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
      if (name === 'update') { tickOnlineMatchFlow(); tickMultiplayerRematch(); }
      if (name === 'requestServeOrContinue' && multiplayerRematchVisible()) return;
      if (name === 'requestRetryLevel' && mode === 2 && onlineSession && (gameOver || lanRole === 'guest')) return;
      if (name === 'requestServeOrContinue' && onlineMatchFlowBlocksPlay()) return;
      if (mode === 2 && onlineGameBlocked) { suspendPointServeCountdown(); return; }
      return original(...args);
    };
  }
  for (const name of ['serveOrContinue', 'togglePause', 'retryLevel', 'pointForPlayer', 'pointForCpu']) {
    const original = window[name];
    window[name] = (...args) => {
      if (mode === 2 && onlineSession && (name === 'retryLevel' && (gameOver || lanRole === 'guest') ||
          name === 'serveOrContinue' && gameOver)) return;
      if (onlineMatchFlowBlocksPlay()) return;
      return original(...args);
    };
  }
  const receive = handleLanMessage;
  window.handleLanMessage = raw => {
    if (typeof raw !== 'string' || raw.length > 8192) return;
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (onlineSession && Array.isArray(message)) {
      message = decodeOnlineWire(message);
      if (!message) return;
      raw = JSON.stringify(message);
    }
    if (onlineSession && message?.type === 'net-format') { receiveOnlineWireHello(message); return; }
    if (message?.type === 'rematch') { receiveMultiplayerRematch(message); return; }
    if (onlineSession && !acceptMultiplayerRound(message)) return;
    // A remote legacy Retry action is not consent from the host. The host's
    // existing mid-match Restart control remains available locally.
    if (onlineSession && message?.type === 'action' && message.action === 'retry') return;
    if (message?.type === 'match-setup') { receiveOnlineMatchSetup(message); return; }
    if (onlineMatchFlowBlocksPlay() && message?.type === 'action') return;
    const needsState = onlineMatchFlow?.configured && !onlineHasState;
    receive(raw);
    if (message?.type === 'state' && message.seq === lanLastStateSeq) finishMultiplayerRematchSnapshot();
    // Acknowledge the first accepted snapshot immediately; no extra retry delay.
    if (needsState && onlineHasState && lanRole === 'guest' && onlineMatchFlow)
      sendOnlineMatchSetup('initialized', {configuration: onlineMatchFlow.configuration});
  };
  const levelChoice = applyCustomLevelPickerChoice;
  window.applyCustomLevelPickerChoice = value => { if (!matchmakingLocked()) levelChoice(value); };
  const guestMessage = handleLanGuestMessage;
  window.handleLanGuestMessage = message => {
    if (validMatchmakingState(message)) guestMessage(message);
  };
}
