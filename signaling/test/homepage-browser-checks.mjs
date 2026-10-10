import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {root} from '../../tests/helpers/game-source.mjs';

export async function homepageBrowserChecks({browser, pass, artifacts, docsRoot = new URL('docs/', root)}) {
  // Serve the real repository prefix, including directory index navigation.
  const server = createServer(async (req, res) => {
    try {
      let path = new URL(req.url, 'http://localhost').pathname;
      if (!path.startsWith('/king-pong/')) throw new Error('Outside site');
      path = path.slice('/king-pong/'.length);
      if (!path || path.endsWith('/')) path += 'index.html';
      const file = new URL(path, docsRoot);
      if (!file.href.startsWith(docsRoot.href)) throw new Error('Outside site');
      res.setHeader('Content-Type', path.endsWith('.png') ? 'image/png' : path.endsWith('.js') ? 'text/javascript' : 'text/html');
      res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const home = `http://127.0.0.1:${server.address().port}/king-pong/`;
  const errors = [];
  if (artifacts) await mkdir(artifacts, {recursive: true});
  try {
    for (const [width, height, touch] of [[390, 844, true], [844, 390, true], [1280, 720], [1366, 768], [1920, 1080], [2560, 1440]]) {
      const context = await browser.newContext({viewport: {width, height}, hasTouch: !!touch,
        ...(browser.browserType().name() === 'chromium' ? {isMobile: !!touch} : {})});
      try {
        context.on('page', p => p.on('pageerror', error => errors.push(error.message)));
        await context.addInitScript(() => {
          if (!location.pathname.endsWith('/king-pong/')) return;
          window.homepageActivity = {raf: 0, audio: 0, sockets: 0};
          const raf = window.requestAnimationFrame;
          window.requestAnimationFrame = callback => { homepageActivity.raf++; return raf.call(window, callback); };
          for (const [name, counter] of [['AudioContext', 'audio'], ['webkitAudioContext', 'audio'], ['WebSocket', 'sockets']]) {
            if (window[name]) window[name] = new Proxy(window[name], {construct(target, args) {
              homepageActivity[counter]++; return Reflect.construct(target, args);
            }});
          }
        });
        const p = await context.newPage(), requests = [];
        p.on('request', req => requests.push(req.url()));
        await p.goto(home);
        const preview = p.getByRole('link', {name: 'Play King Pong — opens in a new tab', exact: true});
        await preview.scrollIntoViewIfNeeded();
        await p.locator('.game-demo-image').evaluate(img => img.decode());
        const box = await preview.boundingBox();
        assert.ok(box.width <= 900 && box.x >= 0 && box.x + box.width <= width);
        assert.ok(Math.abs(box.width / box.height - 4 / 3) < .01);
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(p.frames().length, 1);
        assert.equal(await p.locator('iframe, canvas, script, embed, object').count(), 0);
        assert.equal(requests.some(url => new URL(url).pathname.includes('/demo/')), false);
        if (artifacts) await p.screenshot({path: `${artifacts}/homepage-${width}x${height}.png`, fullPage: true});

        async function activate(link, method) {
          if (method === 'keyboard') {
            await link.focus();
            assert.equal(await link.evaluate(el => el.matches(':focus-visible')), true);
            assert.notEqual(await link.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
          }
          const popupEvent = p.waitForEvent('popup');
          if (method === 'touch') await link.tap();
          else if (method === 'keyboard') await p.keyboard.press('Enter');
          else await link.click();
          const game = await popupEvent;
          await game.waitForLoadState('load');
          assert.equal(game.url(), home + 'demo/');
          assert.equal(await game.evaluate(() => window.top === window.self && window.opener === null), true);
          await game.locator('#titleScreen').waitFor({state: 'visible'});
          assert.equal(context.pages().length, 2, 'one activation opens exactly one game tab');
          assert.equal(game.frames().length, 1);
          assert.equal(await game.locator('#importSavesButton, #exportSavesButton').count(), 2);
          assert.equal(await p.evaluate(() => document.fullscreenElement), null);
          assert.deepEqual(await p.evaluate(() => homepageActivity), {raf: 0, audio: 0, sockets: 0});
          return game;
        }

        const game = await activate(preview, touch ? 'touch' : width === 1280 ? 'keyboard' : 'mouse');
        await game.locator('#titleCampaignButton').click();
        if (await game.locator('#rotateDismiss').isVisible()) await game.locator('#rotateDismiss').click();
        await game.locator('#matchContinue').click();
        await game.waitForFunction(() => !waitingForServe && !paused);
        const x = await game.evaluate(() => ball.x);
        await game.waitForFunction(x => ball.x !== x, x);
        assert.equal(await game.evaluate(() => typeof requestRoyalLandscape), 'function');
        await game.close();
        assert.equal(context.pages().length, 1);
        if (width === 1280) {
          const dedicated = p.getByRole('link', {name: 'Open Browser Demo in a New Tab', exact: true});
          const separate = await activate(dedicated, 'mouse');
          await separate.close();
        }
      } finally { await context.close(); }
    }
    assert.deepEqual(errors, []);
    pass('homepage: static preview, mouse/touch/keyboard single-tab launches, real /king-pong/ URLs and standalone gameplay at six viewport sizes');
  } finally { await new Promise(resolve => server.close(resolve)); }
}
