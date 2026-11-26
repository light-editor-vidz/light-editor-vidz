//! Découpe en séquences : détection des changements de plan, puis fusion des séquences retenues,
//! dans l'ordre voulu, en une seule vidéo. Fonctions pures : rien ici ne lance ffmpeg.

use crate::plan::escape_for_ffmpeg_filter;
use serde::{Deserialize, Serialize};

/// Sensibilité de la détection (0 à 1) : plus elle est basse, plus il y a de coupes.
pub const SCENE_THRESHOLD: f64 = 0.3;
/// Une séquence plus courte que cela est rattachée à la précédente.
pub const MIN_SEQUENCE: f64 = 0.5;
pub const MAX_SEQUENCES: usize = 500;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Sequence {
    pub start: f64,
    pub end: f64,
}

/// Arguments de l'analyse : les instants des changements de plan sont écrits dans `log`.
pub fn scene_detect_args(input: &str, log: &str) -> Vec<String> {
    vec![
        "-i".into(),
        input.into(),
        "-an".into(),
        "-vf".into(),
        format!(
            // Analysé en 320 px de large : le score de changement de plan n'a pas besoin de la pleine
            // résolution, et l'analyse d'un 4K est 10 à 20 fois plus lente sinon.
            "scale=320:-2:flags=fast_bilinear,select=gt(scene\\,{SCENE_THRESHOLD}),metadata=print:file={}",
            escape_for_ffmpeg_filter(log)
        ),
        "-f".into(),
        "null".into(),
        "-".into(),
    ]
}

/// Les instants (`pts_time:`) du journal de `metadata=print`.
pub fn parse_scene_times(log: &str) -> Vec<f64> {
    log.lines()
        .filter_map(|l| {
            let rest = l.split("pts_time:").nth(1)?;
            rest.split_whitespace().next()?.parse::<f64>().ok()
        })
        .filter(|t| t.is_finite())
        .collect()
}

/// Les séquences qui couvrent `[0, duration]`, coupées aux instants donnés ; aucune n'est plus
/// courte que `MIN_SEQUENCE`.
pub fn sequences_from_cuts(times: &[f64], duration: f64) -> Vec<Sequence> {
    if duration.is_nan() || duration <= 0.0 {
        return vec![];
    }
    let mut sorted: Vec<f64> = times.to_vec();
    sorted.sort_by(f64::total_cmp);
    let mut out = Vec::new();
    let mut start = 0.0;
    for t in sorted {
        if t - start >= MIN_SEQUENCE && duration - t >= MIN_SEQUENCE {
            out.push(Sequence { start, end: t });
            start = t;
        }
    }
    out.push(Sequence {
        start,
        end: duration,
    });
    out.truncate(MAX_SEQUENCES);
    if let Some(last) = out.last_mut() {
        last.end = duration;
    }
    out
}

pub fn validate_sequences(sequences: &[Sequence]) -> Result<(), String> {
    if sequences.is_empty() {
        return Err("No sequence to merge".into());
    }
    if sequences.len() > MAX_SEQUENCES {
        return Err("Too many sequences".into());
    }
    for (i, s) in sequences.iter().enumerate() {
        if !(s.start.is_finite() && s.end.is_finite() && s.start >= 0.0 && s.end > s.start) {
            return Err(format!("Invalid sequences[{i}]"));
        }
    }
    Ok(())
}

pub fn total_duration(sequences: &[Sequence]) -> f64 {
    sequences.iter().map(|s| s.end - s.start).sum()
}

/// Arguments de la fusion vers `out` (MP4 H.264 + AAC, lisible directement) : chaque séquence est
/// jointe dans l'ordre donné. Chaque séquence est une **entrée** à elle (`-ss début -t durée -i`),
/// et non une branche `trim` d'une même entrée : avec `trim`, une séquence tardive placée en tête
/// obligeait ffmpeg à garder en mémoire toutes les images décodées qui la précèdent.
pub fn merge_args(
    input: &str,
    out: &str,
    sequences: &[Sequence],
    with_audio: bool,
    sdr: Option<&str>,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    let mut parts = Vec::new();
    for (i, s) in sequences.iter().enumerate() {
        args.extend([
            "-ss".into(),
            format!("{:.3}", s.start),
            "-t".into(),
            format!("{:.3}", s.end - s.start),
            "-i".into(),
            input.into(),
        ]);
        parts.push(format!("[{i}:V]setpts=PTS-STARTPTS[v{i}]"));
        if with_audio {
            parts.push(format!("[{i}:a]asetpts=PTS-STARTPTS[a{i}]"));
        }
    }
    let inputs: String = (0..sequences.len())
        .map(|i| {
            if with_audio {
                format!("[v{i}][a{i}]")
            } else {
                format!("[v{i}]")
            }
        })
        .collect();
    parts.push(format!(
        "{inputs}concat=n={}:v=1:a={}[vc]{}",
        sequences.len(),
        u8::from(with_audio),
        if with_audio { "[ac]" } else { "" }
    ));
    let sdr = sdr.map(|f| format!("{f},")).unwrap_or_default();
    parts.push(format!("[vc]{sdr}scale=trunc(iw/2)*2:trunc(ih/2)*2[vout]"));

    args.extend([
        "-filter_complex".into(),
        parts.join(";"),
        "-map".into(),
        "[vout]".into(),
    ]);
    if with_audio {
        args.extend(["-map".into(), "[ac]".into()]);
    }
    args.extend(
        [
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
        ]
        .map(String::from),
    );
    if with_audio {
        args.extend(["-c:a", "aac", "-b:a", "192k"].map(String::from));
    }
    args.extend(["-movflags".into(), "+faststart".into(), out.into()]);
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seq(start: f64, end: f64) -> Sequence {
        Sequence { start, end }
    }

    #[test]
    fn the_log_gives_the_scene_changes() {
        let log = "frame:0    pts:75000   pts_time:3.0\nlavfi.scene_score=0.61\nframe:1 pts:150000 pts_time:6.25\nlavfi.scene_score=0.4\n";
        assert_eq!(parse_scene_times(log), vec![3.0, 6.25]);
        assert!(parse_scene_times("").is_empty());
    }

    #[test]
    fn cuts_split_the_video_into_contiguous_sequences() {
        assert_eq!(
            sequences_from_cuts(&[6.0, 3.0], 10.0),
            vec![seq(0.0, 3.0), seq(3.0, 6.0), seq(6.0, 10.0)]
        );
    }

    #[test]
    fn no_cut_means_a_single_sequence() {
        assert_eq!(sequences_from_cuts(&[], 8.0), vec![seq(0.0, 8.0)]);
        assert!(sequences_from_cuts(&[1.0], 0.0).is_empty());
    }

    #[test]
    fn too_short_sequences_are_absorbed() {
        // 0.2 s après le début, 0.3 s avant la fin, et 0.1 s après une coupe : aucune ne compte.
        assert_eq!(
            sequences_from_cuts(&[0.2, 4.0, 4.1, 9.7], 10.0),
            vec![seq(0.0, 4.0), seq(4.0, 10.0)]
        );
    }

    #[test]
    fn sequences_are_validated() {
        assert!(validate_sequences(&[]).is_err());
        assert!(validate_sequences(&[seq(2.0, 2.0)]).is_err());
        assert!(validate_sequences(&[seq(-1.0, 2.0)]).is_err());
        assert!(validate_sequences(&[seq(0.0, f64::NAN)]).is_err());
        assert!(validate_sequences(&[seq(5.0, 6.0), seq(0.0, 1.0)]).is_ok());
    }

    #[test]
    fn the_merge_keeps_the_given_order() {
        let a = merge_args(
            "/in.mp4",
            "/out.mp4",
            &[seq(5.0, 8.0), seq(0.0, 2.0)],
            true,
            None,
        );
        let graph = &a[a.iter().position(|x| x == "-filter_complex").unwrap() + 1];
        // Une entrée par séquence, dans l'ordre choisi : rien n'est décodé en avance.
        let inputs: Vec<&[String]> = a.windows(6).filter(|w| w[0] == "-ss").collect();
        assert_eq!(inputs.len(), 2);
        assert_eq!(
            inputs[0][..5],
            ["-ss", "5.000", "-t", "3.000", "-i"].map(String::from)
        );
        assert_eq!(
            inputs[1][..5],
            ["-ss", "0.000", "-t", "2.000", "-i"].map(String::from)
        );
        assert!(!graph.contains("trim="), "plus de branche trim : {graph}");
        assert!(graph.starts_with("[0:V]setpts=PTS-STARTPTS[v0];"));
        assert!(graph.contains("[1:a]asetpts=PTS-STARTPTS[a1]"));
        assert!(graph.contains("[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][ac]"));
        assert_eq!(a.last().unwrap(), "/out.mp4");
        assert!(a.contains(&"[ac]".to_string()));
    }

    #[test]
    fn without_audio_no_audio_stream_is_mapped() {
        let a = merge_args("/in.mp4", "/out.mp4", &[seq(0.0, 2.0)], false, None);
        assert!(!a.iter().any(|x| x.contains("atrim") || x == "aac"));
        let graph = &a[a.iter().position(|x| x == "-filter_complex").unwrap() + 1];
        assert!(graph.contains("concat=n=1:v=1:a=0[vc];"));
    }

    #[test]
    fn the_scene_log_path_is_escaped() {
        let a = scene_detect_args("/in.mp4", "/tmp/a b:c.log");
        assert!(a[4].ends_with("file=/tmp/a\\ b\\\\:c.log"), "{}", a[4]);
    }

    #[test]
    fn the_total_is_the_sum_of_the_lengths() {
        assert_eq!(total_duration(&[seq(1.0, 3.0), seq(0.0, 0.5)]), 2.5);
    }
}
