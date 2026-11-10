//! Lancement de ffmpeg et ffprobe : arguments en tableau (pas de shell), progression lue sur
//! `-progress pipe:1`, annulation, et description des flux d'un fichier.

use scene_core::ffmpeg_path::{ffmpeg_binary, ffprobe_binary};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

const STDERR_TAIL_LINES: usize = 80;

#[derive(Debug, Clone, PartialEq)]
pub enum FfError {
    Cancelled,
    Failed(String),
}

impl std::fmt::Display for FfError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FfError::Cancelled => f.write_str("cancelled"),
            FfError::Failed(m) => f.write_str(m),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct StreamInfo {
    pub codec_type: String,
    pub codec_name: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub pix_fmt: Option<String>,
    /// Rotation d'affichage (matrice ou étiquette `rotate`), en degrés positifs.
    pub rotation: Option<i32>,
    pub attached_pic: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct MediaInfo {
    pub format_name: String,
    pub duration: Option<f64>,
    pub streams: Vec<StreamInfo>,
}

#[derive(Deserialize)]
struct ProbeOut {
    #[serde(default)]
    streams: Vec<ProbeStream>,
    format: Option<ProbeFormat>,
}

#[derive(Deserialize)]
struct ProbeFormat {
    format_name: Option<String>,
    duration: Option<String>,
}

#[derive(Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    pix_fmt: Option<String>,
    tags: Option<std::collections::HashMap<String, String>>,
    side_data_list: Option<Vec<serde_json::Value>>,
    disposition: Option<std::collections::HashMap<String, i32>>,
}

/// Lit la sortie JSON de `ffprobe -show_streams -show_format`.
pub fn parse_probe(json: &str) -> Result<MediaInfo, String> {
    let out: ProbeOut =
        serde_json::from_str(json).map_err(|e| format!("unreadable ffprobe output: {e}"))?;
    let format = out.format.unwrap_or(ProbeFormat {
        format_name: None,
        duration: None,
    });
    let streams = out
        .streams
        .into_iter()
        .map(|s| {
            let from_matrix = s.side_data_list.as_ref().and_then(|l| {
                l.iter()
                    .find_map(|d| d.get("rotation").and_then(|r| r.as_f64()))
            });
            let from_tag = s
                .tags
                .as_ref()
                .and_then(|t| t.get("rotate"))
                .and_then(|r| r.parse::<f64>().ok());
            // Un `displaymatrix` de −90° est un quart de tour d'affichage de 90°.
            let rotation = from_matrix
                .or(from_tag)
                .map(|r| r.abs().round() as i32)
                .filter(|r| *r != 0);
            StreamInfo {
                codec_type: s.codec_type.unwrap_or_default(),
                codec_name: s.codec_name.unwrap_or_default(),
                width: s.width,
                height: s.height,
                pix_fmt: s.pix_fmt,
                rotation,
                attached_pic: s
                    .disposition
                    .and_then(|d| d.get("attached_pic").copied())
                    .unwrap_or(0)
                    == 1,
            }
        })
        .collect();
    Ok(MediaInfo {
        format_name: format.format_name.unwrap_or_default(),
        duration: format
            .duration
            .and_then(|d| d.parse().ok())
            .filter(|d: &f64| d.is_finite()),
        streams,
    })
}

const PROBLEM_WORDS: [&str; 14] = [
    "error",
    "invalid",
    "fail",
    "no such",
    "unable",
    "cannot",
    "could not",
    "unrecognized",
    "unknown",
    "not supported",
    "too big",
    "permission",
    "conversion failed",
    "no space",
];

fn is_chatter(line: &str) -> bool {
    let t = line.trim_start();
    [
        "Stream",
        "Metadata",
        "Input",
        "Output",
        "out#",
        "[out#",
        "frame=",
        "size=",
        "video:",
        "Conversion failed",
    ]
    .iter()
    .any(|p| t.starts_with(p))
}

/// Les quelques lignes de stderr qui expliquent un échec, sans les statistiques de l'encodeur.
pub fn failure_message(lines: &[String]) -> String {
    let useful: Vec<&String> = lines.iter().filter(|l| !is_chatter(l)).collect();
    let problems: Vec<&String> = useful
        .iter()
        .copied()
        .filter(|l| {
            let low = l.to_lowercase();
            PROBLEM_WORDS.iter().any(|w| low.contains(w))
        })
        .collect();
    // La première ligne de problème est la cause ; la suite en est la retombée.
    let chosen: Vec<&String> = if problems.is_empty() {
        useful.iter().rev().take(3).rev().copied().collect()
    } else {
        problems.into_iter().take(2).collect()
    };
    chosen
        .iter()
        .map(|s| s.as_str())
        .collect::<Vec<_>>()
        .join(" | ")
}

/// Ce dont l'export a besoin d'un ffmpeg ; un double de test le remplace.
pub trait Runner {
    /// Lance ffmpeg avec `args` ; `on_progress` reçoit le temps de sortie atteint (secondes).
    fn run(&self, args: &[String], on_progress: &mut dyn FnMut(f64)) -> Result<(), FfError>;
    fn probe(&self, path: &str) -> Result<MediaInfo, String>;
}

/// Le ffmpeg / ffprobe embarqués, avec un drapeau d'annulation.
#[derive(Clone)]
pub struct ProcessRunner {
    pub ffmpeg: String,
    pub ffprobe: String,
    pub cancel: Arc<AtomicBool>,
}

impl ProcessRunner {
    pub fn system(cancel: Arc<AtomicBool>) -> Self {
        Self {
            ffmpeg: ffmpeg_binary(),
            ffprobe: ffprobe_binary(),
            cancel,
        }
    }
}

impl Runner for ProcessRunner {
    fn run(&self, args: &[String], on_progress: &mut dyn FnMut(f64)) -> Result<(), FfError> {
        if self.cancel.load(Ordering::SeqCst) {
            return Err(FfError::Cancelled);
        }
        let mut child = Command::new(&self.ffmpeg)
            .args([
                "-hide_banner",
                "-nostdin",
                "-nostats",
                "-y",
                "-progress",
                "pipe:1",
            ])
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| FfError::Failed(format!("Failed to launch ffmpeg: {e}")))?;
        let stderr = child.stderr.take().map(|pipe| {
            std::thread::spawn(move || {
                let mut tail: Vec<String> = Vec::new();
                for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                    if line.trim().is_empty() {
                        continue;
                    }
                    tail.push(line);
                    if tail.len() > STDERR_TAIL_LINES {
                        tail.remove(0);
                    }
                }
                tail
            })
        });
        if let Some(stdout) = child.stdout.take() {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if self.cancel.load(Ordering::SeqCst) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(FfError::Cancelled);
                }
                if let Some(us) = line.trim().strip_prefix("out_time_us=") {
                    if let Ok(us) = us.parse::<f64>() {
                        on_progress(us / 1e6);
                    }
                }
            }
        }
        let status = child.wait().map_err(|e| FfError::Failed(e.to_string()))?;
        let tail = stderr.and_then(|h| h.join().ok()).unwrap_or_default();
        if self.cancel.load(Ordering::SeqCst) {
            return Err(FfError::Cancelled);
        }
        if status.success() {
            Ok(())
        } else {
            let message = failure_message(&tail);
            Err(FfError::Failed(if message.is_empty() {
                format!("ffmpeg exited with {status}")
            } else {
                message
            }))
        }
    }

    fn probe(&self, path: &str) -> Result<MediaInfo, String> {
        let output = Command::new(&self.ffprobe)
            .args([
                "-v",
                "error",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                path,
            ])
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("Failed to launch ffprobe: {e}"))?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            let reason = err
                .lines()
                .rev()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("unreadable file");
            return Err(reason.to_string());
        }
        parse_probe(&String::from_utf8_lossy(&output.stdout))
    }
}

/// Sortie standard d'une courte requête ffmpeg (`-filters`) ; vide si elle ne peut pas tourner.
pub fn query(args: &[&str]) -> String {
    let mut out = String::new();
    if let Ok(mut child) = Command::new(ffmpeg_binary())
        .args(["-hide_banner", "-nostdin"])
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        if let Some(mut stdout) = child.stdout.take() {
            let _ = stdout.read_to_string(&mut out);
        }
        let _ = child.wait();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_probe_reads_streams_duration_and_rotation() {
        let info = parse_probe(
            r#"{"streams":[
              {"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"pix_fmt":"yuv420p",
               "side_data_list":[{"side_data_type":"Display Matrix","rotation":-90}]},
              {"codec_type":"audio","codec_name":"aac"},
              {"codec_type":"video","codec_name":"mjpeg","disposition":{"attached_pic":1}}],
             "format":{"format_name":"mov,mp4","duration":"12.5"}}"#,
        )
        .unwrap();
        assert_eq!(info.duration, Some(12.5));
        assert_eq!(info.streams.len(), 3);
        assert_eq!(
            (info.streams[0].width, info.streams[0].rotation),
            (Some(1920), Some(90))
        );
        assert_eq!(info.streams[1].codec_type, "audio");
        assert!(info.streams[2].attached_pic);
    }

    #[test]
    fn the_rotate_tag_is_understood_and_zero_is_ignored() {
        let info = parse_probe(r#"{"streams":[{"codec_type":"video","tags":{"rotate":"270"}},{"codec_type":"video","tags":{"rotate":"0"}}],"format":{}}"#).unwrap();
        assert_eq!(info.streams[0].rotation, Some(270));
        assert_eq!(info.streams[1].rotation, None);
        assert_eq!(info.duration, None);
    }

    #[test]
    fn garbage_is_an_error() {
        assert!(parse_probe("not json").is_err());
    }

    #[test]
    fn a_failure_shows_the_cause_not_the_encoder_chatter() {
        let lines: Vec<String> = [
            "Input #0, mov,mp4, from 'a.mp4':",
            "Stream #0:0: Video: h264",
            "[vf#0:0] Error reinitializing filters!",
            "Invalid argument",
            "frame=  10 fps=0.0",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(
            failure_message(&lines),
            "[vf#0:0] Error reinitializing filters! | Invalid argument"
        );
    }

    #[test]
    fn without_a_recognisable_cause_the_last_lines_are_shown() {
        let lines: Vec<String> = ["one", "two", "three", "four"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(failure_message(&lines), "two | three | four");
        assert_eq!(failure_message(&[]), "");
    }

    #[test]
    fn a_cancelled_runner_never_starts_ffmpeg() {
        let runner = ProcessRunner {
            ffmpeg: "/does/not/exist".into(),
            ffprobe: "x".into(),
            cancel: Arc::new(AtomicBool::new(true)),
        };
        assert_eq!(runner.run(&[], &mut |_| {}), Err(FfError::Cancelled));
    }

    #[test]
    fn a_missing_ffmpeg_is_reported() {
        let runner = ProcessRunner {
            ffmpeg: "/does/not/exist".into(),
            ffprobe: "x".into(),
            cancel: Arc::new(AtomicBool::new(false)),
        };
        assert!(
            matches!(runner.run(&[], &mut |_| {}), Err(FfError::Failed(m)) if m.contains("Failed to launch ffmpeg"))
        );
    }
}
