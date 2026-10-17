// Train view: evolution live in the browser (a Web Worker, or the main thread where workers are refused), with presets, an options table, live charts and hand-off to Watch.
(function () {
  'use strict';
  const $ = id => document.getElementById(id), { el } = Lab;

  // Every setting the page offers is one entry here: add an entry and it appears in the panel with its help line.
  // where: 'run' (the seed), 'opt' (run-multi argument) or 'cfg' (engine setting); type: int, num, bool.
  const OPTIONS = [
    { key: 'seed', where: 'run', type: 'int', label: 'Seed', help: 'Random seed of the whole run. The same seed and settings give the same run, generation by generation.' },
    { key: 'K', where: 'opt', type: 'int', min: 1, max: 10, label: 'Maps per generation (K)', help: 'Every dot plays K random maps and is scored on the mean. 3 removes most failures to get started; 1 is the plain method.' },
    { key: 'genP', where: 'cfg', type: 'int', min: 20, max: 400, label: 'Population size', help: 'Dots per generation. More dots cost time in proportion.' },
    { key: 'lossE', where: 'cfg', type: 'num', min: 0.3, max: 3, step: 0.05, label: 'Energy loss per tick', help: 'The energy budget. Cups pay off at 0.75 to 1.0; at 1.25 or more a trip costs about the whole energy store.' },
    { key: 'sight', where: 'cfg', type: 'int', min: 2, max: 20, label: 'Sight (tiles)', help: 'How far a dot sees the nearest food and water.' },
    { key: 'occlude', where: 'cfg', type: 'bool', label: 'Occlusion', help: 'Food and water behind a wall tile are not seen.' },
    { key: 'genLen', where: 'cfg', type: 'int', min: 100, max: 5000, step: 100, label: 'Round length (ticks)', help: 'How long every round lasts. Longer rounds ask the dots to go back to water and food again and again; the thirst wall stays at 833 ticks, so survival past it needs repeated trips. All earlier experiments used 1000.' },
    { key: 'finalGens', where: 'opt', type: 'int', min: 20, max: 5000, label: 'Final generations', help: 'Generations on the real task after all stages. More generations raise the numbers slowly.' }
  ];
  const BASE = { genSpawn: 1, memory: true, maxE: 500, maxW: 500, startE: 500, startW: 500, oscillator: true, oscPeriod: 200, pondSep: 16 };
  const CUPS = { cupGaps: [3, 3, 3], cupMixes: [1, 2, 3], secureDrink: 0.8, cupExit: 0.99, cupStageCap: 300 };
  const PRESETS = [
    { id: 'cups-curr', title: 'Cups with the curriculum', story: 'Pond distances 16, 22, 28, 36, then until drinking starts and is secure, then rings around the ponds (1, 2, then 3 of the 3 maps).', cfg: Object.assign({}, BASE, CUPS, { lossE: 0.75, sight: 12, occlude: 1 }), values: { seed: 1, K: 3, genP: 200, lossE: 0.75, sight: 12, occlude: true, finalGens: 700 }, about: 'About 1700 generations in all; the showcase population "Cups, generous budget" is this run, seed 1.' },
    { id: 'cups-none', title: 'Cups, no curriculum', story: 'Rings around the ponds from generation 1: no distance stages, no drinking stage. About half of the seeds never start drinking.', cfg: Object.assign({}, BASE, { cupGaps: [3], cupStageCap: 1, noCurriculum: 1, lossE: 0.75, sight: 12, occlude: 1 }), values: { seed: 1, K: 3, genP: 200, lossE: 0.75, sight: 12, occlude: true, finalGens: 1500 }, about: 'Try seeds 1 and 2: seed 1 stays at 833 ticks (the thirst wall), seed 2 learns cups.' },
    { id: 'tight', title: 'Tight budget', story: 'The cups curriculum at energy loss 1.5, where a pond trip costs about the whole energy store.', cfg: Object.assign({}, BASE, CUPS, { lossE: 1.5, sight: 12, occlude: 1 }), values: { seed: 1, K: 3, genP: 200, lossE: 1.5, sight: 12, occlude: true, finalGens: 700 }, about: 'Expect few dots to drink on cups at this budget.' },
    { id: 'open', title: 'Open map, basic drinking', story: 'No walls. Ponds walk away from the food, then the real task. The smallest and fastest preset.', cfg: Object.assign({}, BASE, { lossE: 1.5, sight: 5 }), values: { seed: 1, K: 3, genP: 200, lossE: 1.5, sight: 5, occlude: false, finalGens: 300 }, about: 'Watch the survival chart rise past the thirst wall once dots learn to drink.' }
  ];
  PRESETS.forEach(p => { p.values.genLen = 1000; });
  const V = {};   // current option values
  let preset = PRESETS[0], runner = null, workerNote = '', run = null, snapshotWaiters = {}, refSeq = 0, last = { chartAt: 0 };

  function build(sec) {
    sec.innerHTML = `
      <div><h2>Preset</h2><div class="popgrid" id="t-presets"></div></div>
      <div class="twocol">
        <div class="col">
          <section class="panel"><h2>Settings</h2>
            <p class="note" id="t-about"></p>
            <div class="optgrid" id="t-opts" style="margin-top:10px"></div>
            <p class="note" id="t-fixed" style="margin-top:10px"></p>
            <div class="row" style="margin-top:12px"><button class="primary" id="t-start">Start</button><button id="t-pause" disabled>Pause</button><button id="t-stop" disabled>Stop</button></div>
            <p class="note" id="t-where" style="margin-top:8px"></p>
          </section>
          <section class="panel"><h2>This population</h2>
            <p class="note">Copy the dots as they are now into the Watch tab, or save them as files. The pair of files loads in Watch, also from a run you made with Node.</p>
            <div class="row" style="margin-top:8px"><button id="t-watch" disabled>Watch now</button><button id="t-save" disabled>Save .bin and .json</button></div>
            <p class="note" id="t-savenote" style="margin-top:6px">Saving a file works when the page is opened from your computer; a published page cannot start downloads.</p>
          </section>
        </div>
        <div class="col">
          <section class="panel"><h2>Progress</h2>
            <div class="counters" id="t-stats"></div>
            <p class="note" id="t-stage" style="margin-top:8px">Not started.</p>
          </section>
          <section class="panel"><svg class="chart" id="t-ch1" viewBox="0 0 520 190" role="img" aria-label="Mean ticks survived per generation"></svg>
            <svg class="chart" id="t-ch2" viewBox="0 0 520 190" role="img" aria-label="Share of dots that drank, survived the round, per generation" style="margin-top:12px"></svg></section>
          <section class="panel"><h2>Stage log</h2><pre class="stagelog" id="t-log">Stages end when the dots reach their goal or hit the stage's cap, so the length of a run is not fixed.</pre><div id="t-tests"></div></section>
        </div>
      </div>`;
    const pg = $('t-presets');
    for (const p of PRESETS) pg.appendChild(el('button', { class: 'popcard', id: 't-p-' + p.id, 'aria-pressed': 'false', onclick: () => choose(p) }, [el('b', { text: p.title }), el('small', { text: p.story })]));
    const og = $('t-opts');
    for (const o of OPTIONS) {
      let inp;
      if (o.type === 'bool') { inp = el('input', { type: 'checkbox', id: 't-o-' + o.key }); inp.addEventListener('change', () => { V[o.key] = inp.checked; }); og.appendChild(el('div', { class: 'opt check' }, [inp, el('div', {}, [el('label', { for: 't-o-' + o.key, text: o.label }), el('small', { text: o.help })])])); }
      else { inp = el('input', { type: 'number', id: 't-o-' + o.key, min: o.min, max: o.max, step: o.step || 1 }); inp.addEventListener('change', () => { let v = +inp.value; if (!isFinite(v)) v = 0; if (o.min != null) v = Math.max(o.min, v); if (o.max != null) v = Math.min(o.max, v); V[o.key] = o.type === 'int' ? Math.round(v) : v; inp.value = V[o.key]; }); og.appendChild(el('div', { class: 'opt' }, [el('label', { for: 't-o-' + o.key, text: o.label }), inp, el('small', { text: o.help })])); }
    }
    $('t-start').onclick = start; $('t-pause').onclick = togglePause; $('t-stop').onclick = stop;
    $('t-watch').onclick = watchNow; $('t-save').onclick = saveFiles;
    $('t-stats').innerHTML = ['generation', 'gens per second', 'mean ticks', 'drank', 'full round'].map((k, i) => `<div class="stat"><span>${k}</span><b id="t-s${i}">–</b></div>`).join('');
    choose(PRESETS.find(p => p.id === Lab.store.get('preset')) || PRESETS[0]);
    drawCharts();
  }
  function choose(p) {
    preset = p; Lab.store.set('preset', p.id);
    for (const q of document.querySelectorAll('#t-presets .popcard')) q.setAttribute('aria-pressed', q.id === 't-p-' + p.id ? 'true' : 'false');
    Object.assign(V, p.values);
    for (const o of OPTIONS) { const i = $('t-o-' + o.key); if (o.type === 'bool') i.checked = !!V[o.key]; else i.value = V[o.key]; }
    $('t-about').textContent = p.story + ' ' + p.about;
    const fixed = Object.keys(p.cfg).filter(k => !OPTIONS.some(o => o.key === k)).map(k => k + ' ' + JSON.stringify(p.cfg[k])).join(', ');
    $('t-fixed').innerHTML = '<b>Fixed by the preset:</b> ' + fixed + '. 200-tick clock, stores of 500, hidden layers of 8 + 8, mutation rate 0.1 and size 0.2.';
  }

  // ---- running ----
  function currentSettings() {
    const cfg = Object.assign({}, preset.cfg), opts = {}, vals = Object.assign({}, V);
    for (const o of OPTIONS) { if (o.where === 'cfg') cfg[o.key] = o.type === 'bool' ? +!!vals[o.key] : vals[o.key]; else if (o.where === 'opt') opts[o.key] = vals[o.key]; }
    if (!vals.occlude && cfg.occlude === 1) cfg.occlude = 0;
    return { cfg, opts, seed: vals.seed | 0 };
  }
  function makeRunner() {
    if (runner) return runner;
    const onmsg = m => handle(m);
    try {
      const w = new Worker('train-worker.js');
      w.onmessage = e => handle(e.data);
      w.onerror = e => { if (!run || !run.gotAny) { workerNote = 'This browser would not start a background worker for a page opened from a file, so training runs on the page itself and the page may feel slower.'; runner = null; w.terminate(); startMain(); } };
      runner = { post: (m, tr) => w.postMessage(m, tr || []), kind: 'worker' };
    } catch (err) { workerNote = 'Workers are not available here, so training runs on the page itself.'; startMain(); }
    return runner;
    function startMain() { const r = ForagerRunner.make(onmsg); runner = { post: m => r.handle(m), kind: 'main' }; if (run && run.pendingStart) { const m = run.pendingStart; run.pendingStart = null; runner.post(m); } }
  }
  function start() {
    const s = currentSettings();
    run = { s, points: [], stages: [], marks: [], t0: performance.now(), gotAny: false, paused: false, tests: null, total: 0, done: false, running: true };
    $('t-log').textContent = ''; $('t-tests').innerHTML = ''; $('t-stage').textContent = 'Starting…';
    setButtons();
    makeRunner();
    const m = { cmd: 'start', cfg: s.cfg, opts: s.opts, seed: s.seed };
    run.pendingStart = m;
    // the worker may take a moment to exist; post right away (messages queue) and clear the pending copy once the run reports back
    runner.post(m);
    $('t-where').textContent = (runner.kind === 'worker' ? 'Training in a background worker. ' : 'Training on the page itself. ') + workerNote;
  }
  function togglePause() { if (!run || !run.running) return; run.paused = !run.paused; runner.post({ cmd: run.paused ? 'pause' : 'resume' }); setButtons(); }
  function stop() { if (!run) return; runner.post({ cmd: 'stop' }); run.running = false; run.stopped = true; setButtons(); $('t-stage').textContent += ' Stopped.'; }
  function setButtons() {
    const live = run && run.running, any = run && run.gotAny;
    $('t-start').disabled = !!live; $('t-pause').disabled = !live; $('t-pause').textContent = run && run.paused ? 'Resume' : 'Pause'; $('t-stop').disabled = !live;
    $('t-watch').disabled = !any; $('t-save').disabled = !any;
    for (const o of OPTIONS) $('t-o-' + o.key).disabled = !!live;
    for (const q of document.querySelectorAll('#t-presets .popcard')) q.disabled = !!live;
  }
  const pc = v => (100 * v).toFixed(0) + '%';
  function handle(m) {
    if (!run) return;
    if (m.type === 'started') { run.pendingStart = null; return; }
    if (m.type === 'error') { $('t-stage').textContent = 'Error: ' + m.message; run.running = false; setButtons(); return; }
    if (m.type === 'snapshot') { const w = snapshotWaiters[m.ref]; if (w) { delete snapshotWaiters[m.ref]; w(m); } return; }
    run.gotAny = true;
    if (m.type === 'gen') {
      run.total = m.total; run.points.push({ x: m.total, mean: m.mean, full: m.full, drank: m.drank, cupDrank: m.cupDrank, cupMean: m.cupMean, cupFull: m.cupFull });
      run.stageNow = m.stage; run.gOf = m.g; run.cap = m.cap; run.elapsed = m.elapsed;
      const now = performance.now();
      if (now - last.chartAt > 250) { last.chartAt = now; paintProgress(); drawCharts(); }
      setButtons();
    } else if (m.type === 'stage') {
      run.marks.push({ x: m.total, label: m.label });
      $('t-log').textContent += m.label + ' | gens ' + m.g + ' (total ' + m.total + ') | survived ' + m.mean.toFixed(0) + ' full ' + pc(m.full) + ' drank ' + pc(m.drank) + (m.cupDrank != null ? ' | cups only: survived ' + m.cupMean.toFixed(0) + ' full ' + pc(m.cupFull) + ' drank ' + pc(m.cupDrank) : '') + '\n';
      const l = $('t-log'); l.scrollTop = l.scrollHeight;
    } else if (m.type === 'done') {
      run.done = true; paintProgress(); drawCharts();
    } else if (m.type === 'tests') {
      run.tests = m; run.running = false; setButtons(); paintProgress(); drawCharts();
      const row = (n, t) => t ? `<tr><td>${n}</td><td>${t.ticks.toFixed(0)}</td><td>${pc(t.full)}</td><td>${pc(t.drank)}</td></tr>` : '';
      $('t-tests').innerHTML = '<h2 style="margin-top:10px">Held-out test (20 maps, no breeding)</h2><table class="cmp"><thead><tr><th></th><th>ticks survived</th><th>full round</th><th>drank</th></tr></thead><tbody>' + row('Cups', m.cups) + row('Bars', m.bars) + row('Open maps', m.open) + row('Cups facing the food', m.facing) + '</tbody></table>';
    }
  }
  function paintProgress() {
    const p = run.points[run.points.length - 1]; if (!p) return;
    const sec = (performance.now() - run.t0) / 1000, gps = run.total / Math.max(0.001, sec);
    const set = (i, v) => { $('t-s' + i).textContent = v; };
    set(0, run.total); set(1, gps.toFixed(1)); set(2, p.mean.toFixed(0)); set(3, pc(p.drank)); set(4, pc(p.full));
    let txt = run.done ? 'Finished after ' + run.total + ' generations (' + sec.toFixed(0) + ' s).' : 'Stage: ' + run.stageNow + ' (generation ' + run.gOf + ' of at most ' + run.cap + ' in this stage).';
    if (!run.done && /^final/.test(run.stageNow || '')) { const left = (run.cap - run.gOf) / Math.max(0.01, gps); txt += ' About ' + Math.max(1, Math.round(left)) + ' s left.'; }
    else if (!run.done) txt += ' Stages end early when the dots reach their goal, so the total is not known in advance.';
    $('t-stage').textContent = txt + (run.paused ? ' Paused.' : '');
  }

  // ---- charts (inline SVG, drawn to scale) ----
  function bin(points, key, maxN) {   // average neighbouring generations so a long run stays readable
    const n = points.length, step = Math.max(1, Math.ceil(n / maxN)), out = [];
    for (let i = 0; i < n; i += step) { let s = 0, c = 0, any = false; for (let j = i; j < Math.min(n, i + step); j++) { const v = points[j][key]; if (v != null) { s += v; c++; any = true; } } out.push(any ? { x: points[Math.min(n - 1, i + step - 1)].x, y: s / c } : null); }
    return out;
  }
  function chart(svg, o) {
    const Wd = 520, Ht = 190, L = 40, R = 10, T = 22, B = 24, pw = Wd - L - R, ph = Ht - T - B, xmax = Math.max(10, o.xmax), sx = x => L + pw * x / xmax, sy = y => T + ph * (1 - (y - o.ymin) / (o.ymax - o.ymin));
    let s = `<text class="ttl" x="${L}" y="12">${o.title}</text>`;
    for (let i = 0; i <= 4; i++) { const y = o.ymin + (o.ymax - o.ymin) * i / 4; s += `<line x1="${L}" x2="${Wd - R}" y1="${sy(y).toFixed(1)}" y2="${sy(y).toFixed(1)}" stroke="var(--line)" stroke-width="0.6"/><text x="${L - 4}" y="${(sy(y) + 3).toFixed(1)}" text-anchor="end">${o.fmt(y)}</text>`; }
    for (let i = 0; i <= 4; i++) { const x = xmax * i / 4; s += `<text x="${sx(x).toFixed(1)}" y="${Ht - 8}" text-anchor="middle">${Math.round(x)}</text>`; }
    s += `<text x="${Wd - R}" y="12" text-anchor="end">generation</text>`;
    for (const m of o.marks || []) { const x = sx(m.x); s += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${T}" y2="${T + ph}" stroke="var(--muted)" stroke-width="0.7" stroke-dasharray="2 3"/>`; }
    for (const h of o.hlines || []) if (h.y >= o.ymin && h.y <= o.ymax) s += `<line x1="${L}" x2="${Wd - R}" y1="${sy(h.y).toFixed(1)}" y2="${sy(h.y).toFixed(1)}" stroke="${h.color}" stroke-width="1" stroke-dasharray="5 3"/><text x="${Wd - R - 2}" y="${(sy(h.y) - 3).toFixed(1)}" text-anchor="end" style="fill:${h.color}">${h.label}</text>`;
    let lx = L + 4; const ly = T + 10;
    for (const se of o.series) {
      const pts = se.data.filter(Boolean);
      if (pts.length) { const d = pts.map((p, i) => (i ? 'L' : 'M') + sx(p.x).toFixed(1) + ' ' + sy(Math.max(o.ymin, Math.min(o.ymax, p.y))).toFixed(1)).join(''); s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="1.6"/>`; const e = pts[pts.length - 1]; s += `<circle cx="${sx(e.x).toFixed(1)}" cy="${sy(e.y).toFixed(1)}" r="2.6" fill="${se.color}"/>`; }
      s += `<rect x="${lx}" y="${ly - 7}" width="8" height="3" fill="${se.color}"/><text x="${lx + 11}" y="${ly - 3}">${se.name}</text>`; lx += 20 + se.name.length * 6.1;
    }
    svg.innerHTML = s;
  }
  function drawCharts() {
    const pts = run ? run.points : [], cfg = run ? run.s.cfg : preset.cfg, wall = (cfg.maxW || 500) / (cfg.lossW || 0.6), len = cfg.genLen || 1000;
    const xmax = pts.length ? pts[pts.length - 1].x : 10, marks = run ? run.marks : [];
    chart($('t-ch1'), { title: 'Mean ticks survived (round length ' + len + ')', xmax, ymin: 0, ymax: len, fmt: v => v.toFixed(0), marks, series: [{ name: 'all maps', color: 'var(--accent)', data: bin(pts, 'mean', 260).map(p => p && { x: p.x, y: p.y }) }, { name: 'cup maps only', color: 'var(--chart2)', data: bin(pts, 'cupMean', 260) }], hlines: [{ y: wall, color: 'var(--bad)', label: 'thirst wall ' + wall.toFixed(0) + ': dots that never drink' }] });
    chart($('t-ch2'), { title: 'Share of dots', xmax, ymin: 0, ymax: 1, fmt: v => (100 * v).toFixed(0) + '%', marks, series: [{ name: 'drank', color: 'var(--accent)', data: bin(pts, 'drank', 260) }, { name: 'full round', color: 'var(--chart3)', data: bin(pts, 'full', 260) }, { name: 'drank on cups', color: 'var(--chart2)', data: bin(pts, 'cupDrank', 260) }] });
  }

  // ---- hand-off ----
  function snapshot() { return new Promise((res, rej) => { const ref = ++refSeq; snapshotWaiters[ref] = m => m.error ? rej(new Error(m.error)) : res(m); runner.post({ cmd: 'snapshot', ref }); }); }
  async function watchNow() {
    if (!run || !run.gotAny) return;
    const m = await snapshot();
    Lab.watchPop({ id: 'trained', title: 'Your run, generation ' + m.total, story: 'A population from the Train tab, copied at generation ' + m.total + '.', seed: m.seed, cfg: m.cfg, bytes: m.bytes, test: null });
  }
  async function saveFiles() {
    if (!run || !run.gotAny) return;
    const m = await snapshot(), name = 'forager-' + preset.id + '-seed' + m.seed + '-gen' + m.total;
    const dl = (n, blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = n; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
    dl(name + '.bin', new Blob([m.bytes], { type: 'application/octet-stream' }));
    dl(name + '.bin.json', new Blob([JSON.stringify({ seed: m.seed, cfg: m.cfg })], { type: 'application/json' }));
    $('t-savenote').textContent = 'Saved ' + name + '.bin and ' + name + '.bin.json (load both in Watch).';
  }

  Lab.registerView('train', 'Train', { init: build, show() { if (run) { paintProgress(); drawCharts(); } } });
  Lab.train = { OPTIONS, PRESETS, V, start, stop, get run() { return run; }, choose, currentSettings };
})();
