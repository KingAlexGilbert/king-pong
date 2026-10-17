import {functionRange} from './ui-integration.mjs';
export function integrateBossAudio(source) {
  for(const name of ['playMusicStep','playMusicTone']) {
    const [start,end]=functionRange(source,name),original=source.slice(start,end);
    const statement='if (bossAudioOverridesMusic()) return;';
    if(!original.includes(statement)){
      const body=original.indexOf('{')+1;
      source=source.slice(0,start)+original.slice(0,body)+'\n  '+statement+original.slice(body)+source.slice(end);
    }
  }return source;
}
