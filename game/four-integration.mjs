import {functionRange} from './ui-integration.mjs';

export function integrateFour(source) {
  source = source.replace('if (fourView?.active)', "if (typeof fourView !== 'undefined' && fourView?.active)");
  const insert = (before, after) => {
    if (source.includes(after)) return;
    if (!source.includes(before)) throw new Error('Missing four-player hook: ' + before.slice(0, 70));
    source = source.replace(before, after);
  };
  insert('function loop(timestamp) {\n  requestAnimationFrame(loop);',
    'function loop(timestamp) {\n  requestAnimationFrame(loop);\n  if (typeof fourView !== \'undefined\' && fourView?.active) { fourView.frame(timestamp); return; }');
  // Rotate only world presentation. HUD, menu/result text and scoring stay upright.
  const [start, end] = functionRange(source, 'draw');
  let draw = source.slice(start, end);
  if (!draw.includes('/* FOUR PERSPECTIVE */')) {
    draw = draw.replace('  drawBackground();', `  /* FOUR PERSPECTIVE */
  const rotateWorld = twoPlayerViewRotated();
  const worldStart = () => { ctx.save(); if (rotateWorld) { ctx.translate(W, H); ctx.rotate(Math.PI); } };
  worldStart();
  drawBackground();`);
    draw = draw.replace('  drawRoyalEffects(view);', '  drawRoyalEffects(view);\n  ctx.restore();');
    draw = draw.replace('  drawPaddleShape(view.left,', '  worldStart();\n  drawPaddleShape(view.left,');
    draw = draw.replace('  if (menusVisible &&', '  ctx.restore();\n  if (menusVisible &&');
    draw = draw.replace('drawMultiplayerScore(view.left.score,', 'drawMultiplayerScore(rotateWorld ? view.right.score : view.left.score,')
      .replace('drawMultiplayerScore(view.right.score,', 'drawMultiplayerScore(rotateWorld ? view.left.score : view.right.score,');
    source = source.slice(0, start) + draw + source.slice(end);
  }
  return source;
}
