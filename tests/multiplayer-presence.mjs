import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../game/multiplayer-presence.js', import.meta.url), 'utf8');
function pair() {
  let now = 1000;
  function peer(role) {
    const ctx = vm.createContext({Date: {now: () => now}, performance: {now: () => now},
      setInterval: () => 1, clearInterval() {}});
    const run = text => vm.runInContext(text, ctx);
    run(`let onlineSession={close(){closed++}},lanRole='${role}',lanConnected=true,lanRoomCode='ABCDEF',
      onlineRematchReady=true,gameWindowFocused=true,paused=false,waitingForServe=false,gameOver=false,onlineGameBlocked=false,
      resumeCountdownEndAt=0,lastResumeCountdownNumber=0,onlineLastInput=null,onlineMatchFlow={phase:'playing'},
      onlineInputs=new Map(),sent=[],left={score:2},right={score:3},ball={x:300,y:100,vx:5,vy:3},closed=0,leaves=0;
      const LAN_SIGNAL_VERSION=1,RESUME_COUNTDOWN_MS=3000;
      const document={hidden:false,addEventListener(){},getElementById(){return null}};
      const window={addEventListener(){}};
      function multiplayerRematch(){return {token:'0123456789abcdef0123456789abcdef'}}
      function lanSend(m){sent.push({...m,gameplay:'royal',matchRules:'presets'});return true}
      function sendLanState(){const p=multiplayerPresence();lanSend({type:'state',presenceEpoch:p.epoch,
        presenceSnapshot:p.sendingSnapshot,paused,resumeCountdownEndAt,leftScore:left.score,rightScore:right.score})}
      function resumeCountdownRemainingMs(){return Math.max(0,resumeCountdownEndAt-performance.now())}
      function onlineMatchFlowBlocksPlay(){return onlineMatchFlow.phase!=='playing'}
      function clearHeldInput(){}function resetVisualHistory(){}function resetFrameClock(){}
      function suspendPointServeCountdown(){}function syncRoyalUi(){}function stopMatchmaking(){}function sendRematch(){}
      function endMultiplayerSession(){leaves++;stopMultiplayerPresence(onlineSession);onlineSession=null}
      ${source}
      showMultiplayerUnavailable=()=>{};
      receivePresenceHello({presence:1});`);
    return {run, ctx, take: () => JSON.parse(JSON.stringify(run('sent.splice(0)')))};
  }
  const host = peer('host'), guest = peer('guest');
  function deliver(from, to) {
    const messages = from.take();
    for (const m of messages) {
      to.ctx.message = m;
      if (m.type === 'presence') to.run('receiveMultiplayerPresence(message)');
      else to.run(`if(acceptMultiplayerPresence(message)){
        paused=message.paused;resumeCountdownEndAt=message.resumeCountdownEndAt;
        finishPresenceSnapshot(message);noteMultiplayerTraffic();}`);
    }
    return messages;
  }
  return {host, guest, deliver, advance(ms) {now += ms;},
    flush() { for (let i=0;i<6;i++) {deliver(host,guest);deliver(guest,host);} },
    tick() {host.run('tickMultiplayerPresence()');guest.run('tickMultiplayerPresence()');}};
}

test('either peer backgrounds: mutual suspension, unchanged score, fresh snapshot and one countdown', () => {
  for (const who of ['host', 'guest']) {
    const p=pair(), interrupted=p[who];
    p.host.run('onlineSession.secure={pending:new Map([[1,{created:Date.now()}]])}');
    interrupted.run('setMultiplayerAvailability(false)'); p.flush();
    for (const peer of [p.host,p.guest]) {
      assert.equal(peer.run('multiplayerSuspended() && paused && onlineGameBlocked'),true);
      assert.equal(peer.run('left.score+right.score'),5);
    }
    p.advance(29000);
    interrupted.run('setMultiplayerAvailability(true)'); p.flush();
    for (const peer of [p.host,p.guest]) assert.equal(peer.run('multiplayerSuspended()'),false);
    assert.equal(p.host.run('resumeCountdownRemainingMs()'),3000);
    assert.equal(p.guest.run('resumeCountdownRemainingMs()'),3000);
    assert.equal(p.host.run('onlineSession.secure.pending.get(1).created'),30000,
      'pending encrypted ACKs retain their normal delivery window after a long pause');
    p.advance(1000); interrupted.run('setMultiplayerAvailability(true)'); p.flush();
    assert.equal(p.host.run('resumeCountdownRemainingMs()'),2000,'no duplicate countdown');
  }
});

test('peer heartbeat covers idle players and quiet result/ready screens without input activity', () => {
  const p=pair(); let probes=0;
  for(let i=0;i<90;i++) {
    p.advance(2000); p.tick();
    probes+=p.host.run("sent.filter(m=>m.kind==='ping').length");p.flush();
    assert.equal(p.host.run('multiplayerSuspended()'),false);
    assert.equal(p.guest.run('multiplayerSuspended()'),false);
  }
  assert.equal(probes,90,'at most one probe per two seconds on a quiet connection');
  p.host.run('noteMultiplayerTraffic()');p.host.take();p.advance(1000);p.tick();
  assert.equal(p.host.run('sent.length'),0,'normal traffic replaces probes');
});

test('silent termination suspends at eight seconds and exits after a bounded thirty-second recovery', () => {
  const p=pair(); p.advance(7999);p.host.run('tickMultiplayerPresence()');
  assert.equal(p.host.run('multiplayerSuspended()'),false);
  p.advance(1);p.host.run('tickMultiplayerPresence()');
  assert.equal(p.host.run('multiplayerSuspended()'),true);
  p.advance(29999);p.host.run('tickMultiplayerPresence()');assert.equal(p.host.run('leaves'),0);
  p.advance(1);p.host.run('tickMultiplayerPresence()');assert.equal(p.host.run('leaves'),1);
  assert.equal(p.host.run('left.score+right.score'),5);
});

test('late foreground return expires even if browser timers never ran, and repeats cannot extend grace', () => {
  const p=pair();p.guest.run('setMultiplayerAvailability(false)');p.flush();
  p.advance(20000);p.guest.run('setMultiplayerAvailability(false)');p.flush();
  p.advance(10001);p.guest.run('setMultiplayerAvailability(true)');
  assert.equal(p.guest.run('leaves'),1);
  p.host.run('tickMultiplayerPresence()');assert.equal(p.host.run('leaves'),1);
});

test('transport recovery retains identity, rejects old input, and cannot be resumed by a guest command', () => {
  const p=pair();
  p.host.run('window.original=onlineSession;multiplayerTransportInterrupted()');p.flush();
  p.guest.run("sendMultiplayerPresence('resume');sendMultiplayerPresence('snapshot-ack')");p.flush();
  assert.equal(p.host.run('multiplayerSuspended()'),true);
  p.advance(3000);p.host.run('multiplayerTransportResumed()');p.flush();
  assert.equal(p.host.run('onlineSession===window.original && !multiplayerSuspended()'),true);
  assert.equal(p.host.run("acceptMultiplayerPresence({type:'input',presenceEpoch:0})"),false);
  assert.equal(p.host.run("acceptMultiplayerPresence({type:'input',presenceEpoch:1})"),true);
});

test('a second interruption during snapshot agreement cancels that recovery without resetting the deadline', () => {
  const p=pair();p.guest.run('setMultiplayerAvailability(false)');p.flush();
  p.advance(1000);p.guest.run('setMultiplayerAvailability(true)');p.deliver(p.guest,p.host);
  p.deliver(p.host,p.guest); // Guest received offer; snapshot has not arrived.
  p.guest.run('setMultiplayerAvailability(false)');p.flush();
  assert.equal(p.host.run('multiplayerSuspended()'),true);
  assert.equal(p.host.run('resumeCountdownEndAt'),0);
  p.guest.run('setMultiplayerAvailability(true)');p.flush();
  assert.equal(p.host.run('multiplayerSuspended()'),false);
  assert.equal(p.host.run('resumeCountdownRemainingMs()'),3000);
});

test('manual pause and ready consent survive recovery; pagehide distinguishes bfcache from departure', () => {
  const p=pair();p.host.run('paused=true;setMultiplayerAvailability(false)');p.flush();
  p.host.run('setMultiplayerAvailability(true)');p.flush();
  assert.equal(p.host.run('paused && resumeCountdownEndAt===0'),true);
  p.guest.run('multiplayerPageHide({persisted:true})');p.flush();
  assert.equal(p.guest.run('closed'),0);
  p.guest.run('multiplayerPageHide({persisted:false})');p.flush();
  assert.equal(p.guest.run('closed'),1);assert.equal(p.host.run('leaves'),1);
  const q=pair();
  for (const peer of [q.host,q.guest]) peer.run("onlineMatchFlow={phase:'ready',localReady:false};paused=true");
  q.host.run('onlineMatchFlow.localReady=true');
  q.guest.run('setMultiplayerAvailability(false)');q.flush();
  q.guest.run('setMultiplayerAvailability(true)');q.flush();
  assert.equal(q.host.run("onlineMatchFlow.phase==='ready' && onlineMatchFlow.localReady && onlineGameBlocked"),true);
  assert.equal(q.guest.run('onlineMatchFlow.localReady'),false);
  assert.equal(q.host.run('resumeCountdownEndAt'),0,'returning is not consent to start a ready screen');
});

test('duplicate holds, offers and acknowledgements cannot roll back recovery or restart its countdown', () => {
  const p=pair();p.guest.run('setMultiplayerAvailability(false)');p.flush();
  p.guest.run('setMultiplayerAvailability(true)');p.deliver(p.guest,p.host);
  const offer=p.host.take().find(m=>m.kind==='offer');assert.ok(offer);
  p.guest.ctx.message=offer;p.guest.run('receiveMultiplayerPresence(message);receiveMultiplayerPresence(message)');
  p.deliver(p.guest,p.host);p.deliver(p.host,p.guest);
  assert.equal(p.guest.run('multiplayerPresence().phase'),'acknowledged');
  p.guest.ctx.message={...offer,kind:'hold'};p.guest.run('receiveMultiplayerPresence(message)');
  assert.equal(p.guest.run('multiplayerPresence().phase'),'acknowledged');
  p.guest.ctx.message=offer;p.guest.run('receiveMultiplayerPresence(message)');p.flush();
  assert.equal(p.guest.run('multiplayerSuspended()'),false);
  p.advance(1000);p.guest.run('receiveMultiplayerPresence(message)');p.flush();
  assert.equal(p.host.run('resumeCountdownRemainingMs()'),2000);
});


test('focus-only and reordered tab returns share presence recovery without turning focus loss into manual pause', () => {
  for (const who of ['host', 'guest']) for (const order of ['focus-only','focus-before-visible','visible-before-focus','visible-only']) {
    const p=pair(), peer=p[who];
    peer.run('recordMultiplayerFocusLoss(); if (!onlineGameBlocked) paused=true');
    p.flush();
    assert.equal(p.host.run('multiplayerSuspended()'),true, who+' '+order+' suspends immediately');
    if (order !== 'focus-only') peer.run('document.hidden=true;setMultiplayerAvailability(false)');
    p.advance(2500);
    if(order==='focus-before-visible') {
      peer.run('recordMultiplayerFocusReturn()');p.flush();
      assert.equal(p.host.run('multiplayerSuspended()'),true,'focus alone cannot resume a still-hidden page');
    }
    peer.run('document.hidden=false;setMultiplayerAvailability(true)');
    if(order!=='visible-only')peer.run('recordMultiplayerFocusReturn()');
    p.flush();
    assert.equal(p.host.run('multiplayerSuspended()'),false);
    assert.equal(p.host.run('resumeCountdownRemainingMs()'),3000,'one synchronized countdown');
    p.advance(500);peer.run('recordMultiplayerFocusReturn();setMultiplayerAvailability(true)');p.flush();
    assert.equal(p.host.run('resumeCountdownRemainingMs()'),2500,'duplicates do not restart countdown');
    assert.equal(p.host.run('left.score+right.score'),5);
  }
});
