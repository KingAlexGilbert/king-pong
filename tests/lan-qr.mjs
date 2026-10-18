import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {root, functionSource} from './helpers/game-source.mjs';
const local = readFileSync(new URL('game/local-lan.js', root), 'utf8');
const qr = readFileSync(new URL('game/lan-qr.js', root), 'utf8');
const manual = readFileSync(new URL('game/multiplayer-safety.js', root), 'utf8');
const decode = manual.slice(manual.indexOf('  decode(text,'), manual.indexOf('  async accept('));
const context = vm.createContext({atob, btoa});
vm.runInContext(`const LAN_QR_LIMIT=2200; class KingPongManualRoom { ${decode} }
  ${functionSource(local, 'localLanInvitation')}
  ${functionSource(local, 'parseLocalLanInvitation')}
  ${functionSource(qr, 'validateLanQr')}`, context);
const validate = context.validateLanQr;
test('QR transfer accepts only existing native invitations and manual offer/answer envelopes', () => {
  const native = context.localLanInvitation('192.168.1.12', 45873, 'a'.repeat(32), 'ABCD23');
  assert.equal(validate(native).kind, 'native');
  for (const type of ['offer', 'answer']) {
    const text = btoa(JSON.stringify({protocol: 'kp-lan-two-1', room: 'ABCDE', nonce: 'a'.repeat(36), description: {type, sdp: 'v=0\r\n'}}));
    assert.equal(validate(text).kind, type);
  }
});
test('QR transfer rejects URLs, public endpoints, zero ports, oversized and malformed data', () => {
  for (const text of [null, '', 'https://example.com', 'javascript:alert(1)', 'A'.repeat(2201), btoa('{}'),
    context.localLanInvitation('8.8.8.8', 443, 'a'.repeat(32), 'ABCD23'),
    context.localLanInvitation('192.168.1.12', 0, 'a'.repeat(32), 'ABCD23')]) assert.equal(validate(text), null);
});
