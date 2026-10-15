// What do dots trained without cups do on cup maps? (WASM engine) Trains as setup N of step 4 (random-pond curriculum, K = 3, then the real task without walls for `realGens`),
// then replays `rounds` held-out cup maps (map seeds 1000000 and up, gap `gap`) without breeding and logs, per dot: did it leave the food, reach the ring, get inside, drink, and how it died.
// Usage: node run-cuptrace.js '<cfg overrides as JSON>' <seed> [K=3] [realGens=1000] [gap=3] [rounds=10]   (cfg: pondSep 16 expected)
const { Engine, W } = require('./engine');
const DEFAULTS = { layout: 'handfar', lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false, genSpawn: 1, pondSep: 16 };
const A = process.argv, mods = JSON.parse(A[2] || '{}'), seed = +A[3], K = +A[4] || 3, realGens = A[5] === undefined ? 1000 : +A[5], gap = A[6] === undefined ? 3 : +A[6], R = +A[7] || 10;
const cfg = Object.assign({}, DEFAULTS, mods), pn = cfg.pondN, pm = 30;
const e = new Engine(Object.assign({}, cfg, { layout: 'randpond', mapSeed: 1, walls: 0 }), seed);
e.genInit(seed);
const avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
let mapSeed = 1;
const gen = (lo, hi) => { const sets = []; for (let k = 0; k < K; k++) { const ms = mapSeed++; sets.push(() => e.setMap('randpond', 0, ms, pn, lo, hi, 0, 0, 0, 14)); } return e.genRoundMulti(sets); };
[[12, 16], [12, 22], [12, 28], [12, 36]].forEach(([lo, hi], i) => { const hist = []; for (let g = 0; g < (i === 0 ? 1000 : 400); g++) { hist.push(gen(lo, hi)); const l = hist.slice(-10); if (l.length === 10 && avg(l, 'fullShare') >= 0.15) break; } });
for (let g = 0; g < realGens; g++) gen(pm, 0);
const GP = e.cfg.genP, L = e.cfg.genLen, v = e.views(), kindArr = new Uint8Array(e.mem, e.x.kind_ptr(), W * W);
const acc = { drinkSurvived: 0, drinkDiedInside: 0, drinkDiedOutside: 0, nonDrinkInsideAtEnd: 0, drinkDeathTicks: [], dots: 0, leftFood: 0, reachedRing: 0, inside: 0, drank: 0, drankInside: 0, died: 0, hunger: 0, thirst: 0, deathTicks: [], failDeathTicks: [], ringSide: { openFacing: 0 } };
let survived = 0;
for (let r = 0; r < R; r++) {
  e.setMap('randpond', 0, 1000000 + r, pn, pm, 0, 5, gap, 0, 14);
  const kinds = new Uint8Array(kindArr);
  // ponds from the map: find 7x7 blocks of kind 3 via their bounding boxes (pondSep 16 keeps them apart)
  const ponds = []; const seen = new Uint8Array(W * W);
  for (let i = 0; i < W * W; i++) if (kinds[i] === 3 && !seen[i]) { let x0 = i % W, y0 = (i / W) | 0; for (let y = y0; y < y0 + 7; y++) for (let x = x0; x < x0 + 7; x++) seen[y * W + x] = 1; ponds.push([x0, y0]); }
  const inRing = (x, y) => ponds.some(p => x >= p[0] - 3 && x <= p[0] + 10 && y >= p[1] - 3 && y <= p[1] + 10);   // within the ring's 14 x 14 outline
  const nearRing = (x, y) => ponds.some(p => x >= p[0] - 6 && x <= p[0] + 13 && y >= p[1] - 6 && y <= p[1] + 13);   // within 3 tiles outside the ring
  const inside = (x, y) => ponds.some(p => x >= p[0] - 2 && x <= p[0] + 8 && y >= p[1] - 2 && y <= p[1] + 8);   // inside the ring
  const left = new Uint8Array(GP), reach = new Uint8Array(GP), ins = new Uint8Array(GP), lastT = new Int32Array(GP).fill(-1), lastE = new Float64Array(GP), lastW = new Float64Array(GP), lastX = new Float64Array(GP), lastY = new Float64Array(GP);
  e.genBegin();
  for (let t = 0; t < L; t++) {
    const n = e.genTick(t);
    for (let i = 0; i < n; i++) { const s = v.ord[i], x = v.ax[s], y = v.ay[s]; if (kinds[Math.min(W - 1, y | 0) * W + Math.min(W - 1, x | 0)] !== 1 && Math.hypot(x - 32, y - 32) > 14) left[s] = 1; if (nearRing(x, y)) reach[s] = 1; if (inside(x, y)) ins[s] = 1; lastT[s] = t; lastE[s] = v.ae[s]; lastW[s] = v.aw[s]; lastX[s] = x; lastY[s] = y; }
    if (n === 0) break;
  }
  const st = e.genEnd(false); survived += st.mean / R;
  for (let s = 0; s < GP; s++) {
    acc.dots++; const dr = v.gwater[s] > 0;
    if (left[s]) acc.leftFood++; if (reach[s]) acc.reachedRing++; if (ins[s]) acc.inside++; if (dr) acc.drank++; if (dr && ins[s]) acc.drankInside++;
    if (dr) { if (lastT[s] >= L - 1) acc.drinkSurvived++; else { if (inside(lastX[s], lastY[s])) acc.drinkDiedInside++; else acc.drinkDiedOutside++; acc.drinkDeathTicks.push(lastT[s]); } }
    if (lastT[s] >= 0 && lastT[s] < L - 1) { acc.died++; (lastW[s] <= lastE[s] ? acc.thirst++ : acc.hunger++); acc.deathTicks.push(lastT[s]); if (!dr) acc.failDeathTicks.push(lastT[s]); }
  }
}
const q = (a, p) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
const sh = k => Math.round(1000 * acc[k] / acc.dots) / 10;
console.log('CUPTRACE ' + JSON.stringify({ seed, gap, survived: Math.round(survived), dots: acc.dots, leftFood: sh('leftFood'), reachedRing: sh('reachedRing'), insideRing: sh('inside'), drank: sh('drank'), drankAndInside: sh('drankInside'),
  died: sh('died'), diedHunger: sh('hunger'), diedThirst: sh('thirst'), ofDrinkers: { survivedRound: acc.drinkSurvived, diedInsideRing: acc.drinkDiedInside, diedOutsideRing: acc.drinkDiedOutside, total: acc.drank, deathTickMedian: q(acc.drinkDeathTicks, 0.5) }, deathTick: { p10: q(acc.deathTicks, 0.1), median: q(acc.deathTicks, 0.5), p90: q(acc.deathTicks, 0.9) }, deathTickOfNonDrinkers: { p10: q(acc.failDeathTicks, 0.1), median: q(acc.failDeathTicks, 0.5), p90: q(acc.failDeathTicks, 0.9) } }));
