// Shared presentation layer. The existing game and network state remain authoritative.
let royalOnlineSelected = false;
let royalMenuRequested = false;
let royalUiSignature = '';
let royalLastDialog = null;
let royalReturnFocus = null;
let royalOrientationAttempted = false;
let royalOrientationGeneration = 0;
let royalOrientationOwned = false;
let royalRotateDismissed = false;
let royalUiGamepadDirection = 0;
let royalUiGamepadAt = 0;

function royalViewportInset() {
  if (!document.body.classList.contains('royal-ui-ready')) return 0;
  const style = getComputedStyle(document.body);
  return parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
}

function royalOnlineMode() {
  return mode === 2 && (royalOnlineSelected || isLanActive());
}

function setRoyalOnlineSelection(open) {
  if (!byId('matchSetup')) return;
  royalOnlineSelected = Boolean(open) || isLanActive();
  if (open) royalMenuRequested = false;
}

function resetRoyalLocalSetup() {
  royalOnlineSelected = false;
  royalMenuRequested = false;
  lanPanelOpen = false;
}

function resetRoyalUiForTitle() {
  royalOnlineSelected = royalMenuRequested = false;
  lanPanelOpen = false;
  royalRotateDismissed = false;
  royalOrientationAttempted = false;
  royalOrientationGeneration++;
  if (royalOrientationOwned) {
    try {
      window.screen.orientation.unlock();
    } catch {}
    royalOrientationOwned = false;
  }
}

function royalModeName() {
  if (mode === 4 || bossIntroActive) return 'Secret Boss';
  if (mode === 3) return 'Custom Game';
  if (royalOnlineMode()) return typeof KingPongRoom !== 'undefined' ? 'Online Multiplayer' : 'LAN Two Player';
  if (mode === 2) return 'Local Two Player';
  return 'Campaign';
}

function royalNeedsSetup() {
  if (royalOnlineMode() && !lanConnected) return true;
  return customPreviewActive || mode === 2 && waitingForServe && left.score === 0 && right.score === 0 && !gameOver;
}

function royalText(element, value) {
  if (element.dataset.royalText === String(value) && element.textContent === localizeText(value)) return;
  element.dataset.royalText = String(value);
  setLocalizedText(element, value);
}

function royalButton(id, label, action, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = id;
  button.className = className;
  setLocalizedText(button, label);
  button.addEventListener('click', action);
  return button;
}

function prepareAccessibleMenuControls() {
  for (const control of document.querySelectorAll('button,summary')) {
    control.tabIndex = 0;
    control.removeAttribute('data-keyboard-menu-disabled');
  }
}

function royalDisclosure(label, id) {
  const details = document.createElement('details');
  details.id = id;
  const summary = document.createElement('summary');
  setLocalizedText(summary, label);
  details.append(summary);
  return details;
}

function royalDialog(id, title) {
  const overlay = document.createElement('section');
  overlay.id = id;
  overlay.className = 'match-overlay match-ui';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', id + 'Title');
  const card = document.createElement('div');
  card.className = 'match-card';
  const heading = document.createElement('h2');
  heading.id = id + 'Title';
  setLocalizedText(heading, title);
  card.append(heading);
  overlay.append(card);
  document.body.append(overlay);
  return card;
}

function initRoyalUi() {
  if (byId('matchSetup')) return;
  const subtitle = document.querySelector('.title-subtitle');
  // Keep translated sentences intact. A phrase never leaves its last word on a line alone.
  const phrases = subtitle.textContent.match(/[^.!。！]+[.!。！]?/g) || [subtitle.textContent];
  subtitle.replaceChildren();
  for (let i = 0; i < phrases.length; i += 2) {
    const span = document.createElement('span');
    span.textContent = phrases.slice(i, i + 2).map(s => s.trim()).join(' ');
    subtitle.append(span);
  }

  const bar = document.createElement('header');
  bar.id = 'matchBar';
  bar.className = 'match-bar match-ui';
  const identity = document.createElement('div');
  identity.className = 'match-identity';
  identity.innerHTML = '<strong id="matchMode"></strong><span id="matchContext"></span>';
  bar.append(menuToggle, identity, royalButton('matchContinue', 'Serve', royalContinue, 'match-primary'), royalButton(
    'matchPause', 'Pause', () => {
      requestTogglePause();
      syncRoyalUi(true);
    }));
  menuToggle.setAttribute('aria-haspopup', 'dialog');
  menuToggle.setAttribute('aria-controls', 'matchMenu');
  document.body.append(bar);
  const footer = document.createElement('footer');
  footer.className = 'match-footer';
  footer.append(byId('clockIndicator'), controlHint, byId('batteryIndicator'));
  document.body.append(footer);

  const setup = royalDialog('matchSetup', 'Match setup');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'match-eyebrow';
  setLocalizedText(eyebrow, 'MATCH SETUP');
  setup.prepend(eyebrow);
  setup.append(lanPanel, document.querySelector('.royal-selection-row'));
  const custom = royalDisclosure('CPU settings', 'matchCpuSettings');
  custom.append(customPanel);
  setup.append(custom);
  const setupHint = document.createElement('p');
  setupHint.id = 'matchSetupHint';
  setupHint.className = 'match-note';
  setup.append(setupHint);
  const setupActions = document.createElement('div');
  setupActions.className = 'match-actions';
  setupActions.append(royalButton('matchServe', 'Start match', royalContinue, 'match-primary'), royalButton(
    'setupMenuButton', 'Menu (M)', () => {
      royalMenuRequested = true;
      setMenusVisible(true);
    }));
  setup.append(setupActions);
  const setupBody = document.createElement('div');
  setupBody.id = 'matchSetupBody';
  setupBody.append(lanPanel, document.querySelector('.royal-selection-row'), createMatchRulesUi(), custom, setupHint);
  setup.insertBefore(setupBody, setupActions);

  const menu = royalDialog('matchMenu', 'Match menu');
  const menuActions = document.createElement('div');
  menuActions.className = 'match-actions';
  menuActions.append(royalButton('matchResume', 'Resume', royalContinue, 'match-primary'), restartButton,
    titleJumpButton);
  menu.append(menuActions);
  menu.append(royalDisclosure('Room / connection', 'matchConnection'));
  const configure = document.createElement('div');
  configure.className = 'match-actions';
  configure.append(royalButton('menuPaddle', 'Choose your paddle', () => openRoyalGallery('paddle')), royalButton(
    'menuPaddle2', 'Player 2 paddle', () => openRoyalGallery('paddle', 'right')), royalButton('menuArena',
    'Choose your arena', () => openRoyalGallery('arena')));
  menu.append(configure);
  const modes = royalDisclosure('Change mode', 'matchModes');
  const modeGrid = document.createElement('div');
  modeGrid.className = 'match-mode-grid controls';
  const campaignGroup = document.createElement('section');
  campaignGroup.className = 'campaign-mode-group';
  campaignGroup.setAttribute('aria-label', localizeText('Campaign'));
  const campaignEntry = royalButton('menuCampaign', 'Campaign', startCampaignFromSave);
  const chapters = document.createElement('div');
  chapters.className = 'campaign-chapters';
  const chapterLabel = document.createElement('span');
  chapterLabel.className = 'match-eyebrow';
  setLocalizedText(chapterLabel, 'Chapters');
  chapters.append(chapterLabel, ...campaignButtons);
  campaignGroup.append(campaignEntry, chapters);
  royalText(twoPlayerModeButton, 'Local Two Player');
  modeGrid.append(campaignGroup, customModeButton, twoPlayerModeButton, lanModeButton,
    royalButton('menuBoss', 'Secret Boss', startBossFromTitle, 'secret-boss-button'));
  modes.append(modeGrid);
  menu.append(modes);
  const settings = royalDisclosure('Settings', 'matchSettings');
  const audio = royalHelpSection('audioSettings', 'Audio');
  audio.classList.add('audio-settings');
  const audioRows = document.createElement('div');
  audioRows.className = 'audio-rows';
  for (const [label, button] of [
      ['Mute All', royalButton('muteAllButton', 'OFF', () => setGameMuteAll(!saveData.muteAll))],
      ['Music', musicButton],
      ['Sound Effects', royalButton('soundEffectsButton', 'ON', () => setSoundEffectsEnabled(saveData
        .soundEffectsEnabled === false))]
    ]) {
    const row = document.createElement('div');
    row.className = 'audio-row';
    const caption = document.createElement('span');
    caption.id = button.id + 'Label';
    setLocalizedText(caption, label);
    button.setAttribute('aria-labelledby', caption.id + ' ' + button.id);
    row.append(caption, button);
    audioRows.append(row);
  }
  const volume = document.querySelector('.music-volume-control');
  volume.classList.add('audio-volume');
  setLocalizedText(volume.querySelector('span'), 'Music volume');
  audio.append(audioRows, volume);
  settings.append(audio);
  const display = royalHelpSection('displaySettings', 'Display');
  display.append(playInfoToggle);
  settings.append(display);
  menu.append(settings);
  const help = royalDisclosure('Controls & royal powerups', 'matchHelp');
  document.querySelector('.royal-selection-row .royal-help')?.remove();
  help.append(createRoyalHelp());
  const onlineHelp = lanPanel.querySelector('.royal-help');
  if (onlineHelp) {
    onlineHelp.id = 'onlinePaddleHelp';
    help.append(onlineHelp);
  }
  menu.append(help);
  const close = royalButton('matchMenuClose', 'Close menu', () => setMenusVisible(false));
  close.className = 'match-close';
  menu.append(close);
  byId('matchMenu').addEventListener('click', event => {
    if (event.target === byId('matchMenu')) setMenusVisible(false);
  });

  const rotate = royalDialog('rotateDevice', 'Rotate your device to landscape');
  const symbol = document.createElement('div');
  symbol.className = 'rotate-symbol';
  symbol.setAttribute('aria-hidden', 'true');
  symbol.textContent = '↻';
  rotate.prepend(symbol);
  const rotateNote = document.createElement('p');
  rotateNote.className = 'match-note';
  setLocalizedText(rotateNote, 'The arena plays best with your phone on its side.');
  rotate.append(rotateNote);
  const rotateActions = document.createElement('div');
  rotateActions.className = 'match-actions';
  rotateActions.append(royalButton('rotateDismiss', 'Continue in portrait', () => {
    royalRotateDismissed = true;
    syncRoyalOrientation();
  }), royalButton('rotateMenu', 'Menu (M)', () => {
    royalMenuRequested = true;
    setMenusVisible(true);
  }), royalButton('rotateTitle', 'Title Screen', () => showTitleScreen()));
  rotate.append(rotateActions);

  // The legacy nodes remain available to their platform code; the focused shell owns their presentation.
  document.querySelector('.menu-stack').hidden = true;
  if (typeof firstStartControls !== 'undefined' && firstStartControls) firstStartControls.hidden = true;
  for (const button of document.querySelectorAll('.royal-selection-row button')) button.setAttribute('aria-haspopup',
    'dialog');
  for (const id of ['matchCpuSettings', 'matchModes', 'matchSettings', 'matchHelp', 'matchConnection']) {
    byId(id).addEventListener('toggle', () => syncRoyalFocus());
  }
  prepareAccessibleMenuControls();
  document.body.classList.add('royal-ui-ready');
  // One listener per page. Rotation only changes presentation, never match or connection state.
  window.addEventListener('resize', syncRoyalOrientation);
  window.screen.orientation?.addEventListener?.('change', syncRoyalOrientation);
  document.addEventListener('fullscreenchange', syncRoyalOrientation);
  handleViewportChange();
  syncRoyalUi(true);
}

function royalHelpSection(id, label) {
  const section = document.createElement('section');
  section.id = id;
  section.className = 'match-section';
  const heading = document.createElement('h3');
  heading.id = id + 'Title';
  setLocalizedText(heading, label);
  section.setAttribute('aria-labelledby', heading.id);
  section.append(heading);
  return section;
}

function royalPowerupHelpIcon(type) {
  const sprite = royalPickupSprite(type);
  const icon = document.createElement('canvas');
  icon.width = sprite.width;
  icon.height = sprite.height;
  icon.setAttribute('aria-hidden', 'true');
  icon.style.width = '32px';
  icon.style.height = '32px';
  icon.style.flex = '0 0 32px';
  icon.style.imageRendering = 'pixelated';
  icon.getContext('2d').drawImage(sprite, 0, 0);
  return icon;
}

function createRoyalHelp() {
  const content = document.createElement('div');
  content.id = 'fullControlHelp';
  content.className = 'help-grid';
  for (const [id, title, rows] of [
      ['helpKeyboard', 'Keyboard', [
        ['W / S', 'Move (Player 1 in local play)'],
        ['↑ / ↓', 'Move (Player 2 in local play)'],
        ['Space', 'Serve / continue'],
        ['P', 'Pause / resume'],
        ['R', 'Restart match'],
        ['M', 'Menu'],
        ['G', 'Goal info'],
        ['N', 'Music'],
        ['0 / Esc', 'Title Screen']
      ]],
      ['helpController', 'Controller', [
        ['Stick / D-pad', 'Move'],
        ['A', 'Serve / continue'],
        ['Start', 'Pause / resume'],
        ['B', 'Restart match'],
        ['Select', 'Menu'],
        ['P1 / P2', 'One controller per local player']
      ]],
      ['helpTouch', 'Mobile / Touch', [
        ['Drag', 'Move'],
        ['Left / right side', 'Player 1 / Player 2 in local play'],
        ['Tap', 'Serve / continue'],
        ['Two fingers', 'Pause / resume']
      ]],
      ['helpPowerups', 'Royal Powerups', [
        ['Royal Split', 'Both balls score. The duplicate starts at 70% speed.', 'split'],
        ['Crown Rush', '30% faster until the next paddle hit.', 'rush'],
        ['Castle Guard', 'A defensive wall for 10 seconds.', 'guard']
      ]]
    ]) {
    const section = royalHelpSection(id, title),
      list = document.createElement('dl');
    for (const [key, description, powerupType] of rows) {
      const term = document.createElement('dt'),
        definition = document.createElement('dd');

      if (powerupType) {
        const label = document.createElement('span');
        setLocalizedText(label, key);

        term.style.display = 'flex';
        term.style.alignItems = 'center';
        term.style.gap = '8px';

        term.append(royalPowerupHelpIcon(powerupType), label);
      } else {
        setLocalizedText(term, key);
      }

      setLocalizedText(definition, description);
      list.append(term, definition);
    }
    section.append(list);
    content.append(section);
  }
  return content;
}

function createMatchRulesUi() {
  const section = royalHelpSection('matchRules', 'Match rules');
  const options = document.createElement('div');
  options.className = 'match-rule-options';
  options.setAttribute('role', 'group');
  options.setAttribute('aria-labelledby', 'matchRulesTitle');
  for (const [id, rule] of Object.entries(MATCH_RULES)) options.append(royalButton('matchRule-' + id, rule.label, () =>
    setMatchRule(id)));
  const summary = document.createElement('p');
  summary.id = 'matchRulesSummary';
  summary.className = 'match-note';
  section.append(options, summary);
  return section;
}

function syncMatchRulesUi() {
  byId('matchRules').hidden = mode !== 2;
  const guest = lanRole === 'guest';
  byId('matchRules').querySelector('.match-rule-options').hidden = guest;
  for (const id of Object.keys(MATCH_RULES)) {
    const button = byId('matchRule-' + id);
    button.disabled = !canChooseMatchRules();
    button.setAttribute('aria-pressed', String(matchRuleId === id));
  }
  byId('matchRulesSummary').hidden = !guest;
  royalText(byId('matchRulesSummary'), localizeText(matchRule().label) + ' · ' + localizeText(
    'The host chooses the match rules.'));
}

function royalContinue() {
  if (document.body.classList.contains('title-active')) {
    setMenusVisible(false);
    return;
  }
  if (royalNeedsSetup() && royalMenuRequested) {
    setMenusVisible(false);
    return;
  }
  if (!paused && !waitingForServe && !gameOver && !levelCleared && !campaignCleared) {
    setMenusVisible(false);
    return;
  }
  if (paused && !waitingForServe && !gameOver && !levelCleared) requestTogglePause();
  else requestServeOrContinue();
  if (!royalOnlineMode() || lanConnected) setMenusVisible(false);
  syncRoyalUi(true);
}

function toggleRoyalMenu() {
  if (bossIntroActive || creditsActive) return;
  const title = document.body.classList.contains('title-active');
  const open = byId('matchMenu') && !byId('matchMenu').hidden;
  royalMenuRequested = !open;
  if (!title && !open && !paused && !waitingForServe && !gameOver && (!royalOnlineMode() || lanConnected)) {
    requestTogglePause();
  }
  setMenusVisible(!open);
}

function paintRoyalChoice(button, number, label, entry, kind) {
  const key = [number, label, entry.id].join(':');
  if (button.dataset.preview === key) return;
  button.dataset.preview = key;
  button.replaceChildren();
  const caption = document.createElement('span');
  caption.className = 'setup-caption';
  const step = document.createElement('b');
  step.textContent = number;
  const text = document.createElement('span');
  setLocalizedText(text, label);
  caption.append(step, text);
  const name = document.createElement('strong');
  setLocalizedText(name, kind === 'arena' ? entry.level.name : entry.profile.name);
  const affordance = document.createElement('span');
  affordance.className = 'setup-change';
  setLocalizedText(affordance, 'CHANGE');
  button.append(caption, kind === 'arena' ? arenaThumbnail(entry) : paddleThumbnail(entry), name, affordance);
}

function syncRoyalUi(force = false) {
  if (!byId('matchSetup')) return;
  const title = document.body.classList.contains('title-active');
  const online = royalOnlineMode();
  const joining = online && byId('onlineJoinForm') && !byId('onlineJoinForm').hidden;
  const setup = !title && !bossIntroActive && !creditsActive && royalNeedsSetup();
  const menu = !bossIntroActive && !creditsActive && menusVisible && (!setup || royalMenuRequested);
  const desktopPause = paused && !waitingForServe && !gameOver && !levelCleared && !campaignCleared &&
    !hasResumeCountdown() && window.matchMedia('(pointer: fine), (pointer: none)').matches;
  const signature = [title, online, setup, menu, desktopPause, galleryKind, bossIntroActive, creditsActive, mode, activeCampaign,
    levelIndex, waitingForServe, paused, gameOver,
    levelCleared, campaignCleared, lanRole, lanConnected, lanLastStatus, matchArenaId, matchPaddles.left, matchPaddles
    .right,
    saveData?.royalPaddle, activeSaveSlot, playInfoVisible, matchRuleId, matchRuleRevision, isBossUnlocked(),
    touchInputActive, gamepadConnected, joining
  ].join('|');
  if (!force && signature === royalUiSignature) return;
  royalUiSignature = signature;
  byId('matchSetup').hidden = !setup || menu || Boolean(galleryKind);
  byId('matchMenu').hidden = !menu || Boolean(galleryKind);
  byId('matchBar').hidden = title || menu || creditsActive || bossIntroActive;
  byId('matchBar').classList.toggle('match-bar-paused', desktopPause);
  // Keep the toggle inside the current screen or modal's focus/inert boundary.
  if (menu && !royalLastDialog) royalReturnFocus = document.activeElement;
  const toggleParent = byId(menu ? 'matchMenu' : title ? 'titleScreen' : 'matchBar');
  if (menuToggle.parentElement !== toggleParent) {
    if (menu || title) toggleParent.append(menuToggle);
    else toggleParent.prepend(menuToggle);
  }
  document.body.classList.toggle('royal-panel-open', setup || menu || Boolean(galleryKind));
  // One source of truth for active states, including setup before any peer exists.
  for (const button of [...campaignButtons, byId('menuCampaign'), customModeButton, twoPlayerModeButton, lanModeButton,
      byId('menuBoss')
    ]) {
    const active = !title && (button.dataset.campaign !== undefined ? mode === 1 && Number(button.dataset.campaign) ===
      activeCampaign :
      button === byId('menuCampaign') ? mode === 1 : button === customModeButton ? mode === 3 : button ===
      twoPlayerModeButton ? mode === 2 && !online : button === lanModeButton ? online : mode === 4);
    button.classList.toggle('active', active && button.dataset.campaign === undefined);
    button.classList.toggle('chapter-active', active && button.dataset.campaign !== undefined);
    button.setAttribute('aria-pressed', String(active));
  }
  byId('menuBoss').hidden = !isBossUnlocked();
  royalText(byId('matchMode'), royalModeName());
  royalText(byId('matchContext'), online && !lanConnected ? lanLastStatus : mode === 4 ? BOSS_LEVEL.name :
    (online && lanConnected ? localizeText('Connected!') + ' · ' : mode === 1 ? localizeText(CAMPAIGNS[activeCampaign]
      .name) + ' · ' : '') + localizeText(currentLevel().name) + (playInfoVisible ? ' · ' + (mode === 2 ?
      localizeText(matchRule().label) : localizeText('Goal') + ' ' + currentLevel().goal) : ''));
  royalText(byId('matchSetupTitle'), royalModeName());
  royalText(byId('matchMenuTitle'), title ? 'Menu' : paused ? 'Paused' : 'Match menu');
  royalText(twoPlayerModeButton, 'Local Two Player');
  royalText(menuToggle, 'Menu (M)');
  menuToggle.setAttribute('aria-expanded', String(menu));
  menuToggle.setAttribute('aria-pressed', String(menu));
  setLocalizedTitle(menuToggle, 'Menu (M)');
  byId('matchConnection').hidden = title || !online;
  const connectionParent = menu ? byId('matchConnection') : byId('matchSetupBody');
  if (lanPanel.parentElement !== connectionParent) {
    if (connectionParent.id === 'matchConnection') connectionParent.append(lanPanel);
    else connectionParent.insertBefore(lanPanel, document.querySelector('.royal-selection-row'));
  }
  lanPanel.classList.toggle('hidden', !online);
  lanPanel.hidden = !online;
  if (byId('onlinePaddleHelp')) byId('onlinePaddleHelp').hidden = !online;
  const cpu = byId('matchCpuSettings');
  const cpuParent = menu ? byId('matchMenuTitle').parentElement : byId('matchSetupBody');
  if (cpu.parentElement !== cpuParent) cpuParent.insertBefore(cpu, byId(menu ? 'matchModes' : 'matchSetupHint'));
  const choices = document.querySelector('.royal-selection-row');
  const ownSide = lanRole === 'guest' ? 'right' : 'left';
  const first = paddleCatalog.find(entry => entry.id === (mode === 2 ? matchPaddles[ownSide] : savedPaddle())) ||
    paddleCatalog[0];
  paintRoyalChoice(byId('choosePaddleButton'), '01', online ? 'Choose your paddle' : 'Player 1 paddle', first,
  'paddle');
  paintRoyalChoice(byId('choosePaddle2Button'), '02', 'Player 2 paddle', paddleCatalog.find(entry => entry.id ===
    matchPaddles.right) || paddleCatalog[0], 'paddle');
  paintRoyalChoice(byId('chooseArenaButton'), mode === 2 && !online ? '03' : '02', 'Choose your arena', arenaCatalog[
    matchArenaId] || arenaCatalog[0], 'arena');
  byId('choosePaddle2Button').hidden = mode !== 2 || online;
  byId('chooseArenaButton').hidden = mode !== 2 && mode !== 3 || lanRole === 'guest' || joining;
  choices.dataset.online = String(online);
  customPanel.classList.toggle('hidden', mode !== 3);
  byId('matchCpuSettings').hidden = title || mode !== 3;
  const canServe = !online || lanConnected;
  byId('matchServe').hidden = !canServe;
  byId('matchContinue').hidden = title || setup || menu || !canServe || !(waitingForServe || gameOver || levelCleared ||
    campaignCleared);
  byId('matchPause').hidden = title || setup || menu || !canServe;
  royalText(byId('matchContinue'), gameOver ? 'Retry' : levelCleared || campaignCleared ? 'Continue' : 'Serve');
  royalText(byId('matchPause'), paused ? 'Resume' : 'Pause');
  royalText(byId('matchResume'), title ? 'Close menu' : setup ? 'Back to setup' : gameOver ? 'Retry' :
    paused ? 'Resume' : waitingForServe ? 'Serve' : 'Back to match');
  royalText(byId('matchSetupHint'), online ? lanRole === 'guest' ? 'Choose your paddle. The host chooses the arena.' :
    lanConnected ? 'Both players can choose a paddle before serving.' :
    'Create a room or join a friend with their room code.' : mode === 3 ?
    'Choose your paddle and arena, then start the match.' : 'Choose your paddles and arena, then start the match.');
  byId('menuPaddle').hidden = !title && (mode === 4 || online && !waitingForServe);
  byId('menuPaddle2').hidden = title || mode !== 2 || online;
  byId('menuArena').hidden = title || mode !== 2 && mode !== 3 || lanRole === 'guest' || joining ||
    online && !waitingForServe;
  restartButton.hidden = title;
  restartButton.disabled = online && !lanConnected;
  syncMatchRulesUi();
  updateRoyalControlHint();
  syncRoyalOrientation();
  syncRoyalFocus();
}

function royalDesktopPauseVisible() {
  const bar = byId('matchBar');
  return bar && !bar.hidden && bar.classList.contains('match-bar-paused');
}

function updateRoyalControlHint() {
  if (typeof controlHint === 'undefined' || !controlHint || !byId('matchSetup')) return;
  const online = royalOnlineMode();
  const touch = touchInputActive || royalPhoneViewport();
  const move = gamepadConnected ? 'Stick / D-pad: move' : touch ? mode === 2 && !online ? 'Drag each side to move' :
    'Drag to move' : mode === 2 && !online ? 'P1 W/S · P2 ↑/↓' : 'W/S or ↑/↓: move';
  const action = gamepadConnected ? waitingForServe ? 'A: serve' : 'Start: pause' : touch ? waitingForServe ?
    'Tap: serve' : 'Two fingers: pause' : waitingForServe ? 'Space: serve' : 'P: pause';
  royalText(controlHint, online && !lanConnected ? 'Menu (M)' : move + ' · ' + action);
  for (const [id, current] of [
      ['helpKeyboard', !gamepadConnected && !touch],
      ['helpController', gamepadConnected],
      ['helpTouch', touch && !gamepadConnected]
    ]) {
    if (byId(id)) byId(id).classList.toggle('current-input', current);
  }
}

function royalPhoneViewport() {
  return (navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches) && Math.min(window.innerWidth,
    window.innerHeight) <= 600;
}
async function requestRoyalLandscape() {
  // Native Android uses its manifest. Browsers get one attempt per title-to-game visit,
  // only from a real user gesture; rejected/fullscreen-denied attempts never loop.
  if (typeof KingPongRoom === 'undefined' || !royalPhoneViewport() || royalOrientationAttempted || !navigator
    .userActivation?.isActive) return;
  royalOrientationAttempted = true;
  const orientation = window.screen.orientation;
  if (!orientation || typeof orientation.lock !== 'function') return;
  const generation = royalOrientationGeneration;
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement
      .requestFullscreen();
    if (generation !== royalOrientationGeneration) return;
    await orientation.lock('landscape');
    if (generation !== royalOrientationGeneration) {
      orientation.unlock();
      return;
    }
    royalOrientationOwned = true;
  } catch {
    /* Portrait guidance remains available when the browser refuses. */ }
  syncRoyalOrientation();
}

function syncRoyalOrientation() {
  const overlay = byId('rotateDevice');
  if (!overlay) return;
  const visible = royalPhoneViewport() && window.innerHeight > window.innerWidth && !royalRotateDismissed &&
    !document.body.classList.contains('title-active') && !galleryKind && !bossIntroActive && !creditsActive &&
    byId('matchSetup').hidden && byId('matchMenu').hidden;
  overlay.hidden = !visible;
  syncRoyalFocus();
}

function royalActiveDialog() {
  if (galleryKind) return byId('royalGallery');
  for (const id of ['rotateDevice', 'matchMenu', 'matchSetup'])
    if (byId(id) && !byId(id).hidden) return byId(id);
  return null;
}

function royalFocusables(panel) {
  return [...panel.querySelectorAll(
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary')]
    .filter(element => element.getClientRects().length && !element.closest('[hidden]'));
}

function syncRoyalFocus() {
  const dialog = royalActiveDialog();
  for (const id of ['matchBar', 'matchSetup', 'matchMenu', 'titleScreen']) {
    const node = byId(id);
    if (node) node.inert = Boolean(dialog && node !== dialog);
  }
  if (dialog === royalLastDialog) return;
  if (dialog) {
    if (!royalLastDialog && dialog.id !== 'matchMenu') royalReturnFocus = document.activeElement;
    if (!dialog.contains(document.activeElement)) royalFocusables(dialog)[0]?.focus({
      preventScroll: true
    });
  } else if (royalLastDialog) {
    const target = royalReturnFocus?.isConnected && royalReturnFocus !== document.body &&
      royalReturnFocus.getClientRects().length && getComputedStyle(royalReturnFocus).visibility !== 'hidden' &&
      !royalReturnFocus.closest('[inert],[hidden]') ? royalReturnFocus :
      menuToggle;
    target.focus({
      preventScroll: true
    });
  }
  royalLastDialog = dialog;
}

function handleRoyalUiKey(event) {
  const dialog = royalActiveDialog();
  const form = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event
    .target instanceof HTMLTextAreaElement;
  if (dialog && event.key === 'Tab') {
    const controls = royalFocusables(dialog),
      index = controls.indexOf(document.activeElement);
    controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
  } else if (dialog && event.key === 'Escape') {
    if (dialog.id === 'rotateDevice') {
      royalRotateDismissed = true;
      syncRoyalOrientation();
    } else if (dialog.id === 'matchMenu') setMenusVisible(false);
    else showTitleScreen();
  } else if (!form && event.target.closest?.('.match-ui') && ['Enter', ' '].includes(event.key)) {
    if (event.target.tagName === 'BUTTON' || event.target.tagName === 'SUMMARY') event.target.click();
  } else if (!form && event.key.toLowerCase() === 'm' && !bossIntroActive && !creditsActive) {
    if (!event.repeat) toggleRoyalMenu();
  } else return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

function royalUiConsumesGamepad() {
  return Boolean(royalActiveDialog());
}

function pollRoyalUiGamepad(now) {
  syncRoyalUi();
  const panel = royalActiveDialog() || (document.body.classList.contains('title-active') && !creditsActive &&
    !bossIntroActive ? byId('titleScreen') : null);
  if (!panel || now - royalUiGamepadAt < 30) return;
  royalUiGamepadAt = now;
  const pad = getConnectedGamepads()[0];
  if (!pad) return;
  const axis = Math.abs(pad.axes[0] || 0) > .5 ? pad.axes[0] : pad.axes[1] || 0;
  const direction = pad.buttons[12]?.pressed || pad.buttons[14]?.pressed || axis < -.5 ? -1 : pad.buttons[13]
    ?.pressed || pad.buttons[15]?.pressed || axis > .5 ? 1 : 0;
  const controls = royalFocusables(panel);
  if (direction && direction !== royalUiGamepadDirection) {
    const index = controls.indexOf(document.activeElement);
    controls[(index + direction + controls.length) % controls.length]?.focus();
  }
  royalUiGamepadDirection = direction;
  if (gamepadButtonJustPressed(pad, GAMEPAD_BUTTONS.A)) document.activeElement?.click();
  if (gamepadButtonJustPressed(pad, GAMEPAD_BUTTONS.START) && panel.id === 'matchMenu') {
    if (document.body.classList.contains('title-active')) setMenusVisible(false);
    else requestTogglePause();
    syncRoyalUi(true);
  }
  if ((gamepadButtonJustPressed(pad, GAMEPAD_BUTTONS.B) && panel.id !== 'titleScreen') ||
    gamepadButtonJustPressed(pad, GAMEPAD_BUTTONS.SELECT)) {
    if (panel.id === 'rotateDevice') {
      royalRotateDismissed = true;
      syncRoyalOrientation();
    } else toggleRoyalMenu();
  }
}
