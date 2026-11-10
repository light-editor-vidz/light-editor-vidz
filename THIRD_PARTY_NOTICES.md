# Third-party software

LightEditorVidz itself is released under the [MIT license](LICENSE). The packaged
application also ships the components below, each under its own license.

## FFmpeg (GPL-3.0-or-later)

Video decoding, encoding, filtering and audio mixing are done by FFmpeg, bundled
as two sidecar executables (`ffmpeg` and `ffprobe`) next to the application.

| Platform                  | Build                                                                                                                  | Pinned in `scripts/ffmpeg-sources.json` |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Linux x86_64, Linux arm64 | [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) `autobuild-2026-11-09-12-42`, FFmpeg n8.1.3, `gpl` variant | SHA256 of each archive                  |
| macOS arm64               | [Martin Riedl's static builds](https://ffmpeg.martin-riedl.de), build `N-128220-gbea9d176f7`                           | SHA256 of each binary archive           |

These builds are configured with `--enable-gpl --enable-version3` and include, among
others, libx264, libvidstab, libmp3lame, libvorbis and libopus. **They are therefore
distributed under the GNU General Public License, version 3 or (at your option) any
later version**, not under the MIT license of this project. FFmpeg is run as a separate
process; LightEditorVidz does not link against it.

- License text: <https://www.gnu.org/licenses/gpl-3.0.html>
- Corresponding source code: <https://ffmpeg.org/download.html> (FFmpeg n8.1.3), the
  build scripts of each provider linked above, and the sources of the libraries they
  statically link.
- The binaries are downloaded and checksum-verified at build time by
  `npm run fetch:ffmpeg`; they are not stored in this repository.

If you redistribute LightEditorVidz, you must pass these terms on and make the FFmpeg
source available as above. To avoid the GPL, point the application at an LGPL build of
FFmpeg with `LIGHT_EDITOR_VIDZ_FFMPEG` / `LIGHT_EDITOR_VIDZ_FFPROBE` (the x264 export and
video stabilisation then depend on what that build provides).

## Audio view (ex-LightCutSoundz)

The audio view's engine (`crates/audio-dsp`) is the one of LightCutSoundz, by the same author and
under the same MIT license. It decodes with [Symphonia](https://github.com/pdeljanov/Symphonia)
(MPL-2.0), writes WAV with [hound](https://github.com/ruuda/hound) (Apache-2.0) and resamples with
[rubato](https://github.com/HEnquist/rubato) (MIT). MP3, FLAC, OGG and M4A are encoded by the FFmpeg
above.

## Image view (ex-LightCutImgz)

The image view's engine (`src-tauri/src/imgz`) is the one of LightCutImgz, by the same author and
under the same MIT license. It uses [image](https://github.com/image-rs/image) and
[imageproc](https://github.com/image-rs/imageproc) (MIT), [kamadak-exif](https://github.com/kamadak/exif-rs)
(BSD-2-Clause), [img-parts](https://github.com/paolobarbolini/img-parts) (MIT / Apache-2.0) and
[Tailwind CSS](https://tailwindcss.com) (MIT) for the styling.

## Video view (ex-LightCutVidz)

The video view (`crates/video-export`, `src/components/videotool`) is LightCutVidz rewritten for
Tauri, by the same author and under the same MIT license. Its work is done by the FFmpeg above,
including `vidstab` for stabilisation and `libass` for subtitles.

## Subtitle generation (ex-LightGenSubz)

Subtitle generation (`src-tauri/src/subz`, `src/components/subtitles`) is LightGenSubz ported into
the editor, by the same author and under the same MIT license. It uses:

- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) through `whisper-rs` (MIT, Unlicense) and
  the OpenAI Whisper models converted to ggml (MIT), downloaded on first use;
- the Silero voice-activity model (MIT) in its ggml form;
- [NLLB-200](https://github.com/facebookresearch/fairseq/tree/nllb) distilled 600M, in the ONNX
  conversion by Xenova (CC-BY-NC-4.0 — the model is downloaded by the user for personal, non-commercial
  use and is not redistributed with the app), run with `ort` (MIT / Apache-2.0) and `tokenizers` (Apache-2.0);
- the cloud APIs of Groq, OpenAI, Deepgram, AssemblyAI, DeepL, Google and Microsoft, only when the
  user enters a key and chooses them.
