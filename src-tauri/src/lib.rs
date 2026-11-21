mod codec_caps;
mod commands;
mod logging;
mod paths;
mod proxy;
mod state;

use paths::{get_bin_path, hidden_tokio_command, kill_process_tree, sync_bundled_bins};
use state::AppState;
use std::process::Stdio;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{Manager, WindowEvent};

pub fn cleanup_all(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();

    // Stop clipboard watcher
    state.clipboard_watching.store(false, Ordering::SeqCst);
    state.clipboard_gen.fetch_add(1, Ordering::SeqCst);

    // Close popup window if alive
    if let Some(popup) = app.get_webview_window("popup") {
        let _ = popup.destroy();
    }

    // Stop internal proxy
    let proxy = state.proxy.clone();
    tauri::async_runtime::spawn(async move {
        proxy.stop().await;
    });

    // Terminate all active downloads
    {
        let mut active = state.active_downloads.lock().unwrap();
        for (_, dl) in active.drain() {
            if let Some(pid) = dl.pid {
                kill_process_tree(pid);
            }
        }
    }

    // Terminate all active conversions
    {
        let mut mgr = state.conversions.lock().unwrap();
        mgr.queue.clear();
        for (_, conv) in mgr.active.drain() {
            if let Some(pid) = conv.pid {
                kill_process_tree(pid);
            }
        }
        mgr.active_count = 0;
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .setup(|app| {
            let handle = app.handle().clone();

            // Sync bundled binaries into %APPDATA%\BitKit\bin
            sync_bundled_bins(&handle);

            // Clean up any stale completed update installer files
            commands::updater::cleanup_stale_pending_update(&handle);

            // Start internal rate-limiting HTTP CONNECT proxy
            let proxy = app.state::<AppState>().proxy.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = proxy.start().await {
                    logging::write_log("error", &format!("[BitKit:Proxy] Failed to start: {}", e));
                }
            });

            // Background yt-dlp self-update check on startup
            let ytdlp = get_bin_path(&handle, "yt-dlp.exe");
            if ytdlp.exists() {
                let updating_flag = app.state::<AppState>().ytdlp_updating.clone();
                tauri::async_runtime::spawn(async move {
                    updating_flag.store(true, Ordering::SeqCst);
                    let mut cmd = hidden_tokio_command(&ytdlp);
                    cmd.args(["-U", "--ignore-config"])
                        .stdout(Stdio::null())
                        .stderr(Stdio::null());
                    if let Some(parent) = ytdlp.parent() {
                        if !parent.as_os_str().is_empty() {
                            cmd.current_dir(parent);
                        }
                    }
                    let _ = tokio::time::timeout(Duration::from_secs(30), cmd.output()).await;
                    updating_flag.store(false, Ordering::SeqCst);
                });
            }

            // Safety-net show in case page load event fired before hook or delayed
            let show_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(800)).await;
                if let Some(main_win) = show_handle.get_webview_window("main") {
                    if !main_win.is_visible().unwrap_or(false) {
                        let _ = main_win.show();
                    }
                }
            });

            // Open DevTools if launched with --dev
            if std::env::args().any(|a| a == "--dev") {
                if let Some(main_win) = app.get_webview_window("main") {
                    main_win.open_devtools();
                }
            }

            Ok(())
        })
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = webview.show();
            }
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed = event {
                    cleanup_all(window.app_handle());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Window controls
            commands::window::window_minimize,
            commands::window::window_maximize,
            commands::window::window_close,
            commands::window::window_is_maximized,
            commands::window::window_show,
            // Storage (settings, history, queue)
            commands::storage::settings_get,
            commands::storage::settings_set,
            commands::storage::history_get,
            commands::storage::history_add,
            commands::storage::history_clear,
            commands::storage::queue_get,
            commands::storage::queue_save,
            // System & Shell
            commands::system::system_log,
            commands::system::get_bin_paths,
            commands::system::app_version,
            commands::system::shell_open_path,
            commands::system::shell_show_item_in_folder,
            commands::system::shell_open_external,
            commands::system::system_shutdown,
            commands::system::system_cancel_shutdown,
            commands::system::system_get_gpu,
            // File Manager
            commands::file_manager::file_select,
            commands::file_manager::file_select_multiple,
            commands::file_manager::file_select_folder,
            commands::file_manager::file_delete_cookies,
            commands::file_manager::file_get_unique_path,
            // Media Info
            commands::media_info::media_get_info,
            // Download
            commands::download::download_analyze,
            commands::download::download_start,
            commands::download::download_cancel,
            commands::download::download_change_rate,
            // Convert
            commands::convert::convert_get_queue_info,
            commands::convert::convert_start,
            commands::convert::convert_cancel,
            // Clipboard
            commands::clipboard::clipboard_start_watch,
            commands::clipboard::clipboard_stop_watch,
            commands::clipboard::clipboard_read_text,
            // Popup Notification
            commands::popup::popup_show,
            commands::popup::popup_close,
            commands::popup::popup_clicked,
            commands::popup::popup_ready,
            // Updater
            commands::updater::updater_get_versions,
            commands::updater::updater_check_app,
            commands::updater::updater_download_app,
            commands::updater::updater_install_app,
            commands::updater::updater_check_ytdlp,
            commands::updater::updater_update_ytdlp,
            commands::updater::updater_check_ffmpeg,
            commands::updater::updater_update_ffmpeg,
        ])
        .run(tauri::generate_context!())
        .expect("error while running BitKit Tauri application");
}
