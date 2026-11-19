//! Les sous-titres associés à un média : hors projet, dans les données de l'application (le lien
//! repose sur le chemin, la taille et la date du fichier) ; dans un projet, un `.srt` à côté du
//! média copié, qui voyage avec le dossier. Et l'ajout d'un fichier exporté à des projets.

use crate::commands::assets::{has_allowed_extension, unique_destination};
use crate::commands::registry::OpenProjects;
use audio_dsp::approval::Approved;
use audio_dsp::error::CmdError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubEntry {
    pub id: String,
    pub label: String,
    pub srt: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Stored {
    size: u64,
    modified_ms: u128,
    entries: Vec<SubEntry>,
}

/// Taille et date du fichier : s'il change, ses sous-titres ne le décrivent plus.
fn fingerprint(media: &Path) -> Option<(u64, u128)> {
    let meta = fs::metadata(media).ok()?;
    let modified = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    Some((meta.len(), modified.as_millis()))
}

fn store_path(dir: &Path, media: &Path) -> PathBuf {
    let digest = Sha256::digest(media.to_string_lossy().as_bytes());
    let name: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    dir.join(format!("{name}.json"))
}

fn list_in(dir: &Path, media: &Path) -> Vec<SubEntry> {
    let Some((size, modified_ms)) = fingerprint(media) else {
        return Vec::new();
    };
    fs::read(store_path(dir, media))
        .ok()
        .and_then(|raw| serde_json::from_slice::<Stored>(&raw).ok())
        .filter(|s| s.size == size && s.modified_ms == modified_ms)
        .map(|s| s.entries)
        .unwrap_or_default()
}

fn write_in(dir: &Path, media: &Path, entries: Vec<SubEntry>) -> Result<(), String> {
    let file = store_path(dir, media);
    if entries.is_empty() {
        let _ = fs::remove_file(file);
        return Ok(());
    }
    let (size, modified_ms) =
        fingerprint(media).ok_or_else(|| format!("Cannot read {}", media.display()))?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let stored = Stored {
        size,
        modified_ms,
        entries,
    };
    fs::write(
        file,
        serde_json::to_vec(&stored).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Failed to store the subtitles: {e}"))
}

fn save_in(dir: &Path, media: &Path, entry: SubEntry) -> Result<(), String> {
    let mut entries = list_in(dir, media);
    match entries.iter_mut().find(|e| e.id == entry.id) {
        Some(existing) => *existing = entry,
        None => entries.push(entry),
    }
    write_in(dir, media, entries)
}

fn remove_in(dir: &Path, media: &Path, id: &str) -> Result<(), String> {
    let mut entries = list_in(dir, media);
    entries.retain(|e| e.id != id);
    write_in(dir, media, entries)
}

fn store_dir(app: &AppHandle) -> Result<PathBuf, CmdError> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("media-subtitles"))
        .map_err(|e| CmdError::from(anyhow::anyhow!(e.to_string())))
}

fn refuse(message: String) -> CmdError {
    CmdError::from(anyhow::anyhow!(message))
}

/// Lectures et écritures de fichiers : hors du thread principal, où tournent les commandes
/// synchrones.
async fn off_main<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, CmdError> + Send + 'static,
) -> Result<T, CmdError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| refuse(e.to_string()))?
}

#[tauri::command]
pub async fn media_subs_list(
    app: AppHandle,
    approved: State<'_, Approved>,
    path: String,
) -> Result<Vec<SubEntry>, CmdError> {
    approved.check_input(&path).map_err(CmdError::from)?;
    off_main(move || Ok(list_in(&store_dir(&app)?, Path::new(&path)))).await
}

#[tauri::command]
pub async fn media_subs_save(
    app: AppHandle,
    approved: State<'_, Approved>,
    path: String,
    entry: SubEntry,
) -> Result<(), CmdError> {
    approved.check_input(&path).map_err(CmdError::from)?;
    off_main(move || save_in(&store_dir(&app)?, Path::new(&path), entry).map_err(refuse)).await
}

#[tauri::command]
pub async fn media_subs_remove(
    app: AppHandle,
    approved: State<'_, Approved>,
    path: String,
    id: String,
) -> Result<(), CmdError> {
    approved.check_input(&path).map_err(CmdError::from)?;
    off_main(move || remove_in(&store_dir(&app)?, Path::new(&path), &id).map_err(refuse)).await
}

/// Le `.srt` qui accompagne un média copié dans un projet.
pub fn sidecar(media: &Path) -> PathBuf {
    let mut name = media.as_os_str().to_os_string();
    name.push(".srt");
    PathBuf::from(name)
}

/// Le dernier sous-titre associé à `source`, recopié à côté du média importé dans un projet.
pub fn copy_association(app: &AppHandle, source: &Path, imported: &Path) {
    let Ok(dir) = store_dir(app) else { return };
    if let Some(entry) = list_in(&dir, source).pop() {
        let _ = fs::write(sidecar(imported), entry.srt);
    }
}

fn project_media(
    projects: &OpenProjects,
    project_dir: &str,
    src: &str,
) -> Result<PathBuf, CmdError> {
    let dir = projects.require(project_dir).map_err(refuse)?;
    scene_core::paths::resolve_media_path(&dir, src).map_err(refuse)
}

#[tauri::command]
pub async fn project_media_subtitle(
    projects: State<'_, OpenProjects>,
    project_dir: String,
    src: String,
) -> Result<Option<String>, CmdError> {
    let projects = projects.inner().clone();
    off_main(move || {
        let media = project_media(&projects, &project_dir, &src)?;
        Ok(fs::read_to_string(sidecar(&media)).ok())
    })
    .await
}

#[tauri::command]
pub async fn set_project_media_subtitle(
    projects: State<'_, OpenProjects>,
    project_dir: String,
    src: String,
    srt: String,
) -> Result<(), CmdError> {
    let projects = projects.inner().clone();
    off_main(move || {
        let media = project_media(&projects, &project_dir, &src)?;
        fs::write(sidecar(&media), srt).map_err(|e| refuse(e.to_string()))
    })
    .await
}

/// Le type de média d'un fichier exporté (un GIF est une image pour la médiathèque).
fn output_kind(filename: &str) -> Option<&'static str> {
    ["video", "audio", "image"]
        .into_iter()
        .find(|kind| has_allowed_extension(kind, filename))
}

/// Copie `output` dans la médiathèque d'un projet, avec son sous-titre s'il en a un.
fn add_to_project(project: &Path, output: &Path, srt: Option<&str>) -> Result<(), String> {
    if !crate::commands::project::is_project_dir(project) || !project.join("project.json").is_file()
    {
        return Err(format!("{} is not a project", project.display()));
    }
    let filename = output
        .file_name()
        .and_then(|f| f.to_str())
        .ok_or("Invalid file name")?;
    let kind =
        output_kind(filename).ok_or_else(|| format!("{filename} cannot be added to a project"))?;
    let dir = project
        .join("assets")
        .join(crate::commands::assets::kind_subdir(kind)?);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = unique_destination(&dir, filename);
    fs::copy(output, &dest).map_err(|e| format!("Failed to copy file: {e}"))?;
    if let Some(srt) = srt {
        fs::write(sidecar(&dest), srt).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct AddReport {
    pub added: usize,
    pub errors: Vec<String>,
}

/// Le média d'un projet que l'onglet d'édition modifie : l'export en devient une nouvelle version.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaOrigin {
    pub project_dir: String,
    pub src: String,
    /// Le clip depuis lequel l'édition a été demandée.
    #[serde(default)]
    pub element_id: Option<String>,
}

/// Annoncé (`project-media-saved`) quand une nouvelle version d'un média existe : l'éditeur du
/// projet y reporte les clips concernés.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSaved {
    pub project_dir: String,
    pub old_src: String,
    pub new_src: String,
    pub element_id: Option<String>,
}

/// Ajoute `output` à chaque projet et prévient les médiathèques ouvertes. Un export destiné aux
/// seuls projets est ensuite supprimé : les projets en ont leur copie.
pub fn add_everywhere<R: tauri::Runtime>(
    app: &AppHandle<R>,
    output: &Path,
    projects: &[String],
    srt: Option<&str>,
    origin: Option<&MediaOrigin>,
) -> AddReport {
    let mut report = AddReport::default();
    if let Some(origin) = origin {
        let saved = app
            .try_state::<OpenProjects>()
            .ok_or_else(|| "Project registry unavailable".to_string())
            .and_then(|open| open.require(&origin.project_dir))
            .and_then(|dir| save_version(&dir, &origin.src, output));
        match saved {
            Ok(new_src) => {
                report.added += 1;
                let _ = app.emit(
                    "project-media-saved",
                    MediaSaved {
                        project_dir: origin.project_dir.clone(),
                        old_src: origin.src.clone(),
                        new_src,
                        element_id: origin.element_id.clone(),
                    },
                );
            }
            Err(e) => report.errors.push(e),
        }
    }
    for project in projects {
        match add_to_project(Path::new(project), output, srt) {
            Ok(()) => report.added += 1,
            Err(e) => report.errors.push(e),
        }
    }
    discard_staged(app, output);
    let _ = app.emit("project-assets-changed", ());
    report
}

/// Où s'écrit un export qui ne va que dans des projets, le temps de l'y copier.
fn staging_root<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_cache_dir()
        .ok()
        .map(|dir| dir.join("export-staging"))
}

/// `<root>/<id>/<filename>` ; refuse un nom qui désignerait un autre dossier.
fn staged_path_in(root: &Path, id: &str, filename: &str) -> Result<PathBuf, String> {
    let plain = Path::new(filename).file_name().and_then(|f| f.to_str()) == Some(filename);
    if !plain || filename.starts_with('.') {
        return Err(format!("Invalid file name: {filename}"));
    }
    let dir = root.join(id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(filename))
}

/// Supprime le dossier d'un export temporaire ; ne touche à rien d'autre.
fn discard_staged_in(root: &Path, output: &Path) {
    if let Some(dir) = output.parent().filter(|dir| dir.parent() == Some(root)) {
        let _ = fs::remove_dir_all(dir);
    }
}

/// Après un export temporaire : copié dans les projets, échoué ou annulé.
pub fn discard_staged<R: tauri::Runtime>(app: &AppHandle<R>, output: &Path) {
    if let Some(root) = staging_root(app) {
        discard_staged_in(&root, output);
    }
}

/// Au lancement : les exports temporaires laissés par un arrêt brutal.
pub fn clear_staging<R: tauri::Runtime>(app: &AppHandle<R>) {
    if let Some(root) = staging_root(app) {
        let _ = fs::remove_dir_all(root);
    }
}

/// Export vers les seuls projets : un fichier temporaire au nom voulu, que l'export peut écrire.
#[tauri::command]
pub fn staged_export_path(
    app: AppHandle,
    approved: State<'_, Approved>,
    filename: String,
) -> Result<String, CmdError> {
    let root = staging_root(&app).ok_or_else(|| refuse("No cache directory".into()))?;
    let path =
        staged_path_in(&root, &uuid::Uuid::new_v4().to_string(), &filename).map_err(refuse)?;
    approved.allow_output(&path);
    Ok(path.to_string_lossy().into_owned())
}

/// Écrit `output` comme nouvelle version du média `relative_src` d'un projet, à côté de l'original
/// (qui reste intact), sous un nom libre (`<nom>-edit.<ext>`), avec son sous-titre. Renvoie le
/// chemin, relatif au projet, de la nouvelle version.
fn save_version(project: &Path, relative_src: &str, output: &Path) -> Result<String, String> {
    let current = scene_core::paths::resolve_media_path(project, relative_src)?;
    let name = output
        .file_name()
        .and_then(|f| f.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?;
    let kind = output_kind(name).ok_or_else(|| format!("{name} cannot be added to a project"))?;
    let subdir = crate::commands::assets::kind_subdir(kind)?;
    let dir = current
        .parent()
        .ok_or_else(|| "Invalid media path".to_string())?;
    if dir.file_name().and_then(|f| f.to_str()) != Some(subdir) {
        return Err(format!(
            "{name} is not the same kind of media as {relative_src}"
        ));
    }
    let stem = current
        .file_stem()
        .and_then(|f| f.to_str())
        .ok_or_else(|| "Invalid media path".to_string())?;
    let ext = output
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let wanted = if ext.is_empty() {
        format!("{stem}-edit")
    } else {
        format!("{stem}-edit.{ext}")
    };
    let dest = unique_destination(dir, &wanted);
    fs::copy(output, &dest).map_err(|e| format!("Failed to copy file: {e}"))?;
    if sidecar(&current).is_file() {
        let _ = fs::copy(sidecar(&current), sidecar(&dest));
    }
    let file = dest
        .file_name()
        .and_then(|f| f.to_str())
        .ok_or_else(|| "Invalid media path".to_string())?;
    Ok(format!("assets/{subdir}/{file}"))
}

/// Après un export audio ou image : le fichier, déjà écrit, rejoint les projets cochés.
#[tauri::command]
pub async fn add_output_to_projects(
    app: AppHandle,
    approved: State<'_, Approved>,
    output_path: String,
    projects: Vec<String>,
    srt: Option<String>,
    origin: Option<MediaOrigin>,
) -> Result<AddReport, CmdError> {
    approved
        .check_output(&output_path)
        .map_err(CmdError::from)?;
    tauri::async_runtime::spawn_blocking(move || {
        add_everywhere(
            &app,
            Path::new(&output_path),
            &projects,
            srt.as_deref(),
            origin.as_ref(),
        )
    })
    .await
    .map_err(|e| refuse(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, srt: &str) -> SubEntry {
        SubEntry {
            id: id.into(),
            label: "#1".into(),
            srt: srt.into(),
        }
    }

    fn media_in(dir: &Path) -> PathBuf {
        let file = dir.join("a.mp4");
        fs::write(&file, b"video").unwrap();
        file
    }

    #[test]
    fn subtitles_are_kept_per_file_and_replaced_by_id() {
        let (store, media) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let file = media_in(media.path());
        save_in(store.path(), &file, entry("1", "one")).unwrap();
        save_in(store.path(), &file, entry("2", "two")).unwrap();
        save_in(store.path(), &file, entry("1", "edited")).unwrap();
        assert_eq!(
            list_in(store.path(), &file),
            vec![entry("1", "edited"), entry("2", "two")]
        );
        remove_in(store.path(), &file, "1").unwrap();
        assert_eq!(list_in(store.path(), &file), vec![entry("2", "two")]);
    }

    #[test]
    fn a_changed_file_loses_its_subtitles() {
        let (store, media) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let file = media_in(media.path());
        save_in(store.path(), &file, entry("1", "one")).unwrap();
        fs::write(&file, b"a longer video").unwrap();
        assert!(list_in(store.path(), &file).is_empty());
    }

    /// Un dossier de projet : il porte le suffixe `.lvproj`.
    fn project() -> tempfile::TempDir {
        let dir = tempfile::Builder::new()
            .suffix(".lvproj")
            .tempdir()
            .unwrap();
        fs::write(dir.path().join("project.json"), b"{}").unwrap();
        dir
    }

    #[test]
    fn a_folder_without_the_project_suffix_is_refused() {
        let plain = tempfile::tempdir().unwrap();
        fs::write(plain.path().join("project.json"), b"{}").unwrap();
        let media = tempfile::tempdir().unwrap();
        let file = media_in(media.path());
        assert!(add_to_project(plain.path(), &file, None).is_err());
    }

    #[test]
    fn an_export_lands_in_the_library_of_its_kind_with_its_subtitle() {
        let (p, media) = (project(), tempfile::tempdir().unwrap());
        let file = media_in(media.path());
        add_to_project(p.path(), &file, Some("srt")).unwrap();
        let copied = p.path().join("assets/videos/a.mp4");
        assert!(copied.is_file());
        assert_eq!(fs::read_to_string(sidecar(&copied)).unwrap(), "srt");
    }

    #[test]
    fn adding_twice_keeps_both_files_and_a_gif_is_an_image() {
        let (p, media) = (project(), tempfile::tempdir().unwrap());
        let file = media_in(media.path());
        add_to_project(p.path(), &file, None).unwrap();
        add_to_project(p.path(), &file, None).unwrap();
        assert!(p.path().join("assets/videos/a-2.mp4").is_file());
        assert!(!sidecar(&p.path().join("assets/videos/a.mp4")).exists());
        let gif = media.path().join("b.gif");
        fs::write(&gif, b"gif").unwrap();
        add_to_project(p.path(), &gif, None).unwrap();
        assert!(p.path().join("assets/images/b.gif").is_file());
    }

    #[test]
    fn a_new_version_sits_next_to_the_media_and_keeps_its_subtitle() {
        let (p, media) = (project(), tempfile::tempdir().unwrap());
        let file = media_in(media.path());
        add_to_project(p.path(), &file, Some("srt")).unwrap();
        let edited = media.path().join("b.mp4");
        fs::write(&edited, b"edited").unwrap();
        let src = save_version(p.path(), "assets/videos/a.mp4", &edited).unwrap();
        assert_eq!(src, "assets/videos/a-edit.mp4");
        assert_eq!(fs::read(p.path().join(&src)).unwrap(), b"edited");
        assert_eq!(
            fs::read(p.path().join("assets/videos/a.mp4")).unwrap(),
            b"video"
        );
        assert_eq!(
            fs::read_to_string(sidecar(&p.path().join(&src))).unwrap(),
            "srt"
        );
        let again = save_version(p.path(), "assets/videos/a.mp4", &edited).unwrap();
        assert_eq!(again, "assets/videos/a-edit-2.mp4");
    }

    #[test]
    fn a_version_keeps_its_own_extension_and_must_be_the_same_kind() {
        let (p, media) = (project(), tempfile::tempdir().unwrap());
        let file = media_in(media.path());
        add_to_project(p.path(), &file, None).unwrap();
        let webm = media.path().join("c.webm");
        fs::write(&webm, b"webm").unwrap();
        let src = save_version(p.path(), "assets/videos/a.mp4", &webm).unwrap();
        assert_eq!(src, "assets/videos/a-edit.webm");
        let png = media.path().join("d.png");
        fs::write(&png, b"png").unwrap();
        assert!(save_version(p.path(), "assets/videos/a.mp4", &png).is_err());
        assert!(save_version(p.path(), "../outside.mp4", &webm).is_err());
    }

    #[test]
    fn a_staged_export_keeps_its_name_and_only_its_own_folder_is_discarded() {
        let root = tempfile::tempdir().unwrap();
        let staged = staged_path_in(root.path(), "job", "clip_edit.mp4").unwrap();
        assert_eq!(staged, root.path().join("job/clip_edit.mp4"));
        fs::write(&staged, b"video").unwrap();
        let other = root.path().join("other.txt");
        fs::write(&other, b"keep").unwrap();
        discard_staged_in(root.path(), &other);
        assert!(other.is_file());
        discard_staged_in(root.path(), &staged);
        assert!(!root.path().join("job").exists());
        assert!(other.is_file());
    }

    #[test]
    fn a_staged_name_cannot_leave_its_folder() {
        let root = tempfile::tempdir().unwrap();
        for bad in ["../x.mp4", "a/b.mp4", "", ".hidden", ".."] {
            assert!(staged_path_in(root.path(), "job", bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_folder_that_is_not_a_project_is_refused() {
        let (not_project, media) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let file = media_in(media.path());
        assert!(add_to_project(not_project.path(), &file, None).is_err());
        assert!(!not_project.path().join("assets").exists());
    }
}
