using System;
using System.Drawing;
using System.IO;
using System.Globalization;
using System.Text;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace KingPongWebView2
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            // Must happen before any WinForms/WebView2 window is created.
            // This prevents Windows from bitmap-scaling the app on 4K/high-DPI monitors,
            // which is what makes text and canvas graphics look blurry.
            EnableHighDpiMode();

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            // Presence marker for Setup/Uninstall, not a single-instance lock.
            // Multiple game windows (including local LAN testing) still work.
            using (var running = new Mutex(false, @"Local\KingPong.DesktopHD.Running"))
            using (var form = new KingPongForm())
            {
                Application.Run(form);
            }
        }

        private static void EnableHighDpiMode()
        {
            try
            {
                // Windows 10/11: best mode for moving between monitors with different scaling.
                if (SetProcessDpiAwarenessContext(new IntPtr(-4)))
                {
                    return;
                }
            }
            catch
            {
                // Use the Windows 8.1+ per-monitor DPI API when this call is unavailable.
            }

            try
            {
                // Windows 8.1+ fallback.
                SetProcessDpiAwareness(PROCESS_DPI_AWARENESS.Process_Per_Monitor_DPI_Aware);
            }
            catch
            {
                // If Windows refuses the DPI call, keep launching the game normally.
            }
        }

        private enum PROCESS_DPI_AWARENESS
        {
            Process_DPI_Unaware = 0,
            Process_System_DPI_Aware = 1,
            Process_Per_Monitor_DPI_Aware = 2
        }

        [DllImport("user32.dll")]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

        [DllImport("shcore.dll")]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        private static extern int SetProcessDpiAwareness(PROCESS_DPI_AWARENESS awareness);
    }

    public sealed class KingPongForm : Form
    {
        private readonly WebView2 webView;
        private readonly Uri gameUri;
        private Icon ownedIcon;
        private Rectangle windowedBounds;
        private FormBorderStyle windowedBorderStyle;
        private bool isFullscreen;
        private bool exitRequested;
        private bool isClosing;
        private bool failureShown;
        private bool saveFileDialogBusy;
        private const int SaveFileLimit = 64 * 1024;
        private bool batteryPageReady;
        private bool batteryUpdateQueued;
        private string lastBatteryScript;
        private IntPtr batteryLevelNotification;
        private IntPtr powerSourceNotification;

        [StructLayout(LayoutKind.Sequential)]
        private struct SystemPowerStatus
        {
            public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag;
            public uint BatteryLifeTime, BatteryFullLifeTime;
        }

        [DllImport("kernel32.dll")]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetSystemPowerStatus(out SystemPowerStatus status);

        [DllImport("user32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        private static extern IntPtr RegisterPowerSettingNotification(IntPtr recipient, ref Guid setting, uint flags);

        [DllImport("user32.dll", SetLastError = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnregisterPowerSettingNotification(IntPtr handle);

        protected override void OnHandleCreated(EventArgs args)
        {
            base.OnHandleCreated(args);
            Guid level = new Guid("A7AD8041-B45A-4CAE-87A3-EECBB468A9E1");
            Guid source = new Guid("5D3E9A59-E9D5-4B00-A6BD-FF34FF516548");
            batteryLevelNotification = RegisterPowerSettingNotification(Handle, ref level, 0);
            powerSourceNotification = RegisterPowerSettingNotification(Handle, ref source, 0);
        }

        protected override void OnHandleDestroyed(EventArgs args)
        {
            if (batteryLevelNotification != IntPtr.Zero) UnregisterPowerSettingNotification(batteryLevelNotification);
            if (powerSourceNotification != IntPtr.Zero) UnregisterPowerSettingNotification(powerSourceNotification);
            batteryLevelNotification = powerSourceNotification = IntPtr.Zero;
            batteryUpdateQueued = false;
            base.OnHandleDestroyed(args);
        }

        protected override void WndProc(ref Message message)
        {
            base.WndProc(ref message);
            if (message.Msg != 0x0218) return; // WM_POWERBROADCAST
            long powerEvent = message.WParam.ToInt64();
            // Power settings, status changes and resume; no periodic timer.
            if (powerEvent == 0x8013 || powerEvent == 0x000A || powerEvent == 0x0012 || powerEvent == 0x0007)
                QueueBatteryUpdate();
        }

        private void QueueBatteryUpdate()
        {
            if (!batteryPageReady || batteryUpdateQueued || isClosing || IsDisposed || !IsHandleCreated) return;
            // Power notifications can arrive in bursts; defer and combine them into one status read.
            batteryUpdateQueued = true;
            BeginInvoke(new Action(async () =>
            {
                batteryUpdateQueued = false;
                await SendBatteryStateAsync();
            }));
        }

        private async Task SendBatteryStateAsync()
        {
            if (!batteryPageReady || isClosing || IsDisposed || webView == null || webView.CoreWebView2 == null ||
                !GamePagePolicy.IsAllowed(webView.CoreWebView2.Source, gameUri)) return;
            SystemPowerStatus status;
            bool succeeded = GetSystemPowerStatus(out status);
            string script = BatteryStatus.UpdateScript(succeeded, status.BatteryFlag, status.BatteryLifePercent, status.ACLineStatus);
            if (script == lastBatteryScript) return;
            lastBatteryScript = script;
            try { await webView.CoreWebView2.ExecuteScriptAsync(script); }
            catch (Exception) { lastBatteryScript = null; }
        }

        public KingPongForm()
        {
            gameUri = new Uri(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "index.html"));
            Text = "King Pong Desktop HD";
            BackColor = Color.Black;
            KeyPreview = true;
            TryApplyAppIcon();
            StartPosition = FormStartPosition.Manual;
            WindowState = FormWindowState.Normal;
            ShowInTaskbar = true;
            // Keep the initial window within the work area on small/scaled displays.
            Rectangle workArea = Screen.PrimaryScreen.WorkingArea;
            MinimumSize = new Size(Math.Min(960, workArea.Width), Math.Min(720, workArea.Height));
            Size initialSize = new Size(Math.Min(1280, workArea.Width), Math.Min(960, workArea.Height));
            Bounds = new Rectangle(workArea.Left + (workArea.Width - initialSize.Width) / 2,
                workArea.Top + (workArea.Height - initialSize.Height) / 2,
                initialSize.Width, initialSize.Height);

            webView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = Color.Black
            };
            Controls.Add(webView);

            // Drives document.visibilitychange in the unchanged HTML when minimized.
            // Its existing code pauses rendering/audio; do not suspend LAN connections.
            Resize += (sender, args) =>
            {
                if (!isClosing) webView.Visible = WindowState != FormWindowState.Minimized;
            };
            Load += async (sender, args) => await InitializeWebViewAsync();
            Shown += (sender, args) => ApplyFullscreen();
        }


        private void TryApplyAppIcon()
        {
            try
            {
                ownedIcon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                Icon = ownedIcon;
            }
            catch
            {
                // If Windows cannot load the icon for any reason, keep the game launching normally.
            }
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == Keys.F11 || keyData == (Keys.Alt | Keys.Enter))
            {
                ToggleFullscreen();
                return true;
            }

            return base.ProcessCmdKey(ref msg, keyData);
        }

        private async Task InitializeWebViewAsync()
        {
            try
            {
                if (!File.Exists(gameUri.LocalPath))
                {
                    ShowStartupError("index.html was not found next to the EXE. Keep the whole portable folder together or reinstall King Pong.");
                    return;
                }

                // Keep both this path and the file:// page origin unchanged for saves.
                string profileDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "KingPong", "WebView2Profile");
                Directory.CreateDirectory(profileDir);

                // Retain music autoplay; avoid unrelated/undocumented feature overrides.
                var options = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required");
                var environment = await CoreWebView2Environment.CreateAsync(null, profileDir, options);
                if (isClosing || IsDisposed) return;
                await webView.EnsureCoreWebView2Async(environment);
                if (isClosing || IsDisposed) return;

                webView.ZoomFactor = 1.0;
                CoreWebView2 core = webView.CoreWebView2;
                CoreWebView2Settings settings = core.Settings;
                settings.AreDefaultContextMenusEnabled = false;
                settings.AreDevToolsEnabled = false;
                settings.IsStatusBarEnabled = false;
                settings.AreBrowserAcceleratorKeysEnabled = false;
                settings.IsZoomControlEnabled = false;
                settings.IsPinchZoomEnabled = false;
                settings.IsSwipeNavigationEnabled = false;
                settings.AreHostObjectsAllowed = false;
                settings.IsGeneralAutofillEnabled = false;
                settings.IsPasswordAutosaveEnabled = false;
                settings.IsWebMessageEnabled = true;
                // Save confirmations are rendered inside the game page.

                // Install restrictions BEFORE navigating to any game content.
                core.NavigationStarting += (sender, args) =>
                {
                    args.Cancel = !GamePagePolicy.IsAllowed(args.Uri, gameUri);
                    if (!args.Cancel) { batteryPageReady = false; lastBatteryScript = null; }
                };
                core.FrameNavigationStarting += (sender, args) => args.Cancel = true;
                core.NewWindowRequested += (sender, args) => args.Handled = true;
                core.DownloadStarting += (sender, args) => args.Cancel = true;
                core.PermissionRequested += HandlePermissionRequested;
                core.WebMessageReceived += HandleWebMessageReceived;
                core.WindowCloseRequested += (sender, args) =>
                {
                    if (GamePagePolicy.IsAllowed(core.Source, gameUri)) RequestExitFromGame();
                };
                core.ProcessFailed += (sender, args) =>
                {
                    // GPU/utility subprocesses can recover without losing the game.
                    if (args.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited ||
                        args.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited ||
                        args.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
                    {
                        ShowRuntimeError();
                    }
                };
                core.NavigationCompleted += (sender, args) =>
                {
                    if (isClosing || IsDisposed) return;
                    if (args.IsSuccess)
                    {
                        batteryPageReady = true;
                        QueueBatteryUpdate();
                        if (Form.ActiveForm == this) webView.Focus();
                    }
                    else if (args.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
                        ShowRuntimeError();
                };
                core.Navigate(gameUri.AbsoluteUri);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                ShowStartupError("Microsoft Edge WebView2 Runtime is missing. Install the Evergreen Runtime from https://developer.microsoft.com/microsoft-edge/webview2/ and then reopen King Pong.");
            }
            catch (Exception error)
            {
                // Includes profile permission failures, loader errors and async startup races.
                ShowStartupError("King Pong could not start its web view. Update/reinstall the Evergreen WebView2 Runtime and check that the app folder is complete.\n\n" + error.Message);
            }
        }

        private void HandlePermissionRequested(object sender, CoreWebView2PermissionRequestedEventArgs args)
        {
            if (!GamePagePolicy.IsAllowed(args.Uri, gameUri))
            {
                args.State = CoreWebView2PermissionState.Deny;
                return;
            }

            // Deny unused sensitive capabilities while leaving other permissions at Default
            // for clipboard writes, user-initiated features, and future LAN prompts.
            switch (args.PermissionKind)
            {
                case CoreWebView2PermissionKind.Microphone:
                case CoreWebView2PermissionKind.Camera:
                case CoreWebView2PermissionKind.Geolocation:
                case CoreWebView2PermissionKind.Notifications:
                case CoreWebView2PermissionKind.OtherSensors:
                case CoreWebView2PermissionKind.ClipboardRead:
                case CoreWebView2PermissionKind.FileReadWrite:
                case CoreWebView2PermissionKind.MultipleAutomaticDownloads:
                    args.State = CoreWebView2PermissionState.Deny;
                    break;
            }
        }

        private void ShowStartupError(string message)
        {
            if (isClosing || IsDisposed) return;
            MessageBox.Show(this, message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            // Queue shutdown outside any active WebView2 callback.
            RequestExitFromGame();
        }

        private void ShowRuntimeError()
        {
            if (isClosing || IsDisposed || failureShown) return;
            failureShown = true;
            // Modal UI inside a WebView2 event causes unsupported reentrancy.
            BeginInvoke(new Action(() =>
            {
                if (!isClosing && !IsDisposed)
                    MessageBox.Show(this, "WebView2 stopped responding. Close and reopen King Pong. Your saved progress has not been deleted.",
                        Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }));
        }

        private void HandleWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            if (isClosing || !GamePagePolicy.IsAllowed(args.Source, gameUri)) return;
            string message;

            try
            {
                message = args.TryGetWebMessageAsString();
            }
            catch
            {
                // Ignore malformed or non-string messages from the page.
                return;
            }

            if (string.Equals(message, "kingpong:exit", StringComparison.Ordinal))
            {
                RequestExitFromGame();
            }
            else if (message != null && message.Length <= SaveFileLimit + 64 &&
                message.StartsWith("kingpong:save:", StringComparison.Ordinal))
            {
                // A modal picker must run after the WebView2 event has returned.
                BeginInvoke(new Action(async () => await HandleSaveFileRequestAsync(message)));
            }
        }

        private async Task HandleSaveFileRequestAsync(string message)
        {
            if (isClosing || IsDisposed || webView.CoreWebView2 == null ||
                !GamePagePolicy.IsAllowed(webView.CoreWebView2.Source, gameUri)) return;
            string[] parts = message.Split(new[] { ':' }, 5);
            int id;
            if (parts.Length < 4 || !int.TryParse(parts[3], NumberStyles.None, CultureInfo.InvariantCulture, out id) || id <= 0) return;
            bool exporting = parts[2] == "export";
            if (saveFileDialogBusy || (!exporting && parts[2] != "import") || parts.Length != (exporting ? 5 : 4))
            {
                await SendSaveFileResultAsync(id, "error", "");
                return;
            }
            saveFileDialogBusy = true;
            try
            {
                string imported = "";
                if (exporting)
                {
                    string text = parts[4];
                    if (Encoding.UTF8.GetByteCount(text) > SaveFileLimit) throw new IOException("Backup too large");
                    using (var dialog = new SaveFileDialog
                    {
                        Title = "Export King Pong saves", FileName = "KingPong-saves.json",
                        Filter = "King Pong saves (*.json)|*.json", DefaultExt = "json",
                        AddExtension = true, OverwritePrompt = true, RestoreDirectory = true
                    })
                    {
                        if (dialog.ShowDialog(this) != DialogResult.OK)
                        {
                            await SendSaveFileResultAsync(id, "cancel", "");
                            return;
                        }
                        string path = dialog.FileName;
                        await Task.Run(() => File.WriteAllText(path, text, new UTF8Encoding(false)));
                    }
                }
                else
                {
                    using (var dialog = new OpenFileDialog
                    {
                        Title = "Import King Pong saves", Filter = "King Pong saves (*.json)|*.json|All files (*.*)|*.*",
                        CheckFileExists = true, Multiselect = false, RestoreDirectory = true
                    })
                    {
                        if (dialog.ShowDialog(this) != DialogResult.OK)
                        {
                            await SendSaveFileResultAsync(id, "cancel", "");
                            return;
                        }
                        string path = dialog.FileName;
                        imported = await Task.Run(() => ReadSaveBackup(path));
                    }
                }
                await SendSaveFileResultAsync(id, "ok", imported);
            }
            catch (Exception)
            {
                await SendSaveFileResultAsync(id, "error", "");
            }
            finally
            {
                saveFileDialogBusy = false;
                if (!isClosing && !IsDisposed) webView.Focus();
            }
        }

        private static string ReadSaveBackup(string path)
        {
            using (var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                // The extra byte detects oversized backups without loading an arbitrary file into memory.
                byte[] bytes = new byte[SaveFileLimit + 1];
                int length = 0;
                int count;
                while (length < bytes.Length && (count = input.Read(bytes, length, bytes.Length - length)) > 0)
                    length += count;
                if (length > SaveFileLimit) throw new IOException("Backup too large");
                return new UTF8Encoding(false, true).GetString(bytes, 0, length);
            }
        }

        private async Task SendSaveFileResultAsync(int id, string status, string text)
        {
            if (isClosing || IsDisposed || webView.CoreWebView2 == null ||
                !GamePagePolicy.IsAllowed(webView.CoreWebView2.Source, gameUri)) return;
            string encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(text));
            string script = "window.KingPongSaveTransfer && window.KingPongSaveTransfer.receive("
                + id.ToString(CultureInfo.InvariantCulture) + ",'" + status + "','" + encoded + "');";
            try
            {
                await webView.CoreWebView2.ExecuteScriptAsync(script);
            }
            catch (Exception)
            {
                // The user may close the window while a picker or file read is pending.
            }
        }

        private void RequestExitFromGame()
        {
            // The page may send both a WebMessage and window.close(). Exit only once.
            if (exitRequested || IsDisposed || Disposing)
            {
                return;
            }

            exitRequested = true;

            // Defer Close/Dispose until WebView2 has returned from its callback.
            if (IsHandleCreated)
            {
                BeginInvoke(new Action(() => { if (!IsDisposed) Close(); }));
            }
        }

        private void ApplyFullscreen()
        {
            if (isFullscreen)
            {
                return;
            }

            windowedBounds = Bounds;
            windowedBorderStyle = FormBorderStyle;
            isFullscreen = true;

            SuspendLayout();
            WindowState = FormWindowState.Normal;
            FormBorderStyle = FormBorderStyle.None;
            Rectangle targetBounds = Screen.FromControl(this).Bounds;
            Bounds = targetBounds;
            TopMost = false;
            ResumeLayout(true);
        }

        private void RestoreWindowed()
        {
            if (!isFullscreen)
            {
                return;
            }

            isFullscreen = false;
            SuspendLayout();
            FormBorderStyle = windowedBorderStyle == FormBorderStyle.None ? FormBorderStyle.Sizable : windowedBorderStyle;
            Bounds = windowedBounds.Width > 0 && windowedBounds.Height > 0
                ? windowedBounds
                : new Rectangle(80, 80, 1280, 960);
            ResumeLayout(true);
        }

        private void ToggleFullscreen()
        {
            if (isFullscreen)
            {
                RestoreWindowed();
            }
            else
            {
                ApplyFullscreen();
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs args)
        {
            base.OnFormClosing(args);
            if (!args.Cancel) isClosing = true;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                isClosing = true;
                // Controls are disposed by Form; do not dispose the web view twice.
                Icon = null;
                if (ownedIcon != null) ownedIcon.Dispose();
                ownedIcon = null;
            }
            base.Dispose(disposing);
        }
    }
}
