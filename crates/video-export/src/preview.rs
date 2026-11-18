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
        // Au plus 1080p : un 4K transcodé à sa résolution d'origine serait très lent et inutile
        // pour un aperçu.
        "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
        out,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// Largeur et hauteur (px) des vignettes de la frise de la timeline.
pub const THUMB_SIZE: (u32, u32) = (160, 90);

/// Au-delà de cette durée (s), la frise est faite par une recherche par vignette (`frame_args`) :
/// le filtre `fps` de `thumbnail_args` décode toute la vidéo pour n'en garder que `count` images.
pub const SEEK_THUMBNAILS_ABOVE_SECONDS: f64 = 120.0;

/// Les instants (milieux de `count` tranches égales) où prendre les vignettes d'une longue vidéo.
pub fn thumbnail_times(count: u32, duration: f64) -> Vec<f64> {
    (0..count)
        .map(|i| (f64::from(i) + 0.5) * duration / f64::from(count.max(1)))
        .collect()
}

/// Arguments de l'extraction de `count` vignettes réparties sur `duration` secondes, écrites
/// selon le motif `out_pattern` (`%03d.jpg`). Faite par ffmpeg : le WebView ne sait pas lire
/// fiablement une image d'une vidéo hors écran (il rend du bruit).
pub fn thumbnail_args(input: &str, out_pattern: &str, count: u32, duration: f64) -> Vec<String> {
    let (w, h) = THUMB_SIZE;
    vec![
        "-i".into(),
        input.into(),
        "-an".into(),
        "-vf".into(),
        format!(
            "fps={count}/{duration:.6},scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}"
        ),
        "-frames:v".into(),
        count.to_string(),
        "-q:v".into(),
        "5".into(),
        out_pattern.into(),
    ]
}

/// Arguments de l'extraction d'une seule vignette, de l'image à l'instant `time` (secondes).
pub fn frame_args(input: &str, out: &str, time: f64) -> Vec<String> {
    let (w, h) = THUMB_SIZE;
    vec![
        "-ss".into(),
        format!("{:.3}", time.max(0.0)),
        "-i".into(),
        input.into(),
        "-an".into(),
        "-frames:v".into(),
        "1".into(),
        "-vf".into(),
        format!("scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}"),
        "-q:v".into(),
        "5".into(),
        out.into(),
    ]
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
        assert!(
            a.contains("min(1920,iw)") && a.contains("min(1080,ih)"),
            "{a}"
        );
    }

    #[test]
    fn thumbnails_are_spread_over_the_whole_duration() {
        let args = thumbnail_args("in.mp4", "t_%03d.jpg", 10, 20.0);
        assert_eq!(args[1], "in.mp4");
        assert!(args[4].starts_with("fps=10/20.000000,scale=160:90"));
        assert_eq!(args[6], "10");
        assert_eq!(args.last().unwrap(), "t_%03d.jpg");
    }

    #[test]
    fn long_videos_get_one_seek_per_thumbnail_at_the_middle_of_each_slice() {
        assert_eq!(thumbnail_times(4, 400.0), vec![50.0, 150.0, 250.0, 350.0]);
        assert!(thumbnail_times(0, 10.0).is_empty());
    }

    #[test]
    fn a_single_frame_is_taken_at_the_given_time() {
        let args = frame_args("in.mp4", "f.jpg", 4.5);
        assert_eq!(&args[..4], ["-ss", "4.500", "-i", "in.mp4"]);
        assert_eq!(args.last().unwrap(), "f.jpg");
    }
}
