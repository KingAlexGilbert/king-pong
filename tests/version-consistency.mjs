// Run with Node 18+: node --test tests/version-consistency.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function requireMatch(text, pattern, label) {
  const match = text.match(pattern);
  assert.ok(match, `Could not read ${label}`);
  return match[1];
}

test('release version metadata stays consistent across Android, Windows, and Linux', () => {
  const androidGradle = source('../android/app/build.gradle.kts');
  const expected = requireMatch(androidGradle, /versionName\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)"/, 'Android versionName');
  const numeric = `${expected}.0`;

  const csproj = source('../windows/webview-2/KingPongWebView2.csproj');
  assert.equal(requireMatch(csproj, /<Version>([^<]+)<\/Version>/, 'Windows Version'), expected);
  assert.equal(requireMatch(csproj, /<AssemblyVersion>([^<]+)<\/AssemblyVersion>/, 'Windows AssemblyVersion'), numeric);
  assert.equal(requireMatch(csproj, /<FileVersion>([^<]+)<\/FileVersion>/, 'Windows FileVersion'), numeric);
  assert.equal(requireMatch(csproj, /<InformationalVersion>([^<]+)<\/InformationalVersion>/, 'Windows InformationalVersion'), expected);

  const manifest = source('../windows/webview-2/app.manifest');
  assert.equal(requireMatch(manifest, /<assemblyIdentity\s+version="([^"]+)"/, 'Windows manifest version'), numeric);

  for (const [path, label] of [
    ['../windows/webview-2/build-windows.bat', 'Windows portable build version'],
    ['../windows/installer exe/build-installer.bat', 'Windows installer build version'],
  ]) {
    const batch = source(path);
    assert.equal(requireMatch(batch, /set "KINGPONG_VERSION=([^"]+)"/, label), expected);
  }

  const debianControl = source('../Linux/debian/control');
  assert.equal(requireMatch(debianControl, /^Version:\s*([^\s]+)$/m, 'Linux package version'), expected);

  const linuxLauncher = source('../Linux/src/king-pong.py');
  assert.equal(requireMatch(linuxLauncher, /launcher for King Pong ([0-9]+\.[0-9]+\.[0-9]+)/, 'Linux launcher version'), expected);
});
