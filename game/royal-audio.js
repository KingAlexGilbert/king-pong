// Route every game sound through separate music/SFX buses. Master mute never changes preferences.
const gameAudioBuses = new WeakMap();
const activeGameSounds = new Set();
let gameAudioEpoch = 0;

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
