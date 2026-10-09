// The v1.1.3 native save-transfer implementation is also the browser implementation.
// Keep its existing UI, format, translations and recovery guards canonical here.
import { functionRange } from './ui-integration.mjs';

const styles = String.raw`.save-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 12px
}

.save-actions button {
  margin-top: 0;
  font-size: 12px;
  padding: 8px 10px;
  min-height: 36px
}

.save-transfer-status {
  margin: 8px 0 0;
  color: #ddd;
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere
}

.save-transfer-status:empty {
  display: none
}

@media(pointer:coarse) {
  .save-actions button {
    min-height: 44px
  }
}

.save-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
  background: rgba(0, 0, 0, .78);
  touch-action: pan-y
}

.save-confirm-overlay[hidden] {
  display: none
}

.save-confirm-card {
  width: min(100%, 480px);
  max-height: calc(100vh - 32px);
  overflow: auto;
  box-sizing: border-box;
  padding: 24px;
  background: #111;
  border: 2px solid var(--accent);
  box-shadow: 0 0 24px rgba(0, 0, 0, .6);
  text-align: left
}

.save-confirm-card h2 {
  margin: 0 0 14px;
  color: #fff;
  font-size: 22px;
  line-height: 1.25
}

.save-confirm-card p {
  margin: 0;
  color: #ccc;
  font-size: 14px;
  line-height: 1.55;
  overflow-wrap: anywhere
}

.save-confirm-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 22px
}

.save-confirm-actions button {
  min-height: 44px;
  min-width: 100px;
  margin: 0;
  padding: 10px 18px;
  border: 1px solid #777;
  background: #171717;
  color: #fff;
  font: inherit;
  font-size: 14px;
  cursor: pointer
}

.save-confirm-actions button:hover,
.save-confirm-actions button:focus {
  border-color: var(--accent);
  outline: 2px solid var(--accent);
  outline-offset: 2px
}

.save-confirm-actions .save-confirm-accept {
  color: var(--accent);
  border-color: var(--accent)
}

@media(max-height:360px) {
  .save-confirm-card {
    padding: 16px
  }

  .save-confirm-actions {
    margin-top: 14px
  }
}

`;

const translations = String.raw`  const saveTransferTranslations = {
    "es": {
      "Export Saves": "Exportar partidas",
      "Import Saves": "Importar partidas",
      "Save management": "Gestionar partidas",
      "Saves exported.": "Partidas exportadas.",
      "Saves imported.": "Partidas importadas.",
      "Export cancelled.": "Exportaci\u00f3n cancelada.",
      "Import cancelled.": "Importaci\u00f3n cancelada.",
      "Replace all three save slots with this backup? Empty backup slots will also replace your current slots.": "\u00bfReemplazar las tres ranuras con esta copia? Las ranuras vac\u00edas tambi\u00e9n reemplazar\u00e1n tus partidas actuales.",
      "Cancel": "Cancelar",
      "Import": "Importar",
      "Erase": "Borrar",
      "Erase Save Slot": "Borrar partida",
      "The save slot could not be erased.": "No se pudo borrar la partida."
    },
    "fr": {
      "Export Saves": "Exporter les sauvegardes",
      "Import Saves": "Importer les sauvegardes",
      "Save management": "Gestion des sauvegardes",
      "Saves exported.": "Sauvegardes export\u00e9es.",
      "Saves imported.": "Sauvegardes import\u00e9es.",
      "Export cancelled.": "Exportation annul\u00e9e.",
      "Import cancelled.": "Importation annul\u00e9e.",
      "Replace all three save slots with this backup? Empty backup slots will also replace your current slots.": "Remplacer les trois emplacements par cette sauvegarde ? Les emplacements vides remplaceront aussi vos parties actuelles.",
      "Cancel": "Annuler",
      "Import": "Importer",
      "Erase": "Effacer",
      "Erase Save Slot": "Effacer une sauvegarde",
      "The save slot could not be erased.": "Impossible d\u2019effacer la sauvegarde."
    },
    "de": {
      "Export Saves": "Spielst\u00e4nde exportieren",
      "Import Saves": "Spielst\u00e4nde importieren",
      "Save management": "Spielst\u00e4nde verwalten",
      "Saves exported.": "Spielst\u00e4nde exportiert.",
      "Saves imported.": "Spielst\u00e4nde importiert.",
      "Export cancelled.": "Export abgebrochen.",
      "Import cancelled.": "Import abgebrochen.",
      "Replace all three save slots with this backup? Empty backup slots will also replace your current slots.": "Alle drei Speicherpl\u00e4tze durch dieses Backup ersetzen? Leere Pl\u00e4tze ersetzen ebenfalls deine aktuellen Spielst\u00e4nde.",
      "Cancel": "Abbrechen",
      "Import": "Importieren",
      "Erase": "L\u00f6schen",
      "Erase Save Slot": "Spielstand l\u00f6schen",
      "The save slot could not be erased.": "Der Spielstand konnte nicht gel\u00f6scht werden."
    },
    "pt": {
      "Export Saves": "Exportar jogos",
      "Import Saves": "Importar jogos",
      "Save management": "Gerenciar jogos",
      "Saves exported.": "Jogos exportados.",
      "Saves imported.": "Jogos importados.",
      "Export cancelled.": "Exporta\u00e7\u00e3o cancelada.",
      "Import cancelled.": "Importa\u00e7\u00e3o cancelada.",
      "Replace all three save slots with this backup? Empty backup slots will also replace your current slots.": "Substituir os tr\u00eas espa\u00e7os por este backup? Espa\u00e7os vazios tamb\u00e9m substituir\u00e3o seus jogos atuais.",
      "Cancel": "Cancelar",
      "Import": "Importar",
      "Erase": "Apagar",
      "Erase Save Slot": "Apagar jogo salvo",
      "The save slot could not be erased.": "N\u00e3o foi poss\u00edvel apagar o jogo salvo."
    },
    "it": {
      "Export Saves": "Esporta salvataggi",
      "Import Saves": "Importa salvataggi",
      "Save management": "Gestisci salvataggi",
      "Saves exported.": "Salvataggi esportati.",
      "Saves imported.": "Salvataggi importati.",
      "Export cancelled.": "Esportazione annullata.",
      "Import cancelled.": "Importazione annullata.",
      "Replace all three save slots with this backup? Empty backup slots will also replace your current slots.": "Sostituire tutti e tre gli slot con questo backup? Anche gli slot vuoti sostituiranno i salvataggi attuali.",
      "Cancel": "Annulla",
      "Import": "Importa",
      "Erase": "Elimina",
      "Erase Save Slot": "Elimina salvataggio",
      "The save slot could not be erased.": "Impossibile eliminare il salvataggio."
    },
    "nl": {
      "Export Saves": "Saves exporteren",
      "Import Saves": "Saves importeren",
      "Save management": "Saves beheren",
      "Saves exported.": "Saves ge\u00ebxporteerd.",
      "Saves imported.": "Saves ge\u00efmporteerd.",
      "Export cancelled.": "Export geannuleerd.",
      "Import cancelled.": "Import geannuleerd.",
      "Replace all three save slots with this backup? Empty backup slots will also replace your current slots.": "Alle drie de slots vervangen door deze back-up? Lege slots vervangen ook je huidige saves.",
      "Cancel": "Annuleren",
      "Import": "Importeren",
      "Erase": "Wissen",
      "Erase Save Slot": "Opslagvak wissen",
      "The save slot could not be erased.": "Het opslagvak kon niet worden gewist."
    },
    "ja": {
      "Export Saves": "\u30bb\u30fc\u30d6\u3092\u30a8\u30af\u30b9\u30dd\u30fc\u30c8",
      "Import Saves": "\u30bb\u30fc\u30d6\u3092\u30a4\u30f3\u30dd\u30fc\u30c8",
      "Save management": "\u30bb\u30fc\u30d6\u7ba1\u7406",
      "Saves exported.": "\u30bb\u30fc\u30d6\u3092\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3057\u307e\u3057\u305f\u3002",
      "Saves imported.": "\u30bb\u30fc\u30d6\u3092\u30a4\u30f3\u30dd\u30fc\u30c8\u3057\u307e\u3057\u305f\u3002",
      "Export cancelled.": "\u30a8\u30af\u30b9\u30dd\u30fc\u30c8\u3092\u30ad\u30e3\u30f3\u30bb\u30eb\u3057\u307e\u3057\u305f\u3002",
      "Import cancelled.": "\u30a4\u30f3\u30dd\u30fc\u30c8\u3092\u30ad\u30e3\u30f3\u30bb\u30eb\u3057\u307e\u3057\u305f\u3002",
      "Replace all three save slots with this backup? Empty backup slots will also replace your current slots.": "3\u3064\u306e\u30bb\u30fc\u30d6\u30b9\u30ed\u30c3\u30c8\u3092\u3053\u306e\u30d0\u30c3\u30af\u30a2\u30c3\u30d7\u3067\u7f6e\u304d\u63db\u3048\u307e\u3059\u304b\uff1f\u7a7a\u306e\u30b9\u30ed\u30c3\u30c8\u3082\u73fe\u5728\u306e\u30bb\u30fc\u30d6\u3092\u4e0a\u66f8\u304d\u3057\u307e\u3059\u3002",
      "Cancel": "\u30ad\u30e3\u30f3\u30bb\u30eb",
      "Import": "\u30a4\u30f3\u30dd\u30fc\u30c8",
      "Erase": "\u524a\u9664",
      "Erase Save Slot": "\u30bb\u30fc\u30d6\u30c7\u30fc\u30bf\u3092\u524a\u9664",
      "The save slot could not be erased.": "\u30bb\u30fc\u30d6\u30c7\u30fc\u30bf\u3092\u524a\u9664\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002"
    },
    "ko": {
      "Export Saves": "\uc800\uc7a5 \ub0b4\ubcf4\ub0b4\uae30",
      "Import Saves": "\uc800\uc7a5 \uac00\uc838\uc624\uae30",
      "Save management": "\uc800\uc7a5 \uad00\ub9ac",
      "Saves exported.": "\uc800\uc7a5\uc744 \ub0b4\ubcf4\ub0c8\uc2b5\ub2c8\ub2e4.",
      "Saves imported.": "\uc800\uc7a5\uc744 \uac00\uc838\uc654\uc2b5\ub2c8\ub2e4.",
      "Export cancelled.": "\ub0b4\ubcf4\ub0b4\uae30\ub97c \ucde8\uc18c\ud588\uc2b5\ub2c8\ub2e4.",
      "Import cancelled.": "\uac00\uc838\uc624\uae30\ub97c \ucde8\uc18c\ud588\uc2b5\ub2c8\ub2e4.",
      "Replace all three save slots with this backup? Empty backup slots will also replace your current slots.": "\uc800\uc7a5 \uc2ac\ub86f 3\uac1c\ub97c \uc774 \ubc31\uc5c5\uc73c\ub85c \ubc14\uafb8\uc2dc\uaca0\uc2b5\ub2c8\uae4c? \ube48 \uc2ac\ub86f\ub3c4 \ud604\uc7ac \uc800\uc7a5\uc744 \ub36e\uc5b4\uc501\ub2c8\ub2e4.",
      "Cancel": "\ucde8\uc18c",
      "Import": "\uac00\uc838\uc624\uae30",
      "Erase": "\uc0ad\uc81c",
      "Erase Save Slot": "\uc800\uc7a5 \ub370\uc774\ud130 \uc0ad\uc81c",
      "The save slot could not be erased.": "\uc800\uc7a5 \ub370\uc774\ud130\ub97c \uc0ad\uc81c\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4."
    },
    "zh": {
      "Export Saves": "\u5bfc\u51fa\u5b58\u6863",
      "Import Saves": "\u5bfc\u5165\u5b58\u6863",
      "Save management": "\u5b58\u6863\u7ba1\u7406",
      "Saves exported.": "\u5b58\u6863\u5df2\u5bfc\u51fa\u3002",
      "Saves imported.": "\u5b58\u6863\u5df2\u5bfc\u5165\u3002",
      "Export cancelled.": "\u5df2\u53d6\u6d88\u5bfc\u51fa\u3002",
      "Import cancelled.": "\u5df2\u53d6\u6d88\u5bfc\u5165\u3002",
      "Replace all three save slots with this backup? Empty backup slots will also replace your current slots.": "\u8981\u7528\u6b64\u5907\u4efd\u66ff\u6362\u5168\u90e8\u4e09\u4e2a\u5b58\u6863\u69fd\u5417\uff1f\u7a7a\u69fd\u4e5f\u4f1a\u8986\u76d6\u73b0\u6709\u5b58\u6863\u3002",
      "Cancel": "\u53d6\u6d88",
      "Import": "\u5bfc\u5165",
      "Erase": "\u5220\u9664",
      "Erase Save Slot": "\u5220\u9664\u5b58\u6863",
      "The save slot could not be erased.": "\u65e0\u6cd5\u5220\u9664\u5b58\u6863\u3002"
    }
  };
  Object.keys(saveTransferTranslations).forEach(code => Object.assign(phraseTranslations[code],
    saveTransferTranslations[code]));
`;

const actions = String.raw`      <div class="save-actions" role="group" aria-label="Save management">
        <button type="button" class="erase-save-button" id="exportSavesButton">Export Saves</button><button type="button" class="erase-save-button" id="importSavesButton">Import Saves</button><button type="button" class="erase-save-button" id="eraseSaveButton">Erase Selected Slot</button>
      </div>
      <div class="save-transfer-status" id="saveTransferStatus" role="status" aria-live="polite"></div>
`;

const confirmation = String.raw`  <div class="save-confirm-overlay" id="saveConfirmOverlay" hidden>
    <section class="save-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="saveConfirmTitle"
      aria-describedby="saveConfirmMessage"><h2 id="saveConfirmTitle">Import Saves</h2><p id="saveConfirmMessage"></p>
      <div class="save-confirm-actions">
        <button type="button" id="saveConfirmCancel">Cancel</button><button type="button" class="save-confirm-accept" id="saveConfirmAccept">Import</button>
      </div>
    </section>
  </div>
`;

const eraseSlot = `function eraseActiveSaveSlot() {
  if (saveImportRecoveryBlocked || saveTransferRequest || saveConfirmation) return;
  const slot = activeSaveSlot;
  showSaveConfirmation("Erase Save Slot", \`Erase Slot \${slot+1}? This will clear campaign progress and custom unlocks.\`,
    "Erase", confirmed => {
      if (!confirmed) return;
      try {
        window.localStorage.removeItem(saveSlotKey(slot));
      } catch (error) {
        saveTransferMessage("The save slot could not be erased.");
        return;
      }
      loadSaveSlot(slot);
      showTitleScreen(\`Slot \${slot+1} erased. Start Campaign to begin again.\`);
    });
}`;

function replaceOnce(source, before, after) {
  const index = source.indexOf(before);
  if (index < 0 || source.indexOf(before, index + before.length) >= 0) {
    throw new Error('Missing or duplicate save-transfer integration point: ' + before.slice(0, 80));
  }
  return source.slice(0, index) + after + source.slice(index + before.length);
}

function ensureGuard(source, before, after) {
  return source.includes(after) ? source : replaceOnce(source, before, after);
}

export function integrateSaveTransfer(source, script) {
  const begin = '// BEGIN KING PONG SAVE TRANSFER';
  const end = '// END KING PONG SAVE TRANSFER';
  if (source.includes(begin)) {
    const start = source.indexOf(begin), finish = source.indexOf(end, start);
    if (finish < 0 || source.indexOf(begin, start + begin.length) >= 0) {
      throw new Error('Missing or duplicate save-transfer block');
    }
    source = source.slice(0, start) + script.trimEnd() + source.slice(finish + end.length);
  } else {
    source = replaceOnce(source, 'function createDefaultSaveData() {', script + '\nfunction createDefaultSaveData() {');
  }
  if (source.includes('.save-actions {')) {
    const start = source.indexOf('.save-actions {'), end = source.indexOf('.battery-indicator[hidden] {', start);
    const finish = end < 0 ? source.indexOf('</style>', start) : end;
    source = source.slice(0, start) + styles + source.slice(finish);
  } else {
    const end = source.indexOf('</style>');
    source = source.slice(0, end) + '\n' + styles + source.slice(end);
  }
  if (source.includes('id="exportSavesButton"')) {
    const existing = source.match(/^      <div class="save-actions"[^\n]*>[\s\S]*?^      <div class="save-transfer-status"[^\n]*<\/div>\n/m);
    if (!existing) throw new Error('Missing save-transfer actions boundary');
    source = replaceOnce(source, existing[0], actions);
  } else {
    source = replaceOnce(source,
      '      <button type="button" class="erase-save-button" id="eraseSaveButton">Erase Selected Slot</button>\n', actions);
  }
  if (source.includes('id="saveConfirmOverlay"')) {
    const existing = source.match(/^  <div class="save-confirm-overlay"[^\n]*>[\s\S]*?^  <\/div>\n/m);
    if (!existing) throw new Error('Missing save-transfer confirmation boundary');
    source = replaceOnce(source, existing[0], confirmation);
  } else {
    source = replaceOnce(source, '  <script id="royal-localization">', confirmation + '  <script id="royal-localization">');
  }
  if (source.includes('  const saveTransferTranslations = {')) {
    const start = source.indexOf('  const saveTransferTranslations = {');
    const end = source.indexOf('  const runtimeUiTranslations = {', start);
    if (end < 0) throw new Error('Missing save-transfer translation boundary');
    source = source.slice(0, start) + translations + source.slice(end);
  } else {
    source = replaceOnce(source, '  const runtimeUiTranslations = {', translations + '  const runtimeUiTranslations = {');
  }
  source = ensureGuard(source, 'let loadingSaveSlot = false;',
    'let loadingSaveSlot = false;\nlet saveImportRecoveryBlocked = false;');
  source = ensureGuard(source, '  if (!saveData || loadingSaveSlot) return;',
    '  if (!saveData || loadingSaveSlot || saveImportRecoveryBlocked || saveConfirmation) return;');
  source = ensureGuard(source, 'function handleFullScreenPointerDown(e) {',
    'function handleFullScreenPointerDown(e) {\n  if (saveConfirmation) return;');
  source = ensureGuard(source, 'function updateGamepadInput() {\n  const pads = getConnectedGamepads();',
    'function updateGamepadInput() {\n  const pads = getConnectedGamepads();\n' +
    '  if (saveConfirmation) {\n    refreshGamepadConnection(pads);\n' +
    '    pads.forEach(pad => pad.buttons.forEach((button, index) => gamepadButtonState.set(`${pad.index}:${index}`, Boolean(\n' +
    '      button.pressed))));\n    return [];\n  }');
  source = ensureGuard(source, 'loadSaveSlot(rememberedSaveSlot());',
    'recoverInterruptedSaveImport();\nloadSaveSlot(rememberedSaveSlot());');
  const [start, finish] = functionRange(source, 'eraseActiveSaveSlot');
  return source.slice(0, start) + eraseSlot + source.slice(finish);
}
