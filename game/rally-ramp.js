function clearRallyLaunchRamp() {
  rallyLaunchFramesRemaining = 0;
  rallyLaunchTargetSpeed = 0;
}

function beginRallyLaunchRamp() {
  rallyLaunchTargetSpeed = Math.max(0.001, Math.hypot(ball.vx, ball.vy));
  rallyLaunchFramesRemaining = RALLY_LAUNCH_RAMP_FRAMES;
  rallySpawnPulseX = ball.x + BALL_HALF;
  rallySpawnPulseY = ball.y + BALL_HALF;
  ball.vx *= 0.4;
  ball.vy *= 0.4;
}

function updateRallyLaunchRamp() {
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
}
