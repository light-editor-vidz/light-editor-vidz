//! Lecture des vidéos par HTTP local, pour le WebView de Linux : il refuse les protocoles internes
//! dans `<video>` et corrompt les vidéos lues depuis une URL `blob:`. Le serveur n'écoute que sur
//! 127.0.0.1 et ne sert que les fichiers autorisés, chacun derrière un jeton imprévisible.

use crate::commands::registry::OpenProjects;
use audio_dsp::approval::Approved;
use audio_dsp::error::CmdError;
use std::collections::HashMap;
use std::fs::File;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::State;

type Files = Arc<Mutex<HashMap<String, PathBuf>>>;

pub struct MediaServer {
    port: Option<u16>,
    files: Files,
}

impl MediaServer {
    /// Démarre le serveur ; en cas d'échec, l'application fonctionne sans (aperçu transcodé refusé).
    pub fn start() -> Self {
        let files = Files::default();
        let port = TcpListener::bind(("127.0.0.1", 0))
            .ok()
            .and_then(|listener| {
                let port = listener.local_addr().ok()?.port();
                let served = files.clone();
                std::thread::spawn(move || {
                    for stream in listener.incoming().flatten() {
                        let files = served.clone();
                        std::thread::spawn(move || {
                            let _ = handle(stream, &files);
                        });
                    }
                });
                Some(port)
            });
        Self { port, files }
    }

    fn url_for(&self, path: PathBuf) -> Result<String, CmdError> {
        let port = self
            .port
            .ok_or_else(|| CmdError::from(anyhow::anyhow!("The media server is not running")))?;
        let token = uuid::Uuid::new_v4().simple().to_string();
        self.files.lock().unwrap().insert(token.clone(), path);
        Ok(format!("http://127.0.0.1:{port}/{token}"))
    }
}

/// `bytes=a-b`, `bytes=a-` ou `bytes=-n`, bornés au fichier ; `None` si la plage est invalide.
fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let (start, end) = header.trim().strip_prefix("bytes=")?.split_once('-')?;
    if len == 0 {
        return None;
    }
    let (first, last) = if start.is_empty() {
        let suffix: u64 = end.parse().ok()?;
        (len.checked_sub(suffix.min(len))?, len - 1)
    } else {
        let first: u64 = start.parse().ok()?;
        let last = if end.is_empty() {
            len - 1
        } else {
            end.parse::<u64>().ok()?.min(len - 1)
        };
        (first, last)
    };
    (first <= last).then_some((first, last))
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("mkv") => "video/x-matroska",
        Some("avi") => "video/x-msvideo",
        Some("flv") => "video/x-flv",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") | Some("oga") | Some("opus") => "audio/ogg",
        Some("m4a") => "audio/mp4",
        Some("aac") => "audio/aac",
        Some("flac") => "audio/flac",
        _ => "video/mp4",
    }
}

fn respond(stream: &mut TcpStream, status: &str, headers: &str) -> io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n{headers}\r\n"
    )
}

fn handle(mut stream: TcpStream, files: &Files) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request = String::new();
    reader.read_line(&mut request)?;
    let mut parts = request.split_whitespace();
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let mut range = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 || line.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("range") {
                range = Some(value.trim().to_string());
            }
        }
    }
    if method != "GET" && method != "HEAD" {
        return respond(
            &mut stream,
            "405 Method Not Allowed",
            "Content-Length: 0\r\n",
        );
    }
    let path = files
        .lock()
        .unwrap()
        .get(target.trim_start_matches('/'))
        .cloned();
    let Some(mut file) = path.as_ref().and_then(|p| File::open(p).ok()) else {
        return respond(&mut stream, "404 Not Found", "Content-Length: 0\r\n");
    };
    let path = path.expect("the file was opened from this path");
    let len = file.metadata()?.len();
    let (status, first, last) = match range {
        Some(header) => match parse_range(&header, len) {
            Some((first, last)) => ("206 Partial Content", first, last),
            None => {
                let headers = format!("Content-Range: bytes */{len}\r\nContent-Length: 0\r\n");
                return respond(&mut stream, "416 Range Not Satisfiable", &headers);
            }
        },
        None => ("200 OK", 0, len.saturating_sub(1)),
    };
    let body = if len == 0 { 0 } else { last - first + 1 };
    let mut headers = format!(
        "Content-Type: {}\r\nAccept-Ranges: bytes\r\nContent-Length: {body}\r\n",
        content_type(&path)
    );
    if status.starts_with("206") {
        headers.push_str(&format!("Content-Range: bytes {first}-{last}/{len}\r\n"));
    }
    respond(&mut stream, status, &headers)?;
    if method == "GET" {
        file.seek(SeekFrom::Start(first))?;
        io::copy(&mut file.take(body), &mut stream)?;
    }
    Ok(())
}

/// L'URL de lecture d'un fichier choisi par l'utilisateur (vue Vidéo).
#[tauri::command]
pub fn video_stream_url(
    approved: State<'_, Approved>,
    server: State<'_, MediaServer>,
    path: String,
) -> Result<String, CmdError> {
    approved.check_input(&path).map_err(CmdError::from)?;
    server.url_for(PathBuf::from(path))
}

/// L'URL de lecture d'un média d'un projet ouvert, résolu côté Rust.
#[tauri::command]
pub fn project_stream_url(
    projects: State<'_, OpenProjects>,
    server: State<'_, MediaServer>,
    project_dir: String,
    src: String,
) -> Result<String, CmdError> {
    let refuse = |m: String| CmdError::from(anyhow::anyhow!(m));
    let dir = projects.require(&project_dir).map_err(refuse)?;
    let path = scene_core::paths::resolve_media_path(&dir, &src).map_err(refuse)?;
    server.url_for(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fetch(url: &str, request_headers: &str) -> String {
        let rest = url.strip_prefix("http://").unwrap();
        let (host, target) = rest.split_once('/').unwrap();
        let mut stream = TcpStream::connect(host).unwrap();
        write!(
            stream,
            "GET /{target} HTTP/1.1\r\nHost: {host}\r\n{request_headers}\r\n"
        )
        .unwrap();
        let mut out = String::new();
        stream.read_to_string(&mut out).unwrap();
        out
    }

    fn served() -> (tempfile::TempDir, MediaServer, String) {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.webm");
        std::fs::write(&file, b"0123456789").unwrap();
        let server = MediaServer::start();
        let url = server.url_for(file).unwrap();
        (dir, server, url)
    }

    #[test]
    fn a_range_is_bounded_to_the_file() {
        assert_eq!(parse_range("bytes=2-5", 10), Some((2, 5)));
        assert_eq!(parse_range("bytes=2-", 10), Some((2, 9)));
        assert_eq!(parse_range("bytes=-3", 10), Some((7, 9)));
        assert_eq!(parse_range("bytes=4-99", 10), Some((4, 9)));
        assert_eq!(parse_range("bytes=12-", 10), None);
        assert_eq!(parse_range("bytes=5-2", 10), None);
        assert_eq!(parse_range("items=0-1", 10), None);
    }

    #[test]
    fn the_whole_file_is_served_with_its_type() {
        let (_dir, _server, url) = served();
        let response = fetch(&url, "");
        assert!(response.starts_with("HTTP/1.1 200"), "{response}");
        assert!(response.contains("Content-Type: video/webm"));
        assert!(response.ends_with("\r\n\r\n0123456789"));
    }

    #[test]
    fn a_range_request_gets_only_those_bytes() {
        let (_dir, _server, url) = served();
        let response = fetch(&url, "Range: bytes=2-4\r\n");
        assert!(response.starts_with("HTTP/1.1 206"), "{response}");
        assert!(response.contains("Content-Range: bytes 2-4/10"));
        assert!(response.ends_with("\r\n\r\n234"));
    }

    #[test]
    fn an_impossible_range_is_refused() {
        let (_dir, _server, url) = served();
        assert!(fetch(&url, "Range: bytes=50-\r\n").starts_with("HTTP/1.1 416"));
    }

    #[test]
    fn a_wrong_token_gets_nothing() {
        let (_dir, _server, url) = served();
        let (base, _) = url.rsplit_once('/').unwrap();
        assert!(fetch(&format!("{base}/nope"), "").starts_with("HTTP/1.1 404"));
        assert!(fetch(&format!("{base}/../a.webm"), "").starts_with("HTTP/1.1 404"));
    }
}
