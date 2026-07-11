#!/usr/bin/python3
"""GTK 3 / WebKitGTK launcher for King Pong 1.1.0."""

import os
import sys
import traceback
from pathlib import Path

SAFE_RENDERER = "--safe-renderer" in sys.argv
PROBE_ONLY = "--probe" in sys.argv
GTK_ARGV = [
    arg for arg in sys.argv
    if arg not in {"--safe-renderer", "--probe"}
]

# The previous package forced this globally, which made canvas animation very
# slow. Keep GPU/DMA-BUF rendering enabled by default. This opt-in fallback is
# only for systems that show a blank or corrupted WebKit window.
if SAFE_RENDERER:
    os.environ["WEBKIT_DISABLE_DMABUF_RENDERER"] = "1"

GAME_PATH = Path(os.environ.get("KING_PONG_GAME_PATH", "/usr/share/king-pong/index.html"))
ICON_PATH = Path(os.environ.get("KING_PONG_ICON_PATH", "/usr/share/pixmaps/king-pong.png"))


def load_gi():
    try:
        import gi
    except Exception as exc:
        raise RuntimeError(
            "Python GObject bindings are missing. Install python3-gi."
        ) from exc

    # WebKitGTK 4.0/4.1 uses GTK 3 and GDK 3.
    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")

    webkit_version = None
    errors = []
    for candidate in ("4.1", "4.0"):
        try:
            gi.require_version("WebKit2", candidate)
            webkit_version = candidate
            break
        except (ValueError, ImportError) as exc:
            errors.append(f"WebKit2 {candidate}: {exc}")

    if webkit_version is None:
        raise RuntimeError(
            "WebKitGTK introspection data is missing. Install "
            "gir1.2-webkit2-4.1 (Linux Mint 22/Ubuntu 24.04) or "
            "gir1.2-webkit2-4.0 (Linux Mint 21/Ubuntu 22.04).\n"
            + "\n".join(errors)
        )

    from gi.repository import Gdk, Gtk, WebKit2
    return Gdk, Gtk, WebKit2, webkit_version


def acceleration_policy_name(WebKit2, settings):
    try:
        policy = settings.get_hardware_acceleration_policy()
        return str(policy.value_nick if hasattr(policy, "value_nick") else policy)
    except Exception:
        return "unknown"


def enable_hardware_acceleration(WebKit2, settings):
    """Request accelerated compositing; tolerate older introspection APIs."""
    try:
        settings.set_hardware_acceleration_policy(
            WebKit2.HardwareAccelerationPolicy.ALWAYS
        )
        return True
    except Exception:
        try:
            settings.set_property(
                "hardware-acceleration-policy",
                WebKit2.HardwareAccelerationPolicy.ALWAYS,
            )
            return True
        except Exception as exc:
            print(f"Hardware-acceleration setting warning: {exc}", file=sys.stderr)
            return False


def probe():
    Gdk, Gtk, WebKit2, version = load_gi()
    print(
        f"GTK: {Gtk.get_major_version()}."
        f"{Gtk.get_minor_version()}."
        f"{Gtk.get_micro_version()}"
    )
    print(f"WebKitGTK API: {version}")
    try:
        print(
            "WebKitGTK library: "
            f"{WebKit2.get_major_version()}."
            f"{WebKit2.get_minor_version()}."
            f"{WebKit2.get_micro_version()}"
        )
    except Exception:
        pass
    print(f"Renderer mode: {'safe/software fallback' if SAFE_RENDERER else 'accelerated/default'}")
    print(
        "WEBKIT_DISABLE_DMABUF_RENDERER: "
        f"{os.environ.get('WEBKIT_DISABLE_DMABUF_RENDERER', 'unset')}"
    )
    print(f"Game HTML exists: {GAME_PATH.is_file()}")
    print(f"Icon exists: {ICON_PATH.is_file()}")
    ok, _argv = Gtk.init_check(GTK_ARGV)
    print(f"GTK display available: {bool(ok)}")
    if not ok:
        raise RuntimeError("GTK could not connect to the graphical display.")


def main():
    if PROBE_ONLY:
        probe()
        return 0

    Gdk, Gtk, WebKit2, version = load_gi()

    if not GAME_PATH.is_file():
        raise RuntimeError(f"The packaged game file is missing: {GAME_PATH}")

    ok, _argv = Gtk.init_check(GTK_ARGV)
    if not ok:
        raise RuntimeError(
            "GTK could not connect to the graphical desktop. "
            "Start King Pong from inside your desktop session."
        )

    window = Gtk.Window(title="King Pong")
    window.set_default_size(1280, 720)
    window.set_position(Gtk.WindowPosition.CENTER)
    try:
        window.set_wmclass("king-pong", "KingPong")
    except Exception:
        pass
    # Use both the icon-theme name and the absolute fallback file. The
    # matching WM_CLASS lets Cinnamon associate the running window with the
    # installed desktop entry instead of showing a generic application icon.
    try:
        window.set_icon_name("king-pong")
    except Exception as exc:
        print(f"Icon-name warning: {exc}", file=sys.stderr)
    if ICON_PATH.is_file():
        try:
            window.set_icon_from_file(str(ICON_PATH))
        except Exception as exc:
            print(f"Icon-file warning: {exc}", file=sys.stderr)

    manager = WebKit2.UserContentManager.new()

    bridge_registered = False
    try:
        bridge_registered = bool(manager.register_script_message_handler("kingpong"))
    except Exception as exc:
        print(f"Message bridge registration warning: {exc}", file=sys.stderr)

    if bridge_registered:
        def on_script_message(_manager, _message):
            Gtk.main_quit()
            window.destroy()

        manager.connect("script-message-received::kingpong", on_script_message)
        bridge_js = r"""
            (() => {
                window.chrome = window.chrome || {};
                window.chrome.webview = window.chrome.webview || {};
                window.chrome.webview.postMessage = function(message) {
                    window.webkit.messageHandlers.kingpong.postMessage(String(message));
                };
            })();
        """
        try:
            script = WebKit2.UserScript.new(
                bridge_js,
                WebKit2.UserContentInjectedFrames.ALL_FRAMES,
                WebKit2.UserScriptInjectionTime.START,
                [],
                [],
            )
            manager.add_script(script)
        except Exception as exc:
            print(f"Message bridge injection warning: {exc}", file=sys.stderr)

    webview = WebKit2.WebView.new_with_user_content_manager(manager)
    settings = webview.get_settings()

    for property_name, value in (
        ("enable-javascript", True),
        ("enable-webaudio", True),
        ("enable-webgl", True),
        ("enable-accelerated-2d-canvas", True),
        ("media-playback-requires-user-gesture", False),
        ("allow-file-access-from-file-urls", True),
    ):
        try:
            settings.set_property(property_name, value)
        except Exception as exc:
            print(f"Optional setting {property_name} unavailable: {exc}", file=sys.stderr)

    acceleration_requested = False
    if not SAFE_RENDERER:
        acceleration_requested = enable_hardware_acceleration(WebKit2, settings)

    try:
        black = Gdk.RGBA()
        black.parse("#000000")
        webview.set_background_color(black)
    except Exception as exc:
        print(f"Background-color warning: {exc}", file=sys.stderr)

    def close_game(*_args):
        try:
            Gtk.main_quit()
        finally:
            return False

    def on_webview_close(_webview):
        close_game()
        return True

    def on_key_press(_widget, event):
        ctrl = bool(event.state & Gdk.ModifierType.CONTROL_MASK)
        if ctrl and event.keyval in (Gdk.KEY_q, Gdk.KEY_Q):
            close_game()
            window.destroy()
            return True
        if event.keyval == Gdk.KEY_F11:
            state = window.get_window().get_state() if window.get_window() else 0
            if state & Gdk.WindowState.FULLSCREEN:
                window.unfullscreen()
            else:
                window.fullscreen()
            return True
        return False

    def on_load_failed(_view, _event, uri, error):
        print(f"Load failed for {uri}: {error}", file=sys.stderr)
        return False

    window.connect("destroy", close_game)
    window.connect("key-press-event", on_key_press)
    try:
        webview.connect("close", on_webview_close)
    except Exception as exc:
        print(f"WebView close-signal warning: {exc}", file=sys.stderr)
    try:
        webview.connect("load-failed", on_load_failed)
    except Exception:
        pass
    try:
        webview.connect("context-menu", lambda *_args: True)
    except Exception:
        pass

    window.add(webview)
    window.show_all()
    window.fullscreen()

    game_uri = GAME_PATH.resolve().as_uri() + "#kingpong_fullscreen=1"
    print(f"Using WebKitGTK API {version}", file=sys.stderr)
    print(
        f"Renderer: {'safe fallback' if SAFE_RENDERER else 'accelerated'}; "
        f"acceleration request accepted: {acceleration_requested}; "
        f"policy: {acceleration_policy_name(WebKit2, settings)}",
        file=sys.stderr,
    )
    print(f"Loading {game_uri}", file=sys.stderr)
    webview.load_uri(game_uri)
    webview.grab_focus()

    Gtk.main()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:
        print(f"King Pong failed to start: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        raise SystemExit(1)
