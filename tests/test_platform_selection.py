"""Exercise discovery as an unsupported platform without pretending to run Windows."""
import builtins
import importlib.util
from pathlib import Path
import socket
import sys
import unittest
from unittest.mock import patch


def load_tests_module(platform):
    spec = importlib.util.spec_from_file_location('lan_platform_fixture', Path(__file__).with_name('test_local_lan.py'))
    module = importlib.util.module_from_spec(spec)
    with patch.object(sys, 'platform', platform):
        spec.loader.exec_module(module)
    return module


class PlatformSelectionTests(unittest.TestCase):
    def test_unsupported_platforms_skip_only_native_linux_networking(self):
        original_import = builtins.__import__

        def portable_import(name, *args, **kwargs):
            if name == 'fcntl':
                raise AssertionError('unsupported Linux module imported')
            return original_import(name, *args, **kwargs)

        for platform in ('win32', 'darwin'):
            with self.subTest(platform=platform), patch('builtins.__import__', portable_import), patch.object(socket, 'socket', side_effect=AssertionError('native Linux network test ran')):
                module = load_tests_module(platform)
                suite = unittest.defaultTestLoader.loadTestsFromModule(module)
                result = unittest.TestResult()
                suite.run(result)
                self.assertEqual(result.testsRun, 11)
                self.assertEqual(len(result.skipped), 9)
                self.assertEqual(result.errors, [])
                self.assertEqual(result.failures, [])
                self.assertTrue(all('fcntl/ioctl' in reason for _, reason in result.skipped))

    def test_supported_platform_failures_are_not_skipped(self):
        module = load_tests_module('linux')
        case = module.LocalLanTests('test_real_discovery_and_two_way_signaling')
        with patch.object(module.LocalLanTests, 'setUp', side_effect=RuntimeError('real failure')):
            result = unittest.TestResult()
            case.run(result)
        self.assertEqual(len(result.errors), 1)
        self.assertEqual(result.skipped, [])
