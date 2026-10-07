import vm from 'node:vm';
import {
  readFileSync
} from 'node:fs';
import {
  root,
  source,
  functionSource
} from './game-source.mjs';

// Execute production routing, scheduling, settings and save functions with an observable audio graph.
export function audioHarness(platform, initial = new Map()) {
  const html = source(platform),
    data = new Map(initial),
    timers = new Map(),
    oscillators = [],
    gains = [];
  let timerId = 0;
  const parameter = value => ({
    value,
    events: [],
    setValueAtTime(value, time) { this.events.push(['set', value, time]); },
    linearRampToValueAtTime(value, time) { this.events.push(['linear', value, time]); },
    exponentialRampToValueAtTime(value, time) { this.events.push(['exponential', value, time]); },
    cancelScheduledValues(time) {
      this.events = this.events.filter(event => event[2] < time);
    }
  });
  class AudioContext {
    state = 'running';
    currentTime = 1;
    destination = {
      output: true
    };
    createGain() {
      const gain = {
        gain: parameter(1),
        connect(to) {
          this.to = to;
        },
        disconnect() {}
      };
      gains.push(gain);
      return gain;
    }
    createOscillator() {
      const osc = {
        frequency: parameter(0),
        connect(to) {
          this.to = to;
        },
        disconnect() {},
        start(at) {
          this.started = true;
          this.startedAt = at;
        },
        stop(at) {
          if (at === undefined) this.stopped = true;
          this.stopAt = at;
        },
        addEventListener() {}
      };
      oscillators.push(osc);
      return osc;
    }
  }
  const context = vm.createContext({
    AudioContext,
    localStorage: {
      getItem: key => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value)
    },
    setTimeout: (fn, delay) => {
      const id = ++timerId;
      timers.set(id, {
        fn,
        delay
      });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    document: {
      hidden: false,
      getElementById: () => null
    },
    setLocalizedText(el, value) {
      el.textContent = value;
    },
    setLocalizedTitle() {},
    renderSaveSlots() {},
    populateCustomLevelSelect() {},
    updateModeControls() {},
    updateHud() {},
    setCustomCpuIntel() {},
    setCustomCpuMaxMove() {},
    isBossUnlocked() {
      return false;
    },
    stopMusicAudioKeepAlive() {}
  });
  const run = code => vm.runInContext(code, context);
  const functions = ['clamp', 'finiteNumber', 'ensureAudioContext', 'beep', 'playScoreTone', 'playMusicTone',
    'scheduleMusicLoop', 'stopActiveMusicTones', 'setMusicEnabled', 'setMusicVolume', 'updateMusicButton',
    'createDefaultSaveData', 'normalizeSaveData', 'saveSlotKey', 'rememberSaveSlot', 'readSaveSlot', 'writeSaveSlot',
    'loadSaveSlot', 'saveProgressNow'
  ];
  if (html.includes('function updateMusicAudioKeepAlive(')) functions.push('updateMusicAudioKeepAlive',
    'stopMusicAudioKeepAlive');
  if (platform !== 'Browser') functions.push('checkedSaveSlot');
  run(`const window=globalThis;
    const TOTAL_LEVELS=18,SAVE_SLOT_COUNT=3,SAVE_STORAGE_PREFIX='save',ACTIVE_SAVE_SLOT_KEY='active';
    const MUSIC_SCHEDULER_LOOKAHEAD_SECONDS=.1,MUSIC_SCHEDULER_MIN_DELAY_MS=20;
    let musicAudioKeepAliveOscillator=null,musicAudioKeepAliveGain=null;
    let audioCtx=null,musicEnabled=true,musicVolumeLevel=.75,musicTimer=null,musicNextStepTime=0,steps=0;
    let activeSaveSlot=0,saveData=null,loadingSaveSlot=false,saveImportRecoveryBlocked=false,saveConfirmation=null;
    let customCpuIntel=50,customCpuMaxMove=4.4;
    const activeMusicOscillators=new Set(),musicVolumeSlider={},musicVolumeValue={},musicButton={setAttribute(){}};
    function playMusicStep(){steps++} function currentMusicIntervalMs(){return 100}
    ${readFileSync(new URL('game/royal-audio.js', root), 'utf8')}
    ${functions.map(name => functionSource(html, name)).join('\n')}
  `);
  return {
    run,
    data,
    timers,
    oscillators,
    gains,
    json: code => JSON.parse(JSON.stringify(run(code)))
  };
}
