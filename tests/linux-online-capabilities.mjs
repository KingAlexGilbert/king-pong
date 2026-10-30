import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const online = readFileSync(new URL('../game/online.js', import.meta.url), 'utf8');
const launcher = readFileSync(new URL('../Linux/src/king-pong.py', import.meta.url), 'utf8');
const helper = online.match(/^function onlineCapabilityError\(environment = globalThis\) \{[\s\S]*?^\}/m)?.[0];

function diagnose(environment) {
  assert.ok(helper, 'online capability helper must be present');
  const context = vm.createContext({environment});
  return vm.runInContext(helper + '\nonlineCapabilityError(environment)', context);
}

test('online capability gate does not reject otherwise capable engines without RTCPeerConnection', () => {
  assert.equal(diagnose({WebSocket: class {}, crypto: {subtle: {}}, isSecureContext: true}), '');
});

test('online errors distinguish missing WebSocket from missing Web Crypto', () => {
  assert.match(diagnose({crypto: {subtle: {}}, isSecureContext: true}), /WebSocket/);
  assert.match(diagnose({WebSocket: class {}, crypto: {}, isSecureContext: true}), /crypto\.subtle/);
  assert.match(diagnose({WebSocket: class {}, crypto: {}, isSecureContext: false}), /not a secure context/);
});

test('Linux WebKitGTK requests WebRTC separately from camera permissions without disabling security', () => {
  assert.match(launcher, /\("enable-media-stream", True\)/);
  assert.match(launcher, /\("enable-webrtc", True\)/);
  assert.match(launcher, /\("allow-file-access-from-file-urls", False\)/);
  assert.doesNotMatch(launcher, /\("disable-web-security", True\)/);
});
