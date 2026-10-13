// Ablation of an input feature (WASM engine, generational mode): train with the feature on, then evaluate the SAME trained population for
// `evalRounds` rounds without breeding, once as trained and once with the feature switched off (its inputs stuck at 0).
// If survival does not drop when the feature is switched off, the dots are not using it.
// Usage: node run-ablate.js '<cfg overrides as JSON>' <seed> <gens> <feature: age|oscillator|latch|tumble> [evalRounds=10]
const { Engine } = require('./engine');
const DEFAULTS = { layout: 'handfar', lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false, genSpawn: 1 };
const mods = JSON.parse(process.argv[2] || '{}'), seed = +process.argv[3], gens = +process.argv[4], feature = process.argv[5], evalRounds = +process.argv[6] || 10;
const e = new Engine(Object.assign({}, DEFAULTS, mods), seed);
e.genInit(seed);
for (let g = 0; g < gens; g++) e.genRound();
const f = (v, d) => (+v).toFixed(d === undefined ? 0 : d);
function evaluate() { const r = []; for (let i = 0; i < evalRounds; i++) r.push(e.genRound(false)); const a = k => r.reduce((s, x) => s + x[k], 0) / r.length; return { surv: a('mean'), full: a('fullShare'), drank: a('drankShare'), water: a('water') }; }
const on = evaluate();
e.setCfg(feature, 0);          // the brain keeps its weights; the feature's inputs are no longer written, so they stay 0
const off = evaluate();
console.log('FINAL seed', seed, '| ON_SURV', f(on.surv), 'ON_FULL', f(100 * on.full), 'ON_DRANK', f(100 * on.drank), '| OFF_SURV', f(off.surv), 'OFF_FULL', f(100 * off.full), 'OFF_DRANK', f(100 * off.drank));
