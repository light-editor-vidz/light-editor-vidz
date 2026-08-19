# LightEditorVidz

Compose scenes on a canvas with text, images, video, audio and shapes, animate them, and export a real `.mp4` — all locally, no cloud, no watermark.

![CI](https://github.com/light-editor-vidz/light-editor-vidz/actions/workflows/ci.yml/badge.svg) ![license](https://img.shields.io/badge/license-MIT-blue) ![platforms](https://img.shields.io/badge/platforms-Linux%20%7C%20macOS-lightgrey)

**Website** — <https://light-editor-vidz.github.io/light-editor-vidz/>

---

## Features

- **Multi-scene timeline** with a real playback clock, not a fixed-interval hack
- **Five element types** — text, image, video, audio and shapes — all drag/resize/rotate through one shared interaction component
- **Composable animations** — fade, slide, zoom, rotate, blur, bounce… that stack instead of overwriting each other, plus composition transitions and Ken Burns pans
- **Editing** — undo/redo, duplicate, split, delete, and an import path for the legacy JSON project format
- **Real mp4 export** — frames are rasterized natively and piped to `ffmpeg` with audio mixed in; not a DOM/CSS replay
- **Signed auto-update** — checks GitHub Releases, downloads, installs and relaunches
- **Bilingual** — English and French UI

---

## Install

One command, identical on macOS and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/light-editor-vidz/light-editor-vidz/main/install.sh | bash
```

| Platform                    | What it installs                                                    |
| --------------------------- | ------------------------------------------------------------------- |
| macOS                       | Homebrew cask `light-editor-vidz/tap/light-editor-vidz`             |
| Linux — Debian / Ubuntu     | `.deb` package                                                      |
| Linux — other distributions | `.AppImage` in `~/.local/bin`, registered in your applications menu |

Re-run the exact same command to upgrade to the latest release.

> The macOS build is a universal binary (Apple Silicon and Intel).

### Manual install

**macOS — Homebrew**

```bash
brew install --cask light-editor-vidz/tap/light-editor-vidz
```

**Linux — Debian / Ubuntu**

Download the `.deb` from the [latest release](https://github.com/light-editor-vidz/light-editor-vidz/releases/latest), then:

```bash
sudo apt install ./light-editor-vidz_*_amd64.deb
```

**Linux — other distributions**

Download the `.AppImage` from the [latest release](https://github.com/light-editor-vidz/light-editor-vidz/releases/latest), then:

```bash
chmod +x light-editor-vidz_*_amd64.AppImage
./light-editor-vidz_*_amd64.AppImage
```

---

## Requirements

- [`ffmpeg`](https://ffmpeg.org) is a **required runtime dependency** — it encodes exports and decodes video frames, and is not bundled inside the app.
  - On macOS the Homebrew cask pulls it in automatically.
  - On Linux the one-line installer installs it via your system package manager if missing.
  - You can point the app at a specific binary with `LIGHT_EDITOR_VIDZ_FFMPEG`.

---

## Uninstall

**macOS — Homebrew**

```bash
brew uninstall --cask light-editor-vidz
brew untap light-editor-vidz/tap
```

Add `--zap` to also remove settings, caches and application data:

```bash
brew uninstall --zap --cask light-editor-vidz
```

**Linux — Debian / Ubuntu**

```bash
sudo apt remove light-editor-vidz
```

**Linux — AppImage**

```bash
rm ~/.local/bin/light-editor-vidz.AppImage
rm ~/.local/share/applications/light-editor-vidz.desktop
rm ~/.local/share/icons/hicolor/512x512/apps/light-editor-vidz.png
update-desktop-database ~/.local/share/applications
```

---

## Development

### Prerequisites

- [Rust](https://rustup.rs) stable
- [Node.js](https://nodejs.org) 20+
- `ffmpeg` / `ffprobe` on your `PATH`
- The [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS

### Setup

```bash
git clone https://github.com/light-editor-vidz/light-editor-vidz.git
cd light-editor-vidz
npm install
```

### Run in dev mode

```bash
npm run tauri dev
```

### Scripts

| Command                                                 | What it does                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| `npm run tauri dev`                                     | Run the app in dev mode with hot reload                         |
| `npm run gen:types`                                     | Regenerate TS bindings from the Rust model (`scene-core`)       |
| `npm run lint`                                          | ESLint over the frontend                                        |
| `npm run format:check`                                  | Prettier check                                                  |
| `npm run test`                                          | Vitest unit tests (`src/lib/*.ts`)                              |
| `cargo test --workspace`                                | Rust unit + integration tests (includes a real mp4 export test) |
| `cargo clippy --workspace --all-targets -- -D warnings` | Rust lints                                                      |
| `cargo fmt`                                             | Format Rust code                                                |
| `npm run tauri build`                                   | Produce release bundles (deb/AppImage on Linux, .app on macOS)  |

---

## Project structure

```
crates/scene-core/   Rust: data model, animation/timeline resolution, frame rasterizer (export)
src-tauri/           Tauri app: commands (project I/O, assets, export), ffmpeg orchestration
src/                 React frontend: editor UI, i18n, pure logic in src/lib/*.ts
docs/                GitHub Pages landing site
install.sh           one-line installer (Homebrew on macOS, deb/AppImage on Linux)
```

A project is a `.lvproj/` folder (`project.json` plus an `assets/` subfolder for imported media) —
portable, no database.

---

## Known limitations

- Video export renders each `VideoElement` from frames pre-extracted by `ffmpeg`; very long source videos take a moment to extract on first use in an export.
- Blur is applied to text but not yet to shapes/images at export time.
- `ffmpeg` must be installed and reachable (via `PATH` or `LIGHT_EDITOR_VIDZ_FFMPEG`) — it is not bundled as a sidecar binary.

---

## License

MIT — see [LICENSE](LICENSE).
