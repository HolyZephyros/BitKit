/// Direct Rust mirror of src/js/core/codecCaps.js MEGA_MATRIX

pub struct VideoCodecConstraints {
    pub max_width: u32,
    pub max_height: u32,
    pub max_fps: f64,
    pub max_bitrate: u32,
}

pub struct AudioCodecConstraints {
    pub max_channels: u32,
    pub max_sample_rate: u32,
    pub max_bitrate: Option<u32>,
    pub lossless: bool,
}

pub fn hardware_emitter(hw_accel: &str, video_codec: &str) -> Option<&'static str> {
    match (hw_accel, video_codec) {
        ("videotoolbox", "libx264") => Some("h264_videotoolbox"),
        ("videotoolbox", "libx265") => Some("hevc_videotoolbox"),
        ("nvenc", "libx264") => Some("h264_nvenc"),
        ("nvenc", "libx265") => Some("hevc_nvenc"),
        ("nvenc", "libaom-av1") => Some("av1_nvenc"),
        ("amf", "libx264") => Some("h264_amf"),
        ("amf", "libx265") => Some("hevc_amf"),
        ("amf", "libaom-av1") => Some("av1_amf"),
        ("qsv", "libx264") => Some("h264_qsv"),
        ("qsv", "libx265") => Some("hevc_qsv"),
        ("qsv", "libaom-av1") => Some("av1_qsv"),
        ("qsv", "libvpx-vp9") => Some("vp9_qsv"),
        _ => None,
    }
}

pub fn video_codec_constraints(video_codec: &str) -> Option<VideoCodecConstraints> {
    let c = match video_codec {
        "libx264" => VideoCodecConstraints { max_width: 4096, max_height: 2304, max_fps: 360.0, max_bitrate: 500_000 },
        "libx265" => VideoCodecConstraints { max_width: 8192, max_height: 4320, max_fps: 360.0, max_bitrate: 500_000 },
        "libaom-av1" => VideoCodecConstraints { max_width: 8192, max_height: 4320, max_fps: 360.0, max_bitrate: 500_000 },
        "libvpx-vp9" => VideoCodecConstraints { max_width: 8192, max_height: 4320, max_fps: 360.0, max_bitrate: 500_000 },
        "libvpx" => VideoCodecConstraints { max_width: 4096, max_height: 2160, max_fps: 240.0, max_bitrate: 200_000 },
        "mpeg4" => VideoCodecConstraints { max_width: 1920, max_height: 1080, max_fps: 120.0, max_bitrate: 50_000 },
        "mpeg2video" => VideoCodecConstraints { max_width: 1920, max_height: 1080, max_fps: 120.0, max_bitrate: 100_000 },
        "mpeg1video" => VideoCodecConstraints { max_width: 1920, max_height: 1080, max_fps: 60.0, max_bitrate: 20_000 },
        "prores" => VideoCodecConstraints { max_width: 8192, max_height: 4320, max_fps: 360.0, max_bitrate: 1_500_000 },
        "dnxhd" => VideoCodecConstraints { max_width: 1920, max_height: 1080, max_fps: 120.0, max_bitrate: 500_000 },
        "gif" => VideoCodecConstraints { max_width: 1920, max_height: 1080, max_fps: 60.0, max_bitrate: 100_000 },
        "apng" => VideoCodecConstraints { max_width: 8192, max_height: 4320, max_fps: 60.0, max_bitrate: 200_000 },
        "libwebp" | "libwebp_anim" => VideoCodecConstraints { max_width: 16383, max_height: 16383, max_fps: 60.0, max_bitrate: 100_000 },
        "mjpeg" => VideoCodecConstraints { max_width: 8192, max_height: 4320, max_fps: 120.0, max_bitrate: 200_000 },
        "wmv1" | "wmv2" | "flv1" => VideoCodecConstraints { max_width: 1920, max_height: 1080, max_fps: 60.0, max_bitrate: 50_000 },
        "h263" => VideoCodecConstraints { max_width: 1408, max_height: 1152, max_fps: 60.0, max_bitrate: 20_000 },
        _ => return None,
    };
    Some(c)
}

pub fn audio_codec_constraints(audio_codec: &str) -> Option<AudioCodecConstraints> {
    let c = match audio_codec {
        "aac" => AudioCodecConstraints { max_channels: 8, max_sample_rate: 192_000, max_bitrate: Some(1000), lossless: false },
        "libmp3lame" => AudioCodecConstraints { max_channels: 2, max_sample_rate: 48_000, max_bitrate: Some(320), lossless: false },
        "flac" => AudioCodecConstraints { max_channels: 8, max_sample_rate: 384_000, max_bitrate: None, lossless: true },
        "libvorbis" => AudioCodecConstraints { max_channels: 8, max_sample_rate: 48_000, max_bitrate: Some(500), lossless: false },
        "libopus" => AudioCodecConstraints { max_channels: 8, max_sample_rate: 48_000, max_bitrate: Some(512), lossless: false },
        "alac" => AudioCodecConstraints { max_channels: 8, max_sample_rate: 384_000, max_bitrate: None, lossless: true },
        "ac3" => AudioCodecConstraints { max_channels: 6, max_sample_rate: 48_000, max_bitrate: Some(640), lossless: false },
        "eac3" => AudioCodecConstraints { max_channels: 16, max_sample_rate: 48_000, max_bitrate: Some(6144), lossless: false },
        "pcm_s16le" | "pcm_s16be" => AudioCodecConstraints { max_channels: 8, max_sample_rate: 192_000, max_bitrate: None, lossless: true },
        "pcm_s24le" | "pcm_s32le" | "pcm_f32le" => AudioCodecConstraints { max_channels: 8, max_sample_rate: 384_000, max_bitrate: None, lossless: true },
        "wmav2" | "wmav1" => AudioCodecConstraints { max_channels: 2, max_sample_rate: 48_000, max_bitrate: Some(320), lossless: false },
        "amr_nb" => AudioCodecConstraints { max_channels: 1, max_sample_rate: 8_000, max_bitrate: Some(13), lossless: false },
        "amr_wb" => AudioCodecConstraints { max_channels: 1, max_sample_rate: 16_000, max_bitrate: Some(24), lossless: false },
        "mp2" => AudioCodecConstraints { max_channels: 2, max_sample_rate: 48_000, max_bitrate: Some(384), lossless: false },
        "dts" => AudioCodecConstraints { max_channels: 6, max_sample_rate: 48_000, max_bitrate: Some(1536), lossless: false },
        "truehd" => AudioCodecConstraints { max_channels: 8, max_sample_rate: 192_000, max_bitrate: None, lossless: true },
        _ => return None,
    };
    Some(c)
}
