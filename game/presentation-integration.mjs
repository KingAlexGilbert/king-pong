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
  return source;
}
