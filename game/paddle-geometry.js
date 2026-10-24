function rectsOverlapRaw(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function rectsOverlap(a, b) {
  return rectsOverlapRaw(a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h);
}

function ballRect() {
  return {
    x: ball.x,
    y: ball.y,
    w: BALL_SIZE,
    h: BALL_SIZE
  };
}

function ballSpeed() {
  return Math.hypot(ball.vx, ball.vy);
}

function normalizeBallVelocity(minSpeed, maxSpeed) {
  /* ROYAL POLISH */
  minSpeed *= royalBallSpeedScale();
  maxSpeed *= royalBallSpeedScale();
  /* END ROYAL POLISH */
  if (ball.rush) {
    minSpeed *= 1.3;
    maxSpeed *= 1.3;
  }
  let speed = ballSpeed();
  if (speed < 0.001) {
    ball.vx = Math.random() < 0.5 ? -minSpeed : minSpeed;
    ball.vy = 0;
    speed = minSpeed;
  }
  if (Math.abs(ball.vx) < 1.2 * royalBallSpeedScale()) {
    ball.vx = (ball.vx < 0 ? -1 : 1) * 1.2 * royalBallSpeedScale();
    speed = ballSpeed();
  }
  const target = clamp(speed, minSpeed, maxSpeed);
  ball.vx = ball.vx / speed * target;
  ball.vy = ball.vy / speed * target;
}

function activePaddleProfile(paddle) {
  if (mode === 4 || bossIntroActive) {
    return paddle === right ? bossAdaptiveProfile : DEFAULT_PADDLE_PROFILE;
  }
  if (mode === 2) return selectedPaddleProfile(paddle);
  if (mode === 3 && paddle === left && saveData && validPaddleId(saveData.royalPaddle)) return selectedPaddleProfile(paddle);
  const index = clamp(selectedAbsoluteLevelIndex(), 0, TOTAL_LEVELS - 1);
  return paddle === right ? ENEMY_PADDLE_PROFILES[index] || DEFAULT_PADDLE_PROFILE : PLAYER_PADDLE_PROFILES[index] ||
    DEFAULT_PADDLE_PROFILE;
}

function paddleRelativeContact(paddle, centerY) {
  return clamp((centerY - (paddle.y + PADDLE_H / 2)) / (PADDLE_H / 2), -1, 1);
}

function paddleProfileOffset(profile, relative) {
  const values = profile.offsets;
  const scaled = clamp((relative + 1) * 0.5, 0, 1) * (values.length - 1);
  const low = Math.floor(scaled);
  const high = Math.min(values.length - 1, low + 1);
  const amount = scaled - low;
  return lerp(values[low], values[high], amount);
}

function paddleProfileSlopeAngle(profile, relative) {
  const sampleRadius = 0.08;
  const upper = clamp(relative - sampleRadius, -1, 1);
  const lower = clamp(relative + sampleRadius, -1, 1);
  const upperOffset = paddleProfileOffset(profile, upper);
  const lowerOffset = paddleProfileOffset(profile, lower);
  const deltaY = Math.max(1, (lower - upper) * PADDLE_H / 2);
  const faceSlope = (lowerOffset - upperOffset) / deltaY;
  return -Math.atan(faceSlope);
}

function paddleSurfaceX(paddle, direction, profile, centerY) {
  const relative = paddleRelativeContact(paddle, centerY);
  const offset = paddleProfileOffset(profile, relative);
  return direction > 0 ? paddle.x + PADDLE_W + offset : paddle.x - offset;
}

function paddleIntersectsBall(ballState, paddle, direction, profile) {
  const centerY = ballState.y + BALL_HALF;
  if (centerY < paddle.y - BALL_HALF || centerY > paddle.y + PADDLE_H + BALL_HALF) {
    return false;
  }
  const surfaceX = paddleSurfaceX(paddle, direction, profile, centerY);
  if (direction > 0) {
    const crossedFace = ballState.prevX >= surfaceX - 1 && ballState.x <= surfaceX;
    const embeddedInFace = ballState.x <= surfaceX && ballState.x + BALL_SIZE >= paddle.x;
    return crossedFace || embeddedInFace;
  }
  const previousRight = ballState.prevX + BALL_SIZE;
  const currentRight = ballState.x + BALL_SIZE;
  const crossedFace = previousRight <= surfaceX + 1 && currentRight >= surfaceX;
  const embeddedInFace = currentRight >= surfaceX && ballState.x <= paddle.x + PADDLE_W;
  return crossedFace || embeddedInFace;
}

function cpuReturnTargetAngle(ballCenter) {
  const bounds = visiblePlayfieldBounds();
  const playerCenter = left.y + PADDLE_H / 2;
  const fieldCenter = bounds.top + (bounds.bottom - bounds.top) / 2;
  const targetY = playerCenter <= fieldCenter ? bounds.bottom - BALL_HALF - 18 : bounds.top + BALL_HALF + 18;
  const horizontalDistance = Math.max(120, right.x - left.x);
  return clamp(Math.atan2(targetY - ballCenter, horizontalDistance), -0.9, 0.9);
}

function calculatePaddleBounceAngle(profile, paddle, direction, ballCenter, incomingVy = 0, allowCpuAim = true) {
  const relative = paddleRelativeContact(paddle, ballCenter);
  const contactAngle = relative * profile.contactScale;
  const surfaceAngle = paddleProfileSlopeAngle(profile, relative) * profile.slopeInfluence;
  let bounceAngle = contactAngle + surfaceAngle + profile.bias;
  if (allowCpuAim && direction < 0 && profile.aimStrength > 0 && mode !== 2) {
    const desired = cpuReturnTargetAngle(ballCenter);
    bounceAngle = lerp(bounceAngle, desired, profile.aimStrength);
  }
  if (profile.noise > 0) {
    bounceAngle += (Math.random() * 2 - 1) * profile.noise;
  }
  bounceAngle += clamp(incomingVy * 0.012, -0.07, 0.07);
  return clamp(bounceAngle, -1.16, 1.16);
}

function bossDesiredReturnAngle(contactY) {
  const bounds = visiblePlayfieldBounds();
  const playerCenter = left.y + PADDLE_H / 2;
  const fieldCenter = bounds.top + (bounds.bottom - bounds.top) / 2;
  const targetY = playerCenter < fieldCenter ? bounds.bottom - BALL_HALF - 10 : bounds.top + BALL_HALF + 10;
  return clamp(Math.atan2(targetY - contactY, Math.max(120, right.x - left.x)), -0.96, 0.96);
}

function selectBossAdaptiveProfile(targetBall, force = false) {
  if (!targetBall || targetBall.vx <= 0) {
    if (force) {
      bossAdaptiveProfile = BOSS_ADAPTIVE_PROFILES[0];
      bossAdaptiveBallId = null;
    }
    return bossAdaptiveProfile;
  }
  if (!force && targetBall.id === bossAdaptiveBallId && frame - bossAdaptiveDecisionFrame < 6) {
    return bossAdaptiveProfile;
  }
  const contactY = predictBossBallCenter(targetBall);
  const relative = paddleRelativeContact(right, contactY);
  const desiredAngle = bossDesiredReturnAngle(contactY);
  let bestProfile = BOSS_ADAPTIVE_PROFILES[0];
  let bestScore = Infinity;
  for (const candidate of BOSS_ADAPTIVE_PROFILES) {
    const candidateAngle = clamp(relative * candidate.contactScale + paddleProfileSlopeAngle(candidate, relative) *
      candidate.slopeInfluence + candidate.bias + clamp(targetBall.vy * 0.012, -0.07, 0.07), -1.16, 1.16);
    const score = Math.abs(candidateAngle - desiredAngle);
    if (score < bestScore) {
      bestScore = score;
      bestProfile = candidate;
    }
  }
  bossAdaptiveProfile = bestProfile;
  bossAdaptiveBallId = targetBall.id;
  bossAdaptiveDecisionFrame = frame;
  return bestProfile;
}
