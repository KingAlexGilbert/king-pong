// BEGIN KING PONG SAVE TRANSFER -- synchronized from game/save-transfer.js.
const SAVE_BACKUP_LIMIT = 64 * 1024;
const SAVE_IMPORT_JOURNAL = "kingPongSaveImportRecoveryV1";
const exportSavesButton = byId("exportSavesButton");
const importSavesButton = byId("importSavesButton");
const saveTransferStatus = byId("saveTransferStatus");
let saveTransferRequest = null;
let saveTransferSequence = 0;
const saveConfirmOverlay = byId("saveConfirmOverlay");
const saveConfirmTitle = byId("saveConfirmTitle");
const saveConfirmMessage = byId("saveConfirmMessage");
const saveConfirmCancel = byId("saveConfirmCancel");
const saveConfirmAccept = byId("saveConfirmAccept");
let saveConfirmation = null;

function showSaveConfirmation(title, message, acceptLabel, onResult) {
  if (saveConfirmation) return;
  const previousFocus = document.activeElement;
  const background = Array.from(document.body.children).filter(element =>
    element !== saveConfirmOverlay && element.tagName !== "SCRIPT" && element.tagName !== "STYLE"
  ).map(element => ({
    element,
    inert: element.hasAttribute("inert"),
    ariaHidden: element.getAttribute("aria-hidden")
  }));
  saveConfirmation = {
    onResult,
    previousFocus,
    background
  };
  setLocalizedText(saveConfirmTitle, title);
  setLocalizedText(saveConfirmMessage, message);
  setLocalizedText(saveConfirmAccept, acceptLabel);
  setLocalizedText(saveConfirmCancel, "Cancel");
  setSaveTransferBusy(true);
  clearHeldInput();
  saveConfirmOverlay.hidden = false;
  // Focus the non-destructive action, then make the background inaccessible.
  saveConfirmCancel.focus({
    preventScroll: true
  });
  background.forEach(({
    element
  }) => {
    element.setAttribute("inert", "");
    element.setAttribute("aria-hidden", "true");
  });
}

function finishSaveConfirmation(confirmed) {
  if (!saveConfirmation) return;
  const {
    onResult,
    previousFocus,
    background
  } = saveConfirmation;
  saveConfirmation = null;
  saveConfirmOverlay.hidden = true;
  background.forEach(({
    element,
    inert,
    ariaHidden
  }) => {
    if (!inert) element.removeAttribute("inert");
    if (ariaHidden === null) element.removeAttribute("aria-hidden");
    else element.setAttribute("aria-hidden", ariaHidden);
  });
  clearHeldInput();
  setSaveTransferBusy(Boolean(saveTransferRequest));
  if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === "function") {
    previousFocus.focus({
      preventScroll: true
    });
  }
  onResult(confirmed);
}

function handleSaveConfirmationKey(event) {
  if (!saveConfirmation) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.type !== "keydown" || event.repeat) return;
  if (event.key === "Escape") {
    finishSaveConfirmation(false);
  } else if (event.key === "Tab" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
    (document.activeElement === saveConfirmCancel ? saveConfirmAccept : saveConfirmCancel).focus({
      preventScroll: true
    });
  } else if (event.key === "Enter" || event.key === " ") {
    finishSaveConfirmation(document.activeElement === saveConfirmAccept);
  }
}

saveConfirmCancel.addEventListener("click", () => finishSaveConfirmation(false));
saveConfirmAccept.addEventListener("click", () => finishSaveConfirmation(true));
saveConfirmOverlay.addEventListener("click", event => {
  event.stopPropagation();
  if (event.target === saveConfirmOverlay) finishSaveConfirmation(false);
});
// Keep touches on the dialog out of the fullscreen paddle controls.
["pointerdown", "pointermove", "pointerup", "pointercancel"].forEach(type => {
  saveConfirmOverlay.addEventListener(type, event => event.stopPropagation());
});
window.addEventListener("keydown", handleSaveConfirmationKey, true);
window.addEventListener("keyup", handleSaveConfirmationKey, true);
window.addEventListener("focusin", event => {
  if (saveConfirmation && !saveConfirmOverlay.contains(event.target)) saveConfirmCancel.focus({
    preventScroll: true
  });
});

function saveTransferMessage(message) {
  setLocalizedText(saveTransferStatus, message);
}

function setSaveTransferBusy(busy) {
  exportSavesButton.disabled = busy;
  importSavesButton.disabled = busy || saveImportRecoveryBlocked;
  eraseSaveButton.disabled = busy || saveImportRecoveryBlocked;
}

function checkedSaveSlot(slot) {
  if (slot === null) return null;
  if (!slot || typeof slot !== "object" || Array.isArray(slot) || slot.version !== 2) {
    throw new Error("Invalid save slot");
  }
  const number = (name, min, max, integer = false) => {
    const value = slot[name];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number
        .isInteger(value))) {
      throw new Error("Invalid save value");
    }
    return value;
  };
  const boolean = name => {
    if (typeof slot[name] !== "boolean") throw new Error("Invalid save flag");
    return slot[name];
  };
  if (!Array.isArray(slot.completedLevels) || slot.completedLevels.length !== TOTAL_LEVELS || slot.completedLevels.some(
      value => typeof value !== "boolean")) {
    throw new Error("Invalid level progress");
  }
  const selections = {};
  /* ROYAL POLISH */
  for (const key of ["muteAll", "soundEffectsEnabled"]) {
    if (slot[key] !== undefined) selections[key] = boolean(key);
  }
  /* END ROYAL POLISH */

  for (const key of ['royalPaddle', 'royalPaddle2']) {
    if (slot[key] === undefined) continue;
    if (typeof slot[key] !== 'string' || !/^(classic|(?:player|enemy)-(?:[2-9]|1[0-7])|boss-[0-8])$/.test(slot[key]))
      throw new Error('Invalid paddle');
    selections[key] = slot[key];
  }
  if (slot.royalArena !== undefined) selections.royalArena = number('royalArena', 0, TOTAL_LEVELS, true);
  // Copy only known fields. Imported objects never become game state directly.
  return {
    ...selections,
    version: 2,
    createdAt: number("createdAt", 0, Number.MAX_SAFE_INTEGER, true),
    updatedAt: number("updatedAt", 0, Number.MAX_SAFE_INTEGER, true),
    highestUnlockedLevel: number("highestUnlockedLevel", 0, TOTAL_LEVELS - 1, true),
    completedLevels: slot.completedLevels.slice(),
    customCpuIntel: number("customCpuIntel", 0, 100, true),
    customCpuMaxMove: number("customCpuMaxMove", 1, 12),
    musicVolumePercent: number("musicVolumePercent", 0, 100, true),
    musicEnabled: boolean("musicEnabled"),
    bossUnlocked: boolean("bossUnlocked"),
    bossCleared: boolean("bossCleared")
  };
}

function makeSaveBackup() {
  const slots = Array.from({
    length: SAVE_SLOT_COUNT
  }, (_, slot) => {
    const raw = window.localStorage.getItem(saveSlotKey(slot));
    if (raw === null) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Unreadable saved data");
    return checkedSaveSlot(normalizeSaveData(data));
  });
  const text = JSON.stringify({
    format: "king-pong-saves",
    version: 1,
    exportedAt: new Date().toISOString(),
    activeSlot: activeSaveSlot,
    slots
  }, null, 2);
  if (text.length > SAVE_BACKUP_LIMIT) throw new Error("Backup too large");
  return text;
}

function parseSaveBackup(text) {
  if (typeof text !== "string" || text.length > SAVE_BACKUP_LIMIT) throw new Error("Backup too large");
  const backup = JSON.parse(text.replace(/^\uFEFF/, ""));
  if (!backup || backup.format !== "king-pong-saves" || backup.version !== 1 ||
    !Array.isArray(backup.slots) || backup.slots.length !== SAVE_SLOT_COUNT ||
    !Number.isInteger(backup.activeSlot) || backup.activeSlot < 0 || backup.activeSlot >= SAVE_SLOT_COUNT) {
    throw new Error("Unsupported save backup");
  }
  return {
    activeSlot: backup.activeSlot,
    slots: backup.slots.map(checkedSaveSlot)
  };
}

function restoreSaveStrings(values) {
  values.forEach((value, slot) => {
    if (value === null) window.localStorage.removeItem(saveSlotKey(slot));
    else window.localStorage.setItem(saveSlotKey(slot), value);
  });
}

function recoverInterruptedSaveImport() {
  try {
    const journal = window.localStorage.getItem(SAVE_IMPORT_JOURNAL);
    if (journal === null) return true;
    const previous = JSON.parse(journal);
    if (!Array.isArray(previous) || previous.length !== SAVE_SLOT_COUNT || previous.some(value => value !== null &&
        typeof value !== "string")) {
      throw new Error("Invalid recovery data");
    }
    restoreSaveStrings(previous);
    window.localStorage.removeItem(SAVE_IMPORT_JOURNAL);
    return true;
  } catch (error) {
    saveImportRecoveryBlocked = true;
    setSaveTransferBusy(false);
    saveTransferMessage("Save recovery failed. Restart the game before changing saves.");
    return false;
  }
}

function importSaveBackup(text) {
  let backup;
  try {
    backup = parseSaveBackup(text);
  } catch (error) {
    saveTransferMessage("Choose a valid King Pong save backup (64 KB maximum).");
    return;
  }
  if (saveImportRecoveryBlocked || saveConfirmation) return;
  showSaveConfirmation("Import Saves",
    "Replace all three save slots with this backup? Empty backup slots will also replace your current slots.",
    "Import", confirmed => {
      if (confirmed) applyImportedSaveBackup(backup);
      else saveTransferMessage("Import cancelled.");
    });
}

function applyImportedSaveBackup(backup) {
  if (saveImportRecoveryBlocked) return;
  let journalWritten = false;
  try {
    const previous = Array.from({
      length: SAVE_SLOT_COUNT
    }, (_, slot) => window.localStorage.getItem(saveSlotKey(slot)));
    // Abort without touching any slot if there is no room for recovery data.
    window.localStorage.setItem(SAVE_IMPORT_JOURNAL, JSON.stringify(previous));
    journalWritten = true;
    restoreSaveStrings(backup.slots.map(slot => slot === null ? null : JSON.stringify(slot)));
    window.localStorage.removeItem(SAVE_IMPORT_JOURNAL);
  } catch (error) {
    if (!journalWritten || recoverInterruptedSaveImport()) {
      saveTransferMessage("Import failed. Your previous saves were kept.");
    }
    return;
  }
  closeLanConnection(false);
  loadSaveSlot(backup.activeSlot);
  setLevelByAbsoluteIndex(firstUnlockedCampaignIndex(), false);
  showTitleScreen();
  saveTransferMessage("Saves imported.");
}

function finishSaveTransfer(id, status, text = "") {
  if (!saveTransferRequest || saveTransferRequest.id !== id) return;
  const operation = saveTransferRequest.operation;
  saveTransferRequest = null;
  setSaveTransferBusy(false);
  if (status === "cancel") {
    saveTransferMessage(operation === "export" ? "Export cancelled." : "Import cancelled.");
  } else if (status !== "ok") {
    saveTransferMessage("The save file could not be opened or saved.");
  } else if (operation === "import") {
    importSaveBackup(text);
  } else {
    saveTransferMessage("Saves exported.");
  }
}

// Native callbacks carry base64 text, never executable JavaScript from a file.
window.KingPongSaveTransfer = Object.freeze({
  cancelConfirmation() {
    if (!saveConfirmation) return false;
    finishSaveConfirmation(false);
    return true;
  },
  receive(id, status, encoded = "") {
    if (!saveTransferRequest || saveTransferRequest.id !== id) return;
    try {
      if (typeof encoded !== "string" || encoded.length > Math.ceil(SAVE_BACKUP_LIMIT / 3) * 4) throw new Error(
        "Backup too large");
      const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));
      const text = new TextDecoder("utf-8", {
        fatal: true
      }).decode(bytes);
      finishSaveTransfer(id, status, text);
    } catch (error) {
      finishSaveTransfer(id, "error");
    }
  }
});

function browserSaveTransfer(id, operation, text) {
  if (operation === "export") {
    const url = URL.createObjectURL(new Blob([text], {
      type: "application/json"
    }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "KingPong-saves.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    finishSaveTransfer(id, "ok");
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.hidden = true;
  document.body.appendChild(input);
  const cleanup = () => input.remove();
  input.addEventListener("cancel", () => {
    cleanup();
    finishSaveTransfer(id, "cancel");
  }, {
    once: true
  });
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    cleanup();
    if (!file) {
      finishSaveTransfer(id, "cancel");
      return;
    }
    if (file.size > SAVE_BACKUP_LIMIT) {
      finishSaveTransfer(id, "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => finishSaveTransfer(id, "ok", String(reader.result));
    reader.onerror = () => finishSaveTransfer(id, "error");
    reader.onabort = () => finishSaveTransfer(id, "cancel");
    reader.readAsText(file, "UTF-8");
  }, {
    once: true
  });
  input.click();
}

function requestSaveTransfer(operation) {
  if (saveTransferRequest || saveImportRecoveryBlocked || saveConfirmation) return;
  let text = "";
  try {
    if (operation === "export") text = makeSaveBackup();
    const id = ++saveTransferSequence;
    saveTransferRequest = {
      id,
      operation
    };
    setSaveTransferBusy(true);
    saveTransferMessage("");
    const message = "kingpong:save:" + operation + ":" + id + (operation === "export" ? ":" + text : "");
    if (window.KingPongSaveFiles && typeof window.KingPongSaveFiles.postMessage === "function") {
      window.KingPongSaveFiles.postMessage(message);
    } else if (window.chrome && window.chrome.webview && typeof window.chrome.webview.postMessage === "function") {
      window.chrome.webview.postMessage(message);
    } else {
      browserSaveTransfer(id, operation, text);
    }
  } catch (error) {
    saveTransferRequest = null;
    setSaveTransferBusy(false);
    saveTransferMessage("The save file could not be opened or saved.");
  }
}

exportSavesButton.addEventListener("click", () => requestSaveTransfer("export"));
importSavesButton.addEventListener("click", () => requestSaveTransfer("import"));
// END KING PONG SAVE TRANSFER
