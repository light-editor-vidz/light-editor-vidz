//! Commandes de la vue Vidéo (ex-LightCutVidz) : ouvrir une vidéo, l'aperçu, les sous-titres,
//! et la file d'exports. Le moteur est dans le crate `video-export` ; ici, la colle Tauri
//! (dialogues, événements, autorisations de chemins).

use audio_dsp::approval::Approved;
use audio_dsp::error::CmdError;
use audio_dsp::recent::{self, RecentFile};
use base64::Engine as _;
use serde::Serialize;
use std::collections::HashMap;
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
use video_export::sequences::{self, Sequence};

pub const VIDEO_EXTENSIONS: [&str; 7] = ["mp4", "mov", "avi", "mkv", "webm", "flv", "m4v"];
const RECENT_FILE: &str = "recent-video.json";
const MERGED_PREFIX: &str = "lev_merge_";

/// La file d'exports et l'aperçu en cours, gérés par Tauri.
pub struct VideoState {
    queue: ExportQueue<ExportOptions>,
    /// L'aperçu transcodé et le drapeau d'annulation de chaque onglet (`owner`) : un onglet ne
    /// supprime ni n'annule jamais ceux d'un autre.
    preview: Mutex<HashMap<String, PathBuf>>,
    preview_cancel: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Les vidéos fusionnées depuis des séquences : supprimées à la fermeture.
    merged: Mutex<Vec<PathBuf>>,
    capabilities: OnceLock<Capabilities>,
    after_export: AfterExport,
}

/// Ce qu'il reste à faire d'un fichier une fois son export terminé, par chemin de sortie.
type AfterExport = Arc<Mutex<HashMap<String, (Vec<String>, Option<String>)>>>;

#[derive(Debug, Clone, Serialize)]
pub struct Capabilities {
    pub hardware: Vec<String>,
    pub stabilization: bool,
}

impl VideoState {
    pub fn new<R: Runtime>(app: AppHandle<R>) -> Self {
        let emitter = app.clone();
        let after_export = AfterExport::default();
        let (pending, finisher) = (after_export.clone(), app.clone());
        let queue = ExportQueue::new(
            move |options: ExportOptions, ctx| {
                let result = run_job(&options, ctx);
                let next = pending
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&options.output_path);
                match (&result, next) {
                    (Ok(()), Some((projects, srt))) => {
                        finish_export(&finisher, &options.output_path, &projects, srt.as_deref())
                    }
                    // Un export temporaire échoué ou annulé ne sert plus à rien.
                    (Err(_), _) => crate::commands::media_subs::discard_staged(
                        &finisher,
                        Path::new(&options.output_path),
                    ),
                    _ => {}
                }
                result
            },
            move |jobs| {
                let _ = emitter.emit("video-queue", jobs);
            },
        );
        Self {
            queue,
            preview: Mutex::new(HashMap::new()),
            preview_cancel: Mutex::new(HashMap::new()),
            merged: Mutex::new(Vec::new()),
            capabilities: OnceLock::new(),
            after_export,
        }
    }

    /// Un export de la file est en cours ou en attente (l'aperçu transcodé, lui, est un simple
    /// fichier supprimé par `shutdown`).
    pub fn is_busy(&self) -> bool {
        self.queue.has_active()
    }

    /// Demande l'arrêt de tous les exports et aperçus (les `.part` et ffmpeg sont nettoyés par
    /// leurs propres tâches, qu'il faut ensuite attendre : voir `is_busy`).
    pub fn cancel_all(&self) {
        self.queue.cancel_all();
        for flag in self
            .preview_cancel
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
        {
            flag.store(true, Ordering::SeqCst);
        }
    }

    /// Annule tout (fermeture de l'application) et supprime l'aperçu transcodé.
    pub fn shutdown(&self) {
        self.cancel_all();
        for (_, p) in self
            .preview
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .drain()
        {
            let _ = std::fs::remove_file(p);
        }
        for p in self
            .merged
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .drain(..)
        {
            let _ = std::fs::remove_file(p);
        }
    }
}

/// Le fichier exporté rejoint les projets demandés ; l'interface en est prévenue.
fn finish_export<R: Runtime>(
    app: &AppHandle<R>,
    output: &str,
    projects: &[String],
    srt: Option<&str>,
) {
    let handle = app.clone();
    let _ = handle.emit(
        "video-export-added",
        crate::commands::media_subs::add_everywhere(&handle, Path::new(output), projects, srt),
    );
}

/// Même fichier, quelle que soit l'écriture du chemin (lien symbolique, `..`, casse).
/// La sortie n'existant pas forcément encore, on compare son dossier canonique et son nom.
fn same_file(a: &Path, b: &Path) -> bool {
    let canon = |p: &Path| -> Option<PathBuf> {
        if let Ok(c) = p.canonicalize() {
            return Some(c);
        }
        let name = p.file_name()?;
        let parent = p
            .parent()
            .filter(|d| !d.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        Some(parent.canonicalize().ok()?.join(name))
    };
    match (canon(a), canon(b)) {
        (Some(x), Some(y)) => x == y,
        _ => a == b,
    }
}

/// Fichier de travail voisin de la destination (même extension, pour qu'ffmpeg devine le format).
fn partial_path(output: &Path) -> PathBuf {
    let name = output
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "export".into());
    output.with_file_name(format!(
        ".{name}.lev-part.{}",
        output
            .extension()
            .map(|e| e.to_string_lossy().into_owned())
            .unwrap_or_default()
    ))
}

/// Un travail de la file : un dossier de travail privé, l'export dans un `.part`, puis `rename`.
/// La destination n'est jamais supprimée : un échec ou une annulation la laisse intacte.
fn run_job(options: &ExportOptions, ctx: &video_export::queue::JobContext) -> Result<(), String> {
    let output = PathBuf::from(&options.output_path);
    if same_file(Path::new(&options.input_path), &output) {
        return Err("output is the same file as the input".into());
    }
    let partial = partial_path(&output);
    let _tracked = crate::commands::partials::track(&partial);
    let mut job = options.clone();
    job.output_path = partial.to_string_lossy().into_owned();
    let work = tempfile_dir().map_err(|e| e.to_string())?;
    let runner = ProcessRunner::system(ctx.cancel.clone());
    let result = export_video(
        &runner,
        &job,
        &work,
        &mut |p| ctx.set_progress(p),
        &mut |_| {},
    );
    let _ = std::fs::remove_dir_all(&work);
    match result {
        Ok(()) => std::fs::rename(&partial, &output).map_err(|e| {
            let _ = std::fs::remove_file(&partial);
            e.to_string()
        }),
        Err(FfError::Cancelled) => {
            let _ = std::fs::remove_file(&partial);
            Err("cancelled".into())
        }
        Err(FfError::Failed(m)) => {
            let _ = std::fs::remove_file(&partial);
            Err(m)
        }
    }
}

/// Préfixes des fichiers et dossiers temporaires de la vue Vidéo (exports, aperçus, fusions,
/// mixages de sous-titres).
const TEMP_PREFIXES: [&str; 5] = [
    "lev_export_",
    "lev_preview_",
    "lev_merge_",
    "lev_subs_mix_",
    "lev_subs_scratch_",
];

/// Supprime, dans `dir`, ce qu'un plantage ou un arrêt forcé a laissé : seuls les noms de nos
/// préfixes, et seulement au-delà de `max_age` (un autre processus de l'application peut en avoir
/// d'actifs). Renvoie le nombre d'éléments supprimés.
pub fn remove_stale_temp(dir: &Path, max_age: std::time::Duration) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !TEMP_PREFIXES.iter().any(|p| name.starts_with(p)) {
            continue;
        }
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age >= max_age);
        if !old {
            continue;
        }
        let path = entry.path();
        let ok = if path.is_dir() {
            std::fs::remove_dir_all(&path).is_ok()
        } else {
            std::fs::remove_file(&path).is_ok()
        };
        removed += usize::from(ok);
    }
    removed
}

/// Un nom temporaire imprévisible (UUID v4 tiré de l'aléa du système) : un autre processus local
/// ne peut ni le deviner ni y placer un lien symbolique à l'avance.
pub(crate) fn unpredictable_temp(prefix: &str, suffix: &str) -> PathBuf {
    std::env::temp_dir().join(format!("{prefix}{}{suffix}", uuid::Uuid::new_v4().simple()))
}

fn tempfile_dir() -> std::io::Result<PathBuf> {
    // `create_dir` (et non `create_dir_all`) échoue si le nom existe déjà.
    let dir = unpredictable_temp("lev_export_", "");
    std::fs::create_dir(&dir)?;
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
    owner: Option<String>,
) -> Result<Preview, CmdError> {
    let owner = owner.unwrap_or_default();
    approved.check_input(&path).map_err(CmdError::from)?;
    // Une vidéo fusionnée est temporaire : elle n'a pas sa place parmi les fichiers récents.
    let is_merged = Path::new(&path)
        .file_name()
        .is_some_and(|n| n.to_string_lossy().starts_with(MERGED_PREFIX));
    if let (false, Some(file)) = (is_merged, recent_file(&app)) {
        recent::record(&file, &path);
    }
    // Un transcodage précédent encore en cours écrirait un fichier que personne ne supprimera.
    if let Some(old) = state
        .preview_cancel
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&owner)
    {
        old.store(true, Ordering::SeqCst);
    }
    if let Some(stale) = state
        .preview
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&owner)
    {
        let _ = std::fs::remove_file(stale);
    }
    let cancel = fresh_cancel(&state, &owner);

    let runner = ProcessRunner::system(cancel);
    // ffprobe sur le pool bloquant : lancé ici, il occuperait un worker du runtime async.
    let (runner, info) = {
        let probed_path = path.clone();
        blocking(move || {
            let info = runner.probe(&probed_path).ok();
            Ok((runner, info))
        })
        .await?
    };
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
    let out = unpredictable_temp("lev_preview_", ".webm");
    state
        .preview
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(owner.clone(), out.clone());
    let duration = info.as_ref().and_then(|i| i.duration).unwrap_or(0.0);
    let (input, output) = (path.clone(), out.to_string_lossy().into_owned());
    let emitter = app.clone();
    let progress_owner = owner.clone();
    let result = blocking(move || {
        runner
            .run(
                &video_export::preview::preview_args(&input, &output),
                &mut |sec| {
                    if duration > 0.0 {
                        emit_preview_progress(
                            &emitter,
                            &progress_owner,
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
        // Seulement si l'entrée est encore la nôtre : un aperçu plus récent ne doit pas être oublié.
        let mut previews = state.preview.lock().unwrap_or_else(|e| e.into_inner());
        if previews.get(&owner) == Some(&out) {
            previews.remove(&owner);
        }
        return Err(e);
    }
    emit_preview_progress(&app, &owner, 100);
    let out_str = out.to_string_lossy().into_owned();
    // Le WebM est produit par l'application : son accès est autorisé directement.
    app.state::<Approved>().allow_input(&out_str);
    authorize(&app, &out_str).map_err(CmdError::from)?;
    Ok(Preview {
        path: out_str,
        transcoded: true,
    })
}

/// Un drapeau d'annulation neuf pour cet onglet, partagé avec son « Annuler » (même écran de chargement).
fn fresh_cancel(state: &VideoState, owner: &str) -> Arc<AtomicBool> {
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .preview_cancel
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(owner.to_string(), cancel.clone());
    cancel
}

/// La progression d'un aperçu ou d'une fusion, étiquetée par onglet : chacun ne suit que la sienne.
fn emit_preview_progress<R: Runtime>(app: &AppHandle<R>, owner: &str, percent: u32) {
    let _ = app.emit(
        "video-preview-progress",
        serde_json::json!({ "owner": owner, "percent": percent }),
    );
}

/// Découpe la vidéo en séquences, aux changements de plan.
#[tauri::command]
pub async fn video_detect_scenes(
    approved: State<'_, Approved>,
    state: State<'_, VideoState>,
    path: String,
    owner: Option<String>,
) -> Result<Vec<Sequence>, CmdError> {
    approved.check_input(&path).map_err(CmdError::from)?;
    let runner = ProcessRunner::system(fresh_cancel(&state, &owner.unwrap_or_default()));
    blocking(move || {
        let duration = runner
            .probe(&path)?
            .duration
            .filter(|d| *d > 0.0)
            .ok_or("Cannot read the video duration")?;
        let work = tempfile_dir().map_err(|e| e.to_string())?;
        let log = work.join("scenes.log");
        let result = runner.run(
            &sequences::scene_detect_args(&path, &log.to_string_lossy()),
            &mut |_| {},
        );
        let times = std::fs::read_to_string(&log).unwrap_or_default();
        let _ = std::fs::remove_dir_all(&work);
        result.map_err(|e| e.to_string())?;
        Ok(sequences::sequences_from_cuts(
            &sequences::parse_scene_times(&times),
            duration,
        ))
    })
    .await
}

/// Le contenu d'un fichier JPEG, en data URL.
fn jpeg_data_url(path: &Path) -> std::io::Result<String> {
    let bytes = std::fs::read(path)?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// Les vignettes de la frise de la timeline : `count` images JPEG (data URL) réparties sur la vidéo.
#[tauri::command]
pub async fn video_thumbnails(
    approved: State<'_, Approved>,
    path: String,
    count: u32,
) -> Result<Vec<String>, CmdError> {
    approved.check_input(&path).map_err(CmdError::from)?;
    let count = count.clamp(1, 200);
    let runner = ProcessRunner::system(Arc::new(AtomicBool::new(false)));
    blocking(move || {
        let duration = runner
            .probe(&path)?
            .duration
            .filter(|d| *d > 0.0)
            .ok_or("Cannot read the video duration")?;
        let work = tempfile_dir().map_err(|e| e.to_string())?;
        let mut thumbs = Vec::new();
        let result = if duration > video_export::preview::SEEK_THUMBNAILS_ABOVE_SECONDS {
            // Longue vidéo : une recherche par vignette, au lieu de décoder le film entier.
            video_export::preview::thumbnail_times(count, duration)
                .iter()
                .enumerate()
                .try_for_each(|(i, time)| {
                    let out = work.join(format!("t_{:03}.jpg", i + 1));
                    runner.run(
                        &video_export::preview::frame_args(&path, &out.to_string_lossy(), *time),
                        &mut |_| {},
                    )
                })
        } else {
            let pattern = work.join("t_%03d.jpg");
            runner.run(
                &video_export::preview::thumbnail_args(
                    &path,
                    &pattern.to_string_lossy(),
                    count,
                    duration,
                ),
                &mut |_| {},
            )
        };
        if result.is_ok() {
            for i in 1..=count {
                match jpeg_data_url(&work.join(format!("t_{i:03}.jpg"))) {
                    Ok(url) => thumbs.push(url),
                    Err(_) => break,
                }
            }
        }
        let _ = std::fs::remove_dir_all(&work);
        result.map_err(|e| e.to_string())?;
        Ok(thumbs)
    })
    .await
}

/// Une vignette (data URL) par instant demandé, dans le même ordre (`""` si une image manque).
#[tauri::command]
pub async fn video_frames(
    approved: State<'_, Approved>,
    path: String,
    times: Vec<f64>,
) -> Result<Vec<String>, CmdError> {
    approved.check_input(&path).map_err(CmdError::from)?;
    if times.len() > 200 {
        return Err(CmdError::from(anyhow::anyhow!("Too many frames requested")));
    }
    let runner = ProcessRunner::system(Arc::new(AtomicBool::new(false)));
    blocking(move || {
        let work = tempfile_dir().map_err(|e| e.to_string())?;
        // Jusqu'à 200 images : quelques processus ffmpeg en parallèle plutôt qu'un par un.
        let workers = times.len().clamp(1, 4);
        let mut frames = vec![String::new(); times.len()];
        std::thread::scope(|scope| {
            let handles: Vec<_> = (0..workers)
                .map(|w| {
                    let (runner, work, path, times) = (&runner, &work, &path, &times);
                    scope.spawn(move || {
                        (w..times.len())
                            .step_by(workers)
                            .map(|i| {
                                let out = work.join(format!("f_{i}.jpg"));
                                let ok = times[i].is_finite()
                                    && runner
                                        .run(
                                            &video_export::preview::frame_args(
                                                path,
                                                &out.to_string_lossy(),
                                                times[i],
                                            ),
                                            &mut |_| {},
                                        )
                                        .is_ok();
                                let url = if ok {
                                    jpeg_data_url(&out).unwrap_or_default()
                                } else {
                                    String::new()
                                };
                                (i, url)
                            })
                            .collect::<Vec<_>>()
                    })
                })
                .collect();
            for handle in handles {
                for (i, url) in handle.join().unwrap_or_default() {
                    frames[i] = url;
                }
            }
        });
        let _ = std::fs::remove_dir_all(&work);
        Ok(frames)
    })
    .await
}

/// Sépare la piste audio de la vidéo, dans un fichier à côté d'elle (sinon dans le dossier
/// temporaire si ce dossier n'est pas inscriptible) ; renvoie son chemin, ou `None` sans piste audio.
#[tauri::command]
pub async fn video_extract_audio<R: Runtime>(
    app: AppHandle<R>,
    approved: State<'_, Approved>,
    state: State<'_, VideoState>,
    path: String,
    owner: Option<String>,
) -> Result<Option<String>, CmdError> {
    approved.check_input(&path).map_err(CmdError::from)?;
    let runner = ProcessRunner::system(fresh_cancel(&state, &owner.unwrap_or_default()));
    let source = PathBuf::from(&path);
    let out = blocking(move || {
        let info = runner.probe(&path)?;
        let Some(audio) = info.streams.iter().find(|s| s.codec_type == "audio") else {
            return Ok(None);
        };
        let plan = video_export::audio_extract::plan(&audio.codec_name);
        let stem = source
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "audio".into());
        let dirs = [
            source.parent().map(Path::to_path_buf),
            Some(std::env::temp_dir()),
        ];
        let mut last_error = String::from("Cannot write the audio file");
        for dir in dirs.into_iter().flatten() {
            let out = video_export::audio_extract::free_path(&dir, &stem, plan.ext, |p| p.exists());
            let result = runner.run(
                &video_export::audio_extract::extract_args(
                    &path,
                    &out.to_string_lossy(),
                    plan.copy,
                ),
                &mut |_| {},
            );
            match result {
                Ok(()) => return Ok(Some(out.to_string_lossy().into_owned())),
                Err(FfError::Cancelled) => {
                    let _ = std::fs::remove_file(&out);
                    return Err("Cancelled".to_string());
                }
                Err(e) => {
                    let _ = std::fs::remove_file(&out);
                    last_error = e.to_string();
                }
            }
        }
        Err(last_error)
    })
    .await?;
    if let Some(file) = &out {
        approved.allow_input(file);
        authorize(&app, file).map_err(CmdError::from)?;
    }
    Ok(out)
}

/// Fusionne les séquences, dans l'ordre reçu, en une nouvelle vidéo ; renvoie son chemin.
#[tauri::command]
pub async fn video_merge_sequences<R: Runtime>(
    app: AppHandle<R>,
    approved: State<'_, Approved>,
    state: State<'_, VideoState>,
    path: String,
    sequences: Vec<Sequence>,
    owner: Option<String>,
) -> Result<String, CmdError> {
    let owner = owner.unwrap_or_default();
    approved.check_input(&path).map_err(CmdError::from)?;
    sequences::validate_sequences(&sequences).map_err(|m| CmdError::from(anyhow::anyhow!(m)))?;
    let runner = ProcessRunner::system(fresh_cancel(&state, &owner));
    let out = unpredictable_temp(MERGED_PREFIX, ".mp4");
    let out_str = out.to_string_lossy().into_owned();
    let total = sequences::total_duration(&sequences);
    let emitter = app.clone();
    let (input, output) = (path.clone(), out_str.clone());
    let result = blocking(move || {
        let with_audio = runner
            .probe(&input)?
            .streams
            .iter()
            .any(|s| s.codec_type == "audio");
        runner
            .run(
                &sequences::merge_args(&input, &output, &sequences, with_audio),
                &mut |sec| {
                    emit_preview_progress(
                        &emitter,
                        &owner,
                        ((sec / total) * 100.0).min(99.0).round() as u32,
                    );
                },
            )
            .map_err(|e| e.to_string())
    })
    .await;
    if let Err(e) = result {
        let _ = std::fs::remove_file(&out);
        return Err(e);
    }
    state
        .merged
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(out);
    approved.allow_input(&out_str);
    authorize(&app, &out_str).map_err(CmdError::from)?;
    Ok(out_str)
}

#[tauri::command]
pub fn video_cancel_preview(state: State<'_, VideoState>, owner: Option<String>) {
    if let Some(flag) = state
        .preview_cancel
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&owner.unwrap_or_default())
    {
        flag.store(true, Ordering::SeqCst);
    }
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
    if same_file(
        Path::new(&options.input_path),
        Path::new(&options.output_path),
    ) {
        return Err(CmdError::from(anyhow::anyhow!(
            "the output file must differ from the source video"
        )));
    }
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

/// À appeler avant de lancer l'export : ce fichier, une fois écrit, rejoindra ces projets.
#[tauri::command]
pub fn video_add_after_export(
    approved: State<'_, Approved>,
    state: State<'_, VideoState>,
    output_path: String,
    projects: Vec<String>,
    srt: Option<String>,
) -> Result<(), CmdError> {
    approved
        .check_output(&output_path)
        .map_err(CmdError::from)?;
    let mut pending = state.after_export.lock().unwrap_or_else(|e| e.into_inner());
    // Sans projet : l'entrée est retirée (l'export a été refusé ou a échoué, elle ne doit pas
    // rester pour un export ultérieur vers le même fichier).
    if projects.is_empty() {
        pending.remove(&output_path);
    } else {
        pending.insert(output_path, (projects, srt));
    }
    Ok(())
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

    #[test]
    fn an_output_equal_to_the_input_is_detected_even_through_a_symlink_or_dotdot() {
        let dir = std::env::temp_dir().join(format!("lev_same_{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        let src = dir.join("clip.mp4");
        std::fs::write(&src, b"x").unwrap();
        assert!(same_file(&src, &src));
        assert!(same_file(
            &src,
            &dir.join("sub").join("..").join("clip.mp4")
        ));
        assert!(!same_file(&src, &dir.join("other.mp4")));
        #[cfg(unix)]
        {
            let link = dir.join("link.mp4");
            std::os::unix::fs::symlink(&src, &link).unwrap();
            assert!(same_file(&src, &link));
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_partial_file_sits_next_to_the_destination_and_keeps_its_extension() {
        assert_eq!(
            partial_path(Path::new("/v/montage.mp4")),
            PathBuf::from("/v/.montage.mp4.lev-part.mp4")
        );
    }

    #[test]
    fn temporary_names_are_unique_and_keep_the_cleanup_prefix() {
        let (a, b) = (
            unpredictable_temp("lev_preview_", ".webm"),
            unpredictable_temp("lev_preview_", ".webm"),
        );
        assert_ne!(a, b);
        let name = a.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with("lev_preview_") && name.ends_with(".webm"));
        assert!(TEMP_PREFIXES.iter().any(|p| name.starts_with(p)));
    }

    #[test]
    fn stale_temp_files_are_swept_but_only_ours_and_only_old_ones() {
        let dir = std::env::temp_dir().join(format!("lev_sweep_{}", std::process::id()));
        std::fs::create_dir_all(dir.join("lev_export_1_2")).unwrap();
        std::fs::write(dir.join("lev_preview_9.webm"), b"x").unwrap();
        std::fs::write(dir.join("unrelated.txt"), b"x").unwrap();

        // Rien n'est assez vieux : rien ne part (un export peut être en cours dans un autre processus).
        assert_eq!(
            remove_stale_temp(&dir, std::time::Duration::from_secs(3600)),
            0
        );
        // Avec un âge nul, nos fichiers partent et le reste n'est pas touché.
        assert_eq!(remove_stale_temp(&dir, std::time::Duration::ZERO), 2);
        assert!(dir.join("unrelated.txt").exists());
        assert!(!dir.join("lev_export_1_2").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
