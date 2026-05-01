use std::time::Duration;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::state::AppState;

const RADIO_BROWSER_BASE: &str = "https://de1.api.radio-browser.info";
const UA: &str = "OonoTV/0.1 (radio-browser client)";

#[derive(Debug, Deserialize)]
struct RbStation {
    stationuuid: String,
    name: String,
    url: String,
    #[serde(default)]
    url_resolved: Option<String>,
    #[serde(default)]
    homepage: Option<String>,
    #[serde(default)]
    favicon: Option<String>,
    #[serde(default)]
    country: Option<String>,
    #[serde(default)]
    countrycode: Option<String>,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    tags: Option<String>,
    #[serde(default)]
    codec: Option<String>,
    #[serde(default)]
    bitrate: Option<i64>,
    #[serde(default)]
    hls: Option<i64>,
    #[serde(default)]
    lastcheckok: Option<i64>,
    #[serde(default)]
    clickcount: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct RadioStation {
    pub uuid: String,
    pub name: String,
    pub url: String,
    pub url_resolved: Option<String>,
    pub homepage: Option<String>,
    pub favicon: Option<String>,
    pub country: Option<String>,
    pub state: Option<String>,
    pub language: Option<String>,
    pub tags: Vec<String>,
    pub codec: Option<String>,
    pub bitrate: Option<i64>,
    pub hls: bool,
    pub last_check_ok: bool,
    pub click_count: i64,
    pub favorite: bool,
    pub curated: bool,
    pub referer: Option<String>,
    pub user_agent: Option<String>,
}

/// Curated overlay of canonical Zimbabwean stations (per radio.md). For each,
/// we either ship a direct stream URL or use a `radio-browser /byname` lookup
/// to resolve a working URL the community has flagged as healthy.
struct CuratedStation {
    name: &'static str,
    /// Override URL when radio-browser is unreliable (Zeno.fm, iono.fm, etc.).
    direct_url: Option<&'static str>,
    /// Search query into radio-browser /byname when no direct URL is set.
    name_query: Option<&'static str>,
    homepage: Option<&'static str>,
    tags: &'static str,
    /// Set when the upstream requires specific Origin/Referer (Zeno.fm). The
    /// radio player routes the URL through the local HTTP proxy with these
    /// headers injected.
    referer: Option<&'static str>,
    user_agent: Option<&'static str>,
}

const ZW_CURATED: &[CuratedStation] = &[
    // ZBC stations — community-submitted, URLs rotate; use radio-browser by-name.
    CuratedStation {
        name: "Radio Zimbabwe",
        // Verified via icy-name "Radio Zimbabwe" — ZBC's flagship Shona/
        // Ndebele station ("Nhepfenyuro yevanhu / Umsakazo webantu").
        direct_url: Some("https://mainradiostreaming.zbc.co.zw:8040/nhepfenuro.mp3"),
        name_query: Some("Radio Zimbabwe"),
        homepage: Some("https://www.radiozim.co.zw"),
        tags: "zimbabwe,zbc,shona,ndebele",
        referer: None, user_agent: None,
    },
    CuratedStation {
        name: "Power FM Zimbabwe",
        // Verified live via icy-name "POWERFM ZIMBABWE" — ZBC's commercial
        // urban station. 192 kbps mp3.
        direct_url: Some("https://mainradiostreaming.zbc.co.zw:8000/radio.mp3"),
        name_query: Some("Power FM Zimbabwe"),
        homepage: Some("https://www.powerfm.co.zw"),
        tags: "zimbabwe,zbc,urban,harare",
        referer: None, user_agent: None,
    },
    CuratedStation {
        name: "National FM",
        // Verified live via icy-name "National FM" — ZBC's indigenous-
        // languages public service station. 192 kbps mp3.
        direct_url: Some("https://mainradiostreaming.zbc.co.zw:8020/national.mp3"),
        name_query: Some("National FM Zimbabwe"),
        homepage: Some("https://nationalfm.co.zw"),
        tags: "zimbabwe,zbc,indigenous",
        referer: None, user_agent: None,
    },
    CuratedStation {
        name: "Classic 263",
        // Verified live via icy-name "Classic 263" — Zimpapers' adult
        // contemporary music station. 320 kbps mp3.
        direct_url: Some("https://mainradiostreaming.zbc.co.zw:8030/radio.mp3"),
        name_query: Some("Classic 263"),
        homepage: Some("https://classic263.co.zw"),
        tags: "zimbabwe,classic,music,harare",
        referer: None, user_agent: None,
    },
    CuratedStation {
        name: "Khulumani FM",
        direct_url: Some("https://khulumanistream.zbc.co.zw:8000/radio.mp3"),
        name_query: Some("Khulumani"),
        homepage: Some("https://www.khulumanifm.co.zw"),
        tags: "zimbabwe,zbc,bulawayo",
        referer: None, user_agent: None,
    },
    // Major commercial.
    CuratedStation {
        name: "Star FM Zimbabwe",
        direct_url: None,
        name_query: Some("Star FM Zimbabwe"),
        homepage: Some("https://starfm.co.zw"),
        tags: "zimbabwe,star,89.7",
        referer: None, user_agent: None,
    },
    CuratedStation {
        name: "ZiFM Stereo",
        direct_url: Some("https://edge.iono.fm/xice/134_medium.aac"),
        name_query: Some("ZiFM"),
        homepage: Some("https://zifmstereo.co.zw"),
        tags: "zimbabwe,commercial,harare,iono",
        referer: None, user_agent: None,
    },
    // Regional + community.
    CuratedStation {
        name: "Capitalk 100.4 FM",
        direct_url: None,
        name_query: Some("Capitalk"),
        homepage: Some("https://capitalkfm.co.zw"),
        tags: "zimbabwe,harare,talk",
        referer: None, user_agent: None,
    },
    CuratedStation {
        name: "Diamond FM",
        // Iono.fm station 160 — Zimpapers' Manicaland regional station.
        // Verified content-type=audio/aac.
        direct_url: Some("https://edge.iono.fm/xice/160_medium.aac"),
        name_query: Some("Diamond FM"),
        homepage: Some("https://diamondfm.co.zw"),
        tags: "zimbabwe,mutare,manicaland,iono",
        referer: None, user_agent: None,
    },
    CuratedStation {
        name: "Skyz Metro FM",
        direct_url: Some("https://stream.zeno.fm/2634b6n4qy8uv"),
        name_query: Some("Skyz Metro"),
        homepage: Some("https://skyzmetroradio.co.zw"),
        tags: "zimbabwe,bulawayo,zeno",
        referer: Some("https://zeno.fm/"),
        user_agent: Some("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"),
    },
    CuratedStation {
        name: "98.4 Midlands FM",
        // Stream URL is wrapped behind a JS player on 984midlands.co.zw and
        // not directly fetchable. We fall back to radio-browser by-name;
        // until a community submission lands there, the station shows up
        // in the list with a placeholder URL pointing at the homepage.
        direct_url: None,
        name_query: Some("984 Midlands FM"),
        homepage: Some("https://984midlands.co.zw"),
        tags: "zimbabwe,midlands,gweru",
        referer: None, user_agent: None,
    },
    CuratedStation {
        name: "Breeze FM",
        direct_url: None,
        name_query: Some("Breeze FM"),
        homepage: Some("https://breezefm.co.zw"),
        tags: "zimbabwe,victoria falls",
        referer: None, user_agent: None,
    },
    CuratedStation {
        name: "YA FM",
        direct_url: None,
        name_query: Some("YA FM"),
        homepage: Some("https://yafm.co.zw"),
        tags: "zimbabwe,zvishavane",
        referer: None, user_agent: None,
    },
    CuratedStation {
        name: "Nehanda Radio",
        direct_url: None,
        name_query: Some("Nehanda Radio"),
        homepage: None,
        tags: "zimbabwe,diaspora,news",
        referer: None, user_agent: None,
    },
    // Online-only with stable direct URLs.
    CuratedStation {
        name: "ZimGospel Masters Radio",
        direct_url: Some("https://stream.zeno.fm/uqmr572cqrhvv"),
        name_query: None,
        homepage: Some("https://zenoradio.com/station/uqmr572cqrhvv"),
        tags: "zimbabwe,gospel,zeno",
        referer: Some("https://zeno.fm/"),
        user_agent: Some("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"),
    },
];
fn looks_zimbabwean(s: &RbStation) -> bool {
    let cc = s.countrycode.as_deref().unwrap_or("").to_uppercase();
    if cc == "ZW" {
        return true;
    }
    let country = s.country.as_deref().unwrap_or("").to_lowercase();
    country.contains("zimbabwe")
}

async fn upsert(
    state: &AppState,
    s: &RbStation,
    curated: bool,
    referer: Option<&str>,
    user_agent: Option<&str>,
) -> Result<()> {
    let now = chrono::Utc::now().timestamp();
    sqlx::query(
        "INSERT INTO radio_stations
            (uuid, name, url, url_resolved, homepage, favicon, country, state, language,
             tags, codec, bitrate, hls, last_check_ok, click_count, updated_at, curated,
             referer, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uuid) DO UPDATE SET
            name=excluded.name, url=excluded.url, url_resolved=excluded.url_resolved,
            homepage=excluded.homepage, favicon=excluded.favicon, country=excluded.country,
            state=excluded.state, language=excluded.language, tags=excluded.tags,
            codec=excluded.codec, bitrate=excluded.bitrate, hls=excluded.hls,
            last_check_ok=excluded.last_check_ok, click_count=excluded.click_count,
            updated_at=excluded.updated_at,
            curated=MAX(curated, excluded.curated),
            referer=COALESCE(excluded.referer, referer),
            user_agent=COALESCE(excluded.user_agent, user_agent)",
    )
    .bind(&s.stationuuid)
    .bind(&s.name)
    .bind(&s.url)
    .bind(&s.url_resolved)
    .bind(&s.homepage)
    .bind(&s.favicon)
    .bind(&s.country)
    .bind(&s.state)
    .bind(&s.language)
    .bind(&s.tags)
    .bind(&s.codec)
    .bind(&s.bitrate)
    .bind(s.hls.unwrap_or(0))
    .bind(s.lastcheckok.unwrap_or(0))
    .bind(s.clickcount.unwrap_or(0))
    .bind(now)
    .bind(if curated { 1i64 } else { 0i64 })
    .bind(referer)
    .bind(user_agent)
    .execute(&state.pool)
    .await?;
    Ok(())
}

async fn fetch_by_name(state: &AppState, name: &str) -> Vec<RbStation> {
    let q = urlencoding::encode(name);
    let url = format!("{RADIO_BROWSER_BASE}/json/stations/byname/{q}?hidebroken=true&limit=10");
    let res = state
        .http
        .get(&url)
        .header("User-Agent", UA)
        .timeout(Duration::from_secs(15))
        .send()
        .await;
    match res {
        Ok(r) if r.status().is_success() => match r.bytes().await {
            Ok(b) => serde_json::from_slice::<Vec<RbStation>>(&b).unwrap_or_default(),
            Err(_) => vec![],
        },
        _ => vec![],
    }
}

fn synthesize_from_curated(c: &CuratedStation) -> RbStation {
    use std::hash::{Hash, Hasher};
    use std::collections::hash_map::DefaultHasher;
    let mut h = DefaultHasher::new();
    c.name.hash(&mut h);
    let uuid = format!(
        "curated-{:016x}",
        h.finish()
    );
    RbStation {
        stationuuid: uuid,
        name: c.name.to_string(),
        url: c.direct_url.unwrap_or("").to_string(),
        url_resolved: c.direct_url.map(String::from),
        homepage: c.homepage.map(String::from),
        favicon: None,
        country: Some("Zimbabwe".into()),
        countrycode: Some("ZW".into()),
        state: None,
        language: None,
        tags: Some(c.tags.into()),
        codec: None,
        bitrate: None,
        hls: Some(0),
        lastcheckok: Some(1),
        clickcount: Some(0),
    }
}

pub async fn refresh_zw(state: &AppState) -> Result<usize> {
    // Drop non-curated stale entries so radio-browser fixes propagate.
    let _ = sqlx::query("DELETE FROM radio_stations WHERE curated = 0 AND favorite = 0")
        .execute(&state.pool)
        .await;

    let mut total = 0usize;

    // 1) The country lookup, filtered to ZW-tagged entries only.
    let url =
        format!("{RADIO_BROWSER_BASE}/json/stations/bycountrycodeexact/ZW?hidebroken=true");
    if let Ok(resp) = state
        .http
        .get(&url)
        .header("User-Agent", UA)
        .timeout(Duration::from_secs(20))
        .send()
        .await
    {
        if let Ok(bytes) = resp.bytes().await {
            if let Ok(stations) = serde_json::from_slice::<Vec<RbStation>>(&bytes) {
                for s in &stations {
                    if !looks_zimbabwean(s) {
                        continue;
                    }
                    let _ = upsert(state, s, false, None, None).await;
                    total += 1;
                }
            }
        }
    }

    // 2) Curated overlay: by-name lookups + direct-url fallbacks.
    for c in ZW_CURATED {
        if let Some(_url) = c.direct_url {
            let s = synthesize_from_curated(c);
            let _ = upsert(state, &s, true, c.referer, c.user_agent).await;
            total += 1;
            continue;
        }
        if let Some(q) = c.name_query {
            let candidates = fetch_by_name(state, q).await;
            // Prefer ZW-tagged + lastcheckok==1 + highest click count.
            let mut picked: Option<RbStation> = None;
            for s in candidates {
                if !looks_zimbabwean(&s) {
                    continue;
                }
                if s.lastcheckok.unwrap_or(0) == 0 {
                    continue;
                }
                let cur_cc = picked
                    .as_ref()
                    .and_then(|p| p.clickcount)
                    .unwrap_or(0);
                if s.clickcount.unwrap_or(0) >= cur_cc {
                    picked = Some(s);
                }
            }
            if let Some(s) = picked {
                let _ = upsert(state, &s, true, c.referer, c.user_agent).await;
                total += 1;
            } else {
                // Synthesize a placeholder marked curated so the user at least sees the
                // station with its homepage; click-to-play won't work without a stream.
                let mut placeholder = synthesize_from_curated(c);
                placeholder.lastcheckok = Some(0);
                let _ = upsert(state, &placeholder, true, c.referer, c.user_agent).await;
            }
        }
    }

    Ok(total)
}

#[derive(sqlx::FromRow)]
struct StationRow {
    uuid: String,
    name: String,
    url: String,
    url_resolved: Option<String>,
    homepage: Option<String>,
    favicon: Option<String>,
    country: Option<String>,
    state: Option<String>,
    language: Option<String>,
    tags: Option<String>,
    codec: Option<String>,
    bitrate: Option<i64>,
    hls: i64,
    last_check_ok: i64,
    click_count: i64,
    favorite: i64,
    curated: i64,
    referer: Option<String>,
    user_agent: Option<String>,
}

pub async fn list(state: &AppState, search: Option<&str>) -> Result<Vec<RadioStation>> {
    let q = search.map(|s| s.trim()).filter(|s| !s.is_empty());
    let rows: Vec<StationRow> = if let Some(s) = q {
        sqlx::query_as(
            "SELECT uuid, name, url, url_resolved, homepage, favicon, country, state, language,
                    tags, codec, bitrate, hls, last_check_ok, click_count, favorite, curated,
                    referer, user_agent
             FROM radio_stations
             WHERE name LIKE ? OR tags LIKE ?
             ORDER BY favorite DESC, curated DESC, last_check_ok DESC, click_count DESC, name ASC",
        )
        .bind(format!("%{s}%"))
        .bind(format!("%{s}%"))
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT uuid, name, url, url_resolved, homepage, favicon, country, state, language,
                    tags, codec, bitrate, hls, last_check_ok, click_count, favorite, curated,
                    referer, user_agent
             FROM radio_stations
             ORDER BY favorite DESC, curated DESC, last_check_ok DESC, click_count DESC, name ASC",
        )
        .fetch_all(&state.pool)
        .await?
    };

    Ok(rows
        .into_iter()
        .map(|r| {
            let tag_list = r
                .tags
                .as_deref()
                .map(|t| {
                    t.split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_default();
            RadioStation {
                referer: r.referer,
                user_agent: r.user_agent,
                uuid: r.uuid,
                name: r.name,
                url: r.url,
                url_resolved: r.url_resolved,
                homepage: r.homepage,
                favicon: r.favicon,
                country: r.country,
                state: r.state,
                language: r.language,
                tags: tag_list,
                codec: r.codec,
                bitrate: r.bitrate,
                hls: r.hls != 0,
                last_check_ok: r.last_check_ok != 0,
                click_count: r.click_count,
                favorite: r.favorite != 0,
                curated: r.curated != 0,
            }
        })
        .collect())
}

pub async fn set_favorite(state: &AppState, uuid: &str, favorite: bool) -> Result<()> {
    sqlx::query("UPDATE radio_stations SET favorite = ? WHERE uuid = ?")
        .bind(if favorite { 1 } else { 0 })
        .bind(uuid)
        .execute(&state.pool)
        .await?;
    Ok(())
}

pub async fn record_click(state: &AppState, uuid: &str) -> Result<()> {
    sqlx::query("UPDATE radio_stations SET click_count = click_count + 1 WHERE uuid = ?")
        .bind(uuid)
        .execute(&state.pool)
        .await?;
    let url = format!("{RADIO_BROWSER_BASE}/json/url/{uuid}");
    let _ = state
        .http
        .get(&url)
        .timeout(Duration::from_secs(5))
        .header("User-Agent", UA)
        .send()
        .await;
    Ok(())
}
