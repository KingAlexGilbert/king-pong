// Room-scoped transport coordination. Gameplay is opaque authenticated ciphertext.
// The hot path uses hibernating socket attachments, never durable gameplay storage.
const send = (s,m) => { try { s.send(JSON.stringify(m)); } catch {} };
const STUN = [{urls:'stun:stun.cloudflare.com:3478'}];
export class SecureRoomTransport {
  constructor(ctx,env) { this.ctx = ctx; this.env = env; }
  async iceServers() {
    let timer;
    try {
      const servers=await Promise.race([
        this.env.TURN_CREDENTIALS.get(this.env.TURN_CREDENTIALS.idFromName('metered')).fetch('https://turn/ice').then(async r=>r.ok?await r.json():[]),
        new Promise(resolve=>{timer=setTimeout(()=>resolve([]),1500);})
      ]);
      return [...STUN,...(Array.isArray(servers)?servers:[])];
    } catch {return STUN;} finally {clearTimeout(timer);}
  }
  async selectIce(state) {
    state.provider='metered';
    state.iceServers=await this.iceServers();
  }
  sockets(id) { return this.ctx.getWebSockets().filter(s => { const a=s.deserializeAttachment(); return !a?.closed && a?.secure?.id === id; }); }
  update(state) {
    for (const s of this.sockets(state.id)) {
      const a=s.deserializeAttachment();
      s.serializeAttachment({...a,secure:{...a.secure,epoch:state.epoch,mode:state.mode,active:state.phase==='active',out:[],outBytes:0}});
    }
  }
  broadcast(state,m) { for (const s of this.sockets(state.id)) send(s,{type:'secure',session:state.id,epoch:state.epoch,...m}); }
  async begin(sockets,save) {
    const state={id:crypto.randomUUID(),epoch:0,mode:'rtc',phase:'negotiating',keys:{},ready:{},prepared:{},restarts:0};
    for (let i=0;i<sockets.length;i++) {
      const s=sockets[i], a=s.deserializeAttachment();
      s.serializeAttachment({...a,retiredSecureId:null,secure:{id:state.id,role:i===0?'host':'guest',epoch:0,mode:'rtc',active:false,
        high:0,out:[],outBytes:0,ticket:0,windowAt:Date.now(),count:0,bytes:0}});
    }
    await save(state);
    // Key exchange starts immediately and overlaps the bounded credential lookup.
    this.broadcast(state,{kind:'init'});
    await this.selectIce(state);
    await save(state);
    this.broadcast(state,{kind:'rtc',iceServers:state.iceServers,provider:state.provider});
  }
  async control(socket,m,state,save,end,active) {
    const a=socket.deserializeAttachment(), role=a.secure?.role;
    if (!state || !role || a.closed || m.session!==state.id || m.epoch!==state.epoch) return;
    const other=this.sockets(state.id).find(s=>s!==socket);
    if (!other) return;
    const fail=()=>end('negotiation_failed');
    if (m.kind==='key') {
      if (state.keys[role] || !/^04[a-f0-9]{128}$/.test(m.value?.key||'') || !/^[a-f0-9]{32}$/.test(m.value?.nonce||'') ||
        m.value.mac!==undefined && !/^[a-f0-9]{64}$/.test(m.value.mac)) return fail();
      state.keys[role]='sent'; await save(state);
      send(other,{type:'secure',session:state.id,epoch:state.epoch,kind:'key',value:{key:m.value.key,nonce:m.value.nonce,...(m.value.mac?{mac:m.value.mac}:{})}}); return;
    }
    if (m.kind==='proof') {
      if (!state.keys.host || !state.keys.guest || state.keys[role]!=='sent' || !/^[a-f0-9]{64}$/.test(m.value||'')) return fail();
      state.keys[role]='proof'; await save(state);
      send(other,{type:'secure',session:state.id,epoch:state.epoch,kind:'proof',value:m.value}); return;
    }
    if (m.kind==='key-ready') {
      if (state.keys[role]!=='proof') return fail();
      state.keys[role]='ready'; await save(state);
      if(state.keys.host==='ready' && state.keys.guest==='ready')this.broadcast(state,{kind:'keys-ready'});
      return;
    }
    if (m.kind==='description' || m.kind==='candidate') {
      if (state.mode!=='rtc' || !['negotiating','active'].includes(state.phase)) return;
      if (m.kind==='description') {
        if (m.value?.type!==(role==='host'?'offer':'answer') || typeof m.value.sdp!=='string' || m.value.sdp.length>49152) return fail();
        if (state[role+'Description']===state.epoch) return;
        state[role+'Description']=state.epoch; await save(state);
        send(other,{type:'secure',session:state.id,epoch:state.epoch,kind:m.kind,value:{type:m.value.type,sdp:m.value.sdp}});
      } else {
        const c=m.value;
        if (c!==null && (!c || typeof c.candidate!=='string' || c.candidate.length>2048 ||
          !(c.sdpMid===null || typeof c.sdpMid==='string' && c.sdpMid.length<257) ||
          !(c.sdpMLineIndex===null || Number.isInteger(c.sdpMLineIndex) && c.sdpMLineIndex>=0 && c.sdpMLineIndex<16) ||
          c.usernameFragment!==undefined && c.usernameFragment!==null && (typeof c.usernameFragment!=='string' || c.usernameFragment.length>256))) return fail();
        send(other,{type:'secure',session:state.id,epoch:state.epoch,kind:m.kind,value:c===null?null:
          {candidate:c.candidate,sdpMid:c.sdpMid,sdpMLineIndex:c.sdpMLineIndex,usernameFragment:c.usernameFragment}});
      }
      return;
    }
    if (m.kind==='restart') {
      if (state.mode!=='rtc' || state.phase==='preparing') return;
      if (state.restarts>=3) return this.fallback(state,save);
      state.restarts++; state.epoch++; state.ready={}; state.prepared={}; state.phase='negotiating';
      // The credential cache may have recovered since the first attempt.
      await this.selectIce(state);
      await save(state); this.update(state);
      this.broadcast(state,{kind:'rtc',iceServers:state.iceServers,provider:state.provider,restart:true}); return;
    }
    if (m.kind==='fallback') {
      if (state.mode!=='rtc' || !state.restarts || state.phase==='preparing') return;
      return this.fallback(state,save);
    }
    if (m.kind==='ready') {
      if (m.mode!==state.mode || state.phase!=='negotiating' || state.keys[role]!=='ready') return;
      state.ready[role]=true;
      if (state.ready.host && state.ready.guest) { state.phase='preparing'; state.prepared={}; }
      await save(state);
      if (state.phase==='preparing') this.broadcast(state,{kind:'prepare',mode:state.mode});
      return;
    }
    if (m.kind==='prepared') {
      if (m.mode!==state.mode || state.phase!=='preparing') return;
      state.prepared[role]=true;
      if (state.prepared.host && state.prepared.guest) state.phase='active';
      await save(state);
      if (state.phase==='active') {
        this.update(state);
        // Both receivers are armed before either peer may emit gameplay.
        this.broadcast(state,{kind:'activate',mode:state.mode}); await active();
      }
      return;
    }
    return fail();
  }
  async fallback(state,save) {
    state.epoch++; state.mode='ws'; state.phase='negotiating'; state.ready={}; state.prepared={};
    await save(state); this.update(state); this.broadcast(state,{kind:'ws'});
  }
  frame(socket,m) {
    const a=socket.deserializeAttachment(), t=a?.secure;
    if (!a || a.closed || !['secure-frame','secure-credit'].includes(m.type)) return false;
    const now=Date.now();
    const budget=a.relayBudget || {at:now,count:0,bytes:0};
    if(now-budget.at>=1000){budget.at=now;budget.count=0;budget.bytes=0;}
    budget.count++;budget.bytes+=typeof m.body==='string'?m.body.length:128;
    a.relayBudget=budget;socket.serializeAttachment(a);
    if(budget.count>220 || budget.bytes>550000)return false;
    // Packets already queued in TCP before a kick/departure may arrive later.
    // A bounded tombstone keeps those from destroying the retained host room.
    if(!t)return m.session===a.retiredSecureId ? 'stale' : false;
    if(m.session!==t.id || m.epoch!==t.epoch)return 'stale';
    if(!t.active || t.mode!=='ws')return false;
    if (m.type==='secure-credit') {
      if (!Number.isSafeInteger(m.ticket) || m.ticket<0 || m.ticket>t.ticket) return false;
      t.out=t.out.filter(item=>item.ticket>m.ticket); t.outBytes=t.out.reduce((n,item)=>n+item.bytes,0);
      socket.serializeAttachment(a); return true;
    }
    if (!['d','c','a'].includes(m.lane) || !Number.isSafeInteger(m.seq) || m.seq<=t.high ||
      typeof m.body!=='string' || m.body.length<24 || m.body.length>23000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(m.body)) return false;
    if (now-t.windowAt>=1000) { t.windowAt=now; t.count=0; t.bytes=0; }
    t.count++; t.bytes+=m.body.length;
    if (t.count>180 || t.bytes>512000) return false;
    t.high=m.seq; socket.serializeAttachment(a);
    const other=this.sockets(t.id).find(s=>s!==socket), b=other?.deserializeAttachment(), r=b?.secure;
    if (!r || !r.active || r.mode!=='ws' || r.epoch!==t.epoch) return false;
    // Bounded in-flight window, including runtimes without bufferedAmount.
    // Drop unsent data; reliable controls are acknowledged/retried end to end.
    // Reserve four slots and 16 KiB for controls/acks so snapshots cannot fill
    // the entire window while a receiver is slow.
    if (r.out.length>=(m.lane==='d'?12:16) || r.outBytes+m.body.length>(m.lane==='d'?49152:65536) || (other.bufferedAmount||0)>65536) return true;
    r.out.push({ticket:++r.ticket,bytes:m.body.length}); r.outBytes+=m.body.length;
    other.serializeAttachment(b);
    send(other,{type:'secure-frame',session:t.id,epoch:t.epoch,lane:m.lane,seq:m.seq,body:m.body,ticket:r.ticket});
    return true;
  }
}
