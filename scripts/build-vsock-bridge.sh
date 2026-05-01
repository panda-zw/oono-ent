#!/usr/bin/env bash
# Cross-compiles the in-VM vsock-bridge to a static aarch64-musl binary.
# Output: vm-image/vsock-bridge.bin
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.."; pwd)"
SRC="${ROOT}/vm-image/vsock-bridge"
OUT="${ROOT}/vm-image/vsock-bridge.bin"

echo "==> Cross-compiling vsock-bridge for aarch64-unknown-linux-musl"
docker run --rm \
    --platform linux/arm64 \
    -v "${SRC}:/src" \
    -w /src \
    -e PATH=/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    rust:1-bookworm \
    bash -c "
        set -e
        apt-get update -qq >/dev/null && apt-get install -y -qq musl-tools >/dev/null
        rustup target add aarch64-unknown-linux-musl >/dev/null 2>&1 || true
        cargo build --release --target aarch64-unknown-linux-musl --target-dir /tmp/target
        cp /tmp/target/aarch64-unknown-linux-musl/release/vsock-bridge /src/.binary
    "
mv "${SRC}/.binary" "${OUT}"
chmod +x "${OUT}"
ls -lh "${OUT}"
file "${OUT}" 2>/dev/null || head -c 4 "${OUT}" | od -An -c | head -1
