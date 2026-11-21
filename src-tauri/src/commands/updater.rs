use crate::paths::{get_bin_path, hidden_std_command, hidden_tokio_command, user_data_dir};
use crate::state::{AppState, CachedRelease};
use futures_util::StreamExt;
use regex::Regex;
use serde_json::{json, Value};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

/// Cleans up leftover pending-update.json & installer files if the app is already on that version or newer.
pub fn cleanup_stale_pending_update(app: &AppHandle) {
    let current = format!("v{}", app.package_info().version);
    let flag_path = user_data_dir().join("pending-update.json");
    if let Ok(content) = fs::read_to_string(&flag_path) {
        if let Ok(flag) = serde_json::from_str::<Value>(&content) {
            let pending_ver = flag.get("version").and_then(|v| v.as_str()).unwrap_or("");
            if !pending_ver.is_empty() && !is_newer_version(pending_ver, &current) {
                if let Some(inst) = flag.get("installerPath").and_then(|v| v.as_str()) {
                    let _ = fs::remove_file(inst);
                }
                let _ = fs::remove_file(&flag_path);
            }
        }
    }
}

fn validate_pe_installer(path: &Path) -> Result<(), String> {
    let meta = fs::metadata(path).map_err(|_| "Downloaded installer not found".to_string())?;
    if meta.len() < 1_000_000 {
        return Err("Downloaded installer is incomplete or corrupted".to_string());
    }
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    let mut magic = [0u8; 2];
    f.read_exact(&mut magic).map_err(|e| e.to_string())?;
    if &magic != b"MZ" {
        return Err("Downloaded file is not a valid Windows installer".to_string());
    }
    Ok(())
}

fn is_newer_version(remote: &str, local: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.trim_start_matches('v')
            .split('.')
            .map(|p| p.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let r = parse(remote);
    let l = parse(local);
    let max_len = r.len().max(l.len());
    for i in 0..max_len {
        let rr = *r.get(i).unwrap_or(&0);
        let ll = *l.get(i).unwrap_or(&0);
        if rr > ll {
            return true;
        }
        if rr < ll {
            return false;
        }
    }
    false
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("BitKit")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

async fn get_latest_github_release(owner: &str, repo: &str) -> Result<Value, String> {
    let client = http_client()?;
    let url = format!("https://api.github.com/repos/{}/{}/releases/latest", owner, repo);
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("GitHub API error: {}", resp.status().as_u16()));
    }
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

async fn get_ytdlp_version(bin_path: &Path) -> Option<String> {
    let mut cmd = hidden_tokio_command(bin_path);
    cmd.args(["--version", "--ignore-config"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(parent) = bin_path.parent() {
        if !parent.as_os_str().is_empty() {
            cmd.current_dir(parent);
        }
    }
    let out = cmd.output().await.ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

async fn get_ffmpeg_version(bin_path: &Path) -> Option<String> {
    let out = hidden_tokio_command(bin_path)
        .args(["-version"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let re = Regex::new(r"ffmpeg version (\S+)").ok()?;
    let raw = re.captures(&stdout)?.get(1)?.as_str();
    let last_part = raw.split('-').last().unwrap_or(raw);
    if last_part.len() == 8 && last_part.chars().all(|c| c.is_ascii_digit()) {
        return Some(format!(
            "{}.{}.{}",
            &last_part[0..4],
            &last_part[4..6],
            &last_part[6..8]
        ));
    }
    Some(raw.to_string())
}

#[tauri::command]
pub async fn updater_get_versions(app: AppHandle) -> Value {
    let ytdlp_path = get_bin_path(&app, "yt-dlp.exe");
    let ffmpeg_path = get_bin_path(&app, "ffmpeg.exe");
    let (ytdlp, ffmpeg) = tokio::join!(get_ytdlp_version(&ytdlp_path), get_ffmpeg_version(&ffmpeg_path));
    json!({
        "ytdlp": ytdlp,
        "ffmpeg": ffmpeg
    })
}

fn find_windows_installer_asset(release: &Value) -> (Option<String>, Option<String>) {
    let Some(assets) = release.get("assets").and_then(|v| v.as_array()) else {
        return (None, None);
    };

    let chosen = assets
        .iter()
        .find(|a| {
            let name = a
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_lowercase();
            name.ends_with(".exe") && name.contains("setup")
        })
        .or_else(|| {
            assets.iter().find(|a| {
                a.get("name")
                    .and_then(|n| n.as_str())
                    .map(|n| n.to_lowercase().ends_with(".exe"))
                    .unwrap_or(false)
            })
        });

    chosen
        .map(|a| {
            (
                a.get("browser_download_url")
                    .and_then(|u| u.as_str())
                    .map(String::from),
                a.get("name").and_then(|n| n.as_str()).map(String::from),
            )
        })
        .unwrap_or((None, None))
}

#[tauri::command]
pub async fn updater_check_app(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    let current = format!("v{}", app.package_info().version);
    Ok(match get_latest_github_release("HolyZephyros", "BitKit").await {
        Ok(latest) => {
            let mut latest_tag = latest
                .get("tag_name")
                .and_then(|v| v.as_str())
                .unwrap_or(&current)
                .to_string();
            if !latest_tag.starts_with('v') {
                latest_tag = format!("v{}", latest_tag);
            }
            let version_clean = latest_tag.trim_start_matches('v').to_string();
            let is_available = is_newer_version(&latest_tag, &current);
            let html_url = latest
                .get("html_url")
                .and_then(|v| v.as_str())
                .unwrap_or("https://github.com/HolyZephyros/BitKit/releases/latest")
                .to_string();

            let (installer_url, installer_name) = find_windows_installer_asset(&latest);

            *state.latest_release.lock().await = Some(CachedRelease {
                version: version_clean.clone(),
                installer_url,
                installer_name,
            });

            let mut already_downloaded = false;
            let flag_path = user_data_dir().join("pending-update.json");
            if let Ok(content) = fs::read_to_string(&flag_path) {
                if let Ok(flag) = serde_json::from_str::<Value>(&content) {
                    let flag_ver = flag.get("version").and_then(|v| v.as_str()).unwrap_or("");
                    let inst_path = flag
                        .get("installerPath")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if flag_ver == version_clean
                        && !inst_path.is_empty()
                        && validate_pe_installer(Path::new(inst_path)).is_ok()
                    {
                        already_downloaded = true;
                    }
                }
            }

            json!({
                "current": current,
                "latest": latest_tag,
                "updateAvailable": is_available,
                "alreadyDownloaded": already_downloaded,
                "url": html_url
            })
        }
        Err(e) => json!({
            "current": current,
            "updateAvailable": false,
            "error": e
        }),
    })
}

#[tauri::command]
pub async fn updater_download_app(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    if state
        .app_update_downloading
        .swap(true, Ordering::SeqCst)
    {
        return Ok(json!({ "success": true, "alreadyDownloading": true }));
    }

    let result: Result<(), String> = async {
        let mut cached = state.latest_release.lock().await.clone();
        if cached.is_none() {
            let latest = get_latest_github_release("HolyZephyros", "BitKit").await?;
            let version = latest
                .get("tag_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim_start_matches('v')
                .to_string();
            let (installer_url, installer_name) = find_windows_installer_asset(&latest);
            cached = Some(CachedRelease {
                version,
                installer_url,
                installer_name,
            });
        }

        let release = cached.ok_or_else(|| "Release info unavailable".to_string())?;
        let url = release
            .installer_url
            .ok_or_else(|| "No Windows installer asset found in release".to_string())?;
        let filename = release
            .installer_name
            .unwrap_or_else(|| format!("BitKit-Setup-{}.exe", release.version));

        let updates_dir = user_data_dir().join("updates");
        fs::create_dir_all(&updates_dir).map_err(|e| e.to_string())?;
        let dest_path = updates_dir.join(&filename);
        let tmp_path = updates_dir.join(format!("{}.part", filename));
        let flag_path = user_data_dir().join("pending-update.json");

        // Skip redundant download if this exact version is already downloaded & valid
        if validate_pe_installer(&dest_path).is_ok() {
            let flag_data = json!({
                "version": release.version,
                "installerPath": dest_path.to_string_lossy().to_string()
            });
            let _ = fs::write(&flag_path, flag_data.to_string());
            let _ = app.emit("app:updateDownloaded", json!({ "version": release.version }));
            return Ok(());
        }

        let client = reqwest::Client::builder()
            .user_agent("BitKit")
            .connect_timeout(Duration::from_secs(20))
            .read_timeout(Duration::from_secs(60))
            .build()
            .map_err(|e| e.to_string())?;
        let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("Download failed: HTTP {}", resp.status().as_u16()));
        }

        let total = resp.content_length().unwrap_or(0);
        let mut file = File::create(&tmp_path).map_err(|e| e.to_string())?;
        let mut stream = resp.bytes_stream();
        let mut transferred: u64 = 0;
        let started = Instant::now();
        let mut last_emit = Instant::now();

        while let Some(chunk_res) = stream.next().await {
            let chunk = match chunk_res {
                Ok(c) => c,
                Err(e) => {
                    drop(file);
                    let _ = fs::remove_file(&tmp_path);
                    return Err(e.to_string());
                }
            };
            if let Err(e) = file.write_all(&chunk) {
                drop(file);
                let _ = fs::remove_file(&tmp_path);
                return Err(e.to_string());
            }
            transferred += chunk.len() as u64;

            if last_emit.elapsed() >= Duration::from_millis(200) || (total > 0 && transferred >= total) {
                last_emit = Instant::now();
                let elapsed = started.elapsed().as_secs_f64().max(0.001);
                let bps = (transferred as f64) / elapsed;
                let percent = if total > 0 {
                    ((transferred as f64) / (total as f64)) * 100.0
                } else {
                    0.0
                };
                let _ = app.emit(
                    "app:updateProgress",
                    json!({
                        "percent": percent,
                        "transferred": transferred,
                        "total": total,
                        "bytesPerSecond": bps
                    }),
                );
            }
        }
        drop(file);
        if let Err(err) = validate_pe_installer(&tmp_path) {
            let _ = fs::remove_file(&tmp_path);
            return Err(err);
        }
        if dest_path.exists() {
            let _ = fs::remove_file(&dest_path);
        }
        fs::rename(&tmp_path, &dest_path).map_err(|e| e.to_string())?;

        let flag_data = json!({
            "version": release.version,
            "installerPath": dest_path.to_string_lossy().to_string()
        });
        let _ = fs::write(&flag_path, flag_data.to_string());

        let _ = app.emit("app:updateDownloaded", json!({ "version": release.version }));
        Ok(())
    }
    .await;

    state.app_update_downloading.store(false, Ordering::SeqCst);

    Ok(match result {
        Ok(()) => json!({ "success": true }),
        Err(err) => {
            let _ = app.emit("app:updateError", err.clone());
            json!({ "success": false, "error": err })
        }
    })
}

#[tauri::command]
pub fn updater_install_app(app: AppHandle, state: State<'_, AppState>) -> Value {
    if cfg!(debug_assertions) {
        let _ = app.emit("app:updateError", "DEV_MODE_ERROR");
        return json!({ "success": false, "error": "DEV_MODE_ERROR" });
    }

    if state.app_update_installing.swap(true, Ordering::SeqCst) {
        return json!({ "success": true });
    }

    let flag_path = user_data_dir().join("pending-update.json");
    let installer_path = fs::read_to_string(&flag_path)
        .ok()
        .and_then(|c| serde_json::from_str::<Value>(&c).ok())
        .and_then(|v| v.get("installerPath").and_then(|p| p.as_str()).map(String::from));

    let Some(inst) = installer_path else {
        state.app_update_installing.store(false, Ordering::SeqCst);
        let msg = "Downloaded installer not found";
        let _ = app.emit("app:updateError", msg);
        return json!({ "success": false, "error": msg });
    };

    if let Err(msg) = validate_pe_installer(Path::new(&inst)) {
        state.app_update_installing.store(false, Ordering::SeqCst);
        if flag_path.exists() {
            let _ = fs::remove_file(&flag_path);
        }
        let _ = app.emit("app:updateError", msg.clone());
        return json!({ "success": false, "error": msg });
    }

    if flag_path.exists() {
        let _ = fs::remove_file(&flag_path);
    }

    // Cleanly stop active downloads, conversions, proxy, clipboard watcher & popup before restart
    crate::cleanup_all(&app);

    let current_pid = std::process::id();
    let current_exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let local_installed_exe = dirs::data_local_dir()
        .map(|d| d.join("BitKit").join("bitkit.exe").to_string_lossy().to_string())
        .unwrap_or_default();

    let escape_ps = |s: &str| s.replace('\'', "''");
    let helper_script = format!(
        r#"$ErrorActionPreference = 'SilentlyContinue'
$oldPid = {pid}
$installer = '{installer}'
$currentExe = '{current_exe}'
$localExe = '{local_exe}'
$scriptSelf = $MyInvocation.MyCommand.Path

# 1. Wait cleanly for old BitKit process to exit (prevents file lock errors)
for ($i = 0; $i -lt 100; $i++) {{
    if (-not (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {{ break }}
    if ($i -eq 65) {{ Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue }}
    Start-Sleep -Milliseconds 150
}}
Start-Sleep -Milliseconds 350

# 2. Run silent current-user NSIS installer (zero UAC prompt, zero wizard clicks)
if (Test-Path $installer) {{
    Start-Process -FilePath $installer -ArgumentList '/S' -Wait
    Remove-Item -Path $installer -Force -ErrorAction SilentlyContinue
}}

# 3. Seamless auto-relaunch (Discord / Steam style)
Start-Sleep -Milliseconds 300
if ($currentExe -and (Test-Path $currentExe)) {{
    Start-Process -FilePath $currentExe
}} elseif ($localExe -and (Test-Path $localExe)) {{
    Start-Process -FilePath $localExe
}}

if ($scriptSelf -and (Test-Path $scriptSelf)) {{
    Remove-Item -Path $scriptSelf -Force -ErrorAction SilentlyContinue
}}
"#,
        pid = current_pid,
        installer = escape_ps(&inst),
        current_exe = escape_ps(&current_exe),
        local_exe = escape_ps(&local_installed_exe),
    );

    let helper_path = std::env::temp_dir().join("bitkit_apply_update.ps1");
    if let Err(e) = fs::write(&helper_path, helper_script) {
        state.app_update_installing.store(false, Ordering::SeqCst);
        let msg = e.to_string();
        let _ = app.emit("app:updateError", msg.clone());
        return json!({ "success": false, "error": msg });
    }

    match hidden_std_command("powershell")
        .args([
            "-ExecutionPolicy",
            "Bypass",
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-File",
            &helper_path.to_string_lossy(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(_) => {
            app.exit(0);
            json!({ "success": true })
        }
        Err(e) => {
            state.app_update_installing.store(false, Ordering::SeqCst);
            let msg = e.to_string();
            let _ = app.emit("app:updateError", msg.clone());
            json!({ "success": false, "error": msg })
        }
    }
}

#[tauri::command]
pub async fn updater_check_ytdlp(app: AppHandle) -> Value {
    let ytdlp = get_bin_path(&app, "yt-dlp.exe");
    let current = get_ytdlp_version(&ytdlp).await;

    match get_latest_github_release("yt-dlp", "yt-dlp").await {
        Ok(latest) => {
            let tag = latest
                .get("tag_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let download_url = latest
                .get("assets")
                .and_then(|v| v.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .find(|a| a.get("name").and_then(|n| n.as_str()) == Some("yt-dlp.exe"))
                })
                .and_then(|a| a.get("browser_download_url"))
                .and_then(|u| u.as_str());

            json!({
                "current": current,
                "latest": tag,
                "updateAvailable": current.as_deref() != Some(tag),
                "downloadUrl": download_url
            })
        }
        Err(e) => json!({
            "current": current,
            "error": e
        }),
    }
}

#[tauri::command]
pub async fn updater_update_ytdlp(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    let ytdlp = get_bin_path(&app, "yt-dlp.exe");
    let backup = Path::new(&format!("{}.backup", ytdlp.to_string_lossy())).to_path_buf();

    if ytdlp.exists() {
        let _ = fs::copy(&ytdlp, &backup);
    }

    state.ytdlp_updating.store(true, Ordering::SeqCst);

    let mut cmd = hidden_tokio_command(&ytdlp);
    cmd.args(["--update", "--ignore-config"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(parent) = ytdlp.parent() {
        if !parent.as_os_str().is_empty() {
            cmd.current_dir(parent);
        }
    }

    let res = tokio::time::timeout(Duration::from_secs(120), cmd.output()).await;
    state.ytdlp_updating.store(false, Ordering::SeqCst);

    Ok(match res {
        Ok(Ok(out)) if out.status.success() => {
            let _ = fs::remove_file(&backup);
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            json!({
                "success": true,
                "output": if !stdout.is_empty() { stdout } else { stderr }
            })
        }
        Ok(Ok(out)) => {
            if backup.exists() && !ytdlp.exists() {
                let _ = fs::copy(&backup, &ytdlp);
            }
            let _ = fs::remove_file(&backup);
            let err_msg = String::from_utf8_lossy(&out.stderr).to_string();
            json!({ "success": false, "error": err_msg })
        }
        Ok(Err(err)) => {
            if backup.exists() && !ytdlp.exists() {
                let _ = fs::copy(&backup, &ytdlp);
            }
            let _ = fs::remove_file(&backup);
            json!({ "success": false, "error": err.to_string() })
        }
        Err(_) => {
            if backup.exists() && !ytdlp.exists() {
                let _ = fs::copy(&backup, &ytdlp);
            }
            let _ = fs::remove_file(&backup);
            json!({ "success": false, "error": "yt-dlp update timed out" })
        }
    })
}

#[tauri::command]
pub async fn updater_check_ffmpeg(app: AppHandle) -> Value {
    let ffmpeg = get_bin_path(&app, "ffmpeg.exe");
    let current = get_ffmpeg_version(&ffmpeg).await;
    json!({ "current": current })
}

#[tauri::command]
pub async fn updater_update_ffmpeg() -> Value {
    let res: Result<(), String> = async {
        let user_bin = user_data_dir().join("bin");
        fs::create_dir_all(&user_bin).map_err(|e| e.to_string())?;

        let latest = get_latest_github_release("BtbN", "FFmpeg-Builds").await?;
        let url = latest
            .get("assets")
            .and_then(|v| v.as_array())
            .and_then(|assets| {
                assets.iter().find(|a| {
                    a.get("name")
                        .and_then(|n| n.as_str())
                        .map(|n| n.ends_with("win64-gpl-shared.zip"))
                        .unwrap_or(false)
                })
            })
            .and_then(|a| a.get("browser_download_url"))
            .and_then(|u| u.as_str())
            .ok_or_else(|| "FFmpeg release not found".to_string())?
            .to_string();

        let temp_zip = std::env::temp_dir().join("bitkit_ffmpeg_update.zip");
        let client = reqwest::Client::builder()
            .user_agent("BitKit")
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(|e| e.to_string())?;

        let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("FFmpeg download failed: HTTP {}", resp.status().as_u16()));
        }

        {
            let mut file = File::create(&temp_zip).map_err(|e| e.to_string())?;
            let mut stream = resp.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let bytes = chunk.map_err(|e| e.to_string())?;
                file.write_all(&bytes).map_err(|e| e.to_string())?;
            }
        }

        // Extract ffmpeg.exe, ffprobe.exe, and shared *.dll libraries cleanly in a blocking thread
        let zip_clone = temp_zip.clone();
        let bin_clone = user_bin.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let file = File::open(&zip_clone).map_err(|e| e.to_string())?;
            let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

            // Remove stale old FFmpeg DLLs first
            if let Ok(existing) = fs::read_dir(&bin_clone) {
                for e in existing.flatten() {
                    if e.file_name()
                        .to_string_lossy()
                        .to_lowercase()
                        .ends_with(".dll")
                    {
                        let _ = fs::remove_file(e.path());
                    }
                }
            }

            for i in 0..archive.len() {
                let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
                if entry.is_dir() {
                    continue;
                }
                let name = entry.name().replace('\\', "/");
                if let Some(bin_rel) = name.split("/bin/").nth(1) {
                    if !bin_rel.contains('/') {
                        let lower = bin_rel.to_lowercase();
                        if lower == "ffmpeg.exe" || lower == "ffprobe.exe" || lower.ends_with(".dll") {
                            let mut out = File::create(bin_clone.join(bin_rel)).map_err(|e| e.to_string())?;
                            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
                        }
                    }
                }
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())??;

        let _ = fs::remove_file(&temp_zip);
        Ok(())
    }
    .await;

    match res {
        Ok(()) => json!({ "success": true, "output": "FFmpeg updated" }),
        Err(e) => json!({ "success": false, "error": e }),
    }
}

#[cfg(test)]
mod tests {
    use super::is_newer_version;

    #[test]
    fn semver_comparison_works() {
        assert!(is_newer_version("v1.2.2", "v1.2.1"));
        assert!(is_newer_version("v2.0.0", "v1.9.9"));
        assert!(!is_newer_version("v1.2.1", "v1.2.1"));
        assert!(!is_newer_version("v1.2.0", "v1.2.1"));
    }
}
