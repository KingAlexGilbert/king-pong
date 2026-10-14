import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../game/four-core.js', import.meta.url), 'utf8'), context);
const K = vm.runInContext('KingPongFour', context);
const plain = value => JSON.parse(JSON.stringify(value));
const fresh = (options = {}) => { const s = K.create({bots: [false, false, false, false], ...options}, 143); s.countdown = 0; return s; };

test('four-player transforms put every own paddle on the left and invert every point/input', () => {
  for (let side = 0; side < 4; side++) {
    const r = K.paddleRect(side, 120), point = K.viewPoint(side, r.x + r.w / 2, r.y + r.h / 2);
    assert.equal(point[0], 21);
    for (const [x, y] of [[0, 0], [480, 480], [123.25, 386.5]])
      assert.deepEqual(plain(K.worldPoint(side, ...K.viewPoint(side, x, y))), [x, y]);
    const p = {alive: true, pos: 200}; K.movePaddle(p, K.viewInput(side, -1, null));
    const before = K.paddleRect(side, 200), after = K.paddleRect(side, p.pos);
    assert.ok(K.viewPoint(side, after.x + after.w / 2, after.y + after.h / 2)[1] <
      K.viewPoint(side, before.x + before.w / 2, before.y + before.h / 2)[1]);
    assert.deepEqual(plain(K.viewInput(side, .5, 83)), side === 1 || side === 2 ? {axis: -.5, target: 333} : {axis: .5, target: 83});
  }
});

test('all four paddles reflect maximum-speed balls with no tunneling', () => {
  for (let side = 0; side < 4; side++) {
    const s = fresh();
    const b = s.balls[0];
    Object.assign(b, {x: side === 0 ? 35 : side === 1 ? 445 : 240,
      y: side === 2 ? 35 : side === 3 ? 445 : 240,
      vx: side === 0 ? -13 : side === 1 ? 13 : 0, vy: side === 2 ? -13 : side === 3 ? 13 : 0});
    K.step(s);
    assert.equal(b.owner, side);
    assert.ok(side === 0 ? b.vx > 0 : side === 1 ? b.vx < 0 : side === 2 ? b.vy > 0 : b.vy < 0);
    assert.equal(s.paddles[side].lives, 3);
  }
  const hit = K.sweep(140, 150, 200, 0, {x: 160, y: 140, w: 18, h: 18});
  assert.ok(hit && hit.t < .1 && hit.nx === -1);
});

test('symmetric obstacles have identical geometry under all four rotations', () => {
  const original = plain(K.obstacleRects()).map(r => [r.x + r.w / 2, r.y + r.h / 2].join(',')).sort();
  for (let side = 0; side < 4; side++) assert.deepEqual(plain(K.obstacleRects().map(r =>
    K.viewPoint(side, r.x + r.w / 2, r.y + r.h / 2).join(',')).sort()), original);
});

test('exact diagonal corner hits reflect both axes fairly at every arena corner', () => {
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const s = fresh(), b = s.balls[0], epoch = s.epoch;
    const x = sx < 0 ? 40 : 440, y = sy < 0 ? 40 : 440;
    const rect = {x: sx < 0 ? 0 : 452, y: sy < 0 ? 0 : 452, w: 28, h: 28};
    const hit = K.sweep(x, y, sx * 13, sy * 13, rect);
    assert.ok(hit && hit.nx === -sx && hit.ny === -sy);
    Object.assign(b, {x, y, vx: sx * 13, vy: sy * 13});
    for (let tick = 0; tick < 5; tick++) K.step(s);
    assert.ok(b.vx * sx < 0 && b.vy * sy < 0, 'both components point away from the corner');
    assert.equal(s.epoch, epoch);
    assert.deepEqual(plain(s.paddles.map(p => p.lives)), [3, 3, 3, 3]);
    // A near miss of the corner still hits a single face, without sticky edges.
    const edge = K.sweep(x, y - sy, sx * 13, sy * 13, rect);
    assert.ok(edge && edge.nx === 0 && edge.ny === -sy);
  }
});

test('FFA deducts a single life per rally and turns eliminated goals into walls', () => {
  const s = fresh();
  s.paddles[0].lives = 1;
  Object.assign(s.balls[0], {x: -7, y: 50, vx: -12, vy: 0});
  s.balls.push({...s.balls[0], id: 1, split: true});
  K.step(s);
  assert.equal(s.paddles[0].lives, 0); assert.equal(s.paddles[0].alive, false);
  assert.equal(s.balls.length, 1); assert.equal(s.countdown, 90);
  s.countdown = 0; Object.assign(s.balls[0], {x: 6, y: 50, vx: -12, vy: 0});
  K.step(s); assert.ok(s.balls[0].vx > 0);
  s.paddles[1].alive = false; s.paddles[1].lives = 0;
  s.paddles[2].lives = 1;
  Object.assign(s.balls[0], {x: 50, y: -7, vx: 0, vy: -12}); K.step(s);
  assert.equal(s.winner, 3); assert.equal(s.balls.length, 0);
});

test('2v2 awards the opposing team for every conceded goal, including own goals', () => {
  for (let side = 0; side < 4; side++) {
    const s = fresh({variant: 'teams', goal: 5});
    s.scores[1 - K.TEAM[side]] = 4;
    Object.assign(s.balls[0], {owner: side, x: side === 0 ? -9 : side === 1 ? 489 : 50,
      y: side === 2 ? -9 : side === 3 ? 489 : 50, vx: 0, vy: 0});
    K.step(s); assert.equal(s.winner, 1 - K.TEAM[side]);
    assert.equal(s.scores[s.winner], 5); assert.ok(s.paddles.every(p => p.alive));
  }
});

test('powerups retain split lifetime, 30% rush and 600 active-tick guard on each side', () => {
  for (let side = 0; side < 4; side++) {
    const s = fresh(), b = s.balls[0]; b.owner = side;
    const speed = Math.hypot(b.vx, b.vy);
    assert.equal(K.award(s, 'rush', b), true); assert.ok(Math.abs(Math.hypot(b.vx, b.vy) - speed * 1.3) < 1e-10);
    K.award(s, 'rush', b); assert.ok(Math.abs(Math.hypot(b.vx, b.vy) - speed * 1.3) < 1e-10);
    K.award(s, 'guard', b); assert.equal(s.paddles[side].guard, 600);
    K.pause(s); for (let i = 0; i < 600; i++) K.step(s); assert.equal(s.paddles[side].guard, 600);
    K.resume(s); for (let i = 0; i < 180; i++) K.step(s); assert.equal(s.paddles[side].guard, 600);
    K.award(s, 'split', b); assert.equal(s.balls.length, 2);
    assert.ok(Math.abs(Math.hypot(s.balls[1].vx, s.balls[1].vy) - Math.hypot(b.vx, b.vy) * .7) < 1e-10);
    assert.equal(K.award(s, 'split', b), false);
    const split = s.balls[1]; Object.assign(split, {x: 35, y: 240, vx: -10, vy: 0});
    K.step(s); assert.equal(s.balls.length, 1); assert.equal(s.paddles[0].lives, 3);
  }
});

test('authoritative movement is bounded per physics tick for keys, touch, forged targets and bots', () => {
  const s = fresh();
  for (let i = 0; i < 1000; i++) {
    const old = s.paddles.map(p => p.pos);
    K.step(s, [{axis: 1, target: 416}, {axis: -1, target: 0}, {axis: Infinity, target: null}, {axis: 0, target: -1}]);
    s.paddles.forEach((p, j) => assert.ok(Math.abs(p.pos - old[j]) <= 6 && p.pos >= 0 && p.pos <= 416));
  }
  assert.equal(s.paddles[2].pos, 208); assert.equal(s.paddles[3].pos, 208);
});

test('seeded bots and simulation are deterministic; complete full FFA and 2v2 matches', () => {
  for (const variant of ['ffa', 'teams']) {
    const options = {variant, bots: [true, true, true, true], goal: 5};
    const a = K.create(options, 982), b = K.create(options, 982);
    for (let i = 0; i < 60000 && a.winner < 0; i++) {
      const old = a.paddles.map(p => p.pos); K.step(a); K.step(b);
      a.paddles.forEach((p, j) => assert.ok(Math.abs(p.pos - old[j]) <= 4.500001));
      assert.equal(K.validState(K.pack(a)), true);
    }
    assert.ok(a.winner >= 0, variant + ' reaches a winner');
    assert.deepEqual(plain(K.pack(a)), plain(K.pack(b)));
  }
});

test('snapshot validator rejects malformed fields; a full state restores all effects and clears', () => {
  const s = fresh(), original = plain(K.pack(s));
  assert.equal(K.validState(original), true);
  for (const [index, value] of [[0, -1], [3, 2], [4, 181], [5, 4], [7, []], [8, [[0, NaN]]], [9, {}], [11, [[999, 'evil', 0, 0]]]]) {
    const a = structuredClone(original); a[index] = value; assert.equal(K.validState(a), false, String(index));
  }
  assert.deepEqual(plain(K.pack(K.unpack(original, s.config))), original);
  const next = K.unpack(original, s.config); next.epoch++;
  assert.equal(K.interpolate(s, next, .5), next, 'new rallies snap, without cross-court trails');
});
