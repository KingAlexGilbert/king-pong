import assert from 'node:assert/strict';
import {staticServer, closeStaticServer} from './static-server.mjs';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {builds} from '../../tests/helpers/game-source.mjs';

// Real production HTML/canvas with two-page, controlled channel delivery. This
// tests UI/protocol behavior, NOT ICE, TURN or physical WebView compatibility.
const server = await staticServer();
const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
const origin = `http://127.0.0.1:${server.address().port}`;
const errors = [];
const artifacts = process.env.KING_PONG_TEST_ARTIFACTS;
if (artifacts) await mkdir(artifacts, {recursive: true});
let checks = 0;
const pass = label => { checks++; console.log('PASS: ' + label); };
async function page(platform = 'Browser', viewport = {width: 1280, height: 800}, options = {}) {
  const p = await browser.newPage({viewport, ...options});
  p.on('pageerror', e => errors.push(platform + ': ' + e.message));
  await p.addInitScript(() => {
    Object.defineProperty(window, 'KING_PONG_SIGNALING_URL', {get: () => '', set: () => {}, configurable: true});
    window.requestAnimationFrame = () => 1;
    window.testNow = 5000;
    performance.now = () => testNow;
  });
  await p.goto(origin + '/' + builds[platform]);
  return p;
}
async function paint(p, name) {
  await p.evaluate(() => { syncRoyalUi(true); renderFrame(1, performance.now()); });
  if (artifacts && name) {
    await p.waitForTimeout(300); // Let the existing title fade finish before visual review.
    await p.screenshot({path: `${artifacts}/${name}.png`});
  }
}
async function setup(p, role, id = '00000000-0000-4000-8000-000000000001') {
  await p.evaluate(({role, id}) => {
    observeMatchmaking = () => {};
    Object.defineProperty(window, 'KING_PONG_SIGNALING_URL', {value: 'http://127.0.0.1:1', configurable: true});
    KingPongRoom.prototype.open = function (role) {
      this.role = role;
      this.hooks.welcome('ABCDE');
      const peer = this.peer = {connectionState: 'new', close() { this.connectionState = 'closed'; }};
      this.hooks.peer(peer);
      for (const control of [false, true]) this.wire({readyState: 'connecting', bufferedAmount: 0,
        close() { this.readyState = 'closed'; },
        send(raw) { testOut.push({control, message: JSON.parse(raw)}); }
      }, control, peer);
    };
    window.testOut = [];
    startOnlineSetup(true);
    setMatchRule('winTwo'); // The real menu now persists the local preset.
    multiplayerPaddleChoices.left = paddleCatalog[role === 'host' ? 2 : 4].id;
    window.testPaddle = multiplayerPaddleChoices.left;
    openOnlineRoom(role, '', {role, token: id, match: {id, arena: 2, rules: 'classic', protocol: KING_PONG_MATCHMAKING.protocol}});
    window.testOldSession = onlineSession;
  }, {role, id});
  await paint(p, role === 'host' ? 'arena-connecting' : null);
}
async function connect(p) {
  await p.evaluate(() => {
    onlineSession.peer.connectionState = 'connected';
    onlineSession.data.readyState = 'open'; onlineSession.data.onopen();
    if (lanConnected) throw new Error('connected without the control channel');
    onlineSession.control.readyState = 'open'; onlineSession.control.onopen();
  });
}
async function pump(a, b) {
  for (let i = 0; i < 20; i++) {
    let count = 0;
    for (const [from, to] of [[a, b], [b, a]]) {
      const packets = await from.evaluate(() => testOut.splice(0));
      count += packets.length;
      for (const packet of packets) {
        if (packet.message.type === 'match-setup') assert.equal(packet.control, true, 'setup is reliable');
        await to.evaluate(({message}) => {
          // Transport drops data until that recipient is genuinely ready.
          if (onlineSession?.connected) onlineSession.hooks.message(JSON.stringify(message));
        }, packet);
      }
    }
    if (!count) return;
  }
  throw new Error('unexpected setup message loop');
}
async function step(p, ms = 0) {
  await p.evaluate(ms => {
    const start = testNow, ticks = Math.max(1, Math.ceil(ms / (1000/60)));
    for (let i = 1; i <= ticks; i++) { testNow = start + ms*i/ticks; update(); }
    syncRoyalUi(true); renderFrame(1, testNow);
  }, ms);
}
async function readyPair(a, b) {
  await setup(a, 'host'); await setup(b, 'guest');
  await b.evaluate(() => { testNow = 90000; }); // unrelated monotonic clocks
  await connect(a); await pump(a, b); // first hello is deliberately dropped
  await connect(b); await pump(a, b);
  for (const p of [a, b]) assert.equal(await p.locator('#onlineFlowTitle').innerText(), 'CONNECTED');
  await step(a, 650); await pump(a, b); await paint(b);
  for (const p of [a, b]) assert.equal(await p.locator('#onlineFlowTitle').innerText(), 'ARE YOU READY?');
  await paint(a, 'arena-ready');
}
async function state(p) {
  return p.evaluate(() => ({phase: onlineMatchFlow?.phase, waiting: waitingForServe, paused,
    ball: [ball.x, ball.y], scores: [left.score, right.score], blocked: onlineGameBlocked}));
}

try {
  for (const platform of Object.keys(builds)) {
    for (const viewport of [{width: 1366, height: 768}, {width: 1920, height: 1080},
      {width: 390, height: 844}, {width: 844, height: 390}]) {
      const p = await page(platform, viewport);
      for (const id of ['titleLevelSelectButton','titleCustomButton','titleLocalButton']) {
        assert.equal(await p.locator('#'+id).isVisible(),true,id+' available before boss unlock');
      }
      assert.equal(await p.locator('#titleBossButton').isVisible(),false);
      await p.evaluate(() => {
        saveData.completedLevels.fill(true); saveData.highestUnlockedLevel = 17; saveData.bossUnlocked = true;
        updateModeControls(); syncRoyalUi(true);
      });
      const title = await p.evaluate(() => {
        const box = sel => { const r = document.querySelector(sel).getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; };
        const secondaryTiles = [...document.querySelectorAll('.title-actions > button:not([hidden])')].map(button => {
          const {x,y,width,height} = button.getBoundingClientRect();
          return {id:button.id,x,y,w:width,h:height};
        });
        return {primary: box('.title-primary-modes'), secondary: box('.title-actions'), secondaryTiles,
          tiles: [...document.querySelectorAll('.title-primary-modes button')].map(b => ({
            shadow: getComputedStyle(b).boxShadow, border: getComputedStyle(b).borderColor})),
          overflow: document.documentElement.scrollWidth > innerWidth};
      });
      assert.ok(Math.abs(title.primary.x + title.primary.w/2 - title.secondary.x - title.secondary.w/2) < 2);
      assert.equal(title.overflow, false);
      const byId = new Map(title.secondaryTiles.map(tile=>[tile.id,tile]));
      for (const id of ['titleLevelSelectButton','titleCustomButton','titleLocalButton','titleBossButton']) {
        assert.ok(byId.get(id)?.w>0 && byId.get(id)?.h>0,id+' visibly rendered');
      }
      assert.ok(byId.has('titleLanButton') || byId.has('titleNativeLanButton'),'platform LAN entry');
      for (const [i,a] of title.secondaryTiles.entries()) {
        assert.ok(a.x>=-1 && a.x+a.w<=viewport.width+1,'title choice fits viewport');
        for (const b of title.secondaryTiles.slice(i+1)) {
          assert.ok(a.x+a.w<=b.x+1 || b.x+b.w<=a.x+1 || a.y+a.h<=b.y+1 || b.y+b.h<=a.y+1,
            a.id+' and '+b.id+' do not overlap');
        }
      }
      const ordinary = title.secondaryTiles.filter(tile=>tile.id!=='titleBossButton');
      assert.ok(ordinary.every(tile=>Math.abs(tile.w-ordinary[0].w)<2),'ordinary choices have equal width');
      assert.notEqual(title.tiles[0].border, title.tiles[1].border);
      for (const tile of title.tiles) assert.ok(!tile.shadow.includes('4px 4px'), 'no offset double edge');
      await paint(p, `${platform}-title-${viewport.width}`);
      await p.locator('.primary-online').click();
      assert.equal(await p.locator('#matchArenaPreference').count(), 0);
      assert.equal(await p.locator('.matchmaking-rules').innerText(), 'First to 10');
      const order = await p.evaluate(() => {
        const nodes = ['setupMenuButton', 'matchSetupTitle', 'choosePaddleButton', 'chooseArenaButton',
          'matchmakingPanel', 'onlinePrivateRules', onlineHostControl().id].map(id => byId(id));
        return nodes.every((node, i) => !i || (nodes[i-1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
      });
      assert.equal(order, true);
      await paint(p, `${platform}-online-initial-${viewport.width}`);
      const back = await p.locator('#setupMenuButton').boundingBox();
      assert.ok(back.y >= 0 && back.y + back.height < viewport.height, 'back is immediately visible');
      if (viewport.width >= 1366) assert.equal(await p.evaluate(() => {
        const action = onlineHostControl().getBoundingClientRect();
        return action.bottom <= byId('matchSetupBody').getBoundingClientRect().bottom;
      }), true, 'default desktop private actions fit without scrolling');
      await p.locator('#onlinePrivateRules summary').click();
      for (const rule of ['quick', 'classic', 'winTwo', 'endless']) {
        await p.locator(`#matchRule-${rule}`).click();
        assert.equal(await p.evaluate(() => matchRuleId), rule);
      }
      await paint(p, `${platform}-online-${viewport.width}`);
      // Select the existing gallery, then inspect the actual queue request.
      await p.locator('#chooseArenaButton').click();
      await p.locator('.royal-choice[data-choice-id="2"]').click();
      await p.evaluate(() => {
        window.searchRequests = [];
        matchmakingSocket = {readyState: 1, send: raw => searchRequests.push(JSON.parse(raw)), close() {}};
        matchmakingState = 'watching'; matchmakingWaiting = 0;
      });
      await p.locator('#findMatchButton').click();
      assert.equal(await p.evaluate(() => searchRequests[0].arena), 2);
      assert.equal(await p.locator('#cancelSearchButton').isVisible(), true);
      await p.locator('#setupMenuButton').click();
      assert.equal(await p.evaluate(() => matchmakingSocket === null && document.body.classList.contains('title-active')), true);
      if (platform !== 'Browser' && viewport.width === 1366) {
        await p.evaluate(() => startLanTwoPlayerSetup(true));
        assert.equal(await p.evaluate(() => !onlineTransportSelected && onlineMatchFlow === null &&
          Boolean(lanPanel.compareDocumentPosition(byId('choosePaddleButton')) & Node.DOCUMENT_POSITION_FOLLOWING)), true,
          'native LAN keeps its original controls before the selectors');
      }
      await p.close();
    }
    pass(`${platform}: title alignment/colors, four responsive layouts, shared arena, fixed queue rules, private presets, top Back cleanup`);
  }

  const pairs = [['Browser', 'Browser'], ...['Windows', 'Linux', 'Android'].flatMap(p => [[p, 'Browser'], ['Browser', p]])];
  for (const [host, guest] of pairs) {
    const a = await page(host), b = await page(guest);
    await readyPair(a, b);
    assert.deepEqual(await a.evaluate(() => matchPaddles), await b.evaluate(() => matchPaddles));
    assert.equal(await a.evaluate(() => matchPaddles.right), await b.evaluate(() => testPaddle));
    const initial = await state(a);
    await a.evaluate(() => {
      for (let i = 0; i < 120; i++) update();
      serveOrContinue(); togglePause(); retryLevel(); pointForPlayer(); pointForCpu();
      handleLanMessage(JSON.stringify({v: LAN_SIGNAL_VERSION, room: lanRoomCode, gameplay: 'royal', matchRules: 'presets', type:'action', action:'serve'}));
    });
    assert.deepEqual(await state(a), initial, 'no gameplay or forged action can start before readiness');
    await a.locator('#onlineReadyButton').click(); await pump(a,b);
    await step(a, 5000); await pump(a,b);
    assert.equal((await state(a)).phase, 'ready', 'one ready player cannot start');
    await b.locator('#onlineReadyButton').focus(); await b.keyboard.press('Enter'); await pump(a,b);
    const start = await a.evaluate(() => performance.now());
    for (const [ms, label] of [[0,'3'], [1000,'2'], [1000,'1']]) {
      await step(a, ms); await pump(a,b); await step(b, 0);
      for (const p of [a,b]) {
        assert.equal(await p.locator('#onlineFlowTitle').innerText(), label);
        assert.equal((await state(p)).waiting, true);
        assert.deepEqual((await state(p)).scores,[0,0]);
        await paint(p);
      }
    }
    // A guest's timer expiring and an unordered running snapshot cannot bypass GO.
    await step(b, 8000);
    await b.evaluate(() => {
      handleLanMessage(JSON.stringify({v:LAN_SIGNAL_VERSION,room:lanRoomCode,gameplay:'royal',matchRules:'presets',
        type:'state',seq:99999,waitingForServe:false,paused:false}));
    });
    assert.equal((await state(b)).phase, 'countdown');
    assert.equal((await state(b)).waiting, true);
    await step(a, 999); await pump(a,b);
    assert.equal((await state(a)).waiting, true);
    await step(a, 1); await pump(a,b); await paint(b);
    assert.equal(await a.evaluate(() => performance.now()), start + 3000);
    for (const p of [a,b]) {
      assert.equal(await p.locator('#onlineFlowTitle').innerText(), 'GO!');
      assert.equal((await state(p)).waiting, false);
      assert.equal((await state(p)).paused, false);
    }
    await step(a, 700); await step(b, 700); await pump(a,b);
    assert.equal(await a.locator('#onlineMatchFlow').isVisible(), false);
    // Guest still applies snapshots; only the host owns simulation.
    await b.evaluate(() => { gameWindowFocused = true; keys.add('ArrowDown'); });
    await step(b,17); await pump(a,b); await step(a,17);
    assert.ok(await a.evaluate(() => lanLastInputSeq >= 0));
    await a.evaluate(() => onlineSession.hooks.interrupted());
    assert.equal((await state(a)).blocked, true);
    await a.evaluate(() => onlineSession.hooks.resumed());
    assert.equal((await state(a)).blocked, false, 'normal post-start reconnect still recovers');
    await a.close(); await b.close();
    pass(`${host} host/${guest} guest: lost first hello, paddles, frozen setup, both confirmations, 3/2/1/GO, no guest premature start, resumed gameplay`);
  }

  for (const phase of ['connecting', 'connected', 'ready', 'countdown']) {
    const a = await page(), b = await page();
    if (phase === 'connecting') { await setup(a,'host'); await setup(b,'guest'); }
    else {
      await readyPair(a,b);
      if (phase === 'connected') await a.evaluate(() => { onlineMatchFlow.phase = 'connected'; });
      if (phase === 'countdown') {
        await a.locator('#onlineReadyButton').click(); await b.locator('#onlineReadyButton').click(); await pump(a,b);
      }
    }
    await a.evaluate(() => { onlineSession.data.readyState = 'closed'; onlineSession.data.onclose(); });
    if (phase === 'connecting') {
      assert.equal((await state(a)).phase,'failed');
      assert.equal(await a.locator('#onlineRetryButton').isVisible(),true);
    } else {
      assert.equal(await a.locator('#matchSetup').isVisible(),true,
        'an established session returns automatically after an irrecoverable disconnect');
      assert.equal(await a.evaluate(() => paused && onlineGameBlocked),true);
    }
    await step(a,10000);
    assert.equal((await state(a)).waiting,true);
    assert.equal(await a.evaluate(() => resumeCountdownEndAt),0);
    // Late callbacks from the abandoned session cannot revive it.
    await a.evaluate(() => { testOldSession.hooks.connected(); testOldSession.hooks.resumed(); testOldSession.hooks.peer({}); });
    assert.equal(await a.evaluate(() => onlineSession),null);
    if (phase === 'connecting') await a.locator('#onlineFlowBack').click();
    assert.equal(await a.locator('#matchSetup').isVisible(),true);
    assert.equal(await a.evaluate(() => matchRuleId),'winTwo');
    await b.locator('#onlineFlowBack').click();
    await step(b,10000);
    assert.equal(await b.evaluate(() => onlineSession),null);
    assert.equal((await state(b)).waiting,true);
    await a.close(); await b.close();
    pass(`${phase}: disconnect/error recovery, cancellation, preset restoration, late-callback and expired-countdown safety`);
  }
  const p = await page();
  await setup(p,'host'); await connect(p); await step(p,8001);
  assert.equal((await state(p)).phase,'failed');
  assert.match(await p.locator('#onlineFlowNote').innerText(), /latest game/);
  await p.locator('#onlineRetryButton').click();
  assert.equal(await p.evaluate(() => matchmakingRequested),true);
  assert.equal(await p.locator('#matchSetup').isVisible(),true);
  await setup(p,'host'); await connect(p);
  await p.evaluate(() => document.dispatchEvent(new Event('kingpong-background')));
  assert.equal((await state(p)).phase,'failed');
  await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(() => onlineMatchFlow === null && document.body.classList.contains('title-active')),true);
  await p.close();
  pass('old-client handshake timeout, retry, background cancellation and Escape cleanup');

  const controller = await page(), touch = await page('Android', {width:844, height:390}, {hasTouch:true});
  await readyPair(controller, touch);
  await controller.locator('#onlineReadyButton').dispatchEvent('keydown', {key:'Enter', repeat:true});
  assert.equal(await controller.evaluate(() => onlineMatchFlow.localReady), false, 'held Enter is not explicit readiness');
  await controller.evaluate(() => {
    gameWindowFocused = true;
    window.testPad = {index:0, id:'test-controller', connected:true, mapping:'standard', axes:[0,0],
      buttons:Array.from({length:16},()=>({pressed:false,value:0}))};
    navigator.getGamepads = () => [testPad];
    byId('onlineReadyButton').focus(); testPad.buttons[0].pressed = true;
    pollRoyalUiGamepad(200000);
  });
  await touch.locator('#onlineReadyButton').tap(); await pump(controller,touch);
  assert.equal((await state(controller)).phase, 'countdown');
  await controller.evaluate(() => {
    testPad.buttons[0].pressed = false; testPad.buttons[1].pressed = true;
    pollRoyalUiGamepad(200040);
  });
  assert.equal(await controller.evaluate(() => onlineSession === null && document.body.classList.contains('title-active')), true);
  await touch.locator('#onlineFlowBack').tap();
  await touch.locator('#setupMenuButton').tap();
  assert.equal(await touch.evaluate(() => document.body.classList.contains('title-active')),true);
  await controller.close(); await touch.close();
  pass('explicit controller/touch readiness, held-key protection, controller cancellation and touch Back');
  assert.deepEqual(errors, []);
  console.log(`RESULT: ${checks} online UI/flow groups passed (controlled channels; real WebRTC tested separately).`);
} finally { await browser.close(); await closeStaticServer(server); }
