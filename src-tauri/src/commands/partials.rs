//! Journal des fichiers `.part` en cours d'écriture. Un export tué (plantage, arrêt forcé) laisse
//! son fichier de travail à côté de la destination, dans un dossier qu'on ne peut pas deviner :
//! on retient donc, dans le dossier de données de l'application, ceux que l'application est en
//! train d'écrire, et le démarrage suivant supprime ceux qui restent. Seuls les noms de nos propres
//! fichiers de travail (voir `is_ours`) sont supprimés, jamais un chemin journalisé quelconque.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const JOURNAL: &str = "partials.json";

static FILE: OnceLock<PathBuf> = OnceLock::new();
static ACTIVE: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// Nos fichiers de travail : `.<nom>.part` (export de projet) et `.<nom>.lev-part.<ext>` (file
/// d'exports de la vue Vidéo).
fn is_ours(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with('.') && (n.ends_with(".part") || n.contains(".lev-part.")))
}

fn lock() -> std::sync::MutexGuard<'static, Vec<PathBuf>> {
    ACTIVE.lock().unwrap_or_else(|e| e.into_inner())
}

fn write(file: &Path, list: &[PathBuf]) {
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string(list) {
        let _ = std::fs::write(file, json);
    }
}

/// Au démarrage : supprime les fichiers de travail laissés par la session précédente, puis fixe
/// l'emplacement du journal de celle-ci.
pub fn sweep_and_init(data_dir: &Path) -> usize {
    let file = data_dir.join(JOURNAL);
    let removed = sweep(&file);
    let _ = FILE.set(file);
    removed
}

fn sweep(file: &Path) -> usize {
    let list: Vec<PathBuf> = std::fs::read_to_string(file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let removed = list
        .iter()
        .filter(|p| is_ours(p) && std::fs::remove_file(p).is_ok())
        .count();
    let _ = std::fs::remove_file(file);
    removed
}

/// Le fichier est retenu tant que la garde vit (fin normale, erreur, annulation ou panic).
pub struct Tracked(PathBuf);

pub fn track(path: &Path) -> Tracked {
    let mut active = lock();
    active.push(path.to_path_buf());
    if let Some(file) = FILE.get() {
        write(file, &active);
    }
    Tracked(path.to_path_buf())
}

impl Drop for Tracked {
    fn drop(&mut self) {
        let mut active = lock();
        active.retain(|p| p != &self.0);
        if let Some(file) = FILE.get() {
            if active.is_empty() {
                let _ = std::fs::remove_file(file);
            } else {
                write(file, &active);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_our_work_file_names_are_recognised() {
        assert!(is_ours(Path::new("/v/.out.mp4.part")));
        assert!(is_ours(Path::new("/v/.montage.mp4.lev-part.mp4")));
        assert!(!is_ours(Path::new("/v/out.mp4.part")));
        assert!(!is_ours(Path::new("/home/me/.bashrc")));
        assert!(!is_ours(Path::new("/v/.hidden.mp4")));
    }

    #[test]
    fn the_sweep_removes_leftovers_but_never_a_foreign_file() {
        let dir = tempfile::tempdir().unwrap();
        let (part, foreign) = (dir.path().join(".a.mp4.part"), dir.path().join("keep.mp4"));
        std::fs::write(&part, b"x").unwrap();
        std::fs::write(&foreign, b"x").unwrap();
        let journal = dir.path().join(JOURNAL);
        write(&journal, &[part.clone(), foreign.clone()]);

        assert_eq!(sweep(&journal), 1);
        assert!(!part.exists() && foreign.exists());
        assert!(!journal.exists());
    }

    #[test]
    fn a_missing_or_corrupt_journal_sweeps_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let journal = dir.path().join(JOURNAL);
        assert_eq!(sweep(&journal), 0);
        std::fs::write(&journal, "nope").unwrap();
        assert_eq!(sweep(&journal), 0);
    }

    #[test]
    fn tracking_follows_the_guard() {
        let path = PathBuf::from("/nowhere/.t.mp4.part");
        let guard = track(&path);
        assert!(lock().contains(&path));
        drop(guard);
        assert!(!lock().contains(&path));
    }
}
