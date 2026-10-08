// Shared source embedded by tools/sync-gameplay.mjs; native packages remain self-contained.
let visualPrevious = null;
let visualCurrent = null;
let visualEpoch = 0;
const guestSnapshots = [];
let guestRenderTime = null;
let guestRenderAt = null;
let guestSnapshotSequence = -1;
let guestSnapshotTick = -1;
const SNAPSHOT_BUFFER_MS = 100;

// Bound the extra background surface to 32 MiB: large full-canvas copies showed
// frame-time spikes. Keep native resolution and all effects above this limit.
const ROYAL_BACKGROUND_CACHE_MAX_PIXELS = 8 * 1024 * 1024;

function paintRoyalBackground(context, accent) {
  context.save();
  context.fillStyle = '#000';
  context.fillRect(0, 0, W, H);
  context.globalAlpha = 0.12;
  context.strokeStyle = accent;
  context.lineWidth = 1;
  for (let x = 40; x < W; x += 40) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, H);
    context.stroke();
  }
  for (let y = 40; y < H; y += 40) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(W, y);
    context.stroke();
  }
  context.restore();
}

function captureVisualState() {
  return {
    epoch: visualEpoch,
    key: [mode, selectedAbsoluteLevelIndex(), waitingForServe, paused, left.score, right.score, gameOver].join(':'),
    shake: captureVisualShake(),
    left: {
      ...left
    },
    right: {
      ...right
    },
    ball: {
      ...ball
    },
    hazards: hazards.map(h => ({
      ...h
    })),
    bossBalls: bossBalls.map(b => ({
      ...b
    })),
    split: royalSplitBall ? {
      ...royalSplitBall
    } : null,
    pickup: royalPickup ? {
      ...royalPickup
    } : null,
    guards: {
      ...royalGuards
    },
    guardHits: captureGuardHits(),
    launch: {
      remaining: rallyLaunchFramesRemaining,
      x: rallySpawnPulseX,
      y: rallySpawnPulseY
    }
  };
}

function captureVisualShake() {
  // Android keeps its existing two-unit cap, but no longer draws a new random
  // camera position on every display frame. Desktop keeps its display-aware cap.
  const amplitude = typeof currentShakeAmplitude === 'function' ? currentShakeAmplitude() : shakeFrames > 0 ? 2 : 0;
  return {
    x: Math.sin(frame * 12.9898) * amplitude,
    y: Math.sin(frame * 78.233) * amplitude
  };
}

function mixVisualEntity(a, b, alpha) {
  if (!a || !b || a.id !== b.id) return b;
  return {
    ...b,
    x: lerp(a.x, b.x, alpha),
    y: lerp(a.y, b.y, alpha)
  };
}

function interpolateVisualState(a, b, alpha) {
  if (!a || !b || a === b || a.epoch !== b.epoch || a.key !== b.key) return b;
  alpha = clamp(alpha, 0, 1);
  return {
    ...b,
    shake: {
      x: lerp(a.shake.x, b.shake.x, alpha),
      y: lerp(a.shake.y, b.shake.y, alpha)
    },
    left: mixVisualEntity(a.left, b.left, alpha),
    right: mixVisualEntity(a.right, b.right, alpha),
    ball: mixVisualEntity(a.ball, b.ball, alpha),
    split: mixVisualEntity(a.split, b.split, alpha),
    guardHits: interpolateGuardHits(a.guardHits, b.guardHits, alpha),
    launch: a.launch.remaining > 0 && b.launch.remaining > 0 ? {
      ...b.launch,
      remaining: lerp(a.launch.remaining, b.launch.remaining, alpha)
    } : b.launch,
    hazards: b.hazards.map((h, i) => mixVisualEntity(a.hazards[i], h, alpha)),
    bossBalls: b.bossBalls.map(h => mixVisualEntity(a.bossBalls.find(p => p.id === h.id), h, alpha))
  };
}

// Seed only presentation state: a serve/reset must not discard fixed-step time or advance physics.
function seedVisualHistory() {
  visualPrevious = visualCurrent = captureVisualState();
}

function resetVisualHistory() {
  visualEpoch++;
  visualPrevious = visualCurrent = null;
  guestSnapshots.length = 0;
  guestRenderTime = guestRenderAt = null;
}

function queueGuestSnapshot(state) {
  if (!Number.isSafeInteger(state.seq) || state.seq <= guestSnapshotSequence) return;
  const time = Number.isSafeInteger(state.tick) && state.tick >= 0 ? state.tick * FIXED_STEP_MS : state.seq * 50;
  const last = guestSnapshots[guestSnapshots.length - 1];
  if (last && time < last.time) return;
  const view = captureVisualState();
  // The solid paddle shares the ball's host timeline; local input has a separate, faint position marker.
  view.right.y = clamp(finiteNumber(state.rightY, right.y), 0, H - PADDLE_H);
  if (!last) {
    guestRenderTime = time - SNAPSHOT_BUFFER_MS;
    guestRenderAt = null;
  }
  guestSnapshotSequence = state.seq;
  if (guestSnapshots.length && guestSnapshots[guestSnapshots.length - 1].time === time) guestSnapshots.pop();
  guestSnapshots.push({
    time,
    view
  });
  if (guestSnapshots.length > 12) guestSnapshots.shift();
}

function guestVisualState(now) {
  if (!guestSnapshots.length) return captureVisualState();
  const latest = guestSnapshots[guestSnapshots.length - 1];
  if (guestRenderAt !== null) {
    const elapsed = clamp(now - guestRenderAt, 0, 100);
    const drift = latest.time - SNAPSHOT_BUFFER_MS - guestRenderTime;
    // Adjust playout speed gently without ever rewinding or extrapolating physics.
    guestRenderTime = Math.min(latest.time, guestRenderTime + elapsed * clamp(1 + drift / 1000, 0.9, 1.1));
  }
  guestRenderAt = now;
  while (guestSnapshots.length > 2 && guestSnapshots[1].time <= guestRenderTime) guestSnapshots.shift();
  const a = guestSnapshots[0];
  const b = guestSnapshots[1] || a;
  // Keep the established host timeline through scores/serves. Never blend two rallies,
  // or show the new spawn early and then hold it for another entire buffer interval.
  if (a.view.epoch !== b.view.epoch || a.view.key !== b.view.key) return guestRenderTime < b.time ? a.view : b.view;
  return interpolateVisualState(a.view, b.view, b.time > a.time ? (guestRenderTime - a.time) / (b.time - a.time) : 1);
}

function renderFrame(alpha, now) {
  if (!isLanGuestActive() && (!visualCurrent || visualCurrent.epoch !== visualEpoch)) seedVisualHistory();
  const view = isLanGuestActive() ? guestVisualState(now) : interpolateVisualState(visualPrevious, visualCurrent,
  alpha);
  draw(view || captureVisualState());
}

// A single extra ball and a single pickup bound simulation and snapshot costs.
let royalSplitBall = null;
let royalPickup = null;
let royalGuards = {
  left: 0,
  right: 0
};
let royalGuardHits = {left: null, right: null};
let royalGuardHitSequence = 0;
let guestGuardSoundSequence = {left: -1, right: -1};
const ROYAL_GUARD_FLASH_TICKS = 8;

function captureGuardHits() {
  const copy = hit => hit ? {...hit} : null;
  return {left: copy(royalGuardHits.left), right: copy(royalGuardHits.right)};
}

function interpolateGuardHits(a, b, alpha) {
  const mix = side => {
    const before = a?.[side], after = b?.[side];
    if (before?.seq !== after?.seq && alpha < 1) return before;
    return before && after && before.seq === after.seq ?
      {...after, ttl: lerp(before.ttl, after.ttl, alpha)} : after;
  };
  return {left: mix('left'), right: mix('right')};
}

function royalShieldImpact(side) {
  royalGuardHits[side] = {seq: ++royalGuardHitSequence, y: clamp(ball.y + BALL_HALF, 0, H),
    ttl: ROYAL_GUARD_FLASH_TICKS};
  playImpactSound(880, 0.055, 0.045, 'shield');
}
let royalRallyTick = 0;
let royalPickupIndex = 0;
let royalRallyId = 0;
let royalScored = false;
const ROYAL_SPLIT_SPEED_SCALE = 0.7;
let royalCpuTarget = null;
// Reuse the two prediction records; only the existing bounded predictor simulates hazards.
const royalCpuPrimaryAim = {
  target: null,
  center: 0,
  frames: Infinity
};
const royalCpuSplitAim = {
  target: null,
  center: 0,
  frames: Infinity
};

function royalCpuAim(cfg) {
  const primary = royalCpuPrimaryAim;
  primary.target = ball;
  primary.center = predictBallCenterForCPU(cfg, primary);
  if (!royalSplitBall || waitingForServe || (mode !== 1 && mode !== 3)) {
    royalCpuTarget = ball;
    return primary;
  }
  const split = royalCpuSplitAim;
  split.target = royalSplitBall;
  // The legacy hazard predictor uses the active ball's speed scale/Rush flag.
  // Swap only for this synchronous prediction, just as the real duplicate simulation does.
  try {
    ball = split.target;
    split.center = predictBallCenterForCPU(cfg, split);
  } finally {
    ball = primary.target;
  }
  if (primary.target.x > right.x + PADDLE_W) primary.frames = Infinity;
  if (split.target.x > right.x + PADDLE_W) split.frames = Infinity;
  let selected = primary;
  if (Number.isFinite(split.frames)) {
    if (!Number.isFinite(primary.frames)) selected = split;
    else {
      selected = royalCpuTarget === split.target ? split : primary;
      const other = selected === primary ? split : primary;
      // Keep near ties stable, but switch for an earlier threat: 15%, capped at six ticks.
      if (other.frames + Math.min(6, selected.frames * 0.15) < selected.frames) selected = other;
    }
  }
  royalCpuTarget = selected.target;
  return selected;
}

const ROYAL_COLLECTION_RADIUS = 24;
const ROYAL_SPAWN_MARGIN = 32;
const ROYAL_SPAWN_X_MARGIN = 112;
const ROYAL_TYPES = ['split', 'rush', 'guard'];
const ROYAL_COLORS = {
  split: '#bd7aff',
  rush: '#ff604d',
  guard: '#59baff'
};
const ROYAL_PICKUP_SIZE = 24; // Source sprite resolution, shared with the help UI.
const ROYAL_PICKUP_RENDER_SIZE = 30; // Presentation only; collection keeps its 24-unit radius.
const ROYAL_PICKUP_ART_SYMBOLS = '123456789ABCDEF';
// Visual-only 24 x 24 pixel sprites, shared by gameplay and help.
const ROYAL_PICKUP_ART = {
  split: {
    // Approved reference: a large left ball forks into two smaller right balls.
    palette: ['#11001f', '#4a006d', '#250039', '#9000dc', '#f16cff', '#fff7df', '#cf20f1', '#62079c'],
    pixels: [
      '........................',
      '.........111111.........',
      '......115665444411......',
      '.....14422222222441.....',
      '....1542333333332441....',
      '...162233335333335551...',
      '..15423333333333566751..',
      '..14233333333366567451..',
      '..52355553333366574854..',
      '.1425566553336633555241.',
      '.1455667745366333333241.',
      '.1456677745663333333241.',
      '.1456777445663333333241.',
      '.1457774445366333333241.',
      '.1425444453336633555241.',
      '..42355553333366566754..',
      '..14233333333366567451..',
      '..15423333333333574851..',
      '...142233334333335551...',
      '....1542333333332441....',
      '.....14422222222441.....',
      '......114565444411......',
      '.........111111.........',
      '........................',
    ]
  },
  rush: {
    palette: ['#000000', '#440c02', '#915b19', '#d6832b', '#df6f10', '#9b3e0b', '#6a3805', '#f8e48e', '#c83e0a', '#a31704', '#d25415', '#e7bc51', '#4d0001', '#e29f3a', '#592007'],
    pixels: [
      '........................',
      '........................',
      '..........1111..........',
      '.......1234456721.......',
      '......248859AA6B31......',
      '.....2C884AAADDD652.....',
      '....14E5ABAA552F2631....',
      '....7BA99B4C833D7667....',
      '...1B9A636488387F2D61...',
      '...F9DAAF37C78836F33F...',
      '..1BBBE83CCF48BE73E76...',
      '...B4EC8C3CC8CB9EE3F6...',
      '..1AAA9E8359CBA6597D6...',
      '...6A795C36AEEA5A62A7...',
      '...29FABEC35CCE55B291...',
      '...1654EC8C337F2F7A61...',
      '....2BDDA5CE9AD22FB2....',
      '.....35AAAAADC7DA57.....',
      '.....1759DDDDAA957......',
      '.......2659999B62.......',
      '.........1F77F1.........',
      '........................',
      '........................',
      '........................',
    ]
  },
  guard: {
    palette: ['#000000', '#082f4a', '#021543', '#316296', '#5f88b5', '#5ad5f6', '#3caaed', '#0c81c8', '#d4eef8', '#03549f', '#a9bad8', '#033394', '#214d86', '#000054', '#040000'],
    pixels: [
      '........................',
      '........................',
      '..........12231.........',
      '.......1245678421.......',
      '......359968AAAA821.....',
      '.....37997A4B3C228D.....',
      '....15684DD9953D2382....',
      '....27AD9BB99B4B53AA1...',
      '...18A4D99B554574AB82...',
      '...28CA4555BB554DDACA1..',
      '..1486A99B997A45BD2283..',
      '..1AAAAB699978CEBDAE83..',
      '..FA876566997ACCB46783..',
      '..1AA794B7667CE8556A83..',
      '...2AC8AB7768CCBD8ACA1..',
      '...18C484987AC75D6482...',
      '....2876C598C5B2A78AF...',
      '....1A7AA2B97B2CCC83....',
      '.....388CC35B2EC882.....',
      '......1D888C2A8883......',
      '........1DA788D21.......',
      '..........1131..........',
      '........................',
      '........................',
    ]
  }
};
const royalPickupSprites = new Map();
function royalPickupSprite(type) {
  if (royalPickupSprites.has(type)) return royalPickupSprites.get(type);
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = ROYAL_PICKUP_SIZE;
  const c = sprite.getContext('2d');
  const art = ROYAL_PICKUP_ART[type];
  if (art) {
    for (let y = 0; y < ROYAL_PICKUP_SIZE; y++) {
      const row = art.pixels[y];
      for (let x = 0; x < ROYAL_PICKUP_SIZE; x++) {
        const symbol = row[x];
        if (symbol === '.') continue;
        const paletteIndex = ROYAL_PICKUP_ART_SYMBOLS.indexOf(symbol);
        if (paletteIndex < 0) continue;
        c.fillStyle = art.palette[paletteIndex];
        c.fillRect(x, y, 1, 1);
      }
    }
  } else {
    // Defensive fallback for an unknown type; normal gameplay only uses ROYAL_TYPES.
    c.fillStyle = ROYAL_COLORS[type] || '#fff7df';
    c.fillRect(2, 2, ROYAL_PICKUP_SIZE - 4, ROYAL_PICKUP_SIZE - 4);
  }
  // Keep each pickup visually distinct even without its color palette.
  c.fillStyle = '#fff7df';

  if (type === 'rush') {
    c.fillRect(11, 2, 2, 2);
    c.fillRect(8, 4, 2, 1);
  } else if (type === 'guard') {
    c.fillRect(19, 3, 2, 2);
    c.fillRect(20, 6, 1, 2);
  }

  royalPickupSprites.set(type, sprite);
  return sprite;
}

function resetRoyalRally() {
  royalSplitBall = royalPickup = null;
  royalGuardHits = {left: null, right: null};
  royalCpuTarget = null;
  royalGuards = {
    left: 0,
    right: 0
  };
  royalRallyTick = 0;
  royalScored = false;
  royalRallyId++;
  ball.rush = false;
  ball.lastHit = null;
  visualEpoch++;
}

function royalActive() {
  return mode !== 4 && !bossIntroActive && !paused && !waitingForServe && !gameOver && !levelCleared && !
    campaignCleared && !isLanGuestActive();
}

function updateRoyalPowerups() {
  if (!royalActive()) return;
  royalRallyTick++;
  for (const side of ['left', 'right']) {
    royalGuards[side] = Math.max(0, royalGuards[side] - 1);
    if (royalGuardHits[side] && --royalGuardHits[side].ttl <= 0) royalGuardHits[side] = null;
  }
  if (royalPickup && --royalPickup.ttl <= 0) royalPickup = null;
  if (!royalPickup && royalRallyTick % 480 === 180) {
    const spot = findRoyalPickupSpot();
    const type = ROYAL_TYPES[royalPickupIndex++ % ROYAL_TYPES.length];
    if (spot) royalPickup = {
      type,
      ...spot,
      ttl: 480
    };
  }
}

// The host picks from a bounded deterministic sequence, then transmits the actual spot.
// A half-second hazard sweep leaves room around moving geometry as well as static walls.
function royalPickupSpotSafe(x, y) {
  const bounds = visiblePlayfieldBounds(),
    margin = ROYAL_SPAWN_MARGIN;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < ROYAL_SPAWN_X_MARGIN || x > W - ROYAL_SPAWN_X_MARGIN ||
    y < Math.max(0, bounds.top) + margin || y > Math.min(H, bounds.bottom) - margin) return false;
  return hazards.every(h => {
    const travelX = (h.vx || 0) * 30,
      travelY = (h.vy || 0) * 30;
    const radius = h.type === 'circle' ? h.r : 0;
    const x1 = h.x - radius + Math.min(0, travelX),
      y1 = h.y - radius + Math.min(0, travelY);
    const x2 = h.x + (radius || h.w) + Math.max(0, travelX),
      y2 = h.y + (radius || h.h) + Math.max(0, travelY);
    if (h.type === 'circle' && !travelX && !travelY) return Math.hypot(x - h.x, y - h.y) >= h.r + margin;
    return Math.hypot(x - clamp(x, x1, x2), y - clamp(y, y1, y2)) >= margin;
  });
}

function findRoyalPickupSpot(type = ROYAL_TYPES[royalPickupIndex % ROYAL_TYPES.length]) {
  if (isLanGuestActive()) return null;
  let seed = (Math.imul(royalRallyId + 1, 1664525) ^ Math.imul(royalPickupIndex + 1, 1013904223) ^ Math.imul(
    matchArenaId + 1, 2246822519) ^ royalRallyTick) >>> 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const bounds = visiblePlayfieldBounds();
  const top = Math.max(0, bounds.top) + ROYAL_SPAWN_MARGIN,
    bottom = Math.min(H, bounds.bottom) - ROYAL_SPAWN_MARGIN;
  if (bottom <= top) return null;
  const split = type === 'split';
  const minX = split ? Math.max(ROYAL_SPAWN_X_MARGIN, Math.ceil(W * 0.4)) : ROYAL_SPAWN_X_MARGIN;
  const maxX = split ? Math.min(W - ROYAL_SPAWN_X_MARGIN, Math.floor(W * 0.6)) : W - ROYAL_SPAWN_X_MARGIN;
  let firstSpot = null;
  for (let attempt = 0; attempt < 64; attempt++) {
    const x = Math.round(minX + random() * (maxX - minX));
    const y = Math.round(top + random() * (bottom - top));
    if (!firstSpot) firstSpot = {x, y};
    if (royalPickupSpotSafe(x, y)) return {
      x,
      y
    };
  }
  if (split) {
    // A narrow safe gap can evade the random candidates. Find the nearest safe
    // integer position to the first candidate, without ever leaving the center band.
    let nearest = null, distance = Infinity;
    for (let y = Math.ceil(top); y <= Math.floor(bottom); y++) {
      for (let x = minX; x <= maxX; x++) {
        const squared = (x - firstSpot.x) ** 2 + (y - firstSpot.y) ** 2;
        if (squared < distance && royalPickupSpotSafe(x, y)) {
          nearest = {x, y};
          distance = squared;
        }
      }
    }
    return nearest;
  }
  return null; // A crowded arena may safely miss a spawn instead of placing an unreachable orb.
}

function royalBallSpeedScale() {
  return ball.id === 'royal-split' ? ROYAL_SPLIT_SPEED_SCALE : 1;
}

function royalPaddleReturnSpeed(level) {
  if (ball.id === 'royal-split') return Math.min(ballSpeed() + (0.32 + absoluteLevelNumber() * 0.01) *
    ROYAL_SPLIT_SPEED_SCALE, level.maxSpeed * ROYAL_SPLIT_SPEED_SCALE);
  return Math.min(ballSpeed() + 0.32 + absoluteLevelNumber() * 0.01, level.maxSpeed);
}

function awardRoyalPowerup(type, target = ball) {
  if (!royalActive() || !ROYAL_TYPES.includes(type) || !['left', 'right'].includes(target.lastHit)) return false;
  if (type === 'split' && !royalSplitBall) {
    const speed = Math.hypot(target.vx, target.vy);
    const vy = Math.abs(target.vy) < 0.5 ? 1 : -target.vy;
    const factor = speed * ROYAL_SPLIT_SPEED_SCALE / Math.hypot(target.vx, vy);
    royalSplitBall = {
      ...target,
      id: 'royal-split',
      vx: target.vx * factor,
      vy: vy * factor,
      prevX: target.x,
      prevY: target.y,
      trap: null
    };
  }
  if (type === 'rush' && !target.rush) {
    target.rush = true;
    target.vx *= 1.3;
    target.vy *= 1.3;
  }
  if (type === 'guard') royalGuards[target.lastHit] = 600;
  return true;
}

function collectRoyalPickup() {
  if (!royalPickup || !ball.lastHit) return;
  const dx = ball.x - ball.prevX,
    dy = ball.y - ball.prevY;
  const t = clamp(((royalPickup.x - ball.prevX - BALL_HALF) * dx + (royalPickup.y - ball.prevY - BALL_HALF) * dy) / (
    dx * dx + dy * dy || 1), 0, 1);
  if (Math.hypot(ball.prevX + BALL_HALF + dx * t - royalPickup.x, ball.prevY + BALL_HALF + dy * t - royalPickup.y) <=
    ROYAL_COLLECTION_RADIUS) {
    if (awardRoyalPowerup(royalPickup.type)) {
      royalPickup = null;
      playImpactSound(660, 0.04);
    }
  }
}

function collideCastleGuard() {
  const leftWall = 18,
    rightWall = W - 18;
  if (royalGuards.left > 0 && ball.vx < 0 && ball.prevX >= leftWall && ball.x <= leftWall) {
    ball.x = leftWall;
    ball.vx = Math.abs(ball.vx);
    ball.lastHit = 'left';
    royalShieldImpact('left');
  } else if (royalGuards.right > 0 && ball.vx > 0 && ball.prevX + BALL_SIZE <= rightWall && ball.x + BALL_SIZE >=
    rightWall) {
    ball.x = rightWall - BALL_SIZE;
    ball.vx = -Math.abs(ball.vx);
    ball.lastHit = 'right';
    royalShieldImpact('right');
  }
}

function endRoyalRush(target) {
  if (target.rush) {
    target.vx /= 1.3;
    target.vy /= 1.3;
    target.rush = false;
  }
}

function trapState() {
  if (typeof hazardTrapHitCount === 'undefined') return null;
  return {
    hazardTrapHitCount,
    hazardTrapWindowStartFrame,
    lastHazardTrapHitFrame,
    framesSincePaddleContact
  };
}

function restoreTrapState(state) {
  if (typeof hazardTrapHitCount === 'undefined') return;
  ({
    hazardTrapHitCount,
    hazardTrapWindowStartFrame,
    lastHazardTrapHitFrame,
    framesSincePaddleContact
  } = state || {
    hazardTrapHitCount: 0,
    hazardTrapWindowStartFrame: -9999,
    lastHazardTrapHitFrame: -9999,
    framesSincePaddleContact: 0
  });
}

function updateBall() {
  if (!royalActive()) return;
  const primary = ball;
  const extra = royalSplitBall;
  let scored = updateSingleBall();
  const crossingFraction = b => clamp(((b.vx > 0 ? W : -BALL_SIZE) - b.prevX) / (b.x - b.prevX || 1), 0, 1);
  let firstCrossing = scored ? crossingFraction(primary) : Infinity;
  if (extra && royalSplitBall === extra) {
    const primaryTrap = trapState();
    const ramp = rallyLaunchFramesRemaining;
    ball = extra;
    rallyLaunchFramesRemaining = 0;
    restoreTrapState(extra.trap);
    try {
      const extraScore = updateSingleBall();
      if (extraScore && crossingFraction(extra) < firstCrossing) scored = extraScore;
      extra.trap = trapState();
    } finally {
      ball = primary;
      restoreTrapState(primaryTrap);
      rallyLaunchFramesRemaining = ramp;
    }
  }
  if (scored && !royalScored) {
    royalScored = true;
    royalGuardHits = {left: null, right: null};
    royalSplitBall = royalPickup = null;
    royalGuards = {
      left: 0,
      right: 0
    };
    endRoyalRush(ball);
    visualEpoch++;
    if (scored > 0) pointForPlayer();
    else pointForCpu();
  }
}

function packRoyalState() {
  const pack = b => b ? {
    x: b.x,
    y: b.y,
    vx: b.vx,
    vy: b.vy,
    rush: !!b.rush
  } : null;
  return {
    rally: royalRallyId,
    rush: !!ball.rush,
    split: pack(royalSplitBall),
    pickup: royalPickup ? {
      ...royalPickup
    } : null,
    guards: {
      ...royalGuards
    },
    guardHits: captureGuardHits()
  };
}

function validRoyalState(value) {
  const bounded = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  if (!value || !Number.isSafeInteger(value.rally) || value.rally < 0 || typeof value.rush !== 'boolean') return false;
  if (!value.guards || !['left', 'right'].every(k => Number.isInteger(value.guards[k]) && bounded(value.guards[k], 0,
      600))) return false;
  if (value.guardHits !== undefined && (!value.guardHits || !['left', 'right'].every(side => {
    const hit = value.guardHits[side];
    return hit === null || hit && Number.isSafeInteger(hit.seq) && hit.seq >= 0 &&
      bounded(hit.y, 0, H) && Number.isInteger(hit.ttl) && bounded(hit.ttl, 1, ROYAL_GUARD_FLASH_TICKS);
  }))) return false;
  if (value.split !== null && (!value.split || !bounded(value.split.x, -32, W + 32) || !bounded(value.split.y, 0, H) ||
      !bounded(value.split.vx, -32, 32) || !bounded(value.split.vy, -32, 32) || typeof value.split.rush !== 'boolean'))
    return false;
  return value.pickup === null || (value.pickup && ROYAL_TYPES.includes(value.pickup.type) && bounded(value.pickup.x,
    ROYAL_SPAWN_X_MARGIN, W - ROYAL_SPAWN_X_MARGIN) && bounded(value.pickup.y, ROYAL_SPAWN_MARGIN, H -
    ROYAL_SPAWN_MARGIN) && Number.isInteger(value.pickup.ttl) && bounded(value.pickup.ttl, 0, 480));
}

function applyRoyalState(value) {
  const copy = hit => hit ? {seq: hit.seq, y: hit.y, ttl: hit.ttl} : null;
  royalGuardHits = {left: copy(value?.guardHits?.left), right: copy(value?.guardHits?.right)};
  if (!value) {
    royalSplitBall = royalPickup = null;
    royalGuards = {
      left: 0,
      right: 0
    };
    ball.rush = false;
    return;
  }
  if (royalRallyId !== value.rally) {
    royalRallyId = value.rally;
    visualEpoch++;
  }
  ball.rush = value.rush;
  const b = value.split,
    p = value.pickup;
  royalSplitBall = b ? {
    id: 'royal-split',
    x: b.x,
    y: b.y,
    vx: b.vx,
    vy: b.vy,
    rush: b.rush
  } : null;
  royalPickup = p ? {
    type: p.type,
    x: p.x,
    y: p.y,
    ttl: p.ttl
  } : null;
  royalGuards = {
    left: value.guards.left,
    right: value.guards.right
  };
}

// Snap only the final raster rectangle. Simulation and interpolation retain their
// fractional positions; a fixed pixel size stops the ball's edges changing shape.
function drawBallPixels(b) {
  const transform = ctx.getTransform();
  const scaleX = transform.a, scaleY = transform.d;
  const size = Math.max(1, Math.round(BALL_SIZE * Math.min(scaleX, scaleY)));
  ctx.fillRect((Math.round(b.x * scaleX + transform.e) - transform.e) / scaleX,
    (Math.round(b.y * scaleY + transform.f) - transform.f) / scaleY,
    size / scaleX, size / scaleY);
}

function drawRoyalBall(b, translucent = false) {
  if (!b) return;
  ctx.save();
  ctx.globalAlpha = translucent ? 0.52 : 1;
  ctx.shadowBlur = 0;
  if (b.rush) {
    const speed = Math.hypot(b.vx, b.vy) || 1;
    for (let i = 4; i > 0; i--) {
      ctx.fillStyle = i > 2 ? '#ef4f30' : '#ffd469';
      const size = 7 - i;
      drawRect(b.x + BALL_HALF - b.vx / speed * i * 6 - size / 2, b.y + BALL_HALF - b.vy / speed * i * 6 - size / 2,
        size, size);
    }
  }
  ctx.fillStyle = translucent ? '#d6a6ff' : currentCampaign().accent;
  drawBallPixels(b);
  ctx.restore();
}

function drawRoyalEffects(view) {
  ctx.save();
  for (const side of ['left', 'right']) {
    if (view.guards[side] <= 0) continue;
    const x = side === 'left' ? 12 : W - 18;
    ctx.fillStyle = '#59baff';
    ctx.globalAlpha = 0.8;
    for (let y = 0; y < H; y += 16) ctx.fillRect(x, y, 6, 13);
    const hit = view.guardHits?.[side];
    if (hit) {
      if (isLanGuestActive() && hit.seq > guestGuardSoundSequence[side]) {
        guestGuardSoundSequence[side] = hit.seq;
        playImpactSound(880, 0.055, 0.045, 'shield');
      }
      ctx.globalAlpha = clamp(hit.ttl / ROYAL_GUARD_FLASH_TICKS, 0, 1);
      ctx.fillStyle = '#fff7df';
      ctx.fillRect(x - 1, clamp(hit.y - 12, 0, H - 24), 8, 24);
      const sparkX = side === 'left' ? x + 11 : x - 8;
      ctx.fillRect(sparkX, hit.y - 9, 3, 3);
      ctx.fillRect(sparkX + (side === 'left' ? 4 : -4), hit.y - 1, 3, 3);
      ctx.fillRect(sparkX, hit.y + 7, 3, 3);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#59baff';
    drawText(Math.ceil(view.guards[side] / 60) + 's', side === 'left' ? 30 : W - 30, H - 28, 10);
  }
  if (view.pickup) {
    const p = view.pickup;
    ctx.shadowBlur = 0;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(royalPickupSprite(p.type), p.x - ROYAL_PICKUP_RENDER_SIZE / 2,
      p.y - ROYAL_PICKUP_RENDER_SIZE / 2, ROYAL_PICKUP_RENDER_SIZE, ROYAL_PICKUP_RENDER_SIZE);
  }
  ctx.restore();
}

function drawGuestInputPreview(view) {
  if (typeof onlineSession === 'undefined' || !onlineSession || !isLanGuestActive() || Math.abs(right.y - view.right
    .y) < 2) return;
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#b6b0d0';
  // A short pixel cursor at the input's center cannot be mistaken for a collision paddle.
  const center = right.y + PADDLE_H / 2;
  ctx.fillRect(W - 16, center - 1, 7, 2);
  ctx.fillRect(W - 12, center - 4, 2, 8);
  ctx.restore();
}

// Catalogs reference the existing geometry; their IDs stay stable across saves and peers.
const paddleCatalog = [{
  id: 'classic',
  profile: DEFAULT_PADDLE_PROFILE,
  level: 0,
  family: 'player'
}];
for (const [family, profiles] of [
    ['player', PLAYER_PADDLE_PROFILES],
    ['enemy', ENEMY_PADDLE_PROFILES],
    ['boss', BOSS_ADAPTIVE_PROFILES]
  ]) {
  profiles.forEach((profile, index) => {
    if (profile === DEFAULT_PADDLE_PROFILE) return;
    paddleCatalog.push({
      id: family + '-' + index,
      profile,
      level: index,
      family
    });
  });
}
const arenaCatalog = CAMPAIGNS.flatMap((campaign, c) => campaign.levels.map((level, i) => ({
  id: c * 6 + i,
  level,
  campaign
})));
arenaCatalog.push({
  id: TOTAL_LEVELS,
  level: BOSS_LEVEL,
  campaign: BOSS_CAMPAIGN
});
const bossPracticeArena = Object.freeze({
  ...BOSS_LEVEL,
  goal: 6
});
let matchArenaId = 0;
let matchPaddles = {
  left: 'classic',
  right: 'classic'
};
// Multiplayer preferences live only in this session; Campaign keeps its own saved choice.
let multiplayerPaddleChoices = {
  left: null,
  right: null
};
let selectionSequence = 0;
let remoteSelectionSequence = -1;
let selectionReturnFocus = null;
let galleryKind = null;
let gallerySide = 'left';
let galleryResumePlay = false;
let galleryGamepadDirection = 0;
let galleryGamepadAt = 0;

function validPaddleId(id) {
  return typeof id === 'string' && paddleCatalog.some(p => p.id === id);
}

function validArenaId(id) {
  return Number.isInteger(id) && id >= 0 && id < arenaCatalog.length;
}

function paddleUnlocked(entry) {
  if (entry.id === 'classic') return true;
  if (entry.family === 'boss') return isBossUnlocked();
  return entry.family === 'enemy' ? isCustomLevelUnlocked(entry.level) : isCampaignLevelUnlocked(entry.level);
}

function paddleAvailable(entry) {
  return mode === 2 && !document.body.classList.contains('title-active') || paddleUnlocked(entry);
}

function resetMultiplayerPaddleChoices() {
  multiplayerPaddleChoices = {
    left: null,
    right: null
  };
}

function galleryPaddleId(side) {
  if (mode === 2 && !document.body.classList.contains('title-active')) return matchPaddles[lanRole === 'guest' ?
    'right' : side];
  return savedPaddle(side === 'right');
}

function arenaUnlocked(id) {
  return id === TOTAL_LEVELS ? isBossUnlocked() : mode === 2 || isCustomLevelUnlocked(id);
}

function savedPaddle(second = false) {
  const id = saveData && saveData[second ? 'royalPaddle2' : 'royalPaddle'];
  const entry = paddleCatalog.find(p => p.id === id);
  return entry && paddleUnlocked(entry) ? id : 'classic';
}

function selectedPaddleProfile(paddle) {
  const id = mode === 2 ? matchPaddles[paddle === left ? 'left' : 'right'] : savedPaddle();
  return (paddleCatalog.find(p => p.id === id) || paddleCatalog[0]).profile;
}

function initializeMatchSelections() {
  matchPaddles = {
    left: multiplayerPaddleChoices.left || savedPaddle(),
    right: multiplayerPaddleChoices.right || savedPaddle(true)
  };
  if (lanRole === 'guest') matchPaddles.right = multiplayerPaddleChoices.left || savedPaddle();
  const arena = saveData && saveData.royalArena;
  matchArenaId = validArenaId(arena) && arenaUnlocked(arena) ? arena : firstAvailableLevelInCurrentPicker();
  if (!validArenaId(matchArenaId)) matchArenaId = 0;
}

function selectionPayload() {
  return {
    arena: matchArenaId,
    left: matchPaddles.left,
    right: matchPaddles.right
  };
}

function validSelectionState(value) {
  return value && validArenaId(value.arena) && validPaddleId(value.left) && validPaddleId(value.right);
}

// Reject untrusted types before numeric coercion or advancing replay/revision state.
// Older optional snapshot fields remain optional; supplied values must be well formed.
function validLanInput(message) {
  return Number.isSafeInteger(message.seq) && message.seq >= 0 && Number.isFinite(message.axis) &&
    (message.targetY == null || Number.isFinite(message.targetY));
}

function validLanSnapshot(message) {
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <=
    max;
  const optional = (object, key, min, max, integer = false) => object[key] === undefined ||
    number(object[key], min, max) && (!integer || Number.isSafeInteger(object[key]));
  if (!Number.isSafeInteger(message.seq) || message.seq < 0 ||
    !optional(message, 'activeCampaign', 0, CAMPAIGNS.length - 1, true) || !optional(message, 'levelIndex', 0, 5,
    true) ||
    !optional(message, 'leftY', -H, H * 2) || !optional(message, 'rightY', -H, H * 2) ||
    !optional(message, 'inputSeq', -1, Number.MAX_SAFE_INTEGER, true) ||
    !optional(message, 'resumeCountdownMs', 0, 3000)) return false;
  for (const key of ['paused', 'waitingForServe', 'gameOver', 'levelCleared', 'campaignCleared']) {
    if (message[key] !== undefined && typeof message[key] !== 'boolean') return false;
  }
  if (message.endMessage !== undefined && (typeof message.endMessage !== 'string' || message.endMessage.length > 180))
    return false;
  if (message.ball !== undefined) {
    const b = message.ball;
    if (!record(b) || !optional(b, 'x', -32, W + 32) || !optional(b, 'y', -32, H + 32) ||
      !optional(b, 'vx', -32, 32) || !optional(b, 'vy', -32, 32) || !optional(b, 'lastScored', -1, 1, true) ||
      !optional(b, 'rallyLaunchFramesRemaining', 0, RALLY_LAUNCH_RAMP_FRAMES, true) ||
      !optional(b, 'rallyLaunchTargetSpeed', 0, 32) || !optional(b, 'rallySpawnPulseX', 0, W) || !optional(b,
        'rallySpawnPulseY', 0, H)) return false;
  }
  if (message.hazards !== undefined && (!Array.isArray(message.hazards) || message.hazards.length > 128 ||
      !message.hazards.every(h => record(h) && number(h.id, 0, 127) && Number.isInteger(h.id) &&
        optional(h, 'x', -W, W * 2) && optional(h, 'y', -H, H * 2) && optional(h, 'hitFlash', 0, 20, true))))
  return false;
  return true;
}

function applySelectionState(value) {
  if (!value) return;
  matchArenaId = value.arena;
  matchPaddles = {
    left: value.left,
    right: value.right
  };
}

function sendPaddleSelection() {
  if (!isLanGuestActive()) return;
  lanSend({
    v: LAN_SIGNAL_VERSION,
    type: 'selection',
    room: lanRoomCode,
    seq: ++selectionSequence,
    paddle: matchPaddles.right
  });
}

function receivePaddleSelection(message) {
  if (!Number.isSafeInteger(message.seq) || message.seq <= remoteSelectionSequence || !validPaddleId(message.paddle))
    return;
  // Changes are accepted only before a rally. A guest can never choose the host's arena.
  if (!waitingForServe || gameOver) return;
  remoteSelectionSequence = message.seq;
  matchPaddles.right = message.paddle;
  // The scheduled 20 Hz snapshot acknowledges the choice without a reply per request.
}

function resetMatchConnectionState() {
  guestGuardSoundSequence = {left: -1, right: -1};
  resetMatchRuleConnection();
  resetVisualHistory();
  guestSnapshotSequence = -1;
  guestSnapshotTick = -1;
  remoteSelectionSequence = -1;
}

function compatibleGameplay(message) {
  if (message.gameplay === 'royal' && message.matchRules === 'presets') return true;
  closeLanConnection(false);
  paused = true;
  if (typeof onlineGameBlocked !== 'undefined') onlineGameBlocked = true;
  setLanPanelOpen(true);
  setMenusVisible(true);
  setLanStatus('Both players must reload the latest game.');
  return false;
}

function arenaThumbnail(entry) {
  const preview = document.createElement('canvas');
  preview.width = 160;
  preview.height = 120;
  preview.setAttribute('aria-hidden', 'true');
  const c = preview.getContext('2d');
  c.scale(0.25, 0.25);
  c.fillStyle = '#080a12';
  c.fillRect(0, 0, W, H);
  c.strokeStyle = '#343344';
  c.setLineDash([12, 12]);
  c.beginPath();
  c.moveTo(W / 2, 0);
  c.lineTo(W / 2, H);
  c.stroke();
  c.setLineDash([]);
  c.fillStyle = entry.campaign.accent;
  for (const h of entry.level.hazards) {
    c.fillStyle = h.color || entry.campaign.accent;
    if (h.type === 'circle') {
      c.beginPath();
      c.arc(h.x, h.y, h.r, 0, Math.PI * 2);
      c.fill();
    } else c.fillRect(h.x, h.y, h.w, h.h);
  }
  c.fillStyle = '#fff';
  c.fillRect(PADDLE_MARGIN, H / 2 - PADDLE_H / 2, PADDLE_W, PADDLE_H);
  c.fillRect(W - PADDLE_MARGIN - PADDLE_W, H / 2 - PADDLE_H / 2, PADDLE_W, PADDLE_H);
  return preview;
}

function paddleThumbnail(entry) {
  const preview = document.createElement('canvas');
  preview.width = 140;
  preview.height = 90;
  preview.setAttribute('aria-hidden', 'true');
  drawPaddleShape({
    x: 64,
    y: 13
  }, 1, entry.profile, '#ffd469', preview.getContext('2d'));
  return preview;
}

function openRoyalGallery(kind, side = 'left') {
  if (kind === 'arena' && lanRole === 'guest') return;
  if (isLanActive() && !waitingForServe) return;
  galleryKind = kind;
  gallerySide = side;
  galleryResumePlay = !paused && !isLanActive() && !waitingForServe;
  if (galleryResumePlay) paused = true;
  selectionReturnFocus = document.activeElement;
  const panel = byId('royalGallery');
  setLocalizedText(byId('royalGalleryTitle'), kind === 'arena' ? 'Choose your arena' : 'Choose your paddle');
  const list = byId('royalGalleryList');
  list.replaceChildren();
  const entries = kind === 'arena' ? arenaCatalog : paddleCatalog;
  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'royal-choice';
    const unlocked = kind === 'arena' ? arenaUnlocked(entry.id) : paddleAvailable(entry);
    const selected = kind === 'arena' ? entry.id === matchArenaId : entry.id === galleryPaddleId(side);
    button.disabled = !unlocked;
    button.setAttribute('aria-pressed', String(selected));
    button.dataset.choiceId = String(entry.id);
    button.append(kind === 'arena' ? arenaThumbnail(entry) : paddleThumbnail(entry));
    const label = document.createElement('span');
    setLocalizedText(label, kind === 'arena' ? entry.level.name : entry.profile.name);
    button.append(label);
    const badge = document.createElement('small');
    setLocalizedText(badge, !unlocked ? 'Locked' : selected ? 'Selected' : kind === 'arena' && entry.id ===
      TOTAL_LEVELS ? 'Secret Boss arena' : '');
    button.append(badge);
    button.addEventListener('click', () => {
      if (kind === 'arena') {
        if (!arenaUnlocked(entry.id)) return;
        saveData.royalArena = entry.id;
        matchArenaId = entry.id;
        saveProgressNow();
        applyCustomLevelPickerChoice(entry.id);
      } else {
        if (!paddleAvailable(entry)) return;
        if (mode === 2 && !document.body.classList.contains('title-active')) {
          multiplayerPaddleChoices[lanRole === 'guest' ? 'left' : side] = entry.id;
        } else {
          saveData[side === 'right' ? 'royalPaddle2' : 'royalPaddle'] = entry.id;
          saveProgressNow();
        }
        matchPaddles[lanRole === 'guest' ? 'right' : side] = entry.id;
        sendPaddleSelection();
        if (isLanHostActive()) sendLanState(true);
      }
      closeRoyalGallery();
      updateRoyalSelectionLabels();
    });
    list.append(button);
  }
  panel.hidden = false;
  if (typeof syncRoyalUi === 'function') syncRoyalUi();
  (list.querySelector('[aria-pressed="true"]:not(:disabled)') || list.querySelector('button:not(:disabled)') || byId(
    'royalGalleryClose')).focus();
}

function closeRoyalGallery() {
  if (galleryResumePlay && !isLanActive()) paused = false;
  galleryResumePlay = false;
  galleryKind = null;
  if (byId('royalGallery')) byId('royalGallery').hidden = true;
  if (byId('royalGalleryList')) byId('royalGalleryList').replaceChildren();
  if (typeof syncRoyalUi === 'function') syncRoyalUi();
  if (selectionReturnFocus && selectionReturnFocus.isConnected) selectionReturnFocus.focus();
}

function updateRoyalSelectionLabels() {
  if (typeof syncRoyalUi === 'function' && byId('matchSetup')) {
    syncRoyalUi();
    return;
  }
  if (!byId('choosePaddleButton')) return;
  setLocalizedText(byId('choosePaddleButton'), 'Choose your paddle');
  byId('choosePaddle2Button').hidden = mode !== 2 || isLanActive();
  byId('chooseArenaButton').hidden = mode !== 2 && mode !== 3 || lanRole === 'guest';
}

function showLocalPlay() {
  byId('localPlayChoices').hidden = !byId('localPlayChoices').hidden;
  byId('titleLocalButton').setAttribute('aria-expanded', String(!byId('localPlayChoices').hidden));
}

function handleRoyalMenuKey(event) {
  if (galleryKind) {
    const controls = [...byId('royalGallery').querySelectorAll('button:not(:disabled)')];
    const index = controls.indexOf(document.activeElement);
    if (event.key === 'Escape') closeRoyalGallery();
    else if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Tab'].includes(event.key)) {
      const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.shiftKey ? -1 : 1;
      controls[(index + direction + controls.length) % controls.length].focus();
    } else if (event.key === 'Enter' || event.key === ' ') document.activeElement.click();
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }
  if (typeof handleRoyalUiKey === 'function' && handleRoyalUiKey(event)) return true;
  if (event.target.closest && event.target.closest('.title-screen,.royal-selection-row')) {
    if (event.key === 'Enter' || event.key === ' ') {
      if (['BUTTON', 'SUMMARY'].includes(event.target.tagName)) event.target.click();
      event.preventDefault();
      event.stopImmediatePropagation();
      return true;
    }
    if (event.key === 'Tab') {
      event.stopImmediatePropagation();
      return true;
    }
  }
  return false;
}

function pollRoyalGalleryGamepad(now) {
  if (!galleryKind && typeof pollRoyalUiGamepad === 'function') {
    pollRoyalUiGamepad(now);
    return;
  }
  if (!galleryKind || now - galleryGamepadAt < 30) return;
  galleryGamepadAt = now;
  const pad = getConnectedGamepads()[0];
  if (!pad) return;
  const axis = Math.abs(pad.axes[0] || 0) > 0.5 ? pad.axes[0] : pad.axes[1] || 0;
  const direction = pad.buttons[12]?.pressed || pad.buttons[14]?.pressed || axis < -0.5 ? -1 : pad.buttons[13]
    ?.pressed || pad.buttons[15]?.pressed || axis > 0.5 ? 1 : 0;
  const controls = [...byId('royalGallery').querySelectorAll('button:not(:disabled)')];
  if (direction && direction !== galleryGamepadDirection) {
    const i = controls.indexOf(document.activeElement);
    controls[(i + direction + controls.length) % controls.length].focus();
  }
  galleryGamepadDirection = direction;
  if (gamepadButtonJustPressed(pad, GAMEPAD_BUTTONS.A)) document.activeElement.click();
  if (gamepadButtonJustPressed(pad, GAMEPAD_BUTTONS.B)) closeRoyalGallery();
}

function initRoyalMenus() {
  const browserOnline = typeof KingPongRoom !== 'undefined';
  const card = document.querySelector('.title-card');
  setLocalizedText(document.querySelector('.title-subtitle'),
    'Choose your paddle. Choose your arena. Claim royal powerups. Take your crown!');
  const actions = document.querySelector('.title-actions');
  const local = document.createElement('button');
  local.id = 'titleLocalButton';
  local.type = 'button';
  setLocalizedText(local, 'Local Play');
  local.addEventListener('click', showLocalPlay);
  local.setAttribute('aria-expanded', 'false');
  local.setAttribute('aria-controls', 'localPlayChoices');
  actions.append(local, byId('titleBossButton'));
  const localChoices = document.createElement('div');
  localChoices.id = 'localPlayChoices';
  localChoices.hidden = true;
  localChoices.append(titleTwoPlayerButton);
  if (browserOnline) {
    titleLanButton.classList.add('primary-online');
    setLocalizedText(titleLanButton, 'PLAY ONLINE');
    actions.before(titleLanButton);
    const lanNote = document.createElement('span');
    setLocalizedText(lanNote, 'LAN Play is available in the native apps.');
    localChoices.append(lanNote);
  } else {
    localChoices.append(titleLanButton);
    const online = document.createElement('button');
    online.type = 'button';
    online.className = 'primary-online';
    setLocalizedText(online, 'PLAY ONLINE');
    online.addEventListener('click', () => {
      const panel = byId('onlineBrowserNotice');
      panel.hidden = !panel.hidden;
    });
    const notice = document.createElement('div');
    notice.id = 'onlineBrowserNotice';
    notice.hidden = true;
    const text = document.createElement('p');
    setLocalizedText(text, 'Open this address in your browser to play online:');
    const url = document.createElement('input');
    url.readOnly = true;
    url.value = 'https://kingalexgilbert.github.io/king-pong/demo/';
    url.setAttribute('aria-label', 'Online Multiplayer');
    url.addEventListener('click', () => url.select());
    notice.append(text, url);
    actions.before(online, notice);
  }
  actions.after(localChoices);
  const saves = document.createElement('details');
  saves.className = 'compact-saves';
  const summary = document.createElement('summary');
  setLocalizedText(summary, 'Save slots');
  saves.append(summary, activeSaveBadge, byId('saveSlotList'), eraseSaveButton);
  for (const id of ['exportSavesButton', 'importSavesButton'])
    if (byId(id)) saves.append(byId(id));
  card.append(saves);
  const row = document.createElement('div');
  row.className = 'royal-selection-row';
  for (const [id, text, kind, side] of [
      ['choosePaddleButton', 'Choose your paddle', 'paddle', 'left'],
      ['choosePaddle2Button', 'Player 2 paddle', 'paddle', 'right'],
      ['chooseArenaButton', 'Choose your arena', 'arena', 'left']
    ]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    setLocalizedText(b, text);
    b.addEventListener('click', () => openRoyalGallery(kind, side));
    row.append(b);
  }
  customPanel.before(row);
  const titlePaddle = document.createElement('button');
  titlePaddle.type = 'button';
  titlePaddle.className = 'title-paddle';
  setLocalizedText(titlePaddle, 'Choose your paddle');
  titlePaddle.addEventListener('click', () => openRoyalGallery('paddle'));
  actions.after(titlePaddle);
  const gallery = document.createElement('div');
  gallery.id = 'royalGallery';
  gallery.className = 'royal-gallery';
  gallery.hidden = true;
  gallery.setAttribute('role', 'dialog');
  gallery.setAttribute('aria-modal', 'true');
  gallery.setAttribute('aria-labelledby', 'royalGalleryTitle');
  gallery.innerHTML =
    '<div class="royal-gallery-card"><div class="royal-gallery-header"><h2 id="royalGalleryTitle"></h2><button type="button" id="royalGalleryClose"></button></div><div id="royalGalleryList"></div></div>';
  document.body.append(gallery);
  setLocalizedText(byId('royalGalleryClose'), 'Close');
  byId('royalGalleryClose').addEventListener('click', closeRoyalGallery);
  gallery.addEventListener('click', e => {
    if (e.target === gallery) closeRoyalGallery();
  });
  if (browserOnline) {
    const help = document.createElement('p');
    help.className = 'royal-help';
    setLocalizedText(help, 'Solid paddle: host confirmed. Faint cursor: your input.');
    lanPanel.append(help);
  }
  const powers = document.createElement('p');
  powers.className = 'royal-help';
  setLocalizedText(powers,
    'Royal Split: two scoring balls. Crown Rush: 30% faster until paddle hit. Castle Guard: 10-second wall.');
  row.append(powers);
  for (const b of document.querySelectorAll('.title-screen button,.royal-selection-row button')) {
    b.tabIndex = 0;
    b.removeAttribute('data-keyboard-menu-disabled');
  }
  if (typeof preventMenuKeyboardActivation === 'undefined') window.addEventListener('keydown', handleRoyalMenuKey,
  true);
  updateRoyalSelectionLabels();
  initRoyalUi();
}
