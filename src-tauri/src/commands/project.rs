use super::blocking;
use super::error::CmdResult;
use super::registry::OpenProjects;
use scene_core::model::Project;
use scene_core::project::{new_project as build_project, NewProjectOptions};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Manager, State};
use tauri_plugin_store::StoreExt;

/// Autorise le protocole `asset://` à lire les médias de ce projet (images/vidéos
/// affichées dans le canvas), sans ouvrir l'accès à tout le disque.
fn allow_asset_scope(app: &tauri::AppHandle, project_dir: &Path) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(project_dir, true)
        .map_err(|e| format!("Failed to authorize asset access: {e}"))
}

const PROJECT_FILE: &str = "project.json";
/// Copie de la version précédente de `project.json`, conservée à chaque sauvegarde.
const BACKUP_FILE: &str = "project.json.bak";
const TEMP_FILE: &str = "project.json.tmp";
const RECENTS_STORE: &str = "recents.json";
const RECENTS_KEY: &str = "projects";
/// Taille maximale d'un fichier texte importé (JSON de l'ancien projet).
const MAX_TEXT_FILE_BYTES: u64 = 32 * 1024 * 1024;

fn slugify(name: &str) -> String {
    let slug: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "project".to_string()
    } else {
        slug
    }
}

fn project_json_path(project_dir: &Path) -> PathBuf {
    project_dir.join(PROJECT_FILE)
}

fn parse_project_file(path: &Path) -> Result<Project, String> {
    let data = fs::read_to_string(path).map_err(|e| format!("Failed to read project: {e}"))?;
    scene_core::project::from_json(&data).map_err(|e| format!("Invalid project: {e}"))
}

/// Lit le projet ; si `project.json` est illisible (écriture interrompue d'une ancienne version,
/// disque défaillant), retombe sur la sauvegarde de la version précédente.
fn read_project(project_dir: &Path) -> Result<Project, String> {
    match parse_project_file(&project_json_path(project_dir)) {
        Ok(project) => Ok(project),
        Err(primary_error) => {
            parse_project_file(&project_dir.join(BACKUP_FILE)).map_err(|_| primary_error)
        }
    }
}

/// Écriture atomique : le JSON est écrit dans un fichier temporaire puis renommé, de sorte
/// qu'un crash ou une coupure ne laisse jamais un `project.json` tronqué. La version précédente
/// est conservée dans `project.json.bak`.
fn write_project(project_dir: &Path, project: &Project) -> Result<(), String> {
    fs::create_dir_all(project_dir.join("assets"))
        .map_err(|e| format!("Failed to create assets directory: {e}"))?;
    let json = scene_core::project::to_json(project)
        .map_err(|e| format!("Failed to serialize project: {e}"))?;
    let target = project_json_path(project_dir);
    let temp = project_dir.join(TEMP_FILE);
    fs::write(&temp, json).map_err(|e| format!("Failed to write project: {e}"))?;
    if target.is_file() {
        // Best effort : l'absence de sauvegarde ne doit pas empêcher d'enregistrer.
        let _ = fs::copy(&target, project_dir.join(BACKUP_FILE));
    }
    fs::rename(&temp, &target).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("Failed to write project: {e}")
    })
}

/// Nombre de projets récents conservés.
const RECENTS_LIMIT: usize = 20;

/// Projet récent affiché sur l'accueil. Ses métadonnées sont stockées avec le chemin : l'accueil
/// ne relit plus (et ne parse plus) 20 `project.json` à chaque ouverture.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
}

impl RecentProject {
    fn new(path: &str, project: &Project) -> Self {
        Self {
            path: path.to_string(),
            name: project.name.clone(),
            width: project.width,
            height: project.height,
            duration: project.duration,
        }
    }
}

/// Entrée du store : objet complet, ou simple chemin (format des versions précédentes).
#[derive(Deserialize)]
#[serde(untagged)]
enum StoredRecent {
    Full(RecentProject),
    PathOnly(String),
}

/// Remonte `entry` en tête de la liste des récents, sans doublon et sans dépasser
/// `RECENTS_LIMIT`. Séparé de `add_recent` pour être testable sans store.
fn with_recent(mut recents: Vec<RecentProject>, entry: RecentProject) -> Vec<RecentProject> {
    recents.retain(|p| p.path != entry.path);
    recents.insert(0, entry);
    recents.truncate(RECENTS_LIMIT);
    recents
}

/// Met à jour les métadonnées d'une entrée existante, sans changer l'ordre. `None` si rien n'a
/// changé (évite d'écrire le store à chaque sauvegarde automatique).
fn with_updated_meta(
    mut recents: Vec<RecentProject>,
    entry: RecentProject,
) -> Option<Vec<RecentProject>> {
    let slot = recents.iter_mut().find(|p| p.path == entry.path)?;
    if *slot == entry {
        return None;
    }
    *slot = entry;
    Some(recents)
}

/// Chemin du dossier de projet créé pour `name` sous `parent_dir`.
fn project_dir_for(parent_dir: &str, name: &str) -> PathBuf {
    PathBuf::from(parent_dir).join(format!("{}.lvproj", slugify(name)))
}

/// Récents du store, anciens chemins seuls convertis (métadonnées lues une fois dans le projet).
fn load_recents(app: &tauri::AppHandle) -> Result<Vec<RecentProject>, String> {
    let store = app
        .store(RECENTS_STORE)
        .map_err(|e| format!("Recents store unavailable: {e}"))?;
    let stored: Vec<StoredRecent> = store
        .get(RECENTS_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    Ok(stored
        .into_iter()
        .filter_map(|entry| match entry {
            StoredRecent::Full(recent) => Some(recent),
            StoredRecent::PathOnly(path) => {
                let project = read_project(Path::new(&path)).ok()?;
                Some(RecentProject::new(&path, &project))
            }
        })
        .collect())
}

fn store_recents(app: &tauri::AppHandle, recents: &[RecentProject]) -> Result<(), String> {
    let store = app
        .store(RECENTS_STORE)
        .map_err(|e| format!("Recents store unavailable: {e}"))?;
    store.set(RECENTS_KEY, serde_json::json!(recents));
    store
        .save()
        .map_err(|e| format!("Failed to save recents: {e}"))
}

fn add_recent(app: &tauri::AppHandle, project_dir: &str, project: &Project) -> Result<(), String> {
    let recents = with_recent(load_recents(app)?, RecentProject::new(project_dir, project));
    store_recents(app, &recents)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NewProjectArgs {
    pub parent_dir: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

/// Crée un nouveau dossier de projet `<parent_dir>/<slug>.lvproj/` contenant `project.json`
/// et `assets/`, puis l'ajoute aux projets récents.
#[tauri::command]
pub async fn new_project(
    app: tauri::AppHandle,
    projects: State<'_, OpenProjects>,
    args: NewProjectArgs,
) -> CmdResult<String> {
    let projects = projects.inner().clone();
    blocking(move || {
        let project_dir = project_dir_for(&args.parent_dir, &args.name);
        if project_dir.exists() {
            return Err(format!(
                "A project already exists at this location: {}",
                project_dir.display()
            ));
        }

        let project = build_project(NewProjectOptions {
            name: args.name,
            width: args.width,
            height: args.height,
            fps: args.fps,
        });

        write_project(&project_dir, &project)?;
        projects.register(&project_dir)?;
        allow_asset_scope(&app, &project_dir)?;

        let project_dir_str = project_dir.to_string_lossy().to_string();
        add_recent(&app, &project_dir_str, &project)?;
        Ok(project_dir_str)
    })
    .await
}

/// Charge un projet depuis son dossier `.lvproj/` et l'ajoute aux projets récents.
#[tauri::command]
pub async fn load_project(
    app: tauri::AppHandle,
    projects: State<'_, OpenProjects>,
    project_dir: String,
) -> CmdResult<Project> {
    let projects = projects.inner().clone();
    blocking(move || {
        let project = read_project(Path::new(&project_dir))?;
        projects.register(Path::new(&project_dir))?;
        allow_asset_scope(&app, Path::new(&project_dir))?;
        add_recent(&app, &project_dir, &project)?;
        Ok(project)
    })
    .await
}

/// Enregistre l'état courant du projet (écrase `project.json`, de façon atomique).
#[tauri::command]
pub async fn save_project(
    app: tauri::AppHandle,
    projects: State<'_, OpenProjects>,
    project_dir: String,
    project: Project,
) -> CmdResult<()> {
    let dir = projects.require(&project_dir)?;
    blocking(move || {
        write_project(&dir, &project)?;
        // Nom, dimensions et durée affichés sur l'accueil : mis à jour sans changer l'ordre, et
        // seulement si l'un d'eux a changé. Un échec ici ne doit pas faire échouer la sauvegarde.
        if let Ok(recents) = load_recents(&app) {
            let entry = RecentProject::new(&project_dir, &project);
            if let Some(updated) = with_updated_meta(recents, entry) {
                let _ = store_recents(&app, &updated);
            }
        }
        Ok(())
    })
    .await
}

/// Fichier texte choisi par l'utilisateur dans le sélecteur de fichiers.
#[derive(Debug, Serialize)]
pub struct PickedTextFile {
    pub name: String,
    pub content: String,
}

/// Ouvre un sélecteur de fichiers et lit le fichier texte choisi (ex : JSON de l'ancien
/// projet). La lecture se fait ici, sur le fichier désigné par l'utilisateur : le frontend ne
/// peut pas demander la lecture d'un chemin arbitraire. `None` si le sélecteur est fermé.
#[tauri::command]
pub async fn pick_text_file(
    app: tauri::AppHandle,
    title: String,
    filter_name: String,
    extensions: Vec<String>,
) -> CmdResult<Option<PickedTextFile>> {
    use tauri_plugin_dialog::DialogExt;
    blocking(move || {
        let extensions: Vec<&str> = extensions.iter().map(String::as_str).collect();
        let Some(picked) = app
            .dialog()
            .file()
            .set_title(title)
            .add_filter(filter_name, &extensions)
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = picked
            .into_path()
            .map_err(|e| format!("Invalid file path: {e}"))?;
        read_text_file(&path).map(Some)
    })
    .await
}

fn read_text_file(path: &Path) -> Result<PickedTextFile, String> {
    let size = fs::metadata(path)
        .map_err(|e| format!("Failed to read file: {e}"))?
        .len();
    if size > MAX_TEXT_FILE_BYTES {
        return Err("File too large".to_string());
    }
    let content = fs::read_to_string(path).map_err(|e| format!("Failed to read file: {e}"))?;
    Ok(PickedTextFile {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        content,
    })
}

/// Liste les projets récents encore présents sur le disque (les entrées supprimées
/// manuellement sont silencieusement ignorées). Lit uniquement le store, pas les projets.
#[tauri::command]
pub async fn list_recent_projects(app: tauri::AppHandle) -> CmdResult<Vec<RecentProject>> {
    blocking(move || {
        let stored = load_recents(&app)?;
        let present: Vec<RecentProject> = stored
            .iter()
            .filter(|r| project_json_path(Path::new(&r.path)).is_file())
            .cloned()
            .collect();
        if present.len() != stored.len() {
            let _ = store_recents(&app, &present);
        }
        Ok(present)
    })
    .await
}

/// Retire un projet de la liste des récents (le dossier du projet n'est pas touché).
#[tauri::command]
pub async fn remove_recent_project(app: tauri::AppHandle, path: String) -> CmdResult<()> {
    blocking(move || {
        let recents: Vec<RecentProject> = load_recents(&app)?
            .into_iter()
            .filter(|r| r.path != path)
            .collect();
        store_recents(&app, &recents)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_lowercases_and_replaces_non_alphanumeric_with_dashes() {
        assert_eq!(slugify("My Cool Project"), "my-cool-project");
    }

    #[test]
    fn slugify_trims_leading_and_trailing_dashes() {
        assert_eq!(slugify("  --Hello World!!--  "), "hello-world");
    }

    #[test]
    fn slugify_falls_back_to_project_when_nothing_alphanumeric_remains() {
        assert_eq!(slugify("!!!"), "project");
        assert_eq!(slugify(""), "project");
        assert_eq!(slugify("   "), "project");
    }

    #[test]
    fn slugify_preserves_unicode_letters() {
        assert_eq!(slugify("Ma Vidéo Été"), "ma-vidéo-été");
    }

    // ── chemins ──────────────────────────────────────────────────────────────

    #[test]
    fn the_project_folder_is_the_slug_with_the_lvproj_suffix() {
        assert_eq!(
            project_dir_for("/home/me/Vidéos", "My Cool Project"),
            PathBuf::from("/home/me/Vidéos/my-cool-project.lvproj")
        );
    }

    #[test]
    fn an_unnameable_project_still_gets_a_folder() {
        assert_eq!(
            project_dir_for("/home/me", "!!!"),
            PathBuf::from("/home/me/project.lvproj")
        );
    }

    #[test]
    fn the_project_file_sits_at_the_root_of_its_folder() {
        assert_eq!(
            project_json_path(Path::new("/p/clip.lvproj")),
            PathBuf::from("/p/clip.lvproj/project.json")
        );
    }

    // ── lecture / écriture ───────────────────────────────────────────────────

    fn sample_project() -> Project {
        build_project(NewProjectOptions {
            name: "Démo".into(),
            width: 1920,
            height: 1080,
            fps: 30,
        })
    }

    #[test]
    fn writing_then_reading_gives_the_project_back() {
        let dir = tempfile::tempdir().unwrap();
        let project = sample_project();

        write_project(dir.path(), &project).unwrap();
        let back = read_project(dir.path()).unwrap();

        assert_eq!(back.name, "Démo");
        assert_eq!((back.width, back.height, back.fps), (1920, 1080, 30));
        assert_eq!(back.compositions.len(), project.compositions.len());
    }

    #[test]
    fn writing_creates_the_assets_folder() {
        let dir = tempfile::tempdir().unwrap();

        write_project(dir.path(), &sample_project()).unwrap();

        assert!(dir.path().join("assets").is_dir());
        assert!(dir.path().join("project.json").is_file());
    }

    #[test]
    fn writing_into_a_nested_folder_creates_it() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("a/b/clip.lvproj");

        write_project(&nested, &sample_project()).unwrap();

        assert!(nested.join("project.json").is_file());
    }

    #[test]
    fn saving_twice_overwrites_the_previous_state() {
        let dir = tempfile::tempdir().unwrap();
        write_project(dir.path(), &sample_project()).unwrap();
        let mut renamed = sample_project();
        renamed.name = "Autre".into();

        write_project(dir.path(), &renamed).unwrap();

        assert_eq!(read_project(dir.path()).unwrap().name, "Autre");
    }

    #[test]
    fn reading_a_folder_without_a_project_file_fails() {
        let dir = tempfile::tempdir().unwrap();

        let err = read_project(dir.path()).unwrap_err();

        assert!(err.starts_with("Failed to read project:"), "{err}");
    }

    #[test]
    fn reading_a_corrupt_project_file_fails() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("project.json"), "pas du json").unwrap();

        let err = read_project(dir.path()).unwrap_err();

        assert!(err.starts_with("Invalid project:"), "{err}");
    }

    #[test]
    fn writing_to_an_unwritable_place_fails() {
        let err =
            write_project(Path::new("/nowhere-at-all/clip.lvproj"), &sample_project()).unwrap_err();

        assert!(err.contains("Failed to create assets directory"), "{err}");
    }

    // ── sauvegarde atomique ──────────────────────────────────────────────────

    #[test]
    fn saving_leaves_no_temporary_file_and_keeps_the_previous_version() {
        let dir = tempfile::tempdir().unwrap();
        write_project(dir.path(), &sample_project()).unwrap();
        let mut renamed = sample_project();
        renamed.name = "Autre".into();

        write_project(dir.path(), &renamed).unwrap();

        assert!(!dir.path().join(TEMP_FILE).exists());
        let backup = parse_project_file(&dir.path().join(BACKUP_FILE)).unwrap();
        assert_eq!(backup.name, "Démo");
        assert_eq!(read_project(dir.path()).unwrap().name, "Autre");
    }

    #[test]
    fn a_truncated_project_file_falls_back_to_the_backup() {
        let dir = tempfile::tempdir().unwrap();
        write_project(dir.path(), &sample_project()).unwrap();
        write_project(dir.path(), &sample_project()).unwrap();
        std::fs::write(dir.path().join(PROJECT_FILE), "{\"name\": \"tronq").unwrap();

        assert_eq!(read_project(dir.path()).unwrap().name, "Démo");
    }

    #[test]
    fn a_failed_write_never_touches_the_existing_project_file() {
        let dir = tempfile::tempdir().unwrap();
        write_project(dir.path(), &sample_project()).unwrap();
        // Un dossier à la place du fichier temporaire empêche d'y écrire.
        std::fs::create_dir(dir.path().join(TEMP_FILE)).unwrap();
        let mut renamed = sample_project();
        renamed.name = "Autre".into();

        assert!(write_project(dir.path(), &renamed).is_err());
        assert_eq!(read_project(dir.path()).unwrap().name, "Démo");
    }

    // ── fichier texte choisi ─────────────────────────────────────────────────

    #[test]
    fn a_picked_text_file_is_read_with_its_name() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("old.json");
        std::fs::write(&path, "{\"a\":1}").unwrap();

        let picked = read_text_file(&path).unwrap();

        assert_eq!(picked.name, "old.json");
        assert_eq!(picked.content, "{\"a\":1}");
    }

    #[test]
    fn an_oversized_text_file_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("huge.json");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_TEXT_FILE_BYTES + 1).unwrap();

        assert_eq!(read_text_file(&path).unwrap_err(), "File too large");
    }

    // ── projets récents ──────────────────────────────────────────────────────

    fn entry(path: &str) -> RecentProject {
        RecentProject {
            path: path.to_string(),
            name: path.trim_start_matches('/').to_string(),
            width: 1920,
            height: 1080,
            duration: 5.0,
        }
    }

    fn recents(items: &[&str]) -> Vec<RecentProject> {
        items.iter().map(|s| entry(s)).collect()
    }

    fn paths(list: &[RecentProject]) -> Vec<&str> {
        list.iter().map(|r| r.path.as_str()).collect()
    }

    #[test]
    fn a_new_project_goes_to_the_top_of_the_list() {
        let list = with_recent(recents(&["/a", "/b"]), entry("/c"));

        assert_eq!(paths(&list), ["/c", "/a", "/b"]);
    }

    #[test]
    fn reopening_a_project_moves_it_up_without_duplicating_it() {
        let list = with_recent(recents(&["/a", "/b", "/c"]), entry("/c"));

        assert_eq!(paths(&list), ["/c", "/a", "/b"]);
    }

    #[test]
    fn the_list_never_grows_past_twenty_entries() {
        let existing: Vec<RecentProject> = (0..25).map(|i| entry(&format!("/p{i}"))).collect();

        let list = with_recent(existing, entry("/nouveau"));

        assert_eq!(list.len(), RECENTS_LIMIT);
        assert_eq!(list[0].path, "/nouveau");
    }

    #[test]
    fn the_oldest_entry_is_the_one_dropped() {
        let existing: Vec<RecentProject> = (0..RECENTS_LIMIT)
            .map(|i| entry(&format!("/p{i}")))
            .collect();

        let list = with_recent(existing, entry("/nouveau"));

        assert!(!paths(&list).contains(&format!("/p{}", RECENTS_LIMIT - 1).as_str()));
        assert!(paths(&list).contains(&"/p0"));
    }

    #[test]
    fn the_first_project_starts_the_list() {
        assert_eq!(paths(&with_recent(vec![], entry("/a"))), ["/a"]);
    }

    #[test]
    fn updating_metadata_keeps_the_order_and_skips_unchanged_entries() {
        let list = recents(&["/a", "/b"]);
        assert!(with_updated_meta(list.clone(), entry("/b")).is_none());

        let mut changed = entry("/b");
        changed.duration = 12.0;
        let updated = with_updated_meta(list, changed).unwrap();
        assert_eq!(paths(&updated), ["/a", "/b"]);
        assert_eq!(updated[1].duration, 12.0);
        assert!(with_updated_meta(recents(&["/a"]), entry("/zzz")).is_none());
    }

    #[test]
    fn legacy_path_only_entries_are_still_understood() {
        let stored: Vec<StoredRecent> = serde_json::from_value(serde_json::json!([
            "/old",
            {"path": "/new", "name": "N", "width": 1, "height": 2, "duration": 3.0}
        ]))
        .unwrap();
        assert!(matches!(&stored[0], StoredRecent::PathOnly(p) if p == "/old"));
        assert!(matches!(&stored[1], StoredRecent::Full(r) if r.name == "N"));
    }
}
