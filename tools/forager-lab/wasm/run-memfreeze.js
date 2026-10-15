// Do trained dots use memory as memory, or as constants? Trains like run-gen.js (generational mode, fixed far-corners map by default), then evaluates the SAME population
// for `evalRounds` rounds without breeding: as trained, with the registers reading 0 (memory off), and with the registers frozen from a given age on (memFreeze: the registers
// keep updating until that age, then hold their value for the rest of the round). If freezing at a young age costs little but zeroing costs a lot, the registers act as constants
// (a learned offset), not as a store of what happened. NOISE: the registers are replaced by fresh random values every tick (memNoise), which tells whether they matter as a source of randomness. Usage: node run-memfreeze.js '<cfg overrides as JSON>' <seed> <gens> [freezeAges=25,100,400] [evalRounds=10]
const { Engine } = require('./engine');
const DEFAULTS = { layout: 'handfar', lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false, genSpawn: 1 };
const A = process.argv, mods = JSON.parse(A[2] || '{}'), seed = +A[3], gens = +A[4], ages = (A[5] || '25,100,400').split(',').map(Number), R = +A[6] || 10;
const e = new Engine(Object.assign({}, DEFAULTS, mods), seed);
e.genInit(seed);
for (let g = 0; g < gens; g++) e.genRound();
const f = v => Math.round(v);
const evaluate = () => { let t = 0, full = 0, drank = 0; for (let i = 0; i < R; i++) { const s = e.genRound(false); t += s.mean / R; full += s.fullShare / R; drank += s.drankShare / R; } return f(t) + ' ' + f(100 * full) + '% ' + f(100 * drank) + '%'; };
let line = 'FINAL seed ' + seed + ' | ON ' + evaluate();
for (const a of ages) { e.setCfg('memFreeze', a); line += ' | FREEZE' + a + ' ' + evaluate(); }
e.setCfg('memFreeze', 0); e.setCfg('memNoise', 1); line += ' | NOISE ' + evaluate(); e.setCfg('memNoise', 0);
e.setCfg('memory', 0); line += ' | ZERO ' + evaluate();
console.log(line);
