# Changelog

All notable changes to LightEditorVidz are listed here, newest first.
The French version is in [CHANGELOG.fr.md](CHANGELOG.fr.md) — keep both in step.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.3.1] - 2026-11-19

### Changed

- Everything in the library is now added to the scene with a double-click (text, shapes, videos, images, sounds, free stock images) instead of a single click.

### Fixed

- A video placed in a sequence no longer flickers when playback starts, and pausing while it was starting no longer leaves it playing.
- A media can be deleted from the library when only the undo history still used it; those undo steps are dropped (the message wrongly asked to remove it from the timeline).

## [1.3.0] - 2026-11-19

### Added

- Editing a media of a project now happens in its own tab: double-click a clip (timeline or canvas), right-click it, use the pencil in the library or the "Edit in a tab" button. The tab takes the clip's settings (trim, speed, crop, filter, fades…) and the export can be saved as a new version of the media in the project (the original stays in the library), applied to one clip or to all clips that use it, in a single undo step.
- Clips that ask for more than their media contains are outlined on the timeline.

### Changed

- The properties panel keeps only the clip settings: the video filter and crop and the audio filter are now set in the media's tab.

## [1.2.2] - 2026-11-19

Fixes from a full code audit.

### Security

- Output and import paths of the project export, the asset import and the image opening now go through the approval of paths; the unused `store:default` permission is removed; stock downloads are limited to the providers' hosts, also after a redirect; the CSP and the media server CORS are tightened.

### Fixed

- Video: exporting over the source file can no longer delete it; the export is written to a temporary file and renamed, and a read error no longer wipes the edit.
- Export: text and shadow transparency, letter spacing, rotated phone videos, EXIF orientation of photos, the blur transition, line-by-line reveal, Ken Burns and invalid colours now match the preview; frame indices no longer stutter; every video is decoded once instead of once per worker.
- Quitting waits for or cancels the running exports, and orphan temporary files are cleaned up at startup; cancelling during the finalisation of a video is honoured.
- Image: decompression bombs are refused, removing the EXIF keeps the orientation and drops the GPS data, resetting a tool no longer replays steps in the wrong frame, the modified state is reliable, and Ctrl+Q asks before quitting.
- Subtitles: a generated subtitle is kept when the chained translation fails, cancellation is no longer lost, POST requests are only retried when safe, and a warning tells when the speech detection was unavailable.
- Several tabs of the Video and Audio views no longer share their preview, cancellation and progress.
- A project opened from its backup is reported; the export queue shows its position.

### Changed

- Image: white balance, blur and resizing work in linear light, and heavy operations are parallelised.
- Audio: the memory used when changing the speed is halved; stabilisation is measured per segment.
- The video sources are no longer loaded in memory when a project opens.
- Release builds use a single codegen unit and stripped symbols; the CI also runs clippy, rustfmt, prettier and the audits, and the GitHub actions are pinned.
- Dependencies updated (imageproc 0.27 and the latest compatible versions of the other npm packages and Rust crates); Dependabot is no longer used.

## [1.2.0] - 2026-11-16

### Added

- Video: a **Split into sequences** button in the right sidebar. The scenes are detected automatically and shown as a row of thumbnails under the whole video. Tick the ones to keep and drag and drop them to reorder; the preview plays the final result (the ticked sequences, in order), and a click on a thumbnail loops that sequence until you press the player's play button or use its seek bar. The sequences you keep are merged into a single video that becomes the one you edit.
- Video: a **Separate the audio track** button in the Audio section of the right sidebar. The sound is saved next to the video (`<name> (audio).m4a`, or FLAC when the codec cannot be copied) and opens in a tab of the Audio view.

### Fixed

- Video: the thumbnails of the timeline were random noise instead of the images of the video; they are now extracted by ffmpeg.
- Home screen: the three tool buttons are centred under the logo.

## [1.1.2] - 2026-11-13

### Changed

- Dependencies updated: i18next 27, react-i18next 18, TypeScript 6.0, and the latest compatible versions of the other npm packages and Rust crates.

## [1.1.1] - 2026-11-12

### Fixed

- The macOS build: whisper.cpp is now built for macOS 11 or later, which version 1.1.0 failed to do, so 1.1.0 was only published for Linux.

## [1.1.0] - 2026-11-12

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
- History panel in the Audio, Video and Image views and in projects: every step is listed with a readable name ("Cut added", "Crop", "Moved: Title"…), and a click goes back — or forward — to any step. Edit > History (Ctrl+Shift+H) or the History button next to Undo / Redo.
- Image view: File > Settings… (Ctrl+Comma) sets the default export format and JPEG quality and clears the recent images.
- Subtitles can be translated after they are generated, from the detected or a chosen language. The original is kept next to the translation in two tabs, each can be corrected and saved on its own, and "Version to use" decides which one is linked to the media or added to the project. A translation asked before generating no longer replaces the original.
- The subtitle window says when a cloud engine receives the audio or the text, and shows the time elapsed and an estimate of the time left while it works.

### Fixed

- Video view: videos now play on Linux, where the webview refuses internal protocols in `<video>`, through a local-only stream; a video it cannot decode is transcoded for the preview.
- Video view: the Generate subtitles button opens its window, Ctrl+Z / Ctrl+Y work again, and opened videos appear in the recent files.
- Subtitle generation uses the ffmpeg shipped with the app instead of requiring a system one; it can be cancelled while a project is being mixed, and quitting during a run cleans up.
- Subtitle window: closing the save dialog no longer adds the subtitles twice, the Audio view can save its result, the Azure region can be entered, a stored API key can be forgotten, and errors without a code are readable.
- Image view: copy to clipboard works again, and the grid size is back (Edit menu).
- Video export window no longer waits forever for a job that ends immediately.
- Image view: dialogs, cards, borders and grey texts were transparent; they have their colours back.
- Cloud subtitle errors (API key refused, quota reached, service unavailable) are translated instead of shown in English.

### Changed

- The Linux `.deb` installs `gstreamer1.0-libav`, so H.264 and AAC can be previewed without installing anything else.
- Exports from the Video, Audio and Image views can be added to one or several projects, and appear in their media library.
- Generated subtitles are linked to their video or sound automatically. In a project they can be switched on when the media is added or from its properties, follow the media when it is moved, trimmed or sped up, and have their own size and position.
- The text of generated subtitles can be corrected right after generation and, in the Video view, while they are in use.
- A media file given on the command line opens in its tab; a second launch hands it to the open window.
- The vignette colour filter of a video element is now previewed in the editor.
- Errors of the subtitle engine (no audio, missing API key, network, …) are translated.
- The Video view retries with a transcoded preview when the system cannot decode a video it first thought playable.
- ffmpeg and ffprobe now ship inside the app: nothing to install, on any platform.
- Releases are built for Linux x86_64, Linux arm64 and macOS Apple Silicon (Intel Macs are no longer supported).
- Exporting from the Video, Audio and Image views: choose "On my computer", "Add to a project", or both. Without the computer, no save dialog opens: the file goes straight to the media library of each chosen project.
- Quitting or restarting for an update while work is running (video export queue, audio, image or project export, subtitle generation) asks first and lists what would stop.
- Linux packages are built on Ubuntu 24.04 and need glibc 2.39 or later (the local translation engine requires it).

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
