// The Wall keeps its permanent ball array. Royal Split uses the existing single
// temporary slot and the same pickup/shield helpers, without swapping world ball.
function updateSingleBossBall(bossBall) {
  updateBossBallLaunchRamp(bossBall);
  bossBall.prevX = bossBall.x;
  bossBall.prevY = bossBall.y;
  bossBall.x += bossBall.vx;
  bossBall.y += bossBall.vy;
  reflectBossBallYForBounds(bossBall);
  resolveBossHazardCollisions(bossBall);
  if (bossBall.vx < 0 && paddleIntersectsBall(bossBall, left, 1, activePaddleProfile(left)))
    hitBossPaddle(bossBall, left, 1);
  if (bossBall.vx > 0 && paddleIntersectsBall(bossBall, right, -1, activePaddleProfile(right)))
    hitBossPaddle(bossBall, right, -1);
  // A temporary ball disappears on its first paddle contact, as in Campaign.
  if (bossBall.id === 'royal-split' && royalSplitBall !== bossBall) return 0;
  collectRoyalPickup(bossBall);
  collideCastleGuard(bossBall);
  if (bossBall.x + BALL_SIZE < 0) return -1;
  if (bossBall.x > W) return 1;
  return 0;
}
