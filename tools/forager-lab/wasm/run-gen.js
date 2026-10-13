// Generational mode runner (WASM engine). Fixed-size rounds on a fresh map, tournament selection, elitism, optional crossover.
// Usage: node run-gen.js '<cfg overrides as JSON>' <seed> <generations> <report every N generations>
// Defaults: far-ponds map, energy loss 1.5, hydration loss 0.6, 2 hidden layers of 8, start energy and hydration 100,
// 200 dots, 1000-tick rounds, elitism 2, tournament of 3, crossover off (genXover: 1 = whole neurons, 2 = single weights).
// Score = genWSurv * ticks survived + genWFood * food tiles eaten + genWWater * water tiles drunk (default 1, 0, 0). genSpawn: 0 random start, 1 everyone in the centre.
// LAST20_MEAN_SCORE is the mean number of ticks survived (not the weighted score), so it is comparable across scoring modes. Add "baseline":true for random movers (no evolution) as a reference.
const { Engine } = require('./engine');
const DEFAULTS = { layout: 'handfar', lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false };
const mods = JSON.parse(process.argv[2] || '{}'), seed = +process.argv[3], gens = +process.argv[4], every = +process.argv[5] || 10;
const e = new Engine(Object.assign({}, DEFAULTS, mods), seed);
e.genInit(seed);
const f = (v, d) => (+v).toFixed(d === undefined ? 0 : d);
const hist = [];
for (let g = 0; g < gens; g++) {
  const s = e.genRound(); hist.push(s);
  if (g % every === 0 || g === gens - 1)
    console.log('gen', s.gen, '| score best', f(s.best, 1), 'mean', f(s.score, 1), 'median', f(s.median, 1), '| ticks survived (mean)', f(s.mean), '| survived full round', f(100 * s.fullShare) + '%', '| food tiles', f(s.food, 1), 'water tiles', f(s.water, 1), '| drank', f(100 * s.drankShare) + '%', 'stood on pond', f(100 * s.pondShare) + '%', 'both circles', f(100 * s.bothShare) + '%', '| diversity', f(s.diversity, 3));
}
const last = hist.slice(-Math.min(20, hist.length)), avg = k => last.reduce((a, s) => a + s[k], 0) / last.length;
console.log('FINAL seed', seed, '| gens', gens, '| LAST20_MEAN_SCORE', f(avg('mean')), '| LAST20_FOOD', f(avg('food'), 1), '| LAST20_WATER', f(avg('water'), 1), '| LAST20_DRANK', f(100 * avg('drankShare')) + '%', '| LAST20_FULL_SHARE', f(100 * avg('fullShare')) + '%', '| LAST20_POND', f(100 * avg('pondShare')) + '%', '| LAST20_BOTH', f(100 * avg('bothShare')) + '%', '| BEST_EVER', f(Math.max(...hist.map(s => s.best))));
