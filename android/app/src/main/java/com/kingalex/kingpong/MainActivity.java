package com.kingalex.kingpong;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String GAME_URL = "file:///android_asset/index.html";
    private static final int SAVE_FILE_LIMIT = 64 * 1024;
    private static final int REQUEST_EXPORT_SAVES = 4101;
    private static final int REQUEST_IMPORT_SAVES = 4102;
    private final ExecutorService saveFileExecutor = Executors.newSingleThreadExecutor();
    private int saveFileRequestId;
    private String pendingSaveExport;
    private WebView webView;
    private boolean batteryReceiverRegistered;
    private boolean batteryPageReady;
    private int batteryLevel = -1;
    private boolean batteryCharging;
    private int batteryPresence = -1;
    private String lastBatteryScript;
    private final BroadcastReceiver batteryReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (batteryReceiverRegistered && intent != null && Intent.ACTION_BATTERY_CHANGED.equals(intent.getAction())) {
                acceptBatteryIntent(intent);
            }
        }
    };

    @Override
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);
        allowDisplayCutoutInLandscape();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.setKeepScreenOn(true);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setHapticFeedbackEnabled(false);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setTextZoom(100);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        // Packaged android_asset files still work with filesystem access disabled.
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }
        WebView.setWebContentsDebuggingEnabled(false);

        webView.addJavascriptInterface(new SaveFileBridge(), "KingPongSaveFiles");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new LocalOnlyWebViewClient());
        setContentView(webView);

        hideSystemUi();
        webView.loadUrl(GAME_URL);
        webView.requestFocus();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
            webView.requestFocus();
        }
        startBatteryMonitoring();
        hideSystemUi();
    }

    @Override
    protected void onPause() {
        stopBatteryMonitoring();
        if (webView != null) {
            webView.onPause();
            webView.pauseTimers();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        stopBatteryMonitoring();
        saveFileExecutor.shutdown();
        if (webView != null) {
            webView.stopLoading();
            webView.removeJavascriptInterface("KingPongSaveFiles");
            if (webView.getParent() instanceof ViewGroup) {
                ((ViewGroup) webView.getParent()).removeView(webView);
            }
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void startBatteryMonitoring() {
        if (batteryReceiverRegistered) return;
        IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        Intent snapshot;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            snapshot = registerReceiver(batteryReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            snapshot = registerReceiver(batteryReceiver, filter);
        }
        batteryReceiverRegistered = true;
        // The sticky broadcast supplies the current state immediately on resume.
        acceptBatteryIntent(snapshot);
    }

    private void stopBatteryMonitoring() {
        if (!batteryReceiverRegistered) return;
        batteryReceiverRegistered = false;
        unregisterReceiver(batteryReceiver);
    }

    private void acceptBatteryIntent(Intent intent) {
        batteryPresence = intent != null && intent.hasExtra(BatteryManager.EXTRA_PRESENT)
                ? (intent.getBooleanExtra(BatteryManager.EXTRA_PRESENT, false) ? 1 : 0) : -1;
        int level = intent == null ? -1 : intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = intent == null ? -1 : intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        batteryLevel = batteryPresence != 0 && level >= 0 && scale > 0
                ? Math.max(0, Math.min(100, Math.round(level * 100f / scale))) : -1;
        int status = intent == null ? -1 : intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        batteryCharging = batteryPresence != 0 && (status == BatteryManager.BATTERY_STATUS_CHARGING
                || status == BatteryManager.BATTERY_STATUS_FULL);
        sendBatteryState();
    }

    private void sendBatteryState() {
        if (!batteryPageReady || !batteryReceiverRegistered || webView == null ||
                !isGameUrl(Uri.parse(webView.getUrl() == null ? "" : webView.getUrl()))) return;
        String presence = batteryPresence < 0 ? "null" : (batteryPresence == 1 ? "true" : "false");
        String script = "window.KingPongBattery && window.KingPongBattery.update("
                + batteryLevel + "," + batteryCharging + "," + presence + ");";
        if (script.equals(lastBatteryScript)) return;
        lastBatteryScript = script;
        webView.evaluateJavascript(script, null);
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        // Let Back cancel the in-game confirmation before leaving the app.
        webView.evaluateJavascript(
                "Boolean(window.KingPongSaveTransfer && window.KingPongSaveTransfer.cancelConfirmation())",
                handled -> {
                    if (isFinishing() || isDestroyed() || "true".equals(handled)) return;
                    navigateBackOrExit();
                });
    }

    private void navigateBackOrExit() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemUi();
        }
    }

    public final class SaveFileBridge {
        @JavascriptInterface
        public void postMessage(String message) {
            if (message == null || message.length() > SAVE_FILE_LIMIT + 64) return;
            // Bridge calls arrive off the UI thread; the picker rechecks the page after the handoff.
            runOnUiThread(() -> openSaveFilePicker(message));
        }
    }

    private void openSaveFilePicker(String message) {
        if (webView == null || !isGameUrl(Uri.parse(webView.getUrl() == null ? "" : webView.getUrl()))) return;
        String[] parts = message.split(":", 5);
        if (parts.length < 4 || !"kingpong".equals(parts[0]) || !"save".equals(parts[1])) return;
        final int id;
        try {
            id = Integer.parseInt(parts[3]);
        } catch (NumberFormatException error) {
            return;
        }
        if (id <= 0) return;
        boolean exporting = "export".equals(parts[2]);
        if (saveFileRequestId != 0 || (!exporting && !"import".equals(parts[2])) ||
                parts.length != (exporting ? 5 : 4)) {
            sendSaveFileResult(id, "error", "");
            return;
        }
        String text = exporting ? parts[4] : null;
        if (exporting && text.getBytes(StandardCharsets.UTF_8).length > SAVE_FILE_LIMIT) {
            sendSaveFileResult(id, "error", "");
            return;
        }
        saveFileRequestId = id;
        pendingSaveExport = text;
        Intent intent = new Intent(exporting ? Intent.ACTION_CREATE_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        // Import accepts providers that label JSON as text or octet-stream too.
        intent.setType(exporting ? "application/json" : "*/*");
        if (exporting) intent.putExtra(Intent.EXTRA_TITLE, "KingPong-saves.json");
        try {
            startActivityForResult(intent, exporting ? REQUEST_EXPORT_SAVES : REQUEST_IMPORT_SAVES);
        } catch (RuntimeException error) {
            finishSaveFileRequest(id, "error", "");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_EXPORT_SAVES && requestCode != REQUEST_IMPORT_SAVES) return;
        final int id = saveFileRequestId;
        if (id == 0) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            finishSaveFileRequest(id, "cancel", "");
            return;
        }
        final Uri uri = data.getData();
        final String exportText = pendingSaveExport;
        // A document provider may block, so file I/O must not stall the WebView or activity.
        saveFileExecutor.execute(() -> {
            try {
                String imported = "";
                if (requestCode == REQUEST_EXPORT_SAVES) {
                    if (exportText == null) throw new IOException("No backup to export");
                    try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                        if (output == null) throw new IOException("Cannot open save file");
                        output.write(exportText.getBytes(StandardCharsets.UTF_8));
                    }
                } else {
                    try (InputStream input = getContentResolver().openInputStream(uri);
                         ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                        if (input == null) throw new IOException("Cannot open save file");
                        byte[] buffer = new byte[4096];
                        int count;
                        while ((count = input.read(buffer)) != -1) {
                            if (output.size() + count > SAVE_FILE_LIMIT) throw new IOException("Backup too large");
                            output.write(buffer, 0, count);
                        }
                        imported = new String(output.toByteArray(), StandardCharsets.UTF_8);
                    }
                }
                final String result = imported;
                runOnUiThread(() -> finishSaveFileRequest(id, "ok", result));
            } catch (IOException | RuntimeException error) {
                runOnUiThread(() -> finishSaveFileRequest(id, "error", ""));
            }
        });
    }

    private void finishSaveFileRequest(int id, String status, String text) {
        // Ignore a late result if it no longer belongs to the active picker request.
        if (saveFileRequestId != id) return;
        saveFileRequestId = 0;
        pendingSaveExport = null;
        sendSaveFileResult(id, status, text);
        hideSystemUi();
    }

    private void sendSaveFileResult(int id, String status, String text) {
        if (webView == null || !isGameUrl(Uri.parse(webView.getUrl() == null ? "" : webView.getUrl()))) return;
        String encoded = Base64.encodeToString(text.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        webView.evaluateJavascript("window.KingPongSaveTransfer && window.KingPongSaveTransfer.receive("
                + id + ",'" + status + "','" + encoded + "');", null);
    }

    private void allowDisplayCutoutInLandscape() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attributes);
        }
    }

    private void hideSystemUi() {
        View decorView = getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = decorView.getWindowInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
            return;
        }

        decorView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    private final class LocalOnlyWebViewClient extends WebViewClient {
        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            batteryPageReady = false;
            lastBatteryScript = null;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            batteryPageReady = isGameUrl(url == null ? null : Uri.parse(url));
            sendBatteryState();
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            // Keep the native bridge on the bundled game, including fragment links.
            return !request.isForMainFrame() || !isGameUrl(uri);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return !isGameUrl(url == null ? null : Uri.parse(url));
        }

    }

    private static boolean isGameUrl(Uri uri) {
        return uri != null && GAME_URL.equals(uri.buildUpon().fragment(null).build().toString());
    }
}
