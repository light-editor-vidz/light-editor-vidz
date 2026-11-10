use image::{DynamicImage, ImageBuffer, Rgba};

use super::imaging::{blur_rgba, by_depth, is_8bit, par_pixels, Sample};
pub use super::imaging::{clamp_u8, lerp};

// ── helpers ───────────────────────────────────────────────────────────────────

fn vignette_factor(x: u32, y: u32, w: u32, h: u32, strength: f32, feather: f32) -> f32 {
    let ndx = (x as f32 / w as f32) * 2.0 - 1.0;
    let ndy = (y as f32 / h as f32) * 2.0 - 1.0;
    let dist = (ndx * ndx + ndy * ndy).sqrt() / std::f32::consts::SQRT_2;
    let t = ((dist - (1.0 - feather)) / feather.max(0.01)).clamp(0.0, 1.0);
    1.0 - strength * t * t
}

fn hash_noise(x: u32, y: u32, channel: u32) -> f32 {
    let h = x
        .wrapping_mul(2246822519)
        .wrapping_add(y.wrapping_mul(3266489917))
        .wrapping_add(channel.wrapping_mul(668265263));
    let h = h ^ (h >> 16);
    (h as f32) / (u32::MAX as f32)
}

fn adjust_saturation(r: f32, g: f32, b: f32, factor: f32) -> (f32, f32, f32) {
    let luma = 0.299 * r + 0.587 * g + 0.114 * b;
    (
        lerp(luma, r, factor),
        lerp(luma, g, factor),
        lerp(luma, b, factor),
    )
}

fn adjust_contrast_pixel(v: f32, factor: f32) -> f32 {
    ((v - 128.0) * factor + 128.0).clamp(0.0, 255.0)
}

type Buf<S> = ImageBuffer<Rgba<S>, Vec<S>>;

/// Applique `f` à la couleur (r, g, b) de chaque pixel (échelle 0–255), l'alpha étant
/// conservé.
fn map_rgb_buf<S, F>(rgba: &mut Buf<S>, f: F)
where
    S: Sample,
    Rgba<S>: image::Pixel<Subpixel = S>,
    F: Fn(u32, u32, f32, f32, f32) -> (f32, f32, f32) + Sync,
{
    par_pixels(rgba, |x, y, px| {
        let (r, g, b) = f(x, y, px[0].to_255(), px[1].to_255(), px[2].to_255());
        px[0] = S::from_255(r);
        px[1] = S::from_255(g);
        px[2] = S::from_255(b);
    });
}

fn map_rgb<F>(img: &DynamicImage, f: F) -> DynamicImage
where
    F: Fn(u32, u32, f32, f32, f32) -> (f32, f32, f32) + Sync,
{
    fn run<S, F>(img: &DynamicImage, f: F) -> DynamicImage
    where
        S: Sample,
        Rgba<S>: image::Pixel<Subpixel = S>,
        F: Fn(u32, u32, f32, f32, f32) -> (f32, f32, f32) + Sync,
    {
        let mut rgba: Buf<S> = S::buffer_of(img);
        map_rgb_buf(&mut rgba, f);
        S::into_image(rgba)
    }
    if is_8bit(img) {
        run::<u8, _>(img, f)
    } else {
        run::<u16, _>(img, f)
    }
}

fn sepia_of(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    (
        (0.393 * r + 0.769 * g + 0.189 * b).min(255.0),
        (0.349 * r + 0.686 * g + 0.168 * b).min(255.0),
        (0.272 * r + 0.534 * g + 0.131 * b).min(255.0),
    )
}

// ── filters (pure: image in, image out) ───────────────────────────────────────

/// Conversion en niveaux de gris avec un poids par canal.
pub fn grayscale(img: &DynamicImage, r_weight: f32, g_weight: f32, b_weight: f32) -> DynamicImage {
    map_rgb(img, |_, _, r, g, b| {
        let luma = (r_weight * r + g_weight * g + b_weight * b).clamp(0.0, 255.0);
        (luma, luma, luma)
    })
}

/// Sépia d'intensité variable (0.0–1.0).
pub fn sepia(img: &DynamicImage, intensity: f32) -> DynamicImage {
    map_rgb(img, |_, _, r, g, b| {
        let (sr, sg, sb) = sepia_of(r, g, b);
        (
            lerp(r, sr, intensity),
            lerp(g, sg, intensity),
            lerp(b, sb, intensity),
        )
    })
}

/// Inverse les canaux de couleur (alpha conservé).
pub fn invert(img: &DynamicImage) -> DynamicImage {
    map_rgb(img, |_, _, r, g, b| (255.0 - r, 255.0 - g, 255.0 - b))
}

/// Vignettage : assombrissement radial.
pub fn vignette(img: &DynamicImage, strength: f32, feather: f32) -> DynamicImage {
    let (w, h) = (img.width(), img.height());
    map_rgb(img, |x, y, r, g, b| {
        let f = vignette_factor(x, y, w, h, strength, feather);
        (r * f, g * f, b * f)
    })
}

/// Grain de film ; `monochrome` ajoute le même bruit aux trois canaux.
pub fn grain(img: &DynamicImage, amount: f32, monochrome: bool) -> DynamicImage {
    let noise_range = amount * 80.0;
    map_rgb(img, |x, y, r, g, b| {
        if monochrome {
            let n = (hash_noise(x, y, 0) - 0.5) * noise_range;
            (r + n, g + n, b + n)
        } else {
            (
                r + (hash_noise(x, y, 0) - 0.5) * noise_range,
                g + (hash_noise(x, y, 1) - 0.5) * noise_range,
                b + (hash_noise(x, y, 2) - 0.5) * noise_range,
            )
        }
    })
}

/// Pixelisation en blocs de `size` pixels ; chaque bloc prend la **moyenne** de ses pixels
/// (échantillonner un seul pixel donnerait un résultat instable et crénelé).
pub fn pixelate(img: &DynamicImage, size: u32) -> DynamicImage {
    fn run<S>(img: &DynamicImage, size: u32) -> DynamicImage
    where
        S: Sample,
        Rgba<S>: image::Pixel<Subpixel = S>,
    {
        let src: Buf<S> = S::buffer_of(img);
        let (w, h) = (src.width(), src.height());
        let size = size.max(1);
        if w == 0 || h == 0 {
            return S::into_image(src);
        }
        let bw = w.div_ceil(size);
        let bh = h.div_ceil(size);
        let mut sums = vec![[0u64; 5]; (bw * bh) as usize];
        for (x, y, p) in src.enumerate_pixels() {
            let cell = &mut sums[((y / size) * bw + x / size) as usize];
            for c in 0..4 {
                cell[c] += u64::from(p[c].raw());
            }
            cell[4] += 1;
        }
        let mut out = src;
        par_pixels(&mut out, |x, y, px| {
            let cell = &sums[((y / size) * bw + x / size) as usize];
            for c in 0..4 {
                px[c] = S::from_raw(((cell[c] + cell[4] / 2) / cell[4]) as u32);
            }
        });
        S::into_image(out)
    }
    by_depth!(run, img, size)
}

/// Réduit le nombre de valeurs distinctes par canal.
pub fn posterize(img: &DynamicImage, levels: u8) -> DynamicImage {
    let step = 255.0 / (levels.max(2) as f32 - 1.0);
    map_rgb(img, |_, _, r, g, b| {
        let q = |c: f32| ((c / step).round() * step).clamp(0.0, 255.0);
        (q(r), q(g), q(b))
    })
}

/// Associe les ombres à une couleur et les hautes lumières à une autre.
pub fn duotone(img: &DynamicImage, shadow: [u8; 3], highlight: [u8; 3]) -> DynamicImage {
    map_rgb(img, |_, _, r, g, b| {
        let t = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
        (
            lerp(shadow[0] as f32, highlight[0] as f32, t),
            lerp(shadow[1] as f32, highlight[1] as f32, t),
            lerp(shadow[2] as f32, highlight[2] as f32, t),
        )
    })
}

/// Crayon : fusion « densité couleur » du gris et du gris inversé flouté. Le flou est
/// proportionnel à la taille de l'image, pour un rendu identique quelle que soit la
/// résolution.
pub fn sketch(img: &DynamicImage) -> DynamicImage {
    fn run<S>(img: &DynamicImage) -> DynamicImage
    where
        S: Sample,
        Rgba<S>: image::Pixel<Subpixel = S>,
    {
        let mut gray: Buf<S> = S::buffer_of(img);
        map_rgb_buf(&mut gray, |_, _, r, g, b| {
            let luma = (0.299 * r + 0.587 * g + 0.114 * b).clamp(0.0, 255.0);
            (luma, luma, luma)
        });
        let mut inverted = gray.clone();
        map_rgb_buf(&mut inverted, |_, _, r, g, b| {
            (255.0 - r, 255.0 - g, 255.0 - b)
        });
        let sigma = (gray.width().max(gray.height()) as f32 / 150.0).clamp(2.0, 40.0);
        let blurred = blur_rgba(&inverted, sigma);
        let mut result = gray;
        par_pixels(&mut result, |x, y, px| {
            let gray_val = px[0].to_255();
            let blur_val = blurred.get_pixel(x, y)[0].to_255();
            let dodged = if blur_val >= 255.0 {
                255.0
            } else {
                (gray_val * 255.0 / (255.0 - blur_val)).min(255.0)
            };
            px[0] = S::from_255(dodged);
            px[1] = S::from_255(dodged);
            px[2] = S::from_255(dodged);
        });
        S::into_image(result)
    }
    by_depth!(run, img)
}

/// Lomo : saturé, contrasté, vignetté fort.
pub fn lomo(img: &DynamicImage, intensity: f32) -> DynamicImage {
    let (w, h) = (img.width(), img.height());
    let sat_factor = 1.0 + intensity * 0.5;
    let contrast_factor = 1.0 + intensity * 0.3;
    let darken = 1.0 - intensity * 0.1;
    map_rgb(img, |x, y, r, g, b| {
        let (r, g, b) = adjust_saturation(r, g, b, sat_factor);
        let r = adjust_contrast_pixel(r, contrast_factor) * darken;
        let g = adjust_contrast_pixel(g, contrast_factor) * darken;
        let b = adjust_contrast_pixel(b, contrast_factor) * darken;
        let vf = vignette_factor(x, y, w, h, intensity * 0.7, 0.5);
        (r * vf, g * vf, b * vf)
    })
}

/// Look pellicule ancienne : sépia léger, noirs relevés, dominante chaude.
pub fn vintage(img: &DynamicImage, intensity: f32) -> DynamicImage {
    map_rgb(img, |_, _, r, g, b| {
        let (sr, sg, sb) = sepia_of(r, g, b);
        let (r, g, b) = (
            lerp(r, sr, 0.35 * intensity),
            lerp(g, sg, 0.35 * intensity),
            lerp(b, sb, 0.35 * intensity),
        );
        let (r, g, b) = (
            r + 25.0 * intensity,
            g + 25.0 * intensity,
            b + 25.0 * intensity,
        );
        let k = 1.0 - 0.15 * intensity;
        let (r, g, b) = (
            (r - 128.0) * k + 128.0,
            (g - 128.0) * k + 128.0,
            (b - 128.0) * k + 128.0,
        );
        (r + 10.0 * intensity, g, b - 8.0 * intensity)
    })
}

/// Dominante froide : moins de rouge, plus de bleu.
pub fn cool(img: &DynamicImage, intensity: f32) -> DynamicImage {
    map_rgb(img, |_, _, r, g, b| {
        (
            r - 20.0 * intensity,
            g + 5.0 * intensity,
            b + 25.0 * intensity,
        )
    })
}

/// Dominante chaude : plus de rouge, moins de bleu.
pub fn warm(img: &DynamicImage, intensity: f32) -> DynamicImage {
    map_rgb(img, |_, _, r, g, b| {
        (
            r + 25.0 * intensity,
            g + 10.0 * intensity,
            b - 20.0 * intensity,
        )
    })
}

/// Look délavé : noirs relevés, contraste réduit, légère désaturation.
pub fn fade(img: &DynamicImage, intensity: f32) -> DynamicImage {
    map_rgb(img, |_, _, r, g, b| {
        let (r, g, b) = (
            r + 40.0 * intensity,
            g + 40.0 * intensity,
            b + 40.0 * intensity,
        );
        let k = 1.0 - 0.3 * intensity;
        let (r, g, b) = (
            (r - 128.0) * k + 128.0,
            (g - 128.0) * k + 128.0,
            (b - 128.0) * k + 128.0,
        );
        adjust_saturation(r, g, b, 1.0 - 0.15 * intensity)
    })
}

/// Look dramatique : contraste marqué, assombri, légèrement désaturé.
pub fn drama(img: &DynamicImage, intensity: f32) -> DynamicImage {
    map_rgb(img, |_, _, r, g, b| {
        let k = 1.0 + 0.5 * intensity;
        let darken = 1.0 - 0.15 * intensity;
        let (r, g, b) = (
            ((r - 128.0) * k + 128.0) * darken,
            ((g - 128.0) * k + 128.0) * darken,
            ((b - 128.0) * k + 128.0) * darken,
        );
        adjust_saturation(r, g, b, 1.0 - 0.2 * intensity)
    })
}

/// Traitement croisé : canaux décalés, saturation et contraste accrus.
pub fn cross_process(img: &DynamicImage, intensity: f32) -> DynamicImage {
    map_rgb(img, |_, _, r, g, b| {
        let g = g + 20.0 * intensity;
        let b = b + (b / 255.0) * 30.0 * intensity;
        let r = r + (1.0 - r / 255.0) * 20.0 * intensity;
        let k = 1.0 + 0.2 * intensity;
        let (r, g, b) = (
            (r - 128.0) * k + 128.0,
            (g - 128.0) * k + 128.0,
            (b - 128.0) * k + 128.0,
        );
        adjust_saturation(r, g, b, 1.0 + 0.3 * intensity)
    })
}

/// Flou gaussien de rayon réglable.
pub fn blur_gaussian(img: &DynamicImage, radius: f32) -> DynamicImage {
    fn run<S>(img: &DynamicImage, radius: f32) -> DynamicImage
    where
        S: Sample,
        Rgba<S>: image::Pixel<Subpixel = S>,
    {
        S::into_image(blur_rgba(&S::buffer_of(img), radius))
    }
    by_depth!(run, img, radius)
}

/// Flou de mouvement le long d'un angle (degrés) sur `distance` pixels de chaque côté.
pub fn blur_motion(img: &DynamicImage, angle: f32, distance: u32) -> DynamicImage {
    fn run<S>(img: &DynamicImage, angle: f32, distance: u32) -> DynamicImage
    where
        S: Sample,
        Rgba<S>: image::Pixel<Subpixel = S>,
    {
        let rgba: Buf<S> = S::buffer_of(img);
        let (w, h) = (rgba.width() as i32, rgba.height() as i32);
        let distance = distance.clamp(1, 100) as i32;
        let rad = angle.to_radians();
        let (dx, dy) = (rad.cos(), rad.sin());
        // Décalages entiers distincts, calculés une fois pour toute l'image.
        let mut offsets: Vec<(i32, i32)> = (-distance..=distance)
            .map(|i| {
                (
                    (i as f32 * dx).round() as i32,
                    (i as f32 * dy).round() as i32,
                )
            })
            .collect();
        offsets.dedup();
        let mut result = rgba.clone();
        par_pixels(&mut result, |x, y, px| {
            let (mut sum, mut count) = ([0f32; 3], 0f32);
            for &(ox, oy) in &offsets {
                let (sx, sy) = (x as i32 + ox, y as i32 + oy);
                if sx >= 0 && sx < w && sy >= 0 && sy < h {
                    let p = rgba.get_pixel(sx as u32, sy as u32);
                    sum[0] += p[0].to_255();
                    sum[1] += p[1].to_255();
                    sum[2] += p[2].to_255();
                    count += 1.0;
                }
            }
            if count > 0.0 {
                px[0] = S::from_255(sum[0] / count);
                px[1] = S::from_255(sum[1] / count);
                px[2] = S::from_255(sum[2] / count);
            }
        });
        S::into_image(result)
    }
    by_depth!(run, img, angle, distance)
}

/// Flou radial (zoom) depuis le centre de l'image.
pub fn blur_radial(img: &DynamicImage, strength: f32, samples: u32) -> DynamicImage {
    fn run<S>(img: &DynamicImage, strength: f32, samples: u32) -> DynamicImage
    where
        S: Sample,
        Rgba<S>: image::Pixel<Subpixel = S>,
    {
        let rgba: Buf<S> = S::buffer_of(img);
        let (w, h) = (rgba.width(), rgba.height());
        let samples = samples.clamp(4, 32);
        let (cx, cy) = (w as f32 / 2.0, h as f32 / 2.0);
        let strength = strength.clamp(0.0, 0.95);
        let mut result = rgba.clone();
        par_pixels(&mut result, |x, y, px| {
            let mut sum = [0f32; 3];
            for i in 0..samples {
                let t = i as f32 / (samples - 1) as f32;
                let scale = 1.0 - t * strength;
                let sx = (cx + (x as f32 - cx) * scale)
                    .round()
                    .clamp(0.0, (w - 1) as f32) as u32;
                let sy = (cy + (y as f32 - cy) * scale)
                    .round()
                    .clamp(0.0, (h - 1) as f32) as u32;
                let p = rgba.get_pixel(sx, sy);
                sum[0] += p[0].to_255();
                sum[1] += p[1].to_255();
                sum[2] += p[2].to_255();
            }
            px[0] = S::from_255(sum[0] / samples as f32);
            px[1] = S::from_255(sum[1] / samples as f32);
            px[2] = S::from_255(sum[2] / samples as f32);
        });
        S::into_image(result)
    }
    by_depth!(run, img, strength, samples)
}

// ── unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vignette_factor_center_is_one() {
        let w = 100u32;
        let h = 100u32;
        // Centre pixel: (50, 50) → ndx=0, ndy=0, dist=0
        // dist < (1 - feather) so t clamped to 0, factor = 1.0
        let f = vignette_factor(50, 50, w, h, 1.0, 0.5);
        assert!(
            (f - 1.0).abs() < 0.01,
            "centre factor should be ~1.0, got {f}"
        );
    }

    #[test]
    fn vignette_factor_corner_less_than_center() {
        let w = 100u32;
        let h = 100u32;
        let center = vignette_factor(50, 50, w, h, 0.8, 0.5);
        let corner = vignette_factor(0, 0, w, h, 0.8, 0.5);
        assert!(
            corner < center,
            "corner factor ({corner}) should be less than center factor ({center})"
        );
    }

    #[test]
    fn hash_noise_range_zero_to_one() {
        // Sample a grid of positions and verify all values are in [0, 1]
        for y in 0u32..8 {
            for x in 0u32..8 {
                for ch in 0u32..3 {
                    let n = hash_noise(x, y, ch);
                    assert!(
                        (0.0..=1.0).contains(&n),
                        "hash_noise({x},{y},{ch}) = {n} is out of [0,1]"
                    );
                }
            }
        }
    }
    // ── pure helpers ─────────────────────────────────────────────────────────

    #[test]
    fn clamp_u8_pins_values_to_the_byte_range() {
        assert_eq!(clamp_u8(-40.0), 0);
        assert_eq!(clamp_u8(0.0), 0);
        assert_eq!(clamp_u8(127.9), 128);
        assert_eq!(clamp_u8(255.0), 255);
        assert_eq!(clamp_u8(1000.0), 255);
    }

    #[test]
    fn lerp_returns_the_endpoints_and_the_midpoint() {
        assert_eq!(lerp(0.0, 10.0, 0.0), 0.0);
        assert_eq!(lerp(0.0, 10.0, 1.0), 10.0);
        assert_eq!(lerp(0.0, 10.0, 0.5), 5.0);
    }

    #[test]
    fn lerp_extrapolates_past_the_endpoints() {
        assert_eq!(lerp(0.0, 10.0, 2.0), 20.0);
        assert_eq!(lerp(0.0, 10.0, -1.0), -10.0);
    }

    #[test]
    fn vignette_leaves_the_centre_untouched() {
        // The centre of a 100x100 image is the least darkened point.
        let centre = vignette_factor(50, 50, 100, 100, 1.0, 0.5);
        let corner = vignette_factor(0, 0, 100, 100, 1.0, 0.5);
        assert!(centre > corner);
        assert!((centre - 1.0).abs() < 1e-3);
    }

    #[test]
    fn vignette_darkens_more_as_strength_grows() {
        let weak = vignette_factor(0, 0, 100, 100, 0.2, 0.5);
        let strong = vignette_factor(0, 0, 100, 100, 1.0, 0.5);
        assert!(strong < weak);
    }

    #[test]
    fn vignette_stays_within_a_sane_range() {
        for x in [0u32, 25, 50, 75, 99] {
            for y in [0u32, 25, 50, 75, 99] {
                let f = vignette_factor(x, y, 100, 100, 1.0, 0.5);
                assert!(
                    (0.0..=1.0).contains(&f),
                    "factor {f} out of range at {x},{y}"
                );
            }
        }
    }

    #[test]
    fn vignette_survives_a_zero_feather() {
        // `feather.max(0.01)` guards the division; without it this would be NaN.
        let f = vignette_factor(0, 0, 100, 100, 1.0, 0.0);
        assert!(f.is_finite());
    }

    #[test]
    fn noise_is_deterministic_for_a_given_pixel() {
        assert_eq!(hash_noise(3, 7, 1), hash_noise(3, 7, 1));
    }

    #[test]
    fn noise_differs_across_pixels_and_channels() {
        assert_ne!(hash_noise(3, 7, 0), hash_noise(4, 7, 0));
        assert_ne!(hash_noise(3, 7, 0), hash_noise(3, 8, 0));
        assert_ne!(hash_noise(3, 7, 0), hash_noise(3, 7, 1));
    }

    #[test]
    fn noise_stays_between_zero_and_one() {
        for x in 0..20u32 {
            for y in 0..20u32 {
                let n = hash_noise(x, y, 0);
                assert!((0.0..=1.0).contains(&n), "noise {n} out of range");
            }
        }
    }

    #[test]
    fn saturation_of_one_leaves_the_colour_alone() {
        let (r, g, b) = adjust_saturation(10.0, 100.0, 200.0, 1.0);
        assert!((r - 10.0).abs() < 1e-3);
        assert!((g - 100.0).abs() < 1e-3);
        assert!((b - 200.0).abs() < 1e-3);
    }

    #[test]
    fn saturation_of_zero_collapses_to_luma() {
        let (r, g, b) = adjust_saturation(10.0, 100.0, 200.0, 0.0);
        assert!((r - g).abs() < 1e-3);
        assert!((g - b).abs() < 1e-3);
    }

    #[test]
    fn saturation_above_one_pushes_channels_apart() {
        let (r0, _, b0) = adjust_saturation(10.0, 100.0, 200.0, 1.0);
        let (r1, _, b1) = adjust_saturation(10.0, 100.0, 200.0, 2.0);
        assert!((b1 - r1).abs() > (b0 - r0).abs());
    }

    #[test]
    fn contrast_of_one_is_a_no_op() {
        assert!((adjust_contrast_pixel(70.0, 1.0) - 70.0).abs() < 1e-3);
    }

    #[test]
    fn contrast_pivots_around_mid_grey() {
        assert!((adjust_contrast_pixel(128.0, 3.0) - 128.0).abs() < 1e-3);
        assert!(adjust_contrast_pixel(200.0, 2.0) > 200.0);
        assert!(adjust_contrast_pixel(50.0, 2.0) < 50.0);
    }

    #[test]
    fn contrast_never_leaves_the_byte_range() {
        assert_eq!(adjust_contrast_pixel(255.0, 10.0), 255.0);
        assert_eq!(adjust_contrast_pixel(0.0, 10.0), 0.0);
    }

    #[test]
    fn a_contrast_below_one_flattens_towards_mid_grey() {
        let flattened = adjust_contrast_pixel(200.0, 0.5);
        assert!(flattened < 200.0 && flattened > 128.0);
    }
}

// ── command tests ─────────────────────────────────────────────────────────────
//
// Ceux-ci exécutent les vraies commandes via une app Tauri mock, plutôt que de
// recopier leurs formules — voir `crate::imgz::test_support`.

#[cfg(test)]
mod command_tests {
    use super::*;
    use crate::imgz::commands::open::ImageMeta;
    use crate::imgz::commands::pipeline::compat::*;
    use crate::imgz::test_support::{checker, gradient, solid, solid_alpha, Harness, TAB};
    use crate::imgz::AppState;
    use tauri::State;

    // ── contrat commun à toutes les commandes ────────────────────────────────

    #[test]
    fn a_filter_pushes_exactly_one_history_entry() {
        let h = Harness::with_image(solid(4, 4, [100, 150, 200]));
        assert_eq!(h.history_len(), 1);

        let meta = filter_invert(h.state(), TAB.into()).unwrap();

        assert_eq!(h.history_len(), 2);
        assert!(meta.can_undo);
        assert!(!meta.can_redo);
        assert_eq!((meta.width, meta.height), (4, 4));
        assert_eq!(meta.format, "png");
        assert!(meta.preview.contains("lcimg") || meta.preview.contains("lcimg.localhost"));
    }

    #[test]
    fn an_unknown_tab_is_rejected() {
        let h = Harness::empty();
        assert_eq!(
            filter_invert(h.state(), "nope".into()).unwrap_err(),
            "Tab not found"
        );
    }

    #[test]
    fn a_tab_without_an_image_is_rejected() {
        let h = Harness::without_image();
        assert_eq!(
            filter_invert(h.state(), TAB.into()).unwrap_err(),
            "No image loaded"
        );
    }

    #[test]
    fn every_filter_reports_a_missing_image() {
        // Un seul point d'entrée par commande : on vérifie que le garde-fou est bien
        // posé partout, pas seulement sur `filter_invert`.
        let h = Harness::without_image();
        let t = || TAB.to_string();
        let errs = vec![
            filter_grayscale(h.state(), t(), 0.3, 0.6, 0.1).unwrap_err(),
            filter_sepia(h.state(), t(), 1.0).unwrap_err(),
            filter_vignette(h.state(), t(), 0.5, 0.5).unwrap_err(),
            filter_grain(h.state(), t(), 0.5, true).unwrap_err(),
            filter_pixelate(h.state(), t(), 4).unwrap_err(),
            filter_posterize(h.state(), t(), 4).unwrap_err(),
            filter_duotone(h.state(), t(), 0, 0, 0, 255, 255, 255).unwrap_err(),
            filter_sketch(h.state(), t()).unwrap_err(),
            filter_lomo(h.state(), t(), 1.0).unwrap_err(),
            filter_vintage(h.state(), t(), 1.0).unwrap_err(),
            filter_cool(h.state(), t(), 1.0).unwrap_err(),
            filter_warm(h.state(), t(), 1.0).unwrap_err(),
            filter_fade(h.state(), t(), 1.0).unwrap_err(),
            filter_drama(h.state(), t(), 1.0).unwrap_err(),
            filter_cross_process(h.state(), t(), 1.0).unwrap_err(),
            filter_blur_gaussian(h.state(), t(), 2.0).unwrap_err(),
            filter_blur_motion(h.state(), t(), 0.0, 3).unwrap_err(),
            filter_blur_radial(h.state(), t(), 0.5, 8).unwrap_err(),
        ];
        assert_eq!(errs.len(), 18);
        assert!(errs.iter().all(|e| e == "No image loaded"), "{errs:?}");
    }

    #[test]
    fn filters_preserve_the_alpha_channel() {
        let h = Harness::with_image(solid_alpha(2, 2, [10, 20, 30, 77]));

        filter_sepia(h.state(), TAB.into(), 1.0).unwrap();

        assert_eq!(h.pixel(0, 0)[3], 77);
    }

    // ── grayscale ────────────────────────────────────────────────────────────

    #[test]
    fn grayscale_applies_the_given_weights() {
        let h = Harness::with_image(solid(2, 2, [100, 200, 50]));

        filter_grayscale(h.state(), TAB.into(), 0.5, 0.25, 0.25).unwrap();

        // 0,5×100 + 0,25×200 + 0,25×50 = 112,5 → 113 (arrondi)
        let [r, g, b, _] = h.pixel(0, 0);
        assert_eq!([r, g, b], [113, 113, 113]);
    }

    #[test]
    fn grayscale_clamps_weights_that_overflow() {
        let h = Harness::with_image(solid(2, 2, [200, 200, 200]));

        filter_grayscale(h.state(), TAB.into(), 1.0, 1.0, 1.0).unwrap();

        assert_eq!(h.pixel(0, 0)[0], 255);
    }

    // ── sepia ────────────────────────────────────────────────────────────────

    #[test]
    fn sepia_warms_a_neutral_gray() {
        let h = Harness::with_image(solid(2, 2, [128, 128, 128]));

        filter_sepia(h.state(), TAB.into(), 1.0).unwrap();

        let [r, g, b, _] = h.pixel(0, 0);
        assert!(r > g && g > b, "attendu r>g>b, obtenu {r} {g} {b}");
    }

    #[test]
    fn sepia_at_zero_intensity_is_a_no_op() {
        let h = Harness::with_image(solid(2, 2, [10, 90, 200]));

        filter_sepia(h.state(), TAB.into(), 0.0).unwrap();

        assert_eq!(h.pixel(0, 0), [10, 90, 200, 255]);
    }

    // ── invert ───────────────────────────────────────────────────────────────

    #[test]
    fn inverting_twice_restores_the_original() {
        let h = Harness::with_image(solid(3, 3, [10, 120, 240]));

        filter_invert(h.state(), TAB.into()).unwrap();
        assert_eq!(h.pixel(0, 0), [245, 135, 15, 255]);

        filter_invert(h.state(), TAB.into()).unwrap();
        assert_eq!(h.pixel(0, 0), [10, 120, 240, 255]);
    }

    // ── vignette ─────────────────────────────────────────────────────────────

    #[test]
    fn vignette_darkens_the_corners_more_than_the_centre() {
        let h = Harness::with_image(solid(21, 21, [200, 200, 200]));

        filter_vignette(h.state(), TAB.into(), 0.8, 0.5).unwrap();

        let centre = h.pixel(10, 10)[0];
        let corner = h.pixel(0, 0)[0];
        assert!(
            corner < centre,
            "coin {corner} devrait être < centre {centre}"
        );
        assert_eq!(centre, 200); // le centre reste intact
    }

    #[test]
    fn a_zero_strength_vignette_changes_nothing() {
        let h = Harness::with_image(solid(9, 9, [200, 100, 50]));

        filter_vignette(h.state(), TAB.into(), 0.0, 0.5).unwrap();

        assert_eq!(h.pixel(0, 0), [200, 100, 50, 255]);
    }

    // ── grain ────────────────────────────────────────────────────────────────

    #[test]
    fn monochrome_grain_shifts_every_channel_by_the_same_amount() {
        let h = Harness::with_image(solid(8, 8, [128, 128, 128]));

        filter_grain(h.state(), TAB.into(), 1.0, true).unwrap();

        for y in 0..8 {
            for x in 0..8 {
                let [r, g, b, _] = h.pixel(x, y);
                assert_eq!([r, g], [g, b], "bruit non neutre en ({x},{y})");
            }
        }
    }

    #[test]
    fn colour_grain_shifts_the_channels_independently() {
        let h = Harness::with_image(solid(8, 8, [128, 128, 128]));

        filter_grain(h.state(), TAB.into(), 1.0, false).unwrap();

        let differing = (0..8)
            .flat_map(|y| (0..8).map(move |x| (x, y)))
            .filter(|&(x, y)| {
                let [r, g, b, _] = h.pixel(x, y);
                r != g || g != b
            })
            .count();
        assert!(
            differing > 0,
            "le bruit couleur devrait décorréler les canaux"
        );
    }

    #[test]
    fn grain_is_deterministic() {
        let first = {
            let h = Harness::with_image(solid(6, 6, [128, 128, 128]));
            filter_grain(h.state(), TAB.into(), 0.7, false).unwrap();
            h.current()
        };
        let second = {
            let h = Harness::with_image(solid(6, 6, [128, 128, 128]));
            filter_grain(h.state(), TAB.into(), 0.7, false).unwrap();
            h.current()
        };
        assert_eq!(first, second);
    }

    #[test]
    fn a_zero_amount_grain_changes_nothing() {
        let h = Harness::with_image(solid(4, 4, [70, 80, 90]));

        filter_grain(h.state(), TAB.into(), 0.0, false).unwrap();

        assert_eq!(h.pixel(1, 1), [70, 80, 90, 255]);
    }

    // ── pixelate ─────────────────────────────────────────────────────────────

    #[test]
    fn pixelate_makes_each_block_uniform() {
        let h = Harness::with_image(gradient(8, 4));

        filter_pixelate(h.state(), TAB.into(), 4).unwrap();

        // Bloc 0 : colonnes 0..4, toutes égales à l'échantillon central (x=2).
        let block0 = h.pixel(0, 0);
        for x in 0..4 {
            assert_eq!(h.pixel(x, 0), block0);
        }
        assert_ne!(h.pixel(4, 0), block0); // le bloc suivant diffère
    }

    #[test]
    fn a_pixelate_size_of_zero_falls_back_to_one() {
        let h = Harness::with_image(gradient(6, 2));
        let before = h.current();

        filter_pixelate(h.state(), TAB.into(), 0).unwrap();

        assert_eq!(h.current(), before);
    }

    #[test]
    fn a_pixelate_block_larger_than_the_image_flattens_it() {
        let h = Harness::with_image(gradient(4, 4));

        filter_pixelate(h.state(), TAB.into(), 99).unwrap();

        let first = h.pixel(0, 0);
        assert!((0..4).all(|x| (0..4).all(|y| h.pixel(x, y) == first)));
    }

    // ── posterize ────────────────────────────────────────────────────────────

    #[test]
    fn posterize_snaps_values_to_the_level_grid() {
        // 4 niveaux → pas de 85 : 0, 85, 170, 255.
        let h = Harness::with_image(solid(2, 2, [42, 43, 200]));

        filter_posterize(h.state(), TAB.into(), 4).unwrap();

        assert_eq!(h.pixel(0, 0), [0, 85, 170, 255]);
    }

    #[test]
    fn posterize_needs_at_least_two_levels() {
        let h = Harness::with_image(solid(2, 2, [42, 130, 200]));

        // 0 et 1 sont ramenés à 2 niveaux → noir ou blanc, jamais une division par zéro.
        filter_posterize(h.state(), TAB.into(), 0).unwrap();

        let [r, g, b, _] = h.pixel(0, 0);
        assert_eq!([r, g, b], [0, 255, 255]);
    }

    // ── duotone ──────────────────────────────────────────────────────────────

    #[test]
    fn duotone_maps_black_and_white_to_the_two_target_colours() {
        let h = Harness::with_image(checker(2, 2, [0, 0, 0], [255, 255, 255]));

        filter_duotone(h.state(), TAB.into(), 10, 20, 30, 200, 210, 220).unwrap();

        assert_eq!(h.pixel(0, 0), [10, 20, 30, 255]); // ombre
        assert_eq!(h.pixel(1, 0), [200, 210, 220, 255]); // haute lumière
    }

    // ── sketch ───────────────────────────────────────────────────────────────

    #[test]
    fn sketch_turns_a_flat_image_white() {
        // Une image unie n'a aucun contour : le colour-dodge sature partout.
        let h = Harness::with_image(solid(8, 8, [120, 120, 120]));

        filter_sketch(h.state(), TAB.into()).unwrap();

        assert_eq!(h.pixel(4, 4), [255, 255, 255, 255]);
    }

    #[test]
    fn sketch_produces_a_gray_image() {
        let h = Harness::with_image(checker(8, 8, [0, 0, 0], [255, 255, 255]));

        filter_sketch(h.state(), TAB.into()).unwrap();

        for y in 0..8 {
            for x in 0..8 {
                let [r, g, b, _] = h.pixel(x, y);
                assert_eq!([r, g], [g, b], "pixel non gris en ({x},{y})");
            }
        }
    }

    // ── colour grades ────────────────────────────────────────────────────────

    #[test]
    fn cool_pulls_towards_blue() {
        let h = Harness::with_image(solid(2, 2, [100, 100, 100]));

        filter_cool(h.state(), TAB.into(), 1.0).unwrap();

        assert_eq!(h.pixel(0, 0), [80, 105, 125, 255]);
    }

    #[test]
    fn warm_pulls_towards_red() {
        let h = Harness::with_image(solid(2, 2, [100, 100, 100]));

        filter_warm(h.state(), TAB.into(), 1.0).unwrap();

        assert_eq!(h.pixel(0, 0), [125, 110, 80, 255]);
    }

    #[test]
    fn cool_and_warm_are_no_ops_at_zero() {
        let h = Harness::with_image(solid(2, 2, [100, 110, 120]));

        filter_cool(h.state(), TAB.into(), 0.0).unwrap();
        assert_eq!(h.pixel(0, 0), [100, 110, 120, 255]);

        filter_warm(h.state(), TAB.into(), 0.0).unwrap();
        assert_eq!(h.pixel(0, 0), [100, 110, 120, 255]);
    }

    #[test]
    fn lomo_darkens_the_edges_and_saturates() {
        let h = Harness::with_image(solid(21, 21, [180, 90, 60]));

        filter_lomo(h.state(), TAB.into(), 1.0).unwrap();

        let corner = h.pixel(0, 0);
        let centre = h.pixel(10, 10);
        assert!(corner[0] < centre[0], "le coin doit être assombri");
        // Saturation accrue : l'écart rouge/bleu se creuse.
        assert!((centre[0] as i32 - centre[2] as i32) > (180 - 60));
    }

    #[test]
    fn vintage_lifts_the_blacks_and_warms() {
        let h = Harness::with_image(solid(4, 4, [0, 0, 0]));

        filter_vintage(h.state(), TAB.into(), 1.0).unwrap();

        let [r, g, b, _] = h.pixel(0, 0);
        assert!(r > 0 && g > 0, "les noirs doivent être relevés");
        assert!(r > b, "dominante chaude attendue : {r} vs {b}");
    }

    #[test]
    fn fade_lifts_the_blacks_and_flattens_contrast() {
        let h = Harness::with_image(solid(4, 4, [0, 0, 0]));

        filter_fade(h.state(), TAB.into(), 1.0).unwrap();

        assert!(h.pixel(0, 0)[0] > 40);
    }

    #[test]
    fn drama_pushes_the_contrast_apart() {
        let dark = Harness::with_image(solid(4, 4, [60, 60, 60]));
        let bright = Harness::with_image(solid(4, 4, [240, 240, 240]));

        filter_drama(dark.state(), TAB.into(), 1.0).unwrap();
        filter_drama(bright.state(), TAB.into(), 1.0).unwrap();

        assert!(dark.pixel(0, 0)[0] < 60);
        assert!(bright.pixel(0, 0)[0] > 240);
    }

    #[test]
    fn cross_process_skews_the_channels() {
        let h = Harness::with_image(solid(4, 4, [128, 128, 128]));

        filter_cross_process(h.state(), TAB.into(), 1.0).unwrap();

        let [r, g, b, _] = h.pixel(0, 0);
        assert_ne!([r, g, b], [128, 128, 128]);
        assert!(g > r, "le vert doit être poussé : {g} vs {r}");
    }

    #[test]
    fn the_graded_looks_are_no_ops_at_zero_intensity() {
        for apply in [
            filter_lomo as fn(State<'_, AppState>, String, f32) -> Result<ImageMeta, String>,
            filter_vintage,
            filter_fade,
            filter_drama,
            filter_cross_process,
        ] {
            let h = Harness::with_image(solid(5, 5, [130, 120, 110]));
            apply(h.state(), TAB.into(), 0.0).unwrap();
            let [r, g, b, _] = h.pixel(2, 2);
            // Les arrondis flottants peuvent décaler d'un cran, pas davantage.
            assert!(
                (r as i32 - 130).abs() <= 1
                    && (g as i32 - 120).abs() <= 1
                    && (b as i32 - 110).abs() <= 1,
                "intensité nulle devrait être neutre, obtenu {r} {g} {b}"
            );
        }
    }

    // ── blurs ────────────────────────────────────────────────────────────────

    #[test]
    fn gaussian_blur_keeps_the_dimensions_and_smooths() {
        let h = Harness::with_image(checker(8, 8, [0, 0, 0], [255, 255, 255]));

        let meta = filter_blur_gaussian(h.state(), TAB.into(), 3.0).unwrap();

        assert_eq!((meta.width, meta.height), (8, 8));
        // Le damier s'homogénéise autour du gris moyen.
        let v = h.pixel(4, 4)[0];
        assert!((60..=195).contains(&v), "attendu un gris moyen, obtenu {v}");
    }

    #[test]
    fn a_zero_radius_gaussian_blur_is_still_valid() {
        let h = Harness::with_image(solid(4, 4, [10, 20, 30]));

        filter_blur_gaussian(h.state(), TAB.into(), 0.0).unwrap();

        assert_eq!(h.pixel(0, 0), [10, 20, 30, 255]);
    }

    #[test]
    fn motion_blur_leaves_a_uniform_image_alone() {
        let h = Harness::with_image(solid(6, 6, [90, 90, 90]));

        filter_blur_motion(h.state(), TAB.into(), 45.0, 3).unwrap();

        assert_eq!(h.pixel(3, 3), [90, 90, 90, 255]);
    }

    #[test]
    fn horizontal_motion_blur_smears_along_the_rows() {
        // Une colonne blanche sur fond noir : un flou à 0° la déborde horizontalement.
        let mut img = image::RgbaImage::new(9, 3);
        for y in 0..3 {
            for x in 0..9 {
                let v = if x == 4 { 255 } else { 0 };
                img.put_pixel(x, y, image::Rgba([v, v, v, 255]));
            }
        }
        let h = Harness::with_image(DynamicImage::ImageRgba8(img));

        filter_blur_motion(h.state(), TAB.into(), 0.0, 2).unwrap();

        assert!(h.pixel(3, 1)[0] > 0, "la trainée doit atteindre le voisin");
        assert!(h.pixel(4, 1)[0] < 255, "le pic doit être atténué");
    }

    #[test]
    fn the_motion_blur_distance_is_clamped() {
        let h = Harness::with_image(solid(4, 4, [50, 50, 50]));

        // 0 serait un noyau vide, 5 000 ferait exploser la boucle : les deux sont bornés.
        filter_blur_motion(h.state(), TAB.into(), 90.0, 0).unwrap();
        filter_blur_motion(h.state(), TAB.into(), 90.0, 5_000).unwrap();

        assert_eq!(h.pixel(2, 2), [50, 50, 50, 255]);
    }

    #[test]
    fn radial_blur_leaves_a_uniform_image_alone() {
        let h = Harness::with_image(solid(7, 7, [140, 60, 20]));

        filter_blur_radial(h.state(), TAB.into(), 0.8, 12).unwrap();

        assert_eq!(h.pixel(3, 3), [140, 60, 20, 255]);
    }

    #[test]
    fn radial_blur_smears_towards_the_centre() {
        // Dégradé horizontal : le pixel de bord (valeur 0) reçoit des échantillons
        // pris plus près du centre, donc plus clairs.
        let h = Harness::with_image(gradient(9, 9));
        assert_eq!(h.pixel(0, 4)[0], 0);

        filter_blur_radial(h.state(), TAB.into(), 0.9, 16).unwrap();

        let v = h.pixel(0, 4)[0];
        assert!(v > 0 && v < 255, "le bord doit être mélangé, obtenu {v}");
    }

    #[test]
    fn the_radial_blur_sample_count_is_clamped() {
        let h = Harness::with_image(gradient(6, 6));

        // 1 échantillon (< 4) et 999 (> 32) doivent tous deux rester exploitables.
        filter_blur_radial(h.state(), TAB.into(), 0.5, 1).unwrap();
        filter_blur_radial(h.state(), TAB.into(), 0.5, 999).unwrap();

        assert_eq!(h.history_len(), 3);
    }

    #[test]
    fn an_out_of_range_radial_strength_is_clamped() {
        let h = Harness::with_image(gradient(6, 6));

        filter_blur_radial(h.state(), TAB.into(), 5.0, 8).unwrap();

        assert_eq!(h.history_len(), 2);
    }
}
