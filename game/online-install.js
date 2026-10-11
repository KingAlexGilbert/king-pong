// Native LAN functions remain intact. Route only online sessions through the
// existing browser transport and prediction adapters, after legacy declarations.
function installOnlineSupport() {
  onlineNativeTransport = typeof lanLocalSignal !== 'undefined';
  const nativeClose = onlineNativeTransport ? closeLanConnection : null;
  const nativeSetup = onlineNativeTransport ? startLanTwoPlayerSetup : null;
  const nativeHost = onlineNativeTransport ? hostLanMatch : null;
  const nativeJoin = onlineNativeTransport ? prepareLanJoin : null;
  window.closeLanConnection = (show = true, keepQueue = false) => {
    if (nativeClose && !onlineSession && !onlineTransportSelected) nativeClose(false);
    closeOnlineConnection(show, keepQueue);
  };
  window.startLanTwoPlayerSetup = fromTitle => {
    if (!nativeSetup) return startOnlineSetup(fromTitle);
    closeLanConnection(false);
    onlineTransportSelected = false;
    nativeSetup(fromTitle);
  };
  window.hostLanMatch = () => onlineTransportSelected || !nativeHost ? hostOnlineMatch() : nativeHost();
  window.prepareLanJoin = () => onlineTransportSelected || !nativeJoin ? prepareOnlineJoin() : nativeJoin();
  if (!onlineNativeTransport) window.sanitizeRoomCode = sanitizeOnlineRoomCode;
  for (const [name, online] of Object.entries({lanSend: onlineLanSend, sendLanInput: onlineSendLanInput,
      sendLanState: onlineSendLanState, applyLanHostState: onlineApplyLanHostState, updatePlayerPaddles: onlineUpdatePlayerPaddles})) {
    const local = window[name];
    window[name] = (...args) => onlineSession ? online(...args) : local(...args);
  }
  for (const name of ['update', 'requestServeOrContinue', 'requestTogglePause', 'requestRetryLevel']) {
    const original = window[name];
    window[name] = (...args) => {
      if (mode === 2 && onlineGameBlocked) return;
      return original(...args);
    };
  }
  const levelChoice = applyCustomLevelPickerChoice;
  window.applyCustomLevelPickerChoice = value => { if (!matchmakingLocked()) levelChoice(value); };
  const guestMessage = handleLanGuestMessage;
  window.handleLanGuestMessage = message => {
    if (validMatchmakingState(message)) guestMessage(message);
  };
}
