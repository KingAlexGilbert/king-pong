; Build using build-installer.bat (builds and validates the app automatically).
; A current Inno Setup 6 is recommended: https://jrsoftware.org/isinfo.php
#define MyAppName "King Pong"
#define MyAppPublisher "King Alex Gilbert"
#define MyAppExeName "KingPong-Desktop-HD-WebView2.exe"
#ifndef MyAppFolder
  #define MyAppFolder "..\webview-2\dist\KingPong-WebView2-Portable"
#endif
#if !FileExists(MyAppFolder + "\" + MyAppExeName)
  #error Build the portable app first, or use build-installer.bat to build both.
#endif
; Numeric PE version, e.g. 1.1.2.0. ProductVersion is text and may contain a
; .NET/Git suffix such as 1.1.2+abc123, which Inno's binary fields reject.
#define MyAppNumericVersion GetVersionNumbersString(MyAppFolder + "\" + MyAppExeName)
#ifndef MyAppVersion
  #define MyAppVersion GetStringFileInfo(MyAppFolder + "\" + MyAppExeName, "ProductVersion")
#endif

[Setup]
; Keep this ID unchanged so existing installations update in place.
AppId={{A17D3E7B-6FCB-47E2-B8B0-5B2F6FD24E7A}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\King Pong
DefaultGroupName=King Pong
DisableDirPage=no
DisableProgramGroupPage=no
AllowNoIcons=yes
AlwaysShowDirOnReadyPage=yes
AlwaysShowGroupOnReadyPage=yes
OutputDir=Output
OutputBaseFilename=KingPongSetup
SetupIconFile=..\webview-2\king_pong.ico
Compression=lzma2/max
LZMADictionarySize=8192
SolidCompression=yes
WizardStyle=modern
MinVersion=10.0
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
AppMutex=Local\KingPong.DesktopHD.Running
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName=King Pong
VersionInfoVersion={#MyAppNumericVersion}
VersionInfoTextVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=King Pong Installer
VersionInfoProductName=King Pong
VersionInfoProductVersion={#MyAppNumericVersion}
VersionInfoProductTextVersion={#MyAppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce

[Files]
; Explicit payload: never sweep up debug files, extra runtimes, or profiles.
Source: "{#MyAppFolder}\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#MyAppFolder}\{#MyAppExeName}.config"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#MyAppFolder}\Microsoft.Web.WebView2.Core.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#MyAppFolder}\Microsoft.Web.WebView2.WinForms.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#MyAppFolder}\WebView2Loader.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#MyAppFolder}\index.html"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#MyAppFolder}\README.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\King Pong"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{commondesktop}\King Pong"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch King Pong"; Flags: nowait postinstall skipifsilent runasoriginaluser

[InstallDelete]
; Only exact obsolete build artifacts from earlier packages; no wildcards.
Type: files; Name: "{app}\king_pong.ico"
Type: files; Name: "{app}\{#MyAppExeName}.pdb"
Type: files; Name: "{app}\Microsoft.Web.WebView2.Wpf.dll"
Type: files; Name: "{app}\Microsoft.Web.WebView2.Wpf.xml"
Type: files; Name: "{app}\Microsoft.Web.WebView2.Core.xml"
Type: files; Name: "{app}\Microsoft.Web.WebView2.WinForms.xml"
Type: files; Name: "{app}\runtimes\win-x86\native\WebView2Loader.dll"
Type: files; Name: "{app}\runtimes\win-arm64\native\WebView2Loader.dll"
Type: files; Name: "{app}\runtimes\win-x64\native\WebView2Loader.dll"
Type: files; Name: "{app}\x86\WebView2Loader.dll"
Type: files; Name: "{app}\arm64\WebView2Loader.dll"
Type: files; Name: "{app}\x64\WebView2Loader.dll"

; No recursive [UninstallDelete]. Inno removes its tracked installation files
; and leaves unrelated user files and %LOCALAPPDATA%\KingPong saves alone.

[Code]
function HasWebView2Runtime: Boolean;
var
  RuntimeVersion: String;
  ClientKey: String;
begin
  ClientKey := 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  RuntimeVersion := '';
  Result := RegQueryStringValue(HKLM32, ClientKey, 'pv', RuntimeVersion);
  Result := Result and (Trim(RuntimeVersion) <> '') and (RuntimeVersion <> '0.0.0.0');
  if not Result then
  begin
    RuntimeVersion := '';
    Result := RegQueryStringValue(HKCU32, ClientKey, 'pv', RuntimeVersion);
    Result := Result and (Trim(RuntimeVersion) <> '') and (RuntimeVersion <> '0.0.0.0');
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not IsDotNetInstalled(net48, 0) then
    Result := '.NET Framework 4.8 or newer is required. Install it from Microsoft, then retry Setup.' + #13#10 +
      'https://dotnet.microsoft.com/download/dotnet-framework/net48' + #13#10#13#10;
  if not HasWebView2Runtime then
    Result := Result + 'Microsoft Edge WebView2 Evergreen Runtime was not detected. Install it from Microsoft, then retry Setup.' + #13#10 +
      'https://developer.microsoft.com/microsoft-edge/webview2/' + #13#10#13#10 +
      'If Setup uses a different administrator account, install WebView2 for all users.';
end;
