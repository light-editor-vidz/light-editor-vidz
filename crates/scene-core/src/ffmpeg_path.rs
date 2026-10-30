//! Résolution des binaires ffmpeg/ffprobe à utiliser (décodage des sources vidéo à l'export, et
//! encodage/mixage côté `src-tauri`). Par défaut, `ffmpeg` et `ffprobe` sont cherchés dans le
//! `PATH` système. Les variables d'environnement `LIGHT_EDITOR_VIDZ_FFMPEG` et
//! `LIGHT_EDITOR_VIDZ_FFPROBE` permettent de pointer vers des binaires précis (build packagé,
//! ffmpeg installé hors du `PATH`) ; si seul ffmpeg est configuré, ffprobe est cherché à côté.

use std::path::Path;

/// Nom ou chemin du binaire ffmpeg à invoquer.
pub fn ffmpeg_binary() -> String {
    std::env::var("LIGHT_EDITOR_VIDZ_FFMPEG").unwrap_or_else(|_| "ffmpeg".to_string())
}

/// Nom ou chemin du binaire ffprobe à invoquer.
pub fn ffprobe_binary() -> String {
    if let Ok(path) = std::env::var("LIGHT_EDITOR_VIDZ_FFPROBE") {
        return path;
    }
    sibling_ffprobe(&ffmpeg_binary())
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
