use image::{imageops, DynamicImage, ImageBuffer, Rgba};
use tauri::State;

use super::imaging::{by_depth, check_dims, Sample};
use super::open::ImageMeta;
use super::ops::apply_step;
use super::steps::Step;
use crate::imgz::AppState;

/// Découpe `width`×`height` à partir de (`x`, `y`).
pub fn crop_dynamic(
    img: &DynamicImage,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<DynamicImage, String> {
    let in_bounds =
        |origin: u32, len: u32, max: u32| origin.checked_add(len).is_some_and(|end| end <= max);
    if !in_bounds(x, width, img.width()) || !in_bounds(y, height, img.height()) {
        return Err(format!(
            "Crop rect ({x},{y},{width},{height}) exceeds image bounds ({}x{})",
            img.width(),
            img.height()
        ));
    }
    Ok(img.crop_imm(x, y, width, height))
}

/// Pose l'image sur un canevas plus grand, rempli de `fill`, à la position donnée par `anchor`.
pub fn canvas_resize_dynamic(
    img: &DynamicImage,
    width: u32,
    height: u32,
    anchor: &str,
    fill: [u8; 4],
) -> Result<DynamicImage, String> {
    check_dims(width, height)?;
    let (orig_w, orig_h) = (img.width(), img.height());
    if width < orig_w || height < orig_h {
        return Err(format!(
            "Canvas size ({width}×{height}) must be >= image size ({orig_w}×{orig_h})"
        ));
    }

    let (off_x, off_y) = match anchor {
        "top-left" => (0, 0),
        "top-center" => ((width - orig_w) / 2, 0),
        "top-right" => (width - orig_w, 0),
        "middle-left" => (0, (height - orig_h) / 2),
        "center" => ((width - orig_w) / 2, (height - orig_h) / 2),
        "middle-right" => (width - orig_w, (height - orig_h) / 2),
        "bottom-left" => (0, height - orig_h),
        "bottom-center" => ((width - orig_w) / 2, height - orig_h),
        "bottom-right" => (width - orig_w, height - orig_h),
        other => return Err(format!("Unknown anchor: {other}")),
    };

    Ok(by_depth!(
        overlay_on_canvas,
        img,
        width,
        height,
        fill,
        off_x,
        off_y
    ))
}

pub fn resize_dynamic(img: &DynamicImage, width: u32, height: u32) -> Result<DynamicImage, String> {
    check_dims(width, height)?;
    Ok(img.resize_exact(width, height, imageops::FilterType::Lanczos3))
}

pub fn flip_dynamic(img: &DynamicImage, direction: &str) -> Result<DynamicImage, String> {
    match direction {
        "horizontal" => Ok(img.fliph()),
        "vertical" => Ok(img.flipv()),
        other => Err(format!("Unknown flip direction: {other}")),
    }
}

#[tauri::command(async)]
pub fn crop_image(
    state: State<'_, AppState>,
    tab_id: String,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<ImageMeta, String> {
    if width == 0 || height == 0 {
        return Err("Width and height must be greater than 0".to_string());
    }
    apply_step(
        &state,
        &tab_id,
        false,
        Step::Crop {
            x,
            y,
            width,
            height,
        },
    )
}

#[tauri::command(async)]
pub fn canvas_resize_image(
    state: State<'_, AppState>,
    tab_id: String,
    width: u32,
    height: u32,
    anchor: String,
    fill: [u8; 4],
) -> Result<ImageMeta, String> {
    check_dims(width, height)?;
    apply_step(
        &state,
        &tab_id,
        false,
        Step::CanvasResize {
            width,
            height,
            anchor,
            fill,
        },
    )
}

#[tauri::command(async)]
pub fn resize_image(
    state: State<'_, AppState>,
    tab_id: String,
    width: u32,
    height: u32,
) -> Result<ImageMeta, String> {
    check_dims(width, height)?;
    apply_step(&state, &tab_id, false, Step::Resize { width, height })
}

#[tauri::command(async)]
pub fn flip_image(
    state: State<'_, AppState>,
    tab_id: String,
    direction: String,
) -> Result<ImageMeta, String> {
    apply_step(&state, &tab_id, false, Step::Flip { direction })
}

/// Rotation d'un angle quelconque, en degrés (sens horaire). Les multiples de 90° sont
/// exacts et sans perte, y compris −180° ou 360° ; les autres angles agrandissent le
/// canevas à la boîte englobante (coins transparents) pour ne rien rogner.
pub fn rotate_dynamic(img: &DynamicImage, degrees: f64) -> Result<DynamicImage, String> {
    const EPS: f64 = 1e-9;
    if !degrees.is_finite() {
        return Err("Invalid rotation angle".to_string());
    }
    let d = degrees.rem_euclid(360.0);
    let near = |target: f64| (d - target).abs() < EPS;
    if near(0.0) || near(360.0) {
        return Ok(img.clone());
    }
    if near(90.0) {
        return Ok(img.rotate90());
    }
    if near(180.0) {
        return Ok(img.rotate180());
    }
    if near(270.0) {
        return Ok(img.rotate270());
    }

    let (w, h) = (img.width(), img.height());
    let rad = d.to_radians();
    let (sin, cos) = (rad.sin().abs(), rad.cos().abs());
    let new_w = ((w as f64 * cos + h as f64 * sin).ceil() as u32).max(w);
    let new_h = ((w as f64 * sin + h as f64 * cos).ceil() as u32).max(h);
    check_dims(new_w, new_h)?;

    Ok(by_depth!(rotate_free, img, new_w, new_h, rad as f32))
}

/// Pose `img` sur un canevas `width`×`height` rempli de `fill` (8 bits, élargi à la
/// profondeur de l'image), à la position (`off_x`, `off_y`).
fn overlay_on_canvas<S>(
    img: &DynamicImage,
    width: u32,
    height: u32,
    fill: [u8; 4],
    off_x: u32,
    off_y: u32,
) -> DynamicImage
where
    S: Sample,
    Rgba<S>: image::Pixel<Subpixel = S>,
{
    let fill = fill.map(|c| S::from_255(f32::from(c)));
    let mut canvas = ImageBuffer::from_pixel(width, height, Rgba(fill));
    imageops::overlay(&mut canvas, &S::buffer_of(img), off_x as i64, off_y as i64);
    S::into_image(canvas)
}

/// Rotation de `rad` radians autour du centre, sur un canevas transparent `new_w`×`new_h`.
fn rotate_free<S>(img: &DynamicImage, new_w: u32, new_h: u32, rad: f32) -> DynamicImage
where
    S: Sample,
    Rgba<S>: image::Pixel<Subpixel = S>,
    S: Into<f32> + imageproc::definitions::Clamp<f32>,
{
    use imageproc::geometric_transformations::{rotate_about_center, Interpolation};
    let (w, h) = (img.width(), img.height());
    let zero = Rgba([S::from_raw(0); 4]);
    let mut canvas = ImageBuffer::from_pixel(new_w, new_h, zero);
    imageops::overlay(
        &mut canvas,
        &S::buffer_of(img),
        ((new_w - w) / 2) as i64,
        ((new_h - h) / 2) as i64,
    );
    S::into_image(rotate_about_center(
        &canvas,
        rad,
        Interpolation::Bilinear,
        zero,
    ))
}

#[tauri::command(async)]
pub fn rotate_image(
    state: State<'_, AppState>,
    tab_id: String,
    degrees: f64,
) -> Result<ImageMeta, String> {
    apply_step(&state, &tab_id, false, Step::Rotate { degrees })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imgz::test_support::{checker, gradient, solid, Harness, TAB};

    // ── crop ─────────────────────────────────────────────────────────────────

    #[test]
    fn crop_keeps_the_requested_rectangle() {
        let h = Harness::with_image(gradient(10, 10));
        let expected = h.pixel(4, 2);

        let meta = crop_image(h.state(), TAB.into(), 4, 2, 3, 5).unwrap();

        assert_eq!((meta.width, meta.height), (3, 5));
        assert_eq!(h.pixel(0, 0), expected);
        assert_eq!(h.history_len(), 2);
    }

    #[test]
    fn a_crop_flush_with_the_edge_is_allowed() {
        let h = Harness::with_image(solid(10, 10, [1, 2, 3]));

        let meta = crop_image(h.state(), TAB.into(), 5, 5, 5, 5).unwrap();

        assert_eq!((meta.width, meta.height), (5, 5));
    }

    #[test]
    fn a_crop_past_the_edge_is_refused() {
        let h = Harness::with_image(solid(10, 10, [1, 2, 3]));

        let err = crop_image(h.state(), TAB.into(), 5, 0, 6, 5).unwrap_err();

        assert!(err.contains("exceeds image bounds"), "{err}");
        assert_eq!(h.history_len(), 1); // rien n'a été empilé
    }

    #[test]
    fn crop_needs_a_tab_and_an_image() {
        assert_eq!(
            crop_image(Harness::empty().state(), TAB.into(), 0, 0, 1, 1).unwrap_err(),
            "Tab not found"
        );
        assert_eq!(
            crop_image(Harness::without_image().state(), TAB.into(), 0, 0, 1, 1).unwrap_err(),
            "No image loaded"
        );
    }

    // ── canvas resize ────────────────────────────────────────────────────────

    /// Position du coin haut-gauche de l'image d'origine dans le nouveau canevas,
    /// repérée par la seule zone non remplie.
    fn origin_offset(h: &Harness, fill: [u8; 4]) -> (u32, u32) {
        let img = h.current();
        for y in 0..img.height() {
            for x in 0..img.width() {
                if img.get_pixel(x, y).0 != fill {
                    return (x, y);
                }
            }
        }
        panic!("image d'origine introuvable dans le canevas");
    }

    #[test]
    fn canvas_resize_places_the_image_at_each_anchor() {
        let fill = [0, 0, 0, 255];
        // Image 2×2 dans un canevas 6×6 : marges de 4 px, centre à 2.
        let cases = [
            ("top-left", (0, 0)),
            ("top-center", (2, 0)),
            ("top-right", (4, 0)),
            ("middle-left", (0, 2)),
            ("center", (2, 2)),
            ("middle-right", (4, 2)),
            ("bottom-left", (0, 4)),
            ("bottom-center", (2, 4)),
            ("bottom-right", (4, 4)),
        ];
        for (anchor, expected) in cases {
            let h = Harness::with_image(solid(2, 2, [255, 255, 255]));
            let meta =
                canvas_resize_image(h.state(), TAB.into(), 6, 6, anchor.into(), fill).unwrap();
            assert_eq!((meta.width, meta.height), (6, 6), "{anchor}");
            assert_eq!(origin_offset(&h, fill), expected, "ancre {anchor}");
        }
    }

    #[test]
    fn canvas_resize_paints_the_margin_with_the_fill_colour() {
        let h = Harness::with_image(solid(2, 2, [255, 255, 255]));

        canvas_resize_image(
            h.state(),
            TAB.into(),
            4,
            4,
            "top-left".into(),
            [9, 8, 7, 255],
        )
        .unwrap();

        assert_eq!(h.pixel(3, 3), [9, 8, 7, 255]);
        assert_eq!(h.pixel(0, 0), [255, 255, 255, 255]);
    }

    #[test]
    fn canvas_resize_rejects_a_zero_dimension() {
        let h = Harness::with_image(solid(2, 2, [1, 1, 1]));

        assert!(canvas_resize_image(h.state(), TAB.into(), 0, 4, "center".into(), [0; 4]).is_err());
        assert!(canvas_resize_image(h.state(), TAB.into(), 4, 0, "center".into(), [0; 4]).is_err());
    }

    #[test]
    fn canvas_resize_refuses_to_shrink() {
        let h = Harness::with_image(solid(8, 8, [1, 1, 1]));

        let err =
            canvas_resize_image(h.state(), TAB.into(), 4, 8, "center".into(), [0; 4]).unwrap_err();

        assert!(err.contains("must be >= image size"), "{err}");
    }

    #[test]
    fn canvas_resize_rejects_an_unknown_anchor() {
        let h = Harness::with_image(solid(2, 2, [1, 1, 1]));

        let err =
            canvas_resize_image(h.state(), TAB.into(), 4, 4, "middle".into(), [0; 4]).unwrap_err();

        assert_eq!(err, "Unknown anchor: middle");
    }

    #[test]
    fn canvas_resize_needs_a_tab_and_an_image() {
        assert_eq!(
            canvas_resize_image(
                Harness::empty().state(),
                TAB.into(),
                4,
                4,
                "center".into(),
                [0; 4]
            )
            .unwrap_err(),
            "Tab not found"
        );
        assert_eq!(
            canvas_resize_image(
                Harness::without_image().state(),
                TAB.into(),
                4,
                4,
                "center".into(),
                [0; 4]
            )
            .unwrap_err(),
            "No image loaded"
        );
    }

    // ── resize ───────────────────────────────────────────────────────────────

    #[test]
    fn resize_scales_to_the_exact_size() {
        let h = Harness::with_image(solid(8, 4, [30, 60, 90]));

        let meta = resize_image(h.state(), TAB.into(), 20, 5).unwrap();

        assert_eq!((meta.width, meta.height), (20, 5));
        // Une image unie reste unie après ré-échantillonnage.
        assert_eq!(h.pixel(10, 2), [30, 60, 90, 255]);
    }

    #[test]
    fn resize_rejects_a_zero_dimension() {
        let h = Harness::with_image(solid(4, 4, [1, 1, 1]));

        assert!(resize_image(h.state(), TAB.into(), 0, 4).is_err());
        assert!(resize_image(h.state(), TAB.into(), 4, 0).is_err());
        assert_eq!(h.history_len(), 1);
    }

    #[test]
    fn resize_needs_a_tab_and_an_image() {
        assert_eq!(
            resize_image(Harness::empty().state(), TAB.into(), 2, 2).unwrap_err(),
            "Tab not found"
        );
        assert_eq!(
            resize_image(Harness::without_image().state(), TAB.into(), 2, 2).unwrap_err(),
            "No image loaded"
        );
    }

    // ── flip ─────────────────────────────────────────────────────────────────

    #[test]
    fn flipping_horizontally_mirrors_the_columns() {
        let h = Harness::with_image(gradient(4, 1));
        let left = h.pixel(0, 0);
        let right = h.pixel(3, 0);

        flip_image(h.state(), TAB.into(), "horizontal".into()).unwrap();

        assert_eq!(h.pixel(0, 0), right);
        assert_eq!(h.pixel(3, 0), left);
    }

    #[test]
    fn flipping_vertically_mirrors_the_rows() {
        let h = Harness::with_image(checker(2, 2, [0, 0, 0], [255, 255, 255]));
        let top = h.pixel(0, 0);

        flip_image(h.state(), TAB.into(), "vertical".into()).unwrap();

        assert_ne!(h.pixel(0, 0), top);
        assert_eq!(h.pixel(0, 1), top);
    }

    #[test]
    fn flipping_twice_restores_the_original() {
        let h = Harness::with_image(gradient(5, 3));
        let before = h.current();

        flip_image(h.state(), TAB.into(), "horizontal".into()).unwrap();
        flip_image(h.state(), TAB.into(), "horizontal".into()).unwrap();

        assert_eq!(h.current(), before);
    }

    #[test]
    fn flip_rejects_an_unknown_direction() {
        let h = Harness::with_image(solid(2, 2, [1, 1, 1]));

        assert_eq!(
            flip_image(h.state(), TAB.into(), "diagonal".into()).unwrap_err(),
            "Unknown flip direction: diagonal"
        );
    }

    #[test]
    fn flip_needs_a_tab_and_an_image() {
        assert_eq!(
            flip_image(Harness::empty().state(), TAB.into(), "horizontal".into()).unwrap_err(),
            "Tab not found"
        );
        assert_eq!(
            flip_image(
                Harness::without_image().state(),
                TAB.into(),
                "horizontal".into()
            )
            .unwrap_err(),
            "No image loaded"
        );
    }

    // ── rotate ───────────────────────────────────────────────────────────────

    #[test]
    fn rotating_90_degrees_swaps_the_dimensions() {
        let h = Harness::with_image(solid(6, 3, [10, 20, 30]));

        let meta = rotate_image(h.state(), TAB.into(), 90.0).unwrap();

        assert_eq!((meta.width, meta.height), (3, 6));
    }

    #[test]
    fn rotating_180_degrees_keeps_the_dimensions() {
        let h = Harness::with_image(gradient(4, 2));
        let left = h.pixel(0, 0);

        let meta = rotate_image(h.state(), TAB.into(), 180.0).unwrap();

        assert_eq!((meta.width, meta.height), (4, 2));
        assert_eq!(h.pixel(3, 1), left);
    }

    #[test]
    fn rotating_270_degrees_swaps_the_dimensions() {
        let h = Harness::with_image(solid(6, 3, [10, 20, 30]));

        let meta = rotate_image(h.state(), TAB.into(), 270.0).unwrap();

        assert_eq!((meta.width, meta.height), (3, 6));
    }

    #[test]
    fn minus_ninety_is_the_same_as_270() {
        let a = Harness::with_image(gradient(5, 3));
        let b = Harness::with_image(gradient(5, 3));

        rotate_image(a.state(), TAB.into(), -90.0).unwrap();
        rotate_image(b.state(), TAB.into(), 270.0).unwrap();

        assert_eq!(a.current(), b.current());
    }

    #[test]
    fn four_quarter_turns_restore_the_original() {
        let h = Harness::with_image(gradient(4, 3));
        let before = h.current();

        for _ in 0..4 {
            rotate_image(h.state(), TAB.into(), 90.0).unwrap();
        }

        assert_eq!(h.current(), before);
    }

    #[test]
    fn an_arbitrary_angle_goes_through_the_interpolating_path() {
        let h = Harness::with_image(solid(9, 9, [200, 100, 50]));

        let meta = rotate_image(h.state(), TAB.into(), 45.0).unwrap();

        // La rotation libre agrandit le canevas (boîte englobante) : rien n'est rogné,
        // les coins vides sont transparents.
        assert_eq!((meta.width, meta.height), (13, 13));
        assert_eq!(h.pixel(0, 0)[3], 0);
        assert_eq!(h.pixel(6, 6), [200, 100, 50, 255]);
    }

    #[test]
    fn minus_180_and_360_are_exact() {
        let a = Harness::with_image(gradient(5, 3));
        let b = Harness::with_image(gradient(5, 3));
        let c = Harness::with_image(gradient(5, 3));
        let original = a.current();

        rotate_image(a.state(), TAB.into(), 180.0).unwrap();
        rotate_image(b.state(), TAB.into(), -180.0).unwrap();
        rotate_image(c.state(), TAB.into(), 360.0).unwrap();

        assert_eq!(a.current(), b.current());
        assert_eq!(c.current(), original);
    }

    #[test]
    fn a_zero_sized_crop_is_refused_without_touching_the_history() {
        let h = Harness::with_image(solid(10, 10, [1, 2, 3]));

        assert!(crop_image(h.state(), TAB.into(), 0, 0, 0, 5).is_err());

        assert_eq!(h.history_len(), 1);
    }

    #[test]
    fn a_crop_rectangle_that_overflows_u32_is_refused() {
        let h = Harness::with_image(solid(10, 10, [1, 2, 3]));

        let err = crop_image(h.state(), TAB.into(), u32::MAX, 0, 2, 2).unwrap_err();

        assert!(err.contains("exceeds image bounds"), "{err}");
    }

    #[test]
    fn absurd_dimensions_are_refused_before_any_allocation() {
        let h = Harness::with_image(solid(4, 4, [1, 2, 3]));

        let err = resize_image(h.state(), TAB.into(), 100_000, 100_000).unwrap_err();
        assert!(err.contains("exceeds the limit"), "{err}");
        let err = canvas_resize_image(h.state(), TAB.into(), 100_000, 4, "center".into(), [0; 4])
            .unwrap_err();
        assert!(err.contains("exceeds the limit"), "{err}");
        assert_eq!(h.history_len(), 1);
    }

    #[test]
    fn rotate_needs_a_tab_and_an_image() {
        assert_eq!(
            rotate_image(Harness::empty().state(), TAB.into(), 90.0).unwrap_err(),
            "Tab not found"
        );
        assert_eq!(
            rotate_image(Harness::without_image().state(), TAB.into(), 90.0).unwrap_err(),
            "No image loaded"
        );
    }

    #[test]
    fn a_16_bit_canvas_keeps_its_depth_and_scales_the_fill() {
        let src = DynamicImage::ImageRgba16(image::ImageBuffer::from_pixel(
            2,
            2,
            Rgba([1000, 2000, 3000, 65_535]),
        ));

        let out = overlay_on_canvas::<u16>(&src, 4, 4, [255, 0, 0, 255], 1, 1);

        let out = out.to_rgba16();
        assert_eq!(out.get_pixel(0, 0).0, [65_535, 0, 0, 65_535]);
        assert_eq!(out.get_pixel(1, 1).0, [1000, 2000, 3000, 65_535]);
    }
}
