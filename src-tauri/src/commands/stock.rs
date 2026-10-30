//! Recherche et import d'assets libres de droit depuis plusieurs moteurs (Pexels, Pixabay,
//! Freesound, Openverse). La recherche est lancée en parallèle sur tous les moteurs configurés
//! (clé API présente dans le store `settings.json` — Openverse n'en demande pas) et les
//! résultats sont fusionnés ; l'échec d'un moteur (clé invalide, réseau) est remonté comme
//! avertissement sans faire échouer les autres. Les requêtes passent par Rust (reqwest) :
//! pas de CORS côté webview, et la clé ne transite jamais par le frontend au moment de chercher.

use super::error::CmdResult;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

pub(crate) const SETTINGS_STORE: &str = "settings.json";
const RESULTS_PER_PROVIDER: usize = 12;
/// Délai total d'une requête de recherche (réponse JSON courte).
const HTTP_TIMEOUT_SECS: u64 = 15;
/// Téléchargements : pas de délai total (une vidéo de plusieurs centaines de Mo dépasse
/// largement 15 s), seulement un délai de connexion et un délai d'inactivité entre deux lectures.
const DOWNLOAD_CONNECT_TIMEOUT_SECS: u64 = 15;
const DOWNLOAD_READ_TIMEOUT_SECS: u64 = 30;
/// Garde-fou sur la taille d'un fichier téléchargé (les vidéos 4K peuvent être lourdes,
/// mais au-delà c'est probablement une erreur).
const MAX_DOWNLOAD_BYTES: u64 = 500 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct StockResult {
    /// "pexels" | "pixabay" | "freesound" | "openverse"
    pub provider: String,
    pub kind: String,
    pub thumbnail_url: Option<String>,
    pub download_url: String,
    /// Page source (attribution / vérification de licence).
    pub page_url: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
    pub duration: Option<f64>,
    /// Nom de fichier suggéré pour l'import (extension incluse).
    pub filename: String,
}

#[derive(Debug, Serialize)]
pub struct StockSearchResponse {
    pub results: Vec<StockResult>,
    /// Erreurs par moteur, non bloquantes (ex: "pexels: clé API invalide").
    pub errors: Vec<String>,
    /// Moteurs effectivement interrogés — vide = aucun moteur configuré pour ce type de média,
    /// l'UI invite alors à renseigner une clé API.
    pub providers: Vec<String>,
}

fn api_key(app: &tauri::AppHandle, provider: &str) -> Option<String> {
    super::secrets::api_key(app, provider)
}

const USER_AGENT: &str = concat!(
    "light-editor-vidz/",
    env!("CARGO_PKG_VERSION"),
    " (desktop video editor)"
);

/// Réduit les droits du fichier de réglages (clés API) à l'utilisateur seul. Sans effet hors Unix.
#[tauri::command]
pub fn restrict_settings_permissions(app: tauri::AppHandle) -> CmdResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        use tauri::Manager;
        let path = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("App data directory unavailable: {e}"))?
            .join(SETTINGS_STORE);
        if path.is_file() {
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
                .map_err(|e| format!("Failed to restrict settings permissions: {e}"))?;
        }
    }
    #[cfg(not(unix))]
    let _ = &app;
    Ok(())
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("HTTP client init failed: {e}"))
}

fn download_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(
            DOWNLOAD_CONNECT_TIMEOUT_SECS,
        ))
        .read_timeout(std::time::Duration::from_secs(DOWNLOAD_READ_TIMEOUT_SECS))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("HTTP client init failed: {e}"))
}

/// Message d'une erreur reqwest sans l'URL : celle-ci contient parfois une clé API (Pixabay la
/// demande en paramètre de requête) et s'afficherait telle quelle dans l'interface.
fn describe_error(e: reqwest::Error) -> String {
    e.without_url().to_string()
}

async fn get_json(
    client: &reqwest::Client,
    url: &str,
    headers: &[(&str, &str)],
) -> Result<Value, String> {
    let mut req = client.get(url);
    for (name, value) in headers {
        req = req.header(*name, *value);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("network: {}", describe_error(e)))?;
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err("invalid or missing API key".to_string());
    }
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    resp.json()
        .await
        .map_err(|e| format!("bad JSON: {}", describe_error(e)))
}

fn str_of(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(|v| v.as_str()).map(str::to_string)
}

/// Nom de fichier sûr : alphanumérique/tiret/point uniquement, jamais de séparateur de chemin.
fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(['-', '.']).to_string();
    if trimmed.is_empty() {
        "asset".to_string()
    } else {
        trimmed
    }
}

// ---------------------------------------------------------------------------
// Parsing par moteur (fonctions pures sur le JSON de réponse, testées hors-ligne)
// ---------------------------------------------------------------------------

fn parse_pexels_images(body: &Value) -> Vec<StockResult> {
    let Some(photos) = body.get("photos").and_then(|p| p.as_array()) else {
        return vec![];
    };
    photos
        .iter()
        .filter_map(|p| {
            let src = p.get("src")?;
            Some(StockResult {
                provider: "pexels".into(),
                kind: "image".into(),
                thumbnail_url: str_of(src, "medium"),
                download_url: str_of(src, "large2x").or_else(|| str_of(src, "original"))?,
                page_url: str_of(p, "url"),
                author: str_of(p, "photographer"),
                license: Some("Pexels License".into()),
                duration: None,
                filename: format!("pexels-{}.jpg", p.get("id").and_then(|i| i.as_i64())?),
            })
        })
        .collect()
}

fn parse_pexels_videos(body: &Value) -> Vec<StockResult> {
    let Some(videos) = body.get("videos").and_then(|v| v.as_array()) else {
        return vec![];
    };
    videos
        .iter()
        .filter_map(|v| {
            let files = v.get("video_files")?.as_array()?;
            // Privilégie un fichier HD raisonnable (≤1920 de large), sinon le premier lien.
            let best = files
                .iter()
                .filter(|f| {
                    f.get("width")
                        .and_then(|w| w.as_i64())
                        .is_some_and(|w| w <= 1920)
                })
                .max_by_key(|f| f.get("width").and_then(|w| w.as_i64()).unwrap_or(0))
                .or_else(|| files.first())?;
            Some(StockResult {
                provider: "pexels".into(),
                kind: "video".into(),
                thumbnail_url: str_of(v, "image"),
                download_url: str_of(best, "link")?,
                page_url: str_of(v, "url"),
                author: v
                    .get("user")
                    .and_then(|u| u.get("name"))
                    .and_then(|n| n.as_str())
                    .map(str::to_string),
                license: Some("Pexels License".into()),
                duration: v.get("duration").and_then(|d| d.as_f64()),
                filename: format!("pexels-video-{}.mp4", v.get("id").and_then(|i| i.as_i64())?),
            })
        })
        .collect()
}

fn parse_pixabay_images(body: &Value) -> Vec<StockResult> {
    let Some(hits) = body.get("hits").and_then(|h| h.as_array()) else {
        return vec![];
    };
    hits.iter()
        .filter_map(|h| {
            Some(StockResult {
                provider: "pixabay".into(),
                kind: "image".into(),
                thumbnail_url: str_of(h, "previewURL").or_else(|| str_of(h, "webformatURL")),
                download_url: str_of(h, "largeImageURL").or_else(|| str_of(h, "webformatURL"))?,
                page_url: str_of(h, "pageURL"),
                author: str_of(h, "user"),
                license: Some("Pixabay License".into()),
                duration: None,
                filename: format!("pixabay-{}.jpg", h.get("id").and_then(|i| i.as_i64())?),
            })
        })
        .collect()
}

fn parse_pixabay_videos(body: &Value) -> Vec<StockResult> {
    let Some(hits) = body.get("hits").and_then(|h| h.as_array()) else {
        return vec![];
    };
    hits.iter()
        .filter_map(|h| {
            let sizes = h.get("videos")?;
            let best = ["medium", "small", "large", "tiny"]
                .iter()
                .find_map(|s| sizes.get(s).filter(|v| v.get("url").is_some()))?;
            Some(StockResult {
                provider: "pixabay".into(),
                kind: "video".into(),
                thumbnail_url: str_of(best, "thumbnail"),
                download_url: str_of(best, "url")?,
                page_url: str_of(h, "pageURL"),
                author: str_of(h, "user"),
                license: Some("Pixabay License".into()),
                duration: h.get("duration").and_then(|d| d.as_f64()),
                filename: format!(
                    "pixabay-video-{}.mp4",
                    h.get("id").and_then(|i| i.as_i64())?
                ),
            })
        })
        .collect()
}

fn parse_freesound(body: &Value) -> Vec<StockResult> {
    let Some(results) = body.get("results").and_then(|r| r.as_array()) else {
        return vec![];
    };
    results
        .iter()
        .filter_map(|r| {
            let id = r.get("id").and_then(|i| i.as_i64())?;
            let name = str_of(r, "name").unwrap_or_default();
            Some(StockResult {
                provider: "freesound".into(),
                kind: "audio".into(),
                thumbnail_url: None,
                // Preview HQ mp3 : accessible avec un simple token (le fichier original
                // demanderait OAuth2), largement suffisant pour une piste de montage.
                download_url: r
                    .get("previews")
                    .and_then(|p| p.get("preview-hq-mp3"))
                    .and_then(|u| u.as_str())
                    .map(str::to_string)?,
                page_url: Some(format!("https://freesound.org/s/{id}/")),
                author: str_of(r, "username"),
                license: str_of(r, "license"),
                duration: r.get("duration").and_then(|d| d.as_f64()),
                filename: format!("freesound-{id}-{}.mp3", sanitize_filename(&name)),
            })
        })
        .collect()
}

fn parse_openverse(body: &Value, kind: &str, default_ext: &str) -> Vec<StockResult> {
    let Some(results) = body.get("results").and_then(|r| r.as_array()) else {
        return vec![];
    };
    results
        .iter()
        .filter_map(|r| {
            let id = str_of(r, "id")?;
            let ext = str_of(r, "filetype").unwrap_or_else(|| default_ext.to_string());
            Some(StockResult {
                provider: "openverse".into(),
                kind: kind.into(),
                thumbnail_url: str_of(r, "thumbnail"),
                download_url: str_of(r, "url")?,
                page_url: str_of(r, "foreign_landing_url"),
                author: str_of(r, "creator"),
                license: str_of(r, "license").map(|l| license_label(&l)),
                duration: r
                    .get("duration")
                    .and_then(|d| d.as_f64())
                    // Openverse audio : durée en millisecondes.
                    .map(|d| if kind == "audio" { d / 1000.0 } else { d }),
                filename: format!("openverse-{}.{ext}", sanitize_filename(&id)),
            })
        })
        .collect()
}

/// Libellé lisible d'un code de licence Openverse (`cc0`, `pdm`, `by-sa`…).
fn license_label(code: &str) -> String {
    match code.to_ascii_lowercase().as_str() {
        "cc0" => "CC0".to_string(),
        "pdm" => "Public Domain".to_string(),
        other => format!("CC {}", other.replace('-', " ").to_uppercase()),
    }
}

/// Fusion round-robin des résultats par moteur : chaque moteur reste visible en tête de liste
/// au lieu que le premier écrase tous les autres.
fn interleave(per_provider: Vec<Vec<StockResult>>) -> Vec<StockResult> {
    let mut iters: Vec<_> = per_provider.into_iter().map(|v| v.into_iter()).collect();
    let mut out = Vec::new();
    loop {
        let mut exhausted = true;
        for it in &mut iters {
            if let Some(r) = it.next() {
                out.push(r);
                exhausted = false;
            }
        }
        if exhausted {
            return out;
        }
    }
}

// ---------------------------------------------------------------------------
// Requêtes par moteur
// ---------------------------------------------------------------------------

async fn search_pexels(
    client: &reqwest::Client,
    key: &str,
    kind: &str,
    query: &str,
    page: u32,
) -> Result<Vec<StockResult>, String> {
    let url = match kind {
        "image" => format!(
            "https://api.pexels.com/v1/search?query={}&per_page={RESULTS_PER_PROVIDER}&page={page}",
            urlencode(query)
        ),
        "video" => format!(
            "https://api.pexels.com/videos/search?query={}&per_page={RESULTS_PER_PROVIDER}&page={page}",
            urlencode(query)
        ),
        _ => return Ok(vec![]),
    };
    let body = get_json(client, &url, &[("Authorization", key)]).await?;
    Ok(match kind {
        "image" => parse_pexels_images(&body),
        _ => parse_pexels_videos(&body),
    })
}

async fn search_pixabay(
    client: &reqwest::Client,
    key: &str,
    kind: &str,
    query: &str,
    page: u32,
) -> Result<Vec<StockResult>, String> {
    let key = urlencode(key);
    let url = match kind {
        "image" => format!(
            "https://pixabay.com/api/?key={key}&q={}&image_type=photo&per_page={RESULTS_PER_PROVIDER}&page={page}&safesearch=true",
            urlencode(query)
        ),
        "video" => format!(
            "https://pixabay.com/api/videos/?key={key}&q={}&per_page={RESULTS_PER_PROVIDER}&page={page}&safesearch=true",
            urlencode(query)
        ),
        _ => return Ok(vec![]),
    };
    let body = get_json(client, &url, &[]).await?;
    Ok(match kind {
        "image" => parse_pixabay_images(&body),
        _ => parse_pixabay_videos(&body),
    })
}

async fn search_freesound(
    client: &reqwest::Client,
    key: &str,
    query: &str,
    page: u32,
) -> Result<Vec<StockResult>, String> {
    // Filtre CC0 uniquement : utilisable sans attribution, cohérent avec les autres moteurs.
    // La clé passe par l'en-tête `Authorization` (jamais dans l'URL, donc jamais dans un message
    // d'erreur).
    let url = format!(
        "https://freesound.org/apiv2/search/text/?query={}&page={page}&page_size={RESULTS_PER_PROVIDER}&fields=id,name,username,license,duration,previews&filter=license:%22Creative%20Commons%200%22",
        urlencode(query)
    );
    let authorization = format!("Token {key}");
    let body = get_json(client, &url, &[("Authorization", &authorization)]).await?;
    Ok(parse_freesound(&body))
}

async fn search_openverse(
    client: &reqwest::Client,
    kind: &str,
    query: &str,
    page: u32,
) -> Result<Vec<StockResult>, String> {
    let (endpoint, default_ext) = match kind {
        "image" => ("images", "jpg"),
        "audio" => ("audio", "mp3"),
        // Openverse n'indexe pas de vidéos.
        _ => return Ok(vec![]),
    };
    let url = format!(
        // CC0 et domaine public uniquement : aucune attribution à conserver, comme pour les
        // autres moteurs (le filtre `commercial` incluait des CC BY/BY-SA qui l'exigent).
        "https://api.openverse.org/v1/{endpoint}/?q={}&license=cc0,pdm&page={page}&page_size={RESULTS_PER_PROVIDER}",
        urlencode(query)
    );
    let body = get_json(client, &url, &[]).await?;
    Ok(parse_openverse(&body, kind, default_ext))
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            b' ' => "+".to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Recherche sur tous les moteurs configurés pour ce type de média, en parallèle.
#[tauri::command]
pub async fn search_stock_assets(
    app: tauri::AppHandle,
    kind: String,
    query: String,
    page: Option<u32>,
) -> CmdResult<StockSearchResponse> {
    let page = page.unwrap_or(1).clamp(1, 50);
    if !matches!(kind.as_str(), "image" | "video" | "audio") {
        return Err((format!("Unknown media type: {kind}")).into());
    }
    let query = query.trim().to_string();
    if query.is_empty() {
        return Ok(StockSearchResponse {
            results: vec![],
            errors: vec![],
            providers: vec![],
        });
    }
    let client = http_client()?;

    let pexels_key = api_key(&app, "pexels");
    let pixabay_key = api_key(&app, "pixabay");
    let freesound_key = api_key(&app, "freesound");

    // Chaque futur retourne (nom du moteur, résultat) ; tous sont lancés de front.
    type ProviderOutcome<'a> = (&'a str, Result<Vec<StockResult>, String>);
    let mut tasks: Vec<futures::future::BoxFuture<ProviderOutcome>> = Vec::new();
    if let (Some(key), true) = (&pexels_key, kind != "audio") {
        tasks.push(Box::pin(async {
            (
                "pexels",
                search_pexels(&client, key, &kind, &query, page).await,
            )
        }));
    }
    if let (Some(key), true) = (&pixabay_key, kind != "audio") {
        tasks.push(Box::pin(async {
            (
                "pixabay",
                search_pixabay(&client, key, &kind, &query, page).await,
            )
        }));
    }
    if let (Some(key), true) = (&freesound_key, kind == "audio") {
        tasks.push(Box::pin(async {
            (
                "freesound",
                search_freesound(&client, key, &query, page).await,
            )
        }));
    }
    if kind != "video" {
        tasks.push(Box::pin(async {
            (
                "openverse",
                search_openverse(&client, &kind, &query, page).await,
            )
        }));
    }

    let outcomes = futures::future::join_all(tasks).await;
    let mut per_provider = Vec::new();
    let mut errors = Vec::new();
    let mut providers = Vec::new();
    for (provider, outcome) in outcomes {
        providers.push(provider.to_string());
        match outcome {
            Ok(results) => per_provider.push(results),
            Err(e) => errors.push(format!("{provider}: {e}")),
        }
    }
    Ok(StockSearchResponse {
        results: interleave(per_provider),
        errors,
        providers,
    })
}

/// Télécharge un asset choisi dans `<project_dir>/assets/<kind>s/` et retourne son chemin
/// relatif — même arborescence que `import_asset` (fichier local), le projet reste autonome.
/// Le fichier est écrit en flux dans un fichier temporaire (jamais en entier en mémoire), la
/// taille est plafonnée pendant le transfert, puis il est renommé une fois complet.
#[tauri::command]
pub async fn import_stock_asset(
    projects: tauri::State<'_, super::registry::OpenProjects>,
    project_dir: String,
    kind: String,
    url: String,
    filename: String,
) -> CmdResult<String> {
    if !url.starts_with("https://") {
        return Err(("Only https downloads are allowed".to_string()).into());
    }
    let project_dir = projects.require(&project_dir)?;
    let subdir = super::assets::kind_subdir(&kind)?;
    let filename = sanitize_filename(&filename);
    if !super::assets::has_allowed_extension(&kind, &filename) {
        return Err((format!("Unsupported {kind} file type: {filename}")).into());
    }
    let target_dir = project_dir.join("assets").join(subdir);
    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| format!("Failed to create assets directory: {e}"))?;

    let client = download_client()?;
    let mut resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", describe_error(e)))?;
    if !resp.status().is_success() {
        return Err((format!("Download failed: HTTP {}", resp.status())).into());
    }
    if resp.content_length().unwrap_or(0) > MAX_DOWNLOAD_BYTES {
        return Err(("File too large".to_string()).into());
    }

    let dest = super::assets::unique_destination(&target_dir, &filename);
    let partial = dest.with_extension("part");
    let result = download_to(&mut resp, &partial, MAX_DOWNLOAD_BYTES).await;
    if let Err(e) = result {
        let _ = tokio::fs::remove_file(&partial).await;
        return Err((e).into());
    }
    tokio::fs::rename(&partial, &dest)
        .await
        .map_err(|e| format!("Failed to write file: {e}"))?;
    let dest_filename = dest
        .file_name()
        .and_then(|f| f.to_str())
        .ok_or_else(|| "Invalid destination filename".to_string())?;
    Ok(format!("assets/{subdir}/{dest_filename}"))
}

/// Écrit le corps de `resp` dans `path` par morceaux, en s'arrêtant au-delà de
/// `max_bytes` (y compris sans en-tête `Content-Length`).
async fn download_to(
    resp: &mut reqwest::Response,
    path: &Path,
    max_bytes: u64,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|e| format!("Failed to write file: {e}"))?;
    let mut written: u64 = 0;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("Download failed: {}", describe_error(e)))?
    {
        written += chunk.len() as u64;
        if written > max_bytes {
            return Err("File too large".to_string());
        }
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write file: {e}"))?;
    }
    file.flush()
        .await
        .map_err(|e| format!("Failed to write file: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_pexels_photos_and_videos() {
        let photos = json!({"photos": [{"id": 12, "url": "https://pexels.com/photo/12",
            "photographer": "Ana", "src": {"medium": "https://img/m.jpg", "large2x": "https://img/l.jpg"}}]});
        let results = parse_pexels_images(&photos);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].download_url, "https://img/l.jpg");
        assert_eq!(results[0].filename, "pexels-12.jpg");

        let videos = json!({"videos": [{"id": 7, "url": "https://pexels.com/video/7", "image": "https://img/t.jpg",
        "duration": 12.0, "user": {"name": "Bob"},
        "video_files": [
            {"width": 3840, "link": "https://v/4k.mp4"},
            {"width": 1920, "link": "https://v/hd.mp4"},
            {"width": 640, "link": "https://v/sd.mp4"}
        ]}]});
        let results = parse_pexels_videos(&videos);
        assert_eq!(results.len(), 1);
        // 4K exclu (>1920), on prend le plus grand fichier restant.
        assert_eq!(results[0].download_url, "https://v/hd.mp4");
        assert_eq!(results[0].duration, Some(12.0));
    }

    #[test]
    fn parses_pixabay_hits() {
        let images = json!({"hits": [{"id": 5, "pageURL": "https://pixabay.com/5", "user": "Léa",
            "previewURL": "https://img/p.jpg", "largeImageURL": "https://img/l.jpg"}]});
        let results = parse_pixabay_images(&images);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].download_url, "https://img/l.jpg");

        let videos = json!({"hits": [{"id": 9, "pageURL": "https://pixabay.com/v/9", "user": "Max",
            "duration": 20,
            "videos": {"medium": {"url": "https://v/m.mp4", "thumbnail": "https://v/t.jpg"},
                       "small": {"url": "https://v/s.mp4"}}}]});
        let results = parse_pixabay_videos(&videos);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].download_url, "https://v/m.mp4");
        assert_eq!(results[0].thumbnail_url.as_deref(), Some("https://v/t.jpg"));
    }

    #[test]
    fn parses_freesound_previews_and_openverse_results() {
        let fs = json!({"results": [{"id": 42, "name": "Rain Loop!", "username": "sam",
            "license": "https://creativecommons.org/publicdomain/zero/1.0/", "duration": 8.5,
            "previews": {"preview-hq-mp3": "https://fs/42.mp3"}}]});
        let results = parse_freesound(&fs);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].download_url, "https://fs/42.mp3");
        assert_eq!(results[0].filename, "freesound-42-Rain-Loop.mp3");

        let ov = json!({"results": [{"id": "ab-12", "url": "https://ov/file.jpg",
            "thumbnail": "https://ov/t.jpg", "creator": "Zoé", "license": "by",
            "foreign_landing_url": "https://source/page", "filetype": "jpg"}]});
        let results = parse_openverse(&ov, "image", "jpg");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].license.as_deref(), Some("CC BY"));
        assert_eq!(results[0].filename, "openverse-ab-12.jpg");
    }

    #[test]
    fn interleave_alternates_between_providers() {
        let a = |p: &str, n: u32| StockResult {
            provider: p.into(),
            kind: "image".into(),
            thumbnail_url: None,
            download_url: format!("https://x/{p}{n}"),
            page_url: None,
            author: None,
            license: None,
            duration: None,
            filename: format!("{p}{n}.jpg"),
        };
        let merged = interleave(vec![
            vec![a("p1", 1), a("p1", 2), a("p1", 3)],
            vec![a("p2", 1)],
        ]);
        let providers: Vec<&str> = merged.iter().map(|r| r.provider.as_str()).collect();
        assert_eq!(providers, vec!["p1", "p2", "p1", "p1"]);
    }

    #[test]
    fn sanitize_filename_strips_path_separators_and_odd_characters() {
        assert_eq!(sanitize_filename("../../etc/passwd"), "etc-passwd");
        assert_eq!(
            sanitize_filename("mon fichier (1).jpg"),
            "mon-fichier--1-.jpg"
        );
        assert_eq!(sanitize_filename("///"), "asset");
    }

    #[test]
    fn urlencode_escapes_query_characters() {
        assert_eq!(urlencode("chat noir"), "chat+noir");
        assert_eq!(urlencode("café&thé"), "caf%C3%A9%26th%C3%A9");
    }

    // ── réponses vides ou mal formées ────────────────────────────────────────

    #[test]
    fn every_parser_yields_nothing_on_a_body_it_does_not_recognise() {
        for body in [json!({}), json!({"photos": "oops"}), json!([]), json!(null)] {
            assert!(parse_pexels_images(&body).is_empty(), "{body}");
            assert!(parse_pexels_videos(&body).is_empty(), "{body}");
            assert!(parse_pixabay_images(&body).is_empty(), "{body}");
            assert!(parse_pixabay_videos(&body).is_empty(), "{body}");
            assert!(parse_freesound(&body).is_empty(), "{body}");
            assert!(parse_openverse(&body, "image", "jpg").is_empty(), "{body}");
        }
    }

    // ── Pexels ───────────────────────────────────────────────────────────────

    #[test]
    fn a_pexels_photo_falls_back_to_the_original_size() {
        let body = json!({"photos": [{"id": 1, "src": {"original": "https://img/o.jpg"}}]});

        let results = parse_pexels_images(&body);

        assert_eq!(results[0].download_url, "https://img/o.jpg");
    }

    #[test]
    fn a_pexels_photo_without_a_usable_size_is_skipped() {
        let body = json!({"photos": [
            {"id": 1, "src": {"medium": "https://img/m.jpg"}},
            {"id": 2},
            {"src": {"large2x": "https://img/l.jpg"}}
        ]});

        assert!(parse_pexels_images(&body).is_empty());
    }

    #[test]
    fn a_pexels_photo_always_carries_its_licence() {
        let body = json!({"photos": [{"id": 3, "src": {"large2x": "https://img/l.jpg"}}]});

        let results = parse_pexels_images(&body);

        assert_eq!(results[0].license.as_deref(), Some("Pexels License"));
        assert!(results[0].duration.is_none());
    }

    #[test]
    fn a_pexels_video_falls_back_to_the_first_file_when_all_are_too_large() {
        let body = json!({"videos": [{"id": 7, "video_files": [
            {"width": 3840, "link": "https://v/4k.mp4"},
            {"width": 2560, "link": "https://v/2k.mp4"}
        ]}]});

        let results = parse_pexels_videos(&body);

        assert_eq!(results[0].download_url, "https://v/4k.mp4");
    }

    #[test]
    fn a_pexels_video_without_files_is_skipped() {
        let body = json!({"videos": [{"id": 7}, {"id": 8, "video_files": []}]});

        assert!(parse_pexels_videos(&body).is_empty());
    }

    #[test]
    fn a_pexels_video_file_without_a_link_is_skipped() {
        let body = json!({"videos": [{"id": 7, "video_files": [{"width": 1280}]}]});

        assert!(parse_pexels_videos(&body).is_empty());
    }

    // ── Pixabay ──────────────────────────────────────────────────────────────

    #[test]
    fn a_pixabay_image_falls_back_to_the_web_format() {
        let body = json!({"hits": [{"id": 5, "webformatURL": "https://img/w.jpg"}]});

        let results = parse_pixabay_images(&body);

        assert_eq!(results[0].download_url, "https://img/w.jpg");
        assert_eq!(
            results[0].thumbnail_url.as_deref(),
            Some("https://img/w.jpg")
        );
    }

    #[test]
    fn a_pixabay_image_without_any_url_is_skipped() {
        let body = json!({"hits": [{"id": 5}, {"webformatURL": "https://img/w.jpg"}]});

        assert!(parse_pixabay_images(&body).is_empty());
    }

    #[test]
    fn a_pixabay_video_falls_back_through_the_size_ladder() {
        // L'ordre de préférence est medium, small, large, puis tiny.
        let only_tiny =
            json!({"hits": [{"id": 9, "videos": {"tiny": {"url": "https://v/t.mp4"}}}]});
        assert_eq!(
            parse_pixabay_videos(&only_tiny)[0].download_url,
            "https://v/t.mp4"
        );

        let small_and_large = json!({"hits": [{"id": 9, "videos": {
            "large": {"url": "https://v/l.mp4"}, "small": {"url": "https://v/s.mp4"}
        }}]});
        assert_eq!(
            parse_pixabay_videos(&small_and_large)[0].download_url,
            "https://v/s.mp4"
        );
    }

    #[test]
    fn a_pixabay_video_without_a_usable_size_is_skipped() {
        let body = json!({"hits": [
            {"id": 9},
            {"id": 10, "videos": {}},
            {"id": 11, "videos": {"medium": {}}}
        ]});

        assert!(parse_pixabay_videos(&body).is_empty());
    }

    // ── Freesound ────────────────────────────────────────────────────────────

    #[test]
    fn a_freesound_result_without_an_mp3_preview_is_skipped() {
        let body = json!({"results": [
            {"id": 42, "name": "x"},
            {"id": 43, "name": "y", "previews": {}},
            {"name": "z", "previews": {"preview-hq-mp3": "https://fs/z.mp3"}}
        ]});

        assert!(parse_freesound(&body).is_empty());
    }

    #[test]
    fn a_freesound_result_without_a_name_still_gets_a_filename() {
        let body = json!({"results": [{"id": 42,
            "previews": {"preview-hq-mp3": "https://fs/42.mp3"}}]});

        let results = parse_freesound(&body);

        assert_eq!(results[0].filename, "freesound-42-asset.mp3");
        assert_eq!(
            results[0].page_url.as_deref(),
            Some("https://freesound.org/s/42/")
        );
        assert!(results[0].thumbnail_url.is_none());
    }

    // ── Openverse ────────────────────────────────────────────────────────────

    #[test]
    fn an_openverse_result_uses_the_default_extension_when_none_is_given() {
        let body = json!({"results": [{"id": "ab", "url": "https://ov/a"}]});

        let results = parse_openverse(&body, "audio", "mp3");

        assert_eq!(results[0].filename, "openverse-ab.mp3");
        assert_eq!(results[0].kind, "audio");
        assert!(results[0].license.is_none());
    }

    #[test]
    fn an_openverse_audio_duration_is_converted_from_milliseconds() {
        let body = json!({"results": [{"id": "ab", "url": "https://ov/a", "duration": 8500}]});

        assert_eq!(
            parse_openverse(&body, "audio", "mp3")[0].duration,
            Some(8.5)
        );
        // Pour une image ou une vidéo, la valeur est déjà en secondes.
        assert_eq!(
            parse_openverse(&body, "video", "mp4")[0].duration,
            Some(8500.0)
        );
    }

    #[test]
    fn an_openverse_result_without_an_id_or_url_is_skipped() {
        let body = json!({"results": [{"url": "https://ov/a"}, {"id": "ab"}]});

        assert!(parse_openverse(&body, "image", "jpg").is_empty());
    }

    // ── fusion des moteurs ───────────────────────────────────────────────────

    fn stub(provider: &str, n: u32) -> StockResult {
        StockResult {
            provider: provider.into(),
            kind: "image".into(),
            thumbnail_url: None,
            download_url: format!("https://x/{provider}{n}"),
            page_url: None,
            author: None,
            license: None,
            duration: None,
            filename: format!("{provider}{n}.jpg"),
        }
    }

    #[test]
    fn interleaving_nothing_yields_nothing() {
        assert!(interleave(vec![]).is_empty());
        assert!(interleave(vec![vec![], vec![]]).is_empty());
    }

    #[test]
    fn a_lone_provider_keeps_its_own_order() {
        let merged = interleave(vec![vec![stub("p", 1), stub("p", 2)]]);

        assert_eq!(
            merged
                .iter()
                .map(|r| r.filename.as_str())
                .collect::<Vec<_>>(),
            ["p1.jpg", "p2.jpg"]
        );
    }

    #[test]
    fn an_empty_provider_does_not_break_the_rotation() {
        let merged = interleave(vec![vec![stub("a", 1)], vec![], vec![stub("c", 1)]]);

        assert_eq!(
            merged
                .iter()
                .map(|r| r.provider.as_str())
                .collect::<Vec<_>>(),
            ["a", "c"]
        );
    }

    #[test]
    fn no_result_is_lost_in_the_merge() {
        let merged = interleave(vec![
            vec![stub("a", 1), stub("a", 2)],
            vec![stub("b", 1)],
            vec![stub("c", 1), stub("c", 2), stub("c", 3)],
        ]);

        assert_eq!(merged.len(), 6);
    }

    // ── noms de fichiers et encodage ─────────────────────────────────────────

    #[test]
    fn a_filename_never_carries_a_path_separator() {
        for name in ["../../etc/passwd", "a/b/c.mp3", "..\\win\\file"] {
            let safe = sanitize_filename(name);
            assert!(!safe.contains('/'), "{safe}");
            assert!(!safe.contains('\\'), "{safe}");
        }
    }

    #[test]
    fn a_filename_keeps_its_harmless_characters() {
        assert_eq!(sanitize_filename("my_track-01.mp3"), "my_track-01.mp3");
    }

    #[test]
    fn urlencode_leaves_the_unreserved_characters_alone() {
        assert_eq!(urlencode("aZ09-_.~"), "aZ09-_.~");
    }

    #[test]
    fn urlencode_escapes_the_characters_that_would_break_a_query() {
        assert_eq!(urlencode("a=b&c?d/e"), "a%3Db%26c%3Fd%2Fe");
    }

    // --- Téléchargement, erreurs, licences ---------------------------------------------------

    #[test]
    fn license_codes_get_readable_labels() {
        assert_eq!(license_label("cc0"), "CC0");
        assert_eq!(license_label("pdm"), "Public Domain");
        assert_eq!(license_label("by-sa"), "CC BY SA");
        assert_eq!(license_label("by"), "CC BY");
    }

    #[test]
    fn the_user_agent_carries_the_real_app_version() {
        assert!(USER_AGENT.contains(env!("CARGO_PKG_VERSION")));
        assert!(!USER_AGENT.contains("/0.1 "));
    }

    /// Serveur HTTP local qui répond une fois avec `response` (octets bruts), puis s'arrête.
    fn serve_once(response: Vec<u8>) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 2048];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(&response);
            }
        });
        format!("http://127.0.0.1:{port}/file")
    }

    fn chunked_response(total: usize) -> Vec<u8> {
        let mut out =
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n".to_vec();
        let mut left = total;
        while left > 0 {
            let n = left.min(512);
            out.extend_from_slice(format!("{n:x}\r\n").as_bytes());
            out.extend(std::iter::repeat_n(b'x', n));
            out.extend_from_slice(b"\r\n");
            left -= n;
        }
        out.extend_from_slice(b"0\r\n\r\n");
        out
    }

    fn run<F: std::future::Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn a_download_is_streamed_to_disk() {
        let url = serve_once(chunked_response(3000));
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("f.part");
        let result = run(async {
            let mut resp = download_client().unwrap().get(&url).send().await.unwrap();
            download_to(&mut resp, &path, 10_000).await
        });
        assert!(result.is_ok(), "{result:?}");
        assert_eq!(std::fs::metadata(&path).unwrap().len(), 3000);
    }

    #[test]
    fn the_size_limit_applies_to_chunked_downloads_without_content_length() {
        let url = serve_once(chunked_response(5000));
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("f.part");
        let result = run(async {
            let mut resp = download_client().unwrap().get(&url).send().await.unwrap();
            assert!(resp.content_length().is_none(), "transfert chunked attendu");
            download_to(&mut resp, &path, 1000).await
        });
        assert_eq!(result, Err("File too large".to_string()));
        // L'écriture s'est arrêtée au plafond : jamais les 5000 octets.
        assert!(std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) <= 1000 + 512);
    }

    #[test]
    fn error_messages_never_contain_the_request_url_or_its_api_key() {
        let message = run(async {
            let err = http_client()
                .unwrap()
                .get("http://127.0.0.1:1/api/?key=SECRET123&q=cat")
                .send()
                .await
                .unwrap_err();
            describe_error(err)
        });
        assert!(!message.contains("SECRET123"), "{message}");
        assert!(!message.contains("127.0.0.1"), "{message}");
    }

    #[test]
    fn the_download_client_has_no_total_deadline() {
        // Une réponse lente mais continue (plus longue que le délai de recherche) doit passer :
        // seul le délai d'inactivité entre deux lectures s'applique.
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabc",
                );
                std::thread::sleep(std::time::Duration::from_millis(300));
                let _ = stream.write_all(b"def");
            }
        });
        let url = format!("http://127.0.0.1:{port}/slow");
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("slow.part");
        let result = run(async {
            let mut resp = download_client().unwrap().get(&url).send().await.unwrap();
            download_to(&mut resp, &path, 100).await
        });
        assert!(result.is_ok(), "{result:?}");
        assert_eq!(std::fs::read(&path).unwrap(), b"abcdef");
    }
}
