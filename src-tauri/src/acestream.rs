use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use anyhow::Result;
use serde::Serialize;

use crate::state::AppState;

pub const DEFAULT_ENGINE_HOST: &str = "127.0.0.1:6878";

fn current_host(state: &AppState) -> String {
    state.engine_host()
}

fn is_local(host: &str) -> bool {
    host.starts_with("127.0.0.1") || host.starts_with("localhost")
}

#[derive(Debug, Serialize)]
pub struct EngineStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub host: String,
    pub binary_present: bool,
    pub download_url: String,
    pub platform_supported: bool,
    pub platform: &'static str,
}

#[derive(Debug, Serialize)]
pub struct AcestreamHistoryEntry {
    pub content_id: String,
    pub title: Option<String>,
    pub last_played_at: i64,
    pub favorite: bool,
}

pub async fn engine_status(state: &AppState) -> EngineStatus {
    let host = current_host(state);
    let url = format!("http://{host}/webui/api/service?method=get_version");
    let result = state
        .http
        .get(&url)
        .timeout(Duration::from_millis(800))
        .send()
        .await;
    let binary_present = engine_installed().is_some();
    let download = download_url().to_string();
    let supported = platform_supported();
    let plat = platform_label();
    match result {
        Ok(resp) if resp.status().is_success() => {
            let version = resp
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|v| v.get("result").and_then(|r| r.get("version")).and_then(|x| x.as_str()).map(String::from));
            EngineStatus {
                installed: true,
                version,
                host: host.clone(),
                binary_present,
                download_url: download,
                platform_supported: supported,
                platform: plat,
            }
        }
        _ => EngineStatus {
            installed: false,
            version: None,
            host: host.clone(),
            binary_present,
            download_url: download,
            platform_supported: supported,
            platform: plat,
        },
    }
}

pub fn build_stream_url(state: &AppState, content_id: &str) -> String {
    let host = current_host(state);
    // We deliberately use `/ace/getstream` (continuous MPEG-TS over HTTP) and
    // pair it with mpegts.js on the frontend, instead of `/ace/manifest.m3u8`
    // and hls.js. Reasons:
    //   * Acestream's HLS playlist is a sliding-window live playlist with
    //     ~5–7s segments; on Chromium/WKWebView, hls.js + Acestream's
    //     non-standard MPEG-TS framing routinely buffers indefinitely (see
    //     forum.acestream.media "Problem on chrome with m3u8").
    //   * `/ace/getstream` returns a single chunked TS body that mpegts.js
    //     is purpose-built to demux into fMP4 for MSE.
    //   * `transcode_ac3=1` + `transcode_audio=1` ask the engine to convert
    //     AC3/MP2 audio to AAC, which Chromium/WKWebView's MSE can decode.
    //     Without these the audio frequently fails silently and video stalls
    //     after the first GOP.
    // The token at /ace/r/<id>/<token> path is internal; getstream is the
    // documented public entry point.
    format!(
        "http://{host}/ace/getstream?infohash={content_id}&transcode_ac3=1&transcode_audio=1"
    )
}

pub fn try_launch_engine_for(state: &AppState) -> bool {
    if !is_local(&current_host(state)) {
        return false;
    }
    try_launch_engine()
}

pub fn download_url() -> &'static str {
    if cfg!(target_os = "windows") {
        "https://download.acestream.media/products/acestream-full/win/latest"
    } else if cfg!(target_os = "linux") {
        "https://docs.acestream.net/products/#linux"
    } else {
        "https://docs.acestream.net/products/"
    }
}

pub fn platform_supported() -> bool {
    cfg!(target_os = "windows") || cfg!(target_os = "linux")
}

pub fn platform_label() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "other"
    }
}

fn engine_candidates() -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "macos") {
        paths.push(PathBuf::from(
            "/Applications/Acestream.app/Contents/MacOS/acestreamengine",
        ));
        paths.push(PathBuf::from(
            "/Applications/Ace Stream.app/Contents/MacOS/acestreamengine",
        ));
        if let Some(home) = dirs_home() {
            paths.push(home.join(
                "Applications/Acestream.app/Contents/MacOS/acestreamengine",
            ));
        }
    } else if cfg!(target_os = "windows") {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            paths.push(PathBuf::from(format!(
                "{local}\\ACEStream\\engine\\ace_engine.exe"
            )));
        }
        if let Ok(pf) = std::env::var("ProgramFiles(x86)") {
            paths.push(PathBuf::from(format!(
                "{pf}\\ACEStream\\engine\\ace_engine.exe"
            )));
        }
        if let Ok(pf) = std::env::var("ProgramFiles") {
            paths.push(PathBuf::from(format!(
                "{pf}\\ACEStream\\engine\\ace_engine.exe"
            )));
        }
    } else {
        if let Some(home) = dirs_home() {
            paths.push(home.join(".ACEStream/start-engine"));
            paths.push(home.join(".acestream/start-engine"));
        }
        paths.push(PathBuf::from("/usr/bin/acestreamengine"));
        paths.push(PathBuf::from("/usr/local/bin/acestreamengine"));
    }
    paths
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

pub fn engine_installed() -> Option<PathBuf> {
    engine_candidates().into_iter().find(|p| p.exists())
}

pub fn try_launch_engine() -> bool {
    let Some(path) = engine_installed() else {
        return false;
    };
    let result = if cfg!(target_os = "macos") {
        Command::new("open")
            .arg("-g")
            .arg("-a")
            .arg("Acestream")
            .spawn()
            .or_else(|_| {
                Command::new(&path)
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
            })
    } else if cfg!(target_os = "windows") {
        Command::new(&path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
    } else {
        Command::new(&path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
    };
    result.is_ok()
}

pub fn normalize_id(input: &str) -> Option<String> {
    let s = input.trim();
    let candidate = if let Some(idx) = s.rfind("id=") {
        &s[idx + 3..]
    } else {
        s
    };
    let cleaned: String = candidate
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric())
        .collect();
    if cleaned.len() == 40 && cleaned.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(cleaned.to_lowercase())
    } else {
        None
    }
}

pub async fn save_history(
    state: &AppState,
    content_id: &str,
    title: Option<String>,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp();
    sqlx::query(
        "INSERT INTO acestream_streams (content_id, title, last_played_at, favorite)
         VALUES (?, ?, ?, 0)
         ON CONFLICT(content_id) DO UPDATE SET title = COALESCE(?, title), last_played_at = ?",
    )
    .bind(content_id)
    .bind(&title)
    .bind(now)
    .bind(&title)
    .bind(now)
    .execute(&state.pool)
    .await?;
    Ok(())
}

pub async fn list_history(state: &AppState) -> Result<Vec<AcestreamHistoryEntry>> {
    let rows: Vec<(String, Option<String>, i64, i64)> = sqlx::query_as(
        "SELECT content_id, title, last_played_at, favorite FROM acestream_streams ORDER BY favorite DESC, last_played_at DESC LIMIT 60",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(content_id, title, last_played_at, favorite)| AcestreamHistoryEntry {
            content_id,
            title,
            last_played_at,
            favorite: favorite != 0,
        })
        .collect())
}

pub async fn toggle_favorite(state: &AppState, content_id: &str) -> Result<bool> {
    let cur: Option<(i64,)> =
        sqlx::query_as("SELECT favorite FROM acestream_streams WHERE content_id = ?")
            .bind(content_id)
            .fetch_optional(&state.pool)
            .await?;
    let next = match cur {
        Some((v,)) => if v == 0 { 1 } else { 0 },
        None => 1,
    };
    sqlx::query("UPDATE acestream_streams SET favorite = ? WHERE content_id = ?")
        .bind(next)
        .bind(content_id)
        .execute(&state.pool)
        .await?;
    Ok(next == 1)
}

pub async fn delete_entry(state: &AppState, content_id: &str) -> Result<()> {
    sqlx::query("DELETE FROM acestream_streams WHERE content_id = ?")
        .bind(content_id)
        .execute(&state.pool)
        .await?;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct SearchHit {
    pub content_id: String,
    pub name: String,
    pub bitrate: Option<u64>,
    pub categories: Vec<String>,
    pub countries: Vec<String>,
    pub languages: Vec<String>,
    pub icon: Option<String>,
    pub availability: Option<f32>,
    pub now_playing: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct SearchEnvelope {
    result: Option<SearchResult>,
}

#[derive(Debug, serde::Deserialize)]
struct SearchResult {
    results: Option<Vec<SearchGroup>>,
}

#[derive(Debug, serde::Deserialize)]
struct SearchGroup {
    items: Option<Vec<SearchItem>>,
    epg: Option<Vec<SearchEpg>>,
    icons: Option<Vec<SearchIcon>>,
}

#[derive(Debug, serde::Deserialize)]
struct SearchItem {
    name: Option<String>,
    infohash: Option<String>,
    bitrate: Option<u64>,
    categories: Option<Vec<String>>,
    countries: Option<Vec<String>>,
    languages: Option<Vec<String>>,
    availability: Option<f32>,
}

#[derive(Debug, serde::Deserialize)]
struct SearchEpg {
    name: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct SearchIcon {
    url: Option<String>,
}

// --- Playback-session preflight ----------------------------------------------
// Acestream's `/ace/manifest.m3u8?infohash=X` only returns once the engine
// has discovered enough peers and prebuffered some bytes. For a cold swarm
// this can exceed 90 seconds — far longer than hls.js's manifest TTFB
// timeout. We work around that by calling `/ace/getstream?infohash=X` first
// (which kicks off peer discovery and returns in ~1s with the session
// metadata), then polling `/ace/stat/...` until the engine reports it's
// downloading. Only at that point does the player actually attach hls.js.

#[derive(Debug, Serialize, Clone)]
pub struct AcestreamPrepare {
    pub infohash: String,
    pub session_id: String,
    pub stat_url: String,
    pub command_url: String,
    pub manifest_url: String,
    pub is_live: bool,
}

#[derive(Debug, Serialize, Default)]
pub struct AcestreamStat {
    pub status: Option<String>,
    pub peers: Option<i64>,
    pub speed_down: Option<f64>,
    pub progress: Option<f64>,
    pub downloaded: Option<i64>,
    pub error: Option<String>,
}

pub async fn prepare_session(state: &AppState, content_id: &str) -> Result<AcestreamPrepare> {
    // Idempotent: if we already have an active session for this exact
    // infohash, reuse it. This kills duplicate prepares from React's
    // StrictMode double-invoke and from rapid HMR reloads — both of which
    // would otherwise open two engine sessions for the same content and
    // race each other into a 500.
    {
        let guard = state.active_acestream.lock().unwrap();
        if let Some(existing) = guard.as_ref() {
            if existing.infohash == content_id {
                tracing::info!(
                    "[acestream] reusing active session for {content_id} (cached)"
                );
                return Ok(AcestreamPrepare {
                    infohash: existing.infohash.clone(),
                    session_id: existing.session_id.clone(),
                    stat_url: existing.stat_url.clone(),
                    command_url: existing.command_url.clone(),
                    manifest_url: existing.manifest_url.clone(),
                    is_live: existing.is_live,
                });
            }
        }
    }

    // Different infohash — close the previous session before opening the
    // new one so the engine never has to manage two competing sessions.
    let stale_cmd_url = {
        let mut guard = state.active_acestream.lock().unwrap();
        guard.take().map(|s| s.command_url)
    };
    if let Some(cmd) = stale_cmd_url {
        tracing::info!(
            "[acestream] preparing {content_id} — stopping previous session first"
        );
        let _ = stop_session(state, &cmd).await;
    }

    let host = current_host(state);
    let url = format!("http://{host}/ace/getstream?infohash={content_id}&format=json");
    tracing::info!("[acestream] preparing session for {content_id}");
    let resp = state
        .http
        .get(&url)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("getstream send failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(anyhow::anyhow!(
            "engine getstream returned HTTP {}",
            resp.status()
        ));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| anyhow::anyhow!("getstream body not JSON: {e}"))?;

    if let Some(err) = body.get("error").and_then(|v| v.as_str()) {
        return Err(anyhow::anyhow!("engine error: {err}"));
    }

    let response = body
        .get("response")
        .and_then(|v| v.as_object())
        .ok_or_else(|| anyhow::anyhow!("getstream returned no response object"))?;

    let session_id = response
        .get("playback_session_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("missing playback_session_id"))?
        .to_string();
    let stat_url = response
        .get("stat_url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("missing stat_url"))?
        .to_string();
    let command_url = response
        .get("command_url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("missing command_url"))?
        .to_string();
    let is_live = response
        .get("is_live")
        .and_then(|v| v.as_i64())
        .map(|i| i != 0)
        .unwrap_or(true);

    let manifest_url = build_stream_url(state, content_id);

    tracing::info!(
        "[acestream] session prepared: id={} stat={}",
        session_id,
        stat_url
    );

    let prep = AcestreamPrepare {
        infohash: content_id.to_string(),
        session_id,
        stat_url,
        command_url,
        manifest_url,
        is_live,
    };

    {
        let mut guard = state.active_acestream.lock().unwrap();
        *guard = Some(crate::state::ActiveAceSession {
            infohash: prep.infohash.clone(),
            command_url: prep.command_url.clone(),
            stat_url: prep.stat_url.clone(),
            session_id: prep.session_id.clone(),
            manifest_url: prep.manifest_url.clone(),
            is_live: prep.is_live,
        });
    }

    Ok(prep)
}

// Cleanly terminate a playback session via its command_url. Acestream's
// engine retains sessions for a long idle window after the client
// disconnects, so without an explicit stop the engine's internal session
// pool grows by one for every channel the user opens — eventually the
// engine refuses new sessions or stops responding entirely. Fire-and-forget
// best-effort; we don't want a slow stop to block channel switching.
pub async fn stop_session(state: &AppState, command_url: &str) -> Result<()> {
    // Clear active slot if this is the live session — keeps backend's
    // notion of "active" honest if frontend explicitly tears down.
    {
        let mut guard = state.active_acestream.lock().unwrap();
        if let Some(s) = guard.as_ref() {
            if s.command_url == command_url {
                guard.take();
            }
        }
    }

    let url = format!("{command_url}?method=stop");
    let resp = state
        .http
        .get(&url)
        .timeout(Duration::from_secs(5))
        .send()
        .await;
    match resp {
        Ok(r) => {
            tracing::info!(
                "[acestream] stop session -> {} ({command_url})",
                r.status()
            );
        }
        Err(e) => {
            tracing::warn!("[acestream] stop session failed: {e} ({command_url})");
        }
    }
    Ok(())
}

pub async fn read_stat(state: &AppState, stat_url: &str) -> Result<AcestreamStat> {
    let url = if stat_url.contains("format=") {
        stat_url.to_string()
    } else if stat_url.contains('?') {
        format!("{stat_url}&format=json")
    } else {
        format!("{stat_url}?format=json")
    };
    let resp = state
        .http
        .get(&url)
        .timeout(Duration::from_secs(8))
        .send()
        .await?;
    if !resp.status().is_success() {
        return Ok(AcestreamStat {
            error: Some(format!("stat returned HTTP {}", resp.status())),
            ..Default::default()
        });
    }
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    let response = body.get("response").and_then(|v| v.as_object());
    let error_str = body
        .get("error")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);

    Ok(AcestreamStat {
        status: response
            .and_then(|r| r.get("status"))
            .and_then(|v| v.as_str())
            .map(String::from),
        peers: response
            .and_then(|r| r.get("peers"))
            .and_then(|v| v.as_i64()),
        speed_down: response
            .and_then(|r| r.get("speed_down"))
            .and_then(|v| v.as_f64()),
        progress: response
            .and_then(|r| r.get("progress"))
            .and_then(|v| v.as_f64()),
        downloaded: response
            .and_then(|r| r.get("downloaded"))
            .and_then(|v| v.as_i64()),
        error: error_str,
    })
}

pub async fn search(state: &AppState, query: &str) -> Result<Vec<SearchHit>> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let host = current_host(state);
    let url = format!(
        "http://{host}/search/?query={}",
        urlencoding::encode(query.trim())
    );
    let resp = state
        .http
        .get(&url)
        .timeout(Duration::from_secs(15))
        .send()
        .await?;
    if !resp.status().is_success() {
        return Ok(Vec::new());
    }
    let envelope: SearchEnvelope = resp.json().await.unwrap_or(SearchEnvelope { result: None });
    let groups = envelope
        .result
        .and_then(|r| r.results)
        .unwrap_or_default();
    let mut out = Vec::new();
    for g in groups {
        let now = g
            .epg
            .as_ref()
            .and_then(|e| e.first())
            .and_then(|e| e.name.clone())
            .filter(|s| !s.is_empty());
        let icon = g
            .icons
            .as_ref()
            .and_then(|i| i.first())
            .and_then(|i| i.url.clone());
        for it in g.items.unwrap_or_default() {
            let Some(content_id) = it.infohash else { continue };
            let name = it.name.clone().unwrap_or_else(|| content_id.clone());
            out.push(SearchHit {
                content_id,
                name,
                bitrate: it.bitrate,
                categories: it.categories.unwrap_or_default(),
                countries: it.countries.unwrap_or_default(),
                languages: it.languages.unwrap_or_default(),
                icon: icon.clone(),
                availability: it.availability,
                now_playing: now.clone(),
            });
        }
    }
    Ok(out)
}
