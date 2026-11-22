use crate::paths::{
    acquire_bin_sync_lock, atomic_replace_file, get_bin_path, hidden_std_command,
    hidden_tokio_command, is_valid_pe_file, user_data_dir, MIN_VALID_PE_SIZE,
};
use crate::state::{AppState, CachedRelease};
use futures_util::StreamExt;
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

const UPDATER_ICON_PNG: &[u8] = include_bytes!("../../icons/128x128.png");

#[derive(Debug, Deserialize, Default)]
pub struct UpdateUiStrings {
    pub version: Option<String>,
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub restarting: Option<String>,
}

fn encode_base64_utf8(input: &str) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(((bytes.len() + 2) / 3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((triple >> 6) & 0x3F) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(triple & 0x3F) as usize] as char
        } else {
            '='
        });
    }
    out
}

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
    if !path.exists() {
        return Err("Downloaded installer not found".to_string());
    }
    if !is_valid_pe_file(path, 1_000_000) {
        return Err("Downloaded installer is incomplete or corrupted".to_string());
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
        if total > 0 && transferred != total {
            let _ = fs::remove_file(&tmp_path);
            return Err("Downloaded installer is incomplete (connection interrupted)".to_string());
        }
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
pub fn updater_install_app(
    app: AppHandle,
    state: State<'_, AppState>,
    ui: Option<UpdateUiStrings>,
) -> Value {
    if cfg!(debug_assertions) {
        let _ = app.emit("app:updateError", "DEV_MODE_ERROR");
        return json!({ "success": false, "error": "DEV_MODE_ERROR" });
    }

    if state.app_update_installing.swap(true, Ordering::SeqCst) {
        return json!({ "success": true });
    }

    let flag_path = user_data_dir().join("pending-update.json");
    let flag_json = fs::read_to_string(&flag_path)
        .ok()
        .and_then(|c| serde_json::from_str::<Value>(&c).ok());

    let installer_path = flag_json
        .as_ref()
        .and_then(|v| v.get("installerPath").and_then(|p| p.as_str()).map(String::from));
    let flag_version = flag_json
        .as_ref()
        .and_then(|v| v.get("version").and_then(|p| p.as_str()).map(String::from))
        .unwrap_or_default();

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

    let ui_cfg = ui.unwrap_or_default();
    let ver_label = ui_cfg
        .version
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(flag_version);
    let title_str = ui_cfg
        .title
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            if ver_label.is_empty() {
                "Updating BitKit".to_string()
            } else {
                format!("Installing BitKit {}", ver_label)
            }
        });
    let sub_str = ui_cfg
        .subtitle
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Please wait, BitKit will restart automatically...".to_string());
    let restart_str = ui_cfg
        .restarting
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Restarting BitKit...".to_string());

    let icon_path = std::env::temp_dir().join("bitkit_updater_icon.png");
    let _ = fs::write(&icon_path, UPDATER_ICON_PNG);

    let current_pid = std::process::id();
    let current_exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let local_installed_exe = dirs::data_local_dir()
        .map(|d| d.join("BitKit").join("bitkit.exe").to_string_lossy().to_string())
        .unwrap_or_default();
    let user_bin_dir = user_data_dir().join("bin").to_string_lossy().to_string();

    let escape_ps = |s: &str| s.replace('\'', "''");
    let helper_script = format!(
        r##"$ErrorActionPreference = 'SilentlyContinue'
$oldPid = {pid}
$installer = '{installer}'
$currentExe = '{current_exe}'
$localExe = '{local_exe}'
$userBinDir = '{user_bin_dir}'
$iconPath = '{icon_path}'
$scriptSelf = $MyInvocation.MyCommand.Path

$titleText = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{title_b64}'))
$subText = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{sub_b64}'))
$restartText = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{restart_b64}'))

$mutexCreated = $false
$updateMutex = $null
try {{
    $updateMutex = New-Object System.Threading.Mutex($true, 'Local\BitKit_UpdateInProgress_Mutex', [ref]$mutexCreated)
}} catch {{}}

function Release-UpdateLock {{
    if ($script:updateMutex) {{
        if ($script:mutexCreated) {{
            try {{ $script:updateMutex.ReleaseMutex() }} catch {{}}
        }}
        try {{ $script:updateMutex.Dispose() }} catch {{}}
        $script:updateMutex = $null
    }}
}}

function Stop-BitKitBinProcesses {{
    $names = @('ffmpeg', 'ffprobe', 'yt-dlp', 'deno')
    foreach ($n in $names) {{
        Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object {{
            try {{
                if ($_.Path -and $_.Path.StartsWith($userBinDir, [System.StringComparison]::OrdinalIgnoreCase)) {{
                    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
                }}
            }} catch {{}}
        }}
    }}
}}

function Resolve-TargetExe {{
    if ($currentExe -and (Test-Path $currentExe)) {{ return $currentExe }}
    if ($localExe -and (Test-Path $localExe)) {{ return $localExe }}
    return $null
}}

$splashShown = $false
try {{
    Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
    $xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        Title="BitKit Updater" Width="364" Height="212"
        WindowStartupLocation="CenterScreen" WindowStyle="None"
        AllowsTransparency="True" Background="Transparent" Topmost="True"
        ResizeMode="NoResize" ShowInTaskbar="True">
  <Border Background="#0E0E16" BorderBrush="#262638" BorderThickness="1" CornerRadius="14" Margin="8">
    <Border.Effect>
      <DropShadowEffect Color="#000000" BlurRadius="18" ShadowDepth="0" Opacity="0.65"/>
    </Border.Effect>
    <StackPanel VerticalAlignment="Center" HorizontalAlignment="Center" Margin="26,20">
      <Image Name="LogoImg" Width="48" Height="48" HorizontalAlignment="Center" Margin="0,0,0,12" RenderOptions.BitmapScalingMode="HighQuality"/>
      <TextBlock Name="TitleBlock" Text="BitKit" Foreground="#E2E8F0" FontFamily="Segoe UI" FontSize="15" FontWeight="Bold" HorizontalAlignment="Center" TextAlignment="Center"/>
      <TextBlock Name="SubBlock" Text="Updating..." Foreground="#94A3B8" FontFamily="Segoe UI" FontSize="12" HorizontalAlignment="Center" TextAlignment="Center" TextWrapping="Wrap" Margin="0,6,0,18"/>
      <Border Width="272" Height="6" CornerRadius="3" Background="#1C1C2C" ClipToBounds="True">
        <ProgressBar Name="Bar" Width="272" Height="6" IsIndeterminate="True" Foreground="#0891B2" Background="#1C1C2C" BorderThickness="0"/>
      </Border>
    </StackPanel>
  </Border>
</Window>
"@
    $reader = New-Object System.Xml.XmlNodeReader ([xml]$xaml)
    $win = [Windows.Markup.XamlReader]::Load($reader)
    $win.FindName('TitleBlock').Text = $titleText
    $subBlock = $win.FindName('SubBlock')
    $subBlock.Text = $subText

    if ($iconPath -and (Test-Path $iconPath)) {{
        try {{
            $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
            $bmp.BeginInit()
            $bmp.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
            $bmp.UriSource = New-Object Uri($iconPath)
            $bmp.EndInit()
            $bmp.Freeze()
            $win.FindName('LogoImg').Source = $bmp
        }} catch {{}}
    }}

    $win.Add_MouseLeftButtonDown({{ try {{ $win.DragMove() }} catch {{}} }})

    $state = @{{
        Step = 0
        Ticks = 0
        InstProc = $null
        NewProc = $null
    }}

    $timer = New-Object System.Windows.Threading.DispatcherTimer
    $timer.Interval = [TimeSpan]::FromMilliseconds(100)
    $timer.Add_Tick({{
        $state.Ticks++
        switch ($state.Step) {{
            0 {{
                # Wait cleanly for old BitKit process to exit
                $alive = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
                if (-not $alive) {{
                    Stop-BitKitBinProcesses
                    $state.Step = 1
                    $state.Ticks = 0
                }} elseif ($state.Ticks -ge 60) {{
                    Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
                    Stop-BitKitBinProcesses
                    $state.Step = 1
                    $state.Ticks = 0
                }}
            }}
            1 {{
                # Wait 200ms after exit so file handles settle, then run silent NSIS installer
                if ($state.Ticks -lt 2) {{ return }}
                if ($installer -and (Test-Path $installer)) {{
                    $state.InstProc = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru
                    $state.Step = 2
                    $state.Ticks = 0
                }} else {{
                    $state.Step = 3
                    $state.Ticks = 0
                }}
            }}
            2 {{
                # Wait for silent NSIS installer without blocking WPF animations
                if ($state.InstProc -and -not $state.InstProc.HasExited) {{ return }}
                if ($installer -and (Test-Path $installer)) {{
                    Remove-Item -Path $installer -Force -ErrorAction SilentlyContinue
                }}
                $subBlock.Text = $restartText
                Release-UpdateLock
                $state.Step = 3
                $state.Ticks = 0
            }}
            3 {{
                # Launch updated BitKit cleanly after mutex release
                if ($state.Ticks -lt 2) {{ return }}
                Release-UpdateLock
                $exe = Resolve-TargetExe
                if ($exe) {{
                    $state.NewProc = Start-Process -FilePath $exe -PassThru
                    $state.Step = 4
                    $state.Ticks = 0
                }} else {{
                    $timer.Stop()
                    $win.Close()
                }}
            }}
            4 {{
                # Keep splash visible until the new BitKit main window appears (seamless Discord handoff)
                $ready = $false
                if ($state.NewProc) {{
                    try {{
                        $state.NewProc.Refresh()
                        if ($state.NewProc.HasExited -or $state.NewProc.MainWindowHandle -ne [IntPtr]::Zero) {{
                            $ready = $true
                        }}
                    }} catch {{ $ready = $true }}
                }} else {{
                    $ready = $true
                }}
                if ($ready -or $state.Ticks -ge 50) {{
                    $timer.Stop()
                    $win.Close()
                }}
            }}
        }}
    }})
    $timer.Start()
    $splashShown = $true
    $null = $win.ShowDialog()
}} catch {{
    $splashShown = $false
}} finally {{
    if (-not $splashShown) {{
        # Headless fallback if WPF is unavailable on this Windows build
        for ($i = 0; $i -lt 80; $i++) {{
            if (-not (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {{ break }}
            if ($i -eq 55) {{ Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue }}
            Start-Sleep -Milliseconds 120
        }}
        Stop-BitKitBinProcesses
        Start-Sleep -Milliseconds 250
        if ($installer -and (Test-Path $installer)) {{
            Start-Process -FilePath $installer -ArgumentList '/S' -Wait
            Remove-Item -Path $installer -Force -ErrorAction SilentlyContinue
        }}
        Release-UpdateLock
        Start-Sleep -Milliseconds 250
        $exe = Resolve-TargetExe
        if ($exe) {{ Start-Process -FilePath $exe }}
    }} else {{
        Release-UpdateLock
    }}

    if ($iconPath -and (Test-Path $iconPath)) {{
        Remove-Item -Path $iconPath -Force -ErrorAction SilentlyContinue
    }}
    if ($scriptSelf -and (Test-Path $scriptSelf)) {{
        Remove-Item -Path $scriptSelf -Force -ErrorAction SilentlyContinue
    }}
}}
"##,
        pid = current_pid,
        installer = escape_ps(&inst),
        current_exe = escape_ps(&current_exe),
        local_exe = escape_ps(&local_installed_exe),
        user_bin_dir = escape_ps(&user_bin_dir),
        icon_path = escape_ps(&icon_path.to_string_lossy()),
        title_b64 = encode_base64_utf8(&title_str),
        sub_b64 = encode_base64_utf8(&sub_str),
        restart_b64 = encode_base64_utf8(&restart_str),
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
            "-STA",
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
            // Brief handoff delay so the Topmost WPF splash appears before BitKit closes underneath
            let app_exit = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(500));
                app_exit.exit(0);
            });
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

        // Extract ffmpeg.exe, ffprobe.exe, and shared *.dll libraries atomically via staging dir
        let zip_clone = temp_zip.clone();
        let bin_clone = user_bin.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let _sync_lock = acquire_bin_sync_lock();
            let staging_dir = bin_clone.join(".ffmpeg_staging");
            if staging_dir.exists() {
                let _ = fs::remove_dir_all(&staging_dir);
            }
            fs::create_dir_all(&staging_dir).map_err(|e| e.to_string())?;

            let result = (|| -> Result<(), String> {
                let file = File::open(&zip_clone).map_err(|e| e.to_string())?;
                let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
                let mut staged_files: Vec<String> = Vec::new();
                let mut new_dlls: HashSet<String> = HashSet::new();

                for i in 0..archive.len() {
                    let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
                    if entry.is_dir() {
                        continue;
                    }
                    let name = entry.name().replace('\\', "/");
                    if let Some(bin_rel) = name.split("/bin/").nth(1) {
                        if !bin_rel.contains('/') {
                            let lower = bin_rel.to_lowercase();
                            if lower == "ffmpeg.exe"
                                || lower == "ffprobe.exe"
                                || lower.ends_with(".dll")
                            {
                                let staged_path = staging_dir.join(bin_rel);
                                {
                                    let mut out =
                                        File::create(&staged_path).map_err(|e| e.to_string())?;
                                    std::io::copy(&mut entry, &mut out)
                                        .map_err(|e| e.to_string())?;
                                }
                                if !is_valid_pe_file(&staged_path, MIN_VALID_PE_SIZE) {
                                    return Err(format!(
                                        "Extracted binary failed PE integrity check: {}",
                                        bin_rel
                                    ));
                                }
                                if lower.ends_with(".dll") {
                                    new_dlls.insert(lower);
                                }
                                staged_files.push(bin_rel.to_string());
                            }
                        }
                    }
                }

                if !staged_files.iter().any(|f| f.eq_ignore_ascii_case("ffmpeg.exe")) {
                    return Err("FFmpeg archive missing ffmpeg.exe".to_string());
                }

                // Atomically move validated binaries into %APPDATA%\BitKit\bin
                for rel in &staged_files {
                    let src = staging_dir.join(rel);
                    let dest = bin_clone.join(rel);
                    atomic_replace_file(&src, &dest).map_err(|e| e.to_string())?;
                }

                // Only after all new binaries are cleanly in place, remove stale old DLLs
                if !new_dlls.is_empty() {
                    if let Ok(existing) = fs::read_dir(&bin_clone) {
                        for e in existing.flatten() {
                            let lower = e.file_name().to_string_lossy().to_lowercase();
                            if lower.ends_with(".dll") && !new_dlls.contains(&lower) {
                                let _ = fs::remove_file(e.path());
                            }
                        }
                    }
                }

                let _ = fs::write(bin_clone.join("ffmpeg_custom.flag"), "1");
                Ok(())
            })();

            let _ = fs::remove_dir_all(&staging_dir);
            result
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
    use super::{encode_base64_utf8, is_newer_version};

    #[test]
    fn semver_comparison_works() {
        assert!(is_newer_version("v1.2.2", "v1.2.1"));
        assert!(is_newer_version("v2.0.0", "v1.9.9"));
        assert!(!is_newer_version("v1.2.1", "v1.2.1"));
        assert!(!is_newer_version("v1.2.0", "v1.2.1"));
    }

    #[test]
    fn base64_utf8_encodes_turkish_cleanly() {
        assert_eq!(encode_base64_utf8("BitKit"), "Qml0S2l0");
        assert_eq!(
            encode_base64_utf8("BitKit v2.0.2 Kuruluyor"),
            "Qml0S2l0IHYyLjAuMiBLdXJ1bHV5b3I="
        );
        assert_eq!(
            encode_base64_utf8("Lütfen bekleyin, otomatik yeniden açılacak..."),
            "TMO8dGZlbiBiZWtsZXlpbiwgb3RvbWF0aWsgeWVuaWRlbiBhw6fEsWxhY2FrLi4u"
        );
    }
}
