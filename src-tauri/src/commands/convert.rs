use crate::commands::command_builder::{build_ffmpeg_args, get_source_info};
use crate::paths::{get_bin_path, hidden_tokio_command, kill_process_tree};
use crate::state::{ActiveConversion, AppState, ConversionJob};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use uuid::Uuid;

fn parse_time_to_seconds(time_str: &str) -> f64 {
    let trimmed = time_str.trim();
    if trimmed.is_empty() {
        return 0.0;
    }
    let parts: Vec<&str> = trimmed.split(':').collect();
    if parts.len() == 3 {
        let h: f64 = parts[0].parse().unwrap_or(0.0);
        let m: f64 = parts[1].parse().unwrap_or(0.0);
        let s: f64 = parts[2].parse().unwrap_or(0.0);
        return h * 3600.0 + m * 60.0 + s;
    }
    trimmed.parse().unwrap_or(0.0)
}

fn format_seconds(sec: f64) -> String {
    if !sec.is_finite() || sec <= 0.0 {
        return "00:00".into();
    }
    let total = sec.floor() as u64;
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let s = total % 60;
    if h > 0 {
        format!("{:02}:{:02}:{:02}", h, m, s)
    } else {
        format!("{:02}:{:02}", m, s)
    }
}

#[tauri::command]
pub fn convert_get_queue_info(state: State<'_, AppState>) -> Value {
    let mgr = state.conversions.lock().unwrap();
    json!({
        "maxConcurrent": mgr.max_concurrent,
        "cpuCores": mgr.cpu_cores,
        "activeCount": mgr.active_count,
        "queueLength": mgr.queue.len()
    })
}

#[tauri::command]
pub fn convert_start(
    app: AppHandle,
    state: State<'_, AppState>,
    input: String,
    output: String,
    options: Value,
) -> Value {
    let id = Uuid::new_v4().to_string();
    let queued = {
        let mut mgr = state.conversions.lock().unwrap();
        mgr.queue.push_back(ConversionJob {
            id: id.clone(),
            input_path: input,
            requested_output_path: output,
            options,
        });
        mgr.active_count >= mgr.max_concurrent
    };

    process_queue(app);

    json!({
        "id": id,
        "success": true,
        "queued": queued
    })
}

#[tauri::command]
pub fn convert_cancel(app: AppHandle, state: State<'_, AppState>, id: String) -> Value {
    let mut mgr = state.conversions.lock().unwrap();
    if let Some(conv) = mgr.active.get_mut(&id) {
        conv.is_cancelled = true;
        if let Some(pid) = conv.pid {
            kill_process_tree(pid);
        }
        return json!({ "success": true });
    }

    if let Some(pos) = mgr.queue.iter().position(|j| j.id == id) {
        mgr.queue.remove(pos);
        drop(mgr);
        let _ = app.emit(
            "convert:error",
            json!({ "id": id, "errorKey": "backend.convertCancelled" }),
        );
        return json!({ "success": true });
    }

    json!({ "success": false, "errorKey": "backend.convertNotFound" })
}

fn process_queue(app: AppHandle) {
    let state = app.state::<AppState>();
    let jobs_to_start: Vec<ConversionJob> = {
        let mut mgr = state.conversions.lock().unwrap();
        let mut jobs = Vec::new();
        while mgr.active_count < mgr.max_concurrent {
            if let Some(job) = mgr.queue.pop_front() {
                mgr.active_count += 1;
                mgr.active.insert(
                    job.id.clone(),
                    ActiveConversion {
                        pid: None,
                        is_cancelled: false,
                        input_path: job.input_path.clone(),
                        output_path: String::new(),
                    },
                );
                jobs.push(job);
            } else {
                break;
            }
        }
        jobs
    };

    for job in jobs_to_start {
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            run_conversion_job(app_clone, job).await;
        });
    }
}

fn reserve_unique_path(state: &AppState, target_path: &str) -> String {
    let target = Path::new(target_path);
    let dir = target.parent().unwrap_or_else(|| Path::new(""));
    let ext = target
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let stem = target
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut mgr = state.conversions.lock().unwrap();
    let mut current = target_path.to_string();
    let mut counter = 1u32;

    loop {
        if !mgr.reserved_paths.contains(&current) && !Path::new(&current).exists() {
            mgr.reserved_paths.insert(current.clone());
            return current;
        }
        current = dir
            .join(format!("{}_{}{}", stem, counter, ext))
            .to_string_lossy()
            .to_string();
        counter += 1;
    }
}

async fn detect_autocrop(ffmpeg: &Path, input_path: &str) -> Option<String> {
    let out = hidden_tokio_command(ffmpeg)
        .args([
            "-i",
            input_path,
            "-t",
            "10",
            "-vf",
            "cropdetect=24:16:0",
            "-f",
            "null",
            "NUL",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await
        .ok()?;

    let stderr = String::from_utf8_lossy(&out.stderr);
    let crop_re = Regex::new(r"crop=\d+:\d+:\d+:\d+").ok()?;
    let mut freq: HashMap<String, usize> = HashMap::new();
    for m in crop_re.find_iter(&stderr) {
        *freq.entry(m.as_str().to_string()).or_insert(0) += 1;
    }
    freq.into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(k, _)| k.trim_start_matches("crop=").to_string())
}

async fn run_ffmpeg_pass(
    app: &AppHandle,
    id: &str,
    ffmpeg: &Path,
    pass_args: &[String],
    pass_log_dir: &Path,
    pass_num: u8,
    is_two_pass: bool,
    duration_multiplier: f64,
    input_path: &str,
    output_path: &str,
) -> Result<(), String> {
    let state = app.state::<AppState>();

    // Check cancellation before spawn
    {
        let mgr = state.conversions.lock().unwrap();
        if mgr.active.get(id).map(|c| c.is_cancelled).unwrap_or(true) {
            return Err("CANCELLED".into());
        }
    }

    let mut child = hidden_tokio_command(ffmpeg)
        .args(pass_args)
        .current_dir(pass_log_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let pid = child.id();
    let cancelled_during_spawn = {
        let mut mgr = state.conversions.lock().unwrap();
        if let Some(conv) = mgr.active.get_mut(id) {
            if conv.is_cancelled {
                true
            } else {
                conv.pid = pid;
                conv.input_path = input_path.to_string();
                conv.output_path = output_path.to_string();
                false
            }
        } else {
            false
        }
    };
    if cancelled_during_spawn {
        if let Some(p) = pid {
            kill_process_tree(p);
        }
        let _ = child.kill().await;
        return Err("CANCELLED".into());
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let shared_duration = Arc::new(Mutex::new(0.0_f64));
    let shared_err = Arc::new(Mutex::new(String::new()));

    // Read stderr for Duration and error log
    let dur_for_stderr = Arc::clone(&shared_duration);
    let err_for_stderr = Arc::clone(&shared_err);
    let stderr_task = tokio::spawn(async move {
        let Some(mut s) = stderr else { return };
        let dur_re = Regex::new(r"(?m)^\s*Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})").unwrap();
        let mut buf = [0u8; 4096];
        loop {
            match s.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]);
                    let mut last_err = err_for_stderr.lock().unwrap();
                    last_err.push_str(&chunk);
                    if last_err.len() > 3000 {
                        let keep_from = last_err.len() - 2000;
                        let sliced = &last_err[keep_from..];
                        if let Some(nl) = sliced.find('\n') {
                            *last_err = sliced[nl + 1..].to_string();
                        } else {
                            *last_err = sliced.to_string();
                        }
                    }

                    let mut dur = dur_for_stderr.lock().unwrap();
                    if *dur <= 0.0 {
                        if let Some(caps) = dur_re.captures(&last_err) {
                            let h: f64 = caps[1].parse().unwrap_or(0.0);
                            let m: f64 = caps[2].parse().unwrap_or(0.0);
                            let sec: f64 = caps[3].parse().unwrap_or(0.0);
                            let cs: f64 = caps[4].parse().unwrap_or(0.0);
                            *dur = (h * 3600.0 + m * 60.0 + sec + cs / 100.0) * duration_multiplier;
                        }
                    }
                }
            }
        }
    });

    // Read stdout (-progress pipe:1)
    let dur_for_stdout = Arc::clone(&shared_duration);
    let app_for_stdout = app.clone();
    let id_for_stdout = id.to_string();
    let stdout_task = tokio::spawn(async move {
        let Some(s) = stdout else { return };
        let mut reader = BufReader::new(s).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if let Some(dur_str) = line.strip_prefix("duration=") {
                let mut dur = dur_for_stdout.lock().unwrap();
                if *dur <= 0.0 {
                    *dur = parse_time_to_seconds(dur_str) * duration_multiplier;
                }
            } else if let Some(us_str) = line.strip_prefix("out_time_us=") {
                let us: f64 = us_str.trim().parse().unwrap_or(0.0);
                let current_sec = us / 1_000_000.0;
                let duration = *dur_for_stdout.lock().unwrap();
                let mut percent = if duration > 0.0 {
                    ((current_sec / duration) * 100.0).min(100.0)
                } else {
                    0.0
                };
                if is_two_pass {
                    percent = if pass_num == 1 {
                        percent / 2.0
                    } else {
                        50.0 + percent / 2.0
                    };
                }
                let rounded = (percent * 10.0).round() / 10.0;
                let _ = app_for_stdout.emit(
                    "convert:progress",
                    json!({
                        "id": id_for_stdout,
                        "percent": rounded,
                        "currentTime": format_seconds(current_sec),
                        "totalTime": format_seconds(duration)
                    }),
                );
            } else if let Some(speed_str) = line.strip_prefix("speed=") {
                let speed = speed_str.trim();
                let _ = app_for_stdout.emit(
                    "convert:progress",
                    json!({
                        "id": id_for_stdout,
                        "speed": speed
                    }),
                );
            }
        }
    });

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let _ = tokio::join!(stdout_task, stderr_task);

    let was_cancelled = {
        let mgr = state.conversions.lock().unwrap();
        mgr.active.get(id).map(|c| c.is_cancelled).unwrap_or(false)
    };
    if was_cancelled {
        return Err("CANCELLED".into());
    }

    if status.success() {
        Ok(())
    } else {
        let last_err = shared_err.lock().unwrap().clone();
        if last_err.is_empty() {
            Err(format!(
                "FFmpeg exited with code {}",
                status.code().unwrap_or(-1)
            ))
        } else {
            Err(last_err)
        }
    }
}

async fn run_conversion_job(app: AppHandle, mut job: ConversionJob) {
    let state = app.state::<AppState>();
    let normalized_input = fs::canonicalize(&job.input_path)
        .unwrap_or_else(|_| PathBuf::from(&job.input_path))
        .to_string_lossy()
        .to_string();

    {
        let mut mgr = state.conversions.lock().unwrap();
        mgr.reserved_paths.insert(normalized_input.clone());
    }

    let mut final_requested_output = job.requested_output_path.clone();

    // audio_only + original extension rewrite
    if job.options.get("templateId").and_then(|v| v.as_str()) == Some("audio_only")
        && job
            .options
            .pointer("/templateParams/value")
            .and_then(|v| v.as_str())
            == Some("original")
    {
        if let Some(info) = get_source_info(&app, &job.input_path).await {
            if let Some(acodec) = info.audio_codec {
                let real_ext = match acodec.as_str() {
                    "aac" => "m4a",
                    "mp3" => "mp3",
                    "opus" => "opus",
                    "vorbis" => "ogg",
                    "flac" => "flac",
                    "pcm_s16le" => "wav",
                    other => other,
                };
                if final_requested_output.to_lowercase().ends_with(".mka") {
                    let stem_len = final_requested_output.len() - 4;
                    final_requested_output = format!(
                        "{}.{}",
                        &final_requested_output[..stem_len],
                        real_ext
                    );
                }
            }
        }
    }

    let output_path = reserve_unique_path(&state, &final_requested_output);
    let ffmpeg = get_bin_path(&app, "ffmpeg.exe");

    // Autocrop detection if needed
    let tid = job.options.get("templateId").and_then(|v| v.as_str()).unwrap_or("");
    let needs_autocrop = tid == "autocrop"
        || (tid == "multi_filter"
            && job
                .options
                .pointer("/templateParams/filters")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .any(|f| f.get("id").and_then(|v| v.as_str()) == Some("autocrop"))
                })
                .unwrap_or(false));

    if needs_autocrop {
        if let Some(crop) = detect_autocrop(&ffmpeg, &job.input_path).await {
            if let Some(obj) = job.options.as_object_mut() {
                obj.insert("_detectedCrop".into(), json!(crop));
            }
        }
    }

    let mut built = build_ffmpeg_args(&app, &job.input_path, &output_path, &job.options).await;
    let insert_idx = built.args.len().saturating_sub(1);
    built.args.splice(
        insert_idx..insert_idx,
        [
            "-progress".to_string(),
            "pipe:1".to_string(),
            "-stats_period".to_string(),
            "0.5".to_string(),
        ],
    );

    let pass_log_dir = std::env::temp_dir();
    let short_id: String = job.id.replace('-', "").chars().take(8).collect();
    let pass_log_prefix = format!("bitkit_2pass_{}", short_id);
    let hw_accel = job
        .options
        .get("hwAccel")
        .and_then(|v| v.as_str())
        .unwrap_or("none");
    let is_two_pass =
        job.options.get("twoPass").and_then(|v| v.as_bool()).unwrap_or(false) && hw_accel == "none";

    let clean_pass_logs = || {
        let _ = fs::remove_file(pass_log_dir.join(format!("{}-0.log", pass_log_prefix)));
        let _ = fs::remove_file(pass_log_dir.join(format!("{}-0.log.mbtree", pass_log_prefix)));
    };

    let result = if is_two_pass {
        let mut pass1_args = built.args.clone();
        pass1_args.pop();
        let strip_flags = ["-c:a", "-b:a", "-ar", "-ac", "-af", "-filter:a"];
        let mut clean_args = Vec::new();
        let mut i = 0;
        while i < pass1_args.len() {
            if strip_flags.contains(&pass1_args[i].as_str()) {
                i += 2;
            } else {
                clean_args.push(pass1_args[i].clone());
                i += 1;
            }
        }
        clean_args.extend([
            "-pass".into(),
            "1".into(),
            "-passlogfile".into(),
            pass_log_prefix.clone(),
            "-an".into(),
            "-f".into(),
            "null".into(),
            "NUL".into(),
        ]);

        match run_ffmpeg_pass(
            &app,
            &job.id,
            &ffmpeg,
            &clean_args,
            &pass_log_dir,
            1,
            true,
            built.duration_multiplier,
            &job.input_path,
            &output_path,
        )
        .await
        {
            Ok(()) => {
                let mut pass2_args = built.args.clone();
                let pos = pass2_args.len().saturating_sub(1);
                pass2_args.splice(
                    pos..pos,
                    [
                        "-pass".to_string(),
                        "2".to_string(),
                        "-passlogfile".to_string(),
                        pass_log_prefix.clone(),
                    ],
                );
                let res2 = run_ffmpeg_pass(
                    &app,
                    &job.id,
                    &ffmpeg,
                    &pass2_args,
                    &pass_log_dir,
                    2,
                    true,
                    built.duration_multiplier,
                    &job.input_path,
                    &output_path,
                )
                .await;
                clean_pass_logs();
                res2
            }
            Err(e) => {
                clean_pass_logs();
                Err(e)
            }
        }
    } else {
        run_ffmpeg_pass(
            &app,
            &job.id,
            &ffmpeg,
            &built.args,
            &pass_log_dir,
            0,
            false,
            built.duration_multiplier,
            &job.input_path,
            &output_path,
        )
        .await
    };

    let still_active = {
        let mut mgr = state.conversions.lock().unwrap();
        mgr.reserved_paths.remove(&output_path);
        mgr.reserved_paths.remove(&normalized_input);
        let existed = mgr.active.remove(&job.id).is_some();
        if existed {
            mgr.active_count = mgr.active_count.saturating_sub(1);
        }
        existed
    };

    if !still_active {
        process_queue(app);
        return;
    }

    match result {
        Ok(()) => {
            let _ = app.emit(
                "convert:complete",
                json!({ "id": job.id, "outputPath": output_path }),
            );
        }
        Err(err_msg) => {
            if err_msg == "CANCELLED" {
                if Path::new(&output_path).exists() {
                    let _ = fs::remove_file(&output_path);
                }
                clean_pass_logs();
                process_queue(app);
                return;
            }

            let lower = err_msg.to_lowercase();
            let gpu_keywords = [
                "nvenc", "amf", "qsv", "cuda", "opencl", "device", "driver", "gpu",
            ];
            let is_gpu_err = gpu_keywords.iter().any(|kw| lower.contains(kw));
            let already_fell_back = job
                .options
                .get("_gpuFallbackAttempted")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            if is_gpu_err && hw_accel != "none" && !already_fell_back {
                let _ = app.emit(
                    "convert:progress",
                    json!({
                        "id": job.id,
                        "fallback": true,
                        "gpuCodec": hw_accel,
                        "cpuCodec": "none"
                    }),
                );
                if Path::new(&output_path).exists() {
                    let _ = fs::remove_file(&output_path);
                }
                let mut retry_options = job.options.clone();
                if let Some(obj) = retry_options.as_object_mut() {
                    obj.insert("hwAccel".into(), json!("none"));
                    obj.insert("_gpuFallbackAttempted".into(), json!(true));
                }
                {
                    let mut mgr = state.conversions.lock().unwrap();
                    mgr.queue.push_front(ConversionJob {
                        id: job.id,
                        input_path: job.input_path,
                        requested_output_path: job.requested_output_path,
                        options: retry_options,
                    });
                }
                process_queue(app);
                return;
            }

            let clean_err = if err_msg.contains("Invalid data found when processing input") {
                "Invalid data found when processing input".to_string()
            } else {
                let lines: Vec<&str> = err_msg
                    .lines()
                    .map(|l| l.trim())
                    .filter(|l| !l.is_empty())
                    .collect();
                let start = lines.len().saturating_sub(4);
                lines[start..].join(" | ")
            };

            let _ = app.emit(
                "convert:error",
                json!({
                    "id": job.id,
                    "errorKey": "backend.convertFailed",
                    "message": clean_err
                }),
            );
        }
    }

    process_queue(app);
}
