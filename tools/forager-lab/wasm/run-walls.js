// Walls curriculum (WASM engine, generational mode): train on the open far-corners map, then add the corner walls with a wide gap and narrow it.
// Usage: node run-walls.js '<cfg overrides as JSON>' <seed> [openGens=1000] [stageGens=300] [finalGens=500] [gaps=9,7,5,3]
// Each stage prints the mean of its last 20 generations; the last line is FINAL with the result at the narrowest gap after finalGens more generations.
// "wallType" in the overrides picks the wall layout (1 corner cups, the default; 2 long walls). At the end the population is evaluated for 10 rounds
// without breeding as trained and, with wallSense on, again with the wall inputs switched off (held at 0): ABL_ lines.
// Put "wallSense":1 in the overrides to give the dots the wall inputs from the start (they read 0 while there are no walls).
const { Engine } = require('./engine');
const DEFAULTS = { layout: 'handfar', lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false, genSpawn: 1 };
const mods = JSON.parse(process.argv[2] || '{}'), seed = +process.argv[3], openGens = +process.argv[4] || 1000, stageGens = +process.argv[5] || 300, finalGens = process.argv[6] === undefined ? 500 : +process.argv[6];
const gaps = (process.argv[7] || '9,7,5,3').split(',').map(Number);
const e = new Engine(Object.assign({}, DEFAULTS, mods, { walls: 0 }), seed);
e.genInit(seed);
// "gateWalls":1 holds the first-layer weights of the three wall inputs at 0 during the open-map stage (zeroed in every genome before every round, so mutation
// cannot move them), so they carry no drift when the walls arrive; from the first walled stage on they evolve freely.
const x = e.x, NW = x.genome_stride(), HP = x.layout_info(0), NACT = x.layout_info(4), ACT = new Int32Array(e.mem, x.act_ptr(), 40);
function zeroWallWeights() {
  const G = new Float32Array(e.mem, x.genome_ptr(), 2048 * NW); let k0 = -1;
  for (let k = 0; k < NACT; k++) if (ACT[k] === 34) k0 = k;
  if (k0 < 0) throw new Error('gateWalls needs wallSense on');
  for (let s = 0; s < e.cfg.genP; s++) for (let j = 0; j < 3; j++) for (let c = 0; c < HP; c++) G[s * NW + (k0 + j) * HP + c] = 0;
}
const f = (v, d) => (+v).toFixed(d === undefined ? 0 : d), avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
let gate = !!mods.gateWalls;
function run(label, n) {
  const hist = []; for (let g = 0; g < n; g++) { if (gate) zeroWallWeights(); hist.push(e.genRound()); }
  const last = hist.slice(-20);
  console.log(label, '| survived', f(avg(last, 'mean')), 'full', f(100 * avg(last, 'fullShare')) + '%', 'drank', f(100 * avg(last, 'drankShare')) + '%', 'pond', f(100 * avg(last, 'pondShare')) + '%');
  return last;
}
run('open map', openGens);
gate = false;
for (const gap of gaps) { e.setMap('handfar', 0, undefined, undefined, undefined, undefined, mods.wallType || 1, gap); run('walls gap ' + gap + ' (' + stageGens + ' gens)', stageGens); }
const last = run('final, gap ' + gaps[gaps.length - 1] + ' (' + finalGens + ' more gens)', finalGens);
let abl = '';
if (mods.wallSense) {
  const ev = () => { const r = []; for (let i = 0; i < 10; i++) r.push(e.genRound(false)); return r; };
  const on = ev(); e.setCfg('wallSense', 0); const off = ev(); e.setCfg('wallSense', 1);
  abl = ' | ABL_ON ' + f(avg(on, 'mean')) + ' ' + f(100 * avg(on, 'fullShare')) + '% | ABL_OFF ' + f(avg(off, 'mean')) + ' ' + f(100 * avg(off, 'fullShare')) + '%';
}
console.log('FINAL seed', seed, '| SURVIVED', f(avg(last, 'mean')), '| FULL', f(100 * avg(last, 'fullShare')) + '%', '| DRANK', f(100 * avg(last, 'drankShare')) + '%' + abl);
