import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SecureRoomTransport} from '../src/secure-relay.js';
import {PongRoom} from '../src/worker.js';
const ice=name=>[{urls:[`turn:${name}.relay.metered.ca:80`,`turns:${name}.relay.metered.ca:443?transport=tcp`],username:'temporary',credential:'temporary'}];
async function fixture({primary=ice('primary')}={}) {
  const reads=[],sent=[[],[]],sockets=sent.map((out,i)=>({a:{closed:false,role:i?'guest':'host'},
    deserializeAttachment(){return structuredClone(this.a);},serializeAttachment(a){this.a=structuredClone(a);},send(m){out.push(JSON.parse(m));}}));
  const results={metered:primary};
  const env={METERED_APP_NAME:'primary',
    TURN_CREDENTIALS:{idFromName:n=>n,get:n=>({fetch:async()=>{reads.push(n);const r=results[n];if(r instanceof Error)throw r;return r===null?Response.json({reason:'quota_exhausted'},{status:503}):Response.json(r);}})}};
  const ctx={getWebSockets:()=>sockets},relay=new SecureRoomTransport(ctx,env);
  let state, ended=null,activations=0;
  const save=async s=>{state=s;};await relay.begin(sockets,save);state.keys={host:'ready',guest:'ready'};
  return {env,relay,reads,sent,sockets,results,get state(){return state;},get ended(){return ended;},get activations(){return activations;},
    send:(role,kind,fields={})=>relay.control(sockets[role],{session:state.id,epoch:state.epoch,kind,...fields},state,save,async e=>{ended=e;},async()=>activations++),
    async activate(){for(const role of [0,1])await this.send(role,'ready',{mode:state.mode});for(const role of [0,1])await this.send(role,'prepared',{mode:state.mode});}};
}
test('healthy direct/Metered phase reads only primary credentials and never activates WebSocket gameplay',async()=>{
  const h=await fixture();assert.equal(h.state.provider,'metered');assert.deepEqual(h.reads,['metered']);
  assert.ok(h.state.iceServers[0].urls.startsWith('stun:'));assert.equal(h.state.iceServers.length,2);
  await h.activate();assert.equal(h.state.phase,'active');assert.equal(h.state.mode,'rtc');assert.equal(h.activations,1);
  assert.equal(h.sent.flat().some(m=>m.kind==='ws'),false);
});
test('failed/unavailable/quota-withheld Metered credentials retain direct ICE and permit encrypted WS after recovery',async()=>{
  for(const primary of [new Error('upstream timeout'),[],null]){
    const h=await fixture({primary});assert.equal(h.state.provider,'metered');assert.deepEqual(h.reads,['metered']);
    assert.equal(h.state.epoch,0);assert.deepEqual(h.state.iceServers,[{urls:'stun:stun.cloudflare.com:3478'}]);
    await h.activate();assert.equal(h.state.mode,'rtc');
    await h.send(0,'restart');await h.send(1,'fallback');await h.activate();
    assert.equal(h.state.mode,'ws');assert.equal(h.state.epoch,2);assert.deepEqual(h.reads,['metered','metered']);
  }
});
test('failed Metered recovery selects encrypted WS without another ICE phase and preserves session identity',async()=>{
  const h=await fixture(),id=h.state.id;await h.activate();
  await h.send(0,'restart');assert.equal(h.state.provider,'metered');assert.equal(h.state.epoch,1);
  assert.deepEqual(h.reads,['metered','metered']);
  assert.equal(h.sockets.every(s=>!s.a.secure.active),true);
  await h.send(0,'ready',{mode:'rtc'});await h.send(1,'ready',{mode:'ws'});assert.equal(h.state.phase,'negotiating');
  await h.send(1,'fallback');assert.equal(h.state.mode,'ws');assert.equal(h.state.epoch,2);assert.equal(h.state.id,id);
  assert.deepEqual(h.reads,['metered','metered']);
  assert.deepEqual(h.sent[0].filter(m=>m.kind==='rtc').map(m=>m.epoch),[0,1]);
  await h.activate();assert.equal(h.activations,2);assert.equal(h.ended,null);
});
test('direct recovery during a Metered ICE restart does not activate WebSockets',async()=>{
  const h=await fixture();await h.activate();await h.send(0,'restart');await h.activate();
  assert.equal(h.state.provider,'metered');assert.equal(h.state.mode,'rtc');assert.deepEqual(h.reads,['metered','metered']);
  assert.equal(h.sent.flat().some(m=>m.kind==='ws'),false);
});
test('the existing session restart cap activates WebSockets without another credential lookup',async()=>{
  const h=await fixture();
  for(let i=0;i<3;i++)await h.send(0,'restart');
  assert.equal(h.state.mode,'rtc');assert.equal(h.state.restarts,3);
  await h.send(0,'restart');
  assert.equal(h.state.mode,'ws');assert.equal(h.state.epoch,4);assert.equal(h.reads.length,4);
});
test('Metered quota changes affect only necessary recovery, not a healthy active connection',async()=>{
  const h=await fixture();await h.activate();h.results.metered=null;
  assert.equal(h.state.phase,'active');assert.equal(h.state.epoch,0);
  await h.send(0,'restart');await h.send(1,'fallback');assert.equal(h.state.mode,'ws');assert.equal(h.state.epoch,2);
});
test('simultaneous recovery/stale descriptions and revoked membership cannot change the new epoch',async()=>{
  const h=await fixture();await h.activate();await h.send(0,'restart');
  const count=h.sent[0].length;await h.send(1,'restart',{epoch:0});await h.send(1,'candidate',{epoch:0,value:null});
  assert.equal(h.state.epoch,1);assert.equal(h.sent[0].length,count);
  h.sockets[1].a.closed=true;
  await h.send(1,'fallback');assert.equal(h.state.provider,'metered');
  assert.equal(h.relay.frame(h.sockets[1],{type:'secure-frame',session:h.state.id,epoch:1,lane:'d',seq:1,body:'A'.repeat(24)}),false);
});
test('Metered credential cache timeout remains bounded and retains STUN',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const relay=new SecureRoomTransport({}, {
    TURN_CREDENTIALS:{idFromName:n=>n,get:()=>({fetch:()=>new Promise(()=>{})})}});
  const pending=relay.iceServers();t.mock.timers.tick(1500);
  assert.deepEqual(await pending,[{urls:'stun:stun.cloudflare.com:3478'}]);
});
test('valid gameplay is synchronous and storage-free; invalid frames enter the revocation gate before yielding',async()=>{
  const h=await fixture();await h.send(0,'restart');await h.send(1,'fallback');await h.activate();
  const worker=Object.create(PongRoom.prototype);let locks=0,revoked=0;
  worker.secure=h.relay;worker.ctx={blockConcurrencyWhile:fn=>{locks++;return fn();}};worker.end=async()=>{h.sockets[0].a.closed=true;revoked++;};
  const frame={type:'secure-frame',session:h.state.id,epoch:h.state.epoch,lane:'d',seq:1,body:'A'.repeat(24)};
  assert.equal(worker.webSocketMessage(h.sockets[0],JSON.stringify(frame)),undefined);assert.equal(locks,0);
  await worker.webSocketMessage(h.sockets[0],JSON.stringify(frame));assert.equal(locks,1);assert.equal(revoked,1);
  const count=h.sent[1].length;await worker.webSocketMessage(h.sockets[0],JSON.stringify({...frame,seq:2}));assert.equal(h.sent[1].length,count);
});
