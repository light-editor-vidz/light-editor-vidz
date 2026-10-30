//! Rendu d'une frame (image bitmap) à un instant donné, pour l'export vidéo.
//!
//! Chaque élément (texte, forme, image, vidéo) est rendu dans un calque hors-écran à sa taille,
//! puis composé sur la scène via `draw_pixmap` : rotation, skew, flou et modes de fusion sont
//! pleinement supportés. Les calques de texte et de forme sont mis en cache (une vidéo de
//! plusieurs minutes ne les recalcule que si leur contenu change). Les images sont décodées une
//! fois (pré-multipliées, avec une pyramide de réductions) ; les vidéos sont décodées en flux
//! par ffmpeg (voir `crate::video`). Les transitions de type "wipe" ne sont pas des transforms
//! affines : elles sont appliquées comme un masque de clip rectangulaire (voir `wipe_rect`).
//!
//! # Unités
//! Positions et tailles de boîte sont en % du canvas. La taille de police et l'espacement des
//! lettres sont en `cqw` (% de la largeur). Toutes les autres longueurs (épaisseur de contour,
//! pointillés, rayons d'angle, bordures, flou) sont en 1/1000e de la largeur du canvas
//! (`LENGTH_UNITS_PER_WIDTH`) : même rendu relatif quelle que soit la résolution, preview
//! comprise (`value / 10` cqw côté interface).

use crate::animate::{
    resolve_composition_transition, resolve_element_animations, resolve_image_pan,
    resolve_text_reveal, resolve_wipe, ResolvedTransform,
};
pub use crate::color::parse_css_color;
use crate::model::{
    AnimationDirection, AnimationType, BlendMode, Composition, Element, FitMode, FontStyle,
    FontWeight, Project, ShapeType, TextAlign, TextElement, TransitionType, VerticalAlign,
};
use crate::timeline::{is_element_active, resolve_active_compositions};
use crate::video::{probe_video, VideoProbe, VideoStream};
use cosmic_text::{
    Attrs, Buffer, Color as CosmicColor, Family, FontSystem, Metrics, Shaping, SwashCache, Weight,
};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, VecDeque};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use tiny_skia::{
    Color, FillRule, FilterQuality, Mask, Paint, PathBuilder, Pixmap, PixmapPaint, Rect, Transform,
};

/// Nombre d'unités de longueur par largeur de canvas (voir la doc du module).
pub const LENGTH_UNITS_PER_WIDTH: f32 = 1000.0;

/// Police par défaut des textes (celle de l'interface, embarquée) quand aucune n'est choisie.
const DEFAULT_FONT_FAMILY: &str = "Manrope";

/// Polices embarquées : celles de l'interface, pour que l'export rende la même chose que la
/// preview même si elles ne sont pas installées sur le système.
const EMBEDDED_FONTS: &[&[u8]] = &[
    include_bytes!("../fonts/manrope-400.ttf"),
    include_bytes!("../fonts/manrope-500.ttf"),
    include_bytes!("../fonts/manrope-600.ttf"),
    include_bytes!("../fonts/manrope-700.ttf"),
    include_bytes!("../fonts/manrope-800.ttf"),
    include_bytes!("../fonts/jetbrains-mono-400.ttf"),
    include_bytes!("../fonts/jetbrains-mono-500.ttf"),
    include_bytes!("../fonts/jetbrains-mono-700.ttf"),
];

/// Graisses utilisées par la preview (`font-weight`) pour « normal » et « gras ».
const WEIGHT_NORMAL: u16 = 500;
const WEIGHT_BOLD: u16 = 800;
/// Hauteur de ligne (multiplicateur de la taille de police) quand elle n'est pas réglée.
const DEFAULT_LINE_HEIGHT: f64 = 1.25;
/// Ombre de texte : décalage et flou, en fraction de la largeur du canvas (≈ 2px / 4px d'un
/// aperçu de 800px).
const SHADOW_OFFSET_FRACTION: f32 = 0.0025;
const SHADOW_BLUR_FRACTION: f32 = 0.005;
/// Largeur de bordure (unités) appliquée quand une couleur de bordure est définie sans largeur.
const DEFAULT_BORDER_WIDTH: f64 = 2.0;
/// Nombre maximal de calques (texte/forme) conservés en cache.
const LAYER_CACHE_CAPACITY: usize = 48;
/// Nombre maximal de frames d'un GIF animé décodées (au-delà, les suivantes sont ignorées).
const MAX_GIF_FRAMES: usize = 600;

/// Géométrie et style communs de dessin d'un élément (coordonnées canvas, en pixels).
#[derive(Clone, Copy)]
struct DrawCtx {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    opacity: f32,
    /// Écart-type du flou gaussien, en pixels de sortie.
    blur_px: f32,
    transform: Transform,
    blend_mode: Option<BlendMode>,
    /// Pixels par unité de longueur (`width / LENGTH_UNITS_PER_WIDTH`).
    unit: f32,
}

impl DrawCtx {
    /// Marge (px) ajoutée autour de la boîte dans les calques pour que le halo du flou ne soit
    /// pas coupé.
    fn halo(&self) -> f32 {
        (self.blur_px * 3.0).ceil().max(0.0)
    }
}

/// Style des bords d'une image/vidéo.
#[derive(Clone, Copy, Default)]
struct MediaStyle<'a> {
    corner_radius: Option<f64>,
    border_color: Option<&'a str>,
    border_width: Option<f64>,
    background: Option<&'a str>,
}

impl MediaStyle<'_> {
    fn border_px(&self, unit: f32) -> f32 {
        match self.border_color {
            Some(_) => (self.border_width.unwrap_or(DEFAULT_BORDER_WIDTH) as f32 * unit).max(0.0),
            None => 0.0,
        }
    }
}

/// Calque pré-rendu (texte/forme). `origin` = position du coin haut-gauche du calque par
/// rapport au coin haut-gauche de la boîte de l'élément (négatif quand le calque déborde).
struct Layer {
    pixmap: Pixmap,
    origin: (f32, f32),
}

/// Cache borné (FIFO) de calques, clé = empreinte de toutes les entrées du rendu.
#[derive(Default)]
struct LayerCache {
    map: HashMap<u64, Option<Rc<Layer>>>,
    order: VecDeque<u64>,
}

impl LayerCache {
    fn get_or_insert_with(
        &mut self,
        key: u64,
        render: impl FnOnce() -> Option<Layer>,
    ) -> Option<Rc<Layer>> {
        if let Some(entry) = self.map.get(&key) {
            return entry.clone();
        }
        let layer = render().map(Rc::new);
        if self.order.len() >= LAYER_CACHE_CAPACITY {
            if let Some(oldest) = self.order.pop_front() {
                self.map.remove(&oldest);
            }
        }
        self.order.push_back(key);
        self.map.insert(key, layer.clone());
        layer
    }
}

fn hash_key(parts: &[&dyn std::fmt::Debug]) -> u64 {
    let mut hasher = DefaultHasher::new();
    for part in parts {
        format!("{part:?}").hash(&mut hasher);
    }
    hasher.finish()
}

/// Image décodée : une ou plusieurs frames (GIF animé), chacune avec sa pyramide de réductions
/// (niveau 0 = taille d'origine, niveau n = 1/2ⁿ) construite à la demande.
struct Sprite {
    frames: Vec<SpriteFrame>,
    total_ms: u64,
    size: (u32, u32),
}

struct SpriteFrame {
    levels: Vec<Pixmap>,
    delay_ms: u64,
}

impl Sprite {
    fn still(pixmap: Pixmap) -> Self {
        let size = (pixmap.width(), pixmap.height());
        Self {
            frames: vec![SpriteFrame {
                levels: vec![pixmap],
                delay_ms: 0,
            }],
            total_ms: 0,
            size,
        }
    }

    /// Frame à afficher à `time` secondes, réduite autant que possible tout en restant au moins
    /// à la résolution demandée (`scale` = rapport taille affichée / taille d'origine).
    fn pixmap_at(&mut self, time: f64, scale: f32) -> &Pixmap {
        let index = if self.total_ms > 0 {
            let t = ((time.max(0.0) * 1000.0) as u64) % self.total_ms;
            let mut acc = 0;
            self.frames
                .iter()
                .position(|f| {
                    acc += f.delay_ms;
                    t < acc
                })
                .unwrap_or(0)
        } else {
            0
        };
        let frame = &mut self.frames[index];
        let wanted = if scale > 0.0 && scale < 1.0 {
            (1.0 / scale).log2().floor().max(0.0) as usize
        } else {
            0
        };
        while frame.levels.len() <= wanted {
            let last = frame.levels.last().expect("niveau 0 toujours présent");
            if last.width() < 2 || last.height() < 2 {
                break;
            }
            let next = halve(last);
            frame.levels.push(next);
        }
        let level = wanted.min(frame.levels.len() - 1);
        &frame.levels[level]
    }
}

/// Réduction par 2 (moyenne 2×2) d'un pixmap pré-multiplié.
fn halve(src: &Pixmap) -> Pixmap {
    let (w, h) = ((src.width() / 2).max(1), (src.height() / 2).max(1));
    let mut dst = Pixmap::new(w, h).expect("dimensions non nulles");
    let (sw, sh) = (src.width() as usize, src.height() as usize);
    let src_px = src.pixels();
    let dst_px = dst.pixels_mut();
    for y in 0..h as usize {
        for x in 0..w as usize {
            let (x0, y0) = (x * 2, y * 2);
            let (x1, y1) = ((x0 + 1).min(sw - 1), (y0 + 1).min(sh - 1));
            let samples = [
                src_px[y0 * sw + x0],
                src_px[y0 * sw + x1],
                src_px[y1 * sw + x0],
                src_px[y1 * sw + x1],
            ];
            let avg = |f: fn(&tiny_skia::PremultipliedColorU8) -> u8| -> u8 {
                (samples.iter().map(|p| f(p) as u32).sum::<u32>() / 4) as u8
            };
            dst_px[y * w as usize + x] = tiny_skia::PremultipliedColorU8::from_rgba(
                avg(|p| p.red()),
                avg(|p| p.green()),
                avg(|p| p.blue()),
                avg(|p| p.alpha()),
            )
            .unwrap_or_else(transparent);
        }
    }
    dst
}

/// RGBA droit (`image`) → pixmap pré-multiplié (tiny-skia).
fn rgba_to_pixmap(img: &image::RgbaImage) -> Option<Pixmap> {
    let size = tiny_skia::IntSize::from_wh(img.width(), img.height())?;
    let mut pixmap = Pixmap::from_vec(img.as_raw().clone(), size)?;
    premultiply(&mut pixmap);
    Some(pixmap)
}

/// Charge une image (ou toutes les frames d'un GIF animé) depuis le disque.
fn load_sprite(path: &Path) -> Option<Sprite> {
    let is_gif = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("gif"));
    if is_gif {
        if let Some(sprite) = load_gif(path) {
            return Some(sprite);
        }
    }
    let img = image::open(path).ok()?.to_rgba8();
    rgba_to_pixmap(&img).map(Sprite::still)
}

fn load_gif(path: &Path) -> Option<Sprite> {
    use image::AnimationDecoder;
    let file = std::io::BufReader::new(std::fs::File::open(path).ok()?);
    let decoder = image::codecs::gif::GifDecoder::new(file).ok()?;
    let mut frames = Vec::new();
    let mut total_ms = 0;
    let mut size = (0, 0);
    for frame in decoder.into_frames().take(MAX_GIF_FRAMES) {
        let frame = frame.ok()?;
        let (num, den) = frame.delay().numer_denom_ms();
        // Un délai nul est traité comme 100 ms par les navigateurs.
        let delay_ms = if num == 0 || den == 0 {
            100
        } else {
            (num as u64 / den as u64).max(20)
        };
        let pixmap = rgba_to_pixmap(frame.buffer())?;
        size = (pixmap.width(), pixmap.height());
        total_ms += delay_ms;
        frames.push(SpriteFrame {
            levels: vec![pixmap],
            delay_ms,
        });
    }
    if frames.is_empty() {
        return None;
    }
    // Un GIF d'une seule image n'a pas de durée de cycle : traité comme une image fixe.
    if frames.len() == 1 {
        frames[0].delay_ms = 0;
        total_ms = 0;
    }
    Some(Sprite {
        frames,
        total_ms,
        size,
    })
}

/// Décodeur de vidéo en cours pour un élément (voir `FrameRenderer::video_frame_at`).
struct ActiveVideo {
    stream: VideoStream,
    last_used: u64,
}

/// Moteur de texte : polices et cache de glyphes, plus les tailles « auto » déjà calculées.
struct TextEngine {
    font_system: FontSystem,
    swash_cache: SwashCache,
    autofit: HashMap<u64, f32>,
}

pub struct FrameRenderer {
    text: TextEngine,
    sprites: HashMap<String, Option<Sprite>>,
    layers: LayerCache,
    media_paths: HashMap<String, Option<PathBuf>>,
    probes: HashMap<String, Option<VideoProbe>>,
    videos: HashMap<String, ActiveVideo>,
    /// Calque de scène réutilisé d'une frame à l'autre (transitions).
    scene_buffer: Option<Pixmap>,
    frame_counter: u64,
    /// Sources média (image/vidéo) introuvables ou illisibles rencontrées pendant le rendu,
    /// sans doublon — l'appelant les remonte à l'utilisateur.
    pub missing_media: Vec<String>,
}

/// Index (1-based) de la frame extraite à afficher pour `local_time` (secondes dans la source).
/// Hors boucle : clamp sur la dernière frame (gel). En boucle : retour au point d'entrée
/// (`video_offset`), pas au début du fichier — même convention que la preview
/// (`VideoElementView`, modulo sur [offset, fin de source)).
fn video_frame_index(
    local_time: f64,
    fps: u32,
    count: u32,
    loop_video: bool,
    video_offset: f64,
) -> i64 {
    let count = count as i64;
    let raw_idx = (local_time.max(0.0) * fps as f64).floor() as i64;
    let start_idx = ((video_offset.max(0.0) * fps as f64).floor() as i64).clamp(0, count - 1);
    let span = count - start_idx;
    if loop_video && span > 0 && raw_idx >= count {
        start_idx + (raw_idx - start_idx).rem_euclid(span) + 1
    } else {
        (raw_idx + 1).clamp(1, count)
    }
}

/// Famille cosmic-text depuis un `font-family` CSS : première entrée d'une liste, sans guillemets,
/// familles génériques reconnues, repli sur la police de l'interface.
fn font_family(name: Option<&str>) -> Family<'_> {
    let first = name
        .and_then(|n| n.split(',').next())
        .map(|n| n.trim().trim_matches(|c| c == '"' || c == '\'').trim())
        .filter(|n| !n.is_empty());
    match first {
        None => Family::Name(DEFAULT_FONT_FAMILY),
        Some(n) if n.eq_ignore_ascii_case("sans-serif") => Family::SansSerif,
        Some(n) if n.eq_ignore_ascii_case("serif") => Family::Serif,
        Some(n) if n.eq_ignore_ascii_case("monospace") => Family::Monospace,
        Some(n) if n.eq_ignore_ascii_case("cursive") => Family::Cursive,
        Some(n) if n.eq_ignore_ascii_case("fantasy") => Family::Fantasy,
        Some(n) => Family::Name(n),
    }
}

/// Attributs cosmic-text (famille/graisse/style) d'un élément texte — partagé entre la mise en
/// page de mesure (`text_fits_at_size`) et le rendu pour garantir des métriques identiques.
fn text_attrs(text_el: &TextElement) -> Attrs<'_> {
    let weight = if text_el.font_weight == Some(FontWeight::Bold) {
        Weight(WEIGHT_BOLD)
    } else {
        Weight(WEIGHT_NORMAL)
    };
    let style = if text_el.font_style == Some(FontStyle::Italic) {
        cosmic_text::Style::Italic
    } else {
        cosmic_text::Style::Normal
    };
    Attrs::new()
        .family(font_family(text_el.font_family.as_deref()))
        .weight(weight)
        .style(style)
}

/// Multiplicateur de hauteur de ligne (borné pour ne jamais produire une hauteur nulle, que
/// cosmic-text refuse par une assertion).
fn line_height_factor(text_el: &TextElement) -> f32 {
    (text_el.line_height.unwrap_or(DEFAULT_LINE_HEIGHT) as f32).clamp(0.1, 20.0)
}

fn to_skia_blend_mode(mode: Option<BlendMode>) -> tiny_skia::BlendMode {
    match mode {
        None | Some(BlendMode::Normal) => tiny_skia::BlendMode::SourceOver,
        Some(BlendMode::Multiply) => tiny_skia::BlendMode::Multiply,
        Some(BlendMode::Screen) => tiny_skia::BlendMode::Screen,
        Some(BlendMode::Overlay) => tiny_skia::BlendMode::Overlay,
        Some(BlendMode::Darken) => tiny_skia::BlendMode::Darken,
        Some(BlendMode::Lighten) => tiny_skia::BlendMode::Lighten,
    }
}

fn layer_paint(opacity: f32, blend_mode: Option<BlendMode>) -> PixmapPaint {
    PixmapPaint {
        opacity,
        blend_mode: to_skia_blend_mode(blend_mode),
        quality: FilterQuality::Bilinear,
    }
}

fn elem_transform(anim: &ResolvedTransform, cx: f32, cy: f32, w_px: f32, h_px: f32) -> Transform {
    let dx_px = (anim.dx_pct / 100.0) as f32 * w_px;
    let dy_px = (anim.dy_pct / 100.0) as f32 * h_px;
    let skew_kx = (anim.skew_deg as f32).to_radians().tan();
    Transform::from_translate(-cx, -cy)
        .post_concat(Transform::from_row(1.0, 0.0, skew_kx, 1.0, 0.0, 0.0))
        .post_scale(anim.scale as f32, anim.scale as f32)
        .post_rotate(anim.rotate_deg as f32)
        .post_translate(cx, cy)
        .post_translate(dx_px, dy_px)
}

/// Rectangle visible pour un wipe (balayage) donné, selon sa progression (0 = caché, 1 = révélé).
fn wipe_rect(
    transition_type: TransitionType,
    progress: f64,
    width: f32,
    height: f32,
) -> Option<Rect> {
    let p = progress.clamp(0.0, 1.0) as f32;
    match transition_type {
        TransitionType::WipeRight => Rect::from_xywh(0.0, 0.0, width * p, height),
        TransitionType::WipeLeft => Rect::from_xywh(width * (1.0 - p), 0.0, width * p, height),
        TransitionType::WipeDown => Rect::from_xywh(0.0, 0.0, width, height * p),
        TransitionType::WipeUp => Rect::from_xywh(0.0, height * (1.0 - p), width, height * p),
        _ => None,
    }
}

/// Texte révélé par `word-reveal` : tout jusqu'à la fin du `visible`-ième mot, séparateurs
/// (espaces, retours à la ligne) d'origine conservés.
fn reveal_words(content: &str, visible: usize) -> &str {
    if visible == 0 {
        return "";
    }
    let mut words = 0;
    let mut in_word = false;
    for (i, ch) in content.char_indices() {
        if ch.is_whitespace() {
            if in_word && words == visible {
                return &content[..i];
            }
            in_word = false;
        } else if !in_word {
            in_word = true;
            words += 1;
        }
    }
    content
}

impl Default for FrameRenderer {
    fn default() -> Self {
        Self::new()
    }
}

impl FrameRenderer {
    pub fn new() -> Self {
        let mut font_system = FontSystem::new();
        for data in EMBEDDED_FONTS {
            font_system.db_mut().load_font_data(data.to_vec());
        }
        Self {
            text: TextEngine {
                font_system,
                swash_cache: SwashCache::new(),
                autofit: HashMap::new(),
            },
            sprites: HashMap::new(),
            layers: LayerCache::default(),
            media_paths: HashMap::new(),
            probes: HashMap::new(),
            videos: HashMap::new(),
            scene_buffer: None,
            frame_counter: 0,
            missing_media: Vec::new(),
        }
    }

    fn note_missing(&mut self, src: &str) {
        if !self.missing_media.iter().any(|m| m == src) {
            self.missing_media.push(src.to_string());
        }
    }

    /// Chemin réel d'un média du projet (résolution et contrôle d'appartenance mis en cache : ils
    /// ne dépendent pas du temps).
    fn media_path(&mut self, project_dir: &Path, relative_src: &str) -> Option<PathBuf> {
        self.media_paths
            .entry(relative_src.to_string())
            .or_insert_with(|| crate::paths::resolve_media_path(project_dir, relative_src).ok())
            .clone()
    }

    fn sprite(&mut self, project_dir: &Path, relative_src: &str) -> Option<&mut Sprite> {
        if !self.sprites.contains_key(relative_src) {
            let loaded = self
                .media_path(project_dir, relative_src)
                .and_then(|path| load_sprite(&path));
            if loaded.is_none() {
                self.note_missing(relative_src);
            }
            self.sprites.insert(relative_src.to_string(), loaded);
        }
        self.sprites.get_mut(relative_src)?.as_mut()
    }

    /// Frame décodée de la vidéo de l'élément `key` à `local_time` (secondes dans la source),
    /// avec la taille d'origine de la vidéo. Le flux ffmpeg de l'élément est ouvert au premier
    /// appel (au point d'entrée utile, pas au début du fichier) puis lu image par image ;
    /// `target_scale` (≤ 1) permet à ffmpeg de réduire les frames à la taille réellement affichée.
    #[allow(clippy::too_many_arguments)]
    fn video_frame_at(
        &mut self,
        key: &str,
        project_dir: &Path,
        relative_src: &str,
        fps: u32,
        local_time: f64,
        loop_video: bool,
        video_offset: f64,
        target_scale: f32,
    ) -> Option<(&Pixmap, (u32, u32))> {
        let source = self.media_path(project_dir, relative_src);
        let probe = match self.probes.get(relative_src) {
            Some(p) => *p,
            None => {
                let probe = source.as_deref().and_then(probe_video);
                if probe.is_none() {
                    self.note_missing(relative_src);
                }
                self.probes.insert(relative_src.to_string(), probe);
                probe
            }
        }?;
        let source = source?;
        let count = if probe.duration > 0.0 {
            ((probe.duration * fps as f64).floor() as u32).max(1)
        } else {
            u32::MAX
        };
        let idx = (video_frame_index(local_time, fps, count, loop_video, video_offset) - 1) as u64;

        let reopen = self
            .videos
            .get(key)
            .is_none_or(|v| v.stream.needs_reopen(idx, fps as u64 * 2));
        if reopen {
            self.videos.remove(key);
            let scale = target_scale.clamp(0.05, 1.0);
            let out_size = (
                ((probe.width as f32 * scale).ceil() as u32).max(2),
                ((probe.height as f32 * scale).ceil() as u32).max(2),
            );
            match VideoStream::open(&source, fps, idx, out_size) {
                Ok(stream) => {
                    self.videos.insert(
                        key.to_string(),
                        ActiveVideo {
                            stream,
                            last_used: self.frame_counter,
                        },
                    );
                }
                Err(_) => {
                    self.note_missing(relative_src);
                    return None;
                }
            }
        }
        let active = self.videos.get_mut(key)?;
        active.last_used = self.frame_counter;
        let pixmap = active.stream.frame_at(idx)?;
        Some((pixmap, (probe.width, probe.height)))
    }

    pub fn render_frame(&mut self, project: &Project, project_dir: &Path, t: f64) -> Pixmap {
        let width = project.width.max(1);
        let height = project.height.max(1);
        let mut canvas = Pixmap::new(width, height).expect("dimensions non nulles");
        canvas.fill(Color::BLACK);
        self.frame_counter += 1;

        // Plusieurs compositions pendant un chevauchement (fondu-enchaîné) : dessinées dans
        // l'ordre de la timeline, chacune avec ses propres transitions.
        for (composition, local_time) in resolve_active_compositions(project, t) {
            self.draw_scene(
                &mut canvas,
                composition,
                local_time,
                project_dir,
                project.fps.max(1),
            );
        }

        // Les décodeurs vidéo des éléments qui n'ont pas servi à cette frame sont arrêtés.
        let current = self.frame_counter;
        self.videos.retain(|_, v| v.last_used == current);
        canvas
    }

    /// Dessine une composition sur `canvas`, avec ses transitions d'entrée/sortie. Sans
    /// transition active, ses éléments sont dessinés directement (pas de calque intermédiaire).
    fn draw_scene(
        &mut self,
        canvas: &mut Pixmap,
        composition: &Composition,
        local_time: f64,
        project_dir: &Path,
        fps: u32,
    ) {
        let width = canvas.width();
        let height = canvas.height();
        let comp_in = resolve_composition_transition(
            composition.transition_in.as_ref(),
            AnimationDirection::In,
            local_time,
            composition.duration,
        );
        let comp_out = resolve_composition_transition(
            composition.transition_out.as_ref(),
            AnimationDirection::Out,
            local_time,
            composition.duration,
        );
        let opacity = (comp_in.opacity * comp_out.opacity).clamp(0.0, 1.0) as f32;
        let cx = width as f32 / 2.0;
        let cy = height as f32 / 2.0;
        let comp_transform = elem_transform(
            &ResolvedTransform {
                opacity: 1.0,
                dx_pct: comp_in.dx_pct + comp_out.dx_pct,
                dy_pct: comp_in.dy_pct + comp_out.dy_pct,
                scale: comp_in.scale * comp_out.scale,
                rotate_deg: comp_in.rotate_deg + comp_out.rotate_deg,
                skew_deg: 0.0,
                blur_px: 0.0,
            },
            cx,
            cy,
            width as f32,
            height as f32,
        );

        let wipe = resolve_wipe(
            composition.transition_out.as_ref(),
            AnimationDirection::Out,
            local_time,
            composition.duration,
        )
        .or_else(|| {
            resolve_wipe(
                composition.transition_in.as_ref(),
                AnimationDirection::In,
                local_time,
                composition.duration,
            )
        });
        let mask = wipe.and_then(|(transition_type, progress)| {
            let rect = wipe_rect(transition_type, progress, width as f32, height as f32)?;
            let mut m = Mask::new(width, height)?;
            let mut pb = PathBuilder::new();
            pb.push_rect(rect);
            let path = pb.finish()?;
            m.fill_path(&path, FillRule::Winding, true, Transform::identity());
            Some(m)
        });

        if opacity >= 0.999 && comp_transform.is_identity() && mask.is_none() {
            self.draw_elements(canvas, composition, local_time, project_dir, fps);
            return;
        }

        let mut scene = match self.scene_buffer.take() {
            Some(mut buffer) if buffer.width() == width && buffer.height() == height => {
                buffer.fill(Color::TRANSPARENT);
                buffer
            }
            _ => Pixmap::new(width, height).expect("dimensions non nulles"),
        };
        self.draw_elements(&mut scene, composition, local_time, project_dir, fps);
        canvas.draw_pixmap(
            0,
            0,
            scene.as_ref(),
            &layer_paint(opacity, None),
            comp_transform,
            mask.as_ref(),
        );
        self.scene_buffer = Some(scene);
    }

    fn draw_elements(
        &mut self,
        scene: &mut Pixmap,
        composition: &Composition,
        local_time: f64,
        project_dir: &Path,
        fps: u32,
    ) {
        let width = scene.width() as f32;
        let height = scene.height() as f32;
        let unit = width / LENGTH_UNITS_PER_WIDTH;

        for el in &composition.elements {
            if !is_element_active(el, local_time) {
                continue;
            }
            let base = el.base();
            let active_duration = base
                .duration
                .unwrap_or(composition.duration - base.start_time);
            let local_element_time = local_time - base.start_time;
            let anim =
                resolve_element_animations(&base.animations, local_element_time, active_duration);
            if anim.opacity <= 0.001 {
                continue;
            }

            let x_px = (base.x / 100.0) as f32 * width;
            let y_px = (base.y / 100.0) as f32 * height;
            let w_px = (base.width / 100.0) as f32 * width;
            let h_px = (base.height / 100.0) as f32 * height;
            let cx = x_px + w_px / 2.0;
            let cy = y_px + h_px / 2.0;
            // La rotation de l'élément est appliquée après les animations (comme la preview, où
            // l'animation vit dans le repère déjà tourné du calque de l'élément).
            let transform = elem_transform(&anim, cx, cy, w_px, h_px).post_rotate_at(
                base.rotation as f32,
                cx,
                cy,
            );
            let ctx = DrawCtx {
                x: x_px,
                y: y_px,
                w: w_px,
                h: h_px,
                opacity: anim.opacity as f32,
                blur_px: anim.blur_px as f32 * unit,
                transform,
                blend_mode: base.blend_mode,
                unit,
            };

            match el {
                Element::Text(text_el) => {
                    let reveal =
                        resolve_text_reveal(&base.animations, local_element_time, active_duration);
                    self.draw_text(scene, text_el, &ctx, reveal);
                }
                Element::Shape(shape_el) => {
                    draw_shape(scene, &mut self.layers, shape_el, &ctx);
                }
                Element::Image(img_el) => {
                    let pan = resolve_image_pan(
                        img_el.image_pan.as_ref(),
                        local_element_time,
                        active_duration,
                    );
                    let style = MediaStyle {
                        corner_radius: img_el.corner_radius,
                        border_color: img_el.border_color.as_deref(),
                        border_width: img_el.border_width,
                        background: img_el.background_color.as_deref(),
                    };
                    let inner = inner_size(&ctx, &style);
                    if let Some(sprite) = self.sprite(project_dir, &img_el.src) {
                        let orig = sprite.size;
                        let scale = fit_scale(img_el.fit_mode, inner, orig, pan.0 as f32);
                        let pixmap = sprite.pixmap_at(local_element_time, scale.0.max(scale.1));
                        draw_bitmap(
                            scene,
                            Bitmap {
                                pixmap,
                                orig_size: orig,
                            },
                            img_el.fit_mode,
                            &ctx,
                            &style,
                            pan,
                        );
                    } else {
                        draw_placeholder(scene, img_el.background_color.as_deref(), &ctx);
                    }
                }
                Element::Video(video_el) => {
                    let pan = resolve_image_pan(
                        video_el.image_pan.as_ref(),
                        local_element_time,
                        active_duration,
                    );
                    let speed = if video_el.playback_speed > 0.01 {
                        video_el.playback_speed
                    } else {
                        1.0
                    };
                    let local_video_time =
                        local_element_time.max(0.0) * speed + video_el.video_offset;
                    let style = MediaStyle {
                        corner_radius: video_el.corner_radius,
                        border_color: video_el.border_color.as_deref(),
                        border_width: video_el.border_width,
                        background: video_el.background_color.as_deref(),
                    };
                    let inner = inner_size(&ctx, &style);
                    // Un seul seuil de réduction par flux : le zoom Ken Burns peut agrandir
                    // l'image, on garde de la marge (x2) avant de réduire à la taille affichée.
                    let key = format!("{}/{}", composition.id, base.id);
                    let frame_scale = |orig: (u32, u32)| {
                        let s = fit_scale(video_el.fit_mode, inner, orig, 1.0);
                        (s.0.max(s.1) * 2.0).min(1.0)
                    };
                    let probe_size = self
                        .probes
                        .get(&video_el.src)
                        .and_then(|p| p.as_ref())
                        .map(|p| (p.width, p.height));
                    let target_scale = probe_size.map(frame_scale).unwrap_or(1.0);
                    let frame = self.video_frame_at(
                        &key,
                        project_dir,
                        &video_el.src,
                        fps,
                        local_video_time,
                        video_el.loop_video,
                        video_el.video_offset,
                        target_scale,
                    );
                    if let Some((pixmap, orig)) = frame {
                        draw_bitmap(
                            scene,
                            Bitmap {
                                pixmap,
                                orig_size: orig,
                            },
                            video_el.fit_mode,
                            &ctx,
                            &style,
                            pan,
                        );
                    } else {
                        // Repli si ffmpeg est indisponible ou si la source est illisible.
                        draw_placeholder(scene, video_el.background_color.as_deref(), &ctx);
                    }
                }
            }
        }
    }

    /// Rend le texte dans un calque hors-écran local, mis en cache (voir `LayerCache`), puis le
    /// compose sur `scene` via `draw_pixmap` + `transform` — même mécanisme que les images et les
    /// formes : rotation et flou fonctionnent, et un texte qui ne change pas d'une frame à
    /// l'autre n'est mis en page qu'une fois.
    fn draw_text(
        &mut self,
        scene: &mut Pixmap,
        text_el: &TextElement,
        ctx: &DrawCtx,
        reveal: Option<(AnimationType, f64)>,
    ) {
        // Typewriter/word-reveal tronquent le contenu avant la mise en page ; line-reveal masque
        // des lignes (paragraphes) du texte complet.
        let (display_content, visible_lines): (std::borrow::Cow<str>, Option<usize>) = match reveal
        {
            Some((AnimationType::Typewriter, progress)) => {
                let total_chars = text_el.content.chars().count();
                let visible = ((total_chars as f64) * progress).round().max(0.0) as usize;
                (
                    std::borrow::Cow::Owned(text_el.content.chars().take(visible).collect()),
                    None,
                )
            }
            Some((AnimationType::WordReveal, progress)) => {
                let total_words = text_el.content.split_whitespace().count();
                let visible = ((total_words as f64) * progress).round().max(0.0) as usize;
                (
                    std::borrow::Cow::Borrowed(reveal_words(&text_el.content, visible)),
                    None,
                )
            }
            Some((AnimationType::LineReveal, progress)) => {
                let total_lines = text_el.content.split('\n').count();
                let visible = ((total_lines as f64) * progress).round().max(0.0) as usize;
                (
                    std::borrow::Cow::Borrowed(text_el.content.as_str()),
                    Some(visible),
                )
            }
            _ => (std::borrow::Cow::Borrowed(text_el.content.as_str()), None),
        };

        let canvas_w = scene.width() as f32;
        let font_size_px = match text_el.font_size {
            Some(fs) => ((fs / 100.0) as f32 * canvas_w).max(1.0),
            None => self.text.autofit_font_size_px(text_el, ctx.w, ctx.h),
        };

        let key = hash_key(&[
            &display_content,
            &visible_lines,
            &font_size_px.to_bits(),
            &line_height_factor(text_el).to_bits(),
            &text_el.font_family,
            &text_el.font_weight,
            &text_el.font_style,
            &text_el.color,
            &text_el.background_color,
            &text_el.letter_spacing.map(f64::to_bits),
            &text_el.alignment,
            &text_el.vertical_alignment,
            &text_el.text_shadow,
            &text_el.underline,
            &text_el.strikethrough,
            &ctx.w.to_bits(),
            &ctx.h.to_bits(),
            &ctx.blur_px.to_bits(),
            &canvas_w.to_bits(),
        ]);
        let text = &mut self.text;
        let layer = self.layers.get_or_insert_with(key, || {
            render_text_layer(
                text,
                text_el,
                &display_content,
                visible_lines,
                font_size_px,
                ctx,
                canvas_w,
            )
        });
        if let Some(layer) = layer {
            composite_layer(scene, &layer, ctx);
        }
    }
}

/// Compose un calque pré-rendu sur la scène, à la position de la boîte de `ctx`.
fn composite_layer(scene: &mut Pixmap, layer: &Layer, ctx: &DrawCtx) {
    scene.draw_pixmap(
        0,
        0,
        layer.pixmap.as_ref(),
        &layer_paint(ctx.opacity, ctx.blend_mode),
        ctx.transform
            .pre_translate(ctx.x + layer.origin.0, ctx.y + layer.origin.1),
        None,
    );
}

impl TextEngine {
    /// Hauteur totale (px) du texte mis en page à `font_size_px`, et plus grande largeur de
    /// ligne — la boîte n'est pas bornée en hauteur pour mesurer le texte complet.
    fn measure(
        &mut self,
        text_el: &TextElement,
        content: &str,
        font_size_px: f32,
        w_px: f32,
    ) -> (Buffer, f32, f32) {
        let line_height_px = font_size_px * line_height_factor(text_el);
        let metrics = Metrics::new(font_size_px, line_height_px);
        let mut buffer = Buffer::new(&mut self.font_system, metrics);
        buffer.set_size(Some(w_px), None);
        let attrs = text_attrs(text_el);
        buffer.set_text(content, &attrs, Shaping::Advanced, None);
        buffer.shape_until_scroll(&mut self.font_system, false);
        let lines = buffer.layout_runs().count();
        let widest = buffer
            .layout_runs()
            .map(|run| run.glyphs.iter().map(|g| g.w).sum::<f32>())
            .fold(0.0, f32::max);
        (buffer, lines as f32 * line_height_px, widest)
    }

    /// `font_size: None` (auto-fit) : vrai si le texte, une fois mis en page à `font_size_px`
    /// (retour à la ligne automatique sur `w_px`), tient dans `h_px` sans déborder.
    fn text_fits_at_size(
        &mut self,
        text_el: &TextElement,
        font_size_px: f32,
        w_px: f32,
        h_px: f32,
    ) -> bool {
        let (_, total_height, widest) = self.measure(text_el, &text_el.content, font_size_px, w_px);
        total_height <= h_px + 0.5 && widest <= w_px + 0.5
    }

    /// Recherche par dichotomie la plus grande taille de police (px) qui tient dans la boîte
    /// `w_px`×`h_px` — implémente `font_size: None` (auto-fit). Résultat mis en cache : il ne
    /// dépend que du texte complet, de la police et de la boîte (11 mises en page par calcul).
    fn autofit_font_size_px(&mut self, text_el: &TextElement, w_px: f32, h_px: f32) -> f32 {
        let key = hash_key(&[
            &text_el.content,
            &text_el.font_family,
            &text_el.font_weight,
            &text_el.font_style,
            &line_height_factor(text_el).to_bits(),
            &w_px.to_bits(),
            &h_px.to_bits(),
        ]);
        if let Some(size) = self.autofit.get(&key) {
            return *size;
        }
        let mut lo = 2.0f32;
        let mut hi = h_px.max(lo + 1.0);
        let size = if !self.text_fits_at_size(text_el, lo, w_px, h_px) {
            // Même la taille minimale déborde (boîte trop petite / contenu trop long) : on
            // reste sur ce plancher plutôt que de produire un texte invisible (taille 0).
            lo
        } else {
            for _ in 0..10 {
                let mid = (lo + hi) / 2.0;
                if self.text_fits_at_size(text_el, mid, w_px, h_px) {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            lo
        };
        self.autofit.insert(key, size);
        size
    }
}

fn cosmic_color(color: Color) -> CosmicColor {
    CosmicColor::rgba(
        (color.red() * 255.0).round() as u8,
        (color.green() * 255.0).round() as u8,
        (color.blue() * 255.0).round() as u8,
        (color.alpha() * 255.0).round() as u8,
    )
}

/// Trace les glyphes d'une mise en page dans `target`, décalés de `(dx, dy)`.
#[allow(clippy::too_many_arguments)]
fn paint_glyphs(
    engine: &mut TextEngine,
    buffer: &Buffer,
    target: &mut Pixmap,
    color: CosmicColor,
    offset: (f32, f32),
    letter_spacing_px: f32,
    h_offset: &dyn Fn(&cosmic_text::LayoutRun) -> f32,
    visible_lines: Option<usize>,
    mut line_bounds: Option<&mut Vec<(f32, f32, f32)>>,
) {
    let (target_w, target_h) = (target.width() as i32, target.height() as i32);
    for run in buffer.layout_runs() {
        if visible_lines.is_some_and(|max| run.line_i >= max) {
            continue;
        }
        let mut cumulative_spacing = h_offset(&run) + offset.0;
        let (mut min_x, mut max_x) = (f32::MAX, f32::MIN);
        for glyph in run.glyphs {
            let physical = glyph.physical((cumulative_spacing, offset.1 + run.line_y), 1.0);
            cumulative_spacing += letter_spacing_px;
            min_x = min_x.min(physical.x as f32);
            max_x = max_x.max(physical.x as f32 + glyph.w);
            engine.swash_cache.with_pixels(
                &mut engine.font_system,
                physical.cache_key,
                color,
                |gx, gy, gcolor| {
                    let ix = physical.x + gx;
                    let iy = physical.y + gy;
                    if ix < 0 || iy < 0 || ix >= target_w || iy >= target_h {
                        return;
                    }
                    blend_pixel(
                        target,
                        ix as u32,
                        iy as u32,
                        gcolor.r(),
                        gcolor.g(),
                        gcolor.b(),
                        gcolor.a(),
                    );
                },
            );
        }
        if let Some(bounds) = line_bounds.as_mut() {
            if min_x <= max_x {
                bounds.push((offset.1 + run.line_y, min_x, max_x));
            }
        }
    }
}

/// Rend un texte dans un calque (voir `FrameRenderer::draw_text`). Le calque couvre la boîte de
/// l'élément, agrandie si le texte la déborde (la preview laisse le texte déborder) et du halo du
/// flou.
fn render_text_layer(
    engine: &mut TextEngine,
    text_el: &TextElement,
    content: &str,
    visible_lines: Option<usize>,
    font_size_px: f32,
    ctx: &DrawCtx,
    canvas_w: f32,
) -> Option<Layer> {
    let (w_px, h_px) = (ctx.w, ctx.h);
    let line_height_px = font_size_px * line_height_factor(text_el);
    let (buffer, total_text_height, _) = engine.measure(text_el, content, font_size_px, w_px);

    // Position verticale du texte dans la boîte (négative si le texte est plus haut qu'elle).
    let v_in_box = match text_el.vertical_alignment {
        VerticalAlign::Top => 0.0,
        VerticalAlign::Middle => (h_px - total_text_height) / 2.0,
        VerticalAlign::Bottom => h_px - total_text_height,
    };
    let halo = ctx.halo();
    let overflow_top = (-v_in_box).max(0.0).ceil();
    let overflow_bottom = (v_in_box + total_text_height - h_px).max(0.0).ceil();
    let layer_w = (w_px.ceil() + 2.0 * halo).max(1.0) as u32;
    let layer_h = (h_px.ceil() + overflow_top + overflow_bottom + 2.0 * halo).max(1.0) as u32;
    let mut layer = Pixmap::new(layer_w, layer_h)?;
    let box_top = halo + overflow_top;

    // Fond de l'élément : la preview applique `background_color` à toute la boîte du texte, pas
    // seulement derrière les glyphes.
    if let Some(bg) = text_el.background_color.as_deref() {
        let mut paint = Paint::default();
        paint.set_color(parse_css_color(bg));
        if let Some(rect) = Rect::from_xywh(halo, box_top, w_px.ceil(), h_px.ceil()) {
            layer.fill_rect(rect, &paint, Transform::identity(), None);
        }
    }

    let color = parse_css_color(&text_el.color);
    let letter_spacing_px = (text_el.letter_spacing.unwrap_or(0.0) / 100.0) as f32 * canvas_w;

    // Décalage horizontal par ligne selon l'alignement (cosmic-text pose chaque run à gauche par
    // défaut) ; la largeur effective inclut l'espacement de lettres ajouté entre les glyphes.
    let alignment = text_el.alignment;
    let h_offset = move |run: &cosmic_text::LayoutRun| -> f32 {
        let run_width = run.line_w + letter_spacing_px * run.glyphs.len().saturating_sub(1) as f32;
        halo + match alignment {
            TextAlign::Left => 0.0,
            TextAlign::Center => ((w_px - run_width) / 2.0).max(0.0),
            TextAlign::Right => (w_px - run_width).max(0.0),
        }
    };
    let text_origin_y = box_top + v_in_box;

    // Ombre portée : décalée et floutée, dessinée avant le texte pour rester derrière.
    if let Some(shadow_color) = text_el.text_shadow.as_deref() {
        let mut shadow_layer = Pixmap::new(layer_w, layer_h)?;
        let offset = canvas_w * SHADOW_OFFSET_FRACTION;
        paint_glyphs(
            engine,
            &buffer,
            &mut shadow_layer,
            cosmic_color(parse_css_color(shadow_color)),
            (offset, text_origin_y + offset),
            letter_spacing_px,
            &h_offset,
            visible_lines,
            None,
        );
        box_blur(&mut shadow_layer, canvas_w * SHADOW_BLUR_FRACTION / 2.0);
        layer.draw_pixmap(
            0,
            0,
            shadow_layer.as_ref(),
            &PixmapPaint::default(),
            Transform::identity(),
            None,
        );
    }

    // Texte principal ; on garde au passage les bornes de chaque ligne pour le souligné/barré.
    let mut line_bounds: Vec<(f32, f32, f32)> = Vec::new();
    paint_glyphs(
        engine,
        &buffer,
        &mut layer,
        cosmic_color(color),
        (0.0, text_origin_y),
        letter_spacing_px,
        &h_offset,
        visible_lines,
        Some(&mut line_bounds),
    );

    if text_el.underline || text_el.strikethrough {
        let mut line_paint = Paint::default();
        line_paint.set_color(color);
        let thickness = (font_size_px * 0.06).max(1.0);
        for (line_y, min_x, max_x) in &line_bounds {
            if text_el.underline {
                if let Some(rect) = Rect::from_xywh(
                    *min_x,
                    line_y + font_size_px * 0.18,
                    max_x - min_x,
                    thickness,
                ) {
                    layer.fill_rect(rect, &line_paint, Transform::identity(), None);
                }
            }
            if text_el.strikethrough {
                if let Some(rect) = Rect::from_xywh(
                    *min_x,
                    line_y - font_size_px * 0.32,
                    max_x - min_x,
                    thickness,
                ) {
                    layer.fill_rect(rect, &line_paint, Transform::identity(), None);
                }
            }
        }
    }
    let _ = line_height_px;

    if ctx.blur_px > 0.5 {
        box_blur(&mut layer, ctx.blur_px);
    }
    Some(Layer {
        pixmap: layer,
        origin: (-halo, -box_top),
    })
}

fn transparent() -> tiny_skia::PremultipliedColorU8 {
    tiny_skia::PremultipliedColorU8::from_rgba(0, 0, 0, 0).unwrap()
}

/// Une passe de flou par boîte glissante (rayon entier) sur une ligne ou colonne de `len`
/// pixels, via sommes préfixes : O(len) quel que soit le rayon.
fn box_pass(
    get: impl Fn(i32) -> tiny_skia::PremultipliedColorU8,
    mut set: impl FnMut(i32, tiny_skia::PremultipliedColorU8),
    len: i32,
    radius: i32,
) {
    let mut prefix: Vec<(u32, u32, u32, u32)> = Vec::with_capacity(len as usize + 1);
    prefix.push((0, 0, 0, 0));
    let mut acc = (0u32, 0u32, 0u32, 0u32);
    for i in 0..len {
        let p = get(i);
        acc = (
            acc.0 + p.red() as u32,
            acc.1 + p.green() as u32,
            acc.2 + p.blue() as u32,
            acc.3 + p.alpha() as u32,
        );
        prefix.push(acc);
    }
    for i in 0..len {
        let lo = (i - radius).max(0);
        let hi = (i + radius).min(len - 1);
        let count = (hi - lo + 1) as u32;
        let (a, b) = (prefix[(hi + 1) as usize], prefix[lo as usize]);
        // Divisions avec arrondi : trois passes successives accumuleraient sinon une perte
        // d'intensité (troncature) visible sur les aplats.
        let avg = |hi: u32, lo: u32| ((hi - lo + count / 2) / count) as u8;
        set(
            i,
            tiny_skia::PremultipliedColorU8::from_rgba(
                avg(a.0, b.0),
                avg(a.1, b.1),
                avg(a.2, b.2),
                avg(a.3, b.3),
            )
            .unwrap_or_else(transparent),
        );
    }
}

/// Flou gaussien d'écart-type `sigma_px` (équivalent de `filter: blur(σ)` CSS), approximé par
/// trois passes de flou par boîte séparables (horizontale puis verticale), en place sur un
/// buffer RGBA pré-multiplié. Une seule passe de rayon σ donnerait un écart-type effectif de
/// ~0,58σ : le flou serait nettement plus faible que celui de la preview.
fn box_blur(pixmap: &mut Pixmap, sigma_px: f32) {
    let radius = sigma_px.round().max(1.0) as i32;
    let width = pixmap.width() as i32;
    let height = pixmap.height() as i32;
    if width == 0 || height == 0 {
        return;
    }
    let mut tmp = vec![transparent(); (width * height) as usize];
    for _ in 0..3 {
        let src: Vec<tiny_skia::PremultipliedColorU8> = pixmap.pixels().to_vec();
        for y in 0..height {
            let row = (y * width) as usize;
            box_pass(
                |x| src[row + x as usize],
                |x, p| tmp[row + x as usize] = p,
                width,
                radius,
            );
        }
        let pixels = pixmap.pixels_mut();
        for x in 0..width {
            box_pass(
                |y| tmp[(y * width + x) as usize],
                |y, p| pixels[(y * width + x) as usize] = p,
                height,
                radius,
            );
        }
    }
}

/// Compose une couleur (alpha droit, non prémultiplié) sur un pixel du buffer prémultiplié :
/// out = src×sa + dst×(1−sa) par canal, out_a = sa + dst_a×(1−sa) (opérateur "over" standard).
fn blend_pixel(pixmap: &mut Pixmap, x: u32, y: u32, r: u8, g: u8, b: u8, a: u8) {
    if a == 0 {
        return;
    }
    let idx = (y * pixmap.width() + x) as usize;
    let pixels = pixmap.pixels_mut();
    let existing = pixels[idx];
    let sa = a as f32 / 255.0;
    let over = |s: u8, d: u8| -> u8 { (s as f32 * sa + d as f32 * (1.0 - sa)).round() as u8 };
    let new_pixel = tiny_skia::PremultipliedColorU8::from_rgba(
        over(r, existing.red()),
        over(g, existing.green()),
        over(b, existing.blue()),
        (a as f32 + existing.alpha() as f32 * (1.0 - sa)).round() as u8,
    )
    .unwrap_or(existing);
    pixels[idx] = new_pixel;
}

/// Chemin d'un rectangle à coins arrondis (quarts de cercle approximés par des cubiques,
/// constante de Kappa ≈ 0.5523).
fn rounded_rect_path(pb: &mut PathBuilder, x: f32, y: f32, w: f32, h: f32, radius: f32) {
    let r = radius.max(0.0).min(w.min(h) / 2.0);
    if r < 0.5 {
        if let Some(rect) = Rect::from_xywh(x, y, w, h) {
            pb.push_rect(rect);
        }
        return;
    }
    let k = r * 0.5523;
    pb.move_to(x + r, y);
    pb.line_to(x + w - r, y);
    pb.cubic_to(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
    pb.line_to(x + w, y + h - r);
    pb.cubic_to(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
    pb.line_to(x + r, y + h);
    pb.cubic_to(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
    pb.line_to(x, y + r);
    pb.cubic_to(x, y + r - k, x + r - k, y, x + r, y);
    pb.close();
}

/// Étoile : 10 sommets alternant rayon extérieur/intérieur (0,42), étirée à la boîte — même
/// géométrie que `ShapeView` côté interface.
const STAR_INNER_RATIO: f32 = 0.42;

fn shape_path(
    shape_type: ShapeType,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    border_radius: f32,
) -> Option<tiny_skia::Path> {
    let mut pb = PathBuilder::new();
    match shape_type {
        ShapeType::Rectangle => rounded_rect_path(&mut pb, x, y, w, h, border_radius),
        ShapeType::Ellipse => {
            pb.push_oval(Rect::from_xywh(x, y, w, h)?);
        }
        ShapeType::Triangle => {
            pb.move_to(x + w / 2.0, y);
            pb.line_to(x + w, y + h);
            pb.line_to(x, y + h);
            pb.close();
        }
        ShapeType::Line => {
            pb.move_to(x, y + h / 2.0);
            pb.line_to(x + w, y + h / 2.0);
        }
        ShapeType::Arrow => {
            pb.move_to(x, y + h * 0.4);
            pb.line_to(x + w * 0.7, y + h * 0.4);
            pb.line_to(x + w * 0.7, y + h * 0.2);
            pb.line_to(x + w, y + h * 0.5);
            pb.line_to(x + w * 0.7, y + h * 0.8);
            pb.line_to(x + w * 0.7, y + h * 0.6);
            pb.line_to(x, y + h * 0.6);
            pb.close();
        }
        ShapeType::Star => {
            let cx = x + w / 2.0;
            let cy = y + h / 2.0;
            for i in 0..10 {
                let angle = std::f32::consts::PI * i as f32 / 5.0 - std::f32::consts::FRAC_PI_2;
                let r = if i % 2 == 0 { 1.0 } else { STAR_INNER_RATIO };
                let px = cx + (w / 2.0) * r * angle.cos();
                let py = cy + (h / 2.0) * r * angle.sin();
                if i == 0 {
                    pb.move_to(px, py);
                } else {
                    pb.line_to(px, py);
                }
            }
            pb.close();
        }
    }
    pb.finish()
}

/// Rend la forme dans un calque hors-écran (mis en cache), puis la compose sur `scene` via
/// `draw_pixmap` + `transform` — même mécanisme que `draw_text`, ce qui permet d'appliquer un
/// flou avant composition (contrairement à un tracé direct sur `scene`).
fn draw_shape(
    scene: &mut Pixmap,
    cache: &mut LayerCache,
    shape_el: &crate::model::ShapeElement,
    ctx: &DrawCtx,
) {
    let key = hash_key(&[
        &shape_el.shape_type,
        &shape_el.fill,
        &shape_el.stroke,
        &shape_el.stroke_width.to_bits(),
        &shape_el.border_radius.map(f64::to_bits),
        &shape_el.stroke_dash.map(f64::to_bits),
        &shape_el.gradient_to,
        &shape_el.gradient_angle.map(f64::to_bits),
        &ctx.w.to_bits(),
        &ctx.h.to_bits(),
        &ctx.blur_px.to_bits(),
        &ctx.unit.to_bits(),
    ]);
    let layer = cache.get_or_insert_with(key, || render_shape_layer(shape_el, ctx));
    if let Some(layer) = layer {
        composite_layer(scene, &layer, ctx);
    }
}

fn render_shape_layer(shape_el: &crate::model::ShapeElement, ctx: &DrawCtx) -> Option<Layer> {
    let (w, h, unit) = (ctx.w, ctx.h, ctx.unit);
    let stroke_px = (shape_el.stroke_width as f32 * unit).max(0.0);
    // Le contour est centré sur le tracé : sa moitié extérieure déborde de la boîte.
    let pad = (stroke_px / 2.0).ceil() + ctx.halo() + 1.0;
    let layer_w = (w.ceil() + 2.0 * pad).max(1.0) as u32;
    let layer_h = (h.ceil() + 2.0 * pad).max(1.0) as u32;
    let mut layer = Pixmap::new(layer_w, layer_h)?;
    let path = shape_path(
        shape_el.shape_type,
        pad,
        pad,
        w,
        h,
        shape_el.border_radius.unwrap_or(0.0) as f32 * unit,
    )?;
    let mut paint = Paint {
        anti_alias: true,
        ..Default::default()
    };
    if let Some(gradient_to) = shape_el.gradient_to.as_deref() {
        // Dégradé défini sur le carré unitaire puis étiré à la boîte (comme `objectBoundingBox`
        // en SVG côté preview) : mêmes angles apparents sur une boîte non carrée.
        let angle_rad = (shape_el.gradient_angle.unwrap_or(0.0) as f32).to_radians();
        let (dx, dy) = (angle_rad.cos() / 2.0, angle_rad.sin() / 2.0);
        if let Some(shader) = tiny_skia::LinearGradient::new(
            tiny_skia::Point::from_xy(0.5 - dx, 0.5 - dy),
            tiny_skia::Point::from_xy(0.5 + dx, 0.5 + dy),
            vec![
                tiny_skia::GradientStop::new(0.0, parse_css_color(&shape_el.fill)),
                tiny_skia::GradientStop::new(1.0, parse_css_color(gradient_to)),
            ],
            tiny_skia::SpreadMode::Pad,
            Transform::from_row(w, 0.0, 0.0, h, pad, pad),
        ) {
            paint.shader = shader;
        } else {
            paint.set_color(parse_css_color(&shape_el.fill));
        }
    } else {
        paint.set_color(parse_css_color(&shape_el.fill));
    }
    // Un chemin ouvert (ligne) n'a pas de remplissage : seul son contour est visible.
    if shape_el.shape_type != ShapeType::Line {
        layer.fill_path(
            &path,
            &paint,
            FillRule::Winding,
            Transform::identity(),
            None,
        );
    }

    // Une ligne sans couleur de contour est tracée avec sa couleur de remplissage (comme la
    // preview) ; les autres formes n'ont de contour que si `stroke` est défini.
    let stroke_paint = if shape_el.stroke != "none" {
        let mut p = Paint::default();
        p.set_color(parse_css_color(&shape_el.stroke));
        p.anti_alias = true;
        Some(p)
    } else if shape_el.shape_type == ShapeType::Line {
        Some(paint)
    } else {
        None
    };
    if let Some(stroke_paint) = stroke_paint.filter(|_| stroke_px > 0.01) {
        let dash = shape_el
            .stroke_dash
            .map(|d| d as f32 * unit)
            .filter(|d| *d > 0.5)
            .and_then(|d| tiny_skia::StrokeDash::new(vec![d, d], 0.0));
        let stroke = tiny_skia::Stroke {
            width: stroke_px,
            dash,
            ..Default::default()
        };
        layer.stroke_path(&path, &stroke_paint, &stroke, Transform::identity(), None);
    }

    if ctx.blur_px > 0.5 {
        box_blur(&mut layer, ctx.blur_px);
    }
    Some(Layer {
        pixmap: layer,
        origin: (-pad, -pad),
    })
}

/// Pixmap pré-multiplié à dessiner, avec la taille de l'image d'origine (le pixmap peut être
/// une réduction de la source — voir `Sprite::pixmap_at`).
struct Bitmap<'a> {
    pixmap: &'a Pixmap,
    orig_size: (u32, u32),
}

/// Taille de la zone de contenu (boîte moins les bordures) d'une image/vidéo.
fn inner_size(ctx: &DrawCtx, style: &MediaStyle) -> (f32, f32) {
    let bw = style.border_px(ctx.unit);
    ((ctx.w - 2.0 * bw).max(0.0), (ctx.h - 2.0 * bw).max(0.0))
}

/// Facteurs d'échelle (x, y) de l'image d'origine pour remplir une zone de contenu selon le
/// mode d'ajustement, zoom Ken Burns inclus.
fn fit_scale(fit_mode: FitMode, inner: (f32, f32), orig: (u32, u32), pan_scale: f32) -> (f32, f32) {
    let (w, h) = inner;
    let (iw, ih) = (orig.0.max(1) as f32, orig.1.max(1) as f32);
    let (sx, sy) = match fit_mode {
        FitMode::Stretch => (w / iw, h / ih),
        FitMode::FitWidth => (w / iw, w / iw),
        FitMode::FitHeight => (h / ih, h / ih),
        FitMode::Cover => {
            let s = (w / iw).max(h / ih);
            (s, s)
        }
        FitMode::FitLargest => {
            let s = (w / iw).min(h / ih);
            (s, s)
        }
    };
    (sx * pan_scale, sy * pan_scale)
}

/// Dessine une image (ou une frame vidéo) dans un calque de la taille de la boîte : fond,
/// image ajustée et rognée (coins arrondis), bordure intérieure, puis flou — comme la boîte
/// `overflow: hidden` + `border` de la preview. Le calque est ensuite composé sur la scène.
fn draw_bitmap(
    scene: &mut Pixmap,
    bitmap: Bitmap,
    fit_mode: FitMode,
    ctx: &DrawCtx,
    style: &MediaStyle,
    pan: (f64, f64, f64),
) {
    let Bitmap { pixmap, orig_size } = bitmap;
    let (w, h, unit) = (ctx.w, ctx.h, ctx.unit);
    if w < 1.0 || h < 1.0 || pixmap.width() == 0 || pixmap.height() == 0 {
        return;
    }
    let halo = ctx.halo();
    let layer_w = (w.ceil() + 2.0 * halo).max(1.0) as u32;
    let layer_h = (h.ceil() + 2.0 * halo).max(1.0) as u32;
    let Some(mut layer) = Pixmap::new(layer_w, layer_h) else {
        return;
    };

    let bw = style.border_px(unit);
    let radius = style.corner_radius.unwrap_or(0.0) as f32 * unit;
    let (inner_w, inner_h) = inner_size(ctx, style);
    let (inner_x, inner_y) = (halo + bw, halo + bw);
    let inner_radius = (radius - bw).max(0.0);

    if inner_w >= 1.0 && inner_h >= 1.0 {
        let mut pb = PathBuilder::new();
        rounded_rect_path(&mut pb, inner_x, inner_y, inner_w, inner_h, inner_radius);
        let clip_path = pb.finish();
        if let (Some(bg), Some(path)) = (style.background, clip_path.as_ref()) {
            let mut paint = Paint::default();
            paint.set_color(parse_css_color(bg));
            layer.fill_path(path, &paint, FillRule::Winding, Transform::identity(), None);
        }

        let (pan_scale, pan_dx_pct, pan_dy_pct) = pan;
        let (sx, sy) = fit_scale(fit_mode, (inner_w, inner_h), orig_size, pan_scale as f32);
        let scaled_w = orig_size.0 as f32 * sx;
        let scaled_h = orig_size.1 as f32 * sy;
        let offset_x = inner_x + (inner_w - scaled_w) / 2.0 + (pan_dx_pct / 100.0) as f32 * inner_w;
        let offset_y = inner_y + (inner_h - scaled_h) / 2.0 + (pan_dy_pct / 100.0) as f32 * inner_h;
        // `pixmap` peut être une réduction de la source : l'échelle part de sa propre taille.
        let img_transform = Transform::from_translate(offset_x, offset_y).pre_scale(
            scaled_w / pixmap.width() as f32,
            scaled_h / pixmap.height() as f32,
        );
        // Le rognage (boîte, coins arrondis) n'est nécessaire que si l'image peut déborder.
        let needs_clip = inner_radius > 0.5
            || fit_mode != FitMode::Stretch
            || pan_scale != 1.0
            || pan_dx_pct != 0.0
            || pan_dy_pct != 0.0;
        let mask = clip_path.as_ref().filter(|_| needs_clip).and_then(|path| {
            let mut m = Mask::new(layer_w, layer_h)?;
            m.fill_path(path, FillRule::Winding, true, Transform::identity());
            Some(m)
        });
        layer.draw_pixmap(
            0,
            0,
            pixmap.as_ref(),
            &PixmapPaint {
                quality: FilterQuality::Bilinear,
                ..Default::default()
            },
            img_transform,
            mask.as_ref(),
        );
    }

    if bw > 0.01 {
        if let Some(color) = style.border_color {
            let mut pb = PathBuilder::new();
            rounded_rect_path(&mut pb, halo, halo, w, h, radius);
            if inner_w >= 1.0 && inner_h >= 1.0 {
                rounded_rect_path(&mut pb, inner_x, inner_y, inner_w, inner_h, inner_radius);
            }
            if let Some(ring) = pb.finish() {
                let mut paint = Paint::default();
                paint.set_color(parse_css_color(color));
                paint.anti_alias = true;
                layer.fill_path(
                    &ring,
                    &paint,
                    FillRule::EvenOdd,
                    Transform::identity(),
                    None,
                );
            }
        }
    }

    if ctx.blur_px > 0.5 {
        box_blur(&mut layer, ctx.blur_px);
    }
    composite_layer(
        scene,
        &Layer {
            pixmap: layer,
            origin: (-halo, -halo),
        },
        ctx,
    );
}

fn premultiply(pixmap: &mut Pixmap) {
    for pixel in pixmap.pixels_mut() {
        let a = pixel.alpha();
        if a == 255 {
            continue;
        }
        let r = ((pixel.red() as u16 * a as u16) / 255) as u8;
        let g = ((pixel.green() as u16 * a as u16) / 255) as u8;
        let b = ((pixel.blue() as u16 * a as u16) / 255) as u8;
        *pixel = tiny_skia::PremultipliedColorU8::from_rgba(r, g, b, a).unwrap();
    }
}

/// Rectangle de remplacement quand une source média est illisible : fond de l'élément s'il est
/// défini, sinon un gris neutre.
fn draw_placeholder(scene: &mut Pixmap, background: Option<&str>, ctx: &DrawCtx) {
    let Some(rect) = Rect::from_xywh(ctx.x, ctx.y, ctx.w, ctx.h) else {
        return;
    };
    let mut paint = Paint::default();
    let mut color = background
        .map(parse_css_color)
        .unwrap_or(Color::from_rgba8(40, 40, 48, 255));
    color.set_alpha(color.alpha() * ctx.opacity);
    paint.set_color(color);
    let mut pb = PathBuilder::new();
    pb.push_rect(rect);
    if let Some(path) = pb.finish() {
        scene.fill_path(&path, &paint, FillRule::Winding, ctx.transform, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;

    fn base(id: &str, x: f64, y: f64, width: f64, height: f64) -> ElementBase {
        ElementBase {
            id: id.into(),
            name: id.into(),
            start_time: 0.0,
            duration: None,
            x,
            y,
            width,
            height,
            rotation: 0.0,
            animations: vec![],
            group_id: None,
            blend_mode: None,
        }
    }

    fn shape(id: &str, shape_type: ShapeType, fill: &str) -> ShapeElement {
        ShapeElement {
            base: base(id, 0.0, 0.0, 100.0, 100.0),
            shape_type,
            fill: fill.into(),
            stroke: "none".into(),
            stroke_width: 0.0,
            border_radius: None,
            stroke_dash: None,
            gradient_to: None,
            gradient_angle: None,
        }
    }

    fn text(id: &str, content: &str, font_size: Option<f64>) -> TextElement {
        TextElement {
            base: base(id, 0.0, 0.0, 100.0, 100.0),
            content: content.into(),
            alignment: TextAlign::Left,
            vertical_alignment: VerticalAlign::Top,
            color: "rgba(255,255,255,1)".into(),
            background_color: None,
            font_size,
            font_family: None,
            font_weight: None,
            font_style: None,
            letter_spacing: None,
            line_height: None,
            text_shadow: None,
            underline: false,
            strikethrough: false,
        }
    }

    fn video(id: &str, src: &str) -> VideoElement {
        VideoElement {
            base: base(id, 0.0, 0.0, 100.0, 100.0),
            src: src.into(),
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
        }
    }

    fn project_with(width: u32, height: u32, duration: f64, elements: Vec<Element>) -> Project {
        Project {
            name: "Test".into(),
            width,
            height,
            fps: 10,
            duration,
            compositions: vec![Composition {
                id: "c1".into(),
                name: "Scene 1".into(),
                start_time: 0.0,
                duration,
                elements,
                transition_in: None,
                transition_out: None,
                overlap_next: 0.0,
            }],
            audio_tracks: vec![],
        }
    }

    fn render(project: &Project, t: f64) -> Pixmap {
        FrameRenderer::new().render_frame(project, &std::env::temp_dir(), t)
    }

    fn ctx(x: f32, y: f32, w: f32, h: f32) -> DrawCtx {
        DrawCtx {
            x,
            y,
            w,
            h,
            opacity: 1.0,
            blur_px: 0.0,
            transform: Transform::identity(),
            blend_mode: None,
            unit: 1.0,
        }
    }

    fn draw_shape_now(scene: &mut Pixmap, el: &ShapeElement, ctx: &DrawCtx) {
        draw_shape(scene, &mut LayerCache::default(), el, ctx);
    }

    fn is_lit(p: tiny_skia::PremultipliedColorU8) -> bool {
        p.red() > 50 || p.green() > 50 || p.blue() > 50
    }

    fn lit_pixels(frame: &Pixmap) -> usize {
        frame.pixels().iter().filter(|p| is_lit(**p)).count()
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "letest-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_project() -> Project {
        let mut rect = shape("s1", ShapeType::Rectangle, "rgba(255,0,0,1)");
        rect.base = base("s1", 10.0, 10.0, 30.0, 20.0);
        let mut title = text("t1", "Bonjour", Some(6.0));
        title.base = base("t1", 5.0, 50.0, 90.0, 20.0);
        title.base.animations = vec![Animation {
            animation_type: AnimationType::Fade,
            direction: AnimationDirection::In,
            duration: 1.0,
            easing: Easing::Linear,
            with_fade: true,
        }];
        let mut project = project_with(
            320,
            180,
            3.0,
            vec![Element::Shape(rect), Element::Text(title)],
        );
        project.fps = 30;
        project
    }

    #[test]
    fn draw_bitmap_does_not_panic_on_a_zero_dimension_image() {
        let mut canvas = Pixmap::new(20, 20).unwrap();
        // Un pixmap de dimension nulle ne peut pas exister : le décodage rejette l'image.
        assert!(rgba_to_pixmap(&image::RgbaImage::new(0, 0)).is_none());
        assert_eq!(canvas.pixel(0, 0).unwrap().alpha(), 0);
        canvas.fill(Color::BLACK);
    }

    #[test]
    fn renders_frame_without_panicking() {
        let frame = render(&sample_project(), 0.5);
        assert_eq!((frame.width(), frame.height()), (320, 180));
        // Le pixel de fond (coin bas-droit, hors de tout élément) doit rester noir opaque.
        let bg = frame.pixel(310, 170).unwrap();
        assert_eq!((bg.red(), bg.green(), bg.blue()), (0, 0, 0));
    }

    #[test]
    fn fade_in_animation_increases_opacity_over_time() {
        let project = sample_project();
        let mut renderer = FrameRenderer::new();
        let dir = std::env::temp_dir();
        let early = renderer.render_frame(&project, &dir, 0.05);
        let late = renderer.render_frame(&project, &dir, 0.9);
        assert!(early.pixel(60, 30).unwrap().red() > 200);
        assert!(late.pixel(60, 30).unwrap().red() > 200);
    }

    #[test]
    fn renders_visible_text_pixels() {
        // t=2.0 : après la fin de l'animation de fondu (duration 1.0), texte pleinement opaque.
        let frame = render(&sample_project(), 2.0);
        let found = (90..126).any(|py| (16..304).any(|px| is_lit(frame.pixel(px, py).unwrap())));
        assert!(found, "aucun pixel de glyphe détecté dans la zone du texte");
    }

    #[test]
    fn element_rotation_is_applied_by_the_export() {
        // Rectangle horizontal fin (80% × 10%) : tourné de 90° il devient vertical.
        let make = |rotation: f64| {
            let mut rect = shape("r", ShapeType::Rectangle, "rgba(255,0,0,1)");
            rect.base = base("r", 10.0, 45.0, 80.0, 10.0);
            rect.base.rotation = rotation;
            project_with(200, 200, 1.0, vec![Element::Shape(rect)])
        };
        let flat = render(&make(0.0), 0.0);
        let turned = render(&make(90.0), 0.0);
        // Au-dessus du centre : vide à 0°, rempli à 90°.
        assert_eq!(flat.pixel(100, 40).unwrap().red(), 0);
        assert!(turned.pixel(100, 40).unwrap().red() > 200);
        // Sur le côté du rectangle horizontal : rempli à 0°, vide à 90°.
        assert!(flat.pixel(30, 100).unwrap().red() > 200);
        assert_eq!(turned.pixel(30, 100).unwrap().red(), 0);
    }

    #[test]
    fn default_line_shape_is_visible() {
        // Une ligne créée par l'éditeur a `stroke: "none"` : elle est tracée avec son fond.
        let mut line = shape("l", ShapeType::Line, "rgba(255,0,0,1)");
        line.base = base("l", 10.0, 45.0, 80.0, 10.0);
        line.stroke_width = 3.0;
        let frame = render(
            &project_with(1000, 500, 1.0, vec![Element::Shape(line)]),
            0.0,
        );
        let reds = frame.pixels().iter().filter(|p| p.red() > 150).count();
        assert!(
            reds > 1000,
            "la ligne par défaut doit être dessinée ({reds} px)"
        );
    }

    #[test]
    fn zero_font_size_and_line_height_do_not_panic() {
        let mut zero_size = text("t", "Hello", Some(0.0));
        zero_size.line_height = Some(0.0);
        let frame = render(
            &project_with(200, 100, 1.0, vec![Element::Text(zero_size)]),
            0.0,
        );
        assert_eq!(frame.width(), 200);
    }

    #[test]
    fn autofit_font_size_shrinks_for_smaller_boxes() {
        let text_el = text("t1", "Bonjour tout le monde", None);
        let mut renderer = FrameRenderer::new();
        let large = renderer.text.autofit_font_size_px(&text_el, 400.0, 400.0);
        let small = renderer.text.autofit_font_size_px(&text_el, 80.0, 40.0);
        assert!(
            large > small,
            "une boîte plus petite doit produire une taille de police plus petite (large={large}, small={small})"
        );
        assert!(renderer.text.text_fits_at_size(&text_el, small, 80.0, 40.0));
    }

    #[test]
    fn autofit_result_is_cached() {
        let text_el = text("t1", "Bonjour", None);
        let mut renderer = FrameRenderer::new();
        let first = renderer.text.autofit_font_size_px(&text_el, 300.0, 100.0);
        assert_eq!(renderer.text.autofit.len(), 1);
        assert_eq!(
            renderer.text.autofit_font_size_px(&text_el, 300.0, 100.0),
            first
        );
        assert_eq!(renderer.text.autofit.len(), 1);
    }

    #[test]
    fn typewriter_reveal_grows_the_visible_text_width_over_time() {
        let mut el = text("t1", "WWWWWWWWWWWWWWWWWWWW", Some(8.0));
        el.base.animations = vec![Animation {
            animation_type: AnimationType::Typewriter,
            direction: AnimationDirection::In,
            duration: 2.0,
            easing: Easing::Linear,
            with_fade: false,
        }];
        let project = project_with(400, 100, 2.0, vec![Element::Text(el)]);
        let mut renderer = FrameRenderer::new();
        let dir = std::env::temp_dir();
        let rightmost = |frame: &Pixmap| -> i32 {
            (0..frame.width() as i32)
                .rev()
                .find(|x| (0..frame.height()).any(|y| is_lit(frame.pixel(*x as u32, y).unwrap())))
                .unwrap_or(-1)
        };
        let early = rightmost(&renderer.render_frame(&project, &dir, 0.1));
        let late = rightmost(&renderer.render_frame(&project, &dir, 1.9));
        assert!(early < late, "early={early}, late={late}");
    }

    #[test]
    fn reveal_words_keeps_the_original_separators() {
        let content = "un deux\ntrois  quatre";
        assert_eq!(reveal_words(content, 0), "");
        assert_eq!(reveal_words(content, 1), "un");
        assert_eq!(reveal_words(content, 2), "un deux");
        assert_eq!(reveal_words(content, 3), "un deux\ntrois");
        assert_eq!(reveal_words(content, 4), content);
        assert_eq!(reveal_words(content, 99), content);
    }

    #[test]
    fn line_reveal_hides_whole_paragraphs() {
        let mut el = text("t1", "WWW\nWWW\nWWW\nWWW", Some(8.0));
        el.base.animations = vec![Animation {
            animation_type: AnimationType::LineReveal,
            direction: AnimationDirection::In,
            duration: 2.0,
            easing: Easing::Linear,
            with_fade: false,
        }];
        let project = project_with(200, 200, 2.0, vec![Element::Text(el)]);
        let mut renderer = FrameRenderer::new();
        let dir = std::env::temp_dir();
        let early = lit_pixels(&renderer.render_frame(&project, &dir, 0.6));
        let late = lit_pixels(&renderer.render_frame(&project, &dir, 1.9));
        assert!(early > 0 && early < late, "early={early}, late={late}");
    }

    #[test]
    fn text_overflowing_its_box_is_not_clipped() {
        // Boîte de 10 px de haut pour deux lignes de texte : la preview laisse déborder.
        let mut el = text("t1", "WWW\nWWW", Some(10.0));
        el.base = base("t1", 0.0, 0.0, 100.0, 5.0);
        let frame = render(&project_with(200, 200, 1.0, vec![Element::Text(el)]), 0.0);
        let lowest = (0..frame.height())
            .rev()
            .find(|y| (0..frame.width()).any(|x| is_lit(frame.pixel(x, *y).unwrap())))
            .unwrap_or(0);
        assert!(
            lowest > 10,
            "le texte doit déborder de sa boîte (dernière ligne: {lowest})"
        );
    }

    #[test]
    fn text_shadow_is_blurred_and_offset() {
        let mut el = text("t1", "WWWW", Some(12.0));
        el.color = "rgba(0,0,0,0)".into();
        el.text_shadow = Some("rgba(255,255,255,1)".into());
        el.base = base("t1", 10.0, 10.0, 80.0, 60.0);
        let frame = render(&project_with(400, 200, 1.0, vec![Element::Text(el)]), 0.0);
        let partial = frame
            .pixels()
            .iter()
            .filter(|p| p.red() > 10 && p.red() < 240)
            .count();
        assert!(
            partial > 100,
            "l'ombre doit avoir un dégradé de flou ({partial})"
        );
    }

    #[test]
    fn rounded_rectangle_corners_are_transparent_but_center_is_filled() {
        let path = shape_path(ShapeType::Rectangle, 0.0, 0.0, 100.0, 100.0, 30.0).unwrap();
        let mut pixmap = Pixmap::new(100, 100).unwrap();
        let mut paint = Paint::default();
        paint.set_color(Color::from_rgba8(255, 0, 0, 255));
        pixmap.fill_path(
            &path,
            &paint,
            FillRule::Winding,
            Transform::identity(),
            None,
        );
        assert_eq!(pixmap.pixel(2, 2).unwrap().alpha(), 0);
        assert_eq!(pixmap.pixel(50, 50).unwrap().alpha(), 255);
    }

    #[test]
    fn box_blur_softens_a_hard_edge() {
        let mut pixmap = Pixmap::new(40, 40).unwrap();
        let mut paint = Paint::default();
        paint.set_color(Color::from_rgba8(255, 255, 255, 255));
        let mut pb = PathBuilder::new();
        pb.push_rect(Rect::from_xywh(20.0, 0.0, 20.0, 40.0).unwrap());
        pixmap.fill_path(
            &pb.finish().unwrap(),
            &paint,
            FillRule::Winding,
            Transform::identity(),
            None,
        );
        assert_eq!(pixmap.pixel(19, 20).unwrap().alpha(), 0);
        assert_eq!(pixmap.pixel(20, 20).unwrap().alpha(), 255);
        box_blur(&mut pixmap, 6.0);
        let blurred = pixmap.pixel(19, 20).unwrap().alpha();
        assert!(blurred > 0 && blurred < 255, "alpha={blurred}");
    }

    #[test]
    fn blur_keeps_flat_areas_at_full_intensity() {
        let mut pixmap = Pixmap::new(60, 60).unwrap();
        pixmap.fill(Color::from_rgba8(200, 100, 50, 255));
        box_blur(&mut pixmap, 5.0);
        let p = pixmap.pixel(30, 30).unwrap();
        assert_eq!(
            (p.red(), p.green(), p.blue(), p.alpha()),
            (200, 100, 50, 255)
        );
    }

    #[test]
    fn draw_shape_with_blur_softens_its_edge() {
        let mut el = shape("s1", ShapeType::Rectangle, "rgba(255,0,0,1)");
        el.border_radius = Some(15.0);
        let mut sharp = Pixmap::new(40, 40).unwrap();
        draw_shape_now(&mut sharp, &el, &ctx(0.0, 0.0, 40.0, 40.0));
        let mut blurred = Pixmap::new(40, 40).unwrap();
        let mut blur_ctx = ctx(0.0, 0.0, 40.0, 40.0);
        blur_ctx.blur_px = 8.0;
        draw_shape_now(&mut blurred, &el, &blur_ctx);
        assert_eq!(sharp.pixel(2, 2).unwrap().alpha(), 0);
        assert!(blurred.pixel(2, 2).unwrap().alpha() > 0);
    }

    #[test]
    fn blur_halo_extends_beyond_the_box() {
        let el = shape("s1", ShapeType::Rectangle, "rgba(255,0,0,1)");
        let mut canvas = Pixmap::new(80, 80).unwrap();
        let mut blur_ctx = ctx(30.0, 30.0, 20.0, 20.0);
        blur_ctx.blur_px = 4.0;
        draw_shape_now(&mut canvas, &el, &blur_ctx);
        assert!(
            canvas.pixel(27, 40).unwrap().alpha() > 0,
            "le halo doit déborder de la boîte"
        );
    }

    #[test]
    fn gradient_fill_differs_from_left_to_right() {
        let mut el = shape("s1", ShapeType::Rectangle, "rgba(255,0,0,1)");
        el.gradient_to = Some("rgba(0,0,255,1)".into());
        el.gradient_angle = Some(0.0);
        let mut pixmap = Pixmap::new(40, 40).unwrap();
        draw_shape_now(&mut pixmap, &el, &ctx(0.0, 0.0, 40.0, 40.0));
        let left = pixmap.pixel(2, 20).unwrap();
        let right = pixmap.pixel(37, 20).unwrap();
        assert!(left.red() > right.red() && left.blue() < right.blue());
    }

    #[test]
    fn dashed_stroke_leaves_gaps_along_the_edge() {
        let mut el = shape("s1", ShapeType::Rectangle, "rgba(0,0,0,0)");
        el.stroke = "rgba(255,255,255,1)".into();
        el.stroke_width = 3.0;
        el.stroke_dash = Some(4.0);
        let mut pixmap = Pixmap::new(40, 40).unwrap();
        draw_shape_now(&mut pixmap, &el, &ctx(5.0, 5.0, 30.0, 30.0));
        let alphas: Vec<u8> = (5..35)
            .map(|x| pixmap.pixel(x, 5).unwrap().alpha())
            .collect();
        assert!(
            alphas.iter().any(|a| *a > 200),
            "le contour doit couvrir certaines zones"
        );
        assert!(
            alphas.iter().any(|a| *a < 50),
            "le contour doit laisser des espaces: {alphas:?}"
        );
    }

    #[test]
    fn stroke_width_scales_with_the_canvas_width() {
        let make = |unit: f32| {
            let mut el = shape("s1", ShapeType::Rectangle, "rgba(0,0,0,0)");
            el.stroke = "rgba(255,255,255,1)".into();
            el.stroke_width = 4.0;
            let mut canvas = Pixmap::new(200, 200).unwrap();
            let mut c = ctx(50.0, 50.0, 100.0, 100.0);
            c.unit = unit;
            draw_shape_now(&mut canvas, &el, &c);
            // Épaisseur du contour gauche, mesurée sur la ligne médiane.
            (0..100)
                .filter(|x| canvas.pixel(*x, 100).unwrap().alpha() > 128)
                .count()
        };
        assert!(
            make(2.0) > make(1.0),
            "le contour doit épaissir avec l'unité"
        );
    }

    #[test]
    fn star_is_stretched_to_the_box() {
        let wide = shape_path(ShapeType::Star, 0.0, 0.0, 200.0, 50.0, 0.0).unwrap();
        let bounds = wide.bounds();
        assert!((bounds.width() - 200.0).abs() < 30.0, "{bounds:?}");
        assert!(bounds.height() <= 50.0);
    }

    fn solid_pixmap(w: u32, h: u32, color: [u8; 4]) -> Pixmap {
        let mut pixmap = Pixmap::new(w, h).unwrap();
        pixmap.fill(Color::from_rgba8(color[0], color[1], color[2], color[3]));
        pixmap
    }

    fn draw_solid(
        canvas: &mut Pixmap,
        size: (u32, u32),
        mode: FitMode,
        c: &DrawCtx,
        style: &MediaStyle,
    ) {
        let pixmap = solid_pixmap(size.0, size.1, [255, 0, 0, 255]);
        draw_bitmap(
            canvas,
            Bitmap {
                pixmap: &pixmap,
                orig_size: size,
            },
            mode,
            c,
            style,
            (1.0, 0.0, 0.0),
        );
    }

    #[test]
    fn bitmap_corner_radius_masks_the_corner() {
        let mut canvas = Pixmap::new(40, 40).unwrap();
        let style = MediaStyle {
            corner_radius: Some(15.0),
            ..Default::default()
        };
        draw_solid(
            &mut canvas,
            (20, 20),
            FitMode::Stretch,
            &ctx(0.0, 0.0, 40.0, 40.0),
            &style,
        );
        assert_eq!(canvas.pixel(1, 1).unwrap().alpha(), 0);
        assert_eq!(canvas.pixel(20, 20).unwrap().alpha(), 255);
    }

    #[test]
    fn bitmap_border_is_drawn_inside_the_box() {
        let mut canvas = Pixmap::new(60, 60).unwrap();
        let style = MediaStyle {
            border_color: Some("rgba(0,0,255,1)"),
            border_width: Some(6.0),
            ..Default::default()
        };
        draw_solid(
            &mut canvas,
            (20, 20),
            FitMode::Stretch,
            &ctx(10.0, 10.0, 40.0, 40.0),
            &style,
        );
        let border = canvas.pixel(12, 30).unwrap();
        let content = canvas.pixel(30, 30).unwrap();
        assert!(border.blue() > 200 && border.red() < 50, "{border:?}");
        assert!(content.red() > 200, "{content:?}");
        assert_eq!(
            canvas.pixel(8, 30).unwrap().alpha(),
            0,
            "rien hors de la boîte"
        );
    }

    #[test]
    fn bitmap_border_defaults_to_two_units_when_only_the_color_is_set() {
        let style = MediaStyle {
            border_color: Some("rgba(255,255,255,1)"),
            ..Default::default()
        };
        assert_eq!(style.border_px(3.0), 6.0);
        assert_eq!(MediaStyle::default().border_px(3.0), 0.0);
    }

    #[test]
    fn bitmap_background_shows_through_letterboxing() {
        let mut canvas = Pixmap::new(40, 40).unwrap();
        let style = MediaStyle {
            background: Some("rgba(0,255,0,1)"),
            ..Default::default()
        };
        // Image carrée dans une boîte large, mode « contain » : bandes latérales = fond.
        draw_solid(
            &mut canvas,
            (20, 20),
            FitMode::FitLargest,
            &ctx(0.0, 0.0, 40.0, 20.0),
            &style,
        );
        let side = canvas.pixel(2, 10).unwrap();
        let middle = canvas.pixel(20, 10).unwrap();
        assert!(side.green() > 200 && side.red() < 50, "{side:?}");
        assert!(middle.red() > 200, "{middle:?}");
    }

    #[test]
    fn fit_modes_scale_the_image_differently() {
        let inner = (100.0, 50.0);
        let orig = (100, 100);
        assert_eq!(fit_scale(FitMode::FitWidth, inner, orig, 1.0), (1.0, 1.0));
        assert_eq!(fit_scale(FitMode::FitHeight, inner, orig, 1.0), (0.5, 0.5));
        assert_eq!(fit_scale(FitMode::FitLargest, inner, orig, 1.0), (0.5, 0.5));
        assert_eq!(fit_scale(FitMode::Cover, inner, orig, 1.0), (1.0, 1.0));
        assert_eq!(fit_scale(FitMode::Stretch, inner, orig, 2.0), (2.0, 1.0));
    }

    #[test]
    fn blurred_image_is_blurred_after_scaling() {
        let mut canvas = Pixmap::new(80, 80).unwrap();
        let mut blur_ctx = ctx(20.0, 20.0, 40.0, 40.0);
        blur_ctx.blur_px = 6.0;
        draw_solid(
            &mut canvas,
            (400, 400),
            FitMode::Stretch,
            &blur_ctx,
            &MediaStyle::default(),
        );
        let halo = canvas.pixel(18, 40).unwrap().alpha();
        assert!(halo > 0 && halo < 255, "alpha du halo = {halo}");
    }

    #[test]
    fn sprite_picks_a_reduced_level_for_small_displays() {
        let mut sprite = Sprite::still(solid_pixmap(64, 64, [255, 0, 0, 255]));
        assert_eq!(sprite.pixmap_at(0.0, 1.0).width(), 64);
        assert_eq!(sprite.pixmap_at(0.0, 0.25).width(), 16);
        assert_eq!(sprite.pixmap_at(0.0, 0.3).width(), 32);
    }

    #[test]
    fn wipe_transition_reveals_scene_progressively() {
        let mut project = sample_project();
        project.compositions[0].transition_in = Some(Transition {
            transition_type: TransitionType::WipeRight,
            duration: 1.0,
            easing: Easing::Linear,
        });
        let mut renderer = FrameRenderer::new();
        let dir = std::env::temp_dir();
        let early = renderer.render_frame(&project, &dir, 0.05);
        let early_px = early.pixel(300, 30).unwrap();
        assert_eq!(
            (early_px.red(), early_px.green(), early_px.blue()),
            (0, 0, 0)
        );
        let late = renderer.render_frame(&project, &dir, 2.0);
        assert!(late.pixel(60, 30).unwrap().red() > 200);
    }

    #[test]
    fn overlapping_scenes_are_both_drawn_during_a_crossfade() {
        let mut a = shape("a", ShapeType::Rectangle, "rgba(255,0,0,1)");
        a.base = base("a", 0.0, 0.0, 50.0, 100.0);
        let mut b = shape("b", ShapeType::Rectangle, "rgba(0,0,255,1)");
        b.base = base("b", 50.0, 0.0, 50.0, 100.0);
        let scene = |id: &str, el: Element, start: f64| Composition {
            id: id.into(),
            name: id.into(),
            start_time: start,
            duration: 3.0,
            elements: vec![el],
            transition_in: None,
            transition_out: None,
            overlap_next: 0.0,
        };
        let mut project = project_with(100, 100, 5.0, vec![]);
        project.compositions = vec![
            scene("a", Element::Shape(a), 0.0),
            scene("b", Element::Shape(b), 2.0),
        ];
        project.compositions[0].overlap_next = 1.0;
        let frame = render(&project, 2.5);
        assert!(
            frame.pixel(20, 50).unwrap().red() > 200,
            "la scène A reste visible"
        );
        assert!(
            frame.pixel(80, 50).unwrap().blue() > 200,
            "la scène B apparaît"
        );
    }

    #[test]
    fn crossfade_blends_the_two_scenes() {
        let full = |id: &str, color: &str, start: f64| {
            let mut s = shape(id, ShapeType::Rectangle, color);
            s.base = base(id, 0.0, 0.0, 100.0, 100.0);
            Composition {
                id: id.into(),
                name: id.into(),
                start_time: start,
                duration: 3.0,
                elements: vec![Element::Shape(s)],
                transition_in: (id == "b").then_some(Transition {
                    transition_type: TransitionType::Fade,
                    duration: 1.0,
                    easing: Easing::Linear,
                }),
                transition_out: None,
                overlap_next: 0.0,
            }
        };
        let mut project = project_with(10, 10, 5.0, vec![]);
        project.compositions = vec![
            full("a", "rgba(255,0,0,1)", 0.0),
            full("b", "rgba(0,0,255,1)", 2.0),
        ];
        let mid = render(&project, 2.5).pixel(5, 5).unwrap();
        assert!(
            mid.red() > 60 && mid.blue() > 60,
            "mélange attendu: {mid:?}"
        );
    }

    fn ffmpeg_available() -> bool {
        std::process::Command::new("ffmpeg")
            .arg("-version")
            .output()
            .is_ok()
    }

    fn make_test_video(dir: &Path, color: &str, size: &str, seconds: u32) -> PathBuf {
        let path = dir.join("video.mp4");
        let status = std::process::Command::new("ffmpeg")
            .args(["-y", "-f", "lavfi", "-i"])
            .arg(format!("color=c={color}:s={size}:d={seconds}"))
            .args(["-r", "10", "-pix_fmt", "yuv420p"])
            .arg(&path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .expect("ffmpeg doit être disponible");
        assert!(status.success(), "génération de la vidéo de test échouée");
        path
    }

    #[test]
    fn video_element_renders_real_decoded_frame_not_placeholder() {
        if !ffmpeg_available() {
            return;
        }
        let dir = temp_dir("video");
        make_test_video(&dir, "red", "64x64", 1);
        let project = project_with(
            100,
            100,
            1.0,
            vec![Element::Video(video("v1", "video.mp4"))],
        );
        let mut renderer = FrameRenderer::new();
        let frame = renderer.render_frame(&project, &dir, 0.3);
        let pixel = frame.pixel(50, 50).unwrap();
        assert!(
            pixel.red() > 150 && pixel.green() < 100,
            "pixel attendu rouge, obtenu {pixel:?}"
        );
        assert!(renderer.missing_media.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn video_frames_stream_without_writing_anything_to_disk() {
        if !ffmpeg_available() {
            return;
        }
        let dir = temp_dir("videostream");
        make_test_video(&dir, "blue", "32x32", 1);
        let before = std::fs::read_dir(&dir).unwrap().count();
        let project = project_with(32, 32, 1.0, vec![Element::Video(video("v1", "video.mp4"))]);
        let mut renderer = FrameRenderer::new();
        for i in 0..10 {
            renderer.render_frame(&project, &dir, i as f64 / 10.0);
        }
        assert_eq!(
            renderer.videos.len(),
            1,
            "un seul décodeur ouvert pour l'élément"
        );
        assert_eq!(
            std::fs::read_dir(&dir).unwrap().count(),
            before,
            "aucun fichier créé"
        );
        assert!(renderer.sprites.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn video_decoder_is_closed_once_the_element_is_inactive() {
        if !ffmpeg_available() {
            return;
        }
        let dir = temp_dir("videoclose");
        make_test_video(&dir, "green", "32x32", 2);
        let mut v = video("v1", "video.mp4");
        v.base.duration = Some(0.5);
        let project = project_with(32, 32, 2.0, vec![Element::Video(v)]);
        let mut renderer = FrameRenderer::new();
        renderer.render_frame(&project, &dir, 0.1);
        assert_eq!(renderer.videos.len(), 1);
        renderer.render_frame(&project, &dir, 1.0);
        assert_eq!(renderer.videos.len(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn video_trim_starts_decoding_at_the_in_point() {
        if !ffmpeg_available() {
            return;
        }
        let dir = temp_dir("videotrim");
        // Rouge pendant 1 s puis bleu : un point d'entrée à 1,2 s doit montrer du bleu dès t=0.
        let path = dir.join("video.mp4");
        let status = std::process::Command::new("ffmpeg")
            .args(["-y", "-f", "lavfi", "-i", "color=c=red:s=32x32:d=1:r=10"])
            .args(["-f", "lavfi", "-i", "color=c=blue:s=32x32:d=2:r=10"])
            .args([
                "-filter_complex",
                "[0:v][1:v]concat=n=2:v=1[v]",
                "-map",
                "[v]",
            ])
            .args(["-pix_fmt", "yuv420p"])
            .arg(&path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());
        let mut v = video("v1", "video.mp4");
        v.video_offset = 1.2;
        let project = project_with(32, 32, 1.0, vec![Element::Video(v)]);
        let frame = FrameRenderer::new().render_frame(&project, &dir, 0.0);
        let p = frame.pixel(16, 16).unwrap();
        assert!(p.blue() > 150 && p.red() < 100, "{p:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_media_are_reported_once() {
        let dir = temp_dir("missing");
        let img = ImageElement {
            base: base("i1", 0.0, 0.0, 50.0, 50.0),
            src: "absent.png".into(),
            fit_mode: FitMode::Cover,
            background_color: None,
            image_pan: None,
            corner_radius: None,
            border_color: None,
            border_width: None,
        };
        let project = project_with(
            50,
            50,
            1.0,
            vec![
                Element::Image(img),
                Element::Video(video("v1", "absente.mp4")),
            ],
        );
        let mut renderer = FrameRenderer::new();
        renderer.render_frame(&project, &dir, 0.0);
        renderer.render_frame(&project, &dir, 0.5);
        assert_eq!(renderer.missing_media, vec!["absent.png", "absente.mp4"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn image_element_is_drawn_from_disk_and_cached() {
        let dir = temp_dir("image");
        image::RgbaImage::from_pixel(8, 8, image::Rgba([0, 255, 0, 255]))
            .save(dir.join("pic.png"))
            .unwrap();
        let img = ImageElement {
            base: base("i1", 0.0, 0.0, 100.0, 100.0),
            src: "pic.png".into(),
            fit_mode: FitMode::Stretch,
            background_color: None,
            image_pan: None,
            corner_radius: None,
            border_color: None,
            border_width: None,
        };
        let project = project_with(40, 40, 1.0, vec![Element::Image(img)]);
        let mut renderer = FrameRenderer::new();
        let frame = renderer.render_frame(&project, &dir, 0.0);
        assert!(frame.pixel(20, 20).unwrap().green() > 200);
        renderer.render_frame(&project, &dir, 0.5);
        assert_eq!(renderer.sprites.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn animated_gif_frames_follow_the_timeline() {
        use image::codecs::gif::GifEncoder;
        let dir = temp_dir("gif");
        {
            let file = std::fs::File::create(dir.join("anim.gif")).unwrap();
            let mut encoder = GifEncoder::new(file);
            for color in [[255u8, 0, 0, 255], [0, 0, 255, 255]] {
                let frame = image::Frame::from_parts(
                    image::RgbaImage::from_pixel(8, 8, image::Rgba(color)),
                    0,
                    0,
                    image::Delay::from_numer_denom_ms(500, 1),
                );
                encoder.encode_frame(frame).unwrap();
            }
        }
        let img = ImageElement {
            base: base("i1", 0.0, 0.0, 100.0, 100.0),
            src: "anim.gif".into(),
            fit_mode: FitMode::Stretch,
            background_color: None,
            image_pan: None,
            corner_radius: None,
            border_color: None,
            border_width: None,
        };
        let project = project_with(20, 20, 2.0, vec![Element::Image(img)]);
        let mut renderer = FrameRenderer::new();
        let first = renderer
            .render_frame(&project, &dir, 0.1)
            .pixel(10, 10)
            .unwrap();
        let second = renderer
            .render_frame(&project, &dir, 0.7)
            .pixel(10, 10)
            .unwrap();
        let looped = renderer
            .render_frame(&project, &dir, 1.1)
            .pixel(10, 10)
            .unwrap();
        assert!(first.red() > 200, "{first:?}");
        assert!(second.blue() > 200, "{second:?}");
        assert!(looped.red() > 200, "{looped:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn video_frame_index_clamps_to_the_last_frame_without_loop() {
        assert_eq!(video_frame_index(5.0, 30, 60, false, 0.0), 60);
        assert_eq!(video_frame_index(0.0, 30, 60, false, 0.0), 1);
    }

    #[test]
    fn video_frame_index_loops_back_to_the_trim_in_point() {
        assert_eq!(video_frame_index(2.0, 30, 60, true, 1.0), 31);
        assert_eq!(video_frame_index(2.5, 30, 60, true, 1.0), 46);
        assert_eq!(video_frame_index(2.0, 30, 60, true, 0.0), 1);
    }

    #[test]
    fn font_family_handles_css_lists_and_generic_names() {
        assert!(matches!(font_family(None), Family::Name("Manrope")));
        assert!(matches!(font_family(Some("  ")), Family::Name("Manrope")));
        assert!(matches!(
            font_family(Some("\"Inter\", sans-serif")),
            Family::Name("Inter")
        ));
        assert!(matches!(font_family(Some("monospace")), Family::Monospace));
    }

    #[test]
    fn embedded_manrope_is_available_without_system_fonts() {
        let renderer = FrameRenderer::new();
        let has_manrope = renderer
            .text
            .font_system
            .db()
            .faces()
            .any(|face| face.families.iter().any(|(name, _)| name == "Manrope"));
        assert!(has_manrope);
    }

    fn hello_project(alignment: TextAlign, background: Option<&str>) -> Project {
        let mut el = text("t1", "Hi", Some(6.0));
        el.base = base("t1", 10.0, 10.0, 80.0, 60.0);
        el.alignment = alignment;
        el.background_color = background.map(str::to_string);
        let mut project = project_with(320, 180, 2.0, vec![Element::Text(el)]);
        project.fps = 30;
        project
    }

    #[test]
    fn text_background_color_fills_the_element_box() {
        let frame = render(
            &hello_project(TextAlign::Left, Some("rgba(255,0,0,1)")),
            1.0,
        );
        let px = frame.pixel(280, 120).unwrap();
        assert!(px.red() > 200 && px.green() < 50, "{px:?}");
    }

    #[test]
    fn text_alignment_shifts_glyphs_horizontally() {
        let leftmost = |frame: &Pixmap| -> Option<u32> {
            (0..frame.width())
                .find(|x| (0..frame.height()).any(|y| frame.pixel(*x, y).unwrap().red() > 50))
        };
        let left = leftmost(&render(&hello_project(TextAlign::Left, None), 1.0)).unwrap();
        let right = leftmost(&render(&hello_project(TextAlign::Right, None), 1.0)).unwrap();
        assert!(right > left + 50, "left={left}, right={right}");
    }

    #[test]
    fn bold_text_is_heavier_than_normal_text() {
        let make = |weight: Option<FontWeight>| {
            let mut el = text("t1", "Hamburg", Some(10.0));
            el.base = base("t1", 0.0, 0.0, 100.0, 100.0);
            el.font_weight = weight;
            lit_pixels(&render(
                &project_with(300, 100, 1.0, vec![Element::Text(el)]),
                0.0,
            ))
        };
        assert!(make(Some(FontWeight::Bold)) > make(None));
    }

    #[test]
    fn line_height_is_a_pure_multiplier_of_the_font_size() {
        let mut el = text("t1", "A", Some(10.0));
        el.line_height = Some(1.0);
        assert_eq!(line_height_factor(&el), 1.0);
        el.line_height = None;
        assert_eq!(line_height_factor(&el), 1.25);
        el.line_height = Some(0.0);
        assert!(line_height_factor(&el) > 0.0);
    }

    #[test]
    fn unchanged_text_layer_is_laid_out_once() {
        let project = hello_project(TextAlign::Left, None);
        let mut renderer = FrameRenderer::new();
        let dir = std::env::temp_dir();
        renderer.render_frame(&project, &dir, 0.0);
        let cached = renderer.layers.map.len();
        renderer.render_frame(&project, &dir, 0.5);
        assert_eq!(cached, 1);
        assert_eq!(renderer.layers.map.len(), 1);
    }

    #[test]
    fn layer_cache_is_bounded() {
        let mut cache = LayerCache::default();
        for key in 0..(LAYER_CACHE_CAPACITY as u64 + 10) {
            cache.get_or_insert_with(key, || None);
        }
        assert_eq!(cache.map.len(), LAYER_CACHE_CAPACITY);
    }

    #[test]
    fn css_colors_beyond_rgba_are_rendered() {
        let mut named = shape("s", ShapeType::Rectangle, "tomato");
        named.base = base("s", 0.0, 0.0, 100.0, 100.0);
        let frame = render(&project_with(20, 20, 1.0, vec![Element::Shape(named)]), 0.0);
        let p = frame.pixel(10, 10).unwrap();
        assert!(
            p.red() > 200 && p.green() > 60 && p.green() < 140 && p.blue() < 110,
            "{p:?}"
        );
    }
}
