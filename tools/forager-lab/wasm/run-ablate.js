// Ablation of an input feature (WASM engine, generational mode): train with the feature on, then evaluate the SAME trained population for
// `evalRounds` rounds without breeding, once as trained and once with the feature switched off (its inputs stuck at 0).
// If survival does not drop when the feature is switched off, the dots are not using it.
// Usage: node run-ablate.js '<cfg overrides as JSON>' <seed> <gens> <feature[,feature...]: age|oscillator|latch|tumble|ageTherm> [evalRounds=10]
// With several features each is switched off on its own (the others stay on).
const { Engine } = require('./engine');
const DEFAULTS = { layout: 'handfar', lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false, genSpawn: 1 };
const mods = JSON.parse(process.argv[2] || '{}'), seed = +process.argv[3], gens = +process.argv[4], features = (process.argv[5] || '').split(','), evalRounds = +process.argv[6] || 10;
const e = new Engine(Object.assign({}, DEFAULTS, mods), seed);
e.genInit(seed);
for (let g = 0; g < gens; g++) e.genRound();
const f = (v, d) => (+v).toFixed(d === undefined ? 0 : d);
function evaluate() { const r = []; for (let i = 0; i < evalRounds; i++) r.push(e.genRound(false)); const a = k => r.reduce((s, x) => s + x[k], 0) / r.length; return { surv: a('mean'), full: a('fullShare'), drank: a('drankShare'), water: a('water') }; }
const on = evaluate();
let line = 'FINAL seed ' + seed + ' | ON_SURV ' + f(on.surv) + ' ON_FULL ' + f(100 * on.full) + ' ON_DRANK ' + f(100 * on.drank);
for (const ft of features) {
  e.setCfg(ft, 0);         // the brain keeps its weights; the feature's inputs are no longer written, so they stay 0
  const off = evaluate();
  e.setCfg(ft, 1);
  line += ' | OFF_' + ft + ' SURV ' + f(off.surv) + ' FULL ' + f(100 * off.full) + ' DRANK ' + f(100 * off.drank);
}
console.log(line);
