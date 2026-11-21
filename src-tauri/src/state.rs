use crate::proxy::ProxyController;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex};

pub struct ActiveDownload {
    pub pid: Option<u32>,
    pub known_files: Arc<Mutex<Vec<String>>>,
}

pub struct ActiveConversion {
    pub pid: Option<u32>,
    pub is_cancelled: bool,
    pub input_path: String,
    pub output_path: String,
}

pub struct ConversionJob {
    pub id: String,
    pub input_path: String,
    pub requested_output_path: String,
    pub options: Value,
}

pub struct ConversionManager {
    pub active: HashMap<String, ActiveConversion>,
    pub queue: VecDeque<ConversionJob>,
    pub reserved_paths: HashSet<String>,
    pub active_count: usize,
    pub max_concurrent: usize,
    pub cpu_cores: usize,
}

impl ConversionManager {
    pub fn new() -> Self {
        let cpu_cores = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        let max_concurrent = (cpu_cores / 4).clamp(1, 8);
        Self {
            active: HashMap::new(),
            queue: VecDeque::new(),
            reserved_paths: HashSet::new(),
            active_count: 0,
            max_concurrent,
            cpu_cores,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub vendor: String,
    pub name: String,
    pub all: Vec<String>,
    pub available: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct CachedRelease {
    pub version: String,
    pub installer_url: Option<String>,
    pub installer_name: Option<String>,
}

pub struct AppState {
    pub proxy: Arc<ProxyController>,
    pub active_downloads: Arc<Mutex<HashMap<String, ActiveDownload>>>,
    pub cancelled_downloads: Arc<Mutex<HashSet<String>>>,
    pub conversions: Arc<Mutex<ConversionManager>>,
    pub gpu_cache: Arc<tokio::sync::Mutex<Option<GpuInfo>>>,
    pub ytdlp_updating: Arc<AtomicBool>,
    pub clipboard_watching: Arc<AtomicBool>,
    pub clipboard_gen: Arc<AtomicU64>,
    pub popup_hide_gen: Arc<AtomicU64>,
    pub popup_last_data: Arc<Mutex<Option<Value>>>,
    pub app_update_downloading: Arc<AtomicBool>,
    pub app_update_installing: Arc<AtomicBool>,
    pub latest_release: Arc<tokio::sync::Mutex<Option<CachedRelease>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            proxy: ProxyController::new(),
            active_downloads: Arc::new(Mutex::new(HashMap::new())),
            cancelled_downloads: Arc::new(Mutex::new(HashSet::new())),
            conversions: Arc::new(Mutex::new(ConversionManager::new())),
            gpu_cache: Arc::new(tokio::sync::Mutex::new(None)),
            ytdlp_updating: Arc::new(AtomicBool::new(false)),
            clipboard_watching: Arc::new(AtomicBool::new(false)),
            clipboard_gen: Arc::new(AtomicU64::new(0)),
            popup_hide_gen: Arc::new(AtomicU64::new(0)),
            popup_last_data: Arc::new(Mutex::new(None)),
            app_update_downloading: Arc::new(AtomicBool::new(false)),
            app_update_installing: Arc::new(AtomicBool::new(false)),
            latest_release: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }
}
