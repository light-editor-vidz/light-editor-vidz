# Changelog

All notable changes to LightEditorVidz are listed here, newest first.
The French version is in [CHANGELOG.fr.md](CHANGELOG.fr.md) — keep both in step.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- An Image button on the home screen opens the image view of LightCutImgz — crop, rotate, flip, resize, canvas size, adjustments, filters, object removal, colour picker, EXIF, history and export — in the colours of the editor. File > Open file… opens an image there instead of creating a project.
- Tabs: the home screen, each open project and each open audio file have their own tab.
- An Audio button on the home screen opens the audio view of LightCutSoundz — waveform with cuts, fades, normalisation, speed, filters, live preview, undo / redo and export to WAV, MP3, FLAC, OGG or M4A — in the colours of the editor.
- File > Open file… (Ctrl+O) opens an audio file in an Audio tab; a video or an image creates a new project that holds it. Files can also be dropped on the window. The former "Open project" is now File > Open project folder… (Ctrl+Shift+O).
- Audio tracks: fades can follow a linear or an equal-power curve, the speed goes from 0.25× to 4× (the pitch is kept), and a low-pass, high-pass (12 to 48 dB/octave) or band-pass filter can be applied.
- Audio-only export: the mix of every track and of the sound of your videos, as WAV (16-bit, 24-bit or 32-bit float), MP3, FLAC, OGG Vorbis or M4A.

### Changed

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
