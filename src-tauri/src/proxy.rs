use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use bytes::Bytes;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

use crate::state::AppState;

pub async fn spawn(state: Arc<AppState>) -> Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    tracing::info!("hls proxy listening on 127.0.0.1:{port}");

    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, addr)) => {
                    let state = state.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle(stream, addr, state).await {
                            tracing::debug!("proxy conn {addr} error: {e:?}");
                        }
                    });
                }
                Err(e) => {
                    tracing::warn!("accept error: {e}");
                }
            }
        }
    });

    Ok(port)
}

async fn handle(stream: TcpStream, addr: SocketAddr, state: Arc<AppState>) -> Result<()> {
    let (read_half, mut write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);

    let mut request_line = String::new();
    let _ = reader.read_line(&mut request_line).await?;
    tracing::info!("[proxy] {addr} <- {}", request_line.trim());
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");

    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).await?;
        if n == 0 || line == "\r\n" || line == "\n" {
            break;
        }
    }

    if method != "GET" && method != "HEAD" {
        write_status(&mut write_half, 405, "Method Not Allowed").await?;
        return Ok(());
    }

    if path == "/health" {
        let body = b"ok";
        write_response(&mut write_half, 200, "OK", "text/plain", body).await?;
        return Ok(());
    }

    if !path.starts_with("/proxy") {
        write_status(&mut write_half, 404, "Not Found").await?;
        return Ok(());
    }

    let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");
    let params: HashMap<String, String> = url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect();

    let target = params
        .get("u")
        .ok_or_else(|| anyhow!("missing u param"))?
        .clone();

    let mut headers = HeaderMap::new();
    if let Some(r) = params.get("r") {
        if let Ok(v) = HeaderValue::from_str(r) {
            headers.insert(reqwest::header::REFERER, v);
        }
    }
    if let Some(ua) = params.get("ua") {
        if let Ok(v) = HeaderValue::from_str(ua) {
            headers.insert(reqwest::header::USER_AGENT, v);
        }
    }

    tracing::info!("[proxy] GET upstream: {target}");
    let started = std::time::Instant::now();
    let upstream = match state
        .http
        .get(&target)
        .headers(headers)
        .send()
        .await
    {
        Ok(r) => {
            tracing::info!(
                "[proxy] upstream RESPONDED status={} after {:?}: {target}",
                r.status(),
                started.elapsed()
            );
            r
        }
        Err(e) => {
            tracing::error!(
                "[proxy] upstream FAILED after {:?}: {e} ({target})",
                started.elapsed()
            );
            write_status(&mut write_half, 502, "Bad Gateway").await?;
            return Ok(());
        }
    };
    let status = upstream.status();
    let content_type = upstream
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let is_manifest = target.ends_with(".m3u8")
        || content_type.contains("mpegurl")
        || content_type.contains("m3u8");

    if is_manifest {
        let body = upstream.bytes().await?;
        let body_len = body.len();
        let rewritten = rewrite_manifest(&body, &target, params.get("r").map(|s| s.as_str()), params.get("ua").map(|s| s.as_str()), state.proxy_port());
        tracing::info!(
            "[proxy] manifest rewritten: in={}B out={}B status={} from {target}",
            body_len,
            rewritten.len(),
            status.as_u16()
        );
        write_response(
            &mut write_half,
            status.as_u16(),
            status.canonical_reason().unwrap_or("OK"),
            "application/vnd.apple.mpegurl",
            rewritten.as_bytes(),
        )
        .await?;
        tracing::info!("[proxy] manifest sent to client for {target}");
    } else {
        let header_block = format!(
            "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
            status.as_u16(),
            status.canonical_reason().unwrap_or("OK"),
            content_type,
        );
        write_half.write_all(header_block.as_bytes()).await?;

        let mut body_stream = upstream.bytes_stream();
        while let Some(chunk) = body_stream.next().await {
            let chunk: Bytes = chunk?;
            if chunk.is_empty() {
                continue;
            }
            let size_line = format!("{:x}\r\n", chunk.len());
            write_half.write_all(size_line.as_bytes()).await?;
            write_half.write_all(&chunk).await?;
            write_half.write_all(b"\r\n").await?;
        }
        write_half.write_all(b"0\r\n\r\n").await?;
    }

    Ok(())
}

fn rewrite_manifest(body: &[u8], target: &str, referrer: Option<&str>, user_agent: Option<&str>, port: u16) -> String {
    let text = String::from_utf8_lossy(body);
    let base = url::Url::parse(target).ok();
    let mut out = String::with_capacity(text.len() + 256);

    for raw in text.lines() {
        let line = raw.trim_end_matches('\r');
        if line.is_empty() || line.starts_with('#') {
            out.push_str(line);
            out.push('\n');
            continue;
        }
        let absolute = if let Some(base) = base.as_ref() {
            base.join(line).map(|u| u.to_string()).unwrap_or_else(|_| line.to_string())
        } else {
            line.to_string()
        };
        let mut q = url::form_urlencoded::Serializer::new(String::new());
        q.append_pair("u", &absolute);
        if let Some(r) = referrer {
            q.append_pair("r", r);
        }
        if let Some(ua) = user_agent {
            q.append_pair("ua", ua);
        }
        out.push_str(&format!("http://127.0.0.1:{port}/proxy?{}", q.finish()));
        out.push('\n');
    }
    out
}

async fn write_response<W: AsyncWriteExt + Unpin>(
    w: &mut W,
    status: u16,
    reason: &str,
    content_type: &str,
    body: &[u8],
) -> Result<()> {
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
        body.len()
    );
    w.write_all(header.as_bytes()).await?;
    w.write_all(body).await?;
    Ok(())
}

async fn write_status<W: AsyncWriteExt + Unpin>(w: &mut W, status: u16, reason: &str) -> Result<()> {
    write_response(w, status, reason, "text/plain", reason.as_bytes()).await
}

