//! Génération de sous-titres (ex-LightGenSubz) : extraction de la piste audio, transcription
//! (Whisper local ou cloud), découpage en répliques, traduction (NLLB local ou cloud) et écriture
//! en `.srt` / `.vtt` / `.ass`.

pub mod app_dirs;
pub mod cancel;
pub mod cloud_models;
pub mod commands;
pub mod config;
pub mod download;
pub mod errors;
pub mod http;
pub mod models;
pub mod paths;
pub mod pipeline;
