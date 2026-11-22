use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub const MIN_VALID_PE_SIZE: u64 = 16_384;

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

#[cfg(windows)]
fn to_wide_null(s: &std::ffi::OsStr) -> Vec<u16> {
    s.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
mod win_sync {
    use super::to_wide_null;
    use std::ffi::OsStr;
    use std::path::Path;

    const SYNCHRONIZE: u32 = 0x0010_0000;
    const WAIT_OBJECT_0: u32 = 0x0000_0000;
    const WAIT_ABANDONED: u32 = 0x0000_0080;
    const WAIT_TIMEOUT: u32 = 0x0000_0102;
    const ERROR_ALREADY_EXISTS: u32 = 183;
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    const SW_RESTORE: i32 = 9;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(
            lp_mutex_attributes: *const std::ffi::c_void,
            b_initial_owner: i32,
            lp_name: *const u16,
        ) -> *mut std::ffi::c_void;
        fn OpenMutexW(
            dw_desired_access: u32,
            b_inherit_handle: i32,
            lp_name: *const u16,
        ) -> *mut std::ffi::c_void;
        fn WaitForSingleObject(h_handle: *mut std::ffi::c_void, dw_milliseconds: u32) -> u32;
        fn ReleaseMutex(h_mutex: *mut std::ffi::c_void) -> i32;
        fn CloseHandle(h_object: *mut std::ffi::c_void) -> i32;
        fn GetLastError() -> u32;
        fn MoveFileExW(
            lp_existing_file_name: *const u16,
            lp_new_file_name: *const u16,
            dw_flags: u32,
        ) -> i32;
    }

    #[link(name = "user32")]
    extern "system" {
        fn FindWindowW(
            lp_class_name: *const u16,
            lp_window_name: *const u16,
        ) -> *mut std::ffi::c_void;
        fn ShowWindow(h_wnd: *mut std::ffi::c_void, n_cmd_show: i32) -> i32;
        fn SetForegroundWindow(h_wnd: *mut std::ffi::c_void) -> i32;
    }

    pub struct NamedMutex {
        handle: *mut std::ffi::c_void,
        owns_lock: bool,
    }

    unsafe impl Send for NamedMutex {}

    impl Drop for NamedMutex {
        fn drop(&mut self) {
            if !self.handle.is_null() {
                unsafe {
                    if self.owns_lock {
                        let _ = ReleaseMutex(self.handle);
                    }
                    let _ = CloseHandle(self.handle);
                }
                self.handle = std::ptr::null_mut();
            }
        }
    }

    pub fn focus_window_by_title(title: &str) {
        let wide = to_wide_null(OsStr::new(title));
        unsafe {
            let hwnd = FindWindowW(std::ptr::null(), wide.as_ptr());
            if !hwnd.is_null() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
                let _ = SetForegroundWindow(hwnd);
            }
        }
    }

    pub fn is_mutex_held(name: &str) -> bool {
        let wide = to_wide_null(OsStr::new(name));
        unsafe {
            let handle = OpenMutexW(SYNCHRONIZE, 0, wide.as_ptr());
            if handle.is_null() {
                return false;
            }
            let wait = WaitForSingleObject(handle, 0);
            if wait == WAIT_OBJECT_0 || wait == WAIT_ABANDONED {
                let _ = ReleaseMutex(handle);
                let _ = CloseHandle(handle);
                false
            } else {
                let _ = CloseHandle(handle);
                wait == WAIT_TIMEOUT
            }
        }
    }

    pub fn try_create_single_instance(name: &str) -> Option<NamedMutex> {
        let wide = to_wide_null(OsStr::new(name));
        unsafe {
            let handle = CreateMutexW(std::ptr::null(), 0, wide.as_ptr());
            if handle.is_null() {
                return None;
            }
            if GetLastError() == ERROR_ALREADY_EXISTS {
                let _ = CloseHandle(handle);
                return None;
            }
            Some(NamedMutex {
                handle,
                owns_lock: false,
            })
        }
    }

    pub fn lock_named_mutex(name: &str, timeout_ms: u32) -> Option<NamedMutex> {
        let wide = to_wide_null(OsStr::new(name));
        unsafe {
            let handle = CreateMutexW(std::ptr::null(), 0, wide.as_ptr());
            if handle.is_null() {
                return None;
            }
            let wait = WaitForSingleObject(handle, timeout_ms);
            if wait == WAIT_OBJECT_0 || wait == WAIT_ABANDONED {
                Some(NamedMutex {
                    handle,
                    owns_lock: true,
                })
            } else {
                let _ = CloseHandle(handle);
                None
            }
        }
    }

    pub fn move_file_replace(src: &Path, dest: &Path) -> std::io::Result<()> {
        let src_w = to_wide_null(src.as_os_str());
        let dest_w = to_wide_null(dest.as_os_str());
        let ok = unsafe {
            MoveFileExW(
                src_w.as_ptr(),
                dest_w.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if ok != 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error())
        }
    }
}

#[cfg(windows)]
pub use win_sync::NamedMutex;

#[cfg(not(windows))]
pub struct NamedMutex;

/// Returns true if the external BitKit updater splash/installer is actively installing an update.
pub fn is_update_in_progress() -> bool {
    #[cfg(windows)]
    {
        if win_sync::is_mutex_held("Local\\BitKit_UpdateInProgress_Mutex") {
            win_sync::focus_window_by_title("BitKit Updater");
            return true;
        }
    }
    false
}

/// Ensures only one BitKit instance runs at a time; focuses the existing window if already open.
pub fn acquire_single_instance() -> Option<NamedMutex> {
    if std::env::args().any(|a| a == "--allow-multiple") {
        return Some(
            #[cfg(windows)]
            {
                let unique = format!("Local\\BitKit_AllowMulti_{}", std::process::id());
                win_sync::try_create_single_instance(&unique)?
            },
            #[cfg(not(windows))]
            NamedMutex,
        );
    }

    #[cfg(windows)]
    {
        if let Some(guard) = win_sync::try_create_single_instance("Local\\BitKit_SingleInstance_Mutex") {
            Some(guard)
        } else {
            win_sync::focus_window_by_title("BitKit");
            None
        }
    }
    #[cfg(not(windows))]
    {
        Some(NamedMutex)
    }
}

/// Serializes writes to %APPDATA%\BitKit\bin across processes and threads.
pub fn acquire_bin_sync_lock() -> Option<NamedMutex> {
    #[cfg(windows)]
    {
        win_sync::lock_named_mutex("Local\\BitKit_BinSync_Mutex", 30_000)
    }
    #[cfg(not(windows))]
    {
        Some(NamedMutex)
    }
}

/// Fast (<0.1ms) Windows PE header & section-bounds validator.
/// Catches 0-byte, truncated, or corrupted .exe/.dll binaries (prevents Windows 0xc0000020 errors).
pub fn is_valid_pe_file(path: &Path, min_size: u64) -> bool {
    let Ok(mut file) = File::open(path) else {
        return false;
    };
    let Ok(meta) = file.metadata() else {
        return false;
    };
    let file_len = meta.len();
    if file_len < min_size || file_len < 128 {
        return false;
    }

    let mut dos = [0u8; 64];
    if file.read_exact(&mut dos).is_err() {
        return false;
    }
    if &dos[0..2] != b"MZ" {
        return false;
    }

    let pe_offset = u32::from_le_bytes([dos[60], dos[61], dos[62], dos[63]]) as u64;
    if pe_offset < 64 || pe_offset.saturating_add(24) > file_len {
        return false;
    }

    if file.seek(SeekFrom::Start(pe_offset)).is_err() {
        return false;
    }
    let mut coff = [0u8; 24];
    if file.read_exact(&mut coff).is_err() {
        return false;
    }
    if &coff[0..4] != b"PE\0\0" {
        return false;
    }

    let num_sections = u16::from_le_bytes([coff[6], coff[7]]) as usize;
    let opt_header_size = u16::from_le_bytes([coff[20], coff[21]]) as u64;
    if num_sections == 0 || num_sections > 128 {
        return false;
    }

    let sections_offset = pe_offset.saturating_add(24).saturating_add(opt_header_size);
    let sections_bytes = (num_sections as u64).saturating_mul(40);
    if sections_offset.saturating_add(sections_bytes) > file_len {
        return false;
    }

    if file.seek(SeekFrom::Start(sections_offset)).is_err() {
        return false;
    }
    let mut sec_buf = vec![0u8; sections_bytes as usize];
    if file.read_exact(&mut sec_buf).is_err() {
        return false;
    }

    for chunk in sec_buf.chunks_exact(40) {
        let size_of_raw_data = u32::from_le_bytes([chunk[16], chunk[17], chunk[18], chunk[19]]) as u64;
        let ptr_to_raw_data = u32::from_le_bytes([chunk[20], chunk[21], chunk[22], chunk[23]]) as u64;
        if size_of_raw_data > 0 && ptr_to_raw_data > 0 {
            if ptr_to_raw_data.saturating_add(size_of_raw_data) > file_len {
                return false;
            }
        }
    }

    true
}

/// Atomically replaces `dest` with `tmp` (with short retry loop for Windows Defender scan locks).
pub fn atomic_replace_file(tmp: &Path, dest: &Path) -> std::io::Result<()> {
    let mut last_err = None;
    for attempt in 0..8 {
        #[cfg(windows)]
        let res = win_sync::move_file_replace(tmp, dest);
        #[cfg(not(windows))]
        let res = fs::rename(tmp, dest);

        match res {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = Some(e);
                if attempt < 7 {
                    std::thread::sleep(Duration::from_millis(120));
                }
            }
        }
    }
    Err(last_err.unwrap_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, "replace failed")))
}

/// Atomically copies a PE binary (.exe / .dll) via sibling .tmp + size & PE integrity verification.
pub fn atomic_copy_pe(src: &Path, dest: &Path) -> std::io::Result<()> {
    let src_len = fs::metadata(src)?.len();
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }

    let tmp_name = format!(
        "{}.{}.tmp",
        dest.file_name().and_then(|n| n.to_str()).unwrap_or("bin"),
        std::process::id()
    );
    let tmp_path = dest.with_file_name(tmp_name);

    let copy_res = (|| -> std::io::Result<()> {
        let copied = fs::copy(src, &tmp_path)?;
        if copied != src_len || !is_valid_pe_file(&tmp_path, MIN_VALID_PE_SIZE) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Copied binary failed integrity check: {}", dest.display()),
            ));
        }
        atomic_replace_file(&tmp_path, dest)
    })();

    if copy_res.is_err() {
        let _ = fs::remove_file(&tmp_path);
    }
    copy_res
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

/// Atomically syncs & self-heals bundled binaries (.exe & shared FFmpeg .dlls) into %APPDATA%\BitKit\bin.
/// - Skips already-healthy matching files (fast startup, no redundant 318 MB copy on minor updates).
/// - Automatically detects & repairs missing, 0-byte, truncated, or corrupted PE files on every launch.
pub fn sync_bundled_bins(app: &AppHandle) {
    let _sync_lock = acquire_bin_sync_lock();

    let user_bin_dir = user_data_dir().join("bin");
    let _ = fs::create_dir_all(&user_bin_dir);

    // Clean up any abandoned .tmp files from interrupted copies
    if let Ok(existing) = fs::read_dir(&user_bin_dir) {
        for e in existing.flatten() {
            let name = e.file_name().to_string_lossy().to_lowercase();
            if name.ends_with(".tmp") {
                let _ = fs::remove_file(e.path());
            }
        }
    }

    let version_file = user_bin_dir.join("app_version.txt");
    let saved_version = fs::read_to_string(&version_file).unwrap_or_default();
    let current_version = app.package_info().version.to_string();
    let needs_update = saved_version.trim() != current_version;
    let custom_ffmpeg_flag = user_bin_dir.join("ffmpeg_custom.flag");
    let has_custom_ffmpeg = custom_ffmpeg_flag.exists();

    let Some(src_dir) = find_source_bin_dir(app) else {
        return;
    };
    let Ok(entries) = fs::read_dir(&src_dir) else {
        return;
    };

    let mut source_has_dlls = false;
    let mut bundled_dlls: HashSet<String> = HashSet::new();
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
                bundled_dlls.insert(lower);
            }
            items.push((path, target_name));
        }
    }

    let mut all_ok = true;
    let mut synced_bundled_ffmpeg = false;

    for (src_path, target_name) in &items {
        let dest = user_bin_dir.join(target_name);
        let lower = target_name.to_lowercase();
        let is_ytdlp = lower == "yt-dlp.exe";
        let is_ffmpeg_part = lower == "ffmpeg.exe" || lower == "ffprobe.exe" || lower.ends_with(".dll");

        let src_len = fs::metadata(src_path).map(|m| m.len()).unwrap_or(0);
        let dest_len = fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
        let dest_healthy = dest.exists() && is_valid_pe_file(&dest, MIN_VALID_PE_SIZE);

        let should_copy = if !dest_healthy {
            // Always self-heal missing, 0-byte, truncated, or corrupted binaries
            true
        } else if is_ytdlp {
            // Preserve user's auto-updated yt-dlp.exe as long as it's a valid PE executable
            false
        } else if is_ffmpeg_part && has_custom_ffmpeg && !needs_update {
            // Respect user's manual Settings -> Update FFmpeg on same-version restarts
            false
        } else {
            // Only overwrite if bundled file size actually changed (avoids pointless 318 MB recopy)
            dest_len != src_len
        };

        if should_copy {
            if let Err(err) = atomic_copy_pe(src_path, &dest) {
                all_ok = false;
                crate::logging::write_log(
                    "error",
                    &format!("[BitKit:BinSync] Failed to sync {}: {}", target_name, err),
                );
            } else if is_ffmpeg_part {
                synced_bundled_ffmpeg = true;
            }
        }
    }

    if all_ok {
        // Only remove stale old DLLs AFTER all new bundled binaries are verified in place
        if (needs_update || synced_bundled_ffmpeg) && source_has_dlls {
            if let Ok(existing) = fs::read_dir(&user_bin_dir) {
                for e in existing.flatten() {
                    let name_lower = e.file_name().to_string_lossy().to_lowercase();
                    if name_lower.ends_with(".dll") && !bundled_dlls.contains(&name_lower) {
                        let _ = fs::remove_file(e.path());
                    }
                }
            }
            if synced_bundled_ffmpeg && custom_ffmpeg_flag.exists() {
                let _ = fs::remove_file(&custom_ffmpeg_flag);
            }
        }

        if needs_update {
            let _ = fs::write(&version_file, &current_version);
        }
    }
}

pub fn get_bin_path(app: &AppHandle, bin_name: &str) -> PathBuf {
    let user_bin_dir = user_data_dir().join("bin");
    let _ = fs::create_dir_all(&user_bin_dir);
    let user_bin_path = user_bin_dir.join(bin_name);

    if !user_bin_path.exists() || !is_valid_pe_file(&user_bin_path, MIN_VALID_PE_SIZE) {
        let _sync_lock = acquire_bin_sync_lock();
        if !user_bin_path.exists() || !is_valid_pe_file(&user_bin_path, MIN_VALID_PE_SIZE) {
            if let Some(src) = find_source_bin(app, bin_name) {
                let _ = atomic_copy_pe(&src, &user_bin_path);
            }
        }
    }

    if user_bin_path.exists() && is_valid_pe_file(&user_bin_path, MIN_VALID_PE_SIZE) {
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

#[cfg(windows)]
fn decode_win_acp(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        return Some(String::new());
    }
    extern "system" {
        fn MultiByteToWideChar(
            code_page: u32,
            dw_flags: u32,
            lp_multi_byte_str: *const u8,
            cb_multi_byte: i32,
            lp_wide_char_str: *mut u16,
            cch_wide_char: i32,
        ) -> i32;
    }
    const CP_ACP: u32 = 0;
    let len = i32::try_from(bytes.len()).ok()?;
    let wide_len =
        unsafe { MultiByteToWideChar(CP_ACP, 0, bytes.as_ptr(), len, std::ptr::null_mut(), 0) };
    if wide_len <= 0 {
        return None;
    }
    let mut wide = vec![0u16; wide_len as usize];
    let written = unsafe {
        MultiByteToWideChar(
            CP_ACP,
            0,
            bytes.as_ptr(),
            len,
            wide.as_mut_ptr(),
            wide_len,
        )
    };
    if written <= 0 {
        return None;
    }
    wide.truncate(written as usize);
    Some(String::from_utf16_lossy(&wide))
}

/// Decodes bytes emitted by child processes (UTF-8 first, then Windows ANSI code page CP_ACP).
/// Prevents non-UTF8 Windows filenames/titles from breaking stdout pipes (Python Errno 22).
pub fn decode_process_bytes(bytes: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    #[cfg(windows)]
    {
        if let Some(decoded) = decode_win_acp(bytes) {
            return decoded;
        }
    }
    String::from_utf8_lossy(bytes).into_owned()
}

#[cfg(test)]
mod tests {
    use super::{atomic_copy_pe, decode_process_bytes, is_valid_pe_file, MIN_VALID_PE_SIZE};
    use std::fs;

    #[test]
    fn decodes_utf8_and_non_utf8_bytes_without_failing() {
        let utf8 = "Demacia İçin! Öyküsü".as_bytes();
        assert_eq!(decode_process_bytes(utf8), "Demacia İçin! Öyküsü");

        // Exact CP1254 bytes produced by yt-dlp on Windows for "Demacia İçin!"
        let cp1254: &[u8] = &[0x44, 0x65, 0x6d, 0x61, 0x63, 0x69, 0x61, 0x20, 0xdd, 0xe7, 0x69, 0x6e, 0x21];
        let decoded = decode_process_bytes(cp1254);
        assert!(decoded.starts_with("Demacia "));
        assert!(decoded.ends_with("in!"));
        assert!(!decoded.is_empty());
    }

    #[test]
    fn validates_pe_files_and_rejects_truncated_binaries() {
        let current = std::env::current_exe().expect("current_exe");
        assert!(is_valid_pe_file(&current, MIN_VALID_PE_SIZE));

        let temp_dir = std::env::temp_dir().join(format!("bitkit_pe_test_{}", std::process::id()));
        let _ = fs::create_dir_all(&temp_dir);

        // 0-byte file
        let empty = temp_dir.join("empty.dll");
        fs::write(&empty, b"").unwrap();
        assert!(!is_valid_pe_file(&empty, MIN_VALID_PE_SIZE));

        // Garbage non-PE file
        let garbage = temp_dir.join("garbage.dll");
        fs::write(&garbage, vec![0x41u8; 64_000]).unwrap();
        assert!(!is_valid_pe_file(&garbage, MIN_VALID_PE_SIZE));

        // Truncated copy of a real PE binary (simulates interrupted fs::copy -> 0xc0000020)
        let bytes = fs::read(&current).unwrap();
        let half = temp_dir.join("truncated.dll");
        fs::write(&half, &bytes[..bytes.len() / 2]).unwrap();
        assert!(!is_valid_pe_file(&half, MIN_VALID_PE_SIZE));

        // Atomic repair over corrupt target
        atomic_copy_pe(&current, &half).expect("atomic_copy_pe should repair corrupt file");
        assert!(is_valid_pe_file(&half, MIN_VALID_PE_SIZE));
        assert_eq!(fs::metadata(&half).unwrap().len(), bytes.len() as u64);

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
