#!/oono-arm64/busybox sh
# PID 1 inside the bundled Oono TV VM.
#
# Runs as ARM64 (busybox-static) because the AVF VM kernel is ARM64. After we
# register Rosetta-for-Linux as the binfmt_misc handler, the rest of the rootfs
# (x86_64 Debian + Acestream) executes transparently through translation.

set -u
PATH=/oono-arm64:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

exec >/dev/console 2>&1
echo "[oono-init] booting (ARM64 init, x86_64 userspace via Rosetta)"

busybox mount -t proc  proc  /proc      2>/dev/null || true
busybox mount -t sysfs sysfs /sys       2>/dev/null || true
busybox mount -t devtmpfs none /dev     2>/dev/null || true
busybox mount -t tmpfs tmpfs /tmp       2>/dev/null || true
busybox mount -t tmpfs tmpfs /run       2>/dev/null || true
busybox mkdir -p /proc/sys/fs/binfmt_misc
busybox mount -t binfmt_misc none /proc/sys/fs/binfmt_misc 2>/dev/null || true

# --- Load virtiofs kernel module so we can mount the Rosetta share ---------
KREL=$(busybox uname -r 2>/dev/null)
MODDIR="/lib/modules/${KREL}"
echo "[oono-init] kernel ${KREL}"
if [ -d "${MODDIR}" ]; then
    # binfmt_misc, fuse + virtiofs (Rosetta share), AF_VSOCK + virtio transport
    # (host↔guest engine bridge).
    for f in \
        "${MODDIR}/kernel/fs/binfmt_misc.ko" \
        "${MODDIR}/kernel/fs/fuse/fuse.ko" \
        "${MODDIR}/kernel/fs/fuse/virtiofs.ko" \
        "${MODDIR}/kernel/net/vmw_vsock/vsock.ko" \
        "${MODDIR}/kernel/net/vmw_vsock/vmw_vsock_virtio_transport_common.ko" \
        "${MODDIR}/kernel/net/vmw_vsock/vmw_vsock_virtio_transport.ko"; do
        name=$(/oono-arm64/busybox basename "$f")
        if [ -f "$f" ]; then
            if /oono-arm64/busybox insmod "$f" 2>&1; then
                echo "[oono-init] loaded $name"
            else
                echo "[oono-init] failed to insmod $name"
            fi
        else
            echo "[oono-init] module not found: $f"
        fi
    done
    # binfmt_misc auto-mounts /proc/sys/fs/binfmt_misc when loaded; if not, force it.
    busybox mount -t binfmt_misc none /proc/sys/fs/binfmt_misc 2>/dev/null || true
else
    echo "[oono-init] module dir missing: ${MODDIR}"
    /oono-arm64/busybox ls /lib/modules 2>&1 | /oono-arm64/busybox sed 's/^/  /'
fi

# --- Rosetta-for-Linux registration (Apple Silicon only) -------------------
busybox mkdir -p /mnt/rosetta
if busybox mount -t virtiofs rosetta /mnt/rosetta 2>/dev/null; then
    echo "[oono-init] Rosetta share mounted at /mnt/rosetta"
    if [ -x /mnt/rosetta/rosetta ]; then
        # Register Rosetta as the binfmt_misc handler for x86_64 ELFs.
        # The magic + mask pattern matches ELF64 + EM_X86_64 (0x3e == 62).
        echo ':rosetta:M::\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00\x3e\x00:\xff\xff\xff\xff\xff\xfe\xfe\x00\xff\xff\xff\xff\xff\xff\xff\xff\xfe\xff\xff\xff:/mnt/rosetta/rosetta:OCF' \
            > /proc/sys/fs/binfmt_misc/register \
            2>/dev/null && \
            echo "[oono-init] Rosetta binfmt registered" || \
            echo "[oono-init] Rosetta binfmt register write failed"
    else
        echo "[oono-init] /mnt/rosetta/rosetta not executable"
    fi
else
    echo "[oono-init] no Rosetta share (likely Intel host) — assuming amd64 native kernel"
fi

# --- Networking ------------------------------------------------------------
busybox ip link set lo up 2>/dev/null
IFACE=""
for cand in $(busybox ls /sys/class/net 2>/dev/null); do
    case "$cand" in
        lo) ;;
        *) IFACE="$cand"; break ;;
    esac
done
if [ -n "$IFACE" ]; then
    echo "[oono-init] bringing up $IFACE"
    busybox ip link set "$IFACE" up
    if busybox udhcpc -i "$IFACE" -t 8 -T 2 -A 2 -n -q -s /oono-arm64/udhcpc.sh; then
        echo "[oono-init] DHCP succeeded"
    else
        echo "[oono-init] DHCP failed (continuing without network)"
    fi
    echo "[oono-init] addresses:"
    busybox ip -4 addr show "$IFACE" 2>&1 | busybox sed 's/^/  /'
    echo "[oono-init] routes:"
    busybox ip route 2>&1 | busybox sed 's/^/  /'
    echo "[oono-init] resolv.conf:"
    busybox cat /etc/resolv.conf 2>&1 | busybox sed 's/^/  /'
fi

# --- VSOCK <-> TCP bridge for the host -------------------------------------
# Apple Virtualization framework's NAT is opaque to the host, so we expose the
# engine to macOS over AF_VSOCK and let the Swift sidecar bridge host:6878 to
# this listener.
echo "[oono-init] launching vsock-bridge"
/oono-arm64/vsock-bridge &
BRIDGE_PID=$!
echo "[oono-init] vsock-bridge pid=$BRIDGE_PID"

# --- Engine supervision ----------------------------------------------------
# vstavrinov/acestream-service installs Acestream Engine 3.2.11 to /srv/ace,
# Python 3.10 + apsw + pycryptodome under ~ace/.local. We need HOME=/srv/ace
# so Python's site.py picks up the user-site packages dir, and the .ACEStream
# state dir target to exist (/srv/ace/.ACEStream is a symlink to /dev/shm).
busybox mkdir -p /dev/shm/.ACEStream /dev/shm/tmp
echo "[oono-init] starting Acestream engine on :6878"
cd /srv/ace
export HOME=/srv/ace
export PYTHONPATH=/srv/ace/.local/lib/python3.10/site-packages
export PATH=/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin
while true; do
    /oono-arm64/sh /srv/ace/start-engine \
        --client-console \
        --bind-all \
        --live-cache-type memory \
        || echo "[oono-init] engine exited rc=$?"
    echo "[oono-init] restart in 5s"
    busybox sleep 5
done
