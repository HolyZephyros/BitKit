use crate::state::AppState;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Position, Size, State,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

fn get_or_create_popup(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(win) = app.get_webview_window("popup") {
        return Ok(win);
    }

    let win = WebviewWindowBuilder::new(app, "popup", WebviewUrl::App("popup.html".into()))
        .title("BitKit Notification")
        .inner_size(340.0, 84.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .shadow(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;

    let _ = win.set_focusable(false);
    Ok(win)
}

fn position_popup_bottom_right(app: &AppHandle, win: &WebviewWindow) {
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let work = monitor.work_area();
        let scale = monitor.scale_factor();
        let win_w = (340.0 * scale).round() as i32;
        let win_h = (84.0 * scale).round() as i32;
        let margin = (16.0 * scale).round() as i32;
        let pos_x = work.position.x + (work.size.width as i32) - win_w - margin;
        let pos_y = work.position.y + (work.size.height as i32) - win_h - margin;

        let _ = win.set_size(Size::Logical(LogicalSize::new(340.0, 84.0)));
        let _ = win.set_position(Position::Physical(PhysicalPosition::new(pos_x, pos_y)));
    }
}

/// Must be `async fn` on Windows so WebView2 window creation never deadlocks the UI thread.
#[tauri::command]
pub async fn popup_show(
    app: AppHandle,
    state: State<'_, AppState>,
    data: Option<Value>,
) -> Result<bool, String> {
    let payload = data.unwrap_or_else(|| json!({}));
    *state.popup_last_data.lock().unwrap() = Some(payload.clone());

    let Ok(win) = get_or_create_popup(&app) else {
        return Ok(false);
    };

    let gen = state.popup_hide_gen.fetch_add(1, Ordering::SeqCst) + 1;
    position_popup_bottom_right(&app, &win);

    if !win.is_visible().unwrap_or(false) {
        let _ = win.show();
    }

    let _ = app.emit_to("popup", "popup:data", payload);

    let app_timer = app.clone();
    let gen_ref = state.popup_hide_gen.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(2500)).await;
        if gen_ref.load(Ordering::SeqCst) != gen {
            return;
        }
        let _ = app_timer.emit_to("popup", "popup:hide", json!({}));
        tokio::time::sleep(Duration::from_millis(250)).await;
        if gen_ref.load(Ordering::SeqCst) != gen {
            return;
        }
        if let Some(w) = app_timer.get_webview_window("popup") {
            let _ = w.hide();
        }
    });

    Ok(true)
}

#[tauri::command]
pub async fn popup_close(app: AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    state.popup_hide_gen.fetch_add(1, Ordering::SeqCst);
    if let Some(win) = app.get_webview_window("popup") {
        let _ = win.hide();
    }
    Ok(true)
}

#[tauri::command]
pub async fn popup_clicked(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.popup_hide_gen.fetch_add(1, Ordering::SeqCst);
    if let Some(main) = app.get_webview_window("main") {
        if main.is_minimized().unwrap_or(false) {
            let _ = main.unminimize();
        }
        let _ = main.show();
        let _ = main.set_focus();
    }
    if let Some(popup) = app.get_webview_window("popup") {
        let _ = popup.hide();
    }
    Ok(())
}

#[tauri::command]
pub fn popup_ready(state: State<'_, AppState>) -> Option<Value> {
    state.popup_last_data.lock().unwrap().clone()
}
