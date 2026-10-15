// Dump what the memory registers hold, for decoding (WASM engine, generational mode, far-corners map). Trains like run-gen.js, then replays `rounds` rounds of the
// trained population without breeding and writes one CSV row per living dot every `every` ticks: the four register values (the inputs 11 to 14 the brain sees) and
// candidate explanations: hydration, energy, ticks since the last drink and eat (age if never), oscillator sine and cosine, position, distance to the nearest pond / food centre.
// Usage: node run-memdump.js '<cfg overrides as JSON>' <seed> <gens> <out.csv> [rounds=3] [every=5]   Analysis: analyze-mem.py
const fs = require('fs');
const { Engine } = require('./engine');
const DEFAULTS = { layout: 'handfar', lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false, genSpawn: 1 };
const A = process.argv, mods = JSON.parse(A[2] || '{}'), seed = +A[3], gens = +A[4], out = A[5], R = +A[6] || 3, every = +A[7] || 5;
const e = new Engine(Object.assign({}, DEFAULTS, mods), seed);
e.genInit(seed);
for (let g = 0; g < gens; g++) e.genRound();
const GP = e.cfg.genP, L = e.cfg.genLen, v = e.views(), NIN = 37, maxE = e.cfg.maxE, maxW = e.cfg.maxW;
const INP = new Float32Array(e.mem, e.x.inp_ptr(), 2048 * NIN);
const PONDS = [[5.5, 5.5], [58.5, 58.5]], FOODS = [[48, 16], [16, 48]];
const dmin = (x, y, C) => Math.min(...C.map(c => Math.hypot(x - c[0], y - c[1])));
const rows = ['seed,round,tick,dot,m0,m1,m2,m3,hyd,energy,sinceDrink,sinceEat,sin,cos,x,y,dPond,dFood,everDrank'];
for (let r = 0; r < R; r++) {
  e.genBegin();
  const lastDrink = new Int32Array(GP).fill(-1), lastEat = new Int32Array(GP).fill(-1), pw = new Float64Array(GP), pf = new Float64Array(GP);
  for (let t = 0; t < L; t++) {
    const n = e.genTick(t);
    for (let i = 0; i < n; i++) {
      const s = v.ord[i];
      if (v.gwater[s] > pw[s]) { lastDrink[s] = t; pw[s] = v.gwater[s]; }
      if (v.gfood[s] > pf[s]) { lastEat[s] = t; pf[s] = v.gfood[s]; }
      if (t % every !== 0) continue;
      const m = INP.subarray(s * NIN + 11, s * NIN + 15), x = v.ax[s], y = v.ay[s];
      rows.push([seed, r, t, s, m[0].toFixed(4), m[1].toFixed(4), m[2].toFixed(4), m[3].toFixed(4), (v.aw[s] / maxW).toFixed(4), (v.ae[s] / maxE).toFixed(4),
        lastDrink[s] < 0 ? -1 : t - lastDrink[s], lastEat[s] < 0 ? -1 : t - lastEat[s], INP[s * NIN + 23].toFixed(4), INP[s * NIN + 24].toFixed(4), x.toFixed(2), y.toFixed(2),
        dmin(x, y, PONDS).toFixed(2), dmin(x, y, FOODS).toFixed(2), lastDrink[s] < 0 ? 0 : 1].join(','));
    }
    if (n === 0) break;
  }
  e.genEnd(false);
}
fs.writeFileSync(out, rows.join('\n') + '\n');
console.log('wrote', rows.length - 1, 'rows to', out);
