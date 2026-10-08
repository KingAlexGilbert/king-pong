import { functionRange, synchronizeHooks } from './ui-integration.mjs';

// These helpers live outside the shared script block in the legacy shells;
// their implementations stay canonical here. Collision solvers stay unchanged.
const predictionStep = `function simulateHazardStep(sim, h) {
  // Most forecast steps miss every obstacle. Reject only definite misses before
  // copying ball state or entering the allocation-heavy collision helpers.
  if (h.type === "circle") {
    const radius = h.r + BALL_HALF;
    if (Math.abs(sim.x + BALL_HALF - h.x) >= radius ||
        Math.abs(sim.y + BALL_HALF - h.y) >= radius) return false;
  } else if (!rectsOverlapRaw(sim.x, sim.y, BALL_SIZE, BALL_SIZE, h.x, h.y, h.w, h.h)) {
    return false;
  }
  const save = {
    x: ball.x,
    y: ball.y,
    prevX: ball.prevX,
    prevY: ball.prevY,
    vx: ball.vx,
    vy: ball.vy
  };
  ball.x = sim.x;
  ball.y = sim.y;
  ball.prevX = sim.prevX;
  ball.prevY = sim.prevY;
  ball.vx = sim.vx;
  ball.vy = sim.vy;
  const hit = h.type === "circle" ? resolveCircleCollision(h, true) : resolveRectCollision(h, true);
  sim.x = ball.x;
  sim.y = ball.y;
  sim.vx = ball.vx;
  sim.vy = ball.vy;
  ball.x = save.x;
  ball.y = save.y;
  ball.prevX = save.prevX;
  ball.prevY = save.prevY;
  ball.vx = save.vx;
  ball.vy = save.vy;
  return hit;
}`;

const backgroundDraw = `function drawBackground() {
  const accent = currentCampaign().accent;
  if (canvas.width * canvas.height > ROYAL_BACKGROUND_CACHE_MAX_PIXELS) {
    // Avoid copying an entire large surface every frame. This paints the same
    // grid at the existing resolution, under the existing camera transform.
    cachedStaticBackground = null;
    paintRoyalBackground(ctx, accent);
    return;
  }
  if (!cachedStaticBackground || cachedStaticBackgroundScale !== renderScale) {
    cachedStaticBackground = document.createElement("canvas");
    cachedStaticBackground.width = canvas.width;
    cachedStaticBackground.height = canvas.height;
    cachedStaticBackgroundAccent = "";
    cachedStaticBackgroundScale = renderScale;
  }
  if (cachedStaticBackgroundAccent !== accent) {
    const bg = cachedStaticBackground.getContext("2d");
    cachedStaticBackgroundAccent = accent;
    bg.setTransform(renderScale, 0, 0, canvas.height / H, 0, 0);
    bg.imageSmoothingEnabled = false;
    paintRoyalBackground(bg, accent);
  }
  ctx.drawImage(cachedStaticBackground, 0, 0, W, H);
}`;

// Keep legacy platform shells self-contained, with identical gameplay/audio hooks.
// See README.md for the source boundary between hooks and already-integrated shell code.
const hooks = {
  beep: ["if (!gameAudioEnabled(\"sfx\")) return;", "trackGameSound(osc, gain);"],
  playScoreTone: [`
    if (!gameAudioEnabled("sfx")) return;
    const audioEpoch = gameAudioEpoch;
  `, "if (audioEpoch !== gameAudioEpoch || !gameAudioEnabled(\"sfx\")) return;", "trackGameSound(osc, gain);"],
  playMusicTone: ["if (!gameAudioEnabled(\"music\")) return;"],
  scheduleMusicLoop: [`
    if (!gameAudioEnabled("music")) {
      musicNextStepTime = 0;
      return;
    }
  `],
  updateMusicButton: ["updateAudioControls();"],
  setMusicEnabled: ["updateGameAudioGains();"],
  lanSend: ["payload.matchRules = \"presets\";"],
  handleLanHostMessage: ["if (!validLanInput(message)) return;"],
  handleLanGuestMessage: [`
    if (message.type === "rules") {
      receiveMatchRules(message.rules);
      return;
    }
  `, "if (!validLanSnapshot(message) || !validMatchRuleState(message.rules) || !validMatchScores(message)) return;",
    "applyMatchRuleState(message.rules);"
  ],
  sendLanState: ["sendMatchRules();", "rules: matchRulePayload(),"],
  setMusicVolume: ["updateGameAudioGains();"],
  createDefaultSaveData: [`
    muteAll: false,
    soundEffectsEnabled: true,
  `],
  normalizeSaveData: [`
    muteAll: source.muteAll === true,
    soundEffectsEnabled: typeof source.soundEffectsEnabled === "boolean" ? source.soundEffectsEnabled : true,
  `],
  resetBall: ["seedVisualHistory();"],
  serveOrContinue: ["seedVisualHistory();"],
  normalizeBallVelocity: [`
    minSpeed *= royalBallSpeedScale();
    maxSpeed *= royalBallSpeedScale();
  `],
  // Only a confirmed paddle contact consumes the duplicate; misses can still score.
  hitPaddle: ["if (ball === royalSplitBall) royalSplitBall = null;"],
  pointForPlayer: ["if (isLanGuestActive()) return;"],
  pointForCpu: ["if (isLanGuestActive()) return;"],
  predictBallCenterForCPU: ["if (arrival) arrival.frames = Infinity;",
    "if (arrival) arrival.frames = Math.max(0, (right.x - ball.x - BALL_HALF) / ball.vx);",
    "if (arrival) arrival.frames = i + 1;"
  ],
  updateCPU: ["const aim = royalCpuAim(cfg);"],
};

export function integrateRoyalPolish(source) {
  for (const [name, code] of [['simulateHazardStep', predictionStep], ['drawBackground', backgroundDraw]]) {
    const [start, end] = functionRange(source, name);
    source = source.slice(0, start) + code + source.slice(end);
  }
  source = synchronizeHooks(source, 'POLISH', hooks);
  if (source.includes('function checkedSaveSlot(')) {
    // Native shells load audio preferences through their existing setters.
    return synchronizeHooks(source, 'POLISH', {
      checkedSaveSlot: [`
        for (const key of ["muteAll", "soundEffectsEnabled"]) {
          if (slot[key] !== undefined) selections[key] = boolean(key);
        }
      `],
    });
  }
  return synchronizeHooks(source, 'POLISH', {
    loadSaveSlot: [`
      stopGameSounds();
      updateGameAudioGains();
    `],
  });
}
