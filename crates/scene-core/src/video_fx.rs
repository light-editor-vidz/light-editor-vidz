//! Effets d'une vidéo posée dans une scène (filtre de couleur, recadrage) : la chaîne ffmpeg
//! appliquée au décodage pour l'export, et la taille que les frames ont ensuite. Les 20 filtres de
//! couleur sont partagés avec la vue Vidéo et avec l'aperçu CSS (`video_fx_filters.json`).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ColorFilter {
    pub id: String,
    #[serde(rename = "nameEn")]
    pub name_en: String,
    #[serde(rename = "nameFr")]
    pub name_fr: String,
    pub css: String,
    pub ffmpeg: String,
}

const FILTERS_JSON: &str = include_str!("video_fx_filters.json");

/// Tous les filtres, « aucun » en tête.
pub fn filters() -> Vec<ColorFilter> {
    serde_json::from_str(FILTERS_JSON).expect("video_fx_filters.json est valide")
}

/// Chaîne ffmpeg du filtre `id` ; vide pour « aucun » ou un identifiant inconnu.
pub fn ffmpeg_for(id: &str) -> String {
    filters()
        .into_iter()
        .find(|f| f.id == id)
        .map(|f| f.ffmpeg)
        .unwrap_or_default()
}

/// Zone conservée de l'image source, en fractions (0-1) de sa largeur et de sa hauteur.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VideoCrop {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl VideoCrop {
    /// Borne la zone dans l'image et lui garde une taille minimale.
    pub fn clamped(self) -> Self {
        let min = 0.02;
        let w = self.w.clamp(min, 1.0);
        let h = self.h.clamp(min, 1.0);
        Self {
            x: self.x.clamp(0.0, 1.0 - w),
            y: self.y.clamp(0.0, 1.0 - h),
            w,
            h,
        }
    }
}

/// Taille des frames une fois recadrées (paires, comme l'exige le décodage yuv420p en amont).
pub fn effective_size(source: (u32, u32), crop: Option<VideoCrop>) -> (u32, u32) {
    let Some(c) = crop.map(VideoCrop::clamped) else {
        return source;
    };
    let even = |v: f64| (((v.round() as u32) / 2) * 2).max(2);
    (
        even(source.0 as f64 * c.w).min(source.0),
        even(source.1 as f64 * c.h).min(source.1),
    )
}

/// Filtres appliqués avant la mise à l'échelle : recadrage, puis couleur. Vide si rien à faire.
pub fn element_filter_chain(crop: Option<VideoCrop>, color_filter: Option<&str>) -> String {
    let mut parts = Vec::new();
    if let Some(c) = crop.map(VideoCrop::clamped) {
        if c.w < 1.0 || c.h < 1.0 {
            parts.push(format!(
                "crop=trunc(iw*{:.5}/2)*2:trunc(ih*{:.5}/2)*2:trunc(iw*{:.5}):trunc(ih*{:.5})",
                c.w, c.h, c.x, c.y
            ));
        }
    }
    if let Some(id) = color_filter {
        let f = ffmpeg_for(id);
        if !f.is_empty() {
            parts.push(f);
        }
    }
    parts.join(",")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn there_are_twenty_filters_starting_with_none() {
        let all = filters();
        assert_eq!(all.len(), 20);
        assert_eq!((all[0].id.as_str(), all[0].ffmpeg.as_str()), ("none", ""));
    }

    #[test]
    fn identifiers_are_unique_and_every_filter_has_both_names() {
        let all = filters();
        let mut ids: Vec<_> = all.iter().map(|f| f.id.as_str()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), all.len());
        assert!(all
            .iter()
            .all(|f| !f.name_en.is_empty() && !f.name_fr.is_empty()));
    }

    #[test]
    fn a_filter_maps_to_its_ffmpeg_chain() {
        assert_eq!(ffmpeg_for("grayscale"), "hue=s=0");
        assert_eq!(ffmpeg_for("none"), "");
        assert_eq!(ffmpeg_for("nope"), "");
    }

    #[test]
    fn a_crop_is_kept_inside_the_image() {
        let c = VideoCrop {
            x: 0.9,
            y: -1.0,
            w: 0.5,
            h: 5.0,
        }
        .clamped();
        assert_eq!((c.x, c.y, c.w, c.h), (0.5, 0.0, 0.5, 1.0));
        assert_eq!(
            VideoCrop {
                x: 0.0,
                y: 0.0,
                w: 0.0,
                h: 0.0
            }
            .clamped()
            .w,
            0.02
        );
    }

    #[test]
    fn the_cropped_size_is_even_and_inside_the_source() {
        assert_eq!(effective_size((1920, 1080), None), (1920, 1080));
        assert_eq!(
            effective_size(
                (1920, 1080),
                Some(VideoCrop {
                    x: 0.0,
                    y: 0.0,
                    w: 0.5,
                    h: 0.5
                })
            ),
            (960, 540)
        );
        assert_eq!(
            effective_size(
                (101, 51),
                Some(VideoCrop {
                    x: 0.0,
                    y: 0.0,
                    w: 1.0,
                    h: 1.0
                })
            ),
            (100, 50)
        );
        assert_eq!(
            effective_size(
                (3, 3),
                Some(VideoCrop {
                    x: 0.0,
                    y: 0.0,
                    w: 0.02,
                    h: 0.02
                })
            ),
            (2, 2)
        );
    }

    #[test]
    fn the_chain_crops_first_then_colours() {
        let c = Some(VideoCrop {
            x: 0.25,
            y: 0.1,
            w: 0.5,
            h: 0.8,
        });
        assert_eq!(
            element_filter_chain(c, Some("grayscale")),
            "crop=trunc(iw*0.50000/2)*2:trunc(ih*0.80000/2)*2:trunc(iw*0.25000):trunc(ih*0.10000),hue=s=0"
        );
        assert_eq!(element_filter_chain(None, Some("grayscale")), "hue=s=0");
        assert_eq!(element_filter_chain(None, Some("none")), "");
        assert_eq!(element_filter_chain(None, None), "");
        // Un recadrage qui garde toute l'image n'ajoute pas de filtre.
        assert_eq!(
            element_filter_chain(
                Some(VideoCrop {
                    x: 0.0,
                    y: 0.0,
                    w: 1.0,
                    h: 1.0
                }),
                None
            ),
            ""
        );
    }
}
