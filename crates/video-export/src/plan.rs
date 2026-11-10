//! Les pièces pures de l'export : validation des options, graphe de filtres en une seule passe,
//! réglages d'encodeur par format, stabilisation, progression.

use crate::atempo::clamp_atempo;
use crate::video_filters::{Crop, Reframe, ASPECTS, REFRAME_MODES};
use serde::Deserialize;

pub const FORMATS: [&str; 5] = ["mp4", "mov", "webm", "avi", "gif"];
pub const QUALITIES: [&str; 3] = ["high", "balanced", "small"];
pub const STABILIZE_LEVELS: [&str; 4] = ["off", "light", "normal", "strong"];
pub const HARDWARE_ENCODERS: [&str; 4] = ["videotoolbox", "nvenc", "qsv", "vaapi"];
pub const ANIMATIONS: [&str; 7] = [
    "word-pop",
    "word-bounce",
    "word-highlight",
    "rainbow",
    "sentence-fade",
    "sentence-slide",
    "typewriter",
];
pub const POSITIONS: [&str; 3] = ["top", "middle", "bottom"];
pub const MAX_CUES: usize = 50_000;

// ─── Options reçues de l'interface ────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawCrop {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawReframe {
    pub aspect: String,
    pub mode: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Cue {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleStyle {
    pub font_family: String,
    pub font_size: f64,
    pub color: String,
    pub outline_color: String,
    pub outline_width: f64,
    pub background_color: String,
    pub background_opacity: f64,
    pub position: String,
    pub accent_color: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawSubtitles {
    pub cues: Vec<Cue>,
    pub style: SubtitleStyle,
    pub animation: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawExportOptions {
    pub input_path: String,
    pub output_path: String,
    pub format: String,
    #[serde(default)]
    pub segments: Vec<Segment>,
    pub crop: Option<RawCrop>,
    pub reframe: Option<RawReframe>,
    pub filter: Option<String>,
    pub speed: Option<f64>,
    pub rotation: Option<f64>,
    pub straighten: Option<f64>,
    pub perspective_h: Option<f64>,
    pub perspective_v: Option<f64>,
    pub muted: Option<bool>,
    pub subtitles: Option<RawSubtitles>,
    pub quality: Option<String>,
    pub resolution: Option<f64>,
    pub stabilize: Option<String>,
    pub hardware: Option<String>,
    pub gif_width: Option<f64>,
    pub gif_fps: Option<f64>,
}

// ─── Options validées ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct Subtitles {
    pub cues: Vec<Cue>,
    pub style: SubtitleStyle,
    pub animation: String,
}

#[derive(Debug, Clone)]
pub struct ExportOptions {
    pub input_path: String,
    pub output_path: String,
    pub format: String,
    pub segments: Vec<Segment>,
    pub crop: Option<Crop>,
    pub reframe: Option<Reframe>,
    pub filter: String,
    pub speed: f64,
    pub rotation: f64,
    pub straighten: f64,
    pub perspective_h: f64,
    pub perspective_v: f64,
    pub muted: bool,
    pub subtitles: Option<Subtitles>,
    pub quality: String,
    pub resolution: Option<u32>,
    pub stabilize: String,
    pub hardware: Option<String>,
    pub gif_width: u32,
    pub gif_fps: u32,
}

fn fail<T>(msg: &str) -> Result<T, String> {
    Err(format!("Invalid export options: {msg}"))
}

fn num(value: Option<f64>, name: &str, min: f64, max: f64, fallback: f64) -> Result<f64, String> {
    let v = value.unwrap_or(fallback);
    if !v.is_finite() || v < min || v > max {
        return fail(&format!("{name} must be a number in [{min}, {max}]"));
    }
    Ok(v)
}

fn is_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Le nom de police se retrouve tel quel dans une ligne `Style` d'un fichier ASS.
fn is_font_name(s: &str) -> bool {
    let n = s.chars().count();
    (1..=64).contains(&n)
        && s.chars()
            .all(|c| c.is_alphanumeric() || c == ' ' || c == '_' || c == '-')
}

fn validate_subtitles(raw: Option<RawSubtitles>) -> Result<Option<Subtitles>, String> {
    let Some(raw) = raw else { return Ok(None) };
    if raw.cues.len() > MAX_CUES {
        return fail("subtitles.cues");
    }
    if raw.cues.is_empty() {
        return Ok(None);
    }
    for (i, c) in raw.cues.iter().enumerate() {
        if !c.start.is_finite() || !c.end.is_finite() || c.start < 0.0 || c.end <= c.start {
            return fail(&format!("subtitles.cues[{i}]"));
        }
    }
    let s = &raw.style;
    for (key, value) in [
        ("color", &s.color),
        ("outlineColor", &s.outline_color),
        ("backgroundColor", &s.background_color),
        ("accentColor", &s.accent_color),
    ] {
        if !is_hex_color(value) {
            return fail(&format!("subtitles.style.{key}"));
        }
    }
    if !is_font_name(&s.font_family) {
        return fail("subtitles.style.fontFamily");
    }
    if !POSITIONS.contains(&s.position.as_str()) {
        return fail("subtitles.style.position");
    }
    num(
        Some(s.font_size),
        "subtitles.style.fontSize",
        0.5,
        30.0,
        0.0,
    )?;
    num(
        Some(s.outline_width),
        "subtitles.style.outlineWidth",
        0.0,
        20.0,
        0.0,
    )?;
    num(
        Some(s.background_opacity),
        "subtitles.style.backgroundOpacity",
        0.0,
        1.0,
        0.0,
    )?;
    if !ANIMATIONS.contains(&raw.animation.as_str()) {
        return fail("subtitles.animation");
    }
    Ok(Some(Subtitles {
        cues: raw.cues,
        style: raw.style,
        animation: raw.animation,
    }))
}

/// Refuse tout ce que l'interface ne devrait jamais envoyer et renvoie une copie normalisée. Ses
/// valeurs finissent dans un graphe de filtres ffmpeg et un fichier .ass, où une chaîne égarée
/// est une injection.
pub fn validate_export_options(raw: RawExportOptions) -> Result<ExportOptions, String> {
    if raw.input_path.is_empty() {
        return fail("inputPath");
    }
    if raw.output_path.is_empty() {
        return fail("outputPath");
    }
    if !FORMATS.contains(&raw.format.as_str()) {
        return fail("format");
    }
    if raw.segments.is_empty() {
        return Err("Nothing to export: every part of the video has been cut.".into());
    }
    let mut segments = raw.segments;
    for (i, s) in segments.iter().enumerate() {
        if !s.start.is_finite() || !s.end.is_finite() || s.start < 0.0 || s.end <= s.start {
            return fail(&format!("segments[{i}]"));
        }
    }
    segments.sort_by(|a, b| a.start.total_cmp(&b.start));

    let crop = match raw.crop {
        Some(c) => Some(Crop {
            x: num(Some(c.x), "crop.x", 0.0, 100_000.0, 0.0)?,
            y: num(Some(c.y), "crop.y", 0.0, 100_000.0, 0.0)?,
            w: num(Some(c.w), "crop.w", 1.0, 100_000.0, 0.0)?,
            h: num(Some(c.h), "crop.h", 1.0, 100_000.0, 0.0)?,
        }),
        None => None,
    };

    let quality = raw.quality.unwrap_or_else(|| "balanced".into());
    if !QUALITIES.contains(&quality.as_str()) {
        return fail("quality");
    }
    let stabilize = raw.stabilize.unwrap_or_else(|| "off".into());
    if !STABILIZE_LEVELS.contains(&stabilize.as_str()) {
        return fail("stabilize");
    }
    if let Some(h) = &raw.hardware {
        if !HARDWARE_ENCODERS.contains(&h.as_str()) {
            return fail("hardware");
        }
    }
    let resolution = match raw.resolution {
        Some(r) => Some(num(Some(r), "resolution", 144.0, 4320.0, 0.0)?.round() as u32),
        None => None,
    };
    let reframe = match raw.reframe {
        Some(r) => {
            if !ASPECTS.contains(&r.aspect.as_str()) {
                return fail("reframe.aspect");
            }
            if !REFRAME_MODES.contains(&r.mode.as_str()) {
                return fail("reframe.mode");
            }
            Some(Reframe {
                aspect: r.aspect,
                mode: r.mode,
            })
        }
        None => None,
    };

    Ok(ExportOptions {
        input_path: raw.input_path,
        output_path: raw.output_path,
        format: raw.format,
        segments,
        crop,
        reframe,
        filter: raw
            .filter
            .filter(|f| !f.is_empty())
            .unwrap_or_else(|| "none".into()),
        speed: num(raw.speed, "speed", 0.25, 4.0, 1.0)?,
        rotation: num(raw.rotation, "rotation", -360.0, 360.0, 0.0)?,
        straighten: num(raw.straighten, "straighten", -45.0, 45.0, 0.0)?,
        perspective_h: num(raw.perspective_h, "perspectiveH", -45.0, 45.0, 0.0)?,
        perspective_v: num(raw.perspective_v, "perspectiveV", -45.0, 45.0, 0.0)?,
        muted: raw.muted == Some(true),
        subtitles: validate_subtitles(raw.subtitles)?,
        quality,
        resolution,
        stabilize,
        hardware: raw.hardware,
        gif_width: num(raw.gif_width, "gifWidth", 64.0, 1920.0, 480.0)?.round() as u32,
        gif_fps: num(raw.gif_fps, "gifFps", 1.0, 60.0, 15.0)?.round() as u32,
    })
}

/// Ajoute `.format` sauf si le chemin se termine déjà ainsi.
pub fn ensure_extension(path: &str, format: &str) -> String {
    if path.to_lowercase().ends_with(&format!(".{format}")) {
        path.to_string()
    } else {
        format!("{path}.{format}")
    }
}

/// Durée de la vidéo exportée : les parties conservées, jouées à `speed`.
pub fn expected_duration(segments: &[Segment], speed: f64) -> f64 {
    segments.iter().map(|s| s.end - s.start).sum::<f64>() / speed
}

// ─── Encodeurs ────────────────────────────────────────────────────────────────

struct Quality {
    x264: u32,
    preset: &'static str,
    vp9: u32,
    aac: &'static str,
    gif_colors: u32,
    gif_dither: &'static str,
    vt_q: u32,
    nv_cq: u32,
    qsv_q: u32,
    vaapi_qp: u32,
}

/// Réglages par niveau de qualité. Les échelles de CRF diffèrent selon le codec ; la palette GIF
/// échange couleurs et fidélité du dithering contre des fichiers plus petits.
fn quality(level: &str) -> Quality {
    match level {
        "high" => Quality {
            x264: 18,
            preset: "fast",
            vp9: 24,
            aac: "256k",
            gif_colors: 256,
            gif_dither: "sierra2_4a",
            vt_q: 75,
            nv_cq: 19,
            qsv_q: 20,
            vaapi_qp: 20,
        },
        "small" => Quality {
            x264: 28,
            preset: "medium",
            vp9: 37,
            aac: "128k",
            gif_colors: 128,
            gif_dither: "bayer:bayer_scale=5",
            vt_q: 45,
            nv_cq: 30,
            qsv_q: 31,
            vaapi_qp: 31,
        },
        _ => Quality {
            x264: 22,
            preset: "fast",
            vp9: 30,
            aac: "192k",
            gif_colors: 256,
            gif_dither: "bayer:bayer_scale=3",
            vt_q: 60,
            nv_cq: 24,
            qsv_q: 25,
            vaapi_qp: 25,
        },
    }
}

/// Le pipeline de palette GIF. `stats_mode=diff` pèse la palette vers ce qui bouge et
/// `diff_mode=rectangle` ne ré-encode que la zone modifiée : fichiers plus petits. La largeur
/// est plafonnée à celle de la source (jamais d'agrandissement).
pub fn gif_tail(width: u32, fps: u32, level: &str) -> String {
    let q = quality(level);
    format!(
        "fps={fps},scale='min({width},iw)':-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors={}:stats_mode=diff[p];[s1][p]paletteuse=dither={}:diff_mode=rectangle",
        q.gif_colors, q.gif_dither
    )
}

#[derive(Debug, Clone, PartialEq)]
pub struct HardwareProfile {
    pub input_args: Vec<String>,
    pub filter: String,
    pub args: Vec<String>,
}

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

/// Profil d'encodeur matériel : `input_args` avant l'entrée, `filter` ajouté à la chaîne vidéo
/// (VAAPI veut des images envoyées au GPU).
pub fn hardware_profile(id: &str, level: &str) -> Result<HardwareProfile, String> {
    let q = quality(level);
    Ok(match id {
        "videotoolbox" => HardwareProfile {
            input_args: vec![],
            filter: String::new(),
            args: strings(&[
                "-c:v",
                "h264_videotoolbox",
                "-q:v",
                &q.vt_q.to_string(),
                "-pix_fmt",
                "yuv420p",
            ]),
        },
        "nvenc" => HardwareProfile {
            input_args: vec![],
            filter: String::new(),
            args: strings(&[
                "-c:v",
                "h264_nvenc",
                "-preset",
                "p5",
                "-rc",
                "vbr",
                "-cq",
                &q.nv_cq.to_string(),
                "-b:v",
                "0",
                "-pix_fmt",
                "yuv420p",
            ]),
        },
        "qsv" => HardwareProfile {
            input_args: vec![],
            filter: "format=nv12".into(),
            args: strings(&[
                "-c:v",
                "h264_qsv",
                "-global_quality",
                &q.qsv_q.to_string(),
                "-preset",
                "medium",
            ]),
        },
        "vaapi" => HardwareProfile {
            input_args: strings(&["-vaapi_device", "/dev/dri/renderD128"]),
            filter: "format=nv12,hwupload".into(),
            args: strings(&["-c:v", "h264_vaapi", "-qp", &q.vaapi_qp.to_string()]),
        },
        other => return Err(format!("Unknown hardware encoder: {other}")),
    })
}

/// Force de stabilisation → paramètres vidstab (plus haut = plus lisse, plus de rognage).
fn stabilize_params(level: &str) -> (u32, u32) {
    match level {
        "light" => (4, 8),
        "strong" => (8, 30),
        _ => (6, 15),
    }
}

/// Échappe un chemin pour un filtre ffmpeg : deux couches, la valeur d'option (`\`, `:`, `'`) puis
/// le graphe qui la porte (`\`, `'`, `,`, `;`, crochets, espaces). Des guillemets ne suffiraient
/// pas : dans '…' un antislash ne peut pas échapper une apostrophe.
pub fn escape_for_ffmpeg_filter(p: &str) -> String {
    let mut option = String::new();
    for c in p.chars() {
        if matches!(c, '\\' | '\'' | ':') {
            option.push('\\');
        }
        option.push(c);
    }
    let mut out = String::new();
    for c in option.chars() {
        if matches!(c, '\\' | '\'' | ',' | ';' | '[' | ']' | ' ') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Passe 1 de la stabilisation : les segments conservés, joints, analysés par `vidstabdetect` qui
/// écrit le mouvement dans `trf`. Vidéo seule. `accuracy=15` est la valeur par défaut de vid.stab :
/// le ffmpeg macOS écrit à 9 des données qu'il ne sait pas relire.
pub fn build_detect_graph(segments: &[Segment], trf: &str, level: &str) -> String {
    let (shakiness, _) = stabilize_params(level);
    let mut parts: Vec<String> = segments
        .iter()
        .enumerate()
        .map(|(i, s)| {
            format!(
                "[0:v]trim=start={:.3}:end={:.3},setpts=PTS-STARTPTS[v{i}]",
                s.start, s.end
            )
        })
        .collect();
    let inputs: String = (0..segments.len()).map(|i| format!("[v{i}]")).collect();
    parts.push(format!("{inputs}concat=n={}:v=1:a=0[vc]", segments.len()));
    parts.push(format!(
        "[vc]vidstabdetect=shakiness={shakiness}:accuracy=15:result={}[vo]",
        escape_for_ffmpeg_filter(trf)
    ));
    parts.join(";")
}

/// Le filtre qui applique le mouvement mesuré ; il passe en premier, sur les images d'origine.
pub fn stabilize_filter(trf: &str, level: &str) -> String {
    let (_, smoothing) = stabilize_params(level);
    // optzoom=1 choisit un zoom statique qui cache l'essentiel des bords noirs mobiles.
    format!(
        "vidstabtransform=input={}:smoothing={smoothing}:optzoom=1:interpol=bicubic",
        escape_for_ffmpeg_filter(trf)
    )
}

pub struct FilterComplexParams<'a> {
    pub segments: &'a [Segment],
    pub video_chain: &'a [String],
    pub speed: f64,
    pub with_audio: bool,
    pub gif: Option<&'a str>,
    pub stabilize: Option<&'a str>,
    pub hardware_filter: &'a str,
}

/// Un seul graphe pour tout l'export : découpe de chaque segment conservé, concaténation,
/// stabilisation, chaîne géométrie / couleur / vitesse et, pour un GIF, la palette. Une seule
/// passe évite l'aller-retour encodage → concat → ré-encodage (deux générations de qualité, un
/// bref silence à chaque jonction).
pub fn build_filter_complex(p: &FilterComplexParams) -> String {
    let mut parts = Vec::new();
    for (i, s) in p.segments.iter().enumerate() {
        let range = format!("start={:.3}:end={:.3}", s.start, s.end);
        parts.push(format!("[0:v]trim={range},setpts=PTS-STARTPTS[v{i}]"));
        if p.with_audio {
            parts.push(format!("[0:a]atrim={range},asetpts=PTS-STARTPTS[a{i}]"));
        }
    }
    let inputs: String = (0..p.segments.len())
        .map(|i| {
            if p.with_audio {
                format!("[v{i}][a{i}]")
            } else {
                format!("[v{i}]")
            }
        })
        .collect();
    parts.push(format!(
        "{inputs}concat=n={}:v=1:a={}[vc]{}",
        p.segments.len(),
        if p.with_audio { 1 } else { 0 },
        if p.with_audio { "[ac]" } else { "" }
    ));

    let mut chain: Vec<&str> = Vec::new();
    if let Some(s) = p.stabilize {
        chain.push(s);
    }
    chain.extend(p.video_chain.iter().map(String::as_str));
    let mut chain = chain.join(",");
    if let Some(gif) = p.gif {
        chain = format!("{chain},{gif}");
    } else if !p.hardware_filter.is_empty() {
        chain = format!("{chain},{}", p.hardware_filter);
    }
    parts.push(format!("[vc]{chain}[vout]"));
    if p.with_audio {
        parts.push(if p.speed == 1.0 {
            "[ac]anull[aout]".into()
        } else {
            format!("[ac]atempo={}[aout]", clamp_atempo(p.speed))
        });
    }
    parts.join(";")
}

fn video_encoder(format: &str, level: &str, hardware: Option<&str>) -> Vec<String> {
    let q = quality(level);
    match format {
        "gif" => vec![],
        "webm" => strings(&[
            "-c:v",
            "libvpx-vp9",
            "-crf",
            &q.vp9.to_string(),
            "-b:v",
            "0",
            "-row-mt",
            "1",
            "-deadline",
            "good",
            "-cpu-used",
            "4",
            "-pix_fmt",
            "yuv420p",
        ]),
        _ => match hardware {
            Some(h) => hardware_profile(h, level)
                .map(|p| p.args)
                .unwrap_or_default(),
            None => strings(&[
                "-c:v",
                "libx264",
                "-preset",
                q.preset,
                "-crf",
                &q.x264.to_string(),
                "-pix_fmt",
                "yuv420p",
            ]),
        },
    }
}

fn audio_encoder(format: &str, level: &str, copy: bool) -> Vec<String> {
    let q = quality(level);
    match format {
        "gif" => vec![],
        "webm" => strings(&["-c:a", "libopus", "-b:a", "128k"]),
        _ if copy => strings(&["-c:a", "copy"]),
        "avi" => strings(&["-c:a", "libmp3lame", "-b:a", q.aac]),
        _ => strings(&["-c:a", "aac", "-b:a", q.aac]),
    }
}

fn faststart(format: &str) -> Vec<String> {
    if format == "mp4" || format == "mov" {
        strings(&["-movflags", "+faststart"])
    } else {
        vec![]
    }
}

/// Le matériel ne vaut que pour les conteneurs H.264 (le webm est en VP9, le gif n'a pas de codec).
fn uses_hardware(format: &str, hardware: Option<&str>) -> bool {
    hardware.is_some() && matches!(format, "mp4" | "mov" | "avi")
}

/// Réglages de la passe (unique, ou première) qui écrit le fichier final.
pub fn final_options(format: &str, level: &str, hardware: Option<&str>) -> Vec<String> {
    let hw = if uses_hardware(format, hardware) {
        hardware
    } else {
        None
    };
    [
        video_encoder(format, level, hw),
        audio_encoder(format, level, false),
        faststart(format),
    ]
    .concat()
}

/// Arguments d'entrée supplémentaires et filtre de fin de chaîne que l'encodage final demande.
pub fn hardware_setup(format: &str, hardware: Option<&str>, level: &str) -> (Vec<String>, String) {
    if !uses_hardware(format, hardware) {
        return (vec![], String::new());
    }
    match hardware_profile(hardware.unwrap_or_default(), level) {
        Ok(p) => (p.input_args, p.filter),
        Err(_) => (vec![], String::new()),
    }
}

/// Intermédiaire de haute qualité, seulement quand il faut graver des sous-titres.
pub fn intermediate_options() -> Vec<String> {
    strings(&[
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a",
        "aac", "-b:a", "192k",
    ])
}

pub struct BurnOptions {
    pub video_filter: String,
    pub input_args: Vec<String>,
    pub options: Vec<String>,
}

/// Seconde passe : grave les sous-titres dans l'intermédiaire et encode vers `format`.
pub fn burn_options(
    format: &str,
    subtitles_filter: &str,
    level: &str,
    hardware: Option<&str>,
    gif: Option<&str>,
) -> BurnOptions {
    let hw = if uses_hardware(format, hardware) {
        hardware
    } else {
        None
    };
    let mut video_filter = subtitles_filter.to_string();
    let mut input_args = vec![];
    if format == "gif" {
        let tail = gif
            .map(str::to_string)
            .unwrap_or_else(|| gif_tail(480, 15, level));
        video_filter = format!("{subtitles_filter},{tail}");
    } else if let Some(h) = hw {
        if let Ok(p) = hardware_profile(h, level) {
            video_filter = [subtitles_filter, p.filter.as_str()]
                .iter()
                .filter(|s| !s.is_empty())
                .copied()
                .collect::<Vec<_>>()
                .join(",");
            input_args = p.input_args;
        }
    }
    BurnOptions {
        video_filter,
        input_args,
        options: [
            video_encoder(format, level, hw),
            audio_encoder(format, level, format == "mp4" || format == "mov"),
            faststart(format),
        ]
        .concat(),
    }
}

/// Répartit la progression de ffmpeg sur la barre globale : `pass_index` / `pass_count` découpent
/// la barre quand l'export demande deux passes, et le résultat ne recule jamais.
pub struct ProgressTracker {
    last: i32,
}

impl Default for ProgressTracker {
    fn default() -> Self {
        Self { last: -1 }
    }
}

impl ProgressTracker {
    /// Nouveau pourcentage à signaler (0-99), ou `None` s'il n'a pas avancé. Le 100 est gardé
    /// pour la toute fin, quand le fichier est vraiment complet.
    pub fn update(
        &mut self,
        pass_index: u32,
        pass_count: u32,
        done: f64,
        total: f64,
    ) -> Option<u32> {
        let within = if total > 0.0 {
            (done / total).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let pct = ((((pass_index as f64) + within) / pass_count as f64) * 100.0)
            .round()
            .min(99.0) as i32;
        if pct > self.last {
            self.last = pct;
            Some(pct as u32)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw() -> RawExportOptions {
        serde_json::from_value(serde_json::json!({
            "inputPath": "/in.mp4", "outputPath": "/out.mp4", "format": "mp4",
            "segments": [{"start": 5.0, "end": 8.0}, {"start": 0.0, "end": 2.0}],
        }))
        .unwrap()
    }

    fn style() -> serde_json::Value {
        serde_json::json!({
            "fontFamily": "Arial", "fontSize": 5.0, "color": "#ffffff", "outlineColor": "#000000",
            "outlineWidth": 2.0, "backgroundColor": "#000000", "backgroundOpacity": 0.5,
            "position": "bottom", "accentColor": "#ffcc00",
        })
    }

    fn with(patch: serde_json::Value) -> Result<ExportOptions, String> {
        let mut base = serde_json::to_value(serde_json::json!({
            "inputPath": "/in.mp4", "outputPath": "/out.mp4", "format": "mp4",
            "segments": [{"start": 0.0, "end": 2.0}],
        }))
        .unwrap();
        for (k, v) in patch.as_object().unwrap() {
            base[k] = v.clone();
        }
        validate_export_options(serde_json::from_value(base).unwrap())
    }

    #[test]
    fn defaults_are_filled_and_segments_sorted() {
        let o = validate_export_options(raw()).unwrap();
        assert_eq!(o.segments[0].start, 0.0);
        assert_eq!(
            (o.quality.as_str(), o.stabilize.as_str(), o.filter.as_str()),
            ("balanced", "off", "none")
        );
        assert_eq!(
            (o.speed, o.rotation, o.gif_width, o.gif_fps),
            (1.0, 0.0, 480, 15)
        );
        assert!(!o.muted && o.hardware.is_none() && o.resolution.is_none());
    }

    #[test]
    fn nothing_to_export_without_segments() {
        let mut r = raw();
        r.segments.clear();
        assert_eq!(
            validate_export_options(r).unwrap_err(),
            "Nothing to export: every part of the video has been cut."
        );
    }

    #[test]
    fn rejects_bad_paths_formats_and_segments() {
        assert!(with(serde_json::json!({"inputPath": ""})).is_err());
        assert!(with(serde_json::json!({"outputPath": ""})).is_err());
        assert!(with(serde_json::json!({"format": "mkv"})).is_err());
        assert!(with(serde_json::json!({"segments": [{"start": 3.0, "end": 3.0}]})).is_err());
        assert!(with(serde_json::json!({"segments": [{"start": -1.0, "end": 3.0}]})).is_err());
    }

    #[test]
    fn rejects_out_of_range_numbers() {
        for patch in [
            serde_json::json!({"speed": 5.0}),
            serde_json::json!({"speed": 0.1}),
            serde_json::json!({"rotation": 400.0}),
            serde_json::json!({"straighten": 50.0}),
            serde_json::json!({"perspectiveH": -46.0}),
            serde_json::json!({"gifWidth": 10.0}),
            serde_json::json!({"gifFps": 61.0}),
            serde_json::json!({"resolution": 100.0}),
            serde_json::json!({"crop": {"x": 0.0, "y": 0.0, "w": 0.0, "h": 10.0}}),
        ] {
            assert!(with(patch.clone()).is_err(), "{patch}");
        }
    }

    #[test]
    fn rejects_unknown_choices() {
        assert!(with(serde_json::json!({"quality": "ultra"})).is_err());
        assert!(with(serde_json::json!({"stabilize": "max"})).is_err());
        assert!(with(serde_json::json!({"hardware": "cuda"})).is_err());
        assert!(with(serde_json::json!({"reframe": {"aspect": "2:1", "mode": "blur"}})).is_err());
        assert!(with(serde_json::json!({"reframe": {"aspect": "9:16", "mode": "zoom"}})).is_err());
    }

    #[test]
    fn accepts_a_full_set_of_options() {
        let o = with(serde_json::json!({
            "speed": 2.0, "rotation": 90.0, "hardware": "nvenc", "resolution": 1080.4,
            "reframe": {"aspect": "9:16", "mode": "blur"}, "muted": true, "filter": "sepia",
            "crop": {"x": 1.0, "y": 2.0, "w": 100.0, "h": 50.0},
        }))
        .unwrap();
        assert_eq!(
            (o.speed, o.resolution, o.hardware.as_deref()),
            (2.0, Some(1080), Some("nvenc"))
        );
        assert!(o.muted && o.crop.is_some() && o.reframe.is_some());
        assert_eq!(o.filter, "sepia");
    }

    #[test]
    fn subtitles_are_checked_against_injection() {
        let ok = serde_json::json!({"cues": [{"start": 0.0, "end": 1.0, "text": "hi"}], "style": style(), "animation": "word-pop"});
        assert!(with(serde_json::json!({"subtitles": ok}))
            .unwrap()
            .subtitles
            .is_some());
        let mut bad_font = style();
        bad_font["fontFamily"] = "Arial,Bold\nStyle".into();
        let mut bad_color = style();
        bad_color["color"] = "red".into();
        let mut bad_pos = style();
        bad_pos["position"] = "left".into();
        for s in [bad_font, bad_color, bad_pos] {
            let sub = serde_json::json!({"cues": [{"start": 0.0, "end": 1.0, "text": "hi"}], "style": s, "animation": "word-pop"});
            assert!(with(serde_json::json!({"subtitles": sub})).is_err());
        }
        let bad_anim = serde_json::json!({"cues": [{"start": 0.0, "end": 1.0, "text": "hi"}], "style": style(), "animation": "spin"});
        assert!(with(serde_json::json!({"subtitles": bad_anim})).is_err());
        let bad_cue = serde_json::json!({"cues": [{"start": 2.0, "end": 1.0, "text": "hi"}], "style": style(), "animation": "word-pop"});
        assert!(with(serde_json::json!({"subtitles": bad_cue})).is_err());
    }

    #[test]
    fn empty_subtitles_mean_none() {
        let empty = serde_json::json!({"cues": [], "style": style(), "animation": "word-pop"});
        assert!(with(serde_json::json!({"subtitles": empty}))
            .unwrap()
            .subtitles
            .is_none());
    }

    #[test]
    fn the_extension_is_added_once() {
        assert_eq!(ensure_extension("/a/b", "mp4"), "/a/b.mp4");
        assert_eq!(ensure_extension("/a/b.MP4", "mp4"), "/a/b.MP4");
        assert_eq!(ensure_extension("/a/b.mov", "mp4"), "/a/b.mov.mp4");
    }

    #[test]
    fn the_expected_duration_follows_the_speed() {
        let segs = [
            Segment {
                start: 0.0,
                end: 2.0,
            },
            Segment {
                start: 5.0,
                end: 9.0,
            },
        ];
        assert_eq!(expected_duration(&segs, 1.0), 6.0);
        assert_eq!(expected_duration(&segs, 2.0), 3.0);
    }

    #[test]
    fn the_filter_path_is_escaped_in_two_layers() {
        assert_eq!(escape_for_ffmpeg_filter("/tmp/a b.trf"), "/tmp/a\\ b.trf");
        assert_eq!(escape_for_ffmpeg_filter("C:\\x"), "C\\\\:\\\\\\\\x");
        assert_eq!(escape_for_ffmpeg_filter("it's"), "it\\\\\\'s");
    }

    #[test]
    fn single_pass_graph_trims_every_segment_and_concats() {
        let segs = [
            Segment {
                start: 0.0,
                end: 2.0,
            },
            Segment {
                start: 5.0,
                end: 6.5,
            },
        ];
        let chain = vec!["hue=s=0".to_string()];
        let g = build_filter_complex(&FilterComplexParams {
            segments: &segs,
            video_chain: &chain,
            speed: 1.0,
            with_audio: true,
            gif: None,
            stabilize: None,
            hardware_filter: "",
        });
        assert!(g.starts_with("[0:v]trim=start=0.000:end=2.000,setpts=PTS-STARTPTS[v0];[0:a]atrim=start=0.000:end=2.000,asetpts=PTS-STARTPTS[a0];"));
        assert!(g.contains("[v0][a0][v1][a1]concat=n=2:v=1:a=1[vc][ac]"));
        assert!(g.contains("[vc]hue=s=0[vout]"));
        assert!(g.ends_with("[ac]anull[aout]"));
    }

    #[test]
    fn the_graph_has_no_audio_branch_when_muted_and_chains_atempo_when_fast() {
        let segs = [Segment {
            start: 0.0,
            end: 2.0,
        }];
        let chain: Vec<String> = vec![];
        let muted = build_filter_complex(&FilterComplexParams {
            segments: &segs,
            video_chain: &chain,
            speed: 1.0,
            with_audio: false,
            gif: None,
            stabilize: None,
            hardware_filter: "",
        });
        assert!(!muted.contains("[0:a]") && muted.contains("concat=n=1:v=1:a=0[vc];"));
        let fast = build_filter_complex(&FilterComplexParams {
            segments: &segs,
            video_chain: &chain,
            speed: 4.0,
            with_audio: true,
            gif: None,
            stabilize: None,
            hardware_filter: "",
        });
        assert!(fast.ends_with("[ac]atempo=2.0,atempo=2.0000[aout]"));
    }

    #[test]
    fn stabilisation_runs_first_and_gif_or_hardware_closes_the_chain() {
        let segs = [Segment {
            start: 0.0,
            end: 2.0,
        }];
        let chain = vec!["hue=s=0".to_string()];
        let stab = stabilize_filter("/tmp/x.trf", "normal");
        let g = build_filter_complex(&FilterComplexParams {
            segments: &segs,
            video_chain: &chain,
            speed: 1.0,
            with_audio: false,
            gif: Some("fps=15"),
            stabilize: Some(&stab),
            hardware_filter: "format=nv12",
        });
        assert!(
            g.contains(&format!("[vc]{stab},hue=s=0,fps=15[vout]")),
            "{g}"
        );
        let hw = build_filter_complex(&FilterComplexParams {
            segments: &segs,
            video_chain: &chain,
            speed: 1.0,
            with_audio: false,
            gif: None,
            stabilize: None,
            hardware_filter: "format=nv12",
        });
        assert!(hw.contains("[vc]hue=s=0,format=nv12[vout]"));
    }

    #[test]
    fn the_detect_graph_joins_the_segments_for_vidstab() {
        let segs = [
            Segment {
                start: 0.0,
                end: 2.0,
            },
            Segment {
                start: 4.0,
                end: 5.0,
            },
        ];
        let g = build_detect_graph(&segs, "/tmp/m.trf", "strong");
        assert!(g.contains("[v0][v1]concat=n=2:v=1:a=0[vc]"));
        assert!(g.ends_with("[vc]vidstabdetect=shakiness=8:accuracy=15:result=/tmp/m.trf[vo]"));
        assert!(stabilize_filter("/tmp/m.trf", "light")
            .contains("smoothing=8:optzoom=1:interpol=bicubic"));
    }

    #[test]
    fn encoders_follow_the_format() {
        let mp4 = final_options("mp4", "high", None).join(" ");
        assert!(
            mp4.contains("libx264 -preset fast -crf 18")
                && mp4.contains("-c:a aac -b:a 256k")
                && mp4.contains("+faststart")
        );
        assert!(final_options("webm", "balanced", None)
            .join(" ")
            .contains("libvpx-vp9 -crf 30"));
        assert!(final_options("avi", "small", None)
            .join(" ")
            .contains("libmp3lame -b:a 128k"));
        assert!(final_options("gif", "balanced", None).is_empty());
    }

    #[test]
    fn hardware_only_applies_to_h264_containers() {
        assert!(final_options("mp4", "balanced", Some("nvenc"))
            .join(" ")
            .contains("h264_nvenc"));
        assert!(final_options("webm", "balanced", Some("nvenc"))
            .join(" ")
            .contains("libvpx-vp9"));
        assert_eq!(
            hardware_setup("webm", Some("vaapi"), "balanced"),
            (vec![], String::new())
        );
        let (input, filter) = hardware_setup("mp4", Some("vaapi"), "balanced");
        assert_eq!(input, vec!["-vaapi_device", "/dev/dri/renderD128"]);
        assert_eq!(filter, "format=nv12,hwupload");
        assert!(hardware_profile("cuda", "balanced").is_err());
    }

    #[test]
    fn the_gif_pipeline_uses_a_diff_palette() {
        let t = gif_tail(320, 12, "small");
        assert!(t.starts_with("fps=12,scale='min(320,iw)':-1:flags=lanczos,split[s0][s1];"));
        assert!(t.contains("max_colors=128:stats_mode=diff") && t.ends_with("diff_mode=rectangle"));
    }

    #[test]
    fn the_burn_pass_copies_audio_for_mp4_and_filters_for_gif() {
        let mp4 = burn_options("mp4", "subtitles=a.ass", "balanced", None, None);
        assert_eq!(mp4.video_filter, "subtitles=a.ass");
        assert!(mp4.options.join(" ").contains("-c:a copy"));
        let gif = burn_options("gif", "subtitles=a.ass", "balanced", None, Some("fps=10"));
        assert_eq!(gif.video_filter, "subtitles=a.ass,fps=10");
        let hw = burn_options("mp4", "subtitles=a.ass", "balanced", Some("qsv"), None);
        assert_eq!(hw.video_filter, "subtitles=a.ass,format=nv12");
    }

    #[test]
    fn progress_is_sliced_per_pass_capped_below_100_and_never_goes_back() {
        let mut t = ProgressTracker::default();
        assert_eq!(t.update(0, 2, 5.0, 10.0), Some(25));
        assert_eq!(t.update(0, 2, 4.0, 10.0), None);
        assert_eq!(t.update(1, 2, 10.0, 10.0), Some(99));
        assert_eq!(t.update(1, 2, 10.0, 10.0), None);
        assert_eq!(ProgressTracker::default().update(0, 1, 1.0, 0.0), Some(0));
    }
}
