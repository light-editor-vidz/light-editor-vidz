//! Séparer la piste audio d'une vidéo : le flux est copié tel quel quand son codec a un conteneur
//! audio propre, sinon il est ré-encodé en FLAC (sans perte).

use std::path::{Path, PathBuf};

/// Comment la piste est écrite : extension du fichier, et copie du flux ou ré-encodage.
#[derive(Debug, PartialEq, Eq)]
pub struct Plan {
    pub ext: &'static str,
    pub copy: bool,
}

pub fn plan(codec: &str) -> Plan {
    match codec {
        "aac" => Plan {
            ext: "m4a",
            copy: true,
        },
        "mp3" => Plan {
            ext: "mp3",
            copy: true,
        },
        "vorbis" => Plan {
            ext: "ogg",
            copy: true,
        },
        "flac" => Plan {
            ext: "flac",
            copy: true,
        },
        _ => Plan {
            ext: "flac",
            copy: false,
        },
    }
}

/// Arguments de l'extraction de la première piste audio de `input` vers `out`.
pub fn extract_args(input: &str, out: &str, copy: bool) -> Vec<String> {
    let codec = if copy { "copy" } else { "flac" };
    ["-i", input, "-map", "0:a:0", "-vn", "-c:a", codec, out]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

/// Un chemin libre dans `dir` : `<nom> (audio).<ext>`, puis `<nom> (audio 2).<ext>`, etc.
pub fn free_path(dir: &Path, stem: &str, ext: &str, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let first = dir.join(format!("{stem} (audio).{ext}"));
    if !exists(&first) {
        return first;
    }
    (2..)
        .map(|n| dir.join(format!("{stem} (audio {n}).{ext}")))
        .find(|p| !exists(p))
        .expect("an unused name exists")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_codecs_are_copied_into_their_own_container() {
        assert_eq!(
            plan("aac"),
            Plan {
                ext: "m4a",
                copy: true
            }
        );
        assert_eq!(
            plan("mp3"),
            Plan {
                ext: "mp3",
                copy: true
            }
        );
        assert_eq!(
            plan("vorbis"),
            Plan {
                ext: "ogg",
                copy: true
            }
        );
    }

    #[test]
    fn other_codecs_become_flac() {
        // L'outil Audio ne sait pas décoder l'Opus.
        assert_eq!(
            plan("opus"),
            Plan {
                ext: "flac",
                copy: false
            }
        );
        assert_eq!(
            plan("ac3"),
            Plan {
                ext: "flac",
                copy: false
            }
        );
        assert_eq!(
            plan("pcm_s24le"),
            Plan {
                ext: "flac",
                copy: false
            }
        );
    }

    #[test]
    fn the_first_audio_track_is_taken_without_video() {
        let args = extract_args("in.mp4", "out.m4a", true);
        assert_eq!(
            args,
            ["-i", "in.mp4", "-map", "0:a:0", "-vn", "-c:a", "copy", "out.m4a"]
        );
        assert!(extract_args("in.mp4", "out.flac", false).contains(&"flac".to_string()));
    }

    #[test]
    fn an_existing_file_is_never_overwritten() {
        let dir = Path::new("/v");
        let taken = ["/v/a (audio).m4a", "/v/a (audio 2).m4a"];
        let exists = |p: &Path| taken.contains(&p.to_string_lossy().as_ref());
        assert_eq!(
            free_path(dir, "a", "m4a", exists),
            Path::new("/v/a (audio 3).m4a")
        );
        assert_eq!(
            free_path(dir, "b", "m4a", exists),
            Path::new("/v/b (audio).m4a")
        );
    }
}
