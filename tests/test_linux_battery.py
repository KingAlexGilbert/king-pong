"""UPower state and subscription tests; no hardware or GTK required."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

source = Path(__file__).resolve().parents[1] / "Linux/src/king-pong.py"
spec = importlib.util.spec_from_file_location("king_pong_battery", source)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


def properties(**overrides):
    return {"IsPresent": True, "Type": 2, "Percentage": 73.2, "State": 2, **overrides}


class BatteryTests(unittest.TestCase):
    def test_charging_and_full_states(self):
        for state, charging in ((1, True), (2, False), (3, False), (4, True), (5, False), (6, False)):
            self.assertEqual(launcher.battery_state_from_properties(properties(State=state)), (73, charging, True))

    def test_zero_charge_and_rounding(self):
        for percentage, expected in ((0, 0), (49.49, 49), (49.5, 50), (99.9, 100), (100, 100)):
            self.assertEqual(launcher.battery_state_from_properties(properties(Percentage=percentage)), (expected, False, True))

    def test_absent_battery_overrides_stale_percentage(self):
        self.assertEqual(launcher.battery_state_from_properties(properties(IsPresent=False, State=1)), (-1, False, False))

    def test_unknown_presence_does_not_hide_indicator(self):
        for data in ({}, {"Percentage": 0}, properties(IsPresent=None), properties(IsPresent="true")):
            self.assertEqual(launcher.battery_state_from_properties(data), (-1, False, None))

    def test_ups_supported_and_peripherals_excluded(self):
        self.assertEqual(launcher.battery_state_from_properties(properties(Type=3)), (73, False, True))
        for device_type in (0, 1, 5, 6):
            self.assertEqual(launcher.battery_state_from_properties(properties(Type=device_type)), (-1, False, None))

    def test_invalid_level_is_unavailable(self):
        for value in (None, "bad", float("nan"), float("inf"), -1, 101, True):
            self.assertEqual(launcher.battery_state_from_properties(properties(Percentage=value)), (-1, False, True))

    def test_unknown_device_state_is_unavailable(self):
        for state in (None, 0, 7, "charging"):
            self.assertEqual(launcher.battery_state_from_properties(properties(State=state)), (-1, False, True))

    def test_script_accepts_only_numeric_and_boolean_state(self):
        self.assertIn("update(42,true,true)", launcher.battery_result_script((42, True, True)))
        self.assertIn("update(-1,false,false)", launcher.battery_result_script((-1, False, False)))
        self.assertIn("update(-1,false,null)", launcher.battery_result_script((-1, False, None)))
        for state in (("0);alert(1)", False, True), (101, False, True), (True, False, True), (20, "yes", True), (20, False, "yes")):
            with self.subTest(state=state), self.assertRaises(ValueError):
                launcher.battery_result_script(state)


class FakeProxy:
    def __init__(self):
        self.owner = ":1.42"
        self.properties = properties()
        self.callbacks = {}
        self.sequence = 0

    def get_name_owner(self):
        return self.owner

    def get_cached_property(self, name):
        if name not in self.properties:
            return None
        return SimpleNamespace(unpack=lambda: self.properties[name])

    def connect(self, signal, callback):
        self.sequence += 1
        self.callbacks[self.sequence] = (signal, callback)
        return self.sequence

    def disconnect(self, handler):
        del self.callbacks[handler]

    def emit(self, signal):
        for name, callback in list(self.callbacks.values()):
            if name == signal:
                callback(self, None, None)


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.proxy = FakeProxy()
        self.updates = []
        self.calls = []
        self.cancellable = SimpleNamespace(cancelled=False)
        self.cancellable.cancel = lambda: setattr(self.cancellable, "cancelled", True)
        self.Gio = SimpleNamespace(
            Cancellable=lambda: self.cancellable,
            BusType=SimpleNamespace(SYSTEM=1),
            DBusProxyFlags=SimpleNamespace(GET_INVALIDATED_PROPERTIES=8),
            DBusProxy=SimpleNamespace(new_for_bus=lambda *args: self.calls.append(args),
                                     new_for_bus_finish=lambda result: self.proxy))
        self.monitor = launcher.UPowerBatteryMonitor(self.Gio, self.updates.append)
        self.monitor.start()

    def complete(self):
        self.calls[0][-2](None, object(), None)

    def test_initial_read_then_changed_values_only(self):
        self.assertEqual(self.updates, [])
        self.complete()
        self.assertEqual(self.updates, [(73, False, True)])
        self.proxy.emit("g-properties-changed")
        self.assertEqual(len(self.updates), 1)
        self.proxy.properties["State"] = 1
        self.proxy.emit("g-properties-changed")
        self.assertEqual(self.updates[-1], (73, True, True))
        self.monitor.start()
        self.assertEqual(len(self.calls), 1)

    def test_removal_and_addition(self):
        self.complete()
        self.proxy.properties["IsPresent"] = False
        self.proxy.emit("g-properties-changed")
        self.assertEqual(self.updates[-1], (-1, False, False))
        self.proxy.properties["IsPresent"] = True
        self.proxy.emit("g-properties-changed")
        self.assertEqual(self.updates[-1], (73, False, True))

    def test_service_loss_and_restart(self):
        self.complete()
        self.proxy.owner = None
        self.proxy.emit("notify::g-name-owner")
        self.assertEqual(self.updates[-1], (-1, False, None))
        self.proxy.owner = ":1.43"
        self.proxy.properties["Percentage"] = 40
        self.proxy.emit("notify::g-name-owner")
        self.assertEqual(self.updates[-1], (40, False, True))

    def test_initially_unavailable_service_appears_later(self):
        self.proxy.owner = None
        self.complete()
        self.assertEqual(self.updates, [(-1, False, None)])
        self.proxy.owner = ":1.42"
        self.proxy.emit("notify::g-name-owner")
        self.assertEqual(self.updates[-1], (73, False, True))

    def test_invalidated_percentage_does_not_become_zero(self):
        self.complete()
        del self.proxy.properties["Percentage"]
        self.proxy.emit("g-properties-changed")
        self.assertEqual(self.updates[-1], (-1, False, True))

    def test_stop_disconnects_and_ignores_late_notifications(self):
        self.complete()
        self.monitor.stop()
        self.assertTrue(self.cancellable.cancelled)
        self.assertEqual(self.proxy.callbacks, {})
        self.monitor._refresh()
        self.monitor.stop()
        self.assertEqual(len(self.updates), 1)

    def test_stop_during_startup_discards_late_result(self):
        self.monitor.stop()
        self.complete()
        self.assertEqual(self.updates, [])
        self.assertEqual(self.proxy.callbacks, {})


if __name__ == '__main__':
    unittest.main()
