// The Wall plans at its existing six-tick adaptation cadence. Scratch records
// are bounded to three permanent balls and the one temporary Royal Split.
const bossPlan = {at: -Infinity, ball: null, center: 240, forecast: null};
const bossForecasts = Array.from({length: 4}, () => ({}));
const bossForecastState = {};
const bossForecastHazards = [];
const bossContactPaddle = {x: 0, y: 0};

function resetBossTactics() {
  bossPlan.at = -Infinity;
  bossPlan.ball = bossPlan.forecast = null;
  bossPlan.center = visiblePlayfieldCenterY();
}

function forecastBossBall(target, cfg, result) {
  result.ball = target;
  result.frames = Infinity;
  result.center = target.y + BALL_HALF;
  result.vx = target.vx;
  result.vy = target.vy;
  if (target.vx <= 0 || target.x > right.x + PADDLE_W) return result;
  const sim = bossForecastState, bounds = visiblePlayfieldBounds();
  Object.assign(sim, target);
  sim.rush = Boolean(target.rush);
  sim.rallyLaunchFramesRemaining = Number(target.rallyLaunchFramesRemaining) || 0;
  sim.rallyLaunchTargetSpeed = Number(target.rallyLaunchTargetSpeed) || 0;
  let lastHazardX = -Infinity;
  bossForecastHazards.length = hazards.length;
  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i], copy = bossForecastHazards[i] || (bossForecastHazards[i] = {});
    Object.assign(copy, h);
    lastHazardX = Math.max(lastHazardX, h.x + (h.type === 'circle' ? h.r : h.w) + Math.max(0, h.vx || 0) * 30);
  }
  for (let tick = 0; tick < cfg.horizon; tick++) {
    if (!sim.rallyLaunchFramesRemaining && sim.x > lastHazardX) {
      const remaining = Math.max(0, (right.x - BALL_SIZE - sim.x) / sim.vx);
      if (tick + remaining > cfg.horizon) return result;
      result.frames = tick + remaining;
      result.center = predictWithSimpleBounds(sim.x, sim.y, sim.vx, sim.vy, right.x - BALL_HALF);
      result.vx = sim.vx;
      // A wall rebound can reverse the vertical approach before paddle contact.
      const next = predictWithSimpleBounds(sim.x, sim.y, sim.vx, sim.vy, right.x - BALL_HALF + sim.vx * .01);
      result.vy = Math.sign(next - result.center) * Math.abs(sim.vy);
      return result;
    }
    updateBossBallLaunchRamp(sim);
    sim.prevX = sim.x; sim.prevY = sim.y;
    sim.x += sim.vx; sim.y += sim.vy;
    reflectBossBallYForBounds(sim, true);
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i], copy = bossForecastHazards[i];
      // Only short motion extrapolation, then hold the estimate. Future player
      // input, pickups and distant moving-obstacle interactions are not known.
      const time = Math.min(tick + 1, 30);
      copy.x = h.x + (h.vx || 0) * time;
      copy.y = h.y + (h.vy || 0) * time;
      if (copy.type === 'circle') {
        if (Math.abs(sim.x + BALL_HALF - copy.x) < copy.r + BALL_HALF &&
            Math.abs(sim.y + BALL_HALF - copy.y) < copy.r + BALL_HALF) resolveBossCircleCollision(sim, copy, true);
      } else if (rectsOverlapRaw(sim.x, sim.y, BALL_SIZE, BALL_SIZE, copy.x, copy.y, copy.w, copy.h)) {
        resolveBossRectCollision(sim, copy, true);
      }
    }
    if (sim.vx <= 0) return result;
    if (sim.x + BALL_SIZE >= right.x) {
      result.frames = tick + 1;
      result.center = sim.y + BALL_HALF;
      result.vx = sim.vx; result.vy = sim.vy;
      return result;
    }
  }
  return result;
}

function bossReachPosition(targetY, ticks, cfg) {
  const delta = targetY - right.y, distance = Math.abs(delta);
  const steps = Math.max(0, Math.floor(ticks));
  if (distance <= cfg.deadZone || steps === 0) return right.y;
  const linear = Math.min(steps, Math.max(0, Math.ceil((distance - cfg.maxMove / cfg.reaction) / cfg.maxMove)));
  const remaining = Math.max(0, distance - linear * cfg.maxMove);
  const eased = remaining * Math.pow(1 - cfg.reaction, steps - linear);
  return right.y + Math.sign(delta) * (distance - Math.min(remaining, Math.max(cfg.deadZone, eased)));
}

function planBossDefence() {
  if (frame - bossPlan.at < 6) return bossPlan;
  bossPlan.at = frame;
  const cfg = getCpuConfig(), bounds = visiblePlayfieldBounds();
  let best = null, previous = null, count = 0;
  for (let i = 0; i < bossBalls.length + (royalSplitBall ? 1 : 0); i++) {
    const target = i < bossBalls.length ? bossBalls[i] : royalSplitBall;
    const forecast = forecastBossBall(target, cfg, bossForecasts[count++]);
    if (!Number.isFinite(forecast.frames)) continue;
    forecast.targetY = clamp(forecast.center - PADDLE_H / 2, bounds.top, bounds.bottom - PADDLE_H);
    forecast.margin = PADDLE_H / 2 + BALL_HALF - Math.abs(forecast.center -
      bossReachPosition(forecast.targetY, forecast.frames, cfg) - PADDLE_H / 2);
    forecast.score = forecast.frames + (forecast.margin < 0 ? 180 - forecast.margin : Math.max(0, 8 - forecast.margin));
    if (target === bossPlan.ball) previous = forecast;
    if (!best || forecast.score < best.score) best = forecast;
  }
  // Keep near-equivalent targets stable, but abandon a lost interception when
  // another ball can still be saved. A respawn is a new ball object.
  if (previous && previous.margin >= 0 && best && previous.score <= best.score + 8) best = previous;
  bossPlan.ball = best?.ball || null;
  bossPlan.forecast = best;
  bossPlan.center = best ? best.targetY + PADDLE_H / 2 : visiblePlayfieldCenterY();
  if (best && best.margin > 8) {
    for (let i = 0; i < count; i++) {
      const other = bossForecasts[i];
      if (other === best || !Number.isFinite(other.frames) || other.margin < 0 || Math.abs(other.frames - best.frames) > 12) continue;
      const radius = PADDLE_H / 2 - 8;
      const low = Math.max(best.center, other.center) - radius;
      const high = Math.min(best.center, other.center) + radius;
      if (low <= high) {
        const center = clamp(bossPlan.center, low, high);
        const reached = bossReachPosition(center - PADDLE_H / 2, best.frames, cfg) + PADDLE_H / 2;
        if (Math.abs(reached - best.center) <= radius) bossPlan.center = center;
      }
    }
  }
  return bossPlan;
}

function bossThreatBall() { return planBossDefence().ball; }

function predictBossBallCenter(target) {
  const plan = planBossDefence();
  if (plan.ball === target && plan.forecast) return plan.forecast.center;
  return target && target.vx > 0 ? predictWithSimpleBounds(target.x, target.y, target.vx, target.vy, right.x) :
    visiblePlayfieldCenterY();
}

function chooseBossProfile(target) {
  const plan = planBossDefence(), arrival = plan.forecast;
  if (!arrival || plan.ball !== target) return bossAdaptiveProfile;
  const cfg = getCpuConfig(), bounds = visiblePlayfieldBounds();
  const targetY = clamp(plan.center - PADDLE_H / 2, bounds.top, bounds.bottom - PADDLE_H);
  bossContactPaddle.x = right.x;
  let best = bossAdaptiveProfile, bestScore = Infinity;
  for (const candidate of BOSS_ADAPTIVE_PROFILES) {
    bossContactPaddle.y = bossReachPosition(targetY, arrival.frames, cfg);
    const relative = paddleRelativeContact(bossContactPaddle, arrival.center);
    const lead = paddleProfileOffset(candidate, relative) / Math.max(1, arrival.vx);
    const contact = clamp(arrival.center - arrival.vy * lead, bounds.top + BALL_HALF, bounds.bottom - BALL_HALF);
    bossContactPaddle.y = bossReachPosition(targetY, Math.max(0, arrival.frames - lead), cfg);
    const margin = PADDLE_H / 2 + BALL_HALF - Math.abs(contact - bossContactPaddle.y - PADDLE_H / 2);
    // Estimate coverage at arrival, but judge the shot from the observed paddle
    // position. Assuming perfect future contact made this short fight too lethal.
    const angle = calculatePaddleBounceAngle(candidate, right, -1, contact, arrival.vy, false, false);
    const speed = Math.max(1, bossBallSpeed(target) / (target.rush ? 1.3 : 1));
    const landing = cpuShotHeight(contact, angle, right.x - left.x);
    const flight = (right.x - left.x) / Math.max(1, Math.cos(angle) * speed);
    const protectedPlayer = royalGuards.left > arrival.frames + flight;
    // Keep the original open-side aim. Rebound and obstacle value only separate
    // similar safe shapes; the boss can still misjudge its eventual contact.
    const offence = Math.abs(landing - left.y - PADDLE_H / 2) / H * (protectedPlayer ? .1 : .45) -
      cpuShotHazardRisk(contact, angle, speed) * .12;
    const score = Math.max(0, 12 - margin) * 2 + Math.abs(angle - bossDesiredReturnAngle(contact)) - offence * .1 -
      (candidate === bossAdaptiveProfile ? .025 : 0);
    if (score < bestScore) { bestScore = score; best = candidate; }
  }
  return best;
}

function updateBossCPU() {
  if (waitingForServe || gameOver || bossIntroActive) return;
  const cfg = getCpuConfig(), bounds = visiblePlayfieldBounds(), plan = planBossDefence();
  selectBossAdaptiveProfile(plan.ball);
  const targetY = clamp(plan.center - PADDLE_H / 2, bounds.top, bounds.bottom - PADDLE_H);
  const delta = targetY - right.y;
  if (Math.abs(delta) > cfg.deadZone) right.y += clamp(delta * cfg.reaction, -cfg.maxMove, cfg.maxMove);
  right.y = clamp(right.y, bounds.top, bounds.bottom - PADDLE_H);
}
