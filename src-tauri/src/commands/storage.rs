use crate::paths::{atomic_write_sync, downloads_dir, user_data_dir};
use serde_json::{json, Value};
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

const SUPPORTED_LANGS: [&str; 11] = [
    "tr", "en", "de", "es", "fr", "it", "pl", "pt", "ru", "ja", "zh",
];

fn detect_system_language() -> &'static str {
    if let Some(locale) = sys_locale::get_locale() {
        let code = locale
            .split(['-', '_'])
            .next()
            .unwrap_or("en")
            .to_lowercase();
        for &lang in &SUPPORTED_LANGS {
            if lang == code {
                return lang;
            }
        }
    }
    "en"
}

#[tauri::command]
pub fn settings_get() -> Value {
    let settings_path = user_data_dir().join("settings.json");
    if let Ok(content) = fs::read_to_string(&settings_path) {
        if let Ok(parsed) = serde_json::from_str::<Value>(&content) {
            return parsed;
        }
    }

    json!({
        "downloadPath": downloads_dir().to_string_lossy().to_string(),
        "convertPath": "",
        "language": detect_system_language(),
        "cookiesPath": "",
        "maxConcurrent": 3,
        "defaultVideoFormat": "mp4",
        "defaultAudioFormat": "mp3"
    })
}

#[tauri::command]
pub fn settings_set(settings: Value) -> bool {
    let settings_path = user_data_dir().join("settings.json");
    if let Ok(serialized) = serde_json::to_string_pretty(&settings) {
        atomic_write_sync(&settings_path, &serialized);
        return true;
    }
    false
}

#[tauri::command]
pub fn history_get() -> Value {
    let history_path = user_data_dir().join("history.json");
    if let Ok(content) = fs::read_to_string(&history_path) {
        if let Ok(parsed) = serde_json::from_str::<Value>(&content) {
            return parsed;
        }
    }
    json!([])
}

#[tauri::command]
pub fn history_add(item: Value) -> bool {
    let history_path = user_data_dir().join("history.json");
    let mut history: Vec<Value> = fs::read_to_string(&history_path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default();

    let mut entry = match item {
        Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    entry.insert("timestamp".to_string(), json!(ts));

    history.insert(0, Value::Object(entry));
    if history.len() > 2000 {
        history.truncate(2000);
    }

    if let Ok(serialized) = serde_json::to_string_pretty(&history) {
        atomic_write_sync(&history_path, &serialized);
        return true;
    }
    false
}

#[tauri::command]
pub fn history_clear() -> bool {
    let history_path = user_data_dir().join("history.json");
    atomic_write_sync(&history_path, "[]");
    true
}

#[tauri::command]
pub fn queue_get() -> Value {
    let queue_path = user_data_dir().join("queue.json");
    if let Ok(content) = fs::read_to_string(&queue_path) {
        if let Ok(parsed) = serde_json::from_str::<Value>(&content) {
            return parsed;
        }
    }
    json!([])
}

#[tauri::command]
pub fn queue_save(queue_data: Value) -> bool {
    let queue_path = user_data_dir().join("queue.json");
    if let Ok(serialized) = serde_json::to_string_pretty(&queue_data) {
        atomic_write_sync(&queue_path, &serialized);
        return true;
    }
    false
}
