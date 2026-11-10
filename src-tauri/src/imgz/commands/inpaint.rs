use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageBuffer, Rgba};
use tauri::State;

use super::imaging::{by_depth, Sample};
use super::open::ImageMeta;
use super::ops::apply_step;
use super::steps::Step;
use crate::imgz::AppState;
use std::sync::Arc;

// Patch de 7×7 (demi-côté 3), 200 candidats par pixel inconnu : une moitié tirée près du
// trou (le voisinage ressemble au fond), l'autre dans toute l'image.
const HALF: i32 = 3;
const CANDIDATES: usize = 200;
const LOCAL_RADIUS: i64 = 48;

/// Masque décodé : un octet par pixel de la boîte `width`×`height` située en (`x`, `y`).
#[derive(Debug)]
pub struct MaskBox {
    pub bytes: Vec<u8>,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// Remplit la zone masquée par synthèse de patchs.
pub fn inpaint_dynamic(img: &DynamicImage, mask: &MaskBox) -> Result<DynamicImage, String> {
    let MaskBox {
        x: mask_x,
        y: mask_y,
        width: mask_width,
        height: mask_height,
        ..
    } = *mask;
    let (iw, ih) = (img.width(), img.height());
    let fits = |origin: u32, len: u32, max: u32| origin.checked_add(len).is_some_and(|e| e <= max);
    if mask_width == 0
        || mask_height == 0
        || !fits(mask_x, mask_width, iw)
        || !fits(mask_y, mask_height, ih)
    {
        return Err(format!(
            "Mask {mask_width}×{mask_height} at ({mask_x},{mask_y}) doesn't fit image {iw}×{ih}"
        ));
    }
    let expected = mask_width as usize * mask_height as usize;
    if mask.bytes.len() != expected {
        return Err(format!(
            "Expected {expected} mask bytes, got {}",
            mask.bytes.len()
        ));
    }

    let mut unknown = vec![false; iw as usize * ih as usize];
    for (i, &b) in mask.bytes.iter().enumerate() {
        if b > 10 {
            let x = mask_x + (i as u32 % mask_width);
            let y = mask_y + (i as u32 / mask_width);
            unknown[(y * iw + x) as usize] = true;
        }
    }
    if !unknown.iter().any(|&u| u) {
        return Err("Mask is empty".to_string());
    }

    Ok(by_depth!(fill, img, &mut unknown, iw, ih))
}

/// Remplissage par exemplaires : la zone masquée est comblée avec les pixels des patchs
/// les plus ressemblants trouvés ailleurs dans l'image.
///
/// `mask_b64` — masque d'alpha encodé en base64 (1 octet par pixel, non nul = à remplir),
/// limité à la boîte `mask_width`×`mask_height` située en (`mask_x`, `mask_y`) : on ne
/// transmet que la zone peinte, pas une image entière de zéros.
#[tauri::command(async)]
pub fn inpaint_image(
    state: State<'_, AppState>,
    tab_id: String,
    mask_b64: String,
    mask_x: u32,
    mask_y: u32,
    mask_width: u32,
    mask_height: u32,
) -> Result<ImageMeta, String> {
    let mask_bytes = STANDARD.decode(&mask_b64).map_err(|e| e.to_string())?;

    apply_step(
        &state,
        &tab_id,
        false,
        Step::Inpaint(Arc::new(MaskBox {
            bytes: mask_bytes,
            x: mask_x,
            y: mask_y,
            width: mask_width,
            height: mask_height,
        })),
    )
}

/// Remplit la zone `unknown` à la profondeur de l'image.
fn fill<S>(img: &DynamicImage, unknown: &mut [bool], w: u32, h: u32) -> DynamicImage
where
    S: Sample,
    Rgba<S>: image::Pixel<Subpixel = S>,
{
    S::into_image(do_inpaint(&S::buffer_of(img), unknown, w, h))
}

type Buf<S> = ImageBuffer<Rgba<S>, Vec<S>>;

// ── core algorithm ─────────────────────────────────────────────────────────────

/// Boîte englobante (x0, y0, x1, y1 exclusives) des pixels inconnus.
fn unknown_bounds(unknown: &[bool], w: u32, h: u32) -> Option<(u32, u32, u32, u32)> {
    let mut b: Option<(u32, u32, u32, u32)> = None;
    for y in 0..h {
        for x in 0..w {
            if unknown[(y * w + x) as usize] {
                b = Some(match b {
                    None => (x, y, x + 1, y + 1),
                    Some((x0, y0, x1, y1)) => (x0.min(x), y0.min(y), x1.max(x + 1), y1.max(y + 1)),
                });
            }
        }
    }
    b
}

fn do_inpaint<S>(rgba: &Buf<S>, unknown: &mut [bool], w: u32, h: u32) -> Buf<S>
where
    S: Sample,
    Rgba<S>: image::Pixel<Subpixel = S>,
{
    let mut out = rgba.clone();
    let mut rng: u64 = 0x00c0_ffee_dead_beef;
    let Some((x0, y0, x1, y1)) = unknown_bounds(unknown, w, h) else {
        return out;
    };
    let max_passes = ((x1 - x0) + (y1 - y0)) as usize + 1;

    for _ in 0..max_passes {
        // Frontière : pixels inconnus ayant au moins un voisin connu. Seule la boîte du
        // masque est balayée, pas l'image entière.
        let mut boundary: Vec<(u32, u32, u8)> = Vec::new();
        for y in y0..y1 {
            for x in x0..x1 {
                if !unknown[(y * w + x) as usize] {
                    continue;
                }
                let kn = known_neighbor_count(x, y, w, h, unknown);
                if kn > 0 {
                    boundary.push((x, y, kn));
                }
            }
        }

        if boundary.is_empty() {
            break;
        }

        // Les plus contraints d'abord (le plus de voisins connus)
        boundary.sort_unstable_by_key(|b| std::cmp::Reverse(b.2));

        for (x, y, _) in boundary {
            let idx = (y * w + x) as usize;
            if !unknown[idx] {
                continue;
            }

            let px = match find_best_patch(&out, unknown, x, y, w, h, &mut rng) {
                Some((bx, by)) => *out.get_pixel(bx, by),
                None => avg_known_neighbors(&out, unknown, x, y, w, h).unwrap_or(Rgba([
                    S::from_raw(0),
                    S::from_raw(0),
                    S::from_raw(0),
                    S::from_raw(S::MAX),
                ])),
            };

            out.put_pixel(x, y, px);
            unknown[idx] = false;
        }

        if !unknown.iter().any(|&u| u) {
            break;
        }
    }

    out
}

fn known_neighbor_count(x: u32, y: u32, w: u32, h: u32, unknown: &[bool]) -> u8 {
    let mut count = 0u8;
    for dy in -1i32..=1 {
        for dx in -1i32..=1 {
            if dx == 0 && dy == 0 {
                continue;
            }
            let nx = x as i32 + dx;
            let ny = y as i32 + dy;
            if nx >= 0
                && nx < w as i32
                && ny >= 0
                && ny < h as i32
                && !unknown[(ny as u32 * w + nx as u32) as usize]
            {
                count += 1;
            }
        }
    }
    count
}

fn find_best_patch<S>(
    img: &Buf<S>,
    unknown: &[bool],
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    rng: &mut u64,
) -> Option<(u32, u32)>
where
    S: Sample,
    Rgba<S>: image::Pixel<Subpixel = S>,
{
    let ctx = SsdCtx { img, unknown, w, h };
    let mut best_ssd = u64::MAX;
    let mut best: Option<(u32, u32)> = None;

    for i in 0..CANDIDATES {
        // Xorshift64 — générateur déterministe rapide
        *rng ^= *rng << 13;
        *rng ^= *rng >> 7;
        *rng ^= *rng << 17;
        let (cx, cy) = if i % 2 == 0 {
            let span = (2 * LOCAL_RADIUS + 1) as u64;
            let lx = (x as i64 - LOCAL_RADIUS + (*rng % span) as i64).clamp(0, w as i64 - 1);
            let ly =
                (y as i64 - LOCAL_RADIUS + ((*rng >> 32) % span) as i64).clamp(0, h as i64 - 1);
            (lx as u32, ly as u32)
        } else {
            ((*rng % w as u64) as u32, ((*rng >> 32) % h as u64) as u32)
        };

        if unknown[(cy * w + cx) as usize] {
            continue;
        }

        let ssd = patch_ssd(&ctx, x, y, cx, cy);
        if ssd < best_ssd {
            best_ssd = ssd;
            best = Some((cx, cy));
            if ssd == 0 {
                break;
            }
        }
    }

    best
}

struct SsdCtx<'a, S>
where
    S: Sample,
    Rgba<S>: image::Pixel<Subpixel = S>,
{
    img: &'a Buf<S>,
    unknown: &'a [bool],
    w: u32,
    h: u32,
}

fn patch_ssd<S>(ctx: &SsdCtx<'_, S>, ax: u32, ay: u32, bx: u32, by: u32) -> u64
where
    S: Sample,
    Rgba<S>: image::Pixel<Subpixel = S>,
{
    let SsdCtx { img, unknown, w, h } = ctx;
    let (w, h) = (*w, *h);
    let mut ssd = 0u64;
    let mut n = 0u64;

    for dy in -HALF..=HALF {
        for dx in -HALF..=HALF {
            let anx = ax as i32 + dx;
            let any = ay as i32 + dy;
            let bnx = bx as i32 + dx;
            let bny = by as i32 + dy;

            if anx < 0 || anx >= w as i32 || any < 0 || any >= h as i32 {
                continue;
            }
            if bnx < 0 || bnx >= w as i32 || bny < 0 || bny >= h as i32 {
                continue;
            }
            // On ne compare que les pixels connus du patch source
            if unknown[(any as u32 * w + anx as u32) as usize] {
                continue;
            }
            // Le patch candidat doit lui aussi être connu
            if unknown[(bny as u32 * w + bnx as u32) as usize] {
                continue;
            }

            let pa = img.get_pixel(anx as u32, any as u32);
            let pb = img.get_pixel(bnx as u32, bny as u32);
            for ch in 0..3usize {
                let d = (pa[ch].to_255() - pb[ch].to_255()).round() as i64;
                ssd += (d * d) as u64;
            }
            n += 1;
        }
    }

    ssd.checked_div(n).unwrap_or(u64::MAX)
}

fn avg_known_neighbors<S>(
    img: &Buf<S>,
    unknown: &[bool],
    x: u32,
    y: u32,
    w: u32,
    h: u32,
) -> Option<Rgba<S>>
where
    S: Sample,
    Rgba<S>: image::Pixel<Subpixel = S>,
{
    let (mut r, mut g, mut b, mut a, mut n) = (0u32, 0u32, 0u32, 0u32, 0u32);
    for dy in -1i32..=1 {
        for dx in -1i32..=1 {
            if dx == 0 && dy == 0 {
                continue;
            }
            let nx = x as i32 + dx;
            let ny = y as i32 + dy;
            if nx >= 0 && nx < w as i32 && ny >= 0 && ny < h as i32 {
                let idx = (ny as u32 * w + nx as u32) as usize;
                if !unknown[idx] {
                    let px = img.get_pixel(nx as u32, ny as u32);
                    r += px[0].raw();
                    g += px[1].raw();
                    b += px[2].raw();
                    a += px[3].raw();
                    n += 1;
                }
            }
        }
    }
    r.checked_div(n).map(|r_avg| {
        Rgba([
            S::from_raw(r_avg),
            S::from_raw(g / n),
            S::from_raw(b / n),
            S::from_raw(a / n),
        ])
    })
}

// ── tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn solid(r: u8, g: u8, b: u8, w: u32, h: u32) -> RgbaImage {
        let mut img = RgbaImage::new(w, h);
        for px in img.pixels_mut() {
            *px = Rgba([r, g, b, 255]);
        }
        img
    }

    #[test]
    fn inpaint_no_mask_is_identity() {
        let rgba = solid(80, 120, 200, 10, 10);
        let mut unknown = vec![false; 100];
        let result = do_inpaint(&rgba, &mut unknown, 10, 10);
        assert_eq!(result.get_pixel(5, 5), rgba.get_pixel(5, 5));
    }

    #[test]
    fn inpaint_uniform_image_fills_correctly() {
        let w = 20u32;
        let h = 20u32;
        let mut rgba = solid(100, 150, 200, w, h);
        let mut unknown = vec![false; (w * h) as usize];
        // Punch a 4×4 hole in the middle
        for y in 8..12u32 {
            for x in 8..12u32 {
                rgba.put_pixel(x, y, Rgba([0, 0, 0, 255]));
                unknown[(y * w + x) as usize] = true;
            }
        }
        let result = do_inpaint(&rgba, &mut unknown, w, h);
        for y in 8..12u32 {
            for x in 8..12u32 {
                let px = result.get_pixel(x, y);
                assert_eq!(px[0], 100, "R at ({x},{y})");
                assert_eq!(px[1], 150, "G at ({x},{y})");
                assert_eq!(px[2], 200, "B at ({x},{y})");
            }
        }
    }

    #[test]
    fn patch_ssd_identical_patches_is_zero() {
        let rgba = solid(128, 128, 128, 20, 20);
        let unknown = vec![false; 400];
        let ctx = SsdCtx {
            img: &rgba,
            unknown: &unknown,
            w: 20,
            h: 20,
        };
        let ssd = patch_ssd(&ctx, 5, 5, 15, 15);
        assert_eq!(ssd, 0);
    }

    #[test]
    fn avg_known_neighbors_returns_none_when_all_unknown() {
        let rgba = solid(100, 100, 100, 5, 5);
        let unknown = vec![true; 25];
        let result = avg_known_neighbors(&rgba, &unknown, 2, 2, 5, 5);
        assert!(result.is_none());
    }

    // ── commande ─────────────────────────────────────────────────────────────

    use crate::imgz::test_support::{gradient, Harness, TAB};

    /// Masque base64 d'un rectangle plein : (données, x, y, largeur, hauteur).
    fn rect_mask(x: u32, y: u32, w: u32, h: u32) -> (String, u32, u32, u32, u32) {
        (STANDARD.encode(vec![255u8; (w * h) as usize]), x, y, w, h)
    }

    fn run(h: &Harness, m: (String, u32, u32, u32, u32)) -> Result<ImageMeta, String> {
        inpaint_image(h.state(), TAB.into(), m.0, m.1, m.2, m.3, m.4)
    }

    #[test]
    fn an_unknown_tab_is_rejected() {
        let h = Harness::empty();

        assert_eq!(run(&h, rect_mask(0, 0, 1, 1)).unwrap_err(), "Tab not found");
    }

    #[test]
    fn a_tab_without_an_image_is_rejected() {
        let h = Harness::without_image();

        assert_eq!(
            run(&h, rect_mask(0, 0, 1, 1)).unwrap_err(),
            "No image loaded"
        );
    }

    #[test]
    fn a_mask_outside_the_image_is_rejected() {
        let h = Harness::with_image(gradient(8, 8));

        let err = run(&h, rect_mask(6, 6, 4, 4)).unwrap_err();

        assert!(err.contains("doesn't fit image"), "{err}");
        assert_eq!(h.history_len(), 1);
    }

    #[test]
    fn a_mask_that_is_not_base64_is_rejected() {
        let h = Harness::with_image(gradient(4, 4));

        assert!(
            inpaint_image(h.state(), TAB.into(), "!!!pas du base64".into(), 0, 0, 4, 4).is_err()
        );
    }

    #[test]
    fn a_mask_with_the_wrong_byte_count_is_rejected() {
        let h = Harness::with_image(gradient(4, 4));
        let short = STANDARD.encode(vec![0u8; 3]);

        let err = inpaint_image(h.state(), TAB.into(), short, 0, 0, 4, 4).unwrap_err();

        assert!(err.contains("Expected 16 mask bytes"), "{err}");
    }

    #[test]
    fn an_empty_mask_is_an_error_and_pushes_nothing() {
        let h = Harness::with_image(gradient(6, 6));
        let before = h.current();
        let empty = (STANDARD.encode(vec![0u8; 36]), 0, 0, 6, 6);

        assert_eq!(run(&h, empty).unwrap_err(), "Mask is empty");

        assert_eq!(h.current(), before);
        assert_eq!(h.history_len(), 1);
    }

    #[test]
    fn a_masked_region_is_filled_and_pushed_to_the_history() {
        let h = Harness::with_image(gradient(16, 16));

        let meta = run(&h, rect_mask(6, 6, 3, 3)).unwrap();

        assert_eq!((meta.width, meta.height), (16, 16));
        assert_eq!(h.history_len(), 2);
        // Le trou est rebouché par des pixels opaques venus d'ailleurs dans l'image.
        assert_eq!(h.pixel(7, 7)[3], 255);
    }

    #[test]
    fn only_the_masked_box_is_rewritten() {
        let h = Harness::with_image(gradient(16, 16));
        let before = h.current();

        run(&h, rect_mask(6, 6, 3, 3)).unwrap();

        let after = h.current();
        for y in 0..16 {
            for x in 0..16 {
                if !(6..9).contains(&x) || !(6..9).contains(&y) {
                    assert_eq!(after.get_pixel(x, y), before.get_pixel(x, y), "({x},{y})");
                }
            }
        }
    }

    #[test]
    fn a_fully_masked_image_still_terminates() {
        // Aucun pixel connu : `find_best_patch` échoue partout et le repli finit le travail.
        let h = Harness::with_image(gradient(6, 6));

        run(&h, rect_mask(0, 0, 6, 6)).unwrap();

        assert_eq!(h.history_len(), 2);
    }

    #[test]
    fn a_mask_touching_the_border_is_handled() {
        let h = Harness::with_image(gradient(12, 12));

        run(&h, rect_mask(0, 0, 2, 12)).unwrap();

        assert_eq!(h.pixel(0, 0)[3], 255);
    }

    #[test]
    fn faint_mask_values_are_treated_as_known() {
        // Le seuil est à 10 : une valeur en dessous ne doit rien effacer.
        let h = Harness::with_image(gradient(6, 6));
        let faint = (STANDARD.encode(vec![5u8; 36]), 0, 0, 6, 6);

        assert_eq!(run(&h, faint).unwrap_err(), "Mask is empty");
    }

    #[test]
    fn inpainting_is_deterministic() {
        let go = || {
            let h = Harness::with_image(gradient(14, 14));
            run(&h, rect_mask(5, 5, 4, 4)).unwrap();
            h.current()
        };

        assert_eq!(go(), go());
    }

    #[test]
    fn a_16_bit_hole_is_filled_with_16_bit_pixels() {
        let (w, h) = (20u32, 20u32);
        let mut buf = image::ImageBuffer::<Rgba<u16>, Vec<u16>>::from_pixel(
            w,
            h,
            Rgba([12_345, 23_456, 34_567, 65_535]),
        );
        let mut unknown = vec![false; (w * h) as usize];
        for y in 8..12u32 {
            for x in 8..12u32 {
                buf.put_pixel(x, y, Rgba([0, 0, 0, 65_535]));
                unknown[(y * w + x) as usize] = true;
            }
        }

        let out = fill::<u16>(&DynamicImage::ImageRgba16(buf), &mut unknown, w, h);

        assert_eq!(out.color(), image::ColorType::Rgba16);
        assert_eq!(
            out.to_rgba16().get_pixel(9, 9).0,
            [12_345, 23_456, 34_567, 65_535]
        );
    }
}
