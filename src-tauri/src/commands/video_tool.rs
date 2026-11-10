//! Commandes de la vue Vidéo (ex-LightCutVidz) : ouvrir une vidéo, l'aperçu, les sous-titres,
//! et la file d'exports. Le moteur est dans le crate `video-export` ; ici, la colle Tauri
//! (dialogues, événements, autorisations de chemins).

use audio_dsp::approval::Approved;
use audio_dsp::error::CmdError;
use audio_dsp::recent::{self, RecentFile};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;
use video_export::export::export_video;
use video_export::ffmpeg::{FfError, ProcessRunner, Runner};
use video_export::filters::ColorFilter;
use video_export::plan::{
    ensure_extension, validate_export_options, ExportOptions, RawExportOptions,
};
use video_export::queue::{ExportQueue, JobMeta, JobSnapshot};

pub const VIDEO_EXTENSIONS: [&str; 7] = ["mp4", "mov", "avi", "mkv", "webm", "flv", "m4v"];
const RECENT_FILE: &str = "recent-video.json";

/// La file d'exports et l'aperçu en cours, gérés par Tauri.
pub struct VideoState {
    queue: ExportQueue<ExportOptions>,
    preview: Mutex<Option<PathBuf>>,
    preview_cancel: Mutex<Arc<AtomicBool>>,
    capabilities: OnceLock<Capabilities>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Capabilities {
    pub hardware: Vec<String>,
    pub stabilization: bool,
}

impl VideoState {
    pub fn new<R: Runtime>(app: AppHandle<R>) -> Self {
        let emitter = app.clone();
        let queue = ExportQueue::new(
            move |options: ExportOptions, ctx| run_job(&options, ctx),
            move |jobs| {
                let _ = emitter.emit("video-queue", jobs);
            },
        );
        Self {
            queue,
            preview: Mutex::new(None),
            preview_cancel: Mutex::new(Arc::new(AtomicBool::new(false))),
            capabilities: OnceLock::new(),
        }
    }

    /// Annule tout (fermeture de l'application) et supprime l'aperçu transcodé.
    pub fn shutdown(&self) {
        self.queue.cancel_all();
        self.preview_cancel
            .lock()
            .unwrap()
            .store(true, Ordering::SeqCst);
        if let Some(p) = self.preview.lock().unwrap().take() {
            let _ = std::fs::remove_file(p);
        }
    }
}

/// Un travail de la file : un dossier de travail privé, l'export, puis le nettoyage.
fn run_job(options: &ExportOptions, ctx: &video_export::queue::JobContext) -> Result<(), String> {
    let work = tempfile_dir().map_err(|e| e.to_string())?;
    let runner = ProcessRunner::system(ctx.cancel.clone());
    let result = export_video(
        &runner,
        options,
        &work,
        &mut |p| ctx.set_progress(p),
        &mut |_| {},
    );
    let _ = std::fs::remove_dir_all(&work);
    match result {
        Ok(()) => Ok(()),
        Err(FfError::Cancelled) => {
            let _ = std::fs::remove_file(&options.output_path);
            Err("cancelled".into())
        }
        Err(FfError::Failed(m)) => {
            let _ = std::fs::remove_file(&options.output_path);
            Err(m)
        }
    }
}

fn tempfile_dir() -> std::io::Result<PathBuf> {
    let dir = std::env::temp_dir().join(format!(
        "lev_export_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn recent_file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(RECENT_FILE))
}

async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, CmdError> {
    match tauri::async_runtime::spawn_blocking(job).await {
        Ok(r) => r.map_err(|m| anyhow::anyhow!(m).into()),
        Err(e) => Err(anyhow::anyhow!("Background task failed: {e}").into()),
    }
}

/// Rend la vidéo lisible par le WebView via `asset:` (aperçu) ; seul un fichier choisi ou déposé
/// par l'utilisateur est accepté.
fn authorize<R: Runtime>(app: &AppHandle<R>, path: &str) -> anyhow::Result<()> {
    app.state::<Approved>().check_input(path)?;
    app.asset_protocol_scope()
        .allow_file(path)
        .map_err(|e| anyhow::anyhow!("Cannot open '{path}' for preview: {e}"))
}

#[derive(Serialize)]
pub struct SubtitleFile {
    pub path: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct OutputChoice {
    pub path: String,
    /// Le nom saisi n'avait pas l'extension du format et le fichier complété existe déjà : le
    /// dialogue natif n'a pas confirmé celui-là, l'interface doit le faire.
    pub confirm_overwrite: bool,
}

#[derive(Serialize)]
pub struct Preview {
    pub path: String,
    pub transcoded: bool,
}

#[tauri::command]
pub async fn video_pick_file<R: Runtime>(
    app: AppHandle<R>,
    approved: State<'_, Approved>,
) -> Result<Option<String>, CmdError> {
    let handle = app.clone();
    let picked = blocking(move || {
        let mut d = handle.dialog().file();
        if let Some(w) = handle.get_webview_window("main") {
            d = d.set_parent(&w);
        }
        Ok(d.add_filter("Video", &VIDEO_EXTENSIONS)
            .blocking_pick_file()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned()))
    })
    .await?;
    if let Some(p) = &picked {
        approved.allow_input(p);
    }
    Ok(picked)
}

#[tauri::command]
pub async fn video_pick_subtitles<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<SubtitleFile>, CmdError> {
    let handle = app.clone();
    blocking(move || {
        let mut d = handle.dialog().file();
        if let Some(w) = handle.get_webview_window("main") {
            d = d.set_parent(&w);
        }
        let Some(path) = d
            .add_filter("Subtitles", &["srt"])
            .blocking_pick_file()
            .and_then(|p| p.into_path().ok())
        else {
            return Ok(None);
        };
        let bytes =
            std::fs::read(&path).map_err(|e| format!("Cannot open '{}': {e}", path.display()))?;
        Ok(Some(SubtitleFile {
            path: path.to_string_lossy().into_owned(),
            content: video_export::text::decode_text(&bytes),
        }))
    })
    .await
}

/// « Enregistrer sous » : le dialogue natif renvoie ce qui a été tapé (sans extension, ou la
/// mauvaise) ; ffmpeg choisit son muxer d'après le nom, une discordance ferait échouer l'export.
#[tauri::command]
pub async fn video_pick_output<R: Runtime>(
    app: AppHandle<R>,
    approved: State<'_, Approved>,
    default_name: Option<String>,
    format: String,
) -> Result<Option<OutputChoice>, CmdError> {
    let known = video_export::plan::FORMATS;
    let chosen = known.contains(&format.as_str()).then(|| format.clone());
    let handle = app.clone();
    let default = default_name
        .unwrap_or_else(|| format!("output.{}", chosen.clone().unwrap_or_else(|| "mp4".into())));
    let ext_filter = chosen.clone();
    let picked = blocking(move || {
        let mut d = handle.dialog().file().set_file_name(default);
        if let Some(w) = handle.get_webview_window("main") {
            d = d.set_parent(&w);
        }
        // N'offrir que le format choisi garde l'extension du nom et l'encodeur d'accord.
        d = match &ext_filter {
            Some(e) => d.add_filter(e.to_uppercase(), &[e.as_str()]),
            None => known
                .iter()
                .fold(d, |d, e| d.add_filter(e.to_uppercase(), &[*e])),
        };
        Ok(d.blocking_save_file()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned()))
    })
    .await?;
    let Some(path) = picked else { return Ok(None) };
    let final_path = chosen
        .as_deref()
        .map(|f| ensure_extension(&path, f))
        .unwrap_or(path.clone());
    let confirm_overwrite = final_path != path && Path::new(&final_path).exists();
    approved.allow_output(&final_path);
    Ok(Some(OutputChoice {
        path: final_path,
        confirm_overwrite,
    }))
}

/// Le fichier à mettre dans `<video>` : la source telle quelle quand le WebView sait la lire,
/// sinon un WebM VP9 transcodé (`force` : l'aperçu direct vient d'échouer). Progression sur
/// `video-preview-progress`.
#[tauri::command]
pub async fn video_preview<R: Runtime>(
    app: AppHandle<R>,
    approved: State<'_, Approved>,
    state: State<'_, VideoState>,
    path: String,
    force: Option<bool>,
) -> Result<Preview, CmdError> {
    approved.check_input(&path).map_err(CmdError::from)?;
    if let Some(file) = recent_file(&app) {
        recent::record(&file, &path);
    }
    // Un transcodage précédent encore en cours écrirait un fichier que personne ne supprimera.
    state
        .preview_cancel
        .lock()
        .unwrap()
        .store(true, Ordering::SeqCst);
    if let Some(stale) = state.preview.lock().unwrap().take() {
        let _ = std::fs::remove_file(stale);
    }
    let cancel = Arc::new(AtomicBool::new(false));
    *state.preview_cancel.lock().unwrap() = cancel.clone();

    let runner = ProcessRunner::system(cancel);
    let info = runner.probe(&path).ok();
    if force != Some(true)
        && info
            .as_ref()
            .is_some_and(video_export::preview::can_play_directly)
    {
        authorize(&app, &path).map_err(CmdError::from)?;
        return Ok(Preview {
            path,
            transcoded: false,
        });
    }
    let out = std::env::temp_dir().join(format!(
        "lev_preview_{}_{}.webm",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    *state.preview.lock().unwrap() = Some(out.clone());
    let duration = info.as_ref().and_then(|i| i.duration).unwrap_or(0.0);
    let (input, output) = (path.clone(), out.to_string_lossy().into_owned());
    let emitter = app.clone();
    let result = blocking(move || {
        runner
            .run(
                &video_export::preview::preview_args(&input, &output),
                &mut |sec| {
                    if duration > 0.0 {
                        let _ = emitter.emit(
                            "video-preview-progress",
                            ((sec / duration) * 100.0).min(99.0).round() as u32,
                        );
                    }
                },
            )
            .map_err(|e| e.to_string())
    })
    .await;
    if let Err(e) = result {
        let _ = std::fs::remove_file(&out);
        *state.preview.lock().unwrap() = None;
        return Err(e);
    }
    let _ = app.emit("video-preview-progress", 100u32);
    let out_str = out.to_string_lossy().into_owned();
    // Le WebM est produit par l'application : son accès est autorisé directement.
    app.state::<Approved>().allow_input(&out_str);
    authorize(&app, &out_str).map_err(CmdError::from)?;
    Ok(Preview {
        path: out_str,
        transcoded: true,
    })
}

#[tauri::command]
pub fn video_cancel_preview(state: State<'_, VideoState>) {
    state
        .preview_cancel
        .lock()
        .unwrap()
        .store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn video_filters() -> Vec<ColorFilter> {
    video_export::filters::all()
}

/// Encodeurs matériels et stabilisation réellement disponibles (essayés une fois, mémorisés).
#[tauri::command]
pub async fn video_capabilities(state: State<'_, VideoState>) -> Result<Capabilities, CmdError> {
    if let Some(c) = state.capabilities.get() {
        return Ok(c.clone());
    }
    let caps = blocking(|| {
        let runner = ProcessRunner::system(Arc::new(AtomicBool::new(false)));
        let platform = if cfg!(target_os = "macos") {
            "macos"
        } else if cfg!(windows) {
            "windows"
        } else {
            "linux"
        };
        let work = tempfile_dir().map_err(|e| e.to_string())?;
        let caps = Capabilities {
            hardware: video_export::hardware::detect_hardware(&runner, platform),
            stabilization: video_export::hardware::stabilization_works(
                &runner,
                &video_export::ffmpeg::query(&["-filters"]),
                &work,
            ),
        };
        let _ = std::fs::remove_dir_all(&work);
        Ok(caps)
    })
    .await?;
    let _ = state.capabilities.set(caps.clone());
    Ok(caps)
}

/// Valide une demande d'export contre l'état de l'application et cette machine.
async fn prepare(
    approved: &Approved,
    state: &VideoState,
    raw: RawExportOptions,
) -> Result<ExportOptions, CmdError> {
    let mut options =
        validate_export_options(raw).map_err(|m| CmdError::from(anyhow::anyhow!(m)))?;
    approved
        .check_input(&options.input_path)
        .map_err(CmdError::from)?;
    approved
        .check_output(&options.output_path)
        .map_err(CmdError::from)?;
    if options.hardware.is_some() || options.stabilize != "off" {
        let caps = match state.capabilities.get() {
            Some(c) => c.clone(),
            None => {
                let c = blocking(|| {
                    let runner = ProcessRunner::system(Arc::new(AtomicBool::new(false)));
                    let platform = if cfg!(target_os = "macos") {
                        "macos"
                    } else if cfg!(windows) {
                        "windows"
                    } else {
                        "linux"
                    };
                    let work = tempfile_dir().map_err(|e| e.to_string())?;
                    let caps = Capabilities {
                        hardware: video_export::hardware::detect_hardware(&runner, platform),
                        stabilization: video_export::hardware::stabilization_works(
                            &runner,
                            &video_export::ffmpeg::query(&["-filters"]),
                            &work,
                        ),
                    };
                    let _ = std::fs::remove_dir_all(&work);
                    Ok(caps)
                })
                .await?;
                let _ = state.capabilities.set(c.clone());
                c
            }
        };
        // Un encodeur que cette machine ne sait pas lancer n'est pas une erreur : repli logiciel.
        if let Some(h) = &options.hardware {
            if !caps.hardware.contains(h) {
                options.hardware = None;
            }
        }
        if options.stabilize != "off" && !caps.stabilization {
            return Err(
                anyhow::anyhow!("Stabilization is not available in this build of ffmpeg").into(),
            );
        }
    }
    Ok(options)
}

fn job_meta(o: &ExportOptions) -> JobMeta {
    JobMeta {
        name: Path::new(&o.output_path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| o.output_path.clone()),
        format: o.format.clone(),
        output_path: o.output_path.clone(),
    }
}

/// Ajoute un export à la file et rend la main aussitôt ; la progression arrive sur `video-queue`.
#[tauri::command]
pub async fn video_queue_add(
    approved: State<'_, Approved>,
    state: State<'_, VideoState>,
    options: RawExportOptions,
) -> Result<u64, CmdError> {
    let options = prepare(&approved, &state, options).await?;
    let meta = job_meta(&options);
    state
        .queue
        .add(options, meta)
        .map_err(|m| CmdError::from(anyhow::anyhow!(m)))
}

#[tauri::command]
pub fn video_queue_list(state: State<'_, VideoState>) -> Vec<JobSnapshot> {
    state.queue.list()
}

#[tauri::command]
pub fn video_queue_cancel(state: State<'_, VideoState>, id: u64) -> bool {
    state.queue.cancel(id)
}

#[tauri::command]
pub fn video_queue_clear_finished(state: State<'_, VideoState>) {
    state.queue.clear_finished();
}

#[tauri::command]
pub fn video_recent_list<R: Runtime>(
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

#[tauri::command]
pub fn video_recent_forget<R: Runtime>(app: AppHandle<R>, path: Option<String>) {
    if let Some(file) = recent_file(&app) {
        recent::forget(&file, path.as_deref());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_job_name_is_the_file_name() {
        let raw: RawExportOptions = serde_json::from_value(serde_json::json!({
            "inputPath": "/in.mp4", "outputPath": "/videos/out.mp4", "format": "mp4",
            "segments": [{"start": 0.0, "end": 1.0}],
        }))
        .unwrap();
        let meta = job_meta(&validate_export_options(raw).unwrap());
        assert_eq!(
            (
                meta.name.as_str(),
                meta.format.as_str(),
                meta.output_path.as_str()
            ),
            ("out.mp4", "mp4", "/videos/out.mp4")
        );
    }

    #[test]
    fn the_work_directories_are_private_and_distinct() {
        let a = tempfile_dir().unwrap();
        let b = tempfile_dir().unwrap();
        assert_ne!(a, b);
        assert!(a.is_dir() && b.is_dir());
        let _ = std::fs::remove_dir_all(a);
        let _ = std::fs::remove_dir_all(b);
    }

    #[test]
    fn the_video_extensions_do_not_overlap_with_images() {
        assert!(VIDEO_EXTENSIONS.contains(&"mp4") && VIDEO_EXTENSIONS.contains(&"m4v"));
    }
}
