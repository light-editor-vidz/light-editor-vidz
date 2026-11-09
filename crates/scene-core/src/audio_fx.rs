//! Effets audio d'une piste exprimés en filtres ffmpeg (les mêmes chaînes servent à l'export
//! vidéo et à l'export audio seul).

use crate::model::{AudioFilter, AudioFilterKind, FadeCurve};
use std::f64::consts::PI;

/// Plage de fréquences acceptée (Hz) : sous le Nyquist du mix (48 kHz).
const MIN_FREQUENCY: f64 = 20.0;
const MAX_FREQUENCY: f64 = 20_000.0;

/// Valeur du paramètre `curve` du filtre `afade`.
pub fn fade_curve_name(curve: FadeCurve) -> &'static str {
    match curve {
        FadeCurve::Linear => "tri",
        FadeCurve::EqualPower => "qsin",
    }
}

/// Gain (0..1) d'un fondu à la fraction `x` (0..1) de sa durée, selon la courbe — même formule
/// que `afade` (utilisée par l'aperçu).
pub fn fade_gain(curve: FadeCurve, x: f64) -> f64 {
    let x = x.clamp(0.0, 1.0);
    match curve {
        FadeCurve::Linear => x,
        FadeCurve::EqualPower => (x * PI / 2.0).sin(),
    }
}

/// Étapes ffmpeg du filtre : une par biquad. Un passe-bas ou passe-haut d'ordre `n`
/// (`slope / 6`) est une cascade de `n / 2` biquads de Butterworth, de facteur de qualité
/// `1 / (2·cos((2k − 1)·π / 2n))`.
pub fn filter_stages(filter: &AudioFilter) -> Vec<String> {
    let frequency = if filter.frequency.is_finite() {
        filter.frequency.clamp(MIN_FREQUENCY, MAX_FREQUENCY)
    } else {
        1000.0
    };
    match filter.kind {
        AudioFilterKind::BandPass => {
            let q = if filter.q.is_finite() {
                filter.q.clamp(0.1, 20.0)
            } else {
                0.707
            };
            vec![format!("bandpass=f={frequency}:t=q:w={q}")]
        }
        kind => {
            let name = if kind == AudioFilterKind::LowPass {
                "lowpass"
            } else {
                "highpass"
            };
            let order = (filter.slope.clamp(12, 48) / 12 * 2) as usize;
            (1..=order / 2)
                .map(|k| {
                    let q = 1.0 / (2.0 * ((2 * k - 1) as f64 * PI / (2 * order) as f64).cos());
                    format!("{name}=f={frequency}:t=q:w={q:.6}")
                })
                .collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filter(kind: AudioFilterKind, slope: u32) -> AudioFilter {
        AudioFilter {
            kind,
            frequency: 1000.0,
            slope,
            q: 2.0,
        }
    }

    #[test]
    fn a_12_db_low_pass_is_one_butterworth_biquad() {
        assert_eq!(
            filter_stages(&filter(AudioFilterKind::LowPass, 12)),
            ["lowpass=f=1000:t=q:w=0.707107"]
        );
    }

    #[test]
    fn steeper_slopes_cascade_biquads_with_butterworth_qs() {
        let stages = filter_stages(&filter(AudioFilterKind::HighPass, 48));
        assert_eq!(
            stages,
            [
                "highpass=f=1000:t=q:w=0.509796",
                "highpass=f=1000:t=q:w=0.601345",
                "highpass=f=1000:t=q:w=0.899976",
                "highpass=f=1000:t=q:w=2.562915",
            ]
        );
        assert_eq!(
            filter_stages(&filter(AudioFilterKind::LowPass, 24)).len(),
            2
        );
        assert_eq!(
            filter_stages(&filter(AudioFilterKind::LowPass, 36)).len(),
            3
        );
    }

    #[test]
    fn a_band_pass_is_a_single_biquad_with_the_given_q() {
        assert_eq!(
            filter_stages(&filter(AudioFilterKind::BandPass, 12)),
            ["bandpass=f=1000:t=q:w=2"]
        );
    }

    #[test]
    fn out_of_range_values_are_clamped() {
        let mut f = filter(AudioFilterKind::LowPass, 999);
        f.frequency = 1e9;
        assert_eq!(filter_stages(&f).len(), 4);
        assert!(filter_stages(&f)[0].starts_with("lowpass=f=20000:"));
        f.frequency = f64::NAN;
        assert!(filter_stages(&f)[0].starts_with("lowpass=f=1000:"));
    }

    #[test]
    fn equal_power_fades_are_louder_than_linear_at_the_midpoint() {
        assert!((fade_gain(FadeCurve::Linear, 0.5) - 0.5).abs() < 1e-9);
        assert!(
            (fade_gain(FadeCurve::EqualPower, 0.5) - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-9
        );
        assert_eq!(fade_gain(FadeCurve::EqualPower, 0.0), 0.0);
        assert!((fade_gain(FadeCurve::EqualPower, 1.0) - 1.0).abs() < 1e-9);
        assert_eq!(fade_curve_name(FadeCurve::Linear), "tri");
        assert_eq!(fade_curve_name(FadeCurve::EqualPower), "qsin");
    }
}
