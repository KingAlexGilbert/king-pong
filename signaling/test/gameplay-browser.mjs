import assert from 'node:assert/strict';
import {
  createServer
} from 'node:http';
import {
  readFile,
  mkdir
} from 'node:fs/promises';
import {
  chromium
} from 'playwright';
import {
  builds,
  root
} from '../../tests/helpers/game-source.mjs';

// These deterministic browser checks exercise real game/UI code. The peer bridge below
// deliberately tests gameplay messages separately from the real WebRTC test in browser.mjs.
const server = createServer(async (request, response) => {
  try {
    const file = new URL('.' + new URL(request.url, 'http://localhost').pathname, root);
    if (!file.href.startsWith(root.href)) throw new Error();
    response.setHeader('Content-Type', file.pathname.endsWith('.js') ? 'text/javascript' : 'text/html');
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox']
});
const errors = [];
let checks = 0;
const pass = label => {
  checks++;
  console.log('PASS: ' + label);
};
const artifacts = process.env.KING_PONG_TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, {
  recursive: true
});
async function page(platform = 'Browser', options = {}) {
  const context = await browser.newContext({
    viewport: {
      width: 1100,
      height: 800
    },
    ...options
  });
  const p = await context.newPage();
  p.on('pageerror', error => errors.push(`${platform}: ${error.message}`));
  p.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text());
  });
  await p.addInitScript(() => {
    // Advancing the real loop explicitly makes collision/packet/UI assertions reproducible.
    window.requestAnimationFrame = callback => {
      window.nextGameFrame = callback;
      return 1;
    };
  });
  await p.goto(origin + '/' + builds[platform]);
  return p;
}
async function screenshot(p, name) {
  if (artifacts) {
    await p.waitForTimeout(250);
    await p.screenshot({
      path: artifacts + '/' + name + '.png'
    });
  }
}
async function assertGalleryLayout(p) {
  const issues = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('.royal-choice')];
    const boxes = cards.map(c => c.getBoundingClientRect());
    return cards.filter((c, i) => {
      const box = boxes[i];
      const overflow = [...c.children].some(child => {
        const b = child.getBoundingClientRect();
        return b.top < box.top || b.bottom > box.bottom
      });
      const overlap = boxes.some((b, j) => i !== j && b.top > box.top && b.top < box.bottom && b.left === box
        .left);
      return box.height < 160 || overflow || overlap;
    }).map(c => c.textContent);
  });
  assert.deepEqual(issues, [], 'gallery previews/labels stay within non-overlapping rows');
}
try {
  for (const platform of Object.keys(builds)) {
    const p = await page(platform);
    assert.equal(await p.locator('.primary-online').innerText(), 'PLAY ONLINE');
    assert.equal(await p.locator('.compact-saves').getAttribute('open'), null);
    await p.locator('.compact-saves summary').focus();
    await p.keyboard.press('Enter');
    assert.notEqual(await p.locator('.compact-saves').getAttribute('open'), null);
    await p.keyboard.press('Space');
    assert.equal(await p.locator('.compact-saves').getAttribute('open'), null);
    assert.equal(await p.locator('#titleTwoPlayerButton').isVisible(), false);
    await screenshot(p, platform + '-landing');
    await p.locator('#titleLocalButton').click();
    await p.locator('#titleTwoPlayerButton').click();
    await p.locator('#chooseArenaButton').click();
    assert.equal(await p.locator('.royal-choice').count(), 19);
    assert.equal(await p.locator('.royal-choice:disabled').count(), 1);
    await p.locator('[data-choice-id="4"]').click();
    assert.equal(await p.evaluate(() => currentLevel() === CAMPAIGNS[0].levels[4]), true);
    assert.equal(await p.evaluate(() => saveData.royalArena), 4);
    await p.evaluate(() => {
      showTitleScreen();
      startTwoPlayerFromTitle();
    });
    await p.locator('#chooseArenaButton').click();
    assert.equal(await p.locator('[data-choice-id="4"]').getAttribute('aria-pressed'), 'true');
    await p.locator('#royalGalleryClose').click();
    pass(platform + ': primary online action, compact saves, Local Play, arena persistence and boss lock');

    await p.evaluate(() => {
      saveData.completedLevels.fill(true);
      saveData.highestUnlockedLevel = 17;
      saveData.bossUnlocked = true;
      saveProgressNow();
    });
    for (let id = 0; id < 19; id++) {
      await p.evaluate(() => openRoyalGallery('arena'));
      await p.locator(`[data-choice-id="${id}"]`).click();
      const arena = await p.evaluate(() => ({
        id: selectedAbsoluteLevelIndex(),
        same: currentLevel().hazards === arenaCatalog[matchArenaId].level.hazards,
        hazards: hazards.map(h => [h.type, h.x, h.y, h.w || 0, h.h || 0, h.r || 0]),
        source: currentLevel().hazards.map(h => [h.type, h.x, h.y, h.w || 0, h.h || 0, h.r || 0])
      }));
      assert.equal(arena.id, id);
      assert.equal(arena.same, true);
      assert.deepEqual(arena.hazards, arena.source);
    }
    await p.evaluate(() => openRoyalGallery('arena'));
    await assertGalleryLayout(p);
    await screenshot(p, platform + '-arenas');
    await p.locator('#royalGalleryClose').click();
    pass(platform + ': all 19 arena choices initialize the original hazard definitions');

    const ids = await p.evaluate(() => paddleCatalog.map(p => p.id));
    assert.equal(ids.length, 42);
    for (const id of ids) {
      await p.evaluate(() => openRoyalGallery('paddle'));
      await p.locator(`[data-choice-id="${id}"]`).click();
      assert.equal(await p.evaluate(() => activePaddleProfile(left) === paddleCatalog.find(p => p.id === matchPaddles
        .left).profile), true);
    }
    await p.evaluate(() => openRoyalGallery('paddle'));
    await assertGalleryLayout(p);
    await screenshot(p, platform + '-paddles');
    await p.keyboard.press('Home');
    await p.keyboard.press('ArrowLeft');
    await p.keyboard.press('Enter');
    assert.equal(await p.locator('#royalGallery').isVisible(), false);
    await p.evaluate(() => {
      openRoyalGallery('paddle');
      const pad = {
        index: 0,
        axes: [1, 0],
        buttons: Array.from({
          length: 16
        }, () => ({
          pressed: false,
          value: 0
        }))
      };
      navigator.getGamepads = () => [pad];
      pollRoyalGalleryGamepad(1000);
      pad.axes[0] = 0;
      pad.buttons[0] = {
        pressed: true,
        value: 1
      };
      pollRoyalGalleryGamepad(1040);
      navigator.getGamepads = () => [];
    });
    assert.equal(await p.locator('#royalGallery').isVisible(), false);
    await p.evaluate(() => openRoyalGallery('paddle', 'right'));
    await p.locator('[data-choice-id="enemy-2"]').click();
    assert.equal(await p.evaluate(() => activePaddleProfile(right) === ENEMY_PADDLE_PROFILES[2] &&
      multiplayerPaddleChoices.right === 'enemy-2' && saveData.royalPaddle2 !== 'enemy-2'), true);
    pass(platform + ': all 42 existing paddle profiles, keyboard and controller selection');

    // Existing saved preferences from older builds must still survive backups and reloads.
    await p.evaluate(() => {
      setMusicVolume(37);
      setMusicEnabled(false);
      saveData.royalPaddle = 'player-2';
      saveData.royalPaddle2 = 'enemy-2';
      saveData.royalArena = 18;
      saveProgressNow();
      loadSaveSlot(1);
      setMusicVolume(0);
      setMusicEnabled(false);
      loadSaveSlot(0);
    });
    await p.reload();
    assert.deepEqual(await p.evaluate(() => [musicEnabled, musicVolumeLevel, saveData.royalPaddle, saveData.royalArena,
      saveData.highestUnlockedLevel
    ]), [false, .37, 'player-2', 18, 17]);
    await p.locator('#titleCustomButton').click();
    await p.locator('#chooseArenaButton').click();
    await p.locator('[data-choice-id="18"]').click();
    await p.evaluate(() => launchSelectedCustomLevel());
    assert.deepEqual(await p.evaluate(() => [mode, selectedAbsoluteLevelIndex(), currentLevel().goal]), [3, 18, 6]);
    if (platform !== 'Browser') {
      const restored = await p.evaluate(() => parseSaveBackup(makeSaveBackup()).slots[0]);
      assert.equal(restored.royalPaddle, 'player-2');
      assert.equal(restored.royalArena, 18);
      assert.equal(restored.royalPaddle2, 'enemy-2');
    }
    pass(platform + ': music/volume/save compatibility, selection reload, custom Hidden Wall and native backup fields');

    await p.evaluate(() => {
      showTitleScreen();
      startCampaignFromSave();
      waitingForServe = false;
      paused = false;
      gameWindowFocused = true;
      loop(0);
      loop(1000 / 60);
    });
    assert.equal(await p.evaluate(() => mode), 1);
    assert.ok(await p.evaluate(() => Number.isFinite(ball.x) && Number.isFinite(ball.y)));
    await p.evaluate(() => {
      showTitleScreen();
      startBossFromTitle();
    });
    await p.waitForFunction(() => mode === 4 && !bossIntroActive, null, {
      polling: 50
    });
    if (platform !== 'Browser') {
      await p.evaluate(() => {
        clearCreditTimers();
        showTitleScreen();
      });
      await p.locator('.primary-online').click();
      assert.equal(await p.locator('#onlineBrowserNotice input').inputValue(),
        'https://kingalexgilbert.github.io/king-pong/demo/');
      await p.locator('#titleLocalButton').click();
      await p.locator('#titleLanButton').click();
      await p.locator('#lanPanel').waitFor({
        state: 'visible'
      });
      assert.equal(await p.locator('#lanPanel').isVisible(), true, JSON.stringify({
        errors,
        state: await p.evaluate(() => ({
          mode,
          lanPanelOpen,
          menusVisible,
          status: lanStatus.textContent,
          title: document.body.className
        }))
      }));
    }
    pass(platform + ': campaign and boss initialization; native browser-online notice and existing LAN setup');
    await p.close();
  }

  for (const viewport of [{
      width: 390,
      height: 844
    }, {
      width: 844,
      height: 390
    }]) {
    const p = await page('Browser', {
      viewport,
      hasTouch: true,
      isMobile: true
    });
    await p.locator('.title-paddle').tap();
    const layout = await p.evaluate(() => {
      const card = document.querySelector('.royal-gallery-card').getBoundingClientRect(),
        list = byId('royalGalleryList');
      const choices = [...list.querySelectorAll('button')];
      const contained = choices.every(choice => {
        const bounds = choice.getBoundingClientRect();
        return bounds.height >= 160 && [...choice.children].every(child => {
          const box = child.getBoundingClientRect();
          return box.top >= bounds.top && box.bottom <= bounds.bottom;
        });
      });
      return {
        left: card.left,
        right: card.right,
        bottom: card.bottom,
        scrolls: list.scrollHeight > list.clientHeight,
        touch: getComputedStyle(list).touchAction,
        contained
      };
    });
    assert.ok(layout.left >= 0 && layout.right <= viewport.width && layout.bottom <= viewport.height);
    assert.equal(layout.scrolls, true);
    assert.equal(layout.touch, 'pan-y');
    assert.equal(layout.contained, true, 'preview and labels fit in each scrollable card');
    await assertGalleryLayout(p);
    await screenshot(p, 'touch-' + viewport.width);
    await p.close();
    pass(`touch ${viewport.width}x${viewport.height}: scrollable gallery stays inside the viewport`);
  }
  const localized = await page('Browser', {
    locale: 'es-ES'
  });
  assert.equal(await localized.locator('.primary-online').innerText(), 'JUGAR EN LÍNEA');
  await localized.locator('.title-paddle').click();
  assert.equal(await localized.locator('#royalGalleryTitle').innerText(), 'Elige tu pala');
  await localized.close();
  pass('Spanish localization includes new landing and gallery text');

  for (const viewport of [{width: 1280, height: 800}, {width: 844, height: 390}, {width: 390, height: 844}]) {
    const roomHost = await page('Browser', {viewport});
    const roomGuest = await page('Browser', {viewport});
    for (const peer of [roomHost, roomGuest]) {
      await peer.evaluate(() => {
        // Only transport establishment is stubbed here. Real WebRTC stays in browser.mjs.
        KingPongRoom.prototype.open = function(role) {
          this.role = role;
          this.hooks.welcome('ABCDE');
          this.hooks.status('Waiting for Player 2...');
        };
      });
      await peer.locator('#titleLanButton').click();
    }
    assert.equal(await roomHost.evaluate(() => lanRole), 'none');
    assert.equal(await roomHost.evaluate(() => onlineSession), null);
    await roomHost.locator('#chooseArenaButton').click();
    assert.equal(await roomHost.locator('.royal-choice').count(), 19);
    await roomHost.locator('[data-choice-id="4"]').click();
    assert.equal(await roomHost.evaluate(() => matchArenaId), 4);
    await screenshot(roomHost, `pre-room-arena-${viewport.width}`);
    await roomHost.locator('#lanHostButton').click();
    assert.deepEqual(await roomHost.evaluate(() => [lanRole, matchArenaId, selectedAbsoluteLevelIndex()]),
      ['host', 4, 4]);
    assert.equal(await roomHost.locator('#onlineRoomCode').innerText(), 'ABCDE');
    await roomGuest.evaluate(() => { saveData.royalArena = 12; });
    await roomGuest.locator('#lanJoinButton').click();
    assert.equal(await roomGuest.locator('#chooseArenaButton').isVisible(), false);
    await roomGuest.locator('#lanRoomCodeInput').fill('ABCDE');
    await roomGuest.locator('#onlineJoinSubmit').click();
    for (const peer of [roomHost, roomGuest]) await peer.evaluate(() => {
      const channel = {readyState: 'open', bufferedAmount: 0,
        send: data => (window.roomPackets ||= []).push(data)};
      onlineSession.hooks.channel(channel, false);
      onlineSession.hooks.channel(channel, true);
      onlineSession.hooks.connected();
    });
    const deliver = async (from, to) => {
      const packets = await from.evaluate(() => {
        const result = window.roomPackets || [];
        window.roomPackets = [];
        return result;
      });
      for (const packet of packets) await to.evaluate(packet => handleLanMessage(packet), packet);
    };
    await deliver(roomGuest, roomHost);
    await roomHost.evaluate(() => sendLanState(true));
    await deliver(roomHost, roomGuest);
    assert.equal(await roomGuest.evaluate(() => onlineHasState), true);
    assert.deepEqual(await roomGuest.evaluate(() => [matchArenaId, selectedAbsoluteLevelIndex(), saveData.royalArena]),
      [4, 4, 12], 'host setup overrides the guest match, not the guest save');
    assert.equal(await roomGuest.locator('#chooseArenaButton').isVisible(), false);
    await roomGuest.evaluate(() => openRoyalGallery('arena'));
    assert.equal(await roomGuest.locator('#royalGallery').isVisible(), false);
    assert.deepEqual(await roomGuest.evaluate(() => serializeLanHazards()),
      await roomHost.evaluate(() => serializeLanHazards()));
    await roomHost.evaluate(() => {
      handleLanMessage(JSON.stringify({v: LAN_SIGNAL_VERSION, gameplay: 'royal', matchRules: 'presets',
        room: lanRoomCode, type: 'selection', seq: 100, paddle: 'classic', arena: 17}));
      handleLanMessage(JSON.stringify({v: LAN_SIGNAL_VERSION, gameplay: 'royal', matchRules: 'presets',
        room: lanRoomCode, type: 'state', seq: 101, selection: {arena: 17, left: 'classic', right: 'classic'}}));
    });
    assert.equal(await roomHost.evaluate(() => matchArenaId), 4, 'guest cannot change the host arena');
    for (const action of ['score', 'rematch']) {
      await roomHost.evaluate(action => {
        if (action === 'score') pointForPlayer();
        else retryLevel();
        frame += 3;
        sendLanState(true);
      }, action);
      await deliver(roomHost, roomGuest);
      for (const peer of [roomHost, roomGuest]) assert.deepEqual(
        await peer.evaluate(() => [matchArenaId, selectedAbsoluteLevelIndex()]), [4, 4]);
    }
    await roomHost.evaluate(() => {
      waitingForServe = paused = false;
      royalGuards.left = 600;
      ball.prevX = 20; ball.x = 17; ball.y = 70; ball.vx = -4;
      collideCastleGuard();
      frame += 3;
      sendLanState(true);
    });
    await deliver(roomHost, roomGuest);
    assert.deepEqual(await roomGuest.evaluate(() => royalGuardHits), await roomHost.evaluate(() => royalGuardHits));
    await roomGuest.evaluate(() => {
      guestRenderTime = guestSnapshots.at(-1).time;
      window.shieldSounds = 0;
      playImpactSound = () => window.shieldSounds++;
      renderFrame(0, 0);
      renderFrame(0, 1);
    });
    assert.equal(await roomGuest.evaluate(() => window.shieldSounds), 1);
    await screenshot(roomGuest, `guest-shield-${viewport.width}`);
    await roomHost.context().close();
    await roomGuest.context().close();
    pass(`online ${viewport.width}x${viewport.height}: pre-room arena choice, authoritative peers, rematch and shield feedback`);
  }

  const host = await page(),
    guest = await page();
  // Use production JSON encoding/decoding and handlers across independent browser contexts.
  await host.evaluate(() => {
    hideTitleScreen();
    startTwoPlayerMode(true, false);
    lanRole = 'host';
    lanConnected = true;
    lanRoomCode = 'ABCDE';
    lanChannel = {
      readyState: 'open',
      bufferedAmount: 0,
      send: s => (window.outbound ||= []).push(s)
    };
    onlineControlChannel = lanChannel;
    onlineGameBlocked = false;
    gameWindowFocused = true;
    saveData.completedLevels.fill(true);
    saveData.highestUnlockedLevel = 17;
    saveData.bossUnlocked = true;
    setLevelByAbsoluteIndex(18, true);
    matchPaddles.left = 'player-2';
    hideFirstStartControls();
    sendLanState(true);
  });
  await guest.evaluate(() => {
    hideTitleScreen();
    startTwoPlayerMode(true, false);
    lanRole = 'guest';
    lanConnected = true;
    lanRoomCode = 'ABCDE';
    lanChannel = {
      readyState: 'open',
      bufferedAmount: 0,
      send: s => (window.outbound ||= []).push(s)
    };
    onlineControlChannel = lanChannel;
    onlineSession = {
      close() {}
    };
    onlineGameBlocked = false;
    gameWindowFocused = true;
    saveData.highestUnlockedLevel = 17;
    matchPaddles.right = 'player-3';
    hideFirstStartControls();
    sendPaddleSelection();
  });
  const drain = async (from, to) => {
    const packets = await from.evaluate(() => {
      const q = window.outbound || [];
      window.outbound = [];
      return q
    });
    for (const p of packets) await to.evaluate(p => handleLanMessage(p), p);
    return packets
  };
  await drain(guest, host);
  await host.evaluate(() => {
    frame += 3;
    sendLanState()
  });
  await drain(host, guest);
  assert.deepEqual(await guest.evaluate(() => [selectedAbsoluteLevelIndex(), matchPaddles.left, matchPaddles.right]), [
    18, 'player-2', 'player-3'
  ]);
  pass('two browser contexts: host arena authority and both paddle choices synchronize through production messages');
  await host.evaluate(() => {
    paused = false;
    waitingForServe = false;
    ball.lastHit = 'left';
    awardRoyalPowerup('split');
    awardRoyalPowerup('rush');
    awardRoyalPowerup('guard');
    frame += 3;
    sendLanState(true)
  });
  await drain(host, guest);
  assert.deepEqual(await guest.evaluate(() => [!!royalSplitBall, ball.rush, royalGuards.left]), [true, true, 600]);
  await guest.evaluate(() => renderFrame(.5, performance.now()));
  await screenshot(guest, 'royal-effects');
  const original = await guest.evaluate(() => JSON.stringify([ball, royalSplitBall, left.score, right.score]));
  await guest.evaluate(() => {
    keys.add('ArrowDown');
    update();
    keys.clear();
    updateBall();
  });
  assert.equal(await guest.evaluate(() => JSON.stringify([ball, royalSplitBall, left.score, right.score])), original);
  pass('two browser contexts: split/rush/guard synchronization and guest ball-physics prohibition');
  await drain(guest, host);
  await host.evaluate(() => {
    royalGuards.left = 0;
    royalSplitBall.x = W - 1;
    royalSplitBall.y = 10;
    royalSplitBall.vx = 4;
    ball.x = 200;
    ball.y = 200;
    updateBall();
    frame += 3;
    sendLanState(true)
  });
  const scorePackets = await drain(host, guest);
  assert.deepEqual(await guest.evaluate(() => [left.score, right.score, royalSplitBall, waitingForServe]), [1, 0, null,
    true
  ]);
  await guest.evaluate(p => handleLanMessage(p), scorePackets[0]);
  assert.equal(await guest.evaluate(() => left.score), 1);
  for (const side of ['left', 'right']) {
    await host.evaluate(side => {
      paused = waitingForServe = false;
      hazards = [];
      royalGuards = {
        left: 0,
        right: 0
      };
      royalPickup = null;
      clearRallyLaunchRamp();
      ball.x = 300;
      ball.y = 100;
      ball.vx = 4;
      ball.vy = 0;
      ball.lastHit = 'left';
      awardRoyalPowerup('split');
      const paddle = side === 'left' ? left : right,
        direction = paddle === left ? 1 : -1;
      royalSplitBall.y = paddle.y + PADDLE_H / 2 - BALL_HALF;
      royalSplitBall.vy = 0;
      royalSplitBall.vx = -direction * BASE_BALL_SPEED * ROYAL_SPLIT_SPEED_SCALE;
      const face = paddleSurfaceX(paddle, direction, activePaddleProfile(paddle), royalSplitBall.y + BALL_HALF);
      royalSplitBall.x = direction > 0 ? face + 2 : face - BALL_SIZE - 2;
      frame += 3;
      sendLanState(true);
    }, side);
    const beforeHitPackets = await drain(host, guest);
    const beforeHit = beforeHitPackets.find(p => JSON.parse(p).type === 'state');
    assert.ok(beforeHit);
    assert.equal(await guest.evaluate(() => !!royalSplitBall), true);
    const guestBefore = await guest.evaluate(() => JSON.stringify([ball, royalSplitBall, left.score, right.score]));
    await guest.evaluate(() => updateBall());
    assert.equal(await guest.evaluate(() => JSON.stringify([ball, royalSplitBall, left.score, right.score])),
      guestBefore, 'guest does not resolve its own apparent contact');
    const hostBefore = await host.evaluate(() => JSON.stringify([ball, royalSplitBall, left.score, right.score]));
    await host.evaluate(p => {
      const forged = JSON.parse(p);
      forged.seq += 1000;
      forged.royal.split = null;
      forged.leftScore = 99;
      handleLanMessage(JSON.stringify(forged));
    }, beforeHit);
    assert.equal(await host.evaluate(() => JSON.stringify([ball, royalSplitBall, left.score, right.score])), hostBefore,
      'a guest cannot forge duplicate removal or a score');
    const collision = await host.evaluate(() => {
      const primary = ball;
      updateBall();
      frame += 3;
      sendLanState(true);
      return [royalSplitBall, ball === primary, ball.x, ball.y, ball.vx, ball.vy, left.score, right.score];
    });
    assert.deepEqual(collision, [null, true, 304, 100, 4, 0, 1, 0]);
    await drain(host, guest);
    assert.deepEqual(await guest.evaluate(() => [royalSplitBall, ball.x, ball.y, left.score, right.score]), [null, 304,
      100, 1, 0
    ]);
    await guest.evaluate(p => handleLanMessage(p), beforeHit);
    assert.equal(await guest.evaluate(() => royalSplitBall), null, 'a stale snapshot cannot resurrect the duplicate');
    assert.equal(await guest.evaluate(() => {
      guestRenderTime = guestSnapshots.at(-1).time;
      guestRenderAt = 1000;
      return guestVisualState(1000).split;
    }), null, 'the guest render timeline contains the authoritative removal');
    pass(
      `two browser contexts: Royal Split ${side} paddle removal is host-authoritative, preserves the primary and rejects stale resurrection`
      );
  }
  // Start the independent loss/reordering fixture with an empty render buffer. Rally changes
  // now preserve playout time (covered separately), rather than implicitly resetting this fixture.
  await guest.evaluate(() => resetVisualHistory());
  await host.evaluate(() => {
    paused = false;
    waitingForServe = false;
    royalSplitBall = null;
    ball.x = 300;
    ball.y = 200;
    ball.vx = 2;
    ball.vy = 0;
  });
  const packets = [];
  for (let i = 0; i < 8; i++) {
    await host.evaluate(() => {
      frame += 3;
      ball.x += 6;
      sendLanState(true)
    });
    packets.push(...await host.evaluate(() => {
      const p = window.outbound;
      window.outbound = [];
      return p
    }));
  }
  for (const i of [0, 1, 3, 2, 5, 7, 6]) await guest.evaluate(p => handleLanMessage(p), packets[i]);
  const positions = await guest.evaluate(() => {
    const p = [];
    for (let t = 0; t < 250; t += 1000 / 240) {
      p.push(guestVisualState(t).ball.x)
    }
    return p
  });
  assert.ok(positions.every((x, i) => !i || x >= positions[i - 1]));
  assert.ok(new Set(positions).size > 10);
  assert.ok(Math.max(...positions) <= 348);
  await guest.evaluate(() => renderFrame(.5, 250));
  await screenshot(guest, 'guest-smoothing');
  pass('two browser contexts: one-point split resolution, stale/lost/reordered states and bounded interpolated motion');
  await guest.evaluate(() => handleLanMessage(JSON.stringify({
    v: LAN_SIGNAL_VERSION,
    room: lanRoomCode,
    type: 'state',
    seq: 999
  })));
  assert.equal(await guest.evaluate(() => onlineGameBlocked && paused), true);
  pass('mixed old/new gameplay is stopped with a reload message, without changing version numbers');
  await host.close();
  await guest.close();
  assert.deepEqual(errors, []);
  pass('all browser pages and gameplay checks completed without console errors or uncaught exceptions');
  console.log(`RESULT: ${checks} browser integration groups passed`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
