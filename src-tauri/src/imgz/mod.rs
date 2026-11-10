use image::DynamicImage;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

pub mod commands;
pub use commands::steps::Step;

#[cfg(test)]
pub mod test_support;

/// Budget mémoire de l'historique d'un onglet (octets de pixels). Les plus anciennes
/// étapes sont abandonnées au-delà, l'image d'origine étant toujours conservée.
pub const MAX_HISTORY_BYTES: usize = 1 << 30;
/// Nombre maximal d'étapes conservées par onglet.
pub const MAX_HISTORY_ENTRIES: usize = 100;

/// Numérote les états d'historique : une URL d'image ne désigne jamais deux images différentes.
static NEXT_EPOCH: AtomicU64 = AtomicU64::new(1);

pub struct AppHistory {
    /// Change à chaque modification de la liste d'étapes ; sert à dater les URL d'image.
    pub epoch: u64,
    pub entries: Vec<Arc<DynamicImage>>,
    /// Pour chaque étape, les opérations qui la produisent à partir de l'original (parallèle à
    /// `entries`). Sert à rejouer l'historique sans l'une d'elles.
    pub logs: Vec<Arc<Vec<Step>>>,
    pub index: Option<usize>,
    pub source_path: Option<PathBuf>,
    /// Format du fichier d'origine (`png`, `jpeg`…), affiché tel quel après les retouches.
    pub format: String,
    /// Profil colorimétrique ICC du fichier d'origine, réinjecté à l'export.
    pub icc: Option<Vec<u8>>,
}

impl Default for AppHistory {
    fn default() -> Self {
        Self::new()
    }
}

impl AppHistory {
    pub fn new() -> Self {
        AppHistory {
            epoch: NEXT_EPOCH.fetch_add(1, Ordering::Relaxed),
            entries: Vec::new(),
            logs: Vec::new(),
            index: None,
            source_path: None,
            format: "png".to_string(),
            icc: None,
        }
    }

    pub fn current(&self) -> Option<&DynamicImage> {
        self.index.map(|i| &*self.entries[i])
    }

    /// Image courante partageable : permet de calculer hors du verrou.
    pub fn current_arc(&self) -> Option<Arc<DynamicImage>> {
        self.index.map(|i| Arc::clone(&self.entries[i]))
    }

    /// Journal de l'étape courante (vide avant toute image).
    pub fn current_log(&self) -> Arc<Vec<Step>> {
        self.index
            .map(|i| Arc::clone(&self.logs[i]))
            .unwrap_or_default()
    }

    /// Empile une image dont le journal est celui de l'étape courante.
    pub fn push(&mut self, image: DynamicImage) {
        let log = self.current_log();
        self.push_logged(image, log);
    }

    pub fn push_logged(&mut self, image: DynamicImage, log: Arc<Vec<Step>>) {
        if let Some(i) = self.index {
            self.entries.truncate(i + 1);
            self.logs.truncate(i + 1);
        }
        self.entries.push(Arc::new(image));
        self.logs.push(log);
        self.epoch = NEXT_EPOCH.fetch_add(1, Ordering::Relaxed);
        self.index = Some(self.entries.len() - 1);
        self.enforce_budget();
    }

    /// Abandonne les plus anciennes étapes (jamais l'originale) tant que le budget
    /// d'étapes ou de mémoire est dépassé.
    fn enforce_budget(&mut self) {
        let bytes = |h: &Self| h.entries.iter().map(|e| e.as_bytes().len()).sum::<usize>();
        while self.entries.len() > 2
            && (self.entries.len() > MAX_HISTORY_ENTRIES || bytes(self) > MAX_HISTORY_BYTES)
        {
            self.entries.remove(1);
            self.logs.remove(1);
            self.index = Some(self.entries.len() - 1);
        }
    }

    pub fn open(&mut self, image: DynamicImage) {
        self.entries.clear();
        self.logs.clear();
        self.index = None;
        self.push(image);
    }

    pub fn undo(&mut self) -> Option<&DynamicImage> {
        let i = self.index?;
        if i == 0 {
            return None;
        }
        self.index = Some(i - 1);
        Some(&self.entries[i - 1])
    }

    pub fn redo(&mut self) -> Option<&DynamicImage> {
        let i = self.index?;
        if i + 1 >= self.entries.len() {
            return None;
        }
        self.index = Some(i + 1);
        Some(&self.entries[i + 1])
    }

    /// URL (protocole `lcimg`) de l'étape courante : le webview la charge directement,
    /// sans que le PNG passe par l'IPC en base64.
    pub fn image_url(&self, tab_id: &str) -> String {
        let base = if cfg!(windows) {
            "http://lcimg.localhost"
        } else {
            "lcimg://localhost"
        };
        format!("{base}/{tab_id}/{}/{}", self.epoch, self.index.unwrap_or(0))
    }

    pub fn can_undo(&self) -> bool {
        self.index.map(|i| i > 0).unwrap_or(false)
    }

    pub fn can_redo(&self) -> bool {
        self.index
            .map(|i| i + 1 < self.entries.len())
            .unwrap_or(false)
    }
}

pub struct AppState(pub Mutex<HashMap<String, AppHistory>>);

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, Rgba, RgbaImage};

    fn img(w: u32, h: u32) -> DynamicImage {
        let mut i = RgbaImage::new(w, h);
        for p in i.pixels_mut() {
            *p = Rgba([0, 0, 0, 255]);
        }
        DynamicImage::ImageRgba8(i)
    }

    #[test]
    fn history_starts_empty() {
        let h = AppHistory::new();
        assert!(h.current().is_none());
        assert!(!h.can_undo());
        assert!(!h.can_redo());
    }

    #[test]
    fn push_sets_current() {
        let mut h = AppHistory::new();
        h.push(img(10, 10));
        assert!(h.current().is_some());
        assert!(!h.can_undo());
        assert!(!h.can_redo());
    }

    #[test]
    fn undo_redo_navigate() {
        let mut h = AppHistory::new();
        h.push(img(10, 10));
        h.push(img(20, 20));
        h.push(img(30, 30));

        assert!(h.can_undo());
        assert!(!h.can_redo());
        assert_eq!(h.current().unwrap().width(), 30);

        h.undo();
        assert_eq!(h.current().unwrap().width(), 20);
        assert!(h.can_undo());
        assert!(h.can_redo());

        h.undo();
        assert_eq!(h.current().unwrap().width(), 10);
        assert!(!h.can_undo());
        assert!(h.can_redo());

        h.redo();
        assert_eq!(h.current().unwrap().width(), 20);
    }

    #[test]
    fn push_truncates_redo_stack() {
        let mut h = AppHistory::new();
        h.push(img(10, 10));
        h.push(img(20, 20));
        h.undo();
        h.push(img(50, 50));
        assert!(!h.can_redo());
        assert_eq!(h.current().unwrap().width(), 50);
    }

    #[test]
    fn open_resets_history() {
        let mut h = AppHistory::new();
        h.push(img(10, 10));
        h.push(img(20, 20));
        h.open(img(99, 99));
        assert!(!h.can_undo());
        assert!(!h.can_redo());
        assert_eq!(h.current().unwrap().width(), 99);
    }

    #[test]
    fn the_history_is_capped_but_always_keeps_the_original() {
        let mut h = AppHistory::new();
        h.open(img(1, 1));
        for i in 0..(MAX_HISTORY_ENTRIES as u32 + 20) {
            h.push(img(2 + i, 2));
        }

        assert_eq!(h.entries.len(), MAX_HISTORY_ENTRIES);
        assert_eq!(h.entries[0].width(), 1, "l'original est conservé");
        assert_eq!(h.index, Some(MAX_HISTORY_ENTRIES - 1));
        assert_eq!(
            h.current().unwrap().width(),
            2 + MAX_HISTORY_ENTRIES as u32 + 19
        );
        assert!(h.can_undo());
    }

    #[test]
    fn a_small_history_is_never_trimmed() {
        let mut h = AppHistory::new();
        h.open(img(1, 1));
        h.push(img(2, 2));
        h.push(img(3, 3));

        assert_eq!(h.entries.len(), 3);
        assert_eq!(h.index, Some(2));
    }
}
