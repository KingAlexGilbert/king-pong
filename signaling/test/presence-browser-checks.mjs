import assert from 'node:assert/strict';

// Production packets and real DOM lifecycle dispatch; visibility is simulated.
// This does not emulate Android's process suspension or certify physical radios.
export async function presenceBrowserChecks(host, guest, label) {
  for (const p of [host, guest]) {
    await p.waitForFunction(() => Boolean(multiplayerPresence()));
    await p.evaluate(() => {
      window.presenceSession = onlineSession;
      window.presenceTransport = onlineSession.secure || lanPeer;
      window.simulatedHidden = false;
      Object.defineProperty(document, 'hidden', {configurable: true, get: () => window.simulatedHidden});
      window.changeVisibility = hidden => {
        // Android can blur before notifying visibility; either order must work.
        if (hidden) window.dispatchEvent(new Event('blur'));
        window.simulatedHidden = hidden;
        document.dispatchEvent(new Event('visibilitychange'));
        if (!hidden) window.dispatchEvent(new Event('focus'));
      };
    });
  }
  // Advisory RTC changes must not start a recovery epoch while channels work.
  if(await host.evaluate(()=>onlineSession.secure?.mode==='rtc')) {
    const before=await host.evaluate(()=>multiplayerPresence().epoch);
    for(let i=0;i<3;i++) {
      await host.evaluate(()=>{const peer=onlineSession.secure.peer;
        Object.defineProperty(peer,'connectionState',{configurable:true,value:'disconnected'});
        Object.defineProperty(peer,'iceConnectionState',{configurable:true,value:'disconnected'});
        onlineSession.secure.rtcState();onlineSession.secure.rtcState();});
      await host.waitForTimeout(150);
      assert.equal(await host.evaluate(()=>multiplayerSuspended()),false);
      await host.evaluate(()=>{const peer=onlineSession.secure.peer;
        Object.defineProperty(peer,'connectionState',{configurable:true,value:'connected'});
        Object.defineProperty(peer,'iceConnectionState',{configurable:true,value:'connected'});
        onlineSession.secure.rtcState();});
    }
    assert.equal(await host.evaluate(()=>multiplayerPresence().epoch),before,'jitter creates no recovery/countdown');
  }
  for (const interrupted of [host, guest]) {
    await host.evaluate(() => {
      startLevel(); waitingForServe = false; paused = false; gameWindowFocused = true;
      ball.x = W / 2; ball.y = H / 2; ball.vx = 1; ball.vy = 0; sendLanState(true);
      setMenusVisible(false);
    });
    await guest.waitForFunction(() => !paused && !waitingForServe);
    await interrupted.evaluate(() => window.changeVisibility(true));
    await Promise.all([host, guest].map(p => p.waitForFunction(() => multiplayerSuspended())));
    const stopped = await host.evaluate(() => JSON.stringify([frame, left.score, right.score, ball]));
    await host.waitForTimeout(600);
    assert.equal(await host.evaluate(() => JSON.stringify([frame, left.score, right.score, ball])), stopped,
      label + ': host simulation stops, including when the guest is hidden');
    assert.equal(await (interrupted === host ? guest : host).locator('#multiplayerUnavailable').isVisible(), true);
    for (const p of [host,guest]) {
      assert.equal(await p.locator('#multiplayerUnavailable').isVisible(),true,'both peers keep the HUD visible after blur-before-hide');
      assert.equal(await p.locator('#matchMenu').isVisible(),false,'backgrounding does not open a menu');
      assert.equal(await p.locator('#multiplayerUnavailable').getAttribute('role'),'status');
      const fits=await p.evaluate(()=>{const status=byId('multiplayerUnavailable').getBoundingClientRect(),arena=canvas.getBoundingClientRect();
        return status.height<55 && status.bottom<=arena.top+1 && royalActiveDialog()?.id!=='multiplayerUnavailable';});
      assert.equal(fits,true,'compact HUD status reserves space and does not trap focus');
      await p.evaluate(()=>showTitleScreen());
      assert.equal(await p.locator('#multiplayerLeave').isVisible(),true,'departure also protected during suspension');
      await p.locator('#multiplayerStay').click();
      assert.equal(await p.evaluate(()=>multiplayerSuspended()&&onlineSession===window.presenceSession),true);
    }
    const epoch = await host.evaluate(() => multiplayerPresence().epoch);
    await interrupted.evaluate(() => {window.changeVisibility(true);window.changeVisibility(false)});
    await Promise.all([host, guest].map(p => p.waitForFunction(() => !multiplayerSuspended() && hasResumeCountdown())));
    assert.equal(await host.evaluate(() => multiplayerPresence().epoch), epoch, 'one recovery epoch');
    assert.ok(await host.evaluate(() => resumeCountdownRemainingMs() > 2000));
    const snapshot = await host.evaluate(() => {
      const send=window.lanSend;let state;window.lanSend=m=>{if(m.type==='state')state=m;};sendLanState(true);window.lanSend=send;
      return {...state,presenceEpoch:multiplayerPresence().epoch,round:multiplayerRematch().round};
    });
    assert.equal(await guest.evaluate(state => {
      state.presenceEpoch--;state.seq+=10000;
      const previous=lanLastStateSeq;
      handleLanMessage(JSON.stringify(state));
      return lanLastStateSeq===previous;
    }, snapshot),true,'stale snapshot cannot advance the sequence after recovery');
    for (const p of [host, guest]) assert.equal(await p.evaluate(() => onlineSession === window.presenceSession &&
      (onlineSession.secure || lanPeer) === window.presenceTransport), true, 'same authenticated connection');
    // Keep this fixture short; countdown execution itself is covered by serve checks.
    await host.evaluate(() => {resumeCountdownEndAt=0;paused=true;sendLanState(true)});
    await guest.waitForFunction(() => paused && !hasResumeCountdown());
  }
  // Desktop focus-only changes and either visibility/focus order must use
  // the same handshake. Exercise real production event handlers, not just APIs.
  for (const interrupted of [host,guest]) for (const order of ['focus-only','focus-first','visibility-only','visibility-first']) {
    await host.evaluate(() => {paused=false;waitingForServe=false;resumeCountdownEndAt=0;ball.vx=ball.vy=0;sendLanState(true)});
    await guest.waitForFunction(() => !paused);
    await interrupted.evaluate(order => {
      window.dispatchEvent(new Event('blur'));
      if(order!=='focus-only') {window.simulatedHidden=true;document.dispatchEvent(new Event('visibilitychange'));}
    }, order);
    await Promise.all([host,guest].map(p=>p.waitForFunction(()=>multiplayerSuspended())));
    const before=await host.evaluate(()=>JSON.stringify([left.score,right.score,ball.x,ball.y,left.y,right.y,royalPickup,royalSplitBall,royalGuards]));
    await interrupted.evaluate(order => {
      if(order==='focus-first')window.dispatchEvent(new Event('focus'));
      if(order!=='focus-only') {
        window.simulatedHidden=false;
        const focused=document.hasFocus;document.hasFocus=()=>false;
        document.dispatchEvent(new Event('visibilitychange'));document.hasFocus=focused;
      }
      if(order!=='visibility-only')window.dispatchEvent(new Event('focus'));
    }, order);
    await Promise.all([host,guest].map(p=>p.waitForFunction(()=>!multiplayerSuspended()&&hasResumeCountdown())));
    assert.equal(await host.evaluate(()=>JSON.stringify([left.score,right.score,ball.x,ball.y,left.y,right.y,royalPickup,royalSplitBall,royalGuards])),before);
    const end=await host.evaluate(()=>resumeCountdownEndAt);
    await interrupted.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pageshow'));});
    await host.waitForTimeout(80);
    assert.equal(await interrupted.evaluate(()=>gameWindowFocused),true,'visible return releases input even when hasFocus lags');
    assert.equal(await host.evaluate(()=>resumeCountdownEndAt),end,'duplicate return events preserve the countdown');
    assert.equal(await host.locator('#multiplayerDisconnected').isVisible(),false,'temporary absence is not terminal');
  }
  // A deliberate pause, including one made by opening Menu, survives return.
  for (const menu of [false,true]) {
    await host.evaluate(menu=>{resumeCountdownEndAt=0;paused=true;setMenusVisible(menu);sendLanState(true)},menu);
    await guest.waitForFunction(()=>paused&&!hasResumeCountdown());
    await guest.evaluate(()=>window.changeVisibility(true));
    await host.waitForFunction(()=>multiplayerSuspended());
    await guest.evaluate(()=>window.changeVisibility(false));
    await Promise.all([host,guest].map(p=>p.waitForFunction(()=>!multiplayerSuspended())));
    assert.equal(await host.evaluate(()=>paused&&!hasResumeCountdown()),true,'explicit pause remains paused');
    assert.equal(await host.locator('#matchMenu').isVisible(),menu,'existing menu is preserved');
  }
  for (const p of [host,guest]) {
    assert.equal(await p.locator('#multiplayerUnavailable').isVisible(),false);
    const before=await p.evaluate(()=>[paused,multiplayerPresence().epoch]);
    await p.evaluate(()=>showTitleScreen());await p.locator('#multiplayerStay').click();
    assert.deepEqual(await p.evaluate(()=>[paused,multiplayerPresence().epoch]),before,'Stay does not pause or start recovery');
    await p.evaluate(() => {delete document.hidden;gameWindowFocused=true;setMenusVisible(false)});
  }
  console.log('PASS: ' + label + ' host/guest visibility, mutual pause, fresh state, stale-packet fence and connection reuse');
}

// Observe actual application sends, including native bridge commands. The
// physical TURN/socket teardown remains a native-device verification item.
export async function watchSessionShutdown(page) {
  await page.evaluate(() => {
    const session = onlineSession;
    window.shutdownSession = session;
    window.shutdownSends = [];
    const track = (object, name, label) => {
      if (!object?.[name]) return;
      const original = object[name];
      object[name] = function(...args) { window.shutdownSends.push(label); return original.apply(this, args); };
    };
    track(session.socket, 'send', 'signaling/ws');
    track(matchmakingSocket, 'send', 'queue');
    track(session.secure?.rtcControl || session.control, 'send', 'rtc-control');
    track(session.secure?.rtcData || session.data, 'send', 'rtc-data');
    track(window, 'nativeLanCommand', 'native-lan');
    window.shutdownStaleOpen = session.socket?.onopen;
    window.shutdownStaleReceive = session.socket?.onmessage;
    window.shutdownStaleConnected = session.hooks.connected;
    window.shutdownStaleResume = session.hooks.resumed;
    const end = endMultiplayerSession;
    window.endMultiplayerSession = (...args) => {
      if (!multiplayerDisconnect && onlineSession) window.shutdownFinalState = JSON.stringify([left.score, right.score, left.y, right.y, ball, royalPickup, royalSplitBall, royalGuards]);
      return end(...args);
    };
  });
}

export async function disconnectedBrowserChecks(page, origin) {
  await page.locator('#multiplayerDisconnected').waitFor({state:'visible'});
  assert.equal(await page.locator('#multiplayerDisconnectedTitle').textContent(), 'Your opponent disconnected');
  assert.equal(await page.locator('#multiplayerReturn').textContent(), 'Return to Menu');
  assert.equal(await page.locator('#matchSetup').isVisible(), false, 'no automatic navigation');
  assert.equal(await page.evaluate(() => !onlineSession && !lanConnected && paused && onlineGameBlocked &&
    !matchmakingSocket && shutdownSession.closed && !shutdownSession.presence &&
    (!shutdownSession.secure || shutdownSession.secure.closed) &&
    (!shutdownSession.socket || shutdownSession.socket.readyState === 3)), true, 'shutdown finishes before popup');
  const count = await page.evaluate(() => shutdownSends.length);
  await page.evaluate(async () => {
    tickMultiplayerPresence(); tickMultiplayerRematch(); tickOnlineMatchFlow();
    observeMatchmaking(); sendLanState(true); sendLanInput([], true);
    shutdownStaleOpen?.(); shutdownStaleReceive?.({data:'pong'});
    shutdownStaleConnected?.(); shutdownStaleResume?.();
    shutdownSession.send({type:'connected'});
    await shutdownSession.receive({type:'start',attempt:1,iceServers:[]});
    await shutdownSession.secure?.flush(); shutdownSession.secure?.credit();
    document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus'));
    byId('matchPause').click(); byId('menuToggle').click();
    endMultiplayerSession();
  });
  await page.keyboard.press('Escape'); await page.keyboard.press('m'); await page.keyboard.press('2');
  await page.locator('#multiplayerDisconnected').click({position:{x:2,y:2}});
  await page.waitForTimeout(2100); // Cross the normal presence-probe interval.
  assert.equal(await page.evaluate(() => shutdownSends.length), count, 'no session sends after popup, including stale callbacks');
  assert.equal(await page.evaluate(() => JSON.stringify([left.score, right.score, left.y, right.y, ball, royalPickup, royalSplitBall, royalGuards])),
    await page.evaluate(() => shutdownFinalState), 'final arena state remains unchanged');
  assert.equal(await page.locator('#multiplayerDisconnected').isVisible(), true, 'only acknowledgement dismisses');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'multiplayerReturn');
  await page.locator('#multiplayerReturn').click();
  assert.equal(await page.locator(origin === 'lan' ? '#classicLanDialog' : '#matchSetup').isVisible(), true);
  if (origin === 'private') assert.equal(await page.locator('#onlinePrivateRooms').isVisible(), true);
  assert.equal(await page.evaluate(() => !multiplayerDisconnect && !onlineSession && !matchmakingSocket), true, 'return does not start networking');
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => shutdownSends.length), count);
  console.log('PASS '+origin+' terminal shutdown, frozen modal, zero subsequent application sends and acknowledged return');
}
