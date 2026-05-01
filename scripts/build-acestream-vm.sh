#!/usr/bin/env bash
# Builds the Acestream Engine VM artifacts that ship with Oono TV.
#
# Output (in src-tauri/resources/vm/):
#   rootfs.img    ext4 hybrid disk image — ARM64 init + x86_64 Acestream tree
#   kernel        ARM64 Linux kernel (Apple Silicon) suitable for AVF
#   initrd        ARM64 initramfs
#   manifest.json metadata (sha256s, RAM/CPU defaults, init=)
#
# Requirements on the build host:
#   - Docker with buildx + multi-platform support (linux/amd64 + linux/arm64)
#   - macOS host with Apple Virtualization framework (for sanity-test step)
#
# Run this on the dev / CI pipeline only; end users never invoke it.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.."; pwd)"
VM_DIR="${ROOT}/vm-image"
OUT_DIR="${ROOT}/src-tauri/resources/vm"
IMAGE_TAG="oono-acestream-rootfs:latest"

mkdir -p "${OUT_DIR}"

echo "==> Pulling kernel + matching modules from a single apt install"
KSTAGING="${VM_DIR}/kbits"
rm -rf "${KSTAGING}"
mkdir -p "${KSTAGING}"
docker run --rm --platform linux/arm64 \
    -v "${KSTAGING}:/out" \
    ubuntu:22.04 bash -lc "
        set -e
        apt-get update -qq >/dev/null
        # initramfs-tools postinst runs update-initramfs which can return 2 even
        # though it succeeds (it tries to update non-existent older kernels).
        apt-get install -y --no-install-recommends \
            linux-image-generic initramfs-tools zstd kmod 2>&1 | tail -5 || true
        KREL=\$(ls /lib/modules | head -1)
        echo \"kernel version: \$KREL\"

        # Kernel image (gzipped on disk).
        cp /boot/vmlinuz-\$KREL /out/vmlinuz.gz

        # Build a fresh initrd matching this kernel.
        # mkinitramfs needs /lib/modules/<KREL> populated (it is) and a
        # working /etc/initramfs-tools config.
        mkinitramfs -o /out/initrd.img \$KREL

        # Just the modules we need beyond the initrd (rosetta loads after pivot).
        DEST=/out/modules/\$KREL
        mkdir -p \$DEST/kernel/fs/fuse
        cp -a /lib/modules/\$KREL/kernel/fs/fuse/. \$DEST/kernel/fs/fuse/
        # binfmt_misc is also a module in Ubuntu's kernel — needed for Rosetta.
        if [ -f /lib/modules/\$KREL/kernel/fs/binfmt_misc.ko.zst ] || \
           [ -f /lib/modules/\$KREL/kernel/fs/binfmt_misc.ko ]; then
            mkdir -p \$DEST/kernel/fs
            cp /lib/modules/\$KREL/kernel/fs/binfmt_misc.ko* \$DEST/kernel/fs/ 2>/dev/null || true
        fi
        # AF_VSOCK + virtio transport for the host↔guest engine bridge.
        mkdir -p \$DEST/kernel/net/vmw_vsock
        cp -a /lib/modules/\$KREL/kernel/net/vmw_vsock/. \$DEST/kernel/net/vmw_vsock/ 2>/dev/null || true
        find \$DEST -name '*.ko.zst' | while read m; do
            zstd -dq -f \"\$m\" -o \"\${m%.zst}\" && rm -f \"\$m\"
        done
        echo 'Decompressed modules:'
        ls \$DEST/kernel/fs/fuse/
    "
MODULES_STAGING="${VM_DIR}/modules"
rm -rf "${MODULES_STAGING}"
mkdir -p "${MODULES_STAGING}"
cp -a "${KSTAGING}/modules" "${MODULES_STAGING}/"

echo "==> Building hybrid (ARM64 base + x86_64 Acestream) rootfs image"
docker buildx build \
    --platform linux/arm64 \
    --tag "${IMAGE_TAG}" \
    --load \
    "${VM_DIR}"

echo "==> Exporting flattened root filesystem"
TMP_TAR="$(mktemp -t oono-rootfs).tar"
CONTAINER_ID=$(docker create --platform linux/arm64 "${IMAGE_TAG}")
trap 'docker rm -f "${CONTAINER_ID}" >/dev/null 2>&1 || true; rm -f "${TMP_TAR}"' EXIT
docker export "${CONTAINER_ID}" > "${TMP_TAR}"

echo "==> Building ext4 disk image"
ROOTFS_IMG="${OUT_DIR}/rootfs.img"
DISK_SIZE_MB="${DISK_SIZE_MB:-2048}"

docker run --rm --privileged \
    --platform linux/arm64 \
    -v "${TMP_TAR}:/in/rootfs.tar:ro" \
    -v "${OUT_DIR}:/out" \
    alpine:3.20 sh -lc "
        set -e
        apk add --no-cache e2fsprogs >/dev/null
        truncate -s ${DISK_SIZE_MB}M /out/rootfs.img
        mkfs.ext4 -F -L oono-acestream /out/rootfs.img >/dev/null
        mkdir /mnt/root
        mount -o loop /out/rootfs.img /mnt/root
        tar -xf /in/rootfs.tar -C /mnt/root
        umount /mnt/root
    "

echo "==> Decompressing kernel from apt-installed image (matches modules)"
TMP_KERNEL="${KSTAGING}/vmlinuz.gz"
# AVF needs an uncompressed kernel Image.
if file "${TMP_KERNEL}" | grep -qi 'gzip'; then
    gunzip -c "${TMP_KERNEL}" > "${OUT_DIR}/kernel"
else
    cp "${TMP_KERNEL}" "${OUT_DIR}/kernel"
fi

echo "==> Using matching initrd built alongside the kernel"
cp "${KSTAGING}/initrd.img" "${OUT_DIR}/initrd"

echo "==> Manifest"
ROOTFS_SHA=$(shasum -a 256 "${ROOTFS_IMG}" | awk '{print $1}')
KERNEL_SHA=$(shasum -a 256 "${OUT_DIR}/kernel" | awk '{print $1}')
INITRD_SHA=$(shasum -a 256 "${OUT_DIR}/initrd" | awk '{print $1}')
cat > "${OUT_DIR}/manifest.json" <<JSON
{
  "version": "$(date +%Y%m%d)",
  "kernel": "kernel",
  "initrd": "initrd",
  "rootfs": "rootfs.img",
  "rootfs_sha256": "${ROOTFS_SHA}",
  "kernel_sha256": "${KERNEL_SHA}",
  "initrd_sha256": "${INITRD_SHA}",
  "kernel_cmdline": "console=hvc0 root=/dev/vda rw init=/oono-arm64/init.sh quiet",
  "engine_port": 6878,
  "memory_mb": 2048,
  "cpus": 2,
  "platform_kernel": "linux/arm64",
  "rosetta_required_on_apple_silicon": true,
  "rosetta_share_tag": "rosetta"
}
JSON

echo
echo "Done. Artifacts in: ${OUT_DIR}"
ls -lh "${OUT_DIR}"
