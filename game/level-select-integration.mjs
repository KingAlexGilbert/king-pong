import {functionRange} from './ui-integration.mjs';

export function integrateLevelSelect(source) {
  const edit = (name, before, after) => {
    const [start, end] = functionRange(source, name);
    const body = source.slice(start, end);
    if (body.includes(after)) return;
    if (!body.includes(before)) throw new Error('Missing Level Select hook: ' + name);
    source = source.slice(0, start) + body.replace(before, after) + source.slice(end);
  };
  edit('setCampaign', '  const campaignIndex =', '  levelSelectEncounter = null;\n  const campaignIndex =');
  edit('markCampaignLevelCompleted', '  saveData.completedLevels[absoluteIndex] = true;', `  // Replays of completed/earlier encounters cannot award progression again.
  if (levelSelectEncounter && (levelSelectEncounter.slot !== activeSaveSlot ||
      levelSelectEncounter.index !== absoluteIndex || absoluteIndex !== saveData.highestUnlockedLevel ||
      saveData.completedLevels[absoluteIndex])) return;
  saveData.completedLevels[absoluteIndex] = true;`);
  edit('pointForPlayer', '      markCampaignLevelCompleted(clearedAbsoluteIndex);', `      markCampaignLevelCompleted(clearedAbsoluteIndex);
      if (isLevelSelectEncounter()) {
        levelCleared = waitingForServe = true;
        endMessage = currentLevel().name;
        updateHud();
        return;
      }`);
  edit('advanceLevel', '  const nextAbsoluteIndex =',
    '  if (isLevelSelectEncounter()) { openLevelSelect(); return; }\n  const nextAbsoluteIndex =');
  const next = source.includes('"TAP: next level"') ? 'TAP: next level' : 'SPACE: next level';
  const back = next.startsWith('TAP:') ? 'TAP: Level Select' : 'SPACE / TAP / A: Level Select';
  edit('drawOverlay', `    drawText("${next}", W / 2, H / 2 + 38, 14);`,
    `    drawText(isLevelSelectEncounter() ? "${back}" : "${next}", W / 2, H / 2 + 38, 14);`);
  const before = 'titleJumpButton.addEventListener("click", () => {\n  showTitleScreen();\n});';
  const after = 'titleJumpButton.addEventListener("click", () => {\n  returnFromCampaignEncounter();\n});';
  if (!source.includes(after)) {
    if (!source.includes(before)) throw new Error('Missing Level Select Back hook');
    source = source.replace(before, after);
  }
  return source;
}
