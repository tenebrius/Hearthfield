// Random-pond training with held-out test maps (generational mode, WASM engine).
// Usage: node run-rand.js '<cfg overrides as JSON>' <seed> <generations> <report every N> [train=random|fixed] [testMaps=20]
// train=random: every generation gets a fresh randpond layout (map seeds are drawn from the training range, so the dots never see the same map twice).
// train=fixed: every generation uses the cfg layout (default handfar), as in run-gen.js; the dots are still tested on random layouts.
// Test: the current population is evaluated without breeding on `testMaps` randpond layouts from a separate range of map seeds (never used for training),
// and on handfar. Numbers are means over all dots and test maps: ticks survived, share that survived the whole round, share that drank.
// Cost note: a test pass is testMaps extra rounds, so it costs about testMaps/every of a training generation per generation; keep `every` at 50 or more.
// Add "baseline":true and generations 0 for random movers on the test maps. Cfg extras: pondN (ponds per layout, 2), pondMin (min distance to food, 30).
const { Engine } = require('./engine');
const DEFAULTS = { layout: 'handfar', lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false };
const mods = JSON.parse(process.argv[2] || '{}'), seed = +process.argv[3], gens = +process.argv[4], every = +process.argv[5] || 50;
const trainMode = process.argv[6] || 'random', K = +process.argv[7] || 20;
if (!['random', 'fixed'].includes(trainMode)) throw new Error('train must be random or fixed');
const cfg = Object.assign({}, DEFAULTS, mods);
const e = new Engine(Object.assign({}, cfg, { layout: trainMode === 'random' ? 'randpond' : cfg.layout, mapSeed: 1 }), seed);
e.genInit(seed);
const f = (v, d) => (+v).toFixed(d === undefined ? 0 : d);
const TRAIN0 = 1, TEST0 = 1000000;   // map seed ranges: training seeds are 1.., test seeds 1000000..
const pn = cfg.pondN, pm = cfg.pondMin;
function evalOn(layoutFor) {
  let t = 0, full = 0, drank = 0;
  for (let i = 0; i < K; i++) { layoutFor(i); const s = e.genRound(false); t += s.mean; full += s.fullShare; drank += s.drankShare; }
  return { ticks: t / K, full: full / K, drank: drank / K };
}
function testAll() {
  const r = evalOn(i => e.setMap('randpond', 0, TEST0 + i, pn, pm));
  const h = evalOn(() => e.setMap('handfar', 0));
  return { r, h };
}
const fmt = x => f(x.ticks) + ' ticks, ' + f(100 * x.full) + '% full, ' + f(100 * x.drank) + '% drank';
const hist = [];
for (let g = 0; g < gens; g++) {
  if (trainMode === 'random') e.setMap('randpond', 0, TRAIN0 + g, pn, pm);
  const s = e.genRound(); hist.push(s);
  if (g % every === 0 || g === gens - 1) {
    const t = testAll();
    console.log('gen', s.gen, '| train', f(s.mean), 'ticks,', f(100 * s.fullShare) + '% full', '| TEST random ponds:', fmt(t.r), '| TEST far corners:', fmt(t.h));
  }
}
const t = testAll(), last = hist.slice(-Math.min(20, hist.length)), avg = k => last.length ? last.reduce((a, s) => a + s[k], 0) / last.length : NaN;
console.log('FINAL seed', seed, '| train', trainMode, '| gens', gens, '| LAST20_TRAIN_TICKS', f(avg('mean')), '| LAST20_TRAIN_FULL', f(100 * avg('fullShare')) + '%',
  '| TEST_RAND_TICKS', f(t.r.ticks), '| TEST_RAND_FULL', f(100 * t.r.full) + '%', '| TEST_RAND_DRANK', f(100 * t.r.drank) + '%',
  '| TEST_FAR_TICKS', f(t.h.ticks), '| TEST_FAR_FULL', f(100 * t.h.full) + '%', '| TEST_FAR_DRANK', f(100 * t.h.drank) + '%');
