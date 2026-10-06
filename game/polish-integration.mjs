import { synchronizeHooks } from './ui-integration.mjs';

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
