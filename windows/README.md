# King Pong for Windows

The Windows version runs the game in a WebView2 desktop window. It is available as a portable folder or an installer.

There are two main source folders:

- [`webview-2/`](webview-2/) — the desktop app, game page and native Windows code.
- [`installer exe/`](installer%20exe/) — the installer script and build tools.

The shared game code lives in [`../game/`](../game/README.md). Run `node tools/sync-gameplay.mjs` from the repository root after editing it, before making a Windows build.

## Build the Portable Version

You need a .NET SDK and the .NET Framework 4.8 Developer Pack. Go to `windows/webview-2/` and run:

```bat
build-windows.bat
```

The result is in `webview-2/dist/`. The app requires the Microsoft Edge WebView2 runtime on the computer where it runs.

## Build the Installer

Install Inno Setup 6 (version 6.3 or later), then run `build-installer.bat` from `windows/installer exe/`. It builds and checks the portable app before producing `Output/KingPongSetup.exe`.

See the [installer README](installer%20exe/README.md) for layout checks and installation notes.
