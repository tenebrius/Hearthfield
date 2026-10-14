// Curriculum into random ponds (WASM engine, generational mode). Every generation gets a fresh random layout; the ring the ponds
// are placed in grows in stages: ponds within 16, 22, 28 and 36 tiles of the nearer food centre (never closer than 12), then the real
// task (at least pondMin = 30 tiles away). A stage ends when at least `needFull` of the dots survive the whole round (mean of the last
// 10 generations) or after `maxStage` generations (the first stage gets up to `maxFirst`). Then it trains `finalGens` more on the real task
// and tests on 20 held-out layouts (map seeds 1000000 and up) and on far-corners, as run-rand.js does.
// Usage: node run-rand-curriculum.js '<cfg overrides as JSON>' <seed> [maxStage=400] [needFull=0.15] [finalGens=300] [maxFirst=1000] [testMaps=20]
const { Engine } = require('./engine');
const DEFAULTS = { layout: 'handfar', lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false, genSpawn: 1 };
const mods = JSON.parse(process.argv[2] || '{}'), seed = +process.argv[3], maxStage = +process.argv[4] || 400, needFull = process.argv[5] === undefined ? 0.15 : +process.argv[5], finalGens = process.argv[6] === undefined ? 300 : +process.argv[6], maxFirst = +process.argv[7] || 1000, K = +process.argv[8] || 20;
const cfg = Object.assign({}, DEFAULTS, mods), pn = cfg.pondN, pm = cfg.pondMin || 30;
const e = new Engine(Object.assign({}, cfg, { layout: 'randpond', mapSeed: 1 }), seed);
e.genInit(seed);
const f = (v, d) => (+v).toFixed(d === undefined ? 0 : d), avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
const stages = [[12, 16], [12, 22], [12, 28], [12, 36], [pm, 0]];   // [pondMin, pondMax]; the last is the real task
let total = 0, mapSeed = 1;
for (let si = 0; si < stages.length; si++) {
  const [lo, hi] = stages[si], hist = []; let g = 0;
  while (g < (si === 0 ? maxFirst : maxStage)) {
    e.setMap('randpond', 0, mapSeed++, pn, lo, hi);
    hist.push(e.genRound()); g++; total++;
    const last = hist.slice(-10);
    if (si < stages.length - 1 && last.length === 10 && avg(last, 'fullShare') >= needFull) break;
  }
  const last = hist.slice(-10);
  console.log('stage ponds', lo + '..' + (hi || 'any'), '| gens used', g, '(total ' + total + ') | survived', f(avg(last, 'mean')), 'full', f(100 * avg(last, 'fullShare')) + '%', 'drank', f(100 * avg(last, 'drankShare')) + '%');
}
const hist = [];
for (let g = 0; g < finalGens; g++) { e.setMap('randpond', 0, mapSeed++, pn, pm, 0); hist.push(e.genRound()); }
const evalOn = layoutFor => { let t = 0, full = 0, drank = 0; for (let i = 0; i < K; i++) { layoutFor(i); const s = e.genRound(false); t += s.mean; full += s.fullShare; drank += s.drankShare; } return { ticks: t / K, full: full / K, drank: drank / K }; };
const r = evalOn(i => e.setMap('randpond', 0, 1000000 + i, pn, pm, 0)), h = evalOn(() => e.setMap('handfar', 0));
const last = hist.slice(-20);
console.log('FINAL seed', seed, '| gens', total, '| LAST20_TRAIN_TICKS', f(avg(last, 'mean')), '| LAST20_TRAIN_FULL', f(100 * avg(last, 'fullShare')) + '%',
  '| TEST_RAND_TICKS', f(r.ticks), '| TEST_RAND_FULL', f(100 * r.full) + '%', '| TEST_RAND_DRANK', f(100 * r.drank) + '%',
  '| TEST_FAR_TICKS', f(h.ticks), '| TEST_FAR_FULL', f(100 * h.full) + '%', '| TEST_FAR_DRANK', f(100 * h.drank) + '%');
