#!/usr/bin/env bash
# Builds the oono-vm-host Swift sidecar for both Apple Silicon and Intel,
# producing the per-target-triple binaries Tauri expects under
# src-tauri/binaries/.
#
# Run on a macOS 13+ host with Xcode command-line tools installed.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.."; pwd)"
SRC="${ROOT}/src-tauri/binaries-src/oono-vm-host.swift"
ENT="${ROOT}/src-tauri/binaries-src/oono-vm-host.entitlements"
OUT_DIR="${ROOT}/src-tauri/binaries"
mkdir -p "${OUT_DIR}"

if [[ "$(uname)" != "Darwin" ]]; then
    echo "This script must run on macOS." >&2
    exit 1
fi

build_one() {
    local triple="$1"
    local target="$2"
    local out="${OUT_DIR}/oono-vm-host-${triple}"
    echo "==> Compiling ${target} -> ${out}"
    swiftc -O \
        -target "${target}" \
        -framework Virtualization \
        "${SRC}" \
        -o "${out}"
    if [[ -n "${SIGN_IDENTITY:-}" ]]; then
        echo "==> Signing with: ${SIGN_IDENTITY}"
        codesign --force --options=runtime \
            --entitlements "${ENT}" \
            --sign "${SIGN_IDENTITY}" \
            "${out}"
    else
        echo "==> Ad-hoc signing (set SIGN_IDENTITY for release builds)"
        codesign --force --options=runtime \
            --entitlements "${ENT}" \
            --sign - \
            "${out}"
    fi
}

build_one "aarch64-apple-darwin" "arm64-apple-macos13"
build_one "x86_64-apple-darwin"  "x86_64-apple-macos13"

echo
echo "Done."
ls -lh "${OUT_DIR}"
