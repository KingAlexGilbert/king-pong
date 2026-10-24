import { functionRange, synchronizeHooks } from './ui-integration.mjs';

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
  sendLanState: ["sendMatchRules();", "rules: matchRulePayload(false),"],
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
  // Only a confirmed paddle contact consumes the duplicate; misses can still score.
  hitPaddle: [`
    // A paddle return ends serve acceleration, while the spawn ripple continues.
    if (ball !== royalSplitBall) rallyLaunchTargetSpeed = 0;
    if (ball === royalSplitBall) royalSplitBall = null;
  `],
  pointForPlayer: ["if (isLanGuestActive() || mode === 2 && (waitingForServe || paused || gameOver || pointServeCountdownActive())) return;"],
  pointForCpu: ["if (isLanGuestActive() || mode === 2 && (waitingForServe || paused || gameOver || pointServeCountdownActive())) return;"],

};

export function integrateRoyalPolish(source) {
  for (const [name, code] of [['toggleMusic', `function toggleMusic() {
  if (saveData?.muteAll) return;
  setMusicEnabled(!musicEnabled);
}`], ['drawBossRallySpawnPulses', `function drawBossRallySpawnPulses() {
  const color = currentCampaign().accent;
  for (const bossBall of bossBalls) {
    drawSpawnRippleAt(bossBall.rallySpawnPulseX, bossBall.rallySpawnPulseY,
      Number(bossBall.rallyLaunchFramesRemaining) || 0, color);
  }
}`], ['drawBackground', backgroundDraw], ['drawRallySpawnPulse', `function drawRallySpawnPulse(view = captureVisualState()) {
  if (view.launch.remaining <= 0 || mode === 4) return;
  drawSpawnRipple(view.launch, currentCampaign().accent);
}`]]) {
    const [start, end] = functionRange(source, name);
    source = source.slice(0, start) + code + source.slice(end);
  }
  source = synchronizeHooks(source, 'POLISH', hooks);
  if (source.includes('function checkedSaveSlot(')) {
    // Every build validates the same optional audio preferences.
    source = synchronizeHooks(source, 'POLISH', {
      checkedSaveSlot: [`
        for (const key of ["muteAll", "soundEffectsEnabled"]) {
          if (slot[key] !== undefined) selections[key] = boolean(key);
        }
      `],
    });
  }
  const [start, end] = functionRange(source, 'loadSaveSlot');
  if (!source.slice(start, end).includes('/* ROYAL POLISH */')) return source;
  return synchronizeHooks(source, 'POLISH', {
    loadSaveSlot: [`
      stopGameSounds();
      updateGameAudioGains();
    `],
  });
}
