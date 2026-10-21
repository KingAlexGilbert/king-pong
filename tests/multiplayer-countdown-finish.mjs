import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {harness} from './helpers/royal-harness.mjs';
import {builds, source, functionSource} from './helpers/game-source.mjs';

function setup(platform) {
  const h = harness(platform);
  h.run(`let now=1000; performance.now=()=>now;
    let audioCtx={state:'running'};
    let soundLog=[];
    beep=(...args)=>soundLog.push(args);
    function findCenterSafeSpawn(){return {x:316,y:236}}
    function findReceiverSideRallySpawn(){return {x:160,y:236}}
    function setRallyBallVelocity(direction,speed){ball.vx=direction*speed;ball.vy=0}
    function hideFirstStartControls(){} function autoHideMenusForGameplay(){} function syncRoyalUi(){}
    ${['resetBall','serveOrContinue','beginRallyLaunchRamp'].map(n=>functionSource(source(platform),n)).join('\n')}
    lanRole='host'; waitingForServe=false;
  `);
  return h;
}

for (const platform of Object.keys(builds)) {
  test(`${platform}: release uses the pause-resume ding once, not the manual-serve beep`, () => {
    const h = setup(platform);
    h.run(`pointForPlayer(); now+=1000; tickPointServeCountdown();
      playPointServeCountdownSound(1); now+=1000; tickPointServeCountdown();`);
    assert.equal(h.run('waitingForServe'), false);
    assert.equal(h.run('soundLog.filter(s=>s[0]===1040).length'), 1);
    assert.equal(h.run('soundLog.filter(s=>s[0]===440).length'), 0);
    assert.equal(h.run('soundLog.filter(s=>s[0]===720).length'), 1);
    h.run('now+=3000; tickPointServeCountdown();');
    assert.equal(h.run('soundLog.filter(s=>s[0]===1040).length'), 1);
  });

  test(`${platform}: guest plays one release ding on authoritative transition`, () => {
    const h = setup(platform);
    h.run(`lanRole='guest';left.score=1;waitingForServe=true;
      applyPointServeSnapshot({pointServeMs:2000});
      applyPointServeSnapshot({pointServeMs:1000});
      waitingForServe=false;applyPointServeSnapshot({pointServeMs:0});
      applyPointServeSnapshot({pointServeMs:0});`);
    assert.equal(h.run('soundLog.filter(s=>s[0]===1040).length'), 1);
  });

  test(`${platform}: cancelled, paused, hidden and unavailable-audio countdowns cannot ring on release`, () => {
    const h = setup(platform);
    h.run(`lanRole='guest';left.score=1;waitingForServe=true;
      applyPointServeSnapshot({pointServeMs:800});
      paused=true; waitingForServe=false; applyPointServeSnapshot({pointServeMs:0});`);
    assert.equal(h.run('soundLog.length'), 0);
    h.run(`paused=false; waitingForServe=true;applyPointServeSnapshot({pointServeMs:600});
      waitingForServe=false; document.hidden=true;applyPointServeSnapshot({pointServeMs:0});`);
    assert.equal(h.run('soundLog.length'), 0);
    h.run(`document.hidden=false; waitingForServe=true; applyPointServeSnapshot({pointServeMs:600});
      audioCtx.state='suspended';waitingForServe=false;applyPointServeSnapshot({pointServeMs:0});`);
    assert.equal(h.run('soundLog.length'), 0);
    h.run(`audioCtx.state='running';waitingForServe=true;applyPointServeSnapshot({pointServeMs:1000});
      waitingForServe=false;gameOver=true;applyPointServeSnapshot({pointServeMs:0});`);
    assert.equal(h.run('soundLog.length'), 0);
  });

  test(`${platform}: countdown digits share the unboxed pause-resume presentation`, () => {
    const h = setup(platform);
    h.run(`lanRole='host'; waitingForServe=true; gameOver=false;paused=false;
      pointServeCountdown={remainingMs:1200,at:now,networked:true,score:'0:0',soundStep:1};
      let drawnDigits=[];
      const ctx={fillStyle:'',fillRect(){throw Error('unexpected countdown box')},
        strokeRect(){throw Error('unexpected countdown border')}};
      function drawText(...args){drawnDigits.push(args)}
      drawPointServeCountdown();`);
    assert.equal(h.run('drawnDigits.length'), 1);
    assert.equal(h.run('drawnDigits[0][2]'), 182); // H/2 - 58
    assert.equal(h.run('drawnDigits[0][3]'), 64);
  });
}
