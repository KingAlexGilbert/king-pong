# King Pong for Android

The Android app uses a WebView to run King Pong's game page. Java code handles Android-specific features such as the app window and local-network play.

You can find the main files here:

- `app/src/main/assets/index.html` — the game page used by the app.
- `app/src/main/java/com/kingalex/kingpong/MainActivity.java` — the Android app window and its connection to the game.
- `app/src/main/java/com/kingalex/kingpong/LocalLan.java` — local-network discovery and connections.
- `app/build.gradle.kts` — Android version and build settings.

The shared game source is in [`../game/`](../game/README.md). Edit it there and run `node tools/sync-gameplay.mjs` from the repository root before building. Changes made directly to generated shared sections in `index.html` will be overwritten.

## Build an APK

Open `android/` in Android Studio, let Gradle sync, and use **Build → Build APK(s)** to make a debug APK.

You can also build from the `android/` folder with the Gradle wrapper:

```sh
./gradlew assembleDebug
```

On Windows, use `gradlew.bat assembleDebug` instead. The debug APK goes to `app/build/outputs/apk/debug/`.

A debug APK is for testing. A public release must use your release signing key. Keep that key private, and use the same signing certificate as earlier releases so Android can install updates over them.

## Testing

Test the finished APK on a phone or emulator. Check startup, touch controls, landscape mode, save import/export, online matches and LAN pairing. Browser tests alone do not cover Android WebView or the app's Java code.

The Java LAN implementation also has test support in `../tests/`; see the [test README](../tests/README.md).
