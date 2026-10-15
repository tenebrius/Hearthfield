// Step 2 of docs/forager-lab-next-plan.md: random ponds, every dot scored on K layouts per generation (mean score), bars added only after drinking has started.
// Stages (fresh random layouts every round, as run-rand-curriculum.js): ponds within 16, 22, 28, 36 tiles of the nearer food centre (each ends when `needFull` of the dots
// survive the round, mean of the last 10 generations, or after maxStage generations; the first after maxFirst), then the real task (ponds at least 30 away, no bars)
// until drinking has started: at least `drinkStart` of the dots drank (mean of the last 10 generations), or `drinkCap` generations. With "wallN" above 0, bars then
// arrive one at a time on the real task (1, 2, then wallN; each stage ends at needFull or maxStage). Then `finalGens` more generations on the real task (with wallN bars).
// Cups (step 4): with "cupGaps":[9,5,3] the bars stages are replaced by cup stages: every pond is enclosed by a wall ring with an opening of that width on a random side
// (walls = 5; set "pondSep":16 so that rings do not touch), each stage until needFull or maxStage generations, then the final stage with the last gap. "wallSense":1 adds the
// wall inputs and "gateWalls":1 holds their first-layer weights at 0 until the first walled stage. With "cupGaps":[] and "testCups":3 the dots never see a ring in training.
// "cupFacings":[1,1,1,0.75,0.5,0.25] (one per cup stage; use with the same number of cupGaps, e.g. [3,3,3,3,3,3]): the opening faces the food with that probability in the stage; the final stage and the tests use random openings (TEST_FACING = cups that always face the food).
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
const NOW = { t: 0, gap: 0, n: 0, f: 0 }, bars = n => ({ t: n > 0 ? 4 : 0, gap: 0, n, f: 0 }), cups = (g, f) => ({ t: 5, gap: g, n: 0, f: f || 0 });
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
const gen = (lo, hi, w) => { if (mods.gateWalls && w.t === 0) zeroWallWeights(); const sets = []; for (let k = 0; k < K; k++) { const ms = mapSeed++; sets.push(() => setMap(ms, lo, hi, w)); } total++; return e.genRoundMulti(sets); };
function stage(label, lo, hi, w, cap, exit) {
  const hist = []; let g = 0;
  while (g < cap) { hist.push(gen(lo, hi, w)); g++; const last = hist.slice(-10); if (exit && last.length === 10 && exit(last)) break; }
  const last = hist.slice(-10);
  console.log(label, '| gens used', g, '(total ' + total + ') | survived', f(avg(last, 'mean')), 'full', f(100 * avg(last, 'fullShare')) + '%', 'drank', f(100 * avg(last, 'drankShare')) + '%');
  return g;
}
const fullExit = last => avg(last, 'fullShare') >= needFull;
[[12, 16], [12, 22], [12, 28], [12, 36]].forEach(([lo, hi], i) => stage('stage ponds ' + lo + '..' + hi, lo, hi, NOW, i === 0 ? maxFirst : maxStage, fullExit));
const before = total, used = stage('real task, no bars, until drinking starts', pm, 0, NOW, drinkCap, last => avg(last, 'drankShare') >= drinkStart);
const started = used < drinkCap ? before + used : -1;
if (cfg.secureDrink) stage('real task, no walls, until drinking is secure', pm, 0, NOW, cfg.secureCap || 1500, last => avg(last, 'drankShare') >= cfg.secureDrink);
const cupCap = cfg.cupStageCap || maxStage, cupExitFn = cfg.cupExit ? (last => avg(last, 'drankShare') >= cfg.cupExit) : fullExit;   // generation (total so far) at which the 10-generation mean of "drank" first reached drinkStart; -1 if never
if (CUPS) cupGaps.forEach((g, i) => stage('real task, cups gap ' + g + (cupFacings.length ? ' opening faces the food ' + Math.round(100 * (cupFacings[i] || 0)) + '%' : ''), pm, 0, cups(g, cupFacings[i]), cupCap, cupExitFn));
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
