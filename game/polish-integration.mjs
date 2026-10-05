import { functionRange } from './ui-integration.mjs';

// Keep legacy platform shells self-contained, with identical gameplay/audio hooks.
export function integrateRoyalPolish(source) {
  const hook = code => '/* ROYAL POLISH */' + code + '/* END ROYAL POLISH */';
  const edit = (name, transform) => {
    const [start, end] = functionRange(source, name);
    const original = source.slice(start, end).replace(/\/\* ROYAL POLISH \*\/[\s\S]*?\/\* END ROYAL POLISH \*\//g, '');
    source = source.slice(0, start) + transform(original) + source.slice(end);
  };
  edit('normalizeBallVelocity', f => f.replace('{', '{' + hook('minSpeed*=royalBallSpeedScale();maxSpeed*=royalBallSpeedScale();'))
    .replace(/Math\.abs\(ball.vx\)<1.2(?:\*royalBallSpeedScale\(\))?/g, 'Math.abs(ball.vx)<1.2*royalBallSpeedScale()')
    .replace(/\(ball.vx<0\?-1:1\)\*1.2(?:\*royalBallSpeedScale\(\))?/, '(ball.vx<0?-1:1)*1.2*royalBallSpeedScale()'));
  edit('hitPaddle', f => f.replace(/const speed=[^;]+;/, 'const speed=royalPaddleReturnSpeed(level);'));
  if (source.includes('function forceBallOutOfHazardLoop(')) edit('forceBallOutOfHazardLoop', f => f.replace('level.ballSpeed||BASE_BALL_SPEED,level.maxSpeed||12', '(level.ballSpeed||BASE_BALL_SPEED)*royalBallSpeedScale(),(level.maxSpeed||12)*royalBallSpeedScale()'));
  for (const [name, side] of [['pointForPlayer', 'left'], ['pointForCpu', 'right']]) {
    edit(name, f => f.replace('{', '{' + hook('if(isLanGuestActive())return;'))
      .replace(side + '.score++;', side + '.score=mode===2?nextMatchScore(' + side + '.score):' + side + '.score+1;')
      .replace('const isWinningPoint=' + side + '.score>=currentLevel().goal;', 'const isWinningPoint=mode===2?multiplayerPointWins("' + side + '"):' + side + '.score>=currentLevel().goal;')
      .replace('wins the practice round.', 'wins the match.'));
  }
  edit('draw', f => f.includes('drawMultiplayerScore(') ? f : f.replace('drawScore(left.score,W/2-112,34);drawScore(right.score,W/2+72,34);',
    'if(mode===2){drawMultiplayerScore(left.score,W/2-90,34);drawMultiplayerScore(right.score,W/2+90,34);}else{drawScore(left.score,W/2-112,34);drawScore(right.score,W/2+72,34);}'));
  edit('drawOverlay', f => f.replace('"PRACTICE ROUND OVER"', '"MATCH OVER"')
    .replace('"Reach the goal before the Other Player to win the round"', 'matchRule().label'));
  edit('lanSend', f => f.replace('payload.gameplay="royal";', 'payload.gameplay="royal";' + hook('payload.matchRules="presets";'))
    .replace(/payload.type==="selection"(?:\|\|payload.type==="rules")?/, 'payload.type==="selection"||payload.type==="rules"'));
  edit('handleLanMessage', f => f.replace('"action","selection"]', '"action","selection","rules"]'));
  edit('sendLanState', f => f.replace('lanSend({', hook('sendMatchRules();') + 'lanSend({')
    .replace('royal:packRoyalState(),', 'royal:packRoyalState(),' + hook('rules:matchRulePayload(),')));
  edit('handleLanGuestMessage', f => f.replace('{', '{' + hook('if(message.type==="rules"){receiveMatchRules(message.rules);return;}'))
    .replace('if(message.royal!==undefined', hook('if(!validMatchRuleState(message.rules)||!validMatchScores(message))return;') + 'if(message.royal!==undefined')
    .replace('lanLastStateSeq=message.seq;', 'lanLastStateSeq=message.seq;' + hook('applyMatchRuleState(message.rules);')));
  edit('applyLanHostState', f => f.replace(/(Math.round\(Number\(state.(?:left|right)Score\)\|\|0\),0,)99/g, '$1MATCH_SCORE_MAX'));

  edit('createDefaultSaveData', f => f.replace('musicEnabled:true,', 'musicEnabled:true,' + hook('muteAll:false,soundEffectsEnabled:true,')));
  edit('normalizeSaveData', f => f.replace('bossUnlocked:Boolean', hook('muteAll:source.muteAll===true,soundEffectsEnabled:typeof source.soundEffectsEnabled==="boolean"?source.soundEffectsEnabled:true,') + 'bossUnlocked:Boolean'));
  edit('loadSaveSlot', f => f.replace('musicEnabled=saveData.musicEnabled;', 'musicEnabled=saveData.musicEnabled;' + hook('stopGameSounds();updateGameAudioGains();')));
  if (source.includes('function checkedSaveSlot(')) edit('checkedSaveSlot', f => f.replace('const selections = {};', 'const selections = {};' + hook('for(const key of ["muteAll","soundEffectsEnabled"]){if(slot[key]!==undefined)selections[key]=boolean(key);}')));

  for (const name of ['beep', 'playScoreTone', 'playMusicTone']) {
    edit(name, f => {
      const music = name === 'playMusicTone';
      if (name === 'playScoreTone') {
        f = f.replace('{', '{' + hook('if(!gameAudioEnabled("sfx"))return;const audioEpoch=gameAudioEpoch;'))
          .replace('try{const activeAudio=', 'try{' + hook('if(audioEpoch!==gameAudioEpoch||!gameAudioEnabled("sfx"))return;') + 'const activeAudio=');
      } else f = f.replace('{', '{' + hook('if(!gameAudioEnabled("' + (music ? 'music' : 'sfx') + '"))return;'));
      f = f.replace('gain.connect(activeAudio.destination);', 'connectGameAudio(gain,activeAudio,"' + (music ? 'music' : 'sfx') + '");');
      if (!music) f = f.replace('osc.start(', hook('trackGameSound(osc,gain);') + 'osc.start(');
      return f;
    });
  }
  edit('scheduleMusicLoop', f => f.replace('musicTimer=null;', 'musicTimer=null;' + hook('if(!gameAudioEnabled("music")){musicNextStepTime=0;return;}')));
  edit('setMusicEnabled', f => f.replace('if(musicEnabled&&musicVolumeLevel>0)', 'if(gameAudioEnabled("music"))')
    .replace('updateMusicButton();', hook('updateGameAudioGains();') + 'updateMusicButton();'));
  edit('setMusicVolume', f => f.replace('if(musicVolumeLevel<=0)', 'if(musicVolumeLevel<=0||!gameAudioEnabled("music"))')
    .replace('if(saveData){', hook('updateGameAudioGains();') + 'if(saveData){'));
  edit('updateMusicButton', f => f.slice(0, -1) + hook('updateAudioControls();') + '}');
  if (source.includes('function updateMusicAudioKeepAlive(')) edit('updateMusicAudioKeepAlive', f => f
    .replace('&&!document.hidden)', '&&!document.hidden&&gameAudioEnabled("music"))')
    .replace('gain.connect(context.destination);', 'connectGameAudio(gain,context,"music");'));
  return source;
}
