import assert from 'node:assert/strict';
import {test, after} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {MATCHMAKING_CONTRACT as contract} from '../src/matchmaking-contract.js';
import {chooseArena, MatchmakingQueue} from '../src/matchmaking.js';

const origin = 'https://kingalexgilbert.github.io';
const mf = new Miniflare(convertV4MiniflareOptions({
  modules:['worker.js','metered-turn.js','matchmaking.js','matchmaking-contract.js','native-bridge.js','party-room.js','secure-relay.js']
    .map(f=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+f,import.meta.url))})),
  modulesRoot:fileURLToPath(new URL('../src/',import.meta.url)), compatibilityDate:'2025-09-06',
  durableObjects:{ROOMS:{className:'PongRoom',useSQLite:true},TURN_CREDENTIALS:{className:'MeteredTurn',useSQLite:true},
    MATCHMAKING:{className:'MatchmakingQueue',useSQLite:true}},
  bindings:{ALLOWED_ORIGINS:origin},
  ratelimits:{ROOM_LIMITER:{namespace_id:'12',simple:{limit:100,period:60}}}
}));
after(()=>mf.dispose());
let ip=0;
const clients=new Set();
async function connect(path='queue/'+contract.protocol) {
  const response=await mf.dispatchFetch('https://signaling.test/v1/'+path,{headers:{Upgrade:'websocket',Origin:origin,'CF-Connecting-IP':'192.0.2.'+(++ip)}});
  assert.equal(response.status,101);
  const socket=response.webSocket,messages=[],waiters=[];
  socket.addEventListener('message',e=>{
    const m=e.data==='pong'?'pong':JSON.parse(e.data);
    const index=waiters.findIndex(w=>w.predicate(m));
    if(index>=0)waiters.splice(index,1)[0].resolve(m); else messages.push(m);
  });
  socket.accept();
  const client={socket,messages,
    send:m=>socket.send(typeof m==='string'?m:JSON.stringify(m)),
    next:(predicate)=>{
      if(typeof predicate==='string'){const type=predicate;predicate=m=>m.type===type;}
      const index=messages.findIndex(predicate);
      if(index>=0)return Promise.resolve(messages.splice(index,1)[0]);
      return new Promise((resolve,reject)=>{
        const waiter={predicate,resolve:m=>{clearTimeout(timer);resolve(m);}};
        const timer=setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(new Error('Timed out: '+messages.map(m=>JSON.stringify(m)).join(',')));},4000);
        waiters.push(waiter);
      });
    },close:()=>{socket.close(1000);clients.delete(client);}};
  clients.add(client);return client;
}
async function search(client,arena=null){client.send({type:'search',protocol:contract.protocol,arena});}
async function pair(aPreference=null,bPreference=null) {
  const a=await connect(),b=await connect();
  await a.next('queue');await b.next('queue');
  await search(a,aPreference);await search(b,bPreference);
  const [host,guest]=await Promise.all([a.next('matched'),b.next('matched')]);
  return {a,b,host,guest};
}
async function closeAll() {
  for(const c of [...clients])c.close();
  // A round trip observes close events; no timing sleeps are needed.
  const observer=await connect();await observer.next(m=>m.type==='queue'&&m.waiting===0);observer.close();
}

test('empty queue, live counts, duplicate search, delayed opponent, fair metadata and token-only role admission',async()=>{
  const a=await connect(),observer=await connect();
  assert.equal((await a.next('queue')).waiting,0);await observer.next('queue');
  await search(a,2);
  assert.equal((await a.next(m=>m.type==='queue'&&m.state==='waiting')).waiting,1);
  await observer.next(m=>m.type==='queue'&&m.waiting===1);
  await search(a,6); // Cannot change the existing entry or count it twice.
  a.send('ping');assert.equal(await a.next(m=>m==='pong'),'pong');
  assert.equal(a.messages.some(m=>m.type==='queue'&&m.waiting===1),false,'unchanged count is not rebroadcast');
  const b=await connect();assert.equal((await b.next('queue')).waiting,1);await search(b);
  const [host,guest]=await Promise.all([a.next('matched'),b.next('matched')]);
  assert.equal(host.role,'host');assert.equal(guest.role,'guest');assert.deepEqual(host.match,guest.match);
  assert.equal(host.match.arena,2);assert.equal(host.match.rules,'classic');assert.notEqual(host.token,guest.token);
  await observer.next(m=>m.type==='queue'&&m.waiting===0);
  const stranger=await connect('match/'+host.match.id+'/'+crypto.randomUUID());
  assert.equal((await stranger.next('error')).code,'not_found');
  // Guest can claim first. Role comes only from its server token.
  const guestRoom=await connect('match/'+guest.match.id+'/'+guest.token);
  assert.equal((await guestRoom.next('welcome')).role,'guest');
  const hostRoom=await connect('match/'+host.match.id+'/'+host.token);
  const welcome=await hostRoom.next('welcome');assert.equal(welcome.role,'host');assert.equal(welcome.match.arena,2);
  await hostRoom.next('start');await guestRoom.next('start');
  const duplicate=await connect('match/'+host.match.id+'/'+host.token);
  assert.equal((await duplicate.next('error')).code,'full');
  const privateJoin=await connect('join/'+welcome.code);assert.equal((await privateJoin.next('error')).code,'not_found');
  a.send({type:'cancel'});await b.next('failed');await hostRoom.next('error');await guestRoom.next('error');
  const late=await connect('match/'+host.match.id+'/'+host.token);assert.equal((await late.next('error')).code,'not_found');
  await closeAll();
});

test('simultaneous entrants have exactly one assignment each and no connecting players in the waiting count',async()=>{
  const people=await Promise.all(Array.from({length:8},()=>connect()));
  await Promise.all(people.map(p=>p.next('queue')));
  await Promise.all(people.map((p,i)=>search(p,i)));
  const assigned=await Promise.all(people.map(p=>p.next('matched')));
  const ids=new Set(assigned.map(m=>m.match.id));assert.equal(ids.size,4);
  for(const id of ids){const pair=assigned.filter(m=>m.match.id===id);assert.equal(pair.length,2);assert.deepEqual(pair.map(m=>m.role).sort(),['guest','host']);}
  const observer=await connect();assert.equal((await observer.next('queue')).waiting,0);
  await closeAll();
});

test('cancel, disconnect before pairing, disconnect during connection, retry and failed room cleanup',async()=>{
  const observer=await connect(),a=await connect();await observer.next('queue');await a.next('queue');
  await search(a);await observer.next(m=>m.type==='queue'&&m.waiting===1);
  a.send({type:'cancel'});await observer.next(m=>m.type==='queue'&&m.waiting===0);
  await search(a);await observer.next(m=>m.type==='queue'&&m.waiting===1);
  a.close();await observer.next(m=>m.type==='queue'&&m.waiting===0);
  const {a:host,b:guest,host:assignment}=await pair();
  host.close();await guest.next('failed');
  const room=await connect('match/'+assignment.match.id+'/'+assignment.token);
  assert.equal((await room.next('error')).code,'not_found');
  await search(guest);await guest.next(m=>m.type==='queue'&&m.state==='waiting');
  const replacement=await connect();await replacement.next('queue');await search(replacement);
  const retry=await guest.next('matched');assert.notEqual(retry.match.id,assignment.match.id);
  await closeAll();
});

test('incompatible protocols, malformed preferences, oversized messages and search floods fail safely',async()=>{
  const old=await connect('queue/old-client');assert.equal((await old.next('error')).code,'incompatible');old.close();
  for(const payload of [{type:'search',protocol:'old',arena:null},{type:'search',protocol:contract.protocol,arena:999},'x'.repeat(513)]) {
    const c=await connect();await c.next('queue');c.send(payload);await c.next('error');c.close();
  }
  const c=await connect();await c.next('queue');
  for(let i=0;i<21;i++)c.send({type:'search',protocol:contract.protocol,arena:null});
  assert.equal((await c.next('error')).code,'rate_limited');await closeAll();
});

test('arena resolution covers every preference combination and removes random modulo bias',()=>{
  const arenas=contract.arenas;
  for(const a of [null,...arenas])for(const b of [null,...arenas]){
    if(a===null&&b===null)for(let i=0;i<arenas.length;i++)assert.equal(chooseArena(a,b,arenas,()=>i),i);
    else if(a===null||b===null||a===b)assert.equal(chooseArena(a,b,arenas,()=>0),a??b);
    else {assert.equal(chooseArena(a,b,arenas,()=>0),a);assert.equal(chooseArena(a,b,arenas,()=>1),b);}
  }
  const rolls=[0xffffffff,5];assert.equal(chooseArena(null,null,arenas,()=>rolls.shift()),5);
});

test('hibernation reconstruction, five-minute wait, abandoned leases and expired reservations use socket state',async()=>{
  const previous=globalThis.WebSocketRequestResponsePair;globalThis.WebSocketRequestResponsePair=class{};
  try{
    for(const kind of ['fresh','stale','connecting']){
      let alarm=null;const aborted=[];const messages=[];
      const s={a:{joinedAt:Date.now()-300_000,state:kind==='connecting'?'connecting':'waiting',
        match:kind==='connecting'?{id:'example',expiresAt:Date.now()-1}:null},deserializeAttachment(){return this.a;},
        serializeAttachment(a){this.a=a;},send(m){messages.push(JSON.parse(m));},close(){}};
      const ctx={blockConcurrencyWhile:fn=>fn(),setWebSocketAutoResponse(){},getWebSockets:()=>[s],
        getWebSocketAutoResponseTimestamp:()=>kind==='stale'?null:new Date(),
        storage:{setAlarm:async t=>{alarm=t;},deleteAlarm:async()=>{alarm=null;},deleteAll:async()=>{alarm=null;}}};
      const env={ROOMS:{idFromName:n=>n,get:n=>({fetch:async()=>{aborted.push(n);return new Response(null,{status:204});}})}};
      const queue=new MatchmakingQueue(ctx,env);await queue.alarm();
      if(kind==='fresh'){assert.equal(queue.waiting().length,1);assert.ok(alarm>Date.now());}
      if(kind==='stale'){assert.equal(queue.waiting().length,0);assert.equal(s.a.closed,true);assert.equal(alarm,null);}
      if(kind==='connecting'){assert.equal(s.a.state,'watching');assert.deepEqual(aborted,['match:example']);}
    }
  }finally{globalThis.WebSocketRequestResponsePair=previous;}
});

test('native bridge has strict frame policy and signaling rejects opaque and foreign origins',async()=>{
  const bridge=await mf.dispatchFetch('https://signaling.test/v1/native-bridge');assert.equal(bridge.status,200);
  assert.match(bridge.headers.get('Content-Security-Policy'),/frame-ancestors file:/);
  assert.doesNotMatch(await bridge.text(),/secret|credential/i);
  for(const Origin of ['null','https://evil.example']){
    const response=await mf.dispatchFetch('https://signaling.test/v1/queue/'+contract.protocol,{headers:{Upgrade:'websocket',Origin}});
    assert.equal(response.status,403);
  }
});


test('only two ready peers release their assignment, and queue closure cannot abort the reserved room',async()=>{
  const {a,b,host,guest}=await pair(4,4);
  const hostRoom=await connect('match/'+host.match.id+'/'+host.token);
  const guestRoom=await connect('match/'+guest.match.id+'/'+guest.token);
  await hostRoom.next('welcome');await guestRoom.next('welcome');
  await hostRoom.next('start');await guestRoom.next('start');
  a.send({type:'complete'});
  a.send('ping'); await a.next(m=>m==='pong');
  assert.equal(a.messages.some(m=>m.type==='complete'),false);
  b.send({type:'complete'});
  await a.next('complete');await b.next('complete');
  a.close();b.close();
  const observer=await connect();assert.equal((await observer.next('queue')).waiting,0);
  const duplicate=await connect('match/'+host.match.id+'/'+host.token);
  assert.equal((await duplicate.next('error')).code,'full','room survives queue departure');
  await closeAll();
});

test('unchanged queue broadcasts stay suppressed through hibernation, failed sends retry, and changes notify',()=>{
  const previous=globalThis.WebSocketRequestResponsePair;globalThis.WebSocketRequestResponsePair=class{};
  try {
    let fail=false;const sent=[];
    const s={a:{joinedAt:Date.now(),state:'waiting'},deserializeAttachment(){return structuredClone(this.a);},
      serializeAttachment(a){this.a=structuredClone(a);},send(raw){if(fail)throw Error();sent.push(JSON.parse(raw));}};
    const ctx={setWebSocketAutoResponse(){},getWebSockets:()=>[s],getWebSocketAutoResponseTimestamp:()=>new Date()};
    new MatchmakingQueue(ctx,{}).broadcast();
    for(let i=0;i<60;i++)new MatchmakingQueue(ctx,{}).broadcast();
    assert.equal(sent.length,1,'including thirty minutes of identical 30-second alarm notifications');
    s.a.state='watching';fail=true;new MatchmakingQueue(ctx,{}).broadcast();assert.equal(sent.length,1);
    fail=false;new MatchmakingQueue(ctx,{}).broadcast();assert.equal(sent.length,2);
    assert.deepEqual(sent.at(-1),{type:'queue',state:'watching',waiting:0});
  } finally {globalThis.WebSocketRequestResponsePair=previous;}
});
