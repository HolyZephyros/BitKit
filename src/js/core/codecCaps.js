
const MEGA_MATRIX = {

    containers: {

        'mp4': { group: 'modern', videoCodecs: ['libx264', 'libx265', 'libaom-av1', 'libvpx-vp9', 'mpeg4'], audioCodecs: ['aac', 'libmp3lame', 'alac', 'ac3', 'libopus'] },
        'mkv': { group: 'modern', videoCodecs: ['libx264', 'libx265', 'libaom-av1', 'libvpx-vp9', 'libvpx', 'mpeg4', 'prores', 'dnxhd', 'mpeg2video'], audioCodecs: ['aac', 'libmp3lame', 'flac', 'libvorbis', 'libopus', 'ac3', 'eac3', 'truehd', 'dts', 'alac'] },
        'webm': { group: 'modern', videoCodecs: ['libvpx-vp9', 'libvpx', 'libaom-av1'], audioCodecs: ['libopus', 'libvorbis'] },
        'mov': { group: 'modern', videoCodecs: ['libx264', 'libx265', 'prores', 'dnxhd', 'mpeg4'], audioCodecs: ['aac', 'alac', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le'] },
        'm4v': { group: 'modern', videoCodecs: ['libx264', 'libx265'], audioCodecs: ['aac', 'alac'] },
        'gif': { group: 'modern', videoCodecs: ['gif'], audioCodecs: [] },
        'apng': { group: 'modern', videoCodecs: ['apng'], audioCodecs: [] },
        'webp': { group: 'modern', videoCodecs: ['libwebp_anim', 'libwebp'], audioCodecs: [] },
        'avif': { group: 'modern', videoCodecs: ['libaom-av1'], audioCodecs: [] },

        'mp3': { group: 'audio', videoCodecs: [], audioCodecs: ['libmp3lame'] },
        'm4a': { group: 'audio', videoCodecs: [], audioCodecs: ['aac', 'alac'] },
        'flac': { group: 'audio', videoCodecs: [], audioCodecs: ['flac'] },
        'wav': { group: 'audio', videoCodecs: [], audioCodecs: ['pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le'] },
        'ogg': { group: 'audio', videoCodecs: [], audioCodecs: ['libvorbis', 'libopus', 'flac'] },
        'wma': { group: 'audio', videoCodecs: [], audioCodecs: ['wmav2', 'wmav1'] },
        'ac3': { group: 'audio', videoCodecs: [], audioCodecs: ['ac3'] },
        'aac': { group: 'audio', videoCodecs: [], audioCodecs: ['aac'] },
        'opus': { group: 'audio', videoCodecs: [], audioCodecs: ['libopus'] },
        'aiff': { group: 'audio', videoCodecs: [], audioCodecs: ['pcm_s16be'] },
        'amr': { group: 'audio', videoCodecs: [], audioCodecs: ['amr_nb', 'amr_wb'] },
        'mka': { group: 'audio', videoCodecs: [], audioCodecs: ['flac', 'libvorbis', 'libopus', 'aac', 'libmp3lame', 'pcm_s24le', 'pcm_s16le'] },

        'avi': { group: 'legacy', videoCodecs: ['mpeg4', 'libx264', 'mjpeg'], audioCodecs: ['libmp3lame', 'ac3', 'pcm_s16le', 'pcm_s24le'] },
        'wmv': { group: 'legacy', videoCodecs: ['wmv2', 'wmv1'], audioCodecs: ['wmav2', 'wmav1'] },
        'flv': { group: 'legacy', videoCodecs: ['flv1', 'libx264'], audioCodecs: ['libmp3lame', 'aac'] },
        'mpg': { group: 'legacy', videoCodecs: ['mpeg2video', 'mpeg1video'], audioCodecs: ['mp2', 'ac3'] },
        'mpeg': { group: 'legacy', videoCodecs: ['mpeg2video', 'mpeg1video'], audioCodecs: ['mp2', 'ac3'] },
        'vob': { group: 'legacy', videoCodecs: ['mpeg2video'], audioCodecs: ['ac3', 'mp2'] },
        '3gp': { group: 'legacy', videoCodecs: ['h263', 'mpeg4', 'libx264'], audioCodecs: ['amr_nb', 'aac'] },
        '3g2': { group: 'legacy', videoCodecs: ['h263', 'mpeg4', 'libx264'], audioCodecs: ['amr_nb', 'aac'] },
        'asf': { group: 'legacy', videoCodecs: ['wmv2', 'wmv1', 'mpeg4'], audioCodecs: ['wmav2', 'wmav1', 'libmp3lame'] },

        'ts': { group: 'pro', videoCodecs: ['libx264', 'libx265', 'mpeg2video'], audioCodecs: ['aac', 'ac3', 'mp2'] },
        'mts': { group: 'pro', videoCodecs: ['libx264', 'libx265', 'mpeg2video'], audioCodecs: ['ac3'] },
        'm2ts': { group: 'pro', videoCodecs: ['libx264', 'libx265', 'mpeg2video'], audioCodecs: ['ac3', 'pcm_s16le'] },
        'mxf': { group: 'pro', videoCodecs: ['prores', 'dnxhd', 'mpeg2video', 'libx264'], audioCodecs: ['pcm_s16le', 'pcm_s24le'] }
    },

    hardwareEmitters: {
        'videotoolbox': {
            'libx264': 'h264_videotoolbox',
            'libx265': 'hevc_videotoolbox'
        },
        'nvenc': {
            'libx264': 'h264_nvenc',
            'libx265': 'hevc_nvenc',
            'libaom-av1': 'av1_nvenc'
        },
        'amf': {
            'libx264': 'h264_amf',
            'libx265': 'hevc_amf',
            'libaom-av1': 'av1_amf'
        },
        'qsv': {
            'libx264': 'h264_qsv',
            'libx265': 'hevc_qsv',
            'libaom-av1': 'av1_qsv',
            'libvpx-vp9': 'vp9_qsv'
        }
    },

    videoCodecConstraints: {
        'libx264':      { maxWidth: 4096, maxHeight: 2304, maxFps: 360, maxBitrate: 500000 },
        'libx265':      { maxWidth: 8192, maxHeight: 4320, maxFps: 360, maxBitrate: 500000 },
        'libaom-av1':   { maxWidth: 8192, maxHeight: 4320, maxFps: 360, maxBitrate: 500000 },
        'libvpx-vp9':   { maxWidth: 8192, maxHeight: 4320, maxFps: 360, maxBitrate: 500000 },
        'libvpx':       { maxWidth: 4096, maxHeight: 2160, maxFps: 240, maxBitrate: 200000 },
        'mpeg4':        { maxWidth: 1920, maxHeight: 1080, maxFps: 120,  maxBitrate: 50000 },
        'mpeg2video':   { maxWidth: 1920, maxHeight: 1080, maxFps: 120,  maxBitrate: 100000 },
        'mpeg1video':   { maxWidth: 1920, maxHeight: 1080, maxFps: 60,  maxBitrate: 20000 },
        'prores':       { maxWidth: 8192, maxHeight: 4320, maxFps: 360, maxBitrate: 1500000 },
        'dnxhd':        { maxWidth: 1920, maxHeight: 1080, maxFps: 120,  maxBitrate: 500000 },
        'gif':          { maxWidth: 1920, maxHeight: 1080, maxFps: 60,  maxBitrate: 100000 },
        'apng':         { maxWidth: 8192, maxHeight: 4320, maxFps: 60,  maxBitrate: 200000 },
        'libwebp':      { maxWidth: 16383, maxHeight: 16383, maxFps: 60, maxBitrate: 100000 },
        'libwebp_anim': { maxWidth: 16383, maxHeight: 16383, maxFps: 60, maxBitrate: 100000 },
        'mjpeg':        { maxWidth: 8192, maxHeight: 4320, maxFps: 120, maxBitrate: 200000 },
        'wmv1':         { maxWidth: 1920, maxHeight: 1080, maxFps: 60,  maxBitrate: 50000 },
        'wmv2':         { maxWidth: 1920, maxHeight: 1080, maxFps: 60,  maxBitrate: 50000 },
        'flv1':         { maxWidth: 1920, maxHeight: 1080, maxFps: 60,  maxBitrate: 50000 },
        'h263':         { maxWidth: 1408, maxHeight: 1152, maxFps: 60,  maxBitrate: 20000 }
    },

    audioCodecConstraints: {
        'aac':         { maxChannels: 8,  sampleRates: [192000, 96000, 88200, 48000, 44100, 32000, 22050, 16000, 8000], maxBitrate: 1000 },
        'libmp3lame':  { maxChannels: 2,  sampleRates: [48000, 44100, 32000, 22050, 16000, 8000], maxBitrate: 320 },
        'flac':        { maxChannels: 8,  sampleRates: [384000, 192000, 96000, 88200, 48000, 44100, 32000, 22050, 16000, 8000], lossless: true },
        'libvorbis':   { maxChannels: 8,  sampleRates: [48000, 44100, 32000, 22050, 16000, 8000], maxBitrate: 500 },
        'libopus':     { maxChannels: 8,  sampleRates: [48000], maxBitrate: 512 },
        'alac':        { maxChannels: 8,  sampleRates: [384000, 192000, 96000, 88200, 48000, 44100, 32000], lossless: true },
        'ac3':         { maxChannels: 6,  sampleRates: [48000, 44100, 32000], maxBitrate: 640 },
        'eac3':        { maxChannels: 16, sampleRates: [48000, 44100, 32000], maxBitrate: 6144 },
        'pcm_s16le':   { maxChannels: 8,  sampleRates: [192000, 96000, 88200, 48000, 44100, 32000, 22050, 16000, 8000], lossless: true },
        'pcm_s24le':   { maxChannels: 8,  sampleRates: [384000, 192000, 96000, 88200, 48000, 44100], lossless: true },
        'pcm_s32le':   { maxChannels: 8,  sampleRates: [384000, 192000, 96000, 88200, 48000, 44100], lossless: true },
        'pcm_f32le':   { maxChannels: 8,  sampleRates: [384000, 192000, 96000, 88200, 48000, 44100], lossless: true },
        'pcm_s16be':   { maxChannels: 8,  sampleRates: [192000, 96000, 88200, 48000, 44100, 32000, 22050, 16000, 8000], lossless: true },
        'wmav2':       { maxChannels: 2,  sampleRates: [48000, 44100, 22050], maxBitrate: 320 },
        'wmav1':       { maxChannels: 2,  sampleRates: [48000, 44100, 22050], maxBitrate: 320 },
        'amr_nb':      { maxChannels: 1,  sampleRates: [8000], maxBitrate: 13 },
        'amr_wb':      { maxChannels: 1,  sampleRates: [16000], maxBitrate: 24 },
        'mp2':         { maxChannels: 2,  sampleRates: [48000, 44100], maxBitrate: 384 },
        'dts':         { maxChannels: 6,  sampleRates: [48000, 44100], maxBitrate: 1536 },
        'truehd':      { maxChannels: 8,  sampleRates: [192000, 96000, 48000], lossless: true }
    }
};

if(typeof module !== 'undefined') module.exports = MEGA_MATRIX;
if(typeof window !== 'undefined') window.MEGA_MATRIX = MEGA_MATRIX;
