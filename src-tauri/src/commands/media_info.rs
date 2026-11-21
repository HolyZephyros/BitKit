use crate::paths::{get_bin_path, hidden_tokio_command};
use serde_json::{json, Value};
use std::process::Stdio;
use tauri::AppHandle;

fn parse_fps(raw: &str) -> f64 {
    let parts: Vec<&str> = raw.split('/').collect();
    if parts.len() == 2 {
        let num: f64 = parts[0].parse().unwrap_or(0.0);
        let den: f64 = parts[1].parse().unwrap_or(0.0);
        if den != 0.0 {
            return num / den;
        }
        return 0.0;
    }
    raw.parse().unwrap_or(0.0)
}

#[tauri::command]
pub async fn media_get_info(app: AppHandle, file_path: String) -> Value {
    let ffprobe = get_bin_path(&app, "ffprobe.exe");

    let output = match hidden_tokio_command(&ffprobe)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            &file_path,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
    {
        Ok(out) => out,
        Err(err) => {
            return json!({
                "success": false,
                "errorKey": "backend.ffprobeError",
                "errorParams": { "err": err.to_string() }
            });
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let err_msg = if stderr.is_empty() {
            format!("ffprobe exited with code {:?}", output.status.code())
        } else {
            stderr
        };
        return json!({
            "success": false,
            "errorKey": "backend.ffprobeError",
            "errorParams": { "err": err_msg }
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let info: Value = match serde_json::from_str(&stdout) {
        Ok(v) => v,
        Err(err) => {
            return json!({
                "success": false,
                "errorKey": "backend.jsonParseError",
                "errorParams": { "err": err.to_string() }
            });
        }
    };

    let format = info.get("format").cloned().unwrap_or_else(|| json!({}));
    let streams = info
        .get("streams")
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();

    let video: Vec<Value> = streams
        .iter()
        .filter(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("video"))
        .map(|v| {
            let fps_str = v.get("r_frame_rate").and_then(|x| x.as_str()).unwrap_or("");
            let bitrate = v
                .get("bit_rate")
                .and_then(|x| x.as_str())
                .and_then(|s| s.parse::<u64>().ok())
                .or_else(|| v.get("bit_rate").and_then(|x| x.as_u64()))
                .unwrap_or(0);
            json!({
                "codec": v.get("codec_name").and_then(|x| x.as_str()).unwrap_or(""),
                "codecLong": v.get("codec_long_name").and_then(|x| x.as_str()).unwrap_or(""),
                "width": v.get("width").and_then(|x| x.as_u64()).unwrap_or(0),
                "height": v.get("height").and_then(|x| x.as_u64()).unwrap_or(0),
                "fps": parse_fps(fps_str),
                "bitrate": bitrate,
                "pixelFormat": v.get("pix_fmt").and_then(|x| x.as_str()).unwrap_or(""),
                "profile": v.get("profile").and_then(|x| x.as_str()).unwrap_or("")
            })
        })
        .collect();

    let audio: Vec<Value> = streams
        .iter()
        .filter(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("audio"))
        .map(|a| {
            let sample_rate = a
                .get("sample_rate")
                .and_then(|x| x.as_str())
                .and_then(|s| s.parse::<u64>().ok())
                .or_else(|| a.get("sample_rate").and_then(|x| x.as_u64()))
                .unwrap_or(0);
            let bitrate = a
                .get("bit_rate")
                .and_then(|x| x.as_str())
                .and_then(|s| s.parse::<u64>().ok())
                .or_else(|| a.get("bit_rate").and_then(|x| x.as_u64()))
                .unwrap_or(0);
            json!({
                "codec": a.get("codec_name").and_then(|x| x.as_str()).unwrap_or(""),
                "codecLong": a.get("codec_long_name").and_then(|x| x.as_str()).unwrap_or(""),
                "sampleRate": sample_rate,
                "channels": a.get("channels").and_then(|x| x.as_u64()).unwrap_or(0),
                "channelLayout": a.get("channel_layout").and_then(|x| x.as_str()).unwrap_or(""),
                "bitrate": bitrate,
                "language": a.pointer("/tags/language").and_then(|x| x.as_str()).unwrap_or("")
            })
        })
        .collect();

    let subtitles: Vec<Value> = streams
        .iter()
        .filter(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("subtitle"))
        .map(|s| {
            json!({
                "codec": s.get("codec_name").and_then(|x| x.as_str()).unwrap_or(""),
                "language": s.pointer("/tags/language").and_then(|x| x.as_str()).unwrap_or(""),
                "title": s.pointer("/tags/title").and_then(|x| x.as_str()).unwrap_or("")
            })
        })
        .collect();

    let duration = format
        .get("duration")
        .and_then(|x| x.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .or_else(|| format.get("duration").and_then(|x| x.as_f64()))
        .unwrap_or(0.0);
    let size = format
        .get("size")
        .and_then(|x| x.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .or_else(|| format.get("size").and_then(|x| x.as_u64()))
        .unwrap_or(0);
    let bitrate = format
        .get("bit_rate")
        .and_then(|x| x.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .or_else(|| format.get("bit_rate").and_then(|x| x.as_u64()))
        .unwrap_or(0);

    json!({
        "success": true,
        "data": {
            "filename": format.get("filename").and_then(|x| x.as_str()).unwrap_or(""),
            "duration": duration,
            "size": size,
            "bitrate": bitrate,
            "formatName": format.get("format_name").and_then(|x| x.as_str()).unwrap_or(""),
            "formatLong": format.get("format_long_name").and_then(|x| x.as_str()).unwrap_or(""),
            "tags": format.get("tags").cloned().unwrap_or_else(|| json!({})),
            "video": video,
            "audio": audio,
            "subtitles": subtitles
        }
    })
}
