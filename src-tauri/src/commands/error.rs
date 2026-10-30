//! Erreur renvoyée au frontend par les commandes : un code stable (traduisible), le détail brut
//! et le message anglais complet. L'interface choisit le texte d'après `code` ; `message` sert de
//! repli et de trace. Les fonctions internes continuent de produire des `String` : le code est
//! déduit à la frontière de la commande (`From<String>`), au même endroit pour toutes.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CommandError {
    pub code: &'static str,
    /// Partie variable du message (chemin, cause) — le paramètre `{{detail}}` des traductions.
    pub detail: String,
    pub message: String,
}

pub type CmdResult<T> = Result<T, CommandError>;

/// Préfixe du message anglais → code d'erreur.
const KNOWN: &[(&str, &str)] = &[
    (
        "A project already exists at this location",
        "project_exists",
    ),
    ("Failed to read project", "read_project"),
    ("Invalid project", "invalid_project"),
    ("This folder is not an open project", "not_open_project"),
    ("Unsupported ", "unsupported_file"),
    ("Failed to launch ffmpeg", "ffmpeg_missing"),
    ("The project has no scenes to export", "no_scenes"),
    ("An export is already running", "export_running"),
    ("export-cancelled", "export_cancelled"),
    ("File too large", "file_too_large"),
    ("Only https downloads are allowed", "https_only"),
    ("Download failed", "download_failed"),
    ("Failed to write the exported video", "write_export"),
    ("Failed to copy file", "copy_file"),
];

impl From<String> for CommandError {
    fn from(message: String) -> Self {
        for (prefix, code) in KNOWN {
            if let Some(rest) = message.strip_prefix(prefix) {
                let detail = rest.trim_start_matches([':', ' ']).to_string();
                return Self {
                    code,
                    detail,
                    message,
                };
            }
        }
        Self {
            code: "unknown",
            detail: message.clone(),
            message,
        }
    }
}

impl From<&str> for CommandError {
    fn from(message: &str) -> Self {
        message.to_string().into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_messages_get_a_stable_code_and_their_detail() {
        let e = CommandError::from("Failed to read project: No such file".to_string());
        assert_eq!(e.code, "read_project");
        assert_eq!(e.detail, "No such file");
        assert_eq!(e.message, "Failed to read project: No such file");
    }

    #[test]
    fn the_cancellation_marker_has_its_own_code() {
        assert_eq!(
            CommandError::from("export-cancelled").code,
            "export_cancelled"
        );
    }

    #[test]
    fn unknown_messages_keep_everything_in_detail() {
        let e = CommandError::from("boom".to_string());
        assert_eq!((e.code, e.detail.as_str()), ("unknown", "boom"));
    }

    #[test]
    fn serializes_as_code_detail_message() {
        let json = serde_json::to_value(CommandError::from("File too large")).unwrap();
        assert_eq!(json["code"], "file_too_large");
        assert_eq!(json["message"], "File too large");
    }
}
