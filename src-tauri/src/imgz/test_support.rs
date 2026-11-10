//! Harnais partagé par les tests des commandes.
//!
//! Les commandes prennent un `State<'_, AppState>`, qui ne peut pas être fabriqué à la main :
//! il faut un `Manager`. `tauri::test::mock_app()` en fournit un sans fenêtre ni webview, ce
//! qui permet d'exécuter le vrai code des commandes au lieu d'en recopier les formules dans
//! les tests.

use crate::imgz::{AppHistory, AppState};
use image::{DynamicImage, Rgba, RgbaImage};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;

pub const TAB: &str = "tab-1";

/// Application mock portant un `AppState` déjà peuplé.
///
/// L'`App` doit rester vivante tant qu'on emprunte son état, d'où le type de retour plutôt
/// qu'un `State` seul.
pub struct Harness {
    pub app: tauri::App<tauri::test::MockRuntime>,
}

impl Harness {
    /// Onglet `TAB` contenant `image`.
    pub fn with_image(image: DynamicImage) -> Self {
        let mut history = AppHistory::new();
        history.open(image);
        Self::with_history(history)
    }

    pub fn with_history(history: AppHistory) -> Self {
        let mut map = HashMap::new();
        map.insert(TAB.to_string(), history);
        Self::with_map(map)
    }

    /// État complètement vide : aucun onglet.
    pub fn empty() -> Self {
        Self::with_map(HashMap::new())
    }

    /// Onglet `TAB` présent mais sans image chargée.
    pub fn without_image() -> Self {
        let mut map = HashMap::new();
        map.insert(TAB.to_string(), AppHistory::new());
        Self::with_map(map)
    }

    pub fn with_map(map: HashMap<String, AppHistory>) -> Self {
        let app = tauri::test::mock_app();
        app.manage(AppState(Mutex::new(map)));
        Harness { app }
    }

    pub fn state(&self) -> tauri::State<'_, AppState> {
        self.app.state::<AppState>()
    }

    /// Image courante de l'onglet `TAB`, en RGBA8.
    pub fn current(&self) -> RgbaImage {
        let state = self.state();
        let map = state.0.lock().unwrap();
        map.get(TAB).unwrap().current().unwrap().to_rgba8()
    }

    pub fn pixel(&self, x: u32, y: u32) -> [u8; 4] {
        self.current().get_pixel(x, y).0
    }

    /// Nombre d'entrées empilées dans l'historique de `TAB`.
    pub fn history_len(&self) -> usize {
        let state = self.state();
        let map = state.0.lock().unwrap();
        map.get(TAB).unwrap().entries.len()
    }
}

/// Image unie `w`×`h`, entièrement opaque.
pub fn solid(w: u32, h: u32, rgb: [u8; 3]) -> DynamicImage {
    let mut img = RgbaImage::new(w, h);
    for px in img.pixels_mut() {
        *px = Rgba([rgb[0], rgb[1], rgb[2], 255]);
    }
    DynamicImage::ImageRgba8(img)
}

/// Image unie avec une transparence donnée, pour vérifier que l'alpha est préservé.
pub fn solid_alpha(w: u32, h: u32, rgba: [u8; 4]) -> DynamicImage {
    let mut img = RgbaImage::new(w, h);
    for px in img.pixels_mut() {
        *px = Rgba(rgba);
    }
    DynamicImage::ImageRgba8(img)
}

/// Dégradé horizontal noir → blanc : donne des pixels tous différents, utile pour les
/// filtres qui dépendent du voisinage (flou, pixelisation, esquisse).
pub fn gradient(w: u32, h: u32) -> DynamicImage {
    let mut img = RgbaImage::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let v = ((x as f32 / (w.max(2) - 1) as f32) * 255.0) as u8;
            img.put_pixel(x, y, Rgba([v, v, v, 255]));
        }
    }
    DynamicImage::ImageRgba8(img)
}

/// Damier deux couleurs, pour les filtres directionnels.
pub fn checker(w: u32, h: u32, a: [u8; 3], b: [u8; 3]) -> DynamicImage {
    let mut img = RgbaImage::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let c = if (x + y) % 2 == 0 { a } else { b };
            img.put_pixel(x, y, Rgba([c[0], c[1], c[2], 255]));
        }
    }
    DynamicImage::ImageRgba8(img)
}
