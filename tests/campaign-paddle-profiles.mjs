import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const files = [
  'docs/demo/index.html',
  'windows/webview-2/index.html',
  'Linux/assets/index.html',
  'android/app/src/main/assets/index.html'
];

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const brace = source.indexOf('{', start);
  assert.ok(brace > start);
  let depth = 0;
  for (let index = brace; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unterminated ${name}`);
}

function loadProfilesAndResolver(html) {
  const start = html.indexOf('function makePaddleProfile(');
  const end = html.indexOf('const BOSS_ADAPTIVE_PROFILES', start);
  assert.ok(start !== -1 && end > start, 'Campaign paddle definitions missing');
  const setup = html.slice(start, end);
  const context = {
    mode: 1,
    bossIntroActive: false,
    saveData: {royalPaddle: 'player-17'},
    selected: 0,
    left: {side: 'left'},
    right: {side: 'right'},
    TOTAL_LEVELS: 18,
    bossAdaptiveProfile: {name: 'Boss adaptive'},
    customPaddleProfile: {name: 'Custom saved paddle'},
    clamp: (x, a, b) => Math.min(Math.max(x, a), b),
    selectedAbsoluteLevelIndex() {return context.selected;},
    validPaddleId(id) {return typeof id === 'string';},
    selectedPaddleProfile() {return context.customPaddleProfile;}
  };
  vm.runInNewContext(`${setup}\n${functionSource(html, 'activePaddleProfile')}\n` +
    `globalThis.testPaddles = {player: PLAYER_PADDLE_PROFILES, enemy: ENEMY_PADDLE_PROFILES,` +
    ` classic: DEFAULT_PADDLE_PROFILE, activePaddleProfile};`, context);
  return {context, ...context.testPaddles};
}

test('Campaign and Level Select use their fixed player and CPU shapes at every level on every platform', () => {
  for (const file of files) {
    const html = readFileSync(new URL(file, root), 'utf8');
    const {context, player, enemy, activePaddleProfile} = loadProfilesAndResolver(html);
    assert.equal(player.length, 18, `${file}: expected 18 player profiles`);
    assert.equal(enemy.length, 18, `${file}: expected 18 CPU profiles`);
    for (let level = 0; level < 18; level++) {
      context.selected = level;
      context.mode = 1;
      for (const saved of ['classic', 'player-17', 'enemy-17']) {
        context.saveData.royalPaddle = saved;
        assert.strictEqual(activePaddleProfile(context.left), player[level],
          `${file}: level ${level + 1} changed player paddle for saved ${saved}`);
        assert.strictEqual(activePaddleProfile(context.right), enemy[level],
          `${file}: level ${level + 1} changed CPU paddle for saved ${saved}`);
      }
    }
    context.mode = 3;
    context.saveData.royalPaddle = 'player-17';
    assert.strictEqual(activePaddleProfile(context.left), context.customPaddleProfile,
      `${file}: Custom Game must retain selected paddle`);
    context.mode = 2;
    assert.strictEqual(activePaddleProfile(context.left), context.customPaddleProfile,
      `${file}: multiplayer paddle selection must remain available`);
  }
});

test('Campaign and title do not offer paddle selection; Custom and multiplayer do', () => {
  const ui = readFileSync(new URL('game/royal-ui.js', root), 'utf8');
  const assignment = ui.match(/byId\('menuPaddle'\)\.hidden\s*=\s*([^;]+);/);
  assert.ok(assignment, 'In-game paddle button visibility rule missing');
  const hidden = (title, mode, online = false, waitingForServe = true) =>
    vm.runInNewContext(assignment[1], {title, mode, online, waitingForServe});
  for (const mode of [1, 2, 3, 4]) assert.equal(hidden(true, mode), true, 'No title paddle selector');
  assert.equal(hidden(false, 1), true, 'Campaign must not offer paddle selection');
  assert.equal(hidden(false, 4), true, 'Boss must not offer paddle selection');
  assert.equal(hidden(false, 2), false, 'Multiplayer must retain paddle selection');
  assert.equal(hidden(false, 3), false, 'Custom Game must retain paddle selection');
  assert.equal(hidden(false, 2, true, false), true, 'Do not change online paddle during rally');

  const gameplay = readFileSync(new URL('game/royal-gameplay.js', root), 'utf8');
  const gallery = functionSource(gameplay, 'openRoyalGallery');
  assert.match(gallery, /kind === 'paddle'.*mode !== 2 && mode !== 3/,
    'Gallery must refuse Campaign/Boss paddle changes even if called directly');
});
