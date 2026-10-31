import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const online = readFileSync(new URL('../game/online.js', import.meta.url), 'utf8');
const launcher = readFileSync(new URL('../Linux/src/king-pong.py', import.meta.url), 'utf8');
const matchmaking = readFileSync(new URL('../game/matchmaking.js', import.meta.url), 'utf8');
const helper = online.match(/^function onlineCapabilityError\(environment = globalThis\) \{[\s\S]*?^\}/m)?.[0];

function diagnose(environment) {
  assert.ok(helper, 'online capability helper must be present');
  const context = vm.createContext({environment});
  return vm.runInContext(helper + '\nonlineCapabilityError(environment)', context);
}

test('online capability gate does not reject otherwise capable engines without RTCPeerConnection', () => {
  assert.equal(diagnose({WebSocket: class {}, crypto: {subtle: {}}, isSecureContext: true}), '');
});

test('online errors distinguish missing WebSocket from missing Web Crypto', () => {
  assert.match(diagnose({crypto: {subtle: {}}, isSecureContext: true}), /WebSocket/);
  assert.match(diagnose({WebSocket: class {}, crypto: {}, isSecureContext: true}), /crypto\.subtle/);
  assert.match(diagnose({WebSocket: class {}, crypto: {}, isSecureContext: false}), /not a secure context/);
});

test('Linux WebKitGTK requests WebRTC separately from camera permissions without disabling security', () => {
  assert.match(launcher, /\("enable-media-stream", True\)/);
  assert.match(launcher, /\("enable-webrtc", True\)/);
  assert.match(launcher, /\("allow-file-access-from-file-urls", False\)/);
  assert.doesNotMatch(launcher, /\("disable-web-security", True\)/);
});

// Execute the real matchmaking entry point with only the dependencies it uses.
// The simulated WebView has no RTCPeerConnection, as on some WebKitGTK builds.
test('Find Match permits encrypted WebSocket clients without WebRTC and reports missing Web Crypto', () => {
  const entry = matchmaking.match(/^function findOnlineMatch\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(entry, 'matchmaking entry point must be present');
  for (const capabilityError of ['', 'Online unavailable: Web Crypto is blocked because this WebView is not a secure context.']) {
    const statuses = [];
    let observed = 0;
    const context = vm.createContext({
      onlineSession: null, matchmakingRequested: false, matchmakingState: 'offline',
      onlineTransportSelected: false, onlineGameBlocked: false,
      matchmakingPowerupsPreference: null, matchmakingSocket: null, matchmakingWaitTimer: null,
      KING_PONG_MATCHMAKING: {arenas: [0]}, matchArenaId: 0,
      onlineCapabilityError: () => capabilityError,
      playerPreference: () => true,
      setLanStatus: message => statuses.push(message),
      observeMatchmaking: () => { observed++; },
      sendMatchSearch: () => { throw new Error('no matchmaking socket yet'); },
      clearTimeout: () => {}, setTimeout: () => 1,
      syncMatchmakingUi: () => {},
    });
    vm.runInContext(entry + '\nfindOnlineMatch();', context);
    assert.equal(context.matchmakingRequested, !capabilityError);
    assert.equal(observed, capabilityError ? 0 : 1);
    assert.equal(statuses[0], capabilityError || 'Searching for an opponent...');
  }
});
