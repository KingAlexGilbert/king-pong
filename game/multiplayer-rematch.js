// Session-local agreement on the reliable, already authenticated control channel.
// A new round is prepared by the host, acknowledged by the consenting guest,
// then reset exactly once by the host. Snapshot/input round tags fence old packets.
function multiplayerRematch() {
  if (!onlineSession || !['host', 'guest'].includes(lanRole)) return null;
  if (!onlineSession.rematch) {
    onlineSession.rematch = {round: 0, local: false, remote: false, phase: 'playing',
      token: lanRole === 'host' ? Array.from(crypto.getRandomValues(new Uint32Array(4)),
        n => n.toString(16).padStart(8, '0')).join('') : null, lastSend: -Infinity,
      restart: null, ignoredRestarts: []};
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

function sendRematch(kind, round = multiplayerRematch()?.round, requestId = null) {
  const state = multiplayerRematch();
  if (!state || !onlineRematchReady || !lanConnected) return false;
  state.lastSend = performance.now();
  return lanSend({v: LAN_SIGNAL_VERSION, room: lanRoomCode, type: 'rematch', protocol: 1,
    token: state.token, round, kind, ...(requestId ? {requestId} : {})});
}

function requestMultiplayerRematch() {
  const state = multiplayerRematch();
  if (!multiplayerRematchVisible() || !onlineRematchReady || onlineGameBlocked || !state || state.local) return;
  state.local = true;
  sendRematch('accept');
  prepareMultiplayerRematch();
  syncRoyalUi(true);
}

// Mid-match restarts use the existing authenticated rematch control channel and
// its host-only start/started/snapshot handshake. Neither peer can reset a live
// game without the other player's explicit consent.
function multiplayerRestartVisible() {
  const state = onlineSession?.rematch;
  return Boolean(state?.restart && mode === 2 && !gameOver && lanConnected &&
    state.phase === 'playing' && onlineRematchReady && !multiplayerDisconnect);
}

function ignoreRestart(state, id) {
  if (!id) return;
  state.ignoredRestarts = (state.ignoredRestarts || []).filter(value => value !== id).slice(-7);
  state.ignoredRestarts.push(id);
}

// Only the authoritative host freezes simulation while consent is pending.
// If rejected, restore an existing pause or use the normal resume countdown.
function holdMultiplayerRestart(state) {
  if (lanRole !== 'host' || !state.restart || state.restart.beforePause) return;
  state.restart.beforePause = {paused, remaining: hasResumeCountdown() ? resumeCountdownRemainingMs() : 0};
  if (typeof suspendPointServeCountdown === 'function') suspendPointServeCountdown();
  paused = true;
  resumeCountdownEndAt = 0;
  lastResumeCountdownNumber = 0;
  sendLanState(true);
}

function restoreMultiplayerRestart(state) {
  const before = state.restart?.beforePause;
  if (lanRole !== 'host' || !before || state.phase !== 'playing') return;
  paused = true;
  resumeCountdownEndAt = !before.paused ? performance.now() + 3000 :
    before.remaining > 0 ? performance.now() + before.remaining : 0;
  lastResumeCountdownNumber = 0;
  sendLanState(true);
}

function requestMultiplayerRestart() {
  const state = multiplayerRematch();
  if (!state || !onlineRematchReady || !lanConnected || onlineGameBlocked || gameOver ||
      state.phase !== 'playing' || state.restart?.local || onlineMatchFlowBlocksPlay()) return;
  if (!state.restart) {
    const id = Array.from(crypto.getRandomValues(new Uint32Array(4)),
      value => value.toString(16).padStart(8, '0')).join('');
    state.restart = {id, local: true, remote: false, activeWait: 0, lastAt: performance.now()};
    sendRematch('restart-request', state.round, id);
  } else {
    state.restart.local = true; // Accept the other player's request.
    sendRematch('restart-accept', state.round, state.restart.id);
    prepareMultiplayerRematch();
  }
  holdMultiplayerRestart(state);
  setMenusVisible(false);
  syncRoyalUi(true);
}

function declineMultiplayerRestart() {
  const state = onlineSession?.rematch, restart = state?.restart;
  if (!restart || state.phase !== 'playing') return;
  sendRematch(restart.local ? 'restart-cancel' : 'restart-decline', state.round, restart.id);
  ignoreRestart(state, restart.id);
  restoreMultiplayerRestart(state);
  state.restart = null;
  syncRoyalUi(true);
}

function receiveMultiplayerRestart(message, state) {
  const id = message.requestId;
  if (!/^[a-f0-9]{32}$/.test(id || '') || message.round !== state.round ||
      state.phase !== 'playing' || gameOver || !lanConnected) return;
  if (message.kind === 'restart-request') {
    if (state.ignoredRestarts?.includes(id)) return;
    const pending = state.restart;
    if (pending && pending.id !== id && lanRole === 'host' && pending.local) {
      // Simultaneous requests: host's ID wins, but guest's request is consent.
      pending.remote = true;
      sendRematch('restart-request', state.round, pending.id);
      prepareMultiplayerRematch();
      return;
    }
    if (!pending || pending.id !== id) {
      state.restart = {id, local: Boolean(pending?.local), remote: true,
        activeWait: 0, lastAt: performance.now(), beforePause: pending?.beforePause};
    } else state.restart.remote = true;
    holdMultiplayerRestart(state);
    if (state.restart.local) sendRematch('restart-accept', state.round, id);
    prepareMultiplayerRematch();
  } else if (message.kind === 'restart-accept') {
    if (!state.restart || state.restart.id !== id || !state.restart.local) return;
    state.restart.remote = true;
    prepareMultiplayerRematch();
  } else if (message.kind === 'restart-decline' || message.kind === 'restart-cancel') {
    if (!state.restart || state.restart.id !== id) return;
    ignoreRestart(state, id);
    restoreMultiplayerRestart(state);
    state.restart = null;
  }
  syncRoyalUi(true);
}

function prepareMultiplayerRematch() {
  const state = multiplayerRematch();
  if (lanRole !== 'host' || !state || state.phase !== 'playing' ||
      state.round >= Number.MAX_SAFE_INTEGER - 1) return;
  const restarting = !gameOver && state.restart?.local && state.restart?.remote;
  if (!restarting && !(gameOver && state.local && state.remote)) return;
  state.transition = restarting ? 'restart' : 'rematch';
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
    return endMultiplayerSession('Opponent left the match.');
  }
  if (typeof message.kind === 'string' && message.kind.startsWith('restart-')) {
    receiveMultiplayerRestart(message, state);
    return;
  }
  if (lanRole === 'guest' && message.kind === 'start') {
    if (state.phase === 'awaiting-state' && message.round === state.round - 1) {
      sendRematch('started'); // Lost acknowledgement during transport recovery.
      return;
    }
    const restarting = !gameOver && state.restart?.local && state.restart?.remote;
    if (message.round !== state.round || state.phase !== 'playing' ||
        !restarting && !(gameOver && state.local)) return;
    state.transition = restarting ? 'restart' : 'rematch';
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
    if (state.phase !== 'starting' || message.round !== state.round + 1 ||
        (state.transition === 'restart' ? !(state.restart?.local && state.restart?.remote) :
          !(gameOver && state.local && state.remote))) return;
    state.round++;
    state.phase = 'playing'; // Commit before calling reset/UI hooks; duplicates cannot reenter.
    state.local = state.remote = false;
    state.restart = null;
    state.transition = null;
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
    if (state.activeWait > 12000) { endMultiplayerSession(ONLINE_ERRORS.connection_lost); return; }
  }
  if (state.restart && state.phase === 'playing') {
    const pending = state.restart;
    if (!blocked) pending.activeWait += Math.max(0, now - (pending.lastAt ?? now));
    pending.lastAt = now;
    if (gameOver || pending.activeWait > 20000) {
    sendRematch('restart-cancel', state.round, pending.id);
    ignoreRestart(state, pending.id);
    restoreMultiplayerRestart(state);
    state.restart = null;
    syncRoyalUi(true);
    }
  }
  if (blocked || now - state.lastSend < 500) return;
  if (state.phase === 'starting') sendRematch('start');
  else if (state.phase === 'awaiting-state') sendRematch('started');
  else if (state.restart?.local && state.phase === 'playing')
    sendRematch(state.restart.remote ? 'restart-accept' : 'restart-request', state.round, state.restart.id);
  else if (gameOver && state.local) sendRematch('accept');
}

function finishMultiplayerRematchSnapshot() {
  const state = onlineSession?.rematch;
  if (state?.phase === 'awaiting-state' && !gameOver) {
    state.phase = 'playing';
    state.local = state.remote = false;
    state.restart = null;
    state.transition = null;
    clearHeldInput();
    syncRoyalUi(true);
  }
}

// The terminal dialog owns only local UI state. Detach the session before any
// async close completes, so late callbacks cannot revive it or navigate away.
let multiplayerDisconnect = null;
const MULTIPLAYER_SHUTDOWN_WATCHDOG_MS = 5000;

function showMultiplayerDisconnect(ended, confirmed) {
  if (multiplayerDisconnect !== ended) return;
  clearTimeout(ended.watchdog);
  ended.ready = true;
  ended.confirmed = confirmed;
  royalText(byId('multiplayerDisconnectedTitle'), confirmed ? 'Your opponent disconnected' : 'Finishing disconnect...');
  byId('multiplayerDisconnectNote').hidden = confirmed;
  byId('multiplayerDisconnected').hidden = false;
  syncRoyalUi(true);
  byId('multiplayerReturn').focus({preventScroll: true});
}

function escalateMultiplayerShutdown(ended) {
  if (multiplayerDisconnect !== ended || ended.ready) return;
  // One best-effort retry before exposing the fallback. A timeout cannot
  // certify closure, and neither path reopens a retired session.
  try { ended.closed?.retry?.(); } catch { /* Keep the session quarantined. */ }
  showMultiplayerDisconnect(ended, false);
}

function endMultiplayerSession(message = 'Opponent disconnected.') {
  // A confirmed local Leave is already closing this session; its callbacks
  // must not turn our own departure into an opponent-disconnected dialog.
  if (multiplayerLeaveApproved || multiplayerDisconnect || !onlineSession ||
      multiplayerLocallyLeavingSession === onlineSession) return;
  const ended = multiplayerDisconnect = {origin: onlineSession.multiplayerOrigin ||
    (onlineManualLanSelected ? 'lan' : 'private'), role: lanRole, ready: false};
  finishMultiplayerLeave(false);
  onlineGameBlocked = paused = true;
  clearHeldInput();
  ended.watchdog = setTimeout(() => escalateMultiplayerShutdown(ended), MULTIPLAYER_SHUTDOWN_WATCHDOG_MS);
  try { ended.closed = closeOnlineConnection(false); }
  catch (error) { ended.closed = Promise.reject(error); }
  onlineGameBlocked = paused = true;
  setMenusVisible(false);
  byId('classicLanDialog').hidden = true;
  setLanStatus(message);
  // Native LAN acknowledges socket/discovery shutdown; WebSockets must finish
  // closing (including already queued frames) before the local popup appears.
  Promise.resolve(ended.closed).then(() => showMultiplayerDisconnect(ended, true),
    () => escalateMultiplayerShutdown(ended));
}

function acknowledgeMultiplayerDisconnect() {
  if (!multiplayerDisconnect?.ready) return;
  const {origin} = multiplayerDisconnect;
  clearTimeout(multiplayerDisconnect.watchdog);
  multiplayerDisconnect.closed?.release?.();
  multiplayerDisconnect = null;
  byId('multiplayerDisconnected').hidden = true;
  resetFrameClock();
  // Returning is local navigation, not consent to reopen the queue socket.
  if (origin === 'lan') openOfflineLanSetup(false);
  else {
    startOnlineSetup(false, false, false);
    if (origin === 'private') byId('onlinePrivateRooms').open = true;
  }
  onlineGameBlocked = paused = true;
  syncRoyalUi(true);
}

function leaveMultiplayerSession(message = '', notify = true) {
  // Leaving from Back or the result screen can bypass the confirmation path.
  // Mark ownership before sending leave or shutting down the transport.
  const departingSession = onlineSession;
  if (departingSession) multiplayerLocallyLeavingSession = departingSession;
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
  if (multiplayerLocallyLeavingSession === departingSession && onlineSession !== departingSession)
    multiplayerLocallyLeavingSession = null;
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

  const restartPanel = document.createElement('section');
  restartPanel.id = 'multiplayerRestartPrompt';
  restartPanel.className = 'online-match-flow match-ui';
  restartPanel.hidden = true;
  restartPanel.setAttribute('role', 'dialog');
  restartPanel.setAttribute('aria-modal', 'true');
  restartPanel.setAttribute('aria-labelledby', 'multiplayerRestartTitle');
  const restartCard = document.createElement('div'); restartCard.className = 'online-flow-card';
  const restartTitle = document.createElement('h2'); restartTitle.id = 'multiplayerRestartTitle';
  const restartNote = document.createElement('p'); restartNote.id = 'multiplayerRestartNote';
  const restartActions = document.createElement('div'); restartActions.className = 'online-flow-actions';
  restartActions.append(royalButton('multiplayerRestartAccept', 'Accept Restart', requestMultiplayerRestart, 'match-primary'),
    royalButton('multiplayerRestartDecline', 'Decline', declineMultiplayerRestart));
  restartCard.append(restartTitle, restartNote, restartActions);
  restartPanel.append(restartCard); document.body.append(restartPanel);

  // The legacy button calls requestRetryLevel() and resets immediately. The
  // capture listener handles connected online games before that handler runs.
  restartButton.addEventListener('click', event => {
    if (mode !== 2 || !onlineSession || !lanConnected || gameOver) return;
    event.stopImmediatePropagation();
    requestMultiplayerRestart();
  }, true);
}

function syncMultiplayerRematchUi() {
  const restartPanel = byId('multiplayerRestartPrompt');
  if (restartPanel) {
    const pending = onlineSession?.rematch?.restart;
    restartPanel.hidden = !multiplayerRestartVisible() ||
      document.body.classList.contains('title-active');
    if (!restartPanel.hidden) {
      royalText(byId('multiplayerRestartTitle'), pending.local ? 'Restart requested' : 'Restart match?');
      royalText(byId('multiplayerRestartNote'), pending.local ? 'Waiting for your opponent to agree.' :
        'Your opponent wants to restart this match. Accept or decline?');
      byId('multiplayerRestartAccept').hidden = pending.local;
      royalText(byId('multiplayerRestartDecline'), pending.local ? 'Cancel Request' : 'Decline');
    }
  }
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
