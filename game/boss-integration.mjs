import {functionRange} from './ui-integration.mjs';

function change(source, name, edit) {
  const [start, end] = functionRange(source, name);
  return source.slice(0, start) + edit(source.slice(start, end)) + source.slice(end);
}

// Keep the encounter policy identical in the four legacy platform shells.
export function integrateWallBalls(source) {
  for (const name of ['BOSS_STARTING_BALLS', 'BOSS_MAX_BALLS', 'BOSS_SECOND_BALL_DELAY_FRAMES']) {
    source = source.replace(new RegExp('^const ' + name + ' = [^;]+;\\n', 'm'), '');
  }
  const [start, end] = functionRange(source, 'desiredBossBallCount');
  source = source.slice(0, start) + `function desiredBossBallCount() {
  // Health can reach the final stage before the timed addition. Fill missing
  // permanent slots together; the count never includes the temporary Split.
  if (bossEnemyHealth <= 3) return 3;
  return bossRallyFrames >= 600 ? 2 : 1;
}` + source.slice(end);
  const [resetStart, resetEnd] = functionRange(source, 'resetBossBalls');
  source = source.slice(0, resetStart) + `function resetBossBalls() {
  resetBossTactics();
  bossBalls = [createBossBall(0, -1)];
}` + source.slice(resetEnd);
  source = change(source, 'updateBossBalls', () => `function updateBossBalls() {
  if (waitingForServe || gameOver || bossIntroActive) return;
  bossRallyFrames++;
  while (bossBalls.length < desiredBossBallCount()) {
    bossBalls.push(createBossBall(bossBalls.length, 1));
  }
  const extra = royalSplitBall;
  for (let i = 0; i < bossBalls.length && !gameOver; i++) {
    const scored = updateSingleBossBall(bossBalls[i]);
    if (scored) {
      if (scored > 0) damageBoss(); else damagePlayer();
      if (!gameOver) respawnBossBall(i, 1);
    }
  }
  if (extra && royalSplitBall === extra && !gameOver) {
    const scored = updateSingleBossBall(extra);
    if (scored) {
      royalSplitBall = null; // Temporary balls score once and never respawn.
      if (scored > 0) damageBoss(); else damagePlayer();
    }
  }
}`);
  source = change(source, 'hitBossPaddle', body => {
    // The shape which passed collision testing must also produce the bounce.
    body = body.replace(/\n  if \(paddle === right\) \{\n    selectBossAdaptiveProfile\(bossBall, true\);\n  }/, '');
    if (!body.includes('endRoyalRush(bossBall)')) body = body.replace('{', `{
  endRoyalRush(bossBall);
  bossBall.lastHit = paddle === left ? 'left' : 'right';`);
    if (!body.includes('ROYAL_SPLIT_SPEED_SCALE')) body = body.replace(
      'const speed = Math.min(bossBallSpeed(bossBall) + 0.16, BOSS_LEVEL.maxSpeed);',
      `const scale = bossBall.id === 'royal-split' ? ROYAL_SPLIT_SPEED_SCALE : 1;
  const speed = Math.min(bossBallSpeed(bossBall) + 0.16 * scale, BOSS_LEVEL.maxSpeed * scale);`);
    if (!body.includes('royalSplitBall = null')) body = body.replace(/\n}$/, '\n  if (bossBall === royalSplitBall) royalSplitBall = null;\n}');
    return body;
  });
  source = change(source, 'normalizeBossBallVelocity', body => body.includes('ROYAL_SPLIT_SPEED_SCALE') ? body : body.replace('{', `{
  const scale = (bossBall.id === 'royal-split' ? ROYAL_SPLIT_SPEED_SCALE : 1) * (bossBall.rush ? 1.3 : 1);
  minSpeed *= scale;
  maxSpeed *= scale;`));
  source = change(source, 'updateBossBallLaunchRamp', body => body.replace(
    'const targetSpeed = Number(bossBall.rallyLaunchTargetSpeed) || 0;',
    'const targetSpeed = (Number(bossBall.rallyLaunchTargetSpeed) || 0) * (bossBall.rush ? 1.3 : 1);'));
  source = change(source, 'update', body => body.includes('updateRoyalPowerups();\n    updateBossCPU();') ? body :
    body.replace('updateBossCPU();', 'updateRoyalPowerups();\n    updateBossCPU();'));
  source = change(source, 'drawBossBalls', body => body.replace('drawBallPixels(bossBall);', 'drawRoyalBall(bossBall);'));
  source = change(source, 'draw', body => body.includes('drawBossBalls(view.bossBalls);\n    drawRoyalBall(view.split, true);') ? body :
    body.replace('drawBossBalls(view.bossBalls);', 'drawBossBalls(view.bossBalls);\n    drawRoyalBall(view.split, true);'));
  for (const name of ['resolveBossRectCollision', 'resolveBossCircleCollision']) {
    source = change(source, name, body => {
      body = body.replace('(bossBall, h)', '(bossBall, h, predictOnly = false)');
      if (body.includes('if (!predictOnly)')) return body;
      return body
        .replace(/  applyHitFlash\(h, (8|10)\);\n  addScreenShake\((4|5)\);\n  (.*playImpactSound.*);/,
          '  if (!predictOnly) {\n    applyHitFlash(h, $1);\n    addScreenShake($2);\n    $3;\n  }')
        .replace(/  h.hitFlash = (8|10);\n  shakeFrames = Math.max\(shakeFrames, (4|5)\);\n  (.*playImpactSound.*);/,
          '  if (!predictOnly) {\n    h.hitFlash = $1;\n    shakeFrames = Math.max(shakeFrames, $2);\n    $3;\n  }');
    });
  }
  source = change(source, 'reflectBossBallYForBounds', body => body.replace('(bossBall)', '(bossBall, predictOnly = false)')
    .replaceAll('if (struck) playImpactSound', 'if (struck && !predictOnly) playImpactSound'));
  // Only these three boss decision functions move into the shared boss script.
  for (const name of ['bossThreatBall', 'predictBossBallCenter', 'updateBossCPU']) {
    const [begin, finish] = functionRange(source, name);
    if (begin < source.indexOf('// BEGIN SHARED ROYAL GAMEPLAY'))
      source = source.slice(0, begin) + source.slice(finish);
  }
  return source;
}
