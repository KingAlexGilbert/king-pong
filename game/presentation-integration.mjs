import {readFileSync} from 'node:fs';
import {functionRange} from './ui-integration.mjs';

export function integrateMultiplayerPresentation(source) {
  const draw = readFileSync(new URL('./arena-render.js', import.meta.url), 'utf8');
  const [start, end] = functionRange(source, 'draw');
  source = source.slice(0, start) + draw.slice(draw.indexOf('function draw(')).trimEnd() + source.slice(end);
  const [infoStart, infoEnd] = functionRange(source, 'togglePlayInfo');
  source = source.slice(0, infoStart) + `function togglePlayInfo() {
  setPlayInfoVisible(!playInfoVisible);
  savePlayerPreference('playInfoVisible', playInfoVisible);
}` + source.slice(infoEnd);
  source = source.replace('setPlayInfoVisible(true);', "setPlayInfoVisible(playerPreference('playInfoVisible'));");
  const [overlayStart, overlayEnd] = functionRange(source, 'drawOverlay');
  source = source.slice(0, overlayStart) + source.slice(overlayStart, overlayEnd).replaceAll('drawText(endMessage,', 'drawText(arenaResultMessage(endMessage),') + source.slice(overlayEnd);
  const [bossStart, bossEnd] = functionRange(source, 'drawBossHud');
  source = source.slice(0, bossStart) + source.slice(bossStart, bossEnd).replace(
    /\s*ctx\.fillStyle = "rgba\(255, 255, 255, 0\.72\)";\s*drawText\(`SECRET BOSS - \$\{BOSS_LEVEL\.name\}`, W \/ 2, 62, 12\);/, '') + source.slice(bossEnd);
  return source;
}
