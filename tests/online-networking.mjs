import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { harness as gameHarness } from './helpers/royal-harness.mjs';

const source = readFileSync(new URL('../docs/demo/online.js', import.meta.url), 'utf8');
const transport = source.slice(0, source.indexOf('let onlineSession = null;'));
function harness() {
  const timers = new Map();
  const intervals = new Map();
  let nextId = 0;
  const statuses = [], errors = [], peers = [];
  let ready = 0, interrupted = 0, resumed = 0;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    send(value) { this.sent.push(value === 'ping' ? value : JSON.parse(value)); }
    close() { this.readyState = 3; }
  }
  class Channel {
    readyState = 'connecting';
    open() { this.readyState = 'open'; this.onopen?.(); }
    close() { this.readyState = 'closed'; this.onclose?.(); }
  }
  class Peer {
    added = [];
    channels = [];
    constructor(config) { this.config = config; peers.push(this); }
    createDataChannel(label, options) { const channel = new Channel(); channel.label = label; channel.options = options; this.channels.push(channel); return channel; }
    async createOffer() { return { type: 'offer', sdp: 'host' }; }
    async createAnswer() { return { type: 'answer', sdp: 'guest' }; }
    async setLocalDescription(desc) { this.localDescription = { ...desc, toJSON: () => desc }; }
    async setRemoteDescription(desc) { if (desc.sdp === 'broken') throw new Error('raw private SDP failure'); this.remoteDescription = desc; }
    async addIceCandidate(candidate) { this.added.push(candidate); }
    close() { this.closed = true; }
    state(value) { this.connectionState = value; this.onconnectionstatechange?.(); }
  }
  const context = vm.createContext({
    URL, WebSocket: Socket, RTCPeerConnection: Peer, Date,
    setTimeout: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: fn => { const id = ++nextId; intervals.set(id, fn); return id; },
    clearInterval: id => intervals.delete(id)
  });
  const Room = vm.runInContext(transport + '\nKingPongRoom', context);
  const room = new Room('https://signal.example', {
    status: value => statuses.push(value), error: value => errors.push(value), welcome() {}, peer() {}, channel() {}, message() {},
    connected: () => ready++, interrupted: () => interrupted++, resumed: () => resumed++
  });
  return {
    room, statuses, errors, peers,
    get ready() { return ready; }, get interrupted() { return interrupted; }, get resumed() { return resumed; },
    async message(data) { room.socket.onmessage({ data: JSON.stringify(data) }); await room.queue; },
    fire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } },
    timers, intervals
  };
}
const direct = { type: 'start', attempt: 0, iceServers: [{ urls: 'stun:stun.example' }] };
const relay = { type: 'start', attempt: 1, iceServers: [{ urls: 'turn:turn.example', username: 'temporary', credential: 'temporary' }] };

test('online scripts parse and all new user-facing messages have every supported translation', () => {
  for (const name of ['online.js', 'online-config.js', 'online-localization.js']) new vm.Script(readFileSync(new URL('../docs/demo/' + name, import.meta.url), 'utf8'));
  const context = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(new URL('../docs/demo/online-localization.js', import.meta.url), 'utf8'), context);
  const tables = context.window.KING_PONG_ONLINE_TRANSLATIONS;
  const keys = Object.keys(tables.es);
  for (const language of ['es', 'fr', 'de', 'pt', 'it', 'nl', 'ja', 'ko', 'zh']) assert.deepEqual(Object.keys(tables[language]), keys);
  const errors = source.match(/const ONLINE_ERRORS = (\{[\s\S]*?\n\});/)[1];
  const messages = vm.runInNewContext('(' + errors + ')');
  for (const message of Object.values(messages)) for (const language of Object.keys(tables)) assert.ok(tables[language][message]);
});

test('opening timeout cleans up the socket and every timer', () => {
  const h = harness(); h.room.open('host'); h.room.socket.onopen(); h.fire(12000);
  assert.deepEqual(h.errors, ['timeout']);
  assert.equal(h.room.socket.readyState, 3);
  assert.equal(h.timers.size, 0); assert.equal(h.intervals.size, 0);
});

test('ICE arriving before the offer is queued, then applied before answering', async () => {
  const h = harness(); h.room.open('guest'); await h.message(direct);
  const candidate = { candidate: 'candidate:early', sdpMid: '0', sdpMLineIndex: 0 };
  await h.message({ type: 'candidate', attempt: 0, candidate });
  assert.equal(h.peers[0].added.length, 0);
  await h.message({ type: 'description', attempt: 0, description: { type: 'offer', sdp: 'valid' } });
  assert.equal(h.peers[0].added[0].candidate, candidate.candidate);
  assert.equal(h.room.socket.sent.at(-1).description.type, 'answer');
  h.room.close();
});

test('direct timeout requests TURN once, recreates only the peer, rejects stale candidates, then times out', async () => {
  const h = harness(); h.room.open('host');
  await h.message({ type: 'welcome', role: 'host', code: 'ABCDE' });
  assert.equal(h.timers.size, 0);
  await h.message(direct);
  h.fire(8000); h.room.relay();
  assert.equal(h.room.socket.sent.filter(m => m.type === 'relay').length, 1);
  await h.message(relay);
  assert.equal(h.peers[0].closed, true);
  assert.equal(h.peers[1].config.iceTransportPolicy, 'relay');
  await h.message({ type: 'candidate', attempt: 0, candidate: { candidate: 'stale' } });
  assert.equal(h.room.candidates.length, 0);
  h.fire(45000);
  assert.deepEqual(h.errors, ['timeout']);
});

test('connection is ready only after both channels; transient ICE disconnect can recover', async () => {
  const h = harness(); h.room.open('host'); await h.message(direct);
  const peer = h.peers[0];
  peer.channels[0].open(); assert.equal(h.ready, 0);
  peer.channels[1].open(); assert.equal(h.ready, 1);
  assert.equal(peer.channels[0].options.ordered, false);
  assert.equal(peer.channels[1].options, undefined);
  peer.state('disconnected'); assert.equal(h.interrupted, 1);
  peer.state('connected'); assert.equal(h.resumed, 1);
  h.fire(8000); assert.deepEqual(h.errors, []);
  peer.channels[0].close(); h.fire(250);
  assert.deepEqual(h.errors, ['guest_left']);
});

test('negotiation rejection exposes no raw error, and cancellation prevents late setup', async () => {
  const h = harness(); h.room.open('guest'); await h.message(direct);
  await h.message({ type: 'description', attempt: 0, description: { type: 'offer', sdp: 'broken' } });
  assert.deepEqual(h.errors, ['negotiation_failed']);
  const pending = harness(); pending.room.open('host');
  const work = pending.message(direct); pending.room.close(); await work;
  assert.equal(pending.peers.length, 0);
  assert.deepEqual(pending.errors, []);
});

test('authoritative state and input reject duplicate/out-of-order packets', () => {
  const h = gameHarness();
  h.run(`
    const snapshot=seq=>({type:'state',seq,rules:matchRulePayload(),leftScore:0,rightScore:0});
    handleLanGuestMessage(snapshot(12));handleLanGuestMessage(snapshot(11));handleLanGuestMessage(snapshot(12));
    handleLanHostMessage({type:'input',seq:12,axis:1,targetY:200});handleLanHostMessage({type:'input',seq:11,axis:-1,targetY:100});`);
  assert.deepEqual(h.json('applied'), [12]);
  assert.equal(h.run('lanRemoteInput.targetY'), 200);
});
