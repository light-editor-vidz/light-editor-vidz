//! Fond vert (ou d'une autre couleur) : les pixels proches de la couleur choisie deviennent
//! transparents. La même formule est appliquée par l'aperçu (`src/lib/chroma.ts`), pour que ce
//! qu'on voit soit ce qui est exporté ; `chroma_cases.json` vérifie que les deux concordent.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChromaKey {
    /// Couleur à rendre transparente, `#rrggbb`.
    pub color: String,
    /// Écart de teinte (0 à 1) en dessous duquel un pixel disparaît.
    pub similarity: f64,
    /// Largeur du bord progressif au-delà de cet écart.
    pub blend: f64,
    /// Retire le reflet de la couleur sur le sujet.
    pub despill: bool,
}

/// La clé prête à être appliquée pixel par pixel.
#[derive(Debug, Clone, Copy)]
pub struct Keyer {
    u: f64,
    v: f64,
    similarity: f64,
    blend: f64,
    /// Canal (0, 1, 2) dont l'excès est retiré, s'il faut retirer le reflet.
    despill: Option<usize>,
}

/// Les composantes de couleur (sans la luminance), BT.601 pleine échelle, centrées sur 0.
fn chroma(r: f64, g: f64, b: f64) -> (f64, f64) {
    (
        -0.168736 * r - 0.331264 * g + 0.5 * b,
        0.5 * r - 0.418688 * g - 0.081312 * b,
    )
}

fn parse_hex(color: &str) -> Option<[u8; 3]> {
    let hex = color.strip_prefix('#')?;
    if hex.len() != 6 || !hex.is_ascii() {
        return None;
    }
    let byte = |at: usize| u8::from_str_radix(&hex[at..at + 2], 16).ok();
    Some([byte(0)?, byte(2)?, byte(4)?])
}

impl Keyer {
    /// `despill` n'est possible que sur l'image d'origine : le reflet n'a plus la même couleur
    /// après un filtre de couleur. `None` si la couleur est illisible.
    pub fn new(key: &ChromaKey, allow_despill: bool) -> Option<Self> {
        let [r, g, b] = parse_hex(&key.color)?;
        let (u, v) = chroma(r.into(), g.into(), b.into());
        let channels = [r, g, b];
        let dominant = (0..3).find(|&i| (0..3).all(|j| i == j || channels[i] > channels[j]));
        let tame = |x: f64| {
            if x.is_finite() {
                x.clamp(0.0, 1.0)
            } else {
                0.0
            }
        };
        Some(Self {
            u,
            v,
            similarity: tame(key.similarity),
            blend: tame(key.blend),
            despill: dominant.filter(|_| key.despill && allow_despill),
        })
    }

    /// Part (0 à 1) d'un pixel de cette couleur qui reste visible.
    pub fn opacity(&self, rgb: [u8; 3]) -> f64 {
        let (u, v) = chroma(rgb[0].into(), rgb[1].into(), rgb[2].into());
        let distance =
            (((u - self.u).powi(2) + (v - self.v).powi(2)) / (2.0 * 255.0 * 255.0)).sqrt();
        if self.blend > 0.0001 {
            ((distance - self.similarity) / self.blend).clamp(0.0, 1.0)
        } else if distance > self.similarity {
            1.0
        } else {
            0.0
        }
    }

    /// La couleur débarrassée du reflet : le canal de la clé ne dépasse plus les deux autres.
    pub fn despilled(&self, mut rgb: [u8; 3]) -> [u8; 3] {
        if let Some(channel) = self.despill {
            let ceiling = rgb[(channel + 1) % 3].max(rgb[(channel + 2) % 3]);
            rgb[channel] = rgb[channel].min(ceiling);
        }
        rgb
    }

    /// Détoure `frame` (RGBA prémultiplié). La transparence se décide sur `mask`, l'image
    /// d'origine de mêmes dimensions, ou sur `frame` elle-même à défaut.
    pub fn apply(&self, frame: &mut [u8], mask: Option<&[u8]>) {
        let straight = |p: &[u8]| -> [u8; 3] {
            match p[3] {
                255 => [p[0], p[1], p[2]],
                0 => [0, 0, 0],
                a => [0, 1, 2].map(|i| ((u32::from(p[i]) * 255) / u32::from(a)).min(255) as u8),
            }
        };
        let mask = mask.filter(|m| m.len() == frame.len());
        for (at, pixel) in frame.chunks_mut(4).enumerate() {
            let own = straight(pixel);
            let judged = mask.map_or(own, |m| straight(&m[at * 4..at * 4 + 4]));
            let alpha = (f64::from(pixel[3]) * self.opacity(judged)).round() as u32;
            let color = self.despilled(own);
            for (i, channel) in color.into_iter().enumerate() {
                pixel[i] = ((u32::from(channel) * alpha + 127) / 255) as u8;
            }
            pixel[3] = alpha as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct Case {
        key: ChromaKey,
        rgb: [u8; 3],
        alpha: u8,
        out: [u8; 3],
    }

    /// Les mêmes cas que `src/lib/chroma.test.ts`.
    #[test]
    fn the_shared_cases_give_the_expected_pixels() {
        let cases: Vec<Case> =
            serde_json::from_str(include_str!("chroma_cases.json")).expect("cas lisibles");
        assert!(cases.len() >= 8);
        for case in cases {
            let keyer = Keyer::new(&case.key, true).unwrap();
            let alpha = (255.0 * keyer.opacity(case.rgb)).round() as u8;
            let out = keyer.despilled(case.rgb);
            assert_eq!((alpha, out), (case.alpha, case.out), "{:?}", case.rgb);
        }
    }

    fn key() -> ChromaKey {
        ChromaKey {
            color: "#00ff00".into(),
            similarity: 0.2,
            blend: 0.1,
            despill: true,
        }
    }

    #[test]
    fn the_mask_decides_what_disappears_and_the_frame_gives_the_colour() {
        // Pixel 1 : vert d'origine (devenu magenta par un filtre). Pixel 2 : gris.
        let mask = [0, 255, 0, 255, 128, 128, 128, 255];
        let mut frame = [255, 0, 255, 255, 127, 127, 127, 255];
        Keyer::new(&key(), false)
            .unwrap()
            .apply(&mut frame, Some(&mask));
        assert_eq!(frame, [0, 0, 0, 0, 127, 127, 127, 255]);
    }

    #[test]
    fn a_half_transparent_pixel_stays_premultiplied() {
        let mut frame = [64, 64, 64, 128];
        Keyer::new(&key(), true).unwrap().apply(&mut frame, None);
        assert_eq!(frame, [64, 64, 64, 128]);
    }

    #[test]
    fn an_unreadable_colour_keys_nothing() {
        for color in ["green", "#12", "#zzzzzz", "#ééé"] {
            let bad = ChromaKey {
                color: color.into(),
                ..key()
            };
            assert!(Keyer::new(&bad, true).is_none(), "{color}");
        }
    }
}
