//! Construction des commandes ffmpeg de la vue Vidéo (ex-LightCutVidz). Fonctions pures : rien ici
//! ne lance ffmpeg ni ne touche au disque, tout est donc testable.

pub mod atempo;
pub mod export;
pub mod ffmpeg;
pub mod filters;
pub mod hardware;
pub mod plan;
pub mod preview;
pub mod queue;
pub mod subtitles;
pub mod text;
pub mod video_filters;
