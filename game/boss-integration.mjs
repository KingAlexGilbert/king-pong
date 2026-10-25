import {functionRange} from './ui-integration.mjs';

// The Wall encounter always owns two persistent balls. Only the obsolete
// staged ball-count policy changes; spawn, respawn and shape adaptation stay put.
export function integrateWallBalls(source) {
  for (const name of ['BOSS_STARTING_BALLS', 'BOSS_MAX_BALLS', 'BOSS_SECOND_BALL_DELAY_FRAMES']) {
    source = source.replace(new RegExp('^const ' + name + ' = [^;]+;\\n', 'm'), '');
  }
  const [start, end] = functionRange(source, 'desiredBossBallCount');
  return source.slice(0, start) + `function desiredBossBallCount() {
  return 2;
}` + source.slice(end);
}
