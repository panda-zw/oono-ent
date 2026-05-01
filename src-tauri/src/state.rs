use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Mutex;

use anyhow::Result;
use reqwest::Client;
use sqlx::SqlitePool;

use crate::db;
use crate::engine_runtime::{EngineLifecycle, EngineRuntimeState};

#[derive(Clone)]
pub struct ActiveAceSession {
    pub infohash: String,
    pub command_url: String,
    pub stat_url: String,
    pub session_id: String,
    pub manifest_url: String,
    pub is_live: bool,
}

pub struct AppState {
    pub pool: SqlitePool,
    pub http: Client,
    pub app_data_dir: PathBuf,
    pub engine_host: Mutex<String>,
    pub engine_runtime: Mutex<EngineRuntimeState>,
    pub engine_lifecycle: EngineLifecycle,
    // Single-slot for the currently active Acestream playback session. The
    // engine is fragile under rapid session churn (concurrent open/close on
    // the same infohash routinely wedges it), so we serialize here: at most
    // one active session ever, with idempotent prepare for repeat infohash
    // and explicit stop-then-open when the infohash changes.
    pub active_acestream: Mutex<Option<ActiveAceSession>>,
    proxy_port: AtomicU16,
}

impl AppState {
    pub async fn new(app_data_dir: &Path) -> Result<Self> {
        let pool = db::init(app_data_dir).await?;
        let http = Client::builder()
            .user_agent("VLC/3.0.20 LibVLC/3.0.20")
            .build()?;

        let host: Option<(String,)> =
            sqlx::query_as("SELECT value FROM meta WHERE key = 'engine_host'")
                .fetch_optional(&pool)
                .await
                .ok()
                .flatten();
        let engine_host = host
            .map(|(v,)| v)
            .unwrap_or_else(|| "127.0.0.1:6878".to_string());

        Ok(Self {
            pool,
            http,
            app_data_dir: app_data_dir.to_path_buf(),
            engine_host: Mutex::new(engine_host),
            engine_runtime: Mutex::new(EngineRuntimeState::default()),
            engine_lifecycle: EngineLifecycle::new(),
            active_acestream: Mutex::new(None),
            proxy_port: AtomicU16::new(0),
        })
    }

    pub fn set_proxy_port(&self, port: u16) {
        self.proxy_port.store(port, Ordering::Relaxed);
    }

    pub fn proxy_port(&self) -> u16 {
        self.proxy_port.load(Ordering::Relaxed)
    }

    pub fn engine_host(&self) -> String {
        self.engine_host.lock().unwrap().clone()
    }

    pub async fn set_engine_host(&self, host: String) -> Result<()> {
        *self.engine_host.lock().unwrap() = host.clone();
        sqlx::query("INSERT OR REPLACE INTO meta(key, value) VALUES ('engine_host', ?)")
            .bind(&host)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
