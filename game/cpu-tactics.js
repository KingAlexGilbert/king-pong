// Small contact-position choices layered over the existing tracking error,
// prediction and movement limits. No velocity or collision state is changed.
let cpuTacticPlan = null;
function resetCpuTactics() { cpuTacticPlan = null; }

function cpuTacticalIntelligence(cfg) {
  // Custom intelligence is independent of both arena and paddle speed.
  if (mode === 3) return clamp(customCpuIntel / 100, 0, 1);
  if (mode !== 1) return 0; // The adaptive Wall Boss retains its own decisions.
  return clamp(Math.min(cfg.label / 100, cfg.prediction) * (1 - cfg.error / 150), 0, 1);
}

function cpuDecisionVariation(seed) {
  // Do not consume the physics/aim-error RNG when considering hypothetical shots.
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function cpuInterceptMargin(aim, cfg) {
  if (!Number.isFinite(aim.frames)) return -Infinity;
  return cfg.maxMove * Math.max(0, aim.frames) + PADDLE_H / 2 -
    Math.abs(aim.center - right.y - PADDLE_H / 2);
}

function chooseCpuTacticalThreat(cfg, primary, split, selected) {
  const intel = cpuTacticalIntelligence(cfg);
  const other = selected === primary ? split : primary;
  // Retain the existing earliest-arrival choice and near-tie hysteresis unless
  // one ball is already lost and the other can still realistically be returned.
  // Inexperienced CPUs sometimes keep chasing the lost ball.
  if (intel < 0.35 || !Number.isFinite(other.frames) || other.frames > selected.frames + 45) return selected;
  if (cpuInterceptMargin(selected, cfg) < -PADDLE_H / 2 && cpuInterceptMargin(other, cfg) > 8 &&
      cpuDecisionVariation(royalRallyId + 31) < intel * 0.85) return other;
  return selected;
}

function cpuMatchRisk(intel, arrival) {
  const goal = Math.max(1, currentLevel().goal);
  const deficit = (left.score - right.score) / goal;
  const closeFinish = Math.max(left.score, right.score) >= goal - 1;
  const protection = clamp((royalGuards.right - arrival - 45) / 180, 0, 1);
  return clamp(0.42 + deficit * 0.28 - (closeFinish && Math.abs(deficit) < 0.25 ? 0.16 : 0) +
    protection * intel * 0.16, 0.15, 0.75);
}

function cpuShotHeight(contact, angle, distance) {
  return predictWithSimpleBounds(0, contact - BALL_HALF, Math.cos(angle), Math.sin(angle), distance + BALL_HALF);
}

function cpuShotHazardRisk(contact, angle, speed) {
  let risk = 0;
  for (const hazard of hazards) {
    // Short extrapolation plus uncertainty, not a perfect forecast of moving
    // obstacles or an exhaustive simulation of every possible rebound.
    const centerX = hazard.x + (hazard.type === 'circle' ? 0 : hazard.w / 2);
    const time = Math.min(30, Math.max(0, (right.x - centerX) / Math.max(1, Math.cos(angle) * speed)));
    const x = centerX + (hazard.vx || 0) * time;
    if (x <= left.x || x >= right.x) continue;
    const y = hazard.y + (hazard.type === 'circle' ? 0 : hazard.h / 2) + (hazard.vy || 0) * time;
    const halfWidth = hazard.type === 'circle' ? hazard.r : hazard.w / 2;
    const halfHeight = hazard.type === 'circle' ? hazard.r : hazard.h / 2;
    const margin = halfHeight + BALL_HALF + Math.abs(Math.tan(angle)) * (halfWidth + BALL_HALF) +
      Math.abs(hazard.vy || 0) * time * 0.25;
    if (Math.abs(cpuShotHeight(contact, angle, right.x - x) - y) < margin) risk += 0.5;
  }
  return Math.min(1, risk);
}

function cpuPickupValue(type, aim, cfg, intel, speed, openness, hazardRisk, flight) {
  if (!royalPickup || royalPickup.ttl <= aim.frames + flight) return 0;
  if (type === 'guard') return royalGuards.right > aim.frames + flight + 120 ? 0 : 0.75;
  if (type === 'split') return royalSplitBall ? 0 : Math.max(0, 0.35 + openness * 0.35 - hazardRisk * 0.6);
  if (type === 'rush') {
    // Rush can rebound toward its collector before the next paddle hit ends
    // it. Poor reach and uncertain hazards can make that acceleration risky.
    const defensiveLoad = speed / Math.max(1, cfg.maxMove) / 3;
    return Math.max(0, openness * 0.75 - defensiveLoad * 0.4 - hazardRisk * 0.5 +
      cpuMatchRisk(intel, aim.frames) * 0.15);
  }
  return 0;
}

function evaluateCpuContact(cfg, aim, baseCenter, offset, intel, risk) {
  const bounds = visiblePlayfieldBounds();
  const center = clamp(baseCenter + offset, bounds.top + PADDLE_H / 2, bounds.bottom - PADDLE_H / 2);
  const contact = aim.center;
  const relative = (contact - center) / (PADDLE_H / 2);
  const move = Math.abs(center - right.y - PADDLE_H / 2);
  // New tactics may not rescue an otherwise impossible return or aim off the
  // paddle edge. Existing errors remain in baseCenter, including bad estimates.
  if (offset && (Math.abs(relative) > 0.72 || move > cfg.maxMove * aim.frames ||
      cpuInterceptMargin(aim, cfg) < Math.abs(offset) + cfg.error * 0.25)) return null;
  const profile = activePaddleProfile(right);
  const paddle = {x: right.x, y: center - PADDLE_H / 2};
  const angle = calculatePaddleBounceAngle(profile, paddle, -1, contact, aim.target.vy, true, false);
  const speed = Math.max(1, Math.hypot(aim.target.vx, aim.target.vy) / (aim.target.rush ? 1.3 : 1));
  const distance = right.x - left.x;
  const flight = distance / Math.max(1, Math.cos(angle) * speed);
  const landing = cpuShotHeight(contact, angle, distance);
  const openness = Math.abs(landing - left.y - PADDLE_H / 2) / (bounds.bottom - bounds.top);
  const guarded = royalGuards.left > aim.frames + flight + 30;
  const hazardRisk = intel > 0.25 ? cpuShotHazardRisk(contact, angle, speed) : 0;
  const rebound = contact + Math.tan(angle) * distance < bounds.top + BALL_HALF ||
    contact + Math.tan(angle) * distance > bounds.bottom - BALL_HALF;
  let pickup = 0;
  if (royalPickup && aim.target !== royalSplitBall && royalPickup.x < right.x) {
    const dx = right.x - royalPickup.x;
    const miss = Math.abs(cpuShotHeight(contact, angle, dx) - royalPickup.y) * Math.cos(angle);
    if (miss < ROYAL_COLLECTION_RADIUS) {
      pickup = cpuPickupValue(royalPickup.type, aim, cfg, intel, speed, openness, hazardRisk,
        dx / Math.max(1, Math.cos(angle) * speed)) * (1 - miss / ROYAL_COLLECTION_RADIUS * 0.4);
    }
  }
  const score = openness * (guarded ? 0.12 : 0.35 + risk) + pickup * intel -
    hazardRisk * intel * 0.6 - Math.abs(relative) * (0.2 + (1 - risk) * 0.2) -
    Math.abs(offset) / PADDLE_H * (guarded ? 0.6 : 0.15) +
    (rebound && intel > 0.5 && !guarded ? openness * risk * 0.12 : 0);
  return {offset: center - baseCenter, score, pickup, hazardRisk, guarded, rebound, angle};
}

function planCpuContact(cfg, aim, baseCenter, seed) {
  const intel = cpuTacticalIntelligence(cfg), risk = cpuMatchRisk(intel, aim.frames);
  const basic = evaluateCpuContact(cfg, aim, baseCenter, 0, intel, risk);
  let best = basic;
  const range = mode === 3 ? 3 + intel * 17 : 2 + intel * 9;
  for (const scale of [-1, -0.5, 0.5, 1]) {
    const candidate = evaluateCpuContact(cfg, aim, baseCenter, scale * range, intel, risk);
    if (!candidate) continue;
    // Imperfect assessment is stable throughout an approach; no per-frame dice.
    const error = (cpuDecisionVariation(seed + scale * 7) - 0.5) * (0.12 * (1 - intel) + 0.02);
    if (candidate.score + error > best.score) best = candidate;
  }
  const gain = best.score - basic.score;
  const recognition = Math.min(0.9, intel * intel * Math.max(0, gain) * 4);
  return gain > 0.015 && cpuDecisionVariation(seed) < recognition ? best : basic;
}

function cpuTacticalTarget(cfg, aim, baseCenter) {
  if ((mode !== 1 && mode !== 3) || waitingForServe || aim.target.vx <= 0 || !Number.isFinite(aim.frames)) {
    resetCpuTactics(); return baseCenter;
  }
  if (!cpuTacticPlan || cpuTacticPlan.target !== aim.target || cpuTacticPlan.rally !== royalRallyId) {
    cpuTacticPlan = {target: aim.target, rally: royalRallyId, at: -Infinity, offset: 0,
      seed: royalRallyId * 19 + frame * 0.17 + cpuErrorOffset};
  }
  if (aim.frames > 90 || aim.frames < 3) return baseCenter + cpuTacticPlan.offset;
  if (frame - cpuTacticPlan.at >= 12) {
    cpuTacticPlan.at = frame;
    const choice = planCpuContact(cfg, aim, baseCenter, cpuTacticPlan.seed);
    cpuTacticPlan.offset = choice.offset;
  }
  return baseCenter + cpuTacticPlan.offset;
}
