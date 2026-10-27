import assert from 'node:assert/strict';

// Reused by existing private, matchmaking and offline-LAN page pairs, including
// every generated platform shell. No additional browser/Worker launch is needed.
export async function rematchChecks(host,guest,label) {
 for(const p of [host,guest])await p.waitForFunction(()=>onlineRematchReady);
 const original=await host.evaluate(()=>({arena:matchArenaId,rules:matchRuleId,powerups:matchPowerupsEnabled,paddles:{...matchPaddles}}));
 for(const p of [host,guest])await p.evaluate(()=>{
   window.rematchSession=onlineSession;window.rematchPeer=lanPeer;window.rematchChannel=lanChannel;
   window.rematchReset=startLevel;window.rematchResets=0;
   window.startLevel=(...args)=>{window.rematchResets++;return window.rematchReset(...args)};
 });
 const first=await host.evaluate(()=>multiplayerRematch().round);
 for(let i=0;i<2;i++) {
   await host.evaluate(round=>{
     paused=false;gameWindowFocused=true;clearPointServeCountdown();waitingForServe=false;
     left.y=20;right.y=390;
     if (round === 0) { left.score=matchRule().goal-1;right.score=2;pointForPlayer(); }
     else { right.score=matchRule().goal-1;left.score=2;pointForCpu(); }
     sendLanState(true);
   },i);
   await Promise.all([host,guest].map(p=>p.locator('#multiplayerResult').waitFor({state:'visible'})));
   for (const [role,p] of [[0,host],[1,guest]]) {
     assert.equal(await p.locator('#multiplayerResultTitle').textContent(),i===role?'YOU WON!':'YOU LOST!',label+': local result');
     const goal=await p.evaluate(()=>matchRule().goal);
     assert.equal(await p.locator('#multiplayerResultScore').textContent(),i===role?`${goal} – 2`:`2 – ${goal}`);
     assert.equal(await p.locator('#multiplayerRematch').isEnabled(),true);
     assert.equal(await p.locator('#multiplayerBack').isEnabled(),true);
   }
   if (i === 0 && process.env.KING_PONG_TEST_ARTIFACTS)
     await host.screenshot({path: process.env.KING_PONG_TEST_ARTIFACTS + '/rematch.png'});
   await guest.evaluate(()=>{sendLanAction('retry');sendLanAction('serve');});
   assert.equal(await host.evaluate(()=>gameOver),true);
   if(i===0) {
     await guest.locator('#multiplayerRematch').focus();
     await guest.keyboard.press('Tab');
     assert.equal(await guest.evaluate(()=>document.activeElement.id),'multiplayerBack');
     await guest.keyboard.press('Shift+Tab');
     await guest.keyboard.press('Enter');
     await host.waitForFunction(()=>multiplayerRematch().remote);
     assert.equal(await host.evaluate(()=>gameOver),true);
     assert.equal(await guest.locator('#multiplayerBack').isEnabled(),true);
     await host.locator('#multiplayerRematch').click();
   } else await Promise.all([host,guest].map(p=>p.locator('#multiplayerRematch').click()));
   await Promise.all([host,guest].map(p=>p.waitForFunction(round=>!gameOver&&multiplayerRematch().round===round,first+i+1)));
   for(const p of [host,guest]) {
     assert.deepEqual(await p.evaluate(()=>[left.score,right.score,royalSplitBall,royalPickup,royalGuards.left,royalGuards.right]),[0,0,null,null,0,0]);
     assert.equal(await p.evaluate(()=>onlineSession===window.rematchSession&&lanPeer===window.rematchPeer&&lanChannel===window.rematchChannel),true,label+': reuse connection');
     assert.equal(await p.locator('#matchSetup').isVisible(),false);
   }
   assert.equal(await host.evaluate(()=>window.rematchResets),i+1);
   assert.equal(await guest.evaluate(()=>window.rematchResets),0,'guest receives authority reset');
   const centered=await host.evaluate(()=>[left.y,right.y]);
   assert.deepEqual(await guest.evaluate(()=>[left.y,right.y]),centered,'guest accepts centered paddles instead of reusing previous prediction');
   assert.deepEqual(await host.evaluate(()=>({arena:matchArenaId,rules:matchRuleId,powerups:matchPowerupsEnabled,paddles:{...matchPaddles}})),original);
   assert.equal(await host.evaluate(()=>pointServeCountdownActive()),true);
   await Promise.all([host,guest].map(p=>p.waitForFunction(()=>!waitingForServe,null,{timeout:5000})));
 }
 for(const p of [host,guest]) {
   await p.evaluate(()=>showTitleScreen());
   assert.equal(await p.locator('#multiplayerLeave').isVisible(),true,'an active rematch requires confirmation again');
   await p.locator('#multiplayerStay').click();
   assert.equal(await p.evaluate(()=>onlineSession===window.rematchSession&&lanConnected),true);
 }
 for(const p of [host,guest])await p.evaluate(()=>{window.startLevel=window.rematchReset;});
 await host.evaluate(()=>{paused=true;sendLanState(true)});
 console.log('PASS: '+label+' local win/loss, mutual/repeated rematch, host authority, clean reset, connection reuse and automatic countdown');
}

export async function rematchBackChecks(host, guest) {
 await host.evaluate(()=>{
   gameWindowFocused=true;paused=false;clearPointServeCountdown();waitingForServe=false;
   left.score=matchRule().goal-1;right.score=2;pointForPlayer();sendLanState(true);
 });
 await guest.locator('#multiplayerRematch').waitFor({state:'visible'});
 await guest.locator('#multiplayerRematch').click();
 await host.waitForFunction(()=>multiplayerRematch().remote);
 await host.locator('#multiplayerBack').click();
 await Promise.all([host,guest].map(p=>p.waitForFunction(()=>!onlineSession&&!lanConnected&&paused&&onlineGameBlocked)));
 for(const p of [host,guest])assert.equal(await p.locator('#matchSetup').isVisible(),true);
 assert.equal(await guest.locator('#multiplayerResult').isVisible(),false);
 console.log('PASS pending rematch Back notifies the opponent, cleans up and returns both players to setup');
}
