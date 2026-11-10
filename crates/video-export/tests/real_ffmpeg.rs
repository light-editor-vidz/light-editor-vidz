//! Exports réels avec le ffmpeg embarqué (ignorés s'il est introuvable).

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use video_export::export::export_video;
use video_export::ffmpeg::{FfError, ProcessRunner, Runner};
use video_export::plan::{validate_export_options, ExportOptions, RawExportOptions};

fn runner() -> Option<ProcessRunner> {
    let r = ProcessRunner::system(Arc::new(AtomicBool::new(false)));
    std::process::Command::new(&r.ffmpeg).arg("-version").output().ok()?;
    Some(r)
}

/// Un clip de 6 s avec son et motif tremblé (utile à la stabilisation).
fn make_clip(runner: &ProcessRunner, dir: &Path) -> String {
    let path = dir.join("src.mp4").to_string_lossy().into_owned();
    let args: Vec<String> = [
        "-f", "lavfi", "-i", "testsrc2=s=320x240:r=25:d=6", "-f", "lavfi", "-i", "sine=frequency=440:d=6",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", &path,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    runner.run(&args, &mut |_| {}).expect("le clip de test se crée");
    path
}

fn options(input: &str, output: &str, patch: serde_json::Value) -> ExportOptions {
    let mut base = serde_json::json!({
        "inputPath": input, "outputPath": output, "format": "mp4",
        "segments": [{"start": 0.5, "end": 2.5}, {"start": 4.0, "end": 5.0}],
    });
    for (k, v) in patch.as_object().unwrap() {
        base[k] = v.clone();
    }
    validate_export_options(serde_json::from_value::<RawExportOptions>(base).unwrap()).unwrap()
}

fn export(runner: &ProcessRunner, o: &ExportOptions) -> Result<(), FfError> {
    let work = tempfile::tempdir().unwrap();
    export_video(runner, o, work.path(), &mut |_| {}, &mut |_| {})
}

fn duration(runner: &ProcessRunner, path: &str) -> f64 {
    runner.probe(path).unwrap().duration.unwrap()
}

#[test]
fn cutting_joins_the_kept_parts() {
    let Some(r) = runner() else { return };
    let dir = tempfile::tempdir().unwrap();
    let src = make_clip(&r, dir.path());
    let out = dir.path().join("out.mp4").to_string_lossy().into_owned();

    export(&r, &options(&src, &out, serde_json::json!({}))).unwrap();

    // 2 s + 1 s conservées.
    assert!((duration(&r, &out) - 3.0).abs() < 0.3, "{}", duration(&r, &out));
    let info = r.probe(&out).unwrap();
    assert!(info.streams.iter().any(|s| s.codec_type == "audio"));
}

#[test]
fn speed_shortens_the_output_and_keeps_audio_in_sync() {
    let Some(r) = runner() else { return };
    let dir = tempfile::tempdir().unwrap();
    let src = make_clip(&r, dir.path());
    let out = dir.path().join("out.mp4").to_string_lossy().into_owned();

    export(&r, &options(&src, &out, serde_json::json!({"speed": 2.0}))).unwrap();

    assert!((duration(&r, &out) - 1.5).abs() < 0.3, "{}", duration(&r, &out));
}

#[test]
fn crop_rotation_and_resolution_give_the_expected_even_size() {
    let Some(r) = runner() else { return };
    let dir = tempfile::tempdir().unwrap();
    let src = make_clip(&r, dir.path());
    let out = dir.path().join("out.mp4").to_string_lossy().into_owned();

    // Recadrage 200×100 sur l'image non tournée, puis quart de tour → 100×200.
    export(&r, &options(&src, &out, serde_json::json!({"crop": {"x": 10.0, "y": 10.0, "w": 200.0, "h": 100.0}, "rotation": 90.0}))).unwrap();

    let v = r.probe(&out).unwrap().streams.into_iter().find(|s| s.codec_type == "video").unwrap();
    assert_eq!((v.width, v.height), (Some(100), Some(200)));
}

#[test]
fn a_social_reframe_has_the_target_ratio() {
    let Some(r) = runner() else { return };
    let dir = tempfile::tempdir().unwrap();
    let src = make_clip(&r, dir.path());
    for (mode, aspect, ratio) in [("blur", "9:16", 9.0 / 16.0), ("crop", "1:1", 1.0)] {
        let out = dir.path().join(format!("{mode}.mp4")).to_string_lossy().into_owned();
        export(&r, &options(&src, &out, serde_json::json!({"reframe": {"aspect": aspect, "mode": mode}}))).unwrap();
        let v = r.probe(&out).unwrap().streams.into_iter().find(|s| s.codec_type == "video").unwrap();
        let got = v.width.unwrap() as f64 / v.height.unwrap() as f64;
        assert!((got - ratio).abs() < 0.03, "{mode} {aspect}: {got}");
    }
}

#[test]
fn every_format_is_written() {
    let Some(r) = runner() else { return };
    let dir = tempfile::tempdir().unwrap();
    let src = make_clip(&r, dir.path());
    for format in ["mp4", "mov", "webm", "avi", "gif"] {
        let out = dir.path().join(format!("o.{format}")).to_string_lossy().into_owned();
        export(&r, &options(&src, &out, serde_json::json!({"format": format, "gifWidth": 160, "quality": "small"}))).unwrap_or_else(|e| panic!("{format}: {e}"));
        let d = duration(&r, &out);
        assert!((d - 3.0).abs() < 0.5, "{format}: {d}");
    }
}

#[test]
fn all_twenty_colour_filters_run() {
    let Some(r) = runner() else { return };
    let dir = tempfile::tempdir().unwrap();
    let src = make_clip(&r, dir.path());
    for f in video_export::filters::all() {
        let out = dir.path().join("f.mp4").to_string_lossy().into_owned();
        export(&r, &options(&src, &out, serde_json::json!({"filter": f.id, "segments": [{"start": 0.0, "end": 0.6}]}))).unwrap_or_else(|e| panic!("{}: {e}", f.id));
    }
}

#[test]
fn stabilisation_runs_both_passes() {
    let Some(r) = runner() else { return };
    let dir = tempfile::tempdir().unwrap();
    let src = make_clip(&r, dir.path());
    let out = dir.path().join("out.mp4").to_string_lossy().into_owned();

    export(&r, &options(&src, &out, serde_json::json!({"stabilize": "light"}))).unwrap();

    assert!((duration(&r, &out) - 3.0).abs() < 0.3);
}

#[test]
fn subtitles_are_burned_in_and_the_duration_is_kept() {
    let Some(r) = runner() else { return };
    let dir = tempfile::tempdir().unwrap();
    let src = make_clip(&r, dir.path());
    let style = serde_json::json!({
        "fontFamily": "Arial", "fontSize": 8.0, "color": "#ffffff", "outlineColor": "#000000", "outlineWidth": 2.0,
        "backgroundColor": "#000000", "backgroundOpacity": 0.4, "position": "bottom", "accentColor": "#ffcc00"});
    for animation in ["word-pop", "typewriter", "sentence-slide", "rainbow"] {
        let out = dir.path().join(format!("{animation}.mp4")).to_string_lossy().into_owned();
        let sub = serde_json::json!({"cues": [{"start": 0.6, "end": 2.0, "text": "bonjour tout le monde"}], "style": style, "animation": animation});
        export(&r, &options(&src, &out, serde_json::json!({"subtitles": sub}))).unwrap_or_else(|e| panic!("{animation}: {e}"));
        assert!((duration(&r, &out) - 3.0).abs() < 0.3, "{animation}");
    }
}

#[test]
fn a_cancelled_export_stops_with_cancelled() {
    let Some(mut r) = runner() else { return };
    let dir = tempfile::tempdir().unwrap();
    let src = make_clip(&r, dir.path());
    let out = dir.path().join("out.mp4").to_string_lossy().into_owned();
    r.cancel = Arc::new(AtomicBool::new(true));

    assert_eq!(export(&r, &options(&src, &out, serde_json::json!({}))), Err(FfError::Cancelled));
}

#[test]
fn an_unreadable_source_reports_the_reason() {
    let Some(r) = runner() else { return };
    let dir = tempfile::tempdir().unwrap();
    let bad = dir.path().join("bad.mp4");
    std::fs::write(&bad, b"not a video").unwrap();
    let out = dir.path().join("out.mp4").to_string_lossy().into_owned();

    let err = export(&r, &options(&bad.to_string_lossy(), &out, serde_json::json!({}))).unwrap_err();

    assert!(matches!(err, FfError::Failed(m) if !m.is_empty()));
}
