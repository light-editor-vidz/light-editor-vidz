//! Décodage des sources vidéo en flux pour l'export : ffmpeg écrit des frames RGBA brutes sur un
//! pipe, lues au rythme du rendu. Aucune extraction sur disque (une minute de 1080p en PNG
//! pesait ~7 Gio) et seule la plage réellement utilisée est décodée (`-ss` au point d'entrée).

use std::io::Read;
use std::path::Path;
use std::process::{Child, ChildStdout, Command, Stdio};
use tiny_skia::Pixmap;

/// Caractéristiques d'une source vidéo (via ffprobe).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VideoProbe {
    pub width: u32,
    pub height: u32,
    /// Durée en secondes (0.0 si inconnue).
    pub duration: f64,
}

/// Lit largeur, hauteur et durée d'une vidéo. `None` si ffprobe est absent ou ne comprend pas
/// le fichier.
pub fn probe_video(source: &Path) -> Option<VideoProbe> {
    let output = Command::new(crate::ffmpeg_path::ffprobe_binary())
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            // La rotation (smartphones) : ffmpeg la applique au décodage, donc les frames sont dans
            // les dimensions tournées alors que width/height sont celles du codage.
            "stream=width,height,duration:stream_tags=rotate:stream_side_data=rotation:format=duration",
            "-of",
            "default=noprint_wrappers=1",
        ])
        .arg(source)
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_probe(&String::from_utf8_lossy(&output.stdout))
}

fn parse_probe(text: &str) -> Option<VideoProbe> {
    let mut width = None;
    let mut height = None;
    let mut duration = 0.0;
    let mut rotation = 0.0_f64;
    for line in text.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        match key.trim() {
            "width" => width = value.trim().parse::<u32>().ok(),
            "height" => height = value.trim().parse::<u32>().ok(),
            // Durée du conteneur ET du flux : certains fichiers (WebM, MKV en flux) n'ont que l'une des
            // deux (« N/A » pour l'autre). La plus grande valeur valide est retenue ; sans elle, la
            // boucle ne fonctionnait jamais et l'image restait figée.
            "duration" => {
                if let Ok(v) = value.trim().parse::<f64>() {
                    if v.is_finite() {
                        duration = f64::max(duration, v);
                    }
                }
            }
            "rotation" | "TAG:rotate" => {
                rotation = value.trim().parse::<f64>().unwrap_or(rotation);
            }
            _ => {}
        }
    }
    let (width, height) = (width.filter(|w| *w > 0)?, height.filter(|h| *h > 0)?);
    // ±90° (et 270°) : les dimensions affichées sont permutées.
    let quarter_turn = rotation.is_finite() && (rotation.round() as i64).rem_euclid(180) == 90;
    let (width, height) = if quarter_turn {
        (height, width)
    } else {
        (width, height)
    };
    Some(VideoProbe {
        width,
        height,
        duration: if duration.is_finite() { duration } else { 0.0 },
    })
}

/// Flux de frames RGBA décodées, à `fps` images par seconde, à partir de `start_idx`.
pub struct VideoStream {
    child: Child,
    stdout: ChildStdout,
    /// Frame courante (RGBA, alpha droit — les frames vidéo sont opaques).
    frame: Pixmap,
    /// Index (dans la source, au fps du projet) de la frame contenue dans `frame`.
    frame_idx: Option<u64>,
    start_idx: u64,
    ended: bool,
}

impl VideoStream {
    /// Ouvre un décodeur positionné sur `start_idx`. `out_size` est la taille des frames
    /// produites (réduction faite par ffmpeg, bien moins coûteuse qu'un rééchantillonnage ici).
    pub fn open(
        source: &Path,
        fps: u32,
        start_idx: u64,
        out_size: (u32, u32),
        pre_filter: &str,
    ) -> Result<Self, String> {
        let (w, h) = out_size;
        let frame = Pixmap::new(w.max(1), h.max(1)).ok_or("invalid video frame size")?;
        let start_secs = start_idx as f64 / fps.max(1) as f64;
        let mut child = Command::new(crate::ffmpeg_path::ffmpeg_binary())
            .args(["-v", "error", "-nostdin", "-ss"])
            .arg(format!("{start_secs:.6}"))
            .arg("-i")
            .arg(source)
            .args([
                "-an",
                "-vf",
                &format!(
                    "{}fps={},scale={}:{}:flags=bilinear",
                    // Recadrage et filtre de couleur de l'élément, avant la mise à l'échelle.
                    if pre_filter.is_empty() {
                        String::new()
                    } else {
                        format!("{pre_filter},")
                    },
                    fps.max(1),
                    w.max(1),
                    h.max(1)
                ),
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgba",
                "-",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("ffmpeg not found: {e}"))?;
        let stdout = child.stdout.take().ok_or("ffmpeg stdout unavailable")?;
        Ok(Self {
            child,
            stdout,
            frame,
            frame_idx: None,
            start_idx,
            ended: false,
        })
    }

    pub fn size(&self) -> (u32, u32) {
        (self.frame.width(), self.frame.height())
    }

    /// Lit exactement la frame suivante ; faux quand le flux est terminé (la dernière frame lue
    /// reste alors celle de `frame()`).
    pub fn advance(&mut self) -> bool {
        if self.ended {
            return false;
        }
        let next = self.frame_idx.map_or(self.start_idx, |c| c + 1);
        if self.stdout.read_exact(self.frame.data_mut()).is_ok() {
            self.frame_idx = Some(next);
            true
        } else {
            self.ended = true;
            false
        }
    }

    /// Index de la dernière frame lue.
    pub fn current_idx(&self) -> Option<u64> {
        self.frame_idx
    }

    /// Le flux est terminé : plus aucune frame ne viendra.
    pub fn is_ended(&self) -> bool {
        self.ended
    }

    /// La dernière frame lue.
    pub fn frame(&self) -> &Pixmap {
        &self.frame
    }

    /// Premier index que ce flux peut fournir (point d'ouverture).
    pub fn start_idx(&self) -> u64 {
        self.start_idx
    }

    /// Vrai si `idx` ne peut pas être atteint en lisant vers l'avant (retour en arrière après une
    /// boucle) ou serait trop loin pour être décodé image par image (`max_skip`) — il faut alors
    /// rouvrir le flux avec un `-ss` plutôt que décoder et jeter des centaines de frames.
    pub fn needs_reopen(&self, idx: u64, max_skip: u64) -> bool {
        let current = self.frame_idx.unwrap_or(self.start_idx);
        if self.ended {
            // Gelé sur la dernière frame : seul un retour en arrière demande de rouvrir.
            return idx < self.start_idx;
        }
        idx < current || idx - current > max_skip
    }

    /// Frame `idx` (lue en avançant dans le flux). Si le flux se termine avant, la dernière frame
    /// décodée reste affichée (gel sur la dernière image). `None` si aucune frame n'a pu être lue.
    pub fn frame_at(&mut self, idx: u64) -> Option<&Pixmap> {
        while !self.ended && self.frame_idx.is_none_or(|current| current < idx) {
            let next = self.frame_idx.map_or(self.start_idx, |c| c + 1);
            if self.stdout.read_exact(self.frame.data_mut()).is_ok() {
                self.frame_idx = Some(next);
            } else {
                self.ended = true;
            }
        }
        self.frame_idx.map(|_| &self.frame)
    }
}

impl Drop for VideoStream {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ffprobe_output() {
        let probe = parse_probe("width=1920\nheight=1080\nduration=12.500000\n").unwrap();
        assert_eq!(
            probe,
            VideoProbe {
                width: 1920,
                height: 1080,
                duration: 12.5
            }
        );
    }

    #[test]
    fn a_quarter_turn_rotation_swaps_the_displayed_dimensions() {
        // Side data (ffmpeg récent) et balise `rotate` (ancien) : -90°, 90° et 270°.
        for line in ["rotation=-90.000000", "TAG:rotate=90", "TAG:rotate=270"] {
            let probe =
                parse_probe(&format!("width=1920\nheight=1080\n{line}\nduration=2\n")).unwrap();
            assert_eq!((probe.width, probe.height), (1080, 1920), "{line}");
        }
    }

    #[test]
    fn a_real_rotated_video_is_probed_with_its_displayed_size() {
        let ffmpeg = crate::ffmpeg_path::ffmpeg_binary();
        let dir = std::env::temp_dir().join(format!("lev_rotprobe_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (plain, rotated) = (dir.join("plain.mp4"), dir.join("rotated.mp4"));
        let made = Command::new(&ffmpeg)
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=320x180:d=1:r=10",
            ])
            .args(["-c:v", "libx264", "-pix_fmt", "yuv420p"])
            .arg(&plain)
            .status();
        if !matches!(made, Ok(s) if s.success()) {
            return; // pas de ffmpeg (ou sans libx264) : rien à vérifier ici
        }
        Command::new(&ffmpeg)
            .args(["-v", "error", "-y", "-display_rotation", "90", "-i"])
            .arg(&plain)
            .args(["-c", "copy"])
            .arg(&rotated)
            .status()
            .unwrap();

        let probe = probe_video(&rotated).unwrap();

        assert_eq!((probe.width, probe.height), (180, 320));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_stream_duration_is_used_when_the_container_has_none() {
        let probe = parse_probe("width=10\nheight=20\nduration=3.5\nduration=N/A\n").unwrap();
        assert_eq!(probe.duration, 3.5);
        let probe = parse_probe("width=10\nheight=20\nduration=N/A\nduration=2.0\n").unwrap();
        assert_eq!(probe.duration, 2.0);
    }

    #[test]
    fn a_half_turn_or_no_rotation_keeps_the_dimensions() {
        for line in [
            "rotation=180.000000",
            "TAG:rotate=180",
            "rotation=0",
            "rotation=N/A",
        ] {
            let probe = parse_probe(&format!("width=1920\nheight=1080\n{line}\n")).unwrap();
            assert_eq!((probe.width, probe.height), (1920, 1080), "{line}");
        }
    }

    #[test]
    fn missing_dimensions_make_the_probe_fail() {
        assert!(parse_probe("duration=3.0\n").is_none());
        assert!(parse_probe("width=0\nheight=10\n").is_none());
    }

    #[test]
    fn unknown_duration_defaults_to_zero() {
        let probe = parse_probe("width=10\nheight=20\nduration=N/A\n").unwrap();
        assert_eq!(probe.duration, 0.0);
    }
}
