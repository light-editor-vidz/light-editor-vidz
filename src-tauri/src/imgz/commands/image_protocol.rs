//! Protocole `lcimg://localhost/<onglet>/<époque>/<étape>` : sert en PNG l'image d'une étape
//! de l'historique. Le webview la charge lui-même, ce qui évite de faire transiter l'image
//! finale (des dizaines de Mo) par l'IPC sous forme de data URL base64.

use super::open::encode_png;
use crate::imgz::AppState;
use tauri::http::{header, Response, StatusCode};

fn reply(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        // Indispensable pour que la pipette relise les pixels sans « tainter » le canevas.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
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
    let image = {
        let Ok(map) = state.0.lock() else {
            return reply(StatusCode::INTERNAL_SERVER_ERROR, "text/plain", Vec::new());
        };
        match map.get(tab) {
            Some(history) if history.epoch == epoch => history.entries.get(index).cloned(),
            _ => None,
        }
    };
    let Some(image) = image else {
        return not_found("stale image");
    };
    match encode_png(&image) {
        Ok(png) => reply(StatusCode::OK, "image/png", png),
        Err(e) => reply(
            StatusCode::INTERNAL_SERVER_ERROR,
            "text/plain",
            e.into_bytes(),
        ),
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
