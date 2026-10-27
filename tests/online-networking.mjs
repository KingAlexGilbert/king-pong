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
    constructor(url) { this.url = new URL(url); }
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
    byId: () => null, saveConfirmation: null, TextEncoder, URL, WebSocket: Socket, RTCPeerConnection: Peer, Date, crypto, sessionStorage: {getItem: () => null, setItem() {}},
    setTimeout: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: fn => { const id = ++nextId; intervals.set(id, fn); return id; },
    clearInterval: id => intervals.delete(id)
  });
  const Room = vm.runInContext(transport + readFileSync(new URL('../game/pairing.js', import.meta.url), 'utf8') + readFileSync(new URL('../game/approval-pairing.js', import.meta.url), 'utf8') + '\nKingPongRoom', context);
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
  for (const key of ['Your opponent disconnected', 'Return to Menu']) assert.ok(keys.includes(key));
  for (const language of ['es', 'fr', 'de', 'pt', 'it', 'nl', 'ja', 'ko', 'zh']) {
    assert.deepEqual(Object.keys(tables[language]), keys);
    for (const key of keys) assert.ok(typeof tables[language][key] === 'string' && tables[language][key].length, `${language}: ${key}`);
  }
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
  await h.message({ type: 'welcome', role: 'host', code: 'ABCDEF', protocol: 'kp-party-1', capacity: 2 });
  assert.equal(h.timers.size, 0);
  await h.message(direct);
  h.fire(8000); h.room.relay();
  assert.equal(h.room.socket.sent.filter(m => m.type === 'relay').length, 1);
  await h.message(relay);
  assert.equal(h.peers[0].closed, true);
  assert.equal(h.peers[1].config.iceTransportPolicy, 'all');
  await h.message({ type: 'candidate', attempt: 0, candidate: { candidate: 'stale' } });
  assert.equal(h.room.candidates.length, 0);
  h.fire(45000);
  assert.deepEqual(h.errors, ['timeout']);
});

test('connection waits for both channels; a departed guest leaves the managed host room open', async () => {
  const h = harness(); h.room.open('host'); await h.message(direct);
  const peer = h.peers[0];
  peer.channels[0].open(); assert.equal(h.ready, 0);
  peer.channels[1].open(); assert.equal(h.ready, 0);
  peer.state('connected'); assert.equal(h.ready, 1); assert.equal(h.resumed, 0);
  assert.equal(peer.channels[0].options.ordered, false);
  assert.equal(peer.channels[1].options, undefined);
  peer.state('disconnected'); assert.equal(h.interrupted, 0);
  peer.state('connected'); assert.equal(h.resumed, 0);
  h.room.presence={lastHeard:Date.now()};
  peer.state('disconnected'); h.fire(3000); assert.equal(h.interrupted,0,'recent validated LAN traffic outweighs ICE state');
  h.room.presence=null; h.fire(3000); assert.equal(h.interrupted, 1);
  peer.state('connected'); assert.equal(h.resumed, 1);
  h.fire(8000); assert.deepEqual(h.errors, []);
  peer.channels[0].close(); h.fire(250);
  assert.deepEqual(h.errors, [], 'RTC close must not preempt the server departure event');
  assert.equal(h.room.closed, false);
  peer.state('disconnected'); // A queued ICE event can follow the channel close.
  await h.message({type:'departed', slot:1, reason:'guest_left'});
  h.fire(8000);
  assert.deepEqual(h.errors, []);
  assert.equal(h.room.connected, false);
  assert.equal(h.room.socket.readyState, 1);
  await h.message(direct);
  assert.equal(h.peers.length, 2, 'a replacement guest can use the retained room');
  const replacement = h.peers[1];
  replacement.state('connected'); replacement.channels.forEach(channel => channel.open());
  replacement.state('disconnected');
  assert.ok(h.room.disconnectTimer, 'replacement peer gets its own stabilization timer');
  h.room.close();
});

test('RTC channel errors and failed ICE also wait for managed host departure', async () => {
  for (const failure of ['channel-error', 'ice-failed']) {
    const h = harness(); h.room.open('host'); await h.message(direct);
    const peer = h.peers[0]; peer.state('connected'); peer.channels.forEach(channel => channel.open());
    if (failure === 'channel-error') peer.channels[1].onerror();
    else peer.state('failed');
    h.fire(250);
    assert.deepEqual(h.errors, [], failure + ' prematurely closed the reusable host room');
    assert.equal(h.interrupted, 1);
    await h.message({type:'departed', slot:1, reason:'guest_left'});
    h.fire(8000);
    assert.equal(h.room.socket.readyState, 1);
    assert.deepEqual(h.errors, []);
    h.room.close();
  }
});

test('a missing managed-room departure event fails safely after a bounded wait', async () => {
  const h = harness(); h.room.open('host'); await h.message(direct);
  const peer = h.peers[0]; peer.state('connected'); peer.channels.forEach(channel => channel.open());
  peer.channels[0].close(); h.fire(250);
  assert.deepEqual(h.errors, []);
  h.fire(8000);
  assert.deepEqual(h.errors, ['connection_lost']);
  assert.equal(h.room.closed, true);
  assert.equal(h.timers.size, 0);
});

test('peer connecting first still waits for the reliable control channel', async () => {
  const h = harness(); h.room.open('host'); await h.message(direct);
  const peer = h.peers[0];
  peer.state('connected'); peer.channels[0].open(); assert.equal(h.ready, 0);
  peer.channels[1].open(); assert.equal(h.ready, 1);
  h.room.maybeConnected(peer); assert.equal(h.ready, 1);
  h.room.close();
});

test('kicking a private guest preserves the host room when RTC closes before the server acknowledgement', async () => {
  const h = harness(); h.room.open('host'); await h.message(direct);
  const peer = h.peers[0];
  peer.state('connected'); peer.channels.forEach(channel => channel.open());
  let departed = 0; h.room.hooks.departed = () => departed++;
  h.room.kickGuest(); h.room.kickGuest();
  assert.equal(h.room.socket.sent.filter(m => m.type === 'kick').length, 1);
  peer.channels[0].close(); peer.channels[1].onerror(); peer.state('failed');
  h.fire(250);
  assert.deepEqual(h.errors, []); assert.equal(h.room.closed, false);
  await h.message({type:'departed',slot:1,reason:'kicked'});
  h.fire(8000);
  assert.deepEqual(h.errors, []); assert.equal(departed, 1);
  assert.equal(h.room.connected, false); assert.equal(h.room.socket.readyState, 1);
  await h.message(direct);
  assert.equal(h.peers.length, 2, 'another guest can connect using the retained host room');
  h.room.close();
});

test('a lost kick acknowledgement times out rather than leaving a stuck moderation state', async () => {
  const h = harness(); h.room.open('host'); await h.message(direct);
  const peer=h.peers[0];peer.state('connected');peer.channels.forEach(channel=>channel.open());
  h.room.kickGuest();h.fire(8000);
  assert.deepEqual(h.errors,['timeout']);assert.equal(h.room.closed,true);
  assert.equal(h.timers.size,0);
});

test('closing during an interruption does not leave a late disconnect timer', async () => {
  const h = harness(); h.room.open('host'); await h.message(direct);
  h.room.hooks.interrupted = () => h.room.close();
  h.peers[0].state('disconnected'); h.fire(3000);
  assert.equal(h.timers.size, 0);
  assert.equal(h.room.closed, true);
  const pending=harness();pending.room.open('host');pending.room.socket.onopen();
  const staleOpen=pending.room.socket.onopen;
  pending.room.socket.close=()=>{pending.room.socket.readyState=2;};
  let complete=false;const closed=pending.room.close().then(()=>complete=true);
  staleOpen();await pending.room.receive(direct);await Promise.resolve();
  assert.equal(complete,false,'network shutdown waits for WebSocket close completion');
  assert.equal(pending.intervals.size,0);assert.equal(pending.peers.length,0,'late signaling cannot create a peer');
  pending.room.socket.readyState=3;pending.room.socket.onclose();await closed;
  assert.equal(complete,true);
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


test('private approval uses versioned signaling; old unverified servers fail before ICE', async () => {
  const ordinary = harness(); ordinary.room.requireApproval = false; ordinary.room.open('host');
  assert.match(ordinary.room.socket.url.pathname, /^\/v1\/party\/create\/2\/0\/.*\/sas2$/); ordinary.room.close();
  const legacy = harness(); legacy.room.open('guest', 'ABCDE'); assert.equal(legacy.room.socket.url.pathname, '/v1/join/ABCDE'); legacy.room.close();
  const host = harness(); host.room.requireApproval = true; host.room.open('host');
  assert.match(host.room.socket.url.pathname, /^\/v1\/party\/create\/2\/1\/[a-f0-9-]{36}\/sas2$/);
  await host.message({type:'welcome',role:'host',code:'ABCDEF',protocol:'kp-party-1',capacity:2});
  assert.deepEqual(host.errors,['server_outdated']); assert.equal(host.peers.length,0);
  const guest=harness();guest.room.open('guest','ABCDEF');
  await guest.message({type:'welcome',role:'guest',code:'ABCDEF',protocol:'kp-party-1',capacity:2,pending:true,verification:'sas1',request:crypto.randomUUID()});
  assert.equal(guest.peers.length,0);assert.equal(guest.statuses.at(-1),'Waiting for host approval...');
  await guest.message(direct);
  assert.deepEqual(guest.errors,['negotiation_failed']);assert.equal(guest.peers.length,0);
});

test('successful ICE keeps the direct route while channels open; genuine failure still falls back', async () => {
  for(const state of ['connected','completed']) {
    const h=harness();h.room.open('host');await h.message(direct);
    const peer=h.peers[0];peer.iceConnectionState=state;peer.oniceconnectionstatechange();
    h.fire(8000);assert.equal(h.room.socket.sent.some(m=>m.type==='relay'),false);
    assert.equal(h.ready,0);peer.state('connected');peer.channels.forEach(c=>c.open());
    assert.equal(h.ready,1);h.room.close();
  }
  const h=harness();h.room.open('host');await h.message(direct);
  h.peers[0].state('failed');assert.equal(h.room.socket.sent.filter(m=>m.type==='relay').length,1);h.room.close();
});
