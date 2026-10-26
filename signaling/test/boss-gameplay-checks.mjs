import assert from 'node:assert/strict';

// Called by the existing four-platform gameplay suite with its animation loop
// stopped. These use the actual update/render/reset paths, not a second engine.
export async function bossGameplayChecks(page) {
  assert.deepEqual(await page.evaluate(() => [bossBalls.length, bossBalls[0].vx < 0,
    bossRallyFrames, bossPlayerHealth, bossEnemyHealth]), [1, true, 0, 13, 10]);
  const progression = await page.evaluate(() => {
    const park = () => bossBalls.forEach(b => Object.assign(b, {vx: 0, vy: 0, rallyLaunchFramesRemaining: 0}));
    park();
    for (let i = 0; i < 599; i++) update();
    const before = bossBalls.length;
    update();
    const timed = [bossBalls.length, bossBalls[1].vx > 0];
    bossEnemyHealth = 3; update();
    const health = [bossBalls.length, bossBalls[2].vx > 0];
    const ids = bossBalls.map(b => b.id);
    park(); update(); update();
    const stable = bossBalls.every((b, i) => b.id === ids[i]);
    startBossFight(); bossEnemyHealth = 3; update();
    const early = bossBalls.length;
    startBossFight();
    return {before, timed, health, stable, early, reset: [bossBalls.length, bossRallyFrames, bossBalls[0].vx < 0]};
  });
  assert.deepEqual(progression, {before: 1, timed: [2, true], health: [3, true], stable: true,
    early: 3, reset: [1, 0, true]});

  for (const stage of [1, 2, 3]) for (const [index, type] of ['split', 'rush', 'guard'].entries()) {
    const result = await page.evaluate(({stage, index, type}) => {
      startBossFight();
      if (stage > 1) bossRallyFrames = 599;
      if (stage === 3) bossEnemyHealth = 3;
      update();
      bossBalls.forEach(b => Object.assign(b, {vx: 0, vy: 0, rallyLaunchFramesRemaining: 0}));
      royalPickup = null; royalPickupIndex = index; royalRallyTick = 179;
      const ordinaryBall = JSON.stringify(ball);
      update();
      const spawned = royalPickup?.type;
      if (!royalPickup) return {spawned};
      const pickup = {...royalPickup};
      paused = true; update(); paused = false;
      const pausePreserved = royalPickup.ttl === pickup.ttl;
      const target = bossBalls[0];
      Object.assign(target, {x: pickup.x - BALL_HALF - 4, y: pickup.y - BALL_HALF,
        vx: 4, vy: 0, lastHit: 'left', rallyLaunchFramesRemaining: 0});
      update();
      const collected = royalPickup === null;
      let effect, finished;
      if (type === 'split') {
        effect = royalSplitBall?.id === 'royal-split' && bossBalls.length === stage;
        const drawBall = drawRoyalBall, seen = [];
        try {
          drawRoyalBall = (b, extra) => {if (b) seen.push([b.id, !!extra]); drawBall(b, extra);};
          draw(captureVisualState());
        } finally {drawRoyalBall = drawBall;}
        effect &&= seen.some(([id, extra]) => id === 'royal-split' && extra) && seen.length === stage + 1;
        Object.assign(royalSplitBall, {x: W + 1, y: 240, vx: 4, vy: 0});
        const health = bossEnemyHealth, ids = bossBalls.map(b => b.id);
        update();
        finished = royalSplitBall === null && bossEnemyHealth === health - 1 &&
          bossBalls.every((b, i) => b.id === ids[i]);
      } else if (type === 'rush') {
        effect = target.rush === true && Math.abs(target.vx - 5.2) < 1e-9;
        Object.assign(target, {x: paddleSurfaceX(left, 1, activePaddleProfile(left), left.y + PADDLE_H / 2) + 1,
          y: left.y + PADDLE_H / 2 - BALL_HALF, vx: -5.2, vy: 0});
        update();
        finished = !target.rush && target.vx > 0;
      } else {
        effect = royalGuards.left === 600;
        Object.assign(target, {x: 20, y: left.y > H / 2 ? 50 : H - 50, vx: -5, vy: 0});
        const health = bossPlayerHealth;
        update();
        finished = target.vx > 0 && bossPlayerHealth === health && royalGuards.left === 599;
      }
      return {spawned, collected, pausePreserved, effect, finished, ordinaryUnchanged: JSON.stringify(ball) === ordinaryBall};
    }, {stage, index, type});
    assert.deepEqual(result, {spawned: type, collected: true, pausePreserved: true, effect: true,
      finished: true, ordinaryUnchanged: true}, `stage ${stage}: ${type}`);
  }
  const ending = await page.evaluate(() => {
    startBossFight();
    const progress = JSON.stringify([saveData.completedLevels, saveData.highestUnlockedLevel]);
    bossPlayerHealth = 1;
    Object.assign(bossBalls[0], {x: -20, vx: -5, rallyLaunchFramesRemaining: 0});
    update();
    const defeated = gameOver && bossPlayerHealth === 0 && !creditsActive;
    startBossFight();
    const reset = bossBalls.length === 1 && !royalSplitBall && !royalPickup && !royalGuards.left && !royalGuards.right;
    bossEnemyHealth = 1;
    Object.assign(bossBalls[0], {x: W + 1, vx: 5, rallyLaunchFramesRemaining: 0});
    update();
    const victory = bossEnemyHealth === 0 && bossCleared && gameOver && saveData.bossCleared && creditsActive;
    const progressPreserved = progress === JSON.stringify([saveData.completedLevels, saveData.highestUnlockedLevel]);
    finishCreditsSequence();
    const creditsFinished = !creditsActive && !screenFade.classList.contains('active');
    hideTitleScreen(); startBossFight();
    return {defeated, reset, victory, progressPreserved, creditsFinished};
  });
  assert.deepEqual(ending, {defeated: true, reset: true, victory: true, progressPreserved: true, creditsFinished: true});
}
