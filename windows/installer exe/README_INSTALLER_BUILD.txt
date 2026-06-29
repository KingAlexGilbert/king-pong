King Pong Installer Project
===========================

This folder builds a Windows installer EXE for King Pong using Inno Setup 6.

What this installer does:
- Installs King Pong to Program Files\King Pong by default
- Shows the install folder page so users can see/change where it installs
- Shows the Start Menu folder page so users can choose or skip Start Menu shortcuts
- Creates a Desktop shortcut by default, with a checkbox to turn it off
- Uses the King Pong icon for the installer, app, taskbar, and shortcuts
- Adds a normal Windows uninstaller
- Keeps game saves separate under %LOCALAPPDATA%\KingPong
- Does not include a WebView2 runtime check

How to build:
1. Install Inno Setup 6 from: https://jrsoftware.org/isinfo.php
2. Double-click build-installer.bat
3. The installer will be created here:
   Output\KingPongSetup.exe

For GitHub Releases, upload:
- Output\KingPongSetup.exe as the recommended installer
- Your portable zip as an optional portable version

Note about UAC and SmartScreen:
This installer is not code-signed unless you sign it locally with your own trusted code-signing certificate.
Because it is unsigned, Windows UAC will show Publisher: Unknown and SmartScreen may warn some users.
