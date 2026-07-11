# King Pong Linux WebKitGTK source

This folder builds the compact Linux editions of King Pong v1.1.0.

- The Debian package uses the distribution-provided WebKitGTK runtime.
- The thin AppImage uses the same host WebKitGTK/Python GI dependencies; it is
  much smaller than a fully self-contained Chromium AppImage, but it is not a
  universal dependency-free AppImage.
- The packaged game is the exact Windows-derived `assets/index.html`.
- Only one pixel-identical 256x256 icon source is stored. The build creates real menu-visible icon files using hard links, avoiding the Cinnamon symlink regression without duplicating compressed payload data.

## Build the Debian package

```sh
sudo apt install dpkg-dev
./build-deb.sh
```

Output: `dist/King-Pong-Linux-v1.1.0-all.deb`

## Build the thin AppImage

Install or download `appimagetool`, then run:

```sh
APPIMAGETOOL=/path/to/appimagetool ./build-appimage.sh
```

Output: `dist/King-Pong-Linux-v1.1.0-thin-x86_64.AppImage`

## Runtime dependencies

The target system needs:

- Python 3
- Python GObject (`python3-gi`)
- GTK 3 introspection
- WebKitGTK 4.1 or 4.0 introspection

On Linux Mint 22 / Ubuntu 24.04, the `.deb` declares these dependencies so APT
installs them automatically. The thin AppImage cannot install dependencies.

## Controls and diagnostics

- `F11`: toggle fullscreen
- `Ctrl+Q`: quit
- `king-pong --diagnose`: show launcher/runtime diagnostics
- `king-pong --safe-renderer`: use the compatibility renderer
