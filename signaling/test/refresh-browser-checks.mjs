import assert from 'node:assert/strict';

// Drive the real loop with explicit presentation times. No production test hooks.
// An independent tick tape checks interpolation across scores, not just constant speed.
export async function refreshTrace(page, options) {
  return page.evaluate(({hz, irregular = false, arena = 0, local = false, kind = 'score', duration = 2000}) => {
    hideTitleScreen();
    mode = local ? 2 : 1;
    activeCampaign = Math.floor(arena / 6);
    levelIndex = arena % 6;
    matchArenaId = arena;
    frame = 0;
    cloneHazards();
    resetPaddles();
    left.score = right.score = 0;
    gameOver = levelCleared = campaignCleared = paused = waitingForServe = menusVisible = false;
    gameWindowFocused = true;
    royalRotateDismissed = true;
    saveData.muteAll = true;
    nextCpuModeServeDirection = 1;
    resetBall(1, false);
    ball.lastScored = 0;
    shakeFrames = 0;
    if (kind === 'score') Object.assign(ball, {x: W - 1, y: 10, vx: 4, vy: 0});
    else {
      clearRallyLaunchRamp();
      Object.assign(ball, {x: 100.125, y: 120.375, vx: kind === 'vertical' ? 0 : 12,
        vy: kind === 'horizontal' ? 0 : kind === 'vertical' ? 12 : 9, rush: false});
    }
    resetFrameClock();
    syncRoyalUi(true);
    const state = () => ({frame, ball: {...ball}, split: royalSplitBall ? {...royalSplitBall} : null,
      left: {...left}, right: {...right}, hazards: hazards.map(h => ({...h})),
      score: `${left.score}:${right.score}`, remaining: rallyLaunchFramesRemaining,
      waiting: waitingForServe, paused, gameOver, epoch: visualEpoch});
    const ticks = [state()], views = [];
    const originalUpdate = update, originalDraw = draw;
    let time = 0;
    update = () => { originalUpdate(); ticks.push(state()); };
    draw = view => {
      // The simulation tape is indexed by wall time, independently of visualPrevious/Current.
      const n = Math.min(ticks.length - 1, Math.floor((time + 1e-7) / FIXED_STEP_MS));
      const a = ticks[Math.max(0, n - 1)], b = ticks[n];
      const alpha = Math.max(0, Math.min(1, time / FIXED_STEP_MS - n));
      const boundary = a.epoch !== b.epoch || a.score !== b.score || a.waiting !== b.waiting || a.paused !== b.paused;
      const x = boundary ? b.ball.x : a.ball.x + (b.ball.x - a.ball.x) * alpha;
      const y = boundary ? b.ball.y : a.ball.y + (b.ball.y - a.ball.y) * alpha;
      views.push({time, x: view.ball.x, y: view.ball.y, expectedX: x, expectedY: y,
        error: Math.hypot(x - view.ball.x, y - view.ball.y), remaining: view.launch.remaining,
        split: view.split ? {x: view.split.x, y: view.split.y} : null, score: `${view.left.score}:${view.right.score}`});
    };
    const cadence = [.72, 1.31, .93, 1.08, 2, .55, 1.12, .87, 1, 1.4, .8];
    try {
      for (let i = 0; time < duration - 1e-7; i++) {
        loop(time);
        time += 1000 / hz * (irregular ? cadence[i % cadence.length] : 1);
      }
      time = duration;
      loop(time);
    } finally { update = originalUpdate; draw = originalDraw; }
    return {hz, irregular, arena, local, kind, duration, ticks, views};
  }, options);
}

export async function refreshBrowserChecks({page, pass}) {
  const p = await page();
  for (const arena of [0, 4, 7]) {
    let reference;
    for (const hz of [60, 120, 144, 165, 240]) for (const irregular of [false, true]) {
      const trace = await refreshTrace(p, {hz, irregular, arena});
      assert.equal(trace.ticks.length, 121, 'two seconds still execute exactly 120 fixed steps');
      assert.equal(trace.ticks[1].left.score, 1);
      assert.equal(trace.ticks[1].waiting, false, 'a non-winning score still serves automatically');
      assert.equal(trace.ticks[1].remaining, 60, 'the existing launch ramp is unchanged');
      assert.ok(trace.views.every(v => v.error < 1e-7), 'post-score interpolation follows the current rally tick tape');
      const physics = trace.ticks.map(({ball, split, left, right, hazards, remaining, waiting}) =>
        ({ball, split, left, right, hazards, remaining, waiting}));
      if (!reference) reference = physics;
      else assert.deepEqual(physics, reference, 'presentation rate never changes the simulation');
      if (arena === 0) {
        const target = Math.hypot(trace.ticks[1].ball.vx, trace.ticks[1].ball.vy) / .2;
        for (let n = 0; n <= 60; n++) {
          const tick = trace.ticks[n + 1], progress = n / 60;
          const expectedSpeed = target * (.2 + .8 * progress * progress * (3 - 2 * progress));
          assert.ok(Math.abs(Math.hypot(tick.ball.vx, tick.ball.vy) - expectedSpeed) < 1e-7,
            'automatic serving retains the exact one-second slow-to-fast speed curve');
        }
      }
    }
  }
  pass('two seconds after scoring: automatic serve, exact acceleration, interpolation and identical physics at 60/120/144/165/240 Hz with regular/irregular intervals');
  for (const kind of ['horizontal', 'vertical', 'diagonal']) {
    for (const hz of [60, 120, 144, 165, 240]) {
      const trace = await refreshTrace(p, {hz, irregular: true, local: true, kind, duration: 2000});
      assert.ok(trace.views.every(v => v.error < 1e-7), 'high-speed local play follows the tick tape through collisions and scores');
    }
  }
  await p.context().close();
  pass('fast horizontal/vertical/diagonal local rallies keep the same interpolation through irregular presentation');
}
