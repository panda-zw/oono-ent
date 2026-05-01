mod acestream;
mod data;
mod db;
mod engine_runtime;
mod epg;
mod health;
mod m3u;
mod proxy;
mod radio;
mod sources;
mod sports;
mod state;
mod vm_host;
mod vod;

use std::sync::Arc;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let app_data_dir = handle.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;

            // System tray. Lets users keep the engine + radio running with
            // the main window minimised, and toggle visibility from the
            // menubar on macOS / system tray on other platforms.
            install_tray(app)?;

            // Intercept the close button so it hides the window instead of
            // quitting the app — the tray icon then keeps the engine,
            // playback, and radio alive in the background. The user can
            // fully quit via the tray menu's "Quit" item or Cmd+Q (which
            // sends a different signal that we don't intercept).
            if let Some(window) = app.get_webview_window("main") {
                let window_for_close = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_for_close.hide();
                    }
                });
            }

            let state = tauri::async_runtime::block_on(async move {
                let state = AppState::new(&app_data_dir).await?;
                let state = Arc::new(state);
                let proxy_port = proxy::spawn(state.clone()).await?;
                state.set_proxy_port(proxy_port);
                Ok::<_, anyhow::Error>(state)
            })?;

            app.handle().manage(state.clone());

            #[cfg(target_os = "macos")]
            {
                let app_handle = app.handle().clone();
                let state_for_vm = state.clone();
                match vm_host::maybe_spawn(&app_handle, state_for_vm) {
                    Ok(Some(handle)) => {
                        tracing::info!("oono-vm-host sidecar spawned");
                        data::vm_install_handle(handle);
                        // Sidecar is up and the bundled VM resources are
                        // present — kick off the engine immediately so the
                        // Acestream page is ready to play the moment the
                        // user opens it. The send_start IPC + 90s watchdog
                        // mirror what cmd_engine_start does on user click.
                        let state_for_autostart = state.clone();
                        std::thread::spawn(move || {
                            // Tiny delay so the sidecar has time to set up
                            // its IPC reader before we push a command.
                            std::thread::sleep(std::time::Duration::from_millis(300));
                            if let Err(e) =
                                data::start_engine_with_watchdog(state_for_autostart)
                            {
                                tracing::warn!("engine auto-start failed: {e}");
                            } else {
                                tracing::info!("engine auto-start dispatched");
                            }
                        });
                    }
                    Ok(None) => {}
                    Err(e) => tracing::warn!("vm-host spawn failed: {e}"),
                }
            }

            tauri::async_runtime::spawn(async move {
                let needs = match sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM streams")
                    .fetch_one(&state.pool)
                    .await
                {
                    Ok(0) => true,
                    Ok(_) => {
                        let last: Option<(String,)> = sqlx::query_as(
                            "SELECT value FROM meta WHERE key = 'streams_refreshed_at'",
                        )
                        .fetch_optional(&state.pool)
                        .await
                        .ok()
                        .flatten();
                        match last {
                            None => true,
                            Some((ts,)) => match chrono::DateTime::parse_from_rfc3339(&ts) {
                                Ok(t) => {
                                    let age = chrono::Utc::now()
                                        .signed_duration_since(t.with_timezone(&chrono::Utc))
                                        .num_hours();
                                    age >= 24
                                }
                                Err(_) => true,
                            },
                        }
                    }
                    Err(_) => false,
                };
                if needs {
                    tracing::info!("auto-refreshing channel data on startup");
                    if let Err(e) = data::auto_refresh(&state).await {
                        tracing::warn!("startup refresh failed: {e}");
                    }
                }

                // Always refresh radio at startup — the curated station list
                // is small, fast, and must be present in the local DB before
                // the radio page renders.
                if let Err(e) = radio::refresh_zw(&state).await {
                    tracing::warn!("radio refresh failed: {e}");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            data::cmd_refresh_streams,
            data::cmd_list_channels,
            data::cmd_get_channel,
            data::cmd_proxy_url,
            data::cmd_set_favorite,
            data::cmd_list_favorites,
            data::cmd_categories,
            data::cmd_countries,
            data::cmd_now_playing,
            data::cmd_list_sources,
            data::cmd_set_source_enabled,
            data::cmd_vod_set_api_key,
            data::cmd_vod_has_api_key,
            data::cmd_vod_browse,
            data::cmd_vod_search,
            data::cmd_vod_detail,
            data::cmd_vod_episodes,
            data::cmd_vod_embed_url,
            data::cmd_vod_save_progress,
            data::cmd_vod_continue_watching,
            data::cmd_vod_mark_completed,
            data::cmd_vod_clear_progress,
            data::cmd_vod_watchlist_add,
            data::cmd_vod_watchlist_remove,
            data::cmd_vod_watchlist_has,
            data::cmd_vod_watchlist_list,
            data::cmd_add_user_source,
            data::cmd_remove_user_source,
            data::cmd_acestream_status,
            data::cmd_acestream_play,
            data::cmd_acestream_history,
            data::cmd_acestream_toggle_favorite,
            data::cmd_acestream_delete,
            data::cmd_acestream_schedule,
            data::cmd_acestream_search,
            data::cmd_acestream_prepare,
            data::cmd_acestream_stat,
            data::cmd_acestream_stop_session,
            data::cmd_health_record_fail,
            data::cmd_health_record_ok,
            data::cmd_health_list,
            data::cmd_acestream_launch,
            data::cmd_acestream_open_download,
            data::cmd_engine_get_host,
            data::cmd_engine_set_host,
            data::cmd_engine_runtime_status,
            data::cmd_engine_start,
            data::cmd_engine_stop,
            data::cmd_radio_refresh,
            data::cmd_radio_list,
            data::cmd_radio_set_favorite,
            data::cmd_radio_click,
            data::cmd_vod_genres,
            data::cmd_vod_discover,
            data::cmd_vod_person,
            data::cmd_tray_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// --- System tray --------------------------------------------------------
// We render a stateful menu that mirrors what's playing in the app right
// now: a now-playing header (title + status), playback controls (play /
// pause / stop / next episode), engine controls (start / restart / stop),
// and the standard show/hide/quit. The menu is rebuilt from scratch by
// `cmd_tray_update` whenever frontend state changes — Tauri's MenuItem
// disabled flag lets us grey out actions that don't apply (e.g. "Next
// episode" when nothing's playing).
//
// Menu clicks emit a `tray-action` event with a string payload (the action
// name) that the frontend listens to and dispatches to its store/player.
// The Rust side never has to know about player internals — it just relays.

fn install_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::Manager;

    let handle = app.app_handle();
    let menu = build_tray_menu(handle, &TrayState::default())?;

    let mut builder = TrayIconBuilder::with_id("oono-tray")
        .tooltip("Oono Ent")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_tray_menu(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon).icon_as_template(true);
    }

    builder.build(app)?;
    Ok(())
}

#[derive(Debug, Default, Clone, serde::Deserialize)]
pub struct TrayState {
    pub now_playing_title: Option<String>,
    pub now_playing_subtitle: Option<String>,
    pub kind: Option<String>, // "live" | "vod" | "radio" | "acestream"
    pub is_playing: bool,
    pub can_next: bool,
    pub engine_state: Option<String>, // "running" | "stopped" | "error" | "starting" | "unresponsive"
}

fn build_tray_menu<R: tauri::Runtime, M: tauri::Manager<R>>(
    app: &M,
    state: &TrayState,
) -> Result<tauri::menu::Menu<R>, Box<dyn std::error::Error>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};

    let nothing_label = "Nothing playing".to_string();
    let header_text = state
        .now_playing_title
        .clone()
        .map(|t| {
            if let Some(sub) = state.now_playing_subtitle.as_deref() {
                if !sub.is_empty() {
                    return format!("Now: {t} — {sub}");
                }
            }
            format!("Now: {t}")
        })
        .unwrap_or(nothing_label);

    let header = MenuItemBuilder::with_id("tray_header", &header_text)
        .enabled(false)
        .build(app)?;

    let has_media = state.now_playing_title.is_some();
    let pause_label = if state.is_playing { "Pause" } else { "Play" };
    let pause = MenuItemBuilder::with_id("tray_play_pause", pause_label)
        .enabled(has_media)
        .build(app)?;
    let stop = MenuItemBuilder::with_id("tray_stop", "Stop")
        .enabled(has_media)
        .build(app)?;
    let next = MenuItemBuilder::with_id("tray_next", "Next episode")
        .enabled(state.can_next)
        .build(app)?;

    let engine_label = match state.engine_state.as_deref() {
        Some("running") => "Engine: Running",
        Some("starting") => "Engine: Starting…",
        Some("stopped") => "Engine: Stopped",
        Some("unresponsive") => "Engine: Unresponsive",
        Some("error") => "Engine: Error",
        _ => "Engine: —",
    };
    let engine_header = MenuItemBuilder::with_id("tray_engine_header", engine_label)
        .enabled(false)
        .build(app)?;
    let engine_running = matches!(state.engine_state.as_deref(), Some("running"));
    let engine_can_start = !matches!(
        state.engine_state.as_deref(),
        Some("running") | Some("starting")
    );
    let engine_start = MenuItemBuilder::with_id("tray_engine_start", "Start engine")
        .enabled(engine_can_start)
        .build(app)?;
    let engine_restart = MenuItemBuilder::with_id("tray_engine_restart", "Restart engine")
        .enabled(state.engine_state.is_some())
        .build(app)?;
    let engine_stop = MenuItemBuilder::with_id("tray_engine_stop", "Stop engine")
        .enabled(engine_running)
        .build(app)?;

    let show = MenuItemBuilder::with_id("tray_show", "Show Oono Ent").build(app)?;
    let hide = MenuItemBuilder::with_id("tray_hide", "Hide window").build(app)?;
    let quit = MenuItemBuilder::with_id("tray_quit", "Quit Oono Ent").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&header)
        .separator()
        .item(&pause)
        .item(&stop)
        .item(&next)
        .separator()
        .item(&engine_header)
        .item(&engine_start)
        .item(&engine_restart)
        .item(&engine_stop)
        .separator()
        .item(&show)
        .item(&hide)
        .separator()
        .item(&quit)
        .build()?;

    Ok(menu)
}

fn handle_tray_menu(app: &tauri::AppHandle, id: &str) {
    use tauri::Emitter;

    match id {
        // Local actions handled entirely in Rust — no frontend round-trip.
        "tray_show" => {
            show_main_window(app);
            return;
        }
        "tray_hide" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.hide();
            }
            return;
        }
        "tray_quit" => {
            app.exit(0);
        }
        // Engine controls call the same backend functions the UI button
        // does, so we handle them in Rust directly to avoid needing the
        // frontend window to be visible.
        #[cfg(target_os = "macos")]
        "tray_engine_start" => {
            use tauri::Manager;
            let state = app.state::<std::sync::Arc<crate::state::AppState>>();
            let _ = data::start_engine_with_watchdog(state.inner().clone());
            return;
        }
        #[cfg(target_os = "macos")]
        "tray_engine_stop" => {
            let state = app
                .state::<std::sync::Arc<crate::state::AppState>>()
                .inner()
                .clone();
            state.active_acestream.lock().unwrap().take();
            let _ = data::vm_commands::with_handle(|h| crate::vm_host::send_stop(h));
            return;
        }
        #[cfg(target_os = "macos")]
        "tray_engine_restart" => {
            let app = app.clone();
            std::thread::spawn(move || {
                use tauri::Manager;
                let state = app
                    .state::<std::sync::Arc<crate::state::AppState>>()
                    .inner()
                    .clone();
                state.active_acestream.lock().unwrap().take();
                let _ = data::vm_commands::with_handle(|h| crate::vm_host::send_stop(h));
                std::thread::sleep(std::time::Duration::from_millis(800));
                let _ = data::start_engine_with_watchdog(state);
            });
            return;
        }
        _ => {}
    }
    // Forward playback actions to the frontend; the Zustand store and the
    // active <Player> are the only place that has full state.
    let action = match id {
        "tray_play_pause" => "play_pause",
        "tray_stop" => "stop",
        "tray_next" => "next",
        _ => return,
    };
    let _ = app.emit("tray-action", action);
}

fn show_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn apply_tray_update(
    app: &tauri::AppHandle,
    state: &TrayState,
) -> Result<(), String> {
    let tray = app
        .tray_by_id("oono-tray")
        .ok_or_else(|| "tray not initialised".to_string())?;
    let menu = build_tray_menu(app, state).map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;

    let title_text = match state.now_playing_title.as_deref() {
        Some(t) if !t.is_empty() => Some(truncate_for_menubar(t)),
        _ => None,
    };
    #[cfg(target_os = "macos")]
    {
        let _ = tray.set_title(title_text.as_deref());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = title_text;
    }
    Ok(())
}

fn truncate_for_menubar(s: &str) -> String {
    // macOS menubar text gets crowded fast — keep it short.
    const MAX: usize = 28;
    let trimmed: String = s.chars().take(MAX).collect();
    if s.chars().count() > MAX {
        format!("{trimmed}…")
    } else {
        trimmed
    }
}
