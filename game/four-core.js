// A separate deterministic 60 Hz simulation. It never reads the DOM, a clock,
// network state or the classic engine. Positions are always in host coordinates.
const KingPongFour = (() => {
  'use strict';
  const SIZE = 480, PADDLE = 64, THICK = 10, INSET = 16, BALL = 8, SPEED = 6;
  const NORMAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const TEAM = [0, 0, 1, 1]; // Opposite walls on each team; equal geometry.
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const integer = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high;
  const number = (n, low, high) => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high;
  const bool = n => typeof n === 'boolean';
  function validConfig(c) {
    return !!c && ['ffa', 'teams'].includes(c.variant) && [3, 5, 10].includes(c.lives) &&
      [5, 10, 20].includes(c.goal) && ['easy', 'normal', 'hard'].includes(c.difficulty) &&
      bool(c.powerups) && bool(c.hiddenWall) && Array.isArray(c.bots) && c.bots.length === 4 && c.bots.every(bool);
  }
  function config(input = {}) {
    const c = {variant: 'ffa', lives: 3, goal: 10, difficulty: 'normal', powerups: true,
      hiddenWall: false, bots: [false, true, true, true], ...input};
    if (!validConfig(c)) throw new Error('Invalid four-player configuration');
    return {...c, bots: c.bots.slice()};
  }
  function random(s) {
    let x = s.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    s.seed = x >>> 0;
    return s.seed / 4294967296;
  }
  function obstacleRects() {
    return [[144, 144], [318, 144], [144, 318], [318, 318]]
      .map(([x, y]) => ({x, y, w: 18, h: 18})).concat(
        [[0, 0], [452, 0], [0, 452], [452, 452]].map(([x, y]) => ({x, y, w: 28, h: 28})));
  }
  function paddleRect(side, pos) {
    return side < 2 ? {x: side === 0 ? INSET : SIZE - INSET - THICK, y: pos, w: THICK, h: PADDLE} :
      {x: pos, y: side === 2 ? INSET : SIZE - INSET - THICK, w: PADDLE, h: THICK};
  }
  // World -> screen; quarter turns keep the chosen side on the screen's left.
  function viewPoint(side, x, y) {
    return side === 1 ? [SIZE - x, SIZE - y] : side === 2 ? [y, SIZE - x] :
      side === 3 ? [SIZE - y, x] : [x, y];
  }
  function worldPoint(side, x, y) {
    return side === 1 ? [SIZE - x, SIZE - y] : side === 2 ? [SIZE - y, x] :
      side === 3 ? [y, SIZE - x] : [x, y];
  }
  function viewInput(side, axis, target) {
    const reversed = side === 1 || side === 2;
    return {axis: reversed ? -axis : axis, target: target === null ? null :
      clamp(reversed ? SIZE - PADDLE - target : target, 0, SIZE - PADDLE)};
  }
  function create(input, seed = 1) {
    const c = config(input);
    const s = {config: c, seed: (seed >>> 0) || 1, tick: 0, activeTick: 0, epoch: 0,
      paused: false, countdown: 180, winner: -1, scores: [0, 0], rally: 0,
      paddles: Array.from({length: 4}, (_, side) => ({side, pos: (SIZE - PADDLE) / 2,
        lives: c.lives, guard: 0, alive: true, target: SIZE / 2, thinkAt: 0})),
      balls: [], pickup: null, spawnAt: 420, eventSeq: 0, events: []};
    serve(s);
    return s;
  }
  function emit(s, type, side = -1) {
    s.events.push([++s.eventSeq, type, side, s.tick]);
    if (s.events.length > 4) s.events.shift();
  }
  function serve(s) {
    s.epoch++;
    s.rally++;
    const available = s.paddles.filter(p => p.alive).map(p => p.side);
    const target = available[(s.rally - 1) % available.length];
    const normal = NORMAL[target];
    const offset = (random(s) - .5) * 1.1;
    let vx = -normal[0], vy = -normal[1];
    if (target < 2) vy = offset; else vx = offset;
    const scale = SPEED / Math.hypot(vx, vy);
    s.balls = [{id: 0, x: SIZE / 2, y: SIZE / 2, vx: vx * scale, vy: vy * scale,
      owner: -1, split: false, rush: false, speed: SPEED}];
    s.pickup = null;
    s.spawnAt = s.activeTick + 420;
    for (const p of s.paddles) p.guard = 0;
    emit(s, 'serve');
  }
  function movePaddle(p, input, speed = SPEED) {
    if (!p.alive || !input) return;
    if (input.target !== null && input.target !== undefined) {
      p.pos += clamp(input.target - p.pos, -speed, speed);
    } else p.pos += clamp(input.axis || 0, -1, 1) * speed;
    p.pos = clamp(p.pos, 0, SIZE - PADDLE);
  }
  function validInput(input) {
    return !!input && number(input.axis, -1, 1) && (input.target === null || number(input.target, 0, SIZE - PADDLE));
  }
  function botInput(s, p) {
    const difficulty = s.config.difficulty;
    const delay = difficulty === 'easy' ? 30 : difficulty === 'hard' ? 12 : 20;
    if (s.activeTick >= p.thinkAt) {
      p.thinkAt = s.activeTick + delay;
      // React to visible balls at a bounded cadence. No future collision or RNG access.
      const normal = NORMAL[p.side];
      const incoming = s.balls.filter(b => b.vx * normal[0] + b.vy * normal[1] < 0);
      const b = incoming.sort((a, b) => distanceToSide(a, p.side) - distanceToSide(b, p.side))[0];
      const error = (random(s) - .5) * (difficulty === 'easy' ? 70 : difficulty === 'hard' ? 20 : 40);
      p.target = b ? (p.side < 2 ? b.y : b.x) - PADDLE / 2 + error : (SIZE - PADDLE) / 2;
    }
    return {axis: 0, target: clamp(p.target, 0, SIZE - PADDLE)};
  }
  function distanceToSide(b, side) { return side === 0 ? b.x : side === 1 ? SIZE - b.x : side === 2 ? b.y : SIZE - b.y; }
  // Swept point against a rectangle expanded by the ball radius (continuous collision).
  function sweep(x, y, dx, dy, r) {
    const half = BALL / 2;
    let enter = -Infinity, exit = Infinity, nx = 0, ny = 0;
    for (const [p, d, min, max, ax, ay] of [
      [x, dx, r.x - half, r.x + r.w + half, 1, 0],
      [y, dy, r.y - half, r.y + r.h + half, 0, 1]]) {
      if (Math.abs(d) < 1e-9) { if (p < min || p > max) return null; continue; }
      const a = (min - p) / d, b = (max - p) / d;
      const near = Math.min(a, b), far = Math.max(a, b);
      const sign = d > 0 ? -1 : 1;
      if (near > enter + 1e-8) { enter = near; nx = ax * sign; ny = ay * sign; }
      else if (Math.abs(near - enter) <= 1e-8) {
        // An exact corner hits both faces. Reflect both axes so quarter-turns
        // cannot change which adjacent goal the corner protects.
        enter = Math.max(enter, near); nx += ax * sign; ny += ay * sign;
      }
      exit = Math.min(exit, far);
    }
    return enter >= -1e-8 && enter <= 1 && enter <= exit && exit >= 0 ? {t: Math.max(0, enter), nx, ny} : null;
  }
  function boundary(side) {
    return side === 0 ? {x: -16, y: -20, w: 16, h: SIZE + 40} :
      side === 1 ? {x: SIZE, y: -20, w: 16, h: SIZE + 40} :
      side === 2 ? {x: -20, y: -16, w: SIZE + 40, h: 16} : {x: -20, y: SIZE, w: SIZE + 40, h: 16};
  }
  function advanceBall(s, b) {
    let remaining = 1;
    for (let iterations = 0; remaining > 1e-6 && iterations < 8; iterations++) {
      let nearest = null;
      const inspect = (rect, kind, side = -1) => {
        const hit = sweep(b.x, b.y, b.vx * remaining, b.vy * remaining, rect);
        if (hit && (!nearest || hit.t < nearest.t)) nearest = {...hit, kind, side};
      };
      for (const p of s.paddles) {
        if (!p.alive || p.guard > 0) inspect(boundary(p.side), 'wall', p.side);
        if (p.alive && b.vx * NORMAL[p.side][0] + b.vy * NORMAL[p.side][1] < 0)
          inspect(paddleRect(p.side, p.pos), 'paddle', p.side);
      }
      for (const rect of obstacleRects()) inspect(rect, 'obstacle');
      if (!nearest) { b.x += b.vx * remaining; b.y += b.vy * remaining; break; }
      b.x += b.vx * remaining * nearest.t;
      b.y += b.vy * remaining * nearest.t;
      remaining *= 1 - nearest.t;
      if (nearest.kind === 'paddle') {
        if (b.split) { emit(s, 'hit', nearest.side); return false; }
        const p = s.paddles[nearest.side], n = NORMAL[nearest.side];
        const offset = clamp(((nearest.side < 2 ? b.y : b.x) - p.pos - PADDLE / 2) / (PADDLE / 2), -.9, .9);
        b.speed = Math.min(10, b.speed + .12);
        b.rush = false;
        const tangent = offset * .78;
        b.vx = (nearest.side < 2 ? n[0] * Math.sqrt(1 - tangent * tangent) : tangent) * b.speed;
        b.vy = (nearest.side < 2 ? tangent : n[1] * Math.sqrt(1 - tangent * tangent)) * b.speed;
        b.owner = nearest.side;
      } else {
        if (nearest.nx) b.vx *= -1;
        if (nearest.ny) b.vy *= -1;
      }
      b.x += nearest.nx * .001; b.y += nearest.ny * .001;
      emit(s, nearest.kind === 'wall' && s.paddles[nearest.side]?.guard ? 'guard' : 'hit', nearest.side);
    }
    return true;
  }
  function goal(s, side) {
    const p = s.paddles[side];
    if (!p.alive) return;
    if (s.config.variant === 'ffa') {
      p.lives = Math.max(0, p.lives - 1);
      p.alive = p.lives > 0;
      const remaining = s.paddles.filter(p => p.alive);
      if (remaining.length === 1) s.winner = remaining[0].side;
    } else {
      const team = 1 - TEAM[side];
      if (++s.scores[team] >= s.config.goal) s.winner = team;
    }
    emit(s, 'goal', side);
    if (s.winner >= 0) { s.balls = []; s.pickup = null; s.epoch++; emit(s, 'win', s.winner); }
    else { serve(s); s.countdown = 90; }
  }
  function award(s, type, b) {
    if (!b || !integer(b.owner, 0, 3) || !s.paddles[b.owner].alive) return false;
    if (type === 'guard') s.paddles[b.owner].guard = 600;
    else if (type === 'rush') {
      if (!b.rush) { b.rush = true; b.vx *= 1.3; b.vy *= 1.3; }
    } else if (type === 'split') {
      if (s.balls.some(ball => ball.split)) return false;
      const angle = .38;
      s.balls.push({...b, id: 1, split: true, rush: false,
        vx: (b.vx * Math.cos(angle) - b.vy * Math.sin(angle)) * .7,
        vy: (b.vx * Math.sin(angle) + b.vy * Math.cos(angle)) * .7});
    } else return false;
    emit(s, 'pickup', b.owner);
    return true;
  }
  function step(s, inputs = []) {
    s.tick++;
    if (s.paused || s.winner >= 0) return;
    if (s.countdown > 0) { s.countdown--; return; }
    s.activeTick++;
    for (const p of s.paddles) {
      if (p.guard > 0) p.guard--;
      const input = s.config.bots[p.side] ? botInput(s, p) : inputs[p.side];
      if (validInput(input)) movePaddle(p, input, s.config.bots[p.side] ? SPEED *
        (s.config.difficulty === 'easy' ? .55 : s.config.difficulty === 'hard' ? .9 : .75) : SPEED);
    }
    for (const b of [...s.balls]) {
      if (!advanceBall(s, b)) { s.balls = s.balls.filter(ball => ball !== b); continue; }
      const side = b.x < -BALL ? 0 : b.x > SIZE + BALL ? 1 : b.y < -BALL ? 2 : b.y > SIZE + BALL ? 3 : -1;
      if (side >= 0) { goal(s, side); return; } // One loss/point per rally, including Split.
      if (s.pickup && Math.hypot(b.x - s.pickup.x, b.y - s.pickup.y) < 22 && award(s, s.pickup.type, b)) s.pickup = null;
    }
    if (s.pickup && --s.pickup.ttl <= 0) s.pickup = null;
    if (s.config.powerups && !s.pickup && s.activeTick >= s.spawnAt) {
      // Eight symmetric sites, clear of the bumpers and goals.
      const sites = [[240, 110], [240, 370], [110, 240], [370, 240], [200, 240], [280, 240], [240, 200], [240, 280]];
      const [x, y] = sites[Math.floor(random(s) * sites.length)];
      s.pickup = {x, y, type: ['split', 'rush', 'guard'][Math.floor(random(s) * 3)], ttl: 600, born: s.activeTick};
      s.spawnAt = s.activeTick + 720;
      emit(s, 'spawn');
    }
  }
  function pause(s) { if (s.winner < 0) { s.paused = true; s.countdown = 0; } }
  function resume(s) { if (s.paused && s.winner < 0) { s.paused = false; s.countdown = 180; } }
  function pack(s) {
    const q = n => Math.round(n * 1000) / 1000;
    return [s.tick, s.activeTick, s.epoch, s.paused ? 1 : 0, s.countdown, s.winner, s.scores.slice(),
      s.paddles.map(p => [q(p.pos), p.lives, p.guard, p.alive ? 1 : 0]),
      s.balls.map(b => [b.id, q(b.x), q(b.y), q(b.vx), q(b.vy), b.owner, b.split ? 1 : 0, b.rush ? 1 : 0, q(b.speed)]),
      s.pickup ? [s.pickup.x, s.pickup.y, s.pickup.type, s.pickup.ttl, s.pickup.born] : null,
      s.eventSeq, s.events.map(e => e.slice())];
  }
  function validState(a) {
    return Array.isArray(a) && a.length === 12 && a.slice(0, 3).every(n => integer(n, 0, 1e9)) &&
      integer(a[3], 0, 1) && integer(a[4], 0, 180) && integer(a[5], -1, 3) &&
      Array.isArray(a[6]) && a[6].length === 2 && a[6].every(n => integer(n, 0, 20)) &&
      Array.isArray(a[7]) && a[7].length === 4 && a[7].every(p => Array.isArray(p) && p.length === 4 &&
        number(p[0], 0, SIZE - PADDLE) && integer(p[1], 0, 10) && integer(p[2], 0, 600) && integer(p[3], 0, 1)) &&
      Array.isArray(a[8]) && a[8].length <= 2 && new Set(a[8].map(b => b?.[0])).size === a[8].length && a[8].every(b =>
        Array.isArray(b) && b.length === 9 && integer(b[0], 0, 1) && b.slice(1, 3).every(n => number(n, -24, SIZE + 24)) &&
        b.slice(3, 5).every(n => number(n, -14, 14)) && integer(b[5], -1, 3) && integer(b[6], 0, 1) && integer(b[7], 0, 1) && number(b[8], 0, 14)) &&
      (a[9] === null || Array.isArray(a[9]) && a[9].length === 5 && a[9].slice(0, 2).every(n => number(n, 40, SIZE - 40)) &&
        ['split', 'rush', 'guard'].includes(a[9][2]) && integer(a[9][3], 0, 600) && integer(a[9][4], 0, a[1])) &&
      integer(a[10], 0, 1e9) && Array.isArray(a[11]) && a[11].length <= 4 && a[11].every(e => Array.isArray(e) && e.length === 4 &&
        integer(e[0], 1, a[10]) && ['serve', 'hit', 'guard', 'goal', 'win', 'pickup', 'spawn'].includes(e[1]) && integer(e[2], -1, 3) && integer(e[3], 0, a[0]));
  }
  function unpack(a, c) {
    if (!validState(a) || !validConfig(c)) return null;
    return {config: c, tick: a[0], activeTick: a[1], epoch: a[2], paused: !!a[3], countdown: a[4], winner: a[5], scores: a[6].slice(),
      paddles: a[7].map((p, side) => ({side, pos: p[0], lives: p[1], guard: p[2], alive: !!p[3]})),
      balls: a[8].map(b => ({id: b[0], x: b[1], y: b[2], vx: b[3], vy: b[4], owner: b[5], split: !!b[6], rush: !!b[7], speed: b[8]})),
      pickup: a[9] ? {x: a[9][0], y: a[9][1], type: a[9][2], ttl: a[9][3], born: a[9][4]} : null,
      eventSeq: a[10], events: a[11].map(e => e.slice())};
  }
  function interpolate(a, b, alpha) {
    if (!a || a.epoch !== b.epoch || a.paused !== b.paused || a.countdown > 0 || b.countdown > 0) return b;
    const t = clamp(alpha, 0, 1), mix = (x, y) => x + (y - x) * t;
    return {...b, paddles: b.paddles.map((p, i) => ({...p, pos: mix(a.paddles[i].pos, p.pos)})),
      balls: b.balls.map(ball => { const prev = a.balls.find(p => p.id === ball.id);
        return prev ? {...ball, x: mix(prev.x, ball.x), y: mix(prev.y, ball.y)} : ball; })};
  }
  return Object.freeze({SIZE, PADDLE, BALL, SPEED, TEAM, clamp, config, validConfig, create, step, pause, resume,
    pack, unpack, validState, validInput, movePaddle, paddleRect, obstacleRects, viewPoint, worldPoint,
    viewInput, interpolate, sweep, award});
})();
