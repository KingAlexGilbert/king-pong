// Session-local agreement on the reliable, already authenticated control channel.
// A new round is prepared by the host, acknowledged by the consenting guest,
// then reset exactly once by the host. Snapshot/input round tags fence old packets.
function multiplayerRematch() {
  if (!onlineSession || !['host', 'guest'].includes(lanRole)) return null;
  if (!onlineSession.rematch) {
    onlineSession.rematch = {round: 0, local: false, remote: false, phase: 'playing',
      token: lanRole === 'host' ? Array.from(crypto.getRandomValues(new Uint32Array(4)),
        n => n.toString(16).padStart(8, '0')).join('') : null, lastSend: -Infinity};
  }
  return onlineSession.rematch;
}

function receiveRematchHello(message) {
  const state = multiplayerRematch();
  if (!state || message.rematch !== 1 || !/^[a-f0-9]{32}$/.test(message.rematchToken || '')) return;
  if (lanRole === 'guest' && state.token === null) state.token = message.rematchToken;
  if (state.token === message.rematchToken) onlineRematchReady = true;
}

function multiplayerRematchVisible() {
  return Boolean(mode === 2 && gameOver && onlineSession && lanConnected);
}

function sendRematch(kind, round = multiplayerRematch()?.round) {
  const state = multiplayerRematch();
  if (!state || !onlineRematchReady || !lanConnected) return false;
  state.lastSend = performance.now();
  return lanSend({v: LAN_SIGNAL_VERSION, room: lanRoomCode, type: 'rematch', protocol: 1,
    token: state.token, round, kind});
}

function requestMultiplayerRematch() {
  const state = multiplayerRematch();
  if (!multiplayerRematchVisible() || !onlineRematchReady || onlineGameBlocked || !state || state.local) return;
  state.local = true;
  sendRematch('accept');
  prepareMultiplayerRematch();
  syncRoyalUi(true);
}

function prepareMultiplayerRematch() {
  const state = multiplayerRematch();
  if (lanRole !== 'host' || !state || !gameOver || !state.local || !state.remote ||
      state.phase === 'starting' || state.round >= Number.MAX_SAFE_INTEGER - 1) return;
  state.phase = 'starting';
  state.activeWait = 0;
  state.at = performance.now();
  sendRematch('start');
}

function receiveMultiplayerRematch(message) {
  const state = multiplayerRematch();
  if (!state || !onlineRematchReady || !lanConnected || message.v !== LAN_SIGNAL_VERSION ||
      message.room !== lanRoomCode || !lanRoomCode || message.gameplay !== 'royal' ||
      message.matchRules !== 'presets' || message.protocol !== 1 || message.token !== state.token ||
      !Number.isSafeInteger(message.round) || message.round < 0) return;
  if (message.kind === 'leave' && (message.round === state.round ||
      state.phase === 'awaiting-state' && message.round === state.round - 1 ||
      state.phase === 'starting' && message.round === state.round + 1)) {
    return leaveMultiplayerSession('Opponent left the match.', false);
  }
  if (lanRole === 'guest' && message.kind === 'start') {
    if (state.phase === 'awaiting-state' && message.round === state.round - 1) {
      sendRematch('started'); // Lost acknowledgement during transport recovery.
      return;
    }
    if (message.round !== state.round || !state.local || !gameOver || state.phase !== 'playing') return;
    state.round++;
    state.phase = 'awaiting-state';
    state.activeWait = 0;
    state.at = performance.now();
    onlineInputs.clear();
    onlineHasState = false;
    onlineLastInput = null;
    resetVisualHistory();
    sendRematch('started');
  } else if (lanRole === 'host' && message.kind === 'started') {
    if (state.phase !== 'starting' || message.round !== state.round + 1 || !state.local || !state.remote || !gameOver) return;
    state.round++;
    state.phase = 'playing'; // Commit before calling reset/UI hooks; duplicates cannot reenter.
    state.local = state.remote = false;
    lanRemoteInput = {axis: 0, targetY: null, lastAt: 0};
    onlineInputs.clear();
    onlineLastInput = null;
    clearHeldInput();
    shakeFrames = 0;
    resumeCountdownEndAt = 0;
    lastResumeCountdownNumber = 0;
    if (onlineMatchFlow) onlineMatchFlow.phase = 'playing';
    startLevel(); // Existing score, hazard, paddle, ball, powerup and countdown reset.
    if (typeof hideFirstStartControls === 'function') hideFirstStartControls();
    setMenusVisible(false);
    beginPointServeCountdown();
    sendLanState(true);
  } else if (message.kind === 'accept' && message.round === state.round && gameOver) {
    state.remote = true;
    prepareMultiplayerRematch();
  }
  syncRoyalUi(true);
}

function acceptMultiplayerRound(message) {
  const state = multiplayerRematch();
  return !onlineRematchReady || !['input', 'state', 'action'].includes(message?.type) ||
    state && (message.round === state.round || state.round === 0 && message.round === undefined) &&
    !(lanRole === 'host' && state.phase === 'starting');
}

function tickMultiplayerRematch() {
  const state = onlineSession?.rematch;
  if (!state || !onlineRematchReady || !lanConnected) return;
  const now = performance.now();
  const blocked = onlineGameBlocked || onlineSession.secure && onlineSession.secure.phase !== 'active';
  if (state.phase === 'starting' || state.phase === 'awaiting-state') {
    if (!blocked) state.activeWait += Math.max(0, now - (state.at ?? now));
    state.at = now;
    if (state.activeWait > 12000) { leaveMultiplayerSession(ONLINE_ERRORS.connection_lost); return; }
  }
  if (blocked || now - state.lastSend < 500) return;
  if (state.phase === 'starting') sendRematch('start');
  else if (state.phase === 'awaiting-state') sendRematch('started');
  else if (gameOver && state.local) sendRematch('accept');
}

function finishMultiplayerRematchSnapshot() {
  const state = onlineSession?.rematch;
  if (state?.phase === 'awaiting-state' && !gameOver) {
    state.phase = 'playing';
    state.local = state.remote = false;
    clearHeldInput();
    syncRoyalUi(true);
  }
}

function leaveMultiplayerSession(message = '', notify = true) {
  const origin = onlineSession?.multiplayerOrigin || (onlineManualLanSelected ? 'lan' : 'private');
  if (notify) sendRematch('leave');
  // Closing signaling also supplies a departure notification if the final
  // encrypted control packet was still queued when the connection closed.
  if (origin === 'lan') openOfflineLanSetup(false);
  else {
    startOnlineSetup(false);
    if (origin === 'private') byId('onlinePrivateRooms').open = true;
  }
  onlineGameBlocked = paused = true;
  setLanStatus(message || 'Find an opponent or create/join a private room.');
  syncRoyalUi(true);
}

function initMultiplayerRematchUi() {
  const panel = document.createElement('section');
  panel.id = 'multiplayerResult';
  panel.className = 'online-match-flow match-ui';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'multiplayerResultTitle');
  const card = document.createElement('div'); card.className = 'online-flow-card';
  const title = document.createElement('h2'); title.id = 'multiplayerResultTitle';
  const score = document.createElement('p'); score.id = 'multiplayerResultScore';
  const note = document.createElement('p'); note.id = 'multiplayerResultNote';
  note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite');
  const actions = document.createElement('div'); actions.className = 'online-flow-actions';
  actions.append(royalButton('multiplayerRematch', 'Rematch', requestMultiplayerRematch, 'match-primary'),
    royalButton('multiplayerBack', 'Back', () => leaveMultiplayerSession()));
  card.append(title, score, actions, note); panel.append(card); document.body.append(panel);
}

function syncMultiplayerRematchUi() {
  const panel = byId('multiplayerResult');
  if (!panel) return;
  panel.hidden = !multiplayerRematchVisible() || document.body.classList.contains('title-active');
  if (panel.hidden) return;
  const state = multiplayerRematch(), inverted = lanRole === 'guest';
  royalText(byId('multiplayerResultTitle'), multiplayerVictoryText());
  byId('multiplayerResultScore').textContent = inverted ? right.score + ' – ' + left.score : left.score + ' – ' + right.score;
  byId('multiplayerRematch').disabled = !onlineRematchReady || state.local || onlineGameBlocked;
  royalText(byId('multiplayerResultNote'), !onlineRematchReady ? 'Both players must reload the latest game.' :
    state.local ? 'Waiting for opponent...' : state.remote ? 'Your opponent wants a rematch.' : '');
}
