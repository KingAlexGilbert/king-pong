import {readFileSync} from 'node:fs';

// Plain scripts stay at their original initialization points in each shell.
export const sharedSections = [
  'paddle-profiles', 'campaign-data', 'cpu-config', 'paddle-geometry',
  'cpu-tracking', 'hazard-motion', 'rally-ramp', 'gamepad-input', 'touch-input'
];
export function sectionMarkers(name) {
  return ['// BEGIN SHARED ' + name.toUpperCase(), '// END SHARED ' + name.toUpperCase()];
}
export function replaceSharedSection(source, name, content) {
  const [begin, end] = sectionMarkers(name);
  const start = source.indexOf(begin), finish = source.indexOf(end);
  if (start < 0 || finish < start + begin.length ||
      source.indexOf(begin, start + begin.length) !== -1 ||
      source.indexOf(end, finish + end.length) !== -1) {
    throw new Error('Missing, reordered or duplicate shared section: ' + name);
  }
  return source.slice(0, start) + begin + '\n' + content + end + source.slice(finish + end.length);
}
export function integrateSharedSections(source) {
  for (const name of sharedSections) {
    source = replaceSharedSection(source, name,
      readFileSync(new URL('../game/' + name + '.js', import.meta.url), 'utf8'));
  }
  return source;
}
