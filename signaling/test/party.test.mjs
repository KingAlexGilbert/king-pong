import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
const origin = 'https://kingalexgilbert.github.io';
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: ['party-fixture.mjs', '../src/worker.js', '../src/party-room.js', '../src/metered-turn.js', '../src/matchmaking.js', '../src/matchmaking-contract.js', '../src/native-bridge.js'].map(path => ({type: 'ESModule', path: fileURLToPath(new URL(path, import.meta.url))})),
  modulesRoot: fileURLToPath(new URL('../', import.meta.url)), compatibilityDate: '2025-09-06',
  durableObjects: {ROOMS: {className: 'TestPongRoom', useSQLite: true}, MATCHMAKING: {className: 'MatchmakingQueue', useSQLite: true}, TURN_CREDENTIALS: {className: 'TestTurn', useSQLite: true}},
  bindings: {ALLOWED_ORIGINS: origin}, ratelimits: {ROOM_LIMITER: {namespace_id: 'party-tests', simple: {limit: 1000, period: 60}}}
}));
after(() => mf.dispose());
async function connect(path, token = crypto.randomUUID()) {
  const response = await mf.dispatchFetch('https://signal.test/v1/party/' + path + '/' + token, {headers: {Upgrade: 'websocket', Origin: origin}});
  assert.equal(response.status, 101); const socket = response.webSocket, messages = [], waiters = [];
  socket.addEventListener('message', e => { const m = e.data === 'pong' ? 'pong' : JSON.parse(e.data); messages.push(m); for (const fn of [...waiters]) fn(); });
  socket.accept();
  const next = (type, predicate = () => true) => new Promise((resolve, reject) => {
    let timer; const check = () => { const i = messages.findIndex(m => (m.type === type || m === type) && predicate(m)); if (i >= 0) { clearTimeout(timer); const at = waiters.indexOf(check); if (at >= 0) waiters.splice(at, 1); resolve(messages.splice(i, 1)[0]); } };
    timer = setTimeout(() => { waiters.splice(waiters.indexOf(check), 1); reject(Error('Missing ' + type + ': ' + JSON.stringify(messages))); }, 4000); waiters.push(check); check();
  });
  return {socket, messages, token, next, send: m => socket.send(typeof m === 'string' ? m : JSON.stringify(m)), close: () => socket.close(1000)};
}
async function room(capacity = 4, approval = false) { const host = await connect(`create/${capacity}/${approval ? 1 : 0}`); const welcome = await host.next('welcome'); return {host, code: welcome.code}; }
async function join(code, capacity = 4, token) { const guest = await connect(`join/${capacity}/${code}`, token); return guest; }
async function readyPair(host, guest, slot) {
  await host.next('start', m => m.from === slot); await guest.next('start');
  host.send({type: 'connected', to: slot, attempt: 0}); guest.send({type: 'connected', to: 0, attempt: 0});
  await host.next('lobby', m => m.players.some(p => p.slot === slot && p.connected));
}
const config = {variant: 'ffa', lives: 3, goal: 10, difficulty: 'normal', powerups: true, hiddenWall: false};

test('party: six-character capacity-separated rooms preserve legacy five-character rooms', async () => {
  const {host, code} = await room(); assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  const wrong = await join(code, 2); assert.equal((await wrong.next('error')).code, 'wrong_mode');
  const guests = await Promise.all(Array.from({length: 6}, () => join(code)));
  const responses = await Promise.all(guests.map(async g => { while (!g.messages.some(m => m.type === 'welcome' || m.type === 'error')) await new Promise(r => setTimeout(r, 5)); return g.messages.find(m => m.type === 'welcome' || m.type === 'error'); }));
  assert.deepEqual(responses.filter(m => m.type === 'welcome').map(m => m.slot).sort(), [1, 2, 3]);
  assert.equal(responses.filter(m => m.code === 'full').length, 3);
  host.close(); guests.forEach(g => g.close()); wrong.close();
});
test('party: unapproved sockets cannot signal, change slots, or submit gameplay', async () => {
  const {host, code} = await room(4, true); const guest = await join(code); assert.equal((await guest.next('welcome')).slot, -1);
  const roster = await host.next('lobby', m => m.pending.length === 1); assert.equal(roster.players.length, 1);
  guest.send({type: 'input', slot: 1, axis: 1}); assert.equal((await guest.next('error')).code, 'unapproved');
  const good = await join(code); await good.next('welcome'); const request = (await host.next('lobby', m => m.pending.length === 1 && m.pending[0].request !== roster.pending[0].request)).pending[0].request;
  host.send({type: 'approve', request}); assert.equal((await good.next('approved')).slot, 1); await readyPair(host, good, 1);
  good.send({type: 'kick', slot: 0}); assert.equal((await good.next('error')).code, 'unauthorized');
  host.close(); guest.close(); good.close();
});
test('party: rejection and kick block only the removed room token; no private identities in roster', async () => {
  const {host, code} = await room(2, true); const guest = await join(code, 2); await guest.next('welcome');
  const l = await host.next('lobby', m => m.pending.length === 1); assert.equal(JSON.stringify(l).includes(guest.token), false);
  host.send({type: 'reject', request: l.pending[0].request}); assert.equal((await guest.next('error')).code, 'rejected');
  const retry = await join(code, 2, guest.token); assert.equal((await retry.next('error')).code, 'blocked');
  const other = await join(code, 2); await other.next('welcome'); const r = await host.next('lobby', m => m.pending.length === 1 && m.pending[0].request !== l.pending[0].request);
  host.send({type: 'approve', request: r.pending[0].request}); await other.next('approved'); await readyPair(host, other, 1);
  host.send({type: 'kick', slot: 1}); assert.equal((await other.next('error')).code, 'kicked');
  host.close(); guest.close(); retry.close(); other.close();
});
test('party: each guest has independent SDP, relay attempt and stale-candidate rejection', async () => {
  const {host, code} = await room(); const a = await join(code), b = await join(code); const aw = await a.next('welcome'), bw = await b.next('welcome');
  await host.next('start', m => m.from === aw.slot); await host.next('start', m => m.from === bw.slot); await a.next('start'); await b.next('start');
  host.send({type: 'description', to: aw.slot, attempt: 0, description: {type: 'offer', sdp: 'v=0\r\n'}});
  assert.equal((await a.next('description')).from, 0); assert.equal(b.messages.some(m => m.type === 'description'), false);
  a.send({type: 'relay', to: 0}); assert.equal((await a.next('start')).attempt, 1); assert.equal((await host.next('start')).from, aw.slot);
  assert.equal(b.messages.some(m => m.type === 'start' && m.attempt === 1), false);
  a.send({type: 'candidate', to: 0, attempt: 0, candidate: {candidate: 'stale', sdpMid: '0', sdpMLineIndex: 0}});
  a.send('ping'); await a.next('pong'); assert.equal(host.messages.some(m => m.type === 'candidate'), false);
  b.send({type: 'description', to: aw.slot, attempt: 0, description: {type: 'offer', sdp: 'forged'}});
  assert.equal((await b.next('error')).code, 'unauthorized');
  host.close(); a.close(); b.close();
});
test('party: host start is gated by all human readiness; four humans start without bots', async () => {
  const {host, code} = await room(); const guests = [];
  host.send({type: 'configure', config, fill: true}); await host.next('lobby', m => m.config);
  for (let slot = 1; slot <= 3; slot++) { const g = await join(code); guests.push(g); await g.next('welcome'); await readyPair(host, g, slot); }
  host.send({type: 'wait'}); await host.next('lobby', m => m.waitAt !== null);
  host.send({type: 'lock'}); host.send('ping'); await host.next('pong'); assert.equal(host.messages.some(m => m.type === 'locked'), false);
  for (const g of guests) g.send({type: 'ready', ready: true, consent: false});
  await host.next('lobby', m => m.players.every(p => p.ready)); host.send({type: 'lock'});
  const locked = await host.next('locked'); assert.deepEqual(locked.config.bots, [false, false, false, false]);
  const late = await join(code); assert.equal((await late.next('error')).code, 'full');
  host.close(); guests.forEach(g => g.close()); late.close();
});
test('party: bot fill needs 3 minutes, explicit consent and host-controlled start', async () => {
  const {host, code} = await room(); const guest = await join(code); await guest.next('welcome'); await readyPair(host, guest, 1);
  host.send({type: 'configure', config: {...config, variant: 'teams'}, fill: true}); await host.next('lobby', m => m.config);
  host.send({type: 'wait'}); guest.send({type: 'ready', ready: true, consent: false}); await host.next('lobby', m => m.waitAt && m.players.every(p => p.ready));
  host.send({type: 'lock'}); host.send('ping'); await host.next('pong'); assert.equal(host.messages.some(m => m.type === 'locked'), false);
  const ns = await mf.getDurableObjectNamespace('ROOMS'); const stub = ns.get(ns.idFromName('party:' + code)); await stub.fetch('https://room/test-party-age');
  host.send({type: 'lock'}); host.send('ping'); await host.next('pong'); assert.equal(host.messages.some(m => m.type === 'locked'), false);
  guest.send({type: 'ready', ready: true, consent: true}); await host.next('lobby', m => m.players.every(p => p.consent)); host.send({type: 'lock'});
  assert.deepEqual((await host.next('locked')).config.bots, [false, false, true, true]);
  host.close(); guest.close();
});
test('party: configuration change cancels readiness and bot timer; host disconnect ends the room', async () => {
  const {host, code} = await room(); host.send({type: 'configure', config, fill: true}); await host.next('lobby', m => m.config);
  host.send({type: 'wait'}); await host.next('lobby', m => m.waitAt !== null);
  host.send({type: 'configure', config: {...config, goal: 20}, fill: false}); const l = await host.next('lobby', m => m.config?.goal === 20);
  assert.equal(l.waitAt, null); assert.equal(l.players[0].ready, false);
  const guest = await join(code); await guest.next('welcome'); host.close(); assert.equal((await guest.next('error')).code, 'host_left');
  const retry = await join(code); assert.equal((await retry.next('error')).code, 'not_found'); guest.close(); retry.close();
});
