import assert from 'node:assert/strict';
export async function publicPowerupCases({page,waitFor,queueTraffic,errors}) {
  for(const preferences of [[true,true],[false,false],[true,false],[false,true]]) {
    const a=await page(),b=await page(),agreed=preferences.every(Boolean);
    for(const [i,p] of [a,b].entries())await p.evaluate(pref=>{setMatchPowerups(pref);savePlayerPreference('verifyPairing',true);},preferences[i]);
    const started=performance.now();await a.locator('#findMatchButton').click();
    assert.equal(await a.locator('#onlinePowerups').isDisabled(),true);
    await b.locator('#findMatchButton').click();
    await Promise.all([waitFor(a,"onlineMatchFlow?.phase === 'ready'"),waitFor(b,"onlineMatchFlow?.phase === 'ready'")]);
    console.log('METRIC queue-click-to-ready: '+Math.round(performance.now()-started)+' ms');
    const host=await a.evaluate(()=>lanRole==='host')?a:b,guest=host===a?b:a;
    for(const [i,p] of [a,b].entries()) {
      assert.equal(await p.evaluate(()=>matchPowerupsEnabled),agreed);
      assert.equal(await p.evaluate(()=>playerPreference('royalPowerupsEnabled')),preferences[i]);
      assert.match(await p.locator('#onlineFlowConfiguration').innerText(),agreed?/Royal Powerups: On/:/Royal Powerups: Off/);
      assert.equal(await p.locator('#pairingDialog').isVisible(),false,'public matchmaking has no pairing PIN');
      assert.equal(await p.locator('#onlinePowerups').count(),1);
      assert.equal(await p.evaluate(()=>setMatchPowerups(!matchPowerupsEnabled)),false);
    }
    assert.equal(await host.evaluate(()=>onlineMatchFlow.peerInitialized),true);
    await host.locator('#onlineReadyButton').click();await guest.locator('#onlineReadyButton').click();
    await Promise.all([waitFor(host,"onlineMatchFlow?.phase === 'playing'"),waitFor(guest,"onlineMatchFlow?.phase === 'playing'")]);
    if(agreed) {
      for(const [index,kind] of ['split','rush','guard'].entries()) {
        const got=await host.evaluate(index=>{
          gameWindowFocused=true;paused=false;waitingForServe=false;resetRoyalRally();royalPickupIndex=index;royalRallyTick=179;updateRoyalPowerups();
          const kind=royalPickup.type;ball.prevX=ball.x=royalPickup.x-BALL_HALF;ball.prevY=ball.y=royalPickup.y-BALL_HALF;ball.lastHit='left';collectRoyalPickup();
          paused=true;sendLanState(true);return kind;
        },index);assert.equal(got,kind);
        await waitFor(guest,kind==='split'?'royalSplitBall!==null':kind==='rush'?'ball.rush===true':'royalGuards.left===600');
        assert.equal(await guest.evaluate(()=>awardRoyalPowerup('guard')),false,'guest cannot simulate powerups');
      }
      await host.evaluate(()=>{paused=false;for(let i=0;i<600;i++)updateRoyalPowerups();paused=true;sendLanState(true);});
      await waitFor(guest,'royalGuards.left===0');
    } else {
      for(const p of [host,guest])assert.deepEqual(await p.evaluate(()=>{paused=false;waitingForServe=false;royalRallyTick=179;updateRoyalPowerups();return [royalPickup,awardRoyalPowerup('split'),awardRoyalPowerup('rush'),awardRoyalPowerup('guard')];}),[null,false,false,false]);
    }
    for(const p of [a,b])await p.evaluate(()=>closeOnlineConnection(false));
    for(const [i,p] of [a,b].entries()){await p.reload();assert.equal(await p.evaluate(()=>playerPreference('royalPowerupsEnabled')),preferences[i]);await p.close();}
    console.log('PASS shared public queue '+preferences.join('/')+' => '+agreed+', agreed display, locked countdown, persistence and authoritative effects');
  }
  const searches=queueTraffic.filter(p=>p.message.type==='search');assert.equal(searches.length,8);
  assert.equal(new Set(searches.map(p=>new URL(p.url).pathname)).size,1,'one queue for every preference');
  for(const p of searches)assert.deepEqual(Object.keys(p.message).sort(),['arena','protocol','type']);
  assert.deepEqual(errors,[]);
}
