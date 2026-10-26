// One adapter for existing input/snapshot/control handlers. No gameplay authority here.
class KingPongSecureTransport {
  constructor(owner,init) {
    this.owner=owner; this.id=init.session; this.epoch=init.epoch; this.mode='rtc'; this.phase='negotiating';
    this.pending=new Map(); this.reorder=new Map(); this.controlId=0; this.receivedControl=0;
    this.candidates=[]; this.early=[]; this.rx=Promise.resolve(); this.rxCount=0; this.closed=false;
    this.turnProviders=new Map();
    this.crypto=new KingPongSessionCrypto(owner.code,this.id,owner.role,owner.approvalBinding);
    this.keyStart=this.crypto.offer().then(value=>this.signal('key',{value}));
    this.keyStart.catch(()=>this.fail());
    const adapter=control=>({
      get ordered(){return control || owner.secure?.mode==='ws';},
      get readyState(){return !owner.secure?.closed && owner.secure?.phase==='active'?'open':'connecting';},
      get bufferedAmount(){return owner.secure?.bufferedAmount() || 0;},
      send:raw=>this.enqueue(raw,control),close(){}
    });
    owner.data=adapter(false);owner.control=adapter(true);
    owner.hooks.channel(owner.data,false);owner.hooks.channel(owner.control,true);
    this.pumpTimer=setInterval(()=>{this.flush();this.credit();},50);
    this.keyTimer=setTimeout(()=>{if(!this.keyReady)this.fail();},12000);
  }
  signal(kind,fields={}) { if(!this.closed)this.owner.send({type:'secure',session:this.id,epoch:this.epoch,kind,...fields}); }
  fail(){if(!this.closed)this.owner.fail('negotiation_failed');}
  async receive(m) {
    if(this.closed || m.session!==this.id)return;
    if(m.kind==='rtc' || m.kind==='ws') {
      if(m.epoch<this.epoch || m.epoch>this.epoch+1)return;
      const changed=m.epoch!==this.epoch;
      if(changed){
        this.freeze();this.epoch=m.epoch;this.candidates=[];this.early=[];
        this.temporaryDisconnect=false;clearTimeout(this.disconnectTimer);this.disconnectTimer=null;
      }
      this.phase='negotiating';this.mode=m.kind==='rtc'?'rtc':'ws';this.readySent=false;
      if(this.mode==='rtc')await this.startRtc(m);
      else {this.dropRtc();this.armTimeout(12000,()=>this.fail());this.maybeReady();}
      return;
    }
    if(m.epoch!==this.epoch)return;
    if(m.kind==='key') {
      await this.keyStart;
      const value=await this.crypto.accept(m.value);
      if(!this.closed)this.signal('proof',{value});
    } else if(m.kind==='proof') {
      if(!await this.crypto.confirm(m.value))throw Error('confirmation');
      this.confirmed=true;this.signal('key-ready');
    } else if(m.kind==='keys-ready') {
      if(!this.confirmed)throw Error('key confirmation');
      this.keyReady=true;clearTimeout(this.keyTimer);
      if(this.rtcFailurePending){this.rtcFailurePending=false;this.rtcFailed();}else this.maybeReady();
    } else if(m.kind==='description') {
      const peer=this.peer,epoch=this.epoch;
      if(!peer || this.mode!=='rtc' || m.value?.type!==(this.owner.role==='host'?'answer':'offer'))return;
      if(this.remoteEpoch===epoch)return;
      try {
        await peer.setRemoteDescription(m.value);
        if(this.closed || this.peer!==peer || epoch!==this.epoch)return;
        this.remoteEpoch=epoch;
        for(const candidate of this.candidates)await peer.addIceCandidate(candidate);
        this.candidates=[];
        if(this.owner.role==='guest') {
          await peer.setLocalDescription(await peer.createAnswer());
          if(this.peer===peer && epoch===this.epoch)this.publishDescription(peer,epoch);
        }
      } catch {if(this.peer===peer && epoch===this.epoch)this.rtcFailed();return;}
      this.maybeReady();
    } else if(m.kind==='candidate') {
      if(!this.peer || this.mode!=='rtc')return;
      if(this.remoteEpoch===this.epoch) {
        try{await this.peer.addIceCandidate(m.value);}catch{this.rtcFailed();}
      }
      else if(this.candidates.length<128)this.candidates.push(m.value);
      else throw Error('candidate limit');
    } else if(m.kind==='prepare') {
      if(m.mode!==this.mode || !this.readySent || !this.keyReady)throw Error('transport disagreement');
      this.phase='preparing';this.signal('prepared',{mode:this.mode});
    } else if(m.kind==='activate') {
      if(m.mode!==this.mode || this.phase!=='preparing')throw Error('transport disagreement');
      this.phase='active';this.recovering=false;this.temporaryDisconnect=false;
      clearTimeout(this.deadline);clearTimeout(this.disconnectTimer);this.disconnectTimer=null;
      this.owner.connected=true;this.owner.lastTransport=this.mode==='ws'?'WebSocket relay':'WebRTC';
      for(const item of this.pending.values()){item.sentAt=0;item.created=Date.now();}
      if(this.everConnected){this.owner.hooks.status('Connected!');this.owner.hooks.resumed?.();}
      else {this.everConnected=true;this.owner.hooks.connected();}
      for(const frame of this.early.splice(0))this.packet(frame);
      this.flush();
    }
  }
  armTimeout(ms,fn){
    clearTimeout(this.deadline);
    this.deadline=setTimeout(()=>{
      if(this.closed)return;
      const remaining=typeof multiplayerRecoveryRemaining==='function'?multiplayerRecoveryRemaining(this.owner):0;
      if(remaining>0)this.armTimeout(remaining,fn);else fn();
    },ms);
  }
  async startRtc(m) {
    const epoch=this.epoch;
    const provider=m.provider==='metered'?'metered':'unknown';
    for(const server of m.iceServers || []) {
      for(const url of Array.isArray(server.urls)?server.urls:[server.urls])if(typeof url==='string' && /^turns?:/.test(url)) {
        // Unattributed URLs stay generic, including old candidates which can
        // survive an ICE restart from a Worker without provider metadata.
        const previous=this.turnProviders.get(url);
        if(this.turnProviders.size<128 || this.turnProviders.has(url))this.turnProviders.set(url,previous && previous!==provider?'unknown':provider);
      }
    }
    this.recovering=Boolean(m.restart);
    // Both direct families and one provider's TURN transports share a checklist.
    // Restart keeps the same channels and gameplay sequence space.
    if(m.restart && [this.rtcControl,this.rtcData].some(c=>c?.readyState==='closed'))this.dropRtc();
    if(!this.peer && typeof RTCPeerConnection==='function') {
      try {
        const peer=this.peer=new RTCPeerConnection({iceServers:m.iceServers,iceTransportPolicy:'all'});
        this.owner.peer=peer;
        this.owner.hooks.peerChanged?.(peer);
        if(!this.initializedGame){this.initializedGame=true;this.owner.hooks.peer(peer);}
        peer.onconnectionstatechange=()=>this.rtcState();
        peer.oniceconnectionstatechange=()=>this.rtcState();
        if(this.owner.role==='host') {
          this.wire(peer.createDataChannel('pong-lan-input-v1',{ordered:false,maxRetransmits:1}),false);
          this.wire(peer.createDataChannel('pong-control-v1'),true);
        } else peer.ondatachannel=e=>{
          if(e.channel.label==='pong-lan-input-v1')this.wire(e.channel,false);
          else if(e.channel.label==='pong-control-v1')this.wire(e.channel,true);
          else e.channel.close();
        };
      } catch {this.dropRtc();}
    }
    if(!this.initializedGame){this.initializedGame=true;this.owner.hooks.peer(null);}
    this.armTimeout(m.restart?12000:20000,()=>{
      // A selected ICE path may still be finishing DTLS/channel setup. Give that
      // path a bounded grace interval instead of replacing it at the ICE deadline.
      if(this.peer && ['connected','completed'].includes(this.peer.iceConnectionState) && !this.readySent)
        this.armTimeout(12000,()=>this.rtcFailed());
      else this.rtcFailed();
    });
    const peer=this.peer;
    if(!peer){this.rtcFailed();return;}
    if(m.restart) {
      try{peer.setConfiguration({iceServers:m.iceServers,iceTransportPolicy:'all'});}catch{this.rtcFailed();return;}
    }
    this.localEpoch=-1;this.localCandidates=[];
    peer.onicecandidate=e=>{
      if(this.closed || this.peer!==peer || this.epoch!==epoch)return;
      // Null has no ufrag: only forward an end marker from completed current
      // gathering, never one queued while installing a restarted description.
      if(!e.candidate && (this.localEpoch!==epoch || peer.iceGatheringState!=='complete'))return;
      const c=e.candidate?e.candidate.toJSON():null;
      if(this.localEpoch!==epoch){if(this.localCandidates.length<128)this.localCandidates.push(c);return;}
      this.sendCandidate(c);
    };
    this.remoteEpoch=-1;
    if(this.owner.role==='host') {
      try {
        await peer.setLocalDescription(await peer.createOffer(m.restart?{iceRestart:true}:undefined));
        if(!this.closed && this.peer===peer && this.epoch===epoch)this.publishDescription(peer,epoch);
      } catch {this.rtcFailed();}
    }
    this.maybeReady();
  }
  publishDescription(peer,epoch) {
    this.localEpoch=epoch;
    this.signal('description',{value:peer.localDescription.toJSON()});
    for(const candidate of this.localCandidates.splice(0))this.sendCandidate(candidate);
  }
  sendCandidate(candidate) {
    // A late event from the previous ICE generation must not poison a restart.
    const ufrag=this.peer?.localDescription?.sdp.match(/(?:^|\r?\n)a=ice-ufrag:([^\r\n]+)/)?.[1];
    if(candidate?.usernameFragment && ufrag && candidate.usernameFragment!==ufrag)return;
    this.signal('candidate',{value:candidate});
  }
  wire(channel,control) {
    if(control)this.rtcControl=channel;else this.rtcData=channel;
    channel.onopen=()=>this.maybeReady();
    channel.onclose=channel.onerror=()=>{if(this.mode==='rtc'&&!this.closed)this.rtcFailed();};
    channel.onmessage=e=>{
      if(this.mode!=='rtc'||this.closed)return;
      if(typeof e.data!=='string'||e.data.length>24000){this.fail();return;}
      try{this.packet(JSON.parse(e.data));}catch{this.fail();}
    };
  }
  rtcState() {
    if(this.closed || this.mode!=='rtc' || !this.peer)return;
    if(this.peer.connectionState==='failed'||this.peer.iceConnectionState==='failed')this.rtcFailed();
    else if(this.peer.connectionState==='connected' && ['connected','completed'].includes(this.peer.iceConnectionState)) {
      clearTimeout(this.disconnectTimer);this.disconnectTimer=null;
      if(this.temporaryDisconnect && this.requestedEpoch!==this.epoch){this.temporaryDisconnect=false;this.phase='active';this.owner.hooks.resumed?.();this.flush();}
      else this.maybeReady();
    } else if((this.peer.connectionState==='disconnected'||this.peer.iceConnectionState==='disconnected')&&!this.disconnectTimer) {
      this.temporaryDisconnect=this.phase==='active';this.freeze();this.disconnectTimer=setTimeout(()=>{this.disconnectTimer=null;this.rtcFailed();},3000);
    }
  }
  rtcFailed() {
    if(this.closed || this.mode!=='rtc' || this.requestedEpoch===this.epoch)return;
    if(!this.keyReady){this.rtcFailurePending=true;return;}
    this.requestedEpoch=this.epoch;this.temporaryDisconnect=false;this.freeze();
    this.owner.hooks.status('Connection interrupted. Reconnecting...');
    this.signal(this.recovering?'fallback':'restart');
    this.armTimeout(15000,()=>this.fail());
  }
  maybeReady() {
    if(this.closed || !this.keyReady || this.readySent || this.phase!=='negotiating')return;
    if(this.mode==='rtc' && (this.peer?.connectionState!=='connected' ||
      this.peer.iceConnectionState && !['connected','completed'].includes(this.peer.iceConnectionState) ||
      this.rtcData?.readyState!=='open' || this.rtcControl?.readyState!=='open' || this.remoteEpoch!==this.epoch))return;
    this.readySent=true;this.signal('ready',{mode:this.mode});
  }
  freeze() {
    if(this.phase==='active'||this.everConnected)this.owner.hooks.interrupted?.();
    this.phase='negotiating';this.latest=null;
  }
  bufferedAmount() {
    return this.mode==='ws' ? this.owner.socket?.bufferedAmount||0 : Math.max(this.rtcControl?.bufferedAmount||0,this.rtcData?.bufferedAmount||0);
  }
  enqueue(raw,control) {
    if(this.closed||this.phase!=='active')throw Error('transport unavailable');
    if(typeof raw!=='string'||new TextEncoder().encode(raw).length>SECURE_MAX_PLAINTEXT-128)throw Error('packet limit');
    if(control) {
      if(this.pending.size>=32||[...this.pending.values()].reduce((n,v)=>n+v.raw.length,raw.length)>65536){this.fail();return;}
      this.pending.set(++this.controlId,{raw,sentAt:0,created:Date.now()});
    } else {this.latest=raw;this.latestAt=Date.now();} // Only the newest unsent snapshot/input is useful.
    this.flush();
  }
  async flush() {
    if(this.closed||this.flushing||this.phase!=='active'||!this.keyReady)return;
    this.flushing=true;
    try {
      let budget=8;
      while(budget-- && !this.closed && this.phase==='active') {
        if(this.bufferedAmount()>32768) {
          this.blockedAt ||= Date.now();if(Date.now()-this.blockedAt>8000)this.fail();break;
        }
        this.blockedAt=0;
        const now=Date.now(), entry=[...this.pending].find(([,p])=>now-p.sentAt>=500);
        let lane,value;
        if(this.ackPending){lane='a';value={ack:this.receivedControl};this.ackPending=false;}
        else if(entry){lane='c';value={id:entry[0],raw:entry[1].raw};entry[1].sentAt=now;if(now-entry[1].created>12000 && !this.owner.presence?.suspended){this.fail();break;}}
        else if(this.latest!==null&&this.latest!==undefined){
          if(now-this.latestAt>250){this.latest=null;continue;}
          lane='d';value={raw:this.latest};this.latest=null;
        }
        else break;
        const epoch=this.epoch, frame=await this.crypto.seal(epoch,lane,value);
        if(this.closed)break;
        if(epoch!==this.epoch||this.phase!=='active')continue;
        const text=JSON.stringify(frame);
        if(this.mode==='ws')this.owner.socket.send(text);
        else (lane==='d'?this.rtcData:this.rtcControl).send(text);
      }
    } catch {this.fail();} finally {this.flushing=false;}
  }
  packet(frame) {
    if(this.closed||frame.session!==this.id||frame.epoch!==this.epoch)return;
    if(this.phase==='preparing'){if(this.early.length>=16)this.fail();else this.early.push(frame);return;}
    if(this.phase!=='active')return;
    if(++this.rxCount>64){this.fail();return;}
    this.rx=this.rx.then(async()=>{
      if(this.closed||frame.epoch!==this.epoch||this.phase!=='active')return;
      // Old datagrams can arrive after newer reliable controls. Reject them
      // without tearing down an otherwise healthy connection; never deliver twice.
      if(Number.isSafeInteger(frame.seq) && (this.crypto.seen.has(frame.seq)||frame.seq<=this.crypto.high-256))return;
      const value=await this.crypto.open(frame,this.epoch);
      if(this.closed||frame.epoch!==this.epoch||this.phase!=='active')return;
      if(this.mode==='ws' && Number.isSafeInteger(frame.ticket))this.creditTicket=Math.max(this.creditTicket||0,frame.ticket);
      if(frame.lane==='a') {
        if(!Number.isSafeInteger(value.ack)||value.ack<0||value.ack>this.controlId)throw Error('ack');
        for(const id of this.pending.keys())if(id<=value.ack)this.pending.delete(id);
      } else if(frame.lane==='c') {
        if(!Number.isSafeInteger(value.id)||value.id<1||value.id>this.receivedControl+32||typeof value.raw!=='string')throw Error('control');
        if(value.id>this.receivedControl)this.reorder.set(value.id,value.raw);
        while(this.reorder.has(this.receivedControl+1)) {
          const id=++this.receivedControl,raw=this.reorder.get(id);this.reorder.delete(id);this.owner.hooks.message(raw);
        }
        this.ackPending=true;this.flush();
      } else {
        if(typeof value.raw!=='string')throw Error('data');
        this.owner.hooks.message(value.raw);
      }
    }).catch(()=>this.fail()).finally(()=>this.rxCount--);
  }
  credit() {
    if(this.closed||this.mode!=='ws'||this.phase!=='active'||!this.creditTicket)return;
    this.owner.send({type:'secure-credit',session:this.id,epoch:this.epoch,ticket:this.creditTicket});this.creditTicket=0;
  }
  dropRtc() {
    const peer=this.peer;this.peer=null;this.owner.peer=null;
    this.owner.hooks.peerChanged?.(null);
    for(const c of [this.rtcControl,this.rtcData])if(c){c.onclose=c.onerror=c.onopen=c.onmessage=null;c.close();}
    if(peer){peer.onicecandidate=peer.ondatachannel=peer.onconnectionstatechange=peer.oniceconnectionstatechange=null;peer.close();}
    this.rtcData=this.rtcControl=null;
  }
  close() {
    if(this.closed)return;this.closed=true;this.dropRtc();this.crypto.close();
    clearInterval(this.pumpTimer);clearTimeout(this.keyTimer);clearTimeout(this.deadline);clearTimeout(this.disconnectTimer);
    this.pending.clear();this.reorder.clear();this.latest=null;this.early=[];
  }
}
