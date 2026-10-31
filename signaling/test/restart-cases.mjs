import assert from 'node:assert/strict';

// Exercise consent through real controls on the existing connected page pairs.
// These pairs cover direct RTC, encrypted WebSockets and offline native LAN.
export async function restartChecks(host, guest, label) {
  for (const p of [host, guest]) {
    await p.waitForFunction(() => onlineRematchReady && onlineSession.rematch.phase === 'playing');
    await p.evaluate(() => {
      window.restartSession = onlineSession;
      window.restartOriginalStart = startLevel;
      window.restartResets = 0;
      startLevel = (...args) => { restartResets++; return restartOriginalStart(...args); };
    });
  }
  const firstRound = await host.evaluate(() => multiplayerRematch().round);
  const request = async (sender, receiver) => {
    await sender.locator('#menuToggle').click();
    await sender.locator('#restartButton').click();
    await Promise.all([sender, receiver].map(p => p.locator('#multiplayerRestartPrompt').waitFor({state: 'visible'})));
    assert.equal(await sender.locator('#multiplayerRestartAccept').isVisible(), false);
    assert.equal(await receiver.locator('#multiplayerRestartAccept').isVisible(), true);
    for (const p of [sender, receiver]) {
      assert.equal(await p.evaluate(() => byId('game').inert), true, label + ': restart consent blocks gameplay input');
    }
    assert.equal(await receiver.evaluate(() => {
      // A queued activation of a covered exit must not replace the consent dialog.
      titleJumpButton.click();
      return !multiplayerLeaveRequest && royalInputModal() === byId('multiplayerRestartPrompt');
    }), true, label + ': restart guards run before exit navigation');
  };

  await request(host, guest);
  const scores = await host.evaluate(() => [left.score, right.score]);
  await guest.locator('#multiplayerRestartDecline').click();
  for (const p of [host, guest]) {
    await p.waitForFunction(() => !onlineSession.rematch.restart);
    assert.equal(await p.locator('#multiplayerRestartPrompt').isVisible(), false);
    assert.equal(await p.evaluate(() => restartResets), 0, label + ': rejection never resets the match');
    assert.deepEqual(await p.evaluate(() => [left.score, right.score]), scores);
  }

  for (const [index, sender, receiver] of [[0, guest, host], [1, host, guest]]) {
    await request(sender, receiver);
    await receiver.locator('#multiplayerRestartAccept').click();
    for (const p of [host, guest]) {
      await p.waitForFunction(round => onlineSession.rematch.round === round &&
        onlineSession.rematch.phase === 'playing' && !onlineSession.rematch.restart, firstRound + index + 1);
      assert.deepEqual(await p.evaluate(() => [left.score, right.score]), [0, 0]);
      assert.equal(await p.evaluate(() => onlineSession === restartSession && lanConnected), true);
      assert.equal(await p.locator('#matchSetup').isVisible(), false, label + ': restart stays in the arena');
      assert.equal(await p.locator('#multiplayerRestartPrompt').isVisible(), false);
      assert.equal(await p.evaluate(() => byId('game').inert), false, label + ': restart releases modal input isolation');
    }
    assert.equal(await host.evaluate(() => restartResets), index + 1, label + ': host resets exactly once');
    assert.equal(await guest.evaluate(() => restartResets), 0, label + ': guest consumes the authoritative reset');
    await Promise.all([host, guest].map(p => p.waitForFunction(() => !waitingForServe, null, {timeout: 5000})));
  }
  for (const p of [host, guest]) await p.evaluate(() => { startLevel = restartOriginalStart; });
  await host.evaluate(() => { paused = true; sendLanState(true); });
  console.log('PASS: ' + label + ' rendered restart rejection, both request roles, host-only resets and connection reuse');
}
