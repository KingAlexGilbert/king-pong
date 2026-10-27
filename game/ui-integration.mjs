// Small, reproducible hooks into the existing platform shells. UI implementation stays
// in royal-ui.js; no platform transport or gameplay implementation is replaced.
export function functionRange(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('Missing UI integration point: ' + name);
  let cursor = source.indexOf('{', start) + 1,
    depth = 1,
    quote = '',
    comment = '';
  while (depth && cursor < source.length) {
    const c = source[cursor],
      next = source[cursor + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') {
        comment = '';
        cursor++;
      }
    } else if (quote) {
      if (c === '\\') cursor++;
      else if (c === quote) quote = '';
    } else if (c === '/' && next === '/') {
      comment = 'line';
      cursor++;
    } else if (c === '/' && next === '*') {
      comment = 'block';
      cursor++;
    } else if ('"\'`'.includes(c)) quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    cursor++;
  }
  if (depth) throw new Error('Unclosed UI integration point: ' + name);
  return [start, cursor];
}

// Hook bodies are canonical here; their positions remain explicit in each platform shell.
// Completed one-time migrations now live as ordinary readable shell code (see README.md).
export function synchronizeHooks(source, category, hooks) {
  for (const [name, bodies] of Object.entries(hooks)) {
    const [start, end] = functionRange(source, name);
    const original = source.slice(start, end);
    const marker = new RegExp(
      '^([ \t]*)/\\* ROYAL ' + category + ' \\*/\\r?\\n[\\s\\S]*?^\\1/\\* END ROYAL ' + category + ' \\*/',
      'gm'
    );
    const matches = [...original.matchAll(marker)];
	const newline = original.includes('\r\n') ? '\r\n' : '\n';
    if (matches.length !== bodies.length) {
      throw new Error(
        'Expected ' + bodies.length + ' ROYAL ' + category + ' hooks in ' + name + ', found ' + matches.length
      );
    }
    let index = 0;
    const updated = original.replace(marker, (_, indent) => {
      const lines = bodies[index++].replace(/^\n|\n[ \t]*$/g, '').split('\n');
      const margin = Math.min(...lines.filter(line => line.trim()).map(line => line.match(/^[ \t]*/)[0].length));
      const code = lines.map(line => indent + line.slice(margin)).join(newline);
      return indent + '/* ROYAL ' + category + ' */' + newline + code + newline + indent + '/* END ROYAL ' + category + ' */';
    });
    source = source.slice(0, start) + updated + source.slice(end);
  }
  return source;
}

const hooks = {
  handleViewportChange: ["syncRoyalUi(true);"],
  setLanPanelOpen: [`
    setRoyalOnlineSelection(open);
    syncRoyalUi();
  `],
  requestServeOrContinue: [`
    if (royalOnlineMode() && !lanConnected) return;
    if (pointServeCountdownActive()) return;
    requestRoyalLandscape();
  `],
  loadSaveSlot: ["restorePlayerPreferences();"],
  showTitleScreen: ["resetRoyalUiForTitle();", `
    if (typeof FIRST_LAUNCH_HINT_MESSAGE !== "undefined" && message === FIRST_LAUNCH_HINT_MESSAGE) setLocalizedText(
      titleMessage, "Choose a save slot, then choose a game mode.");
  `],
  startCampaignFromSave: ["levelSelectEncounter = null;\nrequestRoyalLandscape();"],
  startTwoPlayerFromTitle: ["closeLanConnection(false);"],
  startBossFromTitle: ["if (isBossUnlocked()) requestRoyalLandscape();"],
  prepareCustomLevelPreview: ["royalMenuRequested = false;"],
  launchSelectedCustomLevel: ["syncRoyalUi(true);"],
  updateModeControls: ["syncRoyalUi(true);"],
  startCustomMode: ["resetRoyalLocalSetup();"],
  startTwoPlayerMode: ["if (showLevelPicker) resetRoyalLocalSetup();"],
  serveOrContinue: ["syncRoyalUi(true);"],
  updateHud: ["syncRoyalUi(true);"],
  setMenusVisible: [`
    if (!menusVisible) royalMenuRequested = false;
    syncRoyalUi(true);
  `],
  togglePause: [`
    // Replace the retained PAUSED canvas before hiding the menu exposes it.
    // This paints presentation only; the existing RAF owns all simulation steps.
    renderFrame(accumulatedFrameMs / FIXED_STEP_MS, performance.now());
  `],
  drawCampaignPlayInfo: ["if (document.body.classList.contains(\"royal-ui-ready\")) return;"],
  drawOverlay: [`
    if (typeof multiplayerRematchVisible === 'function' && multiplayerRematchVisible()) return;
    if (document.body.classList.contains("royal-panel-open") || royalDesktopPauseVisible()) return;
    // Resume needs only its existing 3, 2, 1; retain panels for actual results.
    if ((paused || hasResumeCountdown()) && !gameOver && !levelCleared && !campaignCleared) return;
    if (pointServeCountdownActive()) { drawPointServeCountdown(); return; }
  `],
};

export function integrateRoyalUi(source) {
  // Guard voluntary navigation at its entry, before any session or mode mutation.
  for (const name of ['showTitleScreen', 'startCampaignFromSave', 'startTwoPlayerFromTitle',
      'startBossFromTitle', 'startCustomMode', 'setCampaign', 'requestExitGame'].filter(name => source.includes('function ' + name + '('))) {
    const [start, end] = functionRange(source, name);
    const original = source.slice(start, end);
    const guard = '\n  if (guardMultiplayerLeave(() => ' + name + '(...arguments))) return;';
    if (!original.includes(guard)) {
      const brace = original.indexOf('{') + 1;
      source = source.slice(0, start) + original.slice(0, brace) + guard + original.slice(brace) + source.slice(end);
    }
  }
  // Pause has one job on touch and desktop alike. Menu remains an explicit action.
  const [pauseStart, pauseEnd] = functionRange(source, 'togglePause');
  source = source.slice(0, pauseStart) + source.slice(pauseStart, pauseEnd)
    .replaceAll('setMenusVisible(true);', 'syncRoyalUi(true);') + source.slice(pauseEnd);
  // Android may blur before visibilitychange. Keep that legacy focus pause
  // from opening a menu over the peer-presence HUD or the recovery countdown.
  const [focusStart, focusEnd] = functionRange(source, 'handleGameFocusLoss');
  const focus = source.slice(focusStart, focusEnd);
  if (!focus.includes('!multiplayerPresence()')) source = source.slice(0, focusStart) + focus.replace(
    'setMenusVisible(true);',
    "if (typeof multiplayerPresence !== 'function' || !multiplayerPresence()) setMenusVisible(true);\n    else syncRoyalUi(true);"
  ) + source.slice(focusEnd);
  // A foreground visibility event is sufficient for negotiated presence;
  // document.hasFocus() may still be false until after this event returns.
  source = source.replace('gameWindowFocused = document.hasFocus();',
    'gameWindowFocused = Boolean(multiplayerPresence()) || document.hasFocus();');
  source = source.replace('if (royalPortraitVisible()) return {axis: 0, targetY: null};',
    'if (royalInputModal()) return {axis: 0, targetY: null};');
  source = source.replace('if (royalPortraitVisible()) { refreshGamepadConnection(pads); return []; }',
    'if (royalInputModal()) { refreshGamepadConnection(pads); return []; }');

  const input = 'function readLocalLanInput(gamepads = null) {';
  const neutral = "\n  if (royalInputModal()) return {axis: 0, targetY: null};";
  if (!source.includes(input + neutral)) source = source.replace(input, input + neutral);
  const pads = '  if (creditsActive || galleryKind || royalUiConsumesGamepad()) {';
  const block = '  if (royalInputModal()) { refreshGamepadConnection(pads); return []; }\n';
  if (!source.includes(block + pads)) source = source.replace(pads, block + pads);
  // The current shell hides the legacy first-launch controls. A hidden panel
  // must not suppress the canvas serve prompt before the player's first serve.
  const firstStart = 'function firstStartControlsShouldDisplay() {';
  const visibleControls = '\n  if (!firstStartControls || firstStartControls.hidden) return false;';
  if (source.includes(firstStart) && !source.includes(firstStart + visibleControls)) {
    source = source.replace(firstStart, firstStart + visibleControls);
  }
  // Guard the programmatic picker too; a locked request must not select a different arena.
  const picker = 'function applyCustomLevelPickerChoice(value) {';
  const guard = '\n  if (Number(value) === TOTAL_LEVELS && !isBossUnlocked()) return;';
  if (!source.includes(picker + guard)) source = source.replace(picker, picker + guard);
  // Controls stay above the arena; the existing canvas indicator identifies a paused match.
  const oldTitle = '      if (!royalDesktopPauseVisible()) drawText("PAUSED", W / 2, H / 2 - 100, 24);';
  const newTitle = '      drawText("PAUSED", W / 2, H / 2 - 100, 24);';
  if (source.includes(oldTitle)) source = source.replace(oldTitle, newTitle);
  else if (!source.includes(newTitle)) throw new Error('Missing canvas pause title integration point');
  return synchronizeHooks(source, "UI", hooks);
}
