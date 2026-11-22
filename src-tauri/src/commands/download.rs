use crate::logging::write_log;
use crate::paths::{decode_process_bytes, downloads_dir, get_bin_path, hidden_tokio_command, kill_process_tree};
use crate::state::{ActiveDownload, AppState};
use regex::Regex;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use uuid::Uuid;

fn normalize_url(url: &str) -> String {
    let lower = url.to_lowercase();
    if !url.is_empty() && !lower.starts_with("http://") && !lower.starts_with("https://") {
        format!("https://{}", url)
    } else {
        url.to_string()
    }
}

fn push_js_runtime_args(app: &AppHandle, args: &mut Vec<String>) {
    // Prefer fast JIT engines first (bundled deno -> system deno/bun/node), then lightweight QuickJS fallback
    let deno = get_bin_path(app, "deno.exe");
    if deno.exists() {
        args.push("--js-runtimes".into());
        args.push(format!("deno:{}", deno.to_string_lossy()));
    }
    args.extend([
        "--js-runtimes".into(),
        "deno".into(),
        "--js-runtimes".into(),
        "bun".into(),
        "--js-runtimes".into(),
        "node".into(),
    ]);
    let qjs = get_bin_path(app, "qjs.exe");
    if qjs.exists() {
        args.push("--js-runtimes".into());
        args.push(format!("quickjs:{}", qjs.to_string_lossy()));
    }
    args.extend(["--js-runtimes".into(), "quickjs".into()]);
}

fn parse_analyze_entry(info: &Value, fallback_url: &str) -> Value {
    let mut thumb = info
        .get("thumbnail")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if thumb.is_empty() {
        if let Some(thumbs) = info.get("thumbnails").and_then(|v| v.as_array()) {
            if let Some(last) = thumbs.last() {
                thumb = last
                    .get("url")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
            }
        }
    }

    let formats: Vec<Value> = info
        .get("formats")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|f| {
                    let width = f.get("width").and_then(|v| v.as_u64());
                    let height = f.get("height").and_then(|v| v.as_u64());
                    let resolution = f
                        .get("resolution")
                        .and_then(|v| v.as_str())
                        .map(String::from)
                        .unwrap_or_else(|| {
                            if let (Some(w), Some(h)) = (width, height) {
                                format!("{}x{}", w, h)
                            } else if let Some(h) = height {
                                format!("{}x{}", width.unwrap_or(0), h)
                            } else {
                                "audio".into()
                            }
                        });
                    let vcodec = f.get("vcodec").and_then(|v| v.as_str()).unwrap_or("none");
                    let acodec = f.get("acodec").and_then(|v| v.as_str()).unwrap_or("none");
                    let filesize = f
                        .get("filesize")
                        .and_then(|v| v.as_u64())
                        .or_else(|| f.get("filesize_approx").and_then(|v| v.as_u64()))
                        .unwrap_or(0);
                    json!({
                        "formatId": f.get("format_id"),
                        "ext": f.get("ext"),
                        "resolution": resolution,
                        "width": f.get("width"),
                        "height": f.get("height"),
                        "fps": f.get("fps"),
                        "vcodec": vcodec,
                        "acodec": acodec,
                        "filesize": filesize,
                        "tbr": f.get("tbr").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        "abr": f.get("abr").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        "vbr": f.get("vbr").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        "formatNote": f.get("format_note").and_then(|v| v.as_str()).unwrap_or(""),
                        "hasVideo": vcodec != "none",
                        "hasAudio": acodec != "none"
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    json!({
        "title": info.get("title").and_then(|v| v.as_str()).unwrap_or("Unknown"),
        "duration": info.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0),
        "thumbnail": thumb,
        "uploader": info.get("uploader")
            .or_else(|| info.get("channel"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown"),
        "platform": info.get("extractor")
            .or_else(|| info.get("extractor_key"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown"),
        "url": info.get("webpage_url").and_then(|v| v.as_str()).unwrap_or(fallback_url),
        "formats": formats
    })
}

#[tauri::command]
pub async fn download_analyze(
    app: AppHandle,
    url: String,
    cookies_path: Option<String>,
) -> Value {
    let url = normalize_url(&url);
    let ytdlp = get_bin_path(&app, "yt-dlp.exe");
    let mut args = vec![
        "--ignore-config".to_string(),
        "--dump-json".to_string(),
        "--no-download".to_string(),
    ];
    push_js_runtime_args(&app, &mut args);

    let is_playlist_url =
        url.contains("?list=") || url.contains("&list=") || url.contains("/playlist");
    if is_playlist_url {
        args.push("--flat-playlist".into());
        args.push("--yes-playlist".into());
    }

    if let Some(cp) = cookies_path.filter(|s| !s.is_empty()) {
        args.push("--cookies".into());
        args.push(cp);
    }

    args.push("--".into());
    args.push(url.clone());

    let mut cmd = hidden_tokio_command(&ytdlp);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(parent) = ytdlp.parent() {
        if !parent.as_os_str().is_empty() {
            cmd.current_dir(parent);
        }
    }

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(err) => {
            return json!({
                "success": false,
                "error": err.to_string(),
                "errorKey": "backend.ytdlpExecError",
                "errorParams": { "err": err.to_string() }
            });
        }
    };

    let pid = child.id();
    let output = match tokio::time::timeout(Duration::from_secs(60), child.wait_with_output()).await
    {
        Ok(Ok(out)) => out,
        Ok(Err(err)) => {
            return json!({
                "success": false,
                "error": err.to_string(),
                "errorKey": "backend.ytdlpExecError",
                "errorParams": { "err": err.to_string() }
            });
        }
        Err(_) => {
            if let Some(p) = pid {
                kill_process_tree(p);
            }
            return json!({
                "success": false,
                "errorKey": "backend.timeout60"
            });
        }
    };

    if !output.status.success() {
        let code = output.status.code().unwrap_or(-1);
        let stderr = decode_process_bytes(&output.stderr);
        let mut clean_error = stderr.clone();
        if let Some(idx) = stderr.find("ERROR:") {
            let after = &stderr[idx + 6..];
            let first = after.lines().next().unwrap_or("").trim();
            if !first.is_empty() {
                clean_error = first.to_string();
            }
        }
        return json!({
            "success": false,
            "error": if clean_error.is_empty() { format!("yt-dlp exited with code {}", code) } else { clean_error },
            "errorKey": "backend.ytdlpError",
            "errorParams": { "code": code, "err": stderr }
        });
    }

    let stdout = decode_process_bytes(&output.stdout);
    let mut entries: Vec<Value> = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('{') {
            match serde_json::from_str::<Value>(trimmed) {
                Ok(v) => entries.push(v),
                Err(err) => {
                    return json!({
                        "success": false,
                        "error": err.to_string(),
                        "errorKey": "backend.jsonParseError",
                        "errorParams": { "err": err.to_string() }
                    });
                }
            }
        }
    }

    if entries.is_empty() {
        return json!({
            "success": false,
            "errorKey": "backend.formatInfoFailed"
        });
    }

    if entries.len() == 1 {
        return json!({
            "success": true,
            "data": parse_analyze_entry(&entries[0], &url)
        });
    }

    let first = &entries[0];
    let playlist_entries: Vec<Value> = entries
        .iter()
        .map(|e| {
            let thumb = e
                .get("thumbnail")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(String::from)
                .unwrap_or_else(|| {
                    e.get("thumbnails")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.last())
                        .and_then(|t| t.get("url"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string()
                });
            json!({
                "title": e.get("title"),
                "url": e.get("webpage_url").or_else(|| e.get("url")),
                "duration": e.get("duration"),
                "thumbnail": thumb
            })
        })
        .collect();

    json!({
        "success": true,
        "isPlaylist": true,
        "data": parse_analyze_entry(first, &url),
        "playlist": {
            "title": first.get("playlist_title")
                .or_else(|| first.get("playlist"))
                .and_then(|v| v.as_str())
                .unwrap_or("Playlist"),
            "count": entries.len(),
            "entries": playlist_entries
        }
    })
}

fn sanitize_title_for_check(title: &str) -> String {
    let mut s = String::new();
    for ch in title.chars() {
        match ch {
            ':' => s.push('：'),
            '"' => s.push('\''),
            '<' | '>' | '|' | '?' | '*' | '\\' | '/' => s.push('_'),
            other => s.push(other),
        }
    }
    let trimmed = s.trim_end_matches(|c: char| c.is_whitespace() || c == '.');
    trimmed.chars().take(200).collect()
}

fn add_known_file(known_files: &Arc<Mutex<Vec<String>>>, path: String) -> usize {
    let mut kf = known_files.lock().unwrap();
    if !kf.contains(&path) {
        kf.push(path);
    }
    kf.len()
}

fn cleanup_download_files(known_files: &[String]) {
    for file in known_files {
        let _ = fs::remove_file(file);
        let _ = fs::remove_file(format!("{}.part", file));
        let _ = fs::remove_file(format!("{}.ytdl", file));

        let p = Path::new(file);
        if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
            let dot_ext = format!(".{}", ext);
            if let Some(base) = file.strip_suffix(&dot_ext) {
                let _ = fs::remove_file(format!("{}.temp{}", base, dot_ext));
            }
        }

        if let (Some(dir), Some(base_name)) = (p.parent(), p.file_name().and_then(|n| n.to_str())) {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    if let Some(name) = entry.file_name().to_str() {
                        if name.starts_with(base_name)
                            && (name.ends_with(".part") || name.ends_with(".ytdl"))
                        {
                            let _ = fs::remove_file(entry.path());
                        }
                    }
                }
            }
        }
    }
}

fn parse_time_to_sec(t: &str) -> f64 {
    if t.is_empty() {
        return 0.0;
    }
    let parts: Vec<f64> = t.split(':').filter_map(|p| p.parse::<f64>().ok()).collect();
    match parts.len() {
        3 => parts[0] * 3600.0 + parts[1] * 60.0 + parts[2],
        2 => parts[0] * 60.0 + parts[1],
        1 => parts[0],
        _ => 0.0,
    }
}

fn opt_str<'a>(opts: &'a Value, key: &str) -> Option<&'a str> {
    opts.get(key).and_then(|v| v.as_str()).filter(|s| !s.is_empty())
}

fn opt_bool(opts: &Value, key: &str) -> bool {
    opts.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

#[tauri::command]
pub async fn download_start(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    options: Option<Value>,
) -> Result<Value, String> {
    if state.ytdlp_updating.load(Ordering::Relaxed) {
        return Ok(json!({
            "id": null,
            "success": false,
            "error": "yt-dlp is currently updating. Please wait."
        }));
    }

    let opts = options.unwrap_or_else(|| json!({}));
    let url = normalize_url(&url);
    let ytdlp = get_bin_path(&app, "yt-dlp.exe");
    let id = Uuid::new_v4().to_string();

    let mut args = vec![
        "--ignore-config".to_string(),
        "--windows-filenames".to_string(),
    ];
    push_js_runtime_args(&app, &mut args);

    let output_path = opt_str(&opts, "outputPath")
        .map(String::from)
        .unwrap_or_else(|| downloads_dir().to_string_lossy().to_string());

    let mut template = opt_str(&opts, "filenameTemplate")
        .unwrap_or("%(title)s.%(ext)s")
        .to_string();

    let title_str = sanitize_title_for_check(opt_str(&opts, "title").unwrap_or(""));
    if !title_str.is_empty() {
        if let Ok(entries) = fs::read_dir(&output_path) {
            let dir_files: Vec<String> = entries
                .flatten()
                .filter_map(|e| e.file_name().into_string().ok())
                .collect();
            let mut counter = 0u32;
            loop {
                let prefix = if counter == 0 {
                    title_str.clone()
                } else {
                    format!("{} ({})", title_str, counter)
                };
                if dir_files.iter().any(|f| f.starts_with(&prefix)) {
                    counter += 1;
                } else {
                    break;
                }
            }
            if counter > 0 {
                template = template.replacen("%(title)s", &format!("%(title)s ({})", counter), 1);
            }
        }
    }

    args.push("-o".into());
    args.push(Path::new(&output_path).join(&template).to_string_lossy().to_string());

    let fmt = opt_str(&opts, "outputFormat").unwrap_or("");
    let video_audio_codec = opt_str(&opts, "videoAudioCodec");
    let is_no_audio = video_audio_codec == Some("none");

    let cp = match fmt {
        "webm" => "[vcodec^=vp]",
        "mp4" | "mov" | "avi" => "[vcodec^=avc]",
        _ => "",
    };

    if let Some(fid) = opt_str(&opts, "formatId") {
        args.push("-f".into());
        args.push(fid.into());
    } else if let Some(quality) = opt_str(&opts, "quality") {
        let get_video_fmt = |height_filter: Option<&str>| -> String {
            let base = height_filter
                .map(|h| format!("[height<={}]", h))
                .unwrap_or_default();
            let preferred = format!("bestvideo{}{}", cp, base);
            let fallback = format!("bestvideo{}", base);
            if is_no_audio {
                return if !cp.is_empty() {
                    format!("{}/{}", preferred, fallback)
                } else {
                    fallback
                };
            }
            let best_fallback = height_filter
                .map(|h| format!("best[height<={}]", h))
                .unwrap_or_else(|| "best".to_string());
            if !cp.is_empty() {
                format!("{}+bestaudio/{}+bestaudio/{}", preferred, fallback, best_fallback)
            } else {
                format!("{}+bestaudio/{}", fallback, best_fallback)
            }
        };

        if quality == "best" {
            args.push("-f".into());
            args.push(get_video_fmt(None));
            args.push("-S".into());
            args.push("res,fps,br".into());
        } else if quality == "audio" {
            args.push("-f".into());
            args.push("bestaudio/best".into());
        } else {
            let height = quality.trim_end_matches('p');
            args.push("-f".into());
            args.push(get_video_fmt(Some(height)));
        }
    }

    let is_audio = opt_bool(&opts, "isAudio");
    if is_audio {
        args.push("-x".into());
        if !fmt.is_empty() {
            let audio_fmt = if fmt == "ogg" { "vorbis" } else { fmt };
            args.push("--audio-format".into());
            args.push(audio_fmt.into());
        }
        if let Some(aq) = opts.get("audioQuality") {
            let aq_str = match aq {
                Value::String(s) => s.clone(),
                Value::Null => String::new(),
                other => other.to_string(),
            };
            if !aq_str.is_empty() {
                args.push("--audio-quality".into());
                args.push(aq_str);
            }
        }
    } else if !fmt.is_empty() {
        if is_no_audio {
            args.push("--recode-video".into());
            args.push(fmt.into());
        } else if matches!(fmt, "mp4" | "mkv" | "webm") {
            args.push("--merge-output-format".into());
            args.push(fmt.into());
        } else {
            args.push("--merge-output-format".into());
            args.push("mp4".into());
            args.push("--recode-video".into());
            args.push(fmt.into());
        }
    }

    let mut ffmpeg_extra_args = vec!["-threads".to_string(), "0".to_string()];
    if matches!(fmt, "mp4" | "m4v" | "mov" | "m4a") {
        ffmpeg_extra_args.push("-movflags".into());
        ffmpeg_extra_args.push("+faststart".into());
    }

    if !is_audio && !is_no_audio {
        if let Some(vac) = video_audio_codec {
            let encoder = match vac {
                "aac" | "m4a" => "aac",
                "opus" => "libopus",
                "mp3" => "libmp3lame",
                "flac" => "flac",
                "wav" => "pcm_s16le",
                "ogg" => "libvorbis",
                other => other,
            };
            ffmpeg_extra_args.push("-c:a".into());
            ffmpeg_extra_args.push(encoder.into());
        }
    }

    args.push("--postprocessor-args".into());
    args.push(format!("ffmpeg:{}", ffmpeg_extra_args.join(" ")));

    let ffmpeg_path = get_bin_path(&app, "ffmpeg.exe");
    if let Some(ffmpeg_dir) = ffmpeg_path.parent() {
        if !ffmpeg_dir.as_os_str().is_empty() {
            args.push("--ffmpeg-location".into());
            args.push(ffmpeg_dir.to_string_lossy().to_string());
        }
    }

    let start_time = opt_str(&opts, "startTime");
    let end_time = opt_str(&opts, "endTime");
    let is_section = start_time.is_some() || end_time.is_some();
    if is_section {
        let section = format!(
            "*{}-{}",
            start_time.unwrap_or("0"),
            end_time.unwrap_or("inf")
        );
        args.push("--download-sections".into());
        args.push(section);
        args.push("--force-keyframes-at-cuts".into());
    }

    if let Some(max_fs) = opts.get("maxFilesize") {
        let s = match max_fs {
            Value::String(v) => v.clone(),
            Value::Number(n) => n.to_string(),
            _ => String::new(),
        };
        if !s.is_empty() && s != "0" {
            args.push("--max-filesize".into());
            args.push(format!("{}M", s));
        }
    }

    if opt_bool(&opts, "embedThumbnail") {
        args.push("--embed-thumbnail".into());
    }
    if opt_bool(&opts, "embedMetadata") {
        args.push("--embed-metadata".into());
    }
    if let Some(cp) = opt_str(&opts, "cookiesPath") {
        args.push("--cookies".into());
        args.push(cp.into());
    }

    if let Some(rl) = opts.get("rateLimit") {
        let rate = rl
            .as_u64()
            .or_else(|| rl.as_str().and_then(|s| s.parse::<u64>().ok()))
            .unwrap_or(0);
        state.proxy.set_global_rate(rate).await;
    }

    let proxy_port = state.proxy.get_port();
    if proxy_port > 0 {
        args.push("--proxy".into());
        args.push(format!("http://127.0.0.1:{}", proxy_port));
    }

    args.push("--newline".into());
    args.push("--progress-template".into());
    args.push("%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._total_bytes_str)s".into());

    if !opt_bool(&opts, "playlist") {
        args.push("--no-playlist".into());
    }

    args.push("--".into());
    args.push(url.clone());

    let mut cmd = hidden_tokio_command(&ytdlp);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(parent) = ytdlp.parent() {
        if !parent.as_os_str().is_empty() {
            cmd.current_dir(parent);
        }
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(err) => {
            let _ = app.emit("download:error", json!({ "id": id, "error": err.to_string() }));
            return Ok(json!({ "id": id, "success": true }));
        }
    };

    let pid = child.id();
    let known_files = Arc::new(Mutex::new(Vec::<String>::new()));

    {
        let mut active = state.active_downloads.lock().unwrap();
        active.insert(
            id.clone(),
            ActiveDownload {
                pid,
                known_files: Arc::clone(&known_files),
            },
        );
    }

    let _ = app.emit(
        "download:progress",
        json!({
            "id": id,
            "percent": 0,
            "speed": "",
            "eta": "",
            "status": "connecting",
            "isSection": is_section
        }),
    );

    let has_received_progress = Arc::new(AtomicBool::new(false));
    if is_section {
        let app_cut = app.clone();
        let id_cut = id.clone();
        let recv_flag = Arc::clone(&has_received_progress);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(3)).await;
            let is_still_active = {
                let st = app_cut.state::<AppState>();
                let active = st.active_downloads.lock().unwrap();
                active.contains_key(&id_cut)
            };
            if !recv_flag.load(Ordering::Relaxed) && is_still_active {
                let _ = app_cut.emit(
                    "download:progress",
                    json!({
                        "id": id_cut,
                        "percent": 0,
                        "speed": "",
                        "eta": "",
                        "status": "cutting"
                    }),
                );
            }
        });
    }

    let start_sec = parse_time_to_sec(start_time.unwrap_or("0"));
    let end_sec = end_time.map(parse_time_to_sec).unwrap_or(0.0);
    let section_duration = if end_sec > start_sec {
        end_sec - start_sec
    } else {
        0.0
    };

    let title_for_complete = opt_str(&opts, "title").unwrap_or(&url).to_string();
    let app_bg = app.clone();
    let id_bg = id.clone();
    let url_bg = url.clone();
    let output_path_bg = output_path.clone();

    tauri::async_runtime::spawn(async move {
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let max_filesize_hit = Arc::new(AtomicBool::new(false));
        let error_buffer = Arc::new(Mutex::new(String::new()));

        let kf_stdout = Arc::clone(&known_files);
        let max_fs_stdout = Arc::clone(&max_filesize_hit);
        let recv_stdout = Arc::clone(&has_received_progress);
        let app_out = app_bg.clone();
        let id_out = id_bg.clone();

        let stdout_task = tokio::spawn(async move {
            let Some(s) = stdout else { return };
            let thumb_re = Regex::new(r"to:\s*(.+)$").unwrap();
            let mut reader = BufReader::new(s);
            let mut raw_line = Vec::with_capacity(512);
            let mut current_fragment: usize = 0;
            let mut fragment_weights: [(f64, f64); 2] = [(0.0, 90.0), (45.0, 90.0)];

            loop {
                raw_line.clear();
                match reader.read_until(b'\n', &mut raw_line).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
                let decoded = decode_process_bytes(&raw_line);
                let line = decoded.trim_end_matches(['\r', '\n']);
                if line.contains("max-filesize") && line.contains("Aborting") {
                    max_fs_stdout.store(true, Ordering::Relaxed);
                }

                if let Some(dest) = line.split("[download] Destination: ").nth(1) {
                    let count = add_known_file(&kf_stdout, dest.trim().to_string());
                    if current_fragment == 0 && count > 1 {
                        current_fragment = 1;
                        fragment_weights[0] = (0.0, 45.0);
                    }
                } else if let Some(merged) = line.split("[Merger] Merging formats into \"").nth(1) {
                    if let Some(file_part) = merged.split('"').next() {
                        add_known_file(&kf_stdout, file_part.to_string());
                    }
                } else if let Some(dest) = line.split("[ExtractAudio] Destination: ").nth(1) {
                    add_known_file(&kf_stdout, dest.trim().to_string());
                } else if let Some(dest) = line.split("[VideoConvertor] Destination: ").nth(1) {
                    add_known_file(&kf_stdout, dest.trim().to_string());
                } else if line.contains("[info] Writing video thumbnail") {
                    if let Some(caps) = thumb_re.captures(&line) {
                        add_known_file(&kf_stdout, caps[1].trim().to_string());
                    }
                } else if line.contains('|') {
                    let parts: Vec<&str> = line.split('|').collect();
                    if parts.len() >= 4 {
                        let raw_percent: f64 = parts[0]
                            .replace('%', "")
                            .trim()
                            .parse()
                            .unwrap_or(0.0);
                        recv_stdout.store(true, Ordering::Relaxed);

                        let (w_start, w_end) = fragment_weights
                            .get(current_fragment)
                            .copied()
                            .unwrap_or((0.0, 90.0));
                        let weighted = w_start + (raw_percent / 100.0) * (w_end - w_start);
                        let final_percent = (weighted.round() as i64).min(90).max(0);

                        if raw_percent < 100.0 || !line.contains("[Merger]") {
                            let _ = app_out.emit(
                                "download:progress",
                                json!({
                                    "id": id_out,
                                    "percent": final_percent,
                                    "speed": parts[1].trim(),
                                    "eta": parts[2].trim(),
                                    "totalSize": parts[3].trim()
                                }),
                            );
                        }
                    }
                }

                if line.contains("[Merger]")
                    || line.contains("[ExtractAudio]")
                    || line.contains("[VideoConvertor]")
                    || line.contains("[FFmpegVideoConvertor]")
                    || line.contains("[EmbedThumbnail]")
                    || line.contains("[Metadata]")
                    || line.contains("Deleting original file")
                    || line.contains("Fixing file")
                {
                    let _ = app_out.emit(
                        "download:progress",
                        json!({
                            "id": id_out,
                            "percent": 95,
                            "speed": "",
                            "eta": "",
                            "status": "postprocessing"
                        }),
                    );
                }
            }
        });

        let err_buf_stderr = Arc::clone(&error_buffer);
        let app_err = app_bg.clone();
        let id_err = id_bg.clone();

        let stderr_task = tokio::spawn(async move {
            let Some(mut s) = stderr else { return };
            let time_re = Regex::new(r"time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)").unwrap();
            let speed_re = Regex::new(r"speed=\s*([\d.]+x)").unwrap();
            let size_re = Regex::new(r"size=\s*(\d+\w+)").unwrap();

            let mut buf = [0u8; 4096];
            let mut line_buffer = String::new();
            loop {
                match s.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let chunk = decode_process_bytes(&buf[..n]);
                        {
                            let mut eb = err_buf_stderr.lock().unwrap();
                            eb.push_str(&chunk);
                            if eb.len() > 2000 {
                                let keep = eb.len() - 2000;
                                // ensure char boundary
                                let mut idx = keep;
                                while !eb.is_char_boundary(idx) && idx < eb.len() {
                                    idx += 1;
                                }
                                *eb = eb[idx..].to_string();
                            }
                        }

                        line_buffer.push_str(&chunk);
                        let mut parts: Vec<String> = line_buffer
                            .split(['\r', '\n'])
                            .map(String::from)
                            .collect();
                        line_buffer = parts.pop().unwrap_or_default();

                        for line in parts {
                            if let Some(tm) = time_re.captures(&line) {
                                let h: f64 = tm[1].parse().unwrap_or(0.0);
                                let m: f64 = tm[2].parse().unwrap_or(0.0);
                                let sec: f64 = tm[3].parse().unwrap_or(0.0);
                                let current_sec = h * 3600.0 + m * 60.0 + sec;
                                let percent = if section_duration > 0.0 {
                                    ((current_sec / section_duration) * 100.0)
                                        .round()
                                        .clamp(0.0, 99.0) as i64
                                } else {
                                    50
                                };
                                let speed = speed_re
                                    .captures(&line)
                                    .map(|c| c[1].to_string())
                                    .unwrap_or_default();
                                let size = size_re
                                    .captures(&line)
                                    .map(|c| c[1].to_string())
                                    .unwrap_or_default();

                                let _ = app_err.emit(
                                    "download:progress",
                                    json!({
                                        "id": id_err,
                                        "percent": percent,
                                        "speed": speed,
                                        "eta": "",
                                        "totalSize": size,
                                        "status": "postprocessing"
                                    }),
                                );
                            }
                        }
                    }
                }
            }
        });

        let wait_res = child.wait().await;
        let _ = tokio::join!(stdout_task, stderr_task);

        let st = app_bg.state::<AppState>();
        let removed = st.active_downloads.lock().unwrap().remove(&id_bg);
        let was_cancelled = st.cancelled_downloads.lock().unwrap().remove(&id_bg);

        if was_cancelled {
            return;
        }

        let err_buf = error_buffer.lock().unwrap().clone();
        let succeeded = matches!(&wait_res, Ok(s) if s.success());
        let mut last_error_msg = String::new();
        if !err_buf.is_empty() {
            if !succeeded || err_buf.contains("ERROR:") || err_buf.contains("WARNING:") {
                write_log("error", &format!("[yt-dlp stderr for {}]:\n{}", url_bg, err_buf));
            }
            if let Some(idx) = err_buf.find("ERROR:") {
                let first = err_buf[idx + 6..].lines().next().unwrap_or("").trim();
                if !first.is_empty() {
                    last_error_msg = first.to_string();
                }
            }
            if last_error_msg.is_empty() {
                last_error_msg = err_buf
                    .trim()
                    .lines()
                    .last()
                    .unwrap_or("Download error")
                    .to_string();
            }
        }

        match wait_res {
            Ok(status) if status.success() => {
                let kf_snapshot = removed
                    .map(|d| d.known_files.lock().unwrap().clone())
                    .unwrap_or_else(|| known_files.lock().unwrap().clone());

                if max_filesize_hit.load(Ordering::Relaxed) {
                    cleanup_download_files(&kf_snapshot);
                    let _ = app_bg.emit(
                        "download:error",
                        json!({
                            "id": id_bg,
                            "error": "MAX_FILESIZE_EXCEEDED"
                        }),
                    );
                } else {
                    let mut final_path = output_path_bg.clone();
                    for f in kf_snapshot.iter().rev() {
                        if Path::new(f).exists() && !f.ends_with(".part") && !f.ends_with(".ytdl") {
                            final_path = f.clone();
                            break;
                        }
                    }
                    let _ = app_bg.emit(
                        "download:complete",
                        json!({
                            "id": id_bg,
                            "url": url_bg,
                            "title": title_for_complete,
                            "outputPath": final_path
                        }),
                    );
                }
            }
            Ok(status) => {
                let code = status.code().unwrap_or(-1);
                let err_text = if last_error_msg.is_empty() {
                    format!("Process exited with code {}", code)
                } else {
                    last_error_msg
                };
                let _ = app_bg.emit(
                    "download:error",
                    json!({
                        "id": id_bg,
                        "error": err_text
                    }),
                );
            }
            Err(err) => {
                let _ = app_bg.emit(
                    "download:error",
                    json!({
                        "id": id_bg,
                        "error": err.to_string()
                    }),
                );
            }
        }
    });

    Ok(json!({ "id": id, "success": true }))
}

#[tauri::command]
pub fn download_cancel(state: State<'_, AppState>, id: String) -> Value {
    let removed = {
        let mut active = state.active_downloads.lock().unwrap();
        active.remove(&id)
    };

    if let Some(download) = removed {
        state.cancelled_downloads.lock().unwrap().insert(id);
        if let Some(pid) = download.pid {
            kill_process_tree(pid);
        }

        let kf = Arc::clone(&download.known_files);
        let run_cleanup = move || {
            let snapshot = kf.lock().unwrap().clone();
            cleanup_download_files(&snapshot);
        };

        run_cleanup();
        tauri::async_runtime::spawn(async move {
            for delay_secs in [1u64, 2, 3, 4] {
                tokio::time::sleep(Duration::from_secs(delay_secs)).await;
                run_cleanup();
            }
        });

        return json!({ "success": true });
    }

    json!({ "success": false, "errorKey": "backend.downloadNotFound" })
}

#[tauri::command]
pub async fn download_change_rate(
    state: State<'_, AppState>,
    id: Option<String>,
    rate_kb: Value,
) -> Result<Value, String> {
    let _ = id;
    let rate = rate_kb
        .as_u64()
        .or_else(|| rate_kb.as_str().and_then(|s| s.parse::<u64>().ok()))
        .unwrap_or(0);
    state.proxy.set_global_rate(rate).await;
    Ok(json!({ "success": true, "newRate": rate_kb }))
}
