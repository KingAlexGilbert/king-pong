"""Optional native-core integration; skips are explicit, never substitute JS for a native runtime."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('lan_interop', ROOT / 'tools/test-lan-interop.py')
interop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(interop)


@unittest.skipUnless(sys.platform == 'win32', 'Windows C# LAN core requires native Windows/.NET Framework')
class WindowsLanCoreTests(unittest.TestCase):
    def test_production_windows_core_discovery_admission_signaling_and_kick(self):
        compiler = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
        if not compiler.is_file():
            self.skipTest('Install .NET Framework 4.x C# build tools to run the Windows LAN integration')
        with tempfile.TemporaryDirectory() as directory:
            executable = str(Path(directory) / 'LanDriver.exe')
            subprocess.run([str(compiler), '/nologo', '/r:System.Web.Extensions.dll', '/out:' + executable,
                            str(ROOT / 'windows/webview-2/LocalLan.cs'), str(ROOT / 'tests/fixtures/LanDriver.cs')],
                           check=True, capture_output=True, text=True, timeout=30)
            interop.check([executable], [executable])


class AndroidJavaLanCoreTests(unittest.TestCase):
    def test_production_java_core_and_available_linux_interop(self):
        classpath = os.environ.get('KING_PONG_JAVA_LAN_CLASSPATH')
        if not classpath:
            self.skipTest('Set KING_PONG_JAVA_LAN_CLASSPATH to compiled LocalLan/LanDriver plus org.json to run Java LAN integration')
        java = shutil.which('java')
        if not java:
            self.fail('KING_PONG_JAVA_LAN_CLASSPATH is set but Java is unavailable')
        driver = [java, '-Djava.net.preferIPv4Stack=true', '-cp', classpath, 'com.kingalex.kingpong.LanDriver']
        interop.check(driver, driver)
        if sys.platform.startswith('linux'):
            python = [sys.executable, str(ROOT / 'tests/fixtures/lan-driver.py')]
            interop.check(python, driver)
            interop.check(driver, python)
