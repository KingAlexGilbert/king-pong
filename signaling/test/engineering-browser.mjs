import assert from 'node:assert/strict';
import {
  createServer
} from 'node:http';
import {
  readFile,
  mkdir,
  writeFile
} from 'node:fs/promises';
import {
  chromium,
  firefox
} from 'playwright';
import {
  builds,
  root
} from '../../tests/helpers/game-source.mjs';

const server = createServer(async (req, res) => {
  try {
    const file = new URL('.' + new URL(req.url, 'http://localhost').pathname, root);
    if (!file.href.startsWith(root.href)) throw new Error();
    res.setHeader('Content-Type', file.pathname.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const engine = process.env.KING_PONG_TEST_BROWSER === 'firefox' ? firefox : chromium;
const browser = await engine.launch({
  headless: true
});
const artifacts = process.env.KING_PONG_TEST_ARTIFACTS,
  errors = [],
  metrics = [];
if (artifacts) await mkdir(artifacts, {
  recursive: true
});
let checks = 0;
const pass = label => {
  checks++;
  console.log('PASS: ' + label)
};
async function page(platform = 'Browser', options = {}) {
  const context = await browser.newContext({
    viewport: {
      width: 1280,
      height: 800
    },
    ...options
  });
  const p = await context.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(() => {
    window.requestAnimationFrame = () => 1;
    Math.random = () => .7
  });
  await p.goto(origin + '/' + builds[platform]);
  return p;
}
async function center(p) {
  const b = await p.evaluate(() => {
    handleViewportChange();
    const r = canvas.getBoundingClientRect(),
      s = getComputedStyle(document.body);
    return {
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      cx: innerWidth / 2,
      cy: (innerHeight + parseFloat(s.paddingTop) - parseFloat(s.paddingBottom)) / 2,
      vw: innerWidth,
      vh: innerHeight
    }
  });
  assert.ok(Math.abs(b.x + b.w / 2 - b.cx) < 1 && Math.abs(b.y + b.h / 2 - b.cy) < 1, JSON.stringify(b));
  assert.ok(b.x >= -.5 && b.y >= 0 && b.x + b.w <= b.vw + 1 && b.y + b.h <= b.vh + 1, JSON.stringify(b));
  return b;
}
async function presentationChecks(p, platform) {
  for (const hz of [60, 120, 144, 165, 240, 360]) {
    const motion = await p.evaluate(hz => {
      hideTitleScreen();
      startTwoPlayerMode(true, false);
      waitingForServe = paused = false;
      gameWindowFocused = true;
      hazards = [];
      clearRallyLaunchRamp();
      ball.x = 100.125;
      ball.y = 80.375;
      ball.vx = 12;
      ball.vy = 0;
      resetFrameClock();
      frame = 0;
      const views = [], original = draw;
      let time = 0;
      draw = view => views.push({time, x: view.ball.x, y: view.ball.y});
      try {
        for (let i = 0; i <= hz / 4; i++) {
          time = i * 1000 / hz;
          loop(time);
        }
        if (hz % 4) { time = 250; loop(time); }
      } finally {
        draw = original;
      }
      return {views, x: ball.x, y: ball.y, steps: frame};
    }, hz);
    assert.equal(motion.steps, 15);
    assert.equal(motion.x, 280.125);
    assert.equal(motion.y, 80.375);
    for (const view of motion.views) {
      assert.ok(Math.abs(view.x - (100.125 + 12 * Math.max(0, view.time / (1000 / 60) - 1))) < 1e-7,
        `${platform} ${hz} Hz: position comes from the fixed-step snapshots exactly once`);
      assert.equal(view.y, 80.375);
    }
    metrics.push({platform, hz, fastBallSteps: motion.steps, fastBallFrames: motion.views.length});
  }
  pass(platform + ': precise fast-ball motion at 60/120/144/165/240/360 Hz with unchanged physics');
  const camera = await p.evaluate(() => {
    shakeFrames = 6;
    frame = 3;
    const a = captureVisualState();
    frame = 4;
    const b = captureVisualState();
    const middle = interpolateVisualState(a, b, .25);
    draw(middle);
    const originalRandom = Math.random, originalTranslate = ctx.translate;
    const translations = [];
    let randomCalls = 0;
    Math.random = () => { randomCalls++; return .7; };
    ctx.translate = function(x, y) { translations.push({x, y}); originalTranslate.call(this, x, y); };
    try { draw(middle); draw(middle); }
    finally { Math.random = originalRandom; ctx.translate = originalTranslate; }
    return {a: a.shake, b: b.shake, middle: middle.shake, translations, randomCalls};
  });
  for (const axis of ['x', 'y']) assert.ok(Math.abs(camera.middle[axis] -
    (camera.a[axis] + (camera.b[axis] - camera.a[axis]) * .25)) < 1e-10);
  assert.equal(camera.randomCalls, 0, 'rendering camera feedback does not consume gameplay randomness');
  assert.deepEqual(camera.translations[0], camera.middle);
  assert.deepEqual(camera.translations[1], camera.middle);
  pass(platform + ': collision camera follows interpolated visual state without render-frequency randomness');

  await p.bringToFront();
  await p.waitForFunction(() => !document.hidden);
  const audio = await p.evaluate(async () => {
    setMusicEnabled(false);
    // The score/serve checks above schedule delayed jingles. Invalidate those
    // before measuring only the collision path in an offline audio context.
    stopGameSounds();
    const previous = audioCtx;
    const render = async (count, shield = false) => {
      const context = new OfflineAudioContext(1, 4800, 48000);
      audioCtx = context;
      for (let i = 0; i < count; i++) playImpactSound(300, .025);
      if (shield) playImpactSound(880, .055, .045, 'shield');
      const data = (await context.startRendering()).getChannelData(0);
      return {peak: Math.max(...data.map(Math.abs)), energy: data.reduce((sum, v) => sum + v * v, 0)};
    };
    try {
      saveData.muteAll = false;
      saveData.soundEffectsEnabled = true;
      const one = await render(1), burst = await render(100), shield = await render(100, true);
      saveData.soundEffectsEnabled = false;
      const sfxOff = await render(2, true);
      saveData.soundEffectsEnabled = true;
      saveData.muteAll = true;
      const muted = await render(2, true);
      return {one, burst, shield, sfxOff, muted};
    } finally {
      audioCtx = previous;
      saveData.muteAll = false;
      saveData.soundEffectsEnabled = true;
      stopGameSounds();
    }
  });
  assert.ok(audio.one.peak > .035 && audio.one.peak < .05, JSON.stringify(audio));
  assert.deepEqual(audio.burst, audio.one, '100 simultaneous requests have the amplitude/energy of one impact');
  assert.ok(audio.shield.peak < .05, JSON.stringify(audio));
  assert.equal(audio.sfxOff.energy, 0);
  assert.equal(audio.muted.energy, 0);
  metrics.push({platform, audio});
  pass(platform + ': real Web Audio samples preserve normal amplitude, cap bursts, and respect mute/SFX');
}

async function rasterChecks() {
  for (const scenario of [
    {width: 1280, height: 800, dpr: 1},
    {width: 1280, height: 800, dpr: 1.25},
    {width: 1366, height: 768, dpr: 1.5},
    {width: 1280, height: 800, dpr: 2},
    {width: 1280, height: 800, dpr: 3},
    {width: 3840, height: 2160, dpr: 1},
    {width: 390, height: 844, dpr: 3},
    {width: 844, height: 390, dpr: 3}
  ]) {
    const p = await page('Browser', {viewport: {width: scenario.width, height: scenario.height},
      deviceScaleFactor: scenario.dpr});
    const result = await p.evaluate(() => {
      hideTitleScreen();
      startTwoPlayerMode(true, false);
      handleViewportChange();
      const samples = [];
      for (let i = 0; i < 24; i++) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(renderScale, 0, 0, canvas.height / H, 0, 0);
        ctx.translate(.37, -.23);
        drawRoyalBall({x: 200 + i / 11, y: 100 + i / 17});
        const sx = canvas.width / W, sy = canvas.height / H;
        const x = Math.floor(195 * sx), y = Math.floor(95 * sy);
        const w = Math.ceil(25 * sx), h = Math.ceil(25 * sy);
        const data = ctx.getImageData(x, y, w, h).data;
        let minX = w, maxX = 0, minY = h, maxY = 0, count = 0;
        for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) {
          if (data[(row * w + col) * 4 + 3] < 128) continue;
          minX = Math.min(minX, col); maxX = Math.max(maxX, col);
          minY = Math.min(minY, row); maxY = Math.max(maxY, row); count++;
        }
        samples.push({width: maxX - minX + 1, height: maxY - minY + 1, count});
      }
      return {samples, width: canvas.width, height: canvas.height, dpr: devicePixelRatio,
        cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight};
    });
    assert.equal(result.width, Math.round(result.cssWidth * result.dpr));
    assert.equal(result.height, Math.round(result.cssHeight * result.dpr));
    for (const sample of result.samples) {
      assert.equal(sample.width, result.samples[0].width);
      assert.equal(sample.height, sample.width);
      assert.equal(sample.count, sample.width * sample.height, 'a solid square at every fractional position');
    }
    metrics.push({scenario, raster: result});
    await p.context().close();
  }
  pass('device-pixel ball squares remain stable at desktop/mobile sizes and DPR 1/1.25/1.5/2/3, including 4K');
}

async function backgroundChecks(p, platform) {
  const result = await p.evaluate(() => {
    const originalSize = [canvas.width, canvas.height, renderScale];
    const originalCampaign = activeCampaign;
    const rows = [];
    const state = JSON.stringify([ball, royalSplitBall, hazards, frame, left, right]);
    try {
      // The legacy background raster, kept independent of paintRoyalBackground.
      const reference = document.createElement('canvas');
      for (const scale of [1, 6, 1]) for (const campaign of [0, 1, 2]) {
        activeCampaign = campaign;
        canvas.width = reference.width = W * scale;
        canvas.height = reference.height = H * scale;
        renderScale = scale;
        invalidateStaticBackgroundCache();
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.imageSmoothingEnabled = false;
        const bg = reference.getContext('2d');
        bg.setTransform(scale, 0, 0, scale, 0, 0);
        bg.fillStyle = '#000';
        bg.fillRect(0, 0, W, H);
        bg.globalAlpha = .12;
        bg.strokeStyle = currentCampaign().accent;
        bg.lineWidth = 1;
        for (let x = 40; x < W; x += 40) {
          bg.beginPath(); bg.moveTo(x, 0); bg.lineTo(x, H); bg.stroke();
        }
        for (let y = 40; y < H; y += 40) {
          bg.beginPath(); bg.moveTo(0, y); bg.lineTo(W, y); bg.stroke();
        }
        drawBackground();
        const firstCache = cachedStaticBackground;
        drawBackground();
        // Readback is test-only and never used by production drawing.
        const actual = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const expected = bg.getImageData(0, 0, reference.width, reference.height).data;
        let mismatches = 0;
        for (let i = 0; i < actual.length; i++) if (actual[i] !== expected[i]) mismatches++;
        rows.push({scale, campaign, mismatches, cached: Boolean(firstCache),
          reused: firstCache === cachedStaticBackground, transform: ctx.getTransform().a});
      }
    } finally {
      [canvas.width, canvas.height, renderScale] = originalSize;
      activeCampaign = originalCampaign;
      invalidateStaticBackgroundCache();
    }
    return {rows, unchanged: state === JSON.stringify([ball, royalSplitBall, hazards, frame, left, right])};
  });
  assert.ok(result.unchanged, 'background drawing cannot advance or modify gameplay');
  for (const row of result.rows) {
    assert.equal(row.mismatches, 0, JSON.stringify(row));
    assert.equal(row.cached, row.scale === 1);
    assert.ok(row.reused);
    assert.equal(row.transform, row.scale);
  }
  pass(platform + ': large-canvas grid matches legacy pixels; resize/accent changes and small-canvas caching remain correct');
}

try {
  for (const platform of Object.keys(builds)) {
    const p = await page(platform);
    await p.locator('#titleLocalButton').click();
    await p.locator('#titleTwoPlayerButton').click();
    for (const viewport of [{
        width: 1280,
        height: 800
      }, {
        width: 1920,
        height: 1080
      }, {
        width: 2560,
        height: 1440
      }, {
        width: 3440,
        height: 1440
      }, {
        width: 3840,
        height: 2160
      }, {
        width: 1366,
        height: 768
      }, {
        width: 1024,
        height: 600
      }, {
        width: 800,
        height: 600
      }, {
        width: 640,
        height: 480
      }]) {
      await p.setViewportSize(viewport);
      await center(p);
    }
    await p.setViewportSize({
      width: 1920,
      height: 1080
    });
    await p.locator('#matchServe').click();
    await center(p);
    await p.locator('#menuToggle').click();
    await center(p);
    await p.locator('#matchMenuClose').click();
    const clean = await center(p);
    await p.evaluate(() => {
      const extra = document.createElement('div');
      extra.id = 'layout-fixture';
      extra.style.width = '280px';
      extra.style.height = '80px';
      extra.textContent = 'Host UI fixture';
      document.body.append(extra)
    });
    assert.deepEqual(await center(p), clean, 'a surrounding node cannot push the arena sideways');
    await p.evaluate(() => {
      document.getElementById('layout-fixture').remove();
      draw()
    });
    if (artifacts) await p.screenshot({
      path: `${artifacts}/${platform}-desktop.png`
    });
    pass(platform + ': desktop center, resize, menu transitions and surrounding layout isolation');

    for (const hz of [60, 120, 144, 165, 240, 360]) {
      const result = await p.evaluate(hz => {
        hideTitleScreen();
        mode = 1;
        activeCampaign = 0;
        levelIndex = 0;
        matchArenaId = 0;
        cloneHazards();
        left.score = right.score = 0;
        gameOver = levelCleared = campaignCleared = paused = waitingForServe = false;
        gameWindowFocused = true;
        nextCpuModeServeDirection = 1;
        resetFrameClock();
        frame = 0;
        ball.x = W - 1;
        ball.y = 10;
        ball.vx = 4;
        ball.vy = 0;
        const views = [],
          original = draw;
        draw = v => views.push({
          x: v.ball.x,
          y: v.ball.y,
          epoch: v.epoch,
          remaining: v.launch.remaining
        });
        try {
          for (let i = 0; i <= hz / 2; i++) loop(i * 1000 / hz);
          if (hz % 2) loop(500)
        } finally {
          draw = original
        }
        const spawned = views.filter(v => v.epoch === visualEpoch);
        // Also reset/serve between simulation ticks, including a fractional accumulator.
        mode = 2;
        resetBall(1, true);
        accumulatedFrameMs = 7;
        const clock = previousFrameTime;
        serveOrContinue();
        let immediate;
        draw = v => immediate = v.ball.x;
        try {
          renderFrame(.42, 501)
        } finally {
          draw = original
        }
        return {
          steps: frame,
          score: left.score,
          spawned,
          immediate,
          x: ball.x,
          previous: ball.prevX,
          accumulator: accumulatedFrameMs,
          clockUnchanged: clock === previousFrameTime
        };
      }, hz);
      assert.equal(result.steps, 30);
      assert.equal(result.score, 1);
      assert.equal(result.immediate, result.x);
      assert.equal(result.previous, result.x);
      assert.equal(result.accumulator, 7);
      assert.equal(result.clockUnchanged, true);
      assert.ok(result.spawned.length > 2);
      assert.ok(result.spawned.every((v, i) => !i || v.x >= result.spawned[i - 1].x),
        'spawn moves forward without a stale frame');
      if (hz > 60) assert.ok(new Set(result.spawned.map(v => v.x)).size > 28);
      metrics.push({
        platform,
        hz,
        steps: result.steps,
        uniqueSpawnPositions: new Set(result.spawned.map(v => v.x)).size
      });
    }
    pass(platform + ': production score/reset/serve path at 60/120/144/165/240/360 Hz');
    await presentationChecks(p, platform);
    await backgroundChecks(p, platform);
    await p.context().close();
  }
  for (const viewport of [{
      width: 390,
      height: 844
    }, {
      width: 844,
      height: 390
    }, {
      width: 360,
      height: 640
    }]) {
    const p = await page('Browser', {
      viewport,
      hasTouch: true,
      ...(engine === chromium ? {
        isMobile: true
      } : {})
    });
    await p.evaluate(() => {
      hideTitleScreen();
      startTwoPlayerMode(true, false);
      serveOrContinue();
      royalRotateDismissed = true;
      syncRoyalOrientation();
      ball.x = 120;
      ball.y = 160;
      clearRallyLaunchRamp();
      royalPickup = {
        type: 'split',
        x: 320,
        y: 240,
        ttl: 480
      };
      draw()
    });
    await center(p);
    assert.equal(await p.locator('#game').evaluate(el => getComputedStyle(el).position), 'static',
      'mobile keeps the original flex positioning');
    for (const type of ['split', 'rush', 'guard']) {
      await p.evaluate(type => {
        royalPickup.type = type;
        draw()
      }, type);
      if (artifacts) await p.screenshot({
        path: `${artifacts}/mobile-${viewport.width}-${type}.png`
      });
    }
    await p.context().close();
    pass(`touch ${viewport.width}x${viewport.height}: unchanged positioning and all larger icons`);
  }
  const p = await page();
  const timeline = await p.evaluate(() => {
    hideTitleScreen();
    startTwoPlayerMode(true, false);
    lanRole = 'guest';
    lanConnected = true;
    resetMatchConnectionState();
    lanChannel = {
      readyState: 'open',
      bufferedAmount: 0,
      send() {}
    };
    onlineControlChannel = lanChannel;
    ball.x = 600;
    queueGuestSnapshot({
      seq: 1,
      tick: 60,
      rightY: 208
    });
    guestRenderTime = 990;
    guestRenderAt = 1000;
    resetRoyalRally();
    left.score = 1;
    ball.x = 316;
    queueGuestSnapshot({
      seq: 2,
      tick: 63,
      rightY: 208
    });
    const retained = guestRenderTime;
    ball.x = 319;
    queueGuestSnapshot({
      seq: 3,
      tick: 66,
      rightY: 208
    });
    const before = guestVisualState(1000).ball.x;
    guestRenderTime = 1050;
    guestRenderAt = 1060;
    const at = guestVisualState(1060).ball.x,
      after = guestVisualState(1060 + 1000 / 240).ball.x;
    return {
      retained,
      before,
      at,
      after
    };
  });
  assert.deepEqual({
    ...timeline,
    after: 0
  }, {
    retained: 990,
    before: 600,
    at: 316,
    after: 0
  });
  assert.ok(timeline.after > 316 && timeline.after < 319);
  pass('guest timeline stays continuous through the score boundary and advances on the next 240 Hz frame');
  const perf = await p.evaluate(() => {
    lanRole = 'guest';
    let captures = 0,
      configs = 0;
    const originalCapture = captureVisualState,
      originalConfig = getCpuConfig;
    captureVisualState = () => {
      captures++;
      return originalCapture()
    };
    getCpuConfig = () => {
      configs++;
      return originalConfig()
    };
    try {
      previousFrameTime = null;
      accumulatedFrameMs = 0;
      paused = false;
      for (let i = 0; i <= 240; i++) loop(i * 1000 / 240)
    } finally {
      captureVisualState = originalCapture;
      getCpuConfig = originalConfig
    }
    return {
      captures,
      configs
    };
  });
  assert.equal(perf.captures, 0);
  assert.equal(perf.configs, 0);
  metrics.push({
    guestAt240Hz: perf
  });
  pass('240 Hz guest rendering avoids unused local snapshots and hidden legacy header calculations');
  if (artifacts) {
    const tiles = await p.evaluate(() => {
      lanRole = 'none';
      mode = 2;
      waitingForServe = paused = gameOver = false;
      royalGuards = {
        left: 0,
        right: 0
      };
      royalSplitBall = null;
      ball.x = 100;
      ball.y = 100;
      clearRallyLaunchRamp();
      const out = [];
      for (const entry of arenaCatalog) {
        matchArenaId = entry.id;
        activeCampaign = Math.min(2, Math.floor(entry.id / 6));
        levelIndex = entry.id % 6;
        cloneHazards();
        setAccent();
        royalPickup = null;
        draw();
        const view = captureVisualState();
        for (const [i, type] of ROYAL_TYPES.entries()) {
          view.pickup = {
            type,
            x: 240 + i * 80,
            y: 240,
            ttl: 480
          };
          drawRoyalEffects(view)
        }
        out.push({
          name: entry.level.name,
          url: canvas.toDataURL()
        });
      }
      return out;
    });
    const gallery = await browser.newPage({
      viewport: {
        width: 1200,
        height: 2100
      }
    });
    await gallery.setContent(
      '<style>body{margin:12px;background:#080510;color:#fff;font:14px monospace}main{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}img{width:100%;image-rendering:pixelated}p{margin:4px 0 8px}</style><main></main>'
      );
    await gallery.evaluate(tiles => {
      const main = document.querySelector('main');
      for (const tile of tiles) {
        const figure = document.createElement('div'),
          img = document.createElement('img'),
          p = document.createElement('p');
        img.src = tile.url;
        p.textContent = tile.name;
        figure.append(img, p);
        main.append(figure)
      }
    }, tiles);
    await gallery.screenshot({
      path: `${artifacts}/all-arenas-powerups.png`,
      fullPage: true
    });
    await gallery.close();
    const symbols = await p.evaluate(() => ROYAL_TYPES.map(type => ({
      type,
      url: royalPickupSprite(type).toDataURL()
    })));
    const preview = await browser.newPage({
      viewport: {
        width: 720,
        height: 330
      }
    });
    await preview.setContent(
      '<style>body{margin:0;padding:24px;background:#080510;color:#fff;font:16px monospace}main{display:flex;justify-content:space-around;text-align:center}img{display:block;width:120px;height:120px;image-rendering:pixelated;margin:12px auto}small img{width:48px;height:48px;filter:grayscale(1)}</style><main></main>'
      );
    await preview.evaluate(symbols => {
      for (const s of symbols) {
        const el = document.createElement('div'),
          name = document.createElement('span'),
          img = document.createElement('img'),
          small = document.createElement('small');
        name.textContent = {
          split: 'Royal Split',
          rush: 'Crown Rush',
          guard: 'Castle Guard'
        } [s.type];
        img.src = s.url;
        small.append(img.cloneNode());
        el.append(name, img, small);
        document.querySelector('main').append(el)
      }
    }, symbols);
    await preview.screenshot({
      path: `${artifacts}/powerup-symbols.png`
    });
    await preview.close();
    await writeFile(`${artifacts}/timing-and-work-counts.json`, JSON.stringify(metrics, null, 2) + '\n');
  }
  await p.context().close();
  await rasterChecks();
  assert.deepEqual(errors, []);
  pass('all checks completed without page exceptions');
  console.log(`RESULT: ${checks} engineering browser groups passed (${engine.name()})`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve))
}
