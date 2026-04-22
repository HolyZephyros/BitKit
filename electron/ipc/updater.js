const { execFile } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

function register(ipcMain, getBinPath, app) {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.logger = null;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('download-progress', (progressObj) => {
    const webContents = require('electron').BrowserWindow.getAllWindows()[0]?.webContents;
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('app:updateProgress', progressObj);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[BitKit:Updater] Update downloaded:', info?.version);
    try {
      const flagPath = path.join(app.getPath('userData'), 'pending-update.json');
      fs.writeFileSync(flagPath, JSON.stringify({ version: info?.version }), 'utf-8');
    } catch (e) {}
    const webContents = require('electron').BrowserWindow.getAllWindows()[0]?.webContents;
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('app:updateDownloaded', info);
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[BitKit:Updater] Error:', err?.message);
    const webContents = require('electron').BrowserWindow.getAllWindows()[0]?.webContents;
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('app:updateError', err?.message || 'Unknown error');
    }
  });

  ipcMain.handle('updater:getVersions', async () => {
    const ytdlpVersion = await getYtdlpVersion(getBinPath('yt-dlp.exe'));
    const ffmpegVersion = await getFfmpegVersion(getBinPath('ffmpeg.exe'));
    return { ytdlp: ytdlpVersion, ffmpeg: ffmpegVersion };
  });

  const isNewerVersion = (remote, local) => {
    const parse = (v) => v.replace(/^v/, '').split('.').map(Number);
    const r = parse(remote);
    const l = parse(local);
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
      const rr = r[i] || 0;
      const ll = l[i] || 0;
      if (rr > ll) return true;
      if (rr < ll) return false;
    }
    return false;
  };

  ipcMain.handle('updater:checkApp', async () => {
    const current = 'v' + app.getVersion();

    try {
      autoUpdater.autoDownload = false;
      const result = await autoUpdater.checkForUpdates();
      if (result && result.updateInfo) {
        const latestVersion = 'v' + result.updateInfo.version;
        const isAvailable = isNewerVersion(latestVersion, current);

        let alreadyDownloaded = false;
        try {
          const flagPath = path.join(app.getPath('userData'), 'pending-update.json');
          if (fs.existsSync(flagPath)) {
            const flag = JSON.parse(fs.readFileSync(flagPath, 'utf-8'));
            if (flag.version === result.updateInfo.version) alreadyDownloaded = true;
          }
        } catch (e) {}

        return {
          current,
          latest: latestVersion,
          updateAvailable: isAvailable,
          alreadyDownloaded,
          url: result.updateInfo.releaseNotes ? '' : `https://github.com/HolyZephyros/BitKit/releases/latest`
        };
      }
    } catch (err) {

      try {
        const latest = await getLatestGithubRelease('HolyZephyros', 'BitKit');
        let latestTag = latest.tag_name || current;
        if (!latestTag.startsWith('v')) latestTag = 'v' + latestTag;

        return {
          current,
          latest: latestTag,
          updateAvailable: isNewerVersion(latestTag, current),
          url: latest.html_url
        };
      } catch (e) {
        return { current, updateAvailable: false, error: e.message };
      }
    }
    return { current, updateAvailable: false };
  });

  let isDownloadingUpdate = false;

  ipcMain.handle('updater:downloadApp', async () => {
    if (isDownloadingUpdate) {
      console.log('[BitKit:Updater] Download already in progress, skipping.');
      return { success: true, alreadyDownloading: true };
    }
    try {
      isDownloadingUpdate = true;
      console.log('[BitKit:Updater] Starting download...');
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err) {
      console.error('[BitKit:Updater] Download failed:', err?.message);
      return { success: false, error: err?.message || 'Download failed' };
    } finally {
      isDownloadingUpdate = false;
    }
  });

  ipcMain.handle('updater:installApp', async () => {
    try {
      const flagPath = path.join(app.getPath('userData'), 'pending-update.json');
      if (fs.existsSync(flagPath)) fs.unlinkSync(flagPath);
    } catch (e) {}
    autoUpdater.quitAndInstall(true, true);
  });

  ipcMain.handle('updater:checkYtdlp', async () => {
    const ytdlp = getBinPath('yt-dlp.exe');
    const current = await getYtdlpVersion(ytdlp);

    try {
      const latest = await getLatestGithubRelease('yt-dlp', 'yt-dlp');
      return {
        current,
        latest: latest.tag_name,
        updateAvailable: current !== latest.tag_name,
        downloadUrl: latest.assets?.find(a => a.name === 'yt-dlp.exe')?.browser_download_url
      };
    } catch (e) {
      return { current, error: e.message };
    }
  });

  ipcMain.handle('updater:updateYtdlp', async () => {
    const ytdlp = getBinPath('yt-dlp.exe');
    const backupPath = ytdlp + '.backup';

    try {
      if (fs.existsSync(ytdlp)) {
        fs.copyFileSync(ytdlp, backupPath);
      }

      global.ytdlpUpdating = true;

      return await new Promise((resolve) => {
        execFile(ytdlp, ['--update'], { timeout: 120000 }, (error, stdout, stderr) => {
          global.ytdlpUpdating = false;

          if (error) {
            console.error('[BitKit:Updater] yt-dlp update failed:', error.message);
            if (fs.existsSync(backupPath) && !fs.existsSync(ytdlp)) {
              fs.copyFileSync(backupPath, ytdlp);
              console.log('[BitKit:Updater] Restored yt-dlp from backup');
            }
            try { fs.unlinkSync(backupPath); } catch (e) {}
            resolve({ success: false, error: error.message });
          } else {
            try { fs.unlinkSync(backupPath); } catch (e) {}
            resolve({ success: true, output: stdout || stderr });
          }
        });
      });
    } catch (e) {
      global.ytdlpUpdating = false;
      if (fs.existsSync(backupPath)) {
        try {
          if (!fs.existsSync(ytdlp)) fs.copyFileSync(backupPath, ytdlp);
          fs.unlinkSync(backupPath);
        } catch (err) {}
      }
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('updater:checkFfmpeg', async () => {
    const ffmpeg = getBinPath('ffmpeg.exe');
    const current = await getFfmpegVersion(ffmpeg);
    return { current };
  });

  ipcMain.handle('updater:updateFfmpeg', async () => {
    return new Promise((resolve) => {
      const userDataBin = path.join(app.getPath('userData'), 'bin');
      if (!fs.existsSync(userDataBin)) fs.mkdirSync(userDataBin, { recursive: true });

      const psScript = `
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$api = Invoke-RestMethod -Uri "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest"
$asset = $api.assets | Where-Object { $_.name -like '*win64-gpl.zip' } | Select-Object -First 1
if (!$asset) { throw "FFmpeg release not found" }
$url = $asset.browser_download_url
$tempZip = Join-Path $env:TEMP "ffmpeg_update.zip"
$tempExt = Join-Path $env:TEMP "ffmpeg_extracted"
try {
  if (Test-Path $tempExt) { Remove-Item -Recurse -Force $tempExt }
  Invoke-WebRequest -Uri $url -OutFile $tempZip -UseBasicParsing
  Expand-Archive -Path $tempZip -DestinationPath $tempExt -Force
  $binFolder = Get-ChildItem -Path $tempExt -Directory | Select-Object -First 1
  $ffmpegExe = Join-Path $binFolder.FullName "bin\\ffmpeg.exe"
  $ffprobeExe = Join-Path $binFolder.FullName "bin\\ffprobe.exe"
  $targetBin = "${userDataBin}"
  Copy-Item -Path $ffmpegExe -Destination (Join-Path $targetBin "ffmpeg.exe") -Force
  Copy-Item -Path $ffprobeExe -Destination (Join-Path $targetBin "ffprobe.exe") -Force
} finally {
  if (Test-Path $tempZip) { Remove-Item $tempZip -Force -ErrorAction SilentlyContinue }
  if (Test-Path $tempExt) { Remove-Item $tempExt -Recurse -Force -ErrorAction SilentlyContinue }
}
`;
      const scriptPath = path.join(app.getPath('userData'), 'update_ffmpeg.ps1');
      fs.writeFileSync(scriptPath, psScript);

      execFile('powershell', ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-NonInteractive', '-File', scriptPath], { timeout: 300000 }, (error, stdout, stderr) => {
        try { fs.unlinkSync(scriptPath); } catch (e) {}
        if (error) {
          resolve({ success: false, error: error.message || stderr });
        } else {
          resolve({ success: true, output: stdout });
        }
      });
    });
  });
}

function getYtdlpVersion(binPath) {
  return new Promise((resolve) => {
    execFile(binPath, ['--version'], (error, stdout) => {
      resolve(error ? null : stdout.trim());
    });
  });
}

function getFfmpegVersion(binPath) {
  return new Promise((resolve) => {
    execFile(binPath, ['-version'], (error, stdout) => {
      if (error) {
        resolve(null);
      } else {
        const match = stdout.match(/ffmpeg version (\S+)/);
        if (match) {
          const rawVersion = match[1];

          const parts = rawVersion.split('-');
          const lastPart = parts[parts.length - 1];
          if (/^\d{8}$/.test(lastPart)) {
            const formattedDate = `${lastPart.slice(0, 4)}.${lastPart.slice(4, 6)}.${lastPart.slice(6, 8)}`;
            resolve(formattedDate);
          } else {
            resolve(rawVersion);
          }
        } else {
          resolve(null);
        }
      }
    });
  });
}

function getLatestGithubRelease(owner, repo) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/releases/latest`,
      headers: { 'User-Agent': 'BitKit' }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            return reject(new Error(`GitHub API error: ${res.statusCode}`));
          }
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('GitHub API timeout/error'));
        }
      });
    }).on('error', reject);
  });
}

module.exports = { register };
