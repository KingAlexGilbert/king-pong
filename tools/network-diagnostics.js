// Developer-only. Not bundled, loaded, or enabled by the game. Paste this file
// into DevTools during a test match, then call startKingPongNetworkDiagnostics().
// No SDP, addresses, credentials, identifiers, analytics or network requests.
window.startKingPongNetworkDiagnostics = async function () {
  const peer = typeof lanPeer !== 'undefined' ? lanPeer : null;
  if (!peer || peer.connectionState !== 'connected') throw new Error('Connect a test match first.');
  const channels = [...new Set([lanChannel, onlineControlChannel].filter(Boolean))];
  const encoder = new TextEncoder();
  const size = value => typeof value === 'string' ? encoder.encode(value).length : value.byteLength || value.size || 0;
  const payload = {upload: 0, download: 0, sent: 0, received: 0};
  const undo = [];
  for (const channel of channels) {
    const send = channel.send;
    const wrapper = function (value) {
      const result = send.call(this, value);
      payload.upload += size(value); payload.sent++;
      return result;
    };
    const receive = event => { payload.download += size(event.data); payload.received++; };
    channel.send = wrapper; channel.addEventListener('message', receive);
    undo.push(() => { if (channel.send === wrapper) channel.send = send; channel.removeEventListener('message', receive); });
  }
  const read = async () => {
    const stats = await peer.getStats();
    const transports = [...stats.values()].filter(s => s.type === 'transport');
    const pairs = transports.map(t => stats.get(t.selectedCandidatePairId)).filter(Boolean);
    const candidates = pairs.flatMap(p => [stats.get(p.localCandidateId), stats.get(p.remoteCandidateId)]).filter(Boolean);
    return {time: performance.now(), transportUpload: transports.reduce((n,s)=>n+(s.bytesSent||0),0),
      transportDownload: transports.reduce((n,s)=>n+(s.bytesReceived||0),0),
      dataChannels: [...stats.values()].filter(s=>s.type==='data-channel').reduce((n,s)=>({
        upload:n.upload+(s.bytesSent||0),download:n.download+(s.bytesReceived||0)}),{upload:0,download:0}),
      candidatePairRTTms: pairs.filter(p=>Number.isFinite(p.currentRoundTripTime)).map(p=>p.currentRoundTripTime*1000),
      route: candidates.some(c=>c.candidateType==='relay') ? 'relay' : candidates.length ? 'direct' : 'unknown',
      ...payload};
  };
  let first;
  try { first = await read(); } catch (error) { undo.forEach(fn=>fn()); throw error; }
  const samples = [first];
  let pending = Promise.resolve(), stopped = false;
  const timer = setInterval(() => {
    pending = pending.then(async () => { if (!stopped) samples.push(await read()); }).catch(()=>{});
  },1000);
  return {async stop() {
    clearInterval(timer); await pending;
    if (!stopped) { try { samples.push(await read()); } finally { stopped = true; undo.forEach(fn=>fn()); } }
    const last = samples.at(-1), seconds = (last.time-first.time)/1000;
    const rate = (key,a=first,b=last) => (b[key]-a[key])/Math.max((b.time-a.time)/1000,.001)/1000;
    const result = {seconds, decimalUnits:true, route:last.route,
      payloadUploadKBps:rate('upload'),payloadDownloadKBps:rate('download'),
      transportUploadKBps:rate('transportUpload'),transportDownloadKBps:rate('transportDownload'),
      messagesSentPerSecond:(last.sent-first.sent)/seconds,messagesReceivedPerSecond:(last.received-first.received)/seconds,
      peakOneSecondUploadKBps:Math.max(0,...samples.slice(1).map((b,i)=>rate('upload',samples[i],b))),
      peakOneSecondDownloadKBps:Math.max(0,...samples.slice(1).map((b,i)=>rate('download',samples[i],b))),
      candidatePairRTTms:samples.flatMap(s=>s.candidatePairRTTms),samples,
      note:'Candidate-pair RTT is a connectivity-check statistic, not input latency. Transport statistics are not provider billing.'};
    return result;
  }};
};
