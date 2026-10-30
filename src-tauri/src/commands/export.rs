use super::error::CmdResult;
use super::registry::OpenProjects;
use crate::export::{export_video, ExportOverrides};
use scene_core::model::Project;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, State};

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

/// Demande l'arrêt de l'export en cours (sans effet s'il n'y en a pas).
#[tauri::command]
pub fn cancel_export(control: State<'_, ExportControl>) {
    control.cancel.store(true, Ordering::SeqCst);
}
