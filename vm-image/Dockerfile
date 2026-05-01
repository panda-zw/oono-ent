# syntax=docker/dockerfile:1.7
#
# Hybrid root filesystem for Apple Virtualization framework on Apple Silicon:
#  - Base FS: magnetikonline/acestream-server (Debian 8 x86_64 + Acestream)
#  - Layered: a small ARM64 toolkit at /oono-arm64/ (busybox-static + init.sh)
#
# The ARM64 kernel boots and runs PID 1 = /oono-arm64/init.sh interpreted by
# /oono-arm64/busybox (ARM64). The script:
#   1. Mounts pseudo-fs (proc/sys/dev/binfmt_misc)
#   2. Mounts the virtiofs Rosetta share at /mnt/rosetta and registers Rosetta
#      as the binfmt_misc handler for x86_64 ELFs.
#   3. Brings up networking via virtio-net + DHCP.
#   4. Execs the original /start-engine — its child /acestreamengine (x86_64)
#      is now transparently translated by Rosetta.
#
# On Intel hosts the Rosetta mount is a no-op; the ARM64 toolkit is harmless
# (it just isn't used because there's no Apple Silicon to need it; an Intel
# build would use a different kernel).

# --- Stage 1: ARM64 toolkit -------------------------------------------------
FROM --platform=linux/arm64 alpine:3.20 AS arm64-toolkit
RUN apk add --no-cache busybox-static
RUN mkdir -p /oono-arm64 \
    && cp /bin/busybox.static /oono-arm64/busybox \
    && chmod +x /oono-arm64/busybox \
    && for cmd in sh mount umount mkdir ln sleep echo cat ls cp rm chmod ip ifconfig udhcpc route awk grep sed; do \
           ln -sf busybox /oono-arm64/$cmd; \
       done
COPY init.sh /oono-arm64/init.sh
COPY udhcpc.sh /oono-arm64/udhcpc.sh
COPY vsock-bridge.bin /oono-arm64/vsock-bridge
RUN chmod +x /oono-arm64/init.sh /oono-arm64/udhcpc.sh /oono-arm64/vsock-bridge

# --- Stage 2: hybrid rootfs ------------------------------------------------
# vstavrinov/acestream-service is the actively-maintained Acestream container
# (Debian 13, Python 3, libssl 3, Engine 3.2.11). The 2019 magnetikonline image
# we used previously hit M2Crypto/libssl-1.0 EC-key failures under Rosetta-for-
# Linux translation; this build uses modern crypto and works.
FROM --platform=linux/amd64 vstavrinov/acestream-service:latest
COPY --from=arm64-toolkit /oono-arm64 /oono-arm64
# Linux kernel module tree (virtiofs, etc.) from the same Ubuntu kernel we boot.
COPY modules/modules /lib/modules

EXPOSE 6878

# Kernel cmdline `init=/oono-arm64/init.sh` (see scripts/build-acestream-vm.sh
# manifest.json). Docker CMD is only used for sanity-testing the FS via Docker.
CMD ["/oono-arm64/init.sh"]
