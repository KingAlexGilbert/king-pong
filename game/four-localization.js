// English keys use the existing localization cache; every new label has all nine translations.
(() => {
  const languages = ['es', 'fr', 'de', 'pt', 'it', 'nl', 'ja', 'ko', 'zh'];
  const phrases = {
    'Four Player': ['Cuatro jugadores','Quatre joueurs','Vier Spieler','Quatro jogadores','Quattro giocatori','Vier spelers','4人プレイ','4인 플레이','四人游戏'],
    'Up to Four Players': ['Hasta cuatro jugadores','Jusqu’à quatre joueurs','Bis zu vier Spieler','Até quatro jogadores','Fino a quattro giocatori','Tot vier spelers','最大4人','최대 4인','最多四人'],
    'Play Online': ['Jugar en línea','Jouer en ligne','Online spielen','Jogar online','Gioca online','Online spelen','オンラインでプレイ','온라인 플레이','在线游玩'],
    'Match type': ['Tipo de partida','Type de partie','Spielart','Tipo de partida','Tipo di partita','Speltype','対戦形式','경기 유형','对战类型'],
    'Free-for-All': ['Todos contra todos','Chacun pour soi','Jeder gegen jeden','Todos contra todos','Tutti contro tutti','Iedereen tegen iedereen','個人戦','개인전','自由混战'],
    'Two versus Two': ['Dos contra dos','Deux contre deux','Zwei gegen zwei','Dois contra dois','Due contro due','Twee tegen twee','2対2','2 대 2','二对二'],
    'Lives': ['Vidas','Vies','Leben','Vidas','Vite','Levens','ライフ','목숨','生命'],
    'Team goal': ['Meta del equipo','Objectif d’équipe','Teamziel','Meta da equipe','Obiettivo squadra','Teamdoel','チーム目標点','팀 목표 점수','团队目标分数'],
    'Bot difficulty': ['Dificultad del bot','Difficulté des bots','Bot-Schwierigkeit','Dificuldade dos bots','Difficoltà bot','Botmoeilijkheid','ボットの難易度','봇 난이도','电脑难度'],
    'Easy': ['Fácil','Facile','Leicht','Fácil','Facile','Makkelijk','かんたん','쉬움','简单'],
    'Normal': ['Normal','Normal','Normal','Normal','Normale','Normaal','ふつう','보통','普通'],
    'Hard': ['Difícil','Difficile','Schwer','Difícil','Difficile','Moeilijk','むずかしい','어려움','困难'],
    'My paddle on the left': ['Mi pala a la izquierda','Ma raquette à gauche','Mein Schläger links','Minha raquete à esquerda','La mia racchetta a sinistra','Mijn paddle links','自分のパドルを左に表示','내 패들을 왼쪽에 표시','将我的球拍显示在左侧'],
    'Same-device players': ['Jugadores en este dispositivo','Joueurs sur cet appareil','Spieler an diesem Gerät','Jogadores neste dispositivo','Giocatori su questo dispositivo','Spelers op dit apparaat','同じ端末の人数','같은 기기의 플레이어 수','同设备玩家数'],
    'Practice with bots': ['Practicar con bots','S’entraîner avec des bots','Mit Bots üben','Treinar com bots','Allenati con i bot','Oefenen met bots','ボットと練習','봇과 연습','与电脑练习'],
    'Four-player arena': ['Arena de cuatro jugadores','Arène à quatre joueurs','Vier-Spieler-Arena','Arena de quatro jogadores','Arena per quattro giocatori','Arena voor vier spelers','4人用アリーナ','4인 아레나','四人竞技场'],
    'You': ['Tú','Vous','Du','Você','Tu','Jij','自分','나','你'],
    'Bot': ['Bot','Bot','Bot','Bot','Bot','Bot','ボット','봇','电脑'],
    'Team': ['Equipo','Équipe','Team','Equipe','Squadra','Team','チーム','팀','团队'],
    'Eliminated': ['Eliminado','Éliminé','Ausgeschieden','Eliminado','Eliminato','Uitgeschakeld','脱落','탈락','已淘汰'],
    'Winner': ['Ganador','Vainqueur','Sieger','Vencedor','Vincitore','Winnaar','勝者','승자','获胜者'],
    'Rematch': ['Revancha','Revanche','Revanche','Revanche','Rivincita','Opnieuw spelen','再戦','재대결','再战'],
    'Lose a life when your wall concedes. Eliminated walls become neutral. Last player wins.': [
      'Pierdes una vida cuando entra un gol por tu lado. Los lados eliminados se vuelven muros neutrales. Gana el último jugador.',
      'Vous perdez une vie quand votre côté encaisse. Les côtés éliminés deviennent des murs neutres. Le dernier joueur gagne.',
      'Ein Tor an deiner Seite kostet ein Leben. Ausgeschiedene Seiten werden neutrale Wände. Der letzte Spieler gewinnt.',
      'Você perde uma vida ao sofrer um gol. Lados eliminados viram paredes neutras. O último jogador vence.',
      'Perdi una vita quando subisci un gol. I lati eliminati diventano muri neutrali. Vince l’ultimo giocatore.',
      'Een tegendoelpunt kost een leven. Uitgeschakelde zijden worden neutrale muren. De laatste speler wint.',
      '自分の側にゴールされるとライフを失います。脱落した側は中立の壁になります。最後の1人が勝利します。',
      '자신의 벽으로 실점하면 목숨을 잃습니다. 탈락한 벽은 중립 벽이 됩니다. 마지막 플레이어가 승리합니다.',
      '球越过你的球拍进入球门时失去一条生命。被淘汰的一侧变为中立墙壁。最后存活的玩家获胜。'],
    'Opposite walls are teammates. A conceded goal gives the other team a point. First to the team goal wins.': [
      'Los lados opuestos son compañeros. Cada gol recibido da un punto al otro equipo. Gana quien alcance la meta.',
      'Les côtés opposés sont coéquipiers. Un but encaissé donne un point à l’autre équipe. Atteignez l’objectif pour gagner.',
      'Gegenüberliegende Seiten sind ein Team. Ein Gegentor gibt dem anderen Team einen Punkt. Wer das Teamziel erreicht, gewinnt.',
      'Lados opostos formam uma equipe. Cada gol sofrido dá um ponto à outra equipe. A primeira a atingir a meta vence.',
      'I lati opposti sono compagni. Un gol subito dà un punto all’altra squadra. Vince chi raggiunge l’obiettivo.',
      'Tegenoverliggende zijden zijn teamgenoten. Een tegendoelpunt geeft het andere team een punt. Bereik als eerste het teamdoel.',
      '向かい合う側が同じチームです。失点すると相手チームに1点入ります。目標点に先に到達したチームが勝利します。',
      '마주 보는 벽이 같은 팀입니다. 실점하면 상대 팀이 1점을 얻습니다. 목표 점수에 먼저 도달하면 승리합니다.',
      '相对两侧为队友。失球时对方团队得一分。先达到目标分数的团队获胜。'],
    'Practice: W/S or arrows for P1. Additional players use controllers. Online and LAN use one device per player.': [
      'Práctica: P1 usa W/S o las flechas. Los demás usan mandos. En línea y LAN: un dispositivo por jugador.',
      'Entraînement : P1 utilise W/S ou les flèches. Les autres utilisent des manettes. En ligne et LAN : un appareil par joueur.',
      'Übung: P1 nutzt W/S oder Pfeile. Weitere Spieler nutzen Controller. Online und LAN: ein Gerät pro Spieler.',
      'Treino: P1 usa W/S ou setas. Outros jogadores usam controles. Online e LAN: um dispositivo por jogador.',
      'Allenamento: P1 usa W/S o le frecce. Gli altri usano controller. Online e LAN: un dispositivo per giocatore.',
      'Oefenen: P1 gebruikt W/S of pijlen. Anderen gebruiken controllers. Online en LAN: één apparaat per speler.',
      '練習：P1はW/Sか矢印キー、他のプレイヤーはコントローラーを使います。オンラインとLANは1人1端末です。',
      '연습: P1은 W/S 또는 방향키, 다른 플레이어는 컨트롤러를 사용합니다. 온라인과 LAN은 1인 1기기입니다.',
      '练习：P1使用W/S或方向键，其他玩家使用手柄。在线和局域网模式每人使用一台设备。']
  };
  for (const [key, translations] of Object.entries(phrases)) languages.forEach((language, i) => {
    window.KING_PONG_ROYAL_TRANSLATIONS[language][key] = translations[i];
  });
})();
