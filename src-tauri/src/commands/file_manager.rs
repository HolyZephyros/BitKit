use crate::paths::user_data_dir;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

fn apply_filters<'a>(
    mut builder: tauri_plugin_dialog::FileDialogBuilder<tauri::Wry>,
    filters: &[(String, Vec<String>)],
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    for (name, exts) in filters {
        let ext_refs: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        builder = builder.add_filter(name, &ext_refs);
    }
    builder
}

fn parse_filters(options: &Value, default_filters: Vec<(String, Vec<String>)>) -> Vec<(String, Vec<String>)> {
    if let Some(arr) = options.get("filters").and_then(|v| v.as_array()) {
        let mut parsed = Vec::new();
        for item in arr {
            let name = item
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Files")
                .to_string();
            let exts: Vec<String> = item
                .get("extensions")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|e| e.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_else(|| vec!["*".to_string()]);
            parsed.push((name, exts));
        }
        if !parsed.is_empty() {
            return parsed;
        }
    }
    default_filters
}

#[tauri::command]
pub async fn file_select(app: AppHandle, options: Option<Value>) -> Value {
    let opts = options.unwrap_or_else(|| json!({}));
    let opt_type = opts.get("type").and_then(|v| v.as_str()).unwrap_or("");

    let filters = if opt_type == "cookies" {
        vec![
            ("Cookies".to_string(), vec!["txt".to_string()]),
            ("All Files".to_string(), vec!["*".to_string()]),
        ]
    } else {
        let defaults = vec![
            (
                "Video".to_string(),
                vec![
                    "mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "ts", "m4v", "m2ts", "vob",
                    "mxf", "3gp", "3g2", "ogv", "asf", "mpg", "mpeg", "gif",
                ]
                .into_iter()
                .map(String::from)
                .collect(),
            ),
            (
                "Audio".to_string(),
                vec![
                    "mp3", "flac", "wav", "aac", "ogg", "opus", "wma", "m4a", "alac", "aiff",
                    "ac3", "eac3", "ape", "mka",
                ]
                .into_iter()
                .map(String::from)
                .collect(),
            ),
            ("All Files".to_string(), vec!["*".to_string()]),
        ];
        parse_filters(&opts, defaults)
    };

    let mut builder = app.dialog().file();
    if let Some(title) = opts.get("title").and_then(|v| v.as_str()) {
        builder = builder.set_title(title);
    }
    builder = apply_filters(builder, &filters);

    let (tx, rx) = tokio::sync::oneshot::channel();
    builder.pick_file(move |file_path| {
        let _ = tx.send(file_path);
    });

    let picked = match rx.await {
        Ok(Some(fp)) => fp.into_path().ok(),
        _ => None,
    };

    let Some(file_path) = picked else {
        return json!({ "canceled": true });
    };

    let path_str = file_path.to_string_lossy().to_string();

    if opt_type == "cookies" {
        if let Ok(content) = fs::read_to_string(&file_path) {
            let has_youtube =
                content.contains(".youtube.com") || content.contains("youtube.com");
            let safe_path = user_data_dir().join("cookies.txt");
            if safe_path.exists() {
                let _ = fs::remove_file(&safe_path);
            }
            if fs::copy(&file_path, &safe_path).is_ok() {
                return json!({
                    "canceled": false,
                    "path": safe_path.to_string_lossy().to_string(),
                    "hasYoutube": has_youtube
                });
            }
            return json!({
                "canceled": false,
                "path": path_str,
                "hasYoutube": has_youtube
            });
        }
        return json!({
            "canceled": false,
            "path": path_str,
            "hasYoutube": false
        });
    }

    json!({
        "canceled": false,
        "path": path_str
    })
}

#[tauri::command]
pub async fn file_select_multiple(app: AppHandle, options: Option<Value>) -> Value {
    let opts = options.unwrap_or_else(|| json!({}));

    let defaults = vec![
        (
            "Media".to_string(),
            vec![
                "mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "ts", "m4v", "m2ts", "vob",
                "mxf", "3gp", "3g2", "ogv", "asf", "mpg", "mpeg", "gif", "mp3", "flac", "wav",
                "aac", "ogg", "opus", "wma", "m4a", "alac", "aiff", "ac3", "eac3", "ape", "mka",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
        ),
        ("All Files".to_string(), vec!["*".to_string()]),
    ];

    let filters = parse_filters(&opts, defaults);
    let mut builder = app.dialog().file();
    if let Some(title) = opts.get("title").and_then(|v| v.as_str()) {
        builder = builder.set_title(title);
    }
    builder = apply_filters(builder, &filters);

    let (tx, rx) = tokio::sync::oneshot::channel();
    builder.pick_files(move |files| {
        let _ = tx.send(files);
    });

    match rx.await {
        Ok(Some(files)) => {
            let paths: Vec<String> = files
                .into_iter()
                .filter_map(|fp| fp.into_path().ok())
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            json!({ "canceled": false, "paths": paths })
        }
        _ => json!({ "canceled": true }),
    }
}

#[tauri::command]
pub async fn file_select_folder(app: AppHandle) -> Value {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });

    match rx.await {
        Ok(Some(fp)) => match fp.into_path() {
            Ok(p) => json!({ "canceled": false, "path": p.to_string_lossy().to_string() }),
            Err(_) => json!({ "canceled": true }),
        },
        _ => json!({ "canceled": true }),
    }
}

#[tauri::command]
pub fn file_delete_cookies() -> bool {
    let safe_path = user_data_dir().join("cookies.txt");
    if safe_path.exists() {
        return fs::remove_file(&safe_path).is_ok();
    }
    true
}

#[tauri::command]
pub fn file_get_unique_path(target_path: String) -> String {
    let target = Path::new(&target_path);
    if !target.exists() {
        return target_path;
    }
    let dir = target.parent().unwrap_or_else(|| Path::new(""));
    let ext = target
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let stem = target
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut counter = 1u32;
    loop {
        let candidate: PathBuf = dir.join(format!("{}_{}{}", stem, counter, ext));
        if !candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
        counter += 1;
    }
}
