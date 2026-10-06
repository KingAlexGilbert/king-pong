import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  readFileSync
} from 'node:fs';
import {
  execFileSync
} from 'node:child_process';
import {
  fileURLToPath
} from 'node:url';
import {
  harness
} from './helpers/royal-harness.mjs';
import {
  builds,
  root,
  source,
  functionSource
} from './helpers/game-source.mjs';

test('shared gameplay, UI, and all nine translations are embedded identically', () => {
  execFileSync(process.execPath, [
    fileURLToPath(new URL('tools/sync-gameplay.mjs', root)),
    '--check'
  ]);
  const c = vm.createContext({
    window: {}
  });
  vm.runInContext(readFileSync(new URL('game/royal-localization.js', root), 'utf8'), c);
  const tables = c.window.KING_PONG_ROYAL_TRANSLATIONS;
  assert.equal(Object.keys(tables).length, 9);
  for (const table of Object.values(tables)) assert.deepEqual(Object.keys(table), Object.keys(tables.es));
});

for (const platform of Object.keys(builds)) {
  for (const hz of [60, 120, 144, 165, 240]) test(
    `${platform}: ${hz} Hz renders every active frame with exactly 60 physics steps/second`, () => {
      const h = harness(platform);
      h.run('ball.x=100;ball.vx=.5;ball.vy=0;');
      for (let i = 0; i <= hz * 2; i++) h.run(`loop(${i*1000/hz})`);
      assert.equal(h.run('frame'), 120);
      assert.equal(h.run('ball.x'), 160);
      assert.equal(h.run('drawn.length'), hz * 2 + 1);
      const positions = h.json('drawn');
      assert.ok(positions.slice(3).every((x, i) => x >= positions[i + 2]));
      if (hz > 60) assert.ok(new Set(positions).size > 120, 'visual positions continue between physics steps');
    });
  test(`${platform}: interpolation is pure and rally changes snap without a cross-court streak`, () => {
    const h = harness(platform);
    h.run(
      'const a=captureVisualState();ball.x+=12;hazards=[{id:0,x:200,y:100}];const b=captureVisualState();const before=JSON.stringify({ball,left,right,hazards});const view=interpolateVisualState(a,b,.5);'
      );
    assert.equal(h.run('view.ball.x'), 306);
    assert.equal(h.run('JSON.stringify({ball,left,right,hazards})===before'), true);
    h.run('resetRoyalRally();ball.x=20;const c=captureVisualState();');
    assert.equal(h.run('interpolateVisualState(b,c,.25).ball.x'), 20);
  });
  test(`${platform}: split is bounded, both balls can score, and only one point ends the rally`, () => {
    for (const which of ['primary', 'split']) {
      const h = harness(platform);
      h.run("ball.lastHit='left';awardRoyalPowerup('split');awardRoyalPowerup('split');");
      assert.equal(h.run('royalSplitBall.id'), 'royal-split');
      h.run(which === 'primary' ? 'ball.x=639;ball.y=20;ball.vx=4;royalSplitBall.x=200;' :
        'royalSplitBall.x=639;royalSplitBall.y=20;royalSplitBall.vx=4;ball.x=200;');
      h.run('updateBall();updateBall();');
      assert.deepEqual(h.json('[left.score,right.score,royalSplitBall,waitingForServe]'), [1, 0, null, true]);
    }
    const h = harness(platform);
    h.run(
      "ball.lastHit='left';awardRoyalPowerup('split');ball.x=638;ball.y=20;ball.vx=4;royalSplitBall.x=-7;royalSplitBall.y=40;royalSplitBall.vx=-4;updateBall();"
      );
    assert.deepEqual(h.json('[left.score,right.score]'), [0, 1],
      'earliest crossing wins even when the extra ball crosses first in the same tick');
  });
  test(`${platform}: Crown Rush increases speed by 30% and expires at the next paddle hit`, () => {
    const h = harness(platform);
    h.run("ball.lastHit='left';ball.vx=6;ball.vy=0;awardRoyalPowerup('rush');");
    assert.ok(Math.abs(h.run('ballSpeed()') - 7.8) < 1e-10);
    h.run("awardRoyalPowerup('rush');");
    assert.ok(Math.abs(h.run('ballSpeed()') - 7.8) < 1e-10, 'does not stack');
    h.run('ball.x=590;ball.y=236;hitPaddle(right,-1);');
    assert.equal(h.run('ball.rush'), false);
    assert.ok(Math.abs(h.run('ballSpeed()') - 6.33) < 1e-9);
  });
  test(
    `${platform}: Castle Guard expires at 600 active ticks, freezes on pause, blocks goals, and resets between rallies`,
    () => {
      const h = harness(platform);
      h.run(
        "ball.lastHit='left';awardRoyalPowerup('guard');paused=true;for(let i=0;i<1200;i++)updateRoyalPowerups();");
      assert.equal(h.run('royalGuards.left'), 600);
      h.run('paused=false;ball.x=20;ball.y=10;ball.vx=-4;updateBall();');
      assert.ok(h.run('ball.vx') > 0);
      assert.equal(h.run('right.score'), 0);
      h.run('for(let i=0;i<599;i++)updateRoyalPowerups();');
      assert.equal(h.run('royalGuards.left'), 1);
      h.run('updateRoyalPowerups();');
      assert.equal(h.run('royalGuards.left'), 0);
      h.run("awardRoyalPowerup('guard');resetRoyalRally();");
      assert.deepEqual(h.json('royalGuards'), {
        left: 0,
        right: 0
      });
    });
}

test('buffered guest rendering smooths snapshots, stays bounded, rejects stale ticks, and holds at underrun', () => {
  const h = harness();
  h.run(
    "lanRole='guest';ball.x=100;queueGuestSnapshot({seq:1,tick:0,rightY:100});ball.x=130;queueGuestSnapshot({seq:2,tick:3,rightY:130});ball.x=160;queueGuestSnapshot({seq:3,tick:6,rightY:160});"
    );
  const positions = [];
  for (let t = 0; t < 220; t += 1000 / 240) positions.push(h.run(`guestVisualState(${t}).ball.x`));
  assert.ok(new Set(positions).size > 20);
  assert.ok(positions.every((x, i) => x >= 100 && x <= 160 && (!i || x >= positions[i - 1])));
  h.run('ball.x=5;queueGuestSnapshot({seq:2,tick:3,rightY:5});queueGuestSnapshot({seq:4,tick:4,rightY:5});');
  assert.equal(h.run('guestSnapshotSequence'), 3);
  assert.equal(h.run('guestVisualState(9999).ball.x'), 160);
  h.run('for(let i=4;i<100;i++){ball.x=i;queueGuestSnapshot({seq:i,tick:i*3,rightY:100})}');
  assert.ok(h.run('guestSnapshots.length') <= 12);
});

test('rapid guest input does not move the host-confirmed collision paddle or simulate guest balls', () => {
  const h = harness();
  h.run(
    "lanRole='guest';right.y=50;ball.x=580;queueGuestSnapshot({seq:1,tick:60,rightY:300});right.y=0;const rendered=guestVisualState(1000);const before=JSON.stringify(ball);awardRoyalPowerup('split');updateBall();updateRoyalPowerups();"
    );
  assert.equal(h.run('right.y'), 0, 'input stays responsive');
  assert.equal(h.run('rendered.right.y'), 300, 'solid paddle uses the same host time as the ball');
  assert.equal(h.run('paddleIntersectsBall({x:602,prevX:590,y:20},rendered.right,-1,DEFAULT_PADDLE_PROFILE)'),
    false);
  assert.equal(h.run('JSON.stringify(ball)===before'), true);
  assert.equal(h.run('royalSplitBall'), null);
});

test('guest reversal arriving before contact saves the ball; late input cannot create a phantom save', () => {
  for (const timely of [true, false]) {
    const h = harness();
    h.run(`const keys=new Set(),touchPaddleTargets={left:null,right:null};
      function getConnectedGamepads(){return []} function gamepadVertical(){return 0}
      function clampPaddleToVisiblePlayfield(p){p.y=clamp(p.y,0,H-PADDLE_H)}
      ${functionSource(source('Browser'),'updatePlayerPaddles')}
      lanRole='host';right.y=300;ball.x=589;ball.y=20;ball.vx=8;ball.vy=0;`);
    if (timely) h.run("handleLanHostMessage({type:'input',seq:1,axis:-1,targetY:0});updatePlayerPaddles([]);");
    h.run('updateSingleBall();');
    if (!timely) h.run(
      "updateSingleBall();handleLanHostMessage({type:'input',seq:1,axis:-1,targetY:0});updatePlayerPaddles([]);updateSingleBall();"
      );
    assert.equal(h.run('ball.vx<0'), timely);
    assert.equal(h.run('onlineAppliedInputSeq'), 1);
  }
});

test('paused and title rendering keep the existing idle work limits and catch-up remains capped', () => {
  const h = harness();
  h.run('paused=true;');
  for (let i = 0; i <= 240; i++) h.run(`loop(${i*1000/240})`);
  assert.ok(h.run('drawn.length') <= 11);
  const x = h.run('ball.x');
  assert.equal(x, 300);
  h.run("document.body.classList.contains=()=>true;");
  const frames = h.run('frame');
  for (let i = 241; i < 481; i++) h.run(`loop(${i*1000/240})`);
  assert.equal(h.run('frame'), frames);
  h.run('document.body.classList.contains=()=>false;paused=false;loop(100000);');
  assert.equal(h.run('frame'), frames + 5);
});

test('all original paddle definitions and exactly 19 original arenas are referenced with unlock rules intact', () => {
  const h = harness();
  assert.equal(h.run('arenaCatalog.length'), 19);
  assert.equal(h.run('new Set(arenaCatalog.map(a=>a.level)).size'), 19);
  assert.equal(h.run('new Set(paddleCatalog.map(p=>p.profile)).size'), 42);
  assert.equal(h.run('paddleCatalog.filter(paddleUnlocked).length'), 1);
  assert.equal(h.run('arenaUnlocked(18)'), false);
  h.run('mode=3;');
  assert.equal(h.run('arenaCatalog.filter(a=>arenaUnlocked(a.id)).length'), 0);
  h.run('saveData.completedLevels.fill(true);saveData.highestUnlockedLevel=17;');
  assert.equal(h.run('paddleCatalog.every(paddleUnlocked)'), true);
  assert.equal(h.run('arenaCatalog.every(a=>arenaUnlocked(a.id))'), true);
});

test('online selections are bounded, guest cannot change arena, and stale or mid-rally paddle requests are ignored',
() => {
    const h = harness();
    h.run("lanRole='host';waitingForServe=true;receivePaddleSelection({seq:1,paddle:'player-2',arena:99});");
    assert.deepEqual(h.json('selectionPayload()'), {
      arena: 0,
      left: 'classic',
      right: 'player-2'
    });
    h.run(
      "receivePaddleSelection({seq:0,paddle:'player-3'});receivePaddleSelection({seq:2,paddle:'invented'});waitingForServe=false;receivePaddleSelection({seq:3,paddle:'player-3'});"
      );
    assert.equal(h.run('matchPaddles.right'), 'player-2');
    assert.equal(h.run('sent.length'), 0, 'selection requests cannot force extra host snapshots');
    for (const value of [-1, 19, NaN, '1', Infinity]) assert.equal(h.run(`validArenaId(${JSON.stringify(value)})`),
      false);
    assert.equal(h.run("validSelectionState({arena:0,left:'classic',right:'bogus'})"), false);
  });

test('royal state round trips and rejects malformed or unbounded values', () => {
  const h = harness();
  h.run(
    "ball.lastHit='right';awardRoyalPowerup('split');awardRoyalPowerup('guard');awardRoyalPowerup('rush');const packed=packRoyalState();"
    );
  assert.equal(h.run('validRoyalState(packed)'), true);
  h.run('royalSplitBall=null;royalGuards.right=0;applyRoyalState(packed);');
  assert.equal(h.run('royalSplitBall.id'), 'royal-split');
  assert.equal(h.run('ball.rush'), true);
  assert.equal(h.run('royalGuards.right'), 600);
  for (const change of ['v.guards.left=601', 'v.split.x=1e9', 'v.pickup={type:"evil",x:2,y:3,ttl:4}', 'v.rally=-1',
      'v.split=[]'
    ]) {
    assert.equal(h.run(`(()=>{const v=JSON.parse(JSON.stringify(packed));${change};return validRoyalState(v)})()`),
      false);
  }
});

test('guest protocol rejects stale/out-of-order and invalid selection/powerup snapshots before applying state', () => {
  const h = harness();
  h.run(`handleLanGuestMessage({rules:matchRulePayload(),leftScore:0,rightScore:0,type:'state',seq:2});handleLanGuestMessage({rules:matchRulePayload(),leftScore:0,rightScore:0,type:'state',seq:1});
    handleLanGuestMessage({rules:matchRulePayload(),leftScore:0,rightScore:0,type:'state',seq:3,selection:{arena:19,left:'classic',right:'classic'}});
    handleLanGuestMessage({rules:matchRulePayload(),leftScore:0,rightScore:0,type:'state',seq:4,royal:{}});
    handleLanGuestMessage({rules:matchRulePayload(),leftScore:0,rightScore:0,type:'state',seq:5,tick:-1});
    handleLanGuestMessage({rules:matchRulePayload(),leftScore:0,rightScore:0,type:'state',seq:6,tick:100});
    handleLanGuestMessage({rules:matchRulePayload(),leftScore:0,rightScore:0,type:'state',seq:7,tick:99});`);
  assert.deepEqual(h.json('applied'), [2, 6]);
});

for (const platform of Object.keys(builds)) test(
  `${platform}: legacy saves and all music settings survive slot loading without early writes`, () => {
    const html = source(platform),
      stored = new Map();
    const c = vm.createContext({
      window: {
        localStorage: {
          getItem: k => stored.get(k) || null,
          setItem: (k, v) => stored.set(k, v)
        }
      },
      Date,
      populateCustomLevelSelect() {},
      updateModeControls() {},
      updateHud() {},
      renderSaveSlots() {},
      chooseCpuError() {},
      setLocalizedText() {},
      ensureAudioContext() {},
      scheduleMusicLoop() {},
      updateMusicButton() {},
      stopActiveMusicTones() {},
      stopMusicAudioKeepAlive() {}
    });
    const run = s => vm.runInContext(s, c);
    const fns = ['clamp', 'finiteNumber', 'createDefaultSaveData', 'saveSlotKey', 'rememberSaveSlot', 'readSaveSlot',
      'writeSaveSlot', 'normalizeSaveData', 'completedLevelCount', 'isBossUnlocked', 'saveProgressNow',
      'loadSaveSlot', 'setCustomCpuIntel', 'setCustomCpuMaxMove', 'setMusicVolume', 'setMusicEnabled'
    ];
    run(`const TOTAL_LEVELS=18,SAVE_SLOT_COUNT=3,SAVE_STORAGE_PREFIX='save',ACTIVE_SAVE_SLOT_KEY='active';
    let activeSaveSlot=0,saveData=null,loadingSaveSlot=false,saveImportRecoveryBlocked=false,saveConfirmation=null;
    let customCpuIntel=50,customCpuMaxMove=4.4,musicVolumeLevel=.75,musicEnabled=true,musicTimer=null,musicNextStepTime=0;
    let audioCtx=null; const document={hidden:true,getElementById:()=>null},customIntelSlider={},customIntelValue={},customMaxMoveSlider={},customMaxMoveValue={},musicVolumeSlider={},musicVolumeValue={};
    ${readFileSync(new URL('game/royal-audio.js', root), 'utf8')}
    ${fns.map(n=>functionSource(html,n)).join('\n')}`);
    for (const [slot, volume, enabled] of [
        [0, 0, false],
        [1, 37, false],
        [2, 100, true]
      ]) {
      run(
        `writeSaveSlot(${slot},{...createDefaultSaveData(),musicVolumePercent:${volume},musicEnabled:${enabled},royalPaddle:'classic',royalArena:4});`);
    }
    for (const slot of [1, 2, 0, 1]) {
      const before = stored.get('save_' + slot);
      run(`loadSaveSlot(${slot})`);
      assert.equal(stored.get('save_' + slot), before);
      const expected = JSON.parse(before);
      assert.equal(run('musicVolumeLevel'), expected.musicVolumePercent / 100);
      assert.equal(run('musicEnabled'), expected.musicEnabled);
      assert.equal(run('saveData.royalArena'), 4);
    }
  });
