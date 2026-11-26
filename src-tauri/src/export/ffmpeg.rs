//! Pilotage de ffmpeg pour l'encodage vidéo et le mixage audio. Les binaires sont résolus via
//! `scene_core::ffmpeg_path` — PATH système par défaut, ou chemins définis par
//! `LIGHT_EDITOR_VIDZ_FFMPEG` / `LIGHT_EDITOR_VIDZ_FFPROBE`.
//!
//! Une seule instance ffmpeg encode la vidéo (frames RGBA brutes sur stdin) **et** mixe l'audio
//! (fichiers sources en entrées supplémentaires) : pas de fichier intermédiaire ni de seconde
//! passe. La sortie est écrite dans un fichier temporaire puis renommée une fois complète.

use scene_core::audio_fx::{fade_curve_name, filter_stages};
use scene_core::ffmpeg_path::{ffmpeg_binary, ffprobe_binary};
use scene_core::loudness;
use scene_core::model::{AudioFilter, FadeCurve};
use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::thread::JoinHandle;

/// Taille maximale (octets) de la fin de stderr conservée pour les messages d'erreur.
const STDERR_TAIL_BYTES: usize = 8 * 1024;

pub struct AudioMixInput {
    pub path: PathBuf,
    /// Décalage (secondes) dans le fichier source à partir duquel commencer la lecture.
    pub offset: f64,
    /// Position (secondes) sur la timeline globale à laquelle la piste doit démarrer.
    pub start_time: f64,
    pub volume: f64,
    /// Durée (secondes) du fondu d'entrée/sortie ; 0.0 = pas de fondu.
    pub fade_in: f64,
    pub fade_out: f64,
    /// Durée (secondes) de la piste dans le mix (temps de timeline, après changement de
    /// vitesse). La lecture est toujours coupée à cette durée.
    pub duration: f64,
    /// Vitesse de lecture de la source vidéo associée (1.0 = normale). Doit rester cohérente
    /// avec la vitesse appliquée aux frames vidéo (`playback_speed`), sous peine de désynchro
    /// audio/vidéo progressive sur les clips accélérés/ralentis.
    pub speed: f64,
    /// Si la source est plus courte que `duration`, la boucler plutôt que de laisser le silence
    /// pour le reste — doit suivre le même choix que la vidéo (`VideoElement.loop_video`).
    pub loop_audio: bool,
    /// Durée (secondes) du fichier source, nécessaire pour boucler à partir de `offset`.
    pub source_duration: Option<f64>,
    /// Courbe des fondus d'entrée et de sortie.
    pub fade_curve: FadeCurve,
    /// Filtre passe-bas / passe-haut / passe-bande, appliqué après le changement de vitesse.
    pub filter: Option<AudioFilter>,
    /// Baisse (dB) de cette piste sous les autres sons ; 0 = elle ne baisse pas.
    pub duck_db: f64,
}

/// Paramètres de l'encodage final.
pub struct EncoderSpec<'a> {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// `crf` (0-51, x264) surcharge le contrôle de qualité par défaut du `-preset medium`.
    pub crf: Option<u32>,
    /// Durée (secondes) du fichier final : la vidéo fixe la durée, l'audio est complété par du
    /// silence ou coupé.
    pub duration: f64,
    pub audio: &'a [AudioMixInput],
    /// Correction du volume ressenti (`measure_mix`), appliquée au mix.
    pub normalize: Option<&'a str>,
    pub output_path: &'a Path,
}

/// Fréquence d'échantillonnage commune du mix (les boucles audio se calculent en échantillons).
const MIX_SAMPLE_RATE: u32 = 48_000;

/// Plafond du mix : −1 dBFS (comme la normalisation de la vue Audio). La somme des pistes
/// (`amix normalize=0`, volumes jusqu'à 200 %) peut dépasser la pleine échelle, que l'encodage
/// écrêterait. `level=false` : sans lui, `alimiter` remonte tout le signal ; `latency=true`
/// compense son temps d'anticipation, pour ne pas décaler le son.
const MIX_LIMITER: &str = "alimiter=limit=0.891251:level=false:latency=true";

/// Chaîne de filtres `atempo` équivalente à `speed`, en décomposant en facteurs dans
/// l'intervalle `[0.5, 2.0]` supporté par une seule instance du filtre ffmpeg `atempo`.
fn atempo_chain(speed: f64) -> String {
    let mut remaining = speed;
    let mut factors = Vec::new();
    while remaining < 0.5 {
        factors.push(0.5);
        remaining /= 0.5;
    }
    while remaining > 2.0 {
        factors.push(2.0);
        remaining /= 2.0;
    }
    factors.push(remaining);
    factors
        .iter()
        .map(|f| format!("atempo={f}"))
        .collect::<Vec<_>>()
        .join(",")
}

/// Lance ffprobe et retourne sa sortie standard si la commande réussit.
fn ffprobe(args: &[&str], path: &Path) -> Option<String> {
    let output = Command::new(ffprobe_binary())
        .args(args)
        .arg(path)
        .stdin(Stdio::null())
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Indique si `path` contient au moins une piste audio (ex : une source vidéo peut ne pas en
/// avoir). Best-effort via ffprobe : en cas d'échec (binaire absent, format non lisible), on
/// suppose "pas d'audio" plutôt que de faire échouer tout l'export sur une vérification annexe.
pub fn has_audio_stream(path: &Path) -> bool {
    ffprobe(
        &[
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
        ],
        path,
    )
    .is_some_and(|out| !out.trim().is_empty())
}

/// Durée (secondes) d'un fichier média, si ffprobe la connaît.
pub fn media_duration(path: &Path) -> Option<f64> {
    ffprobe(
        &[
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
        ],
        path,
    )?
    .trim()
    .parse::<f64>()
    .ok()
    .filter(|d| d.is_finite() && *d > 0.0)
}

/// Chaîne de filtres audio d'une entrée (`idx` = index de l'entrée ffmpeg), jusqu'à son
/// étiquette `[a<n>]`. Ordre : bouclage → coupe à la durée → vitesse → filtre → fondus (dans le
/// temps local du clip) → volume → décalage sur la timeline.
fn audio_chain(input: &AudioMixInput, idx: usize, label: &str) -> String {
    let speed = input.speed.clamp(0.1, 4.0);
    let mut filters: Vec<String> = Vec::new();
    if let (true, Some(source_duration)) = (input.loop_audio, input.source_duration) {
        // Boucle sur [offset, fin de source) — comme la vidéo —, et non sur tout le fichier.
        let span = (source_duration - input.offset.max(0.0)).max(0.05);
        let samples = (span * MIX_SAMPLE_RATE as f64).ceil() as u64;
        filters.push(format!("aresample={MIX_SAMPLE_RATE}"));
        filters.push(format!("atrim=start={}", input.offset.max(0.0)));
        filters.push("asetpts=PTS-STARTPTS".to_string());
        filters.push(format!("aloop=loop=-1:size={samples}"));
    }
    filters.push(format!("atrim=duration={}", input.duration * speed));
    filters.push("asetpts=PTS-STARTPTS".to_string());
    if (speed - 1.0).abs() > 0.001 {
        filters.push(atempo_chain(speed));
    }
    if let Some(filter) = &input.filter {
        filters.extend(filter_stages(filter));
    }
    let curve = fade_curve_name(input.fade_curve);
    if input.fade_in > 0.0 {
        filters.push(format!("afade=t=in:st=0:d={}:curve={curve}", input.fade_in));
    }
    if input.fade_out > 0.0 {
        let start = (input.duration - input.fade_out).max(0.0);
        filters.push(format!(
            "afade=t=out:st={start}:d={}:curve={curve}",
            input.fade_out
        ));
    }
    filters.push(format!("volume={}", input.volume.clamp(0.0, 2.0)));
    let delay_ms = (input.start_time.max(0.0) * 1000.0).round() as i64;
    filters.push(format!("adelay={delay_ms}:all=1"));
    format!("[{idx}:a]{}[{label}]", filters.join(","))
}

/// Graphe de filtres complet : conversion vidéo + mix audio. Retourne le graphe et la présence
/// d'une sortie audio `[aout]`.
fn filter_graph(spec: &EncoderSpec) -> (String, bool) {
    // Conversion RGB → YUV 4:2:0 avec la matrice BT.709 (celle déclarée dans les métadonnées).
    let mut graph =
        String::from("[0:v]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[vout]");
    if spec.audio.is_empty() {
        return (graph, false);
    }
    graph.push(';');
    let end = MixEnd {
        normalize: spec.normalize,
        limit: true,
        tail: "",
    };
    graph.push_str(&audio_mix_graph(spec.audio, 1, spec.duration, end));
    (graph, true)
}

/// La fin de chaîne du mix.
#[derive(Default)]
struct MixEnd<'a> {
    /// Correction du volume ressenti, avant le plafond.
    normalize: Option<&'a str>,
    /// Plafonner à −1 dBFS (sauf pour mesurer le mix tel qu'il est).
    limit: bool,
    /// Filtres ajoutés tout au bout (ex. dither).
    tail: &'a str,
}

/// La somme des pistes étiquetées, à volume inchangé.
fn sum(labels: &[String]) -> String {
    let joined = labels.concat();
    if labels.len() == 1 {
        format!("{joined}anull")
    } else {
        format!(
            "{joined}amix=inputs={}:duration=longest:normalize=0",
            labels.len()
        )
    }
}

/// Mix de toutes les pistes `audio` (entrées ffmpeg `first_input`, `first_input + 1`…), jusqu'à
/// l'étiquette `[aout]`, terminée selon `end`.
fn audio_mix_graph(
    audio: &[AudioMixInput],
    first_input: usize,
    duration: f64,
    end: MixEnd,
) -> String {
    let mut graph = String::new();
    // Baisser une piste n'a de sens que s'il reste un autre son pour le déclencher.
    let ducked = |input: &AudioMixInput| scene_core::ducking::amount(input.duck_db) > 0.0;
    let ducking = audio.iter().any(ducked) && !audio.iter().all(ducked);
    let mut voices = Vec::new();
    let mut music = Vec::new();
    for (i, input) in audio.iter().enumerate() {
        let mut label = format!("a{i}");
        graph.push_str(&audio_chain(input, first_input + i, &label));
        graph.push(';');
        if ducking {
            // La porte exige le même format sur ses deux entrées.
            graph.push_str(&format!(
                "[{label}]aformat=sample_rates={MIX_SAMPLE_RATE}:channel_layouts=stereo[f{i}];"
            ));
            label = format!("f{i}");
        }
        if ducking && ducked(input) {
            music.push((label, input.duck_db));
        } else {
            voices.push(format!("[{label}]"));
        }
    }
    let mut labels = voices;
    if ducking {
        // Les autres sons, une fois pour le mix et une fois par piste à baisser.
        let keys: String = (0..music.len()).map(|n| format!("[key{n}]")).collect();
        graph.push_str(&format!(
            "{},asplit={}[voices]{keys};",
            sum(&labels),
            music.len() + 1
        ));
        labels = vec!["[voices]".to_string()];
        for (n, (label, db)) in music.iter().enumerate() {
            let output = format!("duck{n}");
            graph.push_str(&scene_core::ducking::graph(
                label,
                &format!("key{n}"),
                &output,
                *db,
            ));
            graph.push(';');
            labels.push(format!("[{output}]"));
        }
    }
    // Le mix dure aussi longtemps que la piste la plus longue ; `apad` le complète par du silence
    // jusqu'à la durée du projet (`-t` coupe l'excédent).
    let mix = sum(&labels);
    let mut chain = vec![mix];
    chain.extend(end.normalize.map(str::to_string));
    if end.limit {
        chain.push(MIX_LIMITER.to_string());
    }
    chain.push(format!("apad=whole_dur={duration}{}", end.tail));
    graph.push_str(&format!("{}[aout]", chain.join(",")));
    graph
}

/// Une entrée ffmpeg par piste du mix (lecture à partir de l'offset, ou boucle).
fn push_audio_inputs(args: &mut Vec<String>, audio: &[AudioMixInput]) {
    for input in audio {
        let loops_from_offset = input.loop_audio && input.source_duration.is_some();
        if input.loop_audio && !loops_from_offset {
            // Durée de source inconnue : repli sur la boucle du fichier entier.
            args.extend(["-stream_loop".to_string(), "-1".to_string()]);
        }
        if !loops_from_offset {
            args.extend(["-ss".to_string(), input.offset.max(0.0).to_string()]);
        }
        args.push("-i".to_string());
        args.push(input.path.to_string_lossy().into_owned());
    }
}

/// Format de l'export « audio seul ».
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AudioFormat {
    /// WAV 16 bits, avec dither triangulaire.
    Wav16,
    Wav24,
    /// WAV flottant 32 bits.
    Wav32f,
    /// MP3 VBR (V2, ≈ 190 kb/s).
    Mp3,
    Flac,
    /// OGG Vorbis (qualité 5).
    Ogg,
    /// AAC 192 kb/s dans un conteneur M4A.
    M4a,
}

impl AudioFormat {
    #[cfg(test)]
    pub fn extension(self) -> &'static str {
        match self {
            Self::Wav16 | Self::Wav24 | Self::Wav32f => "wav",
            Self::Mp3 => "mp3",
            Self::Flac => "flac",
            Self::Ogg => "ogg",
            Self::M4a => "m4a",
        }
    }

    /// Conteneur (`-f`) : le fichier temporaire n'a pas d'extension exploitable par ffmpeg.
    fn container(self) -> &'static str {
        match self {
            Self::Wav16 | Self::Wav24 | Self::Wav32f => "wav",
            Self::Mp3 => "mp3",
            Self::Flac => "flac",
            Self::Ogg => "ogg",
            Self::M4a => "ipod",
        }
    }

    fn codec_args(self) -> &'static [&'static str] {
        match self {
            Self::Wav16 => &["-c:a", "pcm_s16le"],
            Self::Wav24 => &["-c:a", "pcm_s24le"],
            Self::Wav32f => &["-c:a", "pcm_f32le"],
            Self::Mp3 => &["-c:a", "libmp3lame", "-q:a", "2"],
            Self::Flac => &["-c:a", "flac"],
            Self::Ogg => &["-c:a", "libvorbis", "-q:a", "5"],
            Self::M4a => &["-c:a", "aac", "-b:a", "192k"],
        }
    }

    /// Filtre de fin de chaîne : le passage en 16 bits est dithéré plutôt que tronqué.
    fn graph_tail(self) -> &'static str {
        match self {
            Self::Wav16 => ",aresample=osf=s16:dither_method=triangular",
            _ => "",
        }
    }
}

/// Paramètres de l'export « audio seul » : le mix des pistes, sans vidéo.
pub struct AudioExportSpec<'a> {
    pub audio: &'a [AudioMixInput],
    /// Durée (secondes) du fichier : le mix est complété par du silence ou coupé.
    pub duration: f64,
    pub format: AudioFormat,
    /// Correction du volume ressenti (`measure_mix`), appliquée au mix.
    pub normalize: Option<&'a str>,
    /// Titre inscrit dans les métadonnées du fichier.
    pub title: &'a str,
    pub output_path: &'a Path,
}

/// Arguments complets de ffmpeg pour un export audio seul (hors binaire).
fn audio_export_args(spec: &AudioExportSpec) -> Vec<String> {
    let mut args: Vec<String> = [
        "-y",
        "-nostdin",
        "-nostats",
        "-loglevel",
        "error",
        // Progression lisible sur stdout (`out_time_us=`).
        "-progress",
        "pipe:1",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    push_audio_inputs(&mut args, spec.audio);
    args.extend([
        "-filter_complex".to_string(),
        audio_mix_graph(
            spec.audio,
            0,
            spec.duration,
            MixEnd {
                normalize: spec.normalize,
                limit: true,
                tail: spec.format.graph_tail(),
            },
        ),
        "-map".to_string(),
        "[aout]".to_string(),
        "-ar".to_string(),
        MIX_SAMPLE_RATE.to_string(),
    ]);
    args.extend(spec.format.codec_args().iter().map(|s| s.to_string()));
    if !spec.title.trim().is_empty() {
        args.extend(["-metadata".to_string(), format!("title={}", spec.title)]);
    }
    if spec.format == AudioFormat::M4a {
        args.extend(["-movflags".to_string(), "+faststart".to_string()]);
    }
    args.extend(["-f".to_string(), spec.format.container().to_string()]);
    args.push("-t".to_string());
    args.push(format!("{:.6}", spec.duration));
    // `file:` : un chemin qui ressemble à une URL (`http://…`) ne doit jamais être interprété comme
    // telle par ffmpeg.
    args.push(format!("file:{}", spec.output_path.to_string_lossy()));
    args
}

/// Lance l'export audio seul et attend sa fin. `on_progress` reçoit une fraction 0.0..1.0.
/// `cancelled` est interrogé à chaque mise à jour de progression (ffmpeg en émet plusieurs par
/// seconde) : s'il renvoie vrai, ffmpeg est tué et `Err(CANCELLED)` est retourné.
pub fn run_audio_export(
    spec: &AudioExportSpec,
    cancelled: impl Fn() -> bool,
    on_progress: impl FnMut(f32),
) -> Result<(), String> {
    run_reporting(
        audio_export_args(spec),
        spec.duration,
        cancelled,
        on_progress,
    )
}

/// Première passe de la normalisation : mesure le volume du mix, sans rien écrire d'autre que les
/// mesures. Renvoie le filtre de correction, ou `None` si le son est trop faible pour être monté.
pub fn measure_mix(
    audio: &[AudioMixInput],
    duration: f64,
    target: f64,
    cancelled: impl Fn() -> bool,
) -> Result<Option<String>, String> {
    let stats = tempfile::Builder::new()
        .prefix("lev_loudness_")
        .suffix(".json")
        .tempfile()
        .map_err(|e| format!("Cannot measure the loudness: {e}"))?;
    let measure = loudness::measure_filter(target, &stats.path().to_string_lossy());
    let mut args: Vec<String> = ["-y", "-nostdin", "-nostats", "-loglevel", "error"]
        .map(String::from)
        .to_vec();
    args.extend(["-progress".to_string(), "pipe:1".to_string()]);
    push_audio_inputs(&mut args, audio);
    let end = MixEnd {
        tail: &format!(",{measure}"),
        ..MixEnd::default()
    };
    args.extend([
        "-filter_complex".to_string(),
        audio_mix_graph(audio, 0, duration, end),
    ]);
    args.extend(["-map", "[aout]", "-t"].map(String::from));
    args.push(format!("{duration:.6}"));
    args.extend(["-f", "null", "-"].map(String::from));
    run_reporting(args, duration, cancelled, |_| {})?;
    let json = std::fs::read_to_string(stats.path())
        .map_err(|e| format!("Cannot read the loudness measure: {e}"))?;
    Ok(loudness::apply_filter(
        target,
        &loudness::parse_measure(&json)?,
        loudness::OUTPUT_RATE,
    ))
}

/// Les passages (secondes) où le mix de `audio` dépasse le seuil de la baisse automatique :
/// c'est pendant ceux-là que l'aperçu baisse la musique, comme l'export.
pub fn voice_ranges(audio: &[AudioMixInput], duration: f64) -> Result<Vec<(f64, f64)>, String> {
    if audio.is_empty() {
        return Ok(Vec::new());
    }
    let log = tempfile::Builder::new()
        .prefix("lev_voice_")
        .suffix(".log")
        .tempfile()
        .map_err(|e| format!("Cannot analyse the voice: {e}"))?;
    // Un silence plus court que le retour de la musique ne la laisse pas remonter.
    let detect = format!(
        ",silencedetect=noise={}dB:d={},ametadata=mode=print:file={}",
        scene_core::ducking::THRESHOLD_DB,
        scene_core::ducking::RELEASE_MS / 1000.0,
        scene_core::ffmpeg_path::escape_for_ffmpeg_filter(&log.path().to_string_lossy())
    );
    let mut args: Vec<String> = ["-y", "-nostdin", "-nostats", "-loglevel", "error"]
        .map(String::from)
        .to_vec();
    args.extend(["-progress".to_string(), "pipe:1".to_string()]);
    push_audio_inputs(&mut args, audio);
    let end = MixEnd {
        tail: &detect,
        ..MixEnd::default()
    };
    args.extend([
        "-filter_complex".to_string(),
        audio_mix_graph(audio, 0, duration, end),
    ]);
    args.extend(["-map", "[aout]", "-t"].map(String::from));
    args.push(format!("{duration:.6}"));
    args.extend(["-f", "null", "-"].map(String::from));
    run_reporting(args, duration, || false, |_| {})?;
    let text = std::fs::read_to_string(log.path())
        .map_err(|e| format!("Cannot read the voice analysis: {e}"))?;
    let silences = video_export::silence::parse_silences(&text, duration);
    // Les passages voisés sont ce qui reste entre les silences.
    let mut ranges = Vec::new();
    let mut from = 0.0;
    for silence in silences {
        if silence.start - from > 0.01 {
            ranges.push((from, silence.start));
        }
        from = silence.end;
    }
    if duration - from > 0.01 {
        ranges.push((from, duration));
    }
    Ok(ranges)
}

/// Lance ffmpeg (avec `-progress pipe:1`) et attend sa fin, en suivant sa progression sur
/// `duration` secondes.
fn run_reporting(
    args: Vec<String>,
    duration: f64,
    cancelled: impl Fn() -> bool,
    mut on_progress: impl FnMut(f32),
) -> Result<(), String> {
    let mut child = Command::new(ffmpeg_binary())
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to launch ffmpeg: {e}"))?;
    let stderr = child.stderr.take().map(|mut pipe| {
        std::thread::spawn(move || {
            let mut tail: Vec<u8> = Vec::new();
            let mut chunk = [0u8; 4096];
            while let Ok(n) = pipe.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                tail.extend_from_slice(&chunk[..n]);
                if tail.len() > STDERR_TAIL_BYTES {
                    tail.drain(..tail.len() - STDERR_TAIL_BYTES);
                }
            }
            String::from_utf8_lossy(&tail).into_owned()
        })
    });
    let stdout = child.stdout.take().ok_or("ffmpeg stdout unavailable")?;
    for line in std::io::BufReader::new(stdout)
        .lines()
        .map_while(Result::ok)
    {
        if cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(crate::export::CANCELLED.to_string());
        }
        if let Some(micros) = line.strip_prefix("out_time_us=") {
            if let Ok(micros) = micros.trim().parse::<f64>() {
                on_progress((micros / 1e6 / duration).clamp(0.0, 1.0) as f32);
            }
        }
    }
    let status = child.wait().map_err(|e| format!("ffmpeg failed: {e}"))?;
    let stderr = stderr.and_then(|h| h.join().ok()).unwrap_or_default();
    if status.success() {
        Ok(())
    } else {
        Err(format!("ffmpeg failed: {}", tail(&stderr, 2000)))
    }
}

/// Arguments complets de ffmpeg pour `spec` (hors binaire).
fn encoder_args(spec: &EncoderSpec) -> Vec<String> {
    let mut args: Vec<String> = [
        "-y",
        "-nostdin",
        // Pas de lignes de statistiques périodiques sur stderr, seulement les erreurs.
        "-nostats",
        "-loglevel",
        "error",
        "-f",
        "rawvideo",
        "-pixel_format",
        "rgba",
        "-video_size",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    args.push(format!("{}x{}", spec.width, spec.height));
    args.extend(["-framerate".to_string(), spec.fps.to_string()]);
    // `-nostdin` ne concerne que les commandes interactives : l'entrée vidéo lit bien `pipe:0`.
    args.extend(["-i".to_string(), "pipe:0".to_string()]);

    push_audio_inputs(&mut args, spec.audio);

    let (graph, has_audio) = filter_graph(spec);
    args.extend(["-filter_complex".to_string(), graph]);
    args.extend(["-map".to_string(), "[vout]".to_string()]);
    if has_audio {
        args.extend(["-map".to_string(), "[aout]".to_string()]);
    }
    args.extend(
        ["-c:v", "libx264", "-preset", "medium"]
            .iter()
            .map(|s| s.to_string()),
    );
    if let Some(crf) = spec.crf {
        args.push("-crf".to_string());
        args.push(crf.clamp(0, 51).to_string());
    }
    args.extend(
        [
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-colorspace",
            "bt709",
            "-color_range",
            "tv",
        ]
        .iter()
        .map(|s| s.to_string()),
    );
    if has_audio {
        args.extend(["-c:a", "aac"].iter().map(|s| s.to_string()));
    }
    args.extend(
        ["-movflags", "+faststart", "-f", "mp4", "-t"]
            .iter()
            .map(|s| s.to_string()),
    );
    args.push(format!("{:.6}", spec.duration));
    // `file:` : un chemin qui ressemble à une URL (`http://…`) ne doit jamais être interprété comme
    // telle par ffmpeg.
    args.push(format!("file:{}", spec.output_path.to_string_lossy()));
    args
}

/// Process ffmpeg d'encodage. Si l'encodeur est abandonné avant `finish` (erreur, annulation),
/// le process est tué à la destruction : aucun ffmpeg orphelin.
pub struct VideoEncoder {
    child: Child,
    stdin: Option<ChildStdin>,
    stderr: Option<JoinHandle<String>>,
}

impl VideoEncoder {
    pub fn start(spec: &EncoderSpec) -> Result<Self, String> {
        let mut child = Command::new(ffmpeg_binary())
            .args(encoder_args(spec))
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to launch ffmpeg (is it installed and in PATH?): {e}"))?;
        let stdin = child.stdin.take();
        // stderr est lu en continu : un pipe jamais vidé bloque ffmpeg (et donc l'export) dès
        // que son tampon est plein.
        let stderr = child.stderr.take().map(|mut pipe| {
            std::thread::spawn(move || {
                let mut tail: Vec<u8> = Vec::new();
                let mut chunk = [0u8; 4096];
                while let Ok(n) = pipe.read(&mut chunk) {
                    if n == 0 {
                        break;
                    }
                    tail.extend_from_slice(&chunk[..n]);
                    if tail.len() > STDERR_TAIL_BYTES {
                        tail.drain(..tail.len() - STDERR_TAIL_BYTES);
                    }
                }
                String::from_utf8_lossy(&tail).into_owned()
            })
        });
        Ok(Self {
            child,
            stdin,
            stderr,
        })
    }

    pub fn write_frame(&mut self, rgba: &[u8]) -> Result<(), String> {
        let result = self
            .stdin
            .as_mut()
            .ok_or("ffmpeg stdin unavailable")?
            .write_all(rgba);
        match result {
            Ok(()) => Ok(()),
            // Broken pipe : ffmpeg s'est arrêté, sa propre erreur est plus parlante.
            Err(e) => Err(self
                .failure()
                .unwrap_or_else(|| format!("Failed to write frame to ffmpeg: {e}"))),
        }
    }

    /// Message d'erreur de ffmpeg s'il s'est terminé en échec (stderr conservé).
    fn failure(&mut self) -> Option<String> {
        drop(self.stdin.take());
        let status = self.child.wait().ok()?;
        let stderr = self
            .stderr
            .take()
            .and_then(|h| h.join().ok())
            .unwrap_or_default();
        (!status.success()).then(|| format!("ffmpeg failed: {}", tail(&stderr, 2000)))
    }

    #[cfg(test)]
    pub fn finish(self) -> Result<(), String> {
        self.finish_unless(|| false)
    }

    /// Ferme l'entrée et attend la fin de ffmpeg (finalisation `+faststart`, parfois longue sur un
    /// gros fichier) en interrogeant `cancelled` : s'il devient vrai, ffmpeg est tué et
    /// `Err(CANCELLED)` renvoyé.
    pub fn finish_unless(mut self, cancelled: impl Fn() -> bool) -> Result<(), String> {
        drop(self.stdin.take());
        while matches!(self.child.try_wait(), Ok(None)) {
            if cancelled() {
                let _ = self.child.kill();
                let _ = self.child.wait();
                return Err(crate::export::CANCELLED.to_string());
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        match self.failure() {
            Some(message) => Err(message),
            None => Ok(()),
        }
    }
}

impl Drop for VideoEncoder {
    fn drop(&mut self) {
        if matches!(self.child.try_wait(), Ok(None)) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

fn tail(s: &str, max_len: usize) -> String {
    let s = s.trim();
    if s.len() <= max_len {
        return s.to_string();
    }
    // `s.len() - max_len` peut tomber au milieu d'un caractère UTF-8 multi-octet (la sortie
    // ffmpeg peut contenir des chemins/accents non-ASCII) : on recule jusqu'à la frontière de
    // caractère la plus proche pour éviter un panic sur un découpage de `&str` invalide.
    let mut start = s.len() - max_len;
    while start > 0 && !s.is_char_boundary(start) {
        start -= 1;
    }
    format!("…{}", &s[start..])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(duration: f64) -> AudioMixInput {
        AudioMixInput {
            path: PathBuf::from("/tmp/a.mp3"),
            offset: 0.0,
            start_time: 0.0,
            volume: 1.0,
            fade_in: 0.0,
            fade_out: 0.0,
            duration,
            speed: 1.0,
            loop_audio: false,
            source_duration: None,
            fade_curve: FadeCurve::Linear,
            filter: None,
            duck_db: 0.0,
        }
    }

    fn spec<'a>(audio: &'a [AudioMixInput], output: &'a Path) -> EncoderSpec<'a> {
        EncoderSpec {
            width: 64,
            height: 64,
            fps: 10,
            crf: None,
            duration: 6.0,
            audio,
            normalize: None,
            output_path: output,
        }
    }

    fn product_of_atempo_factors(chain: &str) -> f64 {
        chain
            .split(',')
            .map(|f| f.strip_prefix("atempo=").unwrap().parse::<f64>().unwrap())
            .product()
    }

    #[test]
    fn atempo_chain_is_a_single_filter_within_the_native_range() {
        assert_eq!(atempo_chain(1.5), "atempo=1.5");
        assert_eq!(atempo_chain(0.5), "atempo=0.5");
        assert_eq!(atempo_chain(2.0), "atempo=2");
    }

    #[test]
    fn atempo_chain_splits_out_of_range_speeds_into_factors_within_0_5_to_2() {
        for speed in [0.1, 0.25, 3.0, 4.0] {
            let chain = atempo_chain(speed);
            for factor in chain
                .split(',')
                .map(|f| f.strip_prefix("atempo=").unwrap().parse::<f64>().unwrap())
            {
                assert!(
                    (0.5..=2.0).contains(&factor),
                    "facteur {factor} hors intervalle"
                );
            }
            assert!((product_of_atempo_factors(&chain) - speed).abs() < 1e-9);
        }
    }

    #[test]
    fn tail_returns_input_unchanged_when_shorter_than_max_len() {
        assert_eq!(tail("short", 2000), "short");
    }

    #[test]
    fn tail_truncates_and_prefixes_with_ellipsis() {
        let s = "a".repeat(2010);
        let result = tail(&s, 2000);
        assert!(result.starts_with('…'));
        assert_eq!(result.chars().count(), 2001);
    }

    #[test]
    fn tail_does_not_panic_when_the_cut_point_falls_inside_a_multibyte_char() {
        let s = "é".repeat(1500);
        let result = tail(&s, 1999);
        assert!(result.starts_with('…'));
        assert!(result.chars().skip(1).all(|c| c == 'é'));
    }

    #[test]
    fn args_disable_periodic_stats_and_set_the_final_duration() {
        let out = Path::new("/tmp/out.part");
        let args = encoder_args(&spec(&[], out));
        assert!(args.windows(2).any(|w| w == ["-loglevel", "error"]));
        assert!(args.contains(&"-nostats".to_string()));
        assert!(args.windows(2).any(|w| w == ["-t", "6.000000"]));
        assert!(args.windows(2).any(|w| w == ["-movflags", "+faststart"]));
        assert!(args.windows(2).any(|w| w == ["-colorspace", "bt709"]));
        assert_eq!(args.last().map(String::as_str), Some("file:/tmp/out.part"));
        assert!(
            !args.contains(&"[aout]".to_string()),
            "pas d'audio sans pistes"
        );
    }

    #[test]
    fn audio_never_truncates_the_video() {
        // Régression : `-shortest` et `amix=duration=first` coupaient la vidéo à la fin de la
        // première/plus courte piste.
        let inputs = [input(1.0), input(2.0)];
        let (graph, has_audio) = filter_graph(&spec(&inputs, Path::new("/tmp/o")));
        assert!(has_audio);
        assert!(graph.contains("amix=inputs=2:duration=longest"));
        assert!(graph.contains("apad=whole_dur=6"));
        let args = encoder_args(&spec(&inputs, Path::new("/tmp/o")));
        assert!(!args.contains(&"-shortest".to_string()));
    }

    #[test]
    fn track_duration_is_always_applied() {
        let chain = audio_chain(&input(3.0), 1, "a0");
        assert!(chain.contains("atrim=duration=3"), "{chain}");
    }

    #[test]
    fn track_duration_is_expressed_in_source_time_for_sped_up_clips() {
        let mut fast = input(3.0);
        fast.speed = 2.0;
        let chain = audio_chain(&fast, 1, "a0");
        assert!(chain.contains("atrim=duration=6"), "{chain}");
        assert!(chain.contains("atempo=2"), "{chain}");
    }

    #[test]
    fn fade_in_is_applied_before_the_timeline_delay() {
        let mut track = input(5.0);
        track.start_time = 3.0;
        track.fade_in = 2.0;
        track.fade_out = 1.0;
        let chain = audio_chain(&track, 1, "a0");
        let fade_in = chain.find("afade=t=in:st=0:d=2").expect(&chain);
        let delay = chain.find("adelay=3000:all=1").expect(&chain);
        assert!(fade_in < delay, "le fondu doit précéder adelay: {chain}");
        assert!(chain.contains("afade=t=out:st=4:d=1"), "{chain}");
    }

    #[test]
    fn looping_restarts_from_the_in_point_not_the_start_of_the_file() {
        let mut looping = input(10.0);
        looping.loop_audio = true;
        looping.offset = 2.0;
        looping.source_duration = Some(5.0);
        let chain = audio_chain(&looping, 1, "a0");
        assert!(chain.contains("atrim=start=2"), "{chain}");
        assert!(chain.contains("aloop=loop=-1:size=144000"), "{chain}");
        let args = encoder_args(&spec(&[looping], Path::new("/tmp/o")));
        assert!(!args.contains(&"-stream_loop".to_string()));
        assert!(!args.contains(&"-ss".to_string()));
    }

    #[test]
    fn looping_without_a_known_source_duration_falls_back_to_stream_loop() {
        let mut looping = input(10.0);
        looping.loop_audio = true;
        let args = encoder_args(&spec(&[looping], Path::new("/tmp/o")));
        assert!(args.windows(2).any(|w| w == ["-stream_loop", "-1"]));
    }

    #[test]
    fn equal_power_fades_use_the_quarter_sine_curve() {
        let mut track = input(10.0);
        track.fade_in = 1.0;
        track.fade_out = 2.0;
        assert!(audio_chain(&track, 1, "a0").contains("afade=t=in:st=0:d=1:curve=tri"));
        track.fade_curve = FadeCurve::EqualPower;
        let chain = audio_chain(&track, 1, "a0");
        assert!(chain.contains("afade=t=in:st=0:d=1:curve=qsin"), "{chain}");
        assert!(chain.contains("afade=t=out:st=8:d=2:curve=qsin"), "{chain}");
    }

    #[test]
    fn the_filter_runs_after_the_speed_change_and_before_the_fades() {
        let mut track = input(10.0);
        track.speed = 2.0;
        track.fade_in = 1.0;
        track.filter = Some(AudioFilter {
            kind: scene_core::model::AudioFilterKind::LowPass,
            frequency: 800.0,
            slope: 24,
            q: 0.707,
        });
        let chain = audio_chain(&track, 1, "a0");
        let tempo = chain.find("atempo").expect(&chain);
        let filter = chain.find("lowpass=f=800").expect(&chain);
        let fade = chain.find("afade").expect(&chain);
        assert!(tempo < filter && filter < fade, "{chain}");
        assert_eq!(chain.matches("lowpass").count(), 2, "24 dB/oct = 2 biquads");
    }

    #[test]
    fn audio_export_args_describe_a_video_less_mix() {
        let tracks = [input(4.0), input(2.0)];
        let spec = AudioExportSpec {
            audio: &tracks,
            duration: 6.0,
            format: AudioFormat::Wav16,
            normalize: None,
            title: "Mon projet",
            output_path: Path::new("/tmp/o"),
        };
        let args = audio_export_args(&spec);
        let graph = args
            .windows(2)
            .find(|w| w[0] == "-filter_complex")
            .map(|w| w[1].clone())
            .unwrap();
        // Les entrées audio commencent à l'index 0 (pas de flux vidéo sur stdin).
        assert!(graph.starts_with("[0:a]"), "{graph}");
        assert!(graph.contains("[1:a]"), "{graph}");
        assert!(graph.contains("dither_method=triangular[aout]"), "{graph}");
        assert!(!args.iter().any(|a| a == "pipe:0" || a == "[vout]"));
        assert!(args
            .windows(2)
            .any(|w| w == ["-metadata", "title=Mon projet"]));
        assert!(args.windows(2).any(|w| w == ["-f", "wav"]));
        assert!(args.windows(2).any(|w| w == ["-c:a", "pcm_s16le"]));
    }

    // --- Intégration : vraie exécution de ffmpeg ---------------------------------------------

    fn ffmpeg_available() -> bool {
        Command::new(ffmpeg_binary())
            .arg("-version")
            .output()
            .is_ok()
            && Command::new(ffprobe_binary())
                .arg("-version")
                .output()
                .is_ok()
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "letest-ff-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_tone(dir: &Path, name: &str, seconds: u32) -> PathBuf {
        let path = dir.join(name);
        let status = Command::new(ffmpeg_binary())
            .args(["-y", "-v", "error", "-f", "lavfi", "-i"])
            .arg(format!("sine=frequency=440:duration={seconds}"))
            .arg(&path)
            .status()
            .unwrap();
        assert!(status.success());
        path
    }

    /// Encode `seconds` de frames noires avec les pistes données et retourne le chemin de sortie.
    fn encode(dir: &Path, audio: &[AudioMixInput], seconds: u32) -> PathBuf {
        let out = dir.join("out.mp4");
        let mut spec = spec(audio, &out);
        spec.duration = seconds as f64;
        let mut encoder = VideoEncoder::start(&spec).unwrap();
        let frame = vec![0u8; 64 * 64 * 4];
        for _ in 0..(seconds * 10) {
            encoder.write_frame(&frame).unwrap();
        }
        encoder.finish().unwrap();
        out
    }

    fn probe_duration(path: &Path, stream: Option<&str>) -> f64 {
        let mut args = vec!["-v", "error"];
        if let Some(s) = stream {
            args.extend(["-select_streams", s]);
        }
        args.extend(["-show_entries", "stream=duration", "-of", "csv=p=0"]);
        let out = ffprobe(&args, path).unwrap();
        out.lines().next().unwrap().trim().parse().unwrap()
    }

    #[test]
    fn short_audio_does_not_truncate_the_exported_video() {
        if !ffmpeg_available() {
            return;
        }
        let dir = temp_dir("short");
        let tone = make_tone(&dir, "short.wav", 2);
        let mut track = input(2.0);
        track.path = tone;
        let out = encode(&dir, &[track], 6);
        assert!((probe_duration(&out, Some("v:0")) - 6.0).abs() < 0.2);
        assert!((media_duration(&out).unwrap() - 6.0).abs() < 0.2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn first_short_track_does_not_end_the_mix() {
        if !ffmpeg_available() {
            return;
        }
        let dir = temp_dir("first");
        let sfx = make_tone(&dir, "sfx.wav", 1);
        let music = make_tone(&dir, "music.wav", 8);
        let mut a = input(1.0);
        a.path = sfx;
        let mut b = input(8.0);
        b.path = music;
        let out = encode(&dir, &[a, b], 6);
        assert!((media_duration(&out).unwrap() - 6.0).abs() < 0.2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn track_duration_cuts_the_source() {
        if !ffmpeg_available() {
            return;
        }
        let dir = temp_dir("cut");
        let long = make_tone(&dir, "long.wav", 8);
        let mut track = input(3.0);
        track.path = long;
        let out = encode(&dir, &[track], 6);
        // Le flux audio est complété par du silence jusqu'à la durée du projet : on mesure donc
        // le volume après la fin de la piste (3 s) plutôt que la durée du flux.
        let silent = Command::new(ffmpeg_binary())
            .args(["-v", "info", "-ss", "4", "-t", "1", "-i"])
            .arg(&out)
            .args(["-af", "volumedetect", "-vn", "-f", "null", "-"])
            .output()
            .unwrap();
        let log = String::from_utf8_lossy(&silent.stderr);
        assert!(
            log.contains("max_volume: -91") || log.contains("max_volume: -inf"),
            "la piste doit être muette après 3 s : {log}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn max_volume(path: &Path, start: f64, length: f64) -> f64 {
        let out = Command::new(ffmpeg_binary())
            .args(["-v", "info", "-ss"])
            .arg(start.to_string())
            .args(["-t"])
            .arg(length.to_string())
            .arg("-i")
            .arg(path)
            .args(["-af", "volumedetect", "-vn", "-f", "null", "-"])
            .output()
            .unwrap();
        let log = String::from_utf8_lossy(&out.stderr).into_owned();
        log.lines()
            .find_map(|l| l.split("max_volume:").nth(1))
            .and_then(|v| v.trim().trim_end_matches(" dB").parse::<f64>().ok())
            .unwrap_or(f64::NEG_INFINITY)
    }

    #[test]
    fn fade_in_applies_where_the_track_starts() {
        if !ffmpeg_available() {
            return;
        }
        let dir = temp_dir("fade");
        let tone = make_tone(&dir, "tone.wav", 8);
        let mut track = input(5.0);
        track.path = tone;
        track.start_time = 3.0;
        track.fade_in = 2.0;
        let out = encode(&dir, &[track], 8);
        let at_start = max_volume(&out, 3.0, 0.2);
        let at_full = max_volume(&out, 5.5, 0.2);
        assert!(
            at_full - at_start > 10.0,
            "début de piste {at_start} dB, plein volume {at_full} dB"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn odd_free_output_is_a_valid_h264_mp4_with_bt709_tags() {
        if !ffmpeg_available() {
            return;
        }
        let dir = temp_dir("tags");
        let out = encode(&dir, &[], 1);
        let info = ffprobe(
            &[
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_name,pix_fmt,color_space",
                "-of",
                "csv=p=0",
            ],
            &out,
        )
        .unwrap();
        assert_eq!(info.trim(), "h264,yuv420p,bt709");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[cfg(unix)]
    fn cancelling_during_finalisation_kills_the_process_and_reports_it() {
        let child = Command::new("sleep")
            .arg("30")
            .stdin(Stdio::piped())
            .spawn()
            .unwrap();
        let pid = child.id();
        let mut child = child;
        let stdin = child.stdin.take();
        let encoder = VideoEncoder {
            child,
            stdin,
            stderr: None,
        };
        let started = std::time::Instant::now();
        let result = encoder.finish_unless(|| true);
        assert_eq!(result, Err(crate::export::CANCELLED.to_string()));
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
        assert!(!Path::new(&format!("/proc/{pid}")).exists() || cfg!(not(target_os = "linux")));
    }

    #[test]
    fn dropping_an_unfinished_encoder_kills_ffmpeg() {
        if !ffmpeg_available() {
            return;
        }
        let dir = temp_dir("drop");
        let out = dir.join("out.mp4");
        let encoder = VideoEncoder::start(&spec(&[], &out)).unwrap();
        let pid = encoder.child.id();
        drop(encoder);
        assert!(
            !Path::new(&format!("/proc/{pid}")).exists() || cfg!(not(target_os = "linux")),
            "ffmpeg ne doit pas survivre à l'encodeur"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn make_sine(dir: &Path, name: &str, hz: u32, seconds: u32) -> PathBuf {
        let path = dir.join(name);
        let status = Command::new(ffmpeg_binary())
            .args(["-y", "-v", "error", "-f", "lavfi", "-i"])
            .arg(format!("sine=frequency={hz}:duration={seconds}"))
            .arg(&path)
            .status()
            .unwrap();
        assert!(status.success());
        path
    }

    #[test]
    fn a_low_pass_removes_a_tone_above_its_cutoff_and_keeps_one_below() {
        if !ffmpeg_available() {
            return;
        }
        let dir = temp_dir("lowpass");
        let low = make_sine(&dir, "low.wav", 200, 4);
        let high = make_sine(&dir, "high.wav", 8000, 4);
        let filtered = |path: PathBuf| {
            let mut track = input(4.0);
            track.path = path;
            track.filter = Some(AudioFilter {
                kind: scene_core::model::AudioFilterKind::LowPass,
                frequency: 1000.0,
                slope: 48,
                q: 0.707,
            });
            let out = dir.join("filtered.wav");
            let spec = AudioExportSpec {
                audio: &[track],
                duration: 4.0,
                format: AudioFormat::Wav32f,
                normalize: None,
                title: "",
                output_path: &out,
            };
            run_audio_export(&spec, || false, |_| {}).unwrap();
            max_volume(&out, 1.0, 2.0)
        };
        let kept = filtered(low);
        let removed = filtered(high);
        // La source sinus de ffmpeg culmine à −18 dBFS : le passe-bas ne doit pas l'atténuer.
        assert!(kept > -19.0, "200 Hz doit passer : {kept} dB");
        assert!(removed < -60.0, "8 kHz doit être coupé : {removed} dB");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn every_audio_format_produces_a_file_with_the_right_codec_and_duration() {
        if !ffmpeg_available() {
            return;
        }
        let dir = temp_dir("formats");
        let tone = make_tone(&dir, "tone.wav", 3);
        let cases = [
            (AudioFormat::Wav16, "pcm_s16le"),
            (AudioFormat::Wav24, "pcm_s24le"),
            (AudioFormat::Wav32f, "pcm_f32le"),
            (AudioFormat::Mp3, "mp3"),
            (AudioFormat::Flac, "flac"),
            (AudioFormat::Ogg, "vorbis"),
            (AudioFormat::M4a, "aac"),
        ];
        for (format, codec) in cases {
            let mut track = input(3.0);
            track.path = tone.clone();
            let out = dir.join(format!("out-{codec}.{}", format.extension()));
            let spec = AudioExportSpec {
                audio: &[track],
                duration: 5.0,
                format,
                normalize: None,
                title: "Titre",
                output_path: &out,
            };
            run_audio_export(&spec, || false, |_| {}).unwrap_or_else(|e| panic!("{codec}: {e}"));
            let probed = ffprobe(
                &[
                    "-v",
                    "error",
                    "-select_streams",
                    "a:0",
                    "-show_entries",
                    "stream=codec_name",
                    "-of",
                    "csv=p=0",
                ],
                &out,
            )
            .unwrap();
            assert_eq!(probed.trim(), codec, "{format:?}");
            // La piste (3 s) est complétée par du silence jusqu'à la durée demandée (5 s).
            let duration = media_duration(&out).unwrap();
            assert!((duration - 5.0).abs() < 0.3, "{codec} : {duration} s");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_mix_that_adds_up_past_full_scale_is_limited_instead_of_clipped() {
        if !ffmpeg_available() {
            return;
        }
        let dir = temp_dir("limiter");
        // Deux sons forts (≈ −1 dBFS chacun) : leur somme dépasse la pleine échelle de ≈ 5 dB.
        let loud = |name: &str, hz: u32| {
            let path = dir.join(name);
            let status = Command::new(ffmpeg_binary())
                .args(["-y", "-v", "error", "-f", "lavfi", "-i"])
                .arg(format!("sine=frequency={hz}:duration=3,volume=7"))
                .arg(&path)
                .status()
                .unwrap();
            assert!(status.success());
            path
        };
        let mut a = input(3.0);
        a.path = loud("a.wav", 440);
        let mut b = input(3.0);
        b.path = loud("b.wav", 660);
        let out = dir.join("mix.wav");
        let spec = AudioExportSpec {
            audio: &[a, b],
            duration: 3.0,
            // En flottant, un dépassement reste visible au lieu d'être écrêté à 0 dB.
            format: AudioFormat::Wav32f,
            normalize: None,
            title: "",
            output_path: &out,
        };
        run_audio_export(&spec, || false, |_| {}).unwrap();
        let log = Command::new(ffmpeg_binary())
            .args(["-hide_banner", "-nostats", "-i"])
            .arg(&out)
            .args(["-af", "astats=measure_perchannel=none", "-f", "null", "-"])
            .output()
            .unwrap();
        let peak: f64 = String::from_utf8_lossy(&log.stderr)
            .lines()
            .find_map(|l| l.split("Peak level dB:").nth(1))
            .and_then(|v| v.trim().parse().ok())
            .expect("astats peak");
        assert!(
            (-1.6..=-0.9).contains(&peak),
            "crête attendue autour de −1 dBFS : {peak}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_limiter_neither_raises_nor_delays_a_quiet_track() {
        if !ffmpeg_available() {
            return;
        }
        let dir = temp_dir("limiter-quiet");
        let tone = make_tone(&dir, "tone.wav", 2);
        let mut track = input(2.0);
        track.path = tone;
        track.start_time = 1.0;
        let out = dir.join("mix.wav");
        let spec = AudioExportSpec {
            audio: &[track],
            duration: 4.0,
            format: AudioFormat::Wav32f,
            normalize: None,
            title: "",
            output_path: &out,
        };
        run_audio_export(&spec, || false, |_| {}).unwrap();
        // La sinusoïde de ffmpeg culmine à −18 dBFS : elle sort au même niveau, à sa place.
        assert!((max_volume(&out, 1.5, 1.0) + 18.1).abs() < 0.5);
        assert!(max_volume(&out, 0.0, 0.99) < -80.0);
        assert!(max_volume(&out, 1.0, 0.01) > -30.0);
        assert!(max_volume(&out, 3.01, 0.9) < -80.0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_mix_is_brought_to_the_loudness_target() {
        if !ffmpeg_available() {
            return;
        }
        let dir = temp_dir("loudness");
        let tone = make_tone(&dir, "tone.wav", 8);
        let tracks = || {
            let mut track = input(8.0);
            track.path = tone.clone();
            [track]
        };
        let normalize = measure_mix(&tracks(), 8.0, -14.0, || false)
            .unwrap()
            .expect("le son est assez fort pour être corrigé");
        let out = dir.join("mix.wav");
        let spec = AudioExportSpec {
            audio: &tracks(),
            duration: 8.0,
            format: AudioFormat::Wav24,
            normalize: Some(&normalize),
            title: "",
            output_path: &out,
        };
        run_audio_export(&spec, || false, |_| {}).unwrap();

        let log = Command::new(ffmpeg_binary())
            .args(["-hide_banner", "-nostats", "-i"])
            .arg(&out)
            .args(["-af", "ebur128", "-f", "null", "-"])
            .output()
            .unwrap();
        let log = String::from_utf8_lossy(&log.stderr).into_owned();
        let loudness: f64 = log
            .rsplit("I:")
            .next()
            .and_then(|v| v.split_whitespace().next()?.parse().ok())
            .expect("mesure ebur128");
        assert!((loudness + 14.0).abs() < 0.7, "{loudness} LUFS");
        let rate = ffprobe(
            &[
                "-v",
                "error",
                "-show_entries",
                "stream=sample_rate",
                "-of",
                "csv=p=0",
            ],
            &out,
        )
        .unwrap();
        assert_eq!(rate.trim(), "48000");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_nearly_silent_mix_is_not_amplified() {
        if !ffmpeg_available() {
            return;
        }
        let dir = temp_dir("loudness-quiet");
        let mut track = input(4.0);
        track.path = make_tone(&dir, "tone.wav", 4);
        track.volume = 0.01;
        assert_eq!(measure_mix(&[track], 4.0, -14.0, || false), Ok(None));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Niveau RMS (dB) de `path` entre `from` et `from + 1` s, autour de 3 kHz (la « musique »).
    fn music_level(path: &Path, from: u32) -> f64 {
        let log = Command::new(ffmpeg_binary())
            .args([
                "-hide_banner",
                "-nostats",
                "-ss",
                &from.to_string(),
                "-t",
                "1",
                "-i",
            ])
            .arg(path)
            .args([
                "-af",
                "highpass=f=2000:p=2,highpass=f=2000:p=2,astats",
                "-f",
                "null",
                "-",
            ])
            .output()
            .unwrap();
        String::from_utf8_lossy(&log.stderr)
            .rsplit("RMS level dB:")
            .next()
            .and_then(|v| v.split_whitespace().next()?.parse().ok())
            .expect("mesure astats")
    }

    fn tone_at(dir: &Path, name: &str, frequency: u32, seconds: u32) -> PathBuf {
        let path = dir.join(name);
        let ok = Command::new(ffmpeg_binary())
            .args(["-y", "-v", "error", "-f", "lavfi", "-i"])
            .arg(format!(
                "sine=frequency={frequency}:duration={seconds}:sample_rate=44100"
            ))
            .args(["-af", "volume=3"])
            .arg(&path)
            .status()
            .unwrap()
            .success();
        assert!(ok);
        path
    }

    #[test]
    fn the_music_drops_by_the_chosen_amount_only_while_the_voice_speaks() {
        if !ffmpeg_available() {
            return;
        }
        let dir = temp_dir("ducking");
        // La « musique » dure 9 s ; la « voix » parle de 3 à 5 s.
        let mut music = input(9.0);
        music.path = tone_at(&dir, "music.wav", 6000, 9);
        music.volume = 0.5;
        music.duck_db = 12.0;
        let mut voice = input(2.0);
        voice.path = tone_at(&dir, "voice.wav", 200, 2);
        voice.start_time = 3.0;
        let tracks = [music, voice];
        let out = dir.join("mix.wav");
        let spec = AudioExportSpec {
            audio: &tracks,
            duration: 9.0,
            format: AudioFormat::Wav24,
            normalize: None,
            title: "",
            output_path: &out,
        };
        run_audio_export(&spec, || false, |_| {}).unwrap();

        let before = music_level(&out, 1);
        let during = music_level(&out, 3);
        let after = music_level(&out, 7);
        assert!((before - during - 12.0).abs() < 1.5, "{before} → {during}");
        assert!((before - after).abs() < 1.0, "{before} → {after}");
        assert!((media_duration(&out).unwrap() - 9.0).abs() < 0.1);

        let ranges = voice_ranges(&tracks[1..], 9.0).unwrap();
        assert_eq!(ranges.len(), 1, "{ranges:?}");
        assert!(
            (ranges[0].0 - 3.0).abs() < 0.1 && (ranges[0].1 - 5.0).abs() < 0.1,
            "{ranges:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_ducked_track_alone_is_left_as_it_is() {
        let mut only = input(4.0);
        only.duck_db = 12.0;
        let graph = audio_mix_graph(&[only], 0, 4.0, MixEnd::default());
        assert!(!graph.contains("sidechaingate"), "{graph}");
    }

    #[test]
    fn a_cancelled_audio_export_kills_ffmpeg_and_reports_the_cancellation() {
        if !ffmpeg_available() {
            return;
        }
        let dir = temp_dir("cancel-audio");
        let tone = make_tone(&dir, "tone.wav", 60);
        let mut track = input(60.0);
        track.path = tone;
        let out = dir.join("never.wav");
        let spec = AudioExportSpec {
            audio: &[track],
            duration: 60.0,
            format: AudioFormat::Wav16,
            normalize: None,
            title: "",
            output_path: &out,
        };
        let err = run_audio_export(&spec, || true, |_| {}).unwrap_err();
        assert_eq!(err, crate::export::CANCELLED);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
