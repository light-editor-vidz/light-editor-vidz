//! Nettoyage d'une voix enregistrée : chaînes de filtres ffmpeg, communes aux exports des vues
//! Audio et Vidéo.

use serde::Deserialize;

/// Coupe les grondements sous la voix.
const HIGHPASS: &str = "highpass=f=80";
/// Réduction de bruit par FFT, qui suit le niveau du bruit de fond.
const DENOISE: &str = "afftdn=nf=-25:tn=1";
/// Atténue (sans couper) ce qui passe sous −40 dB, entre les phrases. Le seuil par défaut de
/// ffmpeg (−18 dB) étoufferait une voix douce.
const GATE: &str = "agate=threshold=0.01:ratio=2:range=0.06125:attack=20:release=250";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VoiceLevel {
    #[default]
    Off,
    /// Bonne prise de son : grondements ôtés, niveau un peu égalisé.
    Light,
    /// Ajoute dé-esseur et réduction de bruit.
    Medium,
    /// Téléphone ou ordinateur : second étage de compression et plafond à −1 dBFS.
    Strong,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub struct VoiceCleanup {
    pub level: VoiceLevel,
    /// Réduction de bruit (toujours faite par les niveaux moyen et fort).
    pub denoise: bool,
    pub gate: bool,
}

impl VoiceCleanup {
    /// La chaîne de filtres, ou `None` si rien n'est demandé. Ordre : grondements, bruit, gate,
    /// sifflantes, compression, plafond.
    pub fn filter(&self) -> Option<String> {
        let level = self.level;
        let cleaned = matches!(level, VoiceLevel::Medium | VoiceLevel::Strong);
        let mut stages: Vec<&str> = Vec::new();
        if level != VoiceLevel::Off {
            stages.push(HIGHPASS);
        }
        if self.denoise || cleaned {
            stages.push(DENOISE);
        }
        if self.gate {
            stages.push(GATE);
        }
        match level {
            VoiceLevel::Off => {}
            VoiceLevel::Light => {
                stages.push("acompressor=threshold=-18dB:ratio=2:attack=5:release=80:makeup=1")
            }
            VoiceLevel::Medium | VoiceLevel::Strong => stages.extend([
                "deesser=i=0.4",
                "acompressor=threshold=-18dB:ratio=3:attack=5:release=80:makeup=2",
            ]),
        }
        if level == VoiceLevel::Strong {
            stages.extend([
                "deesser=i=0.6",
                "acompressor=threshold=-24dB:ratio=4:attack=5:release=120:makeup=3",
                "alimiter=limit=0.891251:level=false:latency=true",
            ]);
        }
        (!stages.is_empty()).then(|| stages.join(","))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chain(level: VoiceLevel, denoise: bool, gate: bool) -> Option<String> {
        VoiceCleanup {
            level,
            denoise,
            gate,
        }
        .filter()
    }

    #[test]
    fn nothing_asked_gives_no_filter() {
        assert_eq!(chain(VoiceLevel::Off, false, false), None);
    }

    #[test]
    fn the_options_work_without_a_level() {
        assert_eq!(
            chain(VoiceLevel::Off, true, false).as_deref(),
            Some(DENOISE)
        );
        assert_eq!(chain(VoiceLevel::Off, false, true).as_deref(), Some(GATE));
    }

    #[test]
    fn the_stronger_levels_always_reduce_noise_and_only_once() {
        for level in [VoiceLevel::Medium, VoiceLevel::Strong] {
            assert_eq!(chain(level, true, false), chain(level, false, false));
            assert_eq!(
                chain(level, true, false).unwrap().matches("afftdn").count(),
                1
            );
        }
        assert!(!chain(VoiceLevel::Light, false, false)
            .unwrap()
            .contains("afftdn"));
        assert!(chain(VoiceLevel::Strong, false, false)
            .unwrap()
            .ends_with("latency=true"));
    }

    #[test]
    fn missing_fields_default_to_off() {
        let parsed: VoiceCleanup = serde_json::from_str(r#"{"gate":true}"#).unwrap();
        assert_eq!(parsed.level, VoiceLevel::Off);
        assert!(parsed.gate);
        assert!(serde_json::from_str::<VoiceCleanup>(r#"{"level":"max"}"#).is_err());
    }
}
