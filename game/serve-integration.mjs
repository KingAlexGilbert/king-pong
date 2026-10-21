import {functionRange} from './ui-integration.mjs';

// Acceleration and the existing one-second spawn ripple share the old counter,
// but acceleration releases velocity after 24 ticks. Boss serves are unchanged.
const begin = `function beginRallyLaunchRamp() {
  rallyLaunchTargetSpeed = Math.max(0.001, Math.hypot(ball.vx, ball.vy));
  rallyLaunchFramesRemaining = RALLY_LAUNCH_RAMP_FRAMES;
  rallySpawnPulseX = ball.x + BALL_HALF;
  rallySpawnPulseY = ball.y + BALL_HALF;
  ball.vx *= 0.4;
  ball.vy *= 0.4;
}`;

const advance = `function updateRallyLaunchRamp() {
  if (rallyLaunchFramesRemaining <= 0) return;
  const elapsed = RALLY_LAUNCH_RAMP_FRAMES - rallyLaunchFramesRemaining + 1;
  rallyLaunchFramesRemaining--;
  // Keep the original ripple timing. Only the first 0.4 seconds change speed.
  if (rallyLaunchTargetSpeed > 0 && elapsed <= 24) {
    const desiredSpeed = rallyLaunchTargetSpeed * lerp(0.4, 1, elapsed / 24) * (ball.rush ? 1.3 : 1);
    const currentSpeed = Math.hypot(ball.vx, ball.vy);
    if (currentSpeed > 0.001) {
      const scale = desiredSpeed / currentSpeed;
      ball.vx *= scale;
      ball.vy *= scale;
    }
  }
  if (elapsed >= 24) rallyLaunchTargetSpeed = 0;
  if (rallyLaunchFramesRemaining <= 0) clearRallyLaunchRamp();
}`;

const hazards = `function resolveHazardCollisions() {
  for (const h of hazards) {
    const hit = h.type === "circle" ? resolveCircleCollision(h) : resolveRectCollision(h);
    // A real contact owns its outgoing speed. CPU prediction calls the quiet
    // solvers directly, and a Split collision must not cancel the primary ramp.
    if (hit && ball !== royalSplitBall) rallyLaunchTargetSpeed = 0;
  }
}`;

export function integrateServeMotion(source) {
  for (const [name, code] of [['beginRallyLaunchRamp', begin], ['updateRallyLaunchRamp', advance],
      ['resolveHazardCollisions', hazards]]) {
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
  edit('serveOrContinue', '  if (creditsActive) return;', `  if (creditsActive) return;
  if (mode === 2 && (lanRole === 'guest' || pointServeCountdownActive() || paused || onlineGameBlocked ||
      !waitingForServe && !gameOver)) return;`);
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
  edit('applyLanHostState', '  endMessage = String(state.endMessage || "").slice(0, 180);',
    '  endMessage = String(state.endMessage || "").slice(0, 180);\n  applyPointServeSnapshot(state);');
  return source;
}
