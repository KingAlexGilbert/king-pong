import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {harness} from './helpers/royal-harness.mjs';
import {builds, root, functionSource, source} from './helpers/game-source.mjs';

for (const platform of Object.keys(builds)) {
  test(`${platform}: multiplayer points play existing local win and loss sounds, including guest snapshots`, () => {
    const h = harness(platform);
    h.run(`
      const cues = [];
      function playPlayerPointJingle(){cues.push('point')}
      function playPlayerClearJingle(){cues.push('victory')}
      playLevelFailureJingle=()=>cues.push('defeat');
      beep=(frequency)=>cues.push('beep:'+frequency);
      lanRole='host';
      playMultiplayerLocalScoreCue('left',false);
      playMultiplayerLocalScoreCue('right',false);
      playMultiplayerLocalScoreCue('left',true);
      playMultiplayerLocalScoreCue('right',true);
      lanRole='guest';
      playMultiplayerLocalScoreCue('right',false);
      playMultiplayerLocalScoreCue('left',false);
      playMultiplayerLocalScoreCue('right',true);
      playMultiplayerLocalScoreCue('left',true);
    `);
    assert.deepEqual(h.json('cues'), ['point','beep:98','victory','defeat',
      'point','beep:98','victory','defeat']);
    h.run(`
      cues.length=0;left.score=2;right.score=3;gameOver=false;
      playGuestMultiplayerScoreCue(2,2); // Guest scored once.
      playGuestMultiplayerScoreCue(2,3); // Duplicate snapshot: silent.
      left.score=3;gameOver=true;
      playGuestMultiplayerScoreCue(2,3); // Host won the match.
      right.score=0;left.score=0;gameOver=false;
      playGuestMultiplayerScoreCue(3,3); // Rematch reset: silent.
      left.score=2;right.score=2;
      playGuestMultiplayerScoreCue(0,0); // Missed both sides: ambiguous, silent.
    `);
    assert.deepEqual(h.json('cues'), ['point','defeat']);
    const html = source(platform);
    assert.match(functionSource(html,'resetBall'), /mode === 2 \|\| spawnNearPlayer/);
    assert.match(functionSource(html,'handleLanGuestMessage'), /hadScoreSnapshot/);
    assert.match(functionSource(html,'handleLanGuestMessage'), /playGuestMultiplayerScoreCue/);
  });
}

test('ready countdown gives guest the existing 3-2-1 cues and one authoritative GO sound', () => {
  const onlineSource = readFileSync(new URL('game/online-match-flow.js', root), 'utf8');
  const context = vm.createContext({performance: {now: () => 1000}});
  vm.runInContext(`
    let onlineMatchFlow={id:'room', phase:'countdown', peerHello:true, peerInitialized:true,
      localReady:true,configured:true,hostReady:true,guestReady:true,remoteSequence:-1};
    let onlineSession={secure:{phase:'active'}}, lanRole='guest', lanConnected=true,lanRoomCode='ABCDE';
    const LAN_SIGNAL_VERSION=1,RESUME_COUNTDOWN_MS=3000;
    let lastResumeCountdownNumber=0,resumeCountdownEndAt=4000;
    let paused=true,onlineGameBlocked=true,onlineHasState=true,remaining=3000;
    const sounds=[];
    function beep(f){sounds.push(f)}
    function resumeCountdownRemainingMs(){return remaining}
    function syncRoyalUi(){}
    ${functionSource(onlineSource,'tickOnlineMatchFlow')}
    ${functionSource(onlineSource,'receiveOnlineMatchSetup')}
    tickOnlineMatchFlow();tickOnlineMatchFlow();
    remaining=2000;tickOnlineMatchFlow();tickOnlineMatchFlow();
    remaining=1000;tickOnlineMatchFlow();tickOnlineMatchFlow();
    remaining=0;tickOnlineMatchFlow(); // Local expiry can't release a guest.
    receiveOnlineMatchSetup({protocol:1,match:'room',v:1,room:'ABCDE',gameplay:'royal',matchRules:'presets',
      kind:'status',seq:1,hostReady:true,guestReady:true,phase:'go',remainingMs:0});
    receiveOnlineMatchSetup({protocol:1,match:'room',v:1,room:'ABCDE',gameplay:'royal',matchRules:'presets',
      kind:'status',seq:2,hostReady:true,guestReady:true,phase:'go',remainingMs:0});
  `, context);
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('sounds',context))), [600,600,720,1040]);
  assert.equal(vm.runInContext('onlineGameBlocked',context),false);
  assert.equal(vm.runInContext('onlineMatchFlow.phase',context),'go');
});
