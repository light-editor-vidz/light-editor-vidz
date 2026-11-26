//! Volume ressenti de la vue Audio : les deux passes de `loudnorm`, alimentées directement par le
//! tampon (aucun fichier audio intermédiaire).

use crate::audio::{write_pcm, AudioBuffer};
use crate::error::coded;
use crate::job::Job;
use anyhow::{bail, Context, Result};
use scene_core::loudness;
use std::io::Read;
use std::process::{Command, Stdio};

/// Porte `buf` au volume visé (LUFS). Renvoie `false`, sans toucher au son, s'il est trop faible
/// pour être monté.
pub fn normalize_to(buf: &mut AudioBuffer, target: f64, job: &Job) -> Result<bool> {
    let target = loudness::validate_target(target).map_err(anyhow::Error::msg)?;
    if buf.channels() == 0 || buf.num_frames() == 0 {
        return Ok(false);
    }
    let stats = tempfile::Builder::new()
        .prefix("lev_loudness_")
        .suffix(".json")
        .tempfile()
        .context("Cannot measure the loudness")?;
    let measure = loudness::measure_filter(target, &stats.path().to_string_lossy());
    run(buf, &["-af", &measure, "-f", "null", "-"], job, |_| Ok(()))?;
    job.check()?;
    let json = std::fs::read_to_string(stats.path()).context("Cannot read the loudness measure")?;
    let measured = loudness::parse_measure(&json).map_err(anyhow::Error::msg)?;
    let Some(filter) = loudness::apply_filter(target, &measured, buf.sample_rate) else {
        return Ok(false);
    };
    apply_filter_chain(buf, &filter, job)?;
    Ok(true)
}

/// Passe `buf` dans une chaîne de filtres ffmpeg qui garde sa fréquence et ses canaux.
pub fn apply_filter_chain(buf: &mut AudioBuffer, filter: &str, job: &Job) -> Result<()> {
    if buf.channels() == 0 || buf.num_frames() == 0 {
        return Ok(());
    }
    let channels = buf.channels();
    let frames = buf.num_frames();
    // La chaîne peut changer la fréquence (`loudnorm`) ou les canaux : on les impose en sortie.
    let rate = buf.sample_rate.to_string();
    let count = channels.to_string();
    let filtered = run(
        buf,
        &[
            "-af", filter, "-ar", &rate, "-ac", &count, "-f", "f32le", "pipe:1",
        ],
        job,
        |out| read_pcm(out, channels, frames),
    )?;
    job.check()?;
    buf.samples = filtered;
    Ok(())
}

/// Lit des f32 entrelacés et les range par canal.
fn read_pcm(mut source: impl Read, channels: usize, frames: usize) -> Result<Vec<Vec<f32>>> {
    let mut samples: Vec<Vec<f32>> = (0..channels).map(|_| Vec::with_capacity(frames)).collect();
    let frame = channels * 4;
    let mut chunk = vec![0u8; frame * 4096];
    let mut filled = 0;
    loop {
        let read = source.read(&mut chunk[filled..])?;
        if read == 0 {
            break;
        }
        filled += read;
        let whole = filled - filled % frame;
        for values in chunk[..whole].chunks_exact(frame) {
            for (channel, bytes) in samples.iter_mut().zip(values.as_chunks::<4>().0) {
                channel.push(f32::from_le_bytes(*bytes));
            }
        }
        chunk.copy_within(whole..filled, 0);
        filled -= whole;
    }
    Ok(samples)
}

/// Lance ffmpeg avec `buf` sur son entrée, et confie sa sortie à `consume`.
fn run<T>(
    buf: &AudioBuffer,
    output: &[&str],
    job: &Job,
    consume: impl FnOnce(std::process::ChildStdout) -> Result<T>,
) -> Result<T> {
    let mut child = Command::new(scene_core::ffmpeg_path::ffmpeg_binary())
        .args(["-nostats", "-v", "error", "-f", "f32le", "-ar"])
        .arg(buf.sample_rate.to_string())
        .arg("-ac")
        .arg(buf.channels().to_string())
        .args(["-i", "pipe:0"])
        .args(output)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| coded("ffmpeg_missing", &[], format!("ffmpeg not found ({e})")))?;
    let stdin = child.stdin.take().expect("stdin was piped");
    let stdout = child.stdout.take().expect("stdout was piped");
    let mut stderr = child.stderr.take().expect("stderr was piped");
    let (result, log) = std::thread::scope(|s| {
        // La progression du tampon envoyé ne dit rien de l'export : seule l'annulation compte.
        let quiet = job.slice(0.0, 0.0);
        s.spawn(move || write_pcm(stdin, buf, &quiet));
        let log = s.spawn(move || {
            let mut log = String::new();
            let _ = stderr.read_to_string(&mut log);
            log
        });
        let result = consume(stdout);
        (result, log.join().unwrap_or_default())
    });
    let status = child.wait()?;
    job.check()?;
    if !status.success() {
        bail!("ffmpeg failed: {}", log.trim());
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(amplitude: f32) -> AudioBuffer {
        let wave: Vec<f32> = (0..44_100 * 6)
            .map(|i| amplitude * (i as f32 * 440.0 * std::f32::consts::TAU / 44_100.0).sin())
            .collect();
        AudioBuffer {
            samples: vec![wave.clone(), wave],
            sample_rate: 44_100,
        }
    }

    fn rms(buf: &AudioBuffer) -> f32 {
        let wave = &buf.samples[0];
        (wave.iter().map(|v| v * v).sum::<f32>() / wave.len() as f32).sqrt()
    }

    #[test]
    fn a_quiet_tone_is_raised_and_keeps_its_length_and_rate() {
        let mut buf = tone(0.05);
        let before = rms(&buf);
        assert!(normalize_to(&mut buf, -14.0, &Job::detached()).unwrap());
        assert!(rms(&buf) > before * 2.0, "{} → {}", before, rms(&buf));
        assert_eq!((buf.sample_rate, buf.channels()), (44_100, 2));
        assert!((buf.num_frames() as i64 - 44_100 * 6).abs() < 4_410);
    }

    #[test]
    fn near_silence_is_left_as_it_is() {
        let mut buf = tone(0.0005);
        let before = buf.samples.clone();
        assert!(!normalize_to(&mut buf, -14.0, &Job::detached()).unwrap());
        assert_eq!(buf.samples, before);
    }

    /// Un bruit de fond seul pendant 2 s, puis une « voix » par-dessus pendant 2 s.
    fn noisy_take() -> AudioBuffer {
        let mut seed = 1u32;
        let wave: Vec<f32> = (0..44_100 * 4)
            .map(|i| {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let noise = ((seed >> 8) as f32 / 8_388_608.0 - 1.0) * 0.004;
                let voice = if i < 44_100 * 2 {
                    0.0
                } else {
                    0.3 * (i as f32 * 300.0 * std::f32::consts::TAU / 44_100.0).sin()
                };
                noise + voice
            })
            .collect();
        AudioBuffer {
            samples: vec![wave],
            sample_rate: 44_100,
        }
    }

    fn level(buf: &AudioBuffer, from: usize, to: usize) -> f32 {
        let wave = &buf.samples[0][from..to];
        (wave.iter().map(|v| v * v).sum::<f32>() / wave.len() as f32).sqrt()
    }

    #[test]
    fn voice_cleanup_lowers_the_noise_against_the_voice_and_keeps_the_timing() {
        use scene_core::voice::{VoiceCleanup, VoiceLevel};
        let snr = |buf: &AudioBuffer| level(buf, 110_000, 150_000) / level(buf, 44_100, 80_000);
        for voice_level in [VoiceLevel::Off, VoiceLevel::Medium, VoiceLevel::Strong] {
            let mut buf = noisy_take();
            let before = snr(&buf);
            let chain = VoiceCleanup {
                level: voice_level,
                denoise: true,
                gate: true,
            }
            .filter()
            .unwrap();
            apply_filter_chain(&mut buf, &chain, &Job::detached()).unwrap();
            assert!(
                snr(&buf) > before * 1.5,
                "{voice_level:?}: {before} → {}",
                snr(&buf)
            );
            assert!(
                (buf.num_frames() as i64 - 44_100 * 4).abs() < 512,
                "{voice_level:?}: {}",
                buf.num_frames()
            );
            // La voix commence toujours à 2 s : le filtre ne décale pas le son.
            let onset = buf.samples[0].iter().position(|v| v.abs() > 0.05).unwrap();
            assert!(
                (onset as i64 - 88_200).abs() < 1_500,
                "{voice_level:?}: {onset}"
            );
        }
    }

    #[test]
    fn a_target_out_of_range_is_refused() {
        assert!(normalize_to(&mut tone(0.1), 3.0, &Job::detached()).is_err());
    }

    #[test]
    fn pcm_split_across_reads_is_put_back_together() {
        struct Drip(Vec<u8>, usize);
        impl Read for Drip {
            fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
                let n = 3.min(self.0.len() - self.1).min(out.len());
                out[..n].copy_from_slice(&self.0[self.1..self.1 + n]);
                self.1 += n;
                Ok(n)
            }
        }
        let bytes = [1.0f32, -1.0, 0.5, -0.5]
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        let samples = read_pcm(Drip(bytes, 0), 2, 2).unwrap();
        assert_eq!(samples, vec![vec![1.0, 0.5], vec![-1.0, -0.5]]);
    }
}
