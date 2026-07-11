#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUILD_DIR="$ROOT_DIR/build-appimage"
APPDIR="$BUILD_DIR/KingPong.AppDir"
OUTPUT_DIR="$ROOT_DIR/dist"
OUTPUT_FILE="$OUTPUT_DIR/King-Pong-Linux-v1.1.0-thin-x86_64.AppImage"
APPIMAGETOOL=${APPIMAGETOOL:-appimagetool}
RUNTIME_FILE=${RUNTIME_FILE:-}

if ! command -v "$APPIMAGETOOL" >/dev/null 2>&1 && [ ! -x "$APPIMAGETOOL" ]; then
  echo "Error: appimagetool was not found. Set APPIMAGETOOL=/path/to/appimagetool." >&2
  exit 1
fi

rm -rf "$BUILD_DIR"
mkdir -p \
  "$APPDIR/usr/bin" \
  "$APPDIR/usr/lib/king-pong" \
  "$APPDIR/usr/share/king-pong" \
  "$APPDIR/usr/share/applications" \
  "$APPDIR/usr/share/icons/hicolor/256x256/apps" \
  "$APPDIR/usr/share/pixmaps" \
  "$OUTPUT_DIR"

install -m 0755 "$ROOT_DIR/src/king-pong" "$APPDIR/usr/bin/king-pong"
install -m 0755 "$ROOT_DIR/src/king-pong.py" "$APPDIR/usr/lib/king-pong/king-pong.py"
install -m 0644 "$ROOT_DIR/assets/index.html" "$APPDIR/usr/share/king-pong/index.html"
install -m 0644 "$ROOT_DIR/assets/king-pong.png" "$APPDIR/king-pong.png"
ln "$APPDIR/king-pong.png" "$APPDIR/usr/share/pixmaps/king-pong.png"
ln "$APPDIR/king-pong.png" "$APPDIR/usr/share/icons/hicolor/256x256/apps/king-pong.png"
install -m 0644 "$ROOT_DIR/src/com.kingalexgilbert.KingPong.appimage.desktop" \
  "$APPDIR/com.kingalexgilbert.KingPong.desktop"
ln "$APPDIR/com.kingalexgilbert.KingPong.desktop" \
  "$APPDIR/usr/share/applications/com.kingalexgilbert.KingPong.desktop"

cat > "$APPDIR/AppRun" <<'RUN'
#!/bin/sh
set -eu
APPDIR=${APPDIR:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)}
export KING_PONG_LAUNCHER="$APPDIR/usr/lib/king-pong/king-pong.py"
export KING_PONG_GAME_PATH="$APPDIR/usr/share/king-pong/index.html"
export KING_PONG_ICON_PATH="$APPDIR/king-pong.png"
exec "$APPDIR/usr/bin/king-pong" "$@"
RUN
chmod 0755 "$APPDIR/AppRun"

if [ -n "$RUNTIME_FILE" ]; then
  ARCH=x86_64 "$APPIMAGETOOL" --no-appstream --runtime-file "$RUNTIME_FILE" "$APPDIR" "$OUTPUT_FILE"
else
  ARCH=x86_64 "$APPIMAGETOOL" --no-appstream "$APPDIR" "$OUTPUT_FILE"
fi
chmod 0755 "$OUTPUT_FILE"
sha256sum "$OUTPUT_FILE" > "$OUTPUT_FILE.sha256"
printf '\nBuilt:\n  %s\n  %s\n' "$OUTPUT_FILE" "$OUTPUT_FILE.sha256"
