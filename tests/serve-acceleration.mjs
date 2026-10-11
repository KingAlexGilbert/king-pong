import test from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './helpers/royal-harness.mjs';
import {builds, source, functionSource} from './helpers/game-source.mjs';

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9,
  `${message}: ${actual} versus ${expected}`);

function serveHarness(platform) {
  const h = harness(platform), html = source(platform);
  h.run(`
    function findCenterSafeSpawn(){return {x:316,y:236}}
    function findReceiverSideRallySpawn(){return {x:160,y:236}}
    function setRallyBallVelocity(direction,speed){ball.vx=direction*speed;ball.vy=0}
    function hideFirstStartControls(){} function autoHideMenusForGameplay(){} function syncRoyalUi(){}
    ${['resetBall', 'serveOrContinue', 'beginRallyLaunchRamp', 'simulateHazardStep',
      'rectsOverlapRaw'].map(n => functionSource(html, n)).join('\n')}
  `);
  return h;
}

for (const platform of Object.keys(builds)) {
  test(`${platform}: serve reaches the original velocity at tick 24 without direction drift or a completion jump`, () => {
    for (const [vx, vy] of [[4.4, 0], [0, -4.4], [-3.52, 2.64]]) {
      const h = serveHarness(platform);
      h.run(`Object.assign(ball,{vx:${vx},vy:${vy}});beginRallyLaunchRamp()`);
      for (let tick = 0; tick <= 70; tick++) {
        const factor = tick < 24 ? .4 + .6 * tick / 24 : 1;
        close(h.run('ball.vx'), vx * factor, 'horizontal velocity');
        close(h.run('ball.vy'), vy * factor, 'vertical velocity');
        assert.equal(h.run('rallyLaunchFramesRemaining'), Math.max(0, 60 - tick), 'ripple lasts one second');
        if (tick >= 24) assert.equal(h.run('rallyLaunchTargetSpeed'), 0, 'completed ramp releases velocity');
        h.run('updateRallyLaunchRamp()');
      }
    }
  });

  test(`${platform}: early paddle returns keep the collision velocity on subsequent ticks`, () => {
    const h = serveHarness(platform);
    h.run(`Object.assign(ball,{x:left.x+PADDLE_W+.1,y:left.y+PADDLE_H/2-BALL_HALF,vx:-4.4,vy:0});
      beginRallyLaunchRamp();updateSingleBall();`);
    const outgoing = h.json('({vx:ball.vx,vy:ball.vy,speed:ballSpeed()})');
    assert.ok(outgoing.vx > 0, 'actual paddle contact reversed direction');
    assert.equal(h.run('rallyLaunchTargetSpeed'), 0);
    h.run('updateSingleBall()');
    close(h.run('ball.vx'), outgoing.vx, 'outgoing horizontal velocity is retained');
    close(h.run('ball.vy'), outgoing.vy, 'outgoing vertical velocity is retained');
    assert.equal(h.run('rallyLaunchFramesRemaining'), 58, 'contact preserves spawn animation');
  });

  test(`${platform}: real circle/rectangle contacts retain their speeds; quiet CPU forecasts cannot end the ramp`, () => {
    for (const type of ['rect', 'circle']) {
      const h = serveHarness(platform);
      h.run(`Object.assign(ball,{x:194,prevX:190,y:230,prevY:230,vx:4.4,vy:0});
        beginRallyLaunchRamp();
        const obstacle=${type === 'rect' ? '{type:"rect",x:200,y:200,w:20,h:80}' :
          '{type:"circle",x:211,y:234,r:14}'};
        const beforeForecast=JSON.stringify(ball);
        simulateHazardStep({...ball},obstacle);`);
      assert.equal(h.run('JSON.stringify(ball)'), h.run('beforeForecast'));
      close(h.run('rallyLaunchTargetSpeed'), 4.4, 'quiet CPU contact has no launch side effect');
      h.run('hazards=[obstacle];resolveHazardCollisions()');
      assert.equal(h.run('rallyLaunchTargetSpeed'), 0);
      const outgoing = h.json('({vx:ball.vx,vy:ball.vy})');
      assert.ok(outgoing.vx < 0, 'hazard reflected the actual ball');
      h.run('updateRallyLaunchRamp()');
      close(h.run('ball.vx'), outgoing.vx, 'hazard output survives next ramp tick');
      close(h.run('ball.vy'), outgoing.vy, 'hazard output direction is retained');
    }
  });

  test(`${platform}: wall reflection continues acceleration along the reflected trajectory`, () => {
    const h = serveHarness(platform);
    h.run('Object.assign(ball,{x:300,y:.1,vx:2.64,vy:-3.52});beginRallyLaunchRamp();updateSingleBall()');
    assert.ok(h.run('ball.vy') > 0);
    close(h.run('rallyLaunchTargetSpeed'), 4.4, 'wall does not end acceleration');
    h.run('updateSingleBall()');
    close(h.run('ball.vx'), 2.64 * .45, 'wall reflected horizontal component');
    close(h.run('ball.vy'), 3.52 * .45, 'wall reflected vertical component');
  });

  test(`${platform}: Crown Rush multiplier, guard reflection and Split isolation survive serve acceleration`, () => {
    const h = serveHarness(platform);
    h.run(`Object.assign(ball,{x:300,y:100,vx:4.4,vy:0,lastHit:'left'});beginRallyLaunchRamp();
      awardRoyalPowerup('rush');`);
    for (let tick = 0; tick <= 30; tick++) {
      close(h.run('ballSpeed()'), 4.4 * (tick < 24 ? .4 + .6 * tick / 24 : 1) * 1.3, 'Crown Rush speed');
      h.run('updateRallyLaunchRamp()');
    }
    h.run('endRoyalRush(ball)');
    close(h.run('ballSpeed()'), 4.4, 'ending Rush restores original target');

    h.run(`resetRoyalRally();Object.assign(ball,{x:300,y:100,vx:4.4,vy:0,lastHit:'left'});
      beginRallyLaunchRamp();awardRoyalPowerup('split');
      Object.assign(royalSplitBall,{x:left.x+PADDLE_W+.1,y:left.y+PADDLE_H/2-BALL_HALF,vx:-4,vy:0});
      updateBall();`);
    assert.equal(h.run('royalSplitBall'), null, 'duplicate hit the paddle and disappeared');
    close(h.run('rallyLaunchTargetSpeed'), 4.4, 'duplicate cannot cancel primary acceleration');
    close(h.run('ballSpeed()'), 4.4 * .425, 'primary advances exactly once');

    h.run(`resetRoyalRally();Object.assign(ball,{x:19.1,y:100,vx:-4.4,vy:0,lastHit:'left'});
      beginRallyLaunchRamp();royalGuards.left=600;updateSingleBall();`);
    assert.ok(h.run('ball.vx') > 0, 'Castle Guard reflected the serve');
    assert.equal(h.run('royalGuards.left'), 600, 'reflection preserves the existing timed guard');
    close(h.run('rallyLaunchTargetSpeed'), 4.4, 'guard preserves ramp');
    h.run('updateSingleBall()');
    close(h.run('ballSpeed()'), 4.4 * .45, 'guard keeps expected ramp speed');
  });

  test(`${platform}: initial and repeated score serves preserve existing CPU/local/host timing and snapshots`, () => {
    for (const role of ['none', 'host']) {
      const h = serveHarness(platform);
      h.run(`mode=2;lanRole='${role}';resetBall(1,true);serveOrContinue()`);
      assert.equal(h.run('waitingForServe'), false);
      assert.equal(h.run('rallyLaunchFramesRemaining'), 60);
      close(h.run('ballSpeed()'), h.run('currentLevel().ballSpeed') * .4, 'local/host manual serve');
    }
    const h = serveHarness(platform);
    h.run('mode=1;resetBall(1,true);serveOrContinue()');
    assert.equal(h.run('rallyLaunchFramesRemaining'), 0, 'initial CPU serve remains full speed');
    for (let i = 0; i < 4; i++) {
      h.run(i % 2 ? 'pointForCpu()' : 'pointForPlayer()');
      assert.equal(h.run('waitingForServe'), false, 'non-winning CPU score serves automatically');
      assert.equal(h.run('rallyLaunchFramesRemaining'), 60, 'every score restarts the ramp exactly once');
      close(h.run('ballSpeed()'), h.run('currentLevel().ballSpeed') * .4, 'post-score starting speed');
      assert.equal(h.run('visualPrevious.ball.x'), h.run('ball.x'), 'reset cannot interpolate across rallies');
      assert.equal(h.run('visualCurrent.ball.x'), h.run('ball.x'));
      h.run('for(let n=0;n<10;n++)updateSingleBall()');
      close(h.run('ballSpeed()'), h.run('currentLevel().ballSpeed') * .65, 'fresh progress after score');
    }
  });

  test(`${platform}: waiting and guest simulation cannot advance an authoritative serve`, () => {
    const h = serveHarness(platform);
    h.run('beginRallyLaunchRamp();waitingForServe=true;updateSingleBall()');
    assert.equal(h.run('rallyLaunchFramesRemaining'), 60);
    h.run("waitingForServe=false;lanRole='guest';updateBall()");
    assert.equal(h.run('rallyLaunchFramesRemaining'), 60, 'guest does not simulate the ball');
    h.run("lanRole='host';updateBall()");
    assert.equal(h.run('rallyLaunchFramesRemaining'), 59, 'host owns the next tick');
  });
}
