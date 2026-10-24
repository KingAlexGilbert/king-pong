import assert from 'node:assert/strict';
import test from 'node:test';
import {builds} from './helpers/game-source.mjs';
import {harness} from './helpers/royal-harness.mjs';

for (const platform of Object.keys(builds)) {
  test(platform + ': all campaign profiles stay fixed while Custom Game choices persist', () => {
    const h = harness(platform);
    h.run('saveData.highestUnlockedLevel=17;saveData.completedLevels.fill(true);saveData.bossUnlocked=true;');
    for (const choice of ['classic', 'player-2', 'enemy-17']) {
      h.run("saveData.royalPaddle='" + choice + "';");
      assert.equal(h.run('validPaddleId(saveData.royalPaddle)'), true);
      for (let index = 0; index < 18; index++) {
        h.run('mode=1;activeCampaign=' + Math.floor(index / 6) + ';levelIndex=' + index % 6 + ';');
        assert.equal(h.run('activePaddleProfile(left) === PLAYER_PADDLE_PROFILES[' + index + ']'), true,
          'level ' + (index + 1) + ', saved ' + choice + ': player');
        assert.equal(h.run('activePaddleProfile(right) === ENEMY_PADDLE_PROFILES[' + index + ']'), true,
          'level ' + (index + 1) + ': CPU');
        assert.equal(h.run('saveData.royalPaddle'), choice);
      }
      h.run('mode=3;');
      assert.equal(h.run('activePaddleProfile(left) === selectedPaddleProfile(left)'), true);
      assert.equal(h.run('saveData.royalPaddle'), choice);
      h.run('mode=4;bossAdaptiveProfile=BOSS_ADAPTIVE_PROFILES[2];');
      assert.equal(h.run('activePaddleProfile(left) === DEFAULT_PADDLE_PROFILE'), true);
      assert.equal(h.run('activePaddleProfile(right) === bossAdaptiveProfile'), true);
    }
  });
}
