const { execFile } = require('child_process');

function register(ipcMain, getBinPath) {
  ipcMain.handle('media:getInfo', async (event, filePath) => {
    const ffprobe = getBinPath('ffprobe.exe');

    return new Promise((resolve) => {
      execFile(ffprobe, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
      ], { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, errorKey: 'backend.ffprobeError', errorParams: { err: error.message } });
          return;
        }

        try {
          const info = JSON.parse(stdout);
          const format = info.format || {};
          const streams = info.streams || [];

          const videoStreams = streams.filter(s => s.codec_type === 'video');
          const audioStreams = streams.filter(s => s.codec_type === 'audio');
          const subtitleStreams = streams.filter(s => s.codec_type === 'subtitle');

          resolve({
            success: true,
            data: {
              filename: format.filename || '',
              duration: parseFloat(format.duration) || 0,
              size: parseInt(format.size) || 0,
              bitrate: parseInt(format.bit_rate) || 0,
              formatName: format.format_name || '',
              formatLong: format.format_long_name || '',
              tags: format.tags || {},
              video: videoStreams.map(v => ({
                codec: v.codec_name || '',
                codecLong: v.codec_long_name || '',
                width: v.width || 0,
                height: v.height || 0,
                fps: (() => { const p = (v.r_frame_rate || '').split('/'); return p.length === 2 ? (Number(p[0]) / Number(p[1])) : Number(p[0]) || 0; })(),
                bitrate: parseInt(v.bit_rate) || 0,
                pixelFormat: v.pix_fmt || '',
                profile: v.profile || ''
              })),
              audio: audioStreams.map(a => ({
                codec: a.codec_name || '',
                codecLong: a.codec_long_name || '',
                sampleRate: parseInt(a.sample_rate) || 0,
                channels: a.channels || 0,
                channelLayout: a.channel_layout || '',
                bitrate: parseInt(a.bit_rate) || 0,
                language: a.tags?.language || ''
              })),
              subtitles: subtitleStreams.map(s => ({
                codec: s.codec_name || '',
                language: s.tags?.language || '',
                title: s.tags?.title || ''
              }))
            }
          });
        } catch (e) {
          resolve({ success: false, errorKey: 'backend.jsonParseError', errorParams: { err: e.message } });
        }
      });
    });
  });
}

module.exports = { register };
