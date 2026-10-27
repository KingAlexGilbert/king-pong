let matchmakingSocket = null;
let matchmakingState = 'offline';
let matchmakingWaiting = null;
let matchmakingRequested = false;
let matchmakingHeartbeat = null;
let matchmakingOpenTimer = null;
let matchmakingWaitTimer = null;
let matchmakingLastPong = 0;
let matchmakingPowerupsPreference = null;

function onlineRoomInput() { return byId('onlineRoomInput') || lanRoomCodeInput; }
function onlineHostControl() { return byId('onlineHostButton') || lanHostButton; }
function onlineJoinControl() { return byId('onlineJoinButton') || lanJoinButton; }
function onlineDisconnectControl() { return byId('onlineDisconnectButton') || lanDisconnectButton; }
function matchmakingLocked() { return Boolean(onlineMatchAssignment); }

function syncMatchmakingUi() {
  if (!byId('matchmakingPanel')) return;
  const searching = matchmakingRequested || matchmakingState === 'waiting';
  const connecting = matchmakingState === 'connecting' || matchmakingLocked();
  byId('findMatchButton').hidden = searching || connecting || Boolean(onlineSession);
  byId('cancelSearchButton').hidden = lanConnected || !searching && !connecting;
  byId('chooseArenaButton')?.toggleAttribute('disabled', searching || connecting || Boolean(onlineSession));
  byId('matchmakingAvailability').hidden = connecting;
  const status = matchmakingState === 'opening' ? 'Checking queue...' : matchmakingWaiting === null ? 'Queue status unavailable. Press Find Match to retry.' :
    matchmakingWaiting - (matchmakingState === 'waiting' ? 1 : 0) > 0 ?
      'Opponent available — Find Match!' : searching ?
      "No opponents waiting. You'll be matched when someone joins." : '0 players waiting — Be the first to search!';
  royalText(byId('matchmakingAvailability'), status);
  byId('onlinePowerups')?.toggleAttribute('disabled', searching || connecting || !canChooseMatchRules());
  byId('onlinePrivateRooms').hidden = searching || connecting;
  byId('matchmakingPanel').hidden = Boolean(onlineSession && !onlineMatchAssignment);
}

function stopMatchmaking() {
  const socket = matchmakingSocket;
  matchmakingSocket = null;
  clearInterval(matchmakingHeartbeat);
  clearTimeout(matchmakingOpenTimer);
  clearTimeout(matchmakingWaitTimer);
  matchmakingRequested = false;
  matchmakingPowerupsPreference = null;
  matchmakingState = 'offline';
  matchmakingWaiting = null;
  const closed = closeOnlineSocket(socket);
  syncMatchmakingUi();
  return closed;
}

function matchmakingError(code) {
  return ['incompatible', 'rate_limited', 'unavailable', 'relay_unavailable'].includes(code) ? ONLINE_ERRORS[code] :
    'Match failed. Press Find Match to try again.';
}

function matchmakingFailed(code) {
  if (onlineMatchFlowVisible()) { failOnlineMatchFlow(code); return; }
  const connecting = matchmakingLocked() && !lanConnected;
  stopMatchmaking();
  if (connecting) closeLanConnection(false);
  onlineGameBlocked = true;
  paused = true;
  setLanStatus(matchmakingError(code));
}

function observeMatchmaking() {
  if (multiplayerDisconnect || matchmakingSocket || document.hidden || !window.KING_PONG_SIGNALING_URL) return;
  let socket;
  try {
    const url = new URL(window.KING_PONG_SIGNALING_URL);
    if (url.username || url.password || url.search || url.hash ||
        !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error();
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/v1/queue/' + KING_PONG_MATCHMAKING.protocol;
    socket = matchmakingSocket = kingPongSignalingSocket(url);
  } catch { matchmakingFailed('unavailable'); return; }
  matchmakingState = 'opening';
  matchmakingOpenTimer = setTimeout(() => matchmakingFailed('timeout'), 12_000);
  socket.onopen = () => {
    if (socket !== matchmakingSocket) return;
    matchmakingLastPong = Date.now();
    matchmakingHeartbeat = setInterval(() => {
      if (Date.now() - matchmakingLastPong > 60_000) matchmakingFailed('connection_lost');
      else if (socket.readyState === 1) socket.send('ping');
    }, 20_000);
    if (matchmakingRequested) sendMatchSearch();
  };
  socket.onmessage = event => {
    if (socket !== matchmakingSocket) return;
    if (event.data === 'pong') { matchmakingLastPong = Date.now(); return; }
    try {
      const m = JSON.parse(event.data);
      if (m.type === 'queue') {
        clearTimeout(matchmakingOpenTimer);
        if (!Number.isInteger(m.waiting) || m.waiting < 0 || m.waiting > 256 ||
            !['watching', 'waiting', 'connecting'].includes(m.state)) throw new Error();
        matchmakingWaiting = m.waiting;
        matchmakingState = m.state;
      } else if (m.type === 'matched') {
        if (!matchmakingRequested || m.match?.protocol !== KING_PONG_MATCHMAKING.protocol ||
            !KING_PONG_MATCHMAKING.arenas.includes(m.match.arena) || m.match.rules !== KING_PONG_MATCHMAKING.rules ||
            !/^[a-f0-9-]{36}$/.test(m.match.id) || !/^[a-f0-9-]{36}$/.test(m.token) ||
            !['host', 'guest'].includes(m.role)) throw new Error();
        clearTimeout(matchmakingWaitTimer);
        matchmakingRequested = false;
        matchmakingState = 'connecting';
        openOnlineRoom(m.role, '', m);
        setLanStatus('Match Found!');
      } else if (m.type === 'complete') {
        stopMatchmaking();
      } else if (m.type === 'failed' || m.type === 'error') {
        matchmakingFailed(m.code);
      } else throw new Error();
      syncMatchmakingUi();
    } catch { matchmakingFailed('negotiation_failed'); }
  };
  socket.onerror = socket.onclose = () => {
    if (socket === matchmakingSocket) matchmakingFailed('connection_lost');
  };
}

function sendMatchSearch() {
  if (!matchmakingRequested || matchmakingSocket?.readyState !== 1) return;
  matchmakingSocket.send(JSON.stringify({ type: 'search', protocol: KING_PONG_MATCHMAKING.protocol,
    arena: matchArenaId }));
}

function findOnlineMatch() {
  if (onlineSession || matchmakingRequested || matchmakingState === 'waiting') return;
  if (!isLanSupported()) { setLanStatus('This browser cannot play online. Try an updated browser.'); return; }
  if (!KING_PONG_MATCHMAKING.arenas.includes(matchArenaId)) {
    setLanStatus('Choose a campaign arena to find a match.');
    return;
  }
  onlineTransportSelected = true;
  onlineGameBlocked = true;
  matchmakingPowerupsPreference = playerPreference('royalPowerupsEnabled');
  matchmakingRequested = true;
  setLanStatus('Searching for an opponent...');
  if (matchmakingSocket?.readyState === 1) sendMatchSearch();
  else observeMatchmaking();
  clearTimeout(matchmakingWaitTimer);
  matchmakingWaitTimer = setTimeout(() => {
    if (matchmakingState === 'waiting') setLanStatus('Still searching. You can leave the search open or cancel.');
  }, 60_000);
  syncMatchmakingUi();
}

function cancelMatchSearch() {
  if (onlineMatchFlowVisible()) { leaveOnlineMatchFlow(); return; }
  closeLanConnection(false);
  onlineTransportSelected = true;
  onlineGameBlocked = true;
  paused = true;
  setLanStatus('Search canceled.');
  observeMatchmaking();
}

function matchmakingComplete() {
  if (matchmakingSocket?.readyState === 1) matchmakingSocket.send(JSON.stringify({type: 'complete'}));
}

function applyMatchmakingSettings() {
  if (!onlineMatchAssignment) return;
  matchRuleId = onlineMatchAssignment.rules;
  // Provisional local value; the reliable hello/config handshake resolves AND.
  matchPowerupsEnabled = matchmakingPowerupsPreference ?? playerPreference('royalPowerupsEnabled');
  matchRuleRevision = 0;
  remoteRuleRevision = -1;
  setLevelByAbsoluteIndex(onlineMatchAssignment.arena, true);
}

function validMatchmakingState(message) {
  if (!onlineMatchAssignment) return true;
  const match = onlineMatchAssignment;
  if (onlineMatchFlow?.configured && message.rules?.powerups !== undefined &&
      message.rules.powerups !== onlineMatchFlow.agreedPowerups) {
    onlineSession?.fail('incompatible'); return false;
  }
  if (message.type === 'rules') {
    if (message.rules?.id === match.rules) return true;
    onlineSession?.fail('incompatible');
    return false;
  }
  if (message.type !== 'state') return true;
  // The reliable GO message owns the start. An unordered gameplay packet may
  // arrive before it, but cannot start the guest's presentation prematurely.
  if (onlineMatchFlowBlocksPlay() && (!message.waitingForServe || !message.paused)) return false;
  if (message.rules?.id === match.rules && message.selection?.arena === match.arena &&
      message.activeCampaign === Math.floor(match.arena / 6) && message.levelIndex === match.arena % 6) return true;
  onlineSession?.fail('incompatible');
  return false;
}

function initMatchmakingUi() {
  const panel = document.createElement('section');
  panel.id = 'matchmakingPanel';
  const title = document.createElement('h3');
  setLocalizedText(title, 'Find Match');
  const rules = document.createElement('span');
  rules.className = 'matchmaking-rules';
  setLocalizedText(rules, 'First to 10');
  title.append(rules);
  const arenaNote = document.createElement('p');
  setLocalizedText(arenaNote, 'Your selected arena is your preference. Different choices are decided fairly.');
  const status = document.createElement('p');
  status.id = 'matchmakingAvailability';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  panel.append(title, arenaNote, status,
    royalButton('findMatchButton', 'Find Match', findOnlineMatch, 'match-primary'),
    royalButton('cancelSearchButton', 'Cancel Search', cancelMatchSearch));
  const privateRooms = document.createElement('section');
  privateRooms.id = 'onlinePrivateRooms';
  const privateTitle = document.createElement('h3');
  setLocalizedText(privateTitle, 'Private Room');
  const privateNote = document.createElement('p');
  setLocalizedText(privateNote, 'Play with friends using a room code.');
  privateRooms.append(privateTitle, privateNote);
  const privateRules = royalDisclosure('Match rules', 'onlinePrivateRules');
  privateRooms.append(privateRules);
  const root = document.createElement('div');
  root.id = 'onlineUiRoot';
  if (onlineNativeTransport) {
    const row = document.createElement('div');
    row.className = 'lan-row';
    row.append(royalButton('onlineHostButton', 'Create Room', hostOnlineMatch),
      royalButton('onlineJoinButton', 'Join Room', prepareOnlineJoin));
    privateRooms.append(row);
    const code = document.createElement('div');
    code.id = 'onlineCodeDisplay';
    code.hidden = true;
    const codeLabel = document.createElement('span');
    setLocalizedText(codeLabel, 'Room Code');
    const output = document.createElement('output');
    output.id = 'onlineRoomCode';
    output.translate = false;
    code.append(codeLabel, output);
    const form = document.createElement('form');
    form.id = 'onlineJoinForm';
    form.hidden = true;
    const inputLabel = document.createElement('label');
    inputLabel.htmlFor = 'onlineRoomInput';
    setLocalizedText(inputLabel, 'Enter Room Code');
    const input = document.createElement('input');
    input.id = 'onlineRoomInput';
    input.maxLength = 5;
    input.autocomplete = 'off';
    input.spellcheck = false;
    const join = royalButton('onlineJoinSubmit', 'Join', () => {});
    join.type = 'submit';
    form.append(inputLabel, input, join);
    form.addEventListener('submit', e => { e.preventDefault(); joinOnlineRoom(); });
    root.append(code, form, royalButton('onlineDisconnectButton', 'Disconnect', () => closeLanConnection()));
    root.querySelector('#onlineDisconnectButton').hidden = true;
  } else {
    privateRooms.append(lanHostButton, lanJoinButton);
    root.append(byId('onlineCodeDisplay'), byId('onlineJoinForm'), lanDisconnectButton);
  }
  root.prepend(panel, privateRooms);
  lanPanel.append(root);
  syncMatchmakingUi();
}

function syncOnlineTransportUi() {
  if (!byId('onlineUiRoot')) return;
  byId('onlineUiRoot').hidden = !onlineTransportSelected;
  if (onlineNativeTransport) for (const child of lanPanel.children) {
    if (child.id === 'onlineUiRoot' || child.id === 'lanStatus') continue;
    child.hidden = onlineTransportSelected;
  }
  const activeMenu = onlineTransportSelected && royalOnlineMode() && !document.body.classList.contains('title-active');
  if (!activeMenu && matchmakingSocket && !matchmakingLocked()) stopMatchmaking();
}

function stopBackgroundMatchmaking() {
  if (onlineSession?.presence) return;
  if (onlineMatchFlowBlocksPlay()) { failOnlineMatchFlow('opponent_left'); return; }
  if (!matchmakingSocket) return;
  const wasSearching = matchmakingRequested || matchmakingState === 'waiting' || matchmakingLocked();
  if (matchmakingLocked() && !lanConnected) closeLanConnection(false);
  stopMatchmaking();
  if (wasSearching && onlineTransportSelected && !lanConnected) setLanStatus('Search stopped while the app was in the background.');
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopBackgroundMatchmaking(); });
document.addEventListener('kingpong-background', () => { if (window.KingPongBackgrounded) stopBackgroundMatchmaking(); });
