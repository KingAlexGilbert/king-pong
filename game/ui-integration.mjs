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
      '^([ \t]*)/\\* ROYAL ' + category + ' \\*/\\n[\\s\\S]*?^\\1/\\* END ROYAL ' + category + ' \\*/',
      'gm'
    );
    const matches = [...original.matchAll(marker)];
    if (matches.length !== bodies.length) {
      throw new Error(
        'Expected ' + bodies.length + ' ROYAL ' + category + ' hooks in ' + name + ', found ' + matches.length
      );
    }
    let index = 0;
    const updated = original.replace(marker, (_, indent) => {
      const lines = bodies[index++].replace(/^\n|\n[ \t]*$/g, '').split('\n');
      const margin = Math.min(...lines.filter(line => line.trim()).map(line => line.match(/^[ \t]*/)[0].length));
      const code = lines.map(line => indent + line.slice(margin)).join('\n');
      return indent + '/* ROYAL ' + category + ' */\n' + code + '\n' + indent + '/* END ROYAL ' + category + ' */';
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
    requestRoyalLandscape();
  `],
  loadSaveSlot: ["if (typeof resetMultiplayerPaddleChoices === \"function\") resetMultiplayerPaddleChoices();"],
  showTitleScreen: ["resetRoyalUiForTitle();", `
    if (typeof FIRST_LAUNCH_HINT_MESSAGE !== "undefined" && message === FIRST_LAUNCH_HINT_MESSAGE) setLocalizedText(
      titleMessage, "Choose a save slot, then choose a game mode.");
  `],
  startCampaignFromSave: ["requestRoyalLandscape();"],
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
  drawCampaignPlayInfo: ["if (document.body.classList.contains(\"royal-ui-ready\")) return;"],
  drawOverlay: ["if (document.body.classList.contains(\"royal-panel-open\")) return;"],
};

export function integrateRoyalUi(source) {
  return synchronizeHooks(source, "UI", hooks);
}
