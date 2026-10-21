// Between-point serving is gameplay state, shared by online and offline LAN.
// Only the authority advances this clock; guests interpolate its display only.
const MULTIPLAYER_SERVE_MS = 2000;
let pointServeCountdown = null;

function pointServeCountdownActive() {
  return Boolean(pointServeCountdown && mode === 2 && waitingForServe &&
    !gameOver && !levelCleared && !campaignCleared);
}

function clearPointServeCountdown() {
  pointServeCountdown = null;
}

function suspendPointServeCountdown() {
  if (pointServeCountdown) pointServeCountdown.at = null;
}

function beginPointServeCountdown() {
  if (mode !== 2 || lanRole === 'guest' || pointServeCountdownActive() ||
      gameOver || levelCleared || campaignCleared) return;
  pointServeCountdown = {remainingMs: MULTIPLAYER_SERVE_MS, at: performance.now(), networked: isLanActive(),
    score: left.score + ':' + right.score, soundStep: 3};
  sendLanState(true);
}

function pointServeSnapshotMs() {
  return pointServeCountdownActive() ? Math.ceil(pointServeCountdown.remainingMs) : 0;
}

function applyPointServeSnapshot(state) {
  // Called only after the normal host/sequence/tick/snapshot validation.
  const score = left.score + ':' + right.score;
  // Keep local cue progress across snapshots/recovery. Scores identify a new
  // point even when the guest missed every snapshot of the intervening rally.
  const soundStep = pointServeCountdown?.score === score ? pointServeCountdown.soundStep : 3;
  pointServeCountdown = state.pointServeMs > 0 && waitingForServe && !gameOver &&
    !levelCleared && !campaignCleared ?
    {remainingMs: state.pointServeMs, at: paused ? null : performance.now(), networked: true, score, soundStep} : null;
}

function pointServeDisplayNumber() {
  if (!pointServeCountdownActive()) return 0;
  const elapsed = !paused && !onlineGameBlocked && pointServeCountdown.at !== null ?
    Math.max(0, performance.now() - pointServeCountdown.at) : 0;
  // An expired guest display holds at 1 until an authoritative rally arrives.
  return Math.max(1, Math.ceil((pointServeCountdown.remainingMs - elapsed) / 1000));
}

function tickPointServeCountdown() {
  if (!pointServeCountdown) return;
  if (!pointServeCountdownActive() || document.body.classList.contains('title-active') || creditsActive) {
    clearPointServeCountdown();
    return;
  }
  if (lanRole === 'guest') return;
  if (paused || onlineGameBlocked || pointServeCountdown.networked && !isLanHostActive()) {
    suspendPointServeCountdown();
    return;
  }
  const now = performance.now();
  if (pointServeCountdown.at !== null) {
    pointServeCountdown.remainingMs = Math.max(0, pointServeCountdown.remainingMs -
      Math.max(0, now - pointServeCountdown.at));
  }
  pointServeCountdown.at = now;
  if (pointServeCountdown.remainingMs > 0) return;
  // Clear before invoking the normal serve path: no callbacks or duplicate timers.
  clearPointServeCountdown();
  serveOrContinue();
  sendLanState(true);
}

function playPointServeCountdownSound(number) {
  if (!pointServeCountdownActive() || paused || onlineGameBlocked || pointServeCountdown.at === null ||
      pointServeCountdown.networked && !isLanHostActive() && !isLanGuestActive()) return;
  if (number >= pointServeCountdown.soundStep) return;
  // Consume a displayed step even if muted or audio is not yet unlocked. Never
  // queue old beeps for a later gesture or replay them after snapshot correction.
  pointServeCountdown.soundStep = number;
  if (document.hidden || !audioCtx || audioCtx.state !== 'running') return;
  beep(number === 1 ? 720 : 600, 0.085);
}

function drawPointServeCountdown() {
  const number = pointServeDisplayNumber();
  playPointServeCountdownSound(number);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.68)';
  ctx.fillRect(W / 2 - 42, H / 2 - 96, 84, 84);
  ctx.strokeStyle = currentCampaign().accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(W / 2 - 42, H / 2 - 96, 84, 84);
  ctx.fillStyle = '#fff';
  drawText(String(number), W / 2, H / 2 - 54, 56);
}
