//! Résolution des binaires ffmpeg/ffprobe à utiliser (décodage des sources vidéo à l'export, et
//! encodage/mixage côté `src-tauri`). Ordre de recherche :
//!
//! 1. les variables d'environnement `LIGHT_EDITOR_VIDZ_FFMPEG` et `LIGHT_EDITOR_VIDZ_FFPROBE`
//!    (si seul ffmpeg est configuré, ffprobe est cherché à côté) ;
//! 2. les binaires embarqués avec l'application (sidecars Tauri), situés à côté de l'exécutable ;
//! 3. `ffmpeg` et `ffprobe` dans le `PATH` système (développement, tests).

use std::path::{Path, PathBuf};

const EXE_SUFFIX: &str = if cfg!(windows) { ".exe" } else { "" };

/// Binaire `name` livré à côté de l'exécutable courant, s'il existe.
fn bundled(name: &str) -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let path = dir.join(format!("{name}{EXE_SUFFIX}"));
    path.is_file().then_some(path)
}

/// Nom ou chemin du binaire ffmpeg à invoquer.
pub fn ffmpeg_binary() -> String {
    if let Ok(path) = std::env::var("LIGHT_EDITOR_VIDZ_FFMPEG") {
        return path;
    }
    bundled("ffmpeg")
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "ffmpeg".to_string())
}

/// Nom ou chemin du binaire ffprobe à invoquer.
pub fn ffprobe_binary() -> String {
    if let Ok(path) = std::env::var("LIGHT_EDITOR_VIDZ_FFPROBE") {
        return path;
    }
    if std::env::var("LIGHT_EDITOR_VIDZ_FFMPEG").is_ok() {
        return sibling_ffprobe(&ffmpeg_binary());
    }
    bundled("ffprobe")
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "ffprobe".to_string())
}

/// `ffprobe` situé à côté de `ffmpeg` quand ce dernier est un chemin (et non un nom résolu par
/// le `PATH`) ; conserve l'extension (`.exe`) et le préfixe éventuel du nom de fichier.
fn sibling_ffprobe(ffmpeg: &str) -> String {
    let path = Path::new(ffmpeg);
    let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) else {
        return "ffprobe".to_string();
    };
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().replace("ffmpeg", "ffprobe"))
        .unwrap_or_else(|| "ffprobe".to_string());
    dir.join(file_name).to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_bundled_binary_falls_back_to_the_path() {
        // Le binaire de test n'a pas de `ffmpeg` à côté de lui.
        assert!(bundled("definitely-not-a-bundled-binary").is_none());
    }

    #[test]
    fn a_bundled_binary_is_found_next_to_the_executable() {
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_string_lossy().into_owned();
        let name = name.strip_suffix(EXE_SUFFIX).unwrap_or(&name);
        assert_eq!(bundled(name), Some(exe));
    }

    #[test]
    fn ffprobe_is_resolved_from_the_path_when_ffmpeg_is_a_bare_name() {
        assert_eq!(sibling_ffprobe("ffmpeg"), "ffprobe");
    }

    #[test]
    fn ffprobe_is_looked_up_next_to_a_configured_ffmpeg_path() {
        assert_eq!(
            sibling_ffprobe("/opt/media/bin/ffmpeg"),
            "/opt/media/bin/ffprobe"
        );
        assert_eq!(
            sibling_ffprobe("/opt/media/bin/ffmpeg-x86_64.exe"),
            "/opt/media/bin/ffprobe-x86_64.exe"
        );
    }
}
