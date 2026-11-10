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
            for (x, px) in row.chunks_exact_mut(4).enumerate() {
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

fn premultiply<S: Sample>(img: &mut ImageBuffer<Rgba<S>, Vec<S>>)
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

fn unpremultiply<S: Sample>(img: &mut ImageBuffer<Rgba<S>, Vec<S>>)
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

/// Flou gaussien. Les images translucides sont floutées en alpha prémultiplié, sans quoi
/// les pixels transparents (noirs) viennent assombrir les bords ; les grands rayons passent
/// par l'approximation en trois passes de boîtes, de coût indépendant du rayon.
pub fn blur_rgba<S: Sample>(
    src: &ImageBuffer<Rgba<S>, Vec<S>>,
    sigma: f32,
) -> ImageBuffer<Rgba<S>, Vec<S>>
where
    Rgba<S>: image::Pixel<Subpixel = S>,
{
    let sigma = sigma.max(0.1);
    let run = |img: &ImageBuffer<Rgba<S>, Vec<S>>| {
        if sigma > 4.0 {
            imageops::fast_blur(img, sigma)
        } else {
            imageops::blur(img, sigma)
        }
    };
    if src.pixels().all(|p| p[3].raw() == S::MAX) {
        return run(src);
    }
    let mut work = src.clone();
    premultiply(&mut work);
    let mut out = run(&work);
    unpremultiply(&mut out);
    out
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
