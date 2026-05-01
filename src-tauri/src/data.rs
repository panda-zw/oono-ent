use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::epg::{self, NowPlaying};
use crate::sources::{self, SourceRow};
use crate::state::AppState;
use crate::vod::{
    self, ContinueWatchingEntry, EpisodeInfo, PersonDetail, PosterCard, SearchResults,
    VodDetail, WatchlistEntry,
};

const STREAMS_URL: &str = "https://iptv-org.github.io/api/streams.json";
const CHANNELS_URL: &str = "https://iptv-org.github.io/api/channels.json";

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StreamRecord {
    pub channel: Option<String>,
    pub url: String,
    #[serde(default)]
    pub referrer: Option<String>,
    #[serde(default)]
    pub user_agent: Option<String>,
    #[serde(default)]
    pub quality: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub feed: Option<String>,
    #[serde(default)]
    pub timeshift: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ChannelRecord {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub country: Option<String>,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub languages: Vec<String>,
    #[serde(default)]
    pub logo: Option<String>,
    #[serde(default)]
    pub network: Option<String>,
    #[serde(default)]
    pub is_nsfw: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct ChannelRow {
    pub channel: String,
    pub name: Option<String>,
    pub url: String,
    pub quality: Option<String>,
    pub label: Option<String>,
    pub referrer: Option<String>,
    pub user_agent: Option<String>,
    pub favorite: bool,
    pub country: Option<String>,
    pub logo: Option<String>,
    pub categories: Vec<String>,
    pub source_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ChannelDetail {
    pub channel: String,
    pub streams: Vec<ChannelRow>,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub search: Option<String>,
    pub category: Option<String>,
    pub country: Option<String>,
    pub quality: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub favorites_only: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct RefreshResult {
    pub streams: usize,
    pub channels: usize,
    pub guides: usize,
    pub external: usize,
}

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub async fn auto_refresh(state: &AppState) -> anyhow::Result<RefreshResult> {
    refresh_inner(state).await
}

#[tauri::command]
pub async fn cmd_refresh_streams(state: State<'_, Arc<AppState>>) -> Result<RefreshResult, String> {
    refresh_inner(state.inner()).await.map_err(map_err)
}

async fn refresh_inner(state: &AppState) -> anyhow::Result<RefreshResult> {
    let streams_bytes = state
        .http
        .get(STREAMS_URL)
        .send()
        .await
        ?
        .error_for_status()
        ?
        .bytes()
        .await
        ?;
    let stream_records: Vec<StreamRecord> =
        serde_json::from_slice(&streams_bytes)?;

    let channels_bytes = state
        .http
        .get(CHANNELS_URL)
        .send()
        .await
        ?
        .error_for_status()
        ?
        .bytes()
        .await
        ?;
    let channel_records: Vec<ChannelRecord> =
        serde_json::from_slice(&channels_bytes)?;

    let mut tx = state.pool.begin().await?;

    sqlx::query("DELETE FROM streams")
        .execute(&mut *tx)
        .await
        ?;
    let mut streams_inserted = 0usize;
    for r in &stream_records {
        let channel = match r.channel.as_deref() {
            Some(c) if !c.is_empty() => c,
            _ => continue,
        };
        sqlx::query(
            "INSERT OR IGNORE INTO streams (channel, url, referrer, user_agent, quality, label, feed, timeshift) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(channel)
        .bind(&r.url)
        .bind(&r.referrer)
        .bind(&r.user_agent)
        .bind(&r.quality)
        .bind(&r.label)
        .bind(&r.feed)
        .bind(&r.timeshift)
        .execute(&mut *tx)
        .await
        ?;
        streams_inserted += 1;
    }

    sqlx::query("DELETE FROM channels_meta")
        .execute(&mut *tx)
        .await
        ?;
    sqlx::query("DELETE FROM channel_categories")
        .execute(&mut *tx)
        .await
        ?;

    let mut channels_inserted = 0usize;
    for c in &channel_records {
        sqlx::query(
            "INSERT OR REPLACE INTO channels_meta (id, name, country, categories_json, languages_json, logo, network, is_nsfw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&c.id)
        .bind(&c.name)
        .bind(&c.country)
        .bind(serde_json::to_string(&c.categories).unwrap_or_else(|_| "[]".into()))
        .bind(serde_json::to_string(&c.languages).unwrap_or_else(|_| "[]".into()))
        .bind(&c.logo)
        .bind(&c.network)
        .bind(if c.is_nsfw { 1 } else { 0 })
        .execute(&mut *tx)
        .await
        ?;

        for cat in &c.categories {
            sqlx::query(
                "INSERT OR IGNORE INTO channel_categories (channel_id, category) VALUES (?, ?)",
            )
            .bind(&c.id)
            .bind(cat)
            .execute(&mut *tx)
            .await
            ?;
        }
        channels_inserted += 1;
    }

    sqlx::query("INSERT OR REPLACE INTO meta(key, value) VALUES ('streams_refreshed_at', ?)")
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut *tx)
        .await
        ?;

    tx.commit().await?;
    let guides = epg::refresh_guides(&state).await.unwrap_or(0);
    let external = sources::refresh_all_enabled(&state).await.unwrap_or(0);
    Ok(RefreshResult {
        streams: streams_inserted,
        channels: channels_inserted,
        guides,
        external,
    })
}

#[tauri::command]
pub async fn cmd_list_sources(state: State<'_, Arc<AppState>>) -> Result<Vec<SourceRow>, String> {
    sources::list_sources(&state).await.map_err(map_err)
}

#[tauri::command]
pub async fn cmd_set_source_enabled(
    state: State<'_, Arc<AppState>>,
    id: String,
    enabled: bool,
) -> Result<i64, String> {
    sources::set_enabled(&state, &id, enabled)
        .await
        .map_err(map_err)?;
    if enabled {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT url FROM external_sources WHERE id = ?")
                .bind(&id)
                .fetch_optional(&state.pool)
                .await
                .map_err(map_err)?;
        if let Some((url,)) = row {
            let n = sources::refresh_one(&state, &id, &url)
                .await
                .map_err(map_err)?;
            return Ok(n as i64);
        }
    }
    Ok(0)
}

#[tauri::command]
pub async fn cmd_now_playing(
    state: State<'_, Arc<AppState>>,
    channel: String,
) -> Result<NowPlaying, String> {
    Ok(epg::now_playing(state.inner().clone(), channel).await)
}

const UNIFIED_SOURCE_SQL: &str = r#"
    SELECT
        s.channel AS channel,
        m.name AS name,
        s.url AS url,
        s.quality AS quality,
        s.label AS label,
        s.referrer AS referrer,
        s.user_agent AS user_agent,
        m.country AS country,
        m.logo AS logo,
        COALESCE(m.categories_json, '[]') AS cats,
        'iptv-org' AS source_id,
        NULL AS group_title
    FROM streams s
    LEFT JOIN channels_meta m ON m.id = s.channel
    UNION ALL
    SELECT
        e.channel AS channel,
        e.display_name AS name,
        e.url AS url,
        NULL AS quality,
        NULL AS label,
        e.referrer AS referrer,
        e.user_agent AS user_agent,
        NULL AS country,
        e.logo AS logo,
        '[]' AS cats,
        e.source_id AS source_id,
        e.group_title AS group_title
    FROM external_streams e
    JOIN external_sources es ON es.id = e.source_id
    WHERE es.enabled = 1 AND e.channel != ''
"#;

#[tauri::command]
pub async fn cmd_list_channels(
    state: State<'_, Arc<AppState>>,
    query: ListQuery,
) -> Result<Vec<ChannelRow>, String> {
    let limit = query.limit.unwrap_or(200).clamp(1, 1500);
    let offset = query.offset.unwrap_or(0).max(0);

    let mut sql = format!(
        "SELECT u.channel, u.name, u.url, u.quality, u.label, u.referrer, u.user_agent,
                CASE WHEN f.channel IS NULL THEN 0 ELSE 1 END AS favorite,
                u.country, u.logo, u.cats, u.source_id, u.group_title
         FROM ({UNIFIED_SOURCE_SQL}) u
         LEFT JOIN favorites f ON f.channel = u.channel
         WHERE 1=1",
    );

    let search = query.search.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
    if search.is_some() {
        sql.push_str(" AND (u.channel LIKE ? OR u.name LIKE ?)");
    }
    if query.category.is_some() {
        sql.push_str(
            " AND (u.channel IN (SELECT channel_id FROM channel_categories WHERE category = ?)
                 OR LOWER(COALESCE(u.group_title, '')) LIKE ?)",
        );
    }
    if query.country.is_some() {
        sql.push_str(" AND u.country = ?");
    }
    if query.quality.is_some() {
        sql.push_str(" AND u.quality = ?");
    }
    if query.favorites_only.unwrap_or(false) {
        sql.push_str(" AND f.channel IS NOT NULL");
    }
    sql.push_str(" GROUP BY u.channel, u.url ORDER BY favorite DESC, COALESCE(u.name, u.channel) ASC LIMIT ? OFFSET ?");

    let mut q = sqlx::query_as::<_, (
        String,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
        Option<String>,
        Option<String>,
        String,
        String,
        Option<String>,
    )>(&sql);
    if let Some(s) = search {
        let like = format!("%{s}%");
        q = q.bind(like.clone()).bind(like);
    }
    if let Some(c) = query.category.as_deref() {
        q = q.bind(c.to_string());
        q = q.bind(format!("%{}%", c.to_lowercase()));
    }
    if let Some(c) = query.country.as_deref() {
        q = q.bind(c.to_string());
    }
    if let Some(qq) = query.quality.as_deref() {
        q = q.bind(qq.to_string());
    }
    q = q.bind(limit).bind(offset);

    let rows = q.fetch_all(&state.pool).await.map_err(map_err)?;
    Ok(rows
        .into_iter()
        .map(|(channel, name, url, quality, label, referrer, user_agent, fav, country, logo, cats_json, source_id, group_title)| {
            let mut categories: Vec<String> = serde_json::from_str(&cats_json).unwrap_or_default();
            if categories.is_empty() {
                if let Some(gt) = group_title.as_deref() {
                    let normalized = normalize_group(gt);
                    if !normalized.is_empty() {
                        categories.push(normalized);
                    }
                }
            }
            ChannelRow {
                channel,
                name,
                url,
                quality,
                label,
                referrer,
                user_agent,
                favorite: fav != 0,
                country,
                logo,
                categories,
                source_id: Some(source_id),
            }
        })
        .collect())
}

fn normalize_group(g: &str) -> String {
    let lower = g.to_lowercase();
    if lower.contains("sport") {
        return "sports".into();
    }
    if lower.contains("news") {
        return "news".into();
    }
    if lower.contains("music") {
        return "music".into();
    }
    if lower.contains("kids") || lower.contains("cartoon") || lower.contains("family") {
        return "kids".into();
    }
    if lower.contains("movie") || lower.contains("cinema") {
        return "movies".into();
    }
    if lower.contains("entertain") {
        return "entertainment".into();
    }
    if lower.contains("doc") {
        return "documentary".into();
    }
    g.split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_lowercase()
}

#[tauri::command]
pub async fn cmd_get_channel(
    state: State<'_, Arc<AppState>>,
    channel: String,
) -> Result<ChannelDetail, String> {
    let sql = format!(
        "SELECT u.channel, u.name, u.url, u.quality, u.label, u.referrer, u.user_agent,
                CASE WHEN f.channel IS NULL THEN 0 ELSE 1 END AS favorite,
                u.country, u.logo, u.cats, u.source_id, u.group_title
         FROM ({UNIFIED_SOURCE_SQL}) u
         LEFT JOIN favorites f ON f.channel = u.channel
         WHERE u.channel = ?
         ORDER BY u.quality DESC"
    );
    let rows = sqlx::query_as::<_, (
        String,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
        Option<String>,
        Option<String>,
        String,
        String,
        Option<String>,
    )>(&sql)
    .bind(&channel)
    .fetch_all(&state.pool)
    .await
    .map_err(map_err)?;

    Ok(ChannelDetail {
        channel,
        streams: rows
            .into_iter()
            .map(|(channel, name, url, quality, label, referrer, user_agent, fav, country, logo, cats_json, source_id, group_title)| {
                let mut categories: Vec<String> = serde_json::from_str(&cats_json).unwrap_or_default();
                if categories.is_empty() {
                    if let Some(gt) = group_title.as_deref() {
                        let n = normalize_group(gt);
                        if !n.is_empty() { categories.push(n); }
                    }
                }
                ChannelRow {
                    channel,
                    name,
                    url,
                    quality,
                    label,
                    referrer,
                    user_agent,
                    favorite: fav != 0,
                    country,
                    logo,
                    categories,
                    source_id: Some(source_id),
                }
            })
            .collect(),
    })
}

#[tauri::command]
pub fn cmd_proxy_url(
    state: State<'_, Arc<AppState>>,
    url: String,
    referrer: Option<String>,
    user_agent: Option<String>,
) -> Result<String, String> {
    let port = state.proxy_port();
    if port == 0 {
        return Err("proxy not ready".into());
    }
    // Only short-circuit URLs that already point at our own proxy — anything
    // else on localhost (notably the bundled Acestream engine on :6878) must
    // be routed through the proxy too so the WebView gets CORS headers and a
    // single same-origin endpoint, and so the proxy can rewrite segment URLs
    // inside the m3u8 to keep all subsequent fetches on the same path.
    let our_prefix = format!("http://127.0.0.1:{port}");
    if url.starts_with(&our_prefix) {
        return Ok(url);
    }
    let mut q = url::form_urlencoded::Serializer::new(String::new());
    q.append_pair("u", &url);
    if let Some(r) = referrer.as_deref() {
        q.append_pair("r", r);
    }
    if let Some(ua) = user_agent.as_deref() {
        q.append_pair("ua", ua);
    }
    Ok(format!("http://127.0.0.1:{port}/proxy?{}", q.finish()))
}

#[tauri::command]
pub async fn cmd_set_favorite(
    state: State<'_, Arc<AppState>>,
    channel: String,
    favorite: bool,
) -> Result<(), String> {
    if favorite {
        sqlx::query("INSERT OR IGNORE INTO favorites(channel, added_at) VALUES (?, ?)")
            .bind(&channel)
            .bind(chrono::Utc::now().timestamp())
            .execute(&state.pool)
            .await
            .map_err(map_err)?;
    } else {
        sqlx::query("DELETE FROM favorites WHERE channel = ?")
            .bind(&channel)
            .execute(&state.pool)
            .await
            .map_err(map_err)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn cmd_list_favorites(state: State<'_, Arc<AppState>>) -> Result<Vec<String>, String> {
    let rows: Vec<(String,)> = sqlx::query_as("SELECT channel FROM favorites ORDER BY added_at DESC")
        .fetch_all(&state.pool)
        .await
        .map_err(map_err)?;
    Ok(rows.into_iter().map(|(c,)| c).collect())
}

#[derive(Debug, Serialize)]
pub struct FacetCount {
    pub value: String,
    pub count: i64,
}

#[tauri::command]
pub async fn cmd_categories(state: State<'_, Arc<AppState>>) -> Result<Vec<FacetCount>, String> {
    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT cc.category, COUNT(DISTINCT s.channel)
         FROM channel_categories cc
         JOIN streams s ON s.channel = cc.channel_id
         GROUP BY cc.category
         ORDER BY 2 DESC",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(map_err)?;

    let ext_rows: Vec<(Option<String>, i64)> = sqlx::query_as(
        "SELECT e.group_title, COUNT(DISTINCT e.channel)
         FROM external_streams e
         JOIN external_sources es ON es.id = e.source_id
         WHERE es.enabled = 1 AND e.group_title IS NOT NULL AND e.group_title != ''
         GROUP BY e.group_title",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(map_err)?;

    let mut combined: std::collections::HashMap<String, i64> = rows.into_iter().collect();
    for (gt, n) in ext_rows {
        if let Some(g) = gt {
            let key = normalize_group(&g);
            if !key.is_empty() {
                *combined.entry(key).or_insert(0) += n;
            }
        }
    }
    let mut result: Vec<FacetCount> = combined
        .into_iter()
        .map(|(value, count)| FacetCount { value, count })
        .collect();
    result.sort_by(|a, b| b.count.cmp(&a.count));
    Ok(result)
}

#[tauri::command]
pub async fn cmd_countries(state: State<'_, Arc<AppState>>) -> Result<Vec<FacetCount>, String> {
    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT m.country, COUNT(DISTINCT s.channel)
         FROM streams s JOIN channels_meta m ON m.id = s.channel
         WHERE m.country IS NOT NULL AND m.country != ''
         GROUP BY m.country ORDER BY 2 DESC LIMIT 250",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(map_err)?;
    Ok(rows
        .into_iter()
        .map(|(value, count)| FacetCount { value, count })
        .collect())
}

#[tauri::command]
pub async fn cmd_vod_set_api_key(
    state: State<'_, Arc<AppState>>,
    key: String,
) -> Result<(), String> {
    vod::set_api_key(&state, &key).await.map_err(map_err)
}

#[tauri::command]
pub async fn cmd_vod_has_api_key(state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    Ok(vod::get_api_key(&state).await.map_err(map_err)?.is_some())
}

#[tauri::command]
pub async fn cmd_vod_browse(
    state: State<'_, Arc<AppState>>,
    list: String,
) -> Result<Vec<PosterCard>, String> {
    let (endpoint, default_kind) = match list.as_str() {
        "trending" => ("/trending/all/week", "movie"),
        "popular_movies" => ("/movie/popular", "movie"),
        "top_rated_movies" => ("/movie/top_rated", "movie"),
        "now_playing_movies" => ("/movie/now_playing", "movie"),
        "popular_tv" => ("/tv/popular", "tv"),
        "top_rated_tv" => ("/tv/top_rated", "tv"),
        "on_the_air_tv" => ("/tv/on_the_air", "tv"),
        _ => return Err("unknown list".into()),
    };
    vod::list_endpoint(state.inner().clone(), endpoint, default_kind)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cmd_vod_search(
    state: State<'_, Arc<AppState>>,
    query: String,
) -> Result<SearchResults, String> {
    vod::search(state.inner().clone(), &query)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cmd_vod_person(
    state: State<'_, Arc<AppState>>,
    tmdb_id: i64,
) -> Result<PersonDetail, String> {
    vod::person_detail(state.inner().clone(), tmdb_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cmd_vod_detail(
    state: State<'_, Arc<AppState>>,
    kind: String,
    tmdb_id: i64,
) -> Result<VodDetail, String> {
    vod::detail(state.inner().clone(), &kind, tmdb_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cmd_vod_episodes(
    state: State<'_, Arc<AppState>>,
    tv_id: i64,
    season: i64,
) -> Result<Vec<EpisodeInfo>, String> {
    vod::season_episodes(state.inner().clone(), tv_id, season)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub fn cmd_vod_embed_url(
    provider: String,
    kind: String,
    tmdb_id: i64,
    season: Option<i64>,
    episode: Option<i64>,
) -> String {
    vod::build_embed_url(&provider, &kind, tmdb_id, season, episode)
}

#[tauri::command]
pub async fn cmd_vod_save_progress(
    state: State<'_, Arc<AppState>>,
    media_id: String,
    season: Option<i64>,
    episode: Option<i64>,
    provider: Option<String>,
    completed: bool,
) -> Result<(), String> {
    vod::save_progress(&state, &media_id, season, episode, provider, completed)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cmd_vod_continue_watching(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ContinueWatchingEntry>, String> {
    vod::continue_watching(&state).await.map_err(map_err)
}

#[tauri::command]
pub async fn cmd_vod_mark_completed(
    state: State<'_, Arc<AppState>>,
    media_id: String,
) -> Result<(), String> {
    vod::mark_completed(&state, &media_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn cmd_vod_clear_progress(
    state: State<'_, Arc<AppState>>,
    media_id: String,
) -> Result<(), String> {
    vod::clear_progress(&state, &media_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cmd_vod_watchlist_add(
    state: State<'_, Arc<AppState>>,
    media_id: String,
) -> Result<(), String> {
    vod::watchlist_add(&state, &media_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn cmd_vod_watchlist_remove(
    state: State<'_, Arc<AppState>>,
    media_id: String,
) -> Result<(), String> {
    vod::watchlist_remove(&state, &media_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cmd_vod_watchlist_has(
    state: State<'_, Arc<AppState>>,
    media_id: String,
) -> Result<bool, String> {
    vod::watchlist_has(&state, &media_id).await.map_err(map_err)
}

#[tauri::command]
pub async fn cmd_vod_watchlist_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<WatchlistEntry>, String> {
    vod::watchlist_list(&state).await.map_err(map_err)
}

#[tauri::command]
pub async fn cmd_add_user_source(
    state: State<'_, Arc<AppState>>,
    name: String,
    url: String,
) -> Result<String, String> {
    let id = sources::add_user_source(&state, name.trim(), url.trim())
        .await
        .map_err(map_err)?;
    let _ = sources::refresh_one(&state, &id, url.trim())
        .await
        .map_err(|e| tracing::warn!("refresh new source failed: {e}"));
    Ok(id)
}

#[tauri::command]
pub async fn cmd_remove_user_source(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    sources::remove_user_source(&state, &id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cmd_acestream_status(
    state: State<'_, Arc<AppState>>,
) -> Result<crate::acestream::EngineStatus, String> {
    Ok(crate::acestream::engine_status(&state).await)
}

#[derive(serde::Serialize)]
pub struct AcestreamPlayResult {
    pub url: String,
    pub content_id: String,
}

#[tauri::command]
pub async fn cmd_acestream_play(
    state: State<'_, Arc<AppState>>,
    input: String,
    title: Option<String>,
) -> Result<AcestreamPlayResult, String> {
    let id = crate::acestream::normalize_id(&input)
        .ok_or_else(|| "Not a valid Acestream ID (expected 40 hex characters)".to_string())?;
    crate::acestream::save_history(&state, &id, title)
        .await
        .map_err(map_err)?;
    Ok(AcestreamPlayResult {
        url: crate::acestream::build_stream_url(&state, &id),
        content_id: id,
    })
}

#[tauri::command]
pub async fn cmd_acestream_history(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<crate::acestream::AcestreamHistoryEntry>, String> {
    crate::acestream::list_history(&state).await.map_err(map_err)
}

#[tauri::command]
pub async fn cmd_acestream_toggle_favorite(
    state: State<'_, Arc<AppState>>,
    content_id: String,
) -> Result<bool, String> {
    crate::acestream::toggle_favorite(&state, &content_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cmd_acestream_delete(
    state: State<'_, Arc<AppState>>,
    content_id: String,
) -> Result<(), String> {
    crate::acestream::delete_entry(&state, &content_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cmd_acestream_schedule(
    state: State<'_, Arc<AppState>>,
    date: Option<String>,
) -> Result<Vec<crate::sports::SportEvent>, String> {
    let date = date.unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%d").to_string());
    crate::sports::fetch_schedule(&state, &date)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cmd_acestream_search(
    state: State<'_, Arc<AppState>>,
    query: String,
) -> Result<Vec<crate::acestream::SearchHit>, String> {
    crate::acestream::search(&state, &query).await.map_err(map_err)
}

#[tauri::command]
pub async fn cmd_acestream_prepare(
    state: State<'_, Arc<AppState>>,
    content_id: String,
) -> Result<crate::acestream::AcestreamPrepare, String> {
    crate::acestream::prepare_session(&state, &content_id)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cmd_acestream_stat(
    state: State<'_, Arc<AppState>>,
    stat_url: String,
) -> Result<crate::acestream::AcestreamStat, String> {
    crate::acestream::read_stat(&state, &stat_url)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cmd_acestream_stop_session(
    state: State<'_, Arc<AppState>>,
    command_url: String,
) -> Result<(), String> {
    crate::acestream::stop_session(&state, &command_url)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub fn cmd_tray_update(
    app: tauri::AppHandle,
    state: crate::TrayState,
) -> Result<(), String> {
    crate::apply_tray_update(&app, &state)
}

#[tauri::command]
pub async fn cmd_health_record_fail(
    state: State<'_, Arc<AppState>>,
    channel: String,
    url: String,
) -> Result<i64, String> {
    crate::health::record_fail(&state, &channel, &url)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cmd_health_record_ok(
    state: State<'_, Arc<AppState>>,
    channel: String,
    url: String,
) -> Result<(), String> {
    crate::health::record_ok(&state, &channel, &url)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cmd_health_list(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<crate::health::HealthRow>, String> {
    crate::health::list(&state).await.map_err(map_err)
}

#[tauri::command]
pub fn cmd_acestream_launch(state: State<'_, Arc<AppState>>) -> bool {
    crate::acestream::try_launch_engine_for(&state)
}

#[tauri::command]
pub fn cmd_acestream_open_download(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let url = crate::acestream::download_url();
    app.opener().open_url(url, None::<&str>).map_err(map_err)
}

#[tauri::command]
pub fn cmd_engine_get_host(state: State<'_, Arc<AppState>>) -> String {
    state.engine_host()
}

#[tauri::command]
pub async fn cmd_engine_set_host(
    state: State<'_, Arc<AppState>>,
    host: String,
) -> Result<(), String> {
    let trimmed = host.trim().to_string();
    if trimmed.is_empty() {
        return Err("Engine host cannot be empty".into());
    }
    state.set_engine_host(trimmed).await.map_err(map_err)
}

#[derive(serde::Serialize)]
pub struct EngineRuntimeInfo {
    pub driver: crate::engine_runtime::DriverKind,
    pub state: crate::engine_runtime::EngineRuntimeState,
    pub host: String,
}

#[tauri::command]
pub fn cmd_engine_runtime_status(
    state: State<'_, Arc<AppState>>,
) -> EngineRuntimeInfo {
    let runtime = state.engine_runtime.lock().unwrap().clone();
    EngineRuntimeInfo {
        driver: state.engine_lifecycle.driver,
        state: runtime,
        host: state.engine_host(),
    }
}

#[cfg(target_os = "macos")]
pub mod vm_commands {
    use super::*;
    use std::sync::Mutex;

    static VM_HANDLE: Mutex<Option<crate::vm_host::VmHostHandle>> = Mutex::new(None);

    pub fn store_handle(h: crate::vm_host::VmHostHandle) {
        let mut g = VM_HANDLE.lock().unwrap();
        *g = Some(h);
    }

    pub fn with_handle<R>(f: impl FnOnce(&mut crate::vm_host::VmHostHandle) -> R) -> Option<R> {
        let mut g = VM_HANDLE.lock().unwrap();
        g.as_mut().map(f)
    }
}

#[cfg(target_os = "macos")]
pub fn vm_install_handle(h: crate::vm_host::VmHostHandle) {
    vm_commands::store_handle(h);
}

#[cfg(target_os = "macos")]
pub fn start_engine_with_watchdog(state: Arc<AppState>) -> Result<(), String> {
    vm_commands::with_handle(|h| crate::vm_host::send_start(h).map_err(map_err))
        .unwrap_or_else(|| Err("VM host not running".into()))?;

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(90));
        let mut runtime = state.engine_runtime.lock().unwrap();
        if matches!(
            runtime.phase,
            crate::engine_runtime::EnginePhase::Starting
                | crate::engine_runtime::EnginePhase::Provisioning { .. }
        ) {
            let msg =
                "Engine took longer than 90 seconds to start. Check Console.app for errors from oono-vm-host. On Apple Silicon this is usually a kernel-architecture mismatch (we ship x86_64 but AVF needs ARM64 + Rosetta-for-Linux).".to_string();
            runtime.last_error = Some(msg.clone());
            runtime.phase = crate::engine_runtime::EnginePhase::Error { message: msg };
        }
    });
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn cmd_engine_start(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    start_engine_with_watchdog(state.inner().clone())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn cmd_engine_stop(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    // Engine is going down — drop the active session record so the next
    // prepare doesn't try to reuse a dead session token.
    state.active_acestream.lock().unwrap().take();
    vm_commands::with_handle(|h| crate::vm_host::send_stop(h).map_err(map_err))
        .unwrap_or_else(|| Err("VM host not running".into()))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn cmd_engine_start() -> Result<(), String> {
    Err("Bundled VM is only available on macOS".into())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn cmd_engine_stop() -> Result<(), String> {
    Err("Bundled VM is only available on macOS".into())
}

#[tauri::command]
pub async fn cmd_radio_refresh(state: State<'_, Arc<AppState>>) -> Result<usize, String> {
    crate::radio::refresh_zw(&state).await.map_err(map_err)
}

#[tauri::command]
pub async fn cmd_radio_list(
    state: State<'_, Arc<AppState>>,
    search: Option<String>,
) -> Result<Vec<crate::radio::RadioStation>, String> {
    crate::radio::list(&state, search.as_deref())
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cmd_radio_set_favorite(
    state: State<'_, Arc<AppState>>,
    uuid: String,
    favorite: bool,
) -> Result<(), String> {
    crate::radio::set_favorite(&state, &uuid, favorite)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cmd_radio_click(
    state: State<'_, Arc<AppState>>,
    uuid: String,
) -> Result<(), String> {
    crate::radio::record_click(&state, &uuid).await.map_err(map_err)
}

#[tauri::command]
pub async fn cmd_vod_genres(
    state: State<'_, Arc<AppState>>,
    kind: String,
) -> Result<Vec<crate::vod::GenreEntry>, String> {
    crate::vod::genres(state.inner().clone(), &kind)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn cmd_vod_discover(
    state: State<'_, Arc<AppState>>,
    query: crate::vod::DiscoverQuery,
) -> Result<Vec<PosterCard>, String> {
    crate::vod::discover(state.inner().clone(), query)
        .await
        .map_err(map_err)
}
