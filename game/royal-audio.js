// Route every game sound through separate music/SFX buses. Master mute never changes preferences.
const gameAudioBuses = new WeakMap();
const activeGameSounds = new Set();
let gameAudioEpoch = 0;
let gameImpactVoice = null;

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
  if (!saveData) return;
  saveData.soundEffectsEnabled = Boolean(enabled);
  stopGameSounds();
  updateGameAudioGains();
  updateAudioControls();
  saveProgressNow();
}

function updateAudioControls() {
  for (const [id, enabled] of [
      ['muteAllButton', saveData?.muteAll === true],
      ['soundEffectsButton', saveData?.soundEffectsEnabled !== false]
    ]) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.setAttribute('aria-pressed', String(enabled));
    setLocalizedText(button, enabled ? 'ON' : 'OFF');
  }
  const musicState = document.getElementById('audioMusicState');
  if (musicState) setLocalizedText(musicState, musicEnabled ? 'ON' : 'OFF');
}
