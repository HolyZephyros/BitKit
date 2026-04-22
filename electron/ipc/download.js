const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const activeDownloads = new Map();
const cancelledIds = new Set();

function register(ipcMain, getBinPath) {

  ipcMain.handle('download:analyze', async (event, url, cookiesPath) => {
    if (url && !url.match(/^https?:\/\//i)) url = 'https://' + url;
    const ytdlp = getBinPath('yt-dlp.exe');
    const args = ['--dump-json', '--no-download'];

    const isPlaylistUrl = url.match(/[?&]list=/) || url.includes('/playlist');

    if (isPlaylistUrl) {
      args.push('--flat-playlist', '--yes-playlist');
    }

    if (cookiesPath) {
      args.push('--cookies', cookiesPath);
    }

    args.push('--', url);

    console.log('[BitKit:Analyze]', { url, cookiesPath: cookiesPath || '(none)', args: args.join(' ') });

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn(ytdlp, args);

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          try {

            const jsonLines = stdout.trim().split('\n').filter(line => line.trim().startsWith('{'));
            const entries = jsonLines.map(line => JSON.parse(line));

            if (entries.length === 0) {
              resolve({ success: false, errorKey: 'backend.formatInfoFailed' });
              return;
            }

            const parseEntry = (info) => {
              let thumb = info.thumbnail || '';
              if (!thumb && info.thumbnails && info.thumbnails.length) {
                thumb = info.thumbnails[info.thumbnails.length - 1].url;
              }
              return {
              title: info.title || 'Unknown',
              duration: info.duration || 0,
              thumbnail: thumb,
              uploader: info.uploader || info.channel || 'Unknown',
              platform: info.extractor || info.extractor_key || 'Unknown',
              url: info.webpage_url || url,
              formats: (info.formats || []).map(f => ({
                formatId: f.format_id,
                ext: f.ext,
                resolution: f.resolution || (f.height ? `${f.width}x${f.height}` : 'audio'),
                width: f.width,
                height: f.height,
                fps: f.fps,
                vcodec: f.vcodec || 'none',
                acodec: f.acodec || 'none',
                filesize: f.filesize || f.filesize_approx || 0,
                tbr: f.tbr || 0,
                abr: f.abr || 0,
                vbr: f.vbr || 0,
                formatNote: f.format_note || '',
                hasVideo: f.vcodec !== 'none',
                hasAudio: f.acodec !== 'none'
              }))
            };
            };

            if (entries.length === 1) {

              resolve({ success: true, data: parseEntry(entries[0]) });
            } else {

              const first = entries[0];
              resolve({
                success: true,
                isPlaylist: true,
                data: parseEntry(first),
                playlist: {
                  title: first.playlist_title || first.playlist || 'Playlist',
                  count: entries.length,
                  entries: entries.map(e => ({
                    title: e.title,
                    url: e.webpage_url || e.url,
                    duration: e.duration,
                    thumbnail: e.thumbnail || (e.thumbnails && e.thumbnails.length ? e.thumbnails[e.thumbnails.length-1].url : '')
                  }))
                }
              });
            }
          } catch (e) {
            console.error('[BitKit:Analyze] JSON parse error:', e.message);
            resolve({ success: false, error: e.message, errorKey: 'backend.jsonParseError', errorParams: { err: e.message } });
          }
        } else {
          console.error('[BitKit:Analyze] yt-dlp error (code', code, '):', stderr);
          resolve({ success: false, error: stderr || `yt-dlp exited with code ${code}`, errorKey: 'backend.ytdlpError', errorParams: { code, err: stderr } });
        }
      });

      proc.on('error', (err) => {
        console.error('[BitKit:Analyze] exec error:', err.message);
        resolve({ success: false, error: err.message, errorKey: 'backend.ytdlpExecError', errorParams: { err: err.message } });
      });

      setTimeout(() => {
        proc.kill();
        resolve({ success: false, errorKey: 'backend.timeout60' });
      }, 60000);
    });
  });

  const cleanupDownloadFiles = (options, knownFiles) => {
    const fs = require('fs');

    if (knownFiles && knownFiles.size > 0) {
      for (const file of knownFiles) {
        try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (e) {}
        try { const part = file + '.part'; if (fs.existsSync(part)) fs.unlinkSync(part); } catch (e) {}
        try { const ytdl = file + '.ytdl'; if (fs.existsSync(ytdl)) fs.unlinkSync(ytdl); } catch (e) {}
        try { const temp = file.replace(/(\.[\w]+)$/, '.temp$1'); if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (e) {}

        try {
          const dir = path.dirname(file);
          const base = path.basename(file);
          const dirFiles = fs.readdirSync(dir);
          for (const f of dirFiles) {
            if (f.startsWith(base) && (f.endsWith('.part') || f.endsWith('.ytdl'))) {
              try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
            }
          }
        } catch (e) {}
      }
    }
  };

  ipcMain.handle('download:start', async (event, url, options) => {

    if (global.ytdlpUpdating) {
      return { id: null, success: false, error: 'yt-dlp is currently updating. Please wait.' };
    }
    if (url && !url.match(/^https?:\/\//i)) url = 'https://' + url;
    const ytdlp = getBinPath('yt-dlp.exe');
    const id = crypto.randomUUID();
    const args = ['--windows-filenames'];

    const outputPath = options.outputPath || require('electron').app.getPath('downloads');
    let template = options.filenameTemplate || '%(title)s.%(ext)s';

    const titleStr = (options.title || '')
      .replace(/:/g, '：')
      .replace(/"/g, "'")
      .replace(/[<>|?*\\/]/g, '_')
      .replace(/[\s.]+$/g, '')
      .substring(0, 200);

    if (titleStr) {
      try {
        const fs = require('fs');

        let counter = 0;
        const checkBase = path.join(outputPath, titleStr);

        const dirFiles = await fs.promises.readdir(outputPath);
        while (dirFiles.some(f => f.startsWith(counter === 0 ? titleStr : `${titleStr} (${counter})`))) {
          counter++;
        }
        if (counter > 0) {
          template = template.replace('%(title)s', `%(title)s (${counter})`);
        }
      } catch (e) {  }
    }
    args.push('-o', path.join(outputPath, template));

    const fmt = options.outputFormat || '';
    const isNoAudio = options.videoAudioCodec === 'none';

    const codecPref = {
      webm: '[vcodec^=vp]',
      mp4: '[vcodec^=avc]',
      mkv: '',
      mov: '[vcodec^=avc]',
      avi: '[vcodec^=avc]'
    };
    const cp = fmt ? (codecPref[fmt] || '') : '';

    if (options.formatId) {
      args.push('-f', options.formatId);
    } else if (options.quality) {

      const getVideoFmt = (heightFilter) => {
        const base = heightFilter ? `[height<=${heightFilter}]` : '';
        const preferred = `bestvideo${cp}${base}`;
        const fallback = `bestvideo${base}`;
        if (isNoAudio) {
          return cp ? `${preferred}/${fallback}` : fallback;
        }
        const audio = 'bestaudio';
        const bestFallback = heightFilter ? `best[height<=${heightFilter}]` : 'best';
        return cp
          ? `${preferred}+${audio}/${fallback}+${audio}/${bestFallback}`
          : `${fallback}+${audio}/${bestFallback}`;
      };

      if (options.quality === 'best') {
        args.push('-f', getVideoFmt(null));

        args.push('-S', 'res,fps,br');
      } else if (options.quality === 'audio') {
        args.push('-f', 'bestaudio/best');
      } else {

        const height = options.quality.replace('p', '');
        args.push('-f', getVideoFmt(height));
      }
    }

    const nativeMergeFormats = ['mp4', 'mkv', 'webm'];

    if (options.isAudio) {

      args.push('-x');
      if (fmt) {

        const audioFmtMap = { ogg: 'vorbis' };
        args.push('--audio-format', audioFmtMap[fmt] || fmt);
      }
      if (options.audioQuality !== undefined) {
        args.push('--audio-quality', options.audioQuality);
      }
    } else if (!fmt) {

    } else if (isNoAudio) {

      args.push('--recode-video', fmt);
    } else if (nativeMergeFormats.includes(fmt)) {

      args.push('--merge-output-format', fmt);
    } else {

      args.push('--merge-output-format', 'mp4');
      args.push('--recode-video', fmt);
    }

    const ffmpegExtraArgs = ['-threads', '0'];

    const fastStartFormats = ['mp4', 'm4v', 'mov', 'm4a'];
    if (fmt && fastStartFormats.includes(fmt)) {
      ffmpegExtraArgs.push('-movflags', '+faststart');
    }

    if (!options.isAudio && options.videoAudioCodec && !isNoAudio) {
      const codecMap = { aac: 'aac', m4a: 'aac', opus: 'libopus', mp3: 'libmp3lame', flac: 'flac', wav: 'pcm_s16le', ogg: 'libvorbis' };
      const encoder = codecMap[options.videoAudioCodec] || options.videoAudioCodec;
      ffmpegExtraArgs.push('-c:a', encoder);
    }

    args.push('--postprocessor-args', `ffmpeg:${ffmpegExtraArgs.join(' ')}`);

    const ffmpegPath = getBinPath('ffmpeg.exe');
    args.push('--ffmpeg-location', path.dirname(ffmpegPath));

    if (options.startTime || options.endTime) {
      const section = `*${options.startTime || '0'}-${options.endTime || 'inf'}`;
      args.push('--download-sections', section, '--force-keyframes-at-cuts');
    }

    if (options.maxFilesize) {
      args.push('--max-filesize', options.maxFilesize + 'M');
    }

    if (options.embedThumbnail) {
      args.push('--embed-thumbnail');
    }

    if (options.embedMetadata) {
      args.push('--embed-metadata');
    }

    if (options.cookiesPath) {
      args.push('--cookies', options.cookiesPath);
    }

    const proxy = require('./proxy');
    if (options.rateLimit !== undefined) {
      proxy.setGlobalRate(parseInt(options.rateLimit) || 0);
    }

    const proxyPort = proxy.getProxyPort();
    if (proxyPort > 0) {

      args.push('--proxy', `http://127.0.0.1:${proxyPort}`);
    }

    args.push('--newline');
    args.push('--progress-template', '%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._total_bytes_str)s');

    if (!options.playlist) {
      args.push('--no-playlist');
    }

    args.push('--', url);

    console.log('[BitKit:Download]', { id, args: args.join(' ') });
    const proc = spawn(ytdlp, args);
    activeDownloads.set(id, { proc, url, options, args, startTime: Date.now(), knownFiles: new Set() });

    let lastOutput = '';
    let maxFilesizeHit = false;

    let currentFragment = 0;
    let fragmentCount = 1;
    const fragmentWeights = [
      { start: 0, end: 90 },
      { start: 45, end: 90 }
    ];

    const isSection = !!(options.startTime || options.endTime);

    if (!event.sender.isDestroyed()) {
      event.sender.send('download:progress', {
        id, percent: 0, speed: '', eta: '',
        status: 'connecting',
        isSection
      });
    }

    let hasReceivedProgress = false;
    if (isSection) {
      setTimeout(() => {
        if (!hasReceivedProgress && activeDownloads.has(id) && !event.sender.isDestroyed()) {
          event.sender.send('download:progress', {
            id, percent: 0, speed: '', eta: '',
            status: 'cutting'
          });
        }
      }, 3000);
    }

    proc.stdout.on('data', (data) => {
      const output = data.toString().trim();
      lastOutput = output;

      console.log(`[yt-dlp:${id.slice(0,8)}]`, output);

      const lines = output.split('\n');
      for (const line of lines) {

        if (line.includes('max-filesize') && line.includes('Aborting')) {
          maxFilesizeHit = true;
        }

        if (line.includes('[download] Destination: ')) {
          activeDownloads.get(id)?.knownFiles?.add(line.split('[download] Destination: ')[1].trim());
          if (currentFragment === 0 && activeDownloads.get(id)?.knownFiles?.size > 1) {
            currentFragment = 1;
            fragmentCount = 2;

            fragmentWeights[0] = { start: 0, end: 45 };
          }
        } else if (line.includes('[Merger] Merging formats into "')) {
          activeDownloads.get(id)?.knownFiles?.add(line.split('[Merger] Merging formats into "')[1].split('"')[0]);
        } else if (line.includes('[info] Writing video thumbnail')) {
          const match = line.match(/to:\s*(.+)$/);
          if (match && match[1]) {
            activeDownloads.get(id)?.knownFiles?.add(match[1].trim());
          }
        } else if (line.includes('|')) {
          const parts = line.split('|');
          if (parts.length >= 4) {
            const rawPercent = parseFloat(parts[0].replace('%', '').trim()) || 0;
            hasReceivedProgress = true;

            const w = fragmentWeights[currentFragment] || { start: 0, end: 90 };
            const weightedPercent = w.start + (rawPercent / 100) * (w.end - w.start);
            const finalPercent = Math.min(90, Math.round(weightedPercent));

            if ((rawPercent < 100 || !lastOutput.includes('[Merger]')) && !event.sender.isDestroyed()) {
              event.sender.send('download:progress', {
                id,
                percent: finalPercent,
                speed: parts[1]?.trim() || '',
                eta: parts[2]?.trim() || '',
                totalSize: parts[3]?.trim() || ''
              });
            }
          }
        }

        if (line.includes('[Merger]') || line.includes('[ExtractAudio]') ||
            line.includes('[VideoConvertor]') || line.includes('[FFmpegVideoConvertor]') ||
            line.includes('[EmbedThumbnail]') || line.includes('[Metadata]') ||
            line.includes('Deleting original file') || line.includes('Fixing file')) {

          if (!event.sender.isDestroyed()) {
            event.sender.send('download:progress', {
              id,
              percent: 95,
              speed: '',
              eta: '',
              status: 'postprocessing'
            });
          }
        }
      }
    });

    let errorBuffer = '';

    const parseTimeToSec = (t) => {
      if (!t) return 0;
      const parts = t.split(':').map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] || 0;
    };
    const startSec = parseTimeToSec(options.startTime || '0');
    const endSec = options.endTime ? parseTimeToSec(options.endTime) : 0;
    const sectionDuration = endSec > startSec ? (endSec - startSec) : 0;

    let stderrLineBuffer = '';
    let ffmpegPhaseDetected = false;

    proc.stderr.on('data', (data) => {
      const str = data.toString();
      errorBuffer += str;
      if (errorBuffer.length > 2000) errorBuffer = errorBuffer.substring(errorBuffer.length - 2000);

      stderrLineBuffer += str;
      const lines = stderrLineBuffer.split(/\r|\n/);
      stderrLineBuffer = lines.pop() || '';

      for (const line of lines) {
        const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
        const speedMatch = line.match(/speed=\s*([\d.]+x)/);
        const sizeMatch = line.match(/size=\s*(\d+\w+)/);
        if (timeMatch) {
          if (!ffmpegPhaseDetected) ffmpegPhaseDetected = true;
          const currentSec = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
          const percent = sectionDuration > 0
            ? Math.min(99, Math.round((currentSec / sectionDuration) * 100))
            : 50;
          if (!event.sender.isDestroyed()) {
            event.sender.send('download:progress', {
              id,
              percent,
              speed: speedMatch ? speedMatch[1] : '',
              eta: '',
              totalSize: sizeMatch ? sizeMatch[1] : '',
              status: 'postprocessing'
            });
          }
        }
      }
    });

    proc.on('close', (code) => {

      const current = activeDownloads.get(id);
      if (current && current.proc !== proc) return;

      const knownFiles = current?.knownFiles;
      activeDownloads.delete(id);

      if (cancelledIds.has(id)) {
        cancelledIds.delete(id);
        return;
      }

      let lastErrorMsg = '';
      if (errorBuffer) {
        try {
          const log = require('electron-log');
          log.error(`[yt-dlp stderr for ${url}]:\n${errorBuffer}`);
        } catch(e) {
          console.error(`[yt-dlp stderr] ${errorBuffer}`);
        }
        
        if (errorBuffer.includes('ERROR:')) {
          const match = errorBuffer.match(/ERROR:\s*(.*)/);
          if (match && match[1]) {
            lastErrorMsg = match[1].trim();
          }
        }
        
        if (!lastErrorMsg) {
          const lines = errorBuffer.trim().split(/\r?\n/);
          lastErrorMsg = lines[lines.length - 1] || 'Download error';
        }
      }

      if (code === 0) {

        if (maxFilesizeHit) {
          cleanupDownloadFiles(options, knownFiles);
          if (!event.sender.isDestroyed()) {
            event.sender.send('download:error', {
              id,
              error: 'MAX_FILESIZE_EXCEEDED'
            });
          }
        } else {
          let finalPath = options.outputPath || '';
          if (knownFiles && knownFiles.size > 0) {
            const fs = require('fs');
            const filesArr = Array.from(knownFiles).reverse();
            for (const f of filesArr) {
              try {
                if (fs.existsSync(f) && !f.endsWith('.part') && !f.endsWith('.ytdl')) {
                  finalPath = f;
                  break;
                }
              } catch (e) {}
            }
          }
          if (!event.sender.isDestroyed()) {
            event.sender.send('download:complete', {
              id, url,
              title: options.title || url,
              outputPath: finalPath
            });
          }
        }
      } else {
        const errorText = lastErrorMsg || `Process exited with code ${code}`;
        if (!event.sender.isDestroyed()) {
          event.sender.send('download:error', {
            id,
            error: errorText
          });
        }
      }
    });

    proc.on('error', (err) => {

      const current = activeDownloads.get(id);
      if (current && current.proc !== proc) return;

      activeDownloads.delete(id);
      if (!event.sender.isDestroyed()) {
        event.sender.send('download:error', { id, error: err.message });
      }
    });

    return { id, success: true };
  });

  ipcMain.handle('download:cancel', (event, id) => {
    const download = activeDownloads.get(id);
    if (download) {
      const pid = download.proc?.pid;
      cancelledIds.add(id);
      activeDownloads.delete(id);

      try {
        if (pid) {
          spawn('taskkill', ['/f', '/t', '/pid', String(pid)], { stdio: 'ignore' });
        }
      } catch (e) {
        try { download.proc?.kill('SIGKILL'); } catch (e2) {}
      }

      const doCleanup = () => cleanupDownloadFiles(download.options, download.knownFiles);

      doCleanup();
      setTimeout(doCleanup, 1000);
      setTimeout(doCleanup, 3000);
      setTimeout(doCleanup, 6000);
      setTimeout(doCleanup, 10000);

      return { success: true };
    }
    return { success: false, errorKey: 'backend.downloadNotFound' };
  });

  ipcMain.handle('download:changeRate', (event, id, newRateKB) => {

    const proxy = require('./proxy');
    proxy.setGlobalRate(parseInt(newRateKB) || 0);

    return { success: true, newRate: newRateKB };
  });
}

module.exports = { register, activeDownloads };
