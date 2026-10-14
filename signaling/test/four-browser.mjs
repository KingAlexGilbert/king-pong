import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {builds, root} from '../../tests/helpers/game-source.mjs';
const server = createServer(async (req, res) => {
  try {
    const url = new URL('.' + new URL(req.url, 'http://localhost').pathname, root);
    if (!url.href.startsWith(root.href)) throw Error();
    res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.end(await readFile(url));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({headless: true});
const errors = [], evidence = [];
const artifacts = process.env.KING_PONG_TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, {recursive: true});
try {
  for (const [platform, file] of Object.entries(builds)) {
    const p = await browser.newPage({viewport: {width: 1280, height: 800}});
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => {
      window.requestAnimationFrame = () => 1;
      Object.defineProperty(window, 'KING_PONG_SIGNALING_URL', {get: () => '', set: () => {}});
      window.addEventListener('blur', e => e.stopImmediatePropagation(), true);
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.requestFullscreen = async () => { throw Error('Test viewport'); };
      }, {once: true});
    });
    await p.goto(`http://127.0.0.1:${server.address().port}/${file}`);
    await p.locator('.primary-online').click();
    await p.locator('#onlineFourPlayers').click();
    assert.equal(await p.locator('#fourScreen').isVisible(), true);
    assert.equal(await p.locator('#fourHiddenWall').isDisabled(), true);
    await p.locator('#fourPractice').click();
    assert.equal(await p.locator('#fourCanvas').isVisible(), true);
    const rates = await p.evaluate(() => {
      saveData.muteAll = true; gameWindowFocused = true;
      const snapshots = [];
      for (const hz of [60, 120, 144, 165, 240]) {
        fourView.start(KingPongFour.config(), KingPongFour.create({}, 123));
        for (let i = 0; i <= hz * 10; i++) fourView.frame(i * 1000 / hz);
        snapshots.push({hz, state: KingPongFour.pack(fourView.state)});
      }
      return snapshots;
    });
    for (const rate of rates) { assert.equal(rate.state[0], 600); assert.deepEqual(rate.state, rates[0].state); }
    console.log('PASS: ' + platform + ' menu path, unlock gating and identical 600 steps at 60/120/144/165/240 Hz');
    const inputs = await p.evaluate(() => {
      const results = [];
      for (let side = 0; side < 4; side++) {
        fourView.side = side; fourView.relative = true;
        keys.clear(); keys.add('ArrowUp'); gameWindowFocused = true;
        const input = fourView.input(); const original = fourView.state.paddles[side].pos;
        KingPongFour.movePaddle(fourView.state.paddles[side], input);
        const a = KingPongFour.paddleRect(side, original), b = KingPongFour.paddleRect(side, fourView.state.paddles[side].pos);
        results.push(KingPongFour.viewPoint(side, b.x + b.w / 2, b.y + b.h / 2)[1] <
          KingPongFour.viewPoint(side, a.x + a.w / 2, a.y + a.h / 2)[1]);
        fourView.paint(fourView.state);
      }
      keys.clear(); return results;
    });
    assert.deepEqual(inputs, [true, true, true, true]);
    for (const viewport of [{width: 1280, height: 800}, {width: 1920, height: 1080}, {width: 844, height: 390}, {width: 1024, height: 768}, {width: 390, height: 844}]) {
      await p.setViewportSize(viewport);
      const rect = await p.locator('#fourCanvas').boundingBox();
      assert.ok(Math.abs(rect.width - rect.height) < 1);
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1);
      await p.evaluate(() => fourView.paint(fourView.state));
      if (artifacts && platform === 'Browser') await p.screenshot({path: artifacts + '/four-' + viewport.width + '.png'});
    }
    await p.locator('#fourMenu').click();
    assert.equal(await p.evaluate(() => fourView.state.paused), true);
    await p.locator('#fourCloseMenu').click();
    assert.equal(await p.locator('.four-pause').isVisible(), false);
    assert.equal(await p.evaluate(() => fourView.state.paused), true);
    await p.locator('#fourMenu').click(); await p.locator('#fourResume').click();
    assert.deepEqual(await p.evaluate(() => [fourView.state.paused, fourView.state.countdown]), [false, 180]);
    await p.locator('#fourBack').click();
    await p.locator('#titleLocalButton').click();
    assert.equal(await p.locator('#matchSetup').isVisible(), true);
    const classic = await p.evaluate(() => {
      twoPlayerRelativeView = true; mode = 2; lanRole = 'guest'; lanConnected = true; onlineSession = {close() {}}; lanChannel = {readyState: 'open', send() {}};
      keys.clear(); keys.add('ArrowUp'); gameWindowFocused = true;
      const normal = readLocalLanInput([]); touchPaddleTargets.left = 50;
      const touch = readLocalLanInput([]);
      keys.clear(); touchPaddleTargets.left = null;
      const before = [ball.x, ball.y, ball.vx, ball.vy]; draw();
      const after = [ball.x, ball.y, ball.vx, ball.vy];
      return {normal, touch, before, after, rotate: twoPlayerViewRotated()};
    });
    assert.equal(classic.rotate, true); assert.equal(classic.normal.axis, 1); assert.equal(classic.touch.targetY, 366);
    assert.deepEqual(classic.before, classic.after);
    console.log('PASS: ' + platform + ' every perspective, square desktop/tablet/phone canvas, pause/menu/countdown and classic input transform');
    const measure = await p.evaluate(() => {
      const s = KingPongFour.create({bots: [true, true, true, true]}, 341), begin = performance.now();
      for (let i = 0; i < 36000; i++) { KingPongFour.step(s); if (s.winner >= 0) { s.winner = -1; s.paddles.forEach(p => {p.alive = true; p.lives = 3;}); s.balls = KingPongFour.create({}, i + 1).balls; } }
      const elapsed = performance.now() - begin;
      fourView.state = s;
      const samples = [];
      for (let i = 0; i < 250; i++) { const before = performance.now(); fourView.paint(s); fourView.context.getImageData(0, 0, 1, 1); if (i >= 50) samples.push(performance.now() - before); }
      samples.sort((a, b) => a - b);
      return {simulationMsPerTick: elapsed / 36000, renderReadbackMeanMs: samples.reduce((a, b) => a + b, 0) / samples.length, renderReadbackP95Ms: samples[Math.floor(samples.length * .95)]};
    });
    evidence.push({platform, ...measure});
    await p.close();
  }
  assert.deepEqual(errors, []);
  console.log('MEASUREMENTS: ' + JSON.stringify(evidence));
  if (artifacts) await writeFile(artifacts + '/four-performance.json', JSON.stringify(evidence, null, 2));
  console.log('RESULT: four builds; 20 fixed-clock refresh trials; 20 responsive sizes; actual headless rendering, no physical-device measurements.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
