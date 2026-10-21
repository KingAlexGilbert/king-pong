// A replay is a normal campaign encounter with a different return destination.
// This context is deliberately transient; existing save progression owns unlocks.
let levelSelectEncounter = null;

function isLevelSelectEncounter() {
  return Boolean(levelSelectEncounter && mode === 1 &&
    levelSelectEncounter.slot === activeSaveSlot && levelSelectEncounter.index === selectedAbsoluteLevelIndex());
}

function canSelectCampaignLevel(index) {
  return Number.isSafeInteger(index) && index >= 0 && index < TOTAL_LEVELS && isCampaignLevelUnlocked(index);
}

function openLevelSelect() {
  const previous = isLevelSelectEncounter() ? levelSelectEncounter.index : firstUnlockedCampaignIndex();
  showTitleScreen();
  galleryKind = 'level';
  galleryResumePlay = false;
  selectionReturnFocus = byId('titleLevelSelectButton');
  setLocalizedText(byId('royalGalleryTitle'), 'Level Select');
  setLocalizedText(byId('royalGalleryClose'), 'Back');
  const list = byId('royalGalleryList');
  list.replaceChildren();
  // The secret boss remains in its existing, separately unlocked title mode.
  for (const entry of arenaCatalog.filter(entry => entry.id < TOTAL_LEVELS)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'royal-choice';
    button.dataset.choiceId = String(entry.id);
    button.disabled = !canSelectCampaignLevel(entry.id);
    button.setAttribute('aria-pressed', String(entry.id === previous));
    const number = document.createElement('small');
    number.textContent = localizeText('Level') + ' ' + String(entry.id + 1).padStart(2, '0');
    const name = document.createElement('span');
    setLocalizedText(name, entry.level.name);
    const badge = document.createElement('small');
    setLocalizedText(badge, button.disabled ? 'Locked' : saveData?.completedLevels[entry.id] ? 'Completed' : 'Unlocked');
    button.append(number, arenaThumbnail(entry), name, badge);
    button.addEventListener('click', () => startLevelSelectEncounter(entry.id));
    list.append(button);
  }
  byId('royalGallery').hidden = false;
  syncRoyalUi(true);
  (list.querySelector('[aria-pressed="true"]:not(:disabled)') || list.querySelector('button:not(:disabled)')).focus();
}

function startLevelSelectEncounter(index) {
  // Recheck the active slot at activation, not just when the gallery was drawn.
  if (!canSelectCampaignLevel(index)) return false;
  closeRoyalGallery();
  closeLanConnection(false);
  requestRoyalLandscape();
  mode = 1;
  levelSelectEncounter = {index, slot: activeSaveSlot};
  hideTitleScreen();
  setLevelByAbsoluteIndex(index, true);
  autoHideMenusForGameplay();
  return true;
}

function returnFromCampaignEncounter() {
  if (isLevelSelectEncounter()) openLevelSelect();
  else showTitleScreen();
}
