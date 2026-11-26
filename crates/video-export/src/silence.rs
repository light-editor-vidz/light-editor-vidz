//! Détection des silences d'une vidéo, pour les couper au montage. Fonctions pures : rien ici ne
//! lance ffmpeg. Les marges et le choix des silences à couper sont faits par l'interface, qui peut
//! les ajuster sans relancer l'analyse.

use crate::plan::escape_for_ffmpeg_filter;
use serde::Serialize;

/// Seuil (dB) sous lequel le son compte comme du silence.
pub const THRESHOLD_RANGE: (f64, f64) = (-70.0, -10.0);
/// Durée (s) à partir de laquelle un silence est rapporté.
pub const MIN_SILENCE_RANGE: (f64, f64) = (0.1, 10.0);

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Silence {
    pub start: f64,
    pub end: f64,
}

pub fn validate_settings(threshold_db: f64, min_silence: f64) -> Result<(), String> {
    let within = |v: f64, (min, max): (f64, f64)| v.is_finite() && v >= min && v <= max;
    if !within(threshold_db, THRESHOLD_RANGE) {
        return Err("Invalid silence threshold".into());
    }
    if !within(min_silence, MIN_SILENCE_RANGE) {
        return Err("Invalid minimum silence".into());
    }
    Ok(())
}

/// Arguments de l'analyse de la première piste audio : les silences sont écrits dans `log`.
pub fn silence_detect_args(
    input: &str,
    log: &str,
    threshold_db: f64,
    min_silence: f64,
) -> Vec<String> {
    vec![
        "-i".into(),
        input.into(),
        "-map".into(),
        "0:a:0".into(),
        "-af".into(),
        format!(
            "silencedetect=noise={threshold_db}dB:d={min_silence},ametadata=mode=print:file={}",
            escape_for_ffmpeg_filter(log)
        ),
        "-f".into(),
        "null".into(),
        "-".into(),
    ]
}

/// Les silences du journal de `ametadata=print`. Un silence qui dure jusqu'à la fin n'a pas de
/// `silence_end` : il se termine à `duration`.
pub fn parse_silences(log: &str, duration: f64) -> Vec<Silence> {
    let value = |line: &str, key: &str| {
        line.trim()
            .strip_prefix(key)
            .and_then(|v| v.trim().parse::<f64>().ok())
            .filter(|v| v.is_finite())
    };
    let mut open = None;
    let mut out = Vec::new();
    let mut push = |start: f64, end: f64| {
        let (start, end) = (start.max(0.0), end.min(duration));
        if end > start {
            out.push(Silence { start, end });
        }
    };
    for line in log.lines() {
        if let Some(start) = value(line, "lavfi.silence_start=") {
            open = Some(start);
        } else if let Some(end) = value(line, "lavfi.silence_end=") {
            if let Some(start) = open.take() {
                push(start, end);
            }
        }
    }
    if let Some(start) = open {
        push(start, duration);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silences_are_read_and_a_trailing_one_ends_with_the_file() {
        let log = "frame:25 pts:102400 pts_time:2.32\n\
                   lavfi.silence_start=-0.01\n\
                   lavfi.silence_end=1.5\n\
                   lavfi.silence_duration=1.51\n\
                   lavfi.silence_start=4\n\
                   lavfi.silence_end=5.25\n\
                   lavfi.silence_start=9\n";

        let found: Vec<(f64, f64)> = parse_silences(log, 10.0)
            .iter()
            .map(|s| (s.start, s.end))
            .collect();

        assert_eq!(found, [(0.0, 1.5), (4.0, 5.25), (9.0, 10.0)]);
    }

    #[test]
    fn unusable_lines_give_no_silence() {
        assert!(parse_silences("lavfi.silence_end=3\nnoise", 10.0).is_empty());
        assert!(parse_silences("lavfi.silence_start=12\n", 10.0).is_empty());
    }

    #[test]
    fn settings_outside_their_range_are_refused() {
        assert!(validate_settings(-35.0, 0.5).is_ok());
        for (threshold, min) in [(0.0, 0.5), (-80.0, 0.5), (f64::NAN, 0.5), (-35.0, 0.0)] {
            assert!(
                validate_settings(threshold, min).is_err(),
                "{threshold} {min}"
            );
        }
    }
}
