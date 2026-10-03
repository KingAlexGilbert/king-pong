import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'https://kingalexgilbert.github.io';
let credentialCalls = 0;
let turnFails = false;
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  scriptPath: fileURLToPath(new URL('../src/worker.js', import.meta.url)),
  compatibilityDate: '2025-09-06',
  durableObjects: { ROOMS: { className: 'PongRoom', useSQLite: true } },
  bindings: { ALLOWED_ORIGINS: origin, TURN_KEY_ID: 'test-key', TURN_API_TOKEN: 'server-only-test-secret' },
  ratelimits: { ROOM_LIMITER: { namespace_id: '1', simple: { limit: 20, period: 60 } } },
  outboundService: async request => {
    assert.equal(new URL(request.url).hostname, 'rtc.live.cloudflare.com');
    assert.equal(request.headers.get('Authorization'), 'Bearer server-only-test-secret');
    assert.deepEqual(await request.json(), { ttl: 7500 });
    credentialCalls++;
    if (turnFails) return new Response('', { status: 503 });
    return Response.json({ iceServers: [{
      urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp', 'turn:turn.cloudflare.com:53'],
      username: `temporary-${credentialCalls}`, credential: 'temporary-test-credential'
    }] });
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

test('TURN is issued only to the paired room, once per peer; stale ICE is ignored', async () => {
  const { host, guest } = await pair();
  const before = credentialCalls;
  host.send({ type: 'relay' });
  guest.send({ type: 'relay' });
  const messages = await Promise.all([host.next(), guest.next()]);
  for (const m of messages) {
    assert.equal(m.attempt, 1);
    assert.equal(m.iceServers[0].urls.length, 2);
    assert.ok(!JSON.stringify(m).includes('server-only-test-secret'));
  }
  assert.equal(credentialCalls - before, 2);
  host.send({ type: 'candidate', attempt: 0, candidate: { candidate: 'old', sdpMid: '0', sdpMLineIndex: 0 } });
  host.send({ type: 'description', attempt: 1, description: { type: 'offer', sdp: 'new' } });
  assert.equal((await guest.next()).description.sdp, 'new');
  guest.close();
  assert.equal((await host.next()).code, 'guest_left');
  host.close();
});

test('credential failure is a friendly error to both players', async () => {
  const { host, guest } = await pair();
  turnFails = true;
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
