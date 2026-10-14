// Random ponds AND random wall bars, with a curriculum (WASM engine, generational mode). Every generation gets a fresh layout. Stages as in run-rand-curriculum.js
// (ponds within 16, 22, 28, 36 tiles of the nearer food centre, then the real task), and the number of bars grows with them: 0, 0, 1, 2, then `wallN` (default 3).
// A stage ends when at least `needFull` of the dots survive the whole round (mean of the last 10 generations) or after `maxStage` generations (first stage `maxFirst`).
// Then `finalGens` more generations on the real task. Tests (no breeding) on `testMaps` held-out layouts (map seeds 1000000 and up): random ponds with bars, and random ponds without.
// Usage: node run-randwalls.js '<cfg overrides as JSON>' <seed> [maxStage=400] [needFull=0.15] [finalGens=300] [maxFirst=1000] [testMaps=20]
// Cfg: "wallSense":1 adds the wall inputs; "gateWalls":1 holds their first-layer weights at 0 until the first stage with bars; "wallN", "wallLen" for the real task's bars.
const { Engine } = require('./engine');
const DEFAULTS = { layout: 'handfar', lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false, genSpawn: 1, wallN: 3, wallLen: 14 };
const mods = JSON.parse(process.argv[2] || '{}'), seed = +process.argv[3], maxStage = +process.argv[4] || 400, needFull = process.argv[5] === undefined ? 0.15 : +process.argv[5], finalGens = process.argv[6] === undefined ? 300 : +process.argv[6], maxFirst = +process.argv[7] || 1000, K = +process.argv[8] || 20;
const cfg = Object.assign({}, DEFAULTS, mods), pn = cfg.pondN, pm = cfg.pondMin || 30, WN = cfg.wallN, WL = cfg.wallLen, TB = cfg.testBars == null ? WN : cfg.testBars;   // testBars: bars in the 'with bars' test maps (default: as in training)
const e = new Engine(Object.assign({}, cfg, { layout: 'randpond', mapSeed: 1, walls: 0 }), seed);
e.genInit(seed);
const f = (v, d) => (+v).toFixed(d === undefined ? 0 : d), avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
const x = e.x, NW = x.genome_stride(), HP = x.layout_info(0), NACT = x.layout_info(4), ACT = new Int32Array(e.mem, x.act_ptr(), 40);
function zeroWallWeights() {
  const G = new Float32Array(e.mem, x.genome_ptr(), 2048 * NW); let k0 = -1;
  for (let k = 0; k < NACT; k++) if (ACT[k] === 34) k0 = k;
  if (k0 < 0) throw new Error('gateWalls needs wallSense on');
  for (let s = 0; s < e.cfg.genP; s++) for (let j = 0; j < 3; j++) for (let c = 0; c < HP; c++) G[s * NW + (k0 + j) * HP + c] = 0;
}
// "barsLate":1: learn the real pond task without bars first (the last no-bar stage always runs maxStage generations), then add bars one at a time on the real task
const stages = cfg.barsLate ? [[12, 16, 0], [12, 22, 0], [12, 28, 0], [12, 36, 0], [pm, 0, 0], [pm, 0, Math.min(1, WN)], [pm, 0, Math.min(2, WN)], [pm, 0, WN]]
  : [[12, 16, 0], [12, 22, 0], [12, 28, Math.min(1, WN)], [12, 36, Math.min(2, WN)], [pm, 0, WN]];   // [pondMin, pondMax, bars]; the last is the real task
const setMap = (seedv, lo, hi, bars) => e.setMap('randpond', 0, seedv, pn, lo, hi, bars > 0 ? 4 : 0, 0, bars, WL);
let total = 0, mapSeed = 1;
for (let si = 0; si < stages.length; si++) {
  const [lo, hi, bars] = stages[si], hist = []; let g = 0;
  while (g < (si === 0 ? maxFirst : maxStage)) {
    if (mods.gateWalls && bars === 0) zeroWallWeights();
    setMap(mapSeed++, lo, hi, bars);
    hist.push(e.genRound()); g++; total++;
    const last = hist.slice(-10);
    if (si < stages.length - 1 && last.length === 10 && avg(last, 'fullShare') >= needFull && !(cfg.barsLate && si === 4)) break;
  }
  const last = hist.slice(-10);
  console.log('stage ponds', lo + '..' + (hi || 'any'), 'bars', bars, '| gens used', g, '(total ' + total + ') | survived', f(avg(last, 'mean')), 'full', f(100 * avg(last, 'fullShare')) + '%', 'drank', f(100 * avg(last, 'drankShare')) + '%');
}
const hist = [];
for (let g = 0; g < finalGens; g++) { setMap(mapSeed++, pm, 0, WN); hist.push(e.genRound()); }
const evalOn = layoutFor => { let t = 0, full = 0, drank = 0; for (let i = 0; i < K; i++) { layoutFor(i); const s = e.genRound(false); t += s.mean; full += s.fullShare; drank += s.drankShare; } return { ticks: t / K, full: full / K, drank: drank / K }; };
const wb = evalOn(i => setMap(1000000 + i, pm, 0, TB)), nb = evalOn(i => setMap(1000000 + i, pm, 0, 0));
let abl = '';
if (mods.wallSense) { e.setCfg('wallSense', 0); const off = evalOn(i => setMap(1000000 + i, pm, 0, TB)); e.setCfg('wallSense', 1); abl = ' | ABL_WITHBARS ' + f(off.ticks) + ' ' + f(100 * off.full) + '%'; }
const last = hist.slice(-20);
console.log('FINAL seed', seed, '| gens', total, '| LAST20_TRAIN_TICKS', f(avg(last, 'mean')), '| LAST20_TRAIN_FULL', f(100 * avg(last, 'fullShare')) + '%',
  '| TEST_BARS_TICKS', f(wb.ticks), '| TEST_BARS_FULL', f(100 * wb.full) + '%', '| TEST_BARS_DRANK', f(100 * wb.drank) + '%',
  '| TEST_NOBARS_TICKS', f(nb.ticks), '| TEST_NOBARS_FULL', f(100 * nb.full) + '%', '| TEST_NOBARS_DRANK', f(100 * nb.drank) + '%' + abl);
