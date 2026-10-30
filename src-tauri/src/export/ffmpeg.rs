//! Pilotage de ffmpeg pour l'encodage vidéo et le mixage audio. Les binaires sont résolus via
//! `scene_core::ffmpeg_path` — PATH système par défaut, ou chemins définis par
//! `LIGHT_EDITOR_VIDZ_FFMPEG` / `LIGHT_EDITOR_VIDZ_FFPROBE`.
//!
//! Une seule instance ffmpeg encode la vidéo (frames RGBA brutes sur stdin) **et** mixe l'audio
//! (fichiers sources en entrées supplémentaires) : pas de fichier intermédiaire ni de seconde
//! passe. La sortie est écrite dans un fichier temporaire puis renommée une fois complète.

use scene_core::ffmpeg_path::{ffmpeg_binary, ffprobe_binary};
use std::io::{Read, Write};
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
    pub output_path: &'a Path,
}

/// Fréquence d'échantillonnage commune du mix (les boucles audio se calculent en échantillons).
const MIX_SAMPLE_RATE: u32 = 48_000;

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
/// étiquette `[a<n>]`. Ordre : bouclage → coupe à la durée → vitesse → fondus (dans le temps
/// local du clip) → volume → décalage sur la timeline.
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
    if input.fade_in > 0.0 {
        filters.push(format!("afade=t=in:st=0:d={}", input.fade_in));
    }
    if input.fade_out > 0.0 {
        let start = (input.duration - input.fade_out).max(0.0);
        filters.push(format!("afade=t=out:st={start}:d={}", input.fade_out));
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
    let mut labels = String::new();
    for (i, input) in spec.audio.iter().enumerate() {
        let label = format!("a{i}");
        graph.push(';');
        graph.push_str(&audio_chain(input, i + 1, &label));
        labels.push_str(&format!("[{label}]"));
    }
    // Le mix dure aussi longtemps que la piste la plus longue ; `apad` le complète par du silence
    // jusqu'à la durée du projet (`-t` coupe l'excédent).
    let mix = if spec.audio.len() == 1 {
        format!("{labels}anull")
    } else {
        format!(
            "{labels}amix=inputs={}:duration=longest:normalize=0",
            spec.audio.len()
        )
    };
    graph.push_str(&format!(";{mix},apad=whole_dur={}[aout]", spec.duration));
    (graph, true)
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

    for input in spec.audio {
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
    args.push(spec.output_path.to_string_lossy().into_owned());
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

    pub fn finish(mut self) -> Result<(), String> {
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
        assert_eq!(args.last().map(String::as_str), Some("/tmp/out.part"));
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
}
