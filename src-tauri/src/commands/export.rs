use super::error::{CmdResult, CommandError};
use super::registry::OpenProjects;
use crate::export::{export_audio, export_video, AudioFormat, ExportOverrides};
use audio_dsp::approval::Approved;
use scene_core::model::Project;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager, State};

/// Surcharges d'export optionnelles envoyées par le frontend (résolution/fps/qualité) —
/// n'affectent que le fichier exporté, jamais les réglages enregistrés dans le projet.
#[derive(Debug, Deserialize)]
pub struct ExportOptions {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<u32>,
    pub crf: Option<u32>,
}

/// État partagé de l'export en cours : drapeau d'annulation et verrou « un seul export à la
/// fois » (les deux exports se disputeraient CPU, ffmpeg et le même drapeau).
#[derive(Default)]
pub struct ExportControl {
    cancel: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
}

impl ExportControl {
    /// Un export de projet tourne.
    pub fn is_busy(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Demande l'arrêt de l'export en cours (ffmpeg et le fichier `.part` sont alors nettoyés).
    pub fn request_cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }
}

/// Libère le verrou d'export quoi qu'il arrive (retour normal, erreur, panic).
struct RunningGuard(Arc<AtomicBool>);

impl Drop for RunningGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[derive(Debug, Serialize)]
pub struct ExportResult {
    /// Sources média (images, vidéos, sons) introuvables ou illisibles : l'export a réussi mais
    /// elles n'y figurent pas.
    pub missing_media: Vec<String>,
}

/// Exporte le projet en mp4. `output_path` vient d'un dialogue "Enregistrer sous" côté
/// frontend. Émet `export-progress` (fraction 0.0..1.0). Le travail (plusieurs minutes) tourne
/// sur un thread dédié (`spawn_blocking`) : un panic y devient une erreur renvoyée au frontend
/// au lieu d'une promesse qui ne se résout jamais.
#[tauri::command]
pub async fn export_project(
    app: tauri::AppHandle,
    control: State<'_, ExportControl>,
    projects: State<'_, OpenProjects>,
    project_dir: String,
    project: Project,
    output_path: String,
    options: Option<ExportOptions>,
) -> CmdResult<ExportResult> {
    let project_dir = projects.require(&project_dir)?;
    // Seule une destination choisie dans « Enregistrer sous » peut être écrite (et renommée
    // par-dessus un fichier existant).
    app.state::<Approved>()
        .check_output(&output_path)
        .map_err(|e| CommandError::from(audio_dsp::error::CmdError::from(e)))?;
    if control.running.swap(true, Ordering::SeqCst) {
        return Err(("An export is already running.".to_string()).into());
    }
    let _guard = RunningGuard(control.running.clone());
    let cancel = control.cancel.clone();
    cancel.store(false, Ordering::SeqCst);

    let overrides = options
        .map(|o| ExportOverrides {
            width: o.width,
            height: o.height,
            fps: o.fps,
            crf: o.crf,
        })
        .unwrap_or_default();
    let output_path = PathBuf::from(output_path);
    let report = tauri::async_runtime::spawn_blocking(move || {
        export_video(
            &project,
            &project_dir,
            &output_path,
            overrides,
            &cancel,
            |fraction| {
                let _ = app.emit("export-progress", fraction);
            },
        )
    })
    .await
    .map_err(|e| format!("The export crashed: {e}"))??;
    Ok(ExportResult {
        missing_media: report.missing_media,
    })
}

/// Exporte uniquement le son du projet (mix des pistes audio et de l'audio des vidéos) dans le
/// format demandé. Même verrou, même annulation et même événement `export-progress` que
/// `export_project`.
#[tauri::command]
pub async fn export_project_audio(
    app: tauri::AppHandle,
    control: State<'_, ExportControl>,
    projects: State<'_, OpenProjects>,
    project_dir: String,
    project: Project,
    output_path: String,
    format: AudioFormat,
) -> CmdResult<ExportResult> {
    let project_dir = projects.require(&project_dir)?;
    // Seule une destination choisie dans « Enregistrer sous » peut être écrite (et renommée
    // par-dessus un fichier existant).
    app.state::<Approved>()
        .check_output(&output_path)
        .map_err(|e| CommandError::from(audio_dsp::error::CmdError::from(e)))?;
    if control.running.swap(true, Ordering::SeqCst) {
        return Err(("An export is already running.".to_string()).into());
    }
    let _guard = RunningGuard(control.running.clone());
    let cancel = control.cancel.clone();
    cancel.store(false, Ordering::SeqCst);

    let output_path = PathBuf::from(output_path);
    let report = tauri::async_runtime::spawn_blocking(move || {
        export_audio(
            &project,
            &project_dir,
            &output_path,
            format,
            &cancel,
            |fraction| {
                let _ = app.emit("export-progress", fraction);
            },
        )
    })
    .await
    .map_err(|e| format!("The export crashed: {e}"))??;
    Ok(ExportResult {
        missing_media: report.missing_media,
    })
}

/// Demande l'arrêt de l'export en cours (sans effet s'il n'y en a pas).
#[tauri::command]
pub fn cancel_export(control: State<'_, ExportControl>) {
    control.cancel.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_export_destination_must_have_been_chosen_by_the_user() {
        let approved = Approved::default();
        assert!(approved.check_output("/home/me/.bashrc").is_err());
        approved.allow_output("/home/me/out.mp4");
        assert!(approved.check_output("/home/me/out.mp4").is_ok());
        // Une destination approuvée n'ouvre pas la lecture, et inversement.
        assert!(approved.check_input("/home/me/out.mp4").is_err());
    }

    #[test]
    fn quitting_can_tell_a_running_export_and_ask_it_to_stop() {
        let control = ExportControl::default();
        assert!(!control.is_busy());

        control.running.store(true, Ordering::SeqCst);
        assert!(control.is_busy());
        control.request_cancel();
        assert!(control.cancel.load(Ordering::SeqCst));

        // Le verrou libéré (fin ou annulation de l'export) autorise la sortie.
        drop(RunningGuard(control.running.clone()));
        assert!(!control.is_busy());
    }
}
