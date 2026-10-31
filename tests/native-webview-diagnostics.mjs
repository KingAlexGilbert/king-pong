import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const windows = readFileSync(new URL('../windows/webview-2/Program.cs', import.meta.url), 'utf8');
const android = readFileSync(new URL('../android/app/src/main/java/com/kingalex/kingpong/MainActivity.java', import.meta.url), 'utf8');
const gradle = readFileSync(new URL('../android/app/build.gradle.kts', import.meta.url), 'utf8');

test('Windows DevTools and browser accelerator keys are controlled by an explicit launch flag', () => {
  assert.match(windows, /Main\(string\[\] args\)/);
  assert.match(windows, /Array\.Exists\(args, arg =>/);
  assert.match(windows, /string\.Equals\(arg, "--debug-online", StringComparison\.Ordinal\)/);
  assert.match(windows, /new KingPongForm\(debugOnline\)/);
  assert.match(windows, /settings\.AreDevToolsEnabled = debugOnline;/);
  assert.match(windows, /settings\.AreBrowserAcceleratorKeysEnabled = debugOnline;/);
  assert.match(windows, /settings\.AreHostObjectsAllowed = false;/);
});

test('Android WebView inspection is gated by the application debug flag', () => {
  assert.match(android, /WebView\.setWebContentsDebuggingEnabled\(/);
  assert.match(android, /getApplicationInfo\(\)\.flags & ApplicationInfo\.FLAG_DEBUGGABLE/);
  assert.match(gradle, /debug \{\s*isDebuggable = true/);
  assert.match(gradle, /release \{\s*isDebuggable = false/);
  assert.match(android, /settings\.setAllowUniversalAccessFromFileURLs\(false\)/);
  assert.match(android, /settings\.setMixedContentMode\(WebSettings\.MIXED_CONTENT_NEVER_ALLOW\)/);
});
