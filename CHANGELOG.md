# Changelog

All notable changes to LightEditorVidz are listed here, newest first.
The French version is in [CHANGELOG.fr.md](CHANGELOG.fr.md) — keep both in step.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Subtitle generation (from LightGenSubz), available where the media is: in the Video view (Subtitles panel, "Generate from the audio…"), in the Audio view (header button), on a video element or an audio track of a project (properties panel), and for the whole project (top bar or File menu) — the mix of every scene and sound is transcribed as one set. Transcription runs locally (whisper.cpp, models base / small / medium) or through Groq, OpenAI, Deepgram or AssemblyAI; translation runs locally (NLLB-200) or through DeepL, OpenAI, Google Translate or Azure Translator. In a project the result can be added as text elements, saved as an `.srt` / `.vtt` / `.ass` file, or both; in the Video view it can be used directly as the burned-in subtitles.
- A Video button on the home screen opens the video view of LightCutVidz — trim, speed, crop, social formats, rotation, 20 colour filters, burned-in subtitles, stabilisation and export to MP4, MOV, WebM, AVI or GIF with an export queue — in the colours of the editor. File > Open file… opens a video there.
- A video element of a project can have a colour filter and a crop, previewed live and applied at export.
- An Image button on the home screen opens the image view of LightCutImgz — crop, rotate, flip, resize, canvas size, adjustments, filters, object removal, colour picker, EXIF, history and export — in the colours of the editor. File > Open file… opens an image there instead of creating a project.
- Tabs: the home screen, each open project and each open audio file have their own tab.
- An Audio button on the home screen opens the audio view of LightCutSoundz — waveform with cuts, fades, normalisation, speed, filters, live preview, undo / redo and export to WAV, MP3, FLAC, OGG or M4A — in the colours of the editor.
- File > Open file… (Ctrl+O) opens an audio file in an Audio tab; a video or an image creates a new project that holds it. Files can also be dropped on the window. The former "Open project" is now File > Open project folder… (Ctrl+Shift+O).
- Audio tracks: fades can follow a linear or an equal-power curve, the speed goes from 0.25× to 4× (the pitch is kept), and a low-pass, high-pass (12 to 48 dB/octave) or band-pass filter can be applied.
- Audio-only export: the mix of every track and of the sound of your videos, as WAV (16-bit, 24-bit or 32-bit float), MP3, FLAC, OGG Vorbis or M4A.

### Fixed

- Video view: videos now play on Linux, where the webview refuses internal protocols in `<video>`, through a local-only stream; a video it cannot decode is transcoded for the preview.
- Video view: the Generate subtitles button opens its window, Ctrl+Z / Ctrl+Y work again, and opened videos appear in the recent files.
- Subtitle generation uses the ffmpeg shipped with the app instead of requiring a system one; it can be cancelled while a project is being mixed, and quitting during a run cleans up.
- Subtitle window: closing the save dialog no longer adds the subtitles twice, the Audio view can save its result, the Azure region can be entered, a stored API key can be forgotten, and errors without a code are readable.
- Image view: copy to clipboard works again, and the grid size is back (Edit menu).
- Video export window no longer waits forever for a job that ends immediately.

### Changed

- The Linux `.deb` installs `gstreamer1.0-libav`, so H.264 and AAC can be previewed without installing anything else.
- The text of generated subtitles can be corrected right after generation and, in the Video view, while they are in use.
- A media file given on the command line opens in its tab; a second launch hands it to the open window.
- The vignette colour filter of a video element is now previewed in the editor.
- Errors of the subtitle engine (no audio, missing API key, network, …) are translated.
- The Video view retries with a transcoded preview when the system cannot decode a video it first thought playable.
- ffmpeg and ffprobe now ship inside the app: nothing to install, on any platform.
- Releases are built for Linux x86_64, Linux arm64 and macOS Apple Silicon (Intel Macs are no longer supported).

## [1.0.2] - 2026-11-02

### Changed

- The update bar looks the same in every app: same height, same wording, same order of buttons.

## [1.0.1] - 2026-11-02

### Changed

- Dependencies updated to their latest compatible versions.
- The keyboard focus ring is gone everywhere (buttons, fields, menus, sliders, checkboxes).

## [1.0.0] - 2026-10-30

### Added

- First stable release. The README lists everything LightEditorVidz does.
