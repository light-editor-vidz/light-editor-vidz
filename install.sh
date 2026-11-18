#!/usr/bin/env bash
# LightEditorVidz — one-line installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/light-editor-vidz/light-editor-vidz/main/install.sh | bash
#
#   macOS         → Homebrew cask (light-editor-vidz/tap/light-editor-vidz)
#   Linux + apt   → .deb package
#   Linux (other) → .AppImage in ~/.local/bin, registered in the applications menu
#
# Re-run the same command to upgrade an existing install.
set -euo pipefail

REPO="light-editor-vidz/light-editor-vidz"
TAP="light-editor-vidz/tap"
CASK="light-editor-vidz"
APP_NAME="LightEditorVidz"
APP_SLUG="light-editor-vidz"
APP_COMMENT="Scene-based video editor"
CATEGORIES="AudioVideo;Video;"
ICON_URL="https://raw.githubusercontent.com/$REPO/main/src-tauri/icons/icon.png"
ICON_SIZE="512x512"
RUNTIME_DEPS=""

log() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# Everything downloaded goes into one private directory, removed however the script ends.
WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# sha256_of <file>
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else die "sha256sum or shasum is required to verify the download"
  fi
}

# verify <file> <asset-url> — the file must match the line of SHA256SUMS published next to the asset
# in the same release. A missing or different checksum stops the installation: the package is
# installed with root rights (deb) or run by the user (AppImage).
verify() {
  sums_url="${2%/*}/SHA256SUMS"
  fetch "$sums_url" "$WORK/SHA256SUMS" || die "Cannot download $sums_url — refusing to install an unverified file."
  name="$(basename "$2")"
  expected="$(awk -v n="$name" '{ f=$2; sub(/^\*/, "", f); if (f == n) { print $1; exit } }' "$WORK/SHA256SUMS")"
  [ -n "$expected" ] || die "$name is not listed in SHA256SUMS — refusing to install it."
  actual="$(sha256_of "$1")"
  [ "$actual" = "$expected" ] || die "Checksum mismatch for $name (expected $expected, got $actual)."
  log "Checksum verified."
}

# fetch <url> [output] — writes to <output>, or to stdout when omitted
fetch() {
  if command -v curl >/dev/null 2>&1; then
    if [ $# -ge 2 ]; then curl -fsSL "$1" -o "$2"; else curl -fsSL "$1"; fi
  elif command -v wget >/dev/null 2>&1; then
    if [ $# -ge 2 ]; then wget -qO "$2" "$1"; else wget -qO- "$1"; fi
  else
    die "curl or wget is required"
  fi
}

# latest_asset <extension> <arch-regex> — download URL of the first asset of the latest release
# with that extension whose name matches the CPU architecture (the release ships x86_64 and arm64).
latest_asset() {
  json="$WORK/release.json"
  fetch "https://api.github.com/repos/$REPO/releases/latest" "$json" || return 0
  if command -v jq >/dev/null 2>&1; then
    jq -r '.assets[].browser_download_url' "$json"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; [print(a["browser_download_url"]) for a in json.load(open(sys.argv[1])).get("assets", [])]' "$json"
  else
    # Last resort: the API pretty-prints one key per line.
    grep -o '"browser_download_url": *"[^"]*"' "$json" | sed 's/.*"\(https[^"]*\)"/\1/'
  fi | grep -E "\\.$1\$" | grep -E "$2" | head -1 || true
}

# The Linux installers are built for amd64 and arm64 only.
case "$(uname -m)" in
  x86_64|amd64) LINUX_ARCH="amd64|x86_64" ;;
  aarch64|arm64) LINUX_ARCH="arm64|aarch64" ;;
  *) LINUX_ARCH="" ;;
esac

install_runtime_deps() {
  [ -n "$RUNTIME_DEPS" ] || return 0
  missing=""
  for dep in $RUNTIME_DEPS; do
    command -v "$dep" >/dev/null 2>&1 || missing="$missing $dep"
  done
  [ -n "$missing" ] || return 0
  log "Installing runtime dependencies:$missing"
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y $missing
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y $missing
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --noconfirm $missing
  elif command -v zypper >/dev/null 2>&1; then
    sudo zypper install -y $missing
  else
    log "No supported package manager found — install these manually:$missing"
  fi
}

install_macos() {
  [ "$(uname -m)" = "arm64" ] || die "LightEditorVidz for macOS requires Apple Silicon (arm64)."
  command -v brew >/dev/null 2>&1 \
    || die "Homebrew is required on macOS. Install it from https://brew.sh"
  brew tap "$TAP"
  if brew list --cask "$CASK" >/dev/null 2>&1; then
    log "Upgrading $APP_NAME via Homebrew…"
    brew upgrade --cask "$TAP/$CASK"
  else
    log "Installing $APP_NAME via Homebrew…"
    brew install --cask "$TAP/$CASK"
  fi
  log "Done. Launch $APP_NAME from Spotlight or your Applications folder."
}

install_deb() {
  url="$(latest_asset deb "_($LINUX_ARCH)\\.deb")"
  [ -n "$url" ] || die "No .deb in the latest release — see https://github.com/$REPO/releases"
  tmp="$WORK/$(basename "$url")"
  log "Downloading $(basename "$url")…"
  fetch "$url" "$tmp"
  verify "$tmp" "$url"
  log "Installing the .deb package (sudo required)…"
  sudo apt-get install -y "$tmp"
  log "Done. Launch $APP_NAME from your applications menu."
}

install_appimage() {
  url="$(latest_asset AppImage "_($LINUX_ARCH)\\.AppImage")"
  [ -n "$url" ] || die "No .AppImage in the latest release — see https://github.com/$REPO/releases"

  bin_dir="$HOME/.local/bin"
  desktop_dir="$HOME/.local/share/applications"
  icon_dir="$HOME/.local/share/icons/hicolor/$ICON_SIZE/apps"
  mkdir -p "$bin_dir" "$desktop_dir" "$icon_dir"

  target="$bin_dir/$APP_SLUG.AppImage"
  log "Downloading $(basename "$url")…"
  # Into the work directory first: an interrupted download never replaces a working install, and
  # `mv` swaps the file even while the application is running (no "text file busy").
  download="$WORK/$(basename "$url")"
  fetch "$url" "$download"
  verify "$download" "$url"
  chmod +x "$download"
  mv -f "$download" "$target"

  fetch "$ICON_URL" "$icon_dir/$APP_SLUG.png" 2>/dev/null || true

  cat > "$desktop_dir/$APP_SLUG.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=$APP_NAME
Comment=$APP_COMMENT
Exec=$target
Icon=$APP_SLUG
Terminal=false
Categories=$CATEGORIES
StartupWMClass=$APP_SLUG
EOF

  update-desktop-database "$desktop_dir" 2>/dev/null || true

  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *) log "Note: $bin_dir is not in your PATH — add it to your shell profile to launch from a terminal." ;;
  esac
  log "Done. Installed to $target — launch $APP_NAME from your applications menu."
}

main() {
echo "$APP_NAME installer"

case "$(uname -s)" in
  Darwin)
    install_macos
    ;;
  Linux)
    [ -n "$LINUX_ARCH" ] || die "Unsupported CPU architecture: $(uname -m) (amd64 and arm64 only)."
    install_runtime_deps
    if command -v apt-get >/dev/null 2>&1; then
      install_deb
    else
      install_appimage
    fi
    ;;
  *)
    die "Unsupported platform: $(uname -s). Download manually from https://github.com/$REPO/releases"
    ;;
esac
}

# Called last: a truncated download (curl | bash) never runs a half-read script.
main "$@"
