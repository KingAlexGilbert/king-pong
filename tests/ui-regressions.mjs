import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  readFileSync
} from 'node:fs';
import {
  harness
} from './helpers/royal-harness.mjs';
import {
  builds,
  root,
  source,
  functionSource
} from './helpers/game-source.mjs';
import {
  integrateRoyalUi
} from '../game/ui-integration.mjs';

for (const platform of Object.keys(builds)) {
  test(`${platform}: all 42 multiplayer paddles are available without changing fresh Campaign unlocks`, () => {
    const h = harness(platform);
    const before = h.json('saveData');
    const locks = h.json('paddleCatalog.map(paddleUnlocked)');
    assert.ok(locks.some(value => !value));
    assert.equal(h.run('paddleCatalog.filter(paddleAvailable).length'), 42);
    h.run("multiplayerPaddleChoices={left:'boss-8',right:'enemy-15'};initializeMatchSelections();");
    assert.deepEqual(h.json('matchPaddles'), {
      left: 'boss-8',
      right: 'enemy-15'
    });
    h.run('mode=1');
    assert.equal(h.run('savedPaddle()'), 'classic');
    assert.deepEqual(h.json('paddleCatalog.map(paddleAvailable)'), locks);
    assert.deepEqual(h.json('saveData'), before);
    h.run('mode=2;resetMultiplayerPaddleChoices();initializeMatchSelections();');
    assert.deepEqual(h.json('matchPaddles'), {
      left: 'classic',
      right: 'classic'
    });
  });
  test(`${platform}: guest sends its own session paddle and cannot request host arena or score`, () => {
    const h = harness(platform);
    const before = h.json('saveData');
    h.run(
      "multiplayerPaddleChoices.left='boss-8';lanRole='guest';initializeMatchSelections();sendPaddleSelection();");
    assert.equal(h.run('sent[0].paddle'), 'boss-8');
    assert.deepEqual(h.json('Object.keys(sent[0]).sort()'), ['paddle', 'room', 'seq', 'type', 'v']);
    h.run(
      "lanRole='host';waitingForServe=true;receivePaddleSelection({...sent[0],arena:17,left:'enemy-15',score:999,guards:{left:600},ball:{vx:99}});"
      );
    assert.equal(h.run('matchPaddles.right'), 'boss-8');
    assert.equal(h.run('matchArenaId'), 0);
    assert.deepEqual(h.json('[left.score,right.score,royalGuards.left]'), [0, 0, 0]);
    h.run('mode=1');
    assert.deepEqual(h.json('saveData'), before);
    assert.equal(h.run("paddleAvailable(paddleCatalog.find(p=>p.id==='boss-8'))"), false);
  });
  test(`${platform}: generated UI integration is idempotent and keeps shared source`, () => {
    const html = source(platform);
    assert.equal(integrateRoyalUi(html), html);
    assert.ok(html.includes(readFileSync(new URL('game/royal-ui.js', root), 'utf8')));
    assert.match(functionSource(html, 'showTitleScreen'), /resetRoyalUiForTitle\(\);/);
    assert.match(functionSource(html, 'updateLanPanelVisibility'), /syncRoyalUi\(true\)/);
    assert.doesNotMatch(functionSource(html, 'updateLanPanelVisibility'), /lanPanelOpen\s*\|\|\s*isLanActive/);
  });
}

test('Android supports either landscape direction without recreating the WebView on rotation', () => {
  const manifest = readFileSync(new URL('android/app/src/main/AndroidManifest.xml', root), 'utf8');
  assert.match(manifest, /android:screenOrientation="sensorLandscape"/);
  assert.match(manifest, /android:configChanges="[^"]*orientation\|screenSize/);
});

test('orientation requests are gesture-gated, bounded, and tolerate missing APIs or refusals', async () => {
  const ui = readFileSync(new URL('game/royal-ui.js', root), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(`let royalOrientationAttempted=false,royalOrientationGeneration=0,royalOrientationOwned=false;
    let locks=0,fullscreens=0,updates=0,unlocks=0;
    function KingPongRoom(){} function royalPhoneViewport(){return true} function syncRoyalOrientation(){updates++}
    const navigator={userActivation:{isActive:false}};
    const document={fullscreenElement:null,documentElement:{async requestFullscreen(){fullscreens++}}};
    const window={screen:{orientation:{async lock(){locks++;throw new Error('Not allowed')},unlock(){unlocks++}}}};
    async ${functionSource(ui, 'requestRoyalLandscape')}`, context);
  const run = code => vm.runInContext(code, context);
  await run('requestRoyalLandscape()');
  assert.equal(run('fullscreens'), 0);
  run('navigator.userActivation.isActive=true');
  await run('requestRoyalLandscape()');
  await run('requestRoyalLandscape()');
  assert.equal(run('locks'), 1);
  assert.equal(run('fullscreens'), 1);
  assert.equal(run('royalOrientationOwned'), false);
  run('royalOrientationAttempted=false;window.screen.orientation={}');
  await run('requestRoyalLandscape()');
  assert.equal(run('fullscreens'), 1);
  run('royalOrientationAttempted=false;window.screen.orientation={async lock(){locks++},unlock(){unlocks++}}');
  await run('requestRoyalLandscape()');
  assert.equal(run('royalOrientationOwned'), true);
});
