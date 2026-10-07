# King Pong Linux WebKitGTK source

This folder builds the compact Linux editions of King Pong v2.0.0.

- The Debian package uses the distribution-provided WebKitGTK runtime.
- The thin AppImage uses the same host WebKitGTK/Python GI dependencies; it is
  much smaller than a fully self-contained Chromium AppImage, but it is not a
  universal dependency-free AppImage.
- The packaged game is the Windows-derived `assets/index.html`, with native Linux battery updates.
- Only one pixel-identical 256x256 icon source is stored. The build creates real menu-visible icon files using hard links, avoiding the Cinnamon symlink regression without duplicating compressed payload data.

## Build the Debian package

```sh
sudo apt install dpkg-dev
./build-deb.sh
```

Output: `dist/King-Pong-Linux-v2.0.0-all.deb`

## Build the thin AppImage

Install or download `appimagetool`, then run:

```sh
APPIMAGETOOL=/path/to/appimagetool ./build-appimage.sh
```

Output: `dist/King-Pong-Linux-v2.0.0-thin-x86_64.AppImage`

## Runtime dependencies

The target system needs:

- Python 3
- Python GObject (`python3-gi`)
- GTK 3 introspection
- WebKitGTK 4.1 or 4.0 introspection
- UPower (`upower`) for native battery notifications

On Linux Mint 22 / Ubuntu 24.04, the `.deb` declares these dependencies so APT
installs them automatically. The thin AppImage cannot install dependencies.

## Controls and diagnostics

- `F11`: toggle fullscreen
- `Ctrl+Q`: quit
- `king-pong --diagnose`: show launcher/runtime diagnostics
- `king-pong --safe-renderer`: use the compatibility renderer

## Battery indicator

The top-right indicator receives battery-change notifications from UPower over
D-Bus. It reads the initial state once, then updates when battery percentage,
charging, or presence changes. King Pong does not run a battery polling timer
or background battery thread.

UPower's aggregate display device combines system batteries and supports UPS
power. Peripheral batteries do not replace the computer's battery reading.
The icon hides when no battery is present; unknown or unavailable readings keep
the unavailable indicator. A full battery remains visible. The listener handles
UPower restarts and disconnects when the game closes.

The Debian package declares the `upower` dependency. For the thin AppImage, the
host system must provide UPower as well as the GTK/WebKit dependencies above.
Rebuild the Debian package and AppImage to include the changes.

Repository tests (from the repository root):

```sh
node --test tests/*.mjs
python3 -B -m unittest discover -s tests -p 'test_*.py'
```

The automated Linux battery tests simulate state changes, removal, service
restarts, and shutdown. The broader suite also checks save transfer, shared
desktop HTML, and release-version consistency. Live battery behavior still
needs a check on a Linux laptop.
