use super::blocking;
use super::error::CmdResult;
use super::registry::OpenProjects;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

/// Lit un média (vidéo/image/audio) et le renvoie en octets bruts plutôt que via le protocole
/// `asset://`. Contournement pour la vidéo : WebKitGTK (webview Tauri sur Linux) rejette parfois
/// un `<video src="asset://...">` avec `MEDIA_ERR_SRC_NOT_SUPPORTED` alors que le fichier est
/// parfaitement lisible (GStreamer le décode sans problème en dehors de la webview) — un schéma
/// d'URL personnalisé n'est pas toujours accepté comme source par l'élément `<video>`, contrairement
/// à `<img>`. Charger les octets et construire une URL `blob:` côté frontend contourne le problème.
#[tauri::command]
pub async fn read_media_file(
    projects: State<'_, OpenProjects>,
    project_dir: String,
    relative_src: String,
) -> CmdResult<tauri::ipc::Response> {
    let dir = projects.require(&project_dir)?;
    blocking(move || read_media_bytes(&dir, &relative_src))
        .await
        .map(tauri::ipc::Response::new)
}

fn read_media_bytes(project_dir: &Path, relative_src: &str) -> Result<Vec<u8>, String> {
    let path = scene_core::paths::resolve_media_path(project_dir, relative_src)?;
    fs::read(&path).map_err(|e| format!("Failed to read media file: {e}"))
}

/// Sous-dossier de `assets/` dans lequel stocker ce type de média.
pub(crate) fn kind_subdir(kind: &str) -> Result<&'static str, String> {
    match kind {
        "image" => Ok("images"),
        "video" => Ok("videos"),
        "audio" => Ok("audio"),
        _ => Err(format!("Unknown media type: {kind}")),
    }
}

/// Extensions acceptées par type de média : seule la copie de vrais médias est permise dans les
/// dossiers du projet (pas de fichier arbitraire du disque présenté comme un « son »).
fn allowed_extensions(kind: &str) -> &'static [&'static str] {
    match kind {
        "image" => &[
            "png", "jpg", "jpeg", "jpe", "jfif", "webp", "gif", "bmp", "avif",
        ],
        "video" => &[
            "mp4", "m4v", "mov", "mkv", "webm", "avi", "mpg", "mpeg", "mts", "m2ts", "ogv", "wmv",
            "flv", "3gp",
        ],
        "audio" => &[
            "mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "wma", "aif", "aiff",
        ],
        _ => &[],
    }
}

/// Vrai si `filename` a une extension autorisée pour ce type de média.
pub(crate) fn has_allowed_extension(kind: &str, filename: &str) -> bool {
    Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| {
            allowed_extensions(kind)
                .iter()
                .any(|allowed| allowed.eq_ignore_ascii_case(ext))
        })
}

/// Évite d'écraser un fichier existant en suffixant `-2`, `-3`, ... avant l'extension.
pub(crate) fn unique_destination(dir: &Path, filename: &str) -> PathBuf {
    let mut dest = dir.join(filename);
    if !dest.exists() {
        return dest;
    }
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    let ext = Path::new(filename)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let mut i = 2;
    loop {
        let candidate = if ext.is_empty() {
            format!("{stem}-{i}")
        } else {
            format!("{stem}-{i}.{ext}")
        };
        dest = dir.join(candidate);
        if !dest.exists() {
            return dest;
        }
        i += 1;
    }
}

/// Copie un fichier choisi par l'utilisateur dans `<project_dir>/assets/<kind>s/`.
/// Retourne le chemin relatif au dossier projet (ex: `assets/images/logo.png`).
#[tauri::command]
pub async fn import_asset(
    projects: State<'_, OpenProjects>,
    project_dir: String,
    kind: String,
    source_path: String,
) -> CmdResult<String> {
    let dir = projects.require(&project_dir)?;
    blocking(move || copy_asset(&dir, &kind, &source_path)).await
}

fn copy_asset(project_dir: &Path, kind: &str, source_path: &str) -> Result<String, String> {
    let subdir = kind_subdir(kind)?;
    let source = Path::new(source_path);
    let filename = source
        .file_name()
        .and_then(|f| f.to_str())
        .ok_or_else(|| "Invalid source filename".to_string())?;
    if !has_allowed_extension(kind, filename) {
        return Err(format!("Unsupported {kind} file type: {filename}"));
    }
    let target_dir = project_dir.join("assets").join(subdir);
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Failed to create assets directory: {e}"))?;

    let dest = unique_destination(&target_dir, filename);
    fs::copy(source, &dest).map_err(|e| format!("Failed to copy file: {e}"))?;

    let dest_filename = dest
        .file_name()
        .and_then(|f| f.to_str())
        .ok_or_else(|| "Invalid destination filename".to_string())?;
    Ok(format!("assets/{subdir}/{dest_filename}"))
}

#[derive(Debug, Serialize)]
pub struct AssetInfo {
    pub filename: String,
    pub relative_path: String,
}

/// Liste les médias déjà importés dans `<project_dir>/assets/<kind>s/`.
#[tauri::command]
pub async fn list_assets(
    projects: State<'_, OpenProjects>,
    project_dir: String,
    kind: String,
) -> CmdResult<Vec<AssetInfo>> {
    let dir = projects.require(&project_dir)?;
    blocking(move || scan_assets(&dir, &kind)).await
}

fn scan_assets(project_dir: &Path, kind: &str) -> Result<Vec<AssetInfo>, String> {
    let subdir = kind_subdir(kind)?;
    let dir = project_dir.join("assets").join(subdir);
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(vec![]),
    };

    let mut assets = Vec::new();
    for entry in entries.flatten() {
        if entry.path().is_file() {
            if let Some(filename) = entry.file_name().to_str() {
                assets.push(AssetInfo {
                    filename: filename.to_string(),
                    relative_path: format!("assets/{subdir}/{filename}"),
                });
            }
        }
    }
    assets.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(assets)
}

/// Supprime un média importé (`assets/<kind>s/<fichier>`). Les médias encore utilisés par le
/// projet sont refusés côté interface ; ici seul le chemin est contrôlé (même dossier que
/// l'import, aucun sous-dossier ni `..`).
#[tauri::command]
pub async fn delete_asset(
    projects: State<'_, OpenProjects>,
    project_dir: String,
    kind: String,
    filename: String,
) -> CmdResult<()> {
    let dir = projects.require(&project_dir)?;
    blocking(move || remove_asset(&dir, &kind, &filename)).await
}

fn remove_asset(project_dir: &Path, kind: &str, filename: &str) -> Result<(), String> {
    let subdir = kind_subdir(kind)?;
    let is_plain_name = Path::new(filename)
        .file_name()
        .is_some_and(|n| n == std::ffi::OsStr::new(filename));
    if !is_plain_name {
        return Err("Invalid asset filename".to_string());
    }
    let path = project_dir.join("assets").join(subdir).join(filename);
    if !path.is_file() {
        return Err("Asset not found".to_string());
    }
    fs::remove_file(&path).map_err(|e| format!("Failed to delete asset: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn import(project: String, kind: String, source: String) -> Result<String, String> {
        copy_asset(Path::new(&project), &kind, &source)
    }

    fn list(project: String, kind: String) -> Result<Vec<AssetInfo>, String> {
        scan_assets(Path::new(&project), &kind)
    }

    fn read_media(project: String, relative: String) -> Result<Vec<u8>, String> {
        read_media_bytes(Path::new(&project), &relative)
    }

    #[test]
    fn kind_subdir_maps_known_kinds() {
        assert_eq!(kind_subdir("image"), Ok("images"));
        assert_eq!(kind_subdir("video"), Ok("videos"));
        assert_eq!(kind_subdir("audio"), Ok("audio"));
    }

    #[test]
    fn kind_subdir_rejects_an_unknown_kind() {
        assert!(kind_subdir("subtitle").is_err());
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "letest-assets-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn unique_destination_returns_the_plain_name_when_free() {
        let dir = temp_dir("free");
        assert_eq!(unique_destination(&dir, "logo.png"), dir.join("logo.png"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unique_destination_suffixes_on_collision_and_preserves_the_extension() {
        let dir = temp_dir("collision");
        fs::write(dir.join("logo.png"), b"a").unwrap();
        assert_eq!(unique_destination(&dir, "logo.png"), dir.join("logo-2.png"));

        fs::write(dir.join("logo-2.png"), b"b").unwrap();
        assert_eq!(unique_destination(&dir, "logo.png"), dir.join("logo-3.png"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unique_destination_handles_a_filename_without_extension() {
        let dir = temp_dir("noext");
        fs::write(dir.join("README"), b"a").unwrap();
        assert_eq!(unique_destination(&dir, "README"), dir.join("README-2"));
        let _ = fs::remove_dir_all(&dir);
    }

    // ── import ───────────────────────────────────────────────────────────────

    /// Projet temporaire, avec un fichier source à importer.
    fn project_with_source(filename: &str) -> (tempfile::TempDir, String, String) {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("clip.lvproj");
        std::fs::create_dir_all(&project).unwrap();
        let source = dir.path().join(filename);
        std::fs::write(&source, b"MEDIA").unwrap();
        (
            dir,
            project.to_string_lossy().into_owned(),
            source.to_string_lossy().into_owned(),
        )
    }

    #[test]
    fn importing_copies_the_file_and_returns_its_project_relative_path() {
        let (_dir, project, source) = project_with_source("logo.png");

        let rel = import(project.clone(), "image".into(), source).unwrap();

        assert_eq!(rel, "assets/images/logo.png");
        assert_eq!(
            std::fs::read(Path::new(&project).join(&rel)).unwrap(),
            b"MEDIA"
        );
    }

    #[test]
    fn each_media_type_lands_in_its_own_folder() {
        for (kind, subdir, name) in [
            ("image", "images", "a.png"),
            ("video", "videos", "b.mp4"),
            ("audio", "audio", "c.mp3"),
        ] {
            let (_dir, project, source) = project_with_source(name);

            let rel = import(project, kind.into(), source).unwrap();

            assert_eq!(rel, format!("assets/{subdir}/{name}"));
        }
    }

    #[test]
    fn importing_the_same_name_twice_keeps_both_files() {
        let (_dir, project, source) = project_with_source("logo.png");
        let first = import(project.clone(), "image".into(), source.clone()).unwrap();

        let second = import(project.clone(), "image".into(), source).unwrap();

        assert_eq!(first, "assets/images/logo.png");
        assert_eq!(second, "assets/images/logo-2.png");
        assert!(Path::new(&project).join(&first).is_file());
        assert!(Path::new(&project).join(&second).is_file());
    }

    #[test]
    fn importing_an_unknown_media_type_is_refused() {
        let (_dir, project, source) = project_with_source("a.bin");

        let err = import(project, "hologram".into(), source).unwrap_err();

        assert_eq!(err, "Unknown media type: hologram");
    }

    #[test]
    fn importing_a_missing_source_is_refused() {
        let (_dir, project, _source) = project_with_source("a.png");

        let err = import(project, "image".into(), "/nowhere/a.png".into()).unwrap_err();

        assert!(err.starts_with("Failed to copy file:"), "{err}");
    }

    #[test]
    fn a_source_path_with_no_filename_is_refused() {
        let (_dir, project, _source) = project_with_source("a.png");

        let err = import(project, "image".into(), "/".into()).unwrap_err();

        assert_eq!(err, "Invalid source filename");
    }

    // ── listing ──────────────────────────────────────────────────────────────

    #[test]
    fn listing_returns_the_imported_files_sorted() {
        let (_dir, project, source) = project_with_source("b.png");
        import(project.clone(), "image".into(), source).unwrap();
        let other = Path::new(&project).join("assets/images/a.png");
        std::fs::write(&other, b"X").unwrap();

        let assets = list(project, "image".into()).unwrap();

        assert_eq!(
            assets
                .iter()
                .map(|a| a.filename.as_str())
                .collect::<Vec<_>>(),
            ["a.png", "b.png"]
        );
        assert_eq!(assets[0].relative_path, "assets/images/a.png");
    }

    #[test]
    fn listing_a_folder_that_does_not_exist_yet_is_empty() {
        let (_dir, project, _source) = project_with_source("a.png");

        assert!(list(project, "video".into()).unwrap().is_empty());
    }

    #[test]
    fn listing_skips_sub_folders() {
        let (_dir, project, source) = project_with_source("a.png");
        import(project.clone(), "image".into(), source).unwrap();
        std::fs::create_dir_all(Path::new(&project).join("assets/images/nested")).unwrap();

        let assets = list(project, "image".into()).unwrap();

        assert_eq!(assets.len(), 1);
    }

    #[test]
    fn listing_an_unknown_media_type_is_refused() {
        let (_dir, project, _source) = project_with_source("a.png");

        assert!(list(project, "hologram".into()).is_err());
    }

    #[test]
    fn each_kind_only_lists_its_own_folder() {
        let (dir, project, image) = project_with_source("a.png");
        let audio = dir.path().join("a.mp3");
        std::fs::write(&audio, b"MEDIA").unwrap();
        import(project.clone(), "image".into(), image).unwrap();
        import(
            project.clone(),
            "audio".into(),
            audio.to_string_lossy().into_owned(),
        )
        .unwrap();

        assert_eq!(list(project.clone(), "image".into()).unwrap().len(), 1);
        assert_eq!(list(project.clone(), "audio".into()).unwrap().len(), 1);
        assert!(list(project, "video".into()).unwrap().is_empty());
    }

    #[test]
    fn a_file_that_is_not_a_media_of_that_kind_is_refused() {
        let (_dir, project, source) = project_with_source("secret.pem");

        let err = import(project.clone(), "audio".into(), source.clone()).unwrap_err();
        assert!(err.starts_with("Unsupported audio file type"), "{err}");
        assert!(import(project, "image".into(), source).is_err());
    }

    #[test]
    fn extensions_are_matched_case_insensitively_per_kind() {
        assert!(has_allowed_extension("image", "Photo.JPG"));
        assert!(has_allowed_extension("video", "clip.MOV"));
        assert!(!has_allowed_extension("video", "photo.png"));
        assert!(!has_allowed_extension("audio", "noext"));
        assert!(!has_allowed_extension("hologram", "a.png"));
    }

    // ── suppression ──────────────────────────────────────────────────────────

    #[test]
    fn deleting_removes_only_the_named_asset() {
        let (_dir, project, source) = project_with_source("logo.png");
        let rel = import(project.clone(), "image".into(), source).unwrap();

        remove_asset(Path::new(&project), "image", "logo.png").unwrap();

        assert!(!Path::new(&project).join(rel).exists());
    }

    #[test]
    fn deleting_refuses_paths_that_leave_the_assets_folder() {
        let (_dir, project, _source) = project_with_source("a.png");
        std::fs::write(Path::new(&project).join("project.json"), b"{}").unwrap();

        for name in ["../../project.json", "sub/a.png", "..", ""] {
            assert!(
                remove_asset(Path::new(&project), "image", name).is_err(),
                "{name:?}"
            );
        }
        assert!(Path::new(&project).join("project.json").exists());
    }

    #[test]
    fn deleting_a_missing_asset_is_refused() {
        let (_dir, project, _source) = project_with_source("a.png");
        assert!(remove_asset(Path::new(&project), "image", "absent.png").is_err());
    }

    // ── lecture brute ────────────────────────────────────────────────────────

    #[test]
    fn reading_a_media_file_succeeds_for_an_imported_asset() {
        let (_dir, project, source) = project_with_source("clip.mp4");
        let rel = import(project.clone(), "video".into(), source).unwrap();

        // `Response` n'implémente pas Debug : on teste l'issue, pas son contenu.
        assert!(read_media(project, rel).is_ok());
    }

    #[test]
    fn reading_a_media_file_that_is_gone_is_refused() {
        let (_dir, project, _source) = project_with_source("a.png");

        let Err(err) = read_media(project, "assets/images/absent.png".into()) else {
            panic!("un fichier absent doit être refusé");
        };

        // La résolution du chemin échoue avant même la lecture.
        assert!(err.starts_with("media file not found:"), "{err}");
    }

    #[test]
    fn reading_outside_the_project_is_refused() {
        // `resolve_media_path` interdit de remonter hors du dossier projet.
        let (_dir, project, _source) = project_with_source("a.png");

        assert!(read_media(project, "../../etc/passwd".into()).is_err());
    }
}
