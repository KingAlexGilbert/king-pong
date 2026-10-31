import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../game/royal-ui.js', import.meta.url), 'utf8');
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Missing startup section ${start}`);
  return source.slice(a, b);
};
const optional = section('function runOptionalRoyalUiStartup(', '\nfunction installRoyalPortraitModal(');
const modal = section('function installRoyalPortraitModal(', '\nfunction royalViewportInset(');
const initialize = section('function initRoyalUi(', '\nfunction royalHelpSection(');

test('optional presentation startup failures are visible but do not stop startup', () => {
  const logged = [];
  const scope = {window: {}, console: {error: (...args) => logged.push(args)}};
  vm.runInNewContext(optional, scope);
  assert.equal(vm.runInNewContext("runOptionalRoyalUiStartup('audio', () => {throw Error('broken optional audio')})", scope), false);
  assert.equal(scope.window.kingPongStartupWarnings.length, 1);
  assert.match(scope.window.kingPongStartupWarnings[0].message, /broken optional audio/);
  assert.equal(logged.length, 1);
  assert.equal(vm.runInNewContext("runOptionalRoyalUiStartup('audio', () => {})", scope), true);
});

test('required title DOM elements fail clearly before partial initialization', () => {
  let mutations = 0;
  const scope = {
    byId: () => null,
    document: {body: {classList: {contains: () => false}}, querySelector: () => null,
      createElement: () => {mutations++; throw Error('Must not create nodes before preflight');}}
  };
  vm.runInNewContext(initialize, scope);
  assert.throws(() => vm.runInNewContext('initRoyalUi()', scope), /Missing required UI elements/);
  assert.equal(mutations, 0);
});

test('an incompletely initialized shell cannot be silently treated as ready', () => {
  const scope = {byId: id => id === 'matchSetup' ? {} : null,
    document: {body: {classList: {contains: () => false}}}};
  vm.runInNewContext(initialize, scope);
  assert.throws(() => vm.runInNewContext('initRoyalUi()', scope), /partially initialized/);
});

test('missing optional platform modal does not crash, required restart dialog is checked', () => {
  const makeScope = restart => ({
    byId: id => id === 'multiplayerRestartPrompt' && restart ? {addEventListener() {}} : null,
    window: {addEventListener() {}}, royalInputModal: () => null,
    royalFocusables: () => []
  });
  const safe = makeScope(true);
  vm.runInNewContext(modal, safe);
  assert.doesNotThrow(() => vm.runInNewContext('installRoyalPortraitModal()', safe));
  const missing = makeScope(false);
  vm.runInNewContext(modal, missing);
  assert.throws(() => vm.runInNewContext('installRoyalPortraitModal()', missing), /Required multiplayer restart prompt/);
});

test('critical rematch dialog creation precedes capture listener installation', () => {
  const p = initialize.indexOf('initMultiplayerRematchUi();');
  const g = initialize.indexOf('installRoyalPortraitModal();');
  assert.ok(p >= 0 && p < g);
  assert.match(initialize, /syncRoyalUi\(true\);[\s\S]*?throw error;/);
});
