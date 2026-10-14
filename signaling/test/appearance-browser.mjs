import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {builds, root} from '../../tests/helpers/game-source.mjs';

const output = process.env.KING_PONG_TEST_ARTIFACTS;
if (output) await mkdir(output, {recursive: true});
const server = createServer(async (req, res) => {
  try {
    const path = new URL('.' + new URL(req.url, 'http://localhost').pathname, root);
    if (!path.href.startsWith(root.href)) throw Error();
    res.setHeader('Content-Type', path.pathname.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({headless: true});
const evidence = [], errors = [];
let checks = 0;
try {
  for (const [platform, file] of Object.entries(builds)) {
    for (const mobile of [false, true]) {
      const page = await browser.newPage({viewport: mobile ? {width: 844, height: 390} : {width: 1280, height: 900},
        deviceScaleFactor: mobile ? 3 : 1, hasTouch: mobile, isMobile: mobile});
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => {
        window.requestAnimationFrame = () => 1;
        window.testNow = 1000;
        performance.now = () => window.testNow;
        window.addEventListener('blur', e => e.stopImmediatePropagation(), true);
        Object.defineProperty(window, 'KING_PONG_SIGNALING_URL', {get: () => '', set: () => {}});
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/${file}`);
      const resume = await page.evaluate(() => {
        hideTitleScreen(); saveData.muteAll = true; gameWindowFocused = true;
        const results = [], originalText = drawText, originalStroke = ctx.strokeRect;
        let labels = [], panels = [];
        drawText = (text, ...args) => { labels.push(text); originalText(text, ...args); };
        ctx.strokeRect = function(...args) { panels.push(args); originalStroke.apply(this, args); };
        const paint = () => {
          labels = []; panels = []; draw();
          return {labels: [...labels], panels: panels.filter(a => a[0] === 70.5 && a[2] === W - 140)};
        };
        for (const campaign of [0, 1, 2]) for (const gameMode of [1, 2, 3, 4]) {
          mode = gameMode; activeCampaign = campaign; levelIndex = 0; matchArenaId = campaign * 6;
          lanRole = 'none'; lanConnected = false; onlineSession = null; onlineGameBlocked = false;
          bossIntroActive = creditsActive = waitingForServe = gameOver = levelCleared = campaignCleared = false;
          paused = false; resumeCountdownEndAt = 0; hazards = []; bossBalls = [];
          resetPaddles(); resetBall(1, false); clearRallyLaunchRamp();
          ball.x = 210.25; ball.y = 120.75; ball.vx = 5; ball.vy = 1;
          seedVisualHistory(); setMenusVisible(false);
          togglePause(); setMenusVisible(false);
          const before = paint(), position = [ball.x, ball.y];
          setMenusVisible(true); labels = []; panels = [];
          testNow = 1000;
          // Real Resume control: inspect the canvas before any next RAF is allowed.
          document.getElementById('matchResume').click();
          const immediate = {labels: [...labels], panels: panels.filter(a => a[0] === 70.5 && a[2] === W - 140)};
          const countdown = [];
          for (const now of [1000, 2000, 3000, 3999]) {
            testNow = now; update(); countdown.push({...paint(), paused, position: [ball.x, ball.y]});
          }
          testNow = 4000; update(); const finished = {paused, countdown: hasResumeCountdown(), ...paint()};
          // Canceling the countdown must return to a real pause, not release physics.
          paused = true; resumeCountdownEndAt = 0; testNow = 5000;
          togglePause(); togglePause(); const canceled = {paused, countdown: hasResumeCountdown()};
          setMenusVisible(false); labels = []; panels = [];
          requestTogglePause(); // Keyboard/controller route with the menu already closed.
          const closedMenuResume = {labels: [...labels], panels: panels.filter(a => a[0] === 70.5 && a[2] === W - 140)};
          results.push({campaign, gameMode, before, immediate, position, countdown, finished, canceled, closedMenuResume});
        }
        // Result panels still have a purpose even if a resume deadline exists.
        mode = 1; paused = true; resumeCountdownEndAt = testNow + 3000; setMenusVisible(false);
        for (const flag of ['gameOver', 'levelCleared', 'campaignCleared']) {
          gameOver = flag === 'gameOver'; levelCleared = flag === 'levelCleared'; campaignCleared = flag === 'campaignCleared';
          syncRoyalUi(true); results.push({flag, terminal: paint()});
        }
        drawText = originalText; ctx.strokeRect = originalStroke;
        return results;
      });
      for (const result of resume) {
        if (result.flag) {
          const label = {gameOver: 'LEVEL FAILED', levelCleared: 'LEVEL CLEARED', campaignCleared: 'CAMPAIGN COMPLETE'}[result.flag];
          assert.ok(result.terminal.labels.includes(label)); assert.equal(result.terminal.panels.length, 1);
        } else {
          assert.ok(result.before.labels.includes('PAUSED'));
          assert.deepEqual(result.before.panels, [], 'closed-menu pause has no legacy rectangle');
          assert.ok(result.immediate.labels.includes('3'), 'Resume replaces the old canvas in the same UI event');
          for (const [i, sample] of result.countdown.entries()) {
            assert.ok(sample.labels.includes(String([3, 2, 1, 1][i])));
            assert.deepEqual(sample.position, result.position); assert.equal(sample.paused, true);
          }
          assert.ok(result.closedMenuResume.labels.includes('3'));
          for (const sample of [result.immediate, result.closedMenuResume, ...result.countdown]) {
            assert.ok(!sample.labels.includes('PAUSED')); assert.deepEqual(sample.panels, []);
          }
          assert.equal(result.finished.paused, false); assert.equal(result.finished.countdown, false);
          assert.ok(!result.finished.labels.includes('PAUSED'));
          assert.deepEqual(result.canceled, {paused: true, countdown: false});
        }
        checks++;
      }
      const pixels = await page.evaluate(() => {
        const samples = [];
        for (const scale of [1, 1.25, 2, 3, 4, 6]) {
          canvas.width = W * scale; canvas.height = H * scale; renderScale = scale;
          ctx.setTransform(scale, 0, 0, scale, 0, 0);
          for (const campaign of [0, 1, 2]) for (const split of [false, true]) {
            mode = 1; activeCampaign = campaign;
            ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
            const b = Object.freeze({x: 100.25, y: 150.125, vx: 7, vy: -2});
            const before = JSON.stringify([ball, royalSplitBall, frame]);
            const color = split ? '#d6a6ff' : currentCampaign().accent;
            drawRoyalBall(b, split);
            const size = Math.round(BALL_SIZE * scale), sprite = royalBallGlowSprite(color, size);
            const core = Array.from(ctx.getImageData(Math.floor((b.x + 4) * scale), Math.floor((b.y + 4) * scale), 1, 1).data);
            const outside = Array.from(ctx.getImageData(Math.floor(b.x * scale - 2), Math.floor((b.y + 4) * scale), 1, 1).data);
            const cachedCore = Array.from(sprite.getContext('2d').getImageData(56 + size, 56 + size, 1, 1).data);
            samples.push({scale, campaign, split, color, core, outside, cachedCore,
              sameSprite: sprite === royalBallGlowSprite(color, size),
              cacheSize: royalBallGlowSprites.size, dimension: sprite.width,
              unchanged: before === JSON.stringify([ball, royalSplitBall, frame])});
          }
        }
        return samples;
      });
      for (const result of pixels) {
        const rgb = result.color.slice(1).match(/../g).map(n => parseInt(n, 16));
        result.core.slice(0, 3).forEach((n, i) => assert.ok(Math.abs(n - rgb[i] * (result.split ? .52 : 1)) <= 1));
        assert.ok(result.outside.slice(0, 3).some(n => n > 0), 'accent halo restored');
        assert.equal(result.cachedCore[3], 0, 'the cached halo cannot blur the core');
        assert.ok(result.sameSprite && result.unchanged); assert.ok(result.cacheSize <= 4 && result.dimension <= 208);
        checks++;
      }
      evidence.push({platform, mobile, resume, pixels});
      console.log(`PASS: ${platform} ${mobile ? 'mobile' : 'desktop'}: immediate Resume, 3/2/1, cancellation/results, opaque core and bounded cached halo`);
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  if (output) await writeFile(output + '/appearance-results.json', JSON.stringify({checks, evidence}, null, 2) + '\n');
  console.log(`RESULT: ${checks} browser checks; Chromium renders all four HTML builds, not native-device validation.`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
