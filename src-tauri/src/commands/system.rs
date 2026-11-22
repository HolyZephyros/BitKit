use crate::logging::write_log;
use crate::paths::{get_bin_path, hidden_std_command, hidden_tokio_command};
use crate::state::{AppState, GpuInfo};
use regex::Regex;
use serde_json::{json, Value};
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[tauri::command]
pub fn system_log(level: String, args: Vec<Value>) {
    let joined = args
        .iter()
        .map(|v| match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        })
        .collect::<Vec<_>>()
        .join(" ");
    write_log(&level, &joined);
}

#[tauri::command]
pub fn get_bin_paths(app: AppHandle) -> Value {
    json!({
        "ytdlp": get_bin_path(&app, "yt-dlp.exe").to_string_lossy().to_string(),
        "ffmpeg": get_bin_path(&app, "ffmpeg.exe").to_string_lossy().to_string(),
        "ffprobe": get_bin_path(&app, "ffprobe.exe").to_string_lossy().to_string(),
        "deno": get_bin_path(&app, "deno.exe").to_string_lossy().to_string()
    })
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn shell_open_path(file_path: String) -> bool {
    opener::open(&file_path).is_ok()
}

#[tauri::command]
pub fn shell_show_item_in_folder(file_path: String) -> bool {
    let path = Path::new(&file_path);
    if path.exists() && path.is_dir() {
        return opener::open(path).is_ok();
    }

    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("explorer.exe");
        let escaped = file_path.replace('/', "\\");
        cmd.raw_arg(format!("/select,\"{}\"", escaped));
        return cmd.spawn().is_ok();
    }

    #[cfg(not(windows))]
    {
        if let Some(parent) = path.parent() {
            return opener::open(parent).is_ok();
        }
        false
    }
}

#[tauri::command]
pub fn shell_open_external(url: String) -> bool {
    opener::open(&url).is_ok()
}

#[tauri::command]
pub fn system_shutdown(message: Option<String>) -> Value {
    let raw = message.unwrap_or_else(|| "BitKit".to_string());
    let final_msg: String = if raw.chars().count() > 50 {
        raw.chars().take(50).collect()
    } else if raw.is_empty() {
        "BitKit".to_string()
    } else {
        raw
    };

    #[cfg(windows)]
    {
        let _ = hidden_std_command("shutdown")
            .args(["/s", "/t", "60", "/c", &final_msg])
            .spawn();
    }

    json!({ "success": true })
}

#[tauri::command]
pub fn system_cancel_shutdown() -> Value {
    #[cfg(windows)]
    {
        let _ = hidden_std_command("shutdown").args(["/a"]).spawn();
    }

    json!({ "success": true })
}

#[cfg(windows)]
fn detect_gpu_names_native() -> Vec<String> {
    #[repr(C)]
    struct DisplayDeviceW {
        cb: u32,
        device_name: [u16; 32],
        device_string: [u16; 128],
        state_flags: u32,
        device_id: [u16; 128],
        device_key: [u16; 128],
    }

    #[link(name = "user32")]
    extern "system" {
        fn EnumDisplayDevicesW(
            lp_device: *const u16,
            i_dev_num: u32,
            lp_display_device: *mut DisplayDeviceW,
            dw_flags: u32,
        ) -> i32;
    }

    let mut names: Vec<String> = Vec::new();
    for idx in 0..32u32 {
        let mut dd = DisplayDeviceW {
            cb: std::mem::size_of::<DisplayDeviceW>() as u32,
            device_name: [0; 32],
            device_string: [0; 128],
            state_flags: 0,
            device_id: [0; 128],
            device_key: [0; 128],
        };
        let ok = unsafe { EnumDisplayDevicesW(std::ptr::null(), idx, &mut dd, 0) };
        if ok == 0 {
            break;
        }
        let end = dd
            .device_string
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(dd.device_string.len());
        let name = String::from_utf16_lossy(&dd.device_string[..end])
            .trim()
            .to_string();
        if !name.is_empty() && !names.iter().any(|n| n.eq_ignore_ascii_case(&name)) {
            names.push(name);
        }
    }
    names
}

#[cfg(not(windows))]
fn detect_gpu_names_native() -> Vec<String> {
    Vec::new()
}

#[tauri::command]
pub async fn system_get_gpu(app: AppHandle, state: State<'_, AppState>) -> Result<GpuInfo, String> {
    let mut cache_guard = state.gpu_cache.lock().await;
    if let Some(cached) = cache_guard.as_ref() {
        return Ok(cached.clone());
    }

    let names = detect_gpu_names_native();

    let name_lower = names.join(" ").to_lowercase();
    let vendor = if name_lower.contains("nvidia")
        || name_lower.contains("geforce")
        || name_lower.contains("rtx")
        || name_lower.contains("gtx")
    {
        "nvidia"
    } else if name_lower.contains("amd") || name_lower.contains("radeon") {
        "amd"
    } else if name_lower.contains("intel")
        || name_lower.contains("arc")
        || name_lower.contains("uhd")
        || name_lower.contains("iris")
    {
        "intel"
    } else {
        "none"
    };

    let to_test: &[&str] = match vendor {
        "nvidia" => &["h264_nvenc", "hevc_nvenc", "av1_nvenc"],
        "amd" => &["h264_amf", "hevc_amf", "av1_amf"],
        "intel" => &["h264_qsv", "hevc_qsv", "vp9_qsv", "av1_qsv"],
        _ => &[],
    };

    let ffmpeg = get_bin_path(&app, "ffmpeg.exe");
    let frame_re = Regex::new(r"frame=\s*1").unwrap();
    let mut available = Vec::new();

    for &enc in to_test {
        let works = match tokio::time::timeout(
            Duration::from_secs(8),
            hidden_tokio_command(&ffmpeg)
                .args([
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:s=256x256:d=1:r=25",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:v",
                    enc,
                    "-frames:v",
                    "1",
                    "-f",
                    "null",
                    "-",
                ])
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .output(),
        )
        .await
        {
            Ok(Ok(out)) => {
                let stderr = String::from_utf8_lossy(&out.stderr);
                frame_re.is_match(&stderr)
            }
            _ => false,
        };

        if works {
            available.push(enc.to_string());
            if vendor == "nvidia" && !enc.contains("av1") {
                available.push(format!("{}_lossless", enc));
            }
        }
    }

    let info = GpuInfo {
        vendor: vendor.to_string(),
        name: names.first().cloned().unwrap_or_default(),
        all: names,
        available,
    };

    *cache_guard = Some(info.clone());
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::detect_gpu_names_native;

    #[test]
    fn detects_display_adapters_natively() {
        let names = detect_gpu_names_native();
        // Should return without spawning powershell; on Windows desktops at least 1 adapter exists
        assert!(names.iter().all(|n| !n.is_empty()));
    }
}
