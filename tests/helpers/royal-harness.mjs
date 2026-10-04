import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { source, root, functionSource, constantSource } from './game-source.mjs';

export function harness(platform = 'Browser') {
  const html = source(platform);
  const shared = readFileSync(new URL('game/royal-gameplay.js', root), 'utf8');
  const core = ['clamp','lerp','makePaddleProfile','currentCampaign','currentLevel','absoluteLevelNumber','selectedAbsoluteLevelIndex',
    'completedLevelCount','isBossUnlocked','isCampaignLevelUnlocked','isCustomLevelUnlocked','activePaddleProfile',
    'paddleRelativeContact','paddleProfileOffset','paddleProfileSlopeAngle','paddleSurfaceX','paddleIntersectsBall',
    'calculatePaddleBounceAngle','cpuReturnTargetAngle','ballSpeed','normalizeBallVelocity','hitPaddle','ballRect','rectsOverlap',
    'resolveRectCollision','resolveCircleCollision','resolveHazardCollisions','reflectYForBounds','resetHazardTrapGuard',
    'registerRectHazardHit','forceBallOutOfHazardLoop','updateRallyLaunchRamp','clearRallyLaunchRamp','updateSingleBall',
    'ballSpawnOverlapsHazard','pointForPlayer','pointForCpu','shouldAutoServeAfterPoint','nextCpuModeRallyDirection',
    'loop','resetFrameClock','handleLanHostMessage','handleLanGuestMessage','serializeLanHazards','sendLanState'];
  const definitions = ['DEFAULT_PADDLE_PROFILE','PLAYER_PADDLE_PROFILES','ENEMY_PADDLE_PROFILES','BOSS_ADAPTIVE_PROFILES',
    'CAMPAIGNS','BOSS_LEVEL','BOSS_CAMPAIGN'].map(n => constantSource(html, n)).join('\n');
  const context = vm.createContext({ console, performance: { now: () => 1000 },
    document: { hidden: false, body: { classList: { contains: () => false } } }, requestAnimationFrame() {} });
  const run = code => vm.runInContext(code, context);
  run(`
    const W=640,H=480,PADDLE_W=8,PADDLE_H=64,PADDLE_SPEED=7.2,PADDLE_MARGIN=32,BALL_SIZE=8,BALL_HALF=4;
    const BASE_BALL_SPEED=4.2,TOTAL_LEVELS=18,SECRET_BOSS_LEVEL_NUMBER=19;
    const RALLY_LAUNCH_RAMP_FRAMES=60,RALLY_LAUNCH_START_SPEED_SCALE=.2,SPAWN_HAZARD_PADDING=14;
    const HAZARD_TRAP_FALLBACK_FRAMES=600,HAZARD_TRAP_WINDOW_FRAMES=360,HAZARD_TRAP_HIT_LIMIT=5;
    const FIXED_STEP_MS=1000/60,MAX_CATCHUP_STEPS=5,LAN_STATE_EVERY_FRAMES=3,LAN_SIGNAL_VERSION=1;
    const LAN_ALLOWED_ACTIONS=new Set(['serve','pause','retry']);
    let previousFrameTime=null,accumulatedFrameMs=0,lastCanvasDrawAt=-Infinity,previousPaused=false;
    let frame=0,mode=2,activeCampaign=0,levelIndex=0,paused=false,waitingForServe=false,gameOver=false,levelCleared=false,campaignCleared=false,shakeFrames=0;
    let bossIntroActive=false,creditsActive=false,bossBalls=[],hazards=[],bossAdaptiveProfile=null;
    let lanRole='none',lanLastInputSeq=-1,lanLastStateSeq=-1,lanStateSeq=0,lanLastActionAt=-Infinity,lanRemoteInput={},lanRoomCode='ABCDE';
    let onlineAppliedInputSeq=-1,endMessage='',nextCpuModeServeDirection=-1;
    let rallyLaunchFramesRemaining=0,rallyLaunchTargetSpeed=0,rallySpawnPulseX=320,rallySpawnPulseY=240;
    let hazardTrapHitCount=0,hazardTrapWindowStartFrame=-9999,lastHazardTrapHitFrame=-9999,framesSincePaddleContact=0;
    const left={x:32,y:208,score:0},right={x:600,y:208,score:0};
    let ball={x:300,y:240,prevX:300,prevY:240,vx:4,vy:0,lastScored:0};
    let saveData={highestUnlockedLevel:0,completedLevels:Array(18).fill(false),bossUnlocked:false};
    let drawn=[],sent=[],applied=[];
    function draw(view){drawn.push(view.ball.x)}
    function update(){frame++;updateRoyalPowerups();updateBall()}
    function finiteNumber(x,fallback){return Number.isFinite(Number(x))?Number(x):fallback}
    function isLanGuestActive(){return lanRole==='guest'}
    function isLanHostActive(){return lanRole==='host'}
    function visiblePlayfieldBounds(){return {top:0,bottom:H}}
    function visiblePlayfieldCenterY(){return H/2}
    function beep(){} function chooseCpuError(){} function addScreenShake(){} function applyHitFlash(){}
    function updateHud(){} function playPlayerScoreSound(){} function playLevelFailureJingle(){}
    function resumeCountdownRemainingMs(){return 0} function hasResumeCountdown(){return false}
    function resetBall(direction,wait){resetRoyalRally();ball.x=320;ball.y=240;waitingForServe=wait}
    function lanSend(message){sent.push(message);return true}
    function applyLanHostState(message){applied.push(message.seq)}
    function serveOrContinue(){} function togglePause(){} function retryLevel(){}
    ${core.filter(n=>html.includes('function '+n+'(')).map(n=>functionSource(html,n)).join('\n')}
    ${definitions}
    ${shared}
  `);
  return { run, context, json: code => JSON.parse(JSON.stringify(run(code))) };
}
