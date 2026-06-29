@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "APP_NAME=KingPong-Desktop-HD-WebView2"
set "OUT_DIR=%CD%\dist\KingPong-WebView2-Portable"
set "OUT_EXE=%OUT_DIR%\%APP_NAME%.exe"

echo.
echo === King Pong WebView2 Fullscreen Build ===
echo.

where dotnet >nul 2>nul
if errorlevel 1 (
  echo ERROR: dotnet was not found.
  echo.
  echo Install the .NET SDK, not just the .NET Runtime.
  echo Recommended: .NET 8 SDK or Visual Studio 2022 Build Tools.
  echo Then close this window and run build-windows.bat again.
  echo.
  pause
  exit /b 1
)

set "HAS_DOTNET_SDK="
for /f "usebackq tokens=*" %%S in (`dotnet --list-sdks 2^>nul`) do set "HAS_DOTNET_SDK=1"
if not defined HAS_DOTNET_SDK (
  echo ERROR: dotnet exists, but no .NET SDKs were found.
  echo.
  echo You probably have only the .NET Runtime installed.
  echo Install the .NET SDK, then run this again.
  echo.
  echo Microsoft download page: https://aka.ms/dotnet/download
  echo.
  pause
  exit /b 1
)

if not exist "%ProgramFiles(x86)%\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8\mscorlib.dll" (
  echo ERROR: .NET Framework 4.8 Developer Pack / targeting pack was not found.
  echo.
  echo This project targets .NET Framework 4.8 so the finished app can stay small.
  echo Install one of these, then run this again:
  echo   1. .NET Framework 4.8 Developer Pack
  echo   2. Visual Studio 2022 Build Tools with .NET desktop build tools
  echo.
  pause
  exit /b 1
)

if exist bin rmdir /s /q bin
if exist obj rmdir /s /q obj
if exist dist rmdir /s /q dist

echo Restoring NuGet packages...
dotnet restore KingPongWebView2.csproj
if errorlevel 1 (
  echo.
  echo ERROR: Restore failed.
  echo Make sure you are online and WebView2/NuGet downloads are not blocked.
  echo.
  pause
  exit /b 1
)

echo.
echo Publishing portable WebView2 build...
dotnet publish KingPongWebView2.csproj -c Release -o "%OUT_DIR%"
if errorlevel 1 (
  echo.
  echo ERROR: Publish failed.
  echo Look above this message for the exact build error.
  echo.
  pause
  exit /b 1
)

if not exist "%OUT_EXE%" (
  echo.
  echo ERROR: Build did not create the expected EXE.
  echo Expected file:
  echo %OUT_EXE%
  echo.
  echo The build did not complete successfully.
  pause
  exit /b 1
)

copy /y index.html "%OUT_DIR%\index.html" >nul
copy /y README.txt "%OUT_DIR%\README.txt" >nul
copy /y king_pong.ico "%OUT_DIR%\king_pong.ico" >nul

echo.
echo Build complete.
echo Output folder:
echo %OUT_DIR%
echo.
echo IMPORTANT: Share the whole KingPong-WebView2-Portable folder as a zip.
echo Do not share only the EXE, because it needs its DLLs and index.html beside it.
echo.
pause
