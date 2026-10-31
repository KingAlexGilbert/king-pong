# Native WebView diagnostics

The production game retains its normal browser security settings. Developer
inspection is opt-in and intended for local troubleshooting only. Developer
tools can reveal session messages, room credentials, and connection metadata;
never share raw console or network captures without reviewing/redacting them.

## Windows (installed or portable)

Launch the WebView2 executable with `--debug-online` and press **F12** to open
Edge DevTools. In a PowerShell window, for example:

```powershell
& ".\KingPong-Desktop-HD-WebView2.exe" --debug-online
```

Without this argument, DevTools and browser accelerator keys stay disabled.
This argument does not change WebView2 permissions, navigation allowlists,
file origins, remote debugging ports, or game/networking behavior. Don't
ship shortcuts that add `--debug-online` by default.

## Android

Use the Gradle **debug** APK (created with `assembleDebug`). The activity
checks the Android `FLAG_DEBUGGABLE` flag before allowing Chrome's remote
WebView inspector. Release builds always disable inspection. Connect the
phone over USB with its normal developer debugging setup, open Chrome on the
development computer, and visit `chrome://inspect` to inspect the running
King Pong WebView.

**Before replacing an installed release APK with a debug APK, export saves.**
The variants use the same application ID and may not share signing keys;
reinstalling the APK could require uninstalling the old app and erase local
app data. Reinstall the normal release when testing ends.

## Logs

Use the browser inspector's **Console** and **Network** panels while reproducing
a failure. Connection-stage messages from existing game diagnostics can be
observed there; no logs are automatically uploaded, persisted, or exported.
Do not expose secret room tokens, ICE credentials, private room codes or
personal connection details in reports. The Linux diagnostic flag and F12
inspector are unchanged by this update.
