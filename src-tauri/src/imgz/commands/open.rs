use base64::Engine;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{DynamicImage, ImageDecoder, ImageReader};
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

use crate::imgz::{AppHistory, AppState};

/// Côté maximal des vignettes (préréglages de filtres).
const THUMB_SIDE: u32 = 160;

#[derive(Serialize, Clone, Debug)]
pub struct ImageMeta {
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub preview: String,
    pub thumbnail: String,
    pub can_undo: bool,
    pub can_redo: bool,
    pub history_len: usize,
    pub history_index: usize,
    /// Outils de géométrie déjà appliqués à cet état (voir `steps::Tool`).
    pub tools: Vec<String>,
    pub filename: Option<String>,
    pub path: Option<String>,
}

#[derive(Serialize)]
pub struct OpenedImage {
    pub tab_id: String,
    pub meta: ImageMeta,
}

#[derive(Serialize, Debug)]
pub struct FailedOpen {
    pub path: String,
    pub error: String,
}

#[derive(Serialize)]
pub struct OpenResult {
    pub opened: Vec<OpenedImage>,
    pub failed: Vec<FailedOpen>,
}

/// Encode en PNG à compression rapide (3 à 5 fois plus rapide que le réglage par défaut
/// pour une taille comparable sur une photo) ; les profondeurs > 8 bits sont ramenées à 8.
pub fn encode_png(img: &DynamicImage) -> Result<Vec<u8>, String> {
    let converted;
    let src = match img {
        DynamicImage::ImageRgba8(_) | DynamicImage::ImageRgb8(_) => img,
        _ => {
            converted = DynamicImage::ImageRgba8(img.to_rgba8());
            &converted
        }
    };
    let mut buf = Vec::new();
    let encoder = PngEncoder::new_with_quality(&mut buf, CompressionType::Fast, FilterType::Sub);
    src.write_with_encoder(encoder).map_err(|e| e.to_string())?;
    Ok(buf)
}

pub fn encode_preview(img: &DynamicImage) -> Result<String, String> {
    let b64 = base64::engine::general_purpose::STANDARD.encode(encode_png(img)?);
    Ok(format!("data:image/png;base64,{b64}"))
}

pub fn build_meta(
    img: &DynamicImage,
    format: &str,
    can_undo: bool,
    can_redo: bool,
) -> Result<ImageMeta, String> {
    build_meta_with(img, format, can_undo, can_redo, encode_preview(img)?)
}

/// Comme [`build_meta`], mais avec un `preview` déjà fourni (en pratique l'URL `lcimg` de
/// l'étape) au lieu d'encoder l'image en data URL.
pub fn build_meta_with(
    img: &DynamicImage,
    format: &str,
    can_undo: bool,
    can_redo: bool,
    preview: String,
) -> Result<ImageMeta, String> {
    let thumbnail = if img.width().max(img.height()) > THUMB_SIDE {
        encode_preview(&img.thumbnail(THUMB_SIDE, THUMB_SIDE))?
    } else {
        encode_preview(img)?
    };
    Ok(ImageMeta {
        width: img.width(),
        height: img.height(),
        format: format.to_string(),
        preview,
        thumbnail,
        can_undo,
        can_redo,
        history_len: 0,
        history_index: 0,
        tools: Vec::new(),
        filename: None,
        path: None,
    })
}

fn load_image_from_path(path_buf: PathBuf) -> Result<(String, ImageMeta, AppHistory), String> {
    let filename = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string());
    let path_str = path_buf.to_str().map(|s| s.to_string());

    // Le format est reconnu d'après le contenu, pas l'extension : un JPEG nommé `.png` s'ouvre.
    let reader = ImageReader::open(&path_buf)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let format = reader
        .format()
        .map(|f| format!("{f:?}").to_lowercase())
        .unwrap_or_else(|| "unknown".to_string());
    let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let icc = decoder.icc_profile().ok().flatten();
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    // Les photos de téléphone stockent l'image couchée et la balise Orientation la redresse.
    img.apply_orientation(orientation);

    let tab_id = Uuid::new_v4().to_string();
    let mut history = AppHistory::new();
    history.source_path = Some(path_buf);
    history.format = format.clone();
    history.icc = icc;
    history.open(img);

    let image = history.current().ok_or("No image loaded")?;
    let mut meta = build_meta_with(image, &format, false, false, history.image_url(&tab_id))?;
    meta.filename = filename;
    meta.path = path_str;
    meta.history_len = 1;

    Ok((tab_id, meta, history))
}

fn load_all(paths: Vec<PathBuf>, state: &State<'_, AppState>) -> Result<OpenResult, String> {
    let mut loaded = Vec::new();
    let mut failed = Vec::new();
    for path in paths {
        match load_image_from_path(path.clone()) {
            Ok(item) => loaded.push(item),
            Err(error) => failed.push(FailedOpen {
                path: path.to_string_lossy().into_owned(),
                error,
            }),
        }
    }

    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    let mut opened = Vec::with_capacity(loaded.len());
    for (tab_id, meta, history) in loaded {
        map.insert(tab_id.clone(), history);
        opened.push(OpenedImage { tab_id, meta });
    }
    Ok(OpenResult { opened, failed })
}

#[tauri::command]
pub async fn open_images(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<OpenResult, String> {
    let files = app
        .dialog()
        .file()
        .add_filter(
            "Images",
            &["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"],
        )
        .blocking_pick_files();

    let Some(paths) = files else {
        return Ok(OpenResult {
            opened: vec![],
            failed: vec![],
        });
    };

    let mut path_bufs = Vec::with_capacity(paths.len());
    for path in paths {
        path_bufs.push(path.into_path().map_err(|e| e.to_string())?);
    }
    load_all(path_bufs, &state)
}

#[tauri::command]
pub async fn open_images_by_paths(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<OpenResult, String> {
    load_all(paths.into_iter().map(PathBuf::from).collect(), &state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, Rgba, RgbaImage};

    fn solid_image(w: u32, h: u32) -> DynamicImage {
        let mut img = RgbaImage::new(w, h);
        for pixel in img.pixels_mut() {
            *pixel = Rgba([255, 0, 0, 255]);
        }
        DynamicImage::ImageRgba8(img)
    }

    #[test]
    fn encode_preview_produces_data_url() {
        let img = solid_image(10, 10);
        let result = encode_preview(&img).unwrap();
        assert!(result.starts_with("data:image/png;base64,"));
        assert!(result.len() > 22);
    }

    #[test]
    fn build_meta_returns_correct_dimensions() {
        let img = solid_image(100, 80);
        let meta = build_meta(&img, "png", false, false).unwrap();
        assert_eq!(meta.width, 100);
        assert_eq!(meta.height, 80);
        assert_eq!(meta.format, "png");
        assert!(meta.preview.starts_with("data:image/png;base64,"));
        assert!(meta.filename.is_none());
        assert!(meta.path.is_none());
    }
    #[test]
    fn encodes_a_preview_as_a_png_data_url() {
        let img = image::DynamicImage::ImageRgba8(image::RgbaImage::new(2, 2));
        let preview = encode_preview(&img).unwrap();

        assert!(preview.starts_with("data:image/png;base64,"));
        assert!(preview.len() > "data:image/png;base64,".len());
    }

    #[test]
    fn meta_reports_the_image_dimensions_and_flags() {
        let img = image::DynamicImage::ImageRgba8(image::RgbaImage::new(7, 3));

        let meta = build_meta(&img, "png", true, false).unwrap();

        assert_eq!(meta.width, 7);
        assert_eq!(meta.height, 3);
        assert_eq!(meta.format, "png");
        assert!(meta.can_undo);
        assert!(!meta.can_redo);
    }

    #[test]
    fn meta_leaves_the_file_details_unset() {
        let img = image::DynamicImage::ImageRgba8(image::RgbaImage::new(1, 1));

        let meta = build_meta(&img, "jpeg", false, true).unwrap();

        assert!(meta.filename.is_none());
        assert!(meta.path.is_none());
        assert!(meta.can_redo);
    }

    #[test]
    fn meta_always_carries_a_preview() {
        let img = image::DynamicImage::ImageRgba8(image::RgbaImage::new(4, 4));
        let meta = build_meta(&img, "png", false, false).unwrap();
        assert!(meta.preview.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn meta_serialises_with_snake_case_undo_flags() {
        let img = image::DynamicImage::ImageRgba8(image::RgbaImage::new(1, 1));
        let meta = build_meta(&img, "png", true, true).unwrap();

        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains("\"can_undo\":true"));
        assert!(json.contains("\"can_redo\":true"));
    }

    // ── chargement depuis le disque ──────────────────────────────────────────

    use crate::imgz::test_support::Harness;

    /// Écrit `img` dans un fichier temporaire unique et renvoie son chemin.
    fn temp_image(ext: &str, img: &DynamicImage) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("imgz-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("pic.{ext}"));
        img.save(&path).unwrap();
        path
    }

    fn block_on<F: std::future::Future>(f: F) -> F::Output {
        tauri::async_runtime::block_on(f)
    }

    #[test]
    fn loading_a_file_fills_in_its_name_format_and_history() {
        let path = temp_image("png", &solid_image(6, 4));

        let (tab_id, meta, history) = load_image_from_path(path.clone()).unwrap();

        assert!(!tab_id.is_empty());
        assert_eq!((meta.width, meta.height), (6, 4));
        assert_eq!(meta.format, "png");
        assert_eq!(meta.filename.as_deref(), Some("pic.png"));
        assert_eq!(meta.path.as_deref(), path.to_str());
        assert!(!meta.can_undo && !meta.can_redo);
        assert_eq!(history.source_path, Some(path));
        assert_eq!(history.entries.len(), 1);
    }

    #[test]
    fn loading_a_missing_file_fails() {
        assert!(load_image_from_path(PathBuf::from("/nowhere/nope.png")).is_err());
    }

    #[test]
    fn loading_a_file_that_is_not_an_image_fails() {
        let dir = std::env::temp_dir().join(format!("imgz-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("fake.png");
        std::fs::write(&path, b"pas une image").unwrap();

        assert!(load_image_from_path(path).is_err());
    }

    #[test]
    fn opening_by_path_creates_one_tab_per_image() {
        let h = Harness::empty();
        let a = temp_image("png", &solid_image(3, 3));
        let b = temp_image("bmp", &solid_image(5, 2));

        let result = block_on(open_images_by_paths(
            h.state(),
            vec![
                a.to_str().unwrap().to_string(),
                b.to_str().unwrap().to_string(),
            ],
        ))
        .unwrap();
        let opened = result.opened;

        assert_eq!(opened.len(), 2);
        assert_eq!(opened[0].meta.width, 3);
        assert_eq!(opened[1].meta.format, "bmp");
        let state = h.state();
        let map = state.0.lock().unwrap();
        assert_eq!(map.len(), 2);
        assert!(map.contains_key(&opened[0].tab_id));
    }

    #[test]
    fn opening_by_path_skips_unsupported_extensions() {
        let h = Harness::empty();
        let ok = temp_image("png", &solid_image(2, 2));

        let result = block_on(open_images_by_paths(
            h.state(),
            vec![
                "/tmp/notes.txt".to_string(),
                "/tmp/movie.mp4".to_string(),
                "/tmp/no-extension".to_string(),
                ok.to_str().unwrap().to_string(),
            ],
        ))
        .unwrap();
        let opened = result.opened;

        assert_eq!(opened.len(), 1);
    }

    #[test]
    fn the_extension_check_is_case_insensitive() {
        let h = Harness::empty();
        let path = temp_image("png", &solid_image(2, 2));
        let upper = path.with_file_name("PIC.PNG");
        std::fs::rename(&path, &upper).unwrap();

        let result = block_on(open_images_by_paths(
            h.state(),
            vec![upper.to_str().unwrap().to_string()],
        ))
        .unwrap();
        let opened = result.opened;

        assert_eq!(opened.len(), 1);
    }

    #[test]
    fn opening_by_path_ignores_files_that_fail_to_decode() {
        let h = Harness::empty();
        let dir = std::env::temp_dir().join(format!("imgz-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let broken = dir.join("broken.png");
        std::fs::write(&broken, b"xx").unwrap();

        let result = block_on(open_images_by_paths(
            h.state(),
            vec![broken.to_str().unwrap().to_string()],
        ))
        .unwrap();
        let opened = result.opened;

        assert!(opened.is_empty());
        assert!(h.state().0.lock().unwrap().is_empty());
    }

    #[test]
    fn opening_an_empty_list_yields_nothing() {
        let h = Harness::empty();

        let result = block_on(open_images_by_paths(h.state(), vec![])).unwrap();
        let opened = result.opened;

        assert!(opened.is_empty());
    }

    #[test]
    fn a_file_that_fails_to_decode_is_reported_not_dropped() {
        let h = Harness::empty();
        let dir = std::env::temp_dir().join(format!("imgz-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let broken = dir.join("broken.png");
        std::fs::write(&broken, b"xx").unwrap();
        let ok = temp_image("png", &solid_image(2, 2));

        let result = block_on(open_images_by_paths(
            h.state(),
            vec![
                broken.to_str().unwrap().to_string(),
                ok.to_str().unwrap().to_string(),
            ],
        ))
        .unwrap();

        assert_eq!(result.opened.len(), 1);
        assert_eq!(result.failed.len(), 1);
        assert!(result.failed[0].path.ends_with("broken.png"));
        assert!(!result.failed[0].error.is_empty());
    }

    #[test]
    fn the_format_comes_from_the_content_not_the_extension() {
        // Un JPEG nommé .png (téléchargement mal nommé) doit s'ouvrir.
        let jpeg = temp_image("jpg", &DynamicImage::ImageRgb8(image::RgbImage::new(8, 4)));
        let fake = jpeg.with_file_name("really-a-jpeg.png");
        std::fs::rename(&jpeg, &fake).unwrap();

        let (_, meta, _) = load_image_from_path(fake).unwrap();

        assert_eq!(meta.format, "jpeg");
        assert_eq!((meta.width, meta.height), (8, 4));
    }

    #[test]
    fn exif_orientation_is_applied_on_opening() {
        use img_parts::ImageEXIF;
        let path = temp_image(
            "jpg",
            &DynamicImage::ImageRgb8(image::RgbImage::new(40, 20)),
        );
        // Orientation = 6 : l'image doit être tournée de 90° dans le sens horaire.
        let exif: Vec<u8> = vec![
            b'I', b'I', 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00,
            0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        let mut jpeg =
            img_parts::jpeg::Jpeg::from_bytes(std::fs::read(&path).unwrap().into()).unwrap();
        jpeg.set_exif(Some(exif.into()));
        std::fs::write(&path, jpeg.encoder().bytes()).unwrap();

        let (_, meta, _) = load_image_from_path(path).unwrap();

        assert_eq!((meta.width, meta.height), (20, 40));
    }

    #[test]
    fn a_fresh_tab_starts_with_a_single_history_entry() {
        let path = temp_image("png", &solid_image(5, 5));

        let (_, meta, history) = load_image_from_path(path).unwrap();

        assert_eq!((meta.history_len, meta.history_index), (1, 0));
        assert_eq!(history.format, "png");
    }

    #[test]
    fn a_thumbnail_is_small_whatever_the_image_size() {
        let meta = build_meta(&solid_image(800, 400), "png", false, false).unwrap();
        let bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            meta.thumbnail.trim_start_matches("data:image/png;base64,"),
        )
        .unwrap();
        let thumb = image::load_from_memory(&bytes).unwrap();
        assert_eq!((thumb.width(), thumb.height()), (160, 80));
    }
}
