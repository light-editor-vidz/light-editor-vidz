mod ffmpeg;

use ffmpeg::{has_audio_stream, media_duration, AudioMixInput, EncoderSpec, VideoEncoder};
use scene_core::model::{Element, Project};
use scene_core::raster::FrameRenderer;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::time::{Duration, Instant};

/// Message d'erreur renvoyé quand l'export est annulé par l'utilisateur (le frontend le
/// reconnaît pour ne pas l'afficher comme une erreur).
pub const CANCELLED: &str = "export-cancelled";

/// Mémoire maximale (octets) des frames rendues en attente d'encodage, tous rendus confondus.
const MAX_PENDING_FRAME_BYTES: usize = 256 * 1024 * 1024;
/// Nombre maximal de rendus parallèles.
const MAX_RENDER_WORKERS: usize = 8;
/// Intervalle minimal entre deux notifications de progression.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// Surcharges optionnelles de résolution/fps/qualité pour l'export, indépendantes des
/// réglages du projet (qui restent inchangés). `crf` suit la convention x264 : plus bas =
/// meilleure qualité/fichier plus lourd (typiquement 18-28).
#[derive(Debug, Clone, Copy, Default)]
pub struct ExportOverrides {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<u32>,
    pub crf: Option<u32>,
}

/// Résultat d'un export réussi : sources média qui n'ont pas pu être lues (le fichier est
/// produit, mais incomplet — l'utilisateur doit en être averti).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ExportReport {
    pub missing_media: Vec<String>,
}

/// Durée exploitable (finie et non nulle) : un NaN ou une durée négative issus d'un projet
/// corrompu ne doivent pas produire un filtre ffmpeg invalide.
fn is_usable_duration(duration: f64) -> bool {
    duration.is_finite() && duration > 0.001
}

fn note_missing(missing: &mut Vec<String>, src: &str) {
    if !missing.iter().any(|m| m == src) {
        missing.push(src.to_string());
    }
}

/// Entrées de mixage pour les pistes audio du projet (hors audio embarqué des éléments vidéo,
/// géré séparément dans `collect_audio_inputs`) : les pistes sont globales, leur `start_time`
/// est déjà absolu sur la timeline. Une piste dont le `src` ne résout pas vers un fichier réel
/// à l'intérieur de `project_dir` (fichier manquant, ou chemin tentant de sortir du dossier
/// projet — voir `scene_core::paths::resolve_media_path`) est ignorée et signalée dans
/// `missing`.
fn collect_project_audio_inputs(
    project: &Project,
    project_dir: &Path,
    missing: &mut Vec<String>,
) -> Vec<AudioMixInput> {
    let any_solo = project.audio_tracks.iter().any(|track| track.solo);
    let mut inputs = Vec::new();
    for track in &project.audio_tracks {
        if track.muted || (any_solo && !track.solo) {
            continue;
        }
        let Ok(path) = scene_core::paths::resolve_media_path(project_dir, &track.src) else {
            note_missing(missing, &track.src);
            continue;
        };
        let duration = track
            .duration
            .unwrap_or(project.duration - track.start_time);
        if !is_usable_duration(duration) {
            continue;
        }
        inputs.push(AudioMixInput {
            path,
            offset: track.audio_offset,
            start_time: track.start_time,
            volume: track.volume,
            fade_in: track.fade_in.max(0.0),
            fade_out: track.fade_out.max(0.0),
            duration,
            speed: 1.0,
            loop_audio: false,
            source_duration: None,
        });
    }
    inputs
}

/// Toutes les entrées audio du mix : pistes du projet, puis audio embarqué des éléments vidéo
/// (ffmpeg sélectionne directement la piste audio d'une source vidéo : il suffit de vérifier
/// qu'elle existe, une vidéo pouvant être muette).
fn collect_audio_inputs(
    project: &Project,
    project_dir: &Path,
    missing: &mut Vec<String>,
) -> Vec<AudioMixInput> {
    let mut inputs = collect_project_audio_inputs(project, project_dir, missing);
    for composition in &project.compositions {
        for el in &composition.elements {
            let Element::Video(video_el) = el else {
                continue;
            };
            if video_el.muted || video_el.volume <= 0.001 {
                continue;
            }
            let Ok(source_path) = scene_core::paths::resolve_media_path(project_dir, &video_el.src)
            else {
                // Le renderer signale déjà la source vidéo manquante ; rien à mixer ici.
                continue;
            };
            if !has_audio_stream(&source_path) {
                continue;
            }
            let base = el.base();
            let duration = base
                .duration
                .unwrap_or(composition.duration - base.start_time);
            if !is_usable_duration(duration) {
                continue;
            }
            // Même clamp que la sélection de frame vidéo (raster.rs) : la piste audio doit
            // suivre la même vitesse que l'image, sous peine de désynchronisation progressive.
            let speed = if video_el.playback_speed > 0.01 {
                video_el.playback_speed
            } else {
                1.0
            };
            let source_duration = video_el
                .loop_video
                .then(|| media_duration(&source_path))
                .flatten();
            inputs.push(AudioMixInput {
                path: source_path,
                offset: video_el.video_offset,
                start_time: composition.start_time + base.start_time,
                volume: video_el.volume,
                fade_in: 0.0,
                fade_out: 0.0,
                duration,
                speed,
                loop_audio: video_el.loop_video,
                source_duration,
            });
        }
    }
    inputs
}

/// Nombre de rendus parallèles : un par cœur, borné, et limité par la mémoire que représentent
/// les frames en attente (2 par rendu).
fn render_worker_count(total_frames: u64, width: u32, height: u32) -> usize {
    let cores = std::thread::available_parallelism().map_or(1, |n| n.get());
    let frame_bytes = (width as usize * height as usize * 4).max(1);
    let by_memory = (MAX_PENDING_FRAME_BYTES / (frame_bytes * 2)).max(1);
    cores
        .min(MAX_RENDER_WORKERS)
        .min(by_memory)
        .min(total_frames.max(1) as usize)
}

/// Rend les frames `first, first + step, first + 2·step…` et les envoie dans l'ordre. Retourne
/// les médias introuvables rencontrés.
#[allow(clippy::too_many_arguments)]
fn render_worker(
    project: &Project,
    project_dir: &Path,
    total_frames: u64,
    first: u64,
    step: u64,
    sender: SyncSender<Vec<u8>>,
    stop: &AtomicBool,
    cancel: &AtomicBool,
) -> Vec<String> {
    let mut renderer = FrameRenderer::new();
    let fps = project.fps as f64;
    let mut idx = first;
    while idx < total_frames && !stop.load(Ordering::Relaxed) && !cancel.load(Ordering::Relaxed) {
        let pixmap = renderer.render_frame(project, project_dir, idx as f64 / fps);
        if sender.send(pixmap.take()).is_err() {
            break;
        }
        idx += step;
    }
    renderer.missing_media
}

/// Rend toutes les frames (en parallèle) et les pousse dans l'encodeur dans l'ordre.
#[allow(clippy::too_many_arguments)]
fn render_and_encode(
    render_project: &Project,
    project_dir: &Path,
    total_frames: u64,
    mut encoder: VideoEncoder,
    cancel: &AtomicBool,
    on_progress: &mut impl FnMut(f32),
    missing: &mut Vec<String>,
) -> Result<(), String> {
    let workers = render_worker_count(total_frames, render_project.width, render_project.height);
    let stop = AtomicBool::new(false);
    let result = std::thread::scope(|scope| -> Result<(), String> {
        let mut receivers = Vec::with_capacity(workers);
        let mut handles = Vec::with_capacity(workers);
        for worker in 0..workers {
            let (sender, receiver) = sync_channel::<Vec<u8>>(1);
            receivers.push(receiver);
            let stop = &stop;
            handles.push(scope.spawn(move || {
                render_worker(
                    render_project,
                    project_dir,
                    total_frames,
                    worker as u64,
                    workers as u64,
                    sender,
                    stop,
                    cancel,
                )
            }));
        }

        let mut last_progress = Instant::now();
        let mut outcome = Ok(());
        for frame in 0..total_frames {
            if cancel.load(Ordering::Relaxed) {
                outcome = Err(CANCELLED.to_string());
                break;
            }
            let data = match receivers[frame as usize % workers].recv() {
                Ok(data) => data,
                Err(_) => {
                    outcome = Err("Rendering stopped unexpectedly.".to_string());
                    break;
                }
            };
            if let Err(e) = encoder.write_frame(&data) {
                outcome = Err(e);
                break;
            }
            if last_progress.elapsed() >= PROGRESS_INTERVAL || frame + 1 == total_frames {
                on_progress((frame + 1) as f32 / total_frames as f32);
                last_progress = Instant::now();
            }
        }

        // Libère les rendus encore en attente d'envoi, puis les attend tous (un panic de rendu
        // devient une erreur plutôt qu'un export qui ne répond plus).
        stop.store(true, Ordering::Relaxed);
        drop(receivers);
        for handle in handles {
            match handle.join() {
                Ok(worker_missing) => {
                    for src in worker_missing {
                        note_missing(missing, &src);
                    }
                }
                Err(_) if outcome.is_ok() => {
                    outcome = Err("Rendering failed unexpectedly.".to_string());
                }
                Err(_) => {}
            }
        }
        outcome
    });
    result?;
    encoder.finish()
}

/// Fichier temporaire à côté de la sortie : le fichier final n'apparaît que complet.
fn partial_output_path(output_path: &Path) -> PathBuf {
    let name = output_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "export".to_string());
    output_path.with_file_name(format!(".{name}.part"))
}

/// Rend chaque frame du projet et encode le mp4 final (vidéo + audio mixé).
/// `on_progress` est appelé régulièrement avec une fraction 0.0..1.0. `cancel` interrompt
/// l'export (erreur `CANCELLED`) ; dans tous les cas d'échec, aucun fichier partiel ni process
/// ffmpeg ne subsiste.
pub fn export_video(
    project: &Project,
    project_dir: &Path,
    output_path: &Path,
    overrides: ExportOverrides,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(f32),
) -> Result<ExportReport, String> {
    if project.compositions.is_empty() {
        return Err("The project has no scenes to export.".to_string());
    }

    // x264 en yuv420p exige des dimensions paires.
    let width = overrides.width.unwrap_or(project.width).max(2) & !1;
    let height = overrides.height.unwrap_or(project.height).max(2) & !1;
    let fps = overrides.fps.unwrap_or(project.fps).max(1);
    // Le renderer lit `project.width/height/fps` directement (coordonnées en %) ; on rend
    // donc à la résolution/fps demandés en substituant temporairement ces champs, sans
    // toucher au reste du modèle (project_dir, sources, etc. restent identiques).
    let render_project = Project {
        width,
        height,
        fps,
        ..project.clone()
    };
    let total_frames = ((project.duration * fps as f64).round() as u64).max(1);
    let duration = total_frames as f64 / fps as f64;

    let mut missing = Vec::new();
    let audio_inputs = collect_audio_inputs(project, project_dir, &mut missing);
    let partial = partial_output_path(output_path);
    let encoder = VideoEncoder::start(&EncoderSpec {
        width,
        height,
        fps,
        crf: overrides.crf,
        duration,
        audio: &audio_inputs,
        output_path: &partial,
    })?;

    let result = render_and_encode(
        &render_project,
        project_dir,
        total_frames,
        encoder,
        cancel,
        &mut on_progress,
        &mut missing,
    )
    .and_then(|()| {
        std::fs::rename(&partial, output_path)
            .map_err(|e| format!("Failed to write the exported video: {e}"))
    });
    if result.is_err() {
        let _ = std::fs::remove_file(&partial);
    }
    result.map(|()| ExportReport {
        missing_media: missing,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use scene_core::model::*;

    fn empty_composition(id: &str, start_time: f64, duration: f64) -> Composition {
        Composition {
            id: id.into(),
            name: id.into(),
            start_time,
            duration,
            elements: vec![],
            transition_in: None,
            transition_out: None,
            overlap_next: 0.0,
        }
    }

    fn audio_track(id: &str, start_time: f64) -> AudioTrack {
        AudioTrack {
            id: id.into(),
            name: id.into(),
            src: format!("{id}.mp3"),
            start_time,
            duration: Some(1.0),
            volume: 1.0,
            audio_offset: 0.0,
            fade_in: 0.0,
            fade_out: 0.0,
            muted: false,
            solo: false,
        }
    }

    // `collect_project_audio_inputs` résout désormais chaque `src` sur disque (protection
    // contre les chemins qui sortiraient du dossier projet, voir `scene_core::paths`), donc les
    // tests doivent pointer vers des fichiers réels plutôt qu'un dossier fictif.
    fn temp_dir_with_files(test_name: &str, file_names: &[&str]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "letest-{test_name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        for name in file_names {
            std::fs::write(dir.join(name), b"fake").unwrap();
        }
        dir
    }

    #[test]
    fn audio_tracks_are_global_and_can_span_multiple_scenes() {
        // Piste posée à t=1 (absolu) sans durée : elle couvre les deux scènes jusqu'à la fin
        // du projet, indépendamment du découpage en scènes.
        let dir = temp_dir_with_files("audio-global", &["a1.mp3"]);
        let mut track = audio_track("a1", 1.0);
        track.duration = None;
        let project = Project {
            name: "p".into(),
            width: 100,
            height: 100,
            fps: 30,
            duration: 10.0,
            compositions: vec![
                empty_composition("c1", 0.0, 5.0),
                empty_composition("c2", 5.0, 5.0),
            ],
            audio_tracks: vec![track],
        };
        let inputs = collect_project_audio_inputs(&project, &dir, &mut Vec::new());
        assert_eq!(inputs.len(), 1);
        assert_eq!(inputs[0].start_time, 1.0);
        // Durée par défaut : jusqu'à la fin du projet (10 - 1), pas de la scène.
        assert_eq!(inputs[0].duration, 9.0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn muted_tracks_are_excluded_and_solo_silences_non_solo_tracks() {
        let mut solo_track = audio_track("solo", 0.0);
        solo_track.solo = true;
        let mut muted_track = audio_track("muted", 0.0);
        muted_track.muted = true;
        let regular_track = audio_track("regular", 0.0);

        let dir = temp_dir_with_files("audio-solo-mute", &["solo.mp3", "muted.mp3", "regular.mp3"]);
        let project = Project {
            name: "p".into(),
            width: 100,
            height: 100,
            fps: 30,
            duration: 5.0,
            compositions: vec![empty_composition("c1", 0.0, 5.0)],
            audio_tracks: vec![solo_track, muted_track, regular_track],
        };
        let inputs = collect_project_audio_inputs(&project, &dir, &mut Vec::new());
        assert_eq!(inputs.len(), 1, "seule la piste solo doit être mixée");
        assert!(inputs[0].path.ends_with("solo.mp3"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_track_whose_src_escapes_the_project_directory_is_silently_skipped() {
        let dir = temp_dir_with_files("audio-traversal", &[]);
        let project = Project {
            name: "p".into(),
            width: 100,
            height: 100,
            fps: 30,
            duration: 5.0,
            compositions: vec![empty_composition("c1", 0.0, 5.0)],
            audio_tracks: vec![audio_track("../etc/passwd", 0.0)],
        };
        let inputs = collect_project_audio_inputs(&project, &dir, &mut Vec::new());
        assert!(
            inputs.is_empty(),
            "un src hors du dossier projet doit être ignoré, pas suivi"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn exports_a_minimal_project_to_a_valid_mp4() {
        let dir = std::env::temp_dir().join(format!(
            "letest-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();

        let project = Project {
            name: "Export Test".into(),
            width: 160,
            height: 90,
            fps: 10,
            duration: 1.0,
            compositions: vec![Composition {
                id: "c1".into(),
                name: "Scene 1".into(),
                start_time: 0.0,
                duration: 1.0,
                elements: vec![Element::Shape(ShapeElement {
                    base: ElementBase {
                        id: "s1".into(),
                        name: "Rect".into(),
                        start_time: 0.0,
                        duration: None,
                        x: 10.0,
                        y: 10.0,
                        width: 50.0,
                        height: 50.0,
                        rotation: 0.0,
                        animations: vec![],
                        group_id: None,
                        blend_mode: None,
                    },
                    shape_type: ShapeType::Rectangle,
                    fill: "rgba(0,200,0,1)".into(),
                    stroke: "none".into(),
                    stroke_width: 0.0,
                    border_radius: None,
                    stroke_dash: None,
                    gradient_to: None,
                    gradient_angle: None,
                })],
                transition_in: None,
                transition_out: None,
                overlap_next: 0.0,
            }],
            audio_tracks: vec![],
        };

        let output_path = dir.join("out.mp4");
        let mut progress_calls = 0;
        export_video(
            &project,
            &dir,
            &output_path,
            ExportOverrides::default(),
            &AtomicBool::new(false),
            |_| progress_calls += 1,
        )
        .expect("export should succeed");

        assert!(output_path.exists(), "le fichier mp4 exporté doit exister");
        assert!(
            progress_calls >= 1,
            "la progression doit être notifiée au moins une fois (dernière frame)"
        );
        let metadata = std::fs::metadata(&output_path).unwrap();
        assert!(
            metadata.len() > 1000,
            "le mp4 exporté ne doit pas être vide/tronqué"
        );

        // Vérifie avec ffprobe que le fichier est un mp4 h264 valide de la bonne durée.
        let probe = std::process::Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_name,width,height",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1",
            ])
            .arg(&output_path)
            .output()
            .expect("ffprobe doit être disponible");
        assert!(
            probe.status.success(),
            "ffprobe a échoué sur le fichier exporté"
        );
        let info = String::from_utf8_lossy(&probe.stdout);
        assert!(info.contains("codec_name=h264"), "codec inattendu : {info}");
        assert!(info.contains("width=160"), "largeur inattendue : {info}");
        assert!(info.contains("height=90"), "hauteur inattendue : {info}");

        assert!(
            !dir.join(".out.mp4.part").exists(),
            "le fichier temporaire doit avoir été renommé"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn export_overrides_resolution_and_fps_independently_of_project_settings() {
        let dir = std::env::temp_dir().join(format!(
            "letest-override-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();

        let project = Project {
            name: "Export Override Test".into(),
            width: 160,
            height: 90,
            fps: 10,
            duration: 0.5,
            compositions: vec![Composition {
                id: "c1".into(),
                name: "Scene 1".into(),
                start_time: 0.0,
                duration: 0.5,
                elements: vec![],
                transition_in: None,
                transition_out: None,
                overlap_next: 0.0,
            }],
            audio_tracks: vec![],
        };

        let output_path = dir.join("out.mp4");
        export_video(
            &project,
            &dir,
            &output_path,
            ExportOverrides {
                width: Some(80),
                height: Some(60),
                fps: Some(5),
                crf: Some(30),
            },
            &AtomicBool::new(false),
            |_| {},
        )
        .expect("export with overrides should succeed");

        let probe = std::process::Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=width,height",
                "-of",
                "default=noprint_wrappers=1",
            ])
            .arg(&output_path)
            .output()
            .expect("ffprobe doit être disponible");
        let info = String::from_utf8_lossy(&probe.stdout);
        assert!(
            info.contains("width=80"),
            "la largeur exportée doit suivre la surcharge, pas le projet : {info}"
        );
        assert!(
            info.contains("height=60"),
            "la hauteur exportée doit suivre la surcharge, pas le projet : {info}"
        );
        // Le projet original ne doit pas être modifié par l'export.
        assert_eq!(project.width, 160);
        assert_eq!(project.height, 90);
        assert_eq!(project.fps, 10);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn export_includes_audio_from_a_video_element_with_a_soundtrack() {
        let dir = std::env::temp_dir().join(format!(
            "letest-videoaudio-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();

        // Génère une source vidéo synthétique avec une piste audio (ton sinusoïdal).
        let video_src = dir.join("clip.mp4");
        let status = std::process::Command::new("ffmpeg")
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=64x64:d=1",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=1",
                "-c:v",
                "libx264",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&video_src)
            .status()
            .expect("ffmpeg doit être disponible pour générer le clip de test");
        assert!(status.success(), "échec de génération du clip de test");

        let project = Project {
            name: "Video Audio Test".into(),
            width: 64,
            height: 64,
            fps: 10,
            duration: 1.0,
            compositions: vec![Composition {
                id: "c1".into(),
                name: "Scene 1".into(),
                start_time: 0.0,
                duration: 1.0,
                elements: vec![Element::Video(VideoElement {
                    base: ElementBase {
                        id: "v1".into(),
                        name: "Clip".into(),
                        start_time: 0.0,
                        duration: None,
                        x: 0.0,
                        y: 0.0,
                        width: 100.0,
                        height: 100.0,
                        rotation: 0.0,
                        animations: vec![],
                        group_id: None,
                        blend_mode: None,
                    },
                    src: "clip.mp4".into(),
                    fit_mode: FitMode::Cover,
                    background_color: None,
                    image_pan: None,
                    video_offset: 0.0,
                    corner_radius: None,
                    border_color: None,
                    border_width: None,
                    volume: 1.0,
                    muted: false,
                    playback_speed: 1.0,
                    loop_video: false,
                })],
                transition_in: None,
                transition_out: None,
                overlap_next: 0.0,
            }],
            audio_tracks: vec![],
        };

        let output_path = dir.join("out.mp4");
        export_video(
            &project,
            &dir,
            &output_path,
            ExportOverrides::default(),
            &AtomicBool::new(false),
            |_| {},
        )
        .expect("export should succeed");

        let probe = std::process::Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-select_streams",
                "a",
                "-show_entries",
                "stream=codec_name",
                "-of",
                "csv=p=0",
            ])
            .arg(&output_path)
            .output()
            .expect("ffprobe doit être disponible");
        let info = String::from_utf8_lossy(&probe.stdout);
        assert!(
            info.contains("aac"),
            "le mp4 exporté doit contenir la piste audio du clip vidéo : {info}"
        );

        // Même projet avec l'élément vidéo muet : son audio ne doit pas être mixé.
        let mut muted_project = project.clone();
        let Element::Video(video_el) = &mut muted_project.compositions[0].elements[0] else {
            unreachable!();
        };
        video_el.muted = true;
        let muted_output = dir.join("out-muted.mp4");
        export_video(
            &muted_project,
            &dir,
            &muted_output,
            ExportOverrides::default(),
            &AtomicBool::new(false),
            |_| {},
        )
        .expect("muted export should succeed");
        let probe = std::process::Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-select_streams",
                "a",
                "-show_entries",
                "stream=codec_name",
                "-of",
                "csv=p=0",
            ])
            .arg(&muted_output)
            .output()
            .expect("ffprobe doit être disponible");
        assert!(
            probe.stdout.is_empty(),
            "un élément vidéo muet ne doit apporter aucune piste audio : {}",
            String::from_utf8_lossy(&probe.stdout)
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    fn probe(path: &Path, args: &[&str]) -> String {
        let out = std::process::Command::new("ffprobe")
            .args(["-v", "error"])
            .args(args)
            .arg(path)
            .output()
            .expect("ffprobe doit être disponible");
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn plain_project(width: u32, height: u32, duration: f64) -> Project {
        Project {
            name: "p".into(),
            width,
            height,
            fps: 10,
            duration,
            compositions: vec![empty_composition("c1", 0.0, duration)],
            audio_tracks: vec![],
        }
    }

    fn export_to(
        dir: &Path,
        project: &Project,
        overrides: ExportOverrides,
    ) -> Result<ExportReport, String> {
        export_video(
            project,
            dir,
            &dir.join("out.mp4"),
            overrides,
            &AtomicBool::new(false),
            |_| {},
        )
    }

    #[test]
    fn odd_dimensions_are_rounded_down_to_even_values() {
        let dir = temp_dir_with_files("odd", &[]);
        export_to(
            &dir,
            &plain_project(101, 75, 0.5),
            ExportOverrides::default(),
        )
        .expect("les dimensions impaires ne doivent pas faire échouer l'encodage");
        let info = probe(
            &dir.join("out.mp4"),
            &["-show_entries", "stream=width,height", "-of", "csv=p=0"],
        );
        assert_eq!(info, "100,74");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn export_duration_follows_the_project_even_with_a_short_audio_track() {
        let dir = temp_dir_with_files("shortaudio", &[]);
        let tone = dir.join("a1.mp3");
        let status = std::process::Command::new("ffmpeg")
            .args([
                "-y",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=1",
            ])
            .arg(&tone)
            .status()
            .unwrap();
        assert!(status.success());
        let mut project = plain_project(64, 64, 3.0);
        let mut track = audio_track("a1", 0.0);
        track.duration = Some(1.0);
        project.audio_tracks = vec![track];
        export_to(&dir, &project, ExportOverrides::default()).unwrap();
        let duration: f64 = probe(
            &dir.join("out.mp4"),
            &["-show_entries", "format=duration", "-of", "csv=p=0"],
        )
        .parse()
        .unwrap();
        assert!(
            (duration - 3.0).abs() < 0.2,
            "durée exportée {duration} s au lieu de 3 s"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cancelling_leaves_no_file_behind() {
        let dir = temp_dir_with_files("cancel", &[]);
        let cancel = AtomicBool::new(true);
        let result = export_video(
            &plain_project(64, 64, 2.0),
            &dir,
            &dir.join("out.mp4"),
            ExportOverrides::default(),
            &cancel,
            |_| {},
        );
        assert_eq!(result, Err(CANCELLED.to_string()));
        assert_eq!(
            std::fs::read_dir(&dir).unwrap().count(),
            0,
            "ni fichier final ni fichier temporaire"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_failing_encoder_removes_the_partial_output() {
        let dir = temp_dir_with_files("fail", &[]);
        // Sortie dans un dossier inexistant : ffmpeg échoue à ouvrir son fichier.
        let result = export_video(
            &plain_project(64, 64, 0.5),
            &dir,
            &dir.join("missing-dir").join("out.mp4"),
            ExportOverrides::default(),
            &AtomicBool::new(false),
            |_| {},
        );
        assert!(result.is_err());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unreadable_media_are_reported_in_the_export_report() {
        let dir = temp_dir_with_files("missingmedia", &[]);
        let mut project = plain_project(64, 64, 0.5);
        project.audio_tracks = vec![audio_track("ghost", 0.0)];
        project.compositions[0].elements = vec![Element::Image(ImageElement {
            base: ElementBase {
                id: "i1".into(),
                name: "i1".into(),
                start_time: 0.0,
                duration: None,
                x: 0.0,
                y: 0.0,
                width: 50.0,
                height: 50.0,
                rotation: 0.0,
                animations: vec![],
                group_id: None,
                blend_mode: None,
            },
            src: "gone.png".into(),
            fit_mode: FitMode::Cover,
            background_color: None,
            image_pan: None,
            corner_radius: None,
            border_color: None,
            border_width: None,
        })];
        let report = export_to(&dir, &project, ExportOverrides::default()).unwrap();
        assert_eq!(report.missing_media, vec!["ghost.mp3", "gone.png"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn render_worker_count_respects_memory_and_frame_count() {
        assert_eq!(render_worker_count(1, 1920, 1080), 1);
        assert!(render_worker_count(1000, 1920, 1080) >= 1);
        assert!(render_worker_count(1000, 1920, 1080) <= MAX_RENDER_WORKERS);
        // 8K : une seule frame pèse 128 Mo, deux par rendu dépassent déjà le budget.
        assert_eq!(render_worker_count(1000, 7680, 4320), 1);
    }

    #[test]
    fn parallel_rendering_keeps_frames_in_order() {
        // Rouge à la première seconde, bleu ensuite : l'ordre des frames doit être préservé
        // malgré plusieurs rendus parallèles.
        let dir = temp_dir_with_files("order", &[]);
        let mut project = plain_project(32, 32, 2.0);
        let rect = |id: &str, color: &str, start: f64, duration: f64| {
            Element::Shape(ShapeElement {
                base: ElementBase {
                    id: id.into(),
                    name: id.into(),
                    start_time: start,
                    duration: Some(duration),
                    x: 0.0,
                    y: 0.0,
                    width: 100.0,
                    height: 100.0,
                    rotation: 0.0,
                    animations: vec![],
                    group_id: None,
                    blend_mode: None,
                },
                shape_type: ShapeType::Rectangle,
                fill: color.into(),
                stroke: "none".into(),
                stroke_width: 0.0,
                border_radius: None,
                stroke_dash: None,
                gradient_to: None,
                gradient_angle: None,
            })
        };
        project.compositions[0].elements = vec![
            rect("red", "rgba(255,0,0,1)", 0.0, 1.0),
            rect("blue", "rgba(0,0,255,1)", 1.0, 1.0),
        ];
        export_to(&dir, &project, ExportOverrides::default()).unwrap();
        let frame_color = |second: &str| -> &'static str {
            let out = std::process::Command::new("ffmpeg")
                .args(["-v", "error", "-ss", second, "-i"])
                .arg(dir.join("out.mp4"))
                .args(["-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo"])
                .args(["-pix_fmt", "rgb24", "-"])
                .output()
                .unwrap();
            assert_eq!(out.stdout.len(), 3, "un pixel RGB attendu");
            if out.stdout[0] > out.stdout[2] {
                "red"
            } else {
                "blue"
            }
        };
        assert_eq!(frame_color("0.3"), "red");
        assert_eq!(frame_color("1.5"), "blue");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
