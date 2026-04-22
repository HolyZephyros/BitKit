const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('bitkit', {

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  },

  utils: {
    getPathForFile: (file) => webUtils.getPathForFile(file)
  },

  download: {
    analyze: (url, cookiesPath) => ipcRenderer.invoke('download:analyze', url, cookiesPath),
    start: (url, options) => ipcRenderer.invoke('download:start', url, options),
    cancel: (id) => ipcRenderer.invoke('download:cancel', id),
    changeRate: (id, rateKB) => ipcRenderer.invoke('download:changeRate', id, rateKB),
    onProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('download:progress', handler);
      return () => ipcRenderer.removeListener('download:progress', handler);
    },
    onComplete: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('download:complete', handler);
      return () => ipcRenderer.removeListener('download:complete', handler);
    },
    onError: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('download:error', handler);
      return () => ipcRenderer.removeListener('download:error', handler);
    }
  },

  convert: {
    start: (input, output, options) => ipcRenderer.invoke('convert:start', input, output, options),
    cancel: (id) => ipcRenderer.invoke('convert:cancel', id),
    getQueueInfo: () => ipcRenderer.invoke('convert:getQueueInfo'),
    onProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('convert:progress', handler);
      return () => ipcRenderer.removeListener('convert:progress', handler);
    },
    onComplete: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('convert:complete', handler);
      return () => ipcRenderer.removeListener('convert:complete', handler);
    },
    onError: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('convert:error', handler);
      return () => ipcRenderer.removeListener('convert:error', handler);
    }
  },

  media: {
    getInfo: (filePath) => ipcRenderer.invoke('media:getInfo', filePath)
  },

  file: {
    selectFile: (options) => ipcRenderer.invoke('file:select', options),
    selectFiles: (options) => ipcRenderer.invoke('file:selectMultiple', options),
    selectFolder: () => ipcRenderer.invoke('file:selectFolder'),
    deleteCookies: () => ipcRenderer.invoke('file:deleteCookies'),
    openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
    showInFolder: (path) => ipcRenderer.invoke('shell:showItemInFolder', path)
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings) => ipcRenderer.invoke('settings:set', settings)
  },

  history: {
    get: () => ipcRenderer.invoke('history:get'),
    add: (item) => ipcRenderer.invoke('history:add', item),
    clear: () => ipcRenderer.invoke('history:clear')
  },

  queue: {
    get: () => ipcRenderer.invoke('queue:get'),
    save: (data) => ipcRenderer.send('queue:save', data)
  },

  updater: {
    checkApp: () => ipcRenderer.invoke('updater:checkApp'),
    downloadApp: () => ipcRenderer.invoke('updater:downloadApp'),
    installApp: () => ipcRenderer.invoke('updater:installApp'),
    onAppUpdateProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('app:updateProgress', handler);
      return () => ipcRenderer.removeListener('app:updateProgress', handler);
    },
    onAppUpdateDownloaded: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('app:updateDownloaded', handler);
      return () => ipcRenderer.removeListener('app:updateDownloaded', handler);
    },
    onAppUpdateError: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('app:updateError', handler);
      return () => ipcRenderer.removeListener('app:updateError', handler);
    },
    checkYtdlp: () => ipcRenderer.invoke('updater:checkYtdlp'),
    updateYtdlp: () => ipcRenderer.invoke('updater:updateYtdlp'),
    checkFfmpeg: () => ipcRenderer.invoke('updater:checkFfmpeg'),
    updateFfmpeg: () => ipcRenderer.invoke('updater:updateFfmpeg'),
    getVersions: () => ipcRenderer.invoke('updater:getVersions')
  },

  log: {
    info: function(msg) { return ipcRenderer.invoke('system:log', 'info', msg); },
    warn: function(msg) { return ipcRenderer.invoke('system:log', 'warn', msg); },
    error: function(msg) { return ipcRenderer.invoke('system:log', 'error', msg); },
    debug: function(msg) { return ipcRenderer.invoke('system:log', 'debug', msg); }
  },

  paths: {
    getBinPaths: () => ipcRenderer.invoke('get:binPaths')
  },

  shell: {
    openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
    showInFolder: (path) => ipcRenderer.invoke('shell:showItemInFolder', path),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
  },

  system: {
    shutdown: (message) => ipcRenderer.invoke('system:shutdown', message),
    cancelShutdown: () => ipcRenderer.invoke('system:cancelShutdown'),
    getVersion: () => ipcRenderer.invoke('app:version'),
    getGPU: () => ipcRenderer.invoke('system:getGPU')
  }
});
