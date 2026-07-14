using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
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
            Application.Run(new KingPongForm());
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
                // Fall through to the older API below.
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
        private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

        [DllImport("shcore.dll")]
        private static extern int SetProcessDpiAwareness(PROCESS_DPI_AWARENESS awareness);
    }

    public sealed class KingPongForm : Form
    {
        private readonly WebView2 webView;
        private Rectangle windowedBounds;
        private FormBorderStyle windowedBorderStyle;
        private bool isFullscreen;
        private bool exitRequested;

        public KingPongForm()
        {
            Text = "King Pong Desktop HD";
            BackColor = Color.Black;
            KeyPreview = true;
            TryApplyAppIcon();
            StartPosition = FormStartPosition.Manual;
            WindowState = FormWindowState.Normal;
            ShowInTaskbar = true;
            MinimumSize = new Size(960, 720);

            webView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = Color.Black
            };
            Controls.Add(webView);

            Load += async (sender, args) => await InitializeWebViewAsync();
            Shown += (sender, args) => ApplyFullscreen();
            FormClosing += (sender, args) => DisposeWebView();
        }


        private void TryApplyAppIcon()
        {
            try
            {
                string iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "king_pong.ico");
                if (File.Exists(iconPath))
                {
                    Icon = new Icon(iconPath);
                }
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
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string htmlPath = Path.Combine(baseDir, "index.html");

            if (!File.Exists(htmlPath))
            {
                MessageBox.Show(
                    "index.html was not found next to the EXE. Keep the whole WebView2 app folder together.",
                    "King Pong Desktop HD",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                Close();
                return;
            }

            string profileDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "KingPong",
                "WebView2Profile");
            Directory.CreateDirectory(profileDir);

            string browserArgs = string.Join(" ", new[]
            {
                "--autoplay-policy=no-user-gesture-required",
                "--disable-features=msWebOOUI,msPdfOOUI",
                "--disable-pinch"
            });

            CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions(browserArgs);
            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, profileDir, options);
            await webView.EnsureCoreWebView2Async(environment);
            webView.ZoomFactor = 1.0;

            CoreWebView2Settings settings = webView.CoreWebView2.Settings;
            settings.AreDefaultContextMenusEnabled = false;
            settings.AreDevToolsEnabled = false;
            settings.IsStatusBarEnabled = false;
            settings.AreBrowserAcceleratorKeysEnabled = false;
            settings.IsZoomControlEnabled = false;
            settings.IsWebMessageEnabled = true;

            // The HTML Exit Game button posts the string "kingpong:exit".
            // Listen for that message and close the native WinForms window.
            webView.CoreWebView2.WebMessageReceived += HandleWebMessageReceived;

            // window.close() in the HTML reaches this event in WebView2.
            // Supporting both paths keeps the Exit Game button reliable.
            webView.CoreWebView2.WindowCloseRequested += (sender, args) => RequestExitFromGame();

            webView.CoreWebView2.ProcessFailed += (sender, args) =>
            {
                MessageBox.Show(
                    "WebView2 stopped responding. Restart King Pong.",
                    "King Pong Desktop HD",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            };

            webView.CoreWebView2.Navigate(new Uri(htmlPath).AbsoluteUri);
        }

        private void HandleWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
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
        }

        private void RequestExitFromGame()
        {
            // The page may send both a WebMessage and window.close(). Exit only once.
            if (exitRequested || IsDisposed || Disposing)
            {
                return;
            }

            exitRequested = true;

            Action exitApplication = () =>
            {
                try
                {
                    Close();
                }
                finally
                {
                    // Close the WinForms message loop as well, so no hidden WebView2
                    // process or window keeps the packaged EXE running.
                    Application.Exit();
                }
            };

            if (InvokeRequired)
            {
                BeginInvoke(exitApplication);
            }
            else
            {
                exitApplication();
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

        private void DisposeWebView()
        {
            try
            {
                if (webView != null)
                {
                    webView.Dispose();
                }
            }
            catch
            {
                // Closing should not be blocked by disposal issues.
            }
        }
    }
}
