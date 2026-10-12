// Same command line and output as ../run.js, on the WebAssembly engine (much faster).
// Usage: node run-wasm.js '<cfg overrides as JSON>' <seed> <total ticks> <report every N ticks>
// Layouts: circles, handmade, handfar. Not supported: mixed/split maps, food relocation, archive newcomers (use ../run.js).
const { Engine } = require('./engine');
const mods = JSON.parse(process.argv[2] || '{}'), seed = +process.argv[3], total = +process.argv[4], every = +process.argv[5];
const e = new Engine(mods, seed);
let max = 0, maxTick = 0, acc = 0, cnt = 0, tail = 0, tailN = 0;
for (let k = 1; k <= total; k++) {
  e.step(1); const n = e.pop;
  if (n > max) { max = n; maxTick = k; }
  if (k > total / 2) { tail += n; tailN++; }
  if (k % every > every - 1000 || k % every === 0) { acc += n; cnt++; }
  if (k % every === 0) { console.log('seed', seed, 'tick', k / 1000 + 'k', '| population (avg of last 1000 ticks)', Math.round(acc / cnt), '| max so far', max, '(at tick ' + maxTick + ')'); acc = 0; cnt = 0; }
}
const o = e.occupancy();
console.log('FINAL seed', seed, '| max population', max, 'reached at tick', maxTick, '| births', e.stats().born, '| MEAN_2ND_HALF', Math.round(tail / (tailN || 1)), '| DOTS_NEAR_FOOD_CIRCLES', o[0] + ',' + o[1]);
