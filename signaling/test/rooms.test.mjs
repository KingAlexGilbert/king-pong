import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'https://kingalexgilbert.github.io';
let credentialCalls = 0;
let turnFails = false;
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: ['./worker-fixture.mjs', '../src/worker.js', '../src/metered-turn.js'].map(path => ({
    type: 'ESModule', path: fileURLToPath(new URL(path, import.meta.url))
  })),
  modulesRoot: fileURLToPath(new URL('../', import.meta.url)),
  compatibilityDate: '2025-09-06',
  durableObjects: {
    ROOMS: { className: 'PongRoom', useSQLite: true },
    TURN_CREDENTIALS: { className: 'MeteredTurn', useSQLite: true }
  },
  bindings: { ALLOWED_ORIGINS: origin, METERED_APP_NAME: 'king-pong-test', METERED_SECRET_KEY: 'server-only-test-secret' },
  ratelimits: { ROOM_LIMITER: { namespace_id: '1', simple: { limit: 20, period: 60 } } },
  outboundService: async request => {
    const url = new URL(request.url);
    assert.equal(url.hostname, 'king-pong-test.metered.live');
    credentialCalls++;
    if (turnFails) return new Response('', { status: 503 });
    if (request.method === 'POST') {
      assert.equal(url.pathname, '/api/v1/turn/credential');
      assert.equal(url.searchParams.get('secretKey'), 'server-only-test-secret');
      assert.deepEqual(await request.json(), { expiryInSeconds: 172800, label: 'king-pong-rotating' });
      return Response.json({ apiKey: 'expiring-test-key', expiryInSeconds: 172800 });
    }
    assert.equal(url.pathname, '/api/v1/turn/credentials');
    assert.equal(url.searchParams.get('apiKey'), 'expiring-test-key');
    assert.equal(url.searchParams.get('region'), 'standard');
    assert.equal(url.searchParams.has('secretKey'), false);
    return Response.json([{ urls: 'stun:standard.relay.metered.ca:80' }, {
      urls: ['turn:standard.relay.metered.ca:80', 'turn:standard.relay.metered.ca:80?transport=tcp', 'turns:standard.relay.metered.ca:443?transport=tcp', 'turn:standard.relay.metered.ca:53'],
      username: 'temporary-user', credential: 'temporary-test-credential', apiKey: 'must-not-forward'
    }]);
  }
}));
after(() => mf.dispose());
let ipIndex = 0;
async function connect(path, ip = `192.0.2.${++ipIndex}`) {
  const response = await mf.dispatchFetch('https://signaling.test/v1/' + path, {
    headers: { Upgrade: 'websocket', Origin: origin, 'CF-Connecting-IP': ip }
  });
  assert.equal(response.status, 101);
  const socket = response.webSocket;
  const messages = [];
  const waiting = [];
  socket.addEventListener('message', event => {
    const value = event.data === 'pong' ? 'pong' : JSON.parse(event.data);
    if (waiting.length) waiting.shift()(value);
    else messages.push(value);
  });
  socket.accept();
  return {
    socket,
    next: () => messages.length ? Promise.resolve(messages.shift()) : new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for signaling')), 4000);
      waiting.push(value => { clearTimeout(timer); resolve(value); });
    }),
    send: value => socket.send(typeof value === 'string' ? value : JSON.stringify(value)),
    close: () => socket.close(1000)
  };
}
async function pair() {
  const host = await connect('create');
  const welcome = await host.next();
  assert.match(welcome.code, /^[A-HJ-NP-Z2-9]{5}$/);
  const guest = await connect('join/' + welcome.code);
  assert.equal((await guest.next()).role, 'guest');
  assert.equal((await host.next()).attempt, 0);
  assert.equal((await guest.next()).attempt, 0);
  return { host, guest, code: welcome.code };
}

test('origin restriction, invalid codes, and absent rooms', async () => {
  const response = await mf.dispatchFetch('https://signaling.test/v1/create', { headers: { Upgrade: 'websocket', Origin: 'https://evil.example' } });
  assert.equal(response.status, 403);
  for (const [path, expected] of [['join/O0000', 'invalid_code'], ['join/ABCDE', 'not_found']]) {
    const client = await connect(path);
    assert.equal((await client.next()).code, expected);
    client.close();
  }
});

test('two players exchange SDP/ICE, third is rejected, host departure removes room', async () => {
  const { host, guest, code } = await pair();
  host.send({ type: 'description', attempt: 0, description: { type: 'offer', sdp: 'v=0\r\n', extra: 'not forwarded' } });
  assert.deepEqual(await guest.next(), { type: 'description', attempt: 0, description: { type: 'offer', sdp: 'v=0\r\n' } });
  guest.send({ type: 'candidate', attempt: 0, candidate: { candidate: 'candidate:test', sdpMid: '0', sdpMLineIndex: 0 } });
  assert.equal((await host.next()).type, 'candidate');
  host.send('ping');
  assert.equal(await host.next(), 'pong');
  const third = await connect('join/' + code);
  assert.equal((await third.next()).code, 'full');
  host.close();
  assert.equal((await guest.next()).code, 'host_left');
  const late = await connect('join/' + code);
  assert.equal((await late.next()).code, 'not_found');
  guest.close(); third.close(); late.close();
});

test('simultaneous guests cannot exceed room capacity', async () => {
  const host = await connect('create');
  const { code } = await host.next();
  const guests = await Promise.all([connect('join/' + code), connect('join/' + code)]);
  const responses = await Promise.all(guests.map(g => g.next()));
  assert.equal(responses.filter(m => m.type === 'welcome').length, 1);
  assert.equal(responses.filter(m => m.code === 'full').length, 1);
  host.close(); guests.forEach(g => g.close());
});

test('TURN reuses the pre-propagated Metered credential only for paired rooms; stale ICE is ignored', async () => {
  const warming = await mf.dispatchFetch('https://signaling.test/v1/turn/ready');
  assert.equal(warming.status, 503);
  assert.deepEqual(await warming.json(), { ready: false });
  const namespace = await mf.getDurableObjectNamespace('TURN_CREDENTIALS');
  const cache = namespace.get(namespace.idFromName('metered'));
  const prepared = await cache.fetch('https://turn/test-propagated');
  assert.equal(prepared.status, 200);
  assert.deepEqual(await prepared.json(), { ready: true });
  const status = await mf.dispatchFetch('https://signaling.test/v1/turn/ready');
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { ready: true });
  for (const path of ['/v1/turn/ice', '/test-propagated', '/test-reset', '/v1/turn/ready?extra=1']) {
    const response = await mf.dispatchFetch('https://signaling.test' + path);
    assert.equal(response.status, 426);
    assert.equal(await response.text(), 'King Pong signaling');
  }
  const { host, guest } = await pair();
  const before = credentialCalls;
  host.send({ type: 'relay' });
  guest.send({ type: 'relay' });
  const messages = await Promise.all([host.next(), guest.next()]);
  for (const m of messages) {
    assert.equal(m.attempt, 1);
    assert.equal(m.iceServers[0].urls.length, 3);
    assert.ok(!JSON.stringify(m).includes('server-only-test-secret'));
    assert.ok(!JSON.stringify(m).includes('expiring-test-key'));
    assert.ok(!JSON.stringify(m).includes('must-not-forward'));
  }
  assert.deepEqual(messages[0].iceServers, messages[1].iceServers);
  assert.equal(credentialCalls, before);
  host.send({ type: 'candidate', attempt: 0, candidate: { candidate: 'old', sdpMid: '0', sdpMLineIndex: 0 } });
  host.send({ type: 'description', attempt: 1, description: { type: 'offer', sdp: 'new' } });
  assert.equal((await guest.next()).description.sdp, 'new');
  guest.close();
  assert.equal((await host.next()).code, 'guest_left');
  host.close();
});

test('credential failure is a friendly error to both players', async () => {
  const namespace = await mf.getDurableObjectNamespace('TURN_CREDENTIALS');
  await namespace.get(namespace.idFromName('metered')).fetch('https://turn/test-reset');
  const { host, guest } = await pair();
  turnFails = true;
  const response = await mf.dispatchFetch('https://signaling.test/v1/turn/ready');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ready: false });
  host.send({ type: 'relay' });
  for (const client of [host, guest]) assert.equal((await client.next()).code, 'relay_unavailable');
  turnFails = false;
  host.close(); guest.close();
});

test('wrong SDP role, malformed and oversized signaling close the room', async () => {
  for (const payload of [
    { type: 'description', attempt: 0, description: { type: 'offer', sdp: 'guest cannot offer' } },
    '{bad json',
    'x'.repeat(65_537)
  ]) {
    const { host, guest } = await pair();
    guest.send(payload);
    assert.equal((await host.next()).code, 'negotiation_failed');
    host.close(); guest.close();
  }
});

test('request rate limiting returns a safe error', async () => {
  let last;
  for (let i = 0; i < 21; i++) {
    const socket = await connect('join/ABCDE', '198.51.100.1');
    last = await socket.next();
    socket.close();
  }
  assert.equal(last.code, 'rate_limited');
});

// Alarm and hibernation restoration use the production class with a small clock/storage fixture.
// Socket admission and message forwarding above run in the actual Workers runtime.
test('expired rooms and abandoned sockets delete room data; fresh auto-pongs keep leases alive', async () => {
  const { PongRoom } = await import('../src/worker.js');
  const previous = globalThis.WebSocketRequestResponsePair;
  globalThis.WebSocketRequestResponsePair = class {};
  try {
    for (const kind of ['expired', 'stale', 'fresh']) {
      const sent = [];
      let stored = { expiresAt: Date.now() + (kind === 'expired' ? -1 : 600_000) };
      let alarm = null;
      const socket = {
        attachment: { role: 'host', joinedAt: Date.now() - 180_000 },
        serializeAttachment(value) { this.attachment = value; },
        deserializeAttachment() { return this.attachment; },
        send(value) { sent.push(JSON.parse(value)); }, close() {}
      };
      const ctx = {
        setWebSocketAutoResponse() {}, getWebSockets: () => [socket],
        getWebSocketAutoResponseTimestamp: () => kind === 'fresh' ? new Date() : null,
        storage: {
          get: async () => stored, deleteAll: async () => { stored = null; },
          deleteAlarm: async () => { alarm = null; }, setAlarm: async value => { alarm = value; }
        }
      };
      await new PongRoom(ctx, {}).alarm();
      if (kind === 'fresh') { assert.ok(stored); assert.ok(alarm <= Date.now() + 60_000); assert.equal(sent.length, 0); }
      else { assert.equal(stored, null); assert.equal(alarm, null); assert.equal(sent[0].code, kind === 'expired' ? 'expired' : 'host_left'); }
    }
  } finally { globalThis.WebSocketRequestResponsePair = previous; }
});
