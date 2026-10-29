# King Pong for Linux

The Linux version runs the same game as the browser and Windows versions, using Python, GTK and WebKitGTK to open it in a desktop window.

This folder builds two packages:

- A `.deb` for Debian-based systems such as Ubuntu and Linux Mint.
- A thin AppImage. It is smaller because it uses GTK and WebKitGTK already installed on the computer.

Build from a Linux folder, not directly from a ZIP or a Windows-mounted drive. Run the commands below from `Linux/`.

## Build the Debian Package

Install the packaging tool and run the script:

```sh
sudo apt install dpkg-dev
./build-deb.sh
```

The package will be in `dist/`.

## Build the AppImage

Download `appimagetool` and point the script to it:

```sh
APPIMAGETOOL=/path/to/appimagetool ./build-appimage.sh
```

The AppImage will also be in `dist/`. Unlike the `.deb`, it cannot install missing system libraries for you.

## What the Game Needs

The Linux launcher uses Python 3, Python GObject (`python3-gi`), GTK 3 and WebKitGTK 4.1 or 4.0. UPower provides battery information.

For example, on Ubuntu 24.04 or Linux Mint 22:

```sh
sudo apt install python3 python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 upower
```

The `.deb` lists the required packages so the package manager can install them. The AppImage needs these packages on the computer already.

## Controls and Troubleshooting

- `F11` toggles fullscreen.
- `Ctrl+Q` closes King Pong.
- `king-pong --diagnose` prints launcher information.
- `king-pong --safe-renderer` starts the compatibility renderer.

The battery indicator gets updates from UPower. It shows the computer's battery when one is available, without constantly polling for changes. It hides when no battery is present.

The launcher is in `src/king-pong.py`, and the game page is `assets/index.html`. Shared gameplay changes belong in [`../game/`](../game/README.md), not directly in the generated game page.

From the repository root, you can run the shared tests with:

```sh
node tools/test.mjs core
```

Battery and window behavior should still be checked on a real Linux computer before distributing a new build.
