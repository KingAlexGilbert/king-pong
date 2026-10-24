import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {audioHarness} from './helpers/audio-harness.mjs';
import {builds, root} from './helpers/game-source.mjs';

function game(platform) {
  const h = audioHarness(platform);
  h.run(`
    let now=1000,mode=2,waitingForServe=true,paused=false,onlineGameBlocked=false;
    let gameOver=false,levelCleared=false,campaignCleared=false,creditsActive=false;
    let lanRole='host',connected=true,serves=0;
    const left={score:1},right={score:0},performance={now:()=>now};
    const W=640,H=480,ctx={fillRect(){throw Error('unexpected countdown box')},
      strokeRect(){throw Error('unexpected countdown border')}},texts=[],draws=[];
    document.body={classList:{contains:()=>false}};
    function currentCampaign(){return {accent:'#fff'}}
    function drawText(text,...args){texts.push(text);draws.push([text,...args])}
    function isLanActive(){return lanRole!=='none'}
    function isLanHostActive(){return lanRole==='host'&&connected}
    function isLanGuestActive(){return lanRole==='guest'&&connected}
    function sendLanState(){}
    function serveOrContinue(){serves++;waitingForServe=false}
    ${readFileSync(new URL('game/multiplayer-serve.js', root), 'utf8')}
    loadSaveSlot(0);ensureAudioContext();
  `);
  h.tones = () => h.oscillators.filter(o => o.started && o.type === 'square').map(o => o.frequency.value);
  return h;
}

for (const platform of Object.keys(builds)) {
  test(`${platform}: rendered 2 and 1 each sound once; host still releases at exactly two seconds`, () => {
    const h = game(platform);
    h.run('beginPointServeCountdown();drawPointServeCountdown();drawPointServeCountdown();now+=999;tickPointServeCountdown();drawPointServeCountdown();');
    assert.deepEqual(h.tones(), [600]);
    h.run('now++;tickPointServeCountdown();drawPointServeCountdown();drawPointServeCountdown();');
    assert.deepEqual(h.tones(), [600,720]);
    assert.deepEqual(h.json('texts'), ['2','2','2','1','1']);
    assert.ok(h.json('draws').every(([,x,y,size]) => x === 320 && y === 182 && size === 64),
      'digits retain the centered, unboxed pause/resume presentation');
    h.run('now+=999;tickPointServeCountdown();drawPointServeCountdown();');
    assert.equal(h.run('serves'), 0);
    h.run('now++;tickPointServeCountdown();tickPointServeCountdown();');
    assert.equal(h.run('serves'), 1);
    assert.equal(h.run('pointServeCountdown'), null);
    assert.deepEqual(h.tones(), [600,720,1040]);
    const tone = h.oscillators.find(o => o.type === 'square');
    assert.equal(tone.to.to, h.run('gameAudioBuses.get(audioCtx).sfx'), 'uses the real SFX bus');
    assert.ok(Math.abs(tone.stopAt - 1 - 0.085) < 1e-9);
  });

  test(`${platform}: duplicate/corrected snapshots and recovery never repeat countdown cues`, () => {
    const h = game(platform);
    h.run(`lanRole='guest';applyPointServeSnapshot({pointServeMs:1900});drawPointServeCountdown();
      applyPointServeSnapshot({pointServeMs:1850});drawPointServeCountdown();
      now+=1000;drawPointServeCountdown();
      applyPointServeSnapshot({pointServeMs:1100});drawPointServeCountdown();
      paused=true;onlineGameBlocked=true;suspendPointServeCountdown();now+=8000;
      applyPointServeSnapshot({pointServeMs:1100});drawPointServeCountdown();
      paused=false;onlineGameBlocked=false;applyPointServeSnapshot({pointServeMs:1100});drawPointServeCountdown();
      now+=4000;tickPointServeCountdown();drawPointServeCountdown();`);
    assert.deepEqual(h.tones(), [600,720]);
    assert.equal(h.run('serves'), 0, 'guest rendering/audio can never authorize a serve');
    assert.equal(h.run('waitingForServe'), true);
    // A new score is enough to identify the next countdown; no new wire fields.
    h.run('right.score++;applyPointServeSnapshot({pointServeMs:2000});drawPointServeCountdown();now+=1200;drawPointServeCountdown();');
    assert.deepEqual(h.tones(), [600,720,600,720]);
    h.run('waitingForServe=false;applyPointServeSnapshot({pointServeMs:0});applyPointServeSnapshot({pointServeMs:0});playPointServeCountdownSound(1);');
    assert.deepEqual(h.tones(), [600,720,600,720,1040]);
  });

  test(`${platform}: blocked or cancelled guest release never rings or queues a completion cue`, () => {
    for (const state of ['paused=true', 'onlineGameBlocked=true', 'document.hidden=true',
      "audioCtx.state='suspended'", 'audioCtx=null', 'gameOver=true', 'levelCleared=true',
      'campaignCleared=true', 'saveData.soundEffectsEnabled=false', 'saveData.muteAll=true',
      'clearPointServeCountdown()']) {
      const h = game(platform);
      h.run(`lanRole='guest';applyPointServeSnapshot({pointServeMs:800});${state};
        waitingForServe=false;applyPointServeSnapshot({pointServeMs:0});`);
      assert.deepEqual(h.tones(), [], state);
      h.run(`paused=onlineGameBlocked=gameOver=levelCleared=campaignCleared=document.hidden=false;
        saveData.soundEffectsEnabled=true;saveData.muteAll=false;
        if(audioCtx)audioCtx.state='running';else ensureAudioContext();
        applyPointServeSnapshot({pointServeMs:0});`);
      assert.deepEqual(h.tones(), [], 'no late completion after ' + state);
    }
  });

  test(`${platform}: pausing, suspension and disconnection keep cues silent and preserve host time`, () => {
    const h = game(platform);
    h.run('beginPointServeCountdown();drawPointServeCountdown();now+=400;tickPointServeCountdown();paused=true;suspendPointServeCountdown();now+=9000;drawPointServeCountdown();tickPointServeCountdown();');
    assert.equal(h.run('pointServeSnapshotMs()'), 1600);
    assert.deepEqual(h.tones(), [600]);
    h.run('paused=false;drawPointServeCountdown();tickPointServeCountdown();now+=600;tickPointServeCountdown();drawPointServeCountdown();');
    assert.deepEqual(h.tones(), [600,720]);
    h.run('connected=false;suspendPointServeCountdown();now+=8000;tickPointServeCountdown();drawPointServeCountdown();');
    assert.equal(h.run('serves'), 0);
    h.run('connected=true;tickPointServeCountdown();drawPointServeCountdown();now+=999;tickPointServeCountdown();');
    assert.equal(h.run('serves'), 0);
    h.run('now++;tickPointServeCountdown();');
    assert.equal(h.run('serves'), 1);
    assert.deepEqual(h.tones(), [600,720,1040]);
    // A point paused before its first visible frame sounds only upon resuming.
    h.run('waitingForServe=true;beginPointServeCountdown();paused=true;suspendPointServeCountdown();drawPointServeCountdown();paused=false;tickPointServeCountdown();drawPointServeCountdown();');
    assert.deepEqual(h.tones(), [600,720,1040,600]);
  });

  test(`${platform}: mute settings, suspended/absent audio and hidden pages never queue missed steps`, () => {
    for (const setting of ['saveData.soundEffectsEnabled=false', 'saveData.muteAll=true',
      "audioCtx.state='suspended'", 'audioCtx=null', 'document.hidden=true']) {
      const h = game(platform);
      h.run(`${setting};beginPointServeCountdown();drawPointServeCountdown();`);
      assert.deepEqual(h.tones(), [], setting);
      h.run("saveData.soundEffectsEnabled=true;saveData.muteAll=false;document.hidden=false;if(audioCtx)audioCtx.state='running';else ensureAudioContext();drawPointServeCountdown();");
      assert.deepEqual(h.tones(), [], 'no catch-up sound after ' + setting);
      h.run('now+=1100;tickPointServeCountdown();drawPointServeCountdown();');
      assert.deepEqual(h.tones(), [720]);
    }
    const h = game(platform);
    h.run('musicEnabled=false;musicVolumeLevel=0;beginPointServeCountdown();drawPointServeCountdown();');
    assert.deepEqual(h.tones(), [600], 'music mute/volume do not mute the separate SFX channel');
  });

  test(`${platform}: delayed frames skip missed numbers; cancelled and solo countdowns stay silent`, () => {
    const h = game(platform);
    h.run('playPointServeCountdownSound(2);beginPointServeCountdown();now+=1500;tickPointServeCountdown();drawPointServeCountdown();');
    assert.deepEqual(h.tones(), [720], 'only the number actually displayed gets a cue');
    h.run('gameOver=true;playPointServeCountdownSound(1);tickPointServeCountdown();');
    assert.equal(h.run('pointServeCountdown'), null);
    h.run('gameOver=false;beginPointServeCountdown();clearPointServeCountdown();playPointServeCountdownSound(2);');
    assert.deepEqual(h.tones(), [720]);
    h.run("lanRole='none';beginPointServeCountdown();drawPointServeCountdown();");
    assert.deepEqual(h.tones(), [720,600], 'local two-player shares the same cues');
    for (const mode of [1,3,4]) {
      h.run(`clearPointServeCountdown();mode=${mode};beginPointServeCountdown();playPointServeCountdownSound(2);`);
      assert.equal(h.run('pointServeCountdown'), null);
    }
    assert.deepEqual(h.tones(), [720,600]);
  });
}
