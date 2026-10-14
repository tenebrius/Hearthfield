// Step 2 of docs/forager-lab-next-plan.md: random ponds, every dot scored on K layouts per generation (mean score), bars added only after drinking has started.
// Stages (fresh random layouts every round, as run-rand-curriculum.js): ponds within 16, 22, 28, 36 tiles of the nearer food centre (each ends when `needFull` of the dots
// survive the round, mean of the last 10 generations, or after maxStage generations; the first after maxFirst), then the real task (ponds at least 30 away, no bars)
// until drinking has started: at least `drinkStart` of the dots drank (mean of the last 10 generations), or `drinkCap` generations. With "wallN" above 0, bars then
// arrive one at a time on the real task (1, 2, then wallN; each stage ends at needFull or maxStage). Then `finalGens` more generations on the real task (with wallN bars).
// Tests (no breeding, one round per map): 20 held-out layouts (map seeds 1000000 and up) with `testBars` bars (default 3) and without bars.
// Usage: node run-multi.js '<cfg overrides as JSON>' <seed> [K=1] [finalGens=500] [maxStage=400] [needFull=0.15] [maxFirst=1000] [drinkCap=2000] [drinkStart=0.25]
const { Engine } = require('./engine');
const DEFAULTS = { layout: 'handfar', lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false, genSpawn: 1, wallN: 0, wallLen: 14 };
const A = process.argv, mods = JSON.parse(A[2] || '{}'), seed = +A[3], K = +A[4] || 1, finalGens = A[5] === undefined ? 500 : +A[5], maxStage = +A[6] || 400;
const needFull = A[7] === undefined ? 0.15 : +A[7], maxFirst = +A[8] || 1000, drinkCap = +A[9] || 2000, drinkStart = A[10] === undefined ? 0.25 : +A[10];
const cfg = Object.assign({}, DEFAULTS, mods), pn = cfg.pondN, pm = cfg.pondMin || 30, WN = cfg.wallN, WL = cfg.wallLen, TB = cfg.testBars == null ? 3 : cfg.testBars;
const e = new Engine(Object.assign({}, cfg, { layout: 'randpond', mapSeed: 1, walls: 0 }), seed);
e.genInit(seed);
const f = (v, d) => (+v).toFixed(d === undefined ? 0 : d), avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
const setMap = (seedv, lo, hi, bars) => e.setMap('randpond', 0, seedv, pn, lo, hi, bars > 0 ? 4 : 0, 0, bars, WL);
let total = 0, mapSeed = 1;
const gen = (lo, hi, bars) => { const sets = []; for (let k = 0; k < K; k++) { const ms = mapSeed++; sets.push(() => setMap(ms, lo, hi, bars)); } total++; return e.genRoundMulti(sets); };
function stage(label, lo, hi, bars, cap, exit) {
  const hist = []; let g = 0;
  while (g < cap) { hist.push(gen(lo, hi, bars)); g++; const last = hist.slice(-10); if (exit && last.length === 10 && exit(last)) break; }
  const last = hist.slice(-10);
  console.log(label, '| gens used', g, '(total ' + total + ') | survived', f(avg(last, 'mean')), 'full', f(100 * avg(last, 'fullShare')) + '%', 'drank', f(100 * avg(last, 'drankShare')) + '%');
  return g;
}
const fullExit = last => avg(last, 'fullShare') >= needFull;
[[12, 16], [12, 22], [12, 28], [12, 36]].forEach(([lo, hi], i) => stage('stage ponds ' + lo + '..' + hi, lo, hi, 0, i === 0 ? maxFirst : maxStage, fullExit));
const before = total, used = stage('real task, no bars, until drinking starts', pm, 0, 0, drinkCap, last => avg(last, 'drankShare') >= drinkStart);
const started = used < drinkCap ? before + used : -1;   // generation (total so far) at which the 10-generation mean of "drank" first reached drinkStart; -1 if never
if (WN > 0) for (const b of [Math.min(1, WN), Math.min(2, WN), WN]) stage('real task, bars ' + b, pm, 0, b, maxStage, fullExit);
stage('final, bars ' + WN, pm, 0, WN, finalGens, null);
const evalOn = layoutFor => { let t = 0, full = 0, drank = 0; for (let i = 0; i < 20; i++) { layoutFor(i); const s = e.genRound(false); t += s.mean; full += s.fullShare; drank += s.drankShare; } return { ticks: t / 20, full: full / 20, drank: drank / 20 }; };
const wb = evalOn(i => setMap(1000000 + i, pm, 0, TB)), nb = evalOn(i => setMap(1000000 + i, pm, 0, 0));
console.log('FINAL seed', seed, '| K', K, '| gens', total, '| DRINK_STARTED', started,
  '| TEST_BARS_TICKS', f(wb.ticks), '| TEST_BARS_FULL', f(100 * wb.full) + '%', '| TEST_BARS_DRANK', f(100 * wb.drank) + '%',
  '| TEST_NOBARS_TICKS', f(nb.ticks), '| TEST_NOBARS_FULL', f(100 * nb.full) + '%', '| TEST_NOBARS_DRANK', f(100 * nb.drank) + '%');
