//! Protocole `lvmedia://` : sert les médias d'un projet ouvert au lecteur `<video>`/`<audio>` de
//! la webview, avec les requêtes `Range`. Le lecteur ne lit alors que les octets dont il a besoin
//! (début du clip, saut dans la timeline) au lieu que l'interface charge et copie tout le fichier
//! (`read_media_file`, qui reste le repli si la webview refuse ce protocole).
//!
//! URL : `lvmedia://localhost/<dossier du projet>::<chemin relatif>`, le tout encodé en
//! pourcentage. Seuls les dossiers de projets ouverts sont servis, et le chemin passe par
//! `resolve_media_path` (aucune sortie du dossier projet).

use super::registry::OpenProjects;
use std::io::{Read, Seek, SeekFrom};

/// Taille maximale d'une réponse : une requête sans borne de fin (`bytes=0-`) est servie par
/// tranches, le lecteur redemande la suite.
const MAX_CHUNK: u64 = 8 * 1024 * 1024;

pub struct MediaResponse {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
}

fn error(status: u16) -> MediaResponse {
    MediaResponse {
        status,
        headers: vec![("Access-Control-Allow-Origin", "*".to_string())],
        body: Vec::new(),
    }
}

fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn mime_type(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("mp4" | "m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("mkv") => "video/x-matroska",
        Some("ogv") => "video/ogg",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg" | "oga" | "opus") => "audio/ogg",
        Some("m4a" | "aac") => "audio/mp4",
        Some("flac") => "audio/flac",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "application/octet-stream",
    }
}

/// `bytes=a-b` / `bytes=a-` / `bytes=-n` → (début, fin incluse) bornés à `len`.
fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let spec = header.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (start, end) = spec.split_once('-')?;
    let (start, end) = match (start.is_empty(), end.is_empty()) {
        (true, false) => {
            let suffix: u64 = end.parse().ok()?;
            (len.saturating_sub(suffix), len.saturating_sub(1))
        }
        (false, true) => (start.parse().ok()?, len.saturating_sub(1)),
        (false, false) => (
            start.parse().ok()?,
            end.parse::<u64>().ok()?.min(len.saturating_sub(1)),
        ),
        (true, true) => return None,
    };
    (start <= end && start < len).then_some((start, end))
}

/// Sert `path` (partie chemin de l'URL, sans le `/` initial) pour l'en-tête `Range` donné.
pub fn serve(projects: &OpenProjects, path: &str, range: Option<&str>) -> MediaResponse {
    let Some(decoded) = percent_decode(path.trim_start_matches('/')) else {
        return error(400);
    };
    let Some((project_dir, relative)) = decoded.rsplit_once("::") else {
        return error(400);
    };
    let Ok(dir) = projects.require(project_dir) else {
        return error(403);
    };
    let Ok(file_path) = scene_core::paths::resolve_media_path(&dir, relative) else {
        return error(404);
    };
    let Ok(mut file) = std::fs::File::open(&file_path) else {
        return error(404);
    };
    let Ok(len) = file.metadata().map(|m| m.len()) else {
        return error(500);
    };
    if len == 0 {
        return error(404);
    }

    let (start, end, status) = match range {
        Some(h) => match parse_range(h, len) {
            Some((s, e)) => (s, e.min(s + MAX_CHUNK - 1), 206),
            None => {
                let mut r = error(416);
                r.headers.push(("Content-Range", format!("bytes */{len}")));
                return r;
            }
        },
        None => (
            0,
            (len - 1).min(MAX_CHUNK - 1),
            if len > MAX_CHUNK { 206 } else { 200 },
        ),
    };
    let mut body = vec![0u8; (end - start + 1) as usize];
    if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut body).is_err() {
        return error(500);
    }
    let mut headers = vec![
        ("Content-Type", mime_type(&file_path).to_string()),
        ("Accept-Ranges", "bytes".to_string()),
        ("Content-Length", body.len().to_string()),
        ("Access-Control-Allow-Origin", "*".to_string()),
    ];
    if status == 206 {
        headers.push(("Content-Range", format!("bytes {start}-{end}/{len}")));
    }
    MediaResponse {
        status,
        headers,
        body,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup(content: &[u8]) -> (tempfile::TempDir, OpenProjects, String) {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("p.lvproj");
        std::fs::create_dir_all(project.join("assets/videos")).unwrap();
        std::fs::write(project.join("assets/videos/v.mp4"), content).unwrap();
        let projects = OpenProjects::default();
        projects.register(&project).unwrap();
        let canonical = project.canonicalize().unwrap();
        let url = format!(
            "/{}::assets%2Fvideos%2Fv.mp4",
            canonical.to_string_lossy().replace('/', "%2F")
        );
        (dir, projects, url)
    }

    fn header<'a>(r: &'a MediaResponse, name: &str) -> Option<&'a str> {
        r.headers
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, v)| v.as_str())
    }

    #[test]
    fn serves_the_whole_file_without_a_range() {
        let (_d, projects, url) = setup(b"0123456789");
        let r = serve(&projects, &url, None);
        assert_eq!((r.status, r.body.as_slice()), (200, &b"0123456789"[..]));
        assert_eq!(header(&r, "Content-Type"), Some("video/mp4"));
        assert_eq!(header(&r, "Accept-Ranges"), Some("bytes"));
    }

    #[test]
    fn serves_only_the_requested_bytes() {
        let (_d, projects, url) = setup(b"0123456789");
        let r = serve(&projects, &url, Some("bytes=2-5"));
        assert_eq!((r.status, r.body.as_slice()), (206, &b"2345"[..]));
        assert_eq!(header(&r, "Content-Range"), Some("bytes 2-5/10"));
    }

    #[test]
    fn open_ended_and_suffix_ranges_work() {
        let (_d, projects, url) = setup(b"0123456789");
        assert_eq!(serve(&projects, &url, Some("bytes=7-")).body, b"789");
        assert_eq!(serve(&projects, &url, Some("bytes=-3")).body, b"789");
        assert_eq!(serve(&projects, &url, Some("bytes=8-99")).body, b"89");
    }

    #[test]
    fn an_unsatisfiable_range_is_416() {
        let (_d, projects, url) = setup(b"0123456789");
        let r = serve(&projects, &url, Some("bytes=50-60"));
        assert_eq!(r.status, 416);
        assert_eq!(header(&r, "Content-Range"), Some("bytes */10"));
    }

    #[test]
    fn a_large_open_range_is_served_in_chunks() {
        let (_d, projects, url) = setup(&vec![7u8; (MAX_CHUNK + 100) as usize]);
        let r = serve(&projects, &url, Some("bytes=0-"));
        assert_eq!((r.status, r.body.len() as u64), (206, MAX_CHUNK));
    }

    #[test]
    fn projects_that_are_not_open_are_refused() {
        let (_d, _projects, url) = setup(b"x");
        assert_eq!(serve(&OpenProjects::default(), &url, None).status, 403);
    }

    #[test]
    fn paths_leaving_the_project_are_refused() {
        let (d, projects, _url) = setup(b"x");
        let project = d.path().join("p.lvproj").canonicalize().unwrap();
        std::fs::write(d.path().join("secret.txt"), b"s").unwrap();
        let url = format!(
            "/{}::..%2Fsecret.txt",
            project.to_string_lossy().replace('/', "%2F")
        );
        assert_eq!(serve(&projects, &url, None).status, 404);
    }

    #[test]
    fn malformed_urls_are_400() {
        let projects = OpenProjects::default();
        assert_eq!(serve(&projects, "/no-separator", None).status, 400);
        assert_eq!(serve(&projects, "/%zz::x", None).status, 400);
    }

    #[test]
    fn range_parsing() {
        assert_eq!(parse_range("bytes=0-4", 10), Some((0, 4)));
        assert_eq!(parse_range("bytes=5-", 10), Some((5, 9)));
        assert_eq!(parse_range("bytes=-4", 10), Some((6, 9)));
        assert_eq!(parse_range("bytes=4-2", 10), None);
        assert_eq!(parse_range("items=0-1", 10), None);
        assert_eq!(parse_range("bytes=-", 10), None);
    }
}
