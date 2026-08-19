use scene_core::model::Project;
use scene_core::project::{new_project as build_project, NewProjectOptions};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_store::StoreExt;

/// Autorise le protocole `asset://` à lire les médias de ce projet (images/vidéos
/// affichées dans le canvas), sans ouvrir l'accès à tout le disque.
fn allow_asset_scope(app: &tauri::AppHandle, project_dir: &Path) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(project_dir, true)
        .map_err(|e| format!("Failed to authorize asset access: {e}"))
}

const PROJECT_FILE: &str = "project.json";
const RECENTS_STORE: &str = "recents.json";
const RECENTS_KEY: &str = "projects";

fn slugify(name: &str) -> String {
    let slug: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "projet".to_string()
    } else {
        slug
    }
}

fn project_json_path(project_dir: &Path) -> PathBuf {
    project_dir.join(PROJECT_FILE)
}

fn read_project(project_dir: &Path) -> Result<Project, String> {
    let data = fs::read_to_string(project_json_path(project_dir))
        .map_err(|e| format!("Failed to read project: {e}"))?;
    scene_core::project::from_json(&data).map_err(|e| format!("Invalid project: {e}"))
}

fn write_project(project_dir: &Path, project: &Project) -> Result<(), String> {
    fs::create_dir_all(project_dir.join("assets"))
        .map_err(|e| format!("Failed to create assets directory: {e}"))?;
    let json = scene_core::project::to_json(project)
        .map_err(|e| format!("Failed to serialize project: {e}"))?;
    fs::write(project_json_path(project_dir), json)
        .map_err(|e| format!("Failed to write project: {e}"))
}

/// Nombre de projets récents conservés.
const RECENTS_LIMIT: usize = 20;

/// Remonte `project_dir` en tête de la liste des récents, sans doublon et sans
/// dépasser `RECENTS_LIMIT`. Séparé de `add_recent` pour être testable sans store.
fn with_recent(mut recents: Vec<String>, project_dir: &str) -> Vec<String> {
    recents.retain(|p| p != project_dir);
    recents.insert(0, project_dir.to_string());
    recents.truncate(RECENTS_LIMIT);
    recents
}

/// Chemin du dossier de projet créé pour `name` sous `parent_dir`.
fn project_dir_for(parent_dir: &str, name: &str) -> PathBuf {
    PathBuf::from(parent_dir).join(format!("{}.lvproj", slugify(name)))
}

fn add_recent(app: &tauri::AppHandle, project_dir: &str) -> Result<(), String> {
    let store = app
        .store(RECENTS_STORE)
        .map_err(|e| format!("Recents store unavailable: {e}"))?;
    let recents: Vec<String> = store
        .get(RECENTS_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let recents = with_recent(recents, project_dir);
    store.set(RECENTS_KEY, serde_json::json!(recents));
    store
        .save()
        .map_err(|e| format!("Failed to save recents: {e}"))?;
    Ok(())
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
pub fn new_project(app: tauri::AppHandle, args: NewProjectArgs) -> Result<String, String> {
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
    allow_asset_scope(&app, &project_dir)?;

    let project_dir_str = project_dir.to_string_lossy().to_string();
    add_recent(&app, &project_dir_str)?;

    Ok(project_dir_str)
}

/// Charge un projet depuis son dossier `.lvproj/` et l'ajoute aux projets récents.
#[tauri::command]
pub fn load_project(app: tauri::AppHandle, project_dir: String) -> Result<Project, String> {
    let project = read_project(Path::new(&project_dir))?;
    allow_asset_scope(&app, Path::new(&project_dir))?;
    add_recent(&app, &project_dir)?;
    Ok(project)
}

/// Enregistre l'état courant du projet (écrase `project.json`).
#[tauri::command]
pub fn save_project(project_dir: String, project: Project) -> Result<(), String> {
    write_project(Path::new(&project_dir), &project)
}

/// Lit un fichier texte arbitraire choisi par l'utilisateur (ex: import JSON de l'ancien projet).
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {e}"))
}

#[derive(Debug, Serialize)]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
}

/// Liste les projets récents encore présents sur le disque (les entrées supprimées
/// manuellement sont silencieusement ignorées).
#[tauri::command]
pub fn list_recent_projects(app: tauri::AppHandle) -> Result<Vec<RecentProject>, String> {
    let store = app
        .store(RECENTS_STORE)
        .map_err(|e| format!("Recents store unavailable: {e}"))?;
    let recents: Vec<String> = store
        .get(RECENTS_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    let mut out = Vec::new();
    for path in recents {
        if let Ok(project) = read_project(Path::new(&path)) {
            out.push(RecentProject {
                path,
                name: project.name,
                width: project.width,
                height: project.height,
                duration: project.duration,
            });
        }
    }
    Ok(out)
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
    fn slugify_falls_back_to_projet_when_nothing_alphanumeric_remains() {
        assert_eq!(slugify("!!!"), "projet");
        assert_eq!(slugify(""), "projet");
        assert_eq!(slugify("   "), "projet");
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
            PathBuf::from("/home/me/projet.lvproj")
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

    // ── projets récents ──────────────────────────────────────────────────────

    fn recents(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_new_project_goes_to_the_top_of_the_list() {
        let list = with_recent(recents(&["/a", "/b"]), "/c");

        assert_eq!(list, recents(&["/c", "/a", "/b"]));
    }

    #[test]
    fn reopening_a_project_moves_it_up_without_duplicating_it() {
        let list = with_recent(recents(&["/a", "/b", "/c"]), "/c");

        assert_eq!(list, recents(&["/c", "/a", "/b"]));
    }

    #[test]
    fn the_list_never_grows_past_twenty_entries() {
        let existing: Vec<String> = (0..25).map(|i| format!("/p{i}")).collect();

        let list = with_recent(existing, "/nouveau");

        assert_eq!(list.len(), RECENTS_LIMIT);
        assert_eq!(list[0], "/nouveau");
    }

    #[test]
    fn the_oldest_entry_is_the_one_dropped() {
        let existing: Vec<String> = (0..RECENTS_LIMIT).map(|i| format!("/p{i}")).collect();

        let list = with_recent(existing, "/nouveau");

        assert!(!list.contains(&format!("/p{}", RECENTS_LIMIT - 1)));
        assert!(list.contains(&"/p0".to_string()));
    }

    #[test]
    fn the_first_project_starts_the_list() {
        assert_eq!(with_recent(vec![], "/a"), recents(&["/a"]));
    }
}
