//! Briques communes des traitements d'image : arrondi, parcours parallèle, flou
//! sensible à la transparence, bornes de dimensions.

use image::{imageops, DynamicImage, ImageBuffer, Primitive, Rgba, RgbaImage};
use rayon::prelude::*;

/// Plus grand côté accepté pour une image produite (redimensionnement, canevas, rotation).
pub const MAX_SIDE: u32 = 30_000;
/// Nombre maximal de pixels d'une image produite : au-delà, l'allocation (4 octets par
/// pixel) risque de faire tuer le processus et de perdre tous les onglets.
pub const MAX_PIXELS: u64 = 200_000_000;

pub fn check_dims(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("Width and height must be greater than 0".to_string());
    }
    if width > MAX_SIDE || height > MAX_SIDE || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(format!(
            "Image size {width}×{height} exceeds the limit ({MAX_SIDE} px per side, {} Mpx)",
            MAX_PIXELS / 1_000_000
        ));
    }
    Ok(())
}

#[inline]
pub fn clamp_u8(v: f32) -> u8 {
    v.clamp(0.0, 255.0).round() as u8
}

#[inline]
pub fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// Profondeur d'un canal : 8 bits (`u8`) ou 16 bits (`u16`). Les traitements sont écrits
/// une seule fois pour les deux ; ils raisonnent sur une échelle 0–255 flottante
/// ([`Sample::to_255`]/[`Sample::from_255`]), si bien qu'une image 16 bits garde toute sa
/// précision au lieu d'être ramenée à 8 bits.
pub trait Sample: Primitive + Send + Sync + 'static {
    /// Valeur maximale du canal.
    const MAX: u32;
    /// Valeur du canal sur l'échelle 0–255 (fractionnaire en 16 bits).
    fn to_255(self) -> f32;
    /// Inverse de [`Sample::to_255`], bornée et arrondie.
    fn from_255(v: f32) -> Self;
    fn raw(self) -> u32;
    fn from_raw(v: u32) -> Self;
    /// L'image sous forme de tampon RGBA de cette profondeur.
    fn buffer_of(img: &DynamicImage) -> ImageBuffer<Rgba<Self>, Vec<Self>>
    where
        Rgba<Self>: image::Pixel<Subpixel = Self>;
    fn into_image(buf: ImageBuffer<Rgba<Self>, Vec<Self>>) -> DynamicImage
    where
        Rgba<Self>: image::Pixel<Subpixel = Self>;
}

impl Sample for u8 {
    const MAX: u32 = 255;
    #[inline]
    fn to_255(self) -> f32 {
        self as f32
    }
    #[inline]
    fn from_255(v: f32) -> Self {
        clamp_u8(v)
    }
    #[inline]
    fn raw(self) -> u32 {
        self as u32
    }
    #[inline]
    fn from_raw(v: u32) -> Self {
        v as u8
    }
    fn buffer_of(img: &DynamicImage) -> RgbaImage {
        img.to_rgba8()
    }
    fn into_image(buf: RgbaImage) -> DynamicImage {
        DynamicImage::ImageRgba8(buf)
    }
}

impl Sample for u16 {
    const MAX: u32 = 65_535;
    #[inline]
    fn to_255(self) -> f32 {
        self as f32 / 257.0
    }
    #[inline]
    fn from_255(v: f32) -> Self {
        (v * 257.0).clamp(0.0, 65_535.0).round() as u16
    }
    #[inline]
    fn raw(self) -> u32 {
        self as u32
    }
    #[inline]
    fn from_raw(v: u32) -> Self {
        v as u16
    }
    fn buffer_of(img: &DynamicImage) -> ImageBuffer<Rgba<u16>, Vec<u16>> {
        img.to_rgba16()
    }
    fn into_image(buf: ImageBuffer<Rgba<u16>, Vec<u16>>) -> DynamicImage {
        DynamicImage::ImageRgba16(buf)
    }
}

/// Vrai si l'image tient sur 8 bits par canal ; sinon on la traite en 16 bits.
pub fn is_8bit(img: &DynamicImage) -> bool {
    matches!(
        img,
        DynamicImage::ImageLuma8(_)
            | DynamicImage::ImageLumaA8(_)
            | DynamicImage::ImageRgb8(_)
            | DynamicImage::ImageRgba8(_)
    )
}

/// Appelle la version générique `$f::<S>(img, args…)` avec la profondeur de l'image.
macro_rules! by_depth {
    ($f:ident, $img:expr $(, $arg:expr)*) => {
        if $crate::imgz::commands::imaging::is_8bit($img) {
            $f::<u8>($img $(, $arg)*)
        } else {
            $f::<u16>($img $(, $arg)*)
        }
    };
}
pub(crate) use by_depth;

/// Applique `f(x, y, pixel)` à chaque pixel, lignes réparties sur tous les cœurs.
pub fn par_pixels<S, F>(img: &mut ImageBuffer<Rgba<S>, Vec<S>>, f: F)
where
    S: Sample,
    F: Fn(u32, u32, &mut [S]) + Sync,
    Rgba<S>: image::Pixel<Subpixel = S>,
{
    let w = img.width() as usize;
    if w == 0 {
        return;
    }
    img.as_mut()
        .par_chunks_mut(w * 4)
        .enumerate()
        .for_each(|(y, row)| {
            for (x, px) in row.as_chunks_mut::<4>().0.iter_mut().enumerate() {
                f(x as u32, y as u32, px);
            }
        });
}

/// Table de correspondance sur toute la plage du canal (256 ou 65 536 entrées) ; `f`
/// reçoit et renvoie une valeur sur l'échelle 0–255.
pub fn build_lut<S: Sample>(f: impl Fn(f32) -> f32) -> Vec<S>
where
    Rgba<S>: image::Pixel<Subpixel = S>,
{
    let max = S::MAX as f32;
    (0..=S::MAX)
        .map(|i| S::from_255(f(i as f32 * 255.0 / max)))
        .collect()
}

/// Applique une table de correspondance aux trois canaux de couleur.
pub fn apply_lut<S: Sample>(img: &mut ImageBuffer<Rgba<S>, Vec<S>>, lut: &[S])
where
    Rgba<S>: image::Pixel<Subpixel = S>,
{
    img.as_mut().par_chunks_mut(4).for_each(|px| {
        px[0] = lut[px[0].raw() as usize];
        px[1] = lut[px[1].raw() as usize];
        px[2] = lut[px[2].raw() as usize];
    });
}

pub(crate) fn premultiply<S: Sample>(img: &mut ImageBuffer<Rgba<S>, Vec<S>>)
where
    Rgba<S>: image::Pixel<Subpixel = S>,
{
    let max = u64::from(S::MAX);
    img.as_mut().par_chunks_mut(4).for_each(|px| {
        let a = u64::from(px[3].raw());
        for c in &mut px[..3] {
            *c = S::from_raw(((u64::from(c.raw()) * a + max / 2) / max) as u32);
        }
    });
}

pub(crate) fn unpremultiply<S: Sample>(img: &mut ImageBuffer<Rgba<S>, Vec<S>>)
where
    Rgba<S>: image::Pixel<Subpixel = S>,
{
    let max = u64::from(S::MAX);
    img.as_mut().par_chunks_mut(4).for_each(|px| {
        let a = u64::from(px[3].raw());
        if a > 0 && a < max {
            for c in &mut px[..3] {
                *c = S::from_raw(((u64::from(c.raw()) * max + a / 2) / a).min(max) as u32);
            }
        }
    });
}

/// Flou gaussien en espace d'encodage. Les images translucides sont floutées en alpha
/// prémultiplié, sans quoi les pixels transparents (noirs) viennent assombrir les bords ; les
/// petits rayons passent par un noyau séparable réparti sur tous les cœurs, les grands par
/// l'approximation en trois passes de boîtes, de coût indépendant du rayon.
pub fn blur_rgba<S: Sample>(
    src: &ImageBuffer<Rgba<S>, Vec<S>>,
    sigma: f32,
) -> ImageBuffer<Rgba<S>, Vec<S>>
where
    Rgba<S>: image::Pixel<Subpixel = S>,
{
    let sigma = sigma.max(0.1);
    if sigma <= SMALL_SIGMA {
        let taps = gauss_taps;
        if let Some(out) = separable(
            src,
            src.width(),
            src.height(),
            &taps(src.width() as usize, sigma),
            &taps(src.height() as usize, sigma),
            false,
        ) {
            return out;
        }
    }
    if src.pixels().all(|p| p[3].raw() == S::MAX) {
        return imageops::fast_blur(src, sigma);
    }
    let mut work = src.clone();
    premultiply(&mut work);
    let mut out = imageops::fast_blur(&work, sigma);
    unpremultiply(&mut out);
    out
}

/// Au-delà de ce rayon, le flou passe par les boîtes (`fast_blur`).
const SMALL_SIGMA: f32 = 4.0;
/// Taille maximale (pixels) d'une image floutée en flottant pour les grands rayons.
const LINEAR_BLUR_MAX_PIXELS: u64 = 12_000_000;

/// Flou gaussien en lumière linéaire : mélanger les valeurs sRGB assombrit les transitions
/// (un flou de noir et blanc donne un gris trop sombre). Même résultat que [`blur_rgba`] sur
/// un aplat ; les très grandes images, trop lourdes en flottant, restent en espace d'encodage.
pub fn blur_linear<S: Sample>(
    src: &ImageBuffer<Rgba<S>, Vec<S>>,
    sigma: f32,
) -> ImageBuffer<Rgba<S>, Vec<S>>
where
    Rgba<S>: image::Pixel<Subpixel = S>,
{
    let sigma = sigma.max(0.1);
    if sigma <= SMALL_SIGMA {
        let (w, h) = (src.width(), src.height());
        if let Some(out) = separable(
            src,
            w,
            h,
            &gauss_taps(w as usize, sigma),
            &gauss_taps(h as usize, sigma),
            true,
        ) {
            return out;
        }
    } else if u64::from(src.width()) * u64::from(src.height()) <= LINEAR_BLUR_MAX_PIXELS {
        let dec = decode_table::<S>(true);
        let mut lin = ImageBuffer::<Rgba<f32>, Vec<f32>>::new(src.width(), src.height());
        lin.as_mut()
            .par_chunks_mut(4)
            .zip(src.as_raw().par_chunks(4))
            .for_each(|(o, p)| decode_px(p, &dec, o));
        let blurred = imageops::fast_blur(&lin, sigma);
        let mut out = ImageBuffer::<Rgba<S>, Vec<S>>::new(src.width(), src.height());
        out.as_mut()
            .par_chunks_mut(4)
            .zip(blurred.as_raw().par_chunks(4))
            .for_each(|(o, a)| encode_px(a, true, o));
        return out;
    }
    blur_rgba(src, sigma)
}

// ── noyaux séparables en flottant (redimensionnement, flou) ──────────────────────

/// Pixels sources (`start`, `weights.len()` consécutifs) contribuant à un pixel de sortie.
pub(crate) struct Taps {
    start: usize,
    weights: Vec<f32>,
}

fn normalised(start: usize, mut weights: Vec<f32>) -> Taps {
    let sum: f32 = weights.iter().sum();
    if sum.abs() > 1e-8 {
        weights.iter_mut().for_each(|w| *w /= sum);
    }
    Taps { start, weights }
}

fn lanczos3(x: f32) -> f32 {
    if x.abs() >= 3.0 {
        return 0.0;
    }
    let sinc = |v: f32| {
        if v == 0.0 {
            1.0
        } else {
            let p = std::f32::consts::PI * v;
            p.sin() / p
        }
    };
    sinc(x) * sinc(x / 3.0)
}

/// Poids de Lanczos3 pour passer de `src` à `dst` pixels sur un axe.
pub(crate) fn lanczos_taps(src: usize, dst: usize) -> Vec<Taps> {
    let ratio = src as f32 / dst as f32;
    let scale = ratio.max(1.0);
    let support = 3.0 * scale;
    (0..dst)
        .map(|i| {
            let center = (i as f32 + 0.5) * ratio;
            let left = ((center - support).floor().max(0.0)) as usize;
            let right = (((center + support).ceil()) as usize).min(src);
            let weights = (left..right)
                .map(|j| lanczos3((j as f32 + 0.5 - center) / scale))
                .collect();
            normalised(left, weights)
        })
        .collect()
}

/// Poids gaussiens (même longueur en entrée et en sortie).
pub(crate) fn gauss_taps(len: usize, sigma: f32) -> Vec<Taps> {
    let r = (sigma * 3.0).ceil() as usize;
    (0..len)
        .map(|i| {
            let left = i.saturating_sub(r);
            let right = (i + r + 1).min(len);
            let weights = (left..right)
                .map(|j| {
                    let d = j as f32 - i as f32;
                    (-d * d / (2.0 * sigma * sigma)).exp()
                })
                .collect();
            normalised(left, weights)
        })
        .collect()
}

#[inline]
fn srgb_to_linear(v: f32) -> f32 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

#[inline]
fn linear_to_srgb(v: f32) -> f32 {
    let v = v.clamp(0.0, 1.0);
    if v <= 0.003_130_8 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

/// Valeur d'un canal de l'échelle 0–255 passée par la lumière linéaire : `f` agit sur des
/// intensités linéaires (0–1).
pub fn in_linear_light(v255: f32, f: impl FnOnce(f32) -> f32) -> f32 {
    linear_to_srgb(f(srgb_to_linear(v255 / 255.0))) * 255.0
}

/// Valeur flottante (0–1) de chaque niveau possible d'un canal, linéarisée ou non.
fn decode_table<S: Sample>(linear: bool) -> Vec<f32> {
    (0..=S::MAX)
        .map(|i| {
            let v = i as f32 / S::MAX as f32;
            if linear {
                srgb_to_linear(v)
            } else {
                v
            }
        })
        .collect()
}

/// Pixel RGBA → flottant prémultiplié.
#[inline]
fn decode_px<S: Sample>(p: &[S], dec: &[f32], out: &mut [f32]) {
    let a = p[3].raw() as f32 / S::MAX as f32;
    for c in 0..3 {
        out[c] = dec[p[c].raw() as usize] * a;
    }
    out[3] = a;
}

/// Flottant prémultiplié → pixel RGBA.
#[inline]
fn encode_px<S: Sample>(acc: &[f32], linear: bool, out: &mut [S]) {
    let a = acc[3].clamp(0.0, 1.0);
    for c in 0..3 {
        let v = if a > 0.0 {
            (acc[c] / a).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let v = if linear { linear_to_srgb(v) } else { v };
        out[c] = S::from_255(v * 255.0);
    }
    out[3] = S::from_255(a * 255.0);
}

/// Intermédiaire flottant maximal (pixels) d'un noyau séparable : 16 octets par pixel.
const MAX_SEPARABLE_PIXELS: usize = 48_000_000;

/// Applique `taps_x` puis `taps_y` (un jeu par pixel de sortie), lignes réparties sur tous
/// les cœurs, en flottant prémultiplié (`linear` : en lumière linéaire). `None` si
/// l'intermédiaire serait trop gros : l'appelant se rabat sur un autre chemin.
pub(crate) fn separable<S: Sample>(
    src: &ImageBuffer<Rgba<S>, Vec<S>>,
    dw: u32,
    dh: u32,
    taps_x: &[Taps],
    taps_y: &[Taps],
    linear: bool,
) -> Option<ImageBuffer<Rgba<S>, Vec<S>>>
where
    Rgba<S>: image::Pixel<Subpixel = S>,
{
    let (sw, sh, dw, dh) = (
        src.width() as usize,
        src.height() as usize,
        dw as usize,
        dh as usize,
    );
    if sw == 0 || sh == 0 || dw == 0 || dh == 0 || dw.checked_mul(sh)? > MAX_SEPARABLE_PIXELS {
        return None;
    }
    let dec = decode_table::<S>(linear);
    let raw = src.as_raw();
    let mut tmp = vec![0f32; dw * sh * 4];
    tmp.par_chunks_mut(dw * 4).enumerate().for_each(|(y, row)| {
        let mut line = vec![0f32; sw * 4];
        for (x, p) in raw[y * sw * 4..(y + 1) * sw * 4]
            .as_chunks::<4>()
            .0
            .iter()
            .enumerate()
        {
            decode_px(p, &dec, &mut line[x * 4..x * 4 + 4]);
        }
        for (dx, t) in taps_x.iter().enumerate() {
            let mut acc = [0f32; 4];
            for (k, w) in t.weights.iter().enumerate() {
                let p = &line[(t.start + k) * 4..(t.start + k) * 4 + 4];
                for c in 0..4 {
                    acc[c] += w * p[c];
                }
            }
            row[dx * 4..dx * 4 + 4].copy_from_slice(&acc);
        }
    });
    let mut out = ImageBuffer::<Rgba<S>, Vec<S>>::new(dw as u32, dh as u32);
    out.as_mut()
        .par_chunks_mut(dw * 4)
        .enumerate()
        .for_each(|(dy, row)| {
            let t = &taps_y[dy];
            let mut acc = vec![0f32; dw * 4];
            for (k, w) in t.weights.iter().enumerate() {
                let line = &tmp[(t.start + k) * dw * 4..(t.start + k + 1) * dw * 4];
                for (a, v) in acc.iter_mut().zip(line) {
                    *a += w * v;
                }
            }
            for (a, o) in acc
                .as_chunks::<4>()
                .0
                .iter()
                .zip(row.as_chunks_mut::<4>().0.iter_mut())
            {
                encode_px(a, linear, o);
            }
        });
    Some(out)
}

/// Redimensionnement de Lanczos3 en lumière linéaire et alpha prémultiplié, réparti sur tous
/// les cœurs. `None` quand l'intermédiaire serait trop gros.
pub fn resize_lanczos_linear<S: Sample>(
    src: &ImageBuffer<Rgba<S>, Vec<S>>,
    width: u32,
    height: u32,
) -> Option<ImageBuffer<Rgba<S>, Vec<S>>>
where
    Rgba<S>: image::Pixel<Subpixel = S>,
{
    separable(
        src,
        width,
        height,
        &lanczos_taps(src.width() as usize, width as usize),
        &lanczos_taps(src.height() as usize, height as usize),
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    #[test]
    fn dimensions_are_bounded() {
        assert!(check_dims(10, 10).is_ok());
        assert!(check_dims(0, 10).is_err());
        assert!(check_dims(MAX_SIDE + 1, 1).is_err());
        assert!(check_dims(20_000, 20_000).is_err());
    }

    #[test]
    fn par_pixels_visits_every_pixel_with_its_coordinates() {
        let mut img = RgbaImage::new(5, 3);
        par_pixels(&mut img, |x, y, p| {
            p[0] = x as u8;
            p[1] = y as u8;
        });
        assert_eq!(img.get_pixel(4, 2).0, [4, 2, 0, 0]);
    }

    #[test]
    fn an_opaque_blur_keeps_a_flat_colour() {
        let img = RgbaImage::from_pixel(8, 8, Rgba([10, 200, 30, 255]));
        let out = blur_rgba(&img, 2.0);
        assert_eq!(out.get_pixel(4, 4).0, [10, 200, 30, 255]);
    }

    #[test]
    fn blurring_does_not_darken_the_edge_of_a_transparent_area() {
        // Moitié gauche rouge opaque, moitié droite transparente (noire).
        let mut img = RgbaImage::from_pixel(16, 16, Rgba([0, 0, 0, 0]));
        for y in 0..16 {
            for x in 0..8 {
                img.put_pixel(x, y, Rgba([255, 0, 0, 255]));
            }
        }
        let out = blur_rgba(&img, 2.0);
        let edge = out.get_pixel(8, 8);
        assert!(edge[3] > 0 && edge[3] < 255);
        // La couleur reste du rouge franc : pas de halo sombre.
        assert!(edge[0] >= 250, "rouge assombri : {edge:?}");
    }

    #[test]
    fn large_radii_use_the_box_approximation_and_stay_flat() {
        let img = RgbaImage::from_pixel(32, 32, Rgba([90, 90, 90, 255]));
        assert_eq!(blur_rgba(&img, 30.0).get_pixel(16, 16).0, [90, 90, 90, 255]);
    }

    // ── lumière linéaire et noyaux séparables ─────────────────────────────────

    fn checker(w: u32, h: u32) -> RgbaImage {
        RgbaImage::from_fn(w, h, |x, y| {
            let v = if (x + y) % 2 == 0 { 0 } else { 255 };
            Rgba([v, v, v, 255])
        })
    }

    #[test]
    fn a_resize_mixes_light_not_encoded_values() {
        // Moitié de lumière blanche = 188 en sRGB, pas 128.
        let out = resize_lanczos_linear(&checker(8, 8), 1, 1).unwrap();
        let v = out.get_pixel(0, 0)[0];
        assert!((180..=196).contains(&v), "gris {v}");
    }

    #[test]
    fn a_resize_keeps_flat_colours_and_alpha_exact() {
        let img = RgbaImage::from_pixel(9, 7, Rgba([10, 200, 30, 255]));
        let out = resize_lanczos_linear(&img, 4, 3).unwrap();
        assert!(out.pixels().all(|p| p.0 == [10, 200, 30, 255]));
        let half = RgbaImage::from_pixel(9, 7, Rgba([10, 200, 30, 128]));
        let out = resize_lanczos_linear(&half, 20, 15).unwrap();
        assert!(out.pixels().all(|p| p.0 == [10, 200, 30, 128]));
    }

    #[test]
    fn a_16_bit_resize_keeps_its_precision() {
        let img = ImageBuffer::<Rgba<u16>, Vec<u16>>::from_pixel(
            6,
            6,
            Rgba([30_000, 40_000, 50_000, 65_535]),
        );
        let out = resize_lanczos_linear(&img, 3, 3).unwrap();
        assert!(out
            .pixels()
            .all(|p| p.0 == [30_000, 40_000, 50_000, 65_535]));
    }

    #[test]
    fn a_linear_blur_of_black_and_white_is_brighter_than_the_encoded_one() {
        let img = checker(16, 16);
        let linear = blur_linear(&img, 3.0).get_pixel(8, 8)[0];
        let encoded = blur_rgba(&img, 3.0).get_pixel(8, 8)[0];
        assert!(linear > encoded + 30, "{linear} vs {encoded}");
        for sigma in [3.0, 8.0] {
            let flat = RgbaImage::from_pixel(20, 20, Rgba([90, 90, 90, 255]));
            assert_eq!(
                blur_linear(&flat, sigma).get_pixel(10, 10).0,
                [90, 90, 90, 255]
            );
        }
    }

    #[test]
    fn the_parallel_blur_matches_a_straight_convolution_on_an_impulse() {
        let mut img = RgbaImage::from_pixel(15, 15, Rgba([0, 0, 0, 255]));
        img.put_pixel(7, 7, Rgba([255, 255, 255, 255]));
        let out = blur_rgba(&img, 1.5);
        // Symétrique, maximum au centre, énergie conservée à l'arrondi près.
        assert_eq!(out.get_pixel(6, 7)[0], out.get_pixel(8, 7)[0]);
        assert!(out.get_pixel(7, 7)[0] > out.get_pixel(6, 7)[0]);
        let sum: u32 = out.pixels().map(|p| u32::from(p[0])).sum();
        assert!((245..=265).contains(&sum), "somme {sum}");
    }

    // ── profondeur 16 bits ────────────────────────────────────────────────────

    use super::super::{adjustments as adj, export, filters as fil, transform};
    use image::{ColorType, ImageFormat};

    /// Dégradé 16 bits dont 64 niveaux distincts tiennent dans un seul niveau 8 bits.
    fn deep_gradient() -> DynamicImage {
        let mut img = ImageBuffer::<Rgba<u16>, Vec<u16>>::new(64, 4);
        for (x, _, p) in img.enumerate_pixels_mut() {
            let v = 20_000 + x as u16;
            *p = Rgba([v, v, v, 65_535]);
        }
        DynamicImage::ImageRgba16(img)
    }

    fn distinct_reds(img: &DynamicImage) -> usize {
        let mut v: Vec<u16> = img.to_rgba16().pixels().map(|p| p[0]).collect();
        v.sort_unstable();
        v.dedup();
        v.len()
    }

    #[test]
    fn a_16_bit_image_stays_16_bit_through_every_colour_op() {
        let img = deep_gradient();
        let results = [
            adj::brightness_contrast(&img, 10.0, 10.0),
            adj::exposure(&img, 0.5),
            adj::hue_saturation(&img, 20.0, 10.0, 5.0),
            adj::vibrance(&img, 30.0),
            adj::levels(&img, 10, 240, 1.2, 0, 255),
            adj::curves(&img, &[[0.0, 0.0], [0.5, 0.6], [1.0, 1.0]]),
            adj::white_balance(&img, 20.0, 10.0),
            adj::sharpen(&img, 50.0, 1.0, 0),
            adj::denoise(&img, 30.0),
            fil::grayscale(&img, 0.3, 0.5, 0.2),
            fil::sepia(&img, 0.5),
            fil::invert(&img),
            fil::vignette(&img, 0.5, 0.5),
            fil::grain(&img, 0.2, false),
            fil::pixelate(&img, 4),
            fil::posterize(&img, 8),
            fil::duotone(&img, [0, 0, 64], [255, 220, 200]),
            fil::sketch(&img),
            fil::lomo(&img, 0.5),
            fil::vintage(&img, 0.5),
            fil::cool(&img, 0.5),
            fil::warm(&img, 0.5),
            fil::fade(&img, 0.5),
            fil::drama(&img, 0.5),
            fil::cross_process(&img, 0.5),
            fil::blur_gaussian(&img, 2.0),
            fil::blur_motion(&img, 0.0, 3),
            fil::blur_radial(&img, 0.3, 8),
            transform::rotate_dynamic(&img, 30.0).unwrap(),
        ];
        for (i, out) in results.iter().enumerate() {
            assert_eq!(out.color(), ColorType::Rgba16, "op #{i} dropped to 8 bits");
        }
    }

    #[test]
    fn a_16_bit_tone_change_keeps_levels_an_8_bit_pipeline_would_merge() {
        let img = deep_gradient();
        assert_eq!(distinct_reds(&img), 64);

        let out = adj::brightness_contrast(&img, 5.0, 0.0);

        assert_eq!(
            distinct_reds(&out),
            64,
            "tone ops must not quantise to 256 levels"
        );
    }

    #[test]
    fn an_identity_adjustment_is_lossless_in_16_bits() {
        let img = deep_gradient();

        let out = adj::curves(&img, &[[0.0, 0.0], [1.0, 1.0]]);

        assert_eq!(out.to_rgba16().as_raw(), img.to_rgba16().as_raw());
    }

    #[test]
    fn an_8_bit_image_stays_8_bit() {
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(4, 4, image::Rgb([9, 9, 9])));
        assert_eq!(adj::exposure(&img, 1.0).color(), ColorType::Rgba8);
        assert_eq!(fil::blur_gaussian(&img, 1.0).color(), ColorType::Rgba8);
    }

    #[test]
    fn png_and_tiff_keep_16_bits_other_formats_still_export() {
        let dir = std::env::temp_dir().join(format!("imgz-depth-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let img = deep_gradient();

        for (fmt, name, deep) in [
            (ImageFormat::Png, "a.png", true),
            (ImageFormat::Tiff, "a.tiff", true),
            (ImageFormat::WebP, "a.webp", false),
            (ImageFormat::Bmp, "a.bmp", false),
            (ImageFormat::Jpeg, "a.jpg", false),
        ] {
            let path = dir.join(name);
            export::write_image(&img, &path, fmt, None).unwrap_or_else(|e| panic!("{name}: {e}"));
            let back = image::open(&path).unwrap();
            let is_deep = !is_8bit(&back);
            assert_eq!(is_deep, deep, "{name}");
        }
        let back = image::open(dir.join("a.png")).unwrap();
        assert_eq!(distinct_reds(&back), 64);
        std::fs::remove_dir_all(&dir).ok();
    }
}
