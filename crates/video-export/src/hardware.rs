//! Ce que ce ffmpeg sait vraiment faire au-delà de l'encodage logiciel : encodeurs H.264
//! matériels et filtres de stabilisation. Chaque encodeur est *essayé* sur un minuscule encodage :
//! être compilé ne prouve pas qu'un GPU et son pilote sont là.

use crate::ffmpeg::{FfError, Runner};
use crate::plan::{escape_for_ffmpeg_filter, hardware_profile};

pub fn candidates(platform: &str) -> &'static [&'static str] {
    match platform {
        "macos" | "darwin" => &["videotoolbox"],
        "linux" => &["nvenc", "vaapi", "qsv"],
        "windows" | "win32" => &["nvenc", "qsv"],
        _ => &[],
    }
}

/// Les encodeurs utilisables, du meilleur au moins bon.
pub fn detect_hardware(runner: &dyn Runner, platform: &str) -> Vec<String> {
    let mut usable = Vec::new();
    for id in candidates(platform) {
        let Ok(profile) = hardware_profile(id, "balanced") else {
            continue;
        };
        let mut args = profile.input_args.clone();
        args.extend(
            [
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=320x240:d=0.3:r=10",
                "-vf",
            ]
            .map(String::from),
        );
        args.push(if profile.filter.is_empty() {
            "format=yuv420p".into()
        } else {
            profile.filter.clone()
        });
        args.extend(profile.args);
        args.extend(["-f", "null", "-"].map(String::from));
        if runner.run(&args, &mut |_| {}).is_ok() {
            usable.push((*id).to_string());
        }
    }
    usable
}

/// `ffmpeg -filters` liste les deux filtres de stabilisation.
pub fn has_stabilization(filters_text: &str) -> bool {
    let has = |name: &str| {
        filters_text
            .split(|c: char| !c.is_alphanumeric())
            .any(|w| w == name)
    };
    has("vidstabdetect") && has("vidstabtransform")
}

/// La stabilisation marche-t-elle vraiment ? Avoir les filtres ne suffit pas (certains builds
/// écrivent des données de mouvement qu'ils ne savent pas relire) : les deux passes sont essayées
/// sur un court clip tremblé synthétique.
pub fn stabilization_works(
    runner: &dyn Runner,
    filters_text: &str,
    work_dir: &std::path::Path,
) -> bool {
    if !has_stabilization(filters_text) {
        return false;
    }
    let trf = escape_for_ffmpeg_filter(&work_dir.join("probe.trf").to_string_lossy());
    // Une image qui tremble et a de la texture : les mires plates ou statiques font échouer
    // vid.stab même là où il marche sur de vraies images.
    let source = [
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=480x300:r=25:d=2,crop=320:240:x='80+20*sin(t*13)':y='30+15*sin(t*17)'",
    ];
    let attempt = |filter: String| -> Result<(), FfError> {
        let mut args: Vec<String> = source.iter().map(|s| s.to_string()).collect();
        args.extend([
            "-vf".to_string(),
            filter,
            "-f".into(),
            "null".into(),
            "-".into(),
        ]);
        runner.run(&args, &mut |_| {})
    };
    attempt(format!(
        "vidstabdetect=shakiness=6:accuracy=15:result={trf}"
    ))
    .is_ok()
        && attempt(format!("vidstabtransform=input={trf}")).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffmpeg::MediaInfo;
    use std::cell::RefCell;

    type FailWhen = Box<dyn Fn(&[String]) -> bool>;

    struct Fake {
        calls: RefCell<Vec<Vec<String>>>,
        fail_when: FailWhen,
    }

    impl Runner for Fake {
        fn run(&self, args: &[String], _: &mut dyn FnMut(f64)) -> Result<(), FfError> {
            self.calls.borrow_mut().push(args.to_vec());
            if (self.fail_when)(args) {
                Err(FfError::Failed("nope".into()))
            } else {
                Ok(())
            }
        }
        fn probe(&self, _: &str) -> Result<MediaInfo, String> {
            Ok(MediaInfo::default())
        }
    }

    fn fake(fail_when: impl Fn(&[String]) -> bool + 'static) -> Fake {
        Fake {
            calls: RefCell::new(vec![]),
            fail_when: Box::new(fail_when),
        }
    }

    #[test]
    fn each_platform_tries_its_own_encoders() {
        assert_eq!(candidates("macos"), ["videotoolbox"]);
        assert_eq!(candidates("linux"), ["nvenc", "vaapi", "qsv"]);
        assert_eq!(candidates("windows"), ["nvenc", "qsv"]);
        assert!(candidates("plan9").is_empty());
    }

    #[test]
    fn only_the_encoders_that_really_encode_are_kept() {
        let r = fake(|a| a.iter().any(|x| x == "h264_nvenc"));
        assert_eq!(detect_hardware(&r, "linux"), ["vaapi", "qsv"]);
        let calls = r.calls.borrow();
        assert_eq!(calls.len(), 3);
        // VAAPI demande son périphérique avant l'entrée.
        assert_eq!(&calls[1][..2], ["-vaapi_device", "/dev/dri/renderD128"]);
    }

    #[test]
    fn no_working_encoder_means_an_empty_list() {
        assert!(detect_hardware(&fake(|_| true), "linux").is_empty());
        assert!(detect_hardware(&fake(|_| false), "plan9").is_empty());
    }

    #[test]
    fn the_filters_are_looked_up_as_whole_words() {
        assert!(has_stabilization(
            " T. vidstabdetect  V->V\n T. vidstabtransform V->V"
        ));
        assert!(!has_stabilization(" T. vidstabdetect V->V"));
        assert!(!has_stabilization("myvidstabdetect vidstabtransformx"));
    }

    #[test]
    fn stabilisation_needs_both_passes_to_work() {
        let text = "vidstabdetect vidstabtransform";
        let dir = std::path::Path::new("/tmp");
        assert!(stabilization_works(&fake(|_| false), text, dir));
        assert!(!stabilization_works(
            &fake(|a| a.iter().any(|x| x.starts_with("vidstabtransform"))),
            text,
            dir
        ));
        assert!(!stabilization_works(&fake(|_| false), "nothing", dir));
    }
}
