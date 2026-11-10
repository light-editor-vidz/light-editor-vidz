//! Un fichier passé au lancement (`light-editor-vidz clip.mp4`, « Ouvrir avec… ») s'ouvre dans son
//! onglet ; un second lancement le confie à la fenêtre déjà ouverte.

use crate::commands::audio_tool::kind_of;
use audio_dsp::approval::Approved;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

/// Les fichiers du premier lancement, en attente que l'interface soit prête.
#[derive(Default)]
pub struct PendingOpen(pub Mutex<Vec<String>>);

/// Les médias existants parmi les arguments (le premier est le programme lui-même).
pub fn media_args(args: &[String], cwd: &Path) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| cwd.join(a))
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .filter(|p| kind_of(p) != "unknown")
        .collect()
}

/// Nommer un fichier au lancement est un geste de l'utilisateur, comme le déposer.
fn approve(app: &AppHandle, files: &[String]) {
    let approved = app.state::<Approved>();
    for file in files {
        approved.allow_input(file);
    }
}

/// Premier lancement : retient les fichiers jusqu'à ce que l'interface les demande.
pub fn on_first_launch(app: &AppHandle) {
    let Ok(cwd) = std::env::current_dir() else {
        return;
    };
    let args: Vec<String> = std::env::args().collect();
    let files = media_args(&args, &cwd);
    approve(app, &files);
    *app.state::<PendingOpen>().0.lock().unwrap() = files;
}

/// Second lancement : la fenêtre ouverte passe devant et reçoit ses fichiers.
pub fn on_second_launch(app: &AppHandle, args: &[String], cwd: &str) {
    let files = media_args(args, Path::new(cwd));
    approve(app, &files);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if !files.is_empty() {
        let _ = app.emit("open-files", files);
    }
}

#[tauri::command]
pub fn take_pending_files(pending: State<'_, PendingOpen>) -> Vec<String> {
    std::mem::take(&mut *pending.0.lock().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn only_existing_media_are_kept_and_the_program_name_is_skipped() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["a.mp3", "b.mp4", "c.png", "d.txt"] {
            std::fs::write(dir.path().join(name), b"").unwrap();
        }
        let files = media_args(
            &strings(&[
                "/bin/app.mp4",
                "a.mp3",
                "b.mp4",
                "c.png",
                "d.txt",
                "gone.mp4",
                "--flag",
            ]),
            dir.path(),
        );
        let names: Vec<_> = files
            .iter()
            .map(|f| Path::new(f).file_name().unwrap().to_str().unwrap())
            .collect();
        assert_eq!(names, ["a.mp3", "b.mp4", "c.png"]);
    }

    #[test]
    fn an_absolute_path_ignores_the_working_directory() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.wav");
        std::fs::write(&file, b"").unwrap();
        let files = media_args(
            &strings(&["app", file.to_str().unwrap()]),
            Path::new("/elsewhere"),
        );
        assert_eq!(files, [file.to_string_lossy().into_owned()]);
    }
}
