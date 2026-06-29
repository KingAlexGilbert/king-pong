; King Pong Windows Installer
; Build with Inno Setup 6: https://jrsoftware.org/isinfo.php

#define MyAppName "King Pong"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "King Alex Gilbert"
#define MyAppExeName "KingPong-Desktop-HD-WebView2.exe"
#define MyAppFolder "KingPong-WebView2-Portable"

[Setup]
AppId={{A17D3E7B-6FCB-47E2-B8B0-5B2F6FD24E7A}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\King Pong
DefaultGroupName=King Pong
; Show the user where the game will be installed and let them change it.
DisableDirPage=no
; Show the Start Menu folder page and allow the user to skip Start Menu shortcuts.
DisableProgramGroupPage=no
AllowNoIcons=yes
; Make the final Ready page clearly show the install folder and Start Menu folder.
AlwaysShowDirOnReadyPage=yes
AlwaysShowGroupOnReadyPage=yes
OutputDir=Output
OutputBaseFilename=KingPongSetup
SetupIconFile={#MyAppFolder}\king_pong.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName=King Pong
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=King Pong Installer
VersionInfoProductName=King Pong
VersionInfoProductVersion={#MyAppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce

[Files]
Source: "{#MyAppFolder}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; This shortcut is created in the Start Menu folder the user chooses.
; If they check "Don't create a Start Menu folder", Inno Setup skips it.
Name: "{group}\King Pong"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\king_pong.ico"
Name: "{commondesktop}\King Pong"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\king_pong.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch King Pong"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Do not delete player saves. The game profile/saves are stored under %LOCALAPPDATA%\KingPong.
Type: filesandordirs; Name: "{app}"
