use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn hidden_std_command<S: AsRef<std::ffi::OsStr>>(program: S) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub fn hidden_tokio_command<S: AsRef<std::ffi::OsStr>>(program: S) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Resolves BitKit's persistent user data directory (%APPDATA%\BitKit)
pub fn user_data_dir() -> PathBuf {
    let dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("BitKit");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn downloads_dir() -> PathBuf {
    dirs::download_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn atomic_write_sync(file_path: &Path, data: &str) {
    if let Some(parent) = file_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let tmp_path = PathBuf::from(format!("{}.tmp", file_path.display()));
    if fs::write(&tmp_path, data).is_ok() {
        if fs::rename(&tmp_path, file_path).is_err() {
            // Fallback on Windows if AV briefly locks the target file
            let _ = fs::write(file_path, data);
            let _ = fs::remove_file(&tmp_path);
        }
    } else {
        let _ = fs::write(file_path, data);
    }
}

fn find_source_bin(app: &AppHandle, bin_name: &str) -> Option<PathBuf> {
    // 1. Production bundled resource dir
    if let Ok(res_dir) = app.path().resource_dir() {
        let hidden = res_dir.join("bin").join(format!("{}.hidden", bin_name));
        if hidden.exists() {
            return Some(hidden);
        }
        let prod = res_dir.join("bin").join(bin_name);
        if prod.exists() {
            return Some(prod);
        }
    }

    // 2. Development workspace resources/bin (relative to CARGO_MANIFEST_DIR or cwd)
    let manifest_dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("resources")
        .join("bin")
        .join(bin_name);
    if manifest_dev.exists() {
        return Some(manifest_dev);
    }

    if let Ok(cwd) = std::env::current_dir() {
        let cwd_dev = cwd.join("resources").join("bin").join(bin_name);
        if cwd_dev.exists() {
            return Some(cwd_dev);
        }
        let parent_dev = cwd.join("..").join("resources").join("bin").join(bin_name);
        if parent_dev.exists() {
            return Some(parent_dev);
        }
    }

    None
}

fn find_source_bin_dir(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(res_dir) = app.path().resource_dir() {
        let prod_bin = res_dir.join("bin");
        if prod_bin.is_dir() {
            return Some(prod_bin);
        }
    }

    let manifest_dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("resources")
        .join("bin");
    if manifest_dev.is_dir() {
        return Some(manifest_dev);
    }

    if let Ok(cwd) = std::env::current_dir() {
        let cwd_dev = cwd.join("resources").join("bin");
        if cwd_dev.is_dir() {
            return Some(cwd_dev);
        }
        let parent_dev = cwd.join("..").join("resources").join("bin");
        if parent_dev.is_dir() {
            return Some(parent_dev);
        }
    }

    None
}

/// Syncs bundled binaries (.exe & shared FFmpeg .dlls) into %APPDATA%\BitKit\bin on version change or if missing.
pub fn sync_bundled_bins(app: &AppHandle) {
    let user_bin_dir = user_data_dir().join("bin");
    let _ = fs::create_dir_all(&user_bin_dir);

    let version_file = user_bin_dir.join("app_version.txt");
    let saved_version = fs::read_to_string(&version_file).unwrap_or_default();
    let current_version = app.package_info().version.to_string();
    let needs_update = saved_version.trim() != current_version;

    let mut any_copied = false;

    if let Some(src_dir) = find_source_bin_dir(app) {
        if let Ok(entries) = fs::read_dir(&src_dir) {
            let mut source_has_dlls = false;
            let mut items: Vec<(PathBuf, String)> = Vec::new();

            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let raw_name = entry.file_name().to_string_lossy().to_string();
                let target_name = raw_name
                    .strip_suffix(".hidden")
                    .unwrap_or(&raw_name)
                    .to_string();
                let lower = target_name.to_lowercase();
                if lower.ends_with(".exe") || lower.ends_with(".dll") {
                    if lower.ends_with(".dll") {
                        source_has_dlls = true;
                    }
                    items.push((path, target_name));
                }
            }

            // If updating to a new version with shared DLLs, remove stale old DLLs first
            if needs_update && source_has_dlls {
                if let Ok(existing) = fs::read_dir(&user_bin_dir) {
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
            }

            for (src_path, target_name) in items {
                let dest = user_bin_dir.join(&target_name);
                if needs_update || !dest.exists() {
                    if fs::copy(&src_path, &dest).is_ok() {
                        any_copied = true;
                    }
                }
            }
        }
    }

    if needs_update && any_copied {
        let _ = fs::write(&version_file, &current_version);
    }
}

pub fn get_bin_path(app: &AppHandle, bin_name: &str) -> PathBuf {
    let user_bin_dir = user_data_dir().join("bin");
    let _ = fs::create_dir_all(&user_bin_dir);
    let user_bin_path = user_bin_dir.join(bin_name);

    if !user_bin_path.exists() {
        if let Some(src) = find_source_bin(app, bin_name) {
            let _ = fs::copy(&src, &user_bin_path);
        }
    }

    if user_bin_path.exists() {
        return user_bin_path;
    }

    if let Some(src) = find_source_bin(app, bin_name) {
        return src;
    }

    PathBuf::from(bin_name)
}

pub fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = hidden_std_command("taskkill")
            .args(["/f", "/t", "/pid", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .spawn();
    }
}
