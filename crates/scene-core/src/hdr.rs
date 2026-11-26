//! Sources HDR (iPhone, HDR10, HLG) : tout ce que l'application produit est en SDR BT.709, il faut
//! donc convertir à la lecture. Sans cela, les valeurs HDR sont prises pour du SDR et l'image sort
//! délavée.

use std::process::{Command, Stdio};
use std::sync::OnceLock;

/// Courbe de transfert d'une source HDR.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HdrTransfer {
    /// HDR10, Dolby Vision avec couche HDR10 (SMPTE ST 2084).
    Pq,
    /// HLG, le HDR des iPhone et de la télévision (ARIB STD-B67).
    Hlg,
}

impl HdrTransfer {
    /// Le `color_transfer` de ffprobe ; `None` pour tout ce qui n'est pas HDR (y compris le
    /// BT.2020 SDR).
    pub fn from_name(name: &str) -> Option<Self> {
        match name.trim() {
            "smpte2084" => Some(Self::Pq),
            "arib-std-b67" => Some(Self::Hlg),
            _ => None,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Pq => "smpte2084",
            Self::Hlg => "arib-std-b67",
        }
    }

    /// La chaîne de filtres qui ramène la source en BT.709 SDR. `setparams` complète les fichiers
    /// qui ne déclarent que leur courbe (sans primaires ni matrice, `zscale` refuse). Le blanc
    /// de référence HDR (203 nits, BT.2408) devient le blanc SDR ; `mobius` laisse les tons moyens
    /// intacts et ne comprime que les hautes lumières.
    pub fn to_sdr_filter(self) -> String {
        format!(
            "setparams=color_primaries=bt2020:color_trc={}:colorspace=bt2020nc,\
             zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,\
             tonemap=tonemap=mobius:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p",
            self.name()
        )
    }
}

fn lists_filter(filters: &str, name: &str) -> bool {
    filters
        .lines()
        .any(|line| line.split_whitespace().nth(1) == Some(name))
}

/// Le ffmpeg utilisé sait-il convertir ? (Celui embarqué oui ; un ffmpeg imposé par
/// `LIGHT_EDITOR_VIDZ_FFMPEG` peut avoir été compilé sans zimg.)
fn can_tonemap() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(|| {
        Command::new(crate::ffmpeg_path::ffmpeg_binary())
            .args(["-hide_banner", "-filters"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .is_ok_and(|o| {
                let list = String::from_utf8_lossy(&o.stdout);
                lists_filter(&list, "zscale") && lists_filter(&list, "tonemap")
            })
    })
}

/// Le filtre à placer en tête de la chaîne vidéo d'une source, ou `None` si elle est déjà SDR (ou
/// si ce ffmpeg ne sait pas convertir : mieux vaut des couleurs ternes qu'un export en échec).
pub fn sdr_filter(transfer: Option<HdrTransfer>) -> Option<String> {
    transfer
        .filter(|_| can_tonemap())
        .map(HdrTransfer::to_sdr_filter)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_pq_and_hlg_are_hdr() {
        assert_eq!(HdrTransfer::from_name("smpte2084"), Some(HdrTransfer::Pq));
        assert_eq!(
            HdrTransfer::from_name("arib-std-b67\n"),
            Some(HdrTransfer::Hlg)
        );
        for sdr in ["bt709", "bt2020-10", "unknown", ""] {
            assert_eq!(HdrTransfer::from_name(sdr), None, "{sdr}");
        }
    }

    #[test]
    fn the_filter_declares_the_source_curve() {
        assert!(HdrTransfer::Hlg
            .to_sdr_filter()
            .starts_with("setparams=color_primaries=bt2020:color_trc=arib-std-b67:"));
        assert!(HdrTransfer::Pq
            .to_sdr_filter()
            .contains("color_trc=smpte2084:"));
    }

    #[test]
    fn a_filter_is_found_by_its_exact_name() {
        let list =
            " ... tonemap_vaapi    V->V       x\n .S. tonemap           V->V       Conversion\n";
        assert!(lists_filter(list, "tonemap"));
        assert!(!lists_filter(list, "zscale"));
    }

    #[test]
    fn an_sdr_source_gets_no_filter() {
        assert_eq!(sdr_filter(None), None);
    }
}
