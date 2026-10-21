import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MeteredTurn, validateTurnServers } from '../src/metered-turn.js';

const DAY = 24 * 60 * 60_000;
const PROPAGATION = 120_000;
const RETRY = 15 * 60_000;
function fixture(t, overrides = {}) {
  let now = 1_800_000_000_000, alarm = null, queue = Promise.resolve(), created = 0;
  const stored = new Map(), calls = [], usageCalls = [];
  let usage = {quotaInGB:0.5, usageInGB:0, overageInGB:0};
  let failure = null;
  const env = { METERED_APP_NAME: 'king-pong-test', METERED_SECRET_KEY: 'private&secret=never-client', ...overrides };
  const ctx = {
    id: {name: 'metered'},
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
    if (url.pathname.endsWith('/current_usage')) {usageCalls.push({url,init}); return Response.json(usage);}
    calls.push({ url, init });
    assert.equal(url.origin, `https://${env.METERED_APP_NAME}.metered.live`);
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
    calls, usageCalls, env,
    quota(value) {usage = value;},
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
  assert.equal(h.alarm, h.state.quotaRetryAt);
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
    { METERED_APP_NAME: 123 },
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


test('authoritative quota exhaustion withholds new credentials and renewal restores priority', async t => {
  const h = fixture(t); await h.prepare(); const old = await (await h.ice()).json();
  h.quota({quotaInGB:.5, usageInGB:.5}); h.advance(RETRY); await h.tick();
  assert.equal((await h.ice()).status,503);
  assert.deepEqual(await (await h.ice()).json(),{reason:'quota_exhausted'});
  assert.ok(h.state.current); // Never revoke active allocations.
  const count=h.usageCalls.length; await h.ready(); assert.equal(h.usageCalls.length,count);
  h.quota({quotaInGB:.5, usageInGB:0});h.advance(RETRY);await h.tick();
  assert.deepEqual(await (await h.ice()).json(),old);
});
test('unknown usage is never misreported as exhaustion; malformed usage cannot clear confirmed exhaustion', async t => {
  const h=fixture(t);h.quota({error:'unsupported API'});await h.prepare();assert.equal((await h.ice()).status,200);
  h.quota({quotaInGB:.5,usageInGB:1});h.advance(RETRY);await h.tick();
  h.quota({quotaInGB:'.5',usageInGB:0});h.advance(RETRY);await h.tick();
  assert.equal((await h.ice()).status,503);
});
test('TURN URL/credential validation excludes foreign hosts, injected URLs, unexpected transports and persistent fields', () => {
  const base={username:'temporary-user',credential:'temporary-password'};
  for(const url of ['turn:evil.example:443','turn:relay.metered.ca.evil.example:443','https://relay.metered.ca:443',
    'turn:user@relay.metered.ca:443','turn:relay.metered.ca:53','turns:relay.metered.ca:443?transport=udp',
    'turn:relay.metered.ca:443?secret=x','turn:127.0.0.1:443'])assert.deepEqual(validateTurnServers([{...base,urls:url}]),[]);
  const valid={...base,urls:'turns:global.relay.metered.ca:443?transport=tcp',apiKey:'never-publish'};
  assert.deepEqual(validateTurnServers([valid]),[{...base,urls:[valid.urls]}]);
  assert.deepEqual(validateTurnServers([{...valid,credential:'bad\ncredential'}]),[]);
  assert.deepEqual(validateTurnServers([{...valid,username:'x'.repeat(513)}]),[]);
});

test('slow provider rotation is single-flight while cached credentials remain readable', async t => {
  const old={iceServers:[{urls:'turn:primary.relay.metered.ca:80',username:'old',credential:'old'}],createdAt:Date.now()-DAY,expiresAt:Date.now()+DAY};
  let state={current:old},release,posts=0;
  const ctx={id:{name:'metered'},blockConcurrencyWhile(){throw Error('provider I/O must not close the input gate');},storage:{
    async get(){return structuredClone(state);},async put(k,v){state=structuredClone(v);},async setAlarm(){}
  }};
  t.mock.method(globalThis,'fetch',async(input,init)=>{
    if(init.method==='GET')return Response.json({quotaInGB:.5,usageInGB:0});
    posts++;return new Promise(resolve=>{release=()=>resolve(Response.json({apiKey:'new-expiring',expiryInSeconds:172800}));});
  });
  const cache=new MeteredTurn(ctx,{METERED_APP_NAME:'primary',METERED_SECRET_KEY:'private'});
  const first=cache.refresh(),second=cache.refresh();
  for(let n=0;n<20&&!release;n++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(posts,1);assert.equal(typeof release,'function');
  assert.deepEqual(await (await cache.fetch(new Request('https://turn/ice'))).json(),old.iceServers);
  release();await Promise.all([first,second]);assert.ok(state.pending);assert.equal(posts,1);
});
test('API timeouts, huge responses and HTTP errors back off without inventing quota exhaustion',async t=>{
  const timeouts=[];t.mock.method(AbortSignal,'timeout',ms=>{timeouts.push(ms);return new AbortController().signal;});
  for(const failure of ['timeout','oversized','status']) {
    let state={},calls=0;
    const ctx={id:{name:'metered'},storage:{async get(){return structuredClone(state);},async put(k,v){state=structuredClone(v);},async setAlarm(){}}};
    t.mock.method(globalThis,'fetch',async()=>{calls++;if(failure==='timeout')throw new DOMException('upstream timeout','TimeoutError');return new Response(failure==='oversized'?'x'.repeat(65537):'blocked',{status:failure==='status'?429:200});});
    const cache=new MeteredTurn(ctx,{METERED_APP_NAME:'primary',METERED_SECRET_KEY:'private'});
    assert.equal((await cache.fetch(new Request('https://turn/ready'))).status,503);const count=calls;
    assert.deepEqual(await (await cache.fetch(new Request('https://turn/ice'))).json(),{reason:'unavailable'});
    await cache.refresh();assert.equal(calls,count);assert.equal(state.quota,undefined);
  }
  assert.ok(timeouts.length>0&&timeouts.every(ms=>ms===8000));
});
