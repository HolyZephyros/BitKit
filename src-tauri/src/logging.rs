use crate::paths::user_data_dir;
use chrono::Local;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;

static LOG_LOCK: Mutex<()> = Mutex::new(());

pub fn write_log(level: &str, message: &str) {
    let _guard = LOG_LOCK.lock().ok();
    let log_dir = user_data_dir().join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_path = log_dir.join("bitkit-error.log");

    let now = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{}] [{}] {}\n", now, level, message);

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let _ = file.write_all(line.as_bytes());
    }
}
