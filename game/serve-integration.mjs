import {functionRange} from './ui-integration.mjs';

const hazards = `function resolveHazardCollisions() {
  for (const h of hazards) {
    const hit = h.type === "circle" ? resolveCircleCollision(h) : resolveRectCollision(h);
    // A real contact owns its outgoing speed. CPU prediction calls the quiet
    // solvers directly, and a Split collision must not cancel the primary ramp.
    if (hit && ball !== royalSplitBall) rallyLaunchTargetSpeed = 0;
  }
}`;

export function integrateServeMotion(source) {
  for (const [name, code] of [['resolveHazardCollisions', hazards]]) {
    const [start, end] = functionRange(source, name);
    source = source.slice(0, start) + code + source.slice(end);
  }
  // These narrow hooks also cover the native LAN engine in each platform shell.
  const edit = (name, before, after) => {
    const [start, end] = functionRange(source, name);
    const body = source.slice(start, end);
    if (body.includes(after)) return;
    if (!body.includes(before)) throw new Error('Missing automatic serve hook: ' + name);
    source = source.slice(0, start) + body.replace(before, after) + source.slice(end);
  };
  edit('resetBall', '  resetRoyalRally();', '  clearPointServeCountdown();\n  resetRoyalRally();');
  // Both the first multiplayer serve and subsequent points start close to the
  // receiving paddle, using the same hazard-safe placement as single-player.
  edit('resetBall',
    '  const useReceiverSideSpawn = spawnNearPlayer && shouldAutoServeAfterPoint();',
    '  const useReceiverSideSpawn = mode === 2 || spawnNearPlayer && shouldAutoServeAfterPoint();');
  edit('serveOrContinue', '  if (creditsActive) return;', `  if (creditsActive) return;
  if (mode === 2 && (lanRole === 'guest' || pointServeCountdownActive() || paused || onlineGameBlocked ||
      !waitingForServe && !gameOver)) return;`);
  edit('playPlayerScoreSound',
    '  if (mode === 1 || mode === 3) {',
    `  if (mode === 2) { playMultiplayerLocalScoreCue('left', isWinningPoint); return; }
  if (mode === 1 || mode === 3) {`);
  edit('pointForCpu',
    '  if (isWinningPoint && (mode === 1 || mode === 3)) {',
    `  if (mode === 2) playMultiplayerLocalScoreCue('right', isWinningPoint);
  else if (isWinningPoint && (mode === 1 || mode === 3)) {`);
  for (const name of ['pointForPlayer', 'pointForCpu']) {
    edit(name, '      shouldAutoServeAfterPoint());',
      '      shouldAutoServeAfterPoint());\n    beginPointServeCountdown();');
  }
  edit('update', '  const gamepads = updateGamepadInput();',
    '  const gamepads = updateGamepadInput();\n  tickPointServeCountdown();');
  for (const name of ['togglePause', 'handleGameFocusLoss'].filter(name => source.includes('function ' + name + '('))) {
    const [start, end] = functionRange(source, name);
    const body = source.slice(start, end);
    const header = body.slice(0, body.indexOf('{') + 1);
    edit(name, header, header + '\n  suspendPointServeCountdown();');
  }
  edit('sendLanState', '    waitingForServe,', '    pointServeMs: pointServeSnapshotMs(),\n    waitingForServe,');
  // Count only validated, newly accepted snapshots. The initial snapshot and
  // any rematch reset cannot manufacture a local point sound.
  edit('handleLanGuestMessage',
    '  lanLastStateSeq = message.seq;',
    `  const hadScoreSnapshot = lanLastStateSeq >= 0 && !gameOver;
  const previousLeftScore = left.score, previousRightScore = right.score;
  lanLastStateSeq = message.seq;`);
  edit('handleLanGuestMessage',
    '  applyLanHostState(message);',
    `  applyLanHostState(message);
  if (hadScoreSnapshot && mode === 2 && !onlineGameBlocked)
    playGuestMultiplayerScoreCue(previousLeftScore, previousRightScore);`);
  edit('applyLanHostState', '  endMessage = String(state.endMessage || "").slice(0, 180);',
    '  endMessage = String(state.endMessage || "").slice(0, 180);\n  applyPointServeSnapshot(state);');
  return source;
}
