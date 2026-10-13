// Objective curriculum (WASM engine, generational mode): phase A rewards only drinking (water tiles) until at least `pondGoal` of the dots
// stand on a pond (average of the last 10 generations) or `maxA` generations pass; phase B then switches the score to survival (or whatever
// the cfg overrides say) for `gensB` generations. Same map throughout (far ponds, centre start).
// Usage: node run-objective.js '<cfg overrides as JSON>' <seed> [maxA=300] [pondGoal=0.8] [gensB=700]
const { Engine } = require('./engine');
const DEFAULTS = { layout: 'handfar', lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false, genSpawn: 1 };
const mods = JSON.parse(process.argv[2] || '{}'), seed = +process.argv[3], maxA = +process.argv[4] || 300, goal = process.argv[5] === undefined ? 0.8 : +process.argv[5], gensB = +process.argv[6] || 700;
const cfg = Object.assign({}, DEFAULTS, mods);
const e = new Engine(Object.assign({}, cfg, { genWSurv: 0, genWFood: 0, genWWater: 1, genScoreMode: 0 }), seed);
e.genInit(seed);
const f = (v, d) => (+v).toFixed(d === undefined ? 0 : d), avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
let hist = [], g = 0;
while (g < maxA) { hist.push(e.genRound()); g++; const last = hist.slice(-10); if (last.length === 10 && avg(last, 'pondShare') >= goal) break; }
let last = hist.slice(-10);
console.log('phase A (water only):', g, 'gens | survived', f(avg(last, 'mean')), 'food', f(avg(last, 'food'), 1), 'water', f(avg(last, 'water'), 1), 'drank', f(100 * avg(last, 'drankShare')) + '%', 'pond', f(100 * avg(last, 'pondShare')) + '%');
for (const k of ['genWSurv', 'genWFood', 'genWWater', 'genScoreMode']) e.setCfg(k, k in cfg ? cfg[k] : (k === 'genWSurv' ? 1 : 0));
hist = [];
for (let i = 0; i < gensB; i++) hist.push(e.genRound());
last = hist.slice(-20);
console.log('FINAL seed', seed, '| PHASE_A_GENS', g, '| B_SURVIVED', f(avg(last, 'mean')), '| B_FULL', f(100 * avg(last, 'fullShare')) + '%', '| B_FOOD', f(avg(last, 'food'), 1), '| B_WATER', f(avg(last, 'water'), 1), '| B_DRANK', f(100 * avg(last, 'drankShare')) + '%', '| B_POND', f(100 * avg(last, 'pondShare')) + '%');
