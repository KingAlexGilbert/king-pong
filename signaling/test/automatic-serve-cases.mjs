import assert from 'node:assert/strict';

// Shared checks run after the existing initial Ready flow on real page pairs.
// Callers select direct RTC, encrypted WebSockets, or fully offline native LAN.
export async function automaticServeChecks(host, guest, label) {
  await Promise.all([host,guest].map(p=>p.waitForFunction(()=>onlineMatchFlow?.phase==='playing',null,{timeout:12000})));
  await guest.evaluate(()=>{gameWindowFocused=true;keys.add('ArrowUp');});
  const started=await host.evaluate(()=>{
    gameWindowFocused=true;paused=false;onlineGameBlocked=false;resumeCountdownEndAt=0;
    startLevel();setMenusVisible(false);waitingForServe=false;
    window.testOriginalServe=window.serveOrContinue;window.testAutomaticServes=[];
    window.serveOrContinue=(...args)=>{
      const waiting=waitingForServe;window.testOriginalServe(...args);
      if(waiting&&!waitingForServe)window.testAutomaticServes.push(performance.now()-window.testPointAt);
    };
    window.testPointAt=performance.now();pointForPlayer();
    requestServeOrContinue();keys.add('s');
    return {mode,score:left.score,waitingForServe,paused,remaining:pointServeSnapshotMs(),role:lanRole,before:[left.y,right.y]};
  });
  assert.equal(started.remaining,2000,label+': host starts a fresh countdown: '+JSON.stringify(started));
  assert.equal(started.waitingForServe,true,label+': host manual serve cannot bypass the timer');
  try {await guest.waitForFunction(()=>{
    if(left.score!==1||!pointServeCountdownActive())return false;
    requestServeOrContinue();sendLanAction('serve');return true;
  },null,{timeout:5000});}
  catch(error) {
    console.log(label+' countdown diagnostics',await Promise.all([host,guest].map(p=>p.evaluate(()=>({
      mode,score:left.score,waitingForServe,paused,remaining:pointServeSnapshotMs(),role:lanRole,
      blocked:onlineGameBlocked,flow:onlineMatchFlow?.phase,stateSeq:lanLastStateSeq,compact:onlineWireReady,
      extension:onlinePointServeReady,hasState:onlineHasState
    })))));throw error;
  }
  const before=started.before;
  // Observe actual delivery/movement rather than assuming a fixed RTT under
  // the WebSocket latency/backpressure fixture.
  const movement=await host.waitForFunction(([leftBefore,rightBefore])=>left.y>leftBefore&&right.y<rightBefore&&
    waitingForServe&&[left.y,right.y,waitingForServe,pointServeDisplayNumber()],
    before,{timeout:1300}).catch(async error=>{
      console.log(label+' movement diagnostics',before,await Promise.all([host,guest].map(p=>p.evaluate(()=>({
        left:left.y,right:right.y,paused,waitingForServe,remaining:pointServeSnapshotMs(),keys:[...keys],
        input:lanRemoteInput,local:readLocalLanInput(),focused:gameWindowFocused,hidden:document.hidden,
        elapsed:performance.now()-window.testPointAt
      })))));throw error;
    });
  const preparing=await movement.jsonValue();await movement.dispose();
  assert.ok(preparing[0]>before[0]&&preparing[1]<before[1],label+': both paddles move before serve: '+JSON.stringify({before,preparing}));
  assert.equal(preparing[2],true,label+': neither early input bypasses countdown');
  assert.ok([1,2].includes(preparing[3]));
  assert.equal(await guest.locator('#matchContinue').isVisible(),false);
  assert.doesNotMatch(await guest.locator('#controlHint').innerText(),/serve/i);
  await host.evaluate(()=>keys.clear());await guest.evaluate(()=>keys.clear());
  await Promise.all([host,guest].map(p=>p.waitForFunction(()=>!waitingForServe,null,{timeout:5000})));
  const elapsed=await host.evaluate(()=>window.testAutomaticServes[0]);
  assert.ok(elapsed>=1990&&elapsed<4000,label+': one automatic serve after two seconds: '+elapsed);
  await host.evaluate(()=>{requestServeOrContinue();sendLanState(true);});
  await guest.evaluate(()=>sendLanAction('serve'));
  assert.equal(await host.evaluate(()=>window.testAutomaticServes.length),1);

  await host.evaluate(()=>{
    // A second point exercises pause while the countdown is pending.
    window.testPointAt=performance.now();pointForCpu();togglePause();sendLanState(true);
  });
  await guest.waitForFunction(()=>paused&&pointServeCountdownActive());
  const remaining=await host.evaluate(()=>pointServeSnapshotMs());
  await host.waitForTimeout(2100);
  assert.deepEqual(await host.evaluate(()=>[waitingForServe,pointServeSnapshotMs(),window.testAutomaticServes.length]),[true,remaining,1]);
  await host.evaluate(()=>{
    togglePause();resumeCountdownEndAt=performance.now()-1; // Existing resume flow, without a three-second test delay.
  });
  await host.waitForFunction(()=>!paused);
  assert.equal(await host.evaluate(()=>waitingForServe),true,'resume does not bypass the point countdown');
  await Promise.all([host,guest].map(p=>p.waitForFunction(()=>!waitingForServe,null,{timeout:5000})));
  assert.equal(await host.evaluate(()=>window.testAutomaticServes.length),2);
  assert.deepEqual(await guest.evaluate(()=>[left.score,right.score]),[1,1]);
  await host.evaluate(()=>{window.serveOrContinue=window.testOriginalServe;paused=true;sendLanState(true);setMenusVisible(false);});
  await guest.evaluate(()=>setMenusVisible(false));
  console.log('PASS: '+label+' automatic 2 → 1 serving, paddle preparation, input rejection and pause/resume');
}
