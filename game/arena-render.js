// Canonical arena draw order; world coordinates remain authoritative.
function draw(view = captureVisualState()) {
  ctx.setTransform(renderScale, 0, 0, canvas.height / H, 0, 0);
  ctx.imageSmoothingEnabled = false;
  // Camera feedback follows the same snapshots as the ball, including substeps.
  const offsetX = view.shake.x;
  const offsetY = view.shake.y;
  ctx.save();
  ctx.translate(twoPlayerViewMirrored() ? -offsetX : offsetX, offsetY);
  ctx.save();
  applyArenaPerspective();
  drawBackground();
  drawCenterLine();
  drawHazards(view.hazards);
  ctx.restore(); // Scores and interface text remain readable.
  if (mode === 4) {
    drawBossHud();
  } else {
    ctx.fillStyle = "#fff";
    if (mode === 2) {
      drawMultiplayerScore(twoPlayerViewMirrored() ? view.right.score : view.left.score, W / 2 - 90, 34);
      drawMultiplayerScore(twoPlayerViewMirrored() ? view.left.score : view.right.score, W / 2 + 90, 34);
    } else {
      drawScore(view.left.score, W / 2 - 112, 34);
      drawScore(view.right.score, W / 2 + 72, 34);
    }
    drawCampaignPlayInfo();
  }
  ctx.save();
  applyArenaPerspective();
  // Draw once, after scores: pickup sprites and ripples stay in the foreground.
  drawRoyalEffects(view);
  ctx.fillStyle = "#fff";
  drawPaddleShape(view.left, 1, activePaddleProfile(left), "#ffffff");
  drawPaddleShape(view.right, -1, activePaddleProfile(right), mode === 1 || mode === 3 || mode === 4 ? currentCampaign()
    .accent : "#ffffff");
  if (mode === 4) {
    drawBossBalls(view.bossBalls);
  } else {
    drawRallySpawnPulse(view);
    ctx.fillStyle = currentCampaign().accent;
    ctx.shadowColor = currentCampaign().accent;
    ctx.shadowBlur = 14;
    drawRoyalBall(view.ball);
    drawRoyalBall(view.split, true);
    drawGuestInputPreview(view);
    ctx.shadowBlur = 0;
  }
  ctx.restore();
  ctx.fillStyle = "#fff";
  if (menusVisible && !document.body.classList.contains("royal-ui-ready")) {
    const cfg = getCpuConfig();
    let modeText;
    if (mode === 1) {
      modeText =
        `1 PLAYER CAMPAIGN - LV ${absoluteLevelNumber()}/${mode===1?TOTAL_LEVELS:arenaCatalog.length} - CPU ${cfg.label}%`;
    } else if (mode === 3) {
      modeText =
        `CUSTOM GAME - LV ${String(absoluteLevelNumber()).padStart(2,"0")}/${mode===1?TOTAL_LEVELS:arenaCatalog.length} - ${currentLevel().name} - CPU ${cfg.label}% | CPU Paddle Speed ${cfg.maxMove.toFixed(1)}`;
    } else if (mode === 4) {
      modeText = `SECRET BOSS - ${BOSS_LEVEL.name} - ${bossBalls.length} BALLS`;
    } else {
      modeText = `2 PLAYER PRACTICE - ${currentLevel().name}`;
    }
    drawText(modeText, W / 2, 16, 12);
    drawText(mode === 4 ?
      `Health ${bossPlayerHealth}/${BOSS_PLAYER_MAX_HEALTH} vs ${bossEnemyHealth}/${BOSS_ENEMY_MAX_HEALTH}` :
      `Goal ${currentLevel().goal}`, W / 2, H - 18, 12);
  }
  const showGameOverlay = !onlineGameBlocked &&
    !(typeof onlineMatchFlowVisible === 'function' && onlineMatchFlowVisible());
  if (paused && showGameOverlay) {
    drawOverlay();
    ctx.fillStyle = "#fff";
    if (hasResumeCountdown()) {
      const countdownNumber = Math.max(1, Math.ceil(resumeCountdownRemainingMs() / 1000));
      drawText(String(countdownNumber), W / 2, H / 2 - 58, 64);
    } else {
      drawText("PAUSED", W / 2, H / 2 - 100, 24);
    }
  } else if (showGameOverlay && (waitingForServe || gameOver || levelCleared || campaignCleared)) {
    drawOverlay();
  }
  ctx.restore();
}
