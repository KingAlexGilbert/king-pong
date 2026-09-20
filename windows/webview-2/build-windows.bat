@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "KINGPONG_BUILD_RESULT=1"
set "KINGPONG_NO_PAUSE=0"
set "KINGPONG_CHECK_LAYOUT=0"
set "KINGPONG_PUSHED=0"
set "BUILD_STAGE="
rem Keep this release version in sync with KingPongWebView2.csproj.
set "KINGPONG_VERSION=1.1.3"
set "KINGPONG_VERSION_ARGS=-p:Version=%KINGPONG_VERSION% -p:AssemblyVersion=%KINGPONG_VERSION%.0 -p:FileVersion=%KINGPONG_VERSION%.0 -p:InformationalVersion=%KINGPONG_VERSION% -p:IncludeSourceRevisionInInformationalVersion=false"
for %%A in (%*) do if /i "%%~A"=="--no-pause" set "KINGPONG_NO_PAUSE=1"
for %%A in (%*) do if /i "%%~A"=="--check-layout" set "KINGPONG_CHECK_LAYOUT=1"

rem All build commands are in this file. No other batch file is called.
rem Resolve paths from this script, never the caller's current directory.
pushd "%~dp0"
if errorlevel 1 goto :source_unavailable
set "KINGPONG_PUSHED=1"
set "SOURCE_DIR=%CD%"
set "OUT_DIR=%SOURCE_DIR%\dist\KingPong-WebView2-Portable"

rem Detect incomplete copies before checking the installed build tools.
for %%F in (KingPongWebView2.csproj Program.cs GamePagePolicy.cs App.config app.manifest index.html king_pong.ico README.txt build-tools\KingPong.BuildChecks.csproj build-tools\BuildChecks.cs) do (
  if not exist "%SOURCE_DIR%\%%F" (
    echo ERROR: Required source file is missing: "%SOURCE_DIR%\%%F"
    echo Extract or copy the COMPLETE webview-2 folder, including build-tools.
    goto :finish
  )
)
if "%KINGPONG_CHECK_LAYOUT%"=="0" goto :check_tools
echo Source layout is complete. No build tools were run or files changed.
set "KINGPONG_BUILD_RESULT=0"
goto :finish
:check_tools

where dotnet >nul 2>nul
if errorlevel 1 (
  echo ERROR: Install a supported .NET SDK, not just the runtime.
  goto :finish
)
set "HAS_SDK="
for /f "delims=" %%S in ('dotnet --list-sdks 2^>nul') do set "HAS_SDK=1"
if not defined HAS_SDK (
  echo ERROR: No .NET SDK was found. Install a supported .NET SDK.
  goto :finish
)
if not exist "%ProgramFiles(x86)%\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8\mscorlib.dll" (
  echo ERROR: Install the .NET Framework 4.8 Developer Pack / targeting pack.
  goto :finish
)

rem Unique staging is inside obj on the SAME volume as the final output.
rem Never erase bin, obj, dist, or an existing release to start a build.
:choose_stage
set "STAGE_TOKEN=%RANDOM%-%RANDOM%"
set "BUILD_STAGE=%SOURCE_DIR%\obj\package-%STAGE_TOKEN%"
if exist "%BUILD_STAGE%" goto :choose_stage
mkdir "%BUILD_STAGE%\publish" || goto :failed
mkdir "%BUILD_STAGE%\portable" || goto :failed

rem Rebuild the checker into this run's stage; never run a cached helper EXE.
set "CHECKS_EXE=%BUILD_STAGE%\checks\KingPong.BuildChecks.exe"
echo Rebuilding the build checker...
dotnet build "%SOURCE_DIR%\build-tools\KingPong.BuildChecks.csproj" -c Release --no-incremental --nologo -o "%BUILD_STAGE%\checks"
if errorlevel 1 goto :failed
if not exist "%CHECKS_EXE%" goto :failed
"%CHECKS_EXE%" --check-protocol 2 >nul 2>nul
if errorlevel 1 (
  echo ERROR: The build checker is outdated or could not run.
  echo Replace this source file from the SAME updated ZIP as this launcher:
  echo   "%SOURCE_DIR%\build-tools\BuildChecks.cs"
  echo Extract BOTH complete folders, including webview-2\build-tools, then retry.
  goto :failed
)

echo Restoring pinned NuGet dependencies...
dotnet restore "%SOURCE_DIR%\KingPongWebView2.csproj" --nologo %KINGPONG_VERSION_ARGS%
if errorlevel 1 goto :failed
echo Rebuilding Windows version %KINGPONG_VERSION% from "%SOURCE_DIR%"...
dotnet build "%SOURCE_DIR%\KingPongWebView2.csproj" -c Release --no-restore --no-incremental --nologo %KINGPONG_VERSION_ARGS%
if errorlevel 1 goto :failed
echo Publishing the rebuilt Release x64 app...
dotnet publish "%SOURCE_DIR%\KingPongWebView2.csproj" -c Release --no-build --no-restore --nologo -o "%BUILD_STAGE%\publish" %KINGPONG_VERSION_ARGS%
if errorlevel 1 goto :failed

rem The checker validates the rebuilt app and is never shipped to players.
"%CHECKS_EXE%" --package "%SOURCE_DIR%" "%BUILD_STAGE%\publish" "%BUILD_STAGE%\portable" "%KINGPONG_VERSION%"
if errorlevel 1 goto :failed

:promote
if not exist "%SOURCE_DIR%\dist" mkdir "%SOURCE_DIR%\dist"
if not exist "%SOURCE_DIR%\dist" goto :failed
set "BACKUP_DIR="
if not exist "%OUT_DIR%" goto :move_portable
:choose_backup
set "BACKUP_DIR=%OUT_DIR%.previous-%STAGE_TOKEN%-%RANDOM%"
if exist "%BACKUP_DIR%" goto :choose_backup
move "%OUT_DIR%" "%BACKUP_DIR%" >nul
if errorlevel 1 goto :failed
echo Previous portable build preserved: "%BACKUP_DIR%"
:move_portable
move "%BUILD_STAGE%\portable" "%OUT_DIR%" >nul
if errorlevel 1 goto :restore_portable
echo Portable build: "%OUT_DIR%"

goto :success

:restore_portable
if defined BACKUP_DIR if not exist "%OUT_DIR%" move "%BACKUP_DIR%" "%OUT_DIR%" >nul
goto :failed
:success
set "KINGPONG_BUILD_RESULT=0"
echo Build complete. Verified Windows version: %KINGPONG_VERSION%.
echo Test this release on Windows before distribution.
goto :finish
:failed
echo ERROR: Build failed. See the first error above. Do not distribute a previous EXE as this build.
goto :finish
:source_unavailable
echo ERROR: Cannot open the source folder "%~dp0".
echo Extract the archive to a local folder before running this script.
:finish
rem The only recursive deletion is this build's freshly created staging folder.
if defined BUILD_STAGE if exist "%BUILD_STAGE%" rmdir /s /q "%BUILD_STAGE%"
if "%KINGPONG_PUSHED%"=="1" popd
if "%KINGPONG_NO_PAUSE%"=="0" pause
exit /b %KINGPONG_BUILD_RESULT%
