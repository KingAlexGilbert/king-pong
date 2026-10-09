import assert from 'node:assert/strict';

// Production UI paths; no profiling or test hooks are shipped with the game.
export async function reviewBrowserChecks({page, bounds, snap, pass}) {
  const rects = p => p.evaluate(() => {
    const box = selector => {
      const el = document.querySelector(selector), r = el.getBoundingClientRect();
      return {x: r.x, y: r.y, width: r.width, height: r.height};
    };
    return {arena: box('#game'), card: box('#matchBar'), title: box('.match-pause-title'),
      info: box('.match-identity'), menu: box('#menuToggle'), resume: box('#matchPause')};
  });
  const centered = ({arena, card, title, info, menu, resume}) => {
    assert.ok(Math.abs(card.x + card.width / 2 - arena.x - arena.width / 2) < 2);
    assert.ok(Math.abs(card.y + card.height / 2 - arena.y - arena.height / 2) < 2);
    assert.ok(card.width <= 480 && card.width < arena.width);
    assert.ok(title.y + title.height <= info.y && info.y + info.height <= menu.y);
    assert.ok(Math.abs(menu.y - resume.y) < 2);
    assert.ok(resume.x - menu.x - menu.width <= 24, 'pause actions stay together');
  };
  const start = async p => {
    await p.locator('#titleCampaignButton').click();
    if (await p.locator('#rotateDismiss').isVisible()) await p.locator('#rotateDismiss').click();
    await p.locator('#matchContinue').click();
    assert.equal(await p.evaluate(() => waitingForServe), false);
  };
  const pause = async p => {
    await p.keyboard.press('p');
    if (await p.locator('#matchMenu').isVisible()) await p.keyboard.press('m');
    assert.equal(await p.evaluate(() => paused), true);
  };
  const desktops = [[1280, 720, 1], [1366, 768, 1], [1920, 1080, 1], [2560, 1440, 1], [3840, 2160, 1],
    // Equivalent CSS viewport/DPR pairs for a 1920x1080 screen at 125/150/200% scaling.
    [1536, 864, 1.25], [1280, 720, 1.5], [960, 540, 2],
    // 4K at 300% scaling, also checking the longer German match labels.
    [1280, 720, 3, 'de-DE']];
  for (const [width, height, deviceScaleFactor, locale = 'en-US'] of desktops) {
    const p = await page('Browser', {viewport: {width, height}, deviceScaleFactor, locale});
    await start(p);
    const playing = (await rects(p)).arena;
    assert.ok(Math.abs(playing.x + playing.width / 2 - width / 2) < 1, 'arena is horizontally centered');
    await pause(p);
    assert.equal(await p.locator('#matchBar').evaluate(el => el.classList.contains('match-bar-paused')), true);
    const paused = await rects(p);
    centered(paused);
    assert.deepEqual(paused.arena, playing, 'pausing does not move the arena');
    for (const selector of ['#game', '#matchBar', '#matchContext', '#menuToggle', '#matchPause']) await bounds(p, selector);
    await snap(p, `pause-${width}x${height}-dpr${deviceScaleFactor}`);
    await p.locator('#menuToggle').click();
    assert.equal(await p.locator('#matchMenu').isVisible(), true);
    assert.deepEqual((await rects(p)).arena, playing, 'opening Menu does not move the arena');
    await p.keyboard.press('m');
    centered(await rects(p));
    await p.locator('#matchPause').click();
    assert.equal(await p.evaluate(() => hasResumeCountdown()), true);
    assert.equal(await p.locator('#matchBar').evaluate(el => el.classList.contains('match-bar-paused')), false);
    assert.deepEqual((await rects(p)).arena, playing, 'resuming does not move the arena');
    // Advance only the presentation countdown in this RAF-controlled UI fixture.
    await p.evaluate(() => {resumeCountdownEndAt = 0; paused = false; syncRoyalUi(true);});
    await pause(p);
    await p.setViewportSize({width: 1100, height: 700});
    await p.evaluate(() => {handleViewportChange(); syncRoyalUi(true);});
    centered(await rects(p));
    await bounds(p, '#game');
    await p.context().close();
  }
  pass('desktop pause card and arena stay centered at five desktop sizes, four scaling pairs and live resize');

  const terminal = await page();
  await start(terminal);
  for (const flag of ['waitingForServe', 'gameOver', 'levelCleared', 'campaignCleared']) {
    const result = await terminal.evaluate(flag => {
      waitingForServe = gameOver = levelCleared = campaignCleared = false;
      if (flag === 'waitingForServe') waitingForServe = true;
      if (flag === 'gameOver') gameOver = true;
      if (flag === 'levelCleared') levelCleared = true;
      if (flag === 'campaignCleared') campaignCleared = true;
      paused = true;
      menusVisible = false;
      syncRoyalUi(true);
      const labels = [], original = drawText;
      try {
        drawText = (text, ...args) => {labels.push(text); original(text, ...args);};
        draw();
      } finally {drawText = original;}
      return {pauseCard: royalDesktopPauseVisible(), labels};
    }, flag);
    assert.equal(result.pauseCard, false, 'pause styling does not replace serve or result overlays');
    const label = {gameOver: 'LEVEL FAILED', levelCleared: 'LEVEL CLEARED', campaignCleared: 'CAMPAIGN COMPLETE'}[flag];
    if (label) assert.ok(result.labels.includes(label), 'existing result message remains visible');
  }
  await terminal.context().close();
  pass('serve, game-over, level-clear and campaign-clear overlays remain visible when paused');

  for (const [width, height] of [[390, 844], [844, 390]]) {
    const p = await page('Browser', {viewport: {width, height}, deviceScaleFactor: 3, hasTouch: true, isMobile: true});
    await start(p);
    const playing = (await rects(p)).arena;
    await pause(p);
    assert.equal(await p.locator('#matchBar').evaluate(el => el.classList.contains('match-bar-paused')), false);
    assert.equal(await p.locator('.match-pause-title').isVisible(), false);
    assert.deepEqual((await rects(p)).arena, playing);
    for (const selector of ['#game', '#matchBar', '#menuToggle', '#matchPause']) await bounds(p, selector);
    await snap(p, `pause-mobile-${width}x${height}`);
    await p.locator('#matchPause').tap();
    assert.equal(await p.evaluate(() => hasResumeCountdown()), true);
    await p.context().close();
  }
  pass('mobile portrait and landscape retain the existing pause bar, arena placement and resume behavior');

  const snapshot = p => p.evaluate(() => JSON.stringify({...localStorage}));
  const openSaves = async p => {
    if (!await p.locator('.compact-saves').evaluate(el => el.open)) await p.locator('.compact-saves summary').click();
  };
  const seed = p => p.evaluate(() => {
    const fixtures = [0, 4, 18].map((completed, i) => ({...createDefaultSaveData(),
      createdAt: 1700000000000 + i, updatedAt: 1710000000000 + i,
      highestUnlockedLevel: Math.min(completed, 17), completedLevels: Array.from({length: 18}, (_, j) => j < completed),
      musicVolumePercent: [0, 42, 100][i], musicEnabled: i === 1, muteAll: i === 0, soundEffectsEnabled: i !== 2,
      customCpuIntel: 20 + i, customCpuMaxMove: 3 + i, bossUnlocked: completed === 18, bossCleared: completed === 18,
      royalPaddle: 'classic', royalPaddle2: 'classic', royalArena: i
    }));
    fixtures.forEach((slot, i) => localStorage.setItem(saveSlotKey(i), JSON.stringify(slot)));
    localStorage.setItem('unrelated-setting', 'preserved');
    loadSaveSlot(1);
    return fixtures;
  });
  const exportFile = async p => {
    const event = p.waitForEvent('download');
    await p.locator('#exportSavesButton').click();
    const download = await event;
    assert.equal(download.suggestedFilename(), 'KingPong-saves.json');
    const stream = await download.createReadStream(), chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.equal(await download.failure(), null);
    return Buffer.concat(chunks).toString('utf8');
  };
  const chooseFile = async (p, text) => {
    const event = p.waitForEvent('filechooser');
    await p.locator('#importSavesButton').click();
    const picker = await event;
    assert.equal(picker.isMultiple(), false);
    await picker.setFiles({name: 'KingPong-saves.json', mimeType: 'application/json', buffer: Buffer.from(text)});
    await p.waitForFunction(() => !saveTransferRequest, null, {polling: 20});
  };
  const confirmImport = async (p, text) => {
    const before = await snapshot(p);
    await chooseFile(p, text);
    assert.equal(await p.locator('#saveConfirmOverlay').isVisible(), true);
    assert.equal(await p.evaluate(() => document.activeElement.id), 'saveConfirmCancel');
    assert.equal(await snapshot(p), before, 'file selection alone never replaces saves');
    await p.locator('#saveConfirmAccept').click();
    assert.equal(await p.locator('#saveTransferStatus').innerText(), 'Saves imported.');
    assert.equal(await p.evaluate(() => localStorage.getItem(SAVE_IMPORT_JOURNAL)), null);
  };
  for (const [name, options] of [['desktop', {}],
    ['mobile-portrait', {viewport: {width: 390, height: 844}, deviceScaleFactor: 3, isMobile: true, hasTouch: true}],
    ['mobile-landscape', {viewport: {width: 844, height: 390}, deviceScaleFactor: 3, isMobile: true, hasTouch: true}]]) {
    const p = await page('Browser', options);
    const requests = [];
    p.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    const fixtures = await seed(p);
    await openSaves(p);
    await p.locator('.compact-saves').scrollIntoViewIfNeeded();
    for (const selector of ['.compact-saves', '#exportSavesButton', '#importSavesButton', '#eraseSaveButton']) await bounds(p, selector);
    assert.equal(await p.locator('.compact-saves .save-slot').count(), 3);
    await snap(p, 'save-slots-' + name);
    const exported = await exportFile(p), backup = JSON.parse(exported);
    assert.equal(backup.format, 'king-pong-saves');
    assert.equal(backup.version, 1);
    assert.equal(backup.activeSlot, 1);
    assert.deepEqual(backup.slots, fixtures);
    // Parse in each production native shell and import its own generated backup in the browser.
    // Native OS pickers are outside this browser-only test.
    for (const platform of ['Windows', 'Linux', 'Android']) {
      const native = await page(platform);
      assert.deepEqual(await native.evaluate(text => parseSaveBackup(text), exported), {activeSlot: 1, slots: fixtures});
      const nativeSlots = await seed(native);
      const nativeText = await native.evaluate(() => makeSaveBackup());
      await confirmImport(p, nativeText);
      assert.deepEqual(await p.evaluate(() => Array.from({length: 3}, (_, i) => readSaveSlot(i))), nativeSlots);
      await openSaves(p);
      await native.context().close();
    }
    const beforeCancel = await snapshot(p);
    await chooseFile(p, exported);
    await p.keyboard.press('Escape');
    assert.equal(await snapshot(p), beforeCancel);
    assert.equal(await p.locator('#saveConfirmOverlay').isVisible(), false);
    const pickerEvent = p.waitForEvent('filechooser');
    await p.locator('#importSavesButton').click();
    await pickerEvent;
    // Playwright cannot dismiss the OS picker; exercise its browser cancel event.
    await p.locator('input[type=file]').dispatchEvent('cancel');
    assert.equal(await snapshot(p), beforeCancel);
    assert.equal(await p.locator('#importSavesButton').isEnabled(), true);
    for (const invalid of ['{broken', '{}', JSON.stringify({...backup, version: 99}),
      JSON.stringify({...backup, slots: backup.slots.slice(0, 2)}),
      JSON.stringify({...backup, slots: [{...backup.slots[0], completedLevels: [true]}, null, null]}), 'x'.repeat(65537)]) {
      await chooseFile(p, invalid);
      assert.equal(await snapshot(p), beforeCancel);
      assert.equal(await p.locator('#saveConfirmOverlay').isVisible(), false);
      assert.match(await p.locator('#saveTransferStatus').innerText(), /valid King Pong|could not be opened/);
    }
    for (let i = 0; i < 2; i++) {
      await confirmImport(p, exported);
      await openSaves(p);
      assert.deepEqual(JSON.parse(await exportFile(p)).slots, fixtures);
      await p.reload();
      await openSaves(p);
      assert.deepEqual(await p.evaluate(() => Array.from({length: 3}, (_, i) => readSaveSlot(i))), fixtures);
    }
    const previous = await p.evaluate(() => Array.from({length: 3}, (_, i) => localStorage.getItem(saveSlotKey(i))));
    await p.evaluate(previous => {
      localStorage.setItem(SAVE_IMPORT_JOURNAL, JSON.stringify(previous));
      localStorage.removeItem(saveSlotKey(0));
      localStorage.setItem(saveSlotKey(2), JSON.stringify(createDefaultSaveData()));
    }, previous);
    await p.reload();
    assert.deepEqual(await p.evaluate(() => Array.from({length: 3}, (_, i) => localStorage.getItem(saveSlotKey(i)))), previous);
    assert.equal(await p.evaluate(() => localStorage.getItem(SAVE_IMPORT_JOURNAL)), null);
    assert.equal(await p.evaluate(() => localStorage.getItem('unrelated-setting')), 'preserved');
    // A malformed recovery journal blocks changes, preserving the original slot strings.
    await p.evaluate(() => localStorage.setItem(SAVE_IMPORT_JOURNAL, '{interrupted'));
    await p.reload();
    await openSaves(p);
    assert.equal(await p.locator('#importSavesButton').isDisabled(), true);
    assert.equal(await p.locator('#eraseSaveButton').isDisabled(), true);
    await p.evaluate(() => saveProgressNow());
    assert.deepEqual(await p.evaluate(() => Array.from({length: 3}, (_, i) => localStorage.getItem(saveSlotKey(i)))), previous);
    assert.equal(requests.filter(url => new URL(url).origin !== new URL(p.url()).origin).length, 0, 'transfers use no external service');
    await p.context().close();
  }
  pass('desktop/mobile browser downloads, file picker, native-format round trips, confirmation, cancellation, invalid files and reload recovery');
}
