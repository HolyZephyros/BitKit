use crate::codec_caps::{audio_codec_constraints, hardware_emitter, video_codec_constraints};
use crate::paths::{get_bin_path, hidden_tokio_command};
use serde_json::Value;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tauri::AppHandle;

#[derive(Debug, Clone, Default)]
pub struct SourceInfo {
    pub duration: f64,
    pub audio_codec: Option<String>,
    pub height: Option<u32>,
    pub audio_bitrate: Option<u64>,
}

pub struct BuiltFfmpegCommand {
    pub args: Vec<String>,
    pub duration_multiplier: f64,
}

pub async fn get_source_info(app: &AppHandle, input_path: &str) -> Option<SourceInfo> {
    let ffprobe = get_bin_path(app, "ffprobe.exe");
    let out = tokio::time::timeout(
        Duration::from_secs(15),
        hidden_tokio_command(&ffprobe)
            .args([
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                input_path,
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    if !out.status.success() {
        return None;
    }

    let parsed: Value = serde_json::from_slice(&out.stdout).ok()?;
    let streams = parsed.get("streams")?.as_array()?;
    let video_stream = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("video"));
    let audio_stream = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("audio"));

    let duration = parsed
        .pointer("/format/duration")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .or_else(|| parsed.pointer("/format/duration").and_then(|v| v.as_f64()))
        .unwrap_or(0.0);

    let audio_bitrate = audio_stream.and_then(|a| {
        a.get("bit_rate")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .or_else(|| a.get("bit_rate").and_then(|v| v.as_u64()))
    });

    Some(SourceInfo {
        duration,
        audio_codec: audio_stream
            .and_then(|a| a.get("codec_name"))
            .and_then(|v| v.as_str())
            .map(String::from),
        height: video_stream
            .and_then(|v| v.get("height"))
            .and_then(|v| v.as_u64())
            .map(|x| x as u32),
        audio_bitrate,
    })
}

fn get_dynamic_crf(source_info: &SourceInfo, base_crf: i32) -> String {
    let mut crf = base_crf;
    if let Some(height) = source_info.height {
        if height > 0 {
            let calc = (base_crf as f64 + 4.0 * ((height as f64) / 1080.0).log2()).round() as i32;
            crf = calc.clamp(10, 45);
        }
    }
    crf.to_string()
}

fn val_as_str<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str()).filter(|s| !s.is_empty())
}

fn js_parse_f64(s: &str) -> Option<f64> {
    let trimmed = s.trim();
    let mut end = 0;
    let mut has_dot = false;
    for (i, ch) in trimmed.char_indices() {
        if i == 0 && (ch == '-' || ch == '+') {
            end = i + ch.len_utf8();
        } else if ch.is_ascii_digit() {
            end = i + ch.len_utf8();
        } else if ch == '.' && !has_dot {
            has_dot = true;
            end = i + ch.len_utf8();
        } else {
            break;
        }
    }
    if end == 0 {
        return None;
    }
    trimmed[..end].parse::<f64>().ok()
}

fn js_parse_i64(s: &str) -> Option<i64> {
    js_parse_f64(s).map(|f| f.trunc() as i64)
}

fn val_as_f64(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|x| {
        x.as_f64()
            .or_else(|| x.as_i64().map(|i| i as f64))
            .or_else(|| x.as_str().and_then(js_parse_f64))
    })
}

fn val_as_i64(v: &Value, key: &str) -> Option<i64> {
    v.get(key).and_then(|x| {
        x.as_i64()
            .or_else(|| x.as_f64().map(|f| f as i64))
            .or_else(|| x.as_str().and_then(js_parse_i64))
    })
}

fn val_as_bool(v: &Value, key: &str) -> bool {
    v.get(key).and_then(|x| x.as_bool()).unwrap_or(false)
}

fn format_trim_float(val: f64, decimals: usize) -> String {
    let formatted = format!("{:.*}", decimals, val);
    // Match JS parseFloat((...).toFixed(n)) formatting (e.g. 5.0 -> "5", 1.5 -> "1.5")
    if let Ok(parsed) = formatted.parse::<f64>() {
        if (parsed.fract()).abs() < f64::EPSILON {
            return format!("{}", parsed as i64);
        }
        return parsed.to_string();
    }
    formatted
}

fn build_atempo(mut tempo: f64) -> Vec<String> {
    let mut parts = Vec::new();
    if tempo < 0.5 {
        while tempo < 0.5 {
            parts.push("atempo=0.5".to_string());
            tempo /= 0.5;
        }
        parts.push(format!("atempo={:.4}", tempo));
    } else if tempo > 2.0 {
        while tempo > 2.0 {
            parts.push("atempo=2.0".to_string());
            tempo /= 2.0;
        }
        parts.push(format!("atempo={:.4}", tempo));
    } else {
        parts.push(format!("atempo={:.4}", tempo));
    }
    parts
}

fn split_output_pattern(output_path: &str) -> String {
    let p = Path::new(output_path);
    if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
        let dot_ext = format!(".{}", ext);
        if let Some(base) = output_path.strip_suffix(&dot_ext) {
            return format!("{}_%03d{}", base, dot_ext);
        }
    }
    format!("{}_%03d", output_path)
}

pub async fn build_ffmpeg_args(
    app: &AppHandle,
    input_path: &str,
    output_path_in: &str,
    state: &Value,
) -> BuiltFfmpegCommand {
    let mut args: Vec<String> = Vec::new();
    let mut output_path = output_path_in.to_string();
    let mut duration_multiplier = 1.0_f64;

    let source_info = get_source_info(app, input_path).await.unwrap_or_default();
    let target_ext = Path::new(&output_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_lowercase()))
        .unwrap_or_default();

    let hw_accel = val_as_str(state, "hwAccel").unwrap_or("none");
    if hw_accel != "none" {
        args.push("-hwaccel".into());
        args.push("auto".into());
    }

    // Check trim params (standalone or inside multi_filter)
    let mut trim_params: Option<&Value> = None;
    let template_id = val_as_str(state, "templateId");
    if template_id == Some("trim") {
        trim_params = state.get("templateParams");
    } else if template_id == Some("multi_filter") {
        if let Some(filters) = state.pointer("/templateParams/filters").and_then(|v| v.as_array()) {
            if let Some(tf) = filters
                .iter()
                .find(|f| val_as_str(f, "id") == Some("trim"))
            {
                trim_params = tf.get("params");
            }
        }
    }

    if let Some(tp) = trim_params {
        if let Some(start) = val_as_str(tp, "trim-start") {
            args.push("-ss".into());
            args.push(start.into());
        }
        if let Some(end) = val_as_str(tp, "trim-end") {
            args.push("-to".into());
            args.push(end.into());
        }
    }

    args.push("-i".into());
    args.push(input_path.into());
    args.push("-y".into());
    args.push("-threads".into());
    args.push("0".into());

    // Quick Template Mode
    if let Some(tid) = template_id {
        let empty_obj = serde_json::json!({});
        let p = state.get("templateParams").unwrap_or(&empty_obj);

        match tid {
            "smart_convert" => {
                let vcodec = val_as_str(p, "sc-vcodec").unwrap_or("libx264");
                let acodec = val_as_str(p, "sc-acodec").unwrap_or("aac");
                let dyn_crf = get_dynamic_crf(&source_info, 14);

                args.push("-c:v".into());
                args.push(vcodec.into());
                if vcodec != "copy" {
                    if vcodec == "libvpx-vp9" {
                        args.extend([
                            "-crf".into(), dyn_crf, "-b:v".into(), "0".into(),
                            "-deadline".into(), "good".into(), "-cpu-used".into(), "2".into(),
                            "-row-mt".into(), "1".into(),
                        ]);
                    } else if vcodec == "libaom-av1" {
                        args.extend([
                            "-crf".into(), dyn_crf, "-b:v".into(), "0".into(),
                            "-cpu-used".into(), "4".into(), "-row-mt".into(), "1".into(),
                        ]);
                    } else if vcodec == "libx264" || vcodec == "libx265" {
                        args.extend(["-crf".into(), dyn_crf, "-preset".into(), "slower".into()]);
                    } else if vcodec == "mpeg4" {
                        args.extend(["-vtag".into(), "xvid".into(), "-q:v".into(), "2".into()]);
                    } else {
                        args.extend(["-q:v".into(), "2".into()]);
                    }
                }

                args.push("-c:a".into());
                args.push(acodec.into());
                if acodec != "copy" {
                    match acodec {
                        "aac" | "libmp3lame" | "libopus" => {
                            args.extend(["-b:a".into(), "320k".into()]);
                        }
                        "ac3" | "eac3" => {
                            args.extend(["-b:a".into(), "640k".into()]);
                        }
                        "wmav2" => {
                            args.extend(["-b:a".into(), "192k".into()]);
                        }
                        _ => {}
                    }
                }
            }
            "tiktok" => {
                args.extend([
                    "-c:v".into(), "libx264".into(),
                    "-crf".into(), get_dynamic_crf(&source_info, 16),
                    "-preset".into(), "slow".into(),
                    "-vf".into(),
                    "format=yuv444p,split[original][copy];[copy]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:20[bg];[original]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p".into(),
                    "-c:a".into(), "aac".into(), "-b:a".into(), "320k".into(),
                ]);
            }
            "discord_nitro" => {
                let mut nitro_kbps: i64 = 8000;
                if source_info.duration > 0.0 {
                    let target_total = (490.0 * 8192.0) / source_info.duration;
                    nitro_kbps = ((target_total - 192.0).floor() as i64).clamp(500, 15000);
                }
                args.extend([
                    "-c:v".into(), "libx264".into(), "-preset".into(), "faster".into(),
                    "-b:v".into(), format!("{}k", nitro_kbps),
                    "-maxrate".into(), format!("{}k", nitro_kbps),
                    "-bufsize".into(), format!("{}k", nitro_kbps * 2),
                    "-c:a".into(), "aac".into(), "-b:a".into(), "320k".into(),
                ]);
            }
            "discord_basic" => {
                let mut basic_kbps: i64 = 1500;
                if source_info.duration > 0.0 {
                    let target_total = (9.5 * 8192.0) / source_info.duration;
                    basic_kbps = ((target_total - 128.0).floor() as i64).clamp(100, 5000);
                }
                args.extend([
                    "-c:v".into(), "libx264".into(), "-preset".into(), "faster".into(),
                    "-b:v".into(), format!("{}k", basic_kbps),
                    "-maxrate".into(), format!("{}k", basic_kbps),
                    "-bufsize".into(), format!("{}k", basic_kbps * 2),
                    "-c:a".into(), "aac".into(), "-b:a".into(), "128k".into(),
                ]);
            }
            "whatsapp" => {
                let mut wa_kbps: i64 = 8000;
                if source_info.duration > 0.0 {
                    let target_total = (95.0 * 8192.0) / source_info.duration;
                    wa_kbps = ((target_total - 128.0).floor() as i64).clamp(100, 30000);
                }
                args.extend([
                    "-c:v".into(), "libx264".into(), "-preset".into(), "slow".into(),
                    "-b:v".into(), format!("{}k", wa_kbps),
                    "-maxrate".into(), format!("{}k", wa_kbps),
                    "-bufsize".into(), format!("{}k", wa_kbps * 2),
                    "-c:a".into(), "aac".into(), "-b:a".into(), "128k".into(),
                ]);
            }
            "timelapse" => {
                let speed = val_as_f64(p, "value").unwrap_or(4.0).max(0.01);
                let setpts = format!("{:.4}", 1.0 / speed);
                duration_multiplier = 1.0 / speed;
                args.extend([
                    "-c:v".into(), "libx264".into(), "-preset".into(), "slow".into(), "-crf".into(), "16".into(),
                    "-vf".into(), format!("setpts={}*PTS", setpts),
                    "-an".into(),
                ]);
            }
            "slowmo" => {
                let slow = val_as_f64(p, "value").unwrap_or(2.0).max(0.01);
                duration_multiplier = slow;
                args.extend([
                    "-c:v".into(), "libx264".into(), "-preset".into(), "slow".into(), "-crf".into(), "16".into(),
                    "-vf".into(), format!("setpts={:.4}*PTS", slow),
                    "-an".into(),
                ]);
            }
            "rotate" => {
                let direction = val_as_str(p, "value").unwrap_or("90R");
                if direction == "flipH" {
                    args.extend([
                        "-c:v".into(), "libx264".into(), "-preset".into(), "slow".into(), "-crf".into(), "16".into(),
                        "-c:a".into(), "copy".into(), "-vf".into(), "hflip".into(),
                    ]);
                } else if direction == "flipV" {
                    args.extend([
                        "-c:v".into(), "libx264".into(), "-preset".into(), "slow".into(), "-crf".into(), "16".into(),
                        "-c:a".into(), "copy".into(), "-vf".into(), "vflip".into(),
                    ]);
                } else {
                    args.extend(["-c:v".into(), "copy".into(), "-c:a".into(), "copy".into()]);
                    if direction == "90R" {
                        args.extend(["-metadata:s:v".into(), "rotate=90".into()]);
                    } else if direction == "90L" {
                        args.extend(["-metadata:s:v".into(), "rotate=-90".into()]);
                    } else if direction == "180" {
                        args.extend(["-metadata:s:v".into(), "rotate=180".into()]);
                    }
                }
            }
            "reverse" => {
                args.extend([
                    "-c:v".into(), "libx264".into(), "-preset".into(), "slow".into(), "-crf".into(), "16".into(),
                    "-vf".into(), "reverse".into(),
                    "-c:a".into(), "aac".into(), "-b:a".into(), "320k".into(),
                    "-af".into(), "areverse".into(),
                ]);
            }
            "thumbnail" => {
                let mut sec = val_as_i64(p, "value").unwrap_or(5);
                if source_info.duration > 0.0 && (sec as f64) >= source_info.duration {
                    sec = ((source_info.duration.floor() as i64) - 1).max(0);
                }
                args.extend(["-ss".into(), sec.to_string(), "-vframes".into(), "1".into(), "-q:v".into(), "1".into()]);
            }
            "audio_only" => {
                args.push("-vn".into());
                let fmt = val_as_str(p, "value").unwrap_or("mp3");
                match fmt {
                    "original" => args.extend(["-c:a".into(), "copy".into()]),
                    "mp3" => args.extend(["-c:a".into(), "libmp3lame".into(), "-b:a".into(), "320k".into()]),
                    "aac" => args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "320k".into()]),
                    "m4a" => args.extend(["-c:a".into(), "alac".into()]),
                    "wav" => args.extend(["-c:a".into(), "pcm_s24le".into()]),
                    "flac" => args.extend(["-c:a".into(), "flac".into(), "-compression_level".into(), "8".into()]),
                    "ogg" => args.extend(["-c:a".into(), "libvorbis".into(), "-q:a".into(), "8".into()]),
                    "opus" => args.extend(["-c:a".into(), "libopus".into(), "-b:a".into(), "320k".into(), "-vbr".into(), "on".into()]),
                    _ => {}
                }
            }
            "video_mute" => {
                let vfmt = val_as_str(p, "value").unwrap_or("original");
                args.push("-an".into());
                if vfmt == "original" {
                    args.extend(["-c:v".into(), "copy".into()]);
                } else {
                    let dyn_crf = get_dynamic_crf(&source_info, 14);
                    if vfmt == "avi" {
                        args.extend(["-c:v".into(), "mpeg4".into(), "-vtag".into(), "xvid".into(), "-q:v".into(), "2".into()]);
                    } else if vfmt == "webm" {
                        args.extend(["-c:v".into(), "libvpx-vp9".into(), "-crf".into(), dyn_crf, "-b:v".into(), "0".into(), "-row-mt".into(), "1".into()]);
                    } else {
                        args.extend(["-c:v".into(), "libx264".into(), "-preset".into(), "slower".into(), "-crf".into(), dyn_crf]);
                    }
                }
            }
            "gif" => {
                args.extend([
                    "-vf".into(),
                    "fps=15,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse".into(),
                    "-loop".into(), "0".into(),
                ]);
            }
            "webp_anim" => {
                args.extend([
                    "-c:v".into(), "libwebp".into(), "-lossless".into(), "0".into(),
                    "-q:v".into(), "70".into(), "-preset".into(), "default".into(),
                    "-loop".into(), "0".into(), "-an".into(),
                    "-vf".into(), "fps=15,scale=720:-1:flags=lanczos".into(),
                ]);
            }
            "webm" => {
                args.extend([
                    "-c:v".into(), "libvpx-vp9".into(),
                    "-crf".into(), get_dynamic_crf(&source_info, 20),
                    "-b:v".into(), "0".into(), "-row-mt".into(), "1".into(),
                    "-auto-alt-ref".into(), "0".into(),
                    "-c:a".into(), "libopus".into(), "-b:a".into(), "320k".into(),
                ]);
            }
            "max_compression" => {
                args.extend([
                    "-c:v".into(), "libx265".into(),
                    "-crf".into(), get_dynamic_crf(&source_info, 20),
                    "-preset".into(), "slow".into(), "-tag:v".into(), "hvc1".into(),
                    "-c:a".into(), "aac".into(), "-b:a".into(), "320k".into(),
                ]);
            }
            "trim" => {
                let mode = val_as_str(p, "trim-mode").unwrap_or("fast");
                if mode == "fast" {
                    args.extend(["-c".into(), "copy".into()]);
                } else {
                    args.extend([
                        "-c:v".into(), "libx264".into(), "-preset".into(), "slower".into(),
                        "-crf".into(), get_dynamic_crf(&source_info, 14),
                        "-c:a".into(), "aac".into(), "-b:a".into(), "320k".into(),
                    ]);
                }
            }
            "volume_boost" => {
                let vol = val_as_i64(p, "value").unwrap_or(200);
                args.extend([
                    "-c:v".into(), "copy".into(),
                    "-af".into(), format!("volume={:.2}", (vol as f64) / 100.0),
                    "-c:a".into(), "aac".into(), "-b:a".into(), "320k".into(),
                ]);
            }
            "split" => {
                let seg_time = val_as_i64(p, "value").unwrap_or(15);
                args.extend([
                    "-c".into(), "copy".into(),
                    "-f".into(), "segment".into(),
                    "-segment_time".into(), seg_time.to_string(),
                    "-reset_timestamps".into(), "1".into(),
                ]);
                output_path = split_output_pattern(&output_path);
            }
            "grayscale" => {
                args.extend([
                    "-c:v".into(), "libx264".into(), "-preset".into(), "slow".into(),
                    "-crf".into(), get_dynamic_crf(&source_info, 16),
                    "-vf".into(), "format=gray".into(),
                    "-c:a".into(), "copy".into(),
                ]);
            }
            "deshake" => {
                args.extend([
                    "-c:v".into(), "libx264".into(), "-preset".into(), "slow".into(),
                    "-crf".into(), get_dynamic_crf(&source_info, 16),
                    "-vf".into(), "deshake".into(),
                    "-c:a".into(), "copy".into(),
                ]);
            }
            "denoise" => {
                let dn_val = val_as_i64(p, "value").unwrap_or(50) as f64;
                let luma = (dn_val / 10.0).max(1.0);
                let tmp = (dn_val / 10.0 * 1.5).max(1.0);
                let luma_s = format_trim_float(luma, 1);
                let tmp_s = format_trim_float(tmp, 1);
                args.extend([
                    "-c:v".into(), "libx264".into(), "-preset".into(), "slow".into(),
                    "-crf".into(), get_dynamic_crf(&source_info, 16),
                    "-vf".into(), format!("hqdn3d={}:{}:{}:{}", luma_s, luma_s, tmp_s, tmp_s),
                    "-c:a".into(), "copy".into(),
                ]);
            }
            "sharpen" => {
                let sh_val = val_as_i64(p, "value").unwrap_or(50) as f64;
                let amount = (sh_val / 50.0).max(0.1);
                args.extend([
                    "-c:v".into(), "libx264".into(), "-preset".into(), "slow".into(),
                    "-crf".into(), get_dynamic_crf(&source_info, 16),
                    "-vf".into(), format!("unsharp=5:5:{}", format_trim_float(amount, 2)),
                    "-c:a".into(), "copy".into(),
                ]);
            }
            "loudnorm" => {
                args.extend([
                    "-c:v".into(), "copy".into(),
                    "-af".into(), "loudnorm=I=-16:TP=-1.5:LRA=11".into(),
                    "-c:a".into(), "aac".into(), "-b:a".into(), "320k".into(),
                ]);
            }
            "audio_denoise" => {
                let ad_val = val_as_i64(p, "value").unwrap_or(50) as f64;
                let nr = (4.0 + (ad_val / 100.0) * 20.0).round() as i64;
                args.extend([
                    "-c:v".into(), "copy".into(),
                    "-af".into(), format!("afftdn=nr={}", nr),
                    "-c:a".into(), "aac".into(), "-b:a".into(), "320k".into(),
                ]);
            }
            "autocrop" => {
                args.extend(["-c:v".into(), "libx264".into(), "-preset".into(), "slow".into(), "-crf".into(), "16".into()]);
                if let Some(crop) = val_as_str(state, "_detectedCrop") {
                    args.extend(["-vf".into(), format!("crop={}", crop)]);
                }
                args.extend(["-c:a".into(), "copy".into()]);
            }
            "deblock" => {
                let db_val = val_as_i64(p, "value").unwrap_or(50) as f64;
                let strength = ((db_val / 16.6).ceil() as i64).clamp(1, 6);
                let alpha = format!("{:.2}", (strength as f64) / 6.0);
                args.extend([
                    "-c:v".into(), "libx264".into(), "-preset".into(), "slow".into(), "-crf".into(), "16".into(),
                    "-vf".into(), format!("deblock=filter=weak:block=4:alpha={}:beta={}:gamma={}:delta={}", alpha, alpha, alpha, alpha),
                    "-c:a".into(), "copy".into(),
                ]);
            }
            "hdr2sdr" => {
                args.extend([
                    "-c:v".into(), "libx264".into(), "-preset".into(), "slow".into(), "-crf".into(), "16".into(),
                    "-vf".into(), "format=gbrpf32le,tonemap=hable:desat=0,format=yuv420p".into(),
                    "-c:a".into(), "copy".into(),
                ]);
            }
            "deinterlace" => {
                args.extend([
                    "-c:v".into(), "libx264".into(), "-preset".into(), "slow".into(), "-crf".into(), "16".into(),
                    "-vf".into(), "bwdif=1".into(),
                    "-c:a".into(), "copy".into(),
                ]);
            }
            "minterpolate" => {
                args.extend([
                    "-c:v".into(), "libx264".into(), "-preset".into(), "slow".into(), "-crf".into(), "16".into(),
                    "-vf".into(), "minterpolate='mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=60'".into(),
                    "-fps_mode".into(), "cfr".into(),
                    "-c:a".into(), "copy".into(),
                ]);
            }
            "multi_filter" => {
                let filters = p
                    .get("filters")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                let mut v_filters: Vec<String> = Vec::new();
                let mut a_filters: Vec<String> = Vec::new();
                let mut needs_fps_mode = false;
                let mut speed_multiplier: Option<f64> = None;
                let mut is_split = false;
                let mut split_time: i64 = 15;
                let mut force_video_reencode = false;

                for f in &filters {
                    let fid = val_as_str(f, "id").unwrap_or("");
                    let fp = f.get("params").unwrap_or(&empty_obj);
                    let val = val_as_i64(fp, "value").unwrap_or(50) as f64;

                    match fid {
                        "trim" => {
                            if val_as_str(fp, "trim-mode") == Some("precise") {
                                force_video_reencode = true;
                            }
                        }
                        "timelapse" => {
                            let speed = val_as_f64(fp, "value").unwrap_or(4.0).max(0.01);
                            speed_multiplier = Some(speed);
                            v_filters.push(format!("setpts={:.4}*PTS", 1.0 / speed));
                            duration_multiplier = 1.0 / speed;
                        }
                        "slowmo" => {
                            let slow = val_as_f64(fp, "value").unwrap_or(2.0).max(0.01);
                            speed_multiplier = Some(1.0 / slow);
                            v_filters.push(format!("setpts={:.4}*PTS", slow));
                            duration_multiplier = slow;
                        }
                        "rotate" => match val_as_str(fp, "value").unwrap_or("90R") {
                            "flipH" => v_filters.push("hflip".into()),
                            "flipV" => v_filters.push("vflip".into()),
                            "90R" => v_filters.push("transpose=1".into()),
                            "90L" => v_filters.push("transpose=2".into()),
                            "180" => v_filters.push("transpose=1,transpose=1".into()),
                            _ => {}
                        },
                        "reverse" => {
                            v_filters.push("reverse".into());
                            a_filters.push("areverse".into());
                        }
                        "split" => {
                            is_split = true;
                            split_time = val_as_i64(fp, "value").unwrap_or(15);
                        }
                        "autocrop" => {
                            if let Some(crop) = val_as_str(state, "_detectedCrop") {
                                v_filters.push(format!("crop={}", crop));
                            }
                        }
                        "grayscale" => v_filters.push("format=gray".into()),
                        "deshake" => v_filters.push("deshake".into()),
                        "denoise" => {
                            let luma = (val / 10.0).max(1.0);
                            let tmp = (val / 10.0 * 1.5).max(1.0);
                            let luma_s = format_trim_float(luma, 1);
                            let tmp_s = format_trim_float(tmp, 1);
                            v_filters.push(format!("hqdn3d={}:{}:{}:{}", luma_s, luma_s, tmp_s, tmp_s));
                        }
                        "sharpen" => {
                            let amount = (val / 50.0).max(0.1);
                            v_filters.push(format!("unsharp=5:5:{}", format_trim_float(amount, 2)));
                        }
                        "deblock" => {
                            let strength = ((val / 16.6).ceil() as i64).clamp(1, 6);
                            let alpha = format!("{:.2}", (strength as f64) / 6.0);
                            v_filters.push(format!(
                                "deblock=filter=weak:block=4:alpha={}:beta={}:gamma={}:delta={}",
                                alpha, alpha, alpha, alpha
                            ));
                        }
                        "hdr2sdr" => v_filters.push("format=gbrpf32le,tonemap=hable:desat=0,format=yuv420p".into()),
                        "deinterlace" => v_filters.push("bwdif=1".into()),
                        "minterpolate" => {
                            v_filters.push("minterpolate='mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=60'".into());
                            needs_fps_mode = true;
                        }
                        "volume_boost" => {
                            let vol = val_as_i64(fp, "value").unwrap_or(200);
                            a_filters.push(format!("volume={:.2}", (vol as f64) / 100.0));
                        }
                        "loudnorm" => a_filters.push("loudnorm=I=-16:TP=-1.5:LRA=11".into()),
                        "audio_denoise" => {
                            let ad_val = val_as_i64(fp, "value").unwrap_or(50) as f64;
                            let nr = (4.0 + (ad_val / 100.0) * 20.0).round() as i64;
                            a_filters.push(format!("afftdn=nr={}", nr));
                        }
                        _ => {}
                    }
                }

                if let Some(sm) = speed_multiplier {
                    let has_reverse = filters.iter().any(|f| val_as_str(f, "id") == Some("reverse"));
                    if has_reverse {
                        if let Some(pos) = a_filters.iter().position(|x| x == "areverse") {
                            a_filters.remove(pos);
                        }
                        a_filters.extend(build_atempo(sm));
                        a_filters.push("areverse".into());
                    } else {
                        a_filters.extend(build_atempo(sm));
                    }
                }

                const V_FILTER_ORDER: [&str; 14] = [
                    "format=gbrpf32le",
                    "crop=",
                    "transpose=",
                    "hflip",
                    "vflip",
                    "bwdif=",
                    "deshake",
                    "hqdn3d=",
                    "deblock=",
                    "unsharp=",
                    "format=gray",
                    "setpts=",
                    "reverse",
                    "minterpolate",
                ];

                v_filters.sort_by_key(|f| {
                    V_FILTER_ORDER
                        .iter()
                        .position(|prefix| f.starts_with(prefix))
                        .unwrap_or(999)
                });

                if !v_filters.is_empty() || force_video_reencode {
                    args.extend(["-c:v".into(), "libx264".into(), "-preset".into(), "slow".into(), "-crf".into(), "16".into()]);
                    if !v_filters.is_empty() {
                        args.extend(["-vf".into(), v_filters.join(",")]);
                    }
                    if needs_fps_mode {
                        args.extend(["-fps_mode".into(), "cfr".into()]);
                    }
                } else {
                    args.extend(["-c:v".into(), "copy".into()]);
                }

                if !a_filters.is_empty() {
                    args.extend([
                        "-af".into(), a_filters.join(","),
                        "-c:a".into(), "aac".into(), "-b:a".into(), "320k".into(),
                    ]);
                } else {
                    args.extend(["-c:a".into(), "copy".into()]);
                }

                if is_split {
                    args.extend([
                        "-f".into(), "segment".into(),
                        "-segment_time".into(), split_time.to_string(),
                        "-reset_timestamps".into(), "1".into(),
                    ]);
                    output_path = split_output_pattern(&output_path);
                }
            }
            _ => {}
        }

        if trim_params.is_some() {
            args.extend(["-avoid_negative_ts".into(), "make_zero".into()]);
        }

        if matches!(target_ext.as_str(), ".mp4" | ".mov" | ".m4v" | ".3gp" | ".m4a") {
            args.extend(["-movflags".into(), "+faststart".into()]);
        }

        args.push(output_path);
        return BuiltFfmpegCommand {
            args,
            duration_multiplier,
        };
    }

    // Pro / Custom Mode
    let operation_mode = val_as_str(state, "operationMode").unwrap_or("both");

    if operation_mode == "audio_only" {
        args.push("-vn".into());
    } else {
        let base_vcodec = val_as_str(state, "videoCodec").unwrap_or("libx264");
        let target_vcodec = if hw_accel != "none" {
            hardware_emitter(hw_accel, base_vcodec).unwrap_or(base_vcodec)
        } else {
            base_vcodec
        };

        args.push("-c:v".into());
        args.push(target_vcodec.into());

        if target_vcodec != "copy" {
            let v_constraints = video_codec_constraints(base_vcodec);
            let quality_mode = val_as_str(state, "qualityMode").unwrap_or("crf");

            if quality_mode == "crf" {
                let crf_str = state
                    .get("crf")
                    .map(|v| match v {
                        Value::String(s) => s.clone(),
                        other => other.to_string(),
                    })
                    .unwrap_or_else(|| "23".into());

                if target_vcodec == "mpeg4" || target_vcodec == "mpeg2video" {
                    args.extend(["-qscale:v".into(), crf_str]);
                } else if target_vcodec.contains("nvenc") {
                    args.extend(["-cq".into(), crf_str]);
                } else if target_vcodec.contains("qsv") {
                    args.extend(["-global_quality".into(), crf_str]);
                } else if target_vcodec.contains("amf") {
                    args.extend([
                        "-rc".into(), "cqp".into(),
                        "-qp_i".into(), crf_str.clone(),
                        "-qp_p".into(), crf_str,
                    ]);
                } else {
                    args.extend(["-crf".into(), crf_str]);
                    if base_vcodec == "libvpx-vp9" || base_vcodec == "libaom-av1" {
                        args.extend(["-b:v".into(), "0".into()]);
                    }
                }
            } else if quality_mode == "bitrate" {
                let mut vbr = val_as_i64(state, "videoBitrate").unwrap_or(5000).max(1) as u32;
                if let Some(ref vc) = v_constraints {
                    if vbr > vc.max_bitrate {
                        vbr = vc.max_bitrate;
                    }
                }
                args.extend(["-b:v".into(), format!("{}k", vbr)]);
            }

            if let Some(preset) = val_as_str(state, "preset") {
                const CPU_PRESETS: [&str; 9] = [
                    "ultrafast", "superfast", "veryfast", "faster", "fast",
                    "medium", "slow", "slower", "veryslow",
                ];
                const NVENC_PRESETS: [&str; 7] = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
                const AMF_PRESETS: [&str; 3] = ["speed", "balanced", "quality"];

                if base_vcodec == "libvpx-vp9" {
                    let cpu_used = match preset {
                        "veryslow" => "0",
                        "slower" => "1",
                        "slow" => "2",
                        "medium" => "3",
                        "fast" => "4",
                        "faster" | "veryfast" | "superfast" | "ultrafast" => "5",
                        _ => "1",
                    };
                    args.extend([
                        "-deadline".into(), "good".into(),
                        "-cpu-used".into(), cpu_used.into(),
                        "-row-mt".into(), "1".into(),
                    ]);
                } else if base_vcodec == "libaom-av1" {
                    let cpu_used = match preset {
                        "veryslow" => "1",
                        "slower" => "2",
                        "slow" => "3",
                        "medium" => "4",
                        "fast" => "5",
                        "faster" => "6",
                        "veryfast" => "7",
                        "superfast" | "ultrafast" => "8",
                        _ => "2",
                    };
                    args.extend(["-cpu-used".into(), cpu_used.into(), "-row-mt".into(), "1".into()]);
                } else if target_vcodec.contains("nvenc") {
                    let safe = if NVENC_PRESETS.contains(&preset) { preset } else { "p7" };
                    args.extend(["-preset".into(), safe.into()]);
                } else if target_vcodec.contains("amf") {
                    let safe = if AMF_PRESETS.contains(&preset) { preset } else { "quality" };
                    args.extend(["-quality".into(), safe.into()]);
                } else {
                    let safe = if CPU_PRESETS.contains(&preset) { preset } else { "medium" };
                    args.extend(["-preset".into(), safe.into()]);
                }
            }

            let mut v_filters: Vec<String> = Vec::new();
            let empty_obj = serde_json::json!({});
            let filters_obj = state.get("filters");
            let f_vals = state.get("filterValues").unwrap_or(&empty_obj);
            let mut has_minterpolate = false;

            if let Some(f) = filters_obj {
                if val_as_bool(f, "hdr2sdr") {
                    v_filters.push("format=gbrpf32le,tonemap=hable:desat=0,format=yuv420p".into());
                }
                if val_as_bool(f, "deinterlace") {
                    v_filters.push("bwdif=1".into());
                }
                if val_as_bool(f, "denoise") {
                    let dn = val_as_f64(f_vals, "denoise").unwrap_or(50.0);
                    let luma = (dn / 10.0).max(1.0);
                    let tmp = (dn / 10.0 * 1.5).max(1.0);
                    let luma_s = format_trim_float(luma, 1);
                    let tmp_s = format_trim_float(tmp, 1);
                    v_filters.push(format!("hqdn3d={}:{}:{}:{}", luma_s, luma_s, tmp_s, tmp_s));
                }
                if val_as_bool(f, "deblock") {
                    let db = val_as_f64(f_vals, "deblock").unwrap_or(50.0);
                    let strength = ((db / 16.6).ceil() as i64).clamp(1, 6);
                    let alpha = format!("{:.2}", (strength as f64) / 6.0);
                    v_filters.push(format!(
                        "deblock=filter=weak:block=4:alpha={}:beta={}:gamma={}:delta={}",
                        alpha, alpha, alpha, alpha
                    ));
                }
                if val_as_bool(f, "deshake") {
                    v_filters.push("deshake".into());
                }
                if val_as_bool(f, "sharpen") {
                    let sh = val_as_f64(f_vals, "sharpen").unwrap_or(50.0);
                    let amount = (sh / 50.0).max(0.1);
                    v_filters.push(format!("unsharp=5:5:{}", format_trim_float(amount, 1)));
                }
                if val_as_bool(f, "minterpolate") {
                    has_minterpolate = true;
                    let m_fps = match val_as_str(state, "fps") {
                        Some(fps) if fps != "original" => fps.parse::<f64>().unwrap_or(60.0),
                        _ => 60.0,
                    };
                    v_filters.push(format!(
                        "minterpolate='mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps={}'",
                        format_trim_float(m_fps, 2)
                    ));
                }
            }

            if let Some(res) = val_as_str(state, "resolution").filter(|&r| r != "original") {
                let parts: Vec<&str> = res.split('x').collect();
                if parts.len() == 2 {
                    let mut w = parts[0].parse::<u32>().unwrap_or(1920);
                    let mut h = parts[1].parse::<u32>().unwrap_or(1080);
                    if let Some(ref vc) = v_constraints {
                        if w > vc.max_width {
                            w = vc.max_width;
                        }
                        if h > vc.max_height {
                            h = vc.max_height;
                        }
                    }
                    w = (w / 2) * 2;
                    h = (h / 2) * 2;
                    v_filters.push(format!(
                        "scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:trunc((ow-iw)/2):trunc((oh-ih)/2)",
                        w, h, w, h
                    ));
                }
            } else if !v_filters.is_empty() || base_vcodec != "copy" {
                v_filters.push("scale=trunc(iw/2)*2:trunc(ih/2)*2".into());
            }

            if !v_filters.is_empty() {
                args.extend(["-vf".into(), v_filters.join(",")]);
            }

            if has_minterpolate {
                args.extend(["-fps_mode".into(), "cfr".into()]);
            } else if let Some(fps_str) = val_as_str(state, "fps").filter(|&f| f != "original") {
                if let Some(mut fps_num) = js_parse_f64(fps_str) {
                    if let Some(ref vc) = v_constraints {
                        if fps_num > vc.max_fps {
                            fps_num = vc.max_fps;
                        }
                    }
                    args.extend(["-r".into(), format_trim_float(fps_num, 3)]);
                }
            }
        }
    }

    if operation_mode == "video_only" {
        args.push("-an".into());
    } else {
        let target_acodec = val_as_str(state, "audioCodec").unwrap_or("aac");
        args.extend(["-c:a".into(), target_acodec.into()]);

        if target_acodec != "copy" {
            let constraints = audio_codec_constraints(target_acodec);
            let is_lossless = constraints.as_ref().map(|c| c.lossless).unwrap_or(false);

            if !is_lossless {
                let mut abr: u32 = match val_as_str(state, "audioBitrate").filter(|&b| b != "original") {
                    Some(b) => js_parse_i64(b).unwrap_or(192).max(1) as u32,
                    None => {
                        if let Some(src_br) = source_info.audio_bitrate {
                            (src_br / 1000) as u32
                        } else {
                            320
                        }
                    }
                };
                if let Some(ref c) = constraints {
                    if let Some(max_br) = c.max_bitrate {
                        if abr > max_br {
                            abr = max_br;
                        }
                    }
                }
                args.extend(["-b:a".into(), format!("{}k", abr)]);
            }

            if let Some(sr_str) = val_as_str(state, "sampleRate").filter(|&s| s != "original") {
                if let Some(sr_i) = js_parse_i64(sr_str) {
                    let mut sr = sr_i.max(1) as u32;
                    if let Some(ref c) = constraints {
                        if sr > c.max_sample_rate {
                            sr = c.max_sample_rate;
                        }
                    }
                    args.extend(["-ar".into(), sr.to_string()]);
                }
            }

            if let Some(ch_str) = val_as_str(state, "channels").filter(|&c| c != "original") {
                if let Some(ch_i) = js_parse_i64(ch_str) {
                    let mut ch = ch_i.max(1) as u32;
                    if let Some(ref c) = constraints {
                        if ch > c.max_channels {
                            ch = c.max_channels;
                        }
                    }
                    args.extend(["-ac".into(), ch.to_string()]);
                }
            }

            let mut a_filters: Vec<String> = Vec::new();
            let empty_obj = serde_json::json!({});
            let filters_obj = state.get("filters");
            let f_vals = state.get("filterValues").unwrap_or(&empty_obj);
            let mut has_loudnorm = false;

            if let Some(f) = filters_obj {
                if val_as_bool(f, "audiodenoise") {
                    let ad = val_as_f64(f_vals, "audiodenoise").unwrap_or(50.0);
                    let nr = (4.0 + (ad / 100.0) * 20.0).round() as i64;
                    a_filters.push(format!("afftdn=nr={}", nr));
                }
                if val_as_bool(f, "loudnorm") {
                    has_loudnorm = true;
                    a_filters.push("loudnorm=I=-16:TP=-1.5:LRA=11".into());
                }
            }

            if !has_loudnorm {
                if let Some(vol_str) = val_as_str(state, "volume").filter(|&v| v != "original") {
                    if let Some(v) = js_parse_f64(vol_str) {
                        a_filters.push(format!("volume={}", format_trim_float(v / 100.0, 4)));
                    }
                }
            }

            if !a_filters.is_empty() {
                args.extend(["-filter:a".into(), a_filters.join(",")]);
            }
        }
    }

    args.extend(["-sn".into(), "-dn".into()]);
    if matches!(target_ext.as_str(), ".mp4" | ".mov" | ".m4v" | ".3gp" | ".m4a") {
        args.extend(["-movflags".into(), "+faststart".into()]);
    }
    args.push(output_path);

    BuiltFfmpegCommand {
        args,
        duration_multiplier,
    }
}

#[cfg(test)]
mod tests {
    use super::{build_atempo, get_dynamic_crf, js_parse_f64, js_parse_i64, SourceInfo};

    #[test]
    fn js_style_parsing_handles_suffixes() {
        assert_eq!(js_parse_i64("192k"), Some(192));
        assert_eq!(js_parse_i64("320"), Some(320));
        assert_eq!(js_parse_f64("60fps"), Some(60.0));
        assert_eq!(js_parse_f64("1.5x"), Some(1.5));
        assert_eq!(js_parse_i64("original"), None);
    }

    #[test]
    fn dynamic_crf_scales_with_height() {
        let info_1080 = SourceInfo { height: Some(1080), ..Default::default() };
        assert_eq!(get_dynamic_crf(&info_1080, 14), "14");
        let info_2160 = SourceInfo { height: Some(2160), ..Default::default() };
        assert_eq!(get_dynamic_crf(&info_2160, 14), "18");
    }

    #[test]
    fn atempo_chains_out_of_range_speeds() {
        assert_eq!(build_atempo(4.0), vec!["atempo=2.0", "atempo=2.0000"]);
        assert_eq!(build_atempo(0.25), vec!["atempo=0.5", "atempo=0.5000"]);
    }
}
