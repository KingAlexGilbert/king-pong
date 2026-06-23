King Pong is a Pong-inspired Android arcade campaign game that I made in my free time.

It features campaign progression, language detection, controller support, touch controls, local two-player mode, LAN play, saves, and a secret ending.

The project was developed with AI-assisted coding and packaging help, then manually tested and polished to give it that human touch.

Feel free to test it out, play around with it, and modify it. Hope you enjoy it!

Made by: King Alex Gilbert

## Screenshots

### Title Screen

![King Pong title screen](Screenshots/title-screen.png)

### Gameplay

![King Pong gameplay](Screenshots/gameplay.png)

### Level Cleared

![King Pong level cleared](Screenshots/level-cleared.png)

### Level Failed

![King Pong level failed](Screenshots/level-failed.png)

## HOW TO DOWNLOAD:

The Android APK can be downloaded from the Releases section of this GitHub repository.

After downloading the APK, install it on your Android device. You may need to allow installation from unknown sources depending on your device's settings.

Note: If you already have King Pong installed and want to keep your save data, update over the existing app. Do not uninstall first, because uninstalling may remove local save data.

## BUILD FROM SOURCE:

If you want to build King Pong yourself:

1. Download or clone this repository.
2. Open the project folder in Android Studio.
3. Let Android Studio sync the Gradle project.
4. Build the APK using: `Build → Generate App Bundles or APKs → Build APK(s)`
5. The generated APK should appear in: `app/build/outputs/apk/debug/`

## SOURCE CODE:

The main game code is located at:

app/src/main/assets/index.html

The Android WebView wrapper is located at:

app/src/main/java/com/kingalex/kingpong/MainActivity.java

## LICENSE

This project is released under the GNU General Public License v3.0.

Modified versions that are distributed should remain open-source under the same license.

Copyright (C) 2026 King Alex Gilbert
