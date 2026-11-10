//! Génération de sous-titres depuis l'éditeur : un fichier audio ou vidéo, un média d'un projet,
//! ou le projet entier (le son de toutes ses scènes et pistes, mixé). Le travail est fait par le
//! moteur de `subz` ; ici, seulement l'autorisation des chemins et la préparation de l'audio.

use crate::commands::registry::OpenProjects;
use crate::export::{export_audio, AudioFormat};
use crate::subz::cancel;
use crate::subz::errors::{coded, CommandError};
use crate::subz::paths;
use crate::subz::pipeline::audio_extract::{self, AudioTrack};
use crate::subz::pipeline::{self, PipelineOutput};
use audio_dsp::approval::Approved;
use scene_core::model::Project;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

fn refuse(message: impl Into<String>) -> CommandError {
    CommandError::from(anyhow::anyhow!(message.into()))
}

/// Un fichier que l'utilisateur a choisi (dialogue ou dépôt) : le moteur de sous-titres l'accepte
/// alors, et seulement lui.
fn allow_chosen(approved: &Approved, path: &str) -> Result<PathBuf, CommandError> {
    approved
        .check_input(path)
        .map_err(|e| refuse(e.to_string()))?;
    let path = PathBuf::from(path);
    paths::allow_input(&path);
    Ok(path)
}

/// Un média d'un projet ouvert, résolu côté Rust (jamais hors du dossier projet).
fn project_media(
    projects: &OpenProjects,
    project_dir: &str,
    src: &str,
) -> Result<PathBuf, CommandError> {
    let dir = projects.require(project_dir).map_err(refuse)?;
    let path = scene_core::paths::resolve_media_path(&dir, src).map_err(refuse)?;
    paths::allow_input(&path);
    Ok(path)
}

async fn tracks_of(path: PathBuf) -> Result<Vec<AudioTrack>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || audio_extract::list_audio_tracks(&path))
        .await
        .map_err(|e| refuse(e.to_string()))?
        .map_err(CommandError::from)
}

/// Les pistes audio d'un fichier choisi (plusieurs pour un film multilingue).
#[tauri::command]
pub async fn subs_audio_tracks(
    approved: State<'_, Approved>,
    path: String,
) -> Result<Vec<AudioTrack>, CommandError> {
    tracks_of(allow_chosen(&approved, &path)?).await
}

/// Les pistes audio d'un média de projet.
#[tauri::command]
pub async fn subs_media_tracks(
    projects: State<'_, OpenProjects>,
    project_dir: String,
    src: String,
) -> Result<Vec<AudioTrack>, CommandError> {
    tracks_of(project_media(&projects, &project_dir, &src)?).await
}

/// Sous-titres d'un fichier audio ou vidéo choisi (vue Vidéo, vue Audio).
#[tauri::command]
pub async fn subs_generate_file(
    app: AppHandle,
    approved: State<'_, Approved>,
    path: String,
    audio_track: Option<u32>,
) -> Result<PipelineOutput, CommandError> {
    let path = allow_chosen(&approved, &path)?;
    Ok(pipeline::run(app, paths::to_webview(&path), audio_track).await?)
}

/// Sous-titres d'un média d'un projet (élément vidéo, piste audio).
#[tauri::command]
pub async fn subs_generate_media(
    app: AppHandle,
    projects: State<'_, OpenProjects>,
    project_dir: String,
    src: String,
    audio_track: Option<u32>,
) -> Result<PipelineOutput, CommandError> {
    let path = project_media(&projects, &project_dir, &src)?;
    Ok(pipeline::run(app, paths::to_webview(&path), audio_track).await?)
}

fn mix_path() -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("lev_subs_mix_{}_{nanos}.wav", std::process::id()))
}

/// Un nom de fichier sûr pour proposer l'enregistrement : le nom du projet, `.srt`, à côté du
/// dossier projet.
fn suggested_srt(project_dir: &Path, project_name: &str) -> PathBuf {
    let stem: String = project_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || " _-".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    let stem = if stem.trim().is_empty() {
        "subtitles".to_string()
    } else {
        stem.trim().to_string()
    };
    let parent = project_dir.parent().unwrap_or(project_dir);
    pipeline::unique_path(&parent.join(format!("{stem}.srt")))
}

/// Sous-titres du projet entier : le son de toutes les scènes et pistes est mixé (comme à
/// l'export), transcrit, et les répliques sont comptées sur la timeline du projet.
#[tauri::command]
pub async fn subs_generate_project(
    app: AppHandle,
    projects: State<'_, OpenProjects>,
    project_dir: String,
    project: Project,
) -> Result<PipelineOutput, CommandError> {
    let dir = projects.require(&project_dir).map_err(refuse)?;
    // Annuler ou quitter pendant le mix l'arrête aussi.
    cancel::reset();
    let _busy = cancel::Busy::enter();
    let mix = mix_path();
    let (mix_out, mix_project, mix_dir) = (mix.clone(), project.clone(), dir.clone());
    // Le mix passe par la même chaîne que l'export audio : durée du projet, volumes, fondus.
    let mixed = tauri::async_runtime::spawn_blocking(move || {
        export_audio(
            &mix_project,
            &mix_dir,
            &mix_out,
            AudioFormat::Wav16,
            cancel::flag(),
            |_| {},
        )
    })
    .await
    .map_err(|e| refuse(e.to_string()))?;
    if cancel::is_cancelled() {
        let _ = std::fs::remove_file(&mix);
        return Err(CommandError::from(coded("cancelled", "cancelled")));
    }
    if let Err(e) = mixed {
        let _ = std::fs::remove_file(&mix);
        return Err(refuse(e));
    }
    paths::allow_input(&mix);
    let result = pipeline::run(app, paths::to_webview(&mix), None).await;
    let _ = std::fs::remove_file(&mix);
    let mut output = result?;
    // Le fichier à enregistrer porte le nom du projet, pas celui du mix temporaire.
    let suggestion = suggested_srt(&dir, &project.name);
    paths::mark_output(&suggestion);
    output.srt_path = paths::to_webview(&suggestion);
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_mix_files_are_distinct_and_in_the_temp_dir() {
        let a = mix_path();
        let b = mix_path();
        assert_ne!(a, b);
        assert!(a.starts_with(std::env::temp_dir()) && a.extension().is_some_and(|e| e == "wav"));
    }

    #[test]
    fn the_suggested_file_is_the_project_name_next_to_the_project_folder() {
        let dir = std::env::temp_dir()
            .join("lev_subs_test")
            .join("My Spot.lvproj");
        let out = suggested_srt(&dir, "My/Spot: v2");
        assert_eq!(
            out.file_name().unwrap().to_string_lossy(),
            "My_Spot_ v2.srt"
        );
        assert_eq!(out.parent().unwrap(), dir.parent().unwrap());
    }

    #[test]
    fn an_empty_project_name_still_gets_a_name() {
        let dir = std::env::temp_dir().join("lev_subs_test2").join("p.lvproj");
        assert_eq!(
            suggested_srt(&dir, "  ")
                .file_name()
                .unwrap()
                .to_string_lossy(),
            "subtitles.srt"
        );
    }

    #[test]
    fn a_path_nobody_chose_is_refused() {
        let approved = Approved::default();
        assert!(allow_chosen(&approved, "/etc/passwd").is_err());
        approved.allow_input("/home/me/clip.mp4");
        assert_eq!(
            allow_chosen(&approved, "/home/me/clip.mp4").unwrap(),
            PathBuf::from("/home/me/clip.mp4")
        );
    }
}
