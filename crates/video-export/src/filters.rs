//! Les filtres de couleur proposés (aperçu CSS et chaîne ffmpeg), partagés avec l'interface et
//! avec les vidéos posées dans les scènes : la table vit dans `scene_core::video_fx`.

pub use scene_core::video_fx::{ffmpeg_for, filters as all, ColorFilter};
