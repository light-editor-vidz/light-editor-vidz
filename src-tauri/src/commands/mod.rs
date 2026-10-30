pub mod assets;
pub mod error;
pub mod export;
pub mod media_protocol;
pub mod project;
pub mod registry;
pub mod release_notes;
pub mod secrets;
pub mod stock;

/// Exécute un travail bloquant (disque, copie de gros fichiers) hors du thread principal : les
/// commandes Tauri synchrones y tournent, et gèleraient l'interface pendant toute leur durée.
pub(crate) async fn blocking<T, F>(work: F) -> error::CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let result = tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("Task failed: {e}"))?;
    Ok(result?)
}
