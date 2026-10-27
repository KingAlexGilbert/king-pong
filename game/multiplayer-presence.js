// Peer availability belongs to the authenticated session, never to paddle input.
// Background timers may stop entirely. The visible peer owns the deadline too,
// and every return checks wall-clock time before accepting more gameplay.
const MULTIPLAYER_PRESENCE = Object.freeze({probe: 2000, stale: 8000, grace: 30000, poll: 500});

function multiplayerPresence() { return onlineSession?.presence; }
function multiplayerSuspended() { return Boolean(multiplayerPresence()?.suspended); }

function stopMultiplayerPresence(session) {
  if (session?.presence) clearInterval(session.presence.timer);
  if (session) session.presence = null;
  if (onlineSession && session !== onlineSession) return;
  const panel = document.getElementById('multiplayerUnavailable');
  if (panel) panel.hidden = true;
}

function receivePresenceHello(message) {
  if (message.presence !== 1 || !onlineRematchReady || multiplayerPresence()) return;
  const now = Date.now(), session = onlineSession;
  const p = session.presence = {epoch: 0, phase: 'playing', suspended: false,
    localActive: true, remoteActive: true, revision: 0, remoteRevision: -1,
    lastHeard: now, lastSent: now, probe: 0, awaitingProbe: 0, transportDown: false};
  p.timer = setInterval(() => { if (onlineSession === session) tickMultiplayerPresence(); }, MULTIPLAYER_PRESENCE.poll);
  if (document.hidden || window.KingPongBackgrounded) setMultiplayerAvailability(false);
}

function sendMultiplayerPresence(kind, fields = {}) {
  const p = multiplayerPresence();
  if (!p || !lanConnected) return false;
  return lanSend({v: LAN_SIGNAL_VERSION, room: lanRoomCode, type: 'presence', protocol: 1,
    token: multiplayerRematch().token, epoch: p.epoch, kind,
    revision: p.revision, active: p.localActive, ...fields});
}

function showMultiplayerUnavailable() {
  let panel = document.getElementById('multiplayerUnavailable');
  if (!panel) {
    panel = document.createElement('p');
    panel.id = 'multiplayerUnavailable'; panel.className = 'multiplayer-status';
    panel.setAttribute('role', 'status'); panel.setAttribute('aria-live', 'polite');
    setLocalizedText(panel, 'Opponent unavailable — Game paused.');
    document.getElementById('matchBar').append(panel);
  }
  panel.hidden = !multiplayerSuspended();
}

function suspendMultiplayerPresence(reason = 'peer-hold') {
  const p = multiplayerPresence();
  if (!p) return;
  if (p.suspended) {
    if (p.phase !== 'held') {
      p.phase = 'held';
      if (lanRole === 'host') { p.epoch++; sendMultiplayerPresence('hold'); }
    }
    return;
  }
  p.suspended = true; p.since = Date.now(); p.flowAt = performance.now();
  p.reason = reason;
  p.wasPaused = p.focusPause?.paused ?? paused; p.countdown = p.focusPause?.countdown ?? resumeCountdownRemainingMs();
  p.focusPause = null;
  p.phase = 'held';
  if (lanRole === 'host') p.epoch++;
  onlineGameBlocked = paused = true;
  suspendPointServeCountdown(); resumeCountdownEndAt = 0; lastResumeCountdownNumber = 0;
  clearHeldInput(); onlineInputs.clear(); onlineLastInput = null; resetVisualHistory();
  resetFrameClock();
  showMultiplayerUnavailable();
  if (lanRole === 'host') sendMultiplayerPresence('hold');
}

function presenceExpired(p = multiplayerPresence()) {
  if (!p?.suspended || Date.now() - p.since < MULTIPLAYER_PRESENCE.grace) return false;
  leaveMultiplayerSession('Opponent disconnected.');
  return true;
}

function setMultiplayerAvailability(active) {
  const p = multiplayerPresence();
  if (!p || presenceExpired(p)) return;
  active = Boolean(active);
  if (p.localActive === active) return;
  p.localActive = active; p.revision++;
  if (!active) suspendMultiplayerPresence('local-background');
  sendMultiplayerPresence('status');
  maybeResumeMultiplayer();
}

function multiplayerTransportInterrupted(reason = 'transport-recovery') {
  const p = multiplayerPresence();
  if (!p) return false;
  p.transportDown = true;
  suspendMultiplayerPresence(reason);
  return true;
}

function multiplayerTransportResumed() {
  const p = multiplayerPresence();
  if (!p) return false;
  if (presenceExpired(p)) return true;
  p.transportDown = false;
  sendMultiplayerPresence('status');
  maybeResumeMultiplayer();
  return true;
}

function noteMultiplayerTraffic() {
  const p = multiplayerPresence();
  if (!p || presenceExpired(p)) return;
  p.lastHeard = Date.now();
  maybeResumeMultiplayer();
}

function maybeResumeMultiplayer() {
  const p = multiplayerPresence();
  if (!p || !p.suspended || presenceExpired(p) || lanRole !== 'host' ||
      p.phase !== 'held' || !p.localActive || !p.remoteActive || p.transportDown ||
      Date.now() - p.lastHeard >= MULTIPLAYER_PRESENCE.stale) return;
  p.phase = 'offered';
  sendMultiplayerPresence('offer');
}

function commitMultiplayerResume() {
  const p = multiplayerPresence();
  if (!p || !p.suspended || presenceExpired(p)) return;
  // The snapshot handshake proves the peer is back. A transport ACK for an
  // older control can still be in flight; do not charge its suspended time
  // against the normal 12-second delivery deadline after committing recovery.
  for (const control of onlineSession.secure?.pending?.values() || []) control.created = Date.now();
  p.suspended = false; p.phase = 'playing'; p.awaitingProbe = 0; p.reason = 'snapshot-committed';
  const elapsed = performance.now() - p.flowAt;
  if (onlineMatchFlow) for (const key of ['handshakeDeadline', 'connectedUntil', 'goUntil'])
    if (Number.isFinite(onlineMatchFlow[key])) onlineMatchFlow[key] += elapsed;
  onlineGameBlocked = onlineMatchFlowBlocksPlay();
  clearHeldInput(); onlineInputs.clear(); onlineLastInput = null; resetVisualHistory(); resetFrameClock();
  if (lanRole === 'host') {
    // Preserve manual pause, results and ready consent. An interrupted rally or
    // countdown always resumes through the existing countdown/audio machinery.
    const countdown = onlineMatchFlow?.phase === 'countdown' || p.countdown > 0 ||
      !p.wasPaused && !waitingForServe && !gameOver;
    paused = p.wasPaused || countdown || onlineGameBlocked;
    if (countdown) { resumeCountdownEndAt = performance.now() + RESUME_COUNTDOWN_MS; lastResumeCountdownNumber = 0; }
    sendMultiplayerPresence('resume');
    p.sendingSnapshot = true; sendLanState(true); p.sendingSnapshot = false;
  }
  showMultiplayerUnavailable(); syncRoyalUi(true);
}

function receiveMultiplayerPresence(m) {
  const p = multiplayerPresence();
  if (!p || !lanConnected || m.v !== LAN_SIGNAL_VERSION || m.room !== lanRoomCode ||
      m.gameplay !== 'royal' || m.matchRules !== 'presets' || m.protocol !== 1 ||
      m.token !== multiplayerRematch().token || !Number.isSafeInteger(m.epoch) || m.epoch < 0 ||
      !Number.isSafeInteger(m.revision) || m.revision < 0 || typeof m.active !== 'boolean' ||
      !['status', 'status-ack', 'ping', 'pong', 'hold', 'offer', 'ready', 'snapshot-ack', 'resume', 'leave'].includes(m.kind)) return;
  if (m.kind === 'leave') { leaveMultiplayerSession('Opponent disconnected.', false); return; }
  if (presenceExpired(p)) return;
  if (m.revision < p.remoteRevision) return;
  p.remoteRevision = m.revision; p.remoteActive = m.active; p.lastHeard = Date.now();
  if (!m.active) suspendMultiplayerPresence('peer-background');
  if (m.kind === 'status') sendMultiplayerPresence('status-ack');
  if (m.kind === 'ping' && Number.isSafeInteger(m.probe) && m.probe > 0)
    sendMultiplayerPresence('pong', {probe: m.probe});
  if (m.kind === 'pong' && m.probe === p.awaitingProbe) p.awaitingProbe = 0;
  if (lanRole === 'guest' && (m.kind === 'hold' || m.kind === 'offer') && m.epoch >= p.epoch) {
    if (m.epoch === p.epoch && !p.suspended) return; // Delayed message from a completed recovery.
    if (m.epoch === p.epoch && p.phase !== 'held') {
      if (m.kind === 'offer') sendMultiplayerPresence(p.phase === 'acknowledged' ? 'snapshot-ack' : 'ready');
      return; // A duplicate hold/offer cannot roll back an in-flight handshake.
    }
    suspendMultiplayerPresence('peer-hold');
    p.epoch = m.epoch;
    if (m.kind === 'offer' && p.localActive && m.active && !p.transportDown) {
      p.phase = 'snapshot'; sendMultiplayerPresence('ready');
    }
  } else if (lanRole === 'host' && m.epoch === p.epoch && p.localActive && p.remoteActive && !p.transportDown) {
    if (m.kind === 'ready' && ['offered', 'snapshot'].includes(p.phase)) {
      p.phase = 'snapshot'; p.sendingSnapshot = true; sendLanState(true); p.sendingSnapshot = false;
    } else if (m.kind === 'snapshot-ack' && p.phase === 'snapshot') commitMultiplayerResume();
  } else if (lanRole === 'guest' && m.kind === 'resume' && m.epoch === p.epoch &&
      p.phase === 'acknowledged' && p.localActive && p.remoteActive && !p.transportDown) commitMultiplayerResume();
  maybeResumeMultiplayer();
}

function acceptMultiplayerPresence(m) {
  if (!m || typeof m !== 'object') return false;
  const p = multiplayerPresence();
  if (!p) return true;
  if (presenceExpired(p)) return false;
  if (['state', 'input', 'action', 'match-setup'].includes(m.type) && m.presenceEpoch !== p.epoch &&
      !(p.epoch === 0 && m.presenceEpoch === undefined)) return false;
  if (!p.suspended) return true;
  return m.type === 'state' && lanRole === 'guest' && p.phase === 'snapshot' && m.presenceSnapshot === true ||
    m.type === 'rematch' && m.kind === 'leave';
}

function finishPresenceSnapshot(m) {
  const p = multiplayerPresence();
  if (p?.suspended && p.phase === 'snapshot' && m.presenceSnapshot === true && m.presenceEpoch === p.epoch) {
    p.phase = 'acknowledged'; sendMultiplayerPresence('snapshot-ack');
  }
}

function tickMultiplayerPresence() {
  const p = multiplayerPresence();
  if (!p || presenceExpired(p)) return;
  const now = Date.now();
  if (now - p.lastHeard >= MULTIPLAYER_PRESENCE.stale) {
    suspendMultiplayerPresence('traffic-timeout');
    // Reuse the existing ICE restart -> TURN -> encrypted WebSocket recovery.
    // An explicitly backgrounded peer may simply have suspended its JS timers.
    if (p.remoteActive && p.localActive && !p.transportDown && onlineSession.secure?.mode === 'rtc')
      onlineSession.secure.rtcFailed();
  }
  if (!p.localActive) return;
  if (!p.awaitingProbe && now - p.lastHeard >= MULTIPLAYER_PRESENCE.probe && now - p.lastSent >= MULTIPLAYER_PRESENCE.probe) {
    p.awaitingProbe = ++p.probe;
    if (!sendMultiplayerPresence('ping', {probe: p.awaitingProbe})) p.awaitingProbe = 0;
  }
}

function multiplayerRecoveryRemaining(session) {
  const p = session?.presence;
  return p?.suspended ? Math.max(0, MULTIPLAYER_PRESENCE.grace - (Date.now() - p.since)) : 0;
}

function multiplayerPageHide(event) {
  if (event.persisted) { setMultiplayerAvailability(false); return; }
  stopMatchmaking();
  if (onlineSession) {
    sendMultiplayerPresence('leave'); sendRematch('leave');
    onlineSession.close(); // Best effort; watchdog also covers process kills without any event.
  }
}

window.addEventListener('pagehide', multiplayerPageHide);
window.addEventListener('pageshow', () => setMultiplayerAvailability(!document.hidden && !window.KingPongBackgrounded));
document.addEventListener('visibilitychange', () => setMultiplayerAvailability(!document.hidden && !window.KingPongBackgrounded));
document.addEventListener('kingpong-background', () => setMultiplayerAvailability(!document.hidden && !window.KingPongBackgrounded));

// blur can precede visibilitychange on mobile. Preserve the state from before
// the legacy blur handler pauses the host, rather than treating it as a user's
// manual Pause choice. A visible permission prompt keeps its existing behavior.
function recordMultiplayerFocusLoss() {
  const p = multiplayerPresence();
  if (p && !p.suspended && !p.focusPause) p.focusPause = {paused, countdown: resumeCountdownRemainingMs()};
  if (document.hidden || window.KingPongBackgrounded) setMultiplayerAvailability(false);
}
function recordMultiplayerFocusReturn() {
  if (!document.hidden && !window.KingPongBackgrounded) setMultiplayerAvailability(true);
  const p = multiplayerPresence();
  if (p) p.focusPause = null;
}
