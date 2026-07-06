# No third-party libraries are used in the optimized wrapper.
# Keep only the tiny JavaScript bridge methods that the HTML polls for battery state.
-keepclassmembers class com.kingalex.kingpong.MainActivity$BatteryBridge {
    @android.webkit.JavascriptInterface <methods>;
}
