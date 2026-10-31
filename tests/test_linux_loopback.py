"""Security and lifecycle checks for the Linux-only loopback asset server."""

import importlib.util
from http.client import HTTPConnection
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("king_pong_launcher", ROOT / "Linux/src/king-pong.py")
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LocalGameServerTests(unittest.TestCase):
    def setUp(self):
        self.server = launcher.LocalGameServer(ROOT / "Linux/assets/index.html", port=0)
        self.server.start()
        self.port = self.server.httpd.server_port
        self.host = f"127.0.0.1:{self.port}"
        self.path = self.server.url.split(self.host, 1)[1]

    def tearDown(self):
        self.server.stop()

    def request(self, method, path, headers=None):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=3)
        conn.request(method, path, headers={"Host": self.host, **(headers or {})})
        resp = conn.getresponse()
        body = resp.read()
        result = (resp.status, dict(resp.getheaders()), body)
        conn.close()
        return result

    def test_serves_one_html_asset_without_exposing_cors_or_disk(self):
        status, headers, body = self.request("GET", self.path)
        self.assertEqual(status, 200)
        self.assertIn(b"King Pong", body)
        self.assertEqual(headers.get("Content-Type"), "text/html; charset=utf-8")
        self.assertEqual(headers.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(headers.get("X-Frame-Options"), "DENY")
        self.assertEqual(headers.get("Referrer-Policy"), "no-referrer")
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(self.request("GET", "/etc/passwd")[0], 404)
        self.assertEqual(self.request("GET", "/")[0], 404)
        self.assertEqual(self.request("POST", self.path)[0], 405)

    def test_rejects_cross_origin_and_wrong_host(self):
        self.assertEqual(self.request("GET", self.path, {"Host": "evil.example"})[0], 404)
        self.assertEqual(self.request("GET", self.path, {"Origin": "https://evil.example"})[0], 404)
        self.assertEqual(self.request("GET", self.path, {"Origin": "null"})[0], 404)
        self.assertEqual(self.request("GET", self.path + "?debug=1")[0], 404)
        self.assertEqual(self.request("GET", "/play/not-the-token/index.html")[0], 404)

    def test_loopback_only_and_shutdown(self):
        self.assertEqual(self.server.httpd.server_address[0], "127.0.0.1")
        self.assertTrue(self.server.url.startswith("http://127.0.0.1:"))
        self.server.stop()
        self.server.stop()
        with self.assertRaises(OSError):
            connection = HTTPConnection("127.0.0.1", self.port, timeout=1)
            connection.request("GET", self.path)
            connection.getresponse()


if __name__ == "__main__":
    unittest.main()
