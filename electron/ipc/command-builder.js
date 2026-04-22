const path = require('path');
const { spawn } = require('child_process');
const MEGA_MATRIX = require('../../src/js/core/codecCaps');

function getSourceInfo(inputPath, getBinPath) {
  return new Promise((resolve) => {
    const ffprobePath = getBinPath('ffprobe.exe');
    const ffprobeArgs = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      inputPath
    ];

    const probe = spawn(ffprobePath, ffprobeArgs, { timeout: 15000 });
    const chunks = [];

    probe.stdout.on('data', (data) => chunks.push(data));

    probe.on('close', (code) => {
      if (code !== 0) return resolve(null);
      try {
        const output = Buffer.concat(chunks).toString('utf8');
        const parsed = JSON.parse(output);
        const videoStream = parsed.streams.find(s => s.codec_type === 'video');
        const audioStream = parsed.streams.find(s => s.codec_type === 'audio');

        resolve({
          duration: parseFloat(parsed.format.duration || 0),
          videoCodec: videoStream ? videoStream.codec_name : null,
          audioCodec: audioStream ? audioStream.codec_name : null,
          width: videoStream ? videoStream.width : null,
          height: videoStream ? videoStream.height : null,
          audioBitrate: audioStream ? audioStream.bit_rate : null
        });
      } catch (err) {
        resolve(null);
      }
    });

    probe.on('error', () => resolve(null));
  });
}

async function buildFfmpegArgs(inputPath, outputPath, state, getBinPath) {
  const args = [];
  let durationMultiplier = 1;

  const sourceInfo = await getSourceInfo(inputPath, getBinPath) || {};
  const sourceExt = path.extname(inputPath).toLowerCase();
  const targetExt = path.extname(outputPath).toLowerCase();

  if (state.hwAccel !== 'none') {
    args.push('-hwaccel', 'auto');
  }

  let trimParams = null;
  if (state.templateId === 'trim' && state.templateParams) {
    trimParams = state.templateParams;
  } else if (state.templateId === 'multi_filter' && state.templateParams && state.templateParams.filters) {
    const trimFilter = state.templateParams.filters.find(f => f.id === 'trim');
    if (trimFilter) trimParams = trimFilter.params;
  }
  if (trimParams) {
    if (trimParams['trim-start']) args.push('-ss', trimParams['trim-start']);
    if (trimParams['trim-end']) args.push('-to', trimParams['trim-end']);
  }

  args.push('-i', inputPath);
  args.push('-y');

  args.push('-threads', '0');

  if (state.templateId) {
    const tid = state.templateId;
    const p = state.templateParams || {};

    switch (tid) {
      case 'smart_convert': {
        const vcodec = p['sc-vcodec'] || 'libx264';
        const acodec = p['sc-acodec'] || 'aac';

        args.push('-c:v', vcodec);
        if (vcodec !== 'copy') {
          if (vcodec === 'libvpx-vp9') {
            args.push('-crf', '14', '-b:v', '0', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1');
          } else if (vcodec === 'libaom-av1') {
            args.push('-crf', '14', '-b:v', '0', '-cpu-used', '4', '-row-mt', '1');
          } else if (['libx264', 'libx265'].includes(vcodec)) {
            args.push('-crf', '14', '-preset', 'slower');
          } else if (vcodec === 'mpeg4') {
            args.push('-vtag', 'xvid', '-q:v', '3');
          } else if (vcodec === 'mpeg2video') {
            args.push('-q:v', '3');
          } else {
            args.push('-q:v', '2');
          }
        }

        args.push('-c:a', acodec);
        if (acodec !== 'copy') {
          if (acodec === 'aac') args.push('-b:a', '256k');
          else if (acodec === 'libmp3lame') args.push('-b:a', '320k');
          else if (acodec === 'ac3' || acodec === 'eac3') args.push('-b:a', '640k');
          else if (acodec === 'libopus') args.push('-b:a', '192k');
          else if (acodec === 'wmav2') args.push('-b:a', '192k');
        }
        break;
      }
      case 'tiktok':
        args.push('-c:v', 'libx264', '-crf', '16', '-preset', 'faster');
        args.push('-vf', 'format=yuv444p,split[original][copy];[copy]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:20[bg];[original]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p');
        args.push('-c:a', 'aac', '-b:a', '192k');
        break;
      case 'discord_nitro': {
        let nitroKbps = 8000;
        if (sourceInfo.duration && sourceInfo.duration > 0) {
          const targetTotalKbps = (490 * 8192) / sourceInfo.duration;
          nitroKbps = Math.floor(targetTotalKbps - 192);
          nitroKbps = Math.max(500, Math.min(15000, nitroKbps));
        }
        args.push('-c:v', 'libx264', '-preset', 'faster', '-b:v', `${nitroKbps}k`, '-maxrate', `${nitroKbps}k`, '-bufsize', `${nitroKbps * 2}k`, '-c:a', 'aac', '-b:a', '192k');
        break;
      }
      case 'discord_basic': {
        let basicKbps = 1500;
        if (sourceInfo.duration && sourceInfo.duration > 0) {
          const targetTotalKbps = (9.5 * 8192) / sourceInfo.duration;
          basicKbps = Math.floor(targetTotalKbps - 128);
          basicKbps = Math.max(100, Math.min(5000, basicKbps));
        }
        args.push('-c:v', 'libx264', '-preset', 'faster', '-b:v', `${basicKbps}k`, '-maxrate', `${basicKbps}k`, '-bufsize', `${basicKbps * 2}k`, '-c:a', 'aac', '-b:a', '128k');
        break;
      }
      case 'whatsapp': {
        let waKbps = 8000;
        if (sourceInfo.duration && sourceInfo.duration > 0) {
          const targetTotalKbps = (95 * 8192) / sourceInfo.duration;
          waKbps = Math.floor(targetTotalKbps - 128);

          waKbps = Math.max(100, Math.min(30000, waKbps));
        }
        args.push('-c:v', 'libx264', '-preset', 'slow', '-b:v', `${waKbps}k`, '-maxrate', `${waKbps}k`, '-bufsize', `${waKbps * 2}k`, '-c:a', 'aac', '-b:a', '128k');
        break;
      }
      case 'timelapse': {
        const speedMultiplier = p.value ? parseFloat(p.value) : 4;
        const setpts = (1 / speedMultiplier).toFixed(4);
        durationMultiplier = 1 / speedMultiplier;
        args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '18');
        args.push('-vf', `setpts=${setpts}*PTS`);
        args.push('-an');
        break;
      }
      case 'slowmo': {
        const slowFactor = p.value ? parseFloat(p.value) : 2;
        durationMultiplier = slowFactor;
        args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '18');
        args.push('-vf', `setpts=${slowFactor.toFixed(4)}*PTS`);
        args.push('-an');
        break;
      }
      case 'rotate': {
        const direction = p.value || '90R';

        if (direction === 'flipH') {
          args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-c:a', 'copy', '-vf', 'hflip');
        } else if (direction === 'flipV') {
          args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-c:a', 'copy', '-vf', 'vflip');
        } else {
          args.push('-c:v', 'copy', '-c:a', 'copy');
          if (direction === '90R') args.push('-metadata:s:v', 'rotate=90');
          else if (direction === '90L') args.push('-metadata:s:v', 'rotate=-90');
          else if (direction === '180') args.push('-metadata:s:v', 'rotate=180');
        }
        break;
      }
      case 'reverse': {
        args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '18');
        args.push('-vf', 'reverse');
        args.push('-c:a', 'aac', '-b:a', '192k');
        args.push('-af', 'areverse');
        break;
      }
      case 'thumbnail':
        let sec = p.value ? parseInt(p.value) : 5;
        if (sourceInfo.duration && sec >= sourceInfo.duration) {
          sec = Math.max(0, Math.floor(sourceInfo.duration) - 1);
        }
        args.push('-ss', sec.toString(), '-vframes', '1', '-q:v', '2');
        break;
      case 'audio_only':
        args.push('-vn');
        const fmt = (p && p.value) ? p.value : 'mp3';
        if (fmt === 'original') {
          args.push('-c:a', 'copy');
        } else if (fmt === 'mp3') {
          args.push('-c:a', 'libmp3lame', '-b:a', '320k');
        } else if (fmt === 'aac' || fmt === 'm4a') {
          args.push('-c:a', 'aac', '-b:a', '256k');
        } else if (fmt === 'wav') {
          args.push('-c:a', 'pcm_s16le');
        } else if (fmt === 'flac') {
          args.push('-c:a', 'flac', '-sample_fmt', 's16');
        } else if (fmt === 'ogg') {
          args.push('-c:a', 'libvorbis', '-b:a', '192k');
        } else if (fmt === 'opus') {
          args.push('-c:a', 'libopus', '-b:a', '128k');
        }
        break;
      case 'video_mute': {
        const vfmt = p.value || 'original';
        args.push('-an');
        if (vfmt === 'original') {
          args.push('-c:v', 'copy');
        } else {
          if (vfmt === 'avi') {
            args.push('-c:v', 'mpeg4', '-vtag', 'xvid', '-q:v', '3');
          } else if (vfmt === 'webm') {
            args.push('-c:v', 'libvpx-vp9', '-crf', '14', '-b:v', '0', '-row-mt', '1');
          } else {
            args.push('-c:v', 'libx264', '-preset', 'slower', '-crf', '14');
          }
        }
        break;
      }
      case 'gif':
        args.push('-vf', 'fps=15,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse', '-loop', '0');
        break;
      case 'webp_anim':
        args.push('-c:v', 'libwebp', '-lossless', '0', '-q:v', '70', '-preset', 'default', '-loop', '0', '-an', '-vf', 'fps=15,scale=720:-1:flags=lanczos');
        break;
      case 'webm':
        args.push('-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-row-mt', '1', '-auto-alt-ref', '0', '-c:a', 'libopus');
        break;
      case 'max_compression': {
        let dynamicCrf = 24;
        if (sourceInfo && sourceInfo.height) {

          let calc = Math.round(20 + 4 * Math.log2(sourceInfo.height / 1080));
          dynamicCrf = Math.max(14, Math.min(40, calc));
        }
        args.push('-c:v', 'libx265', '-crf', dynamicCrf.toString(), '-preset', 'slow', '-tag:v', 'hvc1', '-c:a', 'aac', '-b:a', '192k');
        break;
      }
      case 'trim': {
        const mode = p['trim-mode'] || 'fast';
        if (mode === 'fast') {
          args.push('-c', 'copy');
        } else {
          args.push('-c:v', 'libx264', '-preset', 'slower', '-crf', '14', '-c:a', 'aac', '-b:a', '192k');
        }
        break;
      }
      case 'volume_boost': {
        const vol = p.value ? parseInt(p.value) : 200;
        args.push('-c:v', 'copy');
        args.push('-af', `volume=${(vol / 100).toFixed(2)}`);
        args.push('-c:a', 'aac', '-b:a', '192k');
        break;
      }
      case 'split': {
        const segTime = p.value ? parseInt(p.value) : 15;
        args.push('-c', 'copy');
        args.push('-f', 'segment', '-segment_time', segTime.toString(), '-reset_timestamps', '1');
        const ext = path.extname(outputPath);
        const base = outputPath.slice(0, -ext.length);
        outputPath = `${base}_%03d${ext}`;
        break;
      }
      case 'grayscale': {
        args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16');
        args.push('-vf', 'format=gray');
        args.push('-c:a', 'copy');
        break;
      }
      case 'deshake': {
        args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16');
        args.push('-vf', 'deshake');
        args.push('-c:a', 'copy');
        break;
      }
      case 'denoise': {
        const dnVal = p.value ? parseInt(p.value) : 50;
        let luma = parseFloat((dnVal / 10).toFixed(1));
        let tmp = parseFloat((dnVal / 10 * 1.5).toFixed(1));
        if (luma < 1.0) luma = 1.0;
        if (tmp < 1.0) tmp = 1.0;
        args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16');
        args.push('-vf', `hqdn3d=${luma}:${luma}:${tmp}:${tmp}`);
        args.push('-c:a', 'copy');
        break;
      }
      case 'sharpen': {
        const shVal = p.value ? parseInt(p.value) : 50;
        let amount = parseFloat((shVal / 50).toFixed(2));
        if (amount < 0.1) amount = 0.1;
        args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16');
        args.push('-vf', `unsharp=5:5:${amount}`);
        args.push('-c:a', 'copy');
        break;
      }
      case 'loudnorm': {
        args.push('-c:v', 'copy');
        args.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
        args.push('-c:a', 'aac', '-b:a', '192k');
        break;
      }
      case 'audio_denoise': {
        const adVal = p.value ? parseInt(p.value) : 50;
        const nr = Math.round(4 + (adVal / 100) * 20);
        args.push('-c:v', 'copy');
        args.push('-af', `afftdn=nr=${nr}`);
        args.push('-c:a', 'aac', '-b:a', '192k');
        break;
      }
      case 'autocrop': {

        const detectedCrop = state._detectedCrop;
        args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16');
        if (detectedCrop) {
          args.push('-vf', `crop=${detectedCrop}`);
        }
        args.push('-c:a', 'copy');
        break;
      }
      case 'deblock': {
        const dbVal = p.value ? parseInt(p.value) : 50;
        let strength = Math.ceil(dbVal / 16.6);
        if (strength < 1) strength = 1;
        if (strength > 6) strength = 6;
        const alpha = (strength / 6).toFixed(2);
        args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16');
        args.push('-vf', `deblock=filter=weak:block=4:alpha=${alpha}:beta=${alpha}:gamma=${alpha}:delta=${alpha}`);
        args.push('-c:a', 'copy');
        break;
      }
      case 'hdr2sdr': {
        args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16');
        args.push('-vf', 'format=gbrpf32le,tonemap=hable:desat=0,format=yuv420p');
        args.push('-c:a', 'copy');
        break;
      }
      case 'deinterlace': {
        args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16');
        args.push('-vf', 'bwdif=1');
        args.push('-c:a', 'copy');
        break;
      }
      case 'minterpolate': {
        args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16');
        args.push('-vf', "minterpolate='mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=60'");
        args.push('-fps_mode', 'cfr');
        args.push('-c:a', 'copy');
        break;
      }
      case 'multi_filter': {

        const filters = p.filters || [];
        let vFilters = [];
        let aFilters = [];
        let needsFpsMode = false;
        let speedMultiplier = null;
        let isSplit = false;
        let splitTime = 15;
        let forceVideoReencode = false;

        filters.forEach(f => {
          const fp = f.params || {};
          const val = fp.value ? parseInt(fp.value) : 50;

          switch (f.id) {

            case 'trim':
              if (fp['trim-mode'] === 'precise') {
                forceVideoReencode = true;
              }
              break;
            case 'timelapse': {
              const speed = fp.value ? parseFloat(fp.value) : 4;
              speedMultiplier = speed;
              vFilters.push(`setpts=${(1 / speed).toFixed(4)}*PTS`);
              durationMultiplier = 1 / speed;
              break;
            }
            case 'slowmo': {
              const slow = fp.value ? parseFloat(fp.value) : 2;
              speedMultiplier = 1 / slow;
              vFilters.push(`setpts=${slow.toFixed(4)}*PTS`);
              durationMultiplier = slow;
              break;
            }
            case 'rotate': {
              const dir = fp.value || '90R';
              if (dir === 'flipH') vFilters.push('hflip');
              else if (dir === 'flipV') vFilters.push('vflip');
              else if (dir === '90R') vFilters.push('transpose=1');
              else if (dir === '90L') vFilters.push('transpose=2');
              else if (dir === '180') vFilters.push('transpose=1,transpose=1');
              break;
            }
            case 'reverse':
              vFilters.push('reverse');
              aFilters.push('areverse');
              break;
            case 'split':
              isSplit = true;
              splitTime = fp.value ? parseInt(fp.value) : 15;
              break;
            case 'autocrop': {
              const crop = state._detectedCrop;
              if (crop) vFilters.push(`crop=${crop}`);
              break;
            }

            case 'grayscale':
              vFilters.push('format=gray');
              break;
            case 'deshake':
              vFilters.push('deshake');
              break;
            case 'denoise': {
              let luma = parseFloat((val / 10).toFixed(1));
              let tmp = parseFloat((val / 10 * 1.5).toFixed(1));
              if (luma < 1.0) luma = 1.0;
              if (tmp < 1.0) tmp = 1.0;
              vFilters.push(`hqdn3d=${luma}:${luma}:${tmp}:${tmp}`);
              break;
            }
            case 'sharpen': {
              let amount = parseFloat((val / 50).toFixed(2));
              if (amount < 0.1) amount = 0.1;
              vFilters.push(`unsharp=5:5:${amount}`);
              break;
            }
            case 'deblock': {
              let strength = Math.ceil(val / 16.6);
              if (strength < 1) strength = 1;
              if (strength > 6) strength = 6;
              const alpha = (strength / 6).toFixed(2);
              vFilters.push(`deblock=filter=weak:block=4:alpha=${alpha}:beta=${alpha}:gamma=${alpha}:delta=${alpha}`);
              break;
            }
            case 'hdr2sdr':
              vFilters.push('format=gbrpf32le,tonemap=hable:desat=0,format=yuv420p');
              break;
            case 'deinterlace':
              vFilters.push('bwdif=1');
              break;
            case 'minterpolate':
              vFilters.push("minterpolate='mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=60'");
              needsFpsMode = true;
              break;

            case 'volume_boost': {
              const vol = fp.value ? parseInt(fp.value) : 200;
              aFilters.push(`volume=${(vol / 100).toFixed(2)}`);
              break;
            }
            case 'loudnorm':
              aFilters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
              break;
            case 'audio_denoise': {
              const adVal = fp.value ? parseInt(fp.value) : 50;
              const nr = Math.round(4 + (adVal / 100) * 20);
              aFilters.push(`afftdn=nr=${nr}`);
              break;
            }
          }
        });

        if (speedMultiplier) {

          const buildAtempo = (tempo) => {
            const parts = [];
            if (tempo < 0.5) {
              while (tempo < 0.5) { parts.push('atempo=0.5'); tempo /= 0.5; }
              parts.push(`atempo=${tempo.toFixed(4)}`);
            } else if (tempo > 2.0) {
              while (tempo > 2.0) { parts.push('atempo=2.0'); tempo /= 2.0; }
              parts.push(`atempo=${tempo.toFixed(4)}`);
            } else {
              parts.push(`atempo=${tempo.toFixed(4)}`);
            }
            return parts;
          };

          const hasReverse = filters.some(f => f.id === 'reverse');
          if (hasReverse) {

            const reverseIdx = aFilters.indexOf('areverse');
            if (reverseIdx !== -1) aFilters.splice(reverseIdx, 1);
            aFilters.push(...buildAtempo(speedMultiplier));
            aFilters.push('areverse');
          } else {
            aFilters.push(...buildAtempo(speedMultiplier));
          }
        }

        const vFilterOrder = [
          'format=gbrpf32le',
          'crop=',
          'transpose=', 'hflip', 'vflip',
          'bwdif=',
          'deshake',
          'hqdn3d=',
          'deblock=',
          'unsharp=',
          'format=gray',
          'setpts=',
          'reverse',
          'minterpolate',
        ];

        vFilters.sort((a, b) => {
          const aOrder = vFilterOrder.findIndex(prefix => a.startsWith(prefix));
          const bOrder = vFilterOrder.findIndex(prefix => b.startsWith(prefix));
          return (aOrder === -1 ? 999 : aOrder) - (bOrder === -1 ? 999 : bOrder);
        });

        if (vFilters.length > 0 || forceVideoReencode) {
          args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16');
          if (vFilters.length > 0) {
            args.push('-vf', vFilters.join(','));
          }
          if (needsFpsMode) args.push('-fps_mode', 'cfr');
        } else {
          args.push('-c:v', 'copy');
        }

        if (aFilters.length > 0) {
          args.push('-af', aFilters.join(','));
          args.push('-c:a', 'aac', '-b:a', '192k');
        } else {
          args.push('-c:a', 'copy');
        }

        if (isSplit) {
          args.push('-f', 'segment', '-segment_time', splitTime.toString(), '-reset_timestamps', '1');
          const ext = path.extname(outputPath);
          const base = outputPath.slice(0, -ext.length);
          outputPath = `${base}_%03d${ext}`;
        }
        break;
      }
    }

    if (trimParams) {
      args.push('-avoid_negative_ts', 'make_zero');
    }

    const movFlagExts = ['.mp4', '.mov', '.m4v', '.3gp', '.m4a'];
    if (movFlagExts.includes(targetExt)) {
      args.push('-movflags', '+faststart');
    }

    args.push(outputPath);
    return { args, sourceInfo, durationMultiplier };
  }

  if (state.operationMode === 'audio_only') {
    args.push('-vn');
  } else {

    let targetVCodec = state.videoCodec;

    if (state.hwAccel && state.hwAccel !== 'none' && MEGA_MATRIX.hardwareEmitters) {
      const hwMap = MEGA_MATRIX.hardwareEmitters[state.hwAccel];
      if (hwMap && hwMap[targetVCodec]) {
        targetVCodec = hwMap[targetVCodec];
      }
    }

    args.push('-c:v', targetVCodec);

    if (targetVCodec !== 'copy') {
         const vConstraints = MEGA_MATRIX.videoCodecConstraints?.[state.videoCodec];

         if (state.qualityMode === 'crf') {
           if (targetVCodec === 'mpeg4' || targetVCodec === 'mpeg2video') {
             args.push('-qscale:v', state.crf.toString());
            } else if (targetVCodec.includes('nvenc')) {
              args.push('-cq', state.crf.toString());
            } else if (targetVCodec.includes('qsv')) {
              args.push('-global_quality', state.crf.toString());
            } else if (targetVCodec.includes('amf')) {
              args.push('-rc', 'cqp', '-qp_i', state.crf.toString(), '-qp_p', state.crf.toString());
            } else {
              args.push('-crf', state.crf.toString());
              if (state.videoCodec === 'libvpx-vp9' || state.videoCodec === 'libaom-av1') {
                args.push('-b:v', '0');
              }
            }
         } else if (state.qualityMode === 'bitrate') {
            let vbr = parseInt(state.videoBitrate, 10);
            if (isNaN(vbr)) vbr = 5000;
            if (vConstraints && vConstraints.maxBitrate && vbr > vConstraints.maxBitrate) {
               console.warn(`[BitKit] ${targetVCodec} video bitrate clamped from ${vbr} to ${vConstraints.maxBitrate}`);
               vbr = vConstraints.maxBitrate;
            }
            args.push('-b:v', vbr.toString() + 'k');
         }

          if (state.preset) {
            const cpuPresets = ['ultrafast','superfast','veryfast','faster','fast','medium','slow','slower','veryslow'];
            const nvencPresets = ['p1','p2','p3','p4','p5','p6','p7'];
            const amfPresets = ['speed','balanced','quality'];

            let safePreset = state.preset;
            const baseCodec = state.videoCodec;

            if (baseCodec === 'libvpx-vp9') {
              const vp9Map = { veryslow: 0, slower: 1, slow: 2, medium: 3, fast: 4, faster: 5, veryfast: 5, superfast: 5, ultrafast: 5 };
              const cpuUsed = vp9Map[safePreset] ?? 1;
              args.push('-deadline', 'good', '-cpu-used', cpuUsed.toString(), '-row-mt', '1');
            } else if (baseCodec === 'libaom-av1') {
              const av1Map = { veryslow: 1, slower: 2, slow: 3, medium: 4, fast: 5, faster: 6, veryfast: 7, superfast: 8, ultrafast: 8 };
              const cpuUsed = av1Map[safePreset] ?? 2;
              args.push('-cpu-used', cpuUsed.toString(), '-row-mt', '1');
            } else if (targetVCodec.includes('nvenc')) {
              if (!nvencPresets.includes(safePreset)) safePreset = 'p7';
              args.push('-preset', safePreset);
            } else if (targetVCodec.includes('amf')) {
              if (!amfPresets.includes(safePreset)) safePreset = 'quality';
              args.push('-quality', safePreset);
            } else if (targetVCodec.includes('qsv')) {

            } else {
              if (!cpuPresets.includes(safePreset)) safePreset = 'medium';
              args.push('-preset', safePreset);
            }
          }

          let vFilters = [];

          if (state.filters) {

            const fVals = state.filterValues || { denoise: 50, deblock: 50, sharpen: 50 };

            if (state.filters.hdr2sdr) vFilters.push('format=gbrpf32le,tonemap=hable:desat=0,format=yuv420p');

            if (state.filters.deinterlace) vFilters.push('bwdif=1');

            if (state.filters.denoise) {
              let luma = parseFloat(((fVals.denoise || 50) / 10).toFixed(1));
              let tmp = parseFloat(((fVals.denoise || 50) / 10 * 1.5).toFixed(1));

              if(luma < 1.0) luma = 1.0;
              if(tmp < 1.0) tmp = 1.0;
              vFilters.push(`hqdn3d=${luma}:${luma}:${tmp}:${tmp}`);
            }

            if (state.filters.deblock) {
              let strength = Math.ceil((fVals.deblock || 50) / 16.6);
              if (strength < 1) strength = 1;
              if (strength > 6) strength = 6;
              const alpha = (strength / 6).toFixed(2);
              vFilters.push(`deblock=filter=weak:block=4:alpha=${alpha}:beta=${alpha}:gamma=${alpha}:delta=${alpha}`);
            }

            if (state.filters.deshake) vFilters.push('deshake');

            if (state.filters.sharpen) {
              let amount = parseFloat(((fVals.sharpen || 50) / 50).toFixed(1));
              if (amount < 0.1) amount = 0.1;
              vFilters.push(`unsharp=5:5:${amount}`);
            }

            if (state.filters.minterpolate) vFilters.push("minterpolate='mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=60'");
          }

          if (state.resolution && state.resolution !== 'original') {
            let [w, h] = state.resolution.split('x');
             w = parseInt(w, 10);
             h = parseInt(h, 10);

             if (vConstraints) {
               if (vConstraints.maxWidth && w > vConstraints.maxWidth) {
                 console.warn(`[BitKit] ${targetVCodec} width clamped from ${w} to ${vConstraints.maxWidth}`);
                 w = vConstraints.maxWidth;
               }
               if (vConstraints.maxHeight && h > vConstraints.maxHeight) {
                 console.warn(`[BitKit] ${targetVCodec} height clamped from ${h} to ${vConstraints.maxHeight}`);
                 h = vConstraints.maxHeight;
               }
             }

             w = Math.floor(w / 2) * 2;
             h = Math.floor(h / 2) * 2;

            vFilters.push(`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:trunc((ow-iw)/2):trunc((oh-ih)/2)`);
          } else if (vFilters.length > 0 || state.videoCodec !== 'copy') {

            vFilters.push(`scale=trunc(iw/2)*2:trunc(ih/2)*2`);
          }

          if (vFilters.length > 0) {
            args.push('-vf', vFilters.join(','));
          }

          if (state.filters && state.filters.minterpolate) {
            args.push('-fps_mode', 'cfr');
          } else if (state.fps && state.fps !== 'original') {
            let fpsNum = parseFloat(state.fps);
            if (vConstraints && vConstraints.maxFps && fpsNum > vConstraints.maxFps) {
               console.warn(`[BitKit] ${targetVCodec} FPS clamped from ${fpsNum} to ${vConstraints.maxFps}`);
               fpsNum = vConstraints.maxFps;
            }
            args.push('-r', fpsNum.toString());
          }
       }
  }

  if (state.operationMode === 'video_only') {
    args.push('-an');
  } else {
    let targetACodec = state.audioCodec;

    args.push('-c:a', targetACodec);

    if (targetACodec === 'flac') {
      args.push('-sample_fmt', 's16');
    }

    if (targetACodec !== 'copy') {
         const constraints = MEGA_MATRIX.audioCodecConstraints?.[targetACodec];
         const isLossless = constraints?.lossless === true;

         if (!isLossless) {
           let abr = null;
           if (state.audioBitrate && state.audioBitrate !== 'original') {
             abr = parseInt(state.audioBitrate, 10);
           } else if (sourceInfo.audioBitrate) {
             abr = Math.floor(parseInt(sourceInfo.audioBitrate, 10) / 1000);
           }

           if (abr !== null) {
             if (isNaN(abr)) abr = 192;
             if (constraints && constraints.maxBitrate && abr > constraints.maxBitrate) {
                 console.warn(`[BitKit] ${targetACodec} audio bitrate clamped from ${abr} to ${constraints.maxBitrate}`);
                 abr = constraints.maxBitrate;
             }
             args.push('-b:a', abr.toString() + 'k');
           }
         }

         if (state.sampleRate && state.sampleRate !== 'original') {
           let sr = parseInt(state.sampleRate, 10);
           if (constraints && constraints.sampleRates) {
             const maxSr = Math.max(...constraints.sampleRates);
             if (sr > maxSr) {
                console.warn(`[BitKit] ${targetACodec} sample rate clamped from ${sr} to ${maxSr}`);
                sr = maxSr;
             }
           }
           args.push('-ar', sr.toString());
         }

         if (state.channels && state.channels !== 'original') {
           let ch = parseInt(state.channels, 10);
           if (constraints && constraints.maxChannels && ch > constraints.maxChannels) {
               console.warn(`[BitKit] ${targetACodec} channels clamped from ${ch} to ${constraints.maxChannels}`);
               ch = constraints.maxChannels;
           }
           args.push('-ac', ch.toString());
         }

         let aFilters = [];

         if (state.filters) {
           const fVals = state.filterValues || {};
           if (state.filters.audiodenoise) {
             let nr = Math.round(4 + ((fVals.audiodenoise || 50) / 100) * 20);
             aFilters.push(`afftdn=nr=${nr}`);
           }
           if (state.filters.loudnorm) {
             aFilters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
             aFilters.push('aresample=48000');
           }
         }

         if (state.volume && state.volume !== 'original' && !(state.filters && state.filters.loudnorm)) {
            const v = parseFloat(state.volume) / 100;
            aFilters.push(`volume=${v}`);
         }

         if (aFilters.length > 0) {
           args.push('-filter:a', aFilters.join(','));
         }

       }
  }

  args.push('-sn', '-dn');

  const movFlagFormats = ['.mp4', '.mov', '.m4v', '.3gp', '.m4a'];
  if (movFlagFormats.includes(targetExt)) {
    args.push('-movflags', '+faststart');
  }
  args.push(outputPath);

  return { args, sourceInfo, durationMultiplier };
}

module.exports = {
  buildFfmpegArgs,
  getSourceInfo
};
