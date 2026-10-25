// Online-only adapters retain the existing browser reconciliation and reliable control channel.
function onlineLanSend(payload) {
  payload.gameplay = "royal";
  /* ROYAL POLISH */
  payload.matchRules = "presets";
  /* END ROYAL POLISH */
  if (payload.type !== 'net-format') negotiateOnlineWire();
  if (onlineRematchReady && ['state', 'input', 'action'].includes(payload.type)) payload.round = multiplayerRematch().round;
  const channel = (payload.type === "rematch" || payload.type === "action" || payload.type === "selection" || payload.type === "rules" || payload.type === "match-setup" || payload.type === "net-format") ?
    onlineControlChannel : lanChannel;
  if (!channel || channel.readyState !== "open") return false;
  try {
    if (channel.bufferedAmount > 65536) return false;
    channel.send(JSON.stringify(onlineWireReady && ['state', 'input'].includes(payload.type) ? encodeOnlineWire(payload) : payload));
    return true;
  } catch {
    if (onlineSession) onlineSession.fail("connection_lost");
    return false;
  }
}

function onlineSendLanInput(gamepads = null, force = false) {
  if (lanRole !== "guest" || !lanChannel || lanChannel.readyState !== "open") return;
  const localInput = readLocalLanInput(gamepads);
  const now = performance.now();
  // Match snapshot precision (0.01 px), well below a rendered pixel. Keep the
  // prediction history at its original precision for existing reconciliation.
  // Upgraded peers send a destination/axis intent. Older peers keep position reconciliation.
  const targetY = onlineIntentReady ? localInput.targetY : onlineHasState && !paused ? Math.round(right.y * 100) / 100 : localInput.targetY;
  const changed = !onlineLastInput || localInput.axis !== onlineLastInput.axis || targetY !== onlineLastInput.targetY;
  // Keep the legacy packet cadence when the peer cannot negotiate compact input.
  const urgent = !onlineLastInput || localInput.axis !== onlineLastInput.axis || onlineWireReady && changed;
  const acknowledged = onlineLastInput && onlineInputAck >= onlineLastInput.proofSeq;
  // Changes are sent on this physics tick. Unacknowledged releases/targets keep
  // retrying at the original 30 Hz; only confirmed idle input uses a 250 ms lease.
  const idle = !changed && localInput.axis === 0 && acknowledged;
  if (!force && !urgent && (idle ? now - onlineLastInput.at < 250 : frame % 2 !== 0)) return;
  const seq = ++lanInputSeq;
  onlineInput(localInput, seq);
  if (lanSend({v: LAN_SIGNAL_VERSION, type: "input", room: lanRoomCode, seq,
      axis: localInput.axis, targetY})) {
    onlineLastSentAxis = localInput.axis;
    onlineLastInput = {axis: localInput.axis, targetY, seq, at: now,
      proofSeq: changed ? seq : onlineLastInput.proofSeq};
  } else onlineInputs.delete(seq);

}

function onlineApplyLanHostState(state) {
  if (Number.isSafeInteger(state.inputSeq)) onlineInputAck = Math.max(onlineInputAck, state.inputSeq);
  const previousArena = matchArenaId;
  applySelectionState(state.selection);
  const campaignIndex = clamp(Math.round(Number(state.activeCampaign) || 0), 0, CAMPAIGNS.length - 1);
  const levelInCampaign = clamp(Math.round(Number(state.levelIndex) || 0), 0, CAMPAIGNS[campaignIndex].levels.length -
    1);
  const levelChanged = previousArena !== matchArenaId || mode !== 2 || activeCampaign !== campaignIndex ||
    levelIndex !== levelInCampaign;
  mode = 2;
  if (levelChanged) {
    activeCampaign = campaignIndex;
    levelIndex = levelInCampaign;
    cloneHazards();
    setAccent();
    populateCustomLevelSelect();
    syncCustomLevelSelectToCurrent();
  }
  left.y = clamp(finiteNumber(state.leftY, left.y), visiblePlayfieldBounds().top, visiblePlayfieldBounds().bottom -
    PADDLE_H);
  right.y = clamp(onlinePaddleState(state, levelChanged), visiblePlayfieldBounds().top, visiblePlayfieldBounds()
    .bottom - PADDLE_H);
  left.score = clamp(Math.round(Number(state.leftScore) || 0), 0, MATCH_SCORE_MAX);
  right.score = clamp(Math.round(Number(state.rightScore) || 0), 0, MATCH_SCORE_MAX);
  if (state.ball && typeof state.ball === "object") {
    ball.prevX = ball.x;
    ball.prevY = ball.y;
    ball.x = clamp(finiteNumber(state.ball.x, ball.x), -BALL_SIZE * 2, W + BALL_SIZE * 2);
    ball.y = clamp(finiteNumber(state.ball.y, ball.y), visiblePlayfieldBounds().top, visiblePlayfieldBounds().bottom -
      BALL_SIZE);
    ball.vx = clamp(Number(state.ball.vx) || 0, -20, 20);
    ball.vy = clamp(Number(state.ball.vy) || 0, -20, 20);
    ball.lastScored = clamp(Math.round(Number(state.ball.lastScored) || 0), -1, 1);
    rallyLaunchFramesRemaining = clamp(Math.round(Number(state.ball.rallyLaunchFramesRemaining) || 0), 0,
      RALLY_LAUNCH_RAMP_FRAMES);
    rallyLaunchTargetSpeed = clamp(Number(state.ball.rallyLaunchTargetSpeed) || 0, 0, 20);
    rallySpawnPulseX = clamp(finiteNumber(state.ball.rallySpawnPulseX, ball.x + BALL_HALF), 0, W);
    rallySpawnPulseY = clamp(finiteNumber(state.ball.rallySpawnPulseY, ball.y + BALL_HALF), 0, H);
  }
  if (Array.isArray(state.hazards)) {
    state.hazards.slice(0, 128).forEach(source => {
      if (!source || typeof source !== "object") return;
      const hazard = hazards.find(item => item.id === source.id);
      if (!hazard) return;
      if (Number.isFinite(Number(source.x))) hazard.x = clamp(Number(source.x), -W, W * 2);
      if (Number.isFinite(Number(source.y))) hazard.y = clamp(Number(source.y), -H, H * 2);
      hazard.hitFlash = clamp(Math.round(Number(source.hitFlash) || 0), 0, 20);
    });
  }
  paused = Boolean(state.paused);
  const syncedResumeCountdownMs = clamp(Number(state.resumeCountdownMs) || 0, 0, RESUME_COUNTDOWN_MS);
  resumeCountdownEndAt = paused && syncedResumeCountdownMs > 0 ? performance.now() + syncedResumeCountdownMs : 0;
  waitingForServe = Boolean(state.waitingForServe);
  gameOver = Boolean(state.gameOver);
  levelCleared = Boolean(state.levelCleared);
  campaignCleared = Boolean(state.campaignCleared);
  endMessage = String(state.endMessage || "").slice(0, 180);
  applyPointServeSnapshot(state);
  if (document.body.classList.contains("title-active")) hideTitleScreen();
  if (levelChanged) {
    updateModeControls();
    updateHud();
  }
  applyRoyalState(state.royal);
  queueGuestSnapshot(state);
}

function onlineUpdatePlayerPaddles(gamepads = getConnectedGamepads()) {
  const bounds = visiblePlayfieldBounds();
  if (isLanGuestActive()) {
    const input = readLocalLanInput(gamepads);
    if (input.targetY !== null) {
      right.y = input.targetY;
    } else {
      right.y += input.axis * PADDLE_SPEED;
    }
    clampPaddleToVisiblePlayfield(left);
    clampPaddleToVisiblePlayfield(right);
    return;
  }
  const lanLocalPaddleControls = mode === 2 && (isLanHostActive() || lanRole === "host");
  const singlePlayerControls = mode !== 2 || lanLocalPaddleControls;
  const leftUp = keys.has("w") || keys.has("W") || singlePlayerControls && keys.has("ArrowUp");
  const leftDown = keys.has("s") || keys.has("S") || singlePlayerControls && keys.has("ArrowDown");
  if (leftUp) {
    left.y -= PADDLE_SPEED;
  }
  if (leftDown) {
    left.y += PADDLE_SPEED;
  }
  if (touchPaddleTargets.left !== null) {
    left.y = touchPaddleTargets.left;
  }
  if (mode === 2 && !isLanHostActive() && touchPaddleTargets.right !== null) {
    right.y = touchPaddleTargets.right;
  }
  const primaryPad = gamepads[0];
  const secondaryPad = gamepads[1];
  if (singlePlayerControls && primaryPad) {
    left.y += gamepadVertical(primaryPad, 1) * PADDLE_SPEED;
  }
  if (mode === 2) {
    if (isLanHostActive()) {
      onlineAppliedInputSeq = lanLastInputSeq;
      const remoteFresh = performance.now() - lanRemoteInput.lastAt < 1200;
      if (remoteFresh && lanRemoteInput.targetY !== null) {
        right.y = clamp(lanRemoteInput.targetY, bounds.top, bounds.bottom - PADDLE_H);
      } else if (remoteFresh) {
        right.y += lanRemoteInput.axis * PADDLE_SPEED;
      }
    } else {
      if (keys.has("ArrowUp")) {
        right.y -= PADDLE_SPEED;
      }
      if (keys.has("ArrowDown")) {
        right.y += PADDLE_SPEED;
      }
      if (primaryPad) {
        left.y += gamepadVertical(primaryPad, 1) * PADDLE_SPEED;
      }
      if (secondaryPad) {
        right.y += gamepadVertical(secondaryPad, 1) * PADDLE_SPEED;
      }
    }
  }
  clampPaddleToVisiblePlayfield(left);
  clampPaddleToVisiblePlayfield(right);
}

function onlineSendLanState(force = false) {
  if (!isLanHostActive()) return;
  if (!force && frame % LAN_STATE_EVERY_FRAMES !== 0) return;
  /* ROYAL POLISH */
  sendMatchRules();
  /* END ROYAL POLISH */
  lanSend({
    v: LAN_SIGNAL_VERSION,
    type: "state",
    room: lanRoomCode,
    seq: ++lanStateSeq,
    // Paused snapshots acknowledge receipt; reconciliation already clears prediction while paused.
    inputSeq: paused ? lanLastInputSeq : onlineAppliedInputSeq,
    tick: frame,
    selection: selectionPayload(),
    royal: packRoyalState(),
    /* ROYAL POLISH */
    rules: matchRulePayload(false),
    /* END ROYAL POLISH */
    activeCampaign,
    levelIndex,
    leftY: Math.round(left.y * 100) / 100,
    rightY: Math.round(right.y * 100) / 100,
    leftScore: left.score,
    rightScore: right.score,
    ball: {
      x: Math.round(ball.x * 100) / 100,
      y: Math.round(ball.y * 100) / 100,
      vx: Math.round(ball.vx * 100) / 100,
      vy: Math.round(ball.vy * 100) / 100,
      lastScored: ball.lastScored,
      rallyLaunchFramesRemaining,
      rallyLaunchTargetSpeed,
      rallySpawnPulseX,
      rallySpawnPulseY
    },
    hazards: serializeLanHazards(),
    paused,
    resumeCountdownMs: Math.round(resumeCountdownRemainingMs()),
    pointServeMs: pointServeSnapshotMs(),
    waitingForServe,
    gameOver,
    levelCleared,
    campaignCleared,
    endMessage: String(endMessage || "").slice(0, 180)
  });
}
