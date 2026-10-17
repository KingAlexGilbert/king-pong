// Preferences belong to the existing save slot. Only explicit local choices write
// these fields; authoritative remote settings remain temporary match state.
const PLAYER_PREFERENCE_DEFAULTS = Object.freeze({
  hostApprovalRequired: true,
  verifyPairing: false,
  originalBossMusic: true,
  showConnectionType: false,
  playInfoVisible: true,
  matchRuleId: 'classic',
  royalPowerupsEnabled: true,
  multiplayerPaddle: null,
  multiplayerPaddle2: null
});

function validPlayerPreference(key, value) {
  if (!Object.hasOwn(PLAYER_PREFERENCE_DEFAULTS, key)) return false;
  if (key === 'matchRuleId') return ['quick', 'classic', 'winTwo', 'endless'].includes(value);
  if (key.startsWith('multiplayerPaddle')) return value === null || typeof value === 'string' && /^(classic|(?:player|enemy)-(?:[2-9]|1[0-7])|boss-[0-8])$/.test(value);
  return typeof value === 'boolean';
}

function playerPreference(key) {
  const value = saveData?.[key];
  return validPlayerPreference(key, value) ? value : PLAYER_PREFERENCE_DEFAULTS[key];
}

function savePlayerPreference(key, value) {
  if (!saveData || !validPlayerPreference(key, value)) return;
  saveData[key] = value;
  saveProgressNow();
}

function restorePlayerPreferences() {
  resetMultiplayerPaddleChoices();
  matchRuleId = playerPreference('matchRuleId');
  matchPowerupsEnabled = playerPreference('royalPowerupsEnabled');
  setPlayInfoVisible(playerPreference('playInfoVisible'));
  syncPlayerPreferenceControls();
}

function syncPlayerPreferenceControls() {
  for (const [id, key] of [['onlineRequireApproval', 'hostApprovalRequired'], ['privatePairing', 'verifyPairing'], ['localPairing', 'verifyPairing'], ['twoPlayerRoute', 'showConnectionType']]) {
    const input = byId(id);
    if (input) input.checked = playerPreference(key);
  }
}
