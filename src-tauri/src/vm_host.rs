// Spawns the oono-vm-host Swift sidecar and pipes JSON events into the
// EngineRuntimeState. On macOS this is the BundledVm driver. On other
// platforms the sidecar isn't shipped and this module is a no-op.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Arc;
use std::thread;

use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use tauri::Manager;

use crate::engine_runtime::{DriverKind, EnginePhase};
use crate::state::AppState;

pub struct VmHostHandle {
    stdin: Option<ChildStdin>,
    child: Child,
}

impl VmHostHandle {
    pub fn send(&mut self, payload: Value) -> Result<()> {
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| anyhow!("vm-host stdin closed"))?;
        let mut line = serde_json::to_string(&payload)?;
        line.push('\n');
        stdin.write_all(line.as_bytes())?;
        stdin.flush()?;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
pub fn maybe_spawn(app: &tauri::AppHandle, state: Arc<AppState>) -> Result<Option<VmHostHandle>> {
    if state.engine_lifecycle.driver != DriverKind::BundledVm {
        return Ok(None);
    }
    let exe = locate_sidecar(app)?;
    let resources_dir = locate_resources(app)?;

    let mut child = Command::new(&exe)
        .env("OONO_VM_RESOURCES", &resources_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or_else(|| anyhow!("vm-host stdout missing"))?;
    let stderr = child.stderr.take().ok_or_else(|| anyhow!("vm-host stderr missing"))?;

    let state_for_reader = state.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
            handle_event(&state_for_reader, &msg);
        }
    });

    // Drain stderr so the OS pipe buffer never fills. Most lines are normal
    // VM/engine console output (init.sh logs, Acestream progress, etc.) — only
    // promote to Error phase when the line clearly looks like a fatal failure.
    let state_for_stderr = state.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            tracing::debug!("vm-host stderr: {trimmed}");
            if looks_like_fatal(trimmed) {
                tracing::warn!("vm-host fatal line: {trimmed}");
                let mut runtime = state_for_stderr.engine_runtime.lock().unwrap();
                runtime.last_error = Some(trimmed.to_string());
                runtime.phase = crate::engine_runtime::EnginePhase::Error {
                    message: trimmed.to_string(),
                };
            }
        }
    });

    Ok(Some(VmHostHandle {
        stdin,
        child,
    }))
}

#[cfg(not(target_os = "macos"))]
pub fn maybe_spawn(_app: &tauri::AppHandle, _state: Arc<AppState>) -> Result<Option<VmHostHandle>> {
    Ok(None)
}

#[allow(dead_code)]
fn locate_sidecar(app: &tauri::AppHandle) -> Result<std::path::PathBuf> {
    // Tauri's `externalBin: ["binaries/oono-vm-host"]` config places the
    // bundled sidecar at `Contents/MacOS/oono-vm-host` — NEXT TO the main
    // binary, with no `binaries/` subfolder and no arch suffix. The two
    // probes below match that layout and the dev layout (where the source
    // binaries live in `src-tauri/binaries/oono-vm-host-{arch}-apple-darwin`).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(macos_dir) = exe.parent() {
            let bundled = macos_dir.join("oono-vm-host");
            if bundled.exists() {
                return Ok(bundled);
            }
        }
    }

    // As a fallback, ask Tauri for the resolved sidecar path. With Tauri 2
    // some build profiles place it under Resources rather than MacOS.
    if let Ok(path) = app
        .path()
        .resolve("binaries/oono-vm-host", tauri::path::BaseDirectory::Resource)
    {
        if path.exists() {
            return Ok(path);
        }
    }

    // Dev: cargo runs from src-tauri/, sidecar is the arch-suffixed source
    // binary in src-tauri/binaries/.
    if let Ok(cwd) = std::env::current_dir() {
        for arch in ["aarch64", "x86_64"] {
            let p = cwd.join(format!("binaries/oono-vm-host-{arch}-apple-darwin"));
            if p.exists() {
                return Ok(p);
            }
        }
    }

    Err(anyhow!("oono-vm-host sidecar not found"))
}

#[allow(dead_code)]
fn locate_resources(app: &tauri::AppHandle) -> Result<std::path::PathBuf> {
    if let Ok(path) =
        app.path().resolve("resources/vm", tauri::path::BaseDirectory::Resource)
    {
        if path.join("rootfs.img").exists() {
            return Ok(path);
        }
    }
    // Dev fallback: when running `pnpm tauri dev`, the resources live alongside
    // Cargo.toml under src-tauri/resources/vm rather than target/debug/...
    if let Ok(cwd) = std::env::current_dir() {
        let dev = cwd.join("resources/vm");
        if dev.join("rootfs.img").exists() {
            return Ok(dev);
        }
    }
    Err(anyhow!("VM resources not found"))
}

fn handle_event(state: &AppState, msg: &Value) {
    let event = msg.get("event").and_then(|v| v.as_str()).unwrap_or("");
    if event != "phase" {
        return;
    }
    let value = msg.get("value").and_then(|v| v.as_str()).unwrap_or("");
    let mut runtime = state.engine_runtime.lock().unwrap();
    runtime.phase = match value {
        "starting" => EnginePhase::Starting,
        "running" => {
            let since = msg.get("since").and_then(|v| v.as_i64()).unwrap_or(0);
            EnginePhase::Running { since }
        }
        "stopping" => EnginePhase::Stopping,
        "stopped" => EnginePhase::Stopped,
        "error" => {
            let m = msg
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error")
                .to_string();
            runtime.last_error = Some(m.clone());
            EnginePhase::Error { message: m }
        }
        _ => runtime.phase.clone(),
    };
}

pub fn send_start(handle: &mut VmHostHandle) -> Result<()> {
    handle.send(json!({"cmd": "start"}))
}

pub fn send_stop(handle: &mut VmHostHandle) -> Result<()> {
    handle.send(json!({"cmd": "stop"}))
}

pub fn send_shutdown(handle: &mut VmHostHandle) -> Result<()> {
    handle.send(json!({"cmd": "shutdown"}))
}

#[allow(dead_code)]
pub fn wait_child(mut handle: VmHostHandle) {
    let _ = handle.child.wait();
}

fn looks_like_fatal(line: &str) -> bool {
    let l = line.to_lowercase();
    // Definitely-fatal patterns from AVF / kernel / init failure modes.
    l.contains("kernel panic")
        || l.contains("attempt to kill init")
        || l.contains("vzerror")
        || l.contains("the virtual machine failed to start")
        || l.contains("could not locate vm resources")
        || l.starts_with("error domain=")
}
