// Waterlife — you are an octopus exploring the ocean from the reef to the abyss.
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const dark = document.createElement('canvas');
  const dctx = dark.getContext('2d');
  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    dark.width = Math.ceil(W / 2);
    dark.height = Math.ceil(H / 2);
  }
  window.addEventListener('resize', resize);
  resize();

  const $ = (sel) => document.querySelector(sel);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  function mulberry32(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------------------
  // World
  // ---------------------------------------------------------------------------

  const WORLD_W = 6000, WORLD_H = 6400;
  const TWILIGHT_Y = 1600, MIDNIGHT_Y = 3600;

  // Continental shelf on the left, a steep slope, then the abyssal plain.
  function floorY(x) {
    const bumps = Math.sin(x / 310) * 40 + Math.sin(x / 97 + 1.3) * 14 + Math.sin(x / 41) * 5;
    if (x < 2600) return 900 + x * 0.13 + bumps;
    if (x < 3600) {
      const u = (x - 2600) / 1000;
      const e = u * u * (3 - 2 * u);
      return lerp(900 + 2600 * 0.13, 6200, e) + bumps * (1 - e * 0.5);
    }
    return 6200 + bumps * 0.5;
  }

  function depthMeters(y) {
    if (y <= TWILIGHT_Y) return (y / TWILIGHT_Y) * 200;
    if (y <= MIDNIGHT_Y) return 200 + ((y - TWILIGHT_Y) / (MIDNIGHT_Y - TWILIGHT_Y)) * 800;
    return 1000 + ((y - MIDNIGHT_Y) / (WORLD_H - MIDNIGHT_Y)) * 3000;
  }

  const zoneOf = (y) => (y < TWILIGHT_Y ? 'sunlit' : y < MIDNIGHT_Y ? 'twilight' : 'midnight');

  const WATER_STOPS = [[0, [78, 190, 235]], [700, [28, 124, 184]], [1600, [12, 66, 120]], [2600, [6, 34, 72]], [3600, [3, 15, 38]], [6400, [1, 4, 12]]];
  const FLOOR_STOPS = [[900, [222, 198, 142]], [1400, [168, 146, 104]], [2600, [78, 76, 84]], [6400, [26, 25, 32]]];

  function sampleStops(stops, y) {
    if (y <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      const [y1, c1] = stops[i];
      if (y <= y1) {
        const [y0, c0] = stops[i - 1];
        const u = (y - y0) / (y1 - y0);
        return [lerp(c0[0], c1[0], u), lerp(c0[1], c1[1], u), lerp(c0[2], c1[2], u)];
      }
    }
    return stops[stops.length - 1][1];
  }
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  const floorGrad = ctx.createLinearGradient(0, 860, 0, 6400);
  for (const [y, c] of FLOOR_STOPS) floorGrad.addColorStop((y - 860) / (6400 - 860), rgb(c));
  const rayGrad = ctx.createLinearGradient(0, 0, 0, 950);
  rayGrad.addColorStop(0, 'rgba(255,255,230,0.13)');
  rayGrad.addColorStop(1, 'rgba(255,255,230,0)');
  const skyGrad = ctx.createLinearGradient(0, -220, 0, 0);
  skyGrad.addColorStop(0, '#a9defa');
  skyGrad.addColorStop(1, '#e3f6ff');

  // ---------------------------------------------------------------------------
  // Decor (seeded so the reef looks the same every visit)
  // ---------------------------------------------------------------------------

  const rng = mulberry32(42);
  const DEN_X = 600;
  const ANEMONE_XS = [900, 1420, 2320];

  const seaweeds = [];
  for (let i = 0; i < 70; i++) {
    const x = 120 + rng() * 2900;
    if (Math.abs(x - DEN_X) < 90) continue;
    seaweeds.push({ x, h: 60 + rng() * 120, ph: rng() * TAU, w: 4 + rng() * 4, c: ['#2f8f4e', '#3fa35a', '#5b9e3a', '#2a7a5e'][(rng() * 4) | 0] });
  }
  for (let i = 0; i < 45; i++) {
    seaweeds.push({ x: 1610 + rng() * 220, h: 40 + rng() * 55, ph: rng() * TAU, w: 2.5, c: '#62b04c' });
  }

  function makeBranch(segs, x, y, a, len, w, depth) {
    const nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len;
    segs.push([x, y, nx, ny, w]);
    if (depth <= 0) return;
    const n = 2 + (rng() < 0.3 ? 1 : 0);
    for (let i = 0; i < n; i++) makeBranch(segs, nx, ny, a + (rng() - 0.5) * 1.2, len * (0.6 + rng() * 0.2), w * 0.7, depth - 1);
  }

  const CORAL_COLORS = ['#ff7f7f', '#ffb347', '#c38bff', '#ff6fb5', '#6fd3c4', '#f9e26b'];
  const corals = [];
  for (let i = 0; i < 48; i++) {
    const x = 220 + rng() * 2300;
    if (Math.abs(x - DEN_X) < 110 || ANEMONE_XS.some((ax) => Math.abs(x - ax) < 50)) continue;
    const type = ['branch', 'brain', 'fan', 'tube'][(rng() * 4) | 0];
    const c = { x, type, color: CORAL_COLORS[(rng() * CORAL_COLORS.length) | 0], size: 20 + rng() * 30 };
    if (type === 'branch') { c.segs = []; makeBranch(c.segs, 0, 0, -Math.PI / 2 + (rng() - 0.5) * 0.4, c.size * 0.9, 6, 3); }
    if (type === 'fan') c.angles = Array.from({ length: 9 }, (_, k) => -Math.PI / 2 + (k - 4) * 0.17 + (rng() - 0.5) * 0.08);
    if (type === 'tube') c.tubes = Array.from({ length: 3 + ((rng() * 3) | 0) }, (_, k) => [(k - 2) * 9 + rng() * 4, c.size * (0.6 + rng() * 0.8)]);
    corals.push(c);
  }

  const rocks = [];
  for (let i = 0; i < 45; i++) {
    const x = 2600 + rng() * 3400;
    rocks.push({ x, rx: 25 + rng() * 70, ry: 12 + rng() * 30, shade: rng() });
  }

  const WHALE_FALL_X = 4820;

  // ---------------------------------------------------------------------------
  // Entities
  // ---------------------------------------------------------------------------

  const den = { x: DEN_X, y: floorY(DEN_X) - 34 };

  const octo = {
    x: den.x, y: den.y - 6, vx: 0, vy: 0, ang: -Math.PI / 2,
    hp: 100, ink: 100, camo: false, inv: 0, inDen: true, camoColor: '#000',
  };

  function spawnPoint(sp) {
    for (let i = 0; i < 300; i++) {
      const x = rand(sp.home.x[0], sp.home.x[1]);
      if (sp.floor != null) return { x, y: floorY(x) - sp.floor * sp.size };
      const y = rand(sp.home.y[0], sp.home.y[1]);
      if (y < floorY(x) - sp.size * 0.6 - 30) return { x, y };
    }
    return { x: sp.home.x[0], y: sp.home.y[0] };
  }

  const creatures = SPECIES.map((sp) => {
    const p = spawnPoint(sp);
    return { sp, x: p.x, y: p.y, ax: p.x, ay: p.y, vx: 0, vy: 0, tx: null, ty: null, face: Math.random() < 0.5 ? -1 : 1, ph: rand(0, 100) };
  });

  const SHARK_BANDS = [
    { x0: 900, x1: 3000, y0: 250, y1: 800 },
    { x0: 3200, x1: 5800, y0: 200, y1: 1300 },
    { x0: 3700, x1: 5800, y0: 1800, y1: 2800 },
    { x0: 3800, x1: 5800, y0: 2900, y1: 3500 },
  ];
  const sharks = SHARK_BANDS.map((b) => ({
    band: b, x: rand(b.x0, b.x1), y: rand(b.y0, b.y1), vx: 0, vy: 0, tx: null, ty: null,
    confused: 0, face: 1, ph: rand(0, 10), mode: 'patrol', size: 170,
  }));

  function spawnPrey() {
    for (let i = 0; i < 300; i++) {
      const x = rand(150, WORLD_W - 150), y = rand(80, 3400);
      if (y < floorY(x) - 40) return { x, y, bx: x, by: y, ph: rand(0, TAU), alive: true, respawn: 0, face: 1 };
    }
    return { x: 800, y: 500, bx: 800, by: 500, ph: 0, alive: true, respawn: 0, face: 1 };
  }
  const prey = Array.from({ length: 36 }, spawnPrey);

  const bubbles = [];
  const inkParts = [];
  const inkClouds = [];
  const snow = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), r: rand(0.6, 2), s: rand(4, 14), p: rand(0.3, 0.9) }));

  const state = {
    started: false, paused: true, time: 0, playTime: 0,
    discovered: new Set(), quizzed: new Set(),
    pearls: 0, quizRight: 0, quizTotal: 0,
    zonesSeen: new Set(), near: null, won: false,
    shake: 0, flash: 0, factTimer: 75, factIndex: Math.floor(Math.random() * OCTO_FACTS.length),
  };

  const cam = { x: 0, y: 0, init: false };
  const keys = new Set();
  const pointer = { down: false, x: 0, y: 0 };

  // ---------------------------------------------------------------------------
  // Audio (tiny synthesized blips)
  // ---------------------------------------------------------------------------

  let actx = null;
  let muted = false;

  function initAudio() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { actx = null; }
  }

  function tone(f0, f1, dur, type = 'sine', vol = 0.12, delay = 0) {
    if (muted || !actx) return;
    const t0 = actx.currentTime + delay;
    const osc = actx.createOscillator();
    const g = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(actx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  const SFX = {
    discover: () => { tone(520, 780, 0.18); tone(780, 1170, 0.28, 'sine', 0.1, 0.12); },
    eat: () => tone(300, 620, 0.1, 'triangle', 0.1),
    hurt: () => tone(240, 70, 0.4, 'sawtooth', 0.08),
    ink: () => tone(180, 50, 0.45, 'triangle', 0.16),
    right: () => { tone(660, 990, 0.15); tone(990, 1320, 0.22, 'sine', 0.1, 0.12); },
    wrong: () => tone(300, 170, 0.32, 'square', 0.05),
    camo: () => tone(500, 300, 0.15, 'sine', 0.06),
  };
  const sfx = (name) => { try { SFX[name](); } catch (e) { /* audio is optional */ } };

  // ---------------------------------------------------------------------------
  // HUD, toasts, prompt
  // ---------------------------------------------------------------------------

  const hud = $('#hud');
  const hpFill = $('#hpFill'), inkFill = $('#inkFill');
  const depthText = $('#depthText'), zoneText = $('#zoneText');
  const pearlText = $('#pearlText'), foundText = $('#foundText');
  const gaugeMarker = $('#gaugeMarker');
  const promptEl = $('#prompt');
  const toastEl = $('#toast');
  const camoBtn = $('#btnCamo');
  $('#totalText').textContent = SPECIES.length;

  const toastQ = [];
  const toastSeen = new Set();
  let toastTimer = 0;

  function toast(msg, opts = {}) {
    if (opts.once) {
      if (toastSeen.has(opts.once)) return;
      toastSeen.add(opts.once);
    }
    if (opts.urgent) toastQ.unshift({ msg, title: opts.title, dur: opts.dur || 5 });
    else toastQ.push({ msg, title: opts.title, dur: opts.dur || 5 });
    if (opts.urgent) toastTimer = Math.min(toastTimer, 0.01);
  }

  function updateToasts(dt) {
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) toastEl.classList.remove('show');
      return;
    }
    if (!toastQ.length) return;
    const next = toastQ.shift();
    toastEl.innerHTML = (next.title ? `<b>${next.title}</b>` : '') + `<span>${next.msg}</span>`;
    toastEl.classList.add('show');
    toastTimer = next.dur;
  }

  let hudTimer = 0;
  function updateHud(dt) {
    hudTimer -= dt;
    if (hudTimer > 0) return;
    hudTimer = 0.1;
    hpFill.style.width = `${octo.hp}%`;
    hpFill.classList.toggle('low', octo.hp < 35);
    inkFill.style.width = `${octo.ink}%`;
    inkFill.classList.toggle('ready', octo.ink >= 35);
    depthText.textContent = `${Math.round(depthMeters(octo.y)).toLocaleString()} m`;
    zoneText.textContent = ZONES[zoneOf(octo.y)].name;
    pearlText.textContent = state.pearls;
    foundText.textContent = state.discovered.size;
    gaugeMarker.style.top = `${(octo.y / WORLD_H) * 100}%`;
    camoBtn.classList.toggle('on', octo.camo);
  }

  function updatePrompt() {
    const c = state.near;
    if (!c || state.paused) { promptEl.classList.add('hidden'); return; }
    promptEl.classList.remove('hidden');
    const sx = c.x - cam.x, sy = c.y - cam.y - c.sp.size * 0.45 - 34;
    promptEl.style.transform = `translate(${clamp(sx, 70, W - 70)}px, ${clamp(sy, 60, H - 60)}px) translate(-50%, -50%)`;
  }

  // ---------------------------------------------------------------------------
  // Modals: start, fact cards, quiz, journal, win
  // ---------------------------------------------------------------------------

  const modal = $('#modal');
  const sheet = $('#sheet');
  let escHandler = null;

  function openModal(html, cls = '') {
    sheet.className = `sheet ${cls}`;
    sheet.innerHTML = html;
    sheet.scrollTop = 0;
    modal.classList.remove('hidden');
    state.paused = true;
    pointer.down = false;
    keys.clear();
    promptEl.classList.add('hidden');
    escHandler = null;
  }

  function closeModal() {
    modal.classList.add('hidden');
    sheet.innerHTML = '';
    escHandler = null;
    state.paused = !state.started;
  }

  const ZONE_BG = {
    sunlit: ['#6fd0f2', '#1f80ba'],
    twilight: ['#1c5590', '#0a2347'],
    midnight: ['#0b1a36', '#02050d'],
  };

  function setupPortrait(cv, w, h) {
    cv.width = Math.round(w * DPR);
    cv.height = Math.round(h * DPR);
    cv.style.aspectRatio = `${w} / ${h}`;
    return { w, h };
  }

  function renderPortrait(cv, sp, t, silhouette = false) {
    const c = cv.getContext('2d');
    const w = cv.width / DPR, h = cv.height / DPR;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, w, h);
    const f = sp.frame;
    const fit = Math.min((w * 0.82) / (f.w * sp.size), (h * 0.78) / (f.h * sp.size));
    c.save();
    c.translate(w / 2 - f.cx * sp.size * fit, h / 2 - f.cy * sp.size * fit);
    c.scale(fit, fit);
    sp.draw(c, t, sp.size);
    if (!silhouette && sp.glow) {
      c.globalCompositeOperation = 'lighter';
      sp.glow(c, t, sp.size);
    }
    c.restore();
    if (silhouette) {
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = '#16324f';
      c.fillRect(0, 0, w, h);
    }
    c.globalCompositeOperation = 'destination-over';
    const [top, bottom] = silhouette ? ['#dbe8f2', '#b4cadc'] : ZONE_BG[sp.zone];
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'source-over';
  }

  function animatePortrait(cv, sp) {
    const loop = () => {
      if (!cv.isConnected) return;
      renderPortrait(cv, sp, performance.now() / 1000);
      requestAnimationFrame(loop);
    };
    loop();
  }

  function showStart() {
    const fact = OCTO_FACTS[state.factIndex % OCTO_FACTS.length];
    openModal(`
      <div class="title">Waterlife</div>
      <p class="lead">You’re a curious octopus. Explore from the sunny coral reef down to the pitch-black deep, and study every creature you meet to fill your <b>Field Journal</b>.</p>
      <div class="factbox"><span class="kicker">Octopus fact</span>${fact}</div>
      <div class="controls">
        <div><kbd>WASD</kbd><kbd>Arrows</kbd><span>Swim, or hold the mouse or a finger where you want to go</span></div>
        <div><kbd>Shift</kbd><span>Jet boost (or point far away)</span></div>
        <div><kbd>E</kbd><span>Study a creature</span></div>
        <div><kbd>Space</kbd><span>Squirt ink to escape predators</span></div>
        <div><kbd>C</kbd><span>Camouflage: sharks can’t see you, but you move slowly</span></div>
        <div><kbd>J</kbd><span>Field Journal</span></div>
        <div><kbd>M</kbd><span>Sound on/off</span></div>
      </div>
      <p class="touch-only muted"><b>On a phone or tablet:</b> touch where you want to swim, and use the <b>Ink</b> and <b>Hide</b> buttons.</p>
      <p class="muted">Eat shrimp to heal, and rest in your den if you get hurt. Every 3 species you study unlocks an ocean quiz worth bonus pearls.</p>
      <button class="primary big" id="startBtn">Dive in</button>
    `, 'start');
    $('#startBtn').onclick = startGame;
    escHandler = startGame;
  }

  function startGame() {
    initAudio();
    state.started = true;
    closeModal();
    hud.classList.remove('hidden');
    document.body.classList.add('playing');
    const how = document.body.classList.contains('touch') ? 'tap <b>Study</b>' : 'press <kbd>E</kbd>';
    toast(`Swim close to a sparkling creature and ${how} to learn about it.`, { title: 'Welcome to the reef!', dur: 6, once: 'welcome' });
  }

  function showCard(sp, isNew, onDone) {
    const z = ZONES[sp.zone];
    openModal(`
      <div class="card-art"><canvas class="portrait"></canvas>${isNew ? '<span class="badge">New species! +1 pearl</span>' : ''}</div>
      <div class="chip zone-${sp.zone}">${z.name} · ${sp.lives}</div>
      <h2>${sp.name}</h2>
      <p class="sci">${sp.sci}</p>
      <ul class="facts">${sp.facts.map((f) => `<li>${f}</li>`).join('')}</ul>
      <button class="primary" id="cardDone">${isNew ? 'Keep exploring' : 'Back'}</button>
    `, 'card');
    const cv = sheet.querySelector('canvas');
    setupPortrait(cv, 480, 240);
    animatePortrait(cv, sp);
    const done = () => (onDone ? onDone() : closeModal());
    $('#cardDone').onclick = done;
    escHandler = done;
  }

  function study(c) {
    const sp = c.sp;
    if (state.discovered.has(sp.id)) return;
    state.discovered.add(sp.id);
    state.pearls += 1;
    state.near = null;
    sfx('discover');
    showCard(sp, true, afterStudy);
  }

  function afterStudy() {
    const n = state.discovered.size;
    const finish = () => {
      if (n === SPECIES.length && !state.won) showWin();
      else closeModal();
    };
    if (n % 3 === 0) showQuiz(finish);
    else finish();
  }

  function showQuiz(onDone) {
    const pool = [...state.discovered].reverse().filter((id) => !state.quizzed.has(id));
    if (!pool.length) { onDone(); return; }
    const sp = SPECIES_BY_ID[pool[0]];
    state.quizzed.add(sp.id);
    const opts = shuffle(sp.quiz.options.map((text, i) => ({ text, ok: i === 0 })));
    openModal(`
      <div class="kicker">Ocean Quiz · ${sp.name}</div>
      <h2>${sp.quiz.q}</h2>
      <div class="options">${opts.map((o, i) => `<button class="opt" data-i="${i}"><span>${'ABCD'[i]}</span>${o.text}</button>`).join('')}</div>
      <div class="feedback hidden" id="qfb"></div>
      <button class="primary hidden" id="qNext">Continue</button>
    `, 'quiz');
    const buttons = [...sheet.querySelectorAll('.opt')];
    buttons.forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.i);
        const ok = opts[i].ok;
        state.quizTotal++;
        buttons.forEach((bb, j) => {
          bb.disabled = true;
          if (opts[j].ok) bb.classList.add('right');
          else if (j === i) bb.classList.add('wrong');
        });
        if (ok) {
          state.quizRight++;
          state.pearls += 2;
          octo.hp = Math.min(100, octo.hp + 20);
          sfx('right');
        } else {
          sfx('wrong');
        }
        const fb = $('#qfb');
        fb.innerHTML = `<b>${ok ? 'Correct! +2 pearls' : 'Not quite!'}</b> ${sp.quiz.why}`;
        fb.className = `feedback ${ok ? 'good' : 'bad'}`;
        const next = $('#qNext');
        next.classList.remove('hidden');
        next.onclick = onDone;
        next.focus();
        escHandler = onDone;
      };
    });
  }

  function openJournal() {
    if (!state.started) return;
    const n = state.discovered.size;
    const items = SPECIES.map((sp) => {
      const got = state.discovered.has(sp.id);
      return `<button class="jentry ${got ? 'got' : 'unknown'}" data-id="${sp.id}" ${got ? '' : 'disabled'}>
        <canvas></canvas>
        <span class="jname">${got ? sp.name : '???'}</span>
        <span class="jzone zone-${sp.zone}">${ZONES[sp.zone].name}</span>
      </button>`;
    }).join('');
    openModal(`
      <div class="kicker">Field Journal</div>
      <h2>${n} of ${SPECIES.length} species studied</h2>
      <p class="muted">Silhouettes are creatures you haven’t found yet. Check which zone they live in!</p>
      <div class="jgrid">${items}</div>
      <button class="primary" id="jClose">Back to the ocean</button>
    `, 'journal');
    sheet.querySelectorAll('.jentry').forEach((el) => {
      const sp = SPECIES_BY_ID[el.dataset.id];
      const cv = el.querySelector('canvas');
      setupPortrait(cv, 150, 96);
      renderPortrait(cv, sp, 1.3, !state.discovered.has(sp.id));
      el.onclick = () => showCard(sp, false, openJournal);
    });
    $('#jClose').onclick = closeModal;
    escHandler = closeModal;
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function showWin() {
    state.won = true;
    openModal(`
      <div class="kicker">Field Journal complete!</div>
      <h2>You studied all ${SPECIES.length} species</h2>
      <p class="lead">From clownfish on the sunny reef to giant isopods on the abyssal plain, you’ve explored every zone of the ocean.</p>
      <div class="stats">
        <div><b>${state.pearls}</b><span>pearls</span></div>
        <div><b>${state.quizRight}/${state.quizTotal}</b><span>quiz answers</span></div>
        <div><b>${formatTime(state.playTime)}</b><span>dive time</span></div>
      </div>
      <div class="factbox"><span class="kicker">Real-world fact</span>Only about a quarter of the seafloor has been mapped in detail. Scientists discover new deep-sea species every year, so maybe you’ll find one someday!</div>
      <div class="row">
        <button class="primary" id="winKeep">Keep exploring</button>
        <button class="secondary" id="winAgain">Play again</button>
      </div>
    `, 'win');
    sfx('right');
    $('#winKeep').onclick = closeModal;
    $('#winAgain').onclick = () => location.reload();
    escHandler = closeModal;
  }

  // ---------------------------------------------------------------------------
  // Player actions
  // ---------------------------------------------------------------------------

  function squirtInk() {
    if (!state.started || state.paused) return;
    if (octo.ink < 35) {
      toast('Your ink sac needs time to refill.', { once: 'noink', urgent: true, dur: 3 });
      return;
    }
    octo.ink -= 35;
    const dx = Math.cos(octo.ang), dy = Math.sin(octo.ang);
    const bx = octo.x - dx * 22, by = octo.y - dy * 22;
    inkClouds.push({ x: bx, y: by, r: 30, life: 4.5 });
    for (let i = 0; i < 42; i++) {
      const a = rand(0, TAU), s = rand(20, 150);
      const life = rand(2.5, 4.5);
      inkParts.push({ x: bx, y: by, vx: Math.cos(a) * s - dx * 90, vy: Math.sin(a) * s - dy * 90, r: rand(8, 20), life, max: life });
    }
    octo.vx += dx * 260; octo.vy += dy * 260;
    sfx('ink');
    toast('Octopus ink is a dark cloud of melanin. It hides you and can confuse a predator’s senses.', { once: 'inkfact', title: 'Whoosh!' });
  }

  function toggleCamo() {
    if (!state.started || state.paused) return;
    octo.camo = !octo.camo;
    sfx('camo');
    if (octo.camo) toast('Octopuses change color using thousands of skin cells called chromatophores. Some can even change their skin texture!', { once: 'camofact', title: 'Camouflaged' });
  }

  function tryStudy() {
    if (state.started && !state.paused && state.near) study(state.near);
  }

  function hurt(s) {
    const dx = octo.x - s.x, dy = octo.y - s.y, d = Math.hypot(dx, dy) || 1;
    octo.hp -= 25;
    octo.inv = 1.6;
    octo.vx += (dx / d) * 420; octo.vy += (dy / d) * 420;
    s.confused = 1.5;
    state.shake = 0.4;
    state.flash = 0.5;
    sfx('hurt');
    if (octo.hp <= 0) retreat();
  }

  function retreat() {
    octo.hp = 100;
    octo.x = den.x; octo.y = den.y;
    octo.vx = octo.vy = 0;
    octo.inv = 2.5;
    octo.camo = false;
    const lost = state.pearls > 0 ? 1 : 0;
    state.pearls -= lost;
    toast(`You jetted back to your den to recover${lost ? ' and dropped a pearl' : ''}. Real octopuses spend lots of time hiding safely in dens.`, { title: 'Ouch!', urgent: true, dur: 6 });
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  function updatePlayer(dt) {
    const o = octo;
    let ax = 0, ay = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) ax -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) ax += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) ay -= 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) ay += 1;
    let boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (pointer.down) {
      const dx = pointer.x + cam.x - o.x, dy = pointer.y + cam.y - o.y, d = Math.hypot(dx, dy);
      if (d > 16) {
        const k = Math.min(1, d / 120);
        ax += (dx / d) * k; ay += (dy / d) * k;
      }
      if (d > 300) boost = true;
    }
    const al = Math.hypot(ax, ay);
    if (al > 1) { ax /= al; ay /= al; }
    if (o.camo) boost = false;

    const maxS = o.camo ? 110 : boost ? 440 : 260;
    const acc = o.camo ? 600 : boost ? 1500 : 950;
    o.vx += ax * acc * dt; o.vy += ay * acc * dt;
    const drag = Math.pow(al > 0 ? 0.4 : 0.12, dt);
    o.vx *= drag; o.vy *= drag;
    const sp = Math.hypot(o.vx, o.vy);
    if (sp > maxS) {
      const k = lerp(1, maxS / sp, Math.min(1, dt * 8));
      o.vx *= k; o.vy *= k;
    }
    o.x = clamp(o.x + o.vx * dt, 30, WORLD_W - 30);
    o.y += o.vy * dt;
    if (o.y < 34) {
      o.y = 34;
      if (o.vy < 0) o.vy = 0;
      toast('Octopuses breathe with gills, so you’ll stay below the waves.', { once: 'surface' });
    }
    const fy = floorY(o.x) - 26;
    if (o.y > fy) { o.y = fy; if (o.vy > 0) o.vy = 0; }

    const target = sp > 50 ? Math.atan2(o.vy, o.vx) : -Math.PI / 2;
    const diff = ((target - o.ang + Math.PI * 3) % TAU) - Math.PI;
    o.ang += diff * Math.min(1, dt * 6);

    o.ink = Math.min(100, o.ink + 11 * dt);
    o.inv = Math.max(0, o.inv - dt);

    o.inDen = Math.hypot(o.x - den.x, o.y - den.y) < 75;
    if (o.inDen) {
      o.hp = Math.min(100, o.hp + 12 * dt);
      if (state.playTime > 3) toast('This is your den: a safe rocky hideout. Rest here to heal. Sharks can’t reach you inside.', { once: 'den', title: 'Home sweet home' });
    }

    if (boost && sp > 200 && Math.random() < dt * 30) {
      bubbles.push({ x: o.x - Math.cos(o.ang) * 20 + rand(-6, 6), y: o.y - Math.sin(o.ang) * 20, r: rand(2, 5), vy: rand(30, 60), life: rand(1, 2) });
    }

    const z = zoneOf(o.y);
    if (!state.zonesSeen.has(z)) {
      state.zonesSeen.add(z);
      toast(ZONES[z].fact, { title: `${ZONES[z].name} · ${ZONES[z].range}`, dur: 7, urgent: z !== 'sunlit' });
    }

    // Camouflage takes on the colors around you.
    const nearFloor = o.y > floorY(o.x) - 90;
    const base = nearFloor ? sampleStops(FLOOR_STOPS, o.y) : sampleStops(WATER_STOPS, o.y);
    o.camoColor = rgb(base);

    for (const p of prey) {
      if (!p.alive) {
        p.respawn -= dt;
        if (p.respawn <= 0) Object.assign(p, spawnPrey());
        continue;
      }
      if (Math.hypot(p.x - o.x, p.y - o.y) < 34) {
        p.alive = false;
        p.respawn = 25;
        o.hp = Math.min(100, o.hp + 15);
        sfx('eat');
        for (let i = 0; i < 6; i++) bubbles.push({ x: p.x, y: p.y, r: rand(1.5, 3.5), vy: rand(20, 50), life: rand(0.6, 1.2) });
        toast('Yum! Octopuses hunt shrimp and crabs, cracking shells with a hard, parrot-like beak.', { once: 'eat', title: '+15 health' });
      }
    }

    let best = null, bd = Infinity;
    for (const c of creatures) {
      if (state.discovered.has(c.sp.id)) continue;
      const d = Math.hypot(c.x - o.x, c.y - o.y);
      if (d < 110 + c.sp.size * 0.4 && d < bd) { best = c; bd = d; }
    }
    state.near = best;

    state.factTimer -= dt;
    if (state.factTimer <= 0) {
      state.factTimer = 80;
      state.factIndex++;
      toast(OCTO_FACTS[state.factIndex % OCTO_FACTS.length], { title: 'Octopus fact' });
    }
    state.playTime += dt;
  }

  function updateCreature(c, dt) {
    const sp = c.sp;
    c.ph += dt;
    if (sp.behavior === 'hover') {
      c.x = c.ax + Math.sin(c.ph * 0.6) * sp.roam;
      c.y = c.ay + Math.sin(c.ph * 1.1) * sp.roam * 0.3;
      c.face = Math.cos(c.ph * 0.6) >= 0 ? 1 : -1;
      return;
    }
    if (sp.behavior === 'bottom') {
      const w = sp.speed / sp.roam;
      c.x = c.ax + Math.sin(c.ph * w) * sp.roam;
      c.y = floorY(c.x) - sp.floor * sp.size;
      c.face = Math.cos(c.ph * w) >= 0 ? 1 : -1;
      return;
    }
    // swim / drift: wander between random points in the creature's home range
    if (c.tx == null || Math.hypot(c.tx - c.x, c.ty - c.y) < 40) {
      const p = spawnPoint(sp);
      c.tx = p.x; c.ty = p.y;
    }
    const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy) || 1;
    c.vx = lerp(c.vx, (dx / d) * sp.speed, Math.min(1, dt * 1.5));
    c.vy = lerp(c.vy, (dy / d) * sp.speed * 0.6, Math.min(1, dt * 1.5));
    const bob = sp.behavior === 'drift' ? Math.sin(c.ph * 2.4) * 18 : Math.sin(c.ph * 1.3) * 6;
    c.x += c.vx * dt;
    c.y += (c.vy + bob) * dt;
    c.y = Math.min(c.y, floorY(c.x) - sp.size * 0.5);
    if (Math.abs(c.vx) > 4) c.face = c.vx > 0 ? 1 : -1;
  }

  function updateShark(s, dt) {
    const b = s.band, o = octo;
    s.ph += dt;
    const dx = o.x - s.x, dy = o.y - s.y, d = Math.hypot(dx, dy) || 1;
    const hidden = state.paused || o.camo || o.inDen || o.inv > 0;
    for (const c of inkClouds) {
      if (Math.hypot(c.x - s.x, c.y - s.y) < c.r + 40) {
        if (s.mode === 'chase') toast('The ink cloud confused the shark!', { once: 'inkwork', urgent: true, dur: 3 });
        s.confused = 3;
      }
    }
    let tx, ty, spd;
    if (s.confused > 0) {
      s.confused -= dt;
      s.mode = 'confused';
      tx = s.x - (dx / d) * 200; ty = s.y - (dy / d) * 200; spd = 200;
    } else if (!hidden && d < 430 && o.y > b.y0 - 350 && o.y < b.y1 + 350) {
      if (s.mode !== 'chase') {
        const touch = document.body.classList.contains('touch');
        toast(touch
          ? 'Sharks eat octopuses! Tap <b>Ink</b> to escape, <b>Hide</b> to camouflage, or swim back to your den.'
          : 'Sharks eat octopuses! Press <kbd>Space</kbd> for ink, <kbd>C</kbd> to camouflage, or swim back to your den.',
        { once: 'shark', title: 'Shark!', urgent: true, dur: 6 });
      }
      s.mode = 'chase';
      tx = o.x; ty = o.y; spd = 238;
    } else {
      s.mode = 'patrol';
      if (s.tx == null || Math.hypot(s.tx - s.x, s.ty - s.y) < 60) {
        s.tx = rand(b.x0, b.x1);
        s.ty = Math.min(rand(b.y0, b.y1), floorY(s.tx) - 120);
      }
      tx = s.tx; ty = s.ty; spd = 95;
    }
    const ex = tx - s.x, ey = ty - s.y, ed = Math.hypot(ex, ey) || 1;
    s.vx = lerp(s.vx, (ex / ed) * spd, Math.min(1, dt * 2.2));
    s.vy = lerp(s.vy, (ey / ed) * spd, Math.min(1, dt * 2.2));
    s.x = clamp(s.x + s.vx * dt, 100, WORLD_W - 100);
    s.y = clamp(s.y + s.vy * dt, 60, floorY(s.x) - 70);
    if (Math.abs(s.vx) > 5) s.face = s.vx > 0 ? 1 : -1;
    if (!hidden && s.confused <= 0 && d < 52) hurt(s);
  }

  function updateWorld(dt) {
    for (const c of creatures) updateCreature(c, dt);
    for (const s of sharks) updateShark(s, dt);

    for (const p of prey) {
      if (!p.alive) continue;
      p.ph += dt;
      const dx = p.x - octo.x, dy = p.y - octo.y, d = Math.hypot(dx, dy);
      if (d < 130 && d > 0 && state.started) {
        const nbx = p.bx + (dx / d) * 120 * dt, nby = p.by + (dy / d) * 120 * dt;
        if (nby > 40 && nby < floorY(nbx) - 30) { p.bx = nbx; p.by = nby; }
      }
      const nx = p.bx + Math.sin(p.ph * 0.8) * 20;
      p.face = nx > p.x ? 1 : -1;
      p.x = nx;
      p.y = p.by + Math.sin(p.ph * 1.7) * 8;
    }

    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.life -= dt;
      b.y -= b.vy * dt;
      b.x += Math.sin(b.life * 6) * 10 * dt;
      if (b.life <= 0 || b.y < 0) bubbles.splice(i, 1);
    }
    if (Math.random() < dt * 3 && bubbles.length < 120) {
      const x = cam.x + rand(0, W);
      const fy = floorY(x);
      if (fy < cam.y + H + 50) bubbles.push({ x, y: fy - 5, r: rand(1.5, 4), vy: rand(25, 55), life: rand(3, 6) });
    }

    for (let i = inkParts.length - 1; i >= 0; i--) {
      const p = inkParts[i];
      p.life -= dt;
      const k = Math.pow(0.2, dt);
      p.vx *= k; p.vy *= k;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.r += 14 * dt;
      if (p.life <= 0) inkParts.splice(i, 1);
    }
    for (let i = inkClouds.length - 1; i >= 0; i--) {
      const c = inkClouds[i];
      c.life -= dt;
      c.r = Math.min(150, c.r + 60 * dt);
      if (c.life <= 0) inkClouds.splice(i, 1);
    }

    for (const p of snow) {
      p.y += (p.s / H) * dt;
      if (p.y > 1) { p.y -= 1; p.x = Math.random(); }
    }
  }

  function updateCamera(dt) {
    const tx = clamp(octo.x - W / 2, 0, Math.max(0, WORLD_W - W));
    const ty = clamp(octo.y - H / 2, -180, WORLD_H - H);
    if (!cam.init) { cam.x = tx; cam.y = ty; cam.init = true; return; }
    const k = Math.min(1, dt * 5);
    cam.x = lerp(cam.x, tx, k);
    cam.y = lerp(cam.y, ty, k);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const onScreen = (x, y, m) => x > cam.x - m && x < cam.x + W + m && y > cam.y - m && y < cam.y + H + m;

  function withCreature(c, fn) {
    ctx.save();
    ctx.translate(c.x, c.y);
    if (!c.sp.noFlip) ctx.scale(c.face, 1);
    if (c.sp.behavior === 'swim') ctx.rotate(clamp(Math.atan2(c.vy, Math.abs(c.vx) + 1), -0.5, 0.5) * 0.6);
    fn();
    ctx.restore();
  }

  function drawSurface(t) {
    if (cam.y > 30) return;
    const x0 = cam.x - 20, x1 = cam.x + W + 20;
    const wave = (x) => Math.sin(x / 70 + t * 1.6) * 5 + Math.sin(x / 23 - t * 2.3) * 2;
    ctx.beginPath();
    ctx.moveTo(x0, cam.y - 20);
    for (let x = x0; x <= x1; x += 12) ctx.lineTo(x, wave(x));
    ctx.lineTo(x1, cam.y - 20);
    ctx.closePath();
    ctx.fillStyle = skyGrad;
    ctx.fill();
    ctx.beginPath();
    for (let x = x0; x <= x1; x += 12) ctx[x === x0 ? 'moveTo' : 'lineTo'](x, wave(x));
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    ctx.stroke();
    // a fluffy cloud or two
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (const [cx, cy] of [[700, -130], [2300, -150], [4100, -120], [5400, -140]]) {
      const x = cx + ((t * 6) % 400);
      if (x < x0 - 200 || x > x1 + 200) continue;
      for (const [dx, dy, r] of [[0, 0, 26], [28, -10, 30], [58, 0, 24], [30, 8, 24]]) {
        ctx.beginPath(); ctx.arc(x + dx, cy + dy, r, 0, TAU); ctx.fill();
      }
    }
  }

  function drawRays(t) {
    if (cam.y > 950) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rayGrad;
    for (let i = 0; i < 9; i++) {
      const span = W + 600;
      const x = cam.x + ((i * 331 + t * 10) % span) - 300;
      const w = 50 + ((i * 53) % 70);
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x + w, 0);
      ctx.lineTo(x + w + 260, 950); ctx.lineTo(x + 260, 950);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function drawFloor() {
    const x0 = Math.floor(cam.x / 20) * 20 - 40, x1 = cam.x + W + 40;
    ctx.beginPath();
    ctx.moveTo(x0, WORLD_H + 100);
    for (let x = x0; x <= x1; x += 20) ctx.lineTo(x, floorY(x));
    ctx.lineTo(x1, WORLD_H + 100);
    ctx.closePath();
    ctx.fillStyle = floorGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += 20) ctx[x === x0 ? 'moveTo' : 'lineTo'](x, floorY(x) + 2);
    ctx.stroke();
  }

  function drawRocks() {
    for (const r of rocks) {
      if (!onScreen(r.x, floorY(r.x), 120)) continue;
      const y = floorY(r.x);
      const c = sampleStops(FLOOR_STOPS, y);
      const k = 0.75 + r.shade * 0.4;
      ctx.fillStyle = rgb([c[0] * k, c[1] * k, c[2] * k]);
      ctx.beginPath(); ctx.ellipse(r.x, y + 4, r.rx, r.ry, 0, Math.PI, TAU); ctx.fill();
    }
  }

  function drawWhaleFall() {
    const x = WHALE_FALL_X, y = floorY(x);
    if (!onScreen(x, y, 300)) return;
    ctx.strokeStyle = '#8d8a80';
    ctx.lineCap = 'round';
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(x - 200, y - 6); ctx.lineTo(x + 170, y - 10); ctx.stroke();
    ctx.lineWidth = 5;
    for (let i = 0; i < 9; i++) {
      const rx = x - 150 + i * 34;
      ctx.beginPath(); ctx.moveTo(rx, y - 8); ctx.quadraticCurveTo(rx + 22, y - 70 + Math.abs(i - 4) * 6, rx + 8, y - 4); ctx.stroke();
    }
    ctx.fillStyle = '#8d8a80';
    ctx.beginPath(); ctx.ellipse(x + 210, y - 18, 60, 22, -0.1, 0, TAU); ctx.fill();
  }

  function drawDen() {
    const x = den.x, y = floorY(x);
    if (!onScreen(x, y, 200)) return;
    ctx.fillStyle = '#6d6a64';
    ctx.beginPath(); ctx.ellipse(x, y + 10, 110, 70, 0, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = '#5a5751';
    ctx.beginPath(); ctx.ellipse(x - 60, y + 4, 50, 36, 0, Math.PI, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 70, y + 6, 46, 30, 0, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = '#1f1d1c';
    ctx.beginPath(); ctx.ellipse(x, y - 4, 44, 32, 0, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.ellipse(x - 40, y - 52, 30, 8, -0.2, 0, TAU); ctx.fill();
  }

  function drawSeaweed(t) {
    for (const s of seaweeds) {
      if (!onScreen(s.x, floorY(s.x), 200)) continue;
      const by = floorY(s.x) + 4;
      ctx.strokeStyle = s.c;
      ctx.lineWidth = s.w;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s.x, by);
      let x = s.x, y = by;
      for (let k = 1; k <= 6; k++) {
        const u = k / 6;
        x = s.x + Math.sin(t * 1.2 + s.ph + u * 2.5) * 14 * u;
        y = by - s.h * u;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  function drawCorals() {
    for (const c of corals) {
      const by = floorY(c.x) + 6;
      if (!onScreen(c.x, by, 120)) continue;
      ctx.save();
      ctx.translate(c.x, by);
      ctx.fillStyle = c.color;
      ctx.strokeStyle = c.color;
      ctx.lineCap = 'round';
      if (c.type === 'branch') {
        for (const s of c.segs) {
          ctx.lineWidth = s[4];
          ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); ctx.stroke();
        }
      } else if (c.type === 'brain') {
        ctx.beginPath(); ctx.ellipse(0, 0, c.size, c.size * 0.75, 0, Math.PI, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 2;
        for (let i = 1; i < 4; i++) {
          ctx.beginPath(); ctx.ellipse(0, 0, c.size * i / 4, c.size * 0.75 * i / 4, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
        }
      } else if (c.type === 'fan') {
        ctx.lineWidth = 2.5;
        for (const a of c.angles) {
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * c.size * 1.6, Math.sin(a) * c.size * 1.6); ctx.stroke();
        }
        ctx.lineWidth = 1.2;
        for (let r = 0.5; r <= 1.6; r += 0.35) {
          ctx.beginPath(); ctx.arc(0, 0, c.size * r, c.angles[0], c.angles[c.angles.length - 1]); ctx.stroke();
        }
      } else {
        for (const [dx, h] of c.tubes) {
          ctx.lineWidth = 8;
          ctx.beginPath(); ctx.moveTo(dx, 0); ctx.lineTo(dx, -h); ctx.stroke();
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.beginPath(); ctx.ellipse(dx, -h, 3, 2, 0, 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  function drawAnemones(t) {
    for (const x of ANEMONE_XS) {
      const by = floorY(x) + 4;
      if (!onScreen(x, by, 120)) continue;
      ctx.fillStyle = '#b0507a';
      ctx.beginPath(); ctx.ellipse(x, by - 14, 26, 18, 0, 0, TAU); ctx.fill();
      ctx.lineCap = 'round';
      for (let i = 0; i < 18; i++) {
        const u = i / 17 - 0.5;
        const len = 46 - Math.abs(u) * 30;
        ctx.strokeStyle = i % 2 ? '#d68bff' : '#b46fe8';
        ctx.lineWidth = 6;
        ctx.beginPath();
        let px = x + u * 44, py = by - 22;
        ctx.moveTo(px, py);
        for (let k = 1; k <= 5; k++) {
          const f = k / 5;
          px = x + u * 44 + u * len * f * 0.9 + Math.sin(t * 1.8 + i * 0.7 + f * 2) * 6 * f;
          py = by - 22 - len * f;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.fillStyle = '#f3d2ff';
        ctx.beginPath(); ctx.arc(px, py, 3.5, 0, TAU); ctx.fill();
      }
    }
  }

  function drawOctopus(t) {
    const o = octo;
    const r = 24;
    const sp = Math.hypot(o.vx, o.vy), m = clamp(sp / 320, 0, 1);
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.ang + Math.PI / 2);
    let alpha = o.camo ? 0.3 + Math.sin(t * 6) * 0.05 : 1;
    if (o.inv > 0 && Math.floor(t * 16) % 2 === 0) alpha *= 0.4;
    ctx.globalAlpha = alpha;
    const body = o.camo ? o.camoColor : '#e4573f';
    const shade = o.camo ? o.camoColor : '#b9402f';
    ctx.lineCap = 'round';
    for (const pass of [0, 1]) {
      for (let i = pass; i < 8; i += 2) {
        const u = i / 7 - 0.5;
        let x = u * r * 1.1, y = r * 0.25;
        let a = Math.PI / 2 + u * (2.4 - 1.9 * m);
        const len = r * (0.25 + 0.08 * m);
        ctx.strokeStyle = pass ? body : shade;
        for (let k = 0; k < 9; k++) {
          const f = k / 9;
          a += Math.sin(t * (3 + m * 4) + i * 1.7 + k * 0.55) * (0.22 - 0.12 * m) + u * (1 - m) * 0.18 * f;
          const nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len;
          ctx.lineWidth = r * 0.3 * (1 - f * 0.85);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
          x = nx; y = ny;
        }
      }
    }
    ctx.fillStyle = body;
    ellipse(ctx, 0, r * 0.15, r * 0.72, r * 0.45); ctx.fill();
    ellipse(ctx, 0, -r * 0.4, r * 0.78, r * 1.0); ctx.fill();
    if (!o.camo) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ellipse(ctx, -r * 0.28, -r * 0.82, r * 0.2, r * 0.32, 0.3); ctx.fill();
      ctx.fillStyle = shade;
      for (const [sx, sy, sr] of [[0.3, -0.9, 0.08], [0.42, -0.55, 0.06], [-0.1, -1.1, 0.06], [0.15, -0.3, 0.05]]) {
        ellipse(ctx, sx * r, sy * r, sr * r, sr * r); ctx.fill();
      }
    }
    const blink = t % 4.3 < 0.12;
    for (const ex of [-r * 0.36, r * 0.36]) {
      ctx.fillStyle = '#fff3d6';
      ellipse(ctx, ex, r * 0.05, r * 0.2, blink ? r * 0.03 : r * 0.17); ctx.fill();
      if (!blink) {
        ctx.fillStyle = '#1b1b1b';
        ctx.fillRect(ex - r * 0.12, r * 0.02, r * 0.24, r * 0.07);
      }
    }
    ctx.restore();
  }

  function drawDarkness() {
    const a = clamp((octo.y - 600) / 2800, 0, 1) * 0.93;
    if (a < 0.02) return 0;
    const dw = dark.width, dh = dark.height;
    dctx.globalCompositeOperation = 'source-over';
    dctx.clearRect(0, 0, dw, dh);
    dctx.fillStyle = `rgba(0,3,12,${a})`;
    dctx.fillRect(0, 0, dw, dh);
    dctx.globalCompositeOperation = 'destination-out';
    const ox = (octo.x - cam.x) / 2, oy = (octo.y - cam.y) / 2;
    const R = (octo.camo ? 200 : 310) / 2;
    const g = dctx.createRadialGradient(ox, oy, 0, ox, oy, R);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.8)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    dctx.fillStyle = g;
    dctx.beginPath(); dctx.arc(ox, oy, R, 0, TAU); dctx.fill();
    ctx.drawImage(dark, 0, 0, W, H);
    return a;
  }

  function drawGlows(t, darkness) {
    for (const c of creatures) {
      if (!c.sp.glow || !onScreen(c.x, c.y, c.sp.size)) continue;
      withCreature(c, () => c.sp.glow(ctx, c.ph, c.sp.size));
    }
    if (darkness > 0.2) {
      for (const p of prey) {
        if (p.alive && p.y > 1800 && onScreen(p.x, p.y, 40)) glowDot(ctx, p.x, p.y, 16, '255,130,170', 0.35);
      }
    }
    // a sparkle above every creature you haven't studied yet
    for (const c of creatures) {
      if (state.discovered.has(c.sp.id) || !onScreen(c.x, c.y, 100)) continue;
      const pulse = 0.5 + 0.5 * Math.sin(t * 3 + c.ph);
      const x = c.x, y = c.y - c.sp.size * 0.45 - 14;
      const r = 6 + pulse * 3;
      ctx.fillStyle = `rgba(255,250,200,${0.5 + pulse * 0.4})`;
      ctx.beginPath();
      ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.quadraticCurveTo(x, y, x, y + r); ctx.quadraticCurveTo(x, y, x - r, y);
      ctx.quadraticCurveTo(x, y, x, y - r);
      ctx.fill();
      glowDot(ctx, x, y, r * 2.2, '255,250,200', 0.25 + pulse * 0.2);
    }
  }

  function drawSnow(darkness) {
    const a = 0.12 + darkness * 0.45;
    ctx.fillStyle = `rgba(220,235,255,${a})`;
    for (const p of snow) {
      const x = (((p.x * W - cam.x * p.p) % W) + W) % W;
      const y = (((p.y * H - cam.y * p.p) % H) + H) % H;
      ctx.fillRect(x, y, p.r, p.r);
    }
  }

  // Points toward the nearest creature you haven't studied, when it's off-screen.
  function drawCompass(t) {
    if (!state.started || state.paused) return;
    let best = null, bd = Infinity;
    for (const c of creatures) {
      if (state.discovered.has(c.sp.id)) continue;
      const d = Math.hypot(c.x - octo.x, c.y - octo.y);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best || onScreen(best.x, best.y, -40)) return;
    const ox = octo.x - cam.x, oy = octo.y - cam.y;
    const dx = best.x - octo.x, dy = best.y - octo.y, d = Math.hypot(dx, dy);
    const ux = dx / d, uy = dy / d;
    const m = 48;
    const kx = ux > 0 ? (W - m - ox) / ux : ux < 0 ? (m - ox) / ux : Infinity;
    const ky = uy > 0 ? (H - m - oy) / uy : uy < 0 ? (m - oy) / uy : Infinity;
    const k = Math.min(kx, ky);
    const x = ox + ux * k, y = oy + uy * k;
    const a = Math.atan2(uy, ux);
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * 3);
    ctx.fillStyle = 'rgba(8,24,44,0.6)';
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffe9a8';
    ctx.font = '700 15px Fredoka, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, 1);
    ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(28, 0); ctx.lineTo(19, -7); ctx.lineTo(19, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function render(dt) {
    const t = state.time;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    for (let i = 0; i <= 5; i++) bg.addColorStop(i / 5, rgb(sampleStops(WATER_STOPS, cam.y + (i / 5) * H)));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    let sx = 0, sy = 0;
    if (state.shake > 0) {
      state.shake = Math.max(0, state.shake - dt);
      sx = rand(-6, 6) * state.shake / 0.4;
      sy = rand(-6, 6) * state.shake / 0.4;
    }
    const worldTransform = () => ctx.setTransform(DPR, 0, 0, DPR, (-cam.x + sx) * DPR, (-cam.y + sy) * DPR);
    worldTransform();

    drawSurface(t);
    drawRays(t);
    drawSeaweed(t);
    drawFloor();
    drawRocks();
    drawWhaleFall();
    drawCorals();
    drawAnemones(t);
    drawDen();

    for (const c of creatures) {
      if (onScreen(c.x, c.y, c.sp.size)) withCreature(c, () => c.sp.draw(ctx, c.ph, c.sp.size));
    }
    for (const p of prey) {
      if (!p.alive || !onScreen(p.x, p.y, 40)) continue;
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(p.face, 1);
      drawShrimp(ctx, p.ph, 22);
      ctx.restore();
    }
    for (const s of sharks) {
      if (!onScreen(s.x, s.y, s.size)) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.scale(s.face, 1);
      ctx.rotate(clamp(Math.atan2(s.vy, Math.abs(s.vx) + 1), -0.6, 0.6) * 0.6);
      drawShark(ctx, s.ph * (s.mode === 'chase' ? 1.8 : 1), s.size);
      if (s.mode === 'confused') {
        ctx.scale(s.face, 1);
        ctx.fillStyle = '#fff';
        ctx.font = '700 22px Fredoka, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('?', 0, -s.size * 0.32);
      }
      ctx.restore();
    }

    drawOctopus(t);

    for (const p of inkParts) {
      ctx.fillStyle = `rgba(22,12,34,${(p.life / p.max) * 0.65})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.2;
    for (const b of bubbles) {
      if (!onScreen(b.x, b.y, 10)) continue;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.stroke();
    }

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const darkness = drawDarkness();

    worldTransform();
    ctx.globalCompositeOperation = 'lighter';
    drawGlows(t, darkness);
    ctx.globalCompositeOperation = 'source-over';

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawSnow(darkness);
    drawCompass(t);

    if (state.flash > 0) {
      state.flash = Math.max(0, state.flash - dt);
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(255,40,40,0)');
      g.addColorStop(1, `rgba(255,40,40,${state.flash * 0.7})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    state.time += dt;
    if (state.started && !state.paused) {
      updatePlayer(dt);
      updateToasts(dt);
    }
    updateWorld(dt);
    updateCamera(dt);
    render(dt);
    if (state.started) updateHud(dt);
    updatePrompt();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  window.addEventListener('keydown', (e) => {
    if (!modal.classList.contains('hidden')) {
      if ((e.code === 'Escape' || (e.code === 'KeyJ' && sheet.classList.contains('journal'))) && escHandler) {
        e.preventDefault();
        escHandler();
      }
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') squirtInk();
    else if (e.code === 'KeyC') toggleCamo();
    else if (e.code === 'KeyE' || e.code === 'Enter') tryStudy();
    else if (e.code === 'KeyJ') openJournal();
    else if (e.code === 'KeyM') { muted = !muted; toast(muted ? 'Sound off' : 'Sound on', { urgent: true, dur: 1.5 }); }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); pointer.down = false; });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') document.body.classList.add('touch');
    pointer.down = true;
    pointer.x = e.clientX; pointer.y = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; });
  const release = () => { pointer.down = false; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  const tap = (el, fn) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
  tap(promptEl, tryStudy);
  tap($('#btnInk'), squirtInk);
  tap(camoBtn, toggleCamo);
  $('#journalBtn').addEventListener('click', openJournal);

  if (window.matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

  showStart();
  requestAnimationFrame(frame);
})();
