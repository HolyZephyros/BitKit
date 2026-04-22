const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { buildFfmpegArgs, getSourceInfo } = require('./command-builder');

const activeConversions = new Map();
const reservedPaths = new Set();

const conversionQueue = [];
let activeCount = 0;

const cpuCores = os.cpus().length;
const MAX_CONCURRENT = Math.max(1, Math.min(8, Math.floor(cpuCores / 4)));

function register(ipcMain, getBinPath) {

  ipcMain.handle('convert:getQueueInfo', () => ({
    maxConcurrent: MAX_CONCURRENT,
    cpuCores,
    activeCount,
    queueLength: conversionQueue.length
  }));

  ipcMain.handle('convert:start', (event, inputPath, requestedOutputPath, options) => {
    const id = crypto.randomUUID();

    conversionQueue.push({ id, event, inputPath, requestedOutputPath, options });

    processQueue(getBinPath);

    return { id, success: true, queued: activeCount >= MAX_CONCURRENT };
  });

  function processQueue(getBinPath) {
    while (activeCount < MAX_CONCURRENT && conversionQueue.length > 0) {
      const job = conversionQueue.shift();
      activeCount++;

      activeConversions.set(job.id, { proc: null, isCancelled: false, inputPath: job.inputPath });
      startFFmpegProcess(job, getBinPath).catch(err => {
        console.error("[BitKit] Unhandled error in startFFmpegProcess:", err);
        activeConversions.delete(job.id);
        activeCount = Math.max(0, activeCount - 1);
        processQueue(getBinPath);
      });
    }
  }

  async function startFFmpegProcess(job, getBinPath) {
    const { id, event, inputPath, requestedOutputPath, options } = job;
    const fs = require('fs');

    const getUniquePath = async (targetPath) => {
      let currentPath = targetPath;
      let counter = 1;
      const dir = path.dirname(targetPath);
      const ext = path.extname(targetPath);
      const base = path.basename(targetPath, ext);

      while (true) {
        if (!reservedPaths.has(currentPath)) {

          reservedPaths.add(currentPath);
          try {
            await fs.promises.access(currentPath);

            reservedPaths.delete(currentPath);
          } catch {

            return currentPath;
          }
        }
        currentPath = path.join(dir, `${base}_${counter}${ext}`);
        counter++;
      }
    };

    const normalizedInput = path.resolve(inputPath);
    reservedPaths.add(normalizedInput);

    let finalRequestedOutputPath = requestedOutputPath;

    if (options && options.templateId === 'audio_only' && options.templateParams && options.templateParams.value === 'original') {
       try {
         const info = await getSourceInfo(inputPath, getBinPath);
         if (info && info.audioCodec) {
            const codecMap = {
              'aac': 'm4a', 'mp3': 'mp3', 'opus': 'opus',
              'vorbis': 'ogg', 'flac': 'flac', 'pcm_s16le': 'wav'
            };
            const realExt = codecMap[info.audioCodec] || info.audioCodec;
            finalRequestedOutputPath = requestedOutputPath.replace(/\.mka$/i, `.${realExt}`);
         }
       } catch(e) {}
    }

    const outputPath = await getUniquePath(finalRequestedOutputPath);
    const ffmpeg = getBinPath('ffmpeg.exe');

    const needsAutocrop = options.templateId === 'autocrop' ||
      (options.templateId === 'multi_filter' && options.templateParams?.filters?.some(f => f.id === 'autocrop'));

    if (needsAutocrop) {
      try {
        const cropVal = await new Promise((resolve, reject) => {

          const probeArgs = ['-i', inputPath, '-t', '10', '-vf', 'cropdetect=24:16:0', '-f', 'null', 'NUL'];
          const probe = spawn(ffmpeg, probeArgs);
          let stderr = '';
          probe.stderr.on('data', d => stderr += d.toString());
          probe.on('close', () => {

            const crops = stderr.match(/crop=\d+:\d+:\d+:\d+/g);
            if (crops && crops.length > 0) {

              const freq = {};
              crops.forEach(c => freq[c] = (freq[c] || 0) + 1);
              const best = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
              resolve(best.replace('crop=', ''));
            } else {
              reject(new Error('cropdetect: no crop values found'));
            }
          });
          probe.on('error', reject);
        });

        options._detectedCrop = cropVal;
        console.log(`[BitKit:Autocrop] Detected crop: ${cropVal}`);
      } catch (e) {
        console.warn('[BitKit:Autocrop] Detection failed, skipping crop:', e.message);
        options._detectedCrop = null;
      }
    }

    const { args, sourceInfo, durationMultiplier = 1 } = await buildFfmpegArgs(inputPath, outputPath, options, getBinPath);

    args.splice(args.length - 1, 0, '-progress', 'pipe:1', '-stats_period', '0.5');

    const passLogDir = os.tmpdir();
    const passLogPrefix = `bitkit_2pass_${id.replace(/-/g, '').substring(0, 8)}`;
    const isTwoPass = options.twoPass === true && (!options.hwAccel || options.hwAccel === 'none');

    const runFFmpeg = (passNum, passArgs) => {
      return new Promise((resolve, reject) => {
        const proc = spawn(ffmpeg, passArgs, { cwd: passLogDir });

        const existingConv = activeConversions.get(id) || { isCancelled: false };
        activeConversions.set(id, { proc, inputPath, outputPath, startTime: Date.now(), isCancelled: existingConv.isCancelled });

        if (existingConv.isCancelled) {
          proc.kill();
          reject(new Error('CANCELLED'));
          return;
        }

        let duration = 0;
        let lastErr = '';
        let stdoutLeftover = '';

        proc.stdout.on('data', (data) => {
          const chunk = data.toString();
          const lines = (stdoutLeftover + chunk).split('\n');

          stdoutLeftover = lines.pop() || '';

          for (const line of lines) {

            if (line.startsWith('duration=') && !duration) {
              const durStr = line.split('=')[1];
              duration = parseTimeToSeconds(durStr) * durationMultiplier;
            }

            if (line.startsWith('out_time_us=')) {
              const us = parseInt(line.split('=')[1]) || 0;
              const currentSec = us / 1000000;
              let percent = duration > 0 ? Math.min((currentSec / duration) * 100, 100) : 0;

              if (isTwoPass) {

                percent = passNum === 1 ? (percent / 2) : 50 + (percent / 2);
              }

              if (!event.sender.isDestroyed()) {
                event.sender.send('convert:progress', {
                  id,
                  percent: Math.round(percent * 10) / 10,
                  currentTime: formatSeconds(currentSec),
                  totalTime: formatSeconds(duration)
                });
              }
            }

            if (line.startsWith('speed=')) {
              const speed = line.split('=')[1]?.trim();
              if (!event.sender.isDestroyed()) {
                event.sender.send('convert:progress', { id, speed });
              }
            }
          }
        });

        proc.stderr.on('data', (data) => {
          const output = data.toString();
          lastErr += output;

          if (lastErr.length > 3000) lastErr = lastErr.slice(-2000).replace(/^[^]*?\n/, '');

          if (!duration) {
            const durMatch = lastErr.match(/^\s*Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/m);
            if (durMatch) {
              duration = (parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseInt(durMatch[3]) + parseInt(durMatch[4]) / 100) * durationMultiplier;
            }
          }
        });

        proc.on('close', (code) => {
          const conv = activeConversions.get(id);
          if (conv && conv.isCancelled) {
            reject(new Error('CANCELLED'));
            return;
          }
          if (code === 0) resolve();
          else reject(new Error(lastErr || 'FFmpeg exited with code ' + code));
        });

        proc.on('error', (err) => {
          const conv = activeConversions.get(id);
          if (conv && conv.isCancelled) {
            reject(new Error('CANCELLED'));
            return;
          }
          reject(err);
        });
      });
    };

    const cleanPassLogs = () => {
      try { fs.unlinkSync(path.join(passLogDir, `${passLogPrefix}-0.log`)); } catch (_) {}
      try { fs.unlinkSync(path.join(passLogDir, `${passLogPrefix}-0.log.mbtree`)); } catch (_) {}
    };

    try {
      if (isTwoPass) {

        let pass1Args = [...args];
        pass1Args.pop();

        const stripFlags = ['-c:a', '-b:a', '-ar', '-ac', '-af', '-filter:a'];
        let cleanArgs = [];
        for (let i = 0; i < pass1Args.length; i++) {
          if (stripFlags.includes(pass1Args[i])) {
            i++;
          } else {
            cleanArgs.push(pass1Args[i]);
          }
        }

        cleanArgs.push('-pass', '1', '-passlogfile', passLogPrefix, '-an', '-f', 'null', 'NUL');
        console.log(`[BitKit] FFMPEG 2-PASS (1/2): ffmpeg ${cleanArgs.join(' ')}`);
        await runFFmpeg(1, cleanArgs);

        const pass2Args = [...args];
        pass2Args.splice(pass2Args.length - 1, 0, '-pass', '2', '-passlogfile', passLogPrefix);
        console.log(`[BitKit] FFMPEG 2-PASS (2/2): ffmpeg ${pass2Args.join(' ')}`);
        await runFFmpeg(2, pass2Args);

        cleanPassLogs();
      } else {
        console.log(`[BitKit] FFMPEG COMMAND: ffmpeg ${args.join(' ')}`);
        await runFFmpeg(0, args);
      }

      reservedPaths.delete(outputPath);
      reservedPaths.delete(normalizedInput);
      if (!activeConversions.has(id)) return;
      activeConversions.delete(id);
      activeCount = Math.max(0, activeCount - 1);
      if (!event.sender.isDestroyed()) {
        event.sender.send('convert:complete', { id, outputPath });
      }
      processQueue(getBinPath);

    } catch (err) {
      reservedPaths.delete(outputPath);
      reservedPaths.delete(normalizedInput);
      if (!activeConversions.has(id)) return;
      activeConversions.delete(id);
      activeCount = Math.max(0, activeCount - 1);

      if (err.message === 'CANCELLED') {
        if (fs.existsSync(outputPath)) {
          fs.promises.unlink(outputPath).catch(() => {});
        }
        cleanPassLogs();
        processQueue(getBinPath);
        return;
      }

      const lastErr = err.message;
      const gpuKeywords = ['nvenc', 'amf', 'qsv', 'cuda', 'opencl', 'device', 'driver', 'gpu'];
      const isGpuError = gpuKeywords.some(kw => lastErr.toLowerCase().includes(kw));

      if (isGpuError && options.hwAccel !== 'none' && !options._gpuFallbackAttempted) {
         console.log(`[BitKit:Fallback] GPU encoder (${options.hwAccel}) başarısız oldu. CPU (none) ile yeniden deneniyor...`);
         if (!event.sender.isDestroyed()) {
           event.sender.send('convert:progress', { id, fallback: true, gpuCodec: options.hwAccel, cpuCodec: 'none' });
         }

         if (fs.existsSync(outputPath)) {
           try { fs.unlinkSync(outputPath); } catch (_) {}
         }

         const retryOptions = { ...options, hwAccel: 'none', _gpuFallbackAttempted: true };
         conversionQueue.unshift({ id, event, inputPath, requestedOutputPath, options: retryOptions });
         processQueue(getBinPath);
         return;
      }

      let cleanErr = lastErr;
      if (cleanErr.includes('Invalid data found when processing input')) {
        cleanErr = 'Invalid data found when processing input';
      } else {
        const lines = cleanErr.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        cleanErr = lines.slice(-4).join(' | ');
      }

      if (!event.sender.isDestroyed()) {
        event.sender.send('convert:error', { id, errorKey: 'backend.convertFailed', message: cleanErr });
      }
      processQueue(getBinPath);
    }
  }

  ipcMain.handle('convert:cancel', (event, id) => {

    const conversion = activeConversions.get(id);
    if (conversion) {
      conversion.isCancelled = true;
      if (conversion.proc) conversion.proc.kill();
      return { success: true };
    }

    const queueIdx = conversionQueue.findIndex(j => j.id === id);
    if (queueIdx !== -1) {
      conversionQueue.splice(queueIdx, 1);
      if (!event.sender.isDestroyed()) {
        event.sender.send('convert:error', { id, errorKey: 'backend.convertCancelled' });
      }
      return { success: true };
    }
    return { success: false, errorKey: 'backend.convertNotFound' };
  });
}

function parseTimeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  }
  return parseFloat(timeStr) || 0;
}

function formatSeconds(sec) {
  if (!sec || isNaN(sec)) return '00:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

module.exports = { register, activeConversions };
