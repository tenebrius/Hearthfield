// Step 2 of docs/forager-lab-next-plan.md: random ponds, every dot scored on K layouts per generation (mean score), bars added only after drinking has started.
// Stages (fresh random layouts every round, as run-rand-curriculum.js): ponds within 16, 22, 28, 36 tiles of the nearer food centre (each ends when `needFull` of the dots
// survive the round, mean of the last 10 generations, or after maxStage generations; the first after maxFirst), then the real task (ponds at least 30 away, no bars)
// until drinking has started: at least `drinkStart` of the dots drank (mean of the last 10 generations), or `drinkCap` generations. With "wallN" above 0, bars then
// arrive one at a time on the real task (1, 2, then wallN; each stage ends at needFull or maxStage). Then `finalGens` more generations on the real task (with wallN bars).
// Cups (step 4): with "cupGaps":[9,5,3] the bars stages are replaced by cup stages: every pond is enclosed by a wall ring with an opening of that width on a random side
// (walls = 5; set "pondSep":16 so that rings do not touch), each stage until needFull or maxStage generations, then the final stage with the last gap. "wallSense":1 adds the
// wall inputs and "gateWalls":1 holds their first-layer weights at 0 until the first walled stage. With "cupGaps":[] and "testCups":3 the dots never see a ring in training.
// "cupFacings":[1,1,1,0.75,0.5,0.25] (one per cup stage; use with the same number of cupGaps, e.g. [3,3,3,3,3,3]): the opening faces the food with that probability in the stage; the final stage and the tests use random openings (TEST_FACING = cups that always face the food).
// "cupMixes":[1,2,3] (one per cup stage, with K = 3): how many of the K maps each dot plays in a generation are cups, the rest are open maps (mixed training: drinking keeps paying on the open maps). The stage lines then also show the cup maps alone.
// "secureDrink":0.8 (step 4): after drinking has started, keep training the real task without walls until at least that share of the dots drank (mean of the last 10 generations),
// at most "secureCap" generations (default 1500), before any bars or cups arrive (a fragile foothold, 26% drinking, was wiped out by cups in 32 of 32 runs). With "cupStageCap"
// (default maxStage) and "cupExit" (a drank share; a cup stage ends early when the mean of the last 10 generations reaches it) the cup stages can be shortened.
// Tests (no breeding, one round per map): 20 held-out layouts (map seeds 1000000 and up) with `testBars` bars (default 3) or cups of gap `testCups` (default: the last cup gap, or 3), and without walls; with wall sense on, also with the wall inputs at 0.
// Usage: node run-multi.js '<cfg overrides as JSON>' <seed> [K=1] [finalGens=500] [maxStage=400] [needFull=0.15] [maxFirst=1000] [drinkCap=2000] [drinkStart=0.25]
const { Engine } = require('./engine');
const DEFAULTS = { layout: 'handfar', lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false, genSpawn: 1, wallN: 0, wallLen: 14 };
const A = process.argv, mods = JSON.parse(A[2] || '{}'), seed = +A[3], K = +A[4] || 1, finalGens = A[5] === undefined ? 500 : +A[5], maxStage = +A[6] || 400;
const needFull = A[7] === undefined ? 0.15 : +A[7], maxFirst = +A[8] || 1000, drinkCap = +A[9] || 2000, drinkStart = A[10] === undefined ? 0.25 : +A[10];
const cfg = Object.assign({}, DEFAULTS, mods), pn = cfg.pondN, pm = cfg.pondMin || 30, WN = cfg.wallN, WL = cfg.wallLen, TB = cfg.testBars == null ? 3 : cfg.testBars;
const CUPS = Array.isArray(cfg.cupGaps), cupGaps = CUPS ? cfg.cupGaps : [], TC = cfg.testCups != null ? cfg.testCups : cupGaps.length ? cupGaps[cupGaps.length - 1] : 3;
const cupFacings = Array.isArray(cfg.cupFacings) ? cfg.cupFacings : [];   // per cup stage, the probability that the opening faces the food (curriculum that rotates the opening away); the final stage and the tests use random openings
const cupMixes = Array.isArray(cfg.cupMixes) ? cfg.cupMixes : [];   // per cup stage, how many of the K maps of a generation are cup maps (the rest are open maps); default all K
const NOW = { t: 0, gap: 0, n: 0, f: 0 }, bars = n => ({ t: n > 0 ? 4 : 0, gap: 0, n, f: 0 }), cups = (g, f, mix) => ({ t: 5, gap: g, n: 0, f: f || 0, mix });
const e = new Engine(Object.assign({}, cfg, { layout: 'randpond', mapSeed: 1, walls: 0 }), seed);
e.genInit(seed);
const f = (v, d) => (+v).toFixed(d === undefined ? 0 : d), avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
const setMap = (seedv, lo, hi, w) => (e.cfg.cupFacing = w.f || 0, e.setMap('randpond', 0, seedv, pn, lo, hi, w.t, w.gap, w.n, WL));
const x = e.x, NW = x.genome_stride(), HP = x.layout_info(0), NACT = x.layout_info(4), ACT = new Int32Array(e.mem, x.act_ptr(), 40);
function zeroWallWeights() {   // first-layer weights of the three wall inputs, in every genome
  const G = new Float32Array(e.mem, x.genome_ptr(), 2048 * NW); let k0 = -1;
  for (let k = 0; k < NACT; k++) if (ACT[k] === 34) k0 = k;
  if (k0 < 0) throw new Error('gateWalls needs wallSense on');
  for (let s = 0; s < e.cfg.genP; s++) for (let j = 0; j < 3; j++) for (let c = 0; c < HP; c++) G[s * NW + (k0 + j) * HP + c] = 0;
}
let total = 0, mapSeed = 1;
const gen = (lo, hi, w) => { if (mods.gateWalls && w.t === 0) zeroWallWeights(); const sets = [], nc = w.t === 5 && w.mix != null ? Math.min(K, w.mix) : K; for (let k = 0; k < K; k++) { const ms = mapSeed++, wk = (w.t === 5 && k >= nc) ? NOW : w; sets.push(() => setMap(ms, lo, hi, wk)); } total++; const r = e.genRoundMulti(sets); if (w.t === 5) { const c = r.perLayout.slice(0, nc), a = k2 => c.reduce((x, y) => x + y[k2], 0) / c.length; r.cupMean = a('mean'); r.cupFull = a('fullShare'); r.cupDrank = a('drankShare'); } return r; };
function stage(label, lo, hi, w, cap, exit) {
  const hist = []; let g = 0;
  while (g < cap) { hist.push(gen(lo, hi, w)); g++; const last = hist.slice(-10); if (exit && last.length === 10 && exit(last)) break; }
  const last = hist.slice(-10);
  console.log(label, '| gens used', g, '(total ' + total + ') | survived', f(avg(last, 'mean')), 'full', f(100 * avg(last, 'fullShare')) + '%', 'drank', f(100 * avg(last, 'drankShare')) + '%' + (last[0] && last[0].cupDrank != null ? ' | on the cup maps only: survived ' + f(avg(last, 'cupMean')) + ' full ' + f(100 * avg(last, 'cupFull')) + '% drank ' + f(100 * avg(last, 'cupDrank')) + '%' : ''));
  return g;
}
const fullExit = last => avg(last, 'fullShare') >= needFull;
[[12, 16], [12, 22], [12, 28], [12, 36]].forEach(([lo, hi], i) => stage('stage ponds ' + lo + '..' + hi, lo, hi, NOW, i === 0 ? maxFirst : maxStage, fullExit));
const before = total, used = stage('real task, no bars, until drinking starts', pm, 0, NOW, drinkCap, last => avg(last, 'drankShare') >= drinkStart);
const started = used < drinkCap ? before + used : -1;
if (cfg.secureDrink) stage('real task, no walls, until drinking is secure', pm, 0, NOW, cfg.secureCap || 1500, last => avg(last, 'drankShare') >= cfg.secureDrink);
const cupCap = cfg.cupStageCap || maxStage, cupExitFn = cfg.cupExit ? (last => avg(last, 'drankShare') >= cfg.cupExit) : fullExit;   // generation (total so far) at which the 10-generation mean of "drank" first reached drinkStart; -1 if never
if (CUPS) cupGaps.forEach((g, i) => stage('real task, cups gap ' + g + (cupFacings.length ? ' opening faces the food ' + Math.round(100 * (cupFacings[i] || 0)) + '%' : ''), pm, 0, cups(g, cupFacings[i], cupMixes[i]), cupCap, cupExitFn));
else if (WN > 0) for (const b of [Math.min(1, WN), Math.min(2, WN), WN]) stage('real task, bars ' + b, pm, 0, bars(b), maxStage, fullExit);
const finalW = CUPS ? (cupGaps.length ? cups(cupGaps[cupGaps.length - 1]) : NOW) : bars(WN);
stage('final, ' + (CUPS ? 'cups gap ' + (cupGaps.length ? cupGaps[cupGaps.length - 1] : '-') : 'bars ' + WN), pm, 0, finalW, finalGens, null);
const evalOn = layoutFor => { let t = 0, full = 0, drank = 0; for (let i = 0; i < 20; i++) { layoutFor(i); const s = e.genRound(false); t += s.mean; full += s.fullShare; drank += s.drankShare; } return { ticks: t / 20, full: full / 20, drank: drank / 20 }; };
const testW = CUPS ? cups(TC) : bars(TB);
const wb = evalOn(i => setMap(1000000 + i, pm, 0, testW)), nb = evalOn(i => setMap(1000000 + i, pm, 0, NOW));
const fc = CUPS ? evalOn(i => setMap(1000000 + i, pm, 0, cups(TC, 1))) : null;   // cups whose opening always faces the food (usable side)
let abl = '';
if (mods.wallSense) { e.setCfg('wallSense', 0); const off = evalOn(i => setMap(1000000 + i, pm, 0, testW)); e.setCfg('wallSense', 1); abl = ' | ABL_WITHWALLS ' + f(off.ticks) + ' ' + f(100 * off.full) + '% ' + f(100 * off.drank) + '%'; }
console.log('FINAL seed', seed, '| K', K, '| gens', total, '| DRINK_STARTED', started,
  '| TEST_BARS_TICKS', f(wb.ticks), '| TEST_BARS_FULL', f(100 * wb.full) + '%', '| TEST_BARS_DRANK', f(100 * wb.drank) + '%',
  '| TEST_NOBARS_TICKS', f(nb.ticks), '| TEST_NOBARS_FULL', f(100 * nb.full) + '%', '| TEST_NOBARS_DRANK', f(100 * nb.drank) + '%' + (fc ? ' | TEST_FACING_TICKS ' + f(fc.ticks) + ' | TEST_FACING_FULL ' + f(100 * fc.full) + '% | TEST_FACING_DRANK ' + f(100 * fc.drank) + '%' : '') + abl);

// "traceCups":1 (step 6): after the tests, replay 10 held-out cup maps (gap TC, random openings) with the trained dots and print one TRACE line: where each dot first reaches a ring
// (the open side or a closed one), how many get in from each, how many leave again, how many of the dots that drank survive, die inside or outside the ring. Same quantities as run-cuptrace.js.
if (cfg.traceCups && CUPS) {
  const { W } = require('./engine'), GP = e.cfg.genP, L = e.cfg.genLen, v = e.views(), kindArr = new Uint8Array(e.mem, e.x.kind_ptr(), W * W), R = 10;
  const acc = { dots: 0, arrOpen: 0, arrOpenIn: 0, arrClosed: 0, arrClosedIn: 0, gotIn: 0, leftAgain: 0, drank: 0, drinkSurvived: 0, drinkDiedInside: 0, drinkDiedOutside: 0, reached: 0 };
  let survived = 0, drankAll = 0;
  for (let r = 0; r < R; r++) {
    setMap(1000000 + r, pm, 0, cups(TC, 0));
    const kinds = new Uint8Array(kindArr), ponds = [], seen = new Uint8Array(W * W);
    for (let i = 0; i < W * W; i++) if (kinds[i] === 3 && !seen[i]) { const x0 = i % W, y0 = (i / W) | 0; for (let yy = y0; yy < y0 + 7; yy++) for (let xx = x0; xx < x0 + 7; xx++) seen[yy * W + xx] = 1; ponds.push([x0, y0]); }
    const kk = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= W) ? 4 : kinds[yy * W + xx];
    const openSide = ponds.map(p => [[p[0] - 3, p[1] + 3], [p[0] + 9, p[1] + 3], [p[0] + 3, p[1] - 3], [p[0] + 3, p[1] + 9]].findIndex(m => kk(m[0], m[1]) !== 4));
    const nearRing = (xx, yy) => ponds.some(p => xx >= p[0] - 6 && xx <= p[0] + 13 && yy >= p[1] - 6 && yy <= p[1] + 13);
    const inside = (xx, yy) => ponds.some(p => xx >= p[0] - 2 && xx <= p[0] + 8 && yy >= p[1] - 2 && yy <= p[1] + 8);
    const sideOf = (xx, yy) => { let best = -1, bd = 1e9; ponds.forEach((p, i) => { const d = Math.hypot(xx - (p[0] + 3.5), yy - (p[1] + 3.5)); if (d < bd) { bd = d; best = i; } }); const p = ponds[best], dx = xx - (p[0] + 3.5), dy = yy - (p[1] + 3.5); return { pond: best, side: Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 0 : 1) : (dy < 0 ? 2 : 3) }; };
    const arrived = new Int8Array(GP).fill(-1), entered = new Uint8Array(GP), wasIn = new Uint8Array(GP), exited = new Uint8Array(GP), lastT = new Int32Array(GP).fill(-1), lastX = new Float64Array(GP), lastY = new Float64Array(GP);
    e.genBegin();
    for (let t = 0; t < L; t++) {
      const n = e.genTick(t);
      for (let i = 0; i < n; i++) { const sI = v.ord[i], xx = v.ax[sI], yy = v.ay[sI]; if (nearRing(xx, yy) && arrived[sI] < 0) { const sd = sideOf(xx, yy); arrived[sI] = sd.side === openSide[sd.pond] ? 1 : 0; } const nin = inside(xx, yy) ? 1 : 0; if (nin) entered[sI] = 1; if (wasIn[sI] && !nin) exited[sI] = 1; wasIn[sI] = nin; lastT[sI] = t; lastX[sI] = xx; lastY[sI] = yy; }
      if (n === 0) break;
    }
    const st = e.genEnd(false); survived += st.mean / R; drankAll += st.drankShare / R;
    for (let sI = 0; sI < GP; sI++) {
      acc.dots++; const dr = v.gwater[sI] > 0;
      if (arrived[sI] >= 0) acc.reached++;
      if (arrived[sI] === 1) { acc.arrOpen++; if (entered[sI]) acc.arrOpenIn++; } else if (arrived[sI] === 0) { acc.arrClosed++; if (entered[sI]) acc.arrClosedIn++; }
      if (entered[sI]) { acc.gotIn++; if (exited[sI]) acc.leftAgain++; }
      if (dr) { acc.drank++; if (lastT[sI] >= L - 1) acc.drinkSurvived++; else if (inside(lastX[sI], lastY[sI])) acc.drinkDiedInside++; else acc.drinkDiedOutside++; }
    }
  }
  const pc = (a, b) => b ? Math.round(1000 * a / b) / 10 : null;
  console.log('TRACE ' + JSON.stringify({ seed, survived: Math.round(survived), drank: Math.round(1000 * drankAll) / 10, reachedRing: pc(acc.reached, acc.dots), arrivedAtOpen: pc(acc.arrOpen, acc.arrOpen + acc.arrClosed), enteredFromOpen: pc(acc.arrOpenIn, acc.arrOpen), enteredFromClosed: pc(acc.arrClosedIn, acc.arrClosed),
    gotIn: pc(acc.gotIn, acc.dots), leftAgain: pc(acc.leftAgain, acc.gotIn), drinkers: acc.drank, drinkersSurvived: pc(acc.drinkSurvived, acc.drank), drinkersDiedInside: pc(acc.drinkDiedInside, acc.drank), drinkersDiedOutside: pc(acc.drinkDiedOutside, acc.drank) }));
}
// "saveTo":"path.bin": write the trained population (all genomes) to that file and the settings to path.bin.json, for run-load.js (examine it later without training).
if (cfg.saveTo) { e.saveGenomes(cfg.saveTo); require('fs').writeFileSync(cfg.saveTo + '.json', JSON.stringify({ seed, cfg: Object.assign({}, cfg, { saveTo: undefined }) })); }
// "altLossE":1.5 (step 6): after everything else, evaluate the trained population once more with that energy loss per tick (same 20 held-out cup maps and open maps), printed as an ALT line.
if (cfg.altLossE != null) {
  e.setCfg('lossE', cfg.altLossE);
  const a1 = evalOn(i => setMap(1000000 + i, pm, 0, testW)), a2 = evalOn(i => setMap(1000000 + i, pm, 0, NOW));
  console.log('ALT lossE', cfg.altLossE, '| CUPS_TICKS', f(a1.ticks), '| CUPS_FULL', f(100 * a1.full) + '%', '| CUPS_DRANK', f(100 * a1.drank) + '%', '| OPEN_TICKS', f(a2.ticks), '| OPEN_FULL', f(100 * a2.full) + '%', '| OPEN_DRANK', f(100 * a2.drank) + '%');
}
