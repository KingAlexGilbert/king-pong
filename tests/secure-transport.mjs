import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
const source=name=>readFileSync(new URL('../game/'+name,import.meta.url),'utf8');
const context=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,DataView,btoa,atob,setTimeout,clearTimeout});
const Crypto=vm.runInContext(source('pairing.js')+source('approval-pairing.js')+source('secure-crypto.js')+'\nKingPongSessionCrypto',context);
async function pair(binding=null,room='ABCDEF',id='session-one') {
  const a=new Crypto(room,id,'host',binding),b=new Crypto(room,id,'guest',binding);
  const [ka,kb]=await Promise.all([a.offer(),b.offer()]);
  const [pa,pb]=await Promise.all([a.accept(kb),b.accept(ka)]);
  assert.equal(await a.confirm(pb),true);assert.equal(await b.confirm(pa),true);
  return [a,b];
}
test('AES-GCM payloads round trip with independent directional keys; controls contain no visible gameplay',async()=>{
  const [a,b]=await pair();
  const frame=await a.seal(0,'c',{id:1,raw:'serve score=5'});
  assert.equal(JSON.stringify(frame).includes('serve'),false);
  assert.equal((await b.open(frame,0)).raw,'serve score=5');
  assert.equal((await a.open(await b.seal(0,'d',{raw:'input'}),0)).raw,'input');
});
test('tampering, reflection, stale epoch, cross-room/session injection and replay fail closed',async()=>{
  const [a,b]=await pair(),[,other]=await pair(null,'GHIJKL','session-two');
  const f=await a.seal(0,'d',{raw:'state'});
  for(const [receiver,frame,epoch] of [[b,{...f,lane:'c'},0],[a,f,0],[b,f,1],[other,f,0],[b,{...f,body:(f.body[0]==='A'?'B':'A')+f.body.slice(1)},0]])await assert.rejects(()=>receiver.open(frame,epoch));
  await b.open(f,0);await assert.rejects(()=>b.open(f,0));
});
test('unordered data accepts bounded reordering, and reconnect epochs never reuse a nonce',async()=>{
  const [a,b]=await pair();
  const f1=await a.seal(0,'d',{raw:'one'}),f2=await a.seal(0,'d',{raw:'two'});
  await b.open(f2,0);await b.open(f1,0);
  const f3=await a.seal(1,'c',{id:1,raw:'serve'});assert.ok(f3.seq>f2.seq);await b.open(f3,1);
  const [fresh]=await pair();const f4=await fresh.seal(1,'c',{id:1,raw:'serve'});assert.notEqual(f4.body,f3.body);
});
test('approved PIN exchange authenticates transport public keys; an unbound replacement key is rejected',async()=>{
  const key=await webcrypto.subtle.generateKey({name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  const [a,b]=await pair({key});assert.equal((await b.open(await a.seal(0,'d',{raw:'approved'}),0)).raw,'approved');
  const host=new Crypto('ABCDEF','fresh','host',{key}),impostor=new Crypto('ABCDEF','fresh','guest',null);
  await host.offer();await assert.rejects(()=>impostor.offer().then(v=>host.accept(v)));
});
test('limits reject oversized plaintext and forged confirmation',async()=>{
  const [a]=await pair();await assert.rejects(()=>a.seal(0,'c',{raw:'x'.repeat(16384)}));
  assert.equal(await a.confirm('00'.repeat(32)),false);
});
const details=vm.runInContext(source('network-common.js')+'\nkingPongTransportDetails',context);
function stats(local,remote){return new Map([['t',{type:'transport',selectedCandidatePairId:'p'}],['p',{type:'candidate-pair',state:'succeeded',localCandidateId:'l',remoteCandidateId:'r'}],['l',local],['r',remote]]);}
test('diagnostics distinguish IPv4, IPv6, redaction and TURN hop protocol without leaking addresses',()=>{
  for(const [address,family] of [['192.0.2.4','IPv4'],['2001:db8::4','IPv6'],['hidden.local','unknown']]) {
    const result=details(stats({candidateType:'host',address},{candidateType:'host',address}));
    assert.equal(result.family,family);assert.equal(result.transport,'direct');assert.ok(!JSON.stringify(result).includes(address));
  }
  for(const protocol of ['udp','tcp','tls'])assert.equal(details(stats({candidateType:'relay',relayProtocol:protocol},{candidateType:'host'})).relayProtocol,protocol);
  assert.equal(details(stats({candidateType:'host'},{candidateType:'relay',protocol:'udp'})).relayProtocol,'unknown');
});

function transportHarness(cryptoImpl=webcrypto) {
  const sent=[],timers=new Map();let next=0;
  class Peer {
    constructor(config){this.config=config;this.connectionState='new';this.iceConnectionState='new';this.added=[];this.channels=[];}
    createDataChannel(){const channel={readyState:'connecting',bufferedAmount:0,close(){this.readyState='closed';}};this.channels.push(channel);return channel;}
    async createOffer(options){this.lastOffer=options;return {type:'offer',sdp:'v=0\r\na=ice-ufrag:new\r\n'};}
    async setLocalDescription(d){this.localDescription={...d,toJSON:()=>d};this.onicecandidate?.({candidate:null});for(const usernameFragment of ['old','new'])this.onicecandidate?.({candidate:{toJSON:()=>({candidate:'candidate:test',sdpMid:'0',sdpMLineIndex:0,usernameFragment})}});}
    async setRemoteDescription(d){this.remoteDescription=d;}
    async addIceCandidate(c){this.added.push(c);}
    setConfiguration(config){this.config=config;}
    close(){this.connectionState='closed';}
  }
  const ctx=vm.createContext({crypto:cryptoImpl,TextEncoder,TextDecoder,Uint8Array,DataView,btoa,atob,Date,RTCPeerConnection:Peer,
    setInterval:()=>0,clearInterval(){},setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id)});
  const Transport=vm.runInContext(['pairing.js','approval-pairing.js','secure-crypto.js','secure-transport.js'].map(source).join('\n')+'\nKingPongSecureTransport',ctx);
  const owner={role:'host',code:'ABCDEF',hooks:{channel(){},peer(){},status(){},interrupted(){}},send:m=>sent.push(m),fail:code=>{owner.error=code;owner.secure?.close();}};
  owner.secure=new Transport(owner,{session:'one',epoch:0});
  return {t:owner.secure,owner,sent,timers,ctx};
}
test('early IPv6/IPv4 ICE is queued; late old-ufrag candidates are filtered; restart preserves the peer',async()=>{
  const {t,sent}=transportHarness();
  await t.startRtc({iceServers:[{urls:'turn:example.test?transport=udp'}]});
  const peer=t.peer;
  assert.equal(peer.config.iceTransportPolicy,'all');
  assert.deepEqual(sent.filter(m=>m.kind==='candidate').map(m=>m.value.usernameFragment),['new']);
  const v6={candidate:'candidate:1 1 UDP 1 2001:db8::1 5000 typ host',sdpMid:'0',sdpMLineIndex:0,usernameFragment:'new'};
  const v4={...v6,candidate:'candidate:2 1 UDP 1 192.0.2.1 5000 typ host'};
  for(const value of [v6,v4])await t.receive({session:'one',epoch:0,kind:'candidate',value});
  assert.equal(peer.added.length,0);
  await t.receive({session:'one',epoch:0,kind:'description',value:{type:'answer',sdp:'v=0\r\n'}});
  assert.equal(peer.added[0].candidate,v6.candidate);assert.equal(peer.added[1].candidate,v4.candidate);
  t.epoch=1;await t.startRtc({restart:true,iceServers:[]});assert.equal(t.peer,peer);assert.equal(peer.lastOffer.iceRestart,true);
  await t.receive({session:'one',epoch:0,kind:'candidate',value:v4});assert.equal(peer.added.length,2);
  t.close();
});
test('selected ICE gets bounded DTLS grace; encryption failure never enables plaintext fallback',async()=>{
  const {t,timers}=transportHarness();await t.startRtc({iceServers:[]});t.keyReady=true;
  t.peer.iceConnectionState='connected';[...timers.values()].find(v=>v.ms===20000).fn();
  assert.equal(t.requestedEpoch,undefined);assert.ok([...timers.values()].some(v=>v.ms===12000));t.close();
  const h=transportHarness({subtle:{generateKey:async()=>{throw Error('disabled');}}});
  await h.t.keyStart.catch(()=>{});
  assert.equal(h.owner.error,'negotiation_failed');assert.equal(h.t.closed,true);
  assert.equal(h.sent.some(m=>m.type==='secure-frame'||m.kind==='ready'),false);
});
test('ready countdown cannot serve or advance while a transport is recovering',()=>{
  const ctx=vm.createContext({onlineSession:{secure:{phase:'negotiating'}}});
  vm.runInContext(source('online-match-flow.js')+"\nonlineMatchFlow={phase:'countdown'};tickOnlineMatchFlow();",ctx);
  assert.equal(vm.runInContext('onlineMatchFlow.phase',ctx),'countdown');
});
test('recovery requires a new two-peer commit; transient ICE state cannot activate the new epoch',async()=>{
  const {t,owner,sent}=transportHarness();await t.startRtc({iceServers:[]});
  let resumed=0;owner.hooks.resumed=()=>resumed++;
  t.keyReady=true;t.phase='active';t.everConnected=true;t.readySent=true;
  t.peer.connectionState=t.peer.iceConnectionState='disconnected';t.rtcState();
  assert.equal(t.phase,'active','advisory disconnect alone leaves traffic flowing');
  t.rtcFailed();assert.equal(t.temporaryDisconnect,false);
  await t.receive({session:'one',epoch:1,kind:'rtc',restart:true,iceServers:[]});
  assert.equal(t.disconnectTimer,null);
  t.peer.connectionState=t.peer.iceConnectionState='connected';t.rtcState();
  assert.equal(t.phase,'negotiating');assert.equal(resumed,0);
  for(const c of t.peer.channels)c.readyState='open';
  await t.receive({session:'one',epoch:1,kind:'description',value:{type:'answer',sdp:'v=0\r\n'}});
  assert.ok(sent.some(m=>m.kind==='ready'&&m.epoch===1));assert.equal(t.phase,'negotiating');
  await t.receive({session:'one',epoch:1,kind:'prepare',mode:'rtc'});
  await t.receive({session:'one',epoch:1,kind:'activate',mode:'rtc'});
  assert.equal(t.phase,'active');assert.equal(resumed,1);assert.equal(t.disconnectTimer,null);
  // ICE failure can precede the aggregate connectionState event.
  t.peer.iceConnectionState='failed';t.rtcState();assert.equal(t.phase,'negotiating');
  assert.ok(sent.some(m=>m.kind==='restart'&&m.epoch===1));t.close();
});
test('encrypted controls deduplicate across transport epochs and reject late datagrams without disconnecting',async()=>{
  const {t,owner}=transportHarness();await t.keyStart;
  const [sender,receiver]=await pair(null,'ABCDEF','one');t.crypto.close();t.crypto=receiver;
  t.keyReady=true;t.phase='active';t.mode='ws';owner.socket={bufferedAmount:0,send(){}};
  const delivered=[];owner.hooks.message=raw=>delivered.push(raw);
  const first=await sender.seal(0,'c',{id:1,raw:'pause'});t.packet(first);await t.rx;
  t.packet(first);await t.rx;assert.deepEqual(delivered,['pause']);assert.equal(t.closed,false);
  t.epoch=1;t.packet(await sender.seal(1,'c',{id:1,raw:'pause'}));await t.rx;
  t.packet(await sender.seal(1,'c',{id:3,raw:'third'}));await t.rx;
  t.packet(await sender.seal(1,'c',{id:2,raw:'second'}));await t.rx;
  assert.deepEqual(delivered,['pause','second','third']);assert.equal(t.closed,false);t.close();
});
test('an unavailable WebSocket fails closed without sending a plaintext packet',async()=>{
  const {t,owner}=transportHarness();await t.keyStart;
  const [sender]=await pair(null,'ABCDEF','one');t.crypto.close();t.crypto=sender;
  t.keyReady=true;t.phase='active';t.mode='ws';
  const sent=[];owner.socket={bufferedAmount:0,send:raw=>{sent.push(raw);throw Error('closed socket');}};
  t.enqueue('private gameplay',true);
  while(t.flushing)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(owner.error,'negotiation_failed');assert.equal(t.closed,true);
  assert.equal(sent.length,1);assert.equal(sent[0].includes('private gameplay'),false);
});
test('usable RTC channels activate without WebSocket gameplay, with and without configured TURN servers',async()=>{
  for(const iceServers of [[],[{urls:'stun:example.test'}],[{urls:'turn:example.test?transport=udp',username:'test',credential:'test'}]]) {
    const {t,owner,sent}=transportHarness();let connected=0;owner.hooks.connected=()=>connected++;
    await t.startRtc({iceServers});t.keyReady=true;
    for(const c of t.peer.channels)c.readyState='open';
    t.peer.connectionState=t.peer.iceConnectionState='connected';
    await t.receive({session:'one',epoch:0,kind:'description',value:{type:'answer',sdp:'v=0\r\n'}});
    assert.ok(sent.some(m=>m.kind==='ready'&&m.mode==='rtc'));
    await t.receive({session:'one',epoch:0,kind:'prepare',mode:'rtc'});
    await t.receive({session:'one',epoch:0,kind:'activate',mode:'rtc'});
    assert.equal(t.phase,'active');assert.equal(connected,1);
    assert.equal(sent.some(m=>['fallback','restart'].includes(m.kind)||m.type==='secure-frame'),false);t.close();
  }
});
test('browser RTC API failures attempt recovery and then allow encrypted fallback',async()=>{
  const {t,owner,sent}=transportHarness();await t.startRtc({iceServers:[]});t.keyReady=true;
  t.peer.setRemoteDescription=async()=>{throw Error('RTC negotiation unavailable');};
  await t.receive({session:'one',epoch:0,kind:'description',value:{type:'answer',sdp:'v=0\r\n'}});
  assert.ok(sent.some(m=>m.kind==='restart'&&m.epoch===0));assert.equal(owner.error,undefined);
  t.peer.setConfiguration=()=>{throw Error('restart unavailable');};
  await t.receive({session:'one',epoch:1,kind:'rtc',restart:true,iceServers:[]});
  assert.ok(sent.some(m=>m.kind==='fallback'&&m.epoch===1));assert.equal(owner.error,undefined);t.close();
});
test('backpressure coalesces snapshots, expires stale unsent data, and sends reliable controls first',async()=>{
  const {t,owner}=transportHarness();await t.keyStart;
  const [sender,receiver]=await pair(null,'ABCDEF','one');t.crypto.close();t.crypto=sender;
  t.keyReady=true;t.phase='active';t.mode='ws';
  const sent=[];owner.socket={bufferedAmount:49152,send:raw=>sent.push(JSON.parse(raw))};
  for(let i=0;i<40;i++)t.enqueue('snapshot '+i,false);
  assert.equal(sent.length,0);assert.equal(t.latest,'snapshot 39');
  t.latestAt-=300;owner.socket.bufferedAmount=0;await t.flush();assert.equal(sent.length,0);
  owner.socket.bufferedAmount=49152;t.enqueue('latest',false);t.enqueue('pause',true);
  owner.socket.bufferedAmount=0;await t.flush();
  assert.deepEqual(sent.map(m=>m.lane),['c','d']);
  assert.equal((await receiver.open(sent[0],0)).raw,'pause');
  assert.equal((await receiver.open(sent[1],0)).raw,'latest');t.close();
});

test('provider diagnostics require an exact selected local candidate URL, never type/IP/protocol guesses',()=>{
  const primary='turn:primary.relay.metered.ca:80';
  const providers=new Map([[primary,'metered']]);
  for(const [url,provider] of [[primary,'metered'],[undefined,'unknown'],['turn:unconfigured.metered.ca:80','unknown']]) {
    const d=details(stats({candidateType:'relay',address:'192.0.2.1',relayProtocol:'udp',url},{candidateType:'host'}),providers);
    assert.equal(d.provider,provider);assert.ok(!JSON.stringify(d).includes('192.0.2.1'));assert.ok(!JSON.stringify(d).includes('metered.ca'));
  }
  assert.equal(details(stats({candidateType:'host'},{candidateType:'relay',url:primary}),providers).provider,'unknown');
});
test('ICE restarts preserve peer, crypto, control IDs and sequence space; unattributed endpoints stay generic',async()=>{
  const {t}=transportHarness(),url='turn:shared.relay.metered.ca:80';
  await t.startRtc({provider:'metered',iceServers:[{urls:url}]});const peer=t.peer,key=t.crypto;
  t.controlId=7;t.receivedControl=5;t.pending.set(7,{raw:'pause',created:Date.now(),sentAt:0});
  await t.receive({kind:'rtc',session:'one',epoch:1,provider:'metered',restart:true,iceServers:[{urls:url}]});
  assert.equal(t.turnProviders.get(url),'metered');
  await t.receive({kind:'rtc',session:'one',epoch:2,restart:true,iceServers:[{urls:url}]});
  assert.equal(t.peer,peer);assert.equal(t.crypto,key);assert.equal(t.controlId,7);assert.equal(t.receivedControl,5);assert.ok(t.pending.has(7));
  assert.equal(t.turnProviders.get(url),'unknown');assert.equal(peer.lastOffer.iceRestart,true);t.close();
});
test('all nine translations include Metered and generic TURN labels for supported protocols',()=>{
  const ctx=vm.createContext({window:{}});vm.runInContext(source('online-localization.js'),ctx);
  for(const lang of ['es','fr','de','pt','it','nl','ja','ko','zh'])for(const label of ['Metered TURN','TURN relay'])for(const suffix of ['',' — UDP',' — TCP',' — TLS'])
    assert.equal(typeof ctx.window.KING_PONG_ONLINE_TRANSLATIONS[lang][label+suffix],'string');
});

// Controlled time exercises jitter independently of browser ICE timing.
test('degraded RTC uses authenticated traffic and a three-second stabilization period, without repeated freezes',async()=>{
  const {t,owner,ctx,timers,sent}=transportHarness();await t.startRtc({iceServers:[]});
  let now=1000,freezes=0,resumes=0;ctx.Date={now:()=>now};
  owner.hooks.interrupted=()=>freezes++;owner.hooks.resumed=()=>resumes++;
  t.keyReady=true;t.phase='active';t.everConnected=true;t.lastPeerTraffic=now;
  for(const c of t.peer.channels)c.readyState='open';
  for(let i=0;i<5;i++){
    t.peer.connectionState=t.peer.iceConnectionState='disconnected';t.rtcState();const timer=t.disconnectTimer;t.rtcState();
    assert.equal(t.disconnectTimer,timer,'duplicate states share a timer');
    now+=200;t.lastPeerTraffic=now;
    t.peer.connectionState=t.peer.iceConnectionState='connected';t.rtcState();
    assert.equal(t.phase,'active');assert.equal(t.disconnectTimer,null);
  }
  assert.equal(freezes,0);assert.equal(resumes,0);
  t.peer.connectionState=t.peer.iceConnectionState='disconnected';t.rtcState();
  now+=3000;t.lastPeerTraffic=now-20;timers.get(t.disconnectTimer).fn();
  assert.equal(t.phase,'active','recent traffic outweighs a degraded state');
  now+=3000;timers.get(t.disconnectTimer).fn();
  assert.equal(t.phase,'negotiating');assert.equal(freezes,1);
  assert.equal(t.transitionReason,'rtc-degraded-no-traffic');
  t.rtcFailed();assert.equal(freezes,1);assert.equal(sent.filter(m=>m.kind==='restart').length,1);
  t.peer.connectionState=t.peer.iceConnectionState='connected';t.rtcState();
  assert.equal(t.phase,'negotiating','connected events cannot bypass recovery commit');t.close();
});
