// A horizontal reflection changes presentation only. Vertical input, physics,
// snapshots and interpolation stay in world coordinates on every transport.
function twoPlayerViewMirrored() {
  return mode === 2 && isLanGuestActive();
}

function applyArenaPerspective() {
  if (!twoPlayerViewMirrored()) return;
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
}

function drawArenaLabel(text, x, y, size) {
  ctx.save();
  if (twoPlayerViewMirrored()) {
    ctx.translate(x * 2, 0);
    ctx.scale(-1, 1);
  }
  drawText(text, x, y, size);
  ctx.restore();
}

function arenaResultMessage(message) {
  if (!twoPlayerViewMirrored()) return message;
  if (message === 'Left player wins the match. Space to play again.') return 'Right player wins the match. Space to play again.';
  if (message === 'Right player wins the match. Space to play again.') return 'Left player wins the match. Space to play again.';
  return message;
}
