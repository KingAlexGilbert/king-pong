import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { builds, root } from '../../tests/helpers/game-source.mjs';
// Render production builds. Network state fixtures test UI/protocol only;
// browser.mjs remains the independent real-WebRTC gate.
const server = createServer(async (request, response) => {
  try {
    const file = new URL('.' + new URL(request.url, 'http://localhost').pathname, root);
    if (!file.href.startsWith(root.href)) throw new Error();
    response.setHeader('Content-Type', file.pathname.endsWith('.js') ? 'text/javascript' : 'text/html');
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const errors = [], artifacts = process.env.KING_PONG_TEST_ARTIFACTS;
let checks = 0;
if (artifacts) await mkdir(artifacts, { recursive: true });
const pass = label => { checks++; console.log('PASS: ' + label); };
async function page(platform = 'Browser', options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
  const p = await context.newPage(); p.on('pageerror', e => errors.push(platform + ': ' + e.message));
  await p.addInitScript(() => {
    window.requestAnimationFrame = () => 1;
    // Refusal tests without headless fullscreen replacing the emulated viewport.
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.requestFullscreen = async () => { window.fullscreenAttempts = (window.fullscreenAttempts || 0) + 1; throw new Error('Fullscreen refused'); };
    }, { once: true });
  });
  await p.goto(origin + '/' + builds[platform]); return p;
}
async function snap(p, name) {
  await p.evaluate(() => { syncRoyalUi(); if (!document.body.classList.contains('title-active')) draw(); });
  if (artifacts) { await p.waitForTimeout(200); await p.screenshot({ path: `${artifacts}/${name}.png` }); }
}
async function active(p, expected) {
  const chapters = expected.filter(id => id.startsWith('campaign-'));
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('.match-mode-grid .active')].map(b => b.id)), expected.map(id => id.startsWith('campaign-') ? 'menuCampaign' : id));
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('.campaign-chapters .chapter-active')].map(b => 'campaign-' + b.dataset.campaign)), chapters);
  assert.equal(await p.locator('#lanModeButton').getAttribute('aria-pressed'), String(expected.includes('lanModeButton')));
}
async function bounds(p, selector) {
  const b = await p.locator(selector).evaluate(el => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, right: b.right, bottom: b.bottom, width: innerWidth, height: innerHeight, overflow: el.scrollWidth > el.clientWidth + 1 }; });
  assert.ok(b.x >= 0 && b.y >= 0 && b.right <= b.width + 1 && b.bottom <= b.height + 1, `${selector}: ${JSON.stringify(b)}`);
  assert.equal(b.overflow, false, selector + ' has no horizontal overflow');
}
async function local(p) { await p.locator('#titleLocalButton').click(); await p.locator('#titleTwoPlayerButton').click(); }
async function unlock(p) { await p.evaluate(() => { saveData.completedLevels.fill(true); saveData.highestUnlockedLevel = 17; saveData.bossUnlocked = true; saveProgressNow(); updateModeControls(); }); }
try {
  for (const platform of Object.keys(builds)) {
    const p = await page(platform); await active(p, []);
    await p.locator('.compact-saves summary').focus(); await p.keyboard.press('Enter');
    await p.locator('[data-save-slot="1"]').click(); await active(p, []);
    await p.locator('[data-save-slot="0"]').click(); await snap(p, platform + '-saves');
    await p.locator('.compact-saves summary').click();
    const before = await p.evaluate(() => JSON.stringify(saveData));
    await local(p); await active(p, ['twoPlayerModeButton']);
    assert.equal(await p.locator('#lanPanel').isVisible(), false);
    assert.equal(await p.locator('#matchSetup').isVisible(), true);
    await p.locator('#choosePaddleButton').click();
    assert.equal(await p.locator('.royal-choice:not(:disabled)').count(), 42);
    await p.locator('[data-choice-id="boss-8"]').click();
    assert.equal(await p.evaluate(() => document.activeElement.id), 'choosePaddleButton');
    await p.locator('#choosePaddle2Button').click(); await p.locator('[data-choice-id="enemy-15"]').click();
    assert.deepEqual(await p.evaluate(() => matchPaddles), { left: 'boss-8', right: 'enemy-15' });
    assert.equal(await p.evaluate(() => JSON.stringify(saveData)), before);
    await p.locator('#chooseArenaButton').click();
    assert.equal(await p.locator('.royal-choice').count(), 19);
    assert.equal(await p.locator('.royal-choice:not(:disabled)').count(), 18);
    await p.keyboard.press('Escape'); await active(p, ['twoPlayerModeButton']); await snap(p, platform + '-fresh-local-setup');
    await p.locator('#matchServe').click(); assert.equal(await p.evaluate(() => waitingForServe), false);
    assert.equal(await p.locator('#choosePaddleButton').isVisible(), false);
    assert.equal(await p.locator('#musicButton').isVisible(), false);
    await p.keyboard.press('m'); assert.equal(await p.evaluate(() => paused), true);
    assert.equal(await p.locator('#matchMenu').isVisible(), true);
    await p.locator('#matchSettings summary').click();
    await p.locator('#musicVolumeSlider').focus(); await p.keyboard.press('ArrowLeft');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'musicVolumeSlider');
    await p.locator('#matchHelp summary').click();
    assert.match(await p.locator('#matchHelp').innerText(), /Royal Split.*Crown Rush.*Castle Guard/s);
    await snap(p, platform + '-settings-help');
    await p.locator('#matchMenuClose').focus(); await p.keyboard.press('Tab');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'matchResume');
    await p.locator('#titleJumpButton').click(); await active(p, []);
    await p.locator('.title-paddle').click();
    assert.equal(await p.locator('[data-choice-id="boss-8"]').isDisabled(), true);
    assert.equal(await p.locator('[data-choice-id="enemy-15"]').isDisabled(), true);
    await p.keyboard.press('Escape'); await p.locator('#titleCampaignButton').click(); await active(p, ['campaign-0']);
    assert.equal(await p.evaluate(() => savedPaddle()), 'classic'); assert.equal(await p.evaluate(() => saveData.highestUnlockedLevel), 0);
    pass(platform + ': fresh multiplayer catalog, both players, arena access, Campaign isolation and accessible menu');
    await unlock(p);
    for (const c of [0, 1, 2]) {
      await p.evaluate(c => setCampaign(c, true), c); await active(p, ['campaign-' + c]);
      await p.evaluate(() => requestRetryLevel()); await active(p, ['campaign-' + c]); await snap(p, platform + '-campaign-' + c);
    }
    await p.evaluate(() => { showTitleScreen(); startCustomFromSave(); }); await active(p, ['customModeButton']);
    assert.equal(await p.locator('#choosePaddle2Button').isVisible(), false);
    await p.locator('#matchCpuSettings summary').click(); await snap(p, platform + '-custom-setup');
    await p.locator('#matchServe').click(); await active(p, ['customModeButton']);
    await p.evaluate(() => { showTitleScreen(); startBossFromTitle(); });
    await p.waitForFunction(() => mode === 4 && !bossIntroActive, null, { polling: 50 });
    await active(p, ['menuBoss']); await snap(p, platform + '-secret-boss');
    assert.equal(await p.locator('#matchBar').isVisible(), true, 'boss intro completion restores the match controls');
    await p.evaluate(() => { showTitleScreen(); startLanTwoPlayerSetup(true); }); await active(p, ['lanModeButton']);
    assert.equal(await p.locator('#lanPanel').isVisible(), true); assert.equal(await p.locator('#choosePaddle2Button').isVisible(), false);
    await p.evaluate(() => { lanRole = 'host'; lanConnected = true; showTitleScreen(); startTwoPlayerFromTitle(); });
    assert.equal(await p.evaluate(() => lanRole), 'none'); await active(p, ['twoPlayerModeButton']);
    await p.evaluate(() => startLanTwoPlayerSetup(false));
    await p.locator('#setupMenuButton').click(); await p.locator('#matchModes summary').click();
    await p.locator('button[data-campaign="1"]').click(); await active(p, ['campaign-1']);
    assert.equal(await p.locator('#lanPanel').isVisible(), false);
    await p.evaluate(() => { showTitleScreen(); loadSaveSlot(1); }); await active(p, []);
    pass(platform + ': Campaign chapters, Custom, Boss, online entry/exit, restart and slot mode states');
    await p.context().close();
  }
  for (const platform of Object.keys(builds)) {
    const p = await page(platform); await local(p);
    assert.equal(await p.locator('.setup-change').filter({ visible: true }).count(), 3);
    await p.locator('#matchRule-quick').focus(); await p.keyboard.press('Enter');
    assert.equal(await p.evaluate(() => matchRuleId), 'quick');
    assert.equal(await p.locator('#matchRule-quick').getAttribute('aria-pressed'), 'true');
    await snap(p, platform + '-rules-setup');
    await p.locator('#setupMenuButton').click(); await p.locator('#matchModes summary').click();
    assert.equal(await p.locator('.campaign-mode-group [data-campaign]').count(), 3);
    assert.equal(await p.locator('.match-mode-grid > button[data-campaign]').count(), 0);
    await snap(p, platform + '-campaign-hierarchy');
    await p.locator('#matchModes summary').click(); await p.locator('#matchSettings summary').click();
    await p.locator('#soundEffectsButton').click(); await p.locator('#muteAllButton').click();
    assert.deepEqual(await p.evaluate(() => [saveData.muteAll, musicEnabled, saveData.soundEffectsEnabled]), [true, true, false]);
    assert.equal(await p.evaluate(() => gameAudioEnabled('music') || gameAudioEnabled('sfx')), false);
    await p.locator('#musicVolumeSlider').fill('37'); await p.locator('#musicVolumeSlider').dispatchEvent('input');
    await snap(p, platform + '-audio-muted');
    await p.reload();
    assert.deepEqual(await p.evaluate(() => [saveData.muteAll, musicEnabled, saveData.soundEffectsEnabled, musicVolumeLevel]), [true, true, false, .37]);
    await local(p); await p.locator('#setupMenuButton').click(); await p.locator('#matchSettings summary').click(); await p.locator('#muteAllButton').click();
    assert.deepEqual(await p.evaluate(() => [musicEnabled, saveData.soundEffectsEnabled, gameAudioEnabled('music'), gameAudioEnabled('sfx')]), [true, false, true, false]);
    await p.locator('#musicButton').click(); await p.locator('#soundEffectsButton').click();
    assert.deepEqual(await p.evaluate(() => [gameAudioEnabled('music'), gameAudioEnabled('sfx')]), [false, true]);
    await p.locator('#matchSettings summary').click(); await p.locator('#matchHelp summary').click();
    for (const id of ['helpKeyboard','helpController','helpTouch','helpPowerups']) assert.equal(await p.locator('#'+id).isVisible(),true);
    await snap(p, platform + '-structured-help');
    await p.context().close();
    pass(platform + ': rule selection, nested Campaign chapters, structured help and independent saved audio controls');
  }
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 1024, height: 600 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 360, height: 640 }]) {
    const mobile = Math.min(viewport.width, viewport.height) < 500;
    const p = await page('Browser', { viewport, hasTouch: mobile, isMobile: mobile }), prefix = viewport.width + 'x' + viewport.height;
    await bounds(p, '.title-card'); await bounds(p, '.title-subtitle');
    assert.equal(await p.locator('.title-subtitle span').count(), 2);
    const lines = await p.locator('.title-subtitle span').evaluateAll(spans => spans.map(s => ({ top: s.getBoundingClientRect().top, height: s.getBoundingClientRect().height, line: parseFloat(getComputedStyle(s).lineHeight) })));
    assert.ok(lines.every(b => b.height <= b.line + 1), 'tagline phrases stay whole');
    if (viewport.width >= 1024) assert.equal(lines[0].top, lines[1].top, 'wide tagline is a single line');
    await snap(p, prefix + '-title'); await local(p); await bounds(p, '#matchSetup .match-card'); await bounds(p, '#matchServe');
    if (viewport.width > viewport.height && viewport.height < 520) {
      assert.equal(await p.locator('.setup-change').evaluateAll(labels => labels.every(label => label.getBoundingClientRect().bottom <= document.getElementById('matchSetupBody').getBoundingClientRect().bottom)), true);
    }
    await snap(p, prefix + '-setup');
    await p.locator('#choosePaddleButton').click(); await bounds(p, '.royal-gallery-card'); await snap(p, prefix + '-paddles');
    await p.locator('[data-choice-id="player-16"]').click();
    await p.locator('#chooseArenaButton').click(); await bounds(p, '.royal-gallery-card'); await snap(p, prefix + '-arenas');
    await p.locator('[data-choice-id="4"]').click(); await p.locator('#matchServe').click(); await bounds(p, '#game');
    if (mobile && viewport.height > viewport.width) { assert.equal(await p.locator('#rotateDevice').isVisible(), true); await snap(p, prefix + '-rotate'); await p.locator('#rotateDismiss').click(); }
    await p.evaluate(() => { gameWindowFocused = true; ball.lastHit = 'left'; awardRoyalPowerup('split'); awardRoyalPowerup('rush'); awardRoyalPowerup('guard'); });
    await snap(p, prefix + '-royal-gameplay'); await p.locator('#menuToggle').click(); await p.locator('#matchModes summary').click();
    await bounds(p, '#matchMenu .match-card'); await snap(p, prefix + '-menu');
    await p.locator('#matchModes summary').click(); await p.locator('#matchSettings summary').click(); await bounds(p, '#matchMenu .match-card'); await snap(p, prefix + '-audio');
    await p.locator('#matchSettings summary').click(); await p.locator('#matchHelp summary').click(); await bounds(p, '#matchMenu .match-card'); await snap(p, prefix + '-help');
    await p.locator('#helpPowerups').scrollIntoViewIfNeeded(); await snap(p, prefix + '-powerup-help');
    await p.locator('#matchHelp summary').click(); await p.locator('#matchModes summary').click(); await p.locator('#lanModeButton').click();
    await bounds(p, '#matchSetup .match-card'); await snap(p, prefix + '-online');
    await p.locator('#lanJoinButton').click(); await p.locator('#lanRoomCodeInput').fill('OOOOO'); await p.locator('#onlineJoinSubmit').click();
    await bounds(p, '#matchSetup .match-card'); await snap(p, prefix + '-join-error'); assert.match(await p.locator('#lanStatus').innerText(), /valid five-character/);
    await p.evaluate(() => { window.KING_PONG_SIGNALING_URL = ''; hostLanMatch(); }); assert.equal(await p.locator('#lanHostButton').isVisible(), true); await snap(p, prefix + '-connection-error');
    await p.evaluate(() => { lanRole = 'host'; lanRoomCode = 'ABCDE'; setOnlineControls(true); byId('onlineRoomCode').textContent = lanRoomCode; byId('onlineCodeDisplay').hidden = false; setLanStatus('Waiting for Player 2...'); updateModeControls(); });
    await bounds(p, '#matchSetup .match-card'); await snap(p, prefix + '-waiting');
    await p.evaluate(() => setLanStatus('Connecting...')); await snap(p, prefix + '-connecting');
    pass(prefix + ': title, setup, galleries, powerups, menu and online room states fit the viewport'); await p.context().close();
  }
  const host = await page(), guest = await page();
  for (const [p, role] of [[host, 'host'], [guest, 'guest']]) await p.evaluate(role => {
    startLanTwoPlayerSetup(true); lanRole = role; lanConnected = true; onlineGameBlocked = false; lanRoomCode = 'ABCDE';
    lanChannel = { readyState: 'open', bufferedAmount: 0, send: value => (window.outbound ||= []).push(value) };
    onlineControlChannel = lanChannel; setMenusVisible(false); setOnlineControls(true); byId('onlineRoomCode').textContent = lanRoomCode; updateModeControls(); setLanStatus('Connected!');
  }, role);
  const saves = await Promise.all([host, guest].map(p => p.evaluate(() => JSON.stringify(saveData))));
  await host.locator('#choosePaddleButton').click(); await host.locator('[data-choice-id="boss-8"]').click();
  await guest.locator('#choosePaddleButton').click(); assert.equal(await guest.locator('.royal-choice:not(:disabled)').count(), 42);
  await guest.locator('[data-choice-id="enemy-15"]').click();
  const selections = await guest.evaluate(() => window.outbound.map(JSON.parse).filter(m => m.type === 'selection'));
  assert.equal(selections.at(-1).paddle, 'enemy-15'); assert.deepEqual(Object.keys(selections.at(-1)).sort(), ['gameplay', 'matchRules', 'paddle', 'room', 'seq', 'type', 'v']);
  await host.evaluate(m => handleLanMessage(JSON.stringify(m)), selections.at(-1));
  assert.deepEqual(await host.evaluate(() => matchPaddles), { left: 'boss-8', right: 'enemy-15' });
  await guest.evaluate(() => openRoyalGallery('arena')); assert.equal(await guest.locator('#royalGallery').isVisible(), false); assert.equal(await guest.locator('#chooseArenaButton').isVisible(), false);
  const deliver = async () => {
    const packets = await host.evaluate(() => { const list = window.outbound || []; window.outbound = []; return list; });
    for (const packet of packets) await guest.evaluate(packet => handleLanMessage(packet), packet);
  };
  await host.locator('#matchRule-winTwo').click(); await deliver();
  assert.equal(await guest.evaluate(() => matchRuleId), 'winTwo');
  assert.equal(await guest.locator('.match-rule-options').isVisible(), false);
  assert.match(await guest.locator('#matchRulesSummary').innerText(), /Win by Two/);
  assert.equal(await guest.evaluate(() => setMatchRule('quick')), false);
  const hostState = await host.evaluate(() => JSON.stringify([matchRulePayload(),left,right,ball,royalPickup]));
  await host.evaluate(() => handleLanMessage(JSON.stringify({v:LAN_SIGNAL_VERSION,gameplay:'royal',matchRules:'presets',room:lanRoomCode,type:'rules',rules:{id:'endless',revision:999},leftScore:999,royal:{pickup:{x:0,y:0}}})));
  assert.equal(await host.evaluate(() => JSON.stringify([matchRulePayload(),left,right,ball,royalPickup])), hostState);
  await snap(host, 'online-connected-host'); await snap(guest, 'online-connected-guest');
  await host.evaluate(() => { waitingForServe=false;left.score=right.score=9;pointForPlayer();frame+=3;sendLanState(true); }); await deliver();
  assert.deepEqual(await guest.evaluate(() => [left.score,right.score,gameOver]),[10,9,false]);
  await host.evaluate(() => { waitingForServe=false;pointForPlayer();frame+=3;sendLanState(true); }); await deliver();
  assert.deepEqual(await guest.evaluate(() => [left.score,right.score,gameOver]),[11,9,true]);
  await snap(guest, 'online-win-by-two-finish');
  await host.evaluate(() => { retryLevel(false);setMatchRule('endless');waitingForServe=false;left.score=12345;right.score=12344;pointForPlayer();frame+=3;sendLanState(true); }); await deliver();
  assert.deepEqual(await guest.evaluate(() => [matchRuleId,left.score,right.score,gameOver]),['endless',12346,12344,false]);
  await host.evaluate(() => { waitingForServe=false;right.y=280;frame+=3;sendLanState(true); }); await deliver();
  const stableGuest = await guest.evaluate(() => JSON.stringify([ball,left.score,right.score]));
  await guest.evaluate(() => { onlineSession={close(){}};right.y=90;setMenusVisible(false);syncRoyalUi(true);renderFrame(.5,performance.now()); });
  assert.equal(await guest.evaluate(() => JSON.stringify([ball,left.score,right.score])), stableGuest);
  assert.equal(await guest.locator('#matchMenu').isVisible(),false); assert.equal(await guest.locator('#matchSetup').isVisible(),false);
  if (artifacts) await guest.screenshot({path:artifacts+'/guest-prediction-cursor.png'});
  pass('reliable host rules, read-only guest setup, forged-rule rejection, Win by Two and long Endless score synchronization');
  for (let i = 0; i < 2; i++) {
    const p = [host, guest][i]; await p.evaluate(() => { showTitleScreen(); startCampaignFromSave(); });
    assert.equal(await p.evaluate(() => JSON.stringify(saveData)), saves[i]); assert.equal(await p.evaluate(() => paddleUnlocked(paddleCatalog.find(e => e.id === 'boss-8'))), false);
    await active(p, ['campaign-0']); await p.context().close();
  }
  pass('host/guest session paddles leave saves unchanged; guest cannot browse host arenas');
  const phone = await page('Browser', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await local(phone); assert.equal(await phone.locator('#rotateDevice').isVisible(), false); await phone.locator('#matchServe').click(); assert.equal(await phone.locator('#rotateDevice').isVisible(), true);
  const stable = () => phone.evaluate(() => JSON.stringify([mode, left, right, ball, saveData, lanRole, lanRoomCode])); const beforeRotation = await stable();
  await phone.setViewportSize({ width: 844, height: 390 }); assert.equal(await phone.locator('#rotateDevice').isVisible(), false); assert.equal(await stable(), beforeRotation);
  await phone.setViewportSize({ width: 390, height: 844 }); assert.equal(await phone.locator('#rotateDevice').isVisible(), true);
  await phone.locator('#rotateMenu').click(); assert.equal(await phone.locator('#matchMenu').isVisible(), true); await phone.locator('#matchMenuClose').click(); await phone.locator('#rotateDismiss').click();
  for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) await phone.setViewportSize(viewport);
  assert.equal(await phone.locator('#rotateDevice').isVisible(), false); assert.equal(await phone.evaluate(() => window.fullscreenAttempts), 1);
  assert.equal(await phone.evaluate(() => { let n = 0; const add = window.addEventListener; window.addEventListener = (...args) => { n++; return add.apply(window, args); }; initRoyalUi(); initRoyalUi(); window.addEventListener = add; return n; }), 0);
  await phone.evaluate(() => { showTitleScreen(); startLanTwoPlayerSetup(true); lanRole = 'guest'; lanRoomCode = 'ABCDE'; lanConnected = true; onlineGameBlocked = false; waitingForServe = false; left.score = 2; right.score = 1; syncRoyalUi(true); });
  const onlineBefore = await stable(); await phone.setViewportSize({ width: 844, height: 390 }); assert.equal(await stable(), onlineBefore); await snap(phone, 'rotated-online-guest');
  await phone.evaluate(() => showTitleScreen());
  assert.equal(await phone.evaluate(() => royalOrientationAttempted), false);
  await phone.locator('#titleCampaignButton').tap();
  assert.equal(await phone.evaluate(() => window.fullscreenAttempts), 2);
  await phone.context().close();
  pass('portrait prompt, navigation, dismissal, one lock attempt, listener lifetime and local/online rotation state');
  const inputs = await page(); await local(inputs);
  await inputs.evaluate(() => {
    window.testPad = { index: 0, axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
    navigator.getGamepads = () => [window.testPad];
    byId('choosePaddleButton').focus(); testPad.buttons[0].pressed = true; pollRoyalUiGamepad(1000);
  });
  assert.equal(await inputs.locator('#royalGallery').isVisible(), true);
  await inputs.evaluate(() => { testPad.buttons[0].pressed = false; pollRoyalGalleryGamepad(1040); testPad.axes[0] = 1; pollRoyalGalleryGamepad(1080); testPad.axes[0] = 0; testPad.buttons[0].pressed = true; pollRoyalGalleryGamepad(1120); });
  assert.equal(await inputs.locator('#royalGallery').isVisible(), false);
  await inputs.evaluate(() => { testPad.buttons[0].pressed = false; pollRoyalUiGamepad(1160); byId('matchRule-quick').focus(); testPad.buttons[0].pressed = true; pollRoyalUiGamepad(1200); testPad.buttons[0].pressed=false; pollRoyalUiGamepad(1240); byId('matchServe').focus(); testPad.buttons[0].pressed=true; pollRoyalUiGamepad(1280); });
  assert.equal(await inputs.evaluate(() => waitingForServe), false); assert.equal(await inputs.evaluate(() => matchRuleId), 'quick');
  await inputs.evaluate(() => { testPad.buttons[0].pressed = false; updateGamepadInput(); testPad.buttons[9].pressed = true; updateGamepadInput(); });
  assert.equal(await inputs.evaluate(() => paused), true); assert.equal(await inputs.locator('#matchMenu').isVisible(), true);
  await inputs.evaluate(() => { testPad.buttons[9].pressed = false; pollRoyalUiGamepad(1360); testPad.buttons[9].pressed = true; pollRoyalUiGamepad(1400); });
  assert.equal(await inputs.evaluate(() => hasResumeCountdown()), true);
  assert.equal(await inputs.locator('#matchMenu').isVisible(), false);
  await inputs.evaluate(() => { navigator.getGamepads = () => []; resumeCountdownEndAt = 0; paused = false; gameWindowFocused = true; });
  const leftY = await inputs.evaluate(() => left.y); await inputs.keyboard.down('w'); await inputs.evaluate(() => update()); await inputs.keyboard.up('w'); assert.ok(await inputs.evaluate(() => left.y) < leftY);
  const rightY = await inputs.evaluate(() => right.y); await inputs.keyboard.down('ArrowDown'); await inputs.evaluate(() => update()); await inputs.keyboard.up('ArrowDown'); assert.ok(await inputs.evaluate(() => right.y) > rightY);
  await inputs.keyboard.press('m'); await inputs.locator('#matchSettings summary').click();
  await inputs.locator('#playInfoToggle').focus(); await inputs.keyboard.press('Enter');
  assert.equal(await inputs.evaluate(() => playInfoVisible), false);
  await inputs.context().close();
  const touch = await page('Browser', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  await touch.locator('#titleLocalButton').tap(); await touch.locator('#titleTwoPlayerButton').tap();
  await touch.locator('#choosePaddleButton').tap(); await touch.locator('[data-choice-id="boss-8"]').tap(); await touch.locator('#matchRule-endless').tap(); assert.equal(await touch.evaluate(()=>matchRuleId),'endless'); await touch.locator('#matchServe').tap();
  const box = await touch.locator('#game').boundingBox(); const paddleBefore = await touch.evaluate(() => left.y);
  const point = { pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: box.x + 30, clientY: box.y + box.height / 2, buttons: 1, bubbles: true };
  await touch.locator('#game').dispatchEvent('pointerdown', point);
  await touch.locator('#game').dispatchEvent('pointermove', { ...point, clientY: point.clientY + 45 });
  await touch.evaluate(() => updatePlayerPaddles([])); assert.ok(await touch.evaluate(() => left.y) > paddleBefore);
  await touch.locator('#game').dispatchEvent('pointerup', { ...point, clientY: point.clientY + 45, buttons: 0 });
  assert.equal(await touch.evaluate(() => activeTouchPointers.size), 0);
  await touch.locator('#menuToggle').tap();
  assert.equal(await touch.evaluate(() => isFullScreenTouchControlTarget(byId('matchMenuTitle'))), true);
  await touch.context().close(); pass('controller setup/gallery/serve/pause/resume, keyboard paddles, focused actions and touch drag stay functional');
  for (const locale of ['es-ES', 'fr-FR', 'de-DE', 'pt-BR', 'it-IT', 'nl-NL', 'ja-JP', 'ko-KR', 'zh-CN']) {
    const translated = await page('Browser', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale });
    await bounds(translated, '.title-card'); await bounds(translated, '.title-subtitle'); await snap(translated, locale + '-title');
    await translated.locator('#titleLanButton').tap(); await bounds(translated, '#matchSetup .match-card'); await snap(translated, locale + '-online');
    assert.notEqual(await translated.locator('#matchSetupHint').innerText(), 'Create a room or join a friend with their room code.');
    await translated.locator('#setupMenuButton').tap(); await translated.locator('#matchSettings summary').tap();
    await bounds(translated, '#matchMenu .match-card'); await snap(translated, locale + '-audio');
    assert.notEqual(await translated.locator('#muteAllButtonLabel').innerText(), 'Mute All');
    assert.notEqual(await translated.locator('#musicButtonLabel').innerText(), 'Music');
    await translated.locator('#matchSettings summary').tap(); await translated.locator('#matchHelp summary').tap();
    await translated.locator('#helpPowerups').scrollIntoViewIfNeeded(); await bounds(translated, '#matchMenu .match-card'); await snap(translated, locale + '-help');
    await translated.context().close();
  }
  pass('all nine translated phone layouts fit; contextual setup and orientation phrases are localized');

  const reduced = await page('Browser', { reducedMotion: 'reduce' }); await unlock(reduced);
  assert.equal(await reduced.locator('.primary-online').evaluate(e => getComputedStyle(e).animationName), 'none'); assert.equal(await reduced.locator('#titleBossButton').evaluate(e => getComputedStyle(e).animationName), 'none');
  const titleRows = await reduced.evaluate(() => [titleCampaignButton, titleCustomButton, byId('titleLocalButton'), titleBossButton].map(b => b.getBoundingClientRect().top));
  assert.equal(titleRows[0], titleRows[1]); assert.equal(titleRows[1], titleRows[2]); assert.ok(titleRows[3] > titleRows[2]);
  await snap(reduced, 'title-secret-boss-reduced-motion'); await reduced.context().close(); pass('gold and purple title actions respect reduced motion');
  assert.deepEqual(errors, []); console.log(`RESULT: ${checks} UI browser integration groups passed; no page exceptions`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
