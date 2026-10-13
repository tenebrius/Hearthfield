// Curriculum runner (WASM engine, generational mode): start with the ponds touching the food circles and slide them out to the
// corners in steps, keeping the population. A stage ends when at least `needFull` of the dots survive the whole round (average of the
// last 10 generations) or after `maxStage` generations. Then it keeps running on the final (far) map for `finalGens` generations.
// Usage: node run-curriculum.js '<cfg overrides as JSON>' <seed> [maxStage=400] [needFull=0.15] [finalGens=300] [maxFirst=1000]
// (the first stage, ponds touching the food, gets up to maxFirst generations because it has to learn the whole task)
const { Engine } = require('./engine');
const DEFAULTS = { layout: 'handcurr', pondShift: 0, lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false, genSpawn: 1 };
const mods = JSON.parse(process.argv[2] || '{}'), seed = +process.argv[3], maxStage = +process.argv[4] || 400, needFull = process.argv[5] === undefined ? 0.15 : +process.argv[5], finalGens = process.argv[6] === undefined ? 300 : +process.argv[6], maxFirst = +process.argv[7] || 1000;
const e = new Engine(Object.assign({}, DEFAULTS, mods), seed);
e.genInit(seed);
const f = (v, d) => (+v).toFixed(d === undefined ? 0 : d), avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
const shifts = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1];
let total = 0;
for (const t of shifts) {
  e.setMap('handcurr', t);
  const hist = []; let g = 0;
  while (g < (t === 0 ? maxFirst : maxStage)) {
    hist.push(e.genRound()); g++; total++;
    const last = hist.slice(-10);
    if (t < 1 && last.length === 10 && avg(last, 'fullShare') >= needFull) break;
  }
  const last = hist.slice(-10);
  console.log('stage pond shift', f(t, 2), '| gens used', g, '(total ' + total + ') | survived', f(avg(last, 'mean')), 'full', f(100 * avg(last, 'fullShare')) + '%', '| food', f(avg(last, 'food'), 1), 'water', f(avg(last, 'water'), 1), 'drank', f(100 * avg(last, 'drankShare')) + '%', 'pond', f(100 * avg(last, 'pondShare')) + '%');
}
const hist = [];
for (let g = 0; g < finalGens; g++) hist.push(e.genRound());
const last = hist.slice(-20);
console.log('FINAL seed', seed, '| gens', total + finalGens, '| FAR_SURVIVED', f(avg(last, 'mean')), '| FAR_FULL', f(100 * avg(last, 'fullShare')) + '%', '| FAR_FOOD', f(avg(last, 'food'), 1), '| FAR_WATER', f(avg(last, 'water'), 1), '| FAR_DRANK', f(100 * avg(last, 'drankShare')) + '%', '| FAR_POND', f(100 * avg(last, 'pondShare')) + '%');
