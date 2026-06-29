@echo off
setlocal
cd /d "%~dp0"

set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"

if not exist "%ISCC%" (
  echo Inno Setup 6 was not found.
  echo.
  echo Install Inno Setup 6 from:
  echo https://jrsoftware.org/isinfo.php
  echo.
  pause
  exit /b 1
)

echo Building King Pong installer...
"%ISCC%" "KingPongInstaller.iss"
if errorlevel 1 (
  echo.
  echo Installer build failed.
  pause
  exit /b 1
)

echo.
echo Build complete.
echo Installer created at:
echo %CD%\Output\KingPongSetup.exe
echo.
pause
