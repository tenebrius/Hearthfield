// What do dots trained without cups do on cup maps? (WASM engine) Trains as setup N of step 4 (random-pond curriculum, K = 3, then the real task without walls for `realGens`),
// then replays `rounds` held-out cup maps (map seeds 1000000 and up, gap `gap`) without breeding and logs, per dot: did it leave the food, reach the ring, get inside, drink, and how it died.
// Also logged: the side of the ring each dot first reached and whether that side is the open one (is getting in luck of the approach side?), how many dots that got in ever left
// again, and at the end an ablation of memory (registers read 0) on cup maps and open maps with the same trained dots.
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
const acc = { arrOpen: 0, arrOpenIn: 0, arrClosed: 0, arrClosedIn: 0, gotIn: 0, leftAgain: 0, timeInside: [], drinkSurvived: 0, drinkDiedInside: 0, drinkDiedOutside: 0, nonDrinkInsideAtEnd: 0, drinkDeathTicks: [], dots: 0, leftFood: 0, reachedRing: 0, inside: 0, drank: 0, drankInside: 0, died: 0, hunger: 0, thirst: 0, deathTicks: [], failDeathTicks: [], ringSide: { openFacing: 0 } };
let survived = 0;
for (let r = 0; r < R; r++) {
  e.setMap('randpond', 0, 1000000 + r, pn, pm, 0, 5, gap, 0, 14);
  const kinds = new Uint8Array(kindArr);
  // ponds from the map: find 7x7 blocks of kind 3 via their bounding boxes (pondSep 16 keeps them apart)
  const ponds = []; const seen = new Uint8Array(W * W);
  for (let i = 0; i < W * W; i++) if (kinds[i] === 3 && !seen[i]) { let x0 = i % W, y0 = (i / W) | 0; for (let y = y0; y < y0 + 7; y++) for (let x = x0; x < x0 + 7; x++) seen[y * W + x] = 1; ponds.push([x0, y0]); }
  const inRing = (x, y) => ponds.some(p => x >= p[0] - 3 && x <= p[0] + 10 && y >= p[1] - 3 && y <= p[1] + 10);   // within the ring's 14 x 14 outline
  const nearRing = (x, y) => ponds.some(p => x >= p[0] - 6 && x <= p[0] + 13 && y >= p[1] - 6 && y <= p[1] + 13);   // within 3 tiles outside the ring
  const kk = (x, y) => (x < 0 || y < 0 || x >= W || y >= W) ? 4 : kinds[y * W + x];
  const openSide = ponds.map(p => { const mids = [[p[0] - 3, p[1] + 3], [p[0] + 9, p[1] + 3], [p[1] >= 0 ? p[0] + 3 : 0, p[1] - 3], [p[0] + 3, p[1] + 9]]; const o = mids.findIndex(m => kk(m[0], m[1]) !== 4); return o; });   // 0 west, 1 east, 2 north, 3 south; -1 if none
  const sideOf = (x, y) => { let best = -1, bd = 1e9; ponds.forEach((p, i) => { const d = Math.hypot(x - (p[0] + 3.5), y - (p[1] + 3.5)); if (d < bd) { bd = d; best = i; } }); const p = ponds[best], dx = x - (p[0] + 3.5), dy = y - (p[1] + 3.5); return { pond: best, side: Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 0 : 1) : (dy < 0 ? 2 : 3) }; };
  const inside = (x, y) => ponds.some(p => x >= p[0] - 2 && x <= p[0] + 8 && y >= p[1] - 2 && y <= p[1] + 8);   // inside the ring
  const left = new Uint8Array(GP), reach = new Uint8Array(GP), ins = new Uint8Array(GP), lastT = new Int32Array(GP).fill(-1), lastE = new Float64Array(GP), lastW = new Float64Array(GP), lastX = new Float64Array(GP), lastY = new Float64Array(GP), arrived = new Int8Array(GP).fill(-1), entered = new Uint8Array(GP), wasIn = new Uint8Array(GP), exited = new Uint8Array(GP), inTicks = new Int32Array(GP);
  e.genBegin();
  for (let t = 0; t < L; t++) {
    const n = e.genTick(t);
    for (let i = 0; i < n; i++) { const s = v.ord[i], x = v.ax[s], y = v.ay[s]; if (kinds[Math.min(W - 1, y | 0) * W + Math.min(W - 1, x | 0)] !== 1 && Math.hypot(x - 32, y - 32) > 14) left[s] = 1; if (nearRing(x, y)) { reach[s] = 1; if (arrived[s] < 0) { const sd = sideOf(x, y); arrived[s] = sd.side === openSide[sd.pond] ? 1 : 0; } } const nin = inside(x, y) ? 1 : 0; if (nin) { ins[s] = 1; entered[s] = 1; inTicks[s]++; } if (wasIn[s] && !nin) exited[s] = 1; wasIn[s] = nin; lastT[s] = t; lastE[s] = v.ae[s]; lastW[s] = v.aw[s]; lastX[s] = x; lastY[s] = y; }
    if (n === 0) break;
  }
  const st = e.genEnd(false); survived += st.mean / R;
  for (let s = 0; s < GP; s++) {
    acc.dots++; const dr = v.gwater[s] > 0;
    if (arrived[s] === 1) { acc.arrOpen++; if (entered[s]) acc.arrOpenIn++; } else if (arrived[s] === 0) { acc.arrClosed++; if (entered[s]) acc.arrClosedIn++; }
    if (entered[s]) { acc.gotIn++; if (exited[s]) acc.leftAgain++; acc.timeInside.push(inTicks[s]); }
    if (left[s]) acc.leftFood++; if (reach[s]) acc.reachedRing++; if (ins[s]) acc.inside++; if (dr) acc.drank++; if (dr && ins[s]) acc.drankInside++;
    if (dr) { if (lastT[s] >= L - 1) acc.drinkSurvived++; else { if (inside(lastX[s], lastY[s])) acc.drinkDiedInside++; else acc.drinkDiedOutside++; acc.drinkDeathTicks.push(lastT[s]); } }
    if (lastT[s] >= 0 && lastT[s] < L - 1) { acc.died++; (lastW[s] <= lastE[s] ? acc.thirst++ : acc.hunger++); acc.deathTicks.push(lastT[s]); if (!dr) acc.failDeathTicks.push(lastT[s]); }
  }
}
const q = (a, p) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
const sh = k => Math.round(1000 * acc[k] / acc.dots) / 10;
// ablation of memory with the same trained dots: cup maps and open maps, with the registers as trained and reading 0
const evalMaps = (w) => { let t = 0, full = 0, drank = 0; for (let r = 0; r < R; r++) { e.setMap('randpond', 0, 1000000 + r, pn, pm, 0, w ? 5 : 0, gap, 0, 14); const st = e.genRound(false); t += st.mean / R; full += st.fullShare / R; drank += st.drankShare / R; } return [Math.round(t), Math.round(100 * full), Math.round(100 * drank)]; };
const abl = { cupsOn: evalMaps(true), openOn: evalMaps(false) }; e.setCfg('memory', 0); abl.cupsMemoryOff = evalMaps(true); abl.openMemoryOff = evalMaps(false); e.setCfg('memory', 1);
const pc = (a, b) => b ? Math.round(1000 * a / b) / 10 : null;
console.log('CUPTRACE ' + JSON.stringify({ seed, gap, entryBySide: { arrivedAtOpenSide: acc.arrOpen, enteredShare: pc(acc.arrOpenIn, acc.arrOpen), arrivedAtClosedSide: acc.arrClosed, enteredShareClosed: pc(acc.arrClosedIn, acc.arrClosed) }, gotIn: acc.gotIn, leftAgainShare: pc(acc.leftAgain, acc.gotIn), ticksInsideMedian: q(acc.timeInside, 0.5), memoryAblation_ticks_full_drank: abl, survived: Math.round(survived), dots: acc.dots, leftFood: sh('leftFood'), reachedRing: sh('reachedRing'), insideRing: sh('inside'), drank: sh('drank'), drankAndInside: sh('drankInside'),
  died: sh('died'), diedHunger: sh('hunger'), diedThirst: sh('thirst'), ofDrinkers: { survivedRound: acc.drinkSurvived, diedInsideRing: acc.drinkDiedInside, diedOutsideRing: acc.drinkDiedOutside, total: acc.drank, deathTickMedian: q(acc.drinkDeathTicks, 0.5) }, deathTick: { p10: q(acc.deathTicks, 0.1), median: q(acc.deathTicks, 0.5), p90: q(acc.deathTicks, 0.9) }, deathTickOfNonDrinkers: { p10: q(acc.failDeathTicks, 0.1), median: q(acc.failDeathTicks, 0.5), p90: q(acc.failDeathTicks, 0.9) } }));
