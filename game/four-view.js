// Presentation and input for the square arena. Networking plugs into the same
// view through session.tick/action/close; only the host calls the core step.
let twoPlayerRelativeView = false;
let fourView = null;
function twoPlayerViewRotated() { return twoPlayerRelativeView && mode === 2 && isLanGuestActive(); }

class FourPlayerView {
  constructor() {
    this.visible = false;
    this.active = false;
    this.side = 0;
    this.relative = true;
    this.target = null;
    this.previousAt = null;
    this.accumulator = 0;
    this.session = null;
    this.colors = ['#ffe36b', '#79d6ff', '#ff91c4', '#b4ef8b'];
    this.screen = document.createElement('section');
    this.screen.id = 'fourScreen';
    this.screen.className = 'four-screen';
    this.screen.hidden = true;
    this.screen.setAttribute('aria-label', localizeText('Four Player'));
    document.body.append(this.screen);
    this.build();
    window.addEventListener('keyup', e => { if (this.visible) keys.delete(e.key); });
    window.addEventListener('blur', () => { if (this.active) { this.target = null; this.action('pause'); } });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.active) { this.previousAt = null; this.accumulator = 0; this.target = null; this.action('pause'); }
    });
  }
  text(tag, value, className = '') {
    const el = document.createElement(tag); el.className = className;
    setLocalizedText(el, value); return el;
  }
  button(id, value, action) { return royalButton(id, value, action); }
  select(id, label, options) {
    const row = this.text('label', label, 'four-field');
    const select = document.createElement('select'); select.id = id;
    for (const [value, label] of options) {
      const option = this.text('option', label); option.value = value; select.append(option);
    }
    row.append(select); this.settings.append(row); return select;
  }
  check(id, label, initial = false) {
    const row = this.text('label', label, 'four-check'), box = document.createElement('input');
    box.type = 'checkbox'; box.id = id; box.checked = initial; row.prepend(box); this.settings.append(row); return box;
  }
  build() {
    const header = document.createElement('header'); header.className = 'four-header';
    this.heading = this.text('h2', 'Four Player');
    header.append(this.button('fourBack', 'Back', () => this.leave()), this.heading,
      this.button('fourMenu', 'Menu (M)', () => { this.action('pause'); this.menu.hidden = false; }));
    this.screen.append(header);
    this.setup = document.createElement('div'); this.setup.className = 'four-setup';
    this.settings = document.createElement('div'); this.settings.className = 'four-settings';
    this.setup.append(this.settings);
    this.variant = this.select('fourVariant', 'Match type', [['ffa', 'Free-for-All'], ['teams', 'Two versus Two']]);
    this.lives = this.select('fourLives', 'Lives', [[3, '3'], [5, '5'], [10, '10']]);
    this.goal = this.select('fourGoal', 'Team goal', [[5, '5'], [10, '10'], [20, '20']]); this.goal.value = '10';
    this.difficulty = this.select('fourDifficulty', 'Bot difficulty', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']]); this.difficulty.value = 'normal';
    this.powerups = this.check('fourPowerups', 'Royal Powerups', true);
    this.hiddenWall = this.check('fourHiddenWall', 'The Hidden Wall');
    this.relativeBox = this.check('fourPerspective', 'My paddle on the left', true);
    this.relativeBox.addEventListener('change', () => { this.relative = this.relativeBox.checked; this.target = null; });
    this.paddle = this.select('fourPaddle', 'Choose your paddle', paddleCatalog.map(p => [p.id, p.profile.name]));
    this.rules = this.text('p', 'Lose a life when your wall concedes. Eliminated walls become neutral. Last player wins.', 'four-rules');
    this.setup.append(this.rules);
    this.variant.addEventListener('change', () => this.syncSettings());
    this.syncSettings();
    this.networkPanel = document.createElement('div'); this.networkPanel.id = 'fourNetwork';
    this.setup.append(this.networkPanel);
    this.localControls = document.createElement('div'); this.localControls.className = 'four-actions';
    this.localCount = this.select('fourLocalHumans', 'Same-device players', [[1, '1'], [2, '2'], [3, '3'], [4, '4']]);
    this.localControls.append(this.button('fourPractice', 'Practice with bots', () => this.practice()));
    this.setup.append(this.localControls, this.text('p', 'Practice: W/S or arrows for P1. Additional players use controllers. Online and LAN use one device per player.', 'four-note'));
    this.screen.append(this.setup);
    this.play = document.createElement('div'); this.play.className = 'four-play'; this.play.hidden = true;
    this.board = document.createElement('canvas'); this.board.id = 'fourCanvas'; this.board.tabIndex = 0;
    this.board.setAttribute('aria-label', localizeText('Four-player arena'));
    this.board.width = this.board.height = 960;
    this.context = this.board.getContext('2d');
    this.scoreboard = document.createElement('aside'); this.scoreboard.id = 'fourScoreboard'; this.scoreboard.className = 'four-scoreboard';
    this.scoreRows = Array.from({length: 4}, (_, i) => { const el = document.createElement('p');
      el.style.borderColor = this.colors[i]; this.scoreboard.append(el); return el; });
    this.result = this.text('p', '', 'four-result'); this.result.setAttribute('aria-live', 'polite'); this.scoreboard.append(this.result);
    this.route = this.text('p', '', 'four-route'); this.scoreboard.append(this.route);
    this.play.append(this.board, this.scoreboard); this.screen.append(this.play);
    this.menu = document.createElement('div'); this.menu.className = 'four-pause'; this.menu.hidden = true;
    this.menu.append(this.text('h3', 'PAUSED'), this.button('fourResume', 'Resume', () => this.action('resume')),
      this.button('fourCloseMenu', 'Close menu', () => { this.menu.hidden = true; this.board.focus(); }),
      this.button('fourRematch', 'Rematch', () => this.action('rematch')),
      this.button('fourExit', 'Back', () => this.leave()));
    this.screen.append(this.menu);
    this.board.addEventListener('pointerdown', e => { this.board.setPointerCapture(e.pointerId); this.touch(e); });
    this.board.addEventListener('pointermove', e => { if (this.board.hasPointerCapture(e.pointerId)) this.touch(e); });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) this.board.addEventListener(name, () => { this.target = null; });
  }
  syncSettings() {
    const teams = this.variant.value === 'teams';
    this.lives.parentElement.hidden = teams; this.goal.parentElement.hidden = !teams;
    setLocalizedText(this.rules || document.createElement('p'), teams ?
      'Opposite walls are teammates. A conceded goal gives the other team a point. First to the team goal wins.' :
      'Lose a life when your wall concedes. Eliminated walls become neutral. Last player wins.');
  }
  options(bots = [false, true, true, true]) {
    return KingPongFour.config({variant: this.variant.value, lives: Number(this.lives.value), goal: Number(this.goal.value),
      difficulty: this.difficulty.value, powerups: this.powerups.checked,
      hiddenWall: this.hiddenWall.checked && isBossUnlocked(), bots});
  }
  open(transport = 'online') {
    this.leave(false);
    closeLanConnection(false);
    stopMatchmaking();
    this.visible = true; this.transport = transport;
    this.screen.hidden = false; this.setup.hidden = false; this.play.hidden = true;
    byId('fourMenu').hidden = true;
    document.body.classList.add('four-open');
    this.hiddenWall.disabled = !isBossUnlocked();
    if (this.hiddenWall.disabled) this.hiddenWall.checked = false;
    this.hiddenWall.title = localizeText('Complete all 18 campaign levels to unlock this arena.');
    if (typeof installFourNetworkUi === 'function') installFourNetworkUi(this);
    this.variant.focus();
  }
  practice() {
    if (this.session) this.session.close(); this.session = null;
    const humans = Number(this.localCount.value);
    this.localHumans = humans;
    this.side = 0;
    this.start(this.options(Array.from({length: 4}, (_, i) => i >= humans)));
  }
  start(options, initial = null) {
    this.state = initial || KingPongFour.create(options, crypto.getRandomValues(new Uint32Array(1))[0]);
    this.previous = this.current = KingPongFour.unpack(KingPongFour.pack(this.state), this.state.config);
    this.active = true; this.visible = true; this.previousAt = null; this.accumulator = 0; this.lastCue = this.state.eventSeq;
    this.setup.hidden = true; this.play.hidden = false; this.menu.hidden = true; byId('fourMenu').hidden = false;
    this.screen.hidden = false; document.body.classList.add('four-open');
    hideTitleScreen(); clearHeldInput(); this.board.focus();
    requestRoyalLandscape(); this.paint(this.state); this.syncScores();
  }
  leave(title = true) {
    if (this.session) this.session.close();
    this.session = null; this.visible = this.active = false; this.target = null;
    stopRoyalPowerupSound();
    this.screen.hidden = this.menu.hidden = true;
    document.body.classList.remove('four-open'); clearHeldInput(); resetFrameClock();
    if (title) showTitleScreen();
  }
  action(name) {
    if (!this.active) return;
    if (this.session) { this.session.action(name); return; }
    if (name === 'pause') { KingPongFour.pause(this.state); this.menu.hidden = false; }
    if (name === 'resume') { KingPongFour.resume(this.state); this.menu.hidden = true; }
    if (name === 'rematch') this.start(this.state.config);
    clearHeldInput(); this.target = null;
  }
  key(e) {
    if (!this.visible) return;
    e.stopImmediatePropagation();
    if (e.key === 'Tab') {
      const controls = [...(this.menu.hidden ? this.screen : this.menu).querySelectorAll('button,input,select,textarea,canvas')].filter(el => !el.disabled && el.getClientRects().length);
      const index = controls.indexOf(document.activeElement);
      controls[(index + (e.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus(); e.preventDefault(); return;
    }
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (!this.active) { if (e.key === 'Escape') this.leave(); return; }
    if (['m', 'M', 'Escape', 'p', 'P'].includes(e.key)) {
      e.preventDefault(); if (!e.repeat) {
        if (e.key.toLowerCase() === 'p' && this.state.paused) this.action('resume');
        else if (!this.menu.hidden) { this.menu.hidden = true; this.board.focus(); }
        else { this.action('pause'); this.menu.hidden = false; }
      } return;
    }
    if (['w', 'W', 's', 'S', 'ArrowUp', 'ArrowDown'].includes(e.key)) { keys.add(e.key); e.preventDefault(); }
  }
  touch(e) {
    const rect = this.board.getBoundingClientRect(), K = KingPongFour;
    const x = (e.clientX - rect.left) / rect.width * K.SIZE;
    const y = (e.clientY - rect.top) / rect.height * K.SIZE;
    const point = K.worldPoint(this.relative ? this.side : 0, x, y);
    this.target = Math.max(0, Math.min(K.SIZE - K.PADDLE, point[this.side < 2 ? 1 : 0] - K.PADDLE / 2));
    e.preventDefault();
  }
  input(index = this.side, local = false) {
    const pads = getConnectedGamepads();
    const pad = local && this.localHumans > 1 ? (index > 0 ? pads[index - 1] : null) : pads[0];
    const keyboard = index === this.side ? (keys.has('s') || keys.has('S') || keys.has('ArrowDown') ? 1 : 0) -
      (keys.has('w') || keys.has('W') || keys.has('ArrowUp') ? 1 : 0) : 0;
    let axis = Math.max(-1, Math.min(1, keyboard + (pad ? gamepadVertical(pad, 1) : 0)));
    if (index === this.side && this.relative) axis = KingPongFour.viewInput(this.side, axis, null).axis;
    return {axis: gameWindowFocused && !document.hidden ? axis : 0,
      target: gameWindowFocused && index === this.side ? this.target : null};
  }
  frame(now) {
    if (!this.active || !Number.isFinite(now)) return;
    const primary = getConnectedGamepads()[0], menuPressed = Boolean(primary?.buttons?.[9]?.pressed);
    if (menuPressed && !this.menuPressed) { const show = this.menu.hidden; this.action('pause'); this.menu.hidden = !show; }
    this.menuPressed = menuPressed;
    if (document.hidden) { this.previousAt = null; this.accumulator = 0; return; }
    if (this.previousAt === null) this.previousAt = now;
    this.accumulator = Math.min(this.accumulator + Math.max(0, now - this.previousAt), 5 * 1000 / 60);
    this.previousAt = now;
    while (this.accumulator + 1e-6 >= 1000 / 60) {
      this.previous = this.current;
      if (this.session) this.session.tick(this.input(), now);
      else KingPongFour.step(this.state, Array.from({length: 4}, (_, i) => this.input(i, true)));
      this.current = KingPongFour.unpack(KingPongFour.pack(this.state), this.state.config);
      this.accumulator = Math.max(0, this.accumulator - 1000 / 60);
    }
    const display = this.session?.visual ? this.session.visual(now) :
      KingPongFour.interpolate(this.previous, this.current, this.accumulator / (1000 / 60));
    if (!this.state.paused || this.lastPaint === undefined || now - this.lastPaint >= 100) {
      this.paint(display || this.state); this.lastPaint = now;
    }
    this.syncScores(); this.sounds();
  }
  sounds() {
    for (const e of this.state.events) {
      if (e[0] <= this.lastCue) continue;
      if (this.state.tick - e[3] < 30 && !this.state.paused && !document.hidden) {
        if (e[1] === 'spawn' || e[1] === 'pickup') playRoyalPowerupSound(e[1]);
        else if (e[1] === 'hit') playImpactSound(320, .035);
        else if (e[1] === 'guard') playImpactSound(880, .055, .045, 'shield');
      }
    }
    this.lastCue = this.state.eventSeq;
  }
  syncScores() {
    const s = this.state, K = KingPongFour;
    for (const p of s.paddles) {
      const label = 'P' + (p.side + 1) + (p.side === this.side ? ' · ' + localizeText('You') : '') +
        (s.config.bots[p.side] ? ' · ' + localizeText('Bot') : '') + ' · ' +
        (s.config.variant === 'teams' ? localizeText('Team') + ' ' + (K.TEAM[p.side] ? 'B' : 'A') + ' · ' + s.scores[K.TEAM[p.side]] + '/' + s.config.goal :
          p.alive ? '♥ ' + p.lives : localizeText('Eliminated'));
      if (this.scoreRows[p.side].textContent !== label) this.scoreRows[p.side].textContent = label;
    }
    const message = this.disconnectedMessage ? localizeText(this.disconnectedMessage) : s.winner >= 0 ? localizeText('Winner') + ': ' + (s.config.variant === 'teams' ? localizeText('Team') + ' ' +
      (s.winner ? 'B' : 'A') : 'P' + (s.winner + 1)) : s.paused ? localizeText('PAUSED') :
      s.countdown > 0 ? String(Math.ceil(s.countdown / 60)) : '';
    if (this.result.textContent !== message) this.result.textContent = message;
    if (s.winner >= 0) this.menu.hidden = false;
  }
  paint(s) {
    const K = KingPongFour, c = this.context, side = this.relative ? this.side : 0;
    const scale = Math.min(3, devicePixelRatio || 1), pixels = Math.round(K.SIZE * scale);
    if (this.board.width !== pixels) this.board.width = this.board.height = pixels;
    c.setTransform(scale, 0, 0, scale, 0, 0); c.imageSmoothingEnabled = false;
    c.fillStyle = '#080a12'; c.fillRect(0, 0, K.SIZE, K.SIZE);
    c.strokeStyle = '#333448'; c.lineWidth = 1; c.strokeRect(.5, .5, K.SIZE - 1, K.SIZE - 1);
    c.save(); c.translate(K.SIZE / 2, K.SIZE / 2); c.rotate([0, Math.PI, -Math.PI / 2, Math.PI / 2][side]); c.translate(-K.SIZE / 2, -K.SIZE / 2);
    for (const r of K.obstacleRects()) {
      const hidden = s.config.hiddenWall && Math.floor(s.activeTick / 90) % 2;
      c.fillStyle = hidden ? '#151724' : '#747691'; c.fillRect(r.x, r.y, r.w, r.h);
      c.strokeStyle = hidden ? '#292b3f' : '#b1b3d1'; c.strokeRect(r.x + .5, r.y + .5, r.w - 1, r.h - 1);
    }
    for (const p of s.paddles) {
      const r = K.paddleRect(p.side, p.pos);
      c.fillStyle = this.colors[p.side];
      if (p.alive) {
        // Reuse the selected classic paddle silhouette in its own wall coordinates.
        c.save();
        if (p.side === 0) c.translate(r.x, r.y);
        else if (p.side === 1) { c.translate(r.x + r.w, r.y + r.h); c.rotate(Math.PI); }
        else if (p.side === 2) { c.translate(r.x + r.w, r.y); c.rotate(Math.PI / 2); }
        else { c.translate(r.x, r.y + r.h); c.rotate(-Math.PI / 2); }
        const id = this.session?.paddles?.[p.side] || (p.side === this.side ? this.paddle.value : 'classic');
        const profile = (paddleCatalog.find(entry => entry.id === id) || paddleCatalog[0]).profile;
        c.strokeStyle = this.colors[p.side]; c.lineWidth = 1; c.strokeRect(.5, .5, 9, 63);
        const width = PADDLE_W + Math.max(0, ...(profile.offsets || [0]));
        c.beginPath(); c.rect(0, 0, 10, 64); c.clip(); c.scale(10 / width, 1);
        drawPaddleShape({x: 0, y: 0}, 1, profile, this.colors[p.side], c);
        c.restore();
      }
      if (p.guard || !p.alive) {
        c.fillStyle = p.alive ? this.colors[p.side] : '#6a6b80';
        if (p.side < 2) c.fillRect(p.side ? K.SIZE - 3 : 0, 0, 3, K.SIZE);
        else c.fillRect(0, p.side === 3 ? K.SIZE - 3 : 0, K.SIZE, 3);
      }
    }
    if (s.pickup) {
      const p = s.pickup, icon = royalPickupSprite(p.type);
      const age = s.activeTick - p.born;
      if (age < 60) {
        c.strokeStyle = '#ffd469'; c.lineWidth = 2; c.globalAlpha = (1 - age / 60) * .5;
        c.beginPath(); c.arc(p.x, p.y, 12 + age * .7, 0, 2 * Math.PI); c.stroke(); c.globalAlpha = 1;
      }
      if (icon?.complete) c.drawImage(icon, p.x - 14, p.y - 14, 28, 28);
    }
    for (const b of s.balls) {
      c.globalAlpha = b.split ? .62 : 1;
      c.fillStyle = b.split ? '#c493ff' : b.rush ? '#ff944f' : '#ffe36b';
      // Small cached halo, followed by a sharp, directly drawn opaque core.
      if (!this.halo) {
        this.halo = document.createElement('canvas'); this.halo.width = this.halo.height = 48;
        const hc = this.halo.getContext('2d'), gradient = hc.createRadialGradient(24, 24, 4, 24, 24, 24);
        gradient.addColorStop(0, 'rgba(255,227,107,.55)'); gradient.addColorStop(1, 'rgba(255,227,107,0)');
        hc.fillStyle = gradient; hc.fillRect(0, 0, 48, 48); hc.clearRect(20, 20, 8, 8);
      }
      c.drawImage(this.halo, b.x - 24, b.y - 24); c.fillRect(b.x - 4, b.y - 4, 8, 8);
    }
    c.globalAlpha = 1; c.restore();
    c.font = 'bold 13px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const p of s.paddles) {
      const xy = p.side === 0 ? [44, p.pos + 32] : p.side === 1 ? [436, p.pos + 32] : p.side === 2 ? [p.pos + 32, 44] : [p.pos + 32, 436];
      const point = K.viewPoint(side, ...xy); c.fillStyle = this.colors[p.side]; c.fillText('P' + (p.side + 1) + (p.guard ? ' · ' + Math.ceil(p.guard / 60) : ''), ...point);
    }
    if (s.paused || s.countdown > 0) {
      c.fillStyle = '#fff'; c.font = 'bold 30px monospace';
      c.fillText(s.paused ? localizeText('PAUSED') : String(Math.ceil(s.countdown / 60)), 240, 240);
    }
  }
}

function installFourMenus() {
  if (fourView) return;
  fourView = new FourPlayerView();
  installMultiplayerSafety();
  const choices = royalDialog('onlinePlayerCount', 'Play Online');
  choices.append(royalButton('onlineTwoPlayers', 'Two Player', () => {
    byId('onlinePlayerCount').hidden = true; startOnlineSetup(true);
  }), royalButton('onlineFourPlayers', 'Up to Four Players', () => {
    byId('onlinePlayerCount').hidden = true; fourView.open('online');
  }), royalButton('onlineCountBack', 'Back', () => { byId('onlinePlayerCount').hidden = true; document.querySelector('.primary-online').focus(); }));
  document.querySelector('.primary-online').addEventListener('click', e => {
    e.stopImmediatePropagation(); byId('onlinePlayerCount').hidden = false; byId('onlineTwoPlayers').focus();
  }, true);
  const perspective = document.createElement('label'); perspective.className = 'four-check';
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = 'twoPlayerPerspective';
  const label = document.createElement('span'); setLocalizedText(label, 'My paddle on the left');
  checkbox.addEventListener('change', () => { twoPlayerRelativeView = checkbox.checked; clearHeldInput(); resetVisualHistory(); });
  perspective.append(checkbox, label); byId('displaySettings').append(perspective);
  const localRead = readLocalLanInput;
  window.readLocalLanInput = (...args) => {
    const input = localRead(...args);
    return twoPlayerViewRotated() ? {axis: -input.axis, targetY: input.targetY === null ? null : H - PADDLE_H - input.targetY} : input;
  };
}
