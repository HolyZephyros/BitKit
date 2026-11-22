// ===== BitKit Tauri v2 Bridge (1:1 window.bitkit API parity) =====

(() => {
  if (window.bitkit || !window.__TAURI__) return;

  const { core, event: tauriEvent } = window.__TAURI__;
  const invoke = (cmd, args) => core.invoke(cmd, args);

  function subscribeEvent(eventName, callback) {
    let unlistenFn = null;
    let cancelled = false;
    tauriEvent
      .listen(eventName, (ev) => {
        if (!cancelled) callback(ev.payload);
      })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlistenFn = fn;
        }
      })
      .catch((err) => console.error(`[BitKit:Bridge] listen ${eventName} failed:`, err));

    return () => {
      cancelled = true;
      if (unlistenFn) {
        unlistenFn();
        unlistenFn = null;
      }
    };
  }

  window.bitkit = {
    window: {
      minimize: () => invoke('window_minimize'),
      maximize: () => invoke('window_maximize'),
      close: () => invoke('window_close'),
      isMaximized: () => invoke('window_is_maximized'),
      show: () => invoke('window_show')
    },

    utils: {
      getPathForFile: (file) => (file && typeof file.path === 'string' ? file.path : '')
    },

    download: {
      analyze: (url, cookiesPath) =>
        invoke('download_analyze', { url, cookiesPath: cookiesPath || null }),
      start: (url, options) =>
        invoke('download_start', { url, options: options || {} }),
      cancel: (id) => invoke('download_cancel', { id }),
      changeRate: (id, rateKB) =>
        invoke('download_change_rate', { id: id || null, rateKb: rateKB ?? 0 }),
      onProgress: (cb) => subscribeEvent('download:progress', cb),
      onComplete: (cb) => subscribeEvent('download:complete', cb),
      onError: (cb) => subscribeEvent('download:error', cb)
    },

    convert: {
      start: (input, output, options) =>
        invoke('convert_start', { input, output, options: options || {} }),
      cancel: (id) => invoke('convert_cancel', { id }),
      getQueueInfo: () => invoke('convert_get_queue_info'),
      onProgress: (cb) => subscribeEvent('convert:progress', cb),
      onComplete: (cb) => subscribeEvent('convert:complete', cb),
      onError: (cb) => subscribeEvent('convert:error', cb)
    },

    media: {
      getInfo: (filePath) => invoke('media_get_info', { filePath })
    },

    file: {
      selectFile: (options) => invoke('file_select', { options: options || {} }),
      selectFiles: (options) => invoke('file_select_multiple', { options: options || {} }),
      selectFolder: () => invoke('file_select_folder'),
      deleteCookies: () => invoke('file_delete_cookies'),
      openPath: (filePath) => invoke('shell_open_path', { filePath }),
      showInFolder: (filePath) => invoke('shell_show_item_in_folder', { filePath })
    },

    fileManager: {
      getUniquePath: (targetPath) => invoke('file_get_unique_path', { targetPath })
    },

    settings: {
      get: () => invoke('settings_get'),
      set: (settings) => invoke('settings_set', { settings })
    },

    history: {
      get: () => invoke('history_get'),
      add: (item) => invoke('history_add', { item }),
      clear: () => invoke('history_clear')
    },

    queue: {
      get: () => invoke('queue_get'),
      save: (queueData) => invoke('queue_save', { queueData })
    },

    updater: {
      checkApp: () => invoke('updater_check_app'),
      downloadApp: () => invoke('updater_download_app'),
      installApp: (ui) => invoke('updater_install_app', { ui: ui || null }),
      onAppUpdateProgress: (cb) => subscribeEvent('app:updateProgress', cb),
      onAppUpdateDownloaded: (cb) => subscribeEvent('app:updateDownloaded', cb),
      onAppUpdateError: (cb) => subscribeEvent('app:updateError', cb),
      checkYtdlp: () => invoke('updater_check_ytdlp'),
      updateYtdlp: () => invoke('updater_update_ytdlp'),
      checkFfmpeg: () => invoke('updater_check_ffmpeg'),
      updateFfmpeg: () => invoke('updater_update_ffmpeg'),
      getVersions: () => invoke('updater_get_versions')
    },

    log: {
      info: (...args) => invoke('system_log', { level: 'info', args }),
      warn: (...args) => invoke('system_log', { level: 'warn', args }),
      error: (...args) => invoke('system_log', { level: 'error', args }),
      debug: (...args) => invoke('system_log', { level: 'debug', args })
    },

    paths: {
      getBinPaths: () => invoke('get_bin_paths')
    },

    clipboard: {
      startWatch: () => invoke('clipboard_start_watch'),
      stopWatch: () => invoke('clipboard_stop_watch'),
      readText: () => invoke('clipboard_read_text'),
      onUrlsDetected: (cb) => subscribeEvent('clipboard:urlsDetected', cb)
    },

    popup: {
      show: (data) => invoke('popup_show', { data: data || {} }),
      close: () => invoke('popup_close')
    },

    shell: {
      openPath: (filePath) => invoke('shell_open_path', { filePath }),
      showInFolder: (filePath) => invoke('shell_show_item_in_folder', { filePath }),
      openExternal: (url) => invoke('shell_open_external', { url })
    },

    system: {
      shutdown: (message) => invoke('system_shutdown', { message: message || null }),
      cancelShutdown: () => invoke('system_cancel_shutdown'),
      getVersion: () => invoke('app_version'),
      getGPU: () => invoke('system_get_gpu')
    }
  };

  // Native Tauri v2 OS Drag & Drop bridge (zero flicker, full OS paths)
  function isOverDropZone(position) {
    const dropZone = document.getElementById('dropZone');
    if (!dropZone) return false;
    const rect = dropZone.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    if (!position) return true;
    const dpr = window.devicePixelRatio || 1;
    const x = position.x / dpr;
    const y = position.y / dpr;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function setDropZoneHighlight(active) {
    const dropZone = document.getElementById('dropZone');
    if (!dropZone) return;
    if (active) {
      dropZone.classList.add('drag-over');
    } else {
      dropZone.classList.remove('drag-over');
    }
  }

  subscribeEvent('tauri://drag-enter', (payload) => {
    setDropZoneHighlight(isOverDropZone(payload?.position));
  });

  subscribeEvent('tauri://drag-over', (payload) => {
    setDropZoneHighlight(isOverDropZone(payload?.position));
  });

  subscribeEvent('tauri://drag-leave', () => {
    setDropZoneHighlight(false);
  });

  subscribeEvent('tauri://drag-drop', (payload) => {
    const over = isOverDropZone(payload?.position);
    setDropZoneHighlight(false);
    const paths = payload?.paths;
    if (over && Array.isArray(paths) && paths.length > 0) {
      window.dispatchEvent(new CustomEvent('bitkit:files-dropped', { detail: { paths } }));
    }
  });

  // Route browser navigator.clipboard.readText through native Rust so WebView2
  // NEVER shows the ugly top-left browser clipboard permission prompt.
  try {
    if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
      Object.defineProperty(navigator.clipboard, 'readText', {
        configurable: true,
        value: () => invoke('clipboard_read_text')
      });
    }
  } catch (e) {
    // Ignore if browser locks clipboard property
  }

  window.addEventListener('DOMContentLoaded', () => {
    invoke('window_show').catch(() => {});
  });
})();
