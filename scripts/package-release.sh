#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
ZIP="$DIST/karakeep-swift.zip"

mkdir -p "$DIST"
rm -f "$ZIP"

cd "$ROOT"
zip -r "$ZIP" \
  manifest.json \
  background.js \
  utils.js \
  popup.html \
  popup.js \
  options.html \
  options.js \
  styles.css \
  README.md \
  icons/icon.png \
  icons/icon.svg

printf 'Created %s\n' "$ZIP"
