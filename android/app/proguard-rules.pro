# No third-party libraries are used in the optimized wrapper.
# Keep the JavaScript entry points for save-file pickers.
-keepclassmembers class com.kingalex.kingpong.MainActivity$SaveFileBridge {
    @android.webkit.JavascriptInterface <methods>;
}
