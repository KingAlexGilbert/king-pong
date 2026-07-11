#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUILD_DIR="$ROOT_DIR/build"
PKG_DIR="$BUILD_DIR/king-pong"
OUTPUT_DIR="$ROOT_DIR/dist"
VERSION=$(awk '/^Version:/ {print $2}' "$ROOT_DIR/debian/control")
OUTPUT_FILE="$OUTPUT_DIR/King-Pong-Linux-v${VERSION%-*}-all.deb"

rm -rf "$BUILD_DIR"
mkdir -p \
  "$PKG_DIR/DEBIAN" \
  "$PKG_DIR/usr/bin" \
  "$PKG_DIR/usr/lib/king-pong" \
  "$PKG_DIR/usr/share/king-pong" \
  "$PKG_DIR/usr/share/applications" \
  "$PKG_DIR/usr/share/icons/hicolor/256x256/apps" \
  "$PKG_DIR/usr/share/pixmaps" \
  "$PKG_DIR/usr/share/doc/king-pong" \
  "$OUTPUT_DIR"

install -m 0644 "$ROOT_DIR/debian/control" "$PKG_DIR/DEBIAN/control"
install -m 0755 "$ROOT_DIR/debian/postinst" "$PKG_DIR/DEBIAN/postinst"
install -m 0755 "$ROOT_DIR/debian/postrm" "$PKG_DIR/DEBIAN/postrm"
install -m 0755 "$ROOT_DIR/src/king-pong" "$PKG_DIR/usr/bin/king-pong"
install -m 0755 "$ROOT_DIR/src/king-pong.py" "$PKG_DIR/usr/lib/king-pong/king-pong.py"
install -m 0644 "$ROOT_DIR/src/com.kingalexgilbert.KingPong.desktop" \
  "$PKG_DIR/usr/share/applications/com.kingalexgilbert.KingPong.desktop"
install -m 0644 "$ROOT_DIR/assets/index.html" "$PKG_DIR/usr/share/king-pong/index.html"

# Install a real pixmaps icon because Cinnamon reliably honors the absolute
# desktop-entry path. Use a hard link for the hicolor theme copy so the package
# stays compact without relying on a menu-breaking symbolic link.
install -m 0644 "$ROOT_DIR/assets/king-pong.png" \
  "$PKG_DIR/usr/share/pixmaps/king-pong.png"
ln "$PKG_DIR/usr/share/pixmaps/king-pong.png" \
  "$PKG_DIR/usr/share/icons/hicolor/256x256/apps/king-pong.png"

cat > "$PKG_DIR/usr/share/doc/king-pong/README.Debian" <<'DOC'
King Pong for Debian/Ubuntu/Linux Mint
======================================

This compact package uses the system WebKitGTK runtime rather than bundling a
complete browser. GPU rendering and the original high-DPI game canvas remain
enabled. F11 toggles fullscreen, Ctrl+Q exits, --safe-renderer enables the
compatibility renderer, and --diagnose prints startup diagnostics.
DOC

find "$PKG_DIR" -type d -exec chmod 0755 {} +

command -v dpkg-deb >/dev/null 2>&1 || {
  echo "Error: dpkg-deb is required. Install dpkg-dev." >&2
  exit 1
}

dpkg-deb --root-owner-group -Zxz -z9 --build "$PKG_DIR" "$OUTPUT_FILE"
sha256sum "$OUTPUT_FILE" > "$OUTPUT_FILE.sha256"
printf '\nBuilt:\n  %s\n  %s\n' "$OUTPUT_FILE" "$OUTPUT_FILE.sha256"
