use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};

use crate::state::AppState;

pub const GUIDES_URL: &str = "https://iptv-org.github.io/api/guides.json";
const FETCH_COOLDOWN_SECS: i64 = 6 * 3600;
const FETCH_RETRY_BACKOFF_SECS: i64 = 30 * 60;

#[derive(Debug, Deserialize)]
pub struct GuideRecord {
    pub channel: String,
    pub site: String,
    #[serde(default)]
    pub lang: Option<String>,
    pub url: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProgramInfo {
    pub title: String,
    pub description: Option<String>,
    pub start_at: i64,
    pub stop_at: i64,
}

#[derive(Debug, Serialize, Default)]
pub struct NowPlaying {
    pub current: Option<ProgramInfo>,
    pub next: Option<ProgramInfo>,
    pub available: bool,
}

pub async fn refresh_guides(state: &AppState) -> anyhow::Result<usize> {
    let bytes = state
        .http
        .get(GUIDES_URL)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;
    let records: Vec<GuideRecord> = serde_json::from_slice(&bytes)?;

    let mut tx = state.pool.begin().await?;
    sqlx::query("DELETE FROM epg_guides")
        .execute(&mut *tx)
        .await?;
    let mut count = 0usize;
    for r in &records {
        sqlx::query(
            "INSERT OR IGNORE INTO epg_guides (channel_id, site, lang, url) VALUES (?, ?, ?, ?)",
        )
        .bind(&r.channel)
        .bind(&r.site)
        .bind(&r.lang)
        .bind(&r.url)
        .execute(&mut *tx)
        .await?;
        count += 1;
    }
    tx.commit().await?;
    Ok(count)
}

pub async fn now_playing(state: Arc<AppState>, channel: String) -> NowPlaying {
    let now = Utc::now().timestamp();

    if let Ok(np) = lookup_cached(&state, &channel, now).await {
        if np.current.is_some() {
            return np;
        }
    }

    let last: Option<(i64, i64)> = sqlx::query_as(
        "SELECT fetched_at, ok FROM epg_fetch_state WHERE channel_id = ?",
    )
    .bind(&channel)
    .fetch_optional(&state.pool)
    .await
    .unwrap_or(None);

    let needs_fetch = match last {
        None => true,
        Some((fetched_at, ok)) => {
            let cooldown = if ok == 1 {
                FETCH_COOLDOWN_SECS
            } else {
                FETCH_RETRY_BACKOFF_SECS
            };
            now - fetched_at > cooldown
        }
    };

    if needs_fetch {
        let _ = fetch_and_store(&state, &channel).await;
    }

    lookup_cached(&state, &channel, now).await.unwrap_or_default()
}

async fn lookup_cached(
    state: &AppState,
    channel: &str,
    now: i64,
) -> anyhow::Result<NowPlaying> {
    let current: Option<(i64, i64, String, Option<String>)> = sqlx::query_as(
        "SELECT start_at, stop_at, title, description
         FROM epg_programs
         WHERE channel_id = ? AND start_at <= ? AND stop_at > ?
         ORDER BY start_at DESC LIMIT 1",
    )
    .bind(channel)
    .bind(now)
    .bind(now)
    .fetch_optional(&state.pool)
    .await?;

    let next: Option<(i64, i64, String, Option<String>)> = sqlx::query_as(
        "SELECT start_at, stop_at, title, description
         FROM epg_programs
         WHERE channel_id = ? AND start_at > ?
         ORDER BY start_at ASC LIMIT 1",
    )
    .bind(channel)
    .bind(now)
    .fetch_optional(&state.pool)
    .await?;

    let any = current.is_some() || next.is_some();
    Ok(NowPlaying {
        current: current.map(|(start_at, stop_at, title, description)| ProgramInfo {
            start_at,
            stop_at,
            title,
            description,
        }),
        next: next.map(|(start_at, stop_at, title, description)| ProgramInfo {
            start_at,
            stop_at,
            title,
            description,
        }),
        available: any,
    })
}

async fn fetch_and_store(state: &AppState, channel: &str) -> anyhow::Result<()> {
    let urls: Vec<(String,)> =
        sqlx::query_as("SELECT url FROM epg_guides WHERE channel_id = ? LIMIT 4")
            .bind(channel)
            .fetch_all(&state.pool)
            .await?;

    let now = Utc::now().timestamp();
    let mut ok = 0;

    for (url,) in urls {
        let res = state
            .http
            .get(&url)
            .timeout(Duration::from_secs(15))
            .send()
            .await;
        let body = match res {
            Ok(r) => match r.error_for_status() {
                Ok(rr) => match rr.bytes().await {
                    Ok(b) => b,
                    Err(_) => continue,
                },
                Err(_) => continue,
            },
            Err(_) => continue,
        };
        let text = match std::str::from_utf8(&body) {
            Ok(t) => t.to_string(),
            Err(_) => String::from_utf8_lossy(&body).into_owned(),
        };
        let programs = parse_xmltv_for_channel(&text, channel);
        if programs.is_empty() {
            continue;
        }

        let mut tx = state.pool.begin().await?;
        sqlx::query("DELETE FROM epg_programs WHERE channel_id = ?")
            .bind(channel)
            .execute(&mut *tx)
            .await?;
        for p in &programs {
            sqlx::query(
                "INSERT OR REPLACE INTO epg_programs (channel_id, start_at, stop_at, title, description) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(channel)
            .bind(p.start_at)
            .bind(p.stop_at)
            .bind(&p.title)
            .bind(&p.description)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        ok = 1;
        break;
    }

    sqlx::query(
        "INSERT OR REPLACE INTO epg_fetch_state (channel_id, fetched_at, ok) VALUES (?, ?, ?)",
    )
    .bind(channel)
    .bind(now)
    .bind(ok)
    .execute(&state.pool)
    .await?;

    Ok(())
}

fn parse_xmltv_time(s: &str) -> Option<i64> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_str(trimmed, "%Y%m%d%H%M%S %z") {
        return Some(dt.with_timezone(&Utc).timestamp());
    }
    if trimmed.len() >= 14 {
        let date_part = &trimmed[..14];
        if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(date_part, "%Y%m%d%H%M%S") {
            return Some(naive.and_utc().timestamp());
        }
    }
    None
}

fn parse_xmltv_for_channel(xml: &str, channel_id: &str) -> Vec<ProgramInfo> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut programs = Vec::new();
    let mut buf = Vec::new();

    let mut current: Option<ProgramInfo> = None;
    let mut in_title = false;
    let mut in_desc = false;
    let mut text_acc = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = e.name();
                match name.as_ref() {
                    b"programme" => {
                        let attrs: HashMap<String, String> = e
                            .attributes()
                            .filter_map(|a| a.ok())
                            .filter_map(|a| {
                                let k = std::str::from_utf8(a.key.as_ref()).ok()?.to_string();
                                let v = a
                                    .decode_and_unescape_value(reader.decoder())
                                    .ok()?
                                    .into_owned();
                                Some((k, v))
                            })
                            .collect();
                        let chan = attrs.get("channel").cloned().unwrap_or_default();
                        if chan.eq_ignore_ascii_case(channel_id) {
                            let start = parse_xmltv_time(attrs.get("start").map(|s| s.as_str()).unwrap_or(""));
                            let stop = parse_xmltv_time(attrs.get("stop").map(|s| s.as_str()).unwrap_or(""));
                            if let (Some(start_at), Some(stop_at)) = (start, stop) {
                                current = Some(ProgramInfo {
                                    title: String::new(),
                                    description: None,
                                    start_at,
                                    stop_at,
                                });
                            }
                        }
                    }
                    b"title" if current.is_some() => {
                        in_title = true;
                        text_acc.clear();
                    }
                    b"desc" if current.is_some() => {
                        in_desc = true;
                        text_acc.clear();
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(t)) => {
                if in_title || in_desc {
                    if let Ok(s) = t.unescape() {
                        text_acc.push_str(&s);
                    }
                }
            }
            Ok(Event::CData(t)) => {
                if in_title || in_desc {
                    if let Ok(s) = std::str::from_utf8(t.as_ref()) {
                        text_acc.push_str(s);
                    }
                }
            }
            Ok(Event::End(e)) => match e.name().as_ref() {
                b"title" => {
                    if in_title {
                        if let Some(p) = current.as_mut() {
                            if p.title.is_empty() {
                                p.title = text_acc.trim().to_string();
                            }
                        }
                    }
                    in_title = false;
                }
                b"desc" => {
                    if in_desc {
                        if let Some(p) = current.as_mut() {
                            if p.description.is_none() {
                                let s = text_acc.trim().to_string();
                                if !s.is_empty() {
                                    p.description = Some(s);
                                }
                            }
                        }
                    }
                    in_desc = false;
                }
                b"programme" => {
                    if let Some(p) = current.take() {
                        if !p.title.is_empty() {
                            programs.push(p);
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    programs
}
