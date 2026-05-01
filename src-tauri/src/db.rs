use std::path::Path;

use anyhow::Result;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

pub async fn init(app_data_dir: &Path) -> Result<SqlitePool> {
    let db_path = app_data_dir.join("iptv.db");
    let opts = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS streams (
            channel TEXT NOT NULL,
            url TEXT NOT NULL,
            referrer TEXT,
            user_agent TEXT,
            quality TEXT,
            label TEXT,
            feed TEXT,
            timeshift TEXT,
            PRIMARY KEY (channel, url)
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS channels_meta (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            country TEXT,
            categories_json TEXT,
            languages_json TEXT,
            logo TEXT,
            network TEXT,
            is_nsfw INTEGER DEFAULT 0
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS channel_categories (
            channel_id TEXT NOT NULL,
            category TEXT NOT NULL,
            PRIMARY KEY (channel_id, category)
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_cc_category ON channel_categories(category);")
        .execute(&pool)
        .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS epg_guides (
            channel_id TEXT NOT NULL,
            site TEXT NOT NULL,
            lang TEXT,
            url TEXT NOT NULL,
            PRIMARY KEY (channel_id, url)
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS epg_programs (
            channel_id TEXT NOT NULL,
            start_at INTEGER NOT NULL,
            stop_at INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            PRIMARY KEY (channel_id, start_at)
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_epg_lookup ON epg_programs(channel_id, start_at, stop_at);")
        .execute(&pool)
        .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS epg_fetch_state (
            channel_id TEXT PRIMARY KEY,
            fetched_at INTEGER NOT NULL,
            ok INTEGER NOT NULL
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS external_sources (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            kind TEXT NOT NULL,
            description TEXT,
            enabled INTEGER NOT NULL DEFAULT 0,
            last_refreshed_at INTEGER,
            last_count INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            user_added INTEGER NOT NULL DEFAULT 0
        );
        "#,
    )
    .execute(&pool)
    .await?;

    let _ = sqlx::query("ALTER TABLE external_sources ADD COLUMN user_added INTEGER NOT NULL DEFAULT 0")
        .execute(&pool)
        .await;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS channel_health (
            channel TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            last_ok_at INTEGER,
            last_failed_at INTEGER,
            fail_count INTEGER NOT NULL DEFAULT 0
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS acestream_streams (
            content_id TEXT PRIMARY KEY,
            title TEXT,
            last_played_at INTEGER NOT NULL,
            favorite INTEGER NOT NULL DEFAULT 0
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS external_streams (
            source_id TEXT NOT NULL,
            channel TEXT NOT NULL,
            display_name TEXT,
            url TEXT NOT NULL,
            referrer TEXT,
            user_agent TEXT,
            group_title TEXT,
            logo TEXT,
            PRIMARY KEY (source_id, url)
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_external_streams_channel ON external_streams(channel);")
        .execute(&pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_external_streams_group ON external_streams(LOWER(group_title));")
        .execute(&pool)
        .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS favorites (
            channel TEXT PRIMARY KEY,
            added_at INTEGER NOT NULL
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_streams_channel ON streams(channel);")
        .execute(&pool)
        .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS vod_media (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            tmdb_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            overview TEXT,
            poster_path TEXT,
            backdrop_path TEXT,
            release_date TEXT,
            runtime INTEGER,
            vote_average REAL,
            genres_json TEXT,
            updated_at INTEGER NOT NULL
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS vod_progress (
            media_id TEXT NOT NULL,
            season INTEGER NOT NULL DEFAULT -1,
            episode INTEGER NOT NULL DEFAULT -1,
            last_played_at INTEGER NOT NULL,
            completed INTEGER NOT NULL DEFAULT 0,
            provider TEXT,
            PRIMARY KEY (media_id, season, episode)
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_vod_progress_recent ON vod_progress(last_played_at DESC);")
        .execute(&pool)
        .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS vod_watchlist (
            media_id TEXT PRIMARY KEY,
            added_at INTEGER NOT NULL
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS radio_stations (
            uuid TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            url_resolved TEXT,
            homepage TEXT,
            favicon TEXT,
            country TEXT,
            state TEXT,
            language TEXT,
            tags TEXT,
            codec TEXT,
            bitrate INTEGER,
            hls INTEGER NOT NULL DEFAULT 0,
            last_check_ok INTEGER NOT NULL DEFAULT 0,
            click_count INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL DEFAULT 0,
            favorite INTEGER NOT NULL DEFAULT 0,
            curated INTEGER NOT NULL DEFAULT 0
        );
        "#,
    )
    .execute(&pool)
    .await?;
    let _ = sqlx::query("ALTER TABLE radio_stations ADD COLUMN curated INTEGER NOT NULL DEFAULT 0")
        .execute(&pool)
        .await;
    let _ = sqlx::query("ALTER TABLE radio_stations ADD COLUMN referer TEXT")
        .execute(&pool)
        .await;
    let _ = sqlx::query("ALTER TABLE radio_stations ADD COLUMN user_agent TEXT")
        .execute(&pool)
        .await;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS tmdb_cache (
            cache_key TEXT PRIMARY KEY,
            body TEXT NOT NULL,
            fetched_at INTEGER NOT NULL
        );
        "#,
    )
    .execute(&pool)
    .await?;

    seed_sources(&pool).await?;

    Ok(pool)
}

async fn seed_sources(pool: &SqlitePool) -> Result<()> {
    let seeds: &[(&str, &str, &str, &str, &str)] = &[
        (
            "free-tv",
            "Free-TV / IPTV",
            "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u",
            "legal",
            "Curated free legal channels (HD-only). Smaller, hand-picked list.",
        ),
        (
            "tvpass",
            "TheTVApp (US sports + entertainment)",
            "https://tvpass.org/playlist/m3u",
            "aggregator",
            "Community aggregator of US live TV including major sports networks. Unofficial — streams may rotate or break.",
        ),
        (
            "wcb1969-sports",
            "wcb1969 — global sports",
            "https://raw.githubusercontent.com/wcb1969/iptv/main/sport.txt",
            "aggregator",
            "Large unofficial sports list (heavy on Asia and Middle East feeds). Many streams are region-locked.",
        ),
    ];
    for (id, name, url, kind, desc) in seeds {
        sqlx::query(
            "INSERT OR IGNORE INTO external_sources (id, name, url, kind, description, enabled) VALUES (?, ?, ?, ?, ?, 1)",
        )
        .bind(id)
        .bind(name)
        .bind(url)
        .bind(kind)
        .bind(desc)
        .execute(pool)
        .await?;
    }

    let already: Option<(String,)> =
        sqlx::query_as("SELECT value FROM meta WHERE key = 'sources_default_v1'")
            .fetch_optional(pool)
            .await?;
    if already.is_none() {
        sqlx::query("UPDATE external_sources SET enabled = 1")
            .execute(pool)
            .await?;
        sqlx::query("INSERT OR REPLACE INTO meta(key, value) VALUES ('sources_default_v1', '1')")
            .execute(pool)
            .await?;
    }

    Ok(())
}
