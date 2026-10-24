import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {builds,root} from '../../tests/helpers/game-source.mjs';
const server=createServer(async(req,res)=>{try{const file=new URL('.'+new URL(req.url,'http://local').pathname,root);if(!file.href.startsWith(root.href))throw Error();res.setHeader('Content-Type',file.pathname.endsWith('.js')?'text/javascript':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({args:['--no-sandbox']});
const errors=[];
try{
for(const [platform,path] of Object.entries(builds)) for(const [width,height,dpr] of [[1920,1080,1],[2560,1440,1],[3840,2160,1],[1280,720,3],[960,600,1],[640,360,2],[390,844,3],[844,390,3]]){
 const p=await browser.newPage({viewport:{width,height},deviceScaleFactor:dpr});p.on('pageerror',e=>errors.push(e.message));await p.addInitScript(()=>Object.defineProperty(window,'KING_PONG_SIGNALING_URL',{get:()=>'',set:()=>{}}));await p.goto(origin+'/'+path);
 for(const state of ['title','boss-title','online','private','settings','gallery']){
  await p.evaluate(state=>{showTitleScreen();if(state==='boss-title'){isBossUnlocked=()=>true;showTitleScreen();}if(['online','private'].includes(state)){startOnlineSetup(true);if(state==='private')byId('onlinePrivateRules').open=true;}if(state==='settings'){setMenusVisible(true);byId('matchSettings').open=true;}if(state==='gallery'){hideTitleScreen();mode=3;openRoyalGallery('paddle');}syncRoyalUi(true);},state);
  if(state==='gallery')assert.equal(await p.locator('#royalGallery').isVisible(),true);
  const menu=await p.locator('#menuToggle').boundingBox();
  if(menu)assert.ok(menu.x>=0&&menu.x+menu.width<=width,`${platform} ${width} ${state} toolbar reachable`);
  const result=await p.evaluate(()=>{const panel=royalActiveDialog()||byId('titleScreen');return [...panel.querySelectorAll('.match-card,.royal-gallery-card,.title-card')].map(e=>({horizontal:e.scrollWidth>e.clientWidth+1,width:e.getBoundingClientRect().width,outerWidth:innerWidth,scrolls:e.scrollHeight>e.clientHeight+1}));});
  assert.ok(result.every(e=>!e.horizontal&&e.width<=width),`${platform} ${width} ${state} no horizontal clipping`);
  if(state==='online'&&width>=1280&&height>=720){const dims=await p.locator('#matchSetup > .match-card').evaluate(e=>[e.scrollHeight,e.clientHeight]);assert.ok(dims[0]<=dims[1]+1,`${platform} ${width} online does not scroll`);}
  if(state==='online'&&height<=520&&width>height){
   const preview=await p.locator('#matchSetup .royal-selection-row canvas').first().boundingBox();
   assert.ok(preview?.width>=72&&preview.height>=60,`${platform} ${width} landscape keeps readable paddle and arena previews`);
  }
  if(state==='settings'&&width>=960){const boxes=await p.locator('#matchSettings .settings-columns > section').evaluateAll(nodes=>nodes.map(e=>e.getBoundingClientRect().toJSON()));assert.equal(boxes.length,2);assert.ok(Math.abs(boxes[0].top-boxes[1].top)<2&&boxes[1].left>=boxes[0].right,'settings actually use both columns');}
  if(state==='private'){await p.locator('#onlinePowerups').scrollIntoViewIfNeeded();assert.ok(await p.locator('#onlinePowerups').isVisible());}
  if(platform==='Browser')assert.equal(await p.locator('#browserFullscreen').isVisible(),state!=='gallery','gallery controls remain unobstructed');
 }
 await p.close();console.log(`PASS ${platform} ${width}x${height} DPR${dpr}`);
}assert.deepEqual(errors,[]);
}finally{await browser.close();server.close();}
