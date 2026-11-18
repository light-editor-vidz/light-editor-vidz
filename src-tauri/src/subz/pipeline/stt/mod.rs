use crate::subz::pipeline::audio_extract::AudioFormat;
use crate::subz::pipeline::segmentation::{self, CueLimits, TimedWord};

pub mod assemblyai;
pub mod deepgram;
pub mod lang;
pub mod local_whisper;
pub mod openai_compatible;

pub use assemblyai::AssemblyAiEngine;
pub use deepgram::DeepgramEngine;
pub use local_whisper::LocalWhisperEngine;
pub use openai_compatible::OpenAiCompatibleWhisperEngine;

#[derive(Debug, Clone, serde::Serialize)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Transcript {
    pub language: String,
    pub segments: Vec<Segment>,
}

pub trait SttEngine {
    /// What the engine reads: a WAV, or audio already compressed for upload.
    fn audio_format(&self) -> AudioFormat {
        AudioFormat::Wav
    }

    fn transcribe(
        &self,
        audio: &std::path::Path,
        on_progress: Box<dyn FnMut(f32) + Send>,
    ) -> anyhow::Result<Transcript>;
}

/// The words with the spelling (punctuation included) of `text`; unchanged when a word cannot be
/// found in order in the text.
fn respell_from_segment(words: Vec<TimedWord>, text: &str) -> Vec<TimedWord> {
    let mut starts = Vec::with_capacity(words.len());
    let mut at = 0;
    for word in &words {
        let needle = word.text.trim();
        match text.get(at..).and_then(|rest| rest.find(needle)) {
            Some(found) if !needle.is_empty() => {
                starts.push(at + found);
                at += found + needle.len();
            }
            _ => return words,
        }
    }
    words
        .into_iter()
        .enumerate()
        .map(|(i, w)| {
            let end = starts.get(i + 1).copied().unwrap_or(text.len());
            TimedWord {
                text: text[starts[i]..end].trim().to_string(),
                ..w
            }
        })
        .collect()
}

/// The cues of one segment: cut on the real time of its words when the engine gave them,
/// otherwise the segment as it is (`build_cues` then splits it in proportion).
pub fn cues_from_words(
    start: f64,
    end: f64,
    text: &str,
    words: Vec<TimedWord>,
    limits: CueLimits,
) -> Vec<Segment> {
    if words.len() > 1 {
        // The words give the times, the segment text gives the spelling: a provider's `words[]`
        // may drop the punctuation the segment text carries. Each word takes the stretch of the
        // segment text from where it starts to where the next word starts.
        let words = respell_from_segment(words, text);
        segmentation::split_timed(&words, limits)
    } else {
        vec![Segment {
            start,
            end,
            text: text.to_string(),
        }]
    }
}
