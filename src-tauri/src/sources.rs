use std::time::Duration;

use anyhow::Result;
use serde::Serialize;

use crate::m3u;
use crate::state::AppState;

#[derive(Debug, Serialize, Clone, sqlx::FromRow)]
pub struct SourceRow {
    pub id: String,
    pub name: String,
    pub url: String,
    pub kind: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub last_refreshed_at: Option<i64>,
    pub last_count: i64,
    pub last_error: Option<String>,
    pub user_added: bool,
}

pub async fn list_sources(state: &AppState) -> Result<Vec<SourceRow>> {
    let rows: Vec<(
        String,
        String,
        String,
        String,
        Option<String>,
        i64,
        Option<i64>,
        i64,
        Option<String>,
        i64,
    )> = sqlx::query_as(
        "SELECT id, name, url, kind, description, enabled, last_refreshed_at, last_count, last_error,
                COALESCE(user_added, 0)
         FROM external_sources ORDER BY user_added DESC, kind, name",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(id, name, url, kind, description, enabled, last_refreshed_at, last_count, last_error, user_added)| SourceRow {
                id,
                name,
                url,
                kind,
                description,
                enabled: enabled != 0,
                last_refreshed_at,
                last_count,
                last_error,
                user_added: user_added != 0,
            },
        )
        .collect())
}

pub async fn add_user_source(
    state: &AppState,
    name: &str,
    url: &str,
) -> Result<String> {
    let now = chrono::Utc::now().timestamp_millis();
    let id = format!("user-{now}");
    sqlx::query(
        "INSERT INTO external_sources (id, name, url, kind, description, enabled, user_added) VALUES (?, ?, ?, 'user', ?, 1, 1)",
    )
    .bind(&id)
    .bind(name)
    .bind(url)
    .bind(format!("Custom playlist · {url}"))
    .execute(&state.pool)
    .await?;
    Ok(id)
}

pub async fn remove_user_source(state: &AppState, id: &str) -> Result<()> {
    sqlx::query("DELETE FROM external_streams WHERE source_id = ?")
        .bind(id)
        .execute(&state.pool)
        .await?;
    sqlx::query("DELETE FROM external_sources WHERE id = ? AND user_added = 1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(())
}

pub async fn set_enabled(state: &AppState, id: &str, enabled: bool) -> Result<()> {
    sqlx::query("UPDATE external_sources SET enabled = ? WHERE id = ?")
        .bind(if enabled { 1 } else { 0 })
        .bind(id)
        .execute(&state.pool)
        .await?;
    if !enabled {
        sqlx::query("DELETE FROM external_streams WHERE source_id = ?")
            .bind(id)
            .execute(&state.pool)
            .await?;
    }
    Ok(())
}

pub async fn refresh_all_enabled(state: &AppState) -> Result<usize> {
    let sources: Vec<(String, String)> =
        sqlx::query_as("SELECT id, url FROM external_sources WHERE enabled = 1")
            .fetch_all(&state.pool)
            .await?;

    let mut total = 0usize;
    for (id, url) in sources {
        match refresh_one(state, &id, &url).await {
            Ok(n) => total += n,
            Err(e) => {
                tracing::warn!("source {id} refresh failed: {e}");
            }
        }
    }
    Ok(total)
}

pub async fn refresh_one(state: &AppState, id: &str, url: &str) -> Result<usize> {
    let now = chrono::Utc::now().timestamp();
    let result: Result<usize> = async {
        let body = state
            .http
            .get(url)
            .timeout(Duration::from_secs(45))
            .send()
            .await?
            .error_for_status()?
            .bytes()
            .await?;
        let text = String::from_utf8_lossy(&body).into_owned();
        let entries = m3u::parse(&text);

        let mut tx = state.pool.begin().await?;
        sqlx::query("DELETE FROM external_streams WHERE source_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        for e in &entries {
            sqlx::query(
                "INSERT OR IGNORE INTO external_streams (source_id, channel, display_name, url, referrer, user_agent, group_title, logo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(id)
            .bind(e.channel_id.as_deref().unwrap_or(""))
            .bind(&e.display_name)
            .bind(&e.url)
            .bind(&e.referrer)
            .bind(&e.user_agent)
            .bind(&e.group_title)
            .bind(&e.logo)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(entries.len())
    }
    .await;

    match result {
        Ok(count) => {
            sqlx::query(
                "UPDATE external_sources SET last_refreshed_at = ?, last_count = ?, last_error = NULL WHERE id = ?",
            )
            .bind(now)
            .bind(count as i64)
            .bind(id)
            .execute(&state.pool)
            .await?;
            Ok(count)
        }
        Err(e) => {
            let msg = format!("{e}");
            sqlx::query(
                "UPDATE external_sources SET last_refreshed_at = ?, last_error = ? WHERE id = ?",
            )
            .bind(now)
            .bind(&msg)
            .bind(id)
            .execute(&state.pool)
            .await?;
            Err(e)
        }
    }
}
