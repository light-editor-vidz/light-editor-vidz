//! Protocole `lcimg://localhost/<onglet>/<époque>/<étape>` : sert en PNG l'image d'une étape
//! de l'historique. Le webview la charge lui-même, ce qui évite de faire transiter l'image
//! finale (des dizaines de Mo) par l'IPC sous forme de data URL base64.

use super::open::encode_png;
use crate::imgz::AppState;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::http::{header, Response, StatusCode};

/// PNG déjà encodés, par `(onglet, époque, étape)` : une URL `lcimg` désigne toujours la même
/// image, donc le PNG plein cadre (plusieurs secondes sur une grande photo) n'est encodé qu'une
/// fois, même quand le WebView redemande l'image (pipette, copie, retour dans l'historique).
/// LRU borné en octets.
struct PngCache {
    entries: HashMap<(String, u64, usize), Arc<Vec<u8>>>,
    order: VecDeque<(String, u64, usize)>,
    bytes: usize,
}

const PNG_CACHE_BYTES: usize = 256 * 1024 * 1024;

fn png_cache() -> &'static Mutex<PngCache> {
    static CACHE: OnceLock<Mutex<PngCache>> = OnceLock::new();
    CACHE.get_or_init(|| {
        Mutex::new(PngCache {
            entries: HashMap::new(),
            order: VecDeque::new(),
            bytes: 0,
        })
    })
}

fn cached_png(key: &(String, u64, usize)) -> Option<Arc<Vec<u8>>> {
    let mut cache = png_cache().lock().unwrap_or_else(|e| e.into_inner());
    let png = cache.entries.get(key)?.clone();
    if let Some(at) = cache.order.iter().position(|k| k == key) {
        let used = cache.order.remove(at)?;
        cache.order.push_back(used);
    }
    Some(png)
}

fn remember_png(key: (String, u64, usize), png: Arc<Vec<u8>>) {
    let mut cache = png_cache().lock().unwrap_or_else(|e| e.into_inner());
    if cache.entries.contains_key(&key) {
        return;
    }
    cache.bytes += png.len();
    cache.order.push_back(key.clone());
    cache.entries.insert(key, png);
    while cache.bytes > PNG_CACHE_BYTES && cache.order.len() > 1 {
        if let Some(old) = cache.order.pop_front() {
            if let Some(removed) = cache.entries.remove(&old) {
                cache.bytes = cache.bytes.saturating_sub(removed.len());
            }
        }
    }
}

/// Pool borné des encodages : une rafale de requêtes (navigation dans l'historique) ne lance
/// plus un thread par image. Les requêtes devenues périmées (époque changée) sont écartées dès
/// que leur tour vient, avant tout encodage : c'est l'annulation.
pub fn spawn(job: impl FnOnce() + Send + 'static) {
    static POOL: OnceLock<rayon::ThreadPool> = OnceLock::new();
    POOL.get_or_init(|| {
        rayon::ThreadPoolBuilder::new()
            .num_threads(2)
            .thread_name(|i| format!("lcimg-{i}"))
            .build()
            .expect("lcimg pool")
    })
    .spawn(job);
}

fn reply(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        // Indispensable pour que la pipette relise les pixels sans « tainter » le canevas.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        // L'URL contient l'époque et l'étape : son contenu ne change jamais.
        .header(
            header::CACHE_CONTROL,
            if status == StatusCode::OK {
                "public, max-age=31536000, immutable"
            } else {
                "no-store"
            },
        )
        .body(body)
        .expect("static response headers are valid")
}

fn not_found(reason: &str) -> Response<Vec<u8>> {
    reply(
        StatusCode::NOT_FOUND,
        "text/plain",
        reason.as_bytes().to_vec(),
    )
}

/// Répond à une requête `lcimg` ; `path` est le chemin de l'URL (`/<onglet>/<époque>/<étape>`).
pub fn serve(state: &AppState, path: &str) -> Response<Vec<u8>> {
    let mut parts = path.trim_start_matches('/').split('/');
    let (Some(tab), Some(epoch), Some(index), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return not_found("bad path");
    };
    let (Ok(epoch), Ok(index)) = (epoch.parse::<u64>(), index.parse::<usize>()) else {
        return not_found("bad path");
    };

    // Le verrou n'est tenu que le temps de prendre une référence ; l'encodage se fait dehors.
    let (image, icc) = {
        let Ok(map) = state.0.lock() else {
            return reply(StatusCode::INTERNAL_SERVER_ERROR, "text/plain", Vec::new());
        };
        match map.get(tab) {
            Some(history) if history.epoch == epoch => {
                (history.entries.get(index).cloned(), history.icc.clone())
            }
            _ => (None, None),
        }
    };
    let Some(image) = image else {
        return not_found("stale image");
    };
    let key = (tab.to_string(), epoch, index);
    if let Some(png) = cached_png(&key) {
        return reply(StatusCode::OK, "image/png", png.as_ref().clone());
    }
    match encode_png(&image) {
        // Le profil de la photo (P3, Adobe RGB…) accompagne l'aperçu : sans lui le WebView le
        // lirait en sRGB et l'image paraîtrait désaturée.
        Ok(png) => {
            let png = match &icc {
                Some(icc) => super::export::embed_icc(png, image::ImageFormat::Png, icc),
                None => png,
            };
            let png = Arc::new(png);
            remember_png(key, png.clone());
            reply(StatusCode::OK, "image/png", png.as_ref().clone())
        }
        Err(e) => reply(
            StatusCode::INTERNAL_SERVER_ERROR,
            "text/plain",
            e.into_bytes(),
        ),
    }
}

#[cfg(test)]
mod cache_tests {
    use super::*;

    #[test]
    fn an_image_is_encoded_once_and_served_again_from_memory() {
        let key = ("t-cache".to_string(), 1, 0);
        assert!(cached_png(&key).is_none());
        remember_png(key.clone(), Arc::new(vec![1, 2, 3]));
        assert_eq!(cached_png(&key).unwrap().as_slice(), &[1, 2, 3]);
        let ok = reply(StatusCode::OK, "image/png", vec![]);
        assert!(ok.headers()[header::CACHE_CONTROL]
            .to_str()
            .unwrap()
            .contains("immutable"));
        let missing = not_found("x");
        assert_eq!(missing.headers()[header::CACHE_CONTROL], "no-store");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imgz::test_support::{solid, Harness, TAB};

    fn url_path(h: &Harness) -> String {
        let state = h.state();
        let map = state.0.lock().unwrap();
        let url = map[TAB].image_url(TAB);
        url.split_once("localhost").unwrap().1.to_string()
    }

    #[test]
    fn serves_the_current_step_as_a_png() {
        let h = Harness::with_image(solid(3, 2, [10, 20, 30]));

        let res = serve(&h.state(), &url_path(&h));

        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers()[header::CONTENT_TYPE], "image/png");
        assert_eq!(res.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
        let img = image::load_from_memory(res.body()).unwrap();
        assert_eq!((img.width(), img.height()), (3, 2));
    }

    #[test]
    fn a_url_goes_stale_once_the_history_changes() {
        let h = Harness::with_image(solid(3, 2, [1, 1, 1]));
        let before = url_path(&h);
        h.state()
            .0
            .lock()
            .unwrap()
            .get_mut(TAB)
            .unwrap()
            .push(solid(5, 5, [2, 2, 2]));

        assert_eq!(serve(&h.state(), &before).status(), StatusCode::NOT_FOUND);
        let now = serve(&h.state(), &url_path(&h));
        let img = image::load_from_memory(now.body()).unwrap();
        assert_eq!((img.width(), img.height()), (5, 5));
    }

    #[test]
    fn an_earlier_step_of_the_same_epoch_is_still_served() {
        let h = Harness::with_image(solid(3, 2, [1, 1, 1]));
        h.state()
            .0
            .lock()
            .unwrap()
            .get_mut(TAB)
            .unwrap()
            .push(solid(5, 5, [2, 2, 2]));
        let path = url_path(&h);
        let original = path.rsplit_once('/').unwrap().0.to_string() + "/0";

        let res = serve(&h.state(), &original);

        let img = image::load_from_memory(res.body()).unwrap();
        assert_eq!((img.width(), img.height()), (3, 2));
    }

    #[test]
    fn unknown_tabs_and_malformed_paths_are_not_found() {
        let h = Harness::with_image(solid(2, 2, [0, 0, 0]));
        for path in [
            "/nope/1/0",
            "/",
            "/a/b/c",
            "/t/1",
            "/t/1/0/extra",
            "/x/-1/0",
        ] {
            assert_eq!(
                serve(&h.state(), path).status(),
                StatusCode::NOT_FOUND,
                "{path}"
            );
        }
    }
}
