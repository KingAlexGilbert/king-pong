// Run with Node 18+: node --test tests/misc-consistency.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const builds = {
  Android: '../android/app/src/main/assets/index.html',
  Windows: '../windows/webview-2/index.html',
  Linux: '../Linux/assets/index.html',
  BrowserDemo: '../docs/demo/index.html',
};
const sources = Object.fromEntries(Object.entries(builds).map(([name, path]) =>
  [name, readFileSync(new URL(path, import.meta.url), 'utf8')]));

test('Windows and Linux desktop HTML stay byte-identical', () => {
  assert.ok(sources.Windows === sources.Linux, 'Windows and Linux desktop HTML must remain byte-identical.');
});


for (const [platform, html] of Object.entries(sources)) {
  test(`${platform}: scripts parse and clock follows minute boundaries`, () => {
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      new vm.Script(match[1], { filename: platform });
    }
    assert.doesNotMatch(html, /setInterval\(updateClockIndicator\s*,\s*15000\)/);
    assert.match(html, /function scheduleClockUpdate\(\)[\s\S]*?60-now\.getSeconds\(\)[\s\S]*?setTimeout\(scheduleClockUpdate/);
    assert.match(html, /aria-label",localizeText\(accessibleLabel\)\)/);
  });

  test(`${platform}: music uses Web Audio look-ahead scheduling and zero volume stops work`, () => {
    assert.match(html, /new AudioContextCtor\(\{latencyHint:"interactive"\}\)/);
    assert.match(html, /const MUSIC_SCHEDULER_LOOKAHEAD_SECONDS=0\.1;const MUSIC_SCHEDULER_MIN_DELAY_MS=20;/);
    assert.match(html, /function playMusicStep\(startTime=null\)[\s\S]*?Number\.isFinite\(startTime\)\?Math\.max\(startTime,activeAudio\.currentTime\+0\.005\)/);
    assert.match(html, /function scheduleMusicLoop\(\)\{musicTimer=null;if\(!musicEnabled\|\|musicVolumeLevel<=0\|\|document\.hidden\)\{musicNextStepTime=0;return;\}[\s\S]*?const scheduleUntil=activeAudio\.currentTime\+MUSIC_SCHEDULER_LOOKAHEAD_SECONDS;[\s\S]*?playMusicStep\(stepTime\);[\s\S]*?delayUntilNextWindow[\s\S]*?Math\.max\(MUSIC_SCHEDULER_MIN_DELAY_MS,delayUntilNextWindow\)/);
    assert.doesNotMatch(html, /setTimeout\(scheduleMusicLoop,currentMusicIntervalMs\(\)\)/);
    assert.match(html, /function playMusicTone\([\s\S]*?if\(!musicEnabled\|\|musicVolumeLevel<=0\|\|volume<=0\)return;/);
    assert.match(html, /function stopActiveMusicTones\(\)[\s\S]*?activeMusicOscillators\.clear\(\)/);
    assert.match(html, /function setMusicVolume\([\s\S]*?musicVolumeLevel<=0[\s\S]*?clearTimeout\(musicTimer\)[\s\S]*?musicNextStepTime=0;stopActiveMusicTones\(\)/);
  });

  test(`${platform}: save selection and localization state stay bounded and persistent`, () => {
    assert.match(html, /const ACTIVE_SAVE_SLOT_KEY="pongCampaignActiveSaveSlotV1"/);
    assert.match(html, /function loadSaveSlot\(slot\)\{activeSaveSlot=[^;]+;rememberSaveSlot\(activeSaveSlot\);/);
    assert.match(html, /loadSaveSlot\(rememberedSaveSlot\(\)\);setLevelByAbsoluteIndex/);
    assert.match(html, /const TRANSLATION_CACHE_LIMIT=2048/);
    assert.match(html, /if\(translationCache\.size>=TRANSLATION_CACHE_LIMIT\)translationCache\.clear\(\)/);
    for (const language of ['es','fr','de','pt','it','nl','ja','ko','zh']) {
      assert.match(html, new RegExp(`runtimeUiTranslations=.*?"${language}"`, 's'));
    }
    assert.match(html, /batteryIndicator\.setAttribute\("aria-label",\s*localizeText\(/);
  });
}

for (const platform of ['Windows', 'Linux']) {
  test(`${platform}: desktop audio includes the dormant Linux WebKitGTK keep-alive`, () => {
    const html = sources[platform];
    assert.match(html, /function stopMusicAudioKeepAlive\(\)[\s\S]*?musicAudioKeepAliveOscillator=null/);
    assert.match(html, /window\.KingPongLinuxWebKitAudioKeepAlive&&musicEnabled&&musicVolumeLevel>0&&!document\.hidden/);
    assert.match(html, /gain\.gain\.value=1e-7/);
  });
}

for (const platform of ['Windows', 'Linux', 'BrowserDemo']) {
  test(`${platform}: editable menu fields keep native keyboard focus`, () => {
    const html = sources[platform];
    assert.match(html, /function makeMenuControlsMouseAndTouchOnly\(\)\{prepareAccessibleMenuControls\(\);\}/);
    assert.doesNotMatch(html, /control\.tabIndex=-1/);
    assert.match(html, /const targetIsNativeFormControl=e\.target instanceof HTMLInputElement\|\|e\.target instanceof HTMLSelectElement\|\|e\.target instanceof HTMLTextAreaElement;if\(targetIsNativeFormControl\)return;/);
  });
}
