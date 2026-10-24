// Production HTML, canvas and DOM across all builds. Native wrappers and
// Internet NAT are separate smoke tests.
import assert from 'node:assert/strict';
import {staticServer, closeStaticServer} from './static-server.mjs';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {builds} from '../../tests/helpers/game-source.mjs';

const server = await staticServer();
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const errors=[],artifacts=process.env.KING_PONG_TEST_ARTIFACTS;
if(artifacts)await mkdir(artifacts,{recursive:true});
let checks=0;
const pass=label=>{checks++;console.log('PASS: '+label);};
async function page(platform,options={}) {
  const context=await browser.newContext({viewport:{width:1280,height:900},...options});
  const p=await context.newPage();
  p.on('pageerror',e=>errors.push(platform+': '+e.message));
  await p.addInitScript(()=>{
    requestAnimationFrame=()=>1;
    Object.defineProperty(window,'KING_PONG_SIGNALING_URL',{get:()=>'',set:()=>{}});
    document.addEventListener('DOMContentLoaded',()=>{
      document.documentElement.requestFullscreen=async()=>{throw Error('Test viewport');};
    },{once:true});
  });
  await p.goto(origin+'/'+builds[platform]);
  return p;
}
async function snap(p,name){if(artifacts)await p.screenshot({path:artifacts+'/'+name+'.png'});}
async function menu(p){await p.locator('#menuToggle').click();await p.locator('#matchSettings').evaluate(el=>el.open=true);}
try {
  const requested=process.argv.find(arg=>arg.startsWith('--platform='))?.split('=')[1];
  for(const platform of Object.keys(builds).filter(p=>!requested||p===requested)) {
    const p=await page(platform);
    assert.equal(await p.locator('#titleLevelSelectButton').isVisible(),true);
    assert.equal(await p.locator('#titleLevelSelectButton').evaluate(el=>el.parentElement.className),'title-actions');
    await snap(p,platform+'-title');
    await p.locator('#titleLevelSelectButton').click();
    assert.equal(await p.locator('#royalGalleryList button').count(),18);
    assert.equal(await p.locator('#royalGalleryList button:not(:disabled)').count(),1);
    assert.equal(await p.locator('#royalGalleryClose').innerText(),'Back');
    assert.equal(await p.locator('#royalGalleryList canvas').count(),18);
    assert.equal(await p.evaluate(()=>[...byId('royalGalleryList').children].every((b,i)=>
      b.dataset.choiceId===String(i)&&b.textContent.includes(localizeText(arenaCatalog[i].level.name)))),true);
    assert.equal(await p.evaluate(()=>startLevelSelectEncounter(1)),false);
    assert.equal(await p.evaluate(()=>startLevelSelectEncounter(TOTAL_LEVELS)),false,'no secret boss preview/entry');
    await p.locator('#royalGalleryList button:not(:disabled)').click();
    assert.deepEqual(await p.evaluate(()=>[mode,selectedAbsoluteLevelIndex(),waitingForServe,pointServeCountdown,customPreviewActive]),[1,0,true,null,false]);
    await p.locator('#campaignBack').click();
    assert.equal(await p.evaluate(()=>galleryKind),'level');
    await p.keyboard.press('Escape');
    assert.equal(await p.evaluate(()=>document.activeElement.id),'titleLevelSelectButton');
    pass(platform+': title entry, previews/names, initial unlock, locked guards and top Back');

    const progress=await p.evaluate(()=>{
      const old={version:2,highestUnlockedLevel:2,completedLevels:Array.from({length:18},(_,i)=>i<2),customCpuIntel:100,customCpuMaxMove:12};
      localStorage.setItem(saveSlotKey(0),JSON.stringify(old));loadSaveSlot(0);openLevelSelect();
      const count=()=>byId('royalGalleryList').querySelectorAll('button:not(:disabled)').length;
      const first=count();closeRoyalGallery();loadSaveSlot(1);openLevelSelect();const second=count();
      closeRoyalGallery();loadSaveSlot(0);
      const backup=parseSaveBackup(makeSaveBackup());
      saveData.highestUnlockedLevel=0;saveData.completedLevels.fill(false);saveProgressNow();
      applyImportedSaveBackup(backup);openLevelSelect();const restored=count();
      const exported=JSON.parse(makeSaveBackup());
      return [first,second,restored,activeSaveSlot,exported.version,exported.slots[0].version,
        Object.keys(exported.slots[0]).some(k=>/levelSelect|replay/i.test(k))];
    });
    assert.deepEqual(progress,[3,1,3,0,1,2,false]);
    await snap(p,platform+'-level-select');
    const auth=await p.evaluate(()=>{
      saveData.highestUnlockedLevel=17;saveData.completedLevels.fill(true);
      saveData.royalPaddle='enemy-17';
      const results=[];
      for(let index=0;index<TOTAL_LEVELS;index++) {
        levelSelectEncounter=null;mode=1;activeCampaign=Math.floor(index/6);levelIndex=index%6;startLevel();
        const settings=()=>JSON.stringify({cpu:getCpuConfig(),level:currentLevel(),player:activePaddleProfile(left),cpuPaddle:activePaddleProfile(right),hazards});
        const expected=settings();
        if(activePaddleProfile(left)!==PLAYER_PADDLE_PROFILES[index] ||
           activePaddleProfile(right)!==ENEMY_PADDLE_PROFILES[index])return ['incorrect campaign profiles',index];
        mode=3;activeCampaign=2;levelIndex=5;customCpuIntel=100;customCpuMaxMove=12;
        const entered=startLevelSelectEncounter(index);
        for(let i=0;i<5;i++)update();
        openRoyalGallery('paddle');
        results.push(galleryKind!=='paddle'&&byId('menuPaddle').hidden&&saveData.royalPaddle==='enemy-17'&&entered&&mode===1&&selectedAbsoluteLevelIndex()===index&&settings()===expected&&waitingForServe&&pointServeCountdown===null);
      }
      return results;
    });
    assert.deepEqual(auth,Array(18).fill(true));
    assert.equal(await p.evaluate(()=>{
      levelSelectEncounter=null;mode=3;syncRoyalUi(true);
      return !byId('menuPaddle').hidden && activePaddleProfile(left)===selectedPaddleProfile(left) &&
        saveData.royalPaddle==='enemy-17';
    }),true,'Custom Game retains the saved paddle');
    pass(platform+': old/imported saves, independent slots and all 18 authentic campaign configurations');

    assert.deepEqual(await p.evaluate(()=>{
      showTitleScreen();saveData.highestUnlockedLevel=2;saveData.completedLevels=Array.from({length:18},(_,i)=>i<2);
      saveData.bossUnlocked=false;saveProgressNow();startLevelSelectEncounter(0);
      waitingForServe=false;left.score=currentLevel().goal-1;pointForPlayer();
      const earlier=[saveData.highestUnlockedLevel,completedLevelCount(),levelCleared];
      serveOrContinue();const returned=galleryKind==='level'&&selectedAbsoluteLevelIndex()===0;
      startLevelSelectEncounter(2);waitingForServe=false;left.score=currentLevel().goal-1;pointForPlayer();
      const frontier=[saveData.highestUnlockedLevel,completedLevelCount(),levelCleared];
      serveOrContinue();const unlocked=byId('royalGalleryList').querySelectorAll('button:not(:disabled)').length;
      startLevelSelectEncounter(2);waitingForServe=false;right.score=currentLevel().goal-1;pointForCpu();serveOrContinue();
      const retry=[selectedAbsoluteLevelIndex(),waitingForServe,right.score];
      return [earlier,returned,frontier,unlocked,retry];
    }),[[2,2,true],true,[3,3,true],4,[2,true,0]]);
    await p.locator('#menuToggle').click();
    await p.locator('#titleJumpButton').click();
    assert.equal(await p.evaluate(()=>galleryKind),'level','menu Back returns to Level Select');
    assert.deepEqual(await p.evaluate(()=>{
      saveData.highestUnlockedLevel=17;saveData.completedLevels=Array.from({length:18},(_,i)=>i<17);saveData.bossUnlocked=false;
      startLevelSelectEncounter(17);waitingForServe=false;left.score=currentLevel().goal-1;pointForPlayer();
      const result=[isBossUnlocked(),bossIntroActive,mode,levelCleared];serveOrContinue();
      return [...result,galleryKind];
    }),[true,false,1,true,'level']);
    await p.locator('#royalGalleryClose').click();
    assert.equal(await p.locator('#titleBossButton').isVisible(),true);
    assert.deepEqual(await p.evaluate(()=>{
      saveData.highestUnlockedLevel=0;saveData.completedLevels.fill(false);saveData.bossUnlocked=false;
      startCampaignFromSave();waitingForServe=false;left.score=currentLevel().goal-1;pointForPlayer();serveOrContinue();
      return [isLevelSelectEncounter(),mode,selectedAbsoluteLevelIndex(),waitingForServe];
    }),[false,1,1,true]);
    pass(platform+': replay completion/retry/navigation, frontier advancement, boss unlock and unchanged Campaign flow');

    await p.evaluate(()=>{showTitleScreen();syncRoyalUi(true);});
    await menu(p);
    assert.equal(await p.locator('#originalBossMusicRow').isVisible(),false);
    await p.evaluate(()=>{saveData.bossUnlocked=true;saveProgressNow();syncRoyalUi(true);});
    for(const [width,height] of [[1920,1080],[1280,720],[1024,768],[768,540],[600,800]]) {
      await p.setViewportSize({width,height});
      await p.locator('#originalBossMusicButton').scrollIntoViewIfNeeded();
      const rects=await p.evaluate(()=>['musicButton','originalBossMusicButton','soundEffectsButton','originalBossMusicRow'].map(id=>{
        const r=byId(id).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};
      }));
      const [music,boss,sfx,row]=rects;
      assert.ok(Math.abs(music.x-boss.x)<1&&Math.abs(music.w-boss.w)<1,platform+' music column '+width);
      assert.ok(row.y>=music.y+music.h&&row.y-music.y-music.h<20,platform+' adjacent music settings');
      assert.ok(sfx.x>=music.x+music.w&&boss.y>sfx.y,platform+' effects stay in their column');
      assert.equal(await p.locator('#matchMenu .match-card').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    }
    await p.setViewportSize({width:1280,height:900});
    await snap(p,platform+'-music-settings');
    const preference=await p.evaluate(()=>playerPreference('originalBossMusic'));
    await p.locator('#originalBossMusicButton').click();
    assert.equal(await p.evaluate(()=>playerPreference('originalBossMusic')),!preference);
    await p.evaluate(()=>{loadSaveSlot(1);loadSaveSlot(0);syncRoyalUi(true);});
    assert.equal(await p.evaluate(()=>playerPreference('originalBossMusic')),!preference);
    const before=await p.evaluate(()=>[musicEnabled,saveData.soundEffectsEnabled]);
    await p.locator('#musicButton').click();
    assert.deepEqual(await p.evaluate(()=>[musicEnabled,saveData.soundEffectsEnabled]),[!before[0],before[1]]);
    await p.setViewportSize({width:390,height:844});
    await p.locator('#originalBossMusicButton').scrollIntoViewIfNeeded();
    assert.equal(await p.evaluate(()=>{
      const ids=['muteAllButton','musicButton','soundEffectsButton','originalBossMusicButton'];
      const r=ids.map(id=>byId(id).getBoundingClientRect());
      return r.every((b,i)=>!i||b.y>r[i-1].y+r[i-1].height)&&byId('audioSettings').scrollWidth<=byId('audioSettings').clientWidth+1;
    }),true,'mobile keeps the existing audio order and fits');
    await snap(p,platform+'-mobile-settings');
    pass(platform+': boss music unlock visibility, desktop alignment, narrow/mobile layout and preferences');
    await p.context().close();
  }

  if(!requested)for(const platform of ['Windows','Linux']) {
    // CSS pixels represent the smaller effective viewport at desktop display scaling.
    for(const scale of [1.25,2,3]) {
      const p=await page(platform,{deviceScaleFactor:scale,viewport:{width:Math.round(1920/scale),height:Math.round(1080/scale)}});
      await p.evaluate(()=>{saveData.bossUnlocked=true;syncRoyalUi(true);});
      await menu(p);
      const aligned=await p.evaluate(()=>{
        const rect=id=>byId(id).getBoundingClientRect();
        const music=rect('musicButton'),boss=rect('originalBossMusicButton'),sfx=rect('soundEffectsButton');
        return Math.abs(music.x-boss.x)<1&&Math.abs(music.width-boss.width)<1&&
          boss.y>music.y&&sfx.x>=music.right&&byId('audioSettings').scrollWidth<=byId('audioSettings').clientWidth+1;
      });
      assert.equal(aligned,true,platform+' desktop scale '+scale);
      await p.context().close();
    }
    pass(platform+': 125%, 200% and 300% desktop display scaling');
  }

  for(const [locale,language] of (requested?[]:[['es-ES','es'],['fr-FR','fr'],['de-DE','de'],['pt-BR','pt'],['it-IT','it'],['nl-NL','nl'],['ja-JP','ja'],['ko-KR','ko'],['zh-CN','zh']])) {
    const p=await page('Browser',{locale,viewport:{width:390,height:844},hasTouch:true});
    const translated=await p.evaluate(()=>localizeText('Level Select'));
    assert.notEqual(translated,'Level Select');
    assert.equal(await p.locator('#titleLevelSelectButton').innerText(),translated);
    await p.locator('#titleLevelSelectButton').tap();
    assert.equal(await p.locator('#royalGalleryTitle').innerText(),translated);
    assert.equal(await p.locator('.royal-gallery-card').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    assert.equal(await p.evaluate(()=>['Level Select','Level','Completed','Unlocked','SPACE / TAP / A: Level Select','TAP: Level Select']
      .every(key=>typeof window.KING_PONG_ROYAL_TRANSLATIONS[document.documentElement.lang]?.[key]==='string')),true);
    await snap(p,language+'-levels');
    await p.context().close();
  }
  if(!requested)pass('all nine translations and touch Level Select layouts');
  assert.deepEqual(errors,[]);
  console.log(`PASS: ${checks} browser check groups; no page errors`);
} catch(error) {console.error(error);throw error;}
finally {await browser.close();await closeStaticServer(server);}
