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
  for (const p of [host,guest]) await p.evaluate(() => {delete document.hidden;gameWindowFocused=true;setMenusVisible(false)});
  console.log('PASS: ' + label + ' host/guest visibility, mutual pause, fresh state, stale-packet fence and connection reuse');
}
