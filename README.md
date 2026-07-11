# King Pong

King Pong is a retro arcade Pong game featuring an 18-level campaign, custom games, local and LAN multiplayer, different paddle shapes, save slots, multiple languages, and a secret ending.

Play directly in your browser or download King Pong for Windows, Linux, and Android.

The project was developed with AI-assisted coding and packaging help, then manually tested, debugged, and polished to give it that human touch.

Feel free to test it out, play around with it, and modify it. Hope you enjoy it!

Made by: King Alex Gilbert

## Play King Pong

King Pong can now be played directly in your web browser—no installation required.

### Browser Version

[Play King Pong on GitHub Pages](https://kingalexgilbert.github.io/king-pong/demo/)

The browser version supports keyboard, controller, and touch controls. For the best mobile experience, use landscape mode.

Browser save data is stored locally and is separate from the Android, Windows, and Linux versions.

## Gameplay Demo

[![King Pong Gameplay Demo](Screenshots/king-pong-thumbnail.png)](https://youtu.be/2Z1foE1dnKw)

Watch the official King Pong gameplay demo:

[King Pong - Android and Windows Gameplay Demo](https://youtu.be/2Z1foE1dnKw)

## Screenshots

### Title Screen

![King Pong title screen](Screenshots/title-screen.png)

### Gameplay

![King Pong gameplay](Screenshots/gameplay.png)

### Level Cleared

![King Pong level cleared](Screenshots/level-cleared.png)

### Level Failed

![King Pong level failed](Screenshots/level-failed.png)

## Downloads

### Android

Download the Android APK from the [latest GitHub release](https://github.com/KingAlexGilbert/king-pong/releases/latest) and install it on your Android device.

You may need to allow installation from unknown sources depending on your device settings.

Save data note: If you already have King Pong installed and want to keep your save data, update over the existing app. Do not uninstall first, because uninstalling may remove local save data.

### Windows

Download one of the Windows versions from [latest GitHub release](https://github.com/KingAlexGilbert/king-pong/releases/latest:

- `KingPongSetup.v1.1.0.exe` - recommended Windows installer
- `KingPong-WebView2-Portable.v1.1.0.zip` - portable Windows version

For the portable version, extract the ZIP folder first, then run the King Pong EXE inside it.

#### Windows Note

The Windows installer is currently unsigned, so Windows may show an unknown publisher or SmartScreen warning. This is normal for unsigned indie releases.

If you trust this official GitHub release, choose **More info → Run anyway** if SmartScreen appears.

### Linux

Download one of the Linux versions from [latest GitHub release](https://github.com/KingAlexGilbert/king-pong/releases/latest:

- `King-Pong-Linux-v1.1.0-all.deb` — recommended for Linux Mint, Ubuntu, Debian, and other Debian-based distributions
- `King-Pong-Linux-v1.1.0-thin-x86_64.AppImage` — thin x86-64 version that uses the system WebKitGTK runtime

#### Install the Debian Package

Download the `.deb` file, open it with your distribution's software installer, or install it from a terminal:

```bash
sudo apt install ./King-Pong-Linux-v1.1.0-all.deb
```

The package manager will automatically install the required GTK and WebKitGTK dependencies.

#### Run the Thin AppImage

The thin AppImage does not bundle an entire browser engine. The system must already have Python GObject, GTK 3, and WebKitGTK installed.

On Linux Mint 22 or Ubuntu 24.04:

```bash
sudo apt install python3 python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1
```

On an older Debian-based distribution that does not provide WebKitGTK 4.1, install `gir1.2-webkit2-4.0` instead.

Make the AppImage executable and run it:

```bash
chmod +x King-Pong-Linux-v1.1.0-thin-x86_64.AppImage
./King-Pong-Linux-v1.1.0-thin-x86_64.AppImage
```

The thin AppImage is much smaller than a fully self-contained AppImage because it uses the WebKitGTK libraries already installed on the computer.

### Itch.io

You can also play King Pong in your browser or download the desktop and Android versions from itch.io:

[Play or download King Pong on itch.io](https://king-alex-gilbert.itch.io/king-pong)

## Build From Source

### Android

If you want to build King Pong yourself:

1. Download or clone this repository.
2. Open the `android` folder in Android Studio.
3. Let Android Studio sync the Gradle project.
4. Build the APK using: `Build → Generate App Bundles or APKs → Build APK(s)`
5. The generated APK should appear in: `android/app/build/outputs/apk/debug/`

### Windows

If you want to build the Windows version yourself:

1. Download or clone this repository.
2. Go to the `windows/webview-2` folder.
3. Run `build-windows.bat`.
4. The portable Windows build should be generated in the `dist` folder.

To build the Windows installer:

1. Install Inno Setup 6.
2. Go to the `windows/installer exe` folder.
3. Run `build-installer.bat`.
4. The installer should appear in the `Output` folder.

### Linux

If you want to build the Linux version yourself:

1. Download or clone this repository.
2. Go to the `Linux/webkitgtk` folder.
3. Install the Debian package build tools using: `sudo apt install dpkg-dev`
4. Run `./build-deb.sh`.
5. The generated `.deb` package should appear in the `dist` folder.

To build the thin Linux AppImage:

1. Download the x86-64 version of `appimagetool`.
2. Make it executable using: `chmod +x appimagetool-x86_64.AppImage`
3. Go to the `Linux/webkitgtk` folder.
4. Run: `APPIMAGETOOL="/path/to/appimagetool-x86_64.AppImage" ./build-appimage.sh`
5. The generated AppImage should appear in the `dist` folder.


## Source Code

The main game code is located at:

`android/app/src/main/assets/index.html`

The Android WebView wrapper is located at:

`android/app/src/main/java/com/kingalex/kingpong/MainActivity.java`

The Windows WebView2 version is located at:

`windows/webview-2/`

The Windows installer project is located at:

`windows/installer exe/`

The Linux WebKitGTK version is located at:

`Linux/webkitgtk/`

The Linux launcher is located at:

`Linux/webkitgtk/src/king-pong.py`

The Linux `.deb` and thin AppImage build scripts are located at:

`Linux/webkitgtk/build-deb.sh`

`Linux/webkitgtk/build-appimage.sh`

The GitHub Pages website is located at:

`docs/index.html`

The browser demo is located at:

`docs/demo/index.html`

## Documentation & History

This repository includes additional documentation for people who want to explore how King Pong was built and how the project evolved.

* `development-history/` — prompt-history documents and reconstructed making-of notes covering the creation of King Pong, the HTML game development process, and the Android/Windows conversion work.
* `archive/early-builds/` — early HTML prototypes that helped inspire King Pong, including the original Pong-style base and the first expanded difficulty version.

These files are not required to play or build the current version of King Pong. They are included for transparency, project history, and documentation.

## License 

## License

This project is released under the GNU General Public License v3.0.

Distributed modified versions must follow the terms of the GPLv3. See the `LICENSE` file for the complete license terms.

Copyright (C) 2026 King Alex Gilbert
