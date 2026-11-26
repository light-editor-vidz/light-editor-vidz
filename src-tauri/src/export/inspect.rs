//! Relecture d'un fichier exporté : ce qu'il contient réellement (dimensions, durée, volume…),
//! pour le comparer à ce qu'attend la plateforme de destination.

use scene_core::ffmpeg_path::{ffmpeg_binary, ffprobe_binary};
use serde::Serialize;
use std::path::Path;
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct DeliveryReport {
    pub duration: f64,
    pub size_bytes: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub video_codec: Option<String>,
    /// Les couleurs sont étiquetées HDR (PQ ou HLG).
    pub hdr: bool,
    pub has_audio: bool,
    /// Volume ressenti (LUFS) ; `None` sans son ou pour un silence.
    pub loudness: Option<f64>,
    /// Crête vraie (dBTP).
    pub true_peak: Option<f64>,
}

pub fn inspect(path: &Path) -> Result<DeliveryReport, String> {
    let output = Command::new(ffprobe_binary())
        .args(["-v", "error", "-of", "json", "-show_entries"])
        .arg(
            "format=duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate,\
             color_transfer:stream_disposition=attached_pic:stream_side_data=rotation",
        )
        .arg(path)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Cannot read the exported file: {e}"))?;
    if !output.status.success() {
        return Err("Cannot read the exported file".into());
    }
    let mut report = parse_probe(&String::from_utf8_lossy(&output.stdout))?;
    if report.has_audio {
        let measure = Command::new(ffmpeg_binary())
            .args(["-hide_banner", "-nostdin", "-nostats", "-i"])
            .arg(path)
            .args(["-map", "0:a:0", "-af", "ebur128=peak=true:framelog=quiet"])
            .args(["-f", "null", "-"])
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("Cannot measure the exported sound: {e}"))?;
        if !measure.status.success() {
            return Err("Cannot measure the exported sound".into());
        }
        (report.loudness, report.true_peak) =
            parse_ebur128(&String::from_utf8_lossy(&measure.stderr));
    }
    Ok(report)
}

fn parse_probe(json: &str) -> Result<DeliveryReport, String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("Unreadable file information: {e}"))?;
    let number = |v: &serde_json::Value| v.as_str().and_then(|s| s.parse::<f64>().ok());
    let mut report = DeliveryReport {
        duration: number(&value["format"]["duration"]).unwrap_or(0.0),
        size_bytes: number(&value["format"]["size"]).unwrap_or(0.0) as u64,
        ..Default::default()
    };
    for stream in value["streams"].as_array().into_iter().flatten() {
        match stream["codec_type"].as_str() {
            Some("audio") => report.has_audio = true,
            // Une pochette de MP3 ou de M4A n'est pas une piste vidéo.
            Some("video")
                if report.video_codec.is_none()
                    && stream["disposition"]["attached_pic"].as_i64() != Some(1) =>
            {
                let side = |key: &str| stream[key].as_u64().map(|v| v as u32);
                (report.width, report.height) = (side("width"), side("height"));
                report.video_codec = stream["codec_name"].as_str().map(str::to_string);
                report.fps = stream["avg_frame_rate"].as_str().and_then(|rate| {
                    let (n, d) = rate.split_once('/')?;
                    let (n, d): (f64, f64) = (n.parse().ok()?, d.parse().ok()?);
                    (d > 0.0 && n > 0.0).then(|| n / d)
                });
                report.hdr = matches!(
                    stream["color_transfer"].as_str(),
                    Some("smpte2084" | "arib-std-b67")
                );
            }
            _ => {}
        }
    }
    Ok(report)
}

/// Le volume intégré et la crête vraie du résumé final de `ebur128`.
fn parse_ebur128(log: &str) -> (Option<f64>, Option<f64>) {
    let summary = log.rsplit_once("Summary:").map_or("", |(_, s)| s);
    let value = |key: &str| {
        summary
            .lines()
            .find_map(|line| line.trim().strip_prefix(key))
            .and_then(|rest| rest.split_whitespace().next()?.parse::<f64>().ok())
            .filter(|v| v.is_finite())
    };
    // −70 LUFS est le plancher de la mesure : il signifie « silence ».
    (value("I:").filter(|v| *v > -69.9), value("Peak:"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_summary_gives_loudness_and_true_peak() {
        let log =
            "I: -3.0 LUFS\nSummary:\n\n  Integrated loudness:\n    I:         -14.2 LUFS\n    \
                   Threshold: -24.4 LUFS\n\n  True peak:\n    Peak:       -1.3 dBFS\n";
        assert_eq!(parse_ebur128(log), (Some(-14.2), Some(-1.3)));
    }

    #[test]
    fn silence_has_no_loudness() {
        let log = "Summary:\n    I:         -70.0 LUFS\n    Peak:       -inf dBFS\n";
        assert_eq!(parse_ebur128(log), (None, None));
    }

    #[test]
    fn a_cover_picture_is_not_a_video_stream() {
        let json = r#"{"format":{"duration":"12.5","size":"2048"},"streams":[
            {"codec_type":"video","codec_name":"mjpeg","width":500,"height":500,
             "disposition":{"attached_pic":1}},
            {"codec_type":"audio","codec_name":"mp3"}]}"#;
        let report = parse_probe(json).unwrap();
        assert_eq!((report.duration, report.size_bytes), (12.5, 2048));
        assert!(report.has_audio && report.video_codec.is_none());
    }

    #[test]
    fn a_real_file_is_measured() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("o.mp4");
        let made = Command::new(ffmpeg_binary())
            .args([
                "-y",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=108x192:r=30:d=3",
            ])
            .args(["-f", "lavfi", "-i", "sine=frequency=1000:duration=3"])
            .args([
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&path)
            .status();
        if !made.is_ok_and(|s| s.success()) {
            return; // ffmpeg absent
        }
        let report = inspect(&path).unwrap();
        assert_eq!((report.width, report.height), (Some(108), Some(192)));
        assert_eq!(report.video_codec.as_deref(), Some("h264"));
        assert!((report.fps.unwrap() - 30.0).abs() < 0.01, "{report:?}");
        assert!(!report.hdr && report.has_audio);
        // La sinusoïde de lavfi est à −18 dBFS de crête, soit environ −21 LUFS.
        assert!((report.loudness.unwrap() + 21.0).abs() < 2.0, "{report:?}");
        assert!((report.true_peak.unwrap() + 18.0).abs() < 2.5, "{report:?}");
    }
}
