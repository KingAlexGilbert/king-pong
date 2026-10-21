import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {harness} from './helpers/royal-harness.mjs';
const wire = readFileSync(new URL('../game/online-wire.js',import.meta.url),'utf8');
const engine = readFileSync(new URL('../game/online-engine.js',import.meta.url),'utf8');
const clean = value => JSON.parse(JSON.stringify(value));
function game() { const h=harness();h.run(wire + '\nonlinePointServeReady=true;');return h; }
function snapshot(h) {
  h.run("lanRole='host';sendLanState(true)");
  return {...h.json("sent.filter(m=>m.type==='state').at(-1)"),gameplay:"royal",matchRules:"presets"};
}

test('compact snapshots preserve every production field, across all arenas and Royal states',()=>{
  const h=game();
  for(let arena=0;arena<18;arena++)for(const kind of ['none','split','rush','guard']) {
    h.run(`matchArenaId=${arena};activeCampaign=${Math.floor(arena/6)};levelIndex=${arena%6};
      hazards=[{id:0,x:201.23456,y:90.888,width:30,height:10,hitFlash:4}];
      royalSplitBall=null;royalGuards={left:0,right:0};ball.rush=false;
      royalPickup={type:'split',x:320,y:240,ttl:235};royalPowerupPulse={x:320,y:240,remaining:23};
      royalGuardHits={left:{seq:3,y:200,ttl:5},right:null};
      royalPowerupCueSequence=2;royalPowerupCues=[{seq:2,kind:'spawn',type:'split',tick:royalRallyTick}];
      ${kind==='split'?"royalSplitBall={x:410.123456789,y:225,vx:-3.34567,vy:2,rush:true};":''}
      ${kind==='rush'?'ball.rush=true;':''}
      ${kind==='guard'?'royalGuards.left=578;':''}`);
    const s=snapshot(h); h.context.packet=s;
    const roundtrip=h.json('decodeOnlineWire(JSON.parse(JSON.stringify(encodeOnlineWire(packet))))');
    assert.deepEqual(roundtrip,s,`${arena}/${kind}`);
    h.context.packet=roundtrip;
    assert.equal(h.run('validLanSnapshot(packet)&&validRoyalState(packet.royal)&&validSelectionState(packet.selection)'),true);
    assert.ok(JSON.stringify(h.run('encodeOnlineWire(packet)')).length < JSON.stringify(s).length*.65);
  }
});

test('lost snapshots need no baseline; nulls clear powerups and stale packets cannot roll back scores',()=>{
  const h=game(), packets=[];
  for(let seq=0;seq<6;seq++) {
    h.run(`left.score=${seq};royalSplitBall=${seq%2?'null':'{x:400,y:200,vx:-3,vy:2,rush:false}'};`);
    packets.push(snapshot(h));
  }
  h.run("lanRole='guest'");
  for(const i of [0,4,2,4,5]){h.context.packet=packets[i];h.run('handleLanGuestMessage(decodeOnlineWire(encodeOnlineWire(packet)))');}
  assert.deepEqual(h.json('applied'),[packets[0].seq,packets[4].seq,packets[5].seq]);
  h.context.packet=packets[5];assert.equal(h.run('decodeOnlineWire(encodeOnlineWire(packet)).royal.split'),null);
});

test('malformed compact payloads cannot advance sequence state or bypass existing validation',()=>{
  const h=game(); h.context.packet=snapshot(h);
  const a=h.json('encodeOnlineWire(packet)');
  const mutations=[v=>v[1]=999,v=>v.push(1),v=>v[10]=null,v=>v[7]=[],v=>v[13][5]=[],
    v=>v[13][8]=Array(17).fill([]),v=>v[14]=Array(129).fill([]),v=>v[9][4]=-1,
    v=>v[10][0]='300',v=>v[11][0]=1,v=>v[8][0]='hacked',v=>v[7][1]='unknown',v=>v[5]=-1,
    v=>v[13][0]=-1,v=>v[13][2]=[200,200,5,0,'true'],v=>v[13][4][0]=999];
  h.run("lanRole='guest'");
  for(const mutate of mutations) { const copy=clean(a);copy[4]=9999;mutate(copy);h.context.bad=copy;
    h.run('{const decoded=decodeOnlineWire(bad);if(decoded)handleLanGuestMessage(decoded);}');
  }
  assert.deepEqual(h.json('applied'),[]);
  h.run('handleLanGuestMessage(decodeOnlineWire(encodeOnlineWire(packet)))');
  assert.deepEqual(h.json('applied'),[a[4]]);
});

function inputHarness() {
  let now=0;
  const ctx=vm.createContext({performance:{now:()=>now}});
  const run=s=>vm.runInContext(s,ctx);
  run(`const LAN_SIGNAL_VERSION=1;let lanRole='guest',lanRoomCode='ABCDE',frame=0,lanInputSeq=0;
    let onlineHasState=true,paused=false,onlineSession={},onlineLastSentAxis=null;
    const right={y:200},onlineInputs=new Map(),sent=[];let value={axis:0,targetY:null},fail=false;
    const lanChannel={readyState:'open'};
    function readLocalLanInput(){return value}
    function onlineInput(v,seq){onlineInputs.set(seq,right.y);return v}
    function lanSend(m){if(fail)return false;sent.push(m);return true}
    function onlineLanSend(m){sent.push(m);return true}
    ${wire}
    ${engine.slice(engine.indexOf('function onlineSendLanInput'),engine.indexOf('function onlineApplyLanHostState'))}`);
  return {run,step(t){now=t;run('frame++;onlineSendLanInput()');},json:s=>clean(run(s)),time:t=>{now=t;}};
}

test('input changes and releases send on the next physics tick, including touch on an odd tick',()=>{
  const h=inputHarness();h.run('onlineWireReady=true');h.step(0);h.run('value.axis=1');h.step(16.667);
  h.run('value.axis=-1');h.step(33.334);
  h.run('value.axis=0;right.y=211.123456');h.step(50);
  assert.deepEqual(h.json('sent.map(m=>m.axis)'),[0,1,-1,0]);
  assert.equal(h.run('sent.at(-1).targetY'),211.12);
  h.run('right.y=222.256');h.step(66.667);assert.equal(h.run('sent.at(-1).targetY'),222.26);
  assert.ok(Math.abs(h.run('onlineInputs.get(4)')-211.123456)<1e-9);
});

test('idle throttling waits for authority acknowledgment; dropped release retries retain 30 Hz cadence',()=>{
  const h=inputHarness();h.run('value.axis=1');h.step(0);h.run('value.axis=0');h.step(16.667);
  for(let t=2;t<60;t++)h.step(t*1000/60);
  assert.ok(h.run('sent.length')>=30,'unacknowledged release must be repeated');
  h.run('onlineInputAck=lanInputSeq');
  const before=h.run('sent.length');
  for(let t=60;t<120;t++){h.step(t*1000/60);h.run('onlineInputAck=lanInputSeq');}
  assert.ok(h.run('sent.length')-before<=4,'confirmed idle uses keepalive only');
});

test('backpressure retries immediately and session reset forgets old input and capabilities',()=>{
  const h=inputHarness();h.run('fail=true');h.step(0);assert.equal(h.run('onlineLastInput'),null);
  assert.equal(h.run('onlineInputs.size'),0);h.run('fail=false');h.step(16.667);assert.equal(h.run('sent.length'),1);
  h.run('onlineWireReady=true;onlineInputAck=999;resetOnlineWire()');
  assert.equal(h.run('onlineLastInput'),null);assert.equal(h.run('onlineWireReady'),false);assert.equal(h.run('onlineInputAck'),-1);
});

test('wire negotiation is bounded, room/version checked, and legacy peers retain legacy format',()=>{
  const h=inputHarness();
  for(let i=0;i<20;i++){h.time(i*500);h.run('negotiateOnlineWire()');}
  assert.equal(h.run('sent.length'),4);assert.equal(h.run('onlineWireReady'),false);
  h.run("receiveOnlineWireHello({v:1,room:'WRONG',gameplay:'royal',matchRules:'presets',format:1,ack:true})");
  assert.equal(h.run('onlineWireReady'),false);
  h.run("receiveOnlineWireHello({v:1,room:'ABCDE',gameplay:'royal',matchRules:'presets',format:99,ack:true})");
  assert.equal(h.run('onlineWireReady'),false);
  h.run("receiveOnlineWireHello({v:1,room:'ABCDE',gameplay:'royal',matchRules:'presets',format:1,ack:true})");
  assert.equal(h.run('onlineWireReady'),true);
});

test('an earlier acknowledgment of unchanged input permits idle throttling under RTT',()=>{
  const h=inputHarness();h.step(0);h.step(17);h.step(34);h.step(51);
  h.run('onlineInputAck=1');const before=h.run('sent.length');
  h.step(68);h.step(85);assert.equal(h.run('sent.length'),before);
  h.run('value.axis=1');h.step(102);assert.equal(h.run('sent.length'),before+1);
});

test('developer diagnostics start only on request, report aggregate bytes and restore channel hooks',async()=>{
  let time=0,intervals=0,listener;
  const channel={send(){},addEventListener(name,fn){listener=fn},removeEventListener(){listener=null}};
  const originalSend=channel.send;
  const ctx=vm.createContext({window:{},TextEncoder,performance:{now:()=>time},
    lanChannel:channel,onlineControlChannel:channel,
    lanPeer:{connectionState:'connected',getStats:async()=>new Map([
      ['transport',{type:'transport',bytesSent:time*10,bytesReceived:time*5,selectedCandidatePairId:'pair'}],
      ['pair',{type:'candidate-pair',localCandidateId:'local',remoteCandidateId:'remote',currentRoundTripTime:.04}],
      ['local',{type:'local-candidate',candidateType:'relay',address:'PRIVATE_ADDRESS'}],
      ['remote',{type:'remote-candidate',candidateType:'host',address:'PRIVATE_ADDRESS'}]
    ])},setInterval(){intervals++;return 1},clearInterval(){intervals--}});
  vm.runInContext(readFileSync(new URL('../tools/network-diagnostics.js',import.meta.url),'utf8'),ctx);
  assert.equal(intervals,0);const monitor=await ctx.window.startKingPongNetworkDiagnostics();assert.equal(intervals,1);
  channel.send('12345');listener({data:'123'});time=1000;
  const result=await monitor.stop();assert.equal(result.payloadUploadKBps,.005);assert.equal(result.payloadDownloadKBps,.003);
  assert.equal(result.transportUploadKBps,10);assert.equal(result.route,'relay');assert.equal(intervals,0);
  assert.equal(channel.send,originalSend);assert.equal(listener,null);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_ADDRESS'));
});
