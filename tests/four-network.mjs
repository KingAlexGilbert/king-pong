import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read = file => readFileSync(new URL('../game/' + file, import.meta.url), 'utf8');
const common = vm.runInNewContext(read('network-common.js') + '\n({kingPongRoute, KingPongInputGate})');
test('route classification requires selected candidate-pair evidence and never exposes addresses', () => {
  const stats = (local, remote, selected = true) => new Map([
    ['t', {type: 'transport', ...(selected ? {selectedCandidatePairId: 'p'} : {})}],
    ['p', {type: 'candidate-pair', state: 'succeeded', nominated: selected, localCandidateId: 'l', remoteCandidateId: 'r'}], ['l', local], ['r', remote]
  ]);
  for (const [l, r, expected] of [
    [{candidateType: 'host', address: '192.168.1.2'}, {candidateType: 'host', address: '192.168.1.3'}, 'Direct (Local)'],
    [{candidateType: 'host', address: 'fd12::1'}, {candidateType: 'host', address: 'fd12::2'}, 'Direct (Local)'],
    [{candidateType: 'host', address: 'one.local'}, {candidateType: 'host', address: 'two.local'}, 'Unknown'],
    [{candidateType: 'relay'}, {candidateType: 'host'}, 'TURN Relay'],
    [{candidateType: 'host'}, {candidateType: 'srflx'}, 'Direct (Internet)'],
    [{candidateType: 'host', address: '8.8.8.8'}, {candidateType: 'host', address: '1.1.1.1'}, 'Direct (Internet)'],
    [{candidateType: 'host'}, {candidateType: 'host'}, 'Unknown'],
    [{candidateType: 'host', address: '127.0.0.1'}, {candidateType: 'host', address: '127.0.0.1'}, 'Unknown']
  ]) { assert.equal(common.kingPongRoute(stats(l, r)), expected); assert.equal(common.kingPongRoute(stats(l, r, false)), 'Unknown'); }
  assert.equal(common.kingPongRoute(new Map()), 'Unknown');
});
test('input gate drops replay, stale sequences and floods, but recovers after stalls without banning', () => {
  const gate = new common.KingPongInputGate();
  assert.equal(gate.accept(0, 0), true); assert.equal(gate.accept(0, 1), false); assert.equal(gate.accept(-1, 1), false);
  let accepted = 0; for (let i = 1; i <= 1000; i++) if (gate.accept(i, 1)) accepted++;
  assert.ok(accepted <= 240); assert.ok(gate.dropped > 700);
  assert.equal(gate.accept(1001, 10000), true);
  for (let i = 1002; i < 2002; i++) assert.equal(gate.accept(i, 10000 + (i - 1001) * 1000 / 60), true);
});
function harness(host) {
  let now = 1000;
  class Party { constructor(hooks) { this.hooks = hooks; this.peers = new Map(); this.sent = []; }
    data(slot, message, reliable) { this.sent.push({slot, message, reliable}); return true; } send(m) { this.sent.push(m); } close() { this.closed = true; } }
  const context = vm.createContext({ONLINE_ERRORS: {}, KingPongParty: class extends Party { constructor(base, hooks) { super(hooks); } },
    KingPongLanParty: Party, performance: {now: () => now}, Date, crypto, TextEncoder, window: {}, document: {hidden: false},
    paddleCatalog: [{id: 'classic'}], setInterval: () => 1, clearInterval() {}, clearHeldInput() {}, byId: () => ({}),
    setLocalizedText() {}, localizeText: t => t});
  const {K, Session} = vm.runInContext(read('four-core.js') + '\n' + read('network-common.js') + '\n' + read('four-network.js') + '\n({K: KingPongFour, Session: FourNetworkSession})', context);
  const view = {side: host ? 0 : 1, paddle: {value: 'classic'}, approval: {}, networkStatus: {}, result: {}, menu: {}, active: false,
    start(config, state) { this.state = state || K.create(config, 19); this.active = true; }, options: () => K.config()};
  const session = new Session(view, host); session.refresh = () => {}; session.transport.peers.set(host ? 1 : 0, {connected: true});
  session.hellos.add(host ? 1 : 0);
  return {K, session, view, setNow: value => { now = value; }, receive: message => session.receive(host ? 1 : 0, JSON.stringify(message))};
}
test('four-player host accepts only bounded intents from bound slots; score/state forgery and replay cannot mutate simulation', () => {
  const h = harness(true); h.session.begin(h.K.config({bots: [false, false, true, true]}));
  h.receive({k4: 1, type: 'init-ack', match: h.session.match, serial: h.session.matchSerial});
  const id = h.session.match;
  const packet = (seq, axis = 1, target = null) => ['k4', 1, id, 'i', seq, axis, target];
  h.receive(packet(1)); h.session.tick({axis: 0, target: null}, 1000);
  assert.equal(h.session.inputs.get(1).seq, 1);
  for (const m of [packet(1, -1), packet(0), packet(2, 9), packet(3, 0, -1), packet(4, 0, 999), ['k4', 1, id, 's', 200, 1, h.K.pack(h.view.state)]]) h.receive(m);
  assert.equal(h.session.inputs.get(1).seq, 1); assert.ok(h.session.stats.dropped >= 5);
  h.view.state.countdown = 0; const pos = h.view.state.paddles[1].pos;
  h.receive(packet(10, 0, 416)); h.session.tick({axis: 0, target: null}, 1017);
  assert.equal(h.view.state.paddles[1].pos - pos, h.K.SPEED);
  const score = [...h.view.state.scores]; h.receive({type: 'score', value: 99}); assert.deepEqual([...h.view.state.scores], score);
});
test('four-player init requires approved lobby configuration and monotonic match generation', () => {
  const h = harness(false), c = h.K.config({bots: [false, false, true, true]});
  const init = {k4: 1, type: 'init', match: crypto.randomUUID(), serial: 1, config: c, state: h.K.pack(h.K.create(c)), paddles: ['classic', 'classic', 'classic', 'classic']};
  h.receive(init); assert.equal(h.view.active, false); assert.ok(h.session.pendingInit);
  h.session.lockedConfig = c; h.session.initialize(init); assert.equal(h.view.active, true);
  const old = h.view.state; h.receive(init); assert.equal(h.view.state, old);
  h.receive({...init, serial: 2, config: {...c, hiddenWall: true}}); assert.equal(h.view.state, old);
});
test('four-player full snapshots recover after loss, reject stale epochs and preserve host authority during guest prediction', () => {
  const h = harness(false), c = h.K.config({bots: [false, false, true, true]}), authoritative = h.K.create(c);
  authoritative.countdown = 0; h.session.lockedConfig = c;
  const id = crypto.randomUUID(); h.receive({k4: 1, type: 'init', match: id, serial: 1, config: c, state: h.K.pack(authoritative), paddles: ['classic', 'classic', 'classic', 'classic']});
  for (let i = 0; i < 120; i++) h.K.step(authoritative, []);
  const payload = h.K.pack(authoritative); h.setNow(3000); h.receive(['k4', 1, id, 's', 40, -1, payload]);
  assert.deepEqual(h.K.pack(h.view.state), payload); h.receive(['k4', 1, id, 's', 39, -1, payload]); assert.equal(h.session.lastState, 40);
  h.session.tick({axis: 1, target: null}, 3017); assert.deepEqual(h.K.pack(h.view.state), payload);
  h.receive(['k4', 1, crypto.randomUUID(), 's', 100, -1, payload]); assert.equal(h.session.lastState, 40);
  const visual = h.session.visual(3050); assert.ok(Number.isFinite(visual.paddles[1].pos));
});

test('manual LAN four-player invitations reuse host-authoritative WebRTC without contacting any server', async () => {
  const peers = [], timers = new Map(); let id = 0;
  class Channel {
    constructor(label) { this.label = label; this.readyState = 'connecting'; this.bufferedAmount = 0; }
    send(raw) { queueMicrotask(() => this.other?.onmessage?.({data: raw})); }
    close() { this.readyState = 'closed'; }
  }
  class Peer {
    constructor(config) { this.config = config; this.id = peers.length; peers.push(this); this.channels = []; this.iceGatheringState = 'complete'; this.connectionState = 'new'; }
    createDataChannel(label) { const channel = new Channel(label); this.channels.push(channel); return channel; }
    async createOffer() { return {type: 'offer', sdp: String(this.id)}; }
    async createAnswer() { return {type: 'answer', sdp: String(this.id)}; }
    async setLocalDescription(d) { this.localDescription = {...d, toJSON: () => ({...d})}; }
    async setRemoteDescription(d) {
      this.remoteDescription = d;
      if (d.type !== 'answer') return;
      const guest = peers[Number(d.sdp)];
      for (const channel of this.channels) {
        const other = new Channel(channel.label); channel.other = other; other.other = channel;
        guest.ondatachannel({channel: other}); channel.readyState = other.readyState = 'open';
        channel.onopen?.(); other.onopen?.();
      }
      this.connectionState = guest.connectionState = 'connected'; this.onconnectionstatechange?.(); guest.onconnectionstatechange?.();
    }
    close() { this.connectionState = 'closed'; }
  }
  const context = vm.createContext({URL, Date, crypto, TextEncoder, btoa, atob, RTCPeerConnection: Peer,
    setTimeout: (fn, ms) => { const n = ++id; timers.set(n, {fn, ms}); return n; }, clearTimeout: n => timers.delete(n), clearInterval() {},
    WebSocket: class { constructor() { throw Error('LAN contacted a server'); } }});
  const roomSource = read('online.js').split('let onlineSession = null;')[0];
  const Lan = vm.runInContext(roomSource + '\n' + read('party-client.js') + '\nKingPongLanParty', context);
  const errors = [], messages = [], connected = [];
  const hooks = () => ({status() {}, welcome() {}, lobby() {}, error: code => errors.push(code), peerError: (slot, code) => errors.push(code),
    message: (slot, raw) => messages.push([slot, raw]), connected: slot => connected.push(slot)});
  const host = new Lan(hooks()); host.open(true); const guests = [];
  for (let i = 1; i <= 3; i++) {
    const guest = new Lan(hooks()); guest.open(false); guests.push(guest);
    const offer = await host.offer(); const answer = await guest.answer(offer); await host.accept(answer);
    assert.equal(guest.slot, i); assert.equal(host.peers.get(i).connected, true); assert.equal(guest.peers.get(0).connected, true);
    host.data(i, {test: i}, true); await Promise.resolve();
    assert.ok(messages.some(([, raw]) => raw === JSON.stringify({test: i})));
    await assert.rejects(() => host.accept(answer), /invalid_code/);
  }
  assert.equal(peers.length, 6); for (const peer of peers) assert.equal(peer.config.iceServers.length, 0);
  assert.equal(connected.length, 6); assert.equal(timers.size, 0);
  await assert.rejects(() => host.offer(), /full/);
  assert.deepEqual(errors, []); host.close(); guests.forEach(g => g.close());
});

test('simultaneous peer interruptions keep the whole four-player match paused until every link recovers', () => {
  const h = harness(true); h.session.begin(h.K.config());
  h.receive({k4: 1, type: 'init-ack', match: h.session.match, serial: h.session.matchSerial});
  h.session.transport.hooks.interrupted(1); h.session.transport.hooks.interrupted(2);
  h.session.transport.hooks.resumed(1); h.session.action('resume');
  assert.equal(h.session.interrupted, true); assert.equal(h.view.state.paused, true);
  h.session.transport.hooks.resumed(2); h.session.action('resume');
  assert.equal(h.session.interrupted, false); assert.equal(h.view.state.countdown, 180);
});


test('four-player countdown cannot advance before initialization acknowledgement from every guest', () => {
  const h = harness(true); h.session.begin(h.K.config());
  for (let i = 0; i < 300; i++) h.session.tick({axis: 0, target: null}, 1000 + i * 1000 / 60);
  assert.equal(h.view.state.tick, 0); assert.equal(h.view.state.countdown, 180);
  h.receive({k4: 1, type: 'init-ack', match: 'wrong-match', serial: h.session.matchSerial});
  assert.equal(h.session.startPending, true);
  h.receive({k4: 1, type: 'init-ack', match: h.session.match, serial: h.session.matchSerial});
  h.session.tick({axis: 0, target: null}, 6017); assert.equal(h.view.state.countdown, 179);
});
