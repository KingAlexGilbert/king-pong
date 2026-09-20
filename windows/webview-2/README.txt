King Pong Desktop HD - Windows x64
=================================

Launch KingPong-Desktop-HD-WebView2.exe.
Keep all seven files in this folder together when sharing the portable build.

Requirements:
- Windows 10/11 x64 (Windows on ARM needs x64 emulation).
- .NET Framework 4.8 or newer.
- Microsoft Edge WebView2 Evergreen Runtime.
  https://developer.microsoft.com/microsoft-edge/webview2/

F11 or Alt+Enter toggles fullscreen. The title screen's Exit Game button closes
the app. Saved games/settings remain under %LOCALAPPDATA%\KingPong\WebView2Profile.
Do not delete this profile if you want to keep saves. For best compatibility,
update an existing installation in the same location and close it before setup.

For a source build, see ..\README_WINDOWS.md and run build-windows.bat.
This launcher has its own build commands; no parent build.bat is needed.
Copy this entire source folder, including build-tools, when updating a project.
