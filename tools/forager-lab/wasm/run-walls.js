// Walls curriculum (WASM engine, generational mode): train on the open far-corners map, then add the corner walls with a wide gap and narrow it.
// Usage: node run-walls.js '<cfg overrides as JSON>' <seed> [openGens=1000] [stageGens=300] [finalGens=500] [gaps=9,7,5,3]
// Each stage prints the mean of its last 20 generations; the last line is FINAL with the result at the narrowest gap after finalGens more generations.
// Put "wallSense":1 in the overrides to give the dots the wall inputs from the start (they read 0 while there are no walls).
const { Engine } = require('./engine');
const DEFAULTS = { layout: 'handfar', lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false, genSpawn: 1 };
const mods = JSON.parse(process.argv[2] || '{}'), seed = +process.argv[3], openGens = +process.argv[4] || 1000, stageGens = +process.argv[5] || 300, finalGens = process.argv[6] === undefined ? 500 : +process.argv[6];
const gaps = (process.argv[7] || '9,7,5,3').split(',').map(Number);
const e = new Engine(Object.assign({}, DEFAULTS, mods, { walls: 0 }), seed);
e.genInit(seed);
const f = (v, d) => (+v).toFixed(d === undefined ? 0 : d), avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
function run(label, n) {
  const hist = []; for (let g = 0; g < n; g++) hist.push(e.genRound());
  const last = hist.slice(-20);
  console.log(label, '| survived', f(avg(last, 'mean')), 'full', f(100 * avg(last, 'fullShare')) + '%', 'drank', f(100 * avg(last, 'drankShare')) + '%', 'pond', f(100 * avg(last, 'pondShare')) + '%');
  return last;
}
run('open map', openGens);
for (const gap of gaps) { e.setMap('handfar', 0, undefined, undefined, undefined, undefined, 1, gap); run('walls gap ' + gap + ' (' + stageGens + ' gens)', stageGens); }
const last = run('final, gap ' + gaps[gaps.length - 1] + ' (' + finalGens + ' more gens)', finalGens);
console.log('FINAL seed', seed, '| SURVIVED', f(avg(last, 'mean')), '| FULL', f(100 * avg(last, 'fullShare')) + '%', '| DRANK', f(100 * avg(last, 'drankShare')) + '%');
