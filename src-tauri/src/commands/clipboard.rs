use crate::state::AppState;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

fn read_clipboard_os() -> String {
    arboard::Clipboard::new()
        .ok()
        .and_then(|mut cb| cb.get_text().ok())
        .unwrap_or_default()
}

pub fn extract_urls(text: &str) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    let url_re = Regex::new(r#"(?i)(https?://[^\s<>"'{}|\\^`]+)"#).unwrap();
    let mut seen = HashSet::new();
    let mut results = Vec::new();

    for m in url_re.find_iter(text) {
        let cleaned = m
            .as_str()
            .trim_end_matches(['.', ',', ';', ':', '!', '?', ')', ']']);
        if (cleaned.starts_with("http://") || cleaned.starts_with("https://"))
            && cleaned.len() > 10
            && seen.insert(cleaned.to_string())
        {
            results.push(cleaned.to_string());
        }
    }
    results
}

#[tauri::command]
pub fn clipboard_start_watch(app: AppHandle, state: State<'_, AppState>) -> Value {
    let gen = state.clipboard_gen.fetch_add(1, Ordering::SeqCst) + 1;
    state.clipboard_watching.store(true, Ordering::SeqCst);

    let watching = state.clipboard_watching.clone();
    let gen_counter = state.clipboard_gen.clone();

    tauri::async_runtime::spawn(async move {
        let mut last_text = read_clipboard_os().trim().to_string();

        while watching.load(Ordering::SeqCst) && gen_counter.load(Ordering::SeqCst) == gen {
            tokio::time::sleep(Duration::from_millis(400)).await;
            if !watching.load(Ordering::SeqCst) || gen_counter.load(Ordering::SeqCst) != gen {
                break;
            }

            let current = read_clipboard_os().trim().to_string();
            if !current.is_empty() && current != last_text {
                last_text = current.clone();
                let urls = extract_urls(&current);
                if !urls.is_empty() {
                    let _ = app.emit("clipboard:urlsDetected", urls);
                }
            }
        }
    });

    json!({ "success": true })
}

#[tauri::command]
pub fn clipboard_stop_watch(state: State<'_, AppState>) -> Value {
    state.clipboard_watching.store(false, Ordering::SeqCst);
    state.clipboard_gen.fetch_add(1, Ordering::SeqCst);
    json!({ "success": true })
}

#[tauri::command]
pub fn clipboard_read_text() -> String {
    read_clipboard_os()
}

#[cfg(test)]
mod tests {
    use super::extract_urls;

    #[test]
    fn extracts_and_deduplicates_clean_urls() {
        let input = "Check https://youtu.be/abc12345, and (https://youtu.be/abc12345). Also http://example.com/v?a=1!";
        let urls = extract_urls(input);
        assert_eq!(
            urls,
            vec![
                "https://youtu.be/abc12345".to_string(),
                "http://example.com/v?a=1".to_string()
            ]
        );
    }
}
