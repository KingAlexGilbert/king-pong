// Rules are session state. Only the local match or the online host can change them.
const MATCH_RULES = Object.freeze({
  quick: {
    label: 'Quick Match — First to 5',
    goal: 5,
    lead: 1
  },
  classic: {
    label: 'Classic Match — First to 10',
    goal: 10,
    lead: 1
  },
  winTwo: {
    label: 'Win by Two — First to 10, lead by 2',
    goal: 10,
    lead: 2
  },
  endless: {
    label: 'Endless — No score limit',
    goal: null,
    lead: 0
  }
});
const MATCH_SCORE_MAX = Number.MAX_SAFE_INTEGER;
let matchRuleId = 'classic';
let matchRuleRevision = 0;
let remoteRuleRevision = -1;
let remoteRuleId = null;
let sentRuleRevision = -1;

function matchRule() {
  return MATCH_RULES[matchRuleId];
}

function matchRulePayload() {
  return {
    id: matchRuleId,
    revision: matchRuleRevision
  };
}

function validMatchRuleState(value) {
  return Boolean(value && typeof value === 'object' && typeof value.id === 'string' && Object.prototype.hasOwnProperty
    .call(MATCH_RULES, value.id) &&
    Number.isSafeInteger(value.revision) && value.revision >= 0 && value.revision >= remoteRuleRevision &&
    (value.revision !== remoteRuleRevision || value.id === remoteRuleId));
}

function validMatchScores(state) {
  return ['leftScore', 'rightScore'].every(key => Number.isSafeInteger(state[key]) && state[key] >= 0);
}

function canChooseMatchRules() {
  return mode === 2 && lanRole !== 'guest' && waitingForServe && !gameOver && left.score === 0 && right.score === 0;
}

function setMatchRule(id) {
  if (!canChooseMatchRules() || typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(MATCH_RULES, id) ||
    matchRuleRevision === Number.MAX_SAFE_INTEGER) return false;
  if (matchRuleId !== id) {
    matchRuleId = id;
    matchRuleRevision++;
  }
  sendMatchRules();
  if (typeof syncRoyalUi === 'function') syncRoyalUi(true);
  return true;
}

function sendMatchRules() {
  if (!isLanHostActive() || sentRuleRevision === matchRuleRevision) return;
  // Browser lanSend routes this message over the existing reliable control channel.
  if (lanSend({
      v: LAN_SIGNAL_VERSION,
      type: 'rules',
      room: lanRoomCode,
      rules: matchRulePayload()
    })) sentRuleRevision = matchRuleRevision;
}

function applyMatchRuleState(value) {
  remoteRuleRevision = matchRuleRevision = value.revision;
  remoteRuleId = matchRuleId = value.id;
}

function receiveMatchRules(value) {
  if (!isLanGuestActive() || !validMatchRuleState(value)) return false;
  applyMatchRuleState(value);
  if (typeof syncRoyalUi === 'function') syncRoyalUi(true);
  return true;
}

function resetMatchRuleConnection() {
  remoteRuleRevision = sentRuleRevision = -1;
  remoteRuleId = null;
  matchRuleRevision = 0; // Revisions belong to this connection; keep only the chosen preset for the next setup.
}

function multiplayerPointWins(side) {
  const rule = matchRule(),
    own = side === 'left' ? left.score : right.score,
    other = side === 'left' ? right.score : left.score;
  return rule.goal !== null && own >= rule.goal && own - other >= rule.lead;
}

function nextMatchScore(score) {
  return Math.min(MATCH_SCORE_MAX, score + 1);
}

function drawMultiplayerScore(score, center, y) {
  const text = String(score);
  // Exact safe-integer scores remain on their own half, even in a very long Endless session.
  if (text.length > 6) {
    drawText(text, center, y + 26, 12);
    return;
  }
  const scale = Math.min(4, 140 / (text.length * 12));
  const width = text.length * 12 * scale - 2 * scale;
  for (let i = 0; i < text.length; i++) drawDigit(Number(text[i]), center - width / 2 + i * 12 * scale, y, scale);
}
