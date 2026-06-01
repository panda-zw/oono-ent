use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EnginePhase {
    NotProvisioned,
    Provisioning { progress: f32, message: String },
    Stopped,
    Starting,
    Running { since: i64 },
    Stopping,
    Error { message: String },
}

impl Default for EnginePhase {
    fn default() -> Self {
        EnginePhase::NotProvisioned
    }
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct EngineRuntimeState {
    pub phase: EnginePhase,
    pub host: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DriverKind {
    /// Bundled VM via Apple Virtualization framework (phase 2 — scaffolded but
    /// requires the Swift sidecar). Used on macOS once that lands.
    BundledVm,
    /// External Acestream Engine the user installed themselves on the local machine
    /// or on a remote host accessible by IP:port. Default for Windows / Linux.
    External,
    /// Operating system has no path forward (e.g. macOS today, before Swift sidecar
    /// is wired in).
    Unsupported,
}

pub struct EngineLifecycle {
    pub driver: DriverKind,
}

impl EngineLifecycle {
    pub fn new() -> Self {
        Self {
            driver: detect_driver(),
        }
    }
}

pub fn detect_driver() -> DriverKind {
    #[cfg(target_os = "macos")]
    {
        // BundledVm is selected when the Swift sidecar + VM artifacts are
        // present on disk (production build or post-`build-vm-host.sh`).
        // Otherwise fall back to Unsupported (the user can still use the
        // remote-engine field to point at a Pi/NAS).
        if bundled_vm_available() {
            DriverKind::BundledVm
        } else {
            DriverKind::Unsupported
        }
    }
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        DriverKind::External
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        DriverKind::Unsupported
    }
}

#[cfg(target_os = "macos")]
fn bundled_vm_available() -> bool {
    use std::path::PathBuf;

    // We have to find the rootfs and sidecar without an AppHandle (this runs
    // before Tauri's AppState exists). Two layouts to support:
    //
    //   • Dev (`pnpm tauri dev`):
    //       cwd            = .../src-tauri
    //       binary         = .../src-tauri/target/{debug,release}/iptv-app
    //       sidecar        = src-tauri/binaries/oono-vm-host-{arch}-apple-darwin
    //       rootfs         = src-tauri/resources/vm/rootfs.img
    //
    //   • Production .app (the bundle Tauri ships):
    //       cwd            = / (set by Finder/LaunchServices)
    //       binary         = Oono Ent.app/Contents/MacOS/iptv-app
    //       sidecar        = Oono Ent.app/Contents/MacOS/oono-vm-host
    //       rootfs         = Oono Ent.app/Contents/Resources/resources/vm/rootfs.img
    //
    // Probe both. As long as ONE pair exists we're good.

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let dev_sidecar_arm = cwd.join("binaries/oono-vm-host-aarch64-apple-darwin");
    let dev_sidecar_x86 = cwd.join("binaries/oono-vm-host-x86_64-apple-darwin");
    let dev_rootfs = cwd.join("resources/vm/rootfs.img");
    if (dev_sidecar_arm.exists() || dev_sidecar_x86.exists()) && dev_rootfs.exists() {
        return true;
    }

    if let Ok(exe) = std::env::current_exe() {
        // .app bundle: <bundle>/Contents/MacOS/iptv-app
        if let Some(macos_dir) = exe.parent() {
            // Sidecar lives next to the main binary in Contents/MacOS.
            let bundled_sidecar = macos_dir.join("oono-vm-host");
            if let Some(contents_dir) = macos_dir.parent() {
                // Resources live in <bundle>/Contents/Resources/resources/vm.
                let bundled_rootfs = contents_dir
                    .join("Resources")
                    .join("resources")
                    .join("vm")
                    .join("rootfs.img");
                if bundled_sidecar.exists() && bundled_rootfs.exists() {
                    return true;
                }
            }
        }
    }

    false
}
