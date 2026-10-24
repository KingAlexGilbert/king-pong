function predictWithSimpleBounds(x, y, vx, vy, targetX) {
  if (vx <= 0) return y + BALL_HALF;
  const bounds = visiblePlayfieldBounds();
  const timeToPaddle = Math.max(0, (targetX - (x + BALL_HALF)) / vx);
  const rawY = y + BALL_HALF + vy * timeToPaddle;
  const top = bounds.top + BALL_HALF;
  const bottom = bounds.bottom - BALL_HALF;
  const range = bottom - top;
  const period = range * 2;
  let folded = (rawY - top) % period;
  if (folded < 0) folded += period;
  if (folded > range) folded = period - folded;
  return top + folded;
}

function simulateHazardStep(sim, h) {
  // Most forecast steps miss every obstacle. Reject only definite misses before
  // copying ball state or entering the allocation-heavy collision helpers.
  if (h.type === "circle") {
    const radius = h.r + BALL_HALF;
    if (Math.abs(sim.x + BALL_HALF - h.x) >= radius ||
        Math.abs(sim.y + BALL_HALF - h.y) >= radius) return false;
  } else if (!rectsOverlapRaw(sim.x, sim.y, BALL_SIZE, BALL_SIZE, h.x, h.y, h.w, h.h)) {
    return false;
  }
  const save = {
    x: ball.x,
    y: ball.y,
    prevX: ball.prevX,
    prevY: ball.prevY,
    vx: ball.vx,
    vy: ball.vy
  };
  ball.x = sim.x;
  ball.y = sim.y;
  ball.prevX = sim.prevX;
  ball.prevY = sim.prevY;
  ball.vx = sim.vx;
  ball.vy = sim.vy;
  const hit = h.type === "circle" ? resolveCircleCollision(h, true) : resolveRectCollision(h, true);
  sim.x = ball.x;
  sim.y = ball.y;
  sim.vx = ball.vx;
  sim.vy = ball.vy;
  ball.x = save.x;
  ball.y = save.y;
  ball.prevX = save.prevX;
  ball.prevY = save.prevY;
  ball.vx = save.vx;
  ball.vy = save.vy;
  return hit;
}

function predictBallCenterForCPU(cfg, arrival = null) {
  /* ROYAL POLISH */
  if (arrival) arrival.frames = Infinity;
  /* END ROYAL POLISH */
  if (ball.vx <= 0 || waitingForServe) {
    return visiblePlayfieldCenterY();
  }
  if (cfg.prediction < 0.42 || hazards.length === 0) {
    /* ROYAL POLISH */
    if (arrival) arrival.frames = Math.max(0, (right.x - ball.x - BALL_HALF) / ball.vx);
    /* END ROYAL POLISH */
    return predictWithSimpleBounds(ball.x, ball.y, ball.vx, ball.vy, right.x);
  }
  const sim = {
    x: ball.x,
    y: ball.y,
    prevX: ball.prevX,
    prevY: ball.prevY,
    vx: ball.vx,
    vy: ball.vy
  };
  const bounds = visiblePlayfieldBounds();
  for (let i = 0; i < cfg.horizon; i++) {
    sim.prevX = sim.x;
    sim.prevY = sim.y;
    sim.x += sim.vx;
    sim.y += sim.vy;
    if (sim.y <= bounds.top) {
      sim.y = bounds.top;
      sim.vy = Math.abs(sim.vy);
    }
    if (sim.y + BALL_SIZE >= bounds.bottom) {
      sim.y = bounds.bottom - BALL_SIZE;
      sim.vy = -Math.abs(sim.vy);
    }
    for (const h of hazards) {
      simulateHazardStep(sim, h);
    }
    if (sim.x + BALL_SIZE >= right.x) {
      /* ROYAL POLISH */
      if (arrival) arrival.frames = i + 1;
      /* END ROYAL POLISH */
      return sim.y + BALL_HALF;
    }
  }
  return sim.y + BALL_HALF;
}

function updateCPU() {
  const cfg = getCpuConfig();
  /* ROYAL POLISH */
  const aim = royalCpuAim(cfg);
  /* END ROYAL POLISH */
  const bounds = visiblePlayfieldBounds();
  const centerY = bounds.top + (bounds.bottom - bounds.top) / 2;
  const idleDrift = Math.min(12, Math.max(0, (bounds.bottom - bounds.top - PADDLE_H) / 3));
  const currentCenter = aim.target.y + BALL_HALF;
  const predictedCenter = aim.center;
  let targetCenter;
  if (aim.target.vx > 0 && !waitingForServe) {
    targetCenter = lerp(currentCenter, predictedCenter, cfg.prediction) + cpuErrorOffset;
  } else {
    targetCenter = centerY + Math.sin(frame * 0.022) * idleDrift;
  }
  const targetY = clamp(targetCenter - PADDLE_H / 2, bounds.top, bounds.bottom - PADDLE_H);
  const delta = targetY - right.y;
  if (Math.abs(delta) > cfg.deadZone) {
    const move = clamp(delta * cfg.reaction, -cfg.maxMove, cfg.maxMove);
    right.y += move;
  }
  right.y = clamp(right.y, bounds.top, bounds.bottom - PADDLE_H);
}
