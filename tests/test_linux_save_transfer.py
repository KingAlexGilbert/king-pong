"""Run: python3 -m unittest discover -s tests -p 'test_*.py'"""
import base64
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

source = Path(__file__).resolve().parents[1] / "Linux/src/king-pong.py"
spec = importlib.util.spec_from_file_location("king_pong", source)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LinuxSaveTransferTests(unittest.TestCase):
    def test_messages_preserve_json_colons_and_unicode(self):
        text = '{"time":"12:30","note":"日本語"}'
        self.assertEqual(launcher.parse_save_request("kingpong:save:export:12:" + text), (12, "export", text))
        self.assertEqual(launcher.parse_save_request("kingpong:save:import:13"), (13, "import", ""))

    def test_malformed_requests(self):
        for text in (None, "kingpong:exit", "kingpong:save:erase:1", "kingpong:save:import:0",
                     "kingpong:save:import:2147483648", "kingpong:save:import:1:extra",
                     "kingpong:save:export:1", "kingpong:save:export:1:" + "é" * 40000):
            with self.subTest(text=str(text)[:60]), self.assertRaises((ValueError, TypeError)):
                launcher.parse_save_request(text)

    def test_file_round_trip_and_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "backup.json"
            launcher.write_save_backup(path, '{"note":"日本語"}')
            self.assertEqual(launcher.read_save_backup(path), '{"note":"日本語"}')
            launcher.write_save_backup(path, '{}')
            self.assertEqual(path.read_bytes(), b'{}')
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_read_rejects_large_or_invalid_utf8_files(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "backup.json"
            for data in (b'x' * 65537, b'\xff'):
                path.write_bytes(data)
                with self.assertRaises((ValueError, UnicodeError)):
                    launcher.read_save_backup(path)

    def test_failed_export_preserves_existing_backup_and_cleans_temporary_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "backup.json"
            path.write_text('original')
            with patch.object(launcher.os, 'replace', side_effect=OSError('write failed')):
                with self.assertRaises(OSError):
                    launcher.write_save_backup(path, 'replacement')
            self.assertEqual(path.read_text(), 'original')
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_callback_only_contains_base64_file_data(self):
        text = "');alert('test');//日本語"
        script = launcher.save_result_script(3, 'ok', text)
        self.assertNotIn(text, script)
        self.assertIn(base64.b64encode(text.encode()).decode(), script)
        self.assertIn("receive(3,'ok','", script)
        with self.assertRaises(ValueError):
            launcher.save_result_script(3, "malformed'", text)


if __name__ == '__main__':
    unittest.main()
