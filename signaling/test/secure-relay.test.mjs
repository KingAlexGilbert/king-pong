import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const origin='https://kingalexgilbert.github.io';
const mf=new Miniflare(convertV4MiniflareOptions({
  modules:['worker.js','party-room.js','secure-relay.js','metered-turn.js','matchmaking.js','matchmaking-contract.js','native-bridge.js'].map(f=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+f,import.meta.url))})),
  modulesRoot:fileURLToPath(new URL('../src/',import.meta.url)),compatibilityDate:'2025-09-06',
  durableObjects:{ROOMS:{className:'PongRoom',useSQLite:true},TURN_CREDENTIALS:{className:'MeteredTurn',useSQLite:true},MATCHMAKING:{className:'MatchmakingQueue',useSQLite:true}},
  bindings:{ALLOWED_ORIGINS:origin},ratelimits:{ROOM_LIMITER:{namespace_id:'14',simple:{limit:100,period:60}}}
}));
const clients=[];after(async()=>{for(const c of clients)try{c.socket.close();}catch{}await mf.dispose();});
const context=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,DataView,btoa,atob,setTimeout,clearTimeout});
const Crypto=vm.runInContext(['pairing.js','approval-pairing.js','secure-crypto.js'].map(f=>readFileSync(new URL('../../game/'+f,import.meta.url),'utf8')).join('\n')+'\nKingPongSessionCrypto',context);
async function connect(path) {
  const response=await mf.dispatchFetch('https://signal.test/v1/party/'+path,{headers:{Upgrade:'websocket',Origin:origin}});
  assert.equal(response.status,101);const socket=response.webSocket,messages=[],waiters=[];
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);const i=waiters.findIndex(w=>w.p(m));if(i>=0){const w=waiters.splice(i,1)[0];clearTimeout(w.timer);w.resolve(m);}else messages.push(m);});socket.accept();
  const c={socket,messages,send:m=>socket.send(JSON.stringify(m)),next(p){if(typeof p==='string'){const type=p;p=m=>m.type===type;}const i=messages.findIndex(p);if(i>=0)return Promise.resolve(messages.splice(i,1)[0]);return new Promise((resolve,reject)=>{const w={p,resolve};w.timer=setTimeout(()=>reject(Error('Missing expected frame')),4000);waiters.push(w);});}};
  clients.push(c);return c;
}
async function pair(legacy=false) {
  const host=await connect('create/2/0/'+webcrypto.randomUUID()+'/sas2'),welcome=await host.next('welcome');
  const guest=await connect('join/2/'+welcome.code+'/'+webcrypto.randomUUID()+(legacy?'/sas1':'/sas2'));await guest.next('welcome');
  if(legacy)return {host,guest,code:welcome.code};
  const init=await host.next(m=>m.kind==='init');await guest.next(m=>m.kind==='init');
  await Promise.all([host.next(m=>m.kind==='rtc'),guest.next(m=>m.kind==='rtc')]);
  const a=new Crypto(welcome.code,init.session,'host',null),b=new Crypto(welcome.code,init.session,'guest',null);
  const signal=(client,kind,fields={})=>client.send({type:'secure',session:init.session,epoch:0,kind,...fields});
  signal(host,'key',{value:await a.offer()});signal(guest,'key',{value:await b.offer()});
  const pa=await a.accept((await host.next(m=>m.kind==='key')).value),pb=await b.accept((await guest.next(m=>m.kind==='key')).value);
  signal(host,'proof',{value:pa});signal(guest,'proof',{value:pb});
  assert.equal(await a.confirm((await host.next(m=>m.kind==='proof')).value),true);assert.equal(await b.confirm((await guest.next(m=>m.kind==='proof')).value),true);
  signal(host,'key-ready');signal(guest,'key-ready');await Promise.all([host.next(m=>m.kind==='keys-ready'),guest.next(m=>m.kind==='keys-ready')]);
  return {host,guest,a,b,id:init.session,epoch:0,code:welcome.code,signal};
}
async function active(p,mode='ws') {
  if(mode==='ws'){
    p.signal(p.host,'restart');await p.host.next(m=>m.kind==='rtc'&&m.epoch===1);await p.guest.next(m=>m.kind==='rtc'&&m.epoch===1);
    p.signal(p.guest,'fallback',{epoch:1});await p.host.next(m=>m.kind==='ws');await p.guest.next(m=>m.kind==='ws');p.epoch=2;
  }
  p.signal(p.host,'ready',{epoch:p.epoch,mode});p.signal(p.guest,'ready',{epoch:p.epoch,mode});
  await p.host.next(m=>m.kind==='prepare');await p.guest.next(m=>m.kind==='prepare');
  p.signal(p.host,'prepared',{epoch:p.epoch,mode});p.signal(p.guest,'prepared',{epoch:p.epoch,mode});
  await p.host.next(m=>m.kind==='activate');await p.guest.next(m=>m.kind==='activate');
}
test('actual Durable Object WebSockets relay opaque E2EE only after both peers commit; replay ends membership',async()=>{
  const p=await pair();await active(p);
  const frame=await p.a.seal(2,'c',{id:1,raw:'serve'});p.host.send(frame);
  const delivered=await p.guest.next('secure-frame');assert.equal((await p.b.open(delivered,2)).raw,'serve');
  assert.equal(delivered.body,frame.body);assert.ok(delivered.ticket>0);
  p.guest.send({type:'secure-credit',session:p.id,epoch:2,ticket:delivered.ticket});
  p.host.send(frame);assert.equal((await p.host.next('error')).code,'unauthorized');
});
test('mixed client versions keep legacy WebRTC and never select unsupported encryption',async()=>{
  const p=await pair(true);assert.equal((await p.host.next('start')).attempt,0);assert.equal((await p.guest.next('start')).attempt,0);
  p.host.socket.close();p.guest.socket.close();
});
test('direct-ready peers commit RTC without a gameplay relay; transport disagreements cannot activate',async()=>{
  const p=await pair();p.signal(p.host,'ready',{mode:'rtc'});p.signal(p.guest,'ready',{mode:'ws'});
  p.signal(p.guest,'candidate',{value:{candidate:'candidate:1 1 UDP 1 2001:db8::1 1234 typ host',sdpMid:'0',sdpMLineIndex:0,usernameFragment:'ipv6'}});
  const candidate=await p.host.next(m=>m.kind==='candidate');assert.equal(candidate.value.usernameFragment,'ipv6');assert.match(candidate.value.candidate,/2001:db8/);
  assert.equal(p.host.messages.some(m=>m.kind==='prepare'),false);
  p.signal(p.guest,'ready',{mode:'rtc'});await p.host.next(m=>m.kind==='prepare');await p.guest.next(m=>m.kind==='prepare');
  for(const c of [p.host,p.guest])p.signal(c,'prepared',{mode:'rtc'});
  await p.host.next(m=>m.kind==='activate');await p.guest.next(m=>m.kind==='activate');
  assert.equal(p.host.messages.some(m=>m.type==='secure-frame'),false);p.host.socket.close();p.guest.socket.close();
});
test('cross-room and stale generations cannot forward; replaced guests receive fresh keys and epochs',async()=>{
  const p=await pair(),q=await pair();await active(p);await active(q);
  const old=await p.a.seal(2,'d',{raw:'old'});q.host.send(old);
  const good=await q.a.seal(2,'d',{raw:'correct'});q.host.send(good);
  const got=await q.guest.next('secure-frame');assert.equal((await q.b.open(got,2)).raw,'correct');
  p.guest.socket.close();await p.host.next('departed');
  p.host.send(old); // Already-buffered TCP data must not destroy the retained host.
  const next=await connect('join/2/'+p.code+'/'+webcrypto.randomUUID()+'/sas2');await next.next('welcome');
  const init=await p.host.next(m=>m.kind==='init');assert.notEqual(init.session,p.id);
  p.host.send(old);await next.next(m=>m.kind==='rtc');assert.equal(next.messages.some(m=>m.type==='secure-frame'),false);
  for(const c of [p.host,next,q.host,q.guest])c.socket.close();
});
test('slow receivers have 12 data slots plus 4 reserved control slots; credits discard old snapshot queues',async()=>{
  const p=await pair();await active(p);
  for(let i=0;i<24;i++)p.host.send(await p.a.seal(2,'d',{raw:'snapshot '+i}));
  const received=[];for(let i=0;i<12;i++)received.push(await p.guest.next('secure-frame'));
  for(let i=0;i<4;i++)p.host.send(await p.a.seal(2,'c',{id:i+1,raw:'control '+i}));
  for(let i=0;i<4;i++)received.push(await p.guest.next('secure-frame'));
  assert.ok(received.slice(12).every(m=>m.lane==='c'));
  p.signal(p.guest,'candidate',{epoch:2,value:null}); // Ordered barrier, ignored for WS.
  p.guest.send({type:'secure-credit',session:p.id,epoch:2,ticket:received.at(-1).ticket});
  await new Promise(resolve=>setTimeout(resolve,50)); // independent socket handlers may run in either order
  const last=await p.a.seal(2,'d',{raw:'newest'});p.host.send(last);
  const got=await p.guest.next('secure-frame');assert.equal((await p.b.open(got,2)).raw,'newest');
  p.host.socket.close();p.guest.socket.close();
});
test('pending unapproved sockets cannot establish a gameplay transport',async()=>{
  const h=await connect('create/2/1/'+webcrypto.randomUUID()+'/sas2'),w=await h.next('welcome');
  const g=await connect('join/2/'+w.code+'/'+webcrypto.randomUUID()+'/sas2');await g.next('welcome');
  g.send({type:'secure',session:webcrypto.randomUUID(),epoch:0,kind:'ready',mode:'ws'});
  assert.equal((await g.next('error')).code,'unapproved');h.socket.close();g.socket.close();
});
test('malformed pending frames remove only the offender and preserve the private host',async()=>{
  const h=await connect('create/2/1/'+webcrypto.randomUUID()+'/sas2'),w=await h.next('welcome');
  const g=await connect('join/2/'+w.code+'/'+webcrypto.randomUUID()+'/sas2');await g.next('welcome');
  g.socket.send('{"type":"secure-frame",broken');
  assert.equal((await g.next('error')).code,'negotiation_failed');
  const replacement=await connect('join/2/'+w.code+'/'+webcrypto.randomUUID()+'/sas2');
  assert.equal((await replacement.next('welcome')).pending,true);
  assert.equal(h.messages.some(m=>m.type==='error'),false);h.socket.close();replacement.socket.close();
});
test('oversized ciphertext and excess credit traffic reject the sender without forwarding',async()=>{
  const p=await pair();await active(p);
  p.guest.send({type:'secure-frame',session:p.id,epoch:2,lane:'d',seq:1,body:'A'.repeat(23004)});
  assert.equal((await p.guest.next('error')).code,'unauthorized');await p.host.next('departed');
  assert.equal(p.host.messages.some(m=>m.type==='secure-frame'),false);p.host.socket.close();
  const q=await pair();await active(q);
  for(let i=0;i<221;i++)q.guest.send({type:'secure-credit',session:q.id,epoch:2,ticket:0});
  assert.equal((await q.guest.next('error')).code,'unauthorized');await q.host.next('departed');q.host.socket.close();
});

test('kick racing transport recovery revokes forwarding and cannot attach the old guest to a replacement',async()=>{
  const p=await pair();await active(p,'rtc');
  p.signal(p.host,'restart');await p.host.next(m=>m.kind==='rtc'&&m.epoch===1);await p.guest.next(m=>m.kind==='rtc'&&m.epoch===1);
  p.host.send({type:'kick',slot:1});p.signal(p.guest,'fallback',{epoch:1});
  assert.equal((await p.guest.next('error')).code,'kicked');await p.host.next('departed');
  p.host.send(await p.a.seal(1,'d',{raw:'retired snapshot'}));
  const replacement=await connect('join/2/'+p.code+'/'+webcrypto.randomUUID()+'/sas2');await replacement.next('welcome');
  const init=await p.host.next(m=>m.kind==='init');assert.notEqual(init.session,p.id);await replacement.next(m=>m.kind==='rtc');
  replacement.send({type:'secure',session:p.id,epoch:1,kind:'fallback'});
  p.host.send(await p.a.seal(1,'c',{id:1,raw:'retired serve'}));
  p.host.send({type:'secure',session:init.session,epoch:0,kind:'candidate',value:null});
  await replacement.next(m=>m.kind==='candidate'); // Same-socket ordering barrier after the stale ciphertext.
  assert.equal(replacement.messages.some(m=>m.type==='secure-frame'),false);
  p.host.socket.close();replacement.socket.close();
});
