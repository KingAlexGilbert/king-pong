import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = (ROOT / "Linux" / "src" / "king-pong.py").read_text(encoding="utf-8")


class LinuxAudioTests(unittest.TestCase):
    def test_webkit_audio_keep_alive_flag_is_injected(self):
        self.assertIn("window.KingPongLinuxWebKitAudioKeepAlive = true;", LAUNCHER)


if __name__ == "__main__":
    unittest.main()
