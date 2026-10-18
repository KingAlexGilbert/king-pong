// Browser-only: navigation cannot carry activation into a new tab. Consume one
// deliberate gesture after a launcher visit, then leave fullscreen to the player.
(() => {
  const root = document.documentElement;
  const displayMode = window.matchMedia('(display-mode: fullscreen)');
  let wasBrowserFullscreen = false, hintTimer = 0;
  if (!root.requestFullscreen || !document.exitFullscreen || document.fullscreenEnabled === false) return;
  let armed = new URLSearchParams(location.search).get('kingpong_fullscreen') === '1' ||
    new URLSearchParams(location.hash.slice(1)).get('kingpong_fullscreen') === '1';
  let attempted = false, exited = false, pending = null, wasFullscreen = Boolean(document.fullscreenElement), exitAt = -Infinity;
  const button = document.createElement('button');
  button.id = 'browserFullscreen'; button.className = 'match-ui'; button.type = 'button'; button.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  button.style.cssText = 'position:fixed;right:max(10px,env(safe-area-inset-right,0px));top:calc(4px + env(safe-area-inset-top,0px));z-index:90;min-width:42px;min-height:42px;padding:6px;color:#d3d9e2;background:#050507;border:1px solid #66513a;font-size:23px;touch-action:manipulation';
  const hint = document.createElement('p'); hint.id = 'browserFullscreenHint'; hint.hidden = true;
  hint.setAttribute('role', 'status');
  hint.style.cssText = 'position:fixed;right:10px;top:48px;z-index:91;max-width:min(320px,calc(100vw - 44px));padding:10px;color:#ffe1a0;background:#08060b;border:1px solid #ffd469;font:12px/1.5 monospace;pointer-events:none';
  function browserFullscreen() {
    // Only browser-exposed state, never screen-size guesses or remembered F11 keys.
    return !document.fullscreenElement && (window.fullScreen === true || displayMode.matches);
  }
  function explainBrowserFullscreen() {
    armed = false; attempted = true;
    setLocalizedText(hint, 'Press F11 or use your browser’s fullscreen control to exit browser fullscreen.');
    hint.hidden = false; clearTimeout(hintTimer); hintTimer = setTimeout(() => { hint.hidden = true; }, 5000);
  }
  function sync() {
    const active = Boolean(document.fullscreenElement);
    if (wasFullscreen && !active) { exited = true; armed = false; exitAt = performance.now(); }
    const browser = browserFullscreen();
    if (wasBrowserFullscreen && !browser && !active) { exited = true; armed = false; exitAt = performance.now(); }
    if (browser) armed = false;
    if (!browser) hint.hidden = true;
    wasBrowserFullscreen = browser; wasFullscreen = active;
    button.dataset.fullscreenMode = active ? 'element' : browser ? 'browser' : 'windowed';
    const label = localizeText(active ? 'Exit fullscreen' : browser ? 'Browser fullscreen (F11)' : 'Enter fullscreen');
    button.title = label; button.setAttribute('aria-label', label); button.setAttribute('aria-pressed', String(active || browser));
  }
  function enter(manual = false) {
    if (document.fullscreenElement) return Promise.resolve(true);
    if (browserFullscreen()) { armed = false; if (manual) explainBrowserFullscreen(); return Promise.resolve(false); }
    if (pending) return pending;
    if (!navigator.userActivation?.isActive || !manual && (attempted || exited)) return Promise.resolve(false);
    armed = false; attempted = true;
    try {
      pending = Promise.resolve(root.requestFullscreen({navigationUI: 'hide'})).then(() => true, () => false).finally(() => { pending = null; sync(); });
      return pending;
    } catch { sync(); return Promise.resolve(false); }
  }
  button.addEventListener('click', event => {
    event.stopPropagation(); armed = false;
    if (document.fullscreenElement) { try { Promise.resolve(document.exitFullscreen()).catch(() => {}); } catch {} }
    else enter(true);
  });
  const gesture = event => {
    if (!armed || !event.isTrusted || event.target.closest?.('input,textarea,select,#browserFullscreen')) return;
    if (event.type === 'keydown' && (event.repeat || !['Enter', ' '].includes(event.key))) return;
    enter();
  };
  window.addEventListener('click', gesture, true);
  window.addEventListener('keydown', event => {
    // Do not prevent the browser's default Escape action. Keep that same key
    // from also invoking the game's title/reset shortcut, including exit races.
    if (event.key === 'Escape' && (document.fullscreenElement || browserFullscreen() || performance.now() - exitAt < 350)) {
      event.stopImmediatePropagation(); return;
    }
    gesture(event);
  }, true);
  document.addEventListener('fullscreenchange', sync);
  window.KingPongFullscreen = {enter, consumesEscape: () => Boolean(document.fullscreenElement) || browserFullscreen() || performance.now() - exitAt < 350, get exited() { return exited; }};
  displayMode.addEventListener?.('change', sync);
  window.addEventListener('resize', sync); window.addEventListener('pageshow', sync);
  document.body.append(button, hint); sync();
})();
