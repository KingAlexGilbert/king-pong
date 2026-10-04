// Small, reproducible hooks into the existing platform shells. UI implementation stays
// in royal-ui.js; no platform transport or gameplay implementation is replaced.
function functionRange(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('Missing UI integration point: ' + name);
  let cursor = source.indexOf('{', start) + 1, depth = 1, quote = '', comment = '';
  while (depth && cursor < source.length) {
    const c = source[cursor], next = source[cursor + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; cursor++; }
    } else if (quote) {
      if (c === '\\') cursor++;
      else if (c === quote) quote = '';
    } else if (c === '/' && next === '/') { comment = 'line'; cursor++; }
    else if (c === '/' && next === '*') { comment = 'block'; cursor++; }
    else if ('"\'`'.includes(c)) quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    cursor++;
  }
  if (depth) throw new Error('Unclosed UI integration point: ' + name);
  return [start, cursor];
}
export function integrateRoyalUi(source) {
  const edit = (name, transform) => {
    const [start, end] = functionRange(source, name);
    const original = source.slice(start, end).replace(/\/\* ROYAL UI \*\/[\s\S]*?\/\* END ROYAL UI \*\//g, '');
    source = source.slice(0, start) + transform(original) + source.slice(end);
  };
  const hook = code => '/* ROYAL UI */' + code + '/* END ROYAL UI */';
  const after = (name, code) => edit(name, f => f.slice(0, -1) + hook(code) + '}');
  const before = (name, code) => edit(name, f => f.replace('{', '{' + hook(code)));
  for (const name of ['updateModeControls', 'updateHud', 'serveOrContinue', 'launchSelectedCustomLevel', 'handleViewportChange']) after(name, 'syncRoyalUi(true);');
  after('setMenusVisible', 'if(!menusVisible)royalMenuRequested=false;syncRoyalUi(true);');
  after('setLanPanelOpen', 'setRoyalOnlineSelection(open);syncRoyalUi();');
  edit('updateLanPanelVisibility', () => 'function updateLanPanelVisibility(){syncRoyalUi(true);updateControlHint();}');
  edit('updateControlHint', () => 'function updateControlHint(){updateRoyalControlHint();}');
  edit('toggleMenus', () => 'function toggleMenus(){toggleRoyalMenu();}');
  edit('makeMenuControlsMouseAndTouchOnly', () => 'function makeMenuControlsMouseAndTouchOnly(){prepareAccessibleMenuControls();}');
  edit('startTwoPlayerFromTitle', f => f.replace('openRoyalGallery("arena");', '').replace('{', '{' + hook('closeLanConnection(false);')));
  edit('startCustomFromSave', f => f.replace('if(mode===3)openRoyalGallery("arena");', ''));
  edit('showTitleScreen', f => f.replace('{', '{' + hook('resetRoyalUiForTitle();')).slice(0, -1) +
    hook('if(typeof FIRST_LAUNCH_HINT_MESSAGE!=="undefined"&&message===FIRST_LAUNCH_HINT_MESSAGE)setLocalizedText(titleMessage,"Choose a save slot, then choose a game mode.");') + '}');
  before('startCustomMode', 'resetRoyalLocalSetup();');
  before('prepareCustomLevelPreview', 'royalMenuRequested=false;');
  before('startTwoPlayerMode', 'if(showLevelPicker)resetRoyalLocalSetup();');
  after('loadSaveSlot', 'if(typeof resetMultiplayerPaddleChoices==="function")resetMultiplayerPaddleChoices();');
  before('requestServeOrContinue', 'if(royalOnlineMode()&&!lanConnected)return;requestRoyalLandscape();');
  before('startCampaignFromSave', 'requestRoyalLandscape();');
  before('startBossFromTitle', 'if(isBossUnlocked())requestRoyalLandscape();');
  before('drawCampaignPlayInfo', 'if(document.body.classList.contains("royal-ui-ready"))return;');
  edit('draw', f => f.replace(/if\(menusVisible(?:&&!document.body.classList.contains\("royal-ui-ready"\))?\)\{drawText\(modeText/, 'if(menusVisible&&!document.body.classList.contains("royal-ui-ready")){drawText(modeText'));
  edit('isFullScreenTouchControlTarget', f => f.replace(/\.royal-gallery,(?:\.match-ui,)?/, '.royal-gallery,.match-ui,'));
  before('drawOverlay', 'if(document.body.classList.contains("royal-panel-open"))return;');
  edit('fitCanvasToViewport', f => f.replace(/viewport.height-CSS_PLAYFIELD_MARGIN(?:-royalViewportInset\(\))?/, 'viewport.height-CSS_PLAYFIELD_MARGIN-royalViewportInset()'));
  edit('updateGamepadInput', f => f.replace(/creditsActive\|\|galleryKind(?:\|\|royalUiConsumesGamepad\(\))?/, 'creditsActive||galleryKind||royalUiConsumesGamepad()'));
  return source;
}
