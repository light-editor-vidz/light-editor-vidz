//! Chaîne de traitement de la vue « Audio » : décodage mis en cache, forme d'onde, puis
//! coupes → fondus → vitesse → filtres → normalisation → écriture. Repris de LightCutSoundz.

use crate::audio::{self, AudioBuffer};
use crate::job::Job;
use crate::ops::{fade, filter, normalize, speed, trim};
use crate::tags;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

#[derive(Serialize, Debug)]
pub struct AudioInfo {
    pub duration: f64,
    pub channels: usize,
    pub sample_rate: u32,
    pub waveform: Vec<f32>,
}

#[derive(Deserialize)]
pub struct ProcessOptions {
    pub input: String,
    pub output: String,
    pub format: String,
    pub trim_start: Option<f64>,
    pub trim_end: Option<f64>,
    /// Ranges (start, end in seconds) to remove from the audio.
    #[serde(default)]
    pub cuts: Vec<(f64, f64)>,
    pub fade_in: Option<f64>,
    pub fade_out: Option<f64>,
    /// `"linear"` (the default) or `"equal-power"`.
    #[serde(default)]
    pub fade_curve: Option<String>,
    pub normalize: bool,
    pub speed: Option<f64>,
    pub filters: Vec<String>,
    /// WAV sample format: `"float32"` (the default), `"pcm24"` or `"pcm16"`.
    #[serde(default)]
    pub wav_depth: Option<String>,
}

/// The last decoded file. Opening a file decodes it once; the export that
/// follows reuses that decode instead of reading the whole file again. A file
/// edited on disk in between is detected by its size and modification time.
struct Cached {
    path: PathBuf,
    modified: Option<SystemTime>,
    len: u64,
    audio: Arc<AudioBuffer>,
}

#[derive(Default, Clone)]
pub struct DecodeCache(Arc<Mutex<Option<Cached>>>);

impl DecodeCache {
    pub fn get_or_decode(&self, path: &str) -> Result<Arc<AudioBuffer>> {
        let meta = std::fs::metadata(path).ok();
        let stamp = meta.as_ref().map(|m| (m.modified().ok(), m.len()));

        if let Some((modified, len)) = stamp {
            let guard = self.0.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(c) = guard.as_ref() {
                if c.path.as_path() == Path::new(path) && c.modified == modified && c.len == len {
                    return Ok(c.audio.clone());
                }
            }
        }

        // Decoded outside the lock: it can take seconds.
        let audio = Arc::new(audio::decode(path)?);
        if let Some((modified, len)) = stamp {
            *self.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(Cached {
                path: PathBuf::from(path),
                modified,
                len,
                audio: audio.clone(),
            });
        }
        Ok(audio)
    }
}

/// Extensions the file picker offers and the OS file associations declare.
pub const AUDIO_EXTENSIONS: [&str; 11] = [
    "mp3", "wav", "flac", "ogg", "aac", "m4a", "aif", "aiff", "caf", "mka", "webm",
];

/// Peak envelope over `points` buckets covering the whole buffer.
///
/// `points` is clamped to the frame count: asking for more buckets than there
/// are frames used to walk past the end of the slice, and `points == 0` used to
/// divide by zero.
pub fn compute_waveform(buf: &AudioBuffer, points: usize) -> Vec<f32> {
    let frames = buf.num_frames();
    if frames == 0 || points == 0 {
        return Vec::new();
    }
    let points = points.min(frames);

    (0..points)
        .map(|i| {
            let start = i * frames / points;
            let end = (((i + 1) * frames / points).max(start + 1)).min(frames);
            buf.samples
                .iter()
                .flat_map(|ch| ch[start..end].iter())
                .map(|s| s.abs())
                .fold(0.0f32, f32::max)
        })
        .collect()
}

pub fn load_audio_blocking(cache: &DecodeCache, path: &str, points: usize) -> Result<AudioInfo> {
    let buf = cache.get_or_decode(path)?;
    Ok(AudioInfo {
        duration: buf.duration_secs(),
        channels: buf.channels(),
        sample_rate: buf.sample_rate,
        waveform: compute_waveform(&buf, points),
    })
}

fn wav_depth(opts: &ProcessOptions) -> Result<audio::WavDepth> {
    match &opts.wav_depth {
        Some(name) => audio::WavDepth::parse(name),
        None => Ok(audio::WavDepth::default()),
    }
}

fn check_format(opts: &ProcessOptions) -> Result<()> {
    match opts.format.as_str() {
        "wav" => wav_depth(opts).map(|_| ()),
        other => audio::ffmpeg_target(other).map(|_| ()),
    }
}

/// cuts → trim → fades → speed → filters → normalise. Normalising comes last on
/// purpose: speed and filters change the peak, and the promised −1 dBFS must
/// describe the file that is actually written.
pub fn run_pipeline(opts: &ProcessOptions, buf: &mut AudioBuffer, job: &Job) -> Result<()> {
    job.check()?;
    trim::remove(buf, &opts.cuts)?;
    if opts.trim_start.is_some() || opts.trim_end.is_some() {
        let start = opts.trim_start.unwrap_or(0.0);
        let end = opts.trim_end.unwrap_or_else(|| buf.duration_secs());
        trim::trim(buf, start, end)?;
    }
    let curve = match &opts.fade_curve {
        Some(name) => fade::Curve::parse(name)?,
        None => fade::Curve::default(),
    };
    if let Some(secs) = opts.fade_in {
        if secs > 0.0 {
            fade::fade_in(buf, secs, curve)?;
        }
    }
    if let Some(secs) = opts.fade_out {
        if secs > 0.0 {
            fade::fade_out(buf, secs, curve)?;
        }
    }
    if let Some(factor) = opts.speed {
        if (factor - 1.0).abs() > 1e-6 {
            speed::change_speed(buf, factor, job)?;
        }
    }
    for spec_str in &opts.filters {
        job.check()?;
        let spec = filter::FilterSpec::parse(spec_str)?;
        filter::apply_filter(buf, &spec)?;
    }
    if opts.normalize {
        job.check()?;
        normalize::normalize(buf)?;
    }
    Ok(())
}

/// Decoding is the first tenth of an export, the edits (resampling is the slow
/// part) the next three, and writing the file the rest.
pub fn process_blocking(cache: &DecodeCache, opts: &ProcessOptions, job: &Job) -> Result<()> {
    check_format(opts)?;
    // The cached decode is shared, so the pipeline works on its own copy.
    let mut buf = (*cache.get_or_decode(&opts.input)?).clone();
    job.progress(0.1);
    run_pipeline(opts, &mut buf, &job.slice(0.1, 0.4))?;

    let write = job.slice(0.4, 1.0);
    match opts.format.as_str() {
        "wav" => audio::encode_wav(&buf, &opts.output, wav_depth(opts)?, &write),
        fmt => {
            // Read from the source, not carried by the cached decode: probing
            // the headers again costs milliseconds.
            let tags = tags::read(&opts.input);
            audio::encode_via_ffmpeg(&buf, &opts.output, fmt, &tags, &write)
        }
    }?;
    job.progress(1.0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::CmdError;
    use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};

    fn base_opts(input: String, output: String) -> ProcessOptions {
        ProcessOptions {
            input,
            output,
            format: "wav".into(),
            trim_start: None,
            trim_end: None,
            cuts: Vec::new(),
            fade_in: None,
            fade_out: None,
            fade_curve: None,
            normalize: false,
            speed: None,
            filters: vec![],
            wav_depth: None,
        }
    }

    fn process(opts: &ProcessOptions) -> Result<()> {
        process_blocking(&DecodeCache::default(), opts, &Job::detached())
    }

    fn write_wav(dir: &tempfile::TempDir, name: &str, frames: usize, channels: usize) -> String {
        let path = dir.path().join(name).to_str().unwrap().to_string();
        let buf = AudioBuffer {
            samples: (0..channels)
                .map(|c| {
                    (0..frames)
                        .map(|i| ((i + c) as f32 / frames as f32) - 0.5)
                        .collect()
                })
                .collect(),
            sample_rate: 44100,
        };
        audio::encode_wav(&buf, &path, audio::WavDepth::Float32, &Job::detached()).unwrap();
        path
    }

    fn buf_of(frames: usize, channels: usize) -> AudioBuffer {
        AudioBuffer {
            samples: vec![vec![0.5f32; frames]; channels],
            sample_rate: 44100,
        }
    }

    fn peak(buf: &AudioBuffer) -> f32 {
        buf.samples
            .iter()
            .flat_map(|c| c.iter())
            .map(|s| s.abs())
            .fold(0.0, f32::max)
    }

    fn code_of(e: anyhow::Error) -> String {
        CmdError::from(e).code
    }

    // ── compute_waveform ────────────────────────────────────────────────

    #[test]
    fn waveform_has_requested_number_of_points() {
        let buf = buf_of(10_000, 1);
        assert_eq!(compute_waveform(&buf, 900).len(), 900);
    }

    #[test]
    fn waveform_clamps_points_to_frame_count() {
        // Regression: 900 points over 100 frames used to index past the slice.
        let buf = buf_of(100, 1);
        assert_eq!(compute_waveform(&buf, 900).len(), 100);
    }

    #[test]
    fn waveform_with_zero_points_is_empty() {
        // Regression: `frames / points` used to divide by zero.
        let buf = buf_of(44_100, 1);
        assert!(compute_waveform(&buf, 0).is_empty());
    }

    #[test]
    fn waveform_of_empty_buffer_is_empty() {
        let buf = AudioBuffer {
            samples: vec![],
            sample_rate: 44100,
        };
        assert!(compute_waveform(&buf, 900).is_empty());
    }

    #[test]
    fn waveform_reports_peaks_from_every_channel() {
        let buf = AudioBuffer {
            samples: vec![vec![0.1f32; 100], vec![0.9f32; 100]],
            sample_rate: 44100,
        };
        let wave = compute_waveform(&buf, 10);
        assert!(wave.iter().all(|v| (v - 0.9).abs() < 1e-6));
    }

    #[test]
    fn waveform_covers_the_tail_of_the_buffer() {
        let mut buf = buf_of(1000, 1);
        for s in buf.samples[0].iter_mut() {
            *s = 0.0;
        }
        buf.samples[0][999] = 1.0;
        let wave = compute_waveform(&buf, 10);
        assert!(
            (wave[9] - 1.0).abs() < 1e-6,
            "last bucket must see the tail"
        );
    }

    #[test]
    fn a_second_read_of_the_same_file_reuses_the_decode() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_wav(&dir, "in.wav", 4410, 1);
        let cache = DecodeCache::default();

        let first = cache.get_or_decode(&path).unwrap();
        let second = cache.get_or_decode(&path).unwrap();

        assert!(Arc::ptr_eq(&first, &second));
    }

    #[test]
    fn a_file_rewritten_on_disk_is_decoded_again() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_wav(&dir, "in.wav", 4410, 1);
        let cache = DecodeCache::default();
        let first = cache.get_or_decode(&path).unwrap();

        write_wav(&dir, "in.wav", 8820, 1);
        let second = cache.get_or_decode(&path).unwrap();

        assert!(!Arc::ptr_eq(&first, &second));
        assert_eq!(second.num_frames(), 8820);
    }

    #[test]
    fn a_different_file_replaces_the_cached_one() {
        let dir = tempfile::tempdir().unwrap();
        let a = write_wav(&dir, "a.wav", 1000, 1);
        let b = write_wav(&dir, "b.wav", 2000, 1);
        let cache = DecodeCache::default();

        cache.get_or_decode(&a).unwrap();
        assert_eq!(cache.get_or_decode(&b).unwrap().num_frames(), 2000);
        assert_eq!(cache.get_or_decode(&a).unwrap().num_frames(), 1000);
    }

    #[test]
    fn a_failed_decode_is_not_cached() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("junk.wav").to_str().unwrap().to_string();
        std::fs::write(&path, b"not audio").unwrap();
        let cache = DecodeCache::default();

        assert!(cache.get_or_decode(&path).is_err());
        assert!(cache.0.lock().unwrap().is_none());
    }

    #[test]
    fn process_audio_writes_a_wav_passthrough() {
        let dir = tempfile::tempdir().unwrap();
        let input = write_wav(&dir, "in.wav", 4410, 2);
        let output = dir.path().join("out.wav").to_str().unwrap().to_string();
        process(&base_opts(input, output.clone())).unwrap();

        let decoded = audio::decode(&output).unwrap();
        assert_eq!(decoded.num_frames(), 4410);
        assert_eq!(decoded.channels(), 2);
    }

    #[test]
    fn process_audio_applies_the_whole_chain() {
        let dir = tempfile::tempdir().unwrap();
        let input = write_wav(&dir, "in.wav", 44_100, 2);
        let output = dir.path().join("out.wav").to_str().unwrap().to_string();
        let mut opts = base_opts(input, output.clone());
        opts.trim_start = Some(0.1);
        opts.trim_end = Some(0.6);
        opts.fade_in = Some(0.05);
        opts.fade_out = Some(0.05);
        opts.normalize = true;
        opts.speed = Some(2.0);
        opts.filters = vec!["lowpass:4000".into()];

        process(&opts).unwrap();

        let decoded = audio::decode(&output).unwrap();
        // 0.5s trimmed, then played back at 2x.
        let expected = (0.25 * 44_100.0) as usize;
        let delta = (decoded.num_frames() as i64 - expected as i64).abs();
        assert!(
            delta < 64,
            "got {} frames, expected ~{expected}",
            decoded.num_frames()
        );
    }

    #[test]
    fn normalising_is_the_last_step_so_the_peak_is_what_the_label_says() {
        // Regression: normalising before the filter or the speed change left
        // peaks of +4 dBFS (high-pass on a square wave) in the written file.
        let square = |hz: usize| -> Vec<f32> {
            (0..44_100)
                .map(|i| {
                    if (i * hz * 2 / 44_100) & 1 == 0 {
                        0.6
                    } else {
                        -0.6
                    }
                })
                .collect()
        };
        for (speed, filters) in [
            (None, vec!["highpass:1000".to_string()]),
            (Some(1.5), vec![]),
            (Some(1.5), vec!["highpass:1000".to_string()]),
        ] {
            let mut buf = AudioBuffer {
                samples: vec![square(100)],
                sample_rate: 44100,
            };
            let mut opts = base_opts(String::new(), String::new());
            opts.normalize = true;
            opts.speed = speed;
            opts.filters = filters;

            run_pipeline(&opts, &mut buf, &Job::detached()).unwrap();

            assert!(
                (peak(&buf) - normalize::TARGET_PEAK).abs() < 1e-4,
                "peak {} after {:?} {:?}",
                peak(&buf),
                opts.speed,
                opts.filters
            );
        }
    }

    #[test]
    fn overlapping_fades_multiply() {
        let mut buf = buf_of(1000, 1);
        buf.sample_rate = 1000;
        let mut opts = base_opts(String::new(), String::new());
        opts.fade_in = Some(0.8);
        opts.fade_out = Some(0.8);

        run_pipeline(&opts, &mut buf, &Job::detached()).unwrap();

        // At frame 500 the fade-in ramp is at 500/799 and the fade-out at
        // 1 - 300/799, over a source of 0.5: the two multiply (≈ 0.195).
        let expected = 0.5 * (500.0 / 799.0) * (1.0 - 300.0 / 799.0);
        assert!((buf.samples[0][500] - expected).abs() < 1e-4);
    }

    #[test]
    fn the_fade_curve_option_selects_the_shape() {
        let run = |curve: Option<&str>| {
            let mut buf = buf_of(101, 1);
            buf.sample_rate = 101;
            let mut opts = base_opts(String::new(), String::new());
            opts.fade_in = Some(1.0);
            opts.fade_curve = curve.map(String::from);
            run_pipeline(&opts, &mut buf, &Job::detached()).map(|_| buf.samples[0][50])
        };
        assert!((run(None).unwrap() - 0.25).abs() < 0.01);
        assert!((run(Some("linear")).unwrap() - 0.25).abs() < 0.01);
        assert!(
            (run(Some("equal-power")).unwrap() - 0.5 * std::f32::consts::FRAC_1_SQRT_2).abs()
                < 0.01
        );
        assert_eq!(code_of(run(Some("bogus")).unwrap_err()), "fade_curve");
    }

    #[test]
    fn a_quiet_region_can_be_exported_with_normalise_checked() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("quiet.wav").to_str().unwrap().to_string();
        audio::encode_wav(
            &AudioBuffer {
                samples: vec![vec![0.0; 4410]],
                sample_rate: 44100,
            },
            &path,
            audio::WavDepth::Float32,
            &Job::detached(),
        )
        .unwrap();
        let output = dir.path().join("out.wav").to_str().unwrap().to_string();
        let mut opts = base_opts(path, output.clone());
        opts.normalize = true;

        process(&opts).unwrap();

        assert_eq!(audio::decode(&output).unwrap().num_frames(), 4410);
    }

    #[test]
    fn process_audio_trims_with_only_a_start_bound() {
        let dir = tempfile::tempdir().unwrap();
        let input = write_wav(&dir, "in.wav", 44_100, 1);
        let output = dir.path().join("out.wav").to_str().unwrap().to_string();
        let mut opts = base_opts(input, output.clone());
        opts.trim_start = Some(0.5);

        process(&opts).unwrap();
        let decoded = audio::decode(&output).unwrap();
        assert_eq!(decoded.num_frames(), 22_050);
    }

    #[test]
    fn process_audio_removes_the_cuts_before_anything_else() {
        let dir = tempfile::tempdir().unwrap();
        let input = write_wav(&dir, "in.wav", 44_100, 1);
        let output = dir.path().join("out.wav").to_str().unwrap().to_string();
        let mut opts = base_opts(input, output.clone());
        opts.cuts = vec![(0.0, 0.25), (0.5, 0.75)];

        process(&opts).unwrap();
        assert_eq!(audio::decode(&output).unwrap().num_frames(), 22_050);
    }

    #[test]
    fn process_audio_refuses_cuts_that_leave_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let input = write_wav(&dir, "in.wav", 4410, 1);
        let output = dir.path().join("out.wav").to_str().unwrap().to_string();
        let mut opts = base_opts(input, output);
        opts.cuts = vec![(0.0, 5.0)];

        assert_eq!(code_of(process(&opts).unwrap_err()), "trim_empty");
    }

    #[test]
    fn process_audio_trims_with_only_an_end_bound() {
        let dir = tempfile::tempdir().unwrap();
        let input = write_wav(&dir, "in.wav", 44_100, 1);
        let output = dir.path().join("out.wav").to_str().unwrap().to_string();
        let mut opts = base_opts(input, output.clone());
        opts.trim_end = Some(0.25);

        process(&opts).unwrap();
        let decoded = audio::decode(&output).unwrap();
        assert_eq!(decoded.num_frames(), 11_025);
    }

    #[test]
    fn process_audio_rejects_an_unknown_format_before_doing_any_work() {
        let dir = tempfile::tempdir().unwrap();
        // The input does not even exist: the format is checked first.
        let output = dir.path().join("out.xyz").to_str().unwrap().to_string();
        let mut opts = base_opts("/nonexistent-dir-lcs/x.wav".into(), output);
        opts.format = "xyz".into();
        assert_eq!(code_of(process(&opts).unwrap_err()), "unknown_format");
    }

    #[test]
    fn process_audio_reports_an_invalid_filter_spec() {
        let dir = tempfile::tempdir().unwrap();
        let input = write_wav(&dir, "in.wav", 1000, 1);
        let output = dir.path().join("out.wav").to_str().unwrap().to_string();
        let mut opts = base_opts(input, output);
        opts.filters = vec!["notch:100".into()];
        assert_eq!(code_of(process(&opts).unwrap_err()), "filter_spec");
    }

    #[test]
    fn process_audio_reports_an_invalid_trim_range() {
        let dir = tempfile::tempdir().unwrap();
        let input = write_wav(&dir, "in.wav", 4410, 1);
        let output = dir.path().join("out.wav").to_str().unwrap().to_string();
        let mut opts = base_opts(input, output);
        opts.trim_start = Some(0.05);
        opts.trim_end = Some(5.0);
        assert_eq!(code_of(process(&opts).unwrap_err()), "trim_range");
    }

    #[test]
    fn process_audio_reports_a_missing_input() {
        let dir = tempfile::tempdir().unwrap();
        let output = dir.path().join("out.wav").to_str().unwrap().to_string();
        let opts = base_opts("/nonexistent-dir-lcs/x.wav".into(), output);
        assert_eq!(code_of(process(&opts).unwrap_err()), "cannot_open");
    }

    #[test]
    fn process_audio_ignores_a_neutral_speed_factor() {
        let dir = tempfile::tempdir().unwrap();
        let input = write_wav(&dir, "in.wav", 4410, 1);
        let output = dir.path().join("out.wav").to_str().unwrap().to_string();
        let mut opts = base_opts(input, output.clone());
        opts.speed = Some(1.0);

        process(&opts).unwrap();
        assert_eq!(audio::decode(&output).unwrap().num_frames(), 4410);
    }

    #[test]
    fn overwriting_the_source_file_works_and_goes_through_a_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let input = write_wav(&dir, "in.wav", 4410, 1);
        let mut opts = base_opts(input.clone(), input.clone());
        opts.trim_end = Some(0.05);

        process(&opts).unwrap();

        assert_eq!(audio::decode(&input).unwrap().num_frames(), 2205);
    }

    #[test]
    fn a_failing_export_leaves_the_existing_output_intact() {
        let dir = tempfile::tempdir().unwrap();
        let input = write_wav(&dir, "in.wav", 4410, 1);
        let output = dir.path().join("out.wav").to_str().unwrap().to_string();
        std::fs::write(&output, b"precious").unwrap();
        let mut opts = base_opts(input, output.clone());
        opts.filters = vec!["lowpass:99999".into()];

        assert!(process(&opts).is_err());

        assert_eq!(std::fs::read(&output).unwrap(), b"precious");
    }

    #[test]
    fn waveform_single_point_is_the_global_peak() {
        let mut buf = buf_of(500, 1);
        buf.samples[0][250] = -0.75;
        let wave = compute_waveform(&buf, 1);
        assert_eq!(wave.len(), 1);
        assert!((wave[0] - 0.75).abs() < 1e-6);
    }

    // ── command line ────────────────────────────────────────────────────

    #[test]
    fn load_audio_returns_info_and_waveform_in_one_call() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_wav(&dir, "in.wav", 4410, 2);
        let info = load_audio_blocking(&DecodeCache::default(), &path, 100).unwrap();
        assert_eq!(info.channels, 2);
        assert_eq!(info.sample_rate, 44100);
        assert!((info.duration - 0.1).abs() < 1e-6);
        assert_eq!(info.waveform.len(), 100);
    }

    #[test]
    fn load_audio_survives_a_file_shorter_than_the_point_count() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_wav(&dir, "tiny.wav", 100, 1);
        let info = load_audio_blocking(&DecodeCache::default(), &path, 900).unwrap();
        assert_eq!(info.waveform.len(), 100);
    }

    #[test]
    fn load_audio_reports_a_missing_file_as_an_error() {
        let err = load_audio_blocking(&DecodeCache::default(), "/nonexistent-dir-lcs/x.wav", 900)
            .unwrap_err();
        assert_eq!(code_of(err), "cannot_open");
    }

    // ── decode cache ────────────────────────────────────────────────────

    #[test]
    fn editing_the_working_copy_never_touches_the_cache() {
        let dir = tempfile::tempdir().unwrap();
        let input = write_wav(&dir, "in.wav", 4410, 1);
        let output = dir.path().join("out.wav").to_str().unwrap().to_string();
        let cache = DecodeCache::default();
        let mut opts = base_opts(input.clone(), output);
        opts.trim_end = Some(0.05);

        process_blocking(&cache, &opts, &Job::detached()).unwrap();

        assert_eq!(cache.get_or_decode(&input).unwrap().num_frames(), 4410);
    }

    // ── approved paths and the asset protocol scope ─────────────────────

    #[test]
    fn a_cancelled_export_writes_nothing_and_reports_it() {
        let dir = tempfile::tempdir().unwrap();
        let input = write_wav(&dir, "in.wav", 4410, 1);
        let output = dir.path().join("out.wav").to_str().unwrap().to_string();
        let flag = Arc::new(AtomicBool::new(false));
        let job = Job::new(flag.clone(), |_| {});
        flag.store(true, AtomicOrdering::Relaxed);

        let err = process_blocking(
            &DecodeCache::default(),
            &base_opts(input, output.clone()),
            &job,
        )
        .unwrap_err();

        assert_eq!(code_of(err), "cancelled");
        assert!(!std::path::Path::new(&output).exists());
    }

    #[test]
    fn an_export_reports_progress_from_start_to_finish() {
        let dir = tempfile::tempdir().unwrap();
        let input = write_wav(&dir, "in.wav", 200_000, 1);
        let output = dir.path().join("out.wav").to_str().unwrap().to_string();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let job = Job::new(Arc::new(AtomicBool::new(false)), move |f| {
            sink.lock().unwrap().push(f)
        });
        let mut opts = base_opts(input, output);
        opts.speed = Some(1.5);

        process_blocking(&DecodeCache::default(), &opts, &job).unwrap();

        let seen = seen.lock().unwrap();
        assert!(seen.windows(2).all(|w| w[0] <= w[1]), "{seen:?}");
        assert_eq!(*seen.last().unwrap(), 1.0);
    }
}
