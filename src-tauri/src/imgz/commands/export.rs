use image::{DynamicImage, ImageFormat, RgbImage};
use img_parts::ImageICC;
use std::path::Path;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

use super::imaging::is_8bit;
use crate::imgz::AppState;

fn format_from_str(format: &str) -> Result<ImageFormat, String> {
    match format {
        "png" => Ok(ImageFormat::Png),
        "jpeg" | "jpg" => Ok(ImageFormat::Jpeg),
        "webp" => Ok(ImageFormat::WebP),
        "bmp" => Ok(ImageFormat::Bmp),
        "tiff" | "tif" => Ok(ImageFormat::Tiff),
        other => Err(format!("Unsupported format: {other}")),
    }
}

fn extension_for(fmt: ImageFormat) -> &'static str {
    match fmt {
        ImageFormat::Png => "png",
        ImageFormat::Jpeg => "jpg",
        ImageFormat::WebP => "webp",
        ImageFormat::Bmp => "bmp",
        ImageFormat::Tiff => "tiff",
        _ => "bin",
    }
}

/// Compose l'image sur fond blanc : le JPEG n'a pas de canal alpha, et le simple retirer
/// laisserait apparaître la couleur (souvent noire) cachée sous les pixels transparents.
pub fn flatten_on_white(img: &DynamicImage) -> RgbImage {
    let rgba = img.to_rgba8();
    let mut out = RgbImage::new(rgba.width(), rgba.height());
    for (x, y, p) in rgba.enumerate_pixels() {
        let a = p[3] as u32;
        let mix = |c: u8| ((c as u32 * a + 255 * (255 - a) + 127) / 255) as u8;
        out.put_pixel(x, y, image::Rgb([mix(p[0]), mix(p[1]), mix(p[2])]));
    }
    out
}

fn embed_icc(bytes: Vec<u8>, fmt: ImageFormat, icc: &[u8]) -> Vec<u8> {
    use img_parts::{jpeg::Jpeg, png::Png, webp::WebP};
    let profile = Some(icc.to_vec().into());
    match fmt {
        ImageFormat::Jpeg => Jpeg::from_bytes(bytes.clone().into()).map(|mut i| {
            i.set_icc_profile(profile);
            i.encoder().bytes().to_vec()
        }),
        ImageFormat::Png => Png::from_bytes(bytes.clone().into()).map(|mut i| {
            i.set_icc_profile(profile);
            i.encoder().bytes().to_vec()
        }),
        ImageFormat::WebP => WebP::from_bytes(bytes.clone().into()).map(|mut i| {
            i.set_icc_profile(profile);
            i.encoder().bytes().to_vec()
        }),
        _ => return bytes,
    }
    .unwrap_or(bytes)
}

/// Écrit `img` à `path` dans le format demandé, avec le profil ICC d'origine s'il y en a un
/// (JPEG, PNG et WebP).
///
/// Séparé de la commande : celle-ci ne fait qu'ouvrir la boîte de dialogue, tout ce qui
/// suit le choix du fichier est ici et donc testable sans interface.
pub fn write_image_with_icc(
    img: &DynamicImage,
    path: &Path,
    img_format: ImageFormat,
    quality: Option<u8>,
    icc: Option<&[u8]>,
) -> Result<(), String> {
    // Seuls PNG et TIFF savent écrire plus de 8 bits par canal ; les autres formats
    // reçoivent une version 8 bits.
    let narrowed;
    let img = if is_8bit(img) || matches!(img_format, ImageFormat::Png | ImageFormat::Tiff) {
        img
    } else {
        narrowed = DynamicImage::ImageRgba8(img.to_rgba8());
        &narrowed
    };
    let mut bytes = Vec::new();
    match img_format {
        ImageFormat::Jpeg => {
            let q = quality.unwrap_or(90).clamp(1, 100);
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, q);
            DynamicImage::ImageRgb8(flatten_on_white(img))
                .write_with_encoder(encoder)
                .map_err(|e| e.to_string())?;
        }
        ImageFormat::WebP => {
            // L'encodeur disponible est sans perte : la qualité ne s'applique pas.
            let encoder = image::codecs::webp::WebPEncoder::new_lossless(&mut bytes);
            img.write_with_encoder(encoder).map_err(|e| e.to_string())?;
        }
        _ => {
            img.write_to(&mut std::io::Cursor::new(&mut bytes), img_format)
                .map_err(|e| e.to_string())?;
        }
    }
    if let Some(icc) = icc {
        bytes = embed_icc(bytes, img_format, icc);
    }
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

pub fn write_image(
    img: &DynamicImage,
    path: &Path,
    img_format: ImageFormat,
    quality: Option<u8>,
) -> Result<(), String> {
    write_image_with_icc(img, path, img_format, quality, None)
}

#[tauri::command]
pub async fn export_image(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
    format: String,
    quality: Option<u8>,
) -> Result<bool, String> {
    let img_format = format_from_str(&format)?;
    let ext = extension_for(img_format);

    // Nom proposé : celui du fichier d'origine avec la nouvelle extension.
    let stem = {
        let map = state.0.lock().map_err(|e| e.to_string())?;
        let history = map.get(&tab_id).ok_or("Tab not found")?;
        history
            .source_path
            .as_deref()
            .and_then(|p| p.file_stem())
            .and_then(|s| s.to_str())
            .unwrap_or("export")
            .to_string()
    };

    let path = app
        .dialog()
        .file()
        .add_filter("Image", &[ext])
        .set_file_name(format!("{stem}.{ext}"))
        .blocking_save_file();

    let Some(path) = path else {
        return Ok(false);
    };

    let path_buf = path.into_path().map_err(|e| e.to_string())?;

    // Le verrou n'est tenu que pour copier une référence : l'encodage et l'écriture
    // (longs sur une grande image) se font hors verrou.
    let (img, icc) = {
        let map = state.0.lock().map_err(|e| e.to_string())?;
        let history = map.get(&tab_id).ok_or("Tab not found")?;
        (
            history.current_arc().ok_or("No image loaded")?,
            history.icc.clone(),
        )
    };

    write_image_with_icc(&img, &path_buf, img_format, quality, icc.as_deref())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_from_str_maps_known_formats() {
        assert!(matches!(format_from_str("png"), Ok(ImageFormat::Png)));
        assert!(matches!(format_from_str("jpeg"), Ok(ImageFormat::Jpeg)));
        assert!(matches!(format_from_str("jpg"), Ok(ImageFormat::Jpeg)));
        assert!(matches!(format_from_str("webp"), Ok(ImageFormat::WebP)));
        assert!(matches!(format_from_str("bmp"), Ok(ImageFormat::Bmp)));
        assert!(matches!(format_from_str("tiff"), Ok(ImageFormat::Tiff)));
        assert!(matches!(format_from_str("tif"), Ok(ImageFormat::Tiff)));
    }

    #[test]
    fn format_from_str_rejects_unknown() {
        assert!(format_from_str("gif").is_err());
        assert!(format_from_str("svg").is_err());
        assert!(format_from_str("").is_err());
    }
    #[test]
    fn maps_every_supported_format_name() {
        assert_eq!(format_from_str("png").unwrap(), ImageFormat::Png);
        assert_eq!(format_from_str("jpeg").unwrap(), ImageFormat::Jpeg);
        assert_eq!(format_from_str("jpg").unwrap(), ImageFormat::Jpeg);
        assert_eq!(format_from_str("webp").unwrap(), ImageFormat::WebP);
        assert_eq!(format_from_str("bmp").unwrap(), ImageFormat::Bmp);
        assert_eq!(format_from_str("tiff").unwrap(), ImageFormat::Tiff);
        assert_eq!(format_from_str("tif").unwrap(), ImageFormat::Tiff);
    }

    #[test]
    fn rejects_an_unknown_format_by_name() {
        let err = format_from_str("gif").unwrap_err();
        assert!(err.contains("gif"), "unhelpful message: {err}");
    }

    #[test]
    fn is_case_sensitive_about_format_names() {
        assert!(format_from_str("PNG").is_err());
    }

    #[test]
    fn gives_every_format_its_canonical_extension() {
        assert_eq!(extension_for(ImageFormat::Png), "png");
        assert_eq!(extension_for(ImageFormat::Jpeg), "jpg");
        assert_eq!(extension_for(ImageFormat::WebP), "webp");
        assert_eq!(extension_for(ImageFormat::Bmp), "bmp");
        assert_eq!(extension_for(ImageFormat::Tiff), "tiff");
    }

    #[test]
    fn falls_back_to_bin_for_a_format_it_does_not_write() {
        assert_eq!(extension_for(ImageFormat::Gif), "bin");
    }

    #[test]
    fn every_accepted_name_round_trips_to_a_writable_extension() {
        for name in ["png", "jpeg", "webp", "bmp", "tiff"] {
            let fmt = format_from_str(name).unwrap();
            assert_ne!(extension_for(fmt), "bin", "{name} has no extension");
        }
    }

    // ── écriture sur disque ──────────────────────────────────────────────────

    use image::{DynamicImage, GenericImageView, Rgba, RgbaImage};
    use std::path::PathBuf;

    fn img(w: u32, h: u32) -> DynamicImage {
        let mut i = RgbaImage::new(w, h);
        for p in i.pixels_mut() {
            *p = Rgba([200, 100, 50, 255]);
        }
        DynamicImage::ImageRgba8(i)
    }

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("imgz-export-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[test]
    fn writes_every_supported_format_back_readable() {
        for name in ["png", "jpeg", "webp", "bmp", "tiff"] {
            let fmt = format_from_str(name).unwrap();
            let path = temp_path(&format!("out.{}", extension_for(fmt)));

            write_image(&img(6, 4), &path, fmt, None).unwrap();

            let read = image::open(&path).unwrap_or_else(|e| panic!("{name} illisible : {e}"));
            assert_eq!(read.dimensions(), (6, 4), "{name}");
        }
    }

    #[test]
    fn the_jpeg_quality_changes_the_file_size() {
        let low = temp_path("low.jpg");
        let high = temp_path("high.jpg");
        // Un dégradé : une image unie compresse pareil quelle que soit la qualité.
        let mut i = RgbaImage::new(64, 64);
        for (x, y, p) in i.enumerate_pixels_mut() {
            *p = Rgba([(x * 4) as u8, (y * 4) as u8, ((x + y) * 2) as u8, 255]);
        }
        let gradient = DynamicImage::ImageRgba8(i);

        write_image(&gradient, &low, ImageFormat::Jpeg, Some(5)).unwrap();
        write_image(&gradient, &high, ImageFormat::Jpeg, Some(100)).unwrap();

        let low_size = std::fs::metadata(&low).unwrap().len();
        let high_size = std::fs::metadata(&high).unwrap().len();
        assert!(
            low_size < high_size,
            "{low_size} devrait être < {high_size}"
        );
    }

    #[test]
    fn an_out_of_range_jpeg_quality_is_clamped() {
        let path = temp_path("clamped.jpg");

        write_image(&img(8, 8), &path, ImageFormat::Jpeg, Some(0)).unwrap();

        assert!(image::open(&path).is_ok());
    }

    #[test]
    fn the_jpeg_quality_defaults_when_unset() {
        let path = temp_path("default.jpg");

        write_image(&img(8, 8), &path, ImageFormat::Jpeg, None).unwrap();

        assert!(std::fs::metadata(&path).unwrap().len() > 0);
    }

    #[test]
    fn webp_is_written_losslessly() {
        let path = temp_path("out.webp");

        write_image(&img(4, 4), &path, ImageFormat::WebP, None).unwrap();

        let read = image::open(&path).unwrap().to_rgba8();
        assert_eq!(read.get_pixel(0, 0).0, [200, 100, 50, 255]);
    }

    #[test]
    fn an_unwritable_destination_surfaces_the_error() {
        let path = PathBuf::from("/nowhere-at-all/out.png");

        assert!(write_image(&img(2, 2), &path, ImageFormat::Png, None).is_err());
    }

    #[test]
    fn transparent_pixels_become_white_in_a_jpeg() {
        let transparent = DynamicImage::ImageRgba8(RgbaImage::from_pixel(8, 8, Rgba([0, 0, 0, 0])));
        let path = temp_path("alpha.jpg");

        write_image(&transparent, &path, ImageFormat::Jpeg, Some(95)).unwrap();

        let px = image::open(&path).unwrap().to_rgb8().get_pixel(4, 4).0;
        assert!(
            px.iter().all(|&c| c >= 250),
            "attendu du blanc, obtenu {px:?}"
        );
    }

    #[test]
    fn flattening_blends_half_transparent_pixels_with_white() {
        let img = DynamicImage::ImageRgba8(RgbaImage::from_pixel(1, 1, Rgba([0, 0, 0, 128])));
        let px = flatten_on_white(&img).get_pixel(0, 0).0;
        assert!((120..=135).contains(&px[0]), "{px:?}");
    }

    #[test]
    fn the_icc_profile_is_embedded_in_png_and_jpeg() {
        use img_parts::ImageICC;
        let profile = vec![7u8; 64];
        for (fmt, name) in [(ImageFormat::Png, "p.png"), (ImageFormat::Jpeg, "p.jpg")] {
            let path = temp_path(name);

            write_image_with_icc(&img(6, 6), &path, fmt, None, Some(&profile)).unwrap();

            let bytes = std::fs::read(&path).unwrap();
            let found = if fmt == ImageFormat::Png {
                img_parts::png::Png::from_bytes(bytes.into())
                    .unwrap()
                    .icc_profile()
            } else {
                img_parts::jpeg::Jpeg::from_bytes(bytes.into())
                    .unwrap()
                    .icc_profile()
            };
            assert_eq!(found.as_deref(), Some(profile.as_slice()), "{name}");
            assert!(image::open(&path).is_ok(), "{name} reste lisible");
        }
    }
}
