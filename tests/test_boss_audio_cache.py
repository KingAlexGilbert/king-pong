import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('boss_audio',ROOT/'Linux/src/king_pong_audio.py')
audio=importlib.util.module_from_spec(spec);spec.loader.exec_module(audio)
class Response:
    status=200
    def __init__(self,data):self.data=data;self.offset=0
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def read(self,size):
        chunk=self.data[self.offset:self.offset+size];self.offset+=len(chunk);return chunk
class Opener:
    def __init__(self,data):self.data=data;self.calls=0
    def open(self,url,timeout):
        assert url==audio.URL and timeout==4
        self.calls+=1;return Response(self.data)
class BossAudioCacheTests(unittest.TestCase):
    def setUp(self):self.asset=(ROOT/'docs/audio/secret-boss-v1.ogg').read_bytes()
    def test_native_and_js_manifests_agree(self):
        self.assertTrue(audio.valid(self.asset))
        for name in ['game/boss-audio.js','windows/webview-2/BossAudioCache.cs','android/app/src/main/java/com/kingalex/kingpong/BossAudioCache.java']:
            text=(ROOT/name).read_text();self.assertIn(audio.SHA256,text);self.assertIn(str(audio.SIZE),text);self.assertIn(audio.URL,text)
    def test_download_then_persistent_offline_cache(self):
        opener=Opener(self.asset)
        with tempfile.TemporaryDirectory() as d,patch.object(audio.urllib.request,'build_opener',return_value=opener):
            self.assertEqual(audio.load_track(d),self.asset);self.assertEqual(audio.load_track(d),self.asset);self.assertEqual(opener.calls,1)
    def test_corrupt_cache_replaced_oversized_download_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'secret-boss-v1.ogg';path.write_bytes(b'bad')
            with patch.object(audio.urllib.request,'build_opener',return_value=Opener(self.asset)):self.assertEqual(audio.load_track(d),self.asset)
            path.unlink()
            with patch.object(audio.urllib.request,'build_opener',return_value=Opener(self.asset+b'bad')):
                with self.assertRaises(ValueError):audio.load_track(d)
            self.assertFalse(path.exists())
    def test_invalid_bridge_requests_never_download(self):
        cache=audio.BossAudioCache(lambda *args:self.fail('unexpected callback'))
        with patch.object(audio,'load_track',side_effect=AssertionError('unexpected fetch')):
            for request in ['../x','https://other.invalid','x'*33,'']:cache.load(request)
if __name__=='__main__':unittest.main()
