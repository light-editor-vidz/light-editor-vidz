//! Aperçu : la source peut-elle aller directement dans l'élément `<video>` ? Sinon, un petit
//! WebM VP9 est fabriqué (HEVC, AVI, FLV, H.264 10 bits…).

use crate::ffmpeg::MediaInfo;

const DIRECT_VIDEO: [&str; 4] = ["h264", "vp8", "vp9", "av1"];
const DIRECT_AUDIO: [&str; 4] = ["aac", "mp3", "opus", "vorbis"];
const DIRECT_PIX_FMT: [&str; 2] = ["yuv420p", "yuvj420p"];

pub fn can_play_directly(info: &MediaInfo) -> bool {
    if !info
        .format_name
        .split(',')
        .any(|c| matches!(c, "mov" | "mp4" | "webm"))
    {
        return false;
    }
    let Some(video) = info
        .streams
        .iter()
        .find(|s| s.codec_type == "video" && !s.attached_pic)
    else {
        return false;
    };
    if !DIRECT_VIDEO.contains(&video.codec_name.as_str()) {
        return false;
    }
    if let Some(p) = &video.pix_fmt {
        if !DIRECT_PIX_FMT.contains(&p.as_str()) {
            return false;
        }
    }
    // Une rotation d'affichage ferait différer l'aperçu et l'export.
    if video.rotation.is_some() {
        return false;
    }
    info.streams
        .iter()
        .filter(|s| s.codec_type == "audio")
        .all(|a| DIRECT_AUDIO.contains(&a.codec_name.as_str()))
}

/// Arguments de la transcription d'aperçu vers `out` (WebM VP9 + Opus, dimensions paires).
pub fn preview_args(input: &str, out: &str) -> Vec<String> {
    [
        "-i",
        input,
        "-c:v",
        "libvpx-vp9",
        "-crf",
        "33",
        "-b:v",
        "0",
        "-deadline",
        "realtime",
        "-cpu-used",
        "8",
        "-row-mt",
        "1",
        "-c:a",
        "libopus",
        "-b:a",
        "128k",
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        out,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffmpeg::StreamInfo;

    fn video(codec: &str, pix: &str) -> StreamInfo {
        StreamInfo {
            codec_type: "video".into(),
            codec_name: codec.into(),
            pix_fmt: Some(pix.into()),
            ..Default::default()
        }
    }

    fn audio(codec: &str) -> StreamInfo {
        StreamInfo {
            codec_type: "audio".into(),
            codec_name: codec.into(),
            ..Default::default()
        }
    }

    fn mp4(streams: Vec<StreamInfo>) -> MediaInfo {
        MediaInfo {
            format_name: "mov,mp4,m4a,3gp,3g2,mj2".into(),
            duration: Some(1.0),
            streams,
        }
    }

    #[test]
    fn the_usual_phone_clip_plays_directly() {
        assert!(can_play_directly(&mp4(vec![
            video("h264", "yuv420p"),
            audio("aac")
        ])));
        assert!(can_play_directly(&mp4(vec![video("h264", "yuv420p")])));
        let webm = MediaInfo {
            format_name: "matroska,webm".into(),
            duration: None,
            streams: vec![video("vp9", "yuv420p"), audio("opus")],
        };
        assert!(can_play_directly(&webm));
    }

    #[test]
    fn anything_else_is_transcoded() {
        assert!(!can_play_directly(&mp4(vec![
            video("hevc", "yuv420p"),
            audio("aac")
        ])));
        assert!(!can_play_directly(&mp4(vec![video("h264", "yuv420p10le")])));
        assert!(!can_play_directly(&mp4(vec![video("h264", "yuv444p")])));
        assert!(!can_play_directly(&mp4(vec![
            video("h264", "yuv420p"),
            audio("ac3")
        ])));
        let avi = MediaInfo {
            format_name: "avi".into(),
            duration: None,
            streams: vec![video("h264", "yuv420p")],
        };
        assert!(!can_play_directly(&avi));
        let mut rotated = video("h264", "yuv420p");
        rotated.rotation = Some(90);
        assert!(!can_play_directly(&mp4(vec![rotated])));
    }

    #[test]
    fn empty_information_is_not_playable() {
        assert!(!can_play_directly(&MediaInfo::default()));
        assert!(!can_play_directly(&mp4(vec![])));
        let mut cover = video("mjpeg", "yuvj420p");
        cover.attached_pic = true;
        assert!(!can_play_directly(&mp4(vec![cover])));
    }

    #[test]
    fn the_preview_transcode_writes_even_sized_vp9() {
        let a = preview_args("/in.avi", "/out.webm").join(" ");
        assert!(
            a.starts_with("-i /in.avi -c:v libvpx-vp9")
                && a.ends_with("scale=trunc(iw/2)*2:trunc(ih/2)*2 /out.webm")
        );
    }
}
