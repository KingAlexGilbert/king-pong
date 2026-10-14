import test from 'node:test';
import assert from 'node:assert/strict';
import {PartyRoom} from '../signaling/src/party-room.js';

function fixture() {
  const sockets = [0, 1].map(slot => {
    let attachment = {party: true, slot, token: `token-${slot}`, joinedAt: Date.now(), windowAt: Date.now(), count: 0, closed: false};
    return {
      sent: [], closed: false,
      deserializeAttachment() { return attachment; },
      serializeAttachment(value) { attachment = value; },
      send(raw) { this.sent.push(JSON.parse(raw)); },
      close() { this.closed = true; }
    };
  });
  const room = {code:'ABCDE2', capacity:2, peers:{1:{attempt:0,host:false,guest:false}}, blocked:[], started:false, expiresAt:Date.now()+60_000};
  const storage = {get: async () => room, put: async () => {}, deleteAll: async () => {}, deleteAlarm: async () => {}};
  const ctx = {getWebSockets: () => sockets, storage, blockConcurrencyWhile: fn => fn()};
  return {party:new PartyRoom(ctx,{}), room, sockets};
}

test('two-player private room accepts reciprocal host/guest signaling', async () => {
  const {party, sockets} = fixture();
  const candidate = {candidate:'candidate:1 1 udp 1 10.0.0.2 12345 typ host',sdpMid:'0',sdpMLineIndex:0};
  await party.receive(sockets[1], JSON.stringify({type:'candidate',to:0,attempt:0,candidate}));
  assert.equal(sockets[0].sent.at(-1).type,'candidate');
  assert.equal(sockets[0].sent.at(-1).from,1);
  await party.receive(sockets[0], JSON.stringify({type:'candidate',to:1,attempt:0,candidate}));
  assert.equal(sockets[1].sent.at(-1).from,0);
});

test('two-player private room rejects nonexistent third participant slot', async () => {
  const {party,sockets} = fixture();
  await party.receive(sockets[0], JSON.stringify({type:'connected',to:2,attempt:0}));
  assert.equal(sockets[0].sent.at(-1).code,'unauthorized');
  assert.equal(sockets[0].closed,true);
});
