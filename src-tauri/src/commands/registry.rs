//! Dossiers de projet autorisés. Les commandes qui lisent ou écrivent dans un projet
//! (sauvegarde, import, export, lecture de médias) n'acceptent que les dossiers ouverts
//! (`new_project` / `load_project`) : une page web compromise ne peut pas s'en servir pour
//! écrire ou lire à un emplacement arbitraire du disque.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Default, Clone)]
pub struct OpenProjects(Arc<Mutex<HashSet<PathBuf>>>);

impl OpenProjects {
    /// Autorise `dir` (qui doit exister).
    pub fn register(&self, dir: &Path) -> Result<(), String> {
        let canonical = dir
            .canonicalize()
            .map_err(|e| format!("Invalid project directory: {e}"))?;
        self.0
            .lock()
            .map_err(|_| "Project registry unavailable".to_string())?
            .insert(canonical);
        Ok(())
    }

    /// Chemin canonique de `dir` s'il s'agit d'un projet ouvert.
    pub fn require(&self, dir: &str) -> Result<PathBuf, String> {
        let canonical = Path::new(dir)
            .canonicalize()
            .map_err(|e| format!("Invalid project directory: {e}"))?;
        let known = self
            .0
            .lock()
            .map_err(|_| "Project registry unavailable".to_string())?
            .contains(&canonical);
        if known {
            Ok(canonical)
        } else {
            Err("This folder is not an open project.".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_registered_directories_are_accepted() {
        let dir = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let registry = OpenProjects::default();
        registry.register(dir.path()).unwrap();

        assert!(registry.require(dir.path().to_str().unwrap()).is_ok());
        assert!(registry.require(other.path().to_str().unwrap()).is_err());
    }

    #[test]
    fn a_path_is_matched_after_canonicalisation() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("p")).unwrap();
        let registry = OpenProjects::default();
        registry.register(&dir.path().join("p")).unwrap();

        let detour = dir.path().join("p").join("..").join("p");
        assert!(registry.require(detour.to_str().unwrap()).is_ok());
    }

    #[test]
    fn registering_a_missing_directory_fails() {
        assert!(OpenProjects::default()
            .register(Path::new("/nowhere-at-all"))
            .is_err());
    }

    #[test]
    fn a_missing_directory_is_never_accepted() {
        assert!(OpenProjects::default().require("/nowhere-at-all").is_err());
    }
}
