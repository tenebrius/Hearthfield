// Headless experiment runner. Build the harness first: python3 mkharness.py  (writes base.js)
// Usage: node run.js '<cfg overrides as JSON>' <seed> <total ticks> <report every N ticks>
// Example (two circles, thirst off, energy loss 1.0, 2 hidden layers):
//   node run.js '{"layout":"circles","lossW":0,"lossE":1,"layers":2}' 1 800000 50000
// Random-mover baseline: add "baseline":true
eval(require('fs').readFileSync(__dirname + '/base.js', 'utf8'));
const t = globalThis.__t, cfg0 = Object.assign({}, t.cfg);
const mods = JSON.parse(process.argv[2]); const seed = +process.argv[3]; const total = +process.argv[4]; const every = +process.argv[5];
Object.assign(t.cfg, cfg0, mods); t.makeWorld(seed);
let max = 0, maxTick = 0, acc = 0, cnt = 0;
for (let k = 1; k <= total; k++) {
  t.step(); const n = t.agents.length; if (n > max) { max = n; maxTick = k; }
  if (k % every > every - 1000 || k % every === 0) { acc += n; cnt++; }
  if (k % every === 0) { console.log('seed', seed, 'tick', k / 1000 + 'k', '| population (avg of last 1000 ticks)', Math.round(acc / cnt), '| max so far', max, '(at tick ' + maxTick + ')'); acc = 0; cnt = 0; }
}
console.log('FINAL seed', seed, '| max population', max, 'reached at tick', maxTick, '| births', t.born);
