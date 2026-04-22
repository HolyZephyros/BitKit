const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const log = require('electron-log');

log.transports.file.fileName = 'bitkit-error.log';
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.errorHandler.startCatching();

ipcMain.handle('system:log', (event, level, ...args) => {
  if (log[level]) {
    log[level](...args);
  } else {
    log.info(...args);
  }
});

const downloadIPC = require('./ipc/download');
const convertIPC = require('./ipc/convert');
const mediaInfoIPC = require('./ipc/mediaInfo');
const fileManagerIPC = require('./ipc/fileManager');
const updaterIPC = require('./ipc/updater');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0f',
    icon: path.join(__dirname, '../src/assets/icons/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized());

function getBinPath(binName) {
  const devPath = path.join(__dirname, '..', 'resources', 'bin', binName);
  const prodPath = path.join(process.resourcesPath, 'bin', binName);

  const userDataBinDir = path.join(app.getPath('userData'), 'bin');
  const userBinPath = path.join(userDataBinDir, binName);

  if (!fs.existsSync(userDataBinDir)) {
    try { fs.mkdirSync(userDataBinDir, { recursive: true }); } catch (e) {}
  }

  if (!fs.existsSync(userBinPath)) {
    if (fs.existsSync(prodPath)) {
      try { fs.copyFileSync(prodPath, userBinPath); } catch (e) {}
    } else if (fs.existsSync(devPath)) {
      try { fs.copyFileSync(devPath, userBinPath); } catch (e) {}
    }
  }

  if (fs.existsSync(userBinPath)) return userBinPath;

  if (fs.existsSync(devPath)) return devPath;
  if (fs.existsSync(prodPath)) return prodPath;

  return binName;
}

ipcMain.handle('get:binPaths', () => ({
  ytdlp: getBinPath('yt-dlp.exe'),
  ffmpeg: getBinPath('ffmpeg.exe'),
  ffprobe: getBinPath('ffprobe.exe')
}));

function atomicWriteSync(filePath, data) {
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, data, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('Atomic write failed for', filePath, err);
  }
}

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

ipcMain.handle('settings:get', () => {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
  } catch (e) {  }
  const supported = ['tr','en','de','es','fr','it','pl','pt','ru','ja','zh'];
  const sysLang = (app.getLocale() || 'en').split('-')[0].toLowerCase();
  return {
    downloadPath: app.getPath('downloads'),
    convertPath: '',
    language: supported.includes(sysLang) ? sysLang : 'en',
    cookiesPath: '',
    maxConcurrent: 3,
    defaultVideoFormat: 'mp4',
    defaultAudioFormat: 'mp3'
  };
});

ipcMain.handle('settings:set', (event, settings) => {
  atomicWriteSync(settingsPath, JSON.stringify(settings, null, 2));
  return true;
});

const historyPath = path.join(app.getPath('userData'), 'history.json');

ipcMain.handle('history:get', () => {
  try {
    if (fs.existsSync(historyPath)) {
      return JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    }
  } catch (e) {  }
  return [];
});

ipcMain.handle('history:add', (event, item) => {
  let history = [];
  try {
    if (fs.existsSync(historyPath)) {
      history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    }
  } catch (e) {  }
  history.unshift({ ...item, timestamp: Date.now() });

  if (history.length > 2000) history = history.slice(0, 2000);
  atomicWriteSync(historyPath, JSON.stringify(history, null, 2));
  return true;
});

ipcMain.handle('history:clear', () => {
  atomicWriteSync(historyPath, '[]');
  return true;
});

const queuePath = path.join(app.getPath('userData'), 'queue.json');

ipcMain.handle('queue:get', () => {
  try {
    if (fs.existsSync(queuePath)) {
      return JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
    }
  } catch (e) {  }
  return [];
});

ipcMain.on('queue:save', (event, queueData) => {
  atomicWriteSync(queuePath, JSON.stringify(queueData, null, 2));
});

ipcMain.handle('shell:openPath', (event, filePath) => shell.openPath(filePath));
ipcMain.handle('shell:showItemInFolder', (event, filePath) => shell.showItemInFolder(filePath));
ipcMain.handle('shell:openExternal', (event, url) => shell.openExternal(url));

ipcMain.handle('system:shutdown', (event, message) => {
  const { execFile } = require('child_process');
  const finalMessage = message ? (message.length > 50 ? message.substring(0, 50) : message) : 'BitKit';
  execFile('shutdown', ['/s', '/t', '60', '/c', finalMessage]);
  return { success: true };
});
ipcMain.handle('system:cancelShutdown', () => {
  const { execFile } = require('child_process');
  execFile('shutdown', ['/a']);
  return { success: true };
});

let gpuCache = null;
ipcMain.handle('system:getGPU', async () => {
  if (gpuCache) return gpuCache;

  const { exec, execFile } = require('child_process');

  const names = await new Promise((resolve) => {
    exec('powershell -NoProfile -Command "Get-CimInstance -ClassName Win32_VideoController | Select-Object -ExpandProperty Name"', { timeout: 8000 }, (err, stdout) => {
      if (err) return resolve([]);
      resolve(stdout.split('\n').map(l => l.trim()).filter(l => l.length > 0));
    });
  });

  let vendor = 'none';
  const nameLower = names.join(' ').toLowerCase();
  if (nameLower.includes('nvidia') || nameLower.includes('geforce') || nameLower.includes('rtx') || nameLower.includes('gtx')) {
    vendor = 'nvidia';
  } else if (nameLower.includes('amd') || nameLower.includes('radeon')) {
    vendor = 'amd';
  } else if (nameLower.includes('intel') || nameLower.includes('arc') || nameLower.includes('uhd') || nameLower.includes('iris')) {
    vendor = 'intel';
  }

  const gpuEncoders = {
    nvidia: ['h264_nvenc', 'hevc_nvenc', 'av1_nvenc'],
    amd:    ['h264_amf', 'hevc_amf', 'av1_amf'],
    intel:  ['h264_qsv', 'hevc_qsv', 'vp9_qsv', 'av1_qsv']
  };

  const toTest = gpuEncoders[vendor] || [];
  const available = [];
  const ffmpeg = getBinPath('ffmpeg.exe');

  for (const enc of toTest) {
    const works = await new Promise((resolve) => {
      const proc = execFile(ffmpeg, [
        '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=1:r=25',
        '-pix_fmt', 'yuv420p', '-c:v', enc, '-frames:v', '1', '-f', 'null', '-'
      ], { timeout: 8000 }, () => {});
      let output = '';
      proc.stderr.on('data', (d) => { output += d.toString(); });
      proc.on('close', () => {

        resolve(/frame=\s*1/.test(output));
      });
      proc.on('error', () => resolve(false));
    });
    if (works) {
      available.push(enc);

      if (vendor === 'nvidia' && !enc.includes('av1')) {
        available.push(enc + '_lossless');
      }
    }
  }

  gpuCache = { vendor, name: names[0] || '', all: names, available };
  return gpuCache;
});

ipcMain.handle('app:version', () => app.getVersion());

function registerIPCModules() {
  downloadIPC.register(ipcMain, getBinPath);
  convertIPC.register(ipcMain, getBinPath);
  mediaInfoIPC.register(ipcMain, getBinPath);
  fileManagerIPC.register(ipcMain, dialog);
  updaterIPC.register(ipcMain, getBinPath, app);
}

app.whenReady().then(async () => {

  const proxy = require('./ipc/proxy');
  try { await proxy.startProxy(0); } catch (e) { console.error('Failed to start proxy:', e); }

  registerIPCModules();

  createWindow();

  const ytdlp = getBinPath('yt-dlp.exe');
  if (ytdlp && ytdlp !== 'yt-dlp.exe') {
    const { execFile } = require('child_process');
    global.ytdlpUpdating = true;
    execFile(ytdlp, ['-U'], { timeout: 30000 }, () => {
      global.ytdlpUpdating = false;
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {

  const proxy = require('./ipc/proxy');
  proxy.stopProxy();

  const { activeDownloads } = downloadIPC;
  const { spawn } = require('child_process');

  for (const [id, download] of activeDownloads) {
    try {
      if (download.proc && download.proc.pid) {
        spawn('taskkill', ['/f', '/t', '/pid', String(download.proc.pid)], { stdio: 'ignore' });
      }
    } catch (e) {
      try { download.proc?.kill('SIGKILL'); } catch (e2) {}
    }
  }
  activeDownloads.clear();

  const { activeConversions } = convertIPC;
  if (activeConversions) {
    for (const [id, conversion] of activeConversions) {
      try {
        if (conversion.proc && conversion.proc.pid) {
          spawn('taskkill', ['/f', '/t', '/pid', String(conversion.proc.pid)], { stdio: 'ignore' });
        }
      } catch (e) {
        try { conversion.proc?.kill('SIGKILL'); } catch (e2) {}
      }
    }
    activeConversions.clear();
  }

  if (process.platform !== 'darwin') app.quit();
});
