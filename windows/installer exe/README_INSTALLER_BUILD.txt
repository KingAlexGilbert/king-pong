King Pong Installer Project
===========================

1. Extract the WHOLE windows folder, or copy both complete subfolders:
   installer exe and webview-2, including webview-2\build-tools.
   Keep the subfolders beside each other. There is no shared build.bat.
2. Install a supported .NET SDK, .NET Framework 4.8 Developer Pack, and a current
   Inno Setup 6 (6.3 or later). See ..\README_WINDOWS.md for download links.
3. Double-click build-installer.bat. It builds the portable app, validates the
   x64 files, and compiles the installer; no manual folder copying is needed.
4. Output: Output\KingPongSetup.exe
   Portable output: ..\webview-2\dist\KingPong-WebView2-Portable
5. Run that newly built setup EXE to update the installed game and its version
   in Windows. Building alone does not update the installed copy.

If you see "Usage: --package SOURCE PUBLISH STAGE", an older build checker is
being run. Extract both complete folders from the updated ZIP, including
webview-2\build-tools\BuildChecks.cs. The new scripts rebuild the checker into
a fresh temporary folder and verify compatibility before compiling the game.

Each launcher has its own build commands and does not call another .bat file.
For a path-only check, use: build-installer.bat --check-layout --no-pause

The install folder, Start Menu, desktop shortcut, and launch options are kept.
Setup checks for .NET Framework 4.8 and WebView2, without bundling large runtimes
or silently downloading/executing prerequisites. Missing prerequisites display
Microsoft's download URLs and must be installed before continuing.

App version comes from the C# project; the original upgrade AppId is unchanged.
Installer numeric version fields read the EXE's binary file version, so a Git
commit suffix in its text ProductVersion cannot cause a VersionInfoVersion error.
The installer is unsigned unless you sign it with your own trusted certificate.
This work does not remove Windows UAC or SmartScreen warnings.

Read ..\README_WINDOWS.md and ..\WINDOWS_CHANGES.md before distribution.
