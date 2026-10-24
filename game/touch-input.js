function setTouchInputActive() {
  if (!touchInputActive) {
    touchInputActive = true;
    updateControlHint();
  }
}

function canvasPointFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = W / Math.max(1, rect.width);
  const scaleY = H / Math.max(1, rect.height);
  return {
    x: clamp((clientX - rect.left) * scaleX, 0, W),
    y: clamp((clientY - rect.top) * scaleY, 0, H)
  };
}

function sideForTouchPoint(point) {
  if (isLanGuestActive()) {
    return "right";
  }
  if (isLanHostActive()) {
    return "left";
  }
  if (mode === 2) {
    return point.x >= W / 2 ? "right" : "left";
  }
  return "left";
}

function paddleForTouchSide(side) {
  return side === "right" ? right : left;
}

function touchTravelDistance(touch) {
  return Math.hypot((touch.endClientX ?? touch.startClientX) - touch.startClientX, (touch.endClientY ?? touch
    .startClientY) - touch.startClientY);
}

function beginTwoFingerTapCandidate() {
  if (activeTouchPointers.size > 2) {
    if (twoFingerTapCandidate) twoFingerTapCandidate.valid = false;
    return;
  }
  if (activeTouchPointers.size !== 2) return;
  const touches = Array.from(activeTouchPointers.entries());
  const startGap = Math.abs(touches[0][1].startTime - touches[1][1].startTime);
  const bothStationary = touches.every(([, touch]) => touchTravelDistance(touch) <= TWO_FINGER_TAP_MAX_MOVEMENT_PX);
  if (startGap > TWO_FINGER_TAP_MAX_START_GAP_MS || !bothStationary) {
    twoFingerTapCandidate = null;
    return;
  }
  twoFingerTapCandidate = {
    startedAt: Math.max(touches[0][1].startTime, touches[1][1].startTime),
    valid: true,
    released: new Set,
    pointers: new Map(touches.map(([pointerId, touch]) => [pointerId, {
      startClientX: touch.startClientX,
      startClientY: touch.startClientY,
      endClientX: touch.endClientX,
      endClientY: touch.endClientY
    }]))
  };
}

function updateTwoFingerTapCandidate(pointerId, clientX, clientY) {
  if (!twoFingerTapCandidate || !twoFingerTapCandidate.pointers.has(pointerId)) return;
  const pointer = twoFingerTapCandidate.pointers.get(pointerId);
  pointer.endClientX = clientX;
  pointer.endClientY = clientY;
  const distance = Math.hypot(clientX - pointer.startClientX, clientY - pointer.startClientY);
  if (distance > TWO_FINGER_TAP_MAX_MOVEMENT_PX) {
    twoFingerTapCandidate.valid = false;
  }
}

function finishTwoFingerTapPointer(pointerId, clientX, clientY) {
  if (!twoFingerTapCandidate || !twoFingerTapCandidate.pointers.has(pointerId)) return false;
  updateTwoFingerTapCandidate(pointerId, clientX, clientY);
  twoFingerTapCandidate.released.add(pointerId);
  if (twoFingerTapCandidate.released.size === twoFingerTapCandidate.pointers.size) {
    const now = performance.now();
    const shouldToggle = twoFingerTapCandidate.valid && now - twoFingerTapCandidate.startedAt <=
      TWO_FINGER_TAP_MAX_DURATION_MS && now - recentTwoFingerPauseAt > 550;
    twoFingerTapCandidate = null;
    if (shouldToggle) {
      recentTwoFingerPauseAt = now;
      requestTogglePause();
    }
  }
  return true;
}

function cancelTwoFingerTapPointer(pointerId) {
  if (!twoFingerTapCandidate || !twoFingerTapCandidate.pointers.has(pointerId)) return;
  twoFingerTapCandidate.valid = false;
  twoFingerTapCandidate.released.add(pointerId);
  if (twoFingerTapCandidate.released.size === twoFingerTapCandidate.pointers.size) {
    twoFingerTapCandidate = null;
  }
}

function refreshTouchPaddleTargets() {
  touchPaddleTargets.left = null;
  touchPaddleTargets.right = null;
  if (paused) {
    for (const touch of activeTouchPointers.values()) {
      const paddle = paddleForTouchSide(touch.side);
      touch.startGameY = touch.y;
      touch.startPaddleY = paddle ? paddle.y : touch.y - PADDLE_H / 2;
    }
    return;
  }
  for (const touch of activeTouchPointers.values()) {
    const deltaY = touch.y - touch.startGameY;
    const targetY = touch.startPaddleY + deltaY * TOUCH_DRAG_GAIN;
    touchPaddleTargets[touch.side] = clamp(targetY, 0, H - PADDLE_H);
  }
}

function shouldServeFromTouchTap(touch) {
  const dx = touch.endClientX - touch.startClientX;
  const dy = touch.endClientY - touch.startClientY;
  const distance = Math.hypot(dx, dy);
  const elapsed = performance.now() - touch.startTime;
  return distance < 16 && elapsed < 330 && (waitingForServe || levelCleared || campaignCleared || gameOver);
}

function handleCanvasPointerDown(e) {
  if (creditsActive) return;
  if (e.pointerType !== "touch" && e.pointerType !== "pen") {
    return;
  }
  e.preventDefault();
  setTouchInputActive();
  const point = canvasPointFromClient(e.clientX, e.clientY);
  const touchSide = sideForTouchPoint(point);
  const touchPaddle = paddleForTouchSide(touchSide);
  activeTouchPointers.set(e.pointerId, {
    side: touchSide,
    x: point.x,
    y: point.y,
    startGameY: point.y,
    startPaddleY: touchPaddle ? touchPaddle.y : point.y - PADDLE_H / 2,
    startClientX: e.clientX,
    startClientY: e.clientY,
    endClientX: e.clientX,
    endClientY: e.clientY,
    startTime: performance.now()
  });
  beginTwoFingerTapCandidate();
  refreshTouchPaddleTargets();
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {}
}

function handleCanvasPointerMove(e) {
  if (!activeTouchPointers.has(e.pointerId)) {
    return;
  }
  e.preventDefault();
  const point = canvasPointFromClient(e.clientX, e.clientY);
  const touch = activeTouchPointers.get(e.pointerId);
  touch.x = point.x;
  touch.y = point.y;
  touch.endClientX = e.clientX;
  touch.endClientY = e.clientY;
  updateTwoFingerTapCandidate(e.pointerId, e.clientX, e.clientY);
  refreshTouchPaddleTargets();
}

function handleCanvasPointerUp(e) {
  if (!activeTouchPointers.has(e.pointerId)) {
    return;
  }
  e.preventDefault();
  const touch = activeTouchPointers.get(e.pointerId);
  touch.endClientX = e.clientX;
  touch.endClientY = e.clientY;
  const consumedByTwoFingerTap = finishTwoFingerTapPointer(e.pointerId, e.clientX, e.clientY);
  activeTouchPointers.delete(e.pointerId);
  refreshTouchPaddleTargets();
  if (!consumedByTwoFingerTap && shouldServeFromTouchTap(touch)) {
    requestServeOrContinue();
  }
}

function handleCanvasPointerCancel(e) {
  if (!activeTouchPointers.has(e.pointerId)) {
    return;
  }
  cancelTwoFingerTapPointer(e.pointerId);
  activeTouchPointers.delete(e.pointerId);
  refreshTouchPaddleTargets();
}
