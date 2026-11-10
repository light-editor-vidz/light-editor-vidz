//! Commandes de la vue « Audio » (ex-LightCutSoundz) : ouvrir un fichier audio, le décoder, le
//! traiter et l'exporter. Le moteur est dans le crate `audio-dsp` ; ici, seulement la colle Tauri
//! (dialogues, événements de progression, autorisations de chemins).
//!
//! Les chemins reçus du WebView ne sont acceptés que s'ils viennent d'un geste de l'utilisateur
//! (dialogue natif, fichier déposé sur la fenêtre) : voir `audio_dsp::approval`.

use audio_dsp::approval::{self, Approved};
use audio_dsp::error::CmdError;
use audio_dsp::job::Job;
use audio_dsp::pipeline::{
    load_audio_blocking, process_blocking, AudioInfo, DecodeCache, ProcessOptions, AUDIO_EXTENSIONS,
};
use audio_dsp::recent::{self, RecentFile};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;

/// Extensions vidéo et image acceptées par « Fichier > Ouvrir ».
const VIDEO_EXTENSIONS: [&str; 9] = [
    "mp4", "mov", "avi", "mkv", "webm", "flv", "m4v", "mpg", "mpeg",
];
const IMAGE_EXTENSIONS: [&str; 7] = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff"];

/// Drapeau d'annulation de l'export en cours, levé par le bouton Annuler.
#[derive(Default)]
pub struct AudioExportControl(Arc<AtomicBool>);

/// Fichier choisi dans « Fichier > Ouvrir » et son type.
#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct PickedFile {
    pub path: String,
    pub kind: &'static str,
}

/// Type d'un fichier d'après son extension : `audio`, `video`, `image` ou `unknown`.
pub fn kind_of(path: &str) -> &'static str {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if AUDIO_EXTENSIONS.contains(&ext.as_str()) {
        "audio"
    } else if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
        "video"
    } else if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        "image"
    } else {
        "unknown"
    }
}

/// Exécute `job` sur le pool bloquant : décodage, DSP et attente de ffmpeg occuperaient sinon un
/// worker async partagé avec l'IPC.
async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> Result<T, CmdError> {
    match tauri::async_runtime::spawn_blocking(job).await {
        Ok(result) => result.map_err(CmdError::from),
        Err(e) => Err(anyhow::anyhow!("Background task failed: {e}").into()),
    }
}

/// Un dialogue de fichier natif, sur le pool bloquant (il attend l'utilisateur).
async fn dialog<R: Runtime>(
    app: &AppHandle<R>,
    build: impl FnOnce(tauri_plugin_dialog::FileDialogBuilder<R>) -> Option<tauri_plugin_dialog::FilePath>
        + Send
        + 'static,
) -> Result<Option<String>, CmdError> {
    let handle = app.clone();
    let picked = blocking(move || {
        let mut dialog = handle.dialog().file();
        if let Some(window) = handle.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        Ok(build(dialog))
    })
    .await?;
    picked
        .map(|p| {
            let path = p.into_path().map_err(anyhow::Error::from)?;
            path.to_str()
                .map(String::from)
                .ok_or_else(|| anyhow::anyhow!("The chosen path is not valid UTF-8"))
        })
        .transpose()
        .map_err(CmdError::from)
}

/// Fichier de la liste des fichiers audio récents.
fn recent_file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join(recent::FILE_NAME))
}

/// Rend ce fichier lisible par le WebView via le protocole `asset:` (aperçu audio). La portée
/// statique est vide : rien n'est lisible tant que l'utilisateur n'a pas choisi ou déposé le
/// fichier.
fn authorize<R: Runtime>(app: &AppHandle<R>, path: &str) -> anyhow::Result<()> {
    app.state::<Approved>().check_input(path)?;
    app.asset_protocol_scope()
        .allow_file(path)
        .map_err(|e| anyhow::anyhow!("Cannot open '{path}' for preview: {e}"))
}

/// « Fichier > Ouvrir » : un seul dialogue pour tous les médias ; le type du fichier choisi
/// décide de ce que l'interface ouvre. Un fichier audio est autorisé en lecture.
#[tauri::command]
pub async fn pick_media_file<R: Runtime>(
    app: AppHandle<R>,
    approved: State<'_, Approved>,
) -> Result<Option<PickedFile>, CmdError> {
    let picked = dialog(&app, |d| {
        let all: Vec<&str> = AUDIO_EXTENSIONS
            .iter()
            .chain(VIDEO_EXTENSIONS.iter())
            .chain(IMAGE_EXTENSIONS.iter())
            .copied()
            .collect();
        d.add_filter("Media", &all)
            .add_filter("Audio", &AUDIO_EXTENSIONS)
            .add_filter("Video", &VIDEO_EXTENSIONS)
            .add_filter("Image", &IMAGE_EXTENSIONS)
            .blocking_pick_file()
    })
    .await?;
    Ok(picked.map(|path| {
        let kind = kind_of(&path);
        // L'audio et la vidéo se lisent via le protocole `asset:` : leur accès passe par là.
        if kind == "audio" || kind == "video" {
            approved.allow_input(&path);
        }
        PickedFile { path, kind }
    }))
}

/// Type d'un fichier déposé sur la fenêtre (déjà autorisé par l'événement de dépôt).
#[tauri::command]
pub fn media_kind(path: String) -> &'static str {
    kind_of(&path)
}

/// Le sélecteur de fichier audio : seul un fichier qu'il renvoie peut être ouvert.
#[tauri::command]
pub async fn audio_pick_file<R: Runtime>(
    app: AppHandle<R>,
    approved: State<'_, Approved>,
) -> Result<Option<String>, CmdError> {
    let picked = dialog(&app, |d| {
        d.add_filter("Audio", &AUDIO_EXTENSIONS)
            .blocking_pick_file()
    })
    .await?;
    if let Some(path) = &picked {
        approved.allow_input(path);
    }
    Ok(picked)
}

/// Dialogue « Enregistrer sous » : l'extension du format choisi est ajoutée si l'utilisateur
/// l'a omise, et seul le résultat peut être écrit.
#[tauri::command]
pub async fn audio_pick_output<R: Runtime>(
    app: AppHandle<R>,
    approved: State<'_, Approved>,
    default_path: String,
    ext: String,
) -> Result<Option<String>, CmdError> {
    let p = Path::new(&default_path);
    let dir = p.parent().map(Path::to_path_buf);
    let name = p.file_name().and_then(|n| n.to_str()).map(String::from);
    let filter_ext = ext.clone();
    let picked = dialog(&app, move |mut d| {
        if let Some(dir) = dir.filter(|d| d.is_dir()) {
            d = d.set_directory(dir);
        }
        if let Some(name) = name {
            d = d.set_file_name(name);
        }
        d.add_filter(filter_ext.to_uppercase(), &[filter_ext.as_str()])
            .blocking_save_file()
    })
    .await?;
    Ok(picked.map(|path| {
        let path = approval::ensure_extension(&path, &ext);
        approved.allow_output(&path);
        path
    }))
}

#[tauri::command]
pub async fn audio_allow_asset<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<(), CmdError> {
    authorize(&app, &path).map_err(CmdError::from)
}

#[tauri::command]
pub async fn audio_load<R: Runtime>(
    app: AppHandle<R>,
    approved: State<'_, Approved>,
    cache: State<'_, DecodeCache>,
    path: String,
    points: usize,
) -> Result<AudioInfo, CmdError> {
    approved.check_input(&path).map_err(CmdError::from)?;
    let cache = cache.inner().clone();
    let recorded = path.clone();
    let info = blocking(move || load_audio_blocking(&cache, &path, points)).await?;
    if let Some(file) = recent_file(&app) {
        recent::record(&file, &recorded);
    }
    Ok(info)
}

/// Les fichiers audio récents, chacun autorisé en ouverture.
#[tauri::command]
pub fn audio_recent_list<R: Runtime>(
    app: AppHandle<R>,
    approved: State<'_, Approved>,
) -> Vec<RecentFile> {
    let list = recent_file(&app)
        .map(|f| recent::existing(&f))
        .unwrap_or_default();
    for file in &list {
        approved.allow_input(&file.path);
    }
    list
}

/// Retire une entrée de la liste, ou toutes si `path` est absent.
#[tauri::command]
pub fn audio_recent_forget<R: Runtime>(app: AppHandle<R>, path: Option<String>) {
    if let Some(file) = recent_file(&app) {
        recent::forget(&file, path.as_deref());
    }
}

#[tauri::command]
pub async fn audio_process<R: Runtime>(
    app: AppHandle<R>,
    approved: State<'_, Approved>,
    cache: State<'_, DecodeCache>,
    control: State<'_, AudioExportControl>,
    opts: ProcessOptions,
) -> Result<(), CmdError> {
    approved.check_input(&opts.input).map_err(CmdError::from)?;
    approved
        .check_output(&opts.output)
        .map_err(CmdError::from)?;
    let cache = cache.inner().clone();
    let cancel = control.0.clone();
    cancel.store(false, Ordering::Relaxed);

    // Un événement par pourcent, pas un par bloc.
    let last = AtomicU8::new(255);
    let job = Job::new(cancel, move |fraction| {
        let percent = (fraction * 100.0) as u8;
        if last.swap(percent, Ordering::Relaxed) != percent {
            let _ = app.emit("audio-export-progress", percent);
        }
    });
    blocking(move || process_blocking(&cache, &opts, &job)).await
}

#[tauri::command]
pub fn audio_cancel(control: State<'_, AudioExportControl>) {
    control.0.store(true, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_kind_of_a_file_follows_its_extension_whatever_the_case() {
        assert_eq!(kind_of("/m/song.MP3"), "audio");
        assert_eq!(kind_of("/m/take.flac"), "audio");
        assert_eq!(kind_of("/m/clip.MOV"), "video");
        assert_eq!(
            kind_of("/m/clip.webm"),
            "audio",
            "webm audio is read as audio first"
        );
        assert_eq!(kind_of("/m/photo.JPG"), "image");
        assert_eq!(kind_of("/m/notes.txt"), "unknown");
        assert_eq!(kind_of("/m/noextension"), "unknown");
    }

    #[test]
    fn every_extension_belongs_to_exactly_one_kind_except_webm() {
        for ext in VIDEO_EXTENSIONS {
            if ext != "webm" {
                assert!(!AUDIO_EXTENSIONS.contains(&ext), "{ext}");
            }
        }
        for ext in IMAGE_EXTENSIONS {
            assert!(
                !AUDIO_EXTENSIONS.contains(&ext) && !VIDEO_EXTENSIONS.contains(&ext),
                "{ext}"
            );
        }
    }
}
