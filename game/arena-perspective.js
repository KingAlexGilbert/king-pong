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

function multiplayerVictoryText() {
  // Scores stay in host world coordinates even when the guest's view is mirrored.
  const won = lanRole === 'host' ? left.score > right.score : right.score > left.score;
  return won ? 'YOU WON!' : 'YOU LOST!';
}

function arenaResultMessage(message) {
  if (mode === 2 && isLanActive() &&
      (message === 'Left player wins the match. Space to play again.' ||
       message === 'Right player wins the match. Space to play again.')) return multiplayerVictoryText();
  return message;
}
