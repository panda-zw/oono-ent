use anyhow::Result;
use serde::Serialize;

use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct HealthRow {
    pub channel: String,
    pub url: String,
    pub last_ok_at: Option<i64>,
    pub last_failed_at: Option<i64>,
    pub fail_count: i64,
}

pub async fn record_ok(state: &AppState, channel: &str, url: &str) -> Result<()> {
    let now = chrono::Utc::now().timestamp();
    sqlx::query(
        "INSERT INTO channel_health (channel, url, last_ok_at, fail_count) VALUES (?, ?, ?, 0)
         ON CONFLICT(channel) DO UPDATE SET url = excluded.url, last_ok_at = excluded.last_ok_at, fail_count = 0",
    )
    .bind(channel)
    .bind(url)
    .bind(now)
    .execute(&state.pool)
    .await?;
    Ok(())
}

pub async fn record_fail(state: &AppState, channel: &str, url: &str) -> Result<i64> {
    let now = chrono::Utc::now().timestamp();
    sqlx::query(
        "INSERT INTO channel_health (channel, url, last_failed_at, fail_count) VALUES (?, ?, ?, 1)
         ON CONFLICT(channel) DO UPDATE SET url = excluded.url, last_failed_at = excluded.last_failed_at, fail_count = fail_count + 1",
    )
    .bind(channel)
    .bind(url)
    .bind(now)
    .execute(&state.pool)
    .await?;
    let row: Option<(i64,)> = sqlx::query_as("SELECT fail_count FROM channel_health WHERE channel = ?")
        .bind(channel)
        .fetch_optional(&state.pool)
        .await?;
    Ok(row.map(|(c,)| c).unwrap_or(0))
}

pub async fn list(state: &AppState) -> Result<Vec<HealthRow>> {
    let rows: Vec<(String, String, Option<i64>, Option<i64>, i64)> = sqlx::query_as(
        "SELECT channel, url, last_ok_at, last_failed_at, fail_count FROM channel_health",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(channel, url, last_ok_at, last_failed_at, fail_count)| HealthRow {
            channel,
            url,
            last_ok_at,
            last_failed_at,
            fail_count,
        })
        .collect())
}
