import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
const code=['online-wire','multiplayer-rematch'].map(n=>readFileSync(new URL('../game/'+n+'.js',import.meta.url),'utf8')).join('\n');
function peer(role) {
 const ctx=vm.createContext({crypto:webcrypto,performance:{now:()=>1000}});
 const run=source=>vm.runInContext(source,ctx);
 run(`let onlineSession={},lanRole='${role}',lanRoomCode='ABCDEF',mode=2,gameOver=true,lanConnected=true,
   onlineGameBlocked=false,onlineHasState=true,shakeFrames=0,waitingForServe=true,paused=false,resumeCountdownEndAt=0,lastResumeCountdownNumber=0;
   const LAN_SIGNAL_VERSION=1,ONLINE_ERRORS={connection_lost:"lost"};let onlineMatchFlow={phase:'playing'},onlineInputs=new Map(),lanRemoteInput={};
   let resets=0,countdowns=0,uiUpdates=0,leaves=0,sent=[],left={score:10},right={score:8};
   function lanSend(m){sent.push({...m,gameplay:'royal',matchRules:'presets'});return true}
   function syncRoyalUi(){uiUpdates++}function resetVisualHistory(){}function clearHeldInput(){}
   function startLevel(){resets++;left.score=right.score=0;gameOver=false;waitingForServe=true;paused=false}
   function hideFirstStartControls(){}function setMenusVisible(){}function beginPointServeCountdown(){countdowns++}
   function sendLanState(){}const document={body:{classList:{contains:()=>false}}};
   ${code}
   endMultiplayerSession=()=>{leaves++;onlineSession=null;lanConnected=false};
   multiplayerRematch();`);
 return {run,ctx,json:s=>JSON.parse(JSON.stringify(run(s)))};
}
function pair() {
 const a=peer('host'),b=peer('guest');
 const token=a.run('multiplayerRematch().token');
 for(const p of [a,b])p.run(`receiveRematchHello({rematch:1,rematchToken:'${token}'})`);
 const deliver=(from,to,mutate=m=>m)=>{
   const messages=from.json('sent.splice(0)');
   for(const m of messages){to.ctx.message=mutate(m);to.run('receiveMultiplayerRematch(message)');}
   return messages;
 };
 return {a,b,deliver,flush(){for(let i=0;i<4;i++){deliver(a,b);deliver(b,a);}}};
}
test('mutual acceptance resets once, including simultaneous and duplicate controls, and can repeat',()=>{
 const p=pair(),{a,b}=p;
 a.run('hideFirstStartControls=undefined'); // Android has no desktop-only start controls.
 a.run('requestMultiplayerRematch()');p.flush();assert.equal(a.run('resets'),0);
 b.run('requestMultiplayerRematch()');
 const requests=p.deliver(b,a);for(let i=0;i<3;i++){a.ctx.message=requests[0];a.run('receiveMultiplayerRematch(message)');}
 p.flush();assert.equal(a.run('resets'),1);assert.equal(a.run('countdowns'),1);assert.equal(b.run('resets'),0);
 assert.equal(b.run('onlineHasState'),false,'new authoritative snapshot must reset guest paddle prediction');
 b.run('gameOver=false;finishMultiplayerRematchSnapshot()');
 for(const peer of [a,b])peer.run('gameOver=true;requestMultiplayerRematch()');p.flush();
 assert.equal(a.run('resets'),2);assert.equal(a.run('multiplayerRematch().round'),2);
});
test('unsolicited, stale, foreign, malformed and guest-authored starts cannot reset a match',()=>{
 const p=pair(),{a,b}=p;
 assert.equal(b.run("acceptMultiplayerRound({type:'state'})"),true,'round zero accepts an in-flight pre-negotiation snapshot');
 a.run("sendRematch('start')");p.deliver(a,b);
 assert.equal(b.run('multiplayerRematch().round'),0);
 b.run("sendRematch('started',1);sendRematch('start')");p.flush();assert.equal(a.run('resets'),0);
 a.run('requestMultiplayerRematch()');b.run('requestMultiplayerRematch()');
 const requests=b.json('sent');
 for(const change of [m=>({...m,round:-1}),m=>({...m,round:8}),m=>({...m,token:'stale'}),m=>({...m,room:'OTHER'}),m=>({...m,protocol:9})]){
   a.ctx.message=change(requests[0]);a.run('receiveMultiplayerRematch(message)');
 }
 assert.equal(a.run('multiplayerRematch().remote'),false);p.flush();
 a.ctx.message=requests[0];a.run('receiveMultiplayerRematch(message)');assert.equal(a.run('resets'),1);
 assert.equal(a.run("acceptMultiplayerRound({type:'input',round:0})"),false);
 assert.equal(b.run("acceptMultiplayerRound({type:'state',round:0})"),false);
 assert.equal(b.run("acceptMultiplayerRound({type:'state'})"),false,'later rounds require an explicit round tag');
 assert.equal(b.run("acceptMultiplayerRound({type:'state',round:1})"),true);
});
test('round tags survive compact input and snapshots while legacy tuples remain supported',()=>{
 const {a}=pair();
 a.run("const input={type:'input',room:lanRoomCode,seq:2,axis:0,targetY:null,round:4};");
 assert.equal(a.run('decodeOnlineWire(encodeOnlineWire(input)).round'),4);
 a.run('onlineRematchReady=false');assert.equal(a.run('encodeOnlineWire(input).length'),7);
});
test('departure during preparation cancels and a stale departure cannot end a later round',()=>{
 const p=pair(),{a,b}=p;
 a.run('requestMultiplayerRematch()');b.run("sendRematch('leave')");p.deliver(b,a);
 assert.equal(a.run('leaves'),1);assert.equal(a.run('resets'),0);
 const q=pair();q.a.run('requestMultiplayerRematch()');q.b.run('requestMultiplayerRematch()');q.flush();
 q.b.run("sendRematch('leave',0)");q.deliver(q.b,q.a);assert.equal(q.a.run('leaves'),0);
});
test('recovery preserves consent, resends a lost start acknowledgement and suspends the active timeout',()=>{
 const p=pair(),{a,b}=p;
 a.run('requestMultiplayerRematch()');b.run('requestMultiplayerRematch()');p.deliver(b,a);p.deliver(a,b);
 b.run('sent=[]');assert.equal(a.run('resets'),0);
 a.run("sendRematch('start')");p.flush();assert.equal(a.run('resets'),1);
 const q=pair();q.a.run('requestMultiplayerRematch()');q.b.run('requestMultiplayerRematch()');q.deliver(q.b,q.a);
 q.a.run('onlineGameBlocked=true;performance.now=()=>30000;tickMultiplayerRematch()');
 assert.equal(q.a.run('leaves'),0);assert.equal(q.a.run('multiplayerRematch().local'),true);
 q.a.run('onlineGameBlocked=false;performance.now=()=>43001;tickMultiplayerRematch()');assert.equal(q.a.run('leaves'),1);
});

function shutdownPeer(origin, role, failure) {
 const timers=new Map();let id=0;
 const ctx=vm.createContext({setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id},clearTimeout:id=>timers.delete(id)});
 const run=s=>vm.runInContext(s,ctx);
 const leave=readFileSync(new URL('../game/royal-ui.js',import.meta.url),'utf8').split("// Android's intercepted Back")[0];
 run(`let onlineSession,lanRole='${role}',lanConnected=true,lanRoomCode='ABCDEF',mode=2,gameOver=false,
   onlineGameBlocked=false,paused=false,onlineManualLanSelected=false,onlineMatchFlow={phase:'playing'};
   let closes=0,retries=0,releases=0,navigations=0,actions=0,sends=0,focus='',departOnSend=false,departOnFocus=false;
   const nodes=new Map(),window={};
   function byId(id){if(!nodes.has(id))nodes.set(id,{id,hidden:true,focus(){focus=id}});return nodes.get(id)}
   function royalText(node,text){node.textContent=text}
   function clearHeldInput(){}function setMenusVisible(){}function setLanStatus(){}function resetFrameClock(){}
   function syncRoyalUi(){}function syncRoyalFocus(){if(departOnFocus){departOnFocus=false;endMultiplayerSession()}}
   function sendMultiplayerPresence(){if(onlineSession)sends++;if(departOnSend){departOnSend=false;endMultiplayerSession()}}
   function startOnlineSetup(a,b,observe){if(observe!==false)throw Error('queue reopened');navigations++}
   function openOfflineLanSetup(){navigations++}
   function closeOnlineConnection(){const s=onlineSession;onlineSession=null;lanConnected=false;return s.close()}
   let finishClose,rejectClose;
   const networkClosed=new Promise((resolve,reject)=>{finishClose=resolve;rejectClose=reject});
   networkClosed.retry=()=>{retries++};networkClosed.release=()=>{releases++};
   onlineSession={multiplayerOrigin:'${origin}',close(){closes++;${failure==='throw'?"throw Error('close failed')":'return networkClosed'}}};
   ${leave}
   ${code}
   sendRematch=()=>{if(onlineSession)sends++};
   guardMultiplayerLeave(()=>{actions++;onlineSession=null});`);
 return {run,timers,async settle(){for(let i=0;i<4;i++)await Promise.resolve()},fire(){for(const [id,t]of timers){timers.delete(id);t.fn()}}};
}

test('terminal watchdog bounds UI waiting without claiming closure; late completion cannot revive old sessions',async()=>{
 for(const origin of ['matchmaking','private','lan'])for(const role of ['host','guest'])
 for(const failure of ['normal','never','late','reject','throw']) {
   const h=shutdownPeer(origin,role,failure);
   h.run('endMultiplayerSession();endMultiplayerSession();finishMultiplayerLeave(true)');
   assert.equal(h.run('!onlineSession&&!multiplayerLeaveRequest&&actions===0&&closes===1&&paused'),true);
   assert.equal(h.run("byId('multiplayerLeave').hidden"),true);
   assert.deepEqual([...h.timers.values()].map(t=>t.ms),[5000]);
   if(failure==='normal')h.run('finishClose()');
   if(failure==='reject')h.run("rejectClose(Error('native acknowledgement failed'))");
   await h.settle();
   if(['never','late'].includes(failure)) {
     assert.equal(h.run('multiplayerDisconnect.ready'),false);
     h.run('acknowledgeMultiplayerDisconnect()');assert.equal(h.run('navigations'),0);
     h.fire();await h.settle();
   }
   assert.equal(h.run('multiplayerDisconnect.ready'),true);
   assert.equal(h.run('multiplayerDisconnect.confirmed'),failure==='normal');
   assert.equal(h.timers.size,0);
   if(failure==='late'){h.run('finishClose()');await h.settle();assert.equal(h.run('multiplayerDisconnect.confirmed'),true);}
   h.run('endMultiplayerSession();finishMultiplayerLeave(true);finishMultiplayerLeave(false)');
   assert.equal(h.run('closes'),1);assert.equal(h.run('actions'),0);
   h.run('acknowledgeMultiplayerDisconnect();acknowledgeMultiplayerDisconnect()');
   assert.equal(h.run('navigations'),1);
   h.run('finishClose();onlineSession={newSession:true}');await h.settle();
   assert.equal(h.run('!multiplayerDisconnect&&onlineSession.newSession'),true,'late completion is generation fenced');
   assert.equal(h.run("byId('multiplayerDisconnected').hidden"),true);
   assert.ok(h.run('retries')<=1);assert.equal(h.run('sends'),0);
 }
});

test('confirmed local Leave does not show an opponent-disconnected dialog; earlier remote departure still wins',async()=>{
 for(const origin of ['matchmaking','private','lan'])for(const role of ['host','guest'])
 for(const order of ['confirm-send','confirm-focus','cancel-focus','remote-first','local-first']) {
   const h=shutdownPeer(origin,role,'normal');
   if(order==='confirm-send')h.run('departOnSend=true;finishMultiplayerLeave(true)');
   if(order==='confirm-focus')h.run('departOnFocus=true;finishMultiplayerLeave(true)');
   if(order==='cancel-focus')h.run('departOnFocus=true;finishMultiplayerLeave(false)');
   if(order==='remote-first')h.run('endMultiplayerSession();finishMultiplayerLeave(true)');
   if(order==='local-first')h.run('finishMultiplayerLeave(true);endMultiplayerSession()');
   h.run('finishClose()');await h.settle();
   if(['confirm-send','confirm-focus','local-first'].includes(order)) {
     assert.equal(h.run("actions===1&&!multiplayerDisconnect&&!onlineSession&&byId('multiplayerDisconnected').hidden"),true,
       `${origin}/${role}/${order}: local departure should not show opponent popup`);
   } else {
     assert.equal(h.run('actions===0&&multiplayerDisconnect.confirmed&&closes===1'),true);
     h.run('finishMultiplayerLeave(true);finishMultiplayerLeave(false)');
     assert.equal(h.run('actions'),0);
   }
 }
});
