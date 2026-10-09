import assert from 'node:assert/strict';
import test from 'node:test';
import {harness} from './helpers/royal-harness.mjs';
import {audioHarness} from './helpers/audio-harness.mjs';
import {builds, functionSource, source} from './helpers/game-source.mjs';

for (const platform of Object.keys(builds)) {
  function soundGame() {
    const game = harness(platform), audio = audioHarness(platform);
    audio.run('loadSaveSlot(0);setMusicEnabled(false);ensureAudioContext();');
    game.context.impact = (...args) => audio.run(`playImpactSound(...${JSON.stringify(args)})`);
    game.run('playImpactSound=impact;');
    game.run(functionSource(source(platform), 'rectsOverlapRaw'));
    return {game, audio};
  }

  test(`${platform}: simultaneous split and corner collisions share one normal-volume impact`, () => {
    const {game, audio} = soundGame();
    game.run(`ball.x=300;ball.y=1;ball.vx=4;ball.vy=-4;ball.lastHit='left';
      awardRoyalPowerup('split');royalSplitBall.y=1;royalSplitBall.vy=-4;updateBall();`);
    assert.equal(audio.oscillators.length, 1);
    assert.equal(audio.oscillators[0].type, 'square');
    assert.deepEqual(audio.oscillators[0].frequency.events, [['set', 300, 1]]);
    assert.equal(game.run('ball.vy>0 && royalSplitBall.vy>0'), true);
    const envelope = audio.oscillators[0].to.gain.events;
    assert.equal(Math.max(...envelope.map(e => e[1])), .045);
    assert.equal(envelope[0][1], 0);
    assert.equal(envelope.at(-1)[1], 0);
    assert.ok(envelope.at(-1)[2] - envelope[0][2] < .04);
    audio.run('audioCtx.currentTime+=.05;');
    game.run(`royalSplitBall=null;ball.x=391;ball.y=1;ball.vx=4;ball.vy=-4;
      hazards=[{id:0,type:'rect',x:400,y:0,w:10,h:100}];updateBall();`);
    assert.equal(audio.oscillators.length, 2, 'wall and hazard cannot stack separate voices');
    assert.ok(game.run('ball.vx') < 0);
  });

  test(`${platform}: tangent contacts stay silent and rapid impact bursts have a bounded voice budget`, () => {
    const {game, audio} = soundGame();
    game.run('ball.y=0;ball.vy=0;for(let i=0;i<10;i++)updateBall();');
    assert.equal(audio.oscillators.length, 0);
    audio.run('for(let i=0;i<100;i++)playImpactSound(300,.025);');
    assert.equal(audio.oscillators.length, 1);
    audio.run('audioCtx.currentTime+=.02;playImpactSound(520,.035);');
    assert.equal(audio.oscillators.length, 1);
    audio.run('audioCtx.currentTime+=.02;playImpactSound(520,.035);');
    assert.equal(audio.oscillators.length, 2, 'later physical contacts remain audible');
  });

  test(`${platform}: shield impacts preserve collision and duration, expire visually, and obey all audio controls`, () => {
    const {game, audio} = soundGame();
    for (const side of ['left', 'right']) {
      game.run(`royalGuards.${side}=600;ball.prevX=${side === 'left' ? 19 : 613};
        ball.x=${side === 'left' ? 16 : 618};ball.y=30;ball.vx=${side === 'left' ? -4 : 4};
        collideCastleGuard();`);
      assert.equal(game.run(`royalGuards.${side}`), 600);
      assert.equal(game.run('ball.x'), side === 'left' ? 18 : 614);
      assert.equal(game.run('ball.vx'), side === 'left' ? 4 : -4);
      assert.equal(game.run('ball.lastHit'), side);
      const hit = game.json(`royalGuardHits.${side}`);
      assert.equal(hit.y, 34);
      assert.equal(hit.ttl, 8);
      game.run('collideCastleGuard();');
      assert.deepEqual(game.json(`royalGuardHits.${side}`), hit, 'overlap after reflection is not a new hit');
      audio.run('audioCtx.currentTime+=.06;');
    }
    assert.equal(audio.oscillators.length, 2);
    assert.deepEqual(audio.oscillators[0].frequency.events, [['set', 880, 1], ['exponential', 440, 1.055]]);
    assert.equal(audio.run('gameImpactVoice.gain.to === gameAudioBuses.get(audioCtx).sfx'), true);
    game.run('for(let i=0;i<8;i++)updateRoyalPowerups();');
    assert.deepEqual(game.json('royalGuardHits'), {left: null, right: null});
    assert.deepEqual(game.json('royalGuards'), {left: 592, right: 592});
    audio.run('setSoundEffectsEnabled(false);playImpactSound(880,.055,.045,"shield");');
    assert.equal(audio.oscillators.length, 2);
    audio.run('setSoundEffectsEnabled(true);setGameMuteAll(true);playImpactSound(880,.055,.045,"shield");');
    assert.equal(audio.oscillators.length, 2);
    audio.run('setGameMuteAll(false);playImpactSound(880,.055,.045,"shield");');
    assert.equal(audio.oscillators.length, 3, 'SFX returns with music still off');
    audio.run('setGameMuteAll(true);');
    assert.equal(audio.oscillators.at(-1).stopped, true);
  });

  test(`${platform}: shield replaces a simultaneous wall tone with a bounded short crossfade`, () => {
    const {audio} = soundGame();
    audio.run('playImpactSound(300,.025);audioCtx.currentTime+=.005;playImpactSound(880,.055,.045,"shield");');
    assert.equal(audio.oscillators.length, 2);
    assert.ok(Math.abs(audio.oscillators[0].stopAt - 1.007) < 1e-10);
    const old = audio.oscillators[0].to.gain.events.slice(-2);
    const next = audio.oscillators[1].to.gain.events.slice(0, 2);
    assert.deepEqual(old.map(e => e[1]), [.045, 0]);
    assert.deepEqual(next.map(e => e[1]), [0, .045]);
    assert.deepEqual(old.map(e => e[2]), next.map(e => e[2]));
    audio.run('playImpactSound(880,.055,.045,"shield");playImpactSound(300,.025);');
    assert.equal(audio.oscillators.length, 2);
  });

  test(`${platform}: shield feedback is bounded host state, with older packets and replay rejection preserved`, () => {
    const h = harness(platform);
    h.run('royalGuardHits.left={seq:2,y:50,ttl:8};const state=packRoyalState();');
    assert.equal(h.run('validRoyalState(state)'), true);
    assert.equal(h.run('validRoyalState({...state,guardHits:undefined})'), true);
    for (const change of ['v.guardHits.left.ttl=9', 'v.guardHits.left.y=Infinity',
      'v.guardHits.left.seq=-1', 'v.guardHits.left.seq="2"', 'v.guardHits.right={}', 'v.guardHits=null']) {
      assert.equal(h.run(`{const v=JSON.parse(JSON.stringify(state));${change};validRoyalState(v)}`), false, change);
    }
    h.run("lanRole='host';handleLanHostMessage({type:'state',royal:{...state,guardHits:{left:null,right:null}}});");
    assert.equal(h.run('royalGuardHits.left.seq'), 2, 'guest state cannot replace host feedback');
    h.run('applyRoyalState({...state,guardHits:undefined});');
    assert.deepEqual(h.json('royalGuardHits'), {left: null, right: null});
  });

  test(`${platform}: guest shield sound fires once on its rendered timeline`, () => {
    const h = harness(platform);
    h.context.ctx = {save() {}, restore() {}, fillRect() {}};
    h.context.drawText = () => {};
    h.run(`lanRole='guest';let impacts=0;playImpactSound=()=>impacts++;
      royalGuards.left=600;royalGuardHits.left={seq:1,y:40,ttl:8};const view=captureVisualState();
      for(let i=0;i<100;i++)drawRoyalEffects(view);`);
    assert.equal(h.run('impacts'), 1);
    h.run('royalGuardHits.left.seq=2;drawRoyalEffects(captureVisualState());drawRoyalEffects(view);');
    assert.equal(h.run('impacts'), 2, 'old or repeated views cannot replay sound');
  });

  test(`${platform}: camera feedback interpolates once with the ball and snaps on rally changes`, () => {
    const h = harness(platform);
    h.run(`currentShakeAmplitude=()=>.5;frame=1;const a=captureVisualState();
      frame=2;const b=captureVisualState();const middle=interpolateVisualState(a,b,.5);`);
    for (const axis of ['x', 'y']) assert.equal(h.run(`middle.shake.${axis}`),
      h.run(`(a.shake.${axis}+b.shake.${axis})/2`));
    h.run('visualEpoch++;const reset=captureVisualState();');
    assert.deepEqual(h.json('interpolateVisualState(b,reset,.25).shake'), h.json('reset.shake'));
  });

  test(`${platform}: primary and Split retain fractional positions and fixed physical dimensions`, () => {
    const h = harness(platform), rectangles = [];
    // Exercise each synchronized build, as well as the shared-source sync checks.
    h.run(functionSource(source(platform), 'drawBallPixels'));
    h.run(functionSource(source(platform), 'drawRoyalBall'));
    h.run("ball.lastHit='left';awardRoyalPowerup('split');const before=JSON.stringify([ball,royalSplitBall,frame]);");
    for (const [sx, sy] of [[388 / 640, 290 / 480], [1, 1], [1.25, 1.25],
      [952 / 640, 714 / 480], [2.975, 2.975], [4.4625, 4.4625], [6, 6]]) {
      const transform = {a: sx, d: sy, e: .37, f: -.23};
      h.context.ctx = {save() {}, restore() {}, getTransform: () => transform,
        fillRect(...r) { rectangles.push({r, alpha: this.globalAlpha, blur: this.shadowBlur}); }};
      const size = Math.max(1, Math.round(8 * Math.min(sx, sy)));
      for (const split of [false, true]) {
        let previous;
        for (let i = 0; i < 120; i++) {
          const b = {x: 200 + i / 17, y: 100 - i / 23, vx: 4.65, vy: -1};
          h.context.renderedBall = Object.freeze(b);
          h.run(`drawRoyalBall(renderedBall, ${split});`);
          const {r: [x, y, w, height], alpha, blur} = rectangles.at(-1);
          assert.equal(x, b.x, 'rendering must retain the interpolated X position');
          assert.equal(y, b.y, 'rendering must retain the interpolated Y position');
          assert.ok(Math.abs(w * sx - size) < 1e-10);
          assert.ok(Math.abs(height * sy - size) < 1e-10);
          assert.equal(alpha, split ? .52 : 1);
          assert.equal(blur, 0);
          if (previous) {
            assert.ok(Math.abs((x - previous.x) * sx - sx / 17) < 1e-10);
            assert.ok(Math.abs((y - previous.y) * sy + sy / 23) < 1e-10);
          }
          previous = {x, y};
        }
      }
    }
    assert.equal(h.run('JSON.stringify([ball,royalSplitBall,frame])===before'), true);
  });
}
