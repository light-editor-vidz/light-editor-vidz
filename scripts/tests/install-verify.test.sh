#!/usr/bin/env bash
# Checks install.sh's checksum verification without any network: `fetch` is replaced by a stub that
# serves a local SHA256SUMS. Run: bash scripts/tests/install-verify.test.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

# install.sh without its final `main "$@"` call, so the functions can be used on their own.
sed '$d' "$here/install.sh" | sed '$d' > "$tmp/lib.sh"
# shellcheck disable=SC1091
source "$tmp/lib.sh"

printf 'package-bytes' > "$tmp/pkg.deb"
good="$(sha256_of "$tmp/pkg.deb")"
fetch() { cp "$tmp/served-sums" "$2"; }

printf '%s  pkg.deb\n' "$good" > "$tmp/served-sums"
( verify "$tmp/pkg.deb" "https://example.test/dl/pkg.deb" ) >/dev/null || { echo "FAIL: a matching checksum was refused"; exit 1; }

printf '%s  pkg.deb\n' "0000" > "$tmp/served-sums"
if ( verify "$tmp/pkg.deb" "https://example.test/dl/pkg.deb" ) >/dev/null 2>&1; then echo "FAIL: a wrong checksum was accepted"; exit 1; fi

printf '%s  other.deb\n' "$good" > "$tmp/served-sums"
if ( verify "$tmp/pkg.deb" "https://example.test/dl/pkg.deb" ) >/dev/null 2>&1; then echo "FAIL: an unlisted file was accepted"; exit 1; fi

echo "install.sh verification: ok"
