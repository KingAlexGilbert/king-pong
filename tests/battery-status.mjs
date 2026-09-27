// Run: node --test tests/battery-status.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const builds = {
  Android: '../android/app/src/main/assets/index.html',
  Windows: '../windows/webview-2/index.html',
  Linux: '../Linux/assets/index.html',
};

function harness(html, native = true) {
  const flags = new Set(['unavailable']);
  const indicator = {
    hidden: false, attrs: {}, title: '', writes: 0,
    classList: { toggle: (flag, active) => active ? flags.add(flag) : flags.delete(flag) },
    setAttribute(name, value) { this.attrs[name] = value; this.writes++; },
  };
  const fill = { style: {} };
  const listeners = new Map();
  const battery = { level: 0.6, charging: false, addEventListener(type, fn) { listeners.set(type, fn); } };
  let browserReads = 0;
  const sandbox = {
    indicator, fill,
    navigator: { async getBattery() { browserReads++; return battery; } },
    setLocalizedTitle(element, text) { element.title = text; },
    localizeText: text => text,
    setInterval() { throw new Error('Battery must not poll'); },
    setTimeout() { throw new Error('Battery must not poll'); },
  };
  if (native === 'Android') sandbox.KingPongSaveFiles = {};
  else if (native) sandbox.chrome = { webview: {} };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const script = html.match(/\/\/ BEGIN KING PONG BATTERY STATUS[\s\S]*?\/\/ END KING PONG BATTERY STATUS/)[0];
  const ready = vm.runInContext('const batteryIndicator=indicator,batteryFill=fill; let browserBattery;\n' + script, context);
  return { indicator, fill, flags, battery, listeners, ready,
    get browserReads() { return browserReads; },
    update: (...args) => sandbox.KingPongBattery.update(...args),
  };
}

for (const [platform, path] of Object.entries(builds)) {
  const html = readFileSync(new URL(path, import.meta.url), 'utf8');
  test(`${platform}: native notifications update level, low color and charging state`, () => {
    const app = harness(html, platform);
    assert.equal(app.browserReads, 0);
    app.update(15, false, true);
    assert.equal(app.fill.style.width, '15%');
    assert.ok(app.flags.has('low'));
    assert.equal(app.indicator.title, 'Battery 15%');
    app.update(15, true, true);
    assert.ok(app.flags.has('charging'));
    assert.equal(app.flags.has('low'), false);
    assert.equal(app.indicator.attrs['aria-label'], 'Battery 15% - charging');
    app.update(100, true, true);
    assert.equal(app.fill.style.width, '100%');
    assert.equal(app.indicator.hidden, false);
  });
  test(`${platform}: absent batteries hide; hot-added and full batteries show`, () => {
    const app = harness(html, platform);
    app.update(-1, false, false);
    assert.equal(app.indicator.hidden, true);
    app.update(100, true, true);
    assert.equal(app.indicator.hidden, false);
    assert.equal(app.fill.style.width, '100%');
    assert.match(html, /\.battery-indicator\[hidden\]\s*\{\s*display:\s*none/);
  });
  test(`${platform}: unknown data stays distinct from an absent or empty battery`, () => {
    const app = harness(html, platform);
    app.update(-1, false, false);
    for (const value of [-1, NaN, Infinity, 'bad', null]) {
      app.update(value, true, null);
      assert.equal(app.indicator.hidden, false);
      assert.ok(app.flags.has('unavailable'));
      assert.equal(app.flags.has('charging'), false);
      assert.equal(app.indicator.title, 'Battery level unavailable');
    }
    app.update(0, false, true);
    assert.equal(app.flags.has('unavailable'), false);
    assert.equal(app.indicator.title, 'Battery 0%');
  });
  test(`${platform}: identical readings do not rewrite the indicator`, () => {
    const app = harness(html, platform);
    app.update(60, false, true);
    const writes = app.indicator.writes;
    app.update(60, false, true);
    assert.equal(app.indicator.writes, writes);
    app.update(60, true, true);
    assert.equal(app.indicator.writes, writes + 1);
  });
  test(`${platform}: standalone HTML reads once, then follows browser events`, async () => {
    const app = harness(html, false);
    await app.ready;
    assert.equal(app.browserReads, 1);
    assert.equal(app.fill.style.width, '60%');
    app.battery.level = 0.42;
    app.listeners.get('levelchange')();
    assert.equal(app.fill.style.width, '42%');
    app.battery.charging = true;
    app.listeners.get('chargingchange')();
    assert.ok(app.flags.has('charging'));
    assert.equal(app.browserReads, 1);
  });
}
