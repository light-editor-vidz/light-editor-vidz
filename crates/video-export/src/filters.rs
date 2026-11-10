//! Les filtres de couleur proposés (aperçu CSS et chaîne ffmpeg), partagés avec l'interface.

use serde::{Deserialize, Serialize};

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

const FILTERS_JSON: &str = include_str!("filters.json");

/// Tous les filtres, « aucun » en tête.
pub fn all() -> Vec<ColorFilter> {
    serde_json::from_str(FILTERS_JSON).expect("filters.json est valide")
}

/// Chaîne ffmpeg du filtre `id` ; vide pour « aucun » ou un identifiant inconnu.
pub fn ffmpeg_for(id: &str) -> String {
    all()
        .into_iter()
        .find(|f| f.id == id)
        .map(|f| f.ffmpeg)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn there_are_twenty_filters_starting_with_none() {
        let filters = all();
        assert_eq!(filters.len(), 20);
        assert_eq!(filters[0].id, "none");
        assert_eq!(filters[0].ffmpeg, "");
    }

    #[test]
    fn identifiers_are_unique_and_every_filter_has_both_names() {
        let filters = all();
        let mut ids: Vec<_> = filters.iter().map(|f| f.id.as_str()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), filters.len());
        assert!(filters
            .iter()
            .all(|f| !f.name_en.is_empty() && !f.name_fr.is_empty()));
    }

    #[test]
    fn a_filter_maps_to_its_ffmpeg_chain() {
        assert_eq!(ffmpeg_for("grayscale"), "hue=s=0");
        assert_eq!(ffmpeg_for("invert"), "negate");
        assert_eq!(ffmpeg_for("nope"), "");
    }
}
