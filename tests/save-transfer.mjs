// Run with Node 18+: node --test tests/save-transfer.mjs
// Executes the production save code with storage, UI and native pickers isolated.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const builds = {
  Android: '../android/app/src/main/assets/index.html',
  Windows: '../windows/webview-2/index.html',
  Linux: '../Linux/assets/index.html',
};
const sources = Object.fromEntries(Object.entries(builds).map(([name, path]) =>
  [name, readFileSync(new URL(path, import.meta.url), 'utf8')]));
const prefix = 'pongCampaignSaveSlotV2_';
const journal = 'kingPongSaveImportRecoveryV1';
const activeSlotKey = 'pongCampaignActiveSaveSlotV1';
const sharedCode = html => html.slice(html.indexOf('// BEGIN KING PONG SAVE TRANSFER'), html.indexOf('// END KING PONG SAVE TRANSFER'));
const plain = value => JSON.parse(JSON.stringify(value));

function fixture(levels, volume, enabled) {
  return {
    version: 2, createdAt: 1700000000000, updatedAt: 1710000000000,
    highestUnlockedLevel: Math.min(levels, 17),
    completedLevels: Array.from({ length: 18 }, (_, i) => i < levels),
    customCpuIntel: 28, customCpuMaxMove: 5.6,
    musicVolumePercent: volume, musicEnabled: enabled,
    bossUnlocked: levels === 18, bossCleared: levels === 18,
  };
}
const slots = [fixture(4, 0, false), null, fixture(18, 37, true)];
const backup = () => JSON.stringify({ format: 'king-pong-saves', version: 1, activeSlot: 2, slots });

function harness(platform, initial = slots, bridge = true) {
  const html = sources[platform];
  const data = new Map(initial.flatMap((slot, i) => slot === null ? [] : [[prefix + i, JSON.stringify(slot)]]));
  data.set('unrelated-setting', 'keep me');
  const elements = new Map();
  const created = [];
  const messages = [];
  const windowListeners = new Map();
  let fail = () => false;
  let confirms = 0;
  let accept = true;
  let autoRespond = true;
  let focused = null;
  let respondToDialog = () => {};
  const element = (tag = 'div') => ({
    disabled: false, textContent: '', listeners: {}, children: [], attributes: new Map(),
    tagName: tag.toUpperCase(), isConnected: true, hidden: false,
    addEventListener(name, fn) { this.listeners[name] = fn; },
    click() { if (!this.disabled) this.listeners.click?.(); },
    remove() { this.removed = true; },
    hasAttribute(name) { return this.attributes.has(name); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
    contains(target) { return this === target || this.children.some(child => child.contains(target)); },
    focus() { focused = this; },
  });
  const byId = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const storage = {
    getItem: key => data.get(key) ?? null,
    setItem(key, value) {
      if (fail('set', key, value)) throw new Error('Storage unavailable');
      data.set(key, String(value));
    },
    removeItem(key) {
      if (fail('remove', key)) throw new Error('Storage unavailable');
      data.delete(key);
    },
  };
  const background = byId('titleScreen');
  const overlay = byId('saveConfirmOverlay');
  overlay.hidden = true;
  overlay.children = ['saveConfirmTitle', 'saveConfirmMessage', 'saveConfirmCancel', 'saveConfirmAccept'].map(byId);
  background.children = ['importSavesButton', 'exportSavesButton', 'eraseSaveButton'].map(byId);
  focused = byId('importSavesButton');
  const sandbox = {
    byId, TextDecoder, Uint8Array, atob, Blob, URL,
    localStorage: storage,
    confirm() { throw new Error('Save actions must not open a browser confirmation dialog'); },
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    setTimeout(fn) { fn(); }, clearTimeout() {},
    document: {
      get activeElement() { return focused; },
      body: { children: [background, overlay], appendChild() {} },
      createElement(tag) { const el = element(); el.tag = tag; created.push(el); return el; },
    },
    FileReader: class {
      readAsText(file) { this.result = file.text; this.onload(); respondToDialog(); }
    },
    setLocalizedText(el, value) { el.textContent = value; },
    localizeText: value => value,
    clamp: (n, min, max) => Math.max(min, Math.min(max, n)),
    finiteNumber: (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback,
    populateCustomLevelSelect() {}, updateModeControls() {}, updateHud() {},
    chooseCpuError() {}, ensureAudioContext() {}, scheduleMusicLoop() {}, updateMusicButton() {},
    clearHeldInput() {},
    closeLanConnection() {}, setLevelByAbsoluteIndex() {}, showTitleScreen() {},
  };
  sandbox.window = sandbox;
  if (bridge) {
    const native = { postMessage: message => messages.push(message) };
    if (platform === 'Android') sandbox.KingPongSaveFiles = native;
    else sandbox.chrome = { webview: native };
  }
  const context = vm.createContext(sandbox);
  const run = code => vm.runInContext(code, context);
  const functionSource = name => {
    const start = html.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return html.slice(start, html.indexOf('function ', start + 9));
  };
  const saveFunctions = html.slice(html.indexOf('function createDefaultSaveData('), html.indexOf('const FIRST_LAUNCH_HINT_STORAGE_KEY'));
  run(`
    const TOTAL_LEVELS = 18, SAVE_SLOT_COUNT = 3, SAVE_STORAGE_PREFIX = '${prefix.slice(0, -1)}', ACTIVE_SAVE_SLOT_KEY = '${'pongCampaignActiveSaveSlotV1'}';
    let activeSaveSlot = 0, saveData = null, loadingSaveSlot = false, saveImportRecoveryBlocked = false;
    let customCpuIntel = 50, customCpuMaxMove = 4.4, musicVolumeLevel = .75, musicEnabled = true, musicTimer = null;
    function stopActiveMusicTones() {}
    function stopMusicAudioKeepAlive() {}
    const eraseSaveButton = byId('eraseSaveButton');
    const customIntelSlider = {}, customIntelValue = {}, customMaxMoveSlider = {}, customMaxMoveValue = {};
    const musicVolumeSlider = {}, musicVolumeValue = {};
    ${sharedCode(html)}
    ${saveFunctions}
    ${functionSource('eraseActiveSaveSlot')}
    ${['setCustomCpuIntel', 'setCustomCpuMaxMove', 'setMusicVolume', 'setMusicEnabled'].map(functionSource).join('\n')}
    // Rendering is separate from persistence; the real save/load/setter functions run above.
    renderSaveSlots = () => {};
  `);
  respondToDialog = () => {
    if (run('saveConfirmation') && autoRespond) {
      confirms++;
      byId(accept ? 'saveConfirmAccept' : 'saveConfirmCancel').click();
    }
  };
  return {
    run, data, storage, elements, created, messages,
    failWith(fn) { fail = fn; }, confirmWith(value) { accept = value; },
    manualConfirmation() { autoRespond = false; },
    get focus() { return focused; },
    key(key, options = {}) {
      const event = { type: 'keydown', key, repeat: false, ...options,
        preventDefault() { this.prevented = true; },
        stopImmediatePropagation() { this.stopped = true; },
      };
      windowListeners.get(event.type)?.forEach(fn => fn(event));
      return event;
    },
    focusOutside() {
      focused = background;
      windowListeners.get('focusin')?.forEach(fn => fn({ target: background }));
    },
    get confirms() { return confirms; },
    click(operation) { byId(operation + 'SavesButton').click(); },
    get status() { return byId('saveTransferStatus').textContent; },
    receive(status, text = '', id = run('saveTransferRequest.id')) {
      sandbox.KingPongSaveTransfer.receive(id, status, Buffer.from(text).toString('base64'));
      respondToDialog();
    },
    snapshot() { return [...data.entries()].filter(([key]) => key !== activeSlotKey).sort(); },
    saved() { return Array.from({ length: 3 }, (_, i) => JSON.parse(storage.getItem(prefix + i))); },
  };
}

test('all production scripts parse and share exactly the same transfer implementation', () => {
  for (const [platform, html] of Object.entries(sources)) {
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1], { filename: platform });
    assert.equal(sharedCode(html), sharedCode(sources.Android));
    for (const id of ['exportSavesButton', 'importSavesButton', 'eraseSaveButton', 'saveTransferStatus', 'saveConfirmOverlay', 'saveConfirmTitle', 'saveConfirmMessage', 'saveConfirmCancel', 'saveConfirmAccept']) {
      assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1);
    }
    assert.match(html, /recoverInterruptedSaveImport\(\);loadSaveSlot\(rememberedSaveSlot\(\)\);/);
    assert.match(html, /class="save-actions"[\s\S]*?id="exportSavesButton"[\s\S]*?id="importSavesButton"[\s\S]*?id="eraseSaveButton"[\s\S]*?<\/div>/);
    assert.doesNotMatch(html, /window\.confirm\(/);
    assert.match(html, /role="alertdialog" aria-modal="true" aria-labelledby="saveConfirmTitle" aria-describedby="saveConfirmMessage"/);
  }
});

for (const platform of Object.keys(builds)) {
  test(`${platform}: confirmation waits for a decision, traps focus and blocks save changes`, () => {
    const app = harness(platform, [null, fixture(2, 50, true), null]);
    app.run('loadSaveSlot(1)');
    app.manualConfirmation();
    const before = app.snapshot();
    app.click('import'); app.receive('ok', backup());
    assert.equal(app.elements.get('saveConfirmOverlay').hidden, false);
    assert.equal(app.elements.get('saveConfirmTitle').textContent, 'Import Saves');
    assert.equal(app.elements.get('saveConfirmAccept').textContent, 'Import');
    assert.equal(app.focus, app.elements.get('saveConfirmCancel'));
    assert.ok(app.elements.get('titleScreen').hasAttribute('inert'));
    assert.equal(app.elements.get('titleScreen').getAttribute('aria-hidden'), 'true');
    assert.deepEqual(app.snapshot(), before);
    app.click('export'); app.run('eraseActiveSaveSlot(); saveProgressNow()');
    assert.equal(app.messages.length, 1);
    assert.deepEqual(app.snapshot(), before);
    assert.ok(app.key('n').stopped);
    app.focusOutside();
    assert.equal(app.focus, app.elements.get('saveConfirmCancel'));
    app.key('Tab');
    assert.equal(app.focus, app.elements.get('saveConfirmAccept'));
    app.key('Tab', { shiftKey: true });
    assert.equal(app.focus, app.elements.get('saveConfirmCancel'));
    app.key('Enter');
    assert.equal(app.status, 'Import cancelled.');
    assert.equal(app.elements.get('saveConfirmOverlay').hidden, true);
    assert.equal(app.elements.get('titleScreen').hasAttribute('inert'), false);
    assert.equal(app.elements.get('titleScreen').getAttribute('aria-hidden'), null);
    assert.equal(app.focus, app.elements.get('importSavesButton'));
    assert.deepEqual(app.snapshot(), before);
    app.click('import'); app.receive('ok', backup());
    app.key('Tab'); app.key('Enter');
    assert.deepEqual(app.saved(), slots);
    assert.equal(app.status, 'Saves imported.');
  });

  test(`${platform}: Escape/backdrop cancel and erase confirmation affects only the selected slot`, () => {
    const app = harness(platform);
    app.run('loadSaveSlot(2)');
    app.manualConfirmation();
    const before = app.snapshot();
    app.run('eraseActiveSaveSlot()');
    assert.equal(app.elements.get('saveConfirmTitle').textContent, 'Erase Save Slot');
    assert.equal(app.elements.get('saveConfirmAccept').textContent, 'Erase');
    assert.match(app.elements.get('saveConfirmMessage').textContent, /Erase Slot 3/);
    app.key('Escape');
    assert.deepEqual(app.snapshot(), before);
    app.run('eraseActiveSaveSlot()');
    const overlay = app.elements.get('saveConfirmOverlay');
    overlay.listeners.click({ target: overlay, stopPropagation() {} });
    assert.deepEqual(app.snapshot(), before);
    app.run('eraseActiveSaveSlot()');
    assert.equal(app.run('window.KingPongSaveTransfer.cancelConfirmation()'), true);
    assert.equal(app.run('window.KingPongSaveTransfer.cancelConfirmation()'), false);
    assert.deepEqual(app.snapshot(), before);
    app.run('eraseActiveSaveSlot()');
    app.elements.get('saveConfirmAccept').click();
    assert.deepEqual(app.saved(), [slots[0], null, null]);
    assert.equal(app.run('activeSaveSlot'), 2);
    assert.equal(app.elements.get('saveConfirmOverlay').hidden, true);
  });

  test(`${platform}: loading slots preserves muted music, CPU settings and original save data`, () => {
    const app = harness(platform);
    const before = app.snapshot();
    app.run('loadSaveSlot(0)');
    assert.deepEqual(plain(app.run('[customCpuIntel,customCpuMaxMove,musicVolumeLevel,musicEnabled]')), [28, 5.6, 0, false]);
    app.run('loadSaveSlot(2)');
    assert.deepEqual(plain(app.run('[musicVolumeLevel,musicEnabled]')), [.37, true]);
    app.run('loadSaveSlot(1)');
    assert.equal(app.storage.getItem(prefix + 1), null);
    assert.deepEqual(app.snapshot(), before);
  });

  test(`${platform}: selected save slot is remembered separately from save data`, () => {
    const app = harness(platform);
    app.run('loadSaveSlot(2)');
    assert.equal(app.storage.getItem(activeSlotKey), '2');
    assert.equal(app.run('rememberedSaveSlot()'), 2);
    app.run('loadSaveSlot(1)');
    assert.equal(app.storage.getItem(activeSlotKey), '1');
    assert.equal(app.run('rememberedSaveSlot()'), 1);
  });

  test(`${platform}: export includes all slots and transfers into every other build`, () => {
    const app = harness(platform);
    app.run('loadSaveSlot(2)');
    const before = app.snapshot();
    app.click('export');
    assert.equal(app.messages.length, 1);
    assert.ok(app.elements.get('eraseSaveButton').disabled);
    const text = app.messages[0].replace(/^kingpong:save:export:\d+:/, '');
    assert.deepEqual(JSON.parse(text).slots, slots);
    assert.equal(JSON.parse(text).activeSlot, 2);
    app.receive('ok');
    assert.equal(app.status, 'Saves exported.');
    assert.deepEqual(app.snapshot(), before);
    for (const destination of Object.keys(builds)) {
      const other = harness(destination, [fixture(1, 100, false), fixture(2, 65, true), null]);
      other.click('import');
      assert.match(other.messages[0], /^kingpong:save:import:\d+$/);
      other.receive('ok', text);
      assert.equal(other.status, 'Saves imported.');
      assert.deepEqual(other.saved(), slots);
      assert.equal(other.run('activeSaveSlot'), 2);
      assert.equal(other.run('musicVolumeLevel'), .37);
      assert.equal(other.storage.getItem(journal), null);
      assert.equal(other.storage.getItem('unrelated-setting'), 'keep me');
    }
  });

  test(`${platform}: picker/confirmation cancellation, stale callbacks and I/O errors do not change saves`, () => {
    const app = harness(platform);
    const before = app.snapshot();
    for (const operation of ['import', 'export']) {
      for (const status of ['cancel', 'error']) {
        app.click(operation);
        app.receive('ok', backup(), 999);
        assert.equal(app.run('saveTransferRequest.operation'), operation);
        app.receive(status);
        assert.deepEqual(app.snapshot(), before);
        assert.equal(app.elements.get('importSavesButton').disabled, false);
      }
    }
    app.confirmWith(false);
    app.click('import'); app.receive('ok', backup());
    assert.equal(app.confirms, 1);
    assert.equal(app.status, 'Import cancelled.');
    assert.deepEqual(app.snapshot(), before);
  });

  test(`${platform}: invalid backups are rejected before confirmation or storage writes`, () => {
    const app = harness(platform);
    const before = app.snapshot();
    const variations = ['{broken', 'null', '[]', 'x'.repeat(65537)];
    for (const mutate of [
      b => b.format = 'another-game', b => b.version = 2,
      b => b.activeSlot = 3, b => b.activeSlot = -1, b => b.activeSlot = .5,
      b => b.slots.pop(), b => b.slots[0] = [], b => b.slots[0].version = 1,
      b => b.slots[0].completedLevels.pop(), b => b.slots[0].completedLevels[0] = 1,
      b => b.slots[0].highestUnlockedLevel = 18, b => b.slots[0].customCpuIntel = -1,
      b => b.slots[0].customCpuMaxMove = 13, b => b.slots[0].musicVolumePercent = 101,
      b => b.slots[0].musicEnabled = 'false', b => delete b.slots[0].createdAt,
      b => b.slots[0].bossCleared = 1,
    ]) {
      const value = JSON.parse(backup()); mutate(value); variations.push(JSON.stringify(value));
    }
    for (const text of variations) {
      app.click('import'); app.receive('ok', text);
      assert.notEqual(app.status, 'Saves imported.');
      assert.deepEqual(app.snapshot(), before);
    }
    assert.equal(app.confirms, 0);
  });

  test(`${platform}: BOM/unknown fields are safe and importing empty slots clears all progress`, () => {
    const app = harness(platform);
    const value = JSON.parse(backup());
    value.slots[0].unknown = "');window.injected=true;//";
    value.slots[0].__proto__ = { injected: true };
    app.click('import'); app.receive('ok', '\uFEFF' + JSON.stringify(value));
    assert.deepEqual(app.saved(), slots);
    assert.equal(app.run('typeof window.injected'), 'undefined');
    value.slots = [null, null, null]; value.activeSlot = 0;
    app.click('import'); app.receive('ok', JSON.stringify(value));
    assert.deepEqual(app.saved(), [null, null, null]);
    assert.equal(app.run('saveData.highestUnlockedLevel'), 0);
    assert.equal(app.run('musicVolumeLevel'), .75);
  });

  test(`${platform}: failure to create recovery data aborts before touching a slot`, () => {
    const app = harness(platform);
    const before = app.snapshot();
    app.failWith((operation, key) => operation === 'set' && key === journal);
    app.click('import'); app.receive('ok', backup());
    assert.deepEqual(app.snapshot(), before);
    assert.equal(app.status, 'Import failed. Your previous saves were kept.');
  });

  test(`${platform}: a partial write failure rolls back every slot`, () => {
    const app = harness(platform, [fixture(2, 20, true), fixture(5, 65, false), null]);
    const before = app.snapshot();
    let failed = false;
    app.failWith((operation, key) => {
      if (!failed && operation === 'remove' && key === prefix + 1) { failed = true; return true; }
      return false;
    });
    app.click('import'); app.receive('ok', backup());
    assert.equal(failed, true);
    assert.deepEqual(app.snapshot(), before);
    assert.equal(app.status, 'Import failed. Your previous saves were kept.');
  });

  test(`${platform}: interrupted import recovers on restart; failed recovery blocks writes`, () => {
    const app = harness(platform);
    const before = app.snapshot();
    const previous = Array.from({ length: 3 }, (_, i) => app.storage.getItem(prefix + i));
    app.storage.setItem(journal, JSON.stringify(previous));
    app.storage.setItem(prefix + 0, JSON.stringify(fixture(8, 93, true)));
    app.failWith((operation, key) => operation === 'set' && key === prefix + 0);
    assert.equal(app.run('recoverInterruptedSaveImport()'), false);
    assert.ok(app.elements.get('eraseSaveButton').disabled);
    const failed = app.snapshot();
    app.run('loadSaveSlot(0); setMusicVolume(42); saveProgressNow()');
    app.click('import');
    assert.deepEqual(app.snapshot(), failed);
    assert.equal(app.messages.length, 0);
    app.failWith(() => false);
    // A new process starts with this flag clear, then runs recovery before loading.
    app.run('saveImportRecoveryBlocked=false; recoverInterruptedSaveImport(); loadSaveSlot(0)');
    assert.deepEqual(app.snapshot(), before);
    assert.equal(app.run('musicVolumeLevel'), 0);
  });

  test(`${platform}: standalone HTML file input/download fallback`, () => {
    const app = harness(platform, slots, false);
    app.click('export');
    assert.equal(app.created.at(-1).download, 'KingPong-saves.json');
    assert.equal(app.status, 'Saves exported.');
    app.click('import');
    const input = app.created.at(-1);
    input.files = [{ size: Buffer.byteLength(backup()), text: backup() }];
    input.listeners.change();
    assert.equal(app.status, 'Saves imported.');
    assert.deepEqual(app.saved(), slots);
    app.click('import');
    app.created.at(-1).listeners.cancel();
    assert.equal(app.status, 'Import cancelled.');
  });
}
