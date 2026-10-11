// Route every game sound through separate music/SFX buses. Master mute never changes preferences.
const gameAudioBuses = new WeakMap();
const activeGameSounds = new Set();
let gameAudioEpoch = 0;
let gameImpactVoice = null;
let royalPowerupVoice = null;

// Impacts share one short voice. Two balls (or a corner contact) must not add
// square waves together; leave score jingles, music and menu cues independent.
function playImpactSound(freq, duration, volume = 0.045, kind = 'collision') {
  if (!gameAudioEnabled('sfx')) return;
  try {
    const context = ensureAudioContext();
    if (!context) return;
    const now = context.currentTime;
    const previous = gameImpactVoice;
    const attack = 0.002;
    if (previous && previous.context === context && now < previous.until) {
      if (kind !== 'shield' || previous.kind === 'shield') return;
      // A shield takes precedence at a corner. Crossfade within the same gain
      // budget instead of stacking another sound or cutting a square wave off.
      const level = previous.volume * Math.max(0, Math.min(1,
        (now - previous.start) / attack, (previous.end - now) / 0.003));
      previous.gain.gain.cancelScheduledValues(now);
      previous.gain.gain.setValueAtTime(level, now);
      previous.gain.gain.linearRampToValueAtTime(0, now + attack);
      previous.oscillator.stop(now + attack);
    }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const peak = clamp(volume, 0, 0.045);
    const end = now + duration;
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(freq, now);
    if (kind === 'shield') oscillator.frequency.exponentialRampToValueAtTime(freq / 2, end);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + attack);
    gain.gain.setValueAtTime(peak, end - 0.003);
    gain.gain.linearRampToValueAtTime(0, end);
    oscillator.connect(gain);
    connectGameAudio(gain, context, 'sfx');
    trackGameSound(oscillator, gain);
    gameImpactVoice = {context, oscillator, gain, kind, volume: peak, start: now, end,
      until: now + Math.max(0.04, duration)};
    oscillator.start(now);
    oscillator.stop(end);
  } catch {}
}

function gameAudioEnabled(kind) {
  if (saveData?.muteAll === true) return false;
  return kind === 'music' ? musicEnabled && musicVolumeLevel > 0 : saveData?.soundEffectsEnabled !== false;
}

function connectGameAudio(gain, context, kind) {
  let buses = gameAudioBuses.get(context);
  if (!buses) {
    buses = {
      master: context.createGain(),
      music: context.createGain(),
      sfx: context.createGain()
    };
    buses.master.connect(context.destination);
    buses.music.connect(buses.master);
    buses.sfx.connect(buses.master);
    gameAudioBuses.set(context, buses);
  }
  updateGameAudioGains(context);
  gain.connect(buses[kind]);
}

function updateGameAudioGains(context = audioCtx) {
  const buses = context && gameAudioBuses.get(context);
  if (!buses) return;
  buses.master.gain.value = saveData?.muteAll === true ? 0 : 1;
  buses.music.gain.value = musicEnabled && musicVolumeLevel > 0 ? 1 : 0;
  buses.sfx.gain.value = saveData?.soundEffectsEnabled === false ? 0 : 1;
}

function trackGameSound(oscillator, gain) {
  activeGameSounds.add(oscillator);
  oscillator.addEventListener?.('ended', () => {
    activeGameSounds.delete(oscillator);
    try {
      oscillator.disconnect();
      gain.disconnect();
    } catch {}
  }, {
    once: true
  });
}

function stopGameSounds() {
  gameAudioEpoch++; // Delayed score jingles from the old audio/slot state must not start later.
  gameImpactVoice = null;
  royalPowerupVoice = null;
  for (const oscillator of activeGameSounds) {
    try {
      oscillator.stop();
    } catch {}
  }
  activeGameSounds.clear();
}

function setGameMuteAll(muted) {
  if (!saveData) return;
  saveData.muteAll = Boolean(muted);
  stopGameSounds();
  updateGameAudioGains();
  setMusicEnabled(musicEnabled);
}

function setSoundEffectsEnabled(enabled) {
  if (!saveData || saveData.muteAll) return;
  saveData.soundEffectsEnabled = Boolean(enabled);
  stopGameSounds();
  updateGameAudioGains();
  updateAudioControls();
  saveProgressNow();
}

function updateAudioControls() {
  const muted = saveData?.muteAll === true;
  for (const [id, enabled] of [
      ['muteAllButton', muted],
      ['musicButton', musicEnabled],
      ['soundEffectsButton', saveData?.soundEffectsEnabled !== false]
    ]) {
    const button = document.getElementById(id);
    if (!button) continue;
    const suppressed = muted && id !== 'muteAllButton';
    button.disabled = suppressed;
    button.setAttribute('aria-pressed', String(enabled && !suppressed));
    setLocalizedText(button, suppressed ? 'Muted by Mute All' : enabled ? 'ON' : 'OFF');
    setLocalizedTitle(button, suppressed ? 'Muted by Mute All' : enabled ? 'ON' : 'OFF');
  }
  const musicState = document.getElementById('audioMusicState');
  if (musicState) setLocalizedText(musicState, muted ? 'Muted by Mute All' : musicEnabled ? 'ON' : 'OFF');
}

function playRoyalPowerupSound(kind) {
  // Never resume suspended audio or retain a cue for a later user gesture.
  if (!gameAudioEnabled('sfx') || document.hidden || !audioCtx || audioCtx.state !== 'running') return;
  try {
    const context = audioCtx, now = context.currentTime;
    const old = royalPowerupVoice;
    if (old && old.context === context && now < old.end) {
      if (kind === 'spawn') return;
      const level = old.peak * Math.max(0, Math.min(1, (now - old.start) / 0.004, (old.end - now) / 0.04));
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(level, now);
      old.gain.gain.linearRampToValueAtTime(0, now + 0.004);
      old.oscillator.stop(now + 0.004);
    }
    const oscillator = context.createOscillator(), gain = context.createGain();
    const pickup = kind === 'pickup', duration = pickup ? 0.19 : 0.13, peak = pickup ? 0.035 : 0.025;
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(pickup ? 660 : 440, now);
    oscillator.frequency.setValueAtTime(pickup ? 880 : 587.33, now + 0.065);
    if (pickup) oscillator.frequency.setValueAtTime(1108.73, now + 0.12);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.004);
    gain.gain.setValueAtTime(peak, now + duration - 0.04);
    gain.gain.linearRampToValueAtTime(0, now + duration);
    oscillator.connect(gain);
    connectGameAudio(gain, context, 'sfx');
    trackGameSound(oscillator, gain);
    royalPowerupVoice = {context, oscillator, gain, start: now, end: now + duration, peak};
    oscillator.start(now);
    oscillator.stop(now + duration);
  } catch { /* Audio must never block gameplay. */ }
}

function stopRoyalPowerupSound() {
  if (!royalPowerupVoice) return;
  try { royalPowerupVoice.oscillator.stop(); } catch {}
  royalPowerupVoice = null;
}
