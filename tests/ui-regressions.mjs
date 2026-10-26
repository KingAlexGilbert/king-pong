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
  const native = readFileSync(new URL('android/app/src/main/java/com/kingalex/kingpong/MainActivity.java', root), 'utf8');
  assert.match(native, /config\.smallestScreenWidthDp > 0 && config\.smallestScreenWidthDp < 600/);
  assert.match(native, /!isInMultiWindowMode\(\)/);
  assert.match(native, /FEATURE_SCREEN_LANDSCAPE/);
  assert.match(native, /requestLandscape\(String capability\)\s*\{\s*if \(!lanBridgeToken.equals\(capability\)\) return;\s*runOnUiThread/);
  assert.match(native, /if \(landscapeRequestAvailable\(\)\)[\s\S]*setRequestedOrientation\(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE\)/);
  const configuration = native.slice(native.indexOf('void onConfigurationChanged('), native.indexOf('private final class QrCameraBridge'));
  assert.match(configuration, /super.onConfigurationChanged\(config\);\s*sendOrientationState\(\);/);
  assert.doesNotMatch(configuration, /loadUrl|pauseGame|localLan\.stop/);
});

function orientationHarness() {
  const ui = readFileSync(new URL('game/royal-ui.js', root), 'utf8');
  const timers = new Map(); let timer = 0;
  const context = vm.createContext({setTimeout: fn => {timers.set(++timer,fn);return timer;}, clearTimeout: id => timers.delete(id)});
  vm.runInContext(`let locks=0,fullscreens=0,unlocks=0,nativeRequests=0,galleryKind=null,bossIntroActive=false,creditsActive=false;
    function KingPongRoom(){}
    const nodes=Object.fromEntries(['rotateDevice','rotatePlay','rotateDismiss','matchSetup','matchMenu'].map(id=>[id,{hidden:true,focus(){document.activeElement=this}}]));
    const byId=id=>nodes[id];
    const navigator={maxTouchPoints:1,userActivation:{isActive:false}};
    const document={body:{classList:{contains(){return false}}},activeElement:null,fullscreenElement:null,fullscreenEnabled:true,
      documentElement:{async requestFullscreen(){fullscreens++;document.fullscreenElement=this}}};
    const window={innerWidth:390,innerHeight:844,isSecureContext:true,
      screen:{orientation:{type:'portrait-primary',async lock(){locks++},unlock(){unlocks++}}}};
    window.top=window;
    ${ui}
    syncRoyalFocus=()=>{};syncRoyalOrientation();`, context);
  const run = code => vm.runInContext(code, context);
  return {run, expire: () => {for (const fn of [...timers.values()]) fn();}, flush: () => new Promise(setImmediate)};
}

test('web rotation requires demonstrated support, activation and confirmation; failures and races are bounded', async () => {
  const h = orientationHarness(), r = h.run;
  assert.equal(r('royalLandscapeRoute()'), null, 'API presence alone does not advertise support');
  assert.equal(await r('requestRoyalLandscape(true)'), false);
  assert.equal(await r('requestRoyalLandscape()'), false, 'no gesture');
  r('navigator.userActivation.isActive=true');
  const pending = r('requestRoyalLandscape()');
  await h.flush();
  assert.equal(r('locks'), 1);
  assert.equal(r('fullscreens'), 1);
  assert.equal(r('nodes.rotateDevice.hidden'), false, 'lock resolved but portrait is still visible');
  r("window.screen.orientation.type='landscape-primary';window.innerWidth=844;window.innerHeight=390;syncRoyalOrientation()");
  assert.equal(await pending, true);
  r("window.innerWidth=390;window.innerHeight=844;window.screen.orientation.type='portrait-primary';syncRoyalOrientation()");
  assert.equal(r('royalLandscapeRoute()'), 'browser');
  r("window.screen.orientation.lock=async()=>{locks++;throw Error('denied')}");
  assert.equal(await r('requestRoyalLandscape(true)'), false);
  assert.equal(r('nodes.rotateDevice.hidden'), false);
  assert.equal(r('nodes.rotatePlay.hidden'), true);
  assert.equal(await r('requestRoyalLandscape(true)'), false);
  assert.equal(r('locks'), 2, 'known failures are not retried');
  r('dismissRoyalOrientation()');
  assert.equal(r('nodes.rotateDevice.hidden'), true);

  for (const setup of ['window.screen.orientation={}', 'document.fullscreenEnabled=false', 'window.isSecureContext=false', 'window.top={}']) {
    const unsupported = orientationHarness();unsupported.run('navigator.userActivation.isActive=true;' + setup);
    assert.equal(await unsupported.run('requestRoyalLandscape()'), false);
    assert.equal(unsupported.run('fullscreens'), 0);
  }
  const refused = orientationHarness();
  refused.run('navigator.userActivation.isActive=true;window.KingPongFullscreen={enter:async()=>false}');
  assert.equal(await refused.run('requestRoyalLandscape()'), false);
  assert.equal(refused.run('locks'), 0, 'fullscreen refusal never attempts lock');

  const landscape = orientationHarness();
  landscape.run('navigator.userActivation.isActive=true;window.innerWidth=844;window.innerHeight=390');
  const alreadyLandscape = landscape.run('requestRoyalLandscape()');await landscape.flush();
  assert.equal(landscape.run('nodes.rotateDevice.hidden'),true,'a pending startup request never shows portrait guidance in landscape');
  landscape.expire();await alreadyLandscape;

  for (const cancel of [false,true]) {
    const delayed = orientationHarness();
    delayed.run('navigator.userActivation.isActive=true;window.screen.orientation.lock=()=>new Promise(resolve=>window.completeLock=resolve)');
    const waiting = delayed.run('requestRoyalLandscape()');await delayed.flush();
    if (cancel) delayed.run('dismissRoyalOrientation()');else delayed.expire();
    assert.equal(await waiting, false, 'even a never-settled API request has a bounded UI lifetime');
    delayed.run('window.completeLock()');await delayed.flush();
    assert.equal(delayed.run('royalOrientationOwned'), false);
    assert.equal(delayed.run('royalOrientationFailed'), !cancel);
    assert.ok(delayed.run('unlocks') > 0, 'late lock completion is released');
  }
});

test('native rotation requires advertised capability and confirms both native and viewport landscape', async () => {
  const h = orientationHarness(), r = h.run;
  r(`window.KingPongLanToken='capability';window.KingPongOrientation={requestLandscape(token){
    if(token!=='capability')throw Error('wrong token');nativeRequests++;
  }};delete navigator.userActivation`);
  assert.equal(r('royalLandscapeRoute()'), null);
  r('window.KingPongNativeOrientation={available:false,landscape:false}');
  assert.equal(await r('requestRoyalLandscape(true)'), false);
  r('window.KingPongNativeOrientation.available=true;syncRoyalOrientation()');
  assert.equal(r('nodes.rotatePlay.hidden'), false);
  const pending = r('requestRoyalLandscape(true)');
  assert.equal(r('nativeRequests'), 1);
  assert.equal(r('fullscreens+locks'), 0, 'native app does not use WebView fullscreen or screen.lock');
  r('window.KingPongNativeOrientation.available=false;syncRoyalOrientation()');
  assert.equal(r('royalOrientationFailed'), false, 'temporary focus loss during rotation is not a failed request');
  r('window.innerWidth=844;window.innerHeight=390;syncRoyalOrientation()');
  assert.equal(r('nodes.rotateDevice.hidden'), false, 'viewport alone cannot confirm native rotation');
  r('window.KingPongNativeOrientation.landscape=true;syncRoyalOrientation()');
  assert.equal(await pending, true);
  assert.equal(r('nodes.rotateDevice.hidden'), true);
  r('window.innerWidth=390;window.innerHeight=844;window.KingPongNativeOrientation={available:true,landscape:false}');
  const refused = r('requestRoyalLandscape(true)');
  r('window.KingPongNativeOrientation={available:false,landscape:false,failed:true};syncRoyalOrientation()');
  assert.equal(await refused, false);
  assert.equal(r('nodes.rotateDevice.hidden'), false);
  assert.equal(r('nodes.rotatePlay.hidden'), true);
});

test('network victory follows local identity and authoritative scores while shared-screen labels remain specific', () => {
  const context = vm.createContext({});
  vm.runInContext(`let mode=2,lanRole='none',connected=true;const left={score:5},right={score:2};
    function isLanActive(){return connected && ['host','guest'].includes(lanRole)}
    function isLanGuestActive(){return isLanActive()&&lanRole==='guest'}
    ${readFileSync(new URL('game/arena-perspective.js', root), 'utf8')}`, context);
  const r = code => vm.runInContext(code, context);
  for (const role of ['host','guest']) for (const hostWon of [true,false,true]) {
    r(`lanRole='${role}';left.score=${hostWon?5:2};right.score=${hostWon?2:5}`);
    assert.equal(r('twoPlayerViewMirrored()'), role === 'guest');
    for (const message of ['Left player wins the match. Space to play again.','Right player wins the match. Space to play again.']) {
      assert.equal(r(`arenaResultMessage(${JSON.stringify(message)})`),hostWon===(role==='host')?'YOU WON!':'YOU LOST!');
    }
  }
  r("lanRole='none'");
  for (const side of ['Left','Right']) {
    const message=side+' player wins the match. Space to play again.';
    assert.equal(r(`arenaResultMessage(${JSON.stringify(message)})`),message);
  }
});
