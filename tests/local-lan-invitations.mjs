import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {root, functionSource} from './helpers/game-source.mjs';

const source = readFileSync(new URL('game/local-lan.js', root), 'utf8');
const context = vm.createContext({btoa, atob});
vm.runInContext(functionSource(source, 'localLanInvitation') + '\n' +
  functionSource(source, 'parseLocalLanInvitation'), context);
const encode = context.localLanInvitation, decode = context.parseLocalLanInvitation;

test('compact direct invitations round-trip complete temporary room authorization', () => {
  for (const [address, port] of [['192.168.1.12', 45873], ['10.0.0.25', 1024], ['169.254.10.20', 65535]]) {
    const room = '0123456789abcdef0123456789abcdef', code = 'ABCD23';
    const invitation = encode(address, port, room, code);
    assert.equal(invitation.length, 42);
    assert.match(invitation, /^KP1-[A-Za-z0-9_-]+$/);
    assert.deepEqual(JSON.parse(JSON.stringify(decode(invitation))), {address, port, room, code});
  }
});

test('malformed, truncated and unrelated pairing text does not become a native target', () => {
  const invitation = encode('192.168.1.12', 45873, 'a'.repeat(32), 'ABCD23');
  for (const text of ['', 'ABCD23', '192.168.1.12:45873', 'https://example.com',
    invitation.slice(0, -1), invitation + 'x', invitation.replace('KP1-', 'KP2-'), 'KP1-' + 'A'.repeat(38)]) {
    assert.equal(decode(text), null);
  }
});
