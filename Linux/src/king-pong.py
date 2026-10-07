#!/usr/bin/python3
"""GTK 3 / WebKitGTK launcher for King Pong 2.0.0."""

import os
import sys
import traceback
import base64
import tempfile
import math
from pathlib import Path
from urllib.parse import urldefrag

SAFE_RENDERER = "--safe-renderer" in sys.argv
PROBE_ONLY = "--probe" in sys.argv
GTK_ARGV = [
    arg for arg in sys.argv
    if arg not in {"--safe-renderer", "--probe"}
]

# Use accelerated GPU/DMA-BUF rendering by default. The opt-in safe renderer
# disables DMA-BUF for systems that need WebKitGTK compatibility rendering.
if SAFE_RENDERER:
    os.environ["WEBKIT_DISABLE_DMABUF_RENDERER"] = "1"

GAME_PATH = Path(os.environ.get("KING_PONG_GAME_PATH", "/usr/share/king-pong/index.html"))
ICON_PATH = Path(os.environ.get("KING_PONG_ICON_PATH", "/usr/share/pixmaps/king-pong.png"))
SAVE_FILE_LIMIT = 64 * 1024


def battery_state_from_properties(properties):
    """Normalize UPower's aggregate display device, excluding peripherals."""
    present = properties.get("IsPresent")
    if present is False:
        return -1, False, False
    if present is not True or properties.get("Type") not in (2, 3):
        return -1, False, None
    percentage = properties.get("Percentage")
    state = properties.get("State")
    if (type(percentage) not in (int, float) or not math.isfinite(percentage)
            or not 0 <= percentage <= 100 or state not in (1, 2, 3, 4, 5, 6)):
        return -1, False, True
    return int(percentage + 0.5), state in (1, 4), True


class UPowerBatteryMonitor:
    """Read once, then receive D-Bus property changes on GTK's main loop."""

    def __init__(self, Gio, publish):
        self.Gio = Gio
        self.publish = publish
        self.cancellable = Gio.Cancellable()
        self.proxy = None
        self.handlers = []
        self.previous = None
        self.started = False
        self.closed = False

    def start(self):
        if self.started or self.closed:
            return
        self.started = True
        # UPower aggregates laptop packs/UPS devices here. Gio maintains the
        # cache and watches service restarts; there is no application timer.
        self.Gio.DBusProxy.new_for_bus(
            self.Gio.BusType.SYSTEM,
            self.Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES,
            None, "org.freedesktop.UPower",
            "/org/freedesktop/UPower/devices/DisplayDevice",
            "org.freedesktop.UPower.Device", self.cancellable,
            self._on_ready, None)

    def _on_ready(self, _source, result, _user_data=None):
        try:
            proxy = self.Gio.DBusProxy.new_for_bus_finish(result)
        except Exception as exc:
            if not self.closed:
                print(f"Battery status unavailable: {exc}", file=sys.stderr)
                self._publish((-1, False, None))
            return
        if self.closed:
            return
        self.proxy = proxy
        self.handlers = [
            proxy.connect("g-properties-changed", self._refresh),
            proxy.connect("notify::g-name-owner", self._refresh),
        ]
        self._refresh()

    def _refresh(self, *_args):
        if self.closed or self.proxy is None:
            return
        # A vanished power service does not mean the computer has no battery.
        if not self.proxy.get_name_owner():
            self._publish((-1, False, None))
            return
        properties = {}
        for name in ("IsPresent", "Type", "Percentage", "State"):
            value = self.proxy.get_cached_property(name)
            if value is not None:
                properties[name] = value.unpack()
        self._publish(battery_state_from_properties(properties))

    def _publish(self, state):
        if not self.closed and state != self.previous:
            self.previous = state
            self.publish(state)

    def stop(self):
        if self.closed:
            return
        self.closed = True
        self.cancellable.cancel()
        if self.proxy is not None:
            for handler in self.handlers:
                self.proxy.disconnect(handler)
        self.handlers = []
        self.proxy = None


def battery_result_script(state):
    level, charging, present = state
    if type(level) is not int or not -1 <= level <= 100 or type(charging) is not bool or (present is not None and type(present) is not bool):
        raise ValueError("Invalid battery state")
    present_js = "null" if present is None else ("true" if present else "false")
    return ("window.KingPongBattery && window.KingPongBattery.update("
            f"{level},{'true' if charging else 'false'},{present_js});")


def parse_save_request(message):
    if not isinstance(message, str) or len(message) > SAVE_FILE_LIMIT + 64:
        raise ValueError("Invalid save request")
    parts = message.split(":", 4)
    if len(parts) < 4 or parts[:2] != ["kingpong", "save"]:
        raise ValueError("Invalid save request")
    operation = parts[2]
    request_id = int(parts[3])
    if request_id <= 0 or request_id > 2147483647 or operation not in {"export", "import"}:
        raise ValueError("Invalid save request")
    if len(parts) != (5 if operation == "export" else 4):
        raise ValueError("Invalid save request")
    text = parts[4] if operation == "export" else ""
    if len(text.encode("utf-8")) > SAVE_FILE_LIMIT:
        raise ValueError("Backup too large")
    return request_id, operation, text


def read_save_backup(path):
    with open(path, "rb") as source:
        data = source.read(SAVE_FILE_LIMIT + 1)
    if len(data) > SAVE_FILE_LIMIT:
        raise ValueError("Backup too large")
    return data.decode("utf-8")


def write_save_backup(path, text):
    data = text.encode("utf-8")
    if len(data) > SAVE_FILE_LIMIT:
        raise ValueError("Backup too large")
    destination = Path(path)
    temporary = None
    try:
        # Stage beside the destination so replacing an existing backup stays atomic on one filesystem.
        with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".kingpong-save-", delete=False) as output:
            temporary = output.name
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, destination)
        temporary = None
    finally:
        if temporary is not None:
            os.unlink(temporary)


def save_result_script(request_id, status, text=""):
    if not isinstance(request_id, int) or request_id <= 0 or status not in {"ok", "cancel", "error"}:
        raise ValueError("Invalid save result")
    encoded = base64.b64encode(text.encode("utf-8")).decode("ascii")
    return ("window.KingPongSaveTransfer && window.KingPongSaveTransfer.receive("
            f"{request_id},'{status}','{encoded}');")


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
    """Request accelerated compositing across supported WebKitGTK API variants."""
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

    from gi.repository import GLib, Gio
    game_base_uri = GAME_PATH.resolve().as_uri()
    manager = WebKit2.UserContentManager.new()
    # Mark this packaged runtime so the shared game HTML can use the Linux WebKitGTK audio keep-alive only here.
    try:
        linux_audio_script = WebKit2.UserScript.new(
            "window.KingPongLinuxWebKitAudioKeepAlive = true;",
            WebKit2.UserContentInjectedFrames.TOP_FRAME,
            WebKit2.UserScriptInjectionTime.START,
            [],
            [],
        )
        manager.add_script(linux_audio_script)
    except Exception as exc:
        print(f"Linux audio compatibility injection warning: {exc}", file=sys.stderr)
    save_file_busy = False
    battery_closed = False
    battery_state = (-1, False, None)
    battery_page_ready = False

    def send_battery_state():
        if not battery_closed and battery_page_ready and urldefrag(webview.get_uri() or "")[0] == game_base_uri:
            try:
                webview.run_javascript(battery_result_script(battery_state), None, None, None)
            except Exception as exc:
                print(f"Battery status delivery failed: {exc}", file=sys.stderr)

    def publish_battery_state(state):
        nonlocal battery_state
        if battery_closed:
            return
        battery_state = state
        send_battery_state()

    battery_monitor = UPowerBatteryMonitor(Gio, publish_battery_state)

    def on_battery_page_load(_view, event):
        nonlocal battery_page_ready
        if event == WebKit2.LoadEvent.STARTED:
            battery_page_ready = False
        elif event == WebKit2.LoadEvent.FINISHED:
            battery_page_ready = True
            send_battery_state()

    def send_save_result(request_id, status, text=""):
        try:
            if urldefrag(webview.get_uri() or "")[0] == game_base_uri:
                webview.run_javascript(save_result_script(request_id, status, text), None, None, None)
        except Exception as exc:
            print(f"Save result delivery failed: {exc}", file=sys.stderr)

    def choose_save_file(request_id, operation, text):
        nonlocal save_file_busy
        dialog = None
        try:
            if urldefrag(webview.get_uri() or "")[0] != game_base_uri:
                return False
            exporting = operation == "export"
            dialog = Gtk.FileChooserNative.new(
                "Export King Pong saves" if exporting else "Import King Pong saves",
                window, Gtk.FileChooserAction.SAVE if exporting else Gtk.FileChooserAction.OPEN,
                "Save" if exporting else "Open", "Cancel")
            dialog.set_local_only(True)
            save_filter = Gtk.FileFilter()
            save_filter.set_name("King Pong saves (*.json)")
            save_filter.add_pattern("*.json")
            dialog.add_filter(save_filter)
            if exporting:
                dialog.set_current_name("KingPong-saves.json")
                dialog.set_do_overwrite_confirmation(True)
            else:
                all_filter = Gtk.FileFilter()
                all_filter.set_name("All files")
                all_filter.add_pattern("*")
                dialog.add_filter(all_filter)
            if dialog.run() != Gtk.ResponseType.ACCEPT:
                send_save_result(request_id, "cancel")
                return False
            path = dialog.get_filename()
            if not path:
                raise ValueError("No file selected")
            if exporting:
                # Keep the exact selected path so overwrite confirmation applies to it.
                write_save_backup(path, text)
                send_save_result(request_id, "ok")
            else:
                send_save_result(request_id, "ok", read_save_backup(path))
        except Exception as exc:
            print(f"Save file operation failed: {exc}", file=sys.stderr)
            send_save_result(request_id, "error")
        finally:
            if dialog is not None:
                dialog.destroy()
            save_file_busy = False
            webview.grab_focus()
        return False

    bridge_registered = False
    try:
        bridge_registered = bool(manager.register_script_message_handler("kingpong"))
    except Exception as exc:
        print(f"Message bridge registration warning: {exc}", file=sys.stderr)

    if bridge_registered:
        def on_script_message(_manager, message):
            nonlocal save_file_busy
            if urldefrag(webview.get_uri() or "")[0] != game_base_uri:
                return
            try:
                value = message.get_js_value()
                if not value.is_string():
                    return
                text = value.to_string()
                if text == "kingpong:exit":
                    window.destroy()
                    return
                request_id, operation, payload = parse_save_request(text)
            except (ValueError, TypeError):
                return
            if save_file_busy:
                send_save_result(request_id, "error")
                return
            save_file_busy = True
            # Open the modal dialog after the WebKit message event returns.
            GLib.idle_add(choose_save_file, request_id, operation, payload)

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
                WebKit2.UserContentInjectedFrames.TOP_FRAME,
                WebKit2.UserScriptInjectionTime.START,
                [],
                [],
            )
            manager.add_script(script)
        except Exception as exc:
            print(f"Message bridge injection warning: {exc}", file=sys.stderr)

    webview = WebKit2.WebView.new_with_user_content_manager(manager)
    webview.connect("load-changed", on_battery_page_load)

    def on_decide_policy(_view, decision, policy_type):
        if policy_type == WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION:
            decision.ignore()
            return True
        if policy_type == WebKit2.PolicyDecisionType.NAVIGATION_ACTION:
            if urldefrag(decision.get_request().get_uri() or "")[0] != game_base_uri:
                decision.ignore()
                return True
        return False

    webview.connect("decide-policy", on_decide_policy)
    settings = webview.get_settings()

    for property_name, value in (
        ("enable-javascript", True),
        ("enable-webaudio", True),
        ("enable-webgl", True),
        ("enable-accelerated-2d-canvas", True),
        ("media-playback-requires-user-gesture", False),
        ("allow-file-access-from-file-urls", False),
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
        nonlocal battery_closed
        battery_closed = True
        battery_monitor.stop()
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

    battery_monitor.start()
    try:
        Gtk.main()
    finally:
        battery_closed = True
        battery_monitor.stop()
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
