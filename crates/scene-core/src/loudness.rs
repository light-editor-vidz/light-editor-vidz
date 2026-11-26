//! Normalisation du volume ressenti (EBU R128, filtre `loudnorm` de ffmpeg), en deux passes : la
//! première mesure le son, la seconde le corrige avec ces mesures. Fonctions pures, communes aux
//! exports du projet, de la vue Vidéo et de la vue Audio.

use crate::ffmpeg_path::escape_for_ffmpeg_filter;

/// Cibles proposées (LUFS) : plateformes vidéo, podcasts, télévision (EBU R128).
pub const TARGETS: [f64; 3] = [-14.0, -16.0, -23.0];
/// Crête vraie maximale (dBTP) du résultat.
pub const TRUE_PEAK: f64 = -1.0;
/// En dessous de ce niveau, il n'y a qu'un bruit de fond : l'amplifier à la cible monterait le
/// souffle, pas un contenu.
const AMBIENCE_FLOOR: f64 = -40.0;
const DEFAULT_RANGE: f64 = 11.0;
/// Fréquence rendue après `loudnorm`, qui travaille à 192 kHz.
pub const OUTPUT_RATE: u32 = 48_000;

pub fn validate_target(target: f64) -> Result<f64, String> {
    if target.is_finite() && (-30.0..=-9.0).contains(&target) {
        Ok(target)
    } else {
        Err("Invalid loudness target".into())
    }
}

/// Le filtre de la première passe : les mesures sont écrites (en JSON) dans `stats`.
pub fn measure_filter(target: f64, stats: &str) -> String {
    format!(
        "loudnorm=I={target}:TP={TRUE_PEAK}:LRA={DEFAULT_RANGE}:print_format=json:stats_file={}",
        escape_for_ffmpeg_filter(stats)
    )
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Measured {
    pub integrated: f64,
    pub true_peak: f64,
    pub range: f64,
    pub threshold: f64,
    pub offset: f64,
}

/// Lit le JSON de la première passe. Un silence complet y vaut `-inf`.
pub fn parse_measure(json: &str) -> Result<Measured, String> {
    let values: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("Unreadable loudness measure: {e}"))?;
    let number = |key: &str| {
        values[key]
            .as_str()
            .and_then(|v| v.trim().parse::<f64>().ok())
            .ok_or_else(|| format!("The loudness measure has no {key}"))
    };
    Ok(Measured {
        integrated: number("input_i")?,
        true_peak: number("input_tp")?,
        range: number("input_lra")?,
        threshold: number("input_thresh")?,
        offset: number("target_offset")?,
    })
}

/// Le filtre de la seconde passe, ou `None` si le son doit rester tel quel (silence ou simple
/// bruit de fond).
pub fn apply_filter(target: f64, m: &Measured, rate: u32) -> Option<String> {
    let finite = [m.integrated, m.true_peak, m.range, m.threshold, m.offset]
        .iter()
        .all(|v| v.is_finite());
    if !finite || m.integrated < AMBIENCE_FLOOR {
        return None;
    }
    // Une plage cible plus étroite que celle du son forcerait le mode dynamique, qui pompe.
    let range = m.range.clamp(DEFAULT_RANGE, 50.0);
    Some(format!(
        "loudnorm=I={target}:TP={TRUE_PEAK}:LRA={range}:measured_I={}:measured_TP={}:\
         measured_LRA={}:measured_thresh={}:offset={}:linear=true,aresample={rate}",
        m.integrated, m.true_peak, m.range, m.threshold, m.offset
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATS: &str = r#"{"input_i":"-22.19","input_tp":"-18.06","input_lra":"3.20",
        "input_thresh":"-32.33","output_i":"-13.22","target_offset":"-0.78"}"#;

    #[test]
    fn the_second_pass_uses_the_measures_of_the_first() {
        let filter = apply_filter(-14.0, &parse_measure(STATS).unwrap(), OUTPUT_RATE).unwrap();

        assert!(filter.starts_with("loudnorm=I=-14:TP=-1:LRA=11:measured_I=-22.19:"));
        assert!(
            filter.contains("offset=-0.78:linear=true,aresample=48000"),
            "{filter}"
        );
    }

    #[test]
    fn a_wide_dynamic_range_is_kept() {
        let wide = Measured {
            range: 17.5,
            ..parse_measure(STATS).unwrap()
        };
        let filter = apply_filter(-14.0, &wide, 44_100).unwrap();
        assert!(filter.contains(":LRA=17.5:") && filter.ends_with("aresample=44100"));
    }

    #[test]
    fn silence_and_background_noise_are_left_alone() {
        for level in ["-inf", "-52.0"] {
            let measured = parse_measure(&STATS.replace("-22.19", level)).unwrap();
            assert_eq!(apply_filter(-14.0, &measured, OUTPUT_RATE), None, "{level}");
        }
    }

    #[test]
    fn unreadable_measures_and_targets_are_refused() {
        assert!(parse_measure("{}").is_err());
        assert!(parse_measure("nothing").is_err());
        assert!(TARGETS.iter().all(|t| validate_target(*t).is_ok()));
        for target in [0.0, -40.0, f64::NAN] {
            assert!(validate_target(target).is_err(), "{target}");
        }
    }
}
