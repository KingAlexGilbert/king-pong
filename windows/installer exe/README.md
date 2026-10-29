# King Pong Windows Installer

This folder builds the Windows setup file. The desktop app itself is in `../webview-2/`.

Keep both folders together when building. You need a .NET SDK, the .NET Framework 4.8 Developer Pack and Inno Setup 6 (version 6.3 or later).

## Build the Installer

Run `build-installer.bat` from this folder. The script builds the portable app, checks its files and creates the installer. You don't have to build or copy the portable version first.

The results are saved here:

- `Output/KingPongSetup.exe` — Windows installer
- `../webview-2/dist/KingPong-WebView2-Portable/` — portable app

To check that both source folders are complete without running a build:

```bat
build-installer.bat --check-layout --no-pause
```

Run the new installer to update an existing installation. Building it does not update the game already installed on your computer.

## Installing and Signing

The installer checks for .NET Framework 4.8 and the Microsoft Edge WebView2 runtime. If either is missing, it shows where to get it rather than downloading it silently.

The installer is not code-signed by default. Windows may show an unknown publisher or SmartScreen warning until you sign it with your own certificate.

For desktop source files and the portable build, see [`../webview-2/`](../webview-2/).
