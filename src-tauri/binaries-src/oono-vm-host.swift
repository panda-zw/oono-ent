// oono-vm-host.swift
//
// Tauri sidecar that hosts an Apple Virtualization framework VM running the
// Acestream Engine. On Apple Silicon the VM boots an ARM64 Ubuntu kernel and
// uses Rosetta-for-Linux (mounted via virtiofs) to translate x86_64 user-space
// binaries from the Acestream tree.
//
// Wire protocol: newline-delimited JSON over stdin/stdout.
//   Rust -> Swift: {"cmd":"start"|"stop"|"shutdown"|"status"}
//   Swift -> Rust:
//     {"event":"phase","value":"starting|running|stopping|stopped|error",...}
//     {"event":"log","level":"info|warn|error","message":"..."}

import Foundation
import Network
#if canImport(Virtualization)
import Virtualization
#endif

// MARK: - JSON IPC

enum IPC {
    static let queue = DispatchQueue(label: "com.oono.vm-host.ipc")

    static func send(_ payload: [String: Any]) {
        queue.sync {
            guard
                let data = try? JSONSerialization.data(withJSONObject: payload),
                var line = String(data: data, encoding: .utf8)
            else { return }
            line.append("\n")
            FileHandle.standardOutput.write(line.data(using: .utf8)!)
        }
    }

    static func emitPhase(_ value: String, extra: [String: Any] = [:]) {
        var p: [String: Any] = ["event": "phase", "value": value]
        for (k, v) in extra { p[k] = v }
        send(p)
    }

    static func log(_ level: String, _ message: String) {
        send(["event": "log", "level": level, "message": message])
    }
}

// MARK: - VM Host

#if canImport(Virtualization)
@available(macOS 13.0, *)
final class VMHost: NSObject, VZVirtualMachineDelegate {
    let kernel: URL
    let initrd: URL
    let rootfs: URL
    let memoryBytes: UInt64
    let cpuCount: Int
    let cmdline: String
    let rosettaTag: String

    private(set) var vm: VZVirtualMachine?

    init(resourcesDir: URL, manifest: [String: Any]) throws {
        self.kernel  = resourcesDir.appendingPathComponent(manifest["kernel"] as? String ?? "kernel")
        self.initrd  = resourcesDir.appendingPathComponent(manifest["initrd"] as? String ?? "initrd")
        self.rootfs  = resourcesDir.appendingPathComponent(manifest["rootfs"] as? String ?? "rootfs.img")
        let mb = (manifest["memory_mb"] as? Int) ?? 2048
        self.memoryBytes = UInt64(mb) * 1024 * 1024
        self.cpuCount = (manifest["cpus"] as? Int) ?? 2
        self.cmdline = (manifest["kernel_cmdline"] as? String)
            ?? "console=hvc0 root=/dev/vda rw init=/oono-arm64/init.sh quiet"
        self.rosettaTag = (manifest["rosetta_share_tag"] as? String) ?? "rosetta"

        for u in [kernel, initrd, rootfs] {
            guard FileManager.default.fileExists(atPath: u.path) else {
                throw NSError(domain: "oono.vm-host", code: 1,
                              userInfo: [NSLocalizedDescriptionKey: "missing artifact: \(u.path)"])
            }
        }
        super.init()
    }

    /// Make sure Rosetta-for-Linux is installed; installs it on demand.
    /// Apple Silicon only — no-op on Intel where AVF runs amd64 natively.
    @available(macOS 13.0, *)
    func ensureRosettaIfNeeded() async throws -> Bool {
        #if arch(arm64)
        switch VZLinuxRosettaDirectoryShare.availability {
        case .installed:
            return true
        case .notSupported:
            IPC.log("warn", "Rosetta-for-Linux not supported on this machine")
            return false
        case .notInstalled:
            IPC.log("info", "Installing Rosetta-for-Linux (one-time, requires consent)…")
            try await VZLinuxRosettaDirectoryShare.installRosetta()
            return true
        @unknown default:
            return false
        }
        #else
        return false
        #endif
    }

    func buildConfiguration() async throws -> VZVirtualMachineConfiguration {
        let bootloader = VZLinuxBootLoader(kernelURL: kernel)
        bootloader.initialRamdiskURL = initrd
        bootloader.commandLine = cmdline

        let config = VZVirtualMachineConfiguration()
        config.cpuCount   = max(cpuCount, 1)
        config.memorySize = max(memoryBytes, 1024 * 1024 * 1024)
        config.bootLoader = bootloader

        // Storage: rootfs as a virtio block device.
        let diskAttachment = try VZDiskImageStorageDeviceAttachment(url: rootfs, readOnly: false)
        config.storageDevices = [VZVirtioBlockDeviceConfiguration(attachment: diskAttachment)]

        // Networking: NAT — guest:6878 reachable from host:6878.
        let netConfig = VZVirtioNetworkDeviceConfiguration()
        netConfig.attachment = VZNATNetworkDeviceAttachment()
        config.networkDevices = [netConfig]

        // Console: route guest /dev/console to our stderr so the user sees
        // boot logs (and so AVF doesn't fill an unread pipe).
        let serial = VZVirtioConsoleDeviceSerialPortConfiguration()
        serial.attachment = VZFileHandleSerialPortAttachment(
            fileHandleForReading: nil,
            fileHandleForWriting: FileHandle.standardError)
        config.serialPorts = [serial]

        config.entropyDevices       = [VZVirtioEntropyDeviceConfiguration()]
        config.memoryBalloonDevices = [VZVirtioTraditionalMemoryBalloonDeviceConfiguration()]

        // VSOCK device — the host bridges TCP 127.0.0.1:6878 → guest VSOCK :6878.
        config.socketDevices = [VZVirtioSocketDeviceConfiguration()]

        // --- Rosetta-for-Linux directory share (Apple Silicon) -----------
        #if arch(arm64)
        if try await ensureRosettaIfNeeded() {
            do {
                let rosettaShare = try VZLinuxRosettaDirectoryShare()
                let fsDevice = VZVirtioFileSystemDeviceConfiguration(tag: rosettaTag)
                fsDevice.share = rosettaShare
                config.directorySharingDevices = [fsDevice]
                IPC.log("info", "Rosetta-for-Linux share attached as tag '\(rosettaTag)'")
            } catch {
                IPC.log("warn", "Rosetta share unavailable: \(error)")
            }
        }
        #endif

        try config.validate()
        return config
    }

    @MainActor
    func start() async throws {
        IPC.emitPhase("starting")
        let config = try await buildConfiguration()
        let vm = VZVirtualMachine(configuration: config)
        vm.delegate = self
        self.vm = vm
        try await vm.start()

        // Bring up the TCP→VSOCK proxy on the host so 127.0.0.1:6878 reaches
        // the engine inside the guest. Retry a couple of times because the
        // VZVirtioSocketDevice can take a moment after start() to be ready.
        if let socketDev = vm.socketDevices.first as? VZVirtioSocketDevice {
            VsockProxy.shared.activate(socketDev: socketDev,
                                       hostPort: 6878,
                                       guestPort: 6878)
            IPC.log("info", "host TCP listener on 127.0.0.1:6878 → VSOCK :6878")
        } else {
            IPC.log("warn", "no VZVirtioSocketDevice attached; engine unreachable")
        }

        let now = Int(Date().timeIntervalSince1970)
        IPC.emitPhase("running", extra: ["since": now])
    }

    @MainActor
    func stop() async throws {
        guard let vm = vm else { return }
        IPC.emitPhase("stopping")
        if vm.canStop { try await vm.stop() }
        IPC.emitPhase("stopped")
        self.vm = nil
    }

    // VZVirtualMachineDelegate

    func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
        IPC.emitPhase("error", extra: ["message": "\(error)"])
        self.vm = nil
    }

    func guestDidStop(_ virtualMachine: VZVirtualMachine) {
        IPC.emitPhase("stopped")
        self.vm = nil
    }
}
#endif

// MARK: - VSOCK ↔ TCP proxy (POSIX sockets, splice via pread/pwrite loops)

#if canImport(Virtualization)
import Darwin

@available(macOS 13.0, *)
final class VsockProxy {
    static let shared = VsockProxy()
    private var listenFd: Int32 = -1

    func activate(socketDev: VZVirtioSocketDevice, hostPort: UInt16, guestPort: UInt32) {
        if listenFd >= 0 {
            close(listenFd); listenFd = -1
        }
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else {
            IPC.log("error", "socket() failed: \(String(cString: strerror(errno)))")
            return
        }
        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout.size(ofValue: yes)))

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = hostPort.bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let bindRes = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { ptr in
                Darwin.bind(fd, ptr, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        if bindRes != 0 {
            IPC.log("error", "bind 127.0.0.1:\(hostPort) failed: \(String(cString: strerror(errno)))")
            close(fd)
            return
        }
        if Darwin.listen(fd, 16) != 0 {
            IPC.log("error", "listen failed: \(String(cString: strerror(errno)))")
            close(fd)
            return
        }
        listenFd = fd

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.acceptLoop(socketDev: socketDev, guestPort: guestPort)
        }
    }

    private func acceptLoop(socketDev: VZVirtioSocketDevice, guestPort: UInt32) {
        while true {
            let lfd = self.listenFd
            if lfd < 0 { return }
            var clientAddr = sockaddr()
            var clientLen: socklen_t = socklen_t(MemoryLayout<sockaddr>.size)
            let cfd = Darwin.accept(lfd, &clientAddr, &clientLen)
            if cfd < 0 {
                if errno == EINTR { continue }
                IPC.log("warn", "accept err: \(String(cString: strerror(errno)))")
                return
            }
            IPC.log("info", "tcp accepted fd=\(cfd); dialing guest VSOCK :\(guestPort)")
            DispatchQueue.main.async {
                socketDev.connect(toPort: guestPort) { [cfd] result in
                    switch result {
                    case .failure(let err):
                        IPC.log("warn", "VSOCK connect failed: \(err)")
                        close(cfd)
                    case .success(let vsockConn):
                        IPC.log("info", "VSOCK established fd=\(vsockConn.fileDescriptor), splicing")
                        Self.splice(tcpFd: cfd, vsockConn: vsockConn)
                    }
                }
            }
        }
    }

    /// Splice an accepted host TCP socket to a guest VSOCK connection using
    /// kqueue-driven dispatch sources. This is the pattern Apple's own
    /// containerization framework uses (and what Code-Hex/vz, vfkit, etc. all
    /// converge on): dup the FDs so their lifetime decouples from the
    /// Obj-C VZVirtioSocketConnection object, set O_NONBLOCK, drive reads /
    /// writes via DispatchSource read/write sources on a serial queue. A
    /// bare read() on DispatchQueue.global() starves GCD's worker pool and
    /// stalls AVF's internal pump.
    private static func splice(tcpFd: Int32, vsockConn: VZVirtioSocketConnection) {
        let vsockFdDup = dup(vsockConn.fileDescriptor)
        let tcpFdDup = dup(tcpFd)
        // The original tcpFd from accept() is now redundant — we own tcpFdDup.
        Darwin.close(tcpFd)

        // Non-blocking on both dup'd fds.
        _ = fcntl(vsockFdDup, F_SETFL, fcntl(vsockFdDup, F_GETFL) | O_NONBLOCK)
        _ = fcntl(tcpFdDup, F_SETFL, fcntl(tcpFdDup, F_GETFL) | O_NONBLOCK)

        // Strong reference to the VZVirtioSocketConnection — required so AVF
        // doesn't tear down its internal pump while we're reading. Released
        // by the cancel handlers below once both directions have ended.
        let conn = ConnHolder(conn: vsockConn)
        let q = DispatchQueue(label: "com.oono.vsock-splice", qos: .userInitiated)
        let active = AtomicInt(value: 2)

        // Forward bytes from `srcFd` to `dstFd`, kqueue-gated on srcFd.
        func makePump(label: String, srcFd: Int32, dstFd: Int32) -> DispatchSourceRead {
            let src = DispatchSource.makeReadSource(fileDescriptor: srcFd, queue: q)
            var buf = [UInt8](repeating: 0, count: 64 * 1024)
            src.setEventHandler {
                // Read whatever is currently available (avail ≤ buf.count).
                let avail = Int(src.data)
                let toRead = min(buf.count, max(avail, 1))
                let n = buf.withUnsafeMutableBufferPointer {
                    Darwin.read(srcFd, $0.baseAddress, toRead)
                }
                if n > 0 {
                    var written = 0
                    while written < n {
                        let w = buf.withUnsafeBufferPointer {
                            Darwin.write(
                                dstFd,
                                $0.baseAddress!.advanced(by: written),
                                n - written)
                        }
                        if w > 0 {
                            written += w
                        } else if w < 0 && (errno == EAGAIN || errno == EWOULDBLOCK) {
                            // Destination socket is full; spin briefly. For
                            // HTTP responses this almost never happens.
                            usleep(500)
                        } else {
                            // Unrecoverable write error — cancel both pumps.
                            src.cancel()
                            return
                        }
                    }
                } else if n == 0 {
                    // Peer closed read side — propagate by half-closing the
                    // destination's write half so its peer sees EOF, then
                    // cancel this source.
                    Darwin.shutdown(dstFd, SHUT_WR)
                    src.cancel()
                } else if errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR {
                    src.cancel()
                }
            }
            src.setCancelHandler {
                if active.decrement() == 0 {
                    // Both directions ended — close the dup'd fds and release
                    // the AVF connection object. We retained `conn` in this
                    // closure so AVF kept the internal pump alive.
                    Darwin.close(tcpFdDup)
                    Darwin.close(vsockFdDup)
                    _ = conn.conn
                    IPC.log("debug", "splice torn down")
                }
            }
            return src
        }

        let tcpToVsock = makePump(label: "tcp->vsock", srcFd: tcpFdDup, dstFd: vsockFdDup)
        let vsockToTcp = makePump(label: "vsock->tcp", srcFd: vsockFdDup, dstFd: tcpFdDup)
        tcpToVsock.resume()
        vsockToTcp.resume()
    }
}

private final class ConnHolder {
    let conn: VZVirtioSocketConnection
    init(conn: VZVirtioSocketConnection) { self.conn = conn }
}

private final class AtomicInt {
    private var value: Int32
    private let lock = NSLock()
    init(value: Int32) { self.value = value }
    func decrement() -> Int32 {
        lock.lock(); defer { lock.unlock() }
        value -= 1
        return value
    }
}

#endif

// MARK: - Main loop

func resourcesDir() -> URL? {
    if let env = ProcessInfo.processInfo.environment["OONO_VM_RESOURCES"] {
        return URL(fileURLWithPath: env)
    }
    let exe = URL(fileURLWithPath: CommandLine.arguments[0])
    return exe.deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("Resources/vm")
}

func loadManifest(_ dir: URL) -> [String: Any]? {
    let path = dir.appendingPathComponent("manifest.json")
    guard
        let data = try? Data(contentsOf: path),
        let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return nil }
    return obj
}

#if canImport(Virtualization)
@available(macOS 13.0, *)
func bootstrap() {
    guard let dir = resourcesDir(), let manifest = loadManifest(dir) else {
        IPC.emitPhase("error", extra: ["message": "could not locate VM resources"])
        return
    }
    let host: VMHost
    do { host = try VMHost(resourcesDir: dir, manifest: manifest) }
    catch {
        IPC.emitPhase("error", extra: ["message": "\(error)"])
        return
    }
    IPC.emitPhase("stopped")

    // IPC reader runs on its own thread so the main thread stays free to
    // service AVF callbacks and timers.
    let ipcThread = Thread {
        while let line = readLine(strippingNewline: true) {
            guard
                let data = line.data(using: .utf8),
                let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { continue }
            let cmd = msg["cmd"] as? String ?? ""
            DispatchQueue.main.async {
                Task { @MainActor in
                    switch cmd {
                    case "start":
                        do { try await host.start() }
                        catch { IPC.emitPhase("error", extra: ["message": "\(error)"]) }
                    case "stop":
                        do { try await host.stop() }
                        catch { IPC.emitPhase("error", extra: ["message": "\(error)"]) }
                    case "shutdown":
                        do { try await host.stop() } catch { }
                        exit(0)
                    case "status":
                        break
                    default:
                        IPC.log("warn", "unknown cmd: \(cmd)")
                    }
                }
            }
        }
    }
    ipcThread.start()
}
#endif

if #available(macOS 13.0, *) {
    bootstrap()
    RunLoop.main.run()
} else {
    IPC.emitPhase("error", extra: ["message": "macOS 13+ required for Virtualization framework"])
}
