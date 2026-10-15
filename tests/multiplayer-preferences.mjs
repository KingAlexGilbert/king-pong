import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {audioHarness} from './helpers/audio-harness.mjs';
import {harness} from './helpers/royal-harness.mjs';
import {builds, root} from './helpers/game-source.mjs';

test('the existing room-session token is stable when sessionStorage is unavailable or changes mid-session', () => {
  for (const access of ['unavailable','read-only','available']) {
    let stored=null;
    const context=vm.createContext({crypto,sessionStorage:{
      getItem(){if(access==='unavailable')throw Error('denied');return stored},
      setItem(k,v){if(access==='read-only')throw Error('denied');stored=v}
    }});
    vm.runInContext(readFileSync(new URL('game/network-common.js',root),'utf8'),context);
    const token=vm.runInContext('kingPongClientToken()',context);
    stored=null;
    assert.equal(vm.runInContext('kingPongClientToken()',context),token);
    assert.match(token,/^[a-f0-9-]{36}$/);
  }
});

for (const platform of Object.keys(builds)) {
  test(`${platform}: legacy slots default to approval on; explicit false and independent preferences survive restart`, () => {
    const h = audioHarness(platform);
    h.run('loadSaveSlot(0);');
    assert.equal(h.run("playerPreference('hostApprovalRequired')"), true);
    h.run(`savePlayerPreference('hostApprovalRequired', false);
      savePlayerPreference('royalPowerupsEnabled', false);
      savePlayerPreference('matchRuleId', 'winTwo');
      savePlayerPreference('showConnectionType', true);
      savePlayerPreference('playInfoVisible', false);
      savePlayerPreference('multiplayerPaddle', 'boss-8');
      setMusicVolume(29);setGameMuteAll(true);`);
    const again = audioHarness(platform, h.data);
    again.run('loadSaveSlot(0);');
    assert.deepEqual(again.json("Object.keys(PLAYER_PREFERENCE_DEFAULTS).map(playerPreference)"),
      [false, true, false, 'winTwo', false, 'boss-8', null]);
    assert.deepEqual(again.json('[musicVolumeLevel,saveData.muteAll]'), [.29, true]);
    const before = again.json('saveData');
    for (const [key, value] of [['hostApprovalRequired', 0], ['matchRuleId', 'invalid'], ['multiplayerPaddle', 'boss-99'], ['token', 'not-a-preference']]) {
      again.run(`savePlayerPreference(${JSON.stringify(key)},${JSON.stringify(value)});`);
    }
    assert.deepEqual(again.json('saveData'), before);
    again.run('loadSaveSlot(1);');
    assert.equal(again.run("playerPreference('hostApprovalRequired')"), true);
    again.run('loadSaveSlot(0);');
    assert.equal(again.run("playerPreference('hostApprovalRequired')"), false);
  });

  test(`${platform}: powerup opt-out blocks all effects, preserves solo rules and never enables guest simulation`, () => {
    const h = harness(platform);
    h.run(`function savePlayerPreference(k,v){saveData[k]=v} function syncRoyalUi(){}
      waitingForServe=true;lanRole='host';setMatchPowerups(false);waitingForServe=false;
      ball.lastHit='left';royalRallyTick=179;updateRoyalPowerups();`);
    assert.equal(h.run('royalPickup'), null);
    for (const kind of ['split','rush','guard']) assert.equal(h.run(`awardRoyalPowerup('${kind}')`), false);
    assert.equal(h.run('setMatchPowerups(true)'), false, 'active-match configuration is locked');
    h.run(`waitingForServe=true;setMatchPowerups(true);waitingForServe=false;
      royalRallyTick=179;updateRoyalPowerups();`);
    assert.ok(h.run('royalPickup'));
    h.run(`lanRole='guest';resetRoyalRally();royalRallyTick=179;updateRoyalPowerups();`);
    assert.equal(h.run('royalPickup'), null);
    assert.equal(h.run("awardRoyalPowerup('guard')"), false);
    assert.equal(h.run('setMatchPowerups(false)'), false, 'guests cannot change shared rules');
    h.run(`matchPowerupsEnabled=false;mode=1;lanRole='none';royalRallyTick=179;updateRoyalPowerups();`);
    assert.ok(h.run('royalPickup'), 'private preference does not change campaign mechanics');
    h.run(`mode=2;lanRole='host';matchPowerupsEnabled=true;waitingForServe=true;setMatchPowerups(false);`);
    assert.deepEqual(h.json('[royalPickup,royalSplitBall,royalGuards,ball.rush]'), [null,null,{left:0,right:0},false]);
    assert.deepEqual(h.json('matchRulePayload(false)'), {id:'classic',revision:3}, 'compact snapshots retain their original shape');
    h.run(`applyMatchRuleState({id:'quick',revision:4,powerups:true});applyMatchRuleState({id:'quick',revision:4});`);
    assert.equal(h.run('matchPowerupsEnabled'), true, 'compact snapshots preserve reliable powerup config');
    assert.equal(h.run('saveData.royalPowerupsEnabled'), false, 'received rules never overwrite local preferences');
  });
}

function setupGame(role = 'host') {
  const h = harness();
  h.run(`let onlineSession={fail(code){failed.push(code)}}, onlineMatchAssignment=null,
    onlineGameBlocked=false,onlineHasState=false,lanConnected=true,
    resumeCountdownEndAt=0,lastResumeCountdownNumber=0;
    const RESUME_COUNTDOWN_MS=3000, failed=[];let now=1000;
    performance.now=()=>now;
    function clearHeldInput(){} function setMenusVisible(){} function syncRoyalUi(){}
    function byId(){return null}
    resumeCountdownRemainingMs=()=>Math.max(0,resumeCountdownEndAt-now);
    sendLanState=()=>{};
    lanRole='${role}';
    ${readFileSync(new URL('game/online-match-flow.js', root), 'utf8')}
    beginOnlineMatchFlow();onlineMatchTransportReady();
    function incoming(kind,fields={}){receiveOnlineMatchSetup({v:1,room:lanRoomCode,protocol:1,
      match:onlineMatchFlow.id,gameplay:'royal',matchRules:'presets',kind,...fields})}
  `);
  return h;
}

test('private host requires exact initialized configuration, locks selection at ready, and cancels countdown on ready withdrawal', () => {
  const h = setupGame();
  h.run("incoming('hello');incoming('ready');now+=700;tickOnlineMatchFlow();");
  assert.equal(h.run('onlineMatchFlow.phase'), 'connected');
  h.run("incoming('initialized',{configuration:'stale'});tickOnlineMatchFlow();");
  assert.equal(h.run('onlineMatchFlow.peerInitialized'), false);
  h.run("incoming('initialized',{configuration:JSON.stringify(privateMatchConfiguration())});tickOnlineMatchFlow();");
  assert.equal(h.run('onlineMatchFlow.phase'), 'ready');
  h.run("receivePaddleSelection({seq:9,paddle:'boss-8'});");
  assert.equal(h.run('matchPaddles.right'), 'classic');
  h.run("confirmOnlineMatchReady();incoming('ready',{ready:true});");
  assert.equal(h.run('onlineMatchFlow.phase'), 'countdown');
  h.run("incoming('ready',{ready:false});");
  assert.deepEqual(h.json('[onlineMatchFlow.phase,resumeCountdownEndAt,waitingForServe,paused]'), ['ready',0,true,true]);
  h.run("incoming('ready',{ready:true});const countdown=resumeCountdownEndAt;incoming('ready',{ready:true});");
  assert.equal(h.run('resumeCountdownEndAt===countdown'), true, 'duplicate readiness cannot restart countdown');
  h.run('resetOnlineMatchFlow();');
  assert.deepEqual(h.json('[onlineMatchFlow,resumeCountdownEndAt]'), [null,0]);
});

test('private guest waits for both configuration and authoritative snapshot, rejects premature go and stale statuses', () => {
  const h = setupGame('guest');
  h.run("incoming('config',privateMatchConfiguration());");
  assert.equal(h.run("sent.some(m=>m.kind==='initialized')"), false);
  h.run(`incoming('status',{phase:'countdown',seq:1,hostReady:true,guestReady:true,remainingMs:3000});`);
  assert.equal(h.run('onlineMatchFlow.phase'), 'connected');
  h.run('onlineHasState=true;sendOnlineMatchHello();');
  assert.equal(h.run("sent.some(m=>m.kind==='initialized')"), true);
  h.run("incoming('status',{phase:'ready',seq:2,hostReady:true,guestReady:false,remainingMs:0});confirmOnlineMatchReady();");
  h.run("incoming('status',{phase:'countdown',seq:3,hostReady:true,guestReady:true,remainingMs:2000});now+=5000;tickOnlineMatchFlow();");
  assert.equal(h.run('onlineMatchFlow.phase'), 'countdown', 'local elapsed time never releases guest');
  h.run("incoming('status',{phase:'go',seq:2,hostReady:true,guestReady:true,remainingMs:0});");
  assert.equal(h.run('onlineMatchFlow.phase'), 'countdown');
  h.run("incoming('status',{phase:'go',seq:4,hostReady:true,guestReady:true,remainingMs:0});");
  assert.equal(h.run('onlineMatchFlow.phase'), 'go');
});
