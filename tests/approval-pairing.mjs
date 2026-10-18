import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
const source=['pairing.js','approval-pairing.js'].map(f=>readFileSync(new URL('../game/'+f,import.meta.url),'utf8')).join('\n');
function harness(){
  const timers=new Map();let id=0;
  const context=vm.createContext({crypto:webcrypto,TextEncoder,Uint8Array,DataView,
    setTimeout(fn,ms){timers.set(++id,{fn,ms});return id},clearTimeout(id){timers.delete(id)}});
  vm.runInContext(source,context);return {Pair:vm.runInContext('KingPongApprovalPair',context),timers,context};
}
async function settle(peers){for(let i=0;i<10;i++){await Promise.all(peers.map(p=>p.initialized));await Promise.all(peers.map(p=>p.queue));}}
function pair({rooms=['ABCDEF','ABCDEF'],requests=['attempt-one','attempt-one'],hold=false}={}){
  const clients=[harness(),harness()],messages=[[],[]],pins=[[],[]],failed=[0,0],peers=[];
  for(let i=0;i<2;i++)peers.push(new clients[i].Pair({role:i?'guest':'host',room:rooms[i],request:requests[i],
    send:m=>{messages[i].push(structuredClone(m));if(!hold)peers[1-i].receive(structuredClone(m))},
    ready:(pin,binding)=>pins[i].push({pin,binding}),failed:()=>failed[i]++}));
  return {clients,peers,messages,pins,failed,close:()=>peers.forEach(p=>p.close())};
}
test('independent clients derive matching six-digit PINs without WebRTC and use fresh secrets',async()=>{
  const h=pair();await settle(h.peers);assert.deepEqual(h.failed,[0,0]);assert.match(h.pins[0][0].pin,/^\d{6}$/);
  assert.equal(h.pins[0][0].pin,h.pins[1][0].pin);
  for(let i=0;i<2;i++){
    assert.deepEqual(h.messages[i].map(m=>m.kind),['commit','reveal','ready']);
    assert.ok(h.messages[i].every(m=>!('pin' in m)&&!('sdp' in m)&&!('candidate' in m)));assert.equal(h.peers[i].keys,null);
  }
  const next=pair();await settle(next.peers);assert.notEqual(h.messages[0][0].value,next.messages[0][0].value);
  h.close();next.close();for(const p of h.peers)assert.equal(p.binding,null);for(const c of h.clients)assert.equal(c.timers.size,0);
});
test('room/request binding and commitments prevent old reveals from being replayed',async()=>{
  for(const options of [{rooms:['ABCDEF','BBCDEF']},{requests:['old','new']}]){
    const h=pair(options);await settle(h.peers);assert.deepEqual(h.failed,[1,1]);assert.deepEqual(h.pins,[[],[]]);h.close();
  }
  const old=pair();await settle(old.peers);const h=pair({hold:true});await settle(h.peers);
  h.peers[0].receive(h.messages[1][0]);h.peers[0].receive(old.messages[1][1]);await settle(h.peers);
  assert.equal(h.failed[0],1);assert.equal(h.pins[0].length,0);h.close();old.close();
});
test('reordered reveal/commit/ready messages remain serialized and commitment checked',async()=>{
  const h=pair({hold:true});await settle(h.peers);
  h.peers[1].receive(h.messages[0][0]);await settle(h.peers);
  h.peers[0].receive(h.messages[1][1]);h.peers[0].receive(h.messages[1][0]);await settle(h.peers);
  h.peers[1].receive(h.messages[0].find(m=>m.kind==='ready'));h.peers[1].receive(h.messages[0].find(m=>m.kind==='reveal'));await settle(h.peers);
  h.peers[0].receive(h.messages[1].find(m=>m.kind==='ready'));await settle(h.peers);
  assert.deepEqual(h.failed,[0,0]);assert.equal(h.pins[0][0].pin,h.pins[1][0].pin);h.close();
});
test('expiry, cancellation, malformed frames and floods discard ephemeral state',async()=>{
  for(const sequence of [[{kind:'commit',value:'bad'}],[{kind:'commit',value:'a'.repeat(64)},{kind:'commit',value:'b'.repeat(64)}],Array(13).fill({kind:'ready'})]){
    const h=pair({hold:true});for(const m of sequence)h.peers[0].receive(m);await settle(h.peers);
    assert.equal(h.failed[0],1);assert.equal(h.peers[0].keys,null);assert.equal(h.pins[0].length,0);h.close();
  }
  const h=pair({hold:true});const timer=[...h.clients[0].timers.values()][0];assert.equal(timer.ms,60000);
  timer.fn();h.peers[1].close();await settle(h.peers);assert.deepEqual(h.messages,[[],[]]);assert.deepEqual(h.failed,[1,0]);h.close();
});
test('approved SDP is authenticated with the preconnection key, role and ICE attempt',async()=>{
  const h=pair();await settle(h.peers);
  for(let i=0;i<2;i++)h.clients[i].context.session={role:i?'guest':'host',approvalBinding:h.pins[i][0].binding};
  for(const attempt of [0,1]){
    h.clients[0].context.offer={type:'offer',sdp:'v=0\r\na=fingerprint:sha-256 certificate'};
    const signed=await vm.runInContext(`signApprovedDescription(session,offer,${attempt})`,h.clients[0].context);
    h.clients[1].context.description=signed;
    await vm.runInContext(`verifyApprovedDescription(session,description,${attempt})`,h.clients[1].context);
    await assert.rejects(vm.runInContext(`verifyApprovedDescription(session,description,${1-attempt})`,h.clients[1].context));
    h.clients[1].context.description={...signed,sdp:signed.sdp+'tampered'};
    await assert.rejects(vm.runInContext(`verifyApprovedDescription(session,description,${attempt})`,h.clients[1].context));
  }
  h.close();
});
