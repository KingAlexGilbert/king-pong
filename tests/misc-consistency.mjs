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
    assert.match(html, /function scheduleClockUpdate\(\)[\s\S]*?60\s*-\s*now\.getSeconds\(\)[\s\S]*?setTimeout\(scheduleClockUpdate/);
    assert.match(html, /aria-label",\s*localizeText\(accessibleLabel\)\)/);
  });

  test(`${platform}: music uses Web Audio look-ahead scheduling and zero volume stops work`, () => {
    assert.match(html, /new AudioContextCtor\(\{\s*latencyHint:\s*"interactive"\s*\}\)/);
    assert.match(html, /const MUSIC_SCHEDULER_LOOKAHEAD_SECONDS\s*=\s*0\.1;\s*const MUSIC_SCHEDULER_MIN_DELAY_MS\s*=\s*20;/);
    assert.match(html, /function playMusicStep\(startTime\s*=\s*null\)[\s\S]*?Number\.isFinite\(startTime\)\s*\?\s*Math\.max\(startTime,\s*activeAudio\.currentTime\s*\+\s*0\.005\)/);
    assert.match(html, /function scheduleMusicLoop\(\)\s*\{\s*musicTimer\s*=\s*null;[\s\S]*?if\s*\(!musicEnabled\s*\|\|\s*musicVolumeLevel\s*<=\s*0\s*\|\|\s*document\.hidden\)\s*\{\s*musicNextStepTime\s*=\s*0;\s*return;\s*\}[\s\S]*?const scheduleUntil\s*=\s*activeAudio\.currentTime\s*\+\s*MUSIC_SCHEDULER_LOOKAHEAD_SECONDS;[\s\S]*?playMusicStep\(stepTime\);[\s\S]*?delayUntilNextWindow[\s\S]*?Math\.max\(MUSIC_SCHEDULER_MIN_DELAY_MS,\s*delayUntilNextWindow\)/);
    assert.doesNotMatch(html, /setTimeout\(scheduleMusicLoop,\s*currentMusicIntervalMs\(\)\)/);
    assert.match(html, /function playMusicTone\([\s\S]*?if\s*\(!musicEnabled\s*\|\|\s*musicVolumeLevel\s*<=\s*0\s*\|\|\s*volume\s*<=\s*0\)\s*return;/);
    assert.match(html, /function stopActiveMusicTones\(\)[\s\S]*?activeMusicOscillators\.clear\(\)/);
    assert.match(html, /function setMusicVolume\([\s\S]*?musicVolumeLevel\s*<=\s*0[\s\S]*?clearTimeout\(musicTimer\)[\s\S]*?musicNextStepTime\s*=\s*0;\s*stopActiveMusicTones\(\)/);
  });

  test(`${platform}: save selection and localization state stay bounded and persistent`, () => {
    assert.match(html, /const ACTIVE_SAVE_SLOT_KEY\s*=\s*"pongCampaignActiveSaveSlotV1"/);
    assert.match(html, /function loadSaveSlot\(slot\)\s*\{\s*activeSaveSlot\s*=\s*[^;]+;\s*rememberSaveSlot\(activeSaveSlot\);/);
    assert.match(html, /loadSaveSlot\(rememberedSaveSlot\(\)\);\s*setLevelByAbsoluteIndex/);
    assert.match(html, /const TRANSLATION_CACHE_LIMIT\s*=\s*2048/);
    assert.match(html, /if\s*\(translationCache\.size\s*>=\s*TRANSLATION_CACHE_LIMIT\)\s*translationCache\.clear\(\)/);
    for (const language of ['es','fr','de','pt','it','nl','ja','ko','zh']) {
      assert.match(html, new RegExp(`runtimeUiTranslations\\s*=\\s*.*?"${language}"`, 's'));
    }
    assert.match(html, /batteryIndicator\.setAttribute\("aria-label",\s*localizeText\(/);
  });
}

for (const platform of ['Windows', 'Linux']) {
  test(`${platform}: desktop audio includes the dormant Linux WebKitGTK keep-alive`, () => {
    const html = sources[platform];
    assert.match(html, /function stopMusicAudioKeepAlive\(\)[\s\S]*?musicAudioKeepAliveOscillator\s*=\s*null/);
    assert.match(html, /window\.KingPongLinuxWebKitAudioKeepAlive\s*&&\s*musicEnabled\s*&&\s*musicVolumeLevel\s*>\s*0\s*&&\s*!\s*document\.hidden/);
    assert.match(html, /gain\.gain\.value\s*=\s*1e-7/);
  });
}

for (const platform of ['Windows', 'Linux', 'BrowserDemo']) {
  test(`${platform}: editable menu fields keep native keyboard focus`, () => {
    const html = sources[platform];
    assert.match(html, /function makeMenuControlsMouseAndTouchOnly\(\)\s*\{\s*prepareAccessibleMenuControls\(\);\s*\}/);
    assert.doesNotMatch(html, /control\.tabIndex\s*=\s*-1/);
    assert.match(html, /const targetIsNativeFormControl\s*=\s*e\.target instanceof HTMLInputElement\s*\|\|\s*e\.target instanceof HTMLSelectElement\s*\|\|\s*e\.target instanceof HTMLTextAreaElement;\s*if\s*\(targetIsNativeFormControl\)\s*return;/);
  });
}
