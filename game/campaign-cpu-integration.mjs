import {functionRange} from './ui-integration.mjs';

// The opening opponents were steering farther off target than half their paddle
// height. Reduce that error and modestly anticipate angled shots. Movement limits,
// response smoothing, dead zones, collision geometry and later levels stay intact.
const opening = [
  {error: 36, prediction: 0.30},
  {error: 32, prediction: 0.34},
  {error: 28, prediction: 0.38}
];
export function integrateOpeningCpu(source) {
  const [start, end] = functionRange(source, 'getCpuConfig');
  let config = source.slice(start, end);
  opening.forEach((settings, index) => {
    const pattern = new RegExp(`if \\(levelNumber === ${index + 1}\\) \\{[\\s\\S]*?\\n  \\}`);
    if (!pattern.test(config)) throw Error('Missing opening CPU level ' + (index + 1));
    config = config.replace(pattern, block => block
      .replace(/prediction: [\d.]+/, 'prediction: ' + settings.prediction)
      .replace(/error: [\d.]+/, 'error: ' + settings.error));
  });
  return source.slice(0, start) + config + source.slice(end);
}
