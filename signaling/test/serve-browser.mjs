// Real Chromium canvas/production loop, with controlled presentation times and
// production JSON snapshot replay. This is not a physical display or RTC test.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {builds, root} from '../../tests/helpers/game-source.mjs';

const server = createServer(async (req, res) => {
  try {
    const file = new URL('.' + new URL(req.url, 'http://localhost').pathname, root);
    if (!file.href.startsWith(root.href)) throw new Error();
    res.setHeader('Content-Type', file.pathname.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({headless: true});
const errors = [], metrics = [], rates = [60, 120, 144, 165, 240];
const artifacts = process.env.KING_PONG_TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, {recursive: true});
let checks = 0;
const pass = label => { checks++; console.log('PASS: ' + label); };
async function page(platform) {
  const p = await browser.newPage({viewport: {width: 1280, height: 800}});
  p.on('pageerror', error => errors.push(error.message));
  await p.addInitScript(() => {
    window.requestAnimationFrame = () => 1;
    Math.random = () => .5;
    Object.defineProperty(window, 'KING_PONG_SIGNALING_URL', {get: () => '', set: () => {}});
  });
  await p.goto(`http://127.0.0.1:${server.address().port}/${builds[platform]}`);
  return p;
}

async function trace(p, scenario, hz, irregular) {
  return p.evaluate(({scenario, hz, irregular}) => {
    hideTitleScreen(); mode = scenario.startsWith('cpu') ? 1 : 2;
    lanRole = 'none'; lanConnected = false; onlineSession = null;
    activeCampaign = levelIndex = matchArenaId = 0;
    frame = 0; cloneHazards(); resetPaddles(); left.score = right.score = 0;
    paused = waitingForServe = gameOver = levelCleared = campaignCleared = menusVisible = false;
    onlineGameBlocked = false; gameWindowFocused = true; royalRotateDismissed = true;
    saveData.muteAll = true; nextCpuModeServeDirection = 1;
    resetBall(1, true); ball.lastScored = 0; serveOrContinue();
    if (scenario === 'cpu-score' || scenario === 'cpu-repeat') {
      Object.assign(ball, {x: W - 1, y: 10, vx: 4, vy: 0});
    } else if (scenario !== 'cpu-initial' && scenario !== 'local-initial') {
      const vertical = scenario === 'vertical', diagonal = scenario === 'diagonal';
      Object.assign(ball, {x: 160.125, y: 100.375, vx: vertical ? 0 : diagonal ? 3.52 : 4.4,
        vy: vertical ? 4.4 : diagonal ? 2.64 : 0, rush: false});
      if (scenario === 'paddle') Object.assign(ball, {x: left.x + PADDLE_W + .1,
        y: left.y + PADDLE_H / 2 - BALL_HALF, vx: -4.4});
      if (scenario === 'wall') Object.assign(ball, {x: 300, y: .1, vx: 2.64, vy: -3.52});
      beginRallyLaunchRamp();
      if (scenario === 'rush') { ball.lastHit = 'left'; awardRoyalPowerup('rush'); }
    }
    shakeFrames = 0; resetFrameClock(); syncRoyalUi(true);
    const state = () => ({frame, ball: {...ball}, remaining: rallyLaunchFramesRemaining,
      target: rallyLaunchTargetSpeed, left: {...left}, right: {...right}, waiting: waitingForServe,
      key: captureVisualState().key, epoch: visualEpoch});
    const ticks = [state()], views = [];
    const originalUpdate = update, originalDraw = draw;
    let time = 0;
    update = () => {
      if (scenario === 'cpu-repeat' && [18, 36, 54].includes(frame)) {
        Object.assign(ball, {x: W - 1, y: 10, vx: 4, vy: 0});
      }
      originalUpdate(); ticks.push(state());
    };
    draw = view => {
      originalDraw(view);
      const n = Math.min(ticks.length - 1, Math.floor((time + 1e-7) / FIXED_STEP_MS));
      const a = ticks[Math.max(0, n - 1)], b = ticks[n];
      const alpha = Math.max(0, Math.min(1, time / FIXED_STEP_MS - n));
      const boundary = a.key !== b.key || a.epoch !== b.epoch;
      const x = boundary ? b.ball.x : a.ball.x + (b.ball.x - a.ball.x) * alpha;
      const y = boundary ? b.ball.y : a.ball.y + (b.ball.y - a.ball.y) * alpha;
      views.push({time, x: view.ball.x, y: view.ball.y, error: Math.hypot(x - view.ball.x, y - view.ball.y)});
    };
    const cadence = [.72, 1.31, .93, 1.08, 2, .55, 1.12, .87, 1, 1.4, .8];
    try {
      for (let i = 0; time < 1000 - 1e-7; i++) {
        loop(time); time += 1000 / hz * (irregular ? cadence[i % cadence.length] : 1);
      }
      time = 1000; loop(time);
    } finally { update = originalUpdate; draw = originalDraw; }
    return {ticks, views};
  }, {scenario, hz, irregular});
}

async function networkTape(p, online) {
  return p.evaluate(online => {
    hideTitleScreen(); startTwoPlayerMode(true, false);
    lanRole = 'host'; lanConnected = true; lanRoomCode = 'ABCDE';
    const packets = [];
    lanChannel = {readyState: 'open', bufferedAmount: 0, send: s => packets.push({time: frame * FIXED_STEP_MS, s})};
    onlineControlChannel = lanChannel; onlineSession = online ? {close(){}} : null;
    onlineGameBlocked = false; gameWindowFocused = true; saveData.muteAll = true;
    activeCampaign = levelIndex = matchArenaId = 0; cloneHazards(); resetPaddles();
    frame = 0; paused = gameOver = levelCleared = campaignCleared = false;
    left.score = right.score = 0;
    const serve = () => { resetBall(1, true); serveOrContinue();
      Object.assign(ball, {x: 160, y: 100, vx: 4.4, vy: 0}); beginRallyLaunchRamp(); };
    serve(); sendLanState(true);
    for (let tick = 1; tick <= 96; tick++) {
      if ([37, 73].includes(tick)) pointForPlayer();
      if ([38, 74].includes(tick)) serve();
      update();
    }
    return packets;
  }, online);
}

async function replay(p, packets, online, hz, irregular) {
  return p.evaluate(({packets, online, hz, irregular}) => {
    hideTitleScreen(); startTwoPlayerMode(true, false);
    lanRole = 'guest'; lanConnected = true; lanRoomCode = 'ABCDE';
    lanChannel = {readyState: 'open', bufferedAmount: 0, send(){}};
    onlineControlChannel = lanChannel; onlineSession = online ? {close(){}} : null;
    onlineGameBlocked = false; gameWindowFocused = true; saveData.muteAll = true;
    lanLastStateSeq = guestSnapshotSequence = guestSnapshotTick = -1;
    resetVisualHistory(); resetFrameClock();
    const incoming = packets.map((p, i) => ({...p, arrive: p.time + 70 + (irregular ? [12, -8, 18, 0][i % 4] : 0)}))
      .sort((a, b) => a.arrive - b.arrive);
    const originalDraw = draw, views = [];
    let time = 0, index = 0, guestMutations = 0, staleMutations = 0;
    const identity = () => JSON.stringify([ball, rallyLaunchFramesRemaining, rallyLaunchTargetSpeed, left.score, right.score]);
    draw = view => {
      originalDraw(view);
      if (guestSnapshots.length < 2) return;
      const a = guestSnapshots[0], b = guestSnapshots[1];
      const boundary = a.view.key !== b.view.key || a.view.epoch !== b.view.epoch;
      const alpha = Math.max(0, Math.min(1, (guestRenderTime - a.time) / (b.time - a.time || 1)));
      const chosen = guestRenderTime < b.time ? a.view : b.view;
      const x = boundary ? chosen.ball.x : a.view.ball.x + (b.view.ball.x - a.view.ball.x) * alpha;
      const y = boundary ? chosen.ball.y : a.view.ball.y + (b.view.ball.y - a.view.ball.y) * alpha;
      views.push({time, error: Math.hypot(view.ball.x - x, view.ball.y - y), x: view.ball.x, y: view.ball.y});
    };
    const cadence = [.72, 1.31, .93, 1.08, 2, .55, 1.12, .87, 1, 1.4, .8];
    try {
      for (let i = 0; time <= 1800; i++) {
        while (index < incoming.length && incoming[index].arrive <= time) {
          handleLanMessage(incoming[index++].s);
          if (index > 5 && JSON.parse(incoming[index - 4].s).type === 'state') {
            const before = identity(); handleLanMessage(incoming[index - 4].s);
            if (before !== identity()) staleMutations++;
          }
        }
        const before = identity(); loop(time); updateBall();
        if (before !== identity()) guestMutations++;
        time += 1000 / hz * (irregular ? cadence[i % cadence.length] : 1);
      }
    } finally { draw = originalDraw; }
    return {views, guestMutations, staleMutations, sequence: lanLastStateSeq, score: left.score,
      remaining: rallyLaunchFramesRemaining, target: rallyLaunchTargetSpeed};
  }, {packets, online, hz, irregular});
}

try {
  for (const platform of Object.keys(builds)) {
    const p = await page(platform);
    for (const scenario of ['local-initial', 'cpu-initial', 'cpu-score', 'cpu-repeat', 'horizontal',
        'vertical', 'diagonal', 'paddle', 'wall', 'rush']) {
      let reference;
      for (const hz of rates) for (const irregular of [false, true]) {
        const result = await trace(p, scenario, hz, irregular);
        assert.equal(result.ticks.length, 61);
        assert.ok(result.views.length >= 50 && result.views.every(v => v.error < 1e-7),
          `${platform} ${scenario} ${hz} Hz interpolation is continuous on its own tick tape`);
        const physics = result.ticks.map(({epoch, key, ...tick}) => tick);
        if (!reference) reference = physics;
        else assert.deepEqual(physics, reference, `${scenario}: refresh cadence cannot change physics`);
        if (['horizontal', 'vertical', 'diagonal', 'rush'].includes(scenario)) {
          const target = 4.4 * (scenario === 'rush' ? 1.3 : 1);
          for (let tick = 0; tick <= 30; tick++) {
            const b = result.ticks[tick].ball;
            assert.ok(Math.abs(Math.hypot(b.vx, b.vy) - target * (tick < 24 ? .4 + .6 * tick / 24 : 1)) < 1e-8);
          }
        }
        metrics.push({platform, scenario, hz, irregular, frames: result.views.length,
          maxInterpolationError: Math.max(...result.views.map(v => v.error))});
      }
      pass(`${platform}: rendered ${scenario}, five rates, regular/irregular timing, identical 60 Hz physics`);
    }
    if (artifacts) await p.screenshot({path: artifacts + '/' + platform.toLowerCase() + '-serve.png'});
    for (const online of [false, true]) {
      const packets = await networkTape(p, online);
      const statePackets = packets.map(p => JSON.parse(p.s)).filter(p => p.type === 'state');
      assert.ok(statePackets.some(p => p.ball.rallyLaunchFramesRemaining === 36 && p.ball.rallyLaunchTargetSpeed === 0),
        'host publishes released velocity and ongoing ripple without a protocol change');
      const guest = await page(platform);
      for (const hz of rates) for (const irregular of [false, true]) {
        const result = await replay(guest, packets, online, hz, irregular);
        assert.equal(result.guestMutations, 0, 'guest must not predict or accelerate the authoritative ball');
        assert.equal(result.staleMutations, 0, 'old packets cannot restart a ramp or score');
        assert.equal(result.sequence, statePackets.at(-1).seq);
        assert.equal(result.score, 2);
        assert.ok(result.views.length > 40 && result.views.every(v => v.error < 1e-7),
          JSON.stringify({platform, online, hz, irregular, count: result.views.length,
            errors: result.views.filter(v => v.error >= 1e-7).slice(0, 5)}));
        metrics.push({platform, transport: online ? 'online-adapter' : 'LAN-handler', hz, irregular,
          frames: result.views.length, maxInterpolationError: Math.max(...result.views.map(v => v.error))});
      }
      await guest.close();
      pass(`${platform}: ${online ? 'online' : 'LAN'} host/guest JSON replay, repeated scores, jitter and stale packets at five rates`);
    }
    await p.close();
  }
  assert.deepEqual(errors, []);
  if (artifacts) await writeFile(artifacts + '/browser-metrics.json', JSON.stringify(metrics, null, 2));
  console.log(`${checks} serve browser groups passed (${metrics.length} controlled runs); physical displays and RTC transport not exercised.`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
