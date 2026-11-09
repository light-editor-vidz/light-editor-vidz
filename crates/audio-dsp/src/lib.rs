//! Moteur audio de la vue « Audio » (ex-LightCutSoundz) : décodage en mémoire, traitement
//! (coupes, fondus, vitesse, filtres, normalisation) et export. Aucune dépendance à Tauri.

pub mod approval;
pub mod audio;
pub mod error;
pub mod job;
pub mod ops;
pub mod pipeline;
pub mod recent;
pub mod tags;
