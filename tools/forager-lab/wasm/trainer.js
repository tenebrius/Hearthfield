// Stage machine of the random-pond training runs, shared by run-multi.js (Node) and the browser page (train-worker.js).
// train(e, cfg, o) is a generator: it yields one { type: 'gen' } event after every generation and one { type: 'stage' } event when a stage ends, then { type: 'done' }.
// What the stages are (curriculum of pond distances, drinking-start stage, secure-drink stage, bars or cups, budget steps, final stage) is described in the header of run-multi.js.
// cfg is the fully merged settings object (RUN_DEFAULTS plus the run's overrides); o holds the run-multi arguments { K, finalGens, maxStage, needFull, maxFirst, drinkCap, drinkStart }.
// evaluate(e, cfg, ctx) runs the held-out tests (20 maps, map seeds 1000000 and up). In Node: module.exports; in a browser or worker: globalThis.ForagerTrainer.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.ForagerTrainer = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
const RUN_DEFAULTS = { layout: 'handfar', lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false, genSpawn: 1, wallN: 0, wallLen: 14 };
const OPTION_DEFAULTS = { K: 1, finalGens: 500, maxStage: 400, needFull: 0.15, maxFirst: 1000, drinkCap: 2000, drinkStart: 0.25 };
const avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;

// map helpers for a run: the walls spec of a stage is { t: walls kind, gap, n: bars, f: cupFacing, mix }
function makeCtx(e, cfg) {
  const pn = cfg.pondN, pm = cfg.pondMin || 30, WN = cfg.wallN, WL = cfg.wallLen, TB = cfg.testBars == null ? 3 : cfg.testBars;
  const cupGaps = Array.isArray(cfg.cupGaps) ? cfg.cupGaps : [], CUPS = Array.isArray(cfg.cupGaps);
  const TC = cfg.testCups != null ? cfg.testCups : cupGaps.length ? cupGaps[cupGaps.length - 1] : 3;
  const NOW = { t: 0, gap: 0, n: 0, f: 0 }, bars = n => ({ t: n > 0 ? 4 : 0, gap: 0, n, f: 0 }), cups = (g, f, mix) => ({ t: 5, gap: g, n: 0, f: f || 0, mix });
  const setMap = (seedv, lo, hi, w) => (e.cfg.cupFacing = w.f || 0, e.setMap('randpond', 0, seedv, pn, lo, hi, w.t, w.gap, w.n, WL));
  return { pn, pm, WN, WL, TB, cupGaps, CUPS, TC, NOW, bars, cups, setMap, testW: CUPS ? cups(TC) : bars(TB) };
}

function* train(e, cfg, opts) {
  const o = Object.assign({}, OPTION_DEFAULTS, opts), K = o.K, ctx = makeCtx(e, cfg), { pm, WN, cupGaps, CUPS, TC, NOW, bars, cups, setMap } = ctx;
  const cupFacings = Array.isArray(cfg.cupFacings) ? cfg.cupFacings : [], cupMixes = Array.isArray(cfg.cupMixes) ? cfg.cupMixes : [];
  const x = e.x, NW = x.genome_stride(), HP = x.layout_info(0), NACT = x.layout_info(4), ACT = new Int32Array(e.mem, x.act_ptr(), 40);
  function zeroWallWeights() {   // first-layer weights of the three wall inputs, in every genome
    const G = new Float32Array(e.mem, x.genome_ptr(), 2048 * NW); let k0 = -1;
    for (let k = 0; k < NACT; k++) if (ACT[k] === 34) k0 = k;
    if (k0 < 0) throw new Error('gateWalls needs wallSense on');
    for (let s = 0; s < e.cfg.genP; s++) for (let j = 0; j < 3; j++) for (let c = 0; c < HP; c++) G[s * NW + (k0 + j) * HP + c] = 0;
  }
  let total = 0, mapSeed = 1;
  const gen = (lo, hi, w) => {
    if (cfg.gateWalls && w.t === 0) zeroWallWeights();
    const sets = [], nc = w.t === 5 && w.mix != null ? Math.min(K, w.mix) : K;
    for (let k = 0; k < K; k++) { const ms = mapSeed++, wk = (w.t === 5 && k >= nc) ? NOW : w; sets.push(() => setMap(ms, lo, hi, wk)); }
    total++;
    const r = e.genRoundMulti(sets);
    if (w.t === 5) { const c = r.perLayout.slice(0, nc), a = k2 => c.reduce((s, y) => s + y[k2], 0) / c.length; r.cupMean = a('mean'); r.cupFull = a('fullShare'); r.cupDrank = a('drankShare'); }
    return r;
  };
  let started = -1;
  // one stage: yields a 'gen' event per generation, then a 'stage' event; returns the generations used
  function* stage(label, lo, hi, w, cap, exit) {
    const hist = []; let g = 0;
    while (g < cap) {
      const r = gen(lo, hi, w); hist.push(r); g++;
      yield { type: 'gen', stage: label, g, cap, total, stats: r, cups: w.t === 5 };
      const last = hist.slice(-10);
      if (exit && last.length === 10 && exit(last)) break;
    }
    yield { type: 'stage', label, g, total, last: hist.slice(-10) };
    return g;
  }
  const fullExit = last => avg(last, 'fullShare') >= o.needFull;
  if (!cfg.noCurriculum) {
    const dist = [[12, 16], [12, 22], [12, 28], [12, 36]];
    for (let i = 0; i < dist.length; i++) yield* stage('stage ponds ' + dist[i][0] + '..' + dist[i][1], dist[i][0], dist[i][1], NOW, i === 0 ? o.maxFirst : o.maxStage, fullExit);
  }
  const before = total;
  if (!cfg.noCurriculum) {
    const used = yield* stage('real task, no bars, until drinking starts', pm, 0, NOW, o.drinkCap, last => avg(last, 'drankShare') >= o.drinkStart);
    started = used < o.drinkCap ? before + used : -1;
  }
  if (cfg.secureDrink) yield* stage('real task, no walls, until drinking is secure', pm, 0, NOW, cfg.secureCap || 1500, last => avg(last, 'drankShare') >= cfg.secureDrink);
  const cupCap = cfg.cupStageCap || o.maxStage, cupExitFn = cfg.cupExit ? (last => avg(last, 'drankShare') >= cfg.cupExit) : fullExit;
  if (CUPS) { for (let i = 0; i < cupGaps.length; i++) { const g = cupGaps[i]; yield* stage('real task, cups gap ' + g + (cupFacings.length ? ' opening faces the food ' + Math.round(100 * (cupFacings[i] || 0)) + '%' : ''), pm, 0, cups(g, cupFacings[i], cupMixes[i]), cupCap, cupExitFn); } }
  else if (WN > 0) for (const b of [Math.min(1, WN), Math.min(2, WN), WN]) yield* stage('real task, bars ' + b, pm, 0, bars(b), o.maxStage, fullExit);
  // "lossSteps": see run-multi.js
  if (Array.isArray(cfg.lossSteps)) for (const lv of cfg.lossSteps) { e.setCfg('lossE', lv); yield* stage('tighten: energy loss ' + lv, pm, 0, cups(TC, 0), cfg.lossStageCap || 300, last => avg(last, 'cupDrank') >= (cfg.lossExit == null ? 0.5 : cfg.lossExit)); }
  const finalW = CUPS ? (cupGaps.length ? cups(cupGaps[cupGaps.length - 1]) : NOW) : bars(WN);
  yield* stage('final, ' + (CUPS ? 'cups gap ' + (cupGaps.length ? cupGaps[cupGaps.length - 1] : '-') : 'bars ' + WN), pm, 0, finalW, o.finalGens, null);
  yield { type: 'done', started, total };
}

// held-out tests (no breeding, one round per map): cups or bars, open maps, cups facing the food, and with the wall inputs at 0
function evalOn(e, layoutFor, n) { n = n || 20; let t = 0, full = 0, drank = 0; for (let i = 0; i < n; i++) { layoutFor(i); const s = e.genRound(false); t += s.mean; full += s.fullShare; drank += s.drankShare; } return { ticks: t / n, full: full / n, drank: drank / n }; }
function evaluate(e, cfg, ctx) {
  ctx = ctx || makeCtx(e, cfg);
  const { pm, setMap, testW, NOW, CUPS, TC, cups } = ctx;
  const wb = evalOn(e, i => setMap(1000000 + i, pm, 0, testW)), nb = evalOn(e, i => setMap(1000000 + i, pm, 0, NOW));
  const fc = CUPS ? evalOn(e, i => setMap(1000000 + i, pm, 0, cups(TC, 1))) : null;
  let abl = null;
  if (cfg.wallSense) { e.setCfg('wallSense', 0); abl = evalOn(e, i => setMap(1000000 + i, pm, 0, testW)); e.setCfg('wallSense', 1); }
  return { wb, nb, fc, abl };
}
return { RUN_DEFAULTS, OPTION_DEFAULTS, makeCtx, train, evaluate, evalOn, avg };
});
