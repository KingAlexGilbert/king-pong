// Fresh application entry and real canvas/audio paths in each shipped HTML shell.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {builds, root} from '../../tests/helpers/game-source.mjs';

const server = createServer(async (req, res) => {
  try {
    const file = new URL('.' + new URL(req.url, 'http://localhost').pathname, root);
    if (!file.href.startsWith(root.href)) throw Error();
    res.setHeader('Content-Type', file.pathname.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless: true});
const errors = [], failures = [], artifacts = process.env.KING_PONG_TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, {recursive: true});
let checks = 0;
async function check(label, action) {
  try { await action(); checks++; console.log('PASS: ' + label); }
  catch (error) { failures.push(label + ': ' + error.message); console.error('FAIL: ' + failures.at(-1)); }
}
async function page(platform, options = {}) {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, ...options});
  const p = await context.newPage();
  p.on('pageerror', error => errors.push(platform + ': ' + error.message));
  await p.addInitScript(() => {
    // Drive the actual renderer deterministically, without serving or keyboard input.
    requestAnimationFrame = () => 1;
    Object.defineProperty(window, 'KING_PONG_SIGNALING_URL', {get: () => '', set: () => {}});
    window.testCanvasText = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      if (this.canvas.id === 'game') window.testCanvasText.push(text);
      return fillText.call(this, text, ...args);
    };
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.requestFullscreen = async () => { throw Error('Test viewport'); };
    }, {once: true});
  });
  await p.goto(origin + '/' + builds[platform]);
  return p;
}
async function prompt(p, platform, expected = true) {
  const state = await p.evaluate(platform => {
    window.testCanvasText.length = 0;
    renderFrame(0, performance.now());
    return {waitingForServe, text: window.testCanvasText,
      prompt: localizeText(platform === 'Android' ? 'TAP TO SERVE' : 'SPACE TO SERVE')};
  }, platform);
  assert.equal(state.waitingForServe, expected);
  assert.equal(state.text.filter(text => text === state.prompt).length, expected ? 1 : 0,
    'exactly one initial prompt while waiting, none during a rally: ' + JSON.stringify(state));
}
try {
  for (const platform of Object.keys(builds)) {
    for (const entry of ['Campaign', 'Level Select', 'Custom Game']) {
      const p = await page(platform);
      await check(platform + ': fresh ' + entry + ' prompt and reentry before any serve', async () => {
        const enter = async () => {
          if (entry === 'Campaign') await p.locator('#titleCampaignButton').click();
          else if (entry === 'Level Select') {
            await p.locator('#titleLevelSelectButton').click();
            await p.locator('#royalGalleryList button:not(:disabled)').first().click();
          } else {
            // Existing save fixture unlocks Custom. Its preview/Start match flow stays intact.
            await p.evaluate(() => { saveData.completedLevels[0] = true; saveData.highestUnlockedLevel = 1; saveProgressNow(); });
            await p.locator('#titleCustomButton').click();
            assert.equal(await p.locator('#matchSetup').isVisible(), true);
            // Restart initializes a Custom encounter waiting for serve, without ever serving.
            await p.locator('#setupMenuButton').click();
            await p.locator('#restartButton').click();
          }
        };
        await enter();
        if (artifacts) {
          await p.evaluate(() => renderFrame(0, performance.now()));
          await p.screenshot({path: artifacts + '/' + platform + '-' + entry.replaceAll(' ', '-') + '.png'});
        }
        await prompt(p, platform);
        await p.evaluate(() => showTitleScreen());
        await enter();
        await prompt(p, platform);
        await p.evaluate(() => releaseMenuKeyboardFocus());
        await p.keyboard.press('Space');
        await prompt(p, platform, false);
        await p.context().close();
      });
      if (!p.isClosed()) await p.context().close();
    }

    const p = await page(platform);
    await check(platform + ': title menu removes paddle action and empty spacing; setup selections survive', async () => {
      for (const viewport of [{width: 1280, height: 900}, {width: 768, height: 540}, {width: 390, height: 844}]) {
        await p.setViewportSize(viewport);
        await p.locator('#menuToggle').click();
        assert.equal(await p.locator('#menuPaddle').isVisible(), false);
        assert.equal(await p.locator('#menuPaddle').evaluate(el => el.parentElement.getBoundingClientRect().height), 0);
        assert.equal(await p.locator('#titleJumpButton').isVisible(), true);
        assert.equal(await p.locator('#matchResume').innerText(), 'Close menu');
        assert.equal(await p.locator('#matchModes').isVisible(), true);
        if (artifacts) await p.screenshot({path: artifacts + '/' + platform + '-menu-' + viewport.width + '.png'});
        await p.locator('#matchResume').click();
      }
      await p.setViewportSize({width: 1280, height: 900});
      await p.locator('.primary-online').click();
      assert.equal(await p.locator('#choosePaddleButton').isVisible(), true);
      await p.locator('#choosePaddleButton').click();
      assert.equal(await p.evaluate(() => galleryKind), 'paddle');
      await p.locator('#royalGalleryClose').click();
      await p.locator('#setupMenuButton').click();
      await p.evaluate(() => { saveData.highestUnlockedLevel = 2; saveData.completedLevels[0] = saveData.completedLevels[1] = true; saveProgressNow(); });
      await p.locator('#titleCampaignButton').click();
      await p.locator('#menuToggle').click();
      assert.equal(await p.locator('#menuPaddle').isVisible(), true, 'in-game customization is retained');
      await p.locator('#menuPaddle').click();
      await p.locator('#royalGalleryList button:not(:disabled)').nth(1).click();
      const selected = await p.evaluate(() => savedPaddle());
      await p.evaluate(() => { loadSaveSlot(1); loadSaveSlot(0); });
      assert.equal(await p.evaluate(() => savedPaddle()), selected, 'saved paddle preference survives');
    });
    await p.context().close();

    const audio = await page(platform);
    await check(platform + ': real Web Audio cues follow rendered numbers and SFX/master mute', async () => {
      await audio.locator('#titleLocalButton').click();
      await audio.locator('#matchServe').click();
      await audio.waitForFunction(() => audioCtx?.state === 'running');
      const result = await audio.evaluate(() => {
        setMusicEnabled(false);
        window.testTones = [];
        const createOscillator = audioCtx.createOscillator.bind(audioCtx);
        audioCtx.createOscillator = () => {
          const oscillator = createOscillator(), start = oscillator.start.bind(oscillator);
          oscillator.start = (...args) => {
            if ([600,720].includes(oscillator.frequency.value)) window.testTones.push(oscillator.frequency.value);
            return start(...args);
          };
          return oscillator;
        };
        let now = performance.now();
        performance.now = () => now;
        const frame = () => { window.testCanvasText.length = 0; renderFrame(0, now); };
        pointForPlayer();frame();frame();
        const two = window.testCanvasText.includes('2');
        now += 1000;tickPointServeCountdown();frame();frame();
        const one = window.testCanvasText.includes('1');
        now += 999;tickPointServeCountdown();frame();
        const pending = waitingForServe;
        now++;tickPointServeCountdown();frame();
        const active = !waitingForServe && !window.testCanvasText.some(t => /TO SERVE/.test(t));
        const audible = [...window.testTones];
        setSoundEffectsEnabled(false);
        pointForCpu();frame();now += 1000;tickPointServeCountdown();frame();
        setSoundEffectsEnabled(true);frame();
        const muted = [...window.testTones];
        now += 1000;tickPointServeCountdown();
        setGameMuteAll(true);pointForPlayer();frame();setGameMuteAll(false);frame();
        const masterMuted = [...window.testTones];
        now += 1000;tickPointServeCountdown();frame();
        return {two, one, pending, active, audible, muted, masterMuted, final: window.testTones};
      });
      assert.deepEqual(result, {two: true, one: true, pending: true, active: true,
        audible: [600,720], muted: [600,720], masterMuted: [600,720], final: [600,720,720]});
    });
    await audio.context().close();

    const touch = await page(platform, {viewport: {width: 844, height: 390}, hasTouch: true});
    await check(platform + ': initial prompt and existing touch/controller serve inputs', async () => {
      await touch.locator('#titleCampaignButton').tap();
      await prompt(touch, platform);
      await touch.locator('#game').tap();
      await prompt(touch, platform, false);
      await touch.evaluate(() => { showTitleScreen(); startCampaignFromSave(); });
      await prompt(touch, platform);
      await touch.evaluate(() => {
        const pad = {index: 0, id: 'Test controller', connected: true, axes: [0,0,0,0],
          buttons: Array.from({length: 16}, (_, i) => ({pressed: i === 0, value: i === 0 ? 1 : 0}))};
        navigator.getGamepads = () => [pad];
        gameWindowFocused = true;
        updateGamepadInput();
      });
      await prompt(touch, platform, false);
    });
    await touch.context().close();
  }
  assert.deepEqual(errors, [], 'no page errors');
  assert.deepEqual(failures, []);
  console.log(`PASS: ${checks} browser check groups; no page errors`);
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
