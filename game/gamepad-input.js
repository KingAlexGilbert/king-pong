function getConnectedGamepads() {
  if (document.hidden || !gameWindowFocused) return [];
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
    return [];
  }
  const rawPads = navigator.getGamepads();
  const connectedPads = [];
  for (let i = 0; i < rawPads.length; i++) {
    if (rawPads[i]) {
      connectedPads.push(rawPads[i]);
    }
  }
  return connectedPads;
}

function refreshGamepadConnection(gamepads = getConnectedGamepads()) {
  const nextSignature = gamepads.map(pad => `${pad.index}:${pad.id}`).join("|");
  const nextConnected = gamepads.length > 0;
  if (nextSignature !== gamepadSignature) {
    gamepadButtonState = new Map;
    gamepadSignature = nextSignature;
  }
  if (nextConnected !== gamepadConnected) {
    gamepadConnected = nextConnected;
    updateControlHint();
  }
}

function gamepadAxis(pad, axisIndex) {
  if (!pad || !pad.axes || axisIndex >= pad.axes.length) {
    return 0;
  }
  const value = Number(pad.axes[axisIndex]) || 0;
  return Math.abs(value) >= GAMEPAD_AXIS_DEADZONE ? value : 0;
}

function gamepadButtonPressed(pad, buttonIndex) {
  return Boolean(pad && pad.buttons && pad.buttons[buttonIndex] && pad.buttons[buttonIndex].pressed);
}

function gamepadButtonJustPressed(pad, buttonIndex) {
  if (!pad) return false;
  const key = `${pad.index}:${buttonIndex}`;
  const nowPressed = gamepadButtonPressed(pad, buttonIndex);
  const wasPressed = gamepadButtonState.get(key) || false;
  gamepadButtonState.set(key, nowPressed);
  return nowPressed && !wasPressed;
}

function gamepadVertical(pad, axisIndex = 1) {
  if (!pad) return 0;
  const stick = gamepadAxis(pad, axisIndex);
  const dpad = (gamepadButtonPressed(pad, GAMEPAD_BUTTONS.DPAD_DOWN) ? 1 : 0) - (gamepadButtonPressed(pad,
    GAMEPAD_BUTTONS.DPAD_UP) ? 1 : 0);
  return clamp(stick + dpad, -1, 1);
}
