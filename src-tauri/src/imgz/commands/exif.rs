use exif::In;
use img_parts::ImageEXIF;
use serde::Serialize;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::imgz::AppState;

#[derive(Serialize, Debug)]
pub struct ExifField {
    pub tag: String,
    pub value: String,
}

#[tauri::command]
pub async fn get_exif(
    state: State<'_, AppState>,
    tab_id: String,
) -> Result<Vec<ExifField>, String> {
    let source_path = {
        let map = state.0.lock().map_err(|e| e.to_string())?;
        let history = map.get(&tab_id).ok_or("Tab not found")?;
        history.source_path.clone()
    };

    let Some(path) = source_path else {
        return Ok(vec![]);
    };

    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut buf = std::io::BufReader::new(file);
    let reader = exif::Reader::new();

    let exif_data = match reader.read_from_container(&mut buf) {
        Ok(data) => data,
        Err(_) => return Ok(vec![]),
    };

    let fields = exif_data
        .fields()
        .filter(|f| f.ifd_num == In::PRIMARY)
        .map(|f| ExifField {
            tag: f.tag.to_string(),
            value: f.display_value().with_unit(&exif_data).to_string(),
        })
        .collect();

    Ok(fields)
}

/// Extension normalisée d'un chemin source (`jpeg` -> `jpg`), pour le filtre du sélecteur
/// de fichier et pour décider de la stratégie de nettoyage.
pub fn filter_extension(ext: &str) -> &str {
    if ext == "jpg" || ext == "jpeg" {
        "jpg"
    } else {
        ext
    }
}

pub fn source_extension(source_path: Option<&std::path::Path>) -> String {
    source_path
        .and_then(|p| p.extension())
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default()
}

/// Un EXIF minimal (TIFF little-endian, une seule entrée `Orientation`).
fn orientation_only_exif(orientation: u16) -> Vec<u8> {
    let [lo, hi] = orientation.to_le_bytes();
    vec![
        b'I', b'I', 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, // en-tête, IFD à l'offset 8
        0x01, 0x00, // une entrée
        0x12, 0x01, // tag 0x0112 = Orientation
        0x03, 0x00, // type SHORT
        0x01, 0x00, 0x00, 0x00, // count = 1
        lo, hi, 0x00, 0x00, // valeur
        0x00, 0x00, 0x00, 0x00, // pas d'IFD suivant
    ]
}

/// L'orientation EXIF d'un JPEG (1 si absente ou illisible).
fn jpeg_orientation(jpeg: &img_parts::jpeg::Jpeg) -> u16 {
    jpeg.exif()
        .and_then(|tiff| exif::Reader::new().read_raw(tiff.to_vec()).ok())
        .and_then(|data| {
            data.get_field(exif::Tag::Orientation, In::PRIMARY)
                .and_then(|f| f.value.get_uint(0))
        })
        .map_or(1, |v| v as u16)
}

/// Coupe tout ce qui suit le premier marqueur EOI : `img-parts` recopie tel quel ce qui suit le
/// premier SOS, donc les images secondaires (MPF : gain maps, souvent géolocalisées) et les
/// données ajoutées après la fin de l'image survivraient au nettoyage.
fn truncate_after_eoi(bytes: &mut Vec<u8>) {
    let mut at = 2; // après SOI
    while at + 4 <= bytes.len() && bytes[at] == 0xFF {
        let marker = bytes[at + 1];
        let length = usize::from(u16::from_be_bytes([bytes[at + 2], bytes[at + 3]]));
        at += 2 + length;
        if marker == 0xDA {
            // Données entropiques : le premier FF D9 est la fin de l'image (FF 00 est du bourrage).
            if let Some(eoi) = bytes[at..].windows(2).position(|w| w == [0xFF, 0xD9]) {
                bytes.truncate(at + eoi + 2);
            }
            return;
        }
    }
}

/// Réécrit un JPEG sans métadonnées, sans toucher aux pixels. Reste : JFIF (APP0), profil ICC,
/// Adobe (APP14) et les segments d'image. Disparaissent : EXIF, XMP (aussi étendu), IPTC, MPF,
/// commentaires et tout autre APPn. L'orientation est conservée dans un EXIF minimal : les pixels
/// de la source sont couchés, la balise seule les redresse (sinon une photo portrait ressort
/// tournée de 90°).
pub fn strip_jpeg(data: Vec<u8>) -> Result<Vec<u8>, String> {
    let mut jpeg = img_parts::jpeg::Jpeg::from_bytes(data.into()).map_err(|e| e.to_string())?;
    let orientation = jpeg_orientation(&jpeg);
    jpeg.segments_mut().retain(|s| match s.marker() {
        0xE0 | 0xEE => true,
        0xE2 => s.contents().starts_with(b"ICC_PROFILE\0"),
        0xE1..=0xEF | 0xFE => false,
        _ => true,
    });
    if orientation != 1 {
        jpeg.set_exif(Some(orientation_only_exif(orientation).into()));
    }
    let mut bytes = jpeg.encoder().bytes().to_vec();
    truncate_after_eoi(&mut bytes);
    Ok(bytes)
}

/// Écrit `img` (ou la source JPEG d'origine) dans `output`, sans métadonnées.
///
/// `pristine` indique que l'image en mémoire est encore celle du fichier d'origine. Seul ce
/// cas permet le retrait **sans perte** (réécriture du conteneur JPEG) ; dès qu'il y a eu
/// des retouches, relire le fichier source ferait perdre tout le travail, donc l'image en
/// mémoire est ré-encodée (ce qui supprime les métadonnées de toute façon).
///
/// Séparé de la commande : celle-ci ne fait qu'ouvrir la boîte de dialogue, tout ce qui
/// suit le choix du fichier est ici et donc testable sans interface.
pub fn write_stripped(
    source_path: Option<&std::path::Path>,
    img: &image::DynamicImage,
    output: &std::path::Path,
    pristine: bool,
    icc: Option<&[u8]>,
) -> Result<(), String> {
    if pristine {
        if let Some(src) = source_path {
            let data = std::fs::read(src).map_err(|e| e.to_string())?;
            // Le contenu décide, pas l'extension : un JPEG nommé `.png` se nettoie sans perte, un
            // fichier nommé `.jpg` qui n'en est pas un est ré-encodé.
            if data.starts_with(&[0xFF, 0xD8]) {
                return super::export::write_atomic(output, &strip_jpeg(data)?);
            }
        }
    }

    let format = image::ImageFormat::from_path(output).map_err(|e| e.to_string())?;
    let quality = (format == image::ImageFormat::Jpeg).then_some(95);
    super::export::write_image_with_icc(img, output, format, quality, icc, None)
}

#[tauri::command]
pub async fn strip_exif(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
) -> Result<bool, String> {
    let source_path = {
        let map = state.0.lock().map_err(|e| e.to_string())?;
        let history = map.get(&tab_id).ok_or("Tab not found")?;
        history.source_path.clone()
    };

    let ext = source_extension(source_path.as_deref());
    let filter_ext = filter_extension(&ext);
    let stem = source_path
        .as_deref()
        .and_then(|p| p.file_stem())
        .and_then(|s| s.to_str())
        .unwrap_or("stripped");

    let save_path = app
        .dialog()
        .file()
        .add_filter("Image", &[filter_ext])
        .set_file_name(format!("{stem}-stripped.{filter_ext}"))
        .blocking_save_file();

    let Some(save_path) = save_path else {
        return Ok(false);
    };
    let output = save_path.into_path().map_err(|e| e.to_string())?;

    let (img, pristine, icc) = {
        let map = state.0.lock().map_err(|e| e.to_string())?;
        let history = map.get(&tab_id).ok_or("Tab not found")?;
        (
            history.current_arc().ok_or("No image loaded")?,
            history.index == Some(0),
            history.icc.clone(),
        )
    };
    write_stripped(
        source_path.as_deref(),
        &img,
        &output,
        pristine,
        icc.as_deref(),
    )?;

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imgz::test_support::{solid, Harness, TAB};
    use crate::imgz::AppHistory;
    use image::GenericImageView;
    use img_parts::ImageICC;
    use std::path::PathBuf;

    fn block_on<F: std::future::Future>(f: F) -> F::Output {
        tauri::async_runtime::block_on(f)
    }

    /// Onglet dont l'image provient d'un fichier réellement écrit sur disque.
    fn tab_from_file(ext: &str) -> (Harness, PathBuf) {
        let dir = std::env::temp_dir().join(format!("imgz-exif-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("pic.{ext}"));
        let img = solid(4, 4, [10, 20, 30]);
        img.save(&path).unwrap();

        let mut history = AppHistory::new();
        history.source_path = Some(path.clone());
        history.open(img);
        (Harness::with_history(history), path)
    }

    #[test]
    fn an_unknown_tab_is_rejected() {
        let h = Harness::empty();

        let err = block_on(get_exif(h.state(), TAB.into())).unwrap_err();

        assert_eq!(err, "Tab not found");
    }

    #[test]
    fn an_image_with_no_source_file_has_no_metadata() {
        // Cas d'un onglet créé en mémoire (jamais ouvert depuis le disque).
        let h = Harness::with_image(solid(2, 2, [1, 2, 3]));

        let fields = block_on(get_exif(h.state(), TAB.into())).unwrap();

        assert!(fields.is_empty());
    }

    #[test]
    fn a_vanished_source_file_surfaces_the_io_error() {
        let (h, path) = tab_from_file("png");
        std::fs::remove_file(&path).unwrap();

        assert!(block_on(get_exif(h.state(), TAB.into())).is_err());
    }

    #[test]
    fn a_file_without_an_exif_block_yields_no_fields() {
        let (h, _path) = tab_from_file("png");

        let fields = block_on(get_exif(h.state(), TAB.into())).unwrap();

        assert!(fields.is_empty());
    }

    #[test]
    fn the_primary_ifd_fields_are_reported_as_tag_value_pairs() {
        let (h, path) = tab_from_file("jpg");

        // On greffe un bloc EXIF minimal (TIFF little-endian, une entrée Orientation).
        let exif: Vec<u8> = vec![
            b'I', b'I', 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, // en-tête, IFD à l'offset 8
            0x01, 0x00, // une entrée
            0x12, 0x01, // tag 0x0112 = Orientation
            0x03, 0x00, // type SHORT
            0x01, 0x00, 0x00, 0x00, // count = 1
            0x01, 0x00, 0x00, 0x00, // valeur = 1 (normale)
            0x00, 0x00, 0x00, 0x00, // pas d'IFD suivant
        ];
        let data = std::fs::read(&path).unwrap();
        let mut jpeg = img_parts::jpeg::Jpeg::from_bytes(data.into()).unwrap();
        jpeg.set_exif(Some(exif.into()));
        std::fs::write(&path, jpeg.encoder().bytes()).unwrap();

        let fields = block_on(get_exif(h.state(), TAB.into())).unwrap();

        let orientation = fields
            .iter()
            .find(|f| f.tag == "Orientation")
            .unwrap_or_else(|| {
                panic!(
                    "tags lus : {:?}",
                    fields.iter().map(|f| &f.tag).collect::<Vec<_>>()
                )
            });
        assert!(!orientation.value.is_empty());
    }

    #[test]
    fn a_field_serialises_as_tag_and_value() {
        let field = ExifField {
            tag: "Make".into(),
            value: "Canon".into(),
        };

        let json = serde_json::to_string(&field).unwrap();

        assert_eq!(json, r#"{"tag":"Make","value":"Canon"}"#);
    }

    // ── retrait de l'EXIF ────────────────────────────────────────────────────

    #[test]
    fn the_jpeg_extensions_share_one_filter() {
        assert_eq!(filter_extension("jpg"), "jpg");
        assert_eq!(filter_extension("jpeg"), "jpg");
        assert_eq!(filter_extension("png"), "png");
        assert_eq!(filter_extension(""), "");
    }

    #[test]
    fn the_source_extension_is_lowercased() {
        assert_eq!(
            source_extension(Some(&PathBuf::from("/a/PIC.JPEG"))),
            "jpeg"
        );
        assert_eq!(source_extension(Some(&PathBuf::from("/a/pic"))), "");
        assert_eq!(source_extension(None), "");
    }

    #[test]
    fn stripping_a_jpeg_removes_its_exif_block_losslessly() {
        let (h, path) = tab_from_file("jpg");
        let exif: Vec<u8> = vec![
            b'I', b'I', 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00,
            0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        let data = std::fs::read(&path).unwrap();
        let mut jpeg = img_parts::jpeg::Jpeg::from_bytes(data.into()).unwrap();
        jpeg.set_exif(Some(exif.into()));
        std::fs::write(&path, jpeg.encoder().bytes()).unwrap();
        assert!(!block_on(get_exif(h.state(), TAB.into()))
            .unwrap()
            .is_empty());

        let output = path.with_file_name("stripped.jpg");
        let img = solid(4, 4, [10, 20, 30]);
        write_stripped(Some(&path), &img, &output, true, None).unwrap();

        let cleaned = std::fs::read(&output).unwrap();
        let jpeg = img_parts::jpeg::Jpeg::from_bytes(cleaned.into()).unwrap();
        assert!(jpeg.exif().is_none());
        // Sans perte : l'image reste décodable et de même taille.
        assert_eq!(image::open(&output).unwrap().width(), 4);
    }

    #[test]
    fn stripping_a_non_jpeg_re_encodes_the_current_image() {
        let (_h, path) = tab_from_file("png");
        let output = path.with_file_name("stripped.png");

        write_stripped(Some(&path), &solid(7, 3, [1, 2, 3]), &output, true, None).unwrap();

        // C'est bien l'image en mémoire (7×3) qui est écrite, pas la source (4×4).
        assert_eq!(image::open(&output).unwrap().dimensions(), (7, 3));
    }

    #[test]
    fn stripping_without_a_source_falls_back_to_re_encoding() {
        let dir = std::env::temp_dir().join(format!("imgz-exif-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let output = dir.join("out.png");

        write_stripped(None, &solid(5, 5, [9, 9, 9]), &output, true, None).unwrap();

        assert_eq!(image::open(&output).unwrap().width(), 5);
    }

    #[test]
    fn a_corrupt_jpeg_source_surfaces_the_error() {
        let dir = std::env::temp_dir().join(format!("imgz-exif-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("broken.jpg");
        // La signature d'un JPEG, puis n'importe quoi.
        std::fs::write(&source, [0xFF, 0xD8, 0x00, 0x01, 0x02]).unwrap();

        let err = write_stripped(
            Some(&source),
            &solid(2, 2, [0, 0, 0]),
            &dir.join("out.jpg"),
            true,
            None,
        )
        .unwrap_err();

        assert!(!err.is_empty());
    }

    #[test]
    fn the_lossless_path_follows_the_content_not_the_extension() {
        let dir = std::env::temp_dir().join(format!("imgz-exif-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        // Un vrai JPEG nommé .png : nettoyé sans perte (octets JPEG), pas ré-encodé.
        let mut jpeg = Vec::new();
        solid(4, 4, [10, 20, 30])
            .write_to(
                &mut std::io::Cursor::new(&mut jpeg),
                image::ImageFormat::Jpeg,
            )
            .unwrap();
        let disguised = dir.join("photo.png");
        std::fs::write(&disguised, &jpeg).unwrap();
        let out = dir.join("clean.png");
        write_stripped(
            Some(&disguised),
            &solid(4, 4, [10, 20, 30]),
            &out,
            true,
            None,
        )
        .unwrap();
        assert!(std::fs::read(&out).unwrap().starts_with(&[0xFF, 0xD8]));

        // Un fichier .jpg qui n'en est pas un : l'image en mémoire est ré-encodée.
        let fake = dir.join("fake.jpg");
        std::fs::write(&fake, b"pas un jpeg").unwrap();
        let out2 = dir.join("clean2.jpg");
        write_stripped(Some(&fake), &solid(4, 4, [10, 20, 30]), &out2, true, None).unwrap();
        assert_eq!(image::open(&out2).unwrap().width(), 4);
    }

    #[test]
    fn a_missing_jpeg_source_surfaces_the_error() {
        let dir = std::env::temp_dir().join(format!("imgz-exif-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        assert!(write_stripped(
            Some(&dir.join("absent.jpg")),
            &solid(2, 2, [0, 0, 0]),
            &dir.join("out.jpg"),
            true,
            None
        )
        .is_err());
    }

    #[test]
    fn an_unwritable_destination_surfaces_the_error() {
        assert!(write_stripped(
            None,
            &solid(2, 2, [0, 0, 0]),
            &PathBuf::from("/nowhere-at-all/out.png"),
            true,
            None
        )
        .is_err());
    }

    #[test]
    fn a_retouched_jpeg_keeps_its_edits_when_stripped() {
        // Régression : la source était relue sur disque et les retouches perdues.
        let (_h, path) = tab_from_file("jpg"); // source 4×4
        let output = path.with_file_name("stripped.jpg");

        write_stripped(
            Some(&path),
            &solid(10, 6, [200, 0, 0]),
            &output,
            false,
            None,
        )
        .unwrap();

        assert_eq!(image::open(&output).unwrap().dimensions(), (10, 6));
    }

    #[test]
    fn stripping_a_jpeg_also_removes_xmp_and_iptc() {
        let (_h, path) = tab_from_file("jpg");
        let data = std::fs::read(&path).unwrap();
        let mut jpeg = img_parts::jpeg::Jpeg::from_bytes(data.into()).unwrap();
        let xmp = [b"http://ns.adobe.com/xap/1.0/\0".as_slice(), b"<x/>"].concat();
        let at = 1.min(jpeg.segments().len());
        jpeg.segments_mut().insert(
            at,
            img_parts::jpeg::JpegSegment::new_with_contents(0xE1, xmp.into()),
        );
        jpeg.segments_mut().insert(
            at,
            img_parts::jpeg::JpegSegment::new_with_contents(
                0xED,
                b"Photoshop 3.0\0".to_vec().into(),
            ),
        );
        std::fs::write(&path, jpeg.encoder().bytes()).unwrap();
        let output = path.with_file_name("clean.jpg");

        write_stripped(Some(&path), &solid(4, 4, [10, 20, 30]), &output, true, None).unwrap();

        let cleaned =
            img_parts::jpeg::Jpeg::from_bytes(std::fs::read(&output).unwrap().into()).unwrap();
        assert!(cleaned.segments().iter().all(|s| s.marker() != 0xED));
        assert!(cleaned.segments().iter().all(
            |s| !(s.marker() == 0xE1 && s.contents().starts_with(b"http://ns.adobe.com/xap/"))
        ));
    }

    /// Un JPEG de test : `solid` encodé, avec les segments donnés insérés avant les données.
    fn jpeg_with(extra: Vec<img_parts::jpeg::JpegSegment>, trailer: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::new();
        solid(4, 4, [10, 20, 30])
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Jpeg,
            )
            .unwrap();
        let mut jpeg = img_parts::jpeg::Jpeg::from_bytes(bytes.into()).unwrap();
        for (i, segment) in extra.into_iter().enumerate() {
            jpeg.segments_mut().insert(1 + i, segment);
        }
        let mut out = jpeg.encoder().bytes().to_vec();
        out.extend_from_slice(trailer);
        out
    }

    #[test]
    fn a_portrait_photo_keeps_its_orientation_when_its_exif_is_stripped() {
        let exif = [b"Exif\0\0".as_slice(), &orientation_only_exif(6)].concat();
        let source = jpeg_with(
            vec![img_parts::jpeg::JpegSegment::new_with_contents(
                0xE1,
                exif.into(),
            )],
            &[],
        );

        let cleaned =
            img_parts::jpeg::Jpeg::from_bytes(strip_jpeg(source).unwrap().into()).unwrap();

        assert_eq!(jpeg_orientation(&cleaned), 6);
        assert!(
            cleaned
                .segments()
                .iter()
                .filter(|s| s.marker() == 0xE1)
                .count()
                == 1
        );
    }

    #[test]
    fn no_orientation_is_written_when_the_photo_is_upright() {
        let source = jpeg_with(vec![], &[]);
        let cleaned =
            img_parts::jpeg::Jpeg::from_bytes(strip_jpeg(source).unwrap().into()).unwrap();
        assert!(cleaned.exif().is_none());
    }

    #[test]
    fn comments_extra_app_segments_mpf_and_trailing_images_are_removed() {
        let mpf =
            img_parts::jpeg::JpegSegment::new_with_contents(0xE2, b"MPF\0xxxx".to_vec().into());
        let comment = img_parts::jpeg::JpegSegment::new_with_contents(
            0xFE,
            b"gps 48.85,2.35".to_vec().into(),
        );
        let ext_xmp = img_parts::jpeg::JpegSegment::new_with_contents(
            0xE1,
            [
                b"http://ns.adobe.com/xmp/extension/\0".as_slice(),
                b"secret",
            ]
            .concat()
            .into(),
        );
        // Une seconde image complète (gain map) après la fin de la première.
        let trailer = jpeg_with(vec![], &[]);
        let source = jpeg_with(vec![mpf, comment, ext_xmp], &trailer);

        let out = strip_jpeg(source).unwrap();

        assert!(out.ends_with(&[0xFF, 0xD9]));
        assert_eq!(
            out.windows(2).filter(|w| *w == [0xFF, 0xD8]).count(),
            1,
            "one SOI only"
        );
        let cleaned = img_parts::jpeg::Jpeg::from_bytes(out.clone().into()).unwrap();
        assert!(cleaned
            .segments()
            .iter()
            .all(|s| !matches!(s.marker(), 0xE1 | 0xE2 | 0xFE)));
        assert!(!out.windows(6).any(|w| w == b"secret"));
        assert_eq!(image::load_from_memory(&out).unwrap().width(), 4);
    }

    #[test]
    fn the_icc_profile_survives_the_strip() {
        let icc = [b"ICC_PROFILE\0".as_slice(), &[1, 1], b"profile"].concat();
        let source = jpeg_with(
            vec![img_parts::jpeg::JpegSegment::new_with_contents(
                0xE2,
                icc.into(),
            )],
            &[],
        );
        let cleaned =
            img_parts::jpeg::Jpeg::from_bytes(strip_jpeg(source).unwrap().into()).unwrap();
        assert!(cleaned.icc_profile().is_some());
    }
}
