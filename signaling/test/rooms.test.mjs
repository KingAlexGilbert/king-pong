import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'https://kingalexgilbert.github.io';
let credentialCalls = 0;
let turnFails = false;
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: ['./worker-fixture.mjs', '../src/worker.js', '../src/metered-turn.js', '../src/matchmaking.js', '../src/matchmaking-contract.js', '../src/native-bridge.js', '../src/party-room.js'].map(path => ({
    type: 'ESModule', path: fileURLToPath(new URL(path, import.meta.url))
  })),
  modulesRoot: fileURLToPath(new URL('../', import.meta.url)),
  compatibilityDate: '2025-09-06',
  durableObjects: {
    MATCHMAKING: {className: 'MatchmakingQueue', useSQLite: true},
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

async function untilMessage(client, predicate) {
  for (let i=0;i<30;i++) { const message=await client.next(); if(predicate(message)) return message; }
  throw new Error('Expected room message');
}

test('sas1 pending guests exchange verification only; SDP and ICE never reach unapproved peers',async()=>{
  const host=await connect(`party/create/2/1/${crypto.randomUUID()}/sas1`);
  const {code,verification}=await host.next();assert.equal(verification,'sas1');
  const old=await connect(`party/join/2/${code}/${crypto.randomUUID()}`);assert.equal((await old.next()).code,'incompatible');old.close();
  for(const type of ['description','candidate','connected','relay','approve']){
    const guest=await connect(`party/join/2/${code}/${crypto.randomUUID()}/sas1`),welcome=await guest.next();
    assert.equal(welcome.pending,true);assert.equal(welcome.verification,'sas1');
    const lobby=await untilMessage(host,m=>m.type==='lobby'&&m.pending?.length===1);assert.equal(lobby.pending[0].request,welcome.request);
    host.send({type:'description',to:1,attempt:0,description:{type:'offer',sdp:'private'}});
    host.send({type:'candidate',to:1,attempt:0,candidate:{candidate:'private',sdpMid:'0',sdpMLineIndex:0}});
    guest.send({type,request:welcome.request,to:0,attempt:0});
    for(;;){const m=await guest.next();assert.ok(!['description','candidate','start'].includes(m.type));if(m.type==='error'){assert.equal(m.code,'unapproved');break;}}
    await untilMessage(host,m=>m.type==='lobby'&&m.pending?.length===0);guest.close();
  }
  host.close();
});

test('sas1 needs both temporary exchanges, preserves SDP authentication and TURN attempt binding',async()=>{
  const host=await connect(`party/create/2/1/${crypto.randomUUID()}/sas1`),welcome=await host.next();
  const guest=await connect(`party/join/2/${welcome.code}/${crypto.randomUUID()}/sas1`),pending=await guest.next();
  await untilMessage(host,m=>m.type==='lobby'&&m.pending?.length===1);const request=pending.request;
  host.send({type:'approve',request}); // Ignored until both can derive their PIN.
  for(const [i,client,other] of [[0,host,guest],[1,guest,host]]){
    client.send({type:'approval-pair',request,kind:'commit',value:['a','b'][i].repeat(64)});
    const m=await untilMessage(other,m=>m.type==='approval-pair');assert.equal(m.request,request);assert.equal(m.kind,'commit');
  }
  for(const [client,other] of [[host,guest],[guest,host]]){
    client.send({type:'approval-pair',request,kind:'reveal',value:{key:'04'+'a'.repeat(128),nonce:'b'.repeat(32)}});
    assert.equal((await untilMessage(other,m=>m.type==='approval-pair')).kind,'reveal');
  }
  for(const [client,other] of [[host,guest],[guest,host]]){
    client.send({type:'approval-pair',request,kind:'ready'});assert.equal((await untilMessage(other,m=>m.type==='approval-pair')).kind,'ready');
  }
  host.send({type:'approve',request});
  for(const client of [host,guest]){
    assert.equal((await untilMessage(client,m=>m.type==='approved')).request,request);
    const m=await untilMessage(client,m=>m.type==='start');assert.equal(m.attempt,0);assert.equal(m.request,request);assert.equal(m.verification,'sas1');
  }
  const description={type:'offer',sdp:'bound SDP',approvalMac:'c'.repeat(64)};
  host.send({type:'description',to:1,attempt:0,description});assert.deepEqual((await untilMessage(guest,m=>m.type==='description')).description,description);
  const namespace=await mf.getDurableObjectNamespace('TURN_CREDENTIALS'),cache=namespace.get(namespace.idFromName('metered'));
  await cache.fetch('https://turn/test-reset');await mf.dispatchFetch('https://signaling.test/v1/turn/ready');await cache.fetch('https://turn/test-propagated');
  guest.send({type:'relay',to:0,attempt:0});
  for(const client of [host,guest]){
    const m=await untilMessage(client,m=>m.type==='start');assert.equal(m.attempt,1);assert.equal(m.request,request);assert.equal(m.verification,'sas1');
    assert.ok(m.iceServers[0].urls.some(url=>url.startsWith('turn:')));
  }
  host.close();guest.close();
});

test('sas1 malformed, stale-request and premature reveal frames close only that pending guest',async()=>{
  const host=await connect(`party/create/2/1/${crypto.randomUUID()}/sas1`),{code}=await host.next();
  for(const kind of ['malformed','stale','premature']){
    const guest=await connect(`party/join/2/${code}/${crypto.randomUUID()}/sas1`),welcome=await guest.next();
    await untilMessage(host,m=>m.type==='lobby'&&m.pending?.length===1);
    guest.send({type:'approval-pair',request:kind==='stale'?crypto.randomUUID():welcome.request,
      kind:kind==='premature'?'reveal':'commit',value:kind==='premature'?{key:'04'+'a'.repeat(128),nonce:'b'.repeat(32)}:'bad'});
    assert.equal((await untilMessage(guest,m=>m.type==='error')).code,kind==='stale'?'unapproved':'negotiation_failed');
    await untilMessage(host,m=>m.type==='lobby'&&m.pending?.length===0);guest.close();
  }
  host.close();
});
for (const approval of [0,1]) test(`private approval=${approval}: admission, kick, retained host and blocked reconnect`, async () => {
  const host=await connect(`party/create/2/${approval}/${crypto.randomUUID()}`);
  const welcome=await host.next();
  assert.match(welcome.code,/^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(welcome.protocol,'kp-party-1');
  const token=crypto.randomUUID();
  const guest=await connect(`party/join/2/${welcome.code}/${token}`);
  assert.equal((await guest.next()).pending,Boolean(approval));
  if(approval) {
    const lobby=await untilMessage(host,m=>m.type==='lobby'&&m.pending.length===1);
    host.send({type:'approve',request:lobby.pending[0].request});
    assert.equal((await untilMessage(guest,m=>m.type==='approved')).slot,1);
  }
  await untilMessage(host,m=>m.type==='start'); await untilMessage(guest,m=>m.type==='start');
  host.send({type:'connected',to:1,attempt:0});guest.send({type:'connected',to:0,attempt:0});
  await untilMessage(host,m=>m.type==='lobby'&&m.started);
  const third=await connect(`party/join/2/${welcome.code}/${crypto.randomUUID()}`);
  assert.equal((await third.next()).code,'full');third.close();
  host.send({type:'kick',slot:1});
  assert.equal((await untilMessage(guest,m=>m.type==='error')).code,'kicked');
  await untilMessage(host,m=>m.type==='departed');
  const again=await connect(`party/join/2/${welcome.code}/${token}`);
  assert.equal((await again.next()).code,'blocked');again.close();
  const fresh=await connect(`party/join/2/${welcome.code}/${crypto.randomUUID()}`);
  assert.equal((await fresh.next()).type,'welcome');
  host.close();guest.close();fresh.close();
});

test('pending private guest cannot self-approve; rejection blocks its session', async () => {
  const host=await connect(`party/create/2/1/${crypto.randomUUID()}`);
  const {code}=await host.next();
  const rejectedToken=crypto.randomUUID();
  const guest=await connect(`party/join/2/${code}/${rejectedToken}`);await guest.next();
  const lobby=await untilMessage(host,m=>m.type==='lobby'&&m.pending.length===1);
  host.send({type:'reject',request:lobby.pending[0].request});
  assert.equal((await untilMessage(guest,m=>m.type==='error')).code,'rejected');
  const retry=await connect(`party/join/2/${code}/${rejectedToken}`);
  assert.equal((await retry.next()).code,'blocked');retry.close();
  const malicious=await connect(`party/join/2/${code}/${crypto.randomUUID()}`);await malicious.next();
  malicious.send({type:'approve',request:lobby.pending[0].request});
  assert.equal((await untilMessage(malicious,m=>m.type==='error')).code,'unapproved');
  host.close();guest.close();malicious.close();
});
