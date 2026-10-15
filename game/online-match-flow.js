// Online matches share the reliable ready/countdown flow. Private rooms also
// acknowledge host configuration before either client can start; LAN keeps its serve controls.
let onlineMatchFlow = null;

function onlineMatchFlowVisible() {
  return Boolean(onlineMatchFlow && onlineMatchFlow.phase !== 'playing');
}

function onlineMatchFlowBlocksPlay() {
  return onlineMatchFlowVisible() && onlineMatchFlow.phase !== 'go';
}

function resetOnlineMatchFlow() {
  onlineMatchFlow = null;
  resumeCountdownEndAt = 0;
  lastResumeCountdownNumber = 0;
  syncOnlineMatchFlowUi();
}

function beginOnlineMatchFlow() {
  onlineMatchFlow = {id: onlineMatchAssignment?.id || 'private:' + lanRoomCode,
    privateRoom: !onlineMatchAssignment, configured: false, peerInitialized: false, phase: 'connecting', localReady: false,
    hostReady: false, guestReady: false, peerHello: false, sequence: 0, remoteSequence: -1,
    localPaddle: matchPaddles[lanRole === 'guest' ? 'right' : 'left'], lastHelloAt: -Infinity};
  onlineGameBlocked = paused = true;
  waitingForServe = true;
  clearHeldInput();
  setMenusVisible(false);
  syncRoyalUi(true);
}

function sendOnlineMatchSetup(kind, fields = {}) {
  if (!onlineMatchFlow || !lanConnected) return false;
  return lanSend({v: LAN_SIGNAL_VERSION, room: lanRoomCode, type: 'match-setup', protocol: 1,
    match: onlineMatchFlow.id, kind, ...fields});
}

function sendOnlineMatchStatus() {
  if (lanRole !== 'host' || !onlineMatchFlow) return;
  sendOnlineMatchSetup('status', {phase: onlineMatchFlow.phase, hostReady: onlineMatchFlow.hostReady,
    guestReady: onlineMatchFlow.guestReady, seq: ++onlineMatchFlow.sequence,
    remainingMs: Math.round(resumeCountdownRemainingMs())});
}

function onlineMatchTransportReady() {
  const flow = onlineMatchFlow;
  if (!flow || flow.phase !== 'connecting') return;
  flow.phase = 'connected';
  flow.connectedUntil = performance.now() + 600;
  flow.handshakeDeadline = performance.now() + 8000;
  onlineGameBlocked = paused = true;
  sendOnlineMatchHello();
  syncRoyalUi(true);
}

function sendOnlineMatchHello() {
  const flow = onlineMatchFlow;
  flow.lastHelloAt = performance.now();
  // The first host snapshot may precede the guest's channel-open callback.
  // Re-send the locally selected paddle before hello, in reliable channel order.
  if (lanRole === 'guest') lanSend({v: LAN_SIGNAL_VERSION, room: lanRoomCode, type: 'selection',
    seq: ++selectionSequence, paddle: flow.localPaddle});
  sendOnlineMatchSetup('hello');
  if (flow.privateRoom && lanRole === 'host') sendPrivateMatchConfiguration();
  if (flow.privateRoom && lanRole === 'guest' && flow.configured && onlineHasState) {
    sendOnlineMatchSetup('initialized', {configuration: flow.configuration});
  }
}

function confirmOnlineMatchReady() {
  const flow = onlineMatchFlow;
  if (!flow || flow.phase !== 'ready' || !lanConnected || flow.localReady && !flow.privateRoom) return;
  flow.localReady = !flow.localReady;
  if (lanRole === 'host') { flow.hostReady = flow.localReady; maybeStartOnlineMatchCountdown(); }
  else sendOnlineMatchSetup('ready', {ready: flow.localReady});
  syncRoyalUi(true);
}

function maybeStartOnlineMatchCountdown() {
  const flow = onlineMatchFlow;
  if (flow.phase === 'ready' && flow.peerHello && (!flow.privateRoom || flow.peerInitialized) && flow.hostReady && flow.guestReady) {
    flow.phase = 'countdown';
    paused = true;
    resumeCountdownEndAt = performance.now() + RESUME_COUNTDOWN_MS;
    lastResumeCountdownNumber = 0;
    clearHeldInput();
  }
  sendOnlineMatchStatus();
  sendLanState(true);
}

function privateMatchConfiguration() {
  return {selection: selectionPayload(), rules: matchRulePayload()};
}

function sendPrivateMatchConfiguration() {
  if (!onlineMatchFlow?.privateRoom || lanRole !== 'host') return;
  sendOnlineMatchSetup('config', privateMatchConfiguration());
}

function receiveOnlineMatchSetup(message) {
  const flow = onlineMatchFlow;
  if (!flow || !lanConnected || !onlineSession || message.protocol !== 1 || message.match !== flow.id ||
      message.v !== LAN_SIGNAL_VERSION || message.room !== lanRoomCode || !lanRoomCode ||
      message.gameplay !== 'royal' || message.matchRules !== 'presets') return;
  if (flow.privateRoom && message.kind === 'config' && lanRole === 'guest') {
    if (!['connected', 'ready'].includes(flow.phase) || !validSelectionState(message.selection) ||
        !validMatchRuleState(message.rules) || typeof message.rules.powerups !== 'boolean') return;
    applySelectionState(message.selection);
    applyMatchRuleState(message.rules);
    flow.configuration = JSON.stringify({selection: message.selection, rules: message.rules});
    flow.configured = true;
    if (onlineHasState) sendOnlineMatchSetup('initialized', {configuration: flow.configuration});
  } else if (flow.privateRoom && message.kind === 'initialized' && lanRole === 'host') {
    if (message.configuration !== JSON.stringify(privateMatchConfiguration())) return;
    flow.peerInitialized = true;
  } else if (message.kind === 'hello') {
    if (!flow.peerHello) {
      flow.peerHello = true;
      flow.connectedUntil = Math.max(flow.connectedUntil, performance.now() + 600);
      sendOnlineMatchHello();
    }
    if (lanRole === 'host') {
      if (flow.privateRoom) sendPrivateMatchConfiguration();
      sendOnlineMatchStatus();
    }
  } else if (lanRole === 'host' && message.kind === 'ready' && (flow.phase === 'ready' || flow.phase === 'countdown' && message.ready === false) && flow.peerHello) {
    if (flow.privateRoom && !flow.peerInitialized || message.ready !== undefined && typeof message.ready !== 'boolean') return;
    flow.guestReady = message.ready !== false;
    if (!flow.guestReady && flow.phase === 'countdown') {
      flow.phase = 'ready'; resumeCountdownEndAt = 0; lastResumeCountdownNumber = 0;
    }
    maybeStartOnlineMatchCountdown();
  } else if (lanRole === 'guest' && message.kind === 'status') {
    if (!Number.isSafeInteger(message.seq) || message.seq <= flow.remoteSequence ||
        typeof message.hostReady !== 'boolean' || typeof message.guestReady !== 'boolean' ||
        !['connected', 'ready', 'countdown', 'go'].includes(message.phase) ||
        !Number.isFinite(message.remainingMs) || message.remainingMs < 0 || message.remainingMs > RESUME_COUNTDOWN_MS) return;
    if (['countdown', 'go'].includes(message.phase) &&
        (!flow.localReady || !message.hostReady || !message.guestReady)) return;
    if (flow.privateRoom && message.phase !== 'connected' && (!flow.configured || !onlineHasState)) return;
    flow.remoteSequence = message.seq;
    flow.hostReady = message.hostReady;
    flow.guestReady = message.guestReady;
    flow.peerHello = true;
    flow.phase = message.phase;
    if (flow.phase === 'ready') resumeCountdownEndAt = 0;
    if (flow.phase === 'countdown') {
      paused = true;
      resumeCountdownEndAt = performance.now() + message.remainingMs;
    } else if (flow.phase === 'go') {
      // Only the host can release the guest, even if its local countdown expires.
      resumeCountdownEndAt = 0;
      onlineGameBlocked = false;
      flow.goUntil = performance.now() + 650;
    }
  }
  syncRoyalUi(true);
}

function tickOnlineMatchFlow() {
  const flow = onlineMatchFlow;
  if (!flow || flow.phase === 'playing') return;
  const now = performance.now();
  if (flow.phase === 'go') {
    if (now >= flow.goUntil) { flow.phase = 'playing'; syncRoyalUi(true); }
    return;
  }
  if (flow.phase === 'failed' || flow.phase === 'connecting' || !lanConnected) return;
  if (!flow.peerHello || flow.privateRoom && (lanRole === 'host' ? !flow.peerInitialized : flow.phase === 'connected')) {
    if (now >= flow.handshakeDeadline) { onlineSession?.fail('incompatible'); return; }
    if (now - flow.lastHelloAt >= 500) sendOnlineMatchHello();
  }
  if (lanRole !== 'host') return;
  if (flow.phase === 'connected' && flow.peerHello && (!flow.privateRoom || flow.peerInitialized) && now >= flow.connectedUntil) {
    flow.phase = 'ready';
    sendOnlineMatchStatus();
    sendLanState(true);
    syncRoyalUi(true);
  } else if (flow.phase === 'countdown') {
    const previousNumber = lastResumeCountdownNumber;
    if (!updateResumeCountdown()) {
      flow.phase = 'go';
      flow.goUntil = now + 650;
      onlineGameBlocked = false;
      clearHeldInput();
      sendOnlineMatchStatus();
      serveOrContinue();
      sendLanState(true);
      return;
    }
    if (lastResumeCountdownNumber !== previousNumber) {
      sendOnlineMatchStatus();
      sendLanState(true);
    }
  }
  // Keep the existing 20 Hz host snapshots/countdown in sync without simulating
  // the ball, paddles, hazards, powerups or scores during setup.
  frame++;
  sendLanState(false);
}

function failOnlineMatchFlow(code) {
  closeOnlineConnection(false);
  onlineMatchFlow = {phase: 'failed', error: code === 'incompatible' ? ONLINE_ERRORS.incompatible :
    ['host_left', 'guest_left', 'opponent_left'].includes(code) ? ONLINE_ERRORS.opponent_left :
    'Could not connect. Try finding another match.'};
  onlineGameBlocked = paused = true;
  setMenusVisible(false);
  syncRoyalUi(true);
}

function leaveOnlineMatchFlow(retry = false) {
  startOnlineSetup();
  if (retry) findOnlineMatch();
}

function initOnlineMatchFlowUi() {
  const overlay = document.createElement('section');
  overlay.id = 'onlineMatchFlow';
  overlay.className = 'online-match-flow match-ui';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'onlineFlowTitle');
  const card = document.createElement('div');
  card.className = 'online-flow-card';
  const title = document.createElement('h2');
  title.id = 'onlineFlowTitle';
  title.setAttribute('role', 'status');
  title.setAttribute('aria-live', 'polite');
  const note = document.createElement('p');
  note.id = 'onlineFlowNote';
  const configuration = document.createElement('p');
  configuration.id = 'onlineFlowConfiguration';
  const actions = document.createElement('div');
  actions.className = 'online-flow-actions';
  actions.append(royalButton('onlineReadyButton', "I'm ready", confirmOnlineMatchReady, 'match-primary'),
    royalButton('onlineRetryButton', 'Retry', () => leaveOnlineMatchFlow(true)),
    royalButton('onlineFlowBack', 'Back', () => leaveOnlineMatchFlow()));
  card.append(title, note, configuration, actions);
  overlay.append(card);
  document.body.append(overlay);
}

function syncOnlineMatchFlowUi() {
  const panel = byId('onlineMatchFlow');
  if (!panel) return;
  panel.hidden = !onlineMatchFlowVisible() || document.body.classList.contains('title-active');
  if (panel.hidden) return;
  const flow = onlineMatchFlow;
  const previousPhase = panel.dataset.phase;
  panel.dataset.phase = flow.phase;
  const countdown = flow.phase === 'countdown';
  const go = flow.phase === 'go';
  panel.setAttribute('role', go ? 'status' : 'dialog');
  if (go) panel.removeAttribute('aria-modal');
  else panel.setAttribute('aria-modal', 'true');
  royalText(byId('onlineFlowTitle'), countdown ? String(Math.max(1, Math.ceil(resumeCountdownRemainingMs() / 1000))) :
    go ? 'GO!' : flow.phase === 'failed' ? 'Connection failed' : flow.phase === 'ready' ? 'ARE YOU READY?' :
    flow.phase === 'connected' ? 'CONNECTED' : 'CONNECTING...');
  royalText(byId('onlineFlowNote'), countdown || go ? '' : flow.phase === 'failed' ? flow.error :
    flow.phase === 'ready' ? flow.localReady ? 'Waiting for your opponent to be ready.' :
      flow.hostReady || flow.guestReady ? 'Your opponent is ready. Confirm when you are ready.' :
      'Both players must confirm before the countdown.' : flow.privateRoom ? '' : 'Classic Match · First to 10');
  byId('onlineReadyButton').hidden = flow.phase !== 'ready';
  byId('onlineReadyButton').disabled = Boolean(flow.localReady && !flow.privateRoom);
  royalText(byId('onlineFlowConfiguration'), flow.privateRoom && flow.phase !== 'failed' ?
    localizeText(currentLevel().name) + ' · ' + localizeText(matchRule().label) + ' · ' +
    localizeText(matchPowerupsEnabled ? 'Royal Powerups: On' : 'Royal Powerups: Off') : '');
  royalText(byId('onlineReadyButton'), flow.localReady ? flow.privateRoom ? 'Ready — Undo' : 'Ready!' : "I'm ready");
  byId('onlineRetryButton').hidden = flow.phase !== 'failed';
  byId('onlineFlowBack').hidden = go;
  royalText(byId('onlineFlowBack'), flow.phase === 'failed' ? 'Back' : 'Cancel');
  // Focus the explicit confirmation as it appears; never interpret a held key as ready.
  if (previousPhase !== flow.phase && flow.phase === 'ready') byId('onlineReadyButton').focus({preventScroll: true});
}
