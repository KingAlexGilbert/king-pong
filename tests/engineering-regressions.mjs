import test from 'node:test';
import assert from 'node:assert/strict';
import {
  harness
} from './helpers/royal-harness.mjs';
import {
  audioHarness
} from './helpers/audio-harness.mjs';
import {
  builds,
  source,
  functionSource
} from './helpers/game-source.mjs';

function resetHarness(platform) {
  const h = harness(platform),
    html = source(platform);
  // Use the production reset/serve/ramp; deterministic spawn choice isolates render timing.
  h.run(`
    function findCenterSafeSpawn(){return {x:316,y:236}}
    function findReceiverSideRallySpawn(){return {x:160,y:236}}
    function setRallyBallVelocity(direction,speed){ball.vx=direction*speed;ball.vy=0}
    function hideFirstStartControls(){} function autoHideMenusForGameplay(){} function syncRoyalUi(){}
    ${['resetBall','serveOrContinue','beginRallyLaunchRamp'].map(n=>functionSource(html,n)).join('\n')}
  `);
  return h;
}

function cpuHarness(platform) {
  const h = harness(platform),
    html = source(platform);
  h.run(
    `let cpuErrorOffset=0,customCpuIntel=50,customCpuMaxMove=4.4;mode=1;
    ${['getCpuConfig','predictWithSimpleBounds','predictBallCenterForCPU','simulateHazardStep','rectsOverlapRaw','updateCPU'].map(n=>functionSource(html,n)).join('\n')}`
    );
  return h;
}

for (const platform of Object.keys(builds)) {
  test(`${platform}: Royal Split CPU preserves ordinary primary tracking and human-mode isolation`, () => {
    const h = cpuHarness(platform);
    h.run('ball.x=300;ball.y=40;ball.vx=4;ball.vy=0;const before=JSON.stringify(ball);updateCPU();');
    assert.equal(h.run('royalCpuTarget===ball'), true);
    assert.equal(h.run('right.y'), 208 - 2.85);
    assert.equal(h.run('JSON.stringify(ball)'), h.run('before'), 'prediction never advances the actual ball');
    h.run("ball.lastHit='left';awardRoyalPowerup('split');royalSplitBall.x=580;royalSplitBall.y=420;mode=2;");
    assert.equal(h.run('royalCpuAim(getCpuConfig()).target===ball'), true,
      'human multiplayer cannot opt into split-aware CPU targeting');
  });

  test(`${platform}: Royal Split CPU selects the earlier incoming ball and ignores outgoing or passed duplicates`,
() => {
    for (const scenario of ['split', 'primary', 'away', 'primary-away', 'passed']) {
      const h = cpuHarness(platform);
      h.run(
        "ball.x=300;ball.y=40;ball.vx=4;ball.vy=0;ball.lastHit='left';awardRoyalPowerup('split');royalSplitBall.x=550;royalSplitBall.y=420;royalSplitBall.vy=0;"
        );
      if (scenario === 'primary') h.run('ball.x=580;royalSplitBall.x=300;');
      if (scenario === 'away') h.run('royalSplitBall.vx=-Math.abs(royalSplitBall.vx);');
      if (scenario === 'primary-away') h.run('ball.vx=-4;');
      if (scenario === 'passed') h.run('royalSplitBall.x=right.x+PADDLE_W+1;');
      const duplicate = scenario === 'split' || scenario === 'primary-away';
      h.run('const before=JSON.stringify([ball,royalSplitBall]);updateCPU();');
      assert.equal(h.run('royalCpuTarget===royalSplitBall'), duplicate, scenario);
      assert.equal(h.run('right.y>208'), duplicate, scenario + ' moves toward the selected intercept');
      assert.equal(h.run('JSON.stringify([ball,royalSplitBall])'), h.run('before'));
    }
  });

  test(`${platform}: Royal Split CPU selection is stable near ties and returns to the primary after expiry`, () => {
    const h = cpuHarness(platform);
    h.run(
      "ball.vx=4;ball.vy=0;ball.lastHit='left';awardRoyalPowerup('split');royalSplitBall.vx=2.8;royalSplitBall.vy=0;let switches=0,last=null;"
      );
    for (let i = 0; i < 120; i++) {
      h.run(
        `ball.x=right.x-BALL_HALF-30*ball.vx;royalSplitBall.x=right.x-BALL_HALF-(30+${i%2?.5:-.5})*royalSplitBall.vx;`
        );
      h.run(
        '{const selected=royalCpuAim(getCpuConfig()).target;if(last&&selected!==last)switches++;last=selected;}');
    }
    assert.equal(h.run('switches'), 0, 'small arrival jitter cannot alternate paddle targets');
    h.run('royalSplitBall.x=right.x-BALL_HALF-4*royalSplitBall.vx;');
    assert.equal(h.run('royalCpuAim(getCpuConfig()).target===royalSplitBall'), true,
      'an urgent threat breaks the near-tie hold');
    h.run('const primary=ball;ball=royalSplitBall;hitPaddle(right,-1);ball=primary;');
    assert.equal(h.run('royalSplitBall'), null);
    assert.equal(h.run('royalCpuAim(getCpuConfig()).target===ball'), true,
      'ordinary aim resumes on the very next CPU decision');
    h.run('resetRoyalRally();');
    assert.equal(h.run('royalCpuTarget'), null);
  });

  test(`${platform}: Royal Split CPU uses the existing hazard prediction horizon and preserves both ball states`,
() => {
    const h = cpuHarness(platform);
    h.run(
      `mode=3;customCpuIntel=100;ball.x=300;ball.y=50;ball.vx=4;ball.vy=0;ball.lastHit='left';awardRoyalPowerup('split');
      royalSplitBall.x=540;royalSplitBall.y=220;royalSplitBall.vx=2.8;royalSplitBall.vy=0;
      hazards=[{id:0,type:'rect',x:560,y:180,w:10,h:100}];
      const before=JSON.stringify([ball,royalSplitBall,hazards]);const cfg={...getCpuConfig(),horizon:100};const aim=royalCpuAim(cfg);`
      );
    assert.equal(h.run('aim.target===ball'), true,
      'an intervening wall makes the apparently closer duplicate non-imminent');
    assert.equal(h.run('royalCpuSplitAim.frames'), Infinity);
    assert.ok(Number.isFinite(h.run('royalCpuPrimaryAim.frames')));
    assert.equal(h.run('JSON.stringify([ball,royalSplitBall,hazards])'), h.run('before'));
  });

  test(`${platform}: Royal Split CPU keeps campaign/custom speed, reaction and dead-zone limits`, () => {
    const h = cpuHarness(platform);
    for (let level = 0; level < 18; level++) {
      h.run(`mode=1;activeCampaign=${Math.floor(level/6)};levelIndex=${level%6};`);
      checkLimits();
    }
    for (const intel of [0, 50, 100]) {
      h.run(`mode=3;customCpuIntel=${intel};customCpuMaxMove=4.4;`);
      checkLimits();
    }

    function checkLimits() {
      h.run(`resetRoyalRally();ball.x=300;ball.y=20;ball.vx=4;ball.vy=0;ball.lastHit='left';awardRoyalPowerup('split');
        royalSplitBall.x=580;royalSplitBall.y=440;royalSplitBall.vy=0;right.y=208;
        var cfg=getCpuConfig(),oldY=right.y;updateCPU();`);
      assert.ok(Math.abs(h.run('right.y-oldY')) <= h.run('cfg.maxMove') + 1e-10);
      h.run('royalSplitBall.y=right.y+PADDLE_H/2-BALL_HALF+cfg.deadZone/2;oldY=right.y;updateCPU();');
      assert.equal(h.run('right.y'), h.run('oldY'), 'dead zone remains effective');
      h.run('royalSplitBall.y=right.y+PADDLE_H/2-BALL_HALF+cfg.deadZone+1;oldY=right.y;updateCPU();');
      assert.ok(Math.abs(h.run('right.y-oldY')) <= h.run('(cfg.deadZone+1)*cfg.reaction') + 1e-10,
        'reaction remains capped before the speed limit');
    }
  });

  test(
    `${platform}: Royal Split expires on either first valid paddle hit, with host-only physics and an unaffected primary`,
    () => {
      for (const side of ['left', 'right']) {
        const h = harness(platform),
          control = harness(platform);
        for (const game of [h, control]) game.run("lanRole='host';ball.lastHit='left';");
        h.run(`awardRoyalPowerup('split');const primary=ball,duplicate=royalSplitBall;
        const paddle=${side},direction=paddle===left?1:-1;
        duplicate.y=paddle.y+PADDLE_H/2-BALL_HALF;duplicate.vy=0;
        duplicate.vx=-direction*BASE_BALL_SPEED*ROYAL_SPLIT_SPEED_SCALE;
        const face=paddleSurfaceX(paddle,direction,activePaddleProfile(paddle),duplicate.y+BALL_HALF);
        duplicate.x=direction>0?face+2:face-BALL_SIZE-2;
        const before=captureVisualState();const epoch=visualEpoch;
        lanRole='guest';const guestBefore=JSON.stringify([ball,royalSplitBall,left,right]);updateBall();`);
        assert.equal(h.run('JSON.stringify([ball,royalSplitBall,left,right])'), h.run('guestBefore'),
          'guest cannot simulate the contact or remove the ball');
        h.run("lanRole='host';updateBall();const after=captureVisualState();sendLanState(true);");
        control.run('updateBall();');
        assert.equal(h.run('royalSplitBall'), null, 'removed in the collision step');
        assert.equal(h.run('ball===primary'), true);
        assert.deepEqual(h.json('[ball,trapState(),rallyLaunchFramesRemaining]'), control.json(
          '[ball,trapState(),rallyLaunchFramesRemaining]'));
        assert.deepEqual(h.json('[left.score,right.score,waitingForServe,visualEpoch===epoch]'), [0, 0, false, true]);
        assert.equal(h.run('sent.findLast(m=>m.type==="state").royal.split'), null,
          'host publishes removal through the existing state snapshot');
        for (const alpha of [0, .25, .5, .99, 1]) assert.equal(h.run(
            `interpolateVisualState(before,after,${alpha}).split`), null,
          'no retained translucent render after the collision');
        h.run('updateBall();');
        assert.equal(h.run('royalSplitBall'), null, 'the duplicate cannot bounce back on the next step');
      }
    });

  test(`${platform}: Royal Split can score at either goal before a paddle hit and resolves one point`, () => {
    for (const goal of ['left', 'right']) {
      const h = harness(platform);
      h.run(`lanRole='host';ball.lastHit='left';awardRoyalPowerup('split');
        royalSplitBall.x=${goal==='left'?'-BALL_SIZE+1':'W-1'};royalSplitBall.y=10;
        royalSplitBall.vx=${goal==='left'?'-':'+'}BASE_BALL_SPEED*ROYAL_SPLIT_SPEED_SCALE;royalSplitBall.vy=0;
        updateBall();updateBall();`);
      assert.deepEqual(h.json('[left.score,right.score,royalSplitBall,waitingForServe]'), goal === 'left' ? [0, 1,
        null, true
      ] : [1, 0, null, true]);
    }
  });

  test(`${platform}: Royal Split survives primary paddle hits, paddle misses, arena bounces and Castle Guard`, () => {
    for (const scenario of ['primary', 'miss', 'boundary', 'guard', 'hazard']) {
      const h = harness(platform);
      h.run(functionSource(source(platform), 'rectsOverlapRaw'));
      h.run("ball.lastHit='left';awardRoyalPowerup('split');const duplicate=royalSplitBall;");
      if (scenario === 'primary') h.run('ball.x=591;ball.y=right.y+28;ball.vx=4;ball.vy=0;royalSplitBall.x=300;');
      if (scenario === 'miss') h.run(
        'royalSplitBall.x=591;royalSplitBall.y=10;royalSplitBall.vx=3;royalSplitBall.vy=0;');
      if (scenario === 'boundary') h.run('royalSplitBall.y=1;royalSplitBall.vy=-3;');
      if (scenario === 'guard') h.run(
        'royalGuards.left=600;royalSplitBall.x=19;royalSplitBall.y=10;royalSplitBall.vx=-3;royalSplitBall.vy=0;');
      if (scenario === 'hazard') h.run(
        "hazards=[{id:0,type:'rect',x:400,y:180,w:10,h:100}];royalSplitBall.x=391;royalSplitBall.y=220;royalSplitBall.vx=3;royalSplitBall.vy=0;"
        );
      h.run('updateBall();');
      assert.equal(h.run('royalSplitBall===duplicate'), true, scenario + ' does not expire the duplicate');
      assert.deepEqual(h.json('[left.score,right.score]'), [0, 0]);
      if (scenario === 'primary') assert.ok(h.run('ball.vx') < 0, 'primary still bounces normally');
      if (scenario === 'boundary') assert.ok(h.run('royalSplitBall.vy') > 0);
      if (scenario === 'guard') assert.ok(h.run('royalSplitBall.vx') > 0);
      if (scenario === 'hazard') assert.ok(h.run('royalSplitBall.vx') < 0);
    }
  });

  test(`${platform}: corrupted local numeric save fields cannot abort slot loading; legacy numeric strings still load`,
    () => {
      const h = audioHarness(platform);
      h.run(
        `writeSaveSlot(0,{...createDefaultSaveData(),highestUnlockedLevel:{toString:null},customCpuMaxMove:{toString:0}});`
        );
      const before = h.data.get('save_0');
      assert.doesNotThrow(() => h.run('loadSaveSlot(0)'));
      assert.deepEqual(h.json('[saveData.highestUnlockedLevel,saveData.customCpuMaxMove]'), [0, 4.4]);
      assert.equal(h.data.get('save_0'), before, 'loading does not overwrite the original save');
      h.run(
        `writeSaveSlot(1,{...createDefaultSaveData(),highestUnlockedLevel:'5',customCpuMaxMove:'6.2'});loadSaveSlot(1);`
        );
      assert.deepEqual(h.json('[saveData.highestUnlockedLevel,saveData.customCpuMaxMove]'), [5, 6.2]);
    });
  test(`${platform}: reset and serve seed the spawn before the next simulation tick without discarding time`, () => {
    const h = resetHarness(platform);
    h.run(
      'ball.x=620;visualPrevious=visualCurrent=captureVisualState();accumulatedFrameMs=7;previousFrameTime=100;resetBall(1,true);renderFrame(.42,107);'
      );
    assert.equal(h.run('drawn.at(-1)'), 316);
    assert.deepEqual(h.json('[ball.x,ball.prevX,ball.y,ball.prevY]'), [316, 316, 236, 236]);
    assert.deepEqual(h.json('[accumulatedFrameMs,previousFrameTime,frame]'), [7, 100, 0]);
    h.run('serveOrContinue();renderFrame(.42,107);');
    assert.equal(h.run('drawn.at(-1)'), 316);
    assert.equal(h.run('visualCurrent.key===captureVisualState().key'), true);
    h.run('loop(112);'); // First simulation step, with 2.333 ms left for interpolation.
    const x = h.run('drawn.at(-1)');
    assert.ok(x > 316 && x < h.run('ball.x'), 'first movement is interpolated, not a full-tick jump');
    assert.equal(h.run('frame'), 1);
  });

  for (const hz of [60, 120, 144, 165, 240, 360]) test(`${platform}: score → auto spawn stays smooth at ${hz} Hz`,
() => {
    const h = resetHarness(platform);
    h.run(`mode=1;nextCpuModeServeDirection=1;ball.x=639;ball.y=20;ball.vx=4;ball.vy=0;
      draw=view=>drawn.push({x:view.ball.x,epoch:view.epoch,remaining:view.launch.remaining});`);
    for (let i = 0; i <= hz / 2; i++) h.run(`loop(${i*1000/hz});`);
    if (hz % 2) h.run('loop(500);');
    assert.equal(h.run('left.score'), 1);
    assert.equal(h.run('frame'), 30);
    const views = h.json('drawn').filter(v => v.epoch === h.run('visualEpoch'));
    assert.ok(views.length > 1);
    assert.equal(views[0].x, 160);
    assert.ok(views.every((v, i) => v.x >= 160 && v.x < 300 && (!i || v.x >= views[i - 1].x)),
      'no old goal position or reverse jump');
    if (hz > 60) assert.ok(new Set(views.map(v => v.x)).size > 28, 'render positions continue between fixed steps');
    assert.equal(h.run('rallyLaunchFramesRemaining'), 31, 'the existing launch ramp uses simulation ticks');
    assert.equal(h.run('accumulatedFrameMs>=0 && accumulatedFrameMs<FIXED_STEP_MS'), true);
  });

  test(`${platform}: malformed inputs cannot throw, consume a sequence, or modify authoritative state`, () => {
    const h = harness(platform);
    const before = h.json('[ball,left,right,royalGuards,matchRuleId]');
    for (const patch of [{
        axis: {
          toString: 0
        }
      }, {
        axis: '1'
      }, {
        axis: []
      }, {
        targetY: {
          toString: null
        }
      }, {
        targetY: '200'
      }, {
        seq: -1
      }]) {
      assert.doesNotThrow(() => h.run(
        `handleLanHostMessage(${JSON.stringify({type:'input',seq:1,axis:1,targetY:200,...patch})})`));
      assert.equal(h.run('lanLastInputSeq'), -1);
    }
    h.run('handleLanHostMessage({type:"input",seq:1,axis:Infinity,targetY:200});');
    assert.equal(h.run('lanLastInputSeq'), -1);
    h.run('handleLanHostMessage({type:"input",seq:1,axis:1,targetY:200});');
    assert.equal(h.run('lanRemoteInput.targetY'), 200);
    assert.deepEqual(h.json('[ball,left,right,royalGuards,matchRuleId]'), before);
  });

  test(`${platform}: malformed snapshot types/bounds are rejected before revisions and replay state change`, () => {
    const h = harness(platform);
    const base = {
      type: 'state',
      seq: 1,
      tick: 10,
      leftScore: 0,
      rightScore: 0,
      rules: {
        id: 'endless',
        revision: 9
      }
    };
    for (const patch of [{
          ball: {
            vx: {
              toString: null
            }
          }
        }, {
          ball: []
        }, {
          ball: {
            rallyLaunchTargetSpeed: '4'
          }
        }, {
          ball: {
            x: 1e30
          }
        },
        {
          activeCampaign: {
            toString: 0
          }
        }, {
          levelIndex: 6
        }, {
          leftY: []
        }, {
          paused: 'false'
        }, {
          resumeCountdownMs: 4000
        },
        {
          endMessage: {
            toString: null
          }
        }, {
          hazards: Array(129).fill({
            id: 0,
            x: 1,
            y: 1
          })
        }, {
          hazards: [null]
        },
        {
          hazards: [{
            id: 0,
            x: {
              toString: null
            }
          }]
        }, {
          inputSeq: 1.5
        }
      ]) {
      assert.doesNotThrow(() => h.run(`handleLanGuestMessage(${JSON.stringify({...base,...patch})})`));
      assert.deepEqual(h.json('[lanLastStateSeq,guestSnapshotTick,remoteRuleRevision,applied.length]'), [-1, -1, -1,
        0
      ]);
    }
    h.run(`handleLanGuestMessage(${JSON.stringify(base)});`);
    assert.deepEqual(h.json('applied'), [1]);
    assert.equal(h.run('matchRuleId'), 'endless');
  });
}

test('guest score/serve transitions keep their playout clock and never interpolate between rallies', () => {
  const h = harness();
  h.run(`lanRole='guest';ball.x=600;queueGuestSnapshot({seq:1,tick:60,rightY:208});
    guestRenderTime=990;guestRenderAt=1000;
    resetRoyalRally();left.score=1;ball.x=316;queueGuestSnapshot({seq:2,tick:63,rightY:208});`);
  assert.equal(h.run('guestRenderTime'), 990, 'receiving a reset cannot rewind the existing clock');
  assert.equal(h.run('guestRenderAt'), 1000);
  assert.equal(h.run('guestSnapshots.length'), 2);
  h.run('ball.x=319;queueGuestSnapshot({seq:3,tick:66,rightY:208});');
  assert.equal(h.run('guestVisualState(1000).ball.x'), 600, 'old rally holds until the reset timestamp');
  h.run('guestRenderTime=1050;guestRenderAt=1060;');
  assert.equal(h.run('guestVisualState(1060).ball.x'), 316);
  const next = h.run('guestVisualState(1060+1000/240).ball.x');
  assert.ok(next > 316 && next < 319, 'new spawn moves on the next rendered frame, without a new 100 ms hold');
  h.run('ball.x=0;queueGuestSnapshot({seq:2,tick:63,rightY:208});');
  assert.equal(h.run('guestSnapshotSequence'), 3);
});

test('guest simulation does not allocate unused local render snapshots', () => {
  const h = harness();
  h.run(`lanRole='guest';queueGuestSnapshot({seq:1,tick:60,rightY:208});let captures=0;
    const capture=captureVisualState;captureVisualState=()=>{captures++;return capture()};`);
  for (let i = 0; i <= 240; i++) h.run(`loop(${i*1000/240})`);
  assert.equal(h.run('captures'), 0);
  assert.equal(h.run('frame'), 60);
});

test('pickup art is 24 units, cached per type, distinct without color, and independent of collection radius', () => {
  const h = harness();
  h.run(`let allocations=0;document.createElement=()=>{allocations++;const marks=[];return{marks,getContext:()=>({fillRect(...r){marks.push([this.fillStyle,...r])}})}};
    const sprites=ROYAL_TYPES.map(royalPickupSprite);ROYAL_TYPES.forEach(royalPickupSprite);`);
  assert.equal(h.run('allocations'), 3);
  assert.equal(h.run('ROYAL_COLLECTION_RADIUS'), 24);
  for (const s of h.json('sprites')) {
    assert.equal(s.width, 24);
    assert.equal(s.height, 24);
    assert.ok(s.marks.every(([, x, y, w, hh]) => x >= 0 && y >= 0 && x + w <= 24 && y + hh <= 24));
  }
  assert.equal(new Set(h.json(
    'sprites.map(s=>JSON.stringify(s.marks.filter(m=>m[0]==="#fff7df").map(m=>m.slice(1))))')).size, 3);
});
