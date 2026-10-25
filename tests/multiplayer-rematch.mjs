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
   leaveMultiplayerSession=()=>{leaves++;onlineSession=null;lanConnected=false};
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
