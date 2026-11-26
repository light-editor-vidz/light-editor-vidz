//! Le côté ffmpeg d'un export : sonder la source, construire le graphe en une passe, le lancer et
//! — seulement si des sous-titres sont demandés — les graver dans une seconde passe. Le lanceur
//! est injecté (`Runner`) : l'application et les tests pilotent exactement le même code.

use crate::ffmpeg::{FfError, Runner};
use crate::filters;
use crate::plan::{
    build_audio_graph, build_detect_graph, build_filter_complex, escape_for_ffmpeg_filter,
    expected_duration, final_options, gif_tail, hardware_setup, stabilize_filter, ExportOptions,
    FilterComplexParams, ProgressTracker, Subtitles,
};
use crate::subtitles::{
    build_ass_content, expand_cues_to_events, remap_events_to_kept_segments, ExpandOptions,
};
use crate::video_filters::{build_video_filters, VideoFilterParams};
use scene_core::loudness;
use std::path::Path;

/// Construit le filtre `subtitles` pour la vidéo intermédiaire : on la sonde pour connaître ses
/// vraies dimensions (nécessaires à PlayResX/Y et aux coordonnées du glissé), on étend les
/// répliques en événements animés, on les remet sur la ligne de temps de sortie (après coupes et
/// vitesse) et on écrit un .ass temporaire.
pub fn build_export_subtitles_filter(
    runner: &dyn Runner,
    intermediate: &str,
    subtitles: &Subtitles,
    options: &ExportOptions,
    work_dir: &Path,
) -> Result<String, FfError> {
    let info = runner.probe(intermediate).map_err(FfError::Failed)?;
    let video = info.streams.iter().find(|s| s.codec_type == "video");
    let width = video.and_then(|s| s.width).unwrap_or(1920);
    let height = video.and_then(|s| s.height).unwrap_or(1080);

    let events = expand_cues_to_events(
        &subtitles.cues,
        &subtitles.animation,
        &ExpandOptions {
            video_width: width,
            video_height: height,
            position: subtitles.style.position.clone(),
            color: subtitles.style.color.clone(),
            accent_color: subtitles.style.accent_color.clone(),
        },
    );
    // L'intermédiaire est déjà accéléré : les temps des événements rétrécissent avec lui.
    let remapped: Vec<_> = remap_events_to_kept_segments(&events, &options.segments)
        .into_iter()
        .map(|mut e| {
            e.start /= options.speed;
            e.end /= options.speed;
            e
        })
        .collect();
    let ass = build_ass_content(&remapped, &subtitles.style, width, height);
    let ass_path = work_dir.join("subs.ass");
    std::fs::write(&ass_path, ass)
        .map_err(|e| FfError::Failed(format!("Cannot write the subtitles: {e}")))?;
    Ok(format!(
        "subtitles={}",
        escape_for_ffmpeg_filter(&ass_path.to_string_lossy())
    ))
}

/// `-ss` avant `-i` : tout ce qui précède le premier segment conservé n'est ni décodé ni filtré
/// (les coupes en début de film, sinon, coûtaient un décodage complet de ce qu'on jette).
/// `-copyts` garde les horodatages d'origine, donc les `trim` du graphe restent valables ; une
/// seconde de marge évite de couper dans l'image clé de départ.
fn seek_args(segments: &[crate::plan::Segment]) -> Vec<String> {
    let first = segments.iter().map(|x| x.start).fold(f64::MAX, f64::min);
    let seek = (first - 1.0).floor();
    if !first.is_finite() || seek < 1.0 {
        return vec![];
    }
    vec!["-ss".into(), format!("{seek:.3}"), "-copyts".into()]
}

fn s(items: &[&str]) -> Vec<String> {
    items.iter().map(|x| x.to_string()).collect()
}

/// Encode avec l'encodeur matériel demandé ; si cela échoue autrement que par annulation (pilote,
/// taille non gérée…), réessaie une fois en logiciel plutôt que d'échouer l'export.
fn with_fallback(
    hardware: Option<&str>,
    warn: &mut dyn FnMut(&str),
    mut attempt: impl FnMut(Option<&str>) -> Result<(), FfError>,
) -> Result<(), FfError> {
    let Some(hw) = hardware else {
        return attempt(None);
    };
    match attempt(Some(hw)) {
        Err(FfError::Cancelled) => Err(FfError::Cancelled),
        Err(FfError::Failed(m)) => {
            warn(&format!(
                "Hardware encoding ({hw}) failed, retrying in software: {m}"
            ));
            attempt(None)
        }
        ok => ok,
    }
}

/// Avertissement : le son est trop faible pour être porté au volume visé.
pub const LOUDNESS_SKIPPED: &str = "loudness-skipped";

/// Exporte `options`. `send_progress` reçoit 0-99 ; `warn` les événements non fatals.
pub fn export_video(
    runner: &dyn Runner,
    options: &ExportOptions,
    work_dir: &Path,
    send_progress: &mut dyn FnMut(u32),
    warn: &mut dyn FnMut(&str),
) -> Result<(), FfError> {
    let info = runner.probe(&options.input_path).map_err(FfError::Failed)?;
    if !info
        .streams
        .iter()
        .any(|st| st.codec_type == "video" && !st.attached_pic)
    {
        return Err(FfError::Failed("The file has no video stream".into()));
    }
    let with_audio = !options.muted
        && options.format != "gif"
        && info.streams.iter().any(|st| st.codec_type == "audio");

    let mut video_chain = build_video_filters(&VideoFilterParams {
        rotation: options.rotation,
        straighten: options.straighten,
        perspective_h: options.perspective_h,
        perspective_v: options.perspective_v,
        crop: options.crop,
        color_filter: filters::ffmpeg_for(&options.filter),
        speed: Some(options.speed),
        // La taille d'un GIF est sa largeur ; le plafond de hauteur ne vaut que pour la vidéo.
        max_height: if options.format == "gif" {
            None
        } else {
            options.resolution
        },
        reframe: options.reframe.clone(),
    });

    // Avant toute géométrie ou couleur : les filtres suivants travaillent sur des pixels SDR.
    if let Some(sdr) = info.sdr_filter() {
        video_chain.insert(0, sdr);
    }

    let subtitles = options.subtitles.as_ref();
    let gif = (options.format == "gif")
        .then(|| gif_tail(options.gif_width, options.gif_fps, &options.quality));
    let kept_seconds: f64 = options.segments.iter().map(|x| x.end - x.start).sum();
    let total = expected_duration(&options.segments, options.speed);
    let stabilizing = options.stabilize != "off";
    let loudness = options.loudness.filter(|_| with_audio);
    // Le nettoyage précède la mesure du volume : c'est le son nettoyé qu'on porte à la cible.
    let voice = options.voice.filter().filter(|_| with_audio);
    let after_voice = |tail: Option<String>| match (&voice, tail) {
        (Some(voice), Some(tail)) => Some(format!("{voice},{tail}")),
        (voice, tail) => tail.or_else(|| voice.clone()),
    };
    let pass_count = u32::from(stabilizing) + u32::from(loudness.is_some()) + 1;
    let mut tracker = ProgressTracker::default();
    let mut report = |index: u32, seconds: f64, out_total: f64| {
        if let Some(p) = tracker.update(index, pass_count, seconds, out_total) {
            send_progress(p);
        }
    };
    let mut pass = 0;

    // Stabilisation, passe 1 : mesurer le mouvement de la caméra sur les images conservées.
    let mut stab_filters: Option<Vec<String>> = None;
    if stabilizing {
        // One motion file per segment: nothing is measured across a cut, and each segment is
        // stabilised with its own motion before the join (see `FilterComplexParams::stabilize`).
        let parts: Vec<String> = (0..options.segments.len())
            .map(|i| {
                work_dir
                    .join(format!("motion-{i}.trf"))
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        let index = pass;
        pass += 1;
        let mut args = seek_args(&options.segments);
        args.extend(s(&["-i"]));
        args.push(options.input_path.clone());
        args.extend([
            "-filter_complex".into(),
            build_detect_graph(&options.segments, &parts, &options.stabilize),
        ]);
        for i in 0..options.segments.len() {
            args.extend([
                "-map".into(),
                format!("[vo{i}]"),
                "-f".into(),
                "null".into(),
                "-".into(),
            ]);
        }
        runner.run(&args, &mut |sec| report(index, sec, kept_seconds))?;
        stab_filters = Some(
            parts
                .iter()
                .map(|trf| stabilize_filter(trf, &options.stabilize))
                .collect(),
        );
    }

    // Volume, passe de mesure : le son des seules parties conservées, à la vitesse choisie.
    let mut normalize: Option<String> = None;
    if let Some(target) = loudness {
        let stats = work_dir
            .join("loudness.json")
            .to_string_lossy()
            .into_owned();
        let measure = after_voice(Some(loudness::measure_filter(target, &stats)))
            .expect("la mesure est toujours présente");
        let index = pass;
        pass += 1;
        let mut args = seek_args(&options.segments);
        args.push("-i".into());
        args.push(options.input_path.clone());
        args.extend([
            "-filter_complex".into(),
            build_audio_graph(&options.segments, options.speed, &measure),
        ]);
        args.extend(s(&["-map", "[aout]", "-f", "null", "-"]));
        runner.run(&args, &mut |sec| report(index, sec, total))?;
        let json = std::fs::read_to_string(&stats)
            .map_err(|e| FfError::Failed(format!("Cannot read the loudness measure: {e}")))?;
        let measured = loudness::parse_measure(&json).map_err(FfError::Failed)?;
        normalize = loudness::apply_filter(target, &measured, loudness::OUTPUT_RATE);
        if normalize.is_none() {
            warn(LOUDNESS_SKIPPED);
        }
    }

    let audio_tail = after_voice(normalize);

    // Sous-titres : le .ass a besoin des dimensions de l'image finie. Plutôt que d'encoder deux fois
    // (un intermédiaire, puis la gravure, avec l'audio réencodé deux fois), on les mesure sur
    // UNE image du même graphe, puis le filtre `subtitles` rejoint la passe principale.
    if let Some(sub) = subtitles {
        let dims = work_dir.join("dims.png").to_string_lossy().into_owned();
        let graph = build_filter_complex(&FilterComplexParams {
            segments: &options.segments,
            video_chain: &video_chain,
            speed: options.speed,
            with_audio: false,
            gif: None,
            stabilize: None,
            hardware_filter: "",
            audio_tail: None,
        });
        let mut args = s(&["-y"]);
        args.extend(seek_args(&options.segments));
        args.push("-i".into());
        args.push(options.input_path.clone());
        args.extend(["-filter_complex".into(), graph]);
        args.extend(s(&["-map", "[vout]", "-frames:v", "1", "-update", "1"]));
        args.push(dims.clone());
        runner.run(&args, &mut |_| {})?;
        video_chain.push(build_export_subtitles_filter(
            runner, &dims, sub, options, work_dir,
        )?);
    }

    // Passe principale : couper, joindre, stabiliser, géométrie, couleur, vitesse, sous-titres et
    // encoder en un seul graphe.
    let main_index = pass;
    with_fallback(options.hardware.as_deref(), warn, |hardware| {
        let (input_args, hw_filter) = hardware_setup(&options.format, hardware, &options.quality);
        let graph = build_filter_complex(&FilterComplexParams {
            segments: &options.segments,
            video_chain: &video_chain,
            speed: options.speed,
            with_audio,
            gif: gif.as_deref(),
            stabilize: stab_filters.as_deref(),
            hardware_filter: &hw_filter,
            audio_tail: audio_tail.as_deref(),
        });
        let mut args: Vec<String> = input_args;
        args.extend(seek_args(&options.segments));
        args.extend([
            "-i".to_string(),
            options.input_path.clone(),
            "-filter_complex".into(),
            graph,
            "-map".into(),
            "[vout]".into(),
        ]);
        if with_audio {
            args.extend(s(&["-map", "[aout]"]));
        }
        args.extend(final_options(&options.format, &options.quality, hardware));
        if options.format == "gif" {
            args.extend(s(&["-loop", "0"]));
        }
        args.extend([
            "-f".to_string(),
            options.format.clone(),
            options.output_path.clone(),
        ]);
        runner.run(&args, &mut |sec| report(main_index, sec, total))
    })?;
    Ok(())
}

#[cfg(test)]
#[allow(unused_must_use)]
mod tests {
    use super::*;
    use crate::ffmpeg::{MediaInfo, StreamInfo};
    use crate::plan::{validate_export_options, RawExportOptions};
    use std::cell::RefCell;

    struct Fake {
        calls: RefCell<Vec<Vec<String>>>,
        info: MediaInfo,
        /// Échoue l'appel numéro n (à partir de 0) avec ce message.
        fail_call: Option<(usize, FfError)>,
    }

    impl Runner for Fake {
        fn run(&self, args: &[String], on_progress: &mut dyn FnMut(f64)) -> Result<(), FfError> {
            let n = self.calls.borrow().len();
            self.calls.borrow_mut().push(args.to_vec());
            on_progress(1.0);
            match &self.fail_call {
                Some((i, e)) if *i == n => Err(e.clone()),
                _ => Ok(()),
            }
        }
        fn probe(&self, _: &str) -> Result<MediaInfo, String> {
            Ok(self.info.clone())
        }
    }

    fn stream(kind: &str, w: Option<u32>, h: Option<u32>) -> StreamInfo {
        StreamInfo {
            codec_type: kind.into(),
            width: w,
            height: h,
            ..Default::default()
        }
    }

    fn fake(audio: bool) -> Fake {
        let mut streams = vec![stream("video", Some(1280), Some(720))];
        if audio {
            streams.push(stream("audio", None, None));
        }
        Fake {
            calls: RefCell::new(vec![]),
            info: MediaInfo {
                format_name: "mp4".into(),
                duration: Some(20.0),
                streams,
            },
            fail_call: None,
        }
    }

    fn options(patch: serde_json::Value) -> ExportOptions {
        let mut base = serde_json::json!({
            "inputPath": "/in.mp4", "outputPath": "/out.mp4", "format": "mp4",
            "segments": [{"start": 0.0, "end": 4.0}, {"start": 6.0, "end": 8.0}],
        });
        for (k, v) in patch.as_object().unwrap() {
            base[k] = v.clone();
        }
        validate_export_options(serde_json::from_value::<RawExportOptions>(base).unwrap()).unwrap()
    }

    fn run(f: &Fake, o: &ExportOptions) -> (Result<(), FfError>, Vec<u32>, Vec<String>) {
        let dir = tempfile::tempdir().unwrap();
        let mut progress = vec![];
        let mut warnings = vec![];
        let r = export_video(f, o, dir.path(), &mut |p| progress.push(p), &mut |w| {
            warnings.push(w.to_string())
        });
        (r, progress, warnings)
    }

    #[test]
    fn a_simple_export_is_one_ffmpeg_call_writing_the_output() {
        let f = fake(true);
        let (r, progress, _) = run(&f, &options(serde_json::json!({})));
        assert_eq!(r, Ok(()));
        let calls = f.calls.borrow();
        assert_eq!(calls.len(), 1);
        let a = calls[0].join(" ");
        assert!(a.starts_with("-i /in.mp4 -filter_complex "), "{a}");
        assert!(
            a.contains("-map [vout] -map [aout]")
                && a.contains("libx264")
                && a.ends_with("-f mp4 /out.mp4")
        );
        assert!(a.contains("concat=n=2:v=1:a=1"));
        assert!(!progress.is_empty() && progress.iter().all(|p| *p <= 99));
    }

    #[test]
    fn a_muted_export_or_a_source_without_audio_has_no_audio_branch() {
        for (f, patch) in [
            (fake(true), serde_json::json!({"muted": true})),
            (fake(false), serde_json::json!({})),
        ] {
            let _ = run(&f, &options(patch));
            let a = f.calls.borrow()[0].join(" ");
            assert!(!a.contains("[aout]") && !a.contains("[0:a]"), "{a}");
        }
    }

    #[test]
    fn a_gif_has_no_audio_the_palette_pipeline_and_loops_forever() {
        let f = fake(true);
        run(
            &f,
            &options(
                serde_json::json!({"format": "gif", "outputPath": "/o.gif", "gifWidth": 320, "gifFps": 12}),
            ),
        );
        let a = f.calls.borrow()[0].join(" ");
        assert!(
            a.contains("palettegen")
                && a.contains("fps=12")
                && a.contains("-loop 0")
                && !a.contains("[aout]")
        );
        assert!(
            !a.contains("scale=-2:'min("),
            "pas de plafond de hauteur sur un GIF"
        );
    }

    #[test]
    fn the_geometry_filters_and_the_resolution_land_in_the_graph() {
        let f = fake(false);
        run(
            &f,
            &options(
                serde_json::json!({"rotation": 90.0, "filter": "grayscale", "resolution": 720.0, "speed": 2.0, "crop": {"x": 0.0, "y": 0.0, "w": 640.0, "h": 360.0}}),
            ),
        );
        let a = f.calls.borrow()[0].join(" ");
        assert!(
            a.contains(
                "[vc]crop=640:360:0:0,transpose=1,hue=s=0,setpts=PTS/2,scale=w='if(gt(iw,ih),-2,min(720,iw))':h='if(gt(iw,ih),min(720,ih),-2)'"
            ),
            "{a}"
        );
    }

    #[test]
    fn a_file_without_video_is_refused() {
        let mut f = fake(true);
        f.info.streams = vec![stream("audio", None, None)];
        let (r, _, _) = run(&f, &options(serde_json::json!({})));
        assert_eq!(
            r,
            Err(FfError::Failed("The file has no video stream".into()))
        );
        assert!(f.calls.borrow().is_empty());
    }

    #[test]
    fn stabilisation_adds_a_detect_pass_first_and_feeds_the_main_pass() {
        let f = fake(true);
        let (_, progress, _) = run(&f, &options(serde_json::json!({"stabilize": "normal"})));
        let calls = f.calls.borrow();
        assert_eq!(calls.len(), 2);
        assert!(
            calls[0].join(" ").contains("vidstabdetect=shakiness=6")
                && calls[0].join(" ").ends_with("-f null -")
        );
        assert!(calls[1].join(" ").contains("vidstabtransform=input="));
        assert!(progress.contains(&25) || progress.contains(&75) || !progress.is_empty());
    }

    #[test]
    fn subtitles_are_burned_in_the_single_encode_after_measuring_one_frame() {
        let f = fake(true);
        let sub = serde_json::json!({
            "cues": [{"start": 1.0, "end": 3.0, "text": "hello there"}],
            "style": {"fontFamily": "Arial", "fontSize": 5.0, "color": "#ffffff", "outlineColor": "#000000", "outlineWidth": 2.0,
                      "backgroundColor": "#000000", "backgroundOpacity": 0.0, "position": "bottom", "accentColor": "#ffcc00"},
            "animation": "word-pop"});
        let dir = tempfile::tempdir().unwrap();
        let o = options(serde_json::json!({"subtitles": sub}));
        let r = export_video(&f, &o, dir.path(), &mut |_| {}, &mut |_| {});
        assert_eq!(r, Ok(()));
        let calls = f.calls.borrow();
        assert_eq!(calls.len(), 2);
        // Un cadre pour connaître la taille finale, puis UN seul encodage : plus d'intermédiaire,
        // plus d'audio réencodé deux fois.
        let measure = calls[0].join(" ");
        assert!(
            measure.contains("-frames:v 1") && measure.contains("dims.png"),
            "{measure}"
        );
        assert!(!measure.contains("libx264"), "{measure}");
        let main = calls[1].join(" ");
        assert!(main.contains("subtitles="), "{main}");
        assert!(
            main.contains("[vout]") && main.ends_with("-f mp4 /out.mp4"),
            "{main}"
        );
        assert!(!main.contains("intermediate"), "{main}");
        assert_eq!(main.matches("libx264").count(), 1, "{main}");
        let ass = std::fs::read_to_string(dir.path().join("subs.ass")).unwrap();
        assert!(
            ass.contains("PlayResX: 1280") && ass.contains("Dialogue:"),
            "{ass}"
        );
    }

    #[test]
    fn hardware_failure_retries_once_in_software_and_warns() {
        let mut f = fake(true);
        f.fail_call = Some((0, FfError::Failed("driver says no".into())));
        let (r, _, warnings) = run(&f, &options(serde_json::json!({"hardware": "nvenc"})));
        assert_eq!(r, Ok(()));
        let calls = f.calls.borrow();
        assert_eq!(calls.len(), 2);
        assert!(
            calls[0].join(" ").contains("h264_nvenc") && calls[1].join(" ").contains("libx264")
        );
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("nvenc") && warnings[0].contains("driver says no"));
    }

    #[test]
    fn a_cancellation_is_never_retried() {
        let mut f = fake(true);
        f.fail_call = Some((0, FfError::Cancelled));
        let (r, _, warnings) = run(&f, &options(serde_json::json!({"hardware": "nvenc"})));
        assert_eq!(r, Err(FfError::Cancelled));
        assert_eq!(f.calls.borrow().len(), 1);
        assert!(warnings.is_empty());
    }

    #[test]
    fn a_software_failure_is_reported_as_is() {
        let mut f = fake(true);
        f.fail_call = Some((0, FfError::Failed("disk full".into())));
        let (r, _, _) = run(&f, &options(serde_json::json!({})));
        assert_eq!(r, Err(FfError::Failed("disk full".into())));
    }

    #[test]
    fn webm_ignores_the_hardware_encoder() {
        let f = fake(true);
        run(
            &f,
            &options(
                serde_json::json!({"format": "webm", "outputPath": "/o.webm", "hardware": "nvenc"}),
            ),
        );
        let a = f.calls.borrow()[0].join(" ");
        assert!(a.contains("libvpx-vp9") && !a.contains("nvenc"));
    }
}
