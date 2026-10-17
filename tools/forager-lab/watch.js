// Watch view: a trained population playing a round on a held-out map, drawn live from the same WebAssembly engine that trained it.
(function () {
  'use strict';
  const $ = id => document.getElementById(id), { el } = Lab;
  const W = 64, SCALE = 8, N_IN = 37;
  const INPUT_NAMES = ['food here', 'water here', 'food dir x', 'food dir y', 'food near', 'water dir x', 'water dir y', 'water near', 'energy', 'hydration', 'bias', 'memory 1', 'memory 2', 'memory 3', 'memory 4', 'position x', 'position y', 'noise', 'blocked', 'ate', 'wander x', 'wander y', 'age', 'clock sin', 'clock cos', 'latch 1', 'latch 2', 'age 50', 'age 100', 'age 200', 'age 400', 'age 800', 'age 1600', 'timer', 'wall dir x', 'wall dir y', 'wall near'];
  const OUTPUT_NAMES = ['move x', 'move y', 'eat / drink', 'mem 1', 'mem 2', 'mem 3', 'mem 4', 'gate 1', 'gate 2', 'gate 3', 'gate 4'];
  // each switch: what it changes and the finding it shows
  const SWITCHES = [
    { id: 'loss', label: 'Energy loss per tick', values: [['', 'as trained'], ['0.75', '0.75'], ['1', '1.0'], ['1.25', '1.25'], ['1.5', '1.5']], note: 'This is the budget frontier. At 1.25 or above a trip into a cup costs about as much as the whole energy store, so drinking on cups drops from about 72% (0.75) to 49% (1.0), 31% (1.25), 28% (1.5) for dots trained at each value with long sight and occlusion.' },
    { id: 'walls', label: 'Walls', values: [['cups', 'rings around ponds'], ['open', 'open map']], note: 'The same dots on the same ponds without rings. Dots trained on cups drink on open maps almost every time, so the rings are what costs them.' },
    { id: 'occ', label: 'Occlusion', values: [['', 'as trained'], ['1', 'on'], ['0', 'off']], note: 'With occlusion on, food and water behind a wall tile cannot be seen. Switching it on for dots trained without it, or off for dots trained with it, shows how much the brain relied on seeing through the ring.' },
    { id: 'mem', label: 'Memory registers', values: [['', 'as trained'], ['0', 'off']], note: 'Memory off reads 0 into the four registers while the weights stay. Freezing or zeroing them cost 130 to 320 ticks in earlier tests, so they are used as state, but what they store is not known.' }
  ];
  const S = { pop: null, e: null, v: null, mapSeed: 1000000, t: 0, L: 1000, playing: false, speed: 4, follow: -1, trails: false, trailBuf: null, hn: 0, sw: { loss: '', walls: 'cups', occ: '', mem: '' }, ended: null, busy: false, last: null };
  let root, cv, cx, base, baseCx, baseImg, colors = {}, lastBrain = 0, token = 0, shown = false;

  const hex = h => { h = h.trim(); if (h[0] === '#') { if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]; return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; } return h.split(',').map(Number); };
  function readColors() {
    const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n);
    colors = { ground: hex(g('--ground')), food: hex(g('--food')), water: hex(g('--water')), wall: hex(g('--wall')), fg: g('--fg').trim(), accent: g('--accent').trim(), chart2: g('--chart2').trim(), warn: g('--warn').trim(), dead: g('--dead').trim(), good: g('--good').trim(), bad: g('--bad').trim() };
  }
  const f0 = v => (+v).toFixed(0);

  function build(sec) {
    sec.innerHTML = `
      <div><h2>Pick a trained population</h2><div class="popgrid" id="w-pops"></div>
        <p class="note" style="margin-top:8px">Each card is a population of 200 dots trained by selection only. Its numbers are the held-out test from training: 20 maps the dots never saw during training. Load your own with the file pickers at the bottom of this page section or train one in the Train tab.</p></div>
      <div id="w-err" class="warnbox" hidden></div>
      <div class="watchgrid">
        <div class="col">
          <section class="panel">
            <div class="mapwrap"><canvas id="w-map" width="512" height="512" aria-label="Map with the dots of the selected population"></canvas></div>
            <div class="tickbar"><i id="w-tickbar"></i></div>
            <div class="row" style="margin-top:8px">
              <button id="w-play" class="primary">Play</button><button id="w-step">Step 1 tick</button><button id="w-restart">Restart round</button>
              <span class="note" id="w-tick" style="font-family:var(--font-data)">tick 0 / 1000</span>
            </div>
            <div class="ctl" style="margin:10px 0 0"><label for="w-speed">Speed (ticks per frame)</label><output id="w-speed-o">4</output><input type="range" id="w-speed" min="1" max="50" value="4"></div>
            <div class="row"><label for="w-seed">Map seed</label><input type="number" id="w-seed" value="1000000" style="width:110px">
              <button id="w-prev">Previous map</button><button id="w-next">Next map</button><button id="w-rand">Random map</button></div>
            <label class="check" style="margin:8px 0 0"><input type="checkbox" id="w-trails"><span>Show trails (last 30 positions)</span></label>
            <div class="legend" id="w-legend"></div>
          </section>
        </div>
        <div class="col">
          <section class="panel"><h2>This round</h2><div class="counters" id="w-counters"></div><div class="note" id="w-summary" style="margin-top:8px"></div></section>
          <section class="panel"><h2>What if</h2><div id="w-switches"></div></section>
          <section class="panel"><h2>Follow one dot</h2><div id="w-follow"><p class="note">Click a dot on the map.</p></div></section>
          <section class="panel"><h2>Run the 20 test maps</h2>
            <p class="note">Plays the population on the 20 held-out maps (seeds 1000000 to 1000019) without drawing and without breeding. With the what-if switches at their trained values the result must equal the training run's test numbers.</p>
            <div class="row" style="margin-top:8px"><button id="w-eval">Run 20 maps</button><span class="note" id="w-evalprog"></span></div><div class="scroll"><div id="w-evalout"></div></div></section>
        </div>
      </div>
      <section class="panel"><h2>Load a population</h2>
        <p class="note">A population saved by <code>run-multi.js</code> with <code>saveTo</code>, or downloaded from the Train tab, is two files: the <code>.bin</code> genomes and the <code>.bin.json</code> settings. Choose both.</p>
        <div class="row" style="margin-top:8px"><label for="w-fbin">Genomes (.bin)</label><input type="file" id="w-fbin" accept=".bin"><label for="w-fjson">Settings (.json)</label><input type="file" id="w-fjson" accept=".json"><button id="w-fload">Load</button></div>
      </section>`;
    cv = $('w-map'); cx = cv.getContext('2d');
    base = document.createElement('canvas'); base.width = base.height = W; baseCx = base.getContext('2d'); baseImg = baseCx.createImageData(W, W);
    $('w-legend').innerHTML = '<span><i style="background:var(--fg);border-radius:50%"></i>dot</span><span><i style="border:2px solid var(--warn);border-radius:50%;background:none"></i>low energy</span><span><i style="border:2px solid var(--chart2);border-radius:50%;background:none"></i>low hydration</span><span><b style="color:var(--chart2)">×</b> died of thirst</span><span><b style="color:var(--warn)">×</b> died of hunger</span><span><i style="background:var(--wall)"></i>wall</span><span><i style="background:rgb(var(--water))"></i>water</span><span><i style="background:rgb(var(--food))"></i>food</span>';
    $('w-counters').innerHTML = ['alive', 'drank', 'in a cup now', 'died thirsty', 'died hungry'].map((k, i) => `<div class="stat"><span>${k}</span><b id="w-c${i}">0</b></div>`).join('');
    const sw = $('w-switches');
    for (const s of SWITCHES) {
      const sel = el('select', { id: 'w-sw-' + s.id, 'aria-label': s.label }, s.values.map(v => el('option', { value: v[0], text: v[1] })));
      sel.value = S.sw[s.id]; sel.addEventListener('change', () => { S.sw[s.id] = sel.value; applySwitches(); restartRound(); });
      sw.appendChild(el('div', { class: 'sw' }, [el('div', { class: 'head' }, [el('label', { for: 'w-sw-' + s.id, text: s.label, style: 'font-weight:500' }), sel]), el('small', { text: s.note })]));
    }
    $('w-play').onclick = () => setPlaying(!S.playing);
    $('w-step').onclick = () => { setPlaying(false); advance(1); draw(); };
    $('w-restart').onclick = () => restartRound();
    $('w-speed').oninput = e => { S.speed = +e.target.value; $('w-speed-o').textContent = S.speed; };
    const seedIn = $('w-seed'), setSeed = v => { S.mapSeed = Math.max(1000000, v | 0); seedIn.value = S.mapSeed; restartRound(); };
    seedIn.onchange = () => setSeed(+seedIn.value);
    $('w-prev').onclick = () => setSeed(S.mapSeed - 1); $('w-next').onclick = () => setSeed(S.mapSeed + 1);
    $('w-rand').onclick = () => setSeed(1000000 + Math.floor(Math.random() * 1e6));
    $('w-trails').onchange = e => { S.trails = e.target.checked; if (S.trails) resetTrails(); draw(); };
    cv.addEventListener('click', onClick);
    $('w-eval').onclick = runEval;
    $('w-fload').onclick = loadFiles;
    const cards = $('w-pops');
    for (const p of Lab.pops) cards.appendChild(popCard(p));
    window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').addEventListener && window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); draw(); });
  }

  function popCard(p) {
    const t = p.test, nums = t ? `cups: drank ${t.cups.drank}%, full ${t.cups.full}%, ${t.cups.ticks} ticks · seed ${p.seed}` : 'your population';
    const b = el('button', { class: 'popcard', id: 'w-card-' + p.id, 'aria-pressed': 'false', onclick: () => selectPop(p) }, [el('b', { text: p.title }), el('small', { text: p.story }), el('span', { class: 'nums', text: nums })]);
    return b;
  }

  function showError(msg) { const b = $('w-err'); b.hidden = !msg; b.textContent = msg || ''; }

  async function selectPop(p, keepMap) {
    const my = ++token; setPlaying(false); showError('');
    for (const q of document.querySelectorAll('#w-pops .popcard')) q.setAttribute('aria-pressed', q.id === 'w-card-' + p.id ? 'true' : 'false');
    let e;
    try { e = await Lab.engineForPop(p); } catch (err) { if (my === token) showError('Could not load this population: ' + err.message); return; }
    if (my !== token) return;
    S.pop = p; S.e = e; S.v = e.views(); S.L = e.cfg.genLen; S.follow = -1;
    S.sw = { loss: '', walls: 'cups', occ: '', mem: '' };
    for (const s of SWITCHES) $('w-sw-' + s.id).value = S.sw[s.id];
    $('w-evalout').innerHTML = ''; $('w-evalprog').textContent = '';
    if (!keepMap) { S.mapSeed = 1000000; $('w-seed').value = S.mapSeed; }
    restartRound();
    Lab.store.set('pop', p.id);
    setPlaying(true);
  }

  function applySwitches(e) {
    e = e || S.e; if (!e) return;
    const c = S.pop.cfg;
    e.setCfg('lossE', S.sw.loss === '' ? c.lossE : +S.sw.loss);
    e.setCfg('occlude', S.sw.occ === '' ? +!!c.occlude : +S.sw.occ);
    e.setCfg('memory', S.sw.mem === '' ? +!!c.memory : +S.sw.mem);
  }
  function mapSpec(e, kind) { return kind === 'open' ? { t: 0, gap: 0 } : { t: 5, gap: (S.pop.cfg.testCups != null ? S.pop.cfg.testCups : (S.pop.cfg.cupGaps || [3]).slice(-1)[0] || 3) }; }
  function setMap(e, seed, walls) { const c = S.pop.cfg, sp = mapSpec(e, walls); e.cfg.cupFacing = 0; e.setMap('randpond', 0, seed, c.pondN, c.pondMin || 30, 0, sp.t, sp.gap, 0, c.wallLen == null ? 14 : c.wallLen); }

  function restartRound() {
    const e = S.e; if (!e) return;
    applySwitches();
    setMap(e, S.mapSeed, S.sw.walls);
    e.genBegin(); S.t = 0; S.ended = null;
    resetTrails();
    readColors();
    draw();
  }
  function resetTrails() { S.hn = 0; if (S.trailBuf) S.trailBuf.fill(-1); }

  function ringsOf() { return (S.e.ponds || []).map(p => [p[0] - 3, p[1] - 3, p[0] + 9, p[1] + 9]); }
  function advance(n) {
    const e = S.e; if (!e || S.ended) return;
    for (let k = 0; k < n; k++) {
      const alive = e.genTick(S.t); S.t++;
      if (S.trails) pushTrail();
      if (alive === 0 || S.t >= S.L) { S.ended = e.genEnd(false); setPlaying(false); break; }
    }
  }
  function pushTrail() {
    const v = S.v, e = S.e, n = e.x.n_agents(), slot = S.hn % 30; S.hn++;
    const off = slot * 2048 * 2;
    if (!S.trailBuf) S.trailBuf = new Float32Array(30 * 2048 * 2);
    S.trailBuf.fill(-1, off, off + 4096);
    for (let i = 0; i < n; i++) { const s = v.ord[i]; S.trailBuf[off + s * 2] = v.ax[s]; S.trailBuf[off + s * 2 + 1] = v.ay[s]; }
  }

  function drawTiles() {
    const x = S.e.x, kind = new Uint8Array(S.e.mem, x.kind_ptr(), W * W), food = new Float32Array(S.e.mem, x.food_ptr(), W * W), d = baseImg.data, c = colors;
    for (let i = 0; i < W * W; i++) {
      const k = kind[i]; let r = c.ground[0], g = c.ground[1], b = c.ground[2];
      if (k === 1 || k === 3) { const a = Math.min(1, food[i] / 0.8), t = 0.15 + 0.85 * a, col = k === 1 ? c.food : c.water; r += (col[0] - r) * t; g += (col[1] - g) * t; b += (col[2] - b) * t; }
      else if (k === 4) { r = c.wall[0]; g = c.wall[1]; b = c.wall[2]; }
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
    }
    baseCx.putImageData(baseImg, 0, 0);
    cx.imageSmoothingEnabled = false; cx.drawImage(base, 0, 0, W * SCALE, W * SCALE);
  }

  function counters() {
    const e = S.e, v = S.v, GP = e.cfg.genP, rings = ringsOf(), maxE = e.cfg.maxE, maxW = e.cfg.maxW;
    let alive = 0, drank = 0, inCup = 0, thirsty = 0, hungry = 0;
    for (let s = 0; s < GP; s++) {
      if (v.gwater[s] > 0) drank++;
      if (v.gdead[s] >= 0) { if (v.ae[s] <= 0) hungry++; else thirsty++; }
      else { alive++; if (S.sw.walls === 'cups') { const x = v.ax[s], y = v.ay[s]; for (const r of rings) if (x >= r[0] && x < r[2] + 1 && y >= r[1] && y < r[3] + 1) { inCup++; break; } } }
    }
    return { alive, drank, inCup, thirsty, hungry };
  }

  function draw() {
    if (!S.e || !cv) return;
    const e = S.e, v = S.v, GP = e.cfg.genP, c = colors, maxE = e.cfg.maxE, maxW = e.cfg.maxW;
    drawTiles();
    // trails
    if (S.trails && S.trailBuf) {
      cx.lineWidth = 1; cx.strokeStyle = c.fg; cx.globalAlpha = 0.18;
      const nsl = Math.min(S.hn, 30);
      for (let s = 0; s < GP; s++) {
        if (v.gdead[s] >= 0) continue;
        cx.beginPath(); let started = false;
        for (let k = nsl; k >= 1; k--) { const slot = ((S.hn - k) % 30 + 30) % 30, o = slot * 4096 + s * 2, x = S.trailBuf[o], y = S.trailBuf[o + 1]; if (x < 0) continue; if (!started) { cx.moveTo(x * SCALE, y * SCALE); started = true; } else cx.lineTo(x * SCALE, y * SCALE); }
        cx.stroke();
      }
      cx.globalAlpha = 1;
    }
    // followed dot: sight and hidden tiles under the dots
    const fs = S.follow;
    if (fs >= 0 && v.gdead[fs] < 0) drawSight(fs);
    // dead
    cx.lineWidth = 2; cx.globalAlpha = 0.45;
    for (let s = 0; s < GP; s++) {
      if (v.gdead[s] < 0) continue;
      const x = v.ax[s] * SCALE, y = v.ay[s] * SCALE, r = 3;
      cx.strokeStyle = v.ae[s] <= 0 ? c.warn : c.chart2;
      cx.beginPath(); cx.moveTo(x - r, y - r); cx.lineTo(x + r, y + r); cx.moveTo(x + r, y - r); cx.lineTo(x - r, y + r); cx.stroke();
    }
    cx.globalAlpha = 1;
    // alive
    const n = e.x.n_agents();
    for (let i = 0; i < n; i++) {
      const s = v.ord[i], x = v.ax[s] * SCALE, y = v.ay[s] * SCALE, lowE = v.ae[s] < 0.25 * maxE, lowW = v.aw[s] < 0.25 * maxW;
      cx.fillStyle = c.fg; cx.beginPath(); cx.arc(x, y, 2.6, 0, 6.2832); cx.fill();
      cx.lineWidth = 1.5;
      if (lowE) { cx.strokeStyle = c.warn; cx.beginPath(); cx.arc(x, y, 4.4, 0, 6.2832); cx.stroke(); }
      if (lowW) { cx.strokeStyle = c.chart2; cx.beginPath(); cx.arc(x, y, lowE ? 6 : 4.4, 0, 6.2832); cx.stroke(); }
    }
    if (fs >= 0 && v.gdead[fs] < 0) { const x = v.ax[fs] * SCALE, y = v.ay[fs] * SCALE; cx.strokeStyle = c.accent; cx.lineWidth = 2.5; cx.beginPath(); cx.arc(x, y, 9, 0, 6.2832); cx.stroke(); }
    // text
    $('w-tick').textContent = 'tick ' + S.t + ' / ' + S.L;
    $('w-tickbar').style.width = (100 * S.t / S.L) + '%';
    const k = counters();
    [k.alive, k.drank, S.sw.walls === 'cups' ? k.inCup : '–', k.thirsty, k.hungry].forEach((x, i) => { $('w-c' + i).textContent = x; });
    const sm = $('w-summary');
    if (S.ended) { const s = S.ended; sm.textContent = 'Round over on map ' + S.mapSeed + ': mean ticks survived ' + f0(s.mean) + ', survived the whole round ' + f0(100 * s.fullShare) + '%, drank at least once ' + f0(100 * s.drankShare) + '%.'; }
    else sm.textContent = 'Map ' + S.mapSeed + (S.sw.walls === 'cups' ? ' with cups' : ' open') + '. Every dot starts in the centre with the same stores.';
    const now = performance.now(); if (now - lastBrain > 100) { lastBrain = now; updateFollow(); }
  }

  // ---- following a dot ----
  function onClick(ev) {
    if (!S.e) return;
    const r = cv.getBoundingClientRect(), mx = (ev.clientX - r.left) / r.width * W, my = (ev.clientY - r.top) / r.height * W, v = S.v, n = S.e.x.n_agents();
    let best = -1, bd = 2.2 * 2.2;
    for (let i = 0; i < n; i++) { const s = v.ord[i], d = (v.ax[s] - mx) ** 2 + (v.ay[s] - my) ** 2; if (d < bd) { bd = d; best = s; } }
    S.follow = best; lastBrain = 0; draw();
  }
  // line of sight, display only: the engine's own rule is in forager.c (tested against an exact segment test), this copy samples along the segment
  function visibleTile(x, y, tx, ty, kind) {
    const cxm = tx + 0.5, cym = ty + 0.5, dx = cxm - x, dy = cym - y, len = Math.hypot(dx, dy), steps = Math.max(2, Math.ceil(len * 5));
    for (let k = 1; k < steps; k++) { const px = x + dx * k / steps, py = y + dy * k / steps, ix = Math.floor(px), iy = Math.floor(py); if ((ix === tx && iy === ty) || (ix === Math.floor(x) && iy === Math.floor(y))) continue; if (kind[iy * W + ix] === 4) return false; }
    return true;
  }
  function drawSight(s) {
    const e = S.e, v = S.v, R = e.cfg.sight, x = v.ax[s], y = v.ay[s];
    if (e.cfg.occlude) {
      const kind = new Uint8Array(e.mem, e.x.kind_ptr(), W * W);
      cx.fillStyle = 'rgba(0,0,0,0.35)';
      for (let ty = Math.max(0, Math.floor(y) - R); ty <= Math.min(W - 1, Math.floor(y) + R); ty++) for (let tx = Math.max(0, Math.floor(x) - R); tx <= Math.min(W - 1, Math.floor(x) + R); tx++) {
        if (kind[ty * W + tx] === 4) continue;
        if (Math.hypot(tx + 0.5 - x, ty + 0.5 - y) > R + 0.5) continue;
        if (!visibleTile(x, y, tx, ty, kind)) cx.fillRect(tx * SCALE, ty * SCALE, SCALE, SCALE);
      }
    }
    cx.strokeStyle = colors.accent; cx.lineWidth = 1; cx.globalAlpha = 0.7; cx.setLineDash([4, 3]);
    cx.beginPath(); cx.arc(x * SCALE, y * SCALE, (R + 0.5) * SCALE, 0, 6.2832); cx.stroke(); cx.setLineDash([]); cx.globalAlpha = 1;
  }
  function brainOf(s) {
    const e = S.e, x = e.x, g = new Float32Array(e.mem, x.genome_ptr() + s * x.genome_stride() * 4, x.genome_stride()), INP = new Float32Array(e.mem, x.inp_ptr(), 2048 * N_IN);
    const HP = x.layout_info(0), OP = x.layout_info(1), OFF2 = x.layout_info(2), OFFO = x.layout_info(3), NACT = x.layout_info(4), NH = e.cfg.hidden, NL = e.cfg.layers, ACT = new Int32Array(e.mem, x.act_ptr(), 40);
    const NOUT = e.cfg.memory || S.pop.cfg.memory ? 11 : 3;
    const xin = [], names = [];
    for (let k = 0; k < NACT; k++) { xin.push(INP[s * N_IN + ACT[k]]); names.push(INPUT_NAMES[ACT[k]] || 'input ' + ACT[k]); }
    const h1 = [], h2 = [], out = [];
    for (let c = 0; c < NH; c++) { let a = 0; for (let k = 0; k < NACT; k++) a += xin[k] * g[k * HP + c]; h1.push(Math.tanh(a)); }
    let last = h1;
    if (NL === 2) { for (let c = 0; c < NH; c++) { let a = 0; for (let j = 0; j < NH; j++) a += h1[j] * g[OFF2 + j * HP + c]; h2.push(Math.tanh(a)); } last = h2; }
    for (let o = 0; o < NOUT; o++) { let a = 0; for (let j = 0; j < NH; j++) a += last[j] * g[OFFO + j * OP + o]; out.push(a); }
    return { g, HP, OP, OFF2, OFFO, NACT, NH, NL, xin, names, h1, h2, out, NOUT };
  }
  function bar(label, value, min, max, mid) { const p = Math.max(0, Math.min(1, (value - min) / (max - min))) * 100; return `<div class="barrow"><span>${label}</span><div class="bar${mid ? ' mid' : ''}"><i style="width:${p}%"></i></div><output>${value.toFixed(2)}</output></div>`; }
  function updateFollow() {
    const box = $('w-follow'), s = S.follow, e = S.e;
    if (!e || s < 0) { if (!box.dataset.empty) { box.innerHTML = '<p class="note">Click a dot on the map to follow it.</p>'; box.dataset.empty = '1'; } return; }
    delete box.dataset.empty;
    const v = S.v, dead = v.gdead[s] >= 0;
    const b = brainOf(s), INP = new Float32Array(e.mem, e.x.inp_ptr(), 2048 * N_IN);
    let html = `<p class="note"><b>Dot ${s}</b> ${dead ? '(died at tick ' + v.gdead[s] + ')' : 'alive'} at (${v.ax[s].toFixed(1)}, ${v.ay[s].toFixed(1)}). Dashed circle: sight radius ${e.cfg.sight}${e.cfg.occlude ? '; shaded tiles are hidden behind walls (display approximation of the engine\'s line-of-sight rule)' : ''}.</p>`;
    html += bar('energy', v.ae[s] / e.cfg.maxE, 0, 1) + bar('hydration', v.aw[s] / e.cfg.maxW, 0, 1);
    if (e.cfg.memory) html += '<p class="note" style="margin-top:6px">Memory registers the brain read this tick (−1 to +1)</p>' + [0, 1, 2, 3].map(m => bar('register ' + (m + 1), INP[s * N_IN + 11 + m], -1, 1, true)).join('');
    const mv = [Math.tanh(b.out[0]), Math.tanh(b.out[1])];
    html += `<p class="note" style="margin-top:6px">Outputs this tick (recomputed in the page from the genome): move ${mv[0].toFixed(2)}, ${mv[1].toFixed(2)}; ${b.out[2] > 0 ? '<b>eat / drink</b>' : 'moves'}.` + (e.cfg.memory ? ' Memory gates ' + b.out.slice(7, 11).map(o => (0.5 * (1 + Math.tanh(0.5 * o))).toFixed(2)).join(', ') + '.' : '') + '</p>';
    html += '<div id="w-brain">' + brainSvg(b) + '</div><span class="note">Lines: weights (orange positive, blue negative; thicker is stronger). Circles: activation. Weights are the dot\'s own genome; activations are computed in the page.</span>';
    box.innerHTML = html;
  }
  function brainSvg(b) {
    const colsX = b.NL === 2 ? [90, 200, 300, 420] : [90, 250, 420], H = 14 * Math.max(b.NACT, 11) + 24, Wd = 520, cols = [b.xin, b.h1].concat(b.NL === 2 ? [b.h2] : []).concat([b.out]);
    const pos = cols.map((col, ci) => col.map((_, i) => [colsX[ci], 14 + (H - 28) * (col.length === 1 ? 0.5 : i / (col.length - 1))]));
    let lines = '', nodes = '', labels = '';
    const wt = (ci, i, j) => ci === 0 ? b.g[i * b.HP + j] : (ci === 1 && b.NL === 2) ? b.g[b.OFF2 + i * b.HP + j] : b.g[b.OFFO + i * b.OP + j];
    for (let ci = 0; ci < cols.length - 1; ci++) for (let i = 0; i < cols[ci].length; i++) for (let j = 0; j < cols[ci + 1].length; j++) {
      const w = wt(ci, i, j), a = Math.abs(w); if (a < 0.35) continue;
      lines += `<line x1="${pos[ci][i][0]}" y1="${pos[ci][i][1].toFixed(1)}" x2="${pos[ci + 1][j][0]}" y2="${pos[ci + 1][j][1].toFixed(1)}" stroke="${w > 0 ? 'var(--accent)' : 'var(--chart2)'}" stroke-opacity="${Math.min(0.75, 0.12 + a * 0.3).toFixed(2)}" stroke-width="${Math.min(2.2, 0.4 + a * 0.6).toFixed(2)}"/>`;
    }
    cols.forEach((col, ci) => col.forEach((val, i) => {
      const p = pos[ci][i], last = ci === cols.length - 1, act = last ? Math.tanh(val) : val, o = Math.min(1, Math.abs(act));
      nodes += `<circle cx="${p[0]}" cy="${p[1].toFixed(1)}" r="4.5" fill="${act >= 0 ? 'var(--accent)' : 'var(--chart2)'}" fill-opacity="${(0.12 + 0.88 * o).toFixed(2)}" stroke="var(--muted)" stroke-width="0.6"/>`;
      if (ci === 0) labels += `<text x="${p[0] - 8}" y="${(p[1] + 3).toFixed(1)}" text-anchor="end">${b.names[i]}</text>`;
      if (last) labels += `<text x="${p[0] + 8}" y="${(p[1] + 3).toFixed(1)}">${OUTPUT_NAMES[i] || 'out ' + i}</text>`;
    }));
    return `<svg id="brainSvg" viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Brain of the followed dot">${lines}${nodes}${labels}</svg>`;
  }

  // ---- loop ----
  let raf = 0;
  function loop() {
    raf = 0; if (!shown) return;
    if (S.playing && S.e && !S.busy) { advance(S.speed); draw(); }
    if (S.playing || !S.ended) raf = requestAnimationFrame(loop); else raf = 0;
  }
  function setPlaying(on) {
    S.playing = !!on && !!S.e;
    if (S.e && on && S.ended) restartRound();
    S.playing = !!on && !!S.e;
    const b = $('w-play'); if (b) b.textContent = S.playing ? 'Pause' : (S.ended ? 'Play again' : 'Play');
    if (S.playing && !raf && shown) raf = requestAnimationFrame(loop);
  }

  // ---- 20 held-out maps, no drawing ----
  async function runEval() {
    if (!S.pop || S.busy) return;
    S.busy = true; $('w-eval').disabled = true;
    const my = token, out = $('w-evalout'), prog = $('w-evalprog'); out.innerHTML = '';
    try {
      const e = await Lab.engineForPop(S.pop), c = S.pop.cfg;
      applySwitches(e);
      const T = ForagerTrainer, res = {};
      for (const kind of ['cups', 'open']) {
        let t = 0, full = 0, drank = 0;
        for (let i = 0; i < 20; i++) {
          setMap(e, 1000000 + i, kind); const s = e.genRound(false); t += s.mean; full += s.fullShare; drank += s.drankShare;
          prog.textContent = kind + ' maps ' + (i + 1) + ' / 20';
          await new Promise(r => setTimeout(r, 0));
        }
        res[kind] = { ticks: f0(t / 20), full: f0(100 * full / 20), drank: f0(100 * drank / 20) };
      }
      prog.textContent = '';
      const def = S.sw.loss === '' && S.sw.occ === '' && S.sw.mem === '', trained = S.pop.test, rows = [];
      const cell = (a, b) => b == null ? a : (String(a) === String(b) ? `<span class="ok">${a}</span>` : `<span class="bad">${a}</span>`);
      for (const [kind, label] of [['cups', 'Cups'], ['open', 'Open maps']]) {
        const r = res[kind], tt = trained ? trained[kind] : null, cmp = def && tt && true;
        rows.push(`<tr><td>${label} (this page)</td><td>${cell(r.ticks, cmp ? tt.ticks : null)}</td><td>${cell(r.full + '%', cmp ? tt.full + '%' : null)}</td><td>${cell(r.drank + '%', cmp ? tt.drank + '%' : null)}</td></tr>`);
        if (tt) rows.push(`<tr><td>${label} (training run)</td><td>${tt.ticks}</td><td>${tt.full}%</td><td>${tt.drank}%</td></tr>`);
      }
      const same = trained && def && ['cups', 'open'].every(k => res[k].ticks == trained[k].ticks && res[k].full == trained[k].full && res[k].drank == trained[k].drank);
      out.innerHTML = '<table class="cmp"><thead><tr><th></th><th>ticks survived</th><th>full round</th><th>drank</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>' +
        `<p class="note" style="margin-top:6px">${trained ? (def ? (same ? '<b class="ok">Identical to the training run: the page runs the same engine.</b>' : '<b class="bad">Different from the training run.</b>') : 'What-if switches are on, so a difference from the training run is expected.') : 'No training numbers stored for this population.'}</p>`;
      S.last = { res, same };
    } catch (err) { out.textContent = 'Evaluation failed: ' + err.message; }
    S.busy = false; $('w-eval').disabled = false;
    if (S.playing && !raf) raf = requestAnimationFrame(loop);
  }

  // ---- load files ----
  async function loadFiles() {
    const fb = $('w-fbin').files[0], fj = $('w-fjson').files[0];
    if (!fb || !fj) { showError('Choose both files: the .bin genomes and the .json settings.'); return; }
    try {
      const saved = JSON.parse(await fj.text()), bytes = new Uint8Array(await fb.arrayBuffer());
      Lab.watchPop({ id: 'custom', title: 'Loaded: ' + fb.name, story: 'A population you loaded from files.', seed: saved.seed, cfg: saved.cfg, bytes, test: null });
    } catch (err) { showError('Could not read the files: ' + err.message); }
  }
  Lab.watchPop = async function (pop, opts) {
    Lab.show('watch');
    await Lab.views.watch.ready;
    const old = $('w-card-' + pop.id); if (old) old.remove();
    const card = popCard(pop); $('w-pops').prepend(card);
    await selectPop(pop);
    if (opts && opts.sw) { Object.assign(S.sw, opts.sw); for (const s of SWITCHES) $('w-sw-' + s.id).value = S.sw[s.id]; restartRound(); }
  };

  let resolveReady; const readyP = new Promise(r => { resolveReady = r; });
  Lab.registerView('watch', 'Watch', {
    ready: readyP,
    init(sec) { build(sec); readColors(); resolveReady(); },
    show() { shown = true; readColors(); if (!S.e && Lab.pops.length) { const want = Lab.pops.find(p => p.id === Lab.store.get('pop')) || Lab.pops[0]; selectPop(want); } else { draw(); if (S.playing && !raf) raf = requestAnimationFrame(loop); } },
    hide() { shown = false; }
  });
  Lab.watch = { S, selectPop, runEval, restartRound, setPlaying, advance, draw, SWITCHES };
})();
