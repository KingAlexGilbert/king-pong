import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MeteredTurn } from '../src/metered-turn.js';

const DAY = 24 * 60 * 60_000;
const PROPAGATION = 120_000;
const RETRY = 15 * 60_000;
function fixture(t, overrides = {}) {
  let now = 1_800_000_000_000, alarm = null, queue = Promise.resolve(), created = 0;
  const stored = new Map(), calls = [];
  let failure = null;
  const env = { METERED_APP_NAME: 'king-pong-test', METERED_SECRET_KEY: 'private&secret=never-client', ...overrides };
  const ctx = {
    blockConcurrencyWhile(fn) { const work = queue.then(fn); queue = work.catch(() => {}); return work; },
    storage: {
      async get(key) { return structuredClone(stored.get(key)); },
      async put(key, value) { stored.set(key, structuredClone(value)); },
      async setAlarm(value) { alarm = value; }
    }
  };
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    assert.equal(url.origin, 'https://king-pong-test.metered.live');
    assert.equal(init.redirect, 'manual');
    assert.ok(init.signal instanceof AbortSignal);
    if (failure?.method === init.method) {
      if (failure.throw) throw new Error('private upstream error: ' + env.METERED_SECRET_KEY);
      return Response.json(failure.body, { status: failure.status });
    }
    if (init.method === 'POST') {
      assert.equal(url.pathname, '/api/v1/turn/credential');
      assert.equal(url.searchParams.get('secretKey'), env.METERED_SECRET_KEY);
      assert.deepEqual(JSON.parse(init.body), { expiryInSeconds: 172800, label: 'king-pong-rotating' });
      return Response.json({ apiKey: `expiring-key-${++created}`, expiryInSeconds: 172800 });
    }
    assert.equal(url.pathname, '/api/v1/turn/credentials');
    assert.equal(url.searchParams.has('secretKey'), false);
    assert.equal(url.searchParams.get('region'), 'standard');
    const key = url.searchParams.get('apiKey');
    assert.match(key, /^expiring-key-\d+$/);
    return Response.json([
      { urls: 'stun:standard.relay.metered.ca:80' },
      { urls: ['turn:standard.relay.metered.ca:80', 'turn:standard.relay.metered.ca:80?transport=tcp',
        'turn:standard.relay.metered.ca:443', 'turns:standard.relay.metered.ca:443?transport=tcp', 'turn:standard.relay.metered.ca:53'],
      username: `user-${key}`, credential: `password-${key}`, apiKey: key }
    ]);
  });
  let cache = new MeteredTurn(ctx, env);
  return {
    calls, env,
    get alarm() { return alarm; }, get state() { return structuredClone(stored.get('turn')); },
    advance(ms) { now += ms; },
    fail(value) { failure = value; },
    restart() { cache = new MeteredTurn(ctx, env); },
    ready() { return cache.fetch(new Request('https://turn/ready')); },
    ice() { return cache.fetch(new Request('https://turn/ice')); },
    tick() { return cache.alarm(); },
    async prepare() {
      assert.equal((await this.ready()).status, 503);
      this.advance(PROPAGATION);
      await this.tick();
      assert.equal((await this.ready()).status, 200);
    }
  };
}

test('room lookups never create credentials; setup waits the full two-minute propagation window', async t => {
  const h = fixture(t);
  assert.equal((await h.ice()).status, 503);
  assert.equal(h.calls.length, 0);
  const response = await h.ready();
  assert.deepEqual(await response.json(), { ready: false });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(h.calls.length, 1);
  assert.equal(h.alarm, h.state.pending.readyAt);
  h.advance(PROPAGATION - 1);
  assert.equal((await h.ready()).status, 503);
  assert.equal(h.calls.length, 1);
  h.advance(1);
  await h.tick();
  assert.deepEqual(await (await h.ready()).json(), { ready: true });
  const servers = await (await h.ice()).json();
  assert.equal(servers.length, 1);
  assert.equal(servers[0].urls.length, 4);
  assert.ok(servers[0].urls.some(url => url.startsWith('turns:')));
  assert.equal(h.calls.length, 2);
  assert.ok(!JSON.stringify(servers).includes('apiKey'));
  assert.ok(!JSON.stringify(h.state).includes(h.env.METERED_SECRET_KEY));
});

test('concurrent initialization creates one credential and survives object re-creation', async t => {
  const h = fixture(t);
  const responses = await Promise.all(Array.from({ length: 12 }, () => h.ready()));
  assert.ok(responses.every(r => r.status === 503));
  assert.equal(h.calls.length, 1);
  h.restart();
  h.advance(PROPAGATION);
  await h.tick();
  assert.equal((await h.ice()).status, 200);
  assert.equal(h.calls.length, 2);
});

test('daily rotation preserves the outgoing credential during propagation and never revokes active sessions', async t => {
  const h = fixture(t);
  await h.prepare();
  const old = await (await h.ice()).json();
  h.advance(DAY - PROPAGATION);
  await h.tick();
  assert.equal(h.calls.length, 3);
  assert.deepEqual(await (await h.ice()).json(), old);
  assert.equal(h.state.pending.expiresAt - h.state.pending.createdAt, 2 * DAY);
  h.advance(PROPAGATION);
  await h.tick();
  assert.notDeepEqual(await (await h.ice()).json(), old);
  assert.equal(h.state.pending, undefined);
  assert.equal(h.alarm, h.state.current.createdAt + DAY);
  assert.deepEqual(h.calls.map(c => c.init.method), ['POST', 'GET', 'POST', 'GET']);
});

test('credential-cap errors retain the working credential and back off across requests and restarts', async t => {
  const h = fixture(t);
  await h.prepare();
  const old = await (await h.ice()).json();
  h.advance(DAY - PROPAGATION);
  h.fail({ method: 'POST', status: 403, body: { message: 'Maximum credential limit reached' } });
  await h.tick();
  const calls = h.calls.length;
  h.restart();
  await Promise.all([h.ready(), h.ready(), h.ready()]);
  assert.equal(h.calls.length, calls);
  assert.deepEqual(await (await h.ice()).json(), old);
  assert.equal(h.alarm, h.state.retryAt);
  h.fail(null);
  h.advance(RETRY);
  await h.tick();
  assert.ok(h.state.pending);
  h.advance(PROPAGATION);
  await h.tick();
  assert.notDeepEqual(await (await h.ice()).json(), old);
});

test('failed ICE lookup retries the same expiring key and retains the old credential', async t => {
  const h = fixture(t);
  await h.prepare();
  const old = await (await h.ice()).json();
  h.advance(DAY - PROPAGATION);
  await h.tick();
  const key = h.state.pending.apiKey;
  h.advance(PROPAGATION);
  h.fail({ method: 'GET', throw: true });
  await h.tick();
  assert.deepEqual(await (await h.ice()).json(), old);
  assert.equal(h.state.pending.apiKey, key);
  assert.deepEqual(await (await h.ready()).json(), { ready: true });
  h.fail(null);
  h.advance(RETRY);
  await h.tick();
  assert.notDeepEqual(await (await h.ice()).json(), old);
  assert.equal(h.calls.filter(c => c.init.method === 'POST').length, 2);
});

test('near-expiry credentials are withheld so a two-hour match cannot outlive the relay', async t => {
  const h = fixture(t);
  await h.prepare();
  h.advance(2 * DAY - PROPAGATION - (2 * 60 * 60 + 300) * 1000);
  assert.equal((await h.ice()).status, 503);
  assert.equal(h.calls.length, 2);
});

test('missing or unsafe account configuration never sends a secret to an arbitrary host', async t => {
  for (const env of [
    { METERED_APP_NAME: 'https://evil.example/?x=' },
    { METERED_APP_NAME: 'example.metered.live' },
    { METERED_SECRET_KEY: '' }
  ]) {
    const h = fixture(t, env);
    assert.deepEqual(await (await h.ready()).json(), { ready: false });
    assert.equal(h.calls.length, 0);
  }
});

test('non-expiring/malformed provider responses fail safely without publishing credentials', async t => {
  for (const body of [{ apiKey: 'permanent' }, { apiKey: 'permanent', expiryInSeconds: 0 }]) {
    const h = fixture(t);
    h.fail({ method: 'POST', status: 200, body });
    assert.deepEqual(await (await h.ready()).json(), { ready: false });
    assert.equal((await h.ice()).status, 503);
    assert.equal(h.state.pending, undefined);
  }
  const h = fixture(t);
  await h.ready();
  h.advance(PROPAGATION);
  h.fail({ method: 'GET', status: 200, body: { error: 'private upstream details' } });
  assert.deepEqual(await (await h.ready()).json(), { ready: false });
  assert.equal((await h.ice()).status, 503);
});
