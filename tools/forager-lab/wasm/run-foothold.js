// Foothold traces (WASM engine, generational mode). Reproduces a run-randwalls.js "barsLate" trajectory without bars (the engine is deterministic: same cfg, seed,
// map seeds and stage rules give the same genomes), stops at the end of a chosen stage, then replays `rounds` held-out random-pond layouts (map seeds 1000000 and up)
// without breeding and prints one "FOOTHOLD {json}" line per snapshot with what the dots did.
// Stages as run-randwalls.js with barsLate and no bars: ponds 12..16, 12..22, 12..28, 12..36 (each ends early when 15% survive the round, mean of 10 generations),
// then the real task (ponds at least 30 away) for exactly maxStage generations. Snapshots: "s4" = end of the 12..36 stage, "real" = end of the real-task stage.
// Usage: node run-foothold.js '<cfg overrides as JSON>' <seed> [maxStage=400] [needFull=0.15] [maxFirst=1000] [rounds=10]
const { Engine, W } = require('./engine');
const DEFAULTS = { layout: 'handfar', lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false, genSpawn: 1, wallN: 0, wallLen: 14 };
const mods = JSON.parse(process.argv[2] || '{}'), seed = +process.argv[3], maxStage = +process.argv[4] || 400, needFull = process.argv[5] === undefined ? 0.15 : +process.argv[5], maxFirst = +process.argv[6] || 1000, R = +process.argv[7] || 10;
const cfg = Object.assign({}, DEFAULTS, mods), pn = cfg.pondN, pm = cfg.pondMin || 30;
const e = new Engine(Object.assign({}, cfg, { layout: 'randpond', mapSeed: 1, walls: 0 }), seed);
e.genInit(seed);
const avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
const setMap = (seedv, lo, hi) => e.setMap('randpond', 0, seedv, pn, lo, hi, 0, 0, 0, cfg.wallLen);
const q = (a, p) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
const r1 = v => v == null ? null : Math.round(v * 10) / 10;
const FOODC = [[48, 16], [16, 48]];   // food circle centres (engine.js CIRCLES)
function replay(label, gensUsed, stageStats) {
  const GP = e.cfg.genP, L = e.cfg.genLen, v = e.views(), kindArr = new Uint8Array(e.mem, e.x.kind_ptr(), W * W), cdist = (x, y) => Math.min(...FOODC.map(c => Math.hypot(x - c[0], y - c[1])));
  const acc = { rounds: R, dots: 0, drank: 0, ate: 0, firstDrink: [], deathTick: [], deathThirst: 0, deathHunger: 0, survivedWhole: 0, farCentre: [], farFood: [], leftFood: 0, reachedPond: 0, died: 0, deadFarFood: [], deadAtPond: 0 };
  const grid = {};   // tick -> [sum alive, sum at food, sum at pond, sum elsewhere] over rounds, as shares of all dots
  let survived = 0;
  for (let r = 0; r < R; r++) {
    setMap(1000000 + r, pm, 0);
    const kinds = new Uint8Array(kindArr);   // copy of this round's map
    e.genBegin();
    const firstDrink = new Int32Array(GP).fill(-1), firstEat = new Int32Array(GP).fill(-1), lastT = new Int32Array(GP).fill(-1), lastE = new Float64Array(GP), lastW = new Float64Array(GP);
    const lastX = new Float64Array(GP), lastY = new Float64Array(GP), farC = new Float64Array(GP), farF = new Float64Array(GP), atPond = new Uint8Array(GP);
    for (let t = 0; t < L; t++) {
      const n = e.genTick(t);
      for (let s = 0; s < GP; s++) { if (firstDrink[s] < 0 && v.gwater[s] > 0) firstDrink[s] = t; if (firstEat[s] < 0 && v.gfood[s] > 0) firstEat[s] = t; }
      let nf = 0, np = 0;
      for (let i = 0; i < n; i++) {
        const s = v.ord[i], x = v.ax[s], y = v.ay[s], k = kinds[Math.min(W - 1, Math.floor(y)) * W + Math.min(W - 1, Math.floor(x))];
        if (k === 1) nf++; else if (k === 3) { np++; atPond[s] = 1; }
        const dc = Math.hypot(x - 32, y - 32), df = cdist(x, y); if (dc > farC[s]) farC[s] = dc; if (df > farF[s]) farF[s] = df;
        lastT[s] = t; lastE[s] = v.ae[s]; lastW[s] = v.aw[s]; lastX[s] = x; lastY[s] = y;
      }
      if (t % 50 === 0 || t === L - 1) { const g = grid[t] || (grid[t] = [0, 0, 0, 0]); g[0] += n / GP; g[1] += nf / GP; g[2] += np / GP; g[3] += (n - nf - np) / GP; }
      if (n === 0) break;
    }
    const st = e.genEnd(false); survived += st.mean; acc.survivedWhole += st.fullShare;
    for (let s = 0; s < GP; s++) {
      acc.dots++; if (firstDrink[s] >= 0) { acc.drank++; acc.firstDrink.push(firstDrink[s]); } if (firstEat[s] >= 0) acc.ate++;
      acc.farCentre.push(farC[s]); acc.farFood.push(farF[s]); if (farF[s] > 30) acc.leftFood++; if (atPond[s]) acc.reachedPond++;
      if (lastT[s] >= 0 && lastT[s] < L - 1) {   // died before the end of the round
        acc.died++; acc.deathTick.push(lastT[s]); if (lastW[s] <= lastE[s]) acc.deathThirst++; else acc.deathHunger++; acc.deadFarFood.push(cdist(lastX[s], lastY[s]));
      }
    }
  }
  const D = acc.dots, timeline = Object.keys(grid).map(Number).sort((a, b) => a - b).map(t => ({ t, alive: r1(100 * grid[t][0] / R), food: r1(100 * grid[t][1] / R), pond: r1(100 * grid[t][2] / R), elsewhere: r1(100 * grid[t][3] / R) }));
  const out = { label, seed, gens: gensUsed, stage: stageStats, replay: { survived: r1(survived / R), full: r1(100 * acc.survivedWhole / R), drank: r1(100 * acc.drank / D), ate: r1(100 * acc.ate / D), everOnPond: r1(100 * acc.reachedPond / D),
    firstDrinkTick: { p25: q(acc.firstDrink, 0.25), median: q(acc.firstDrink, 0.5), p75: q(acc.firstDrink, 0.75) },
    farthestFromCentre: { p10: r1(q(acc.farCentre, 0.1)), median: r1(q(acc.farCentre, 0.5)), p90: r1(q(acc.farCentre, 0.9)) }, farthestFromFood: { p10: r1(q(acc.farFood, 0.1)), median: r1(q(acc.farFood, 0.5)), p90: r1(q(acc.farFood, 0.9)) },
    farFoodOver30: r1(100 * acc.leftFood / D), died: r1(100 * acc.died / D), deathThirst: acc.deathThirst, deathHunger: acc.deathHunger,
    deathTick: { p10: q(acc.deathTick, 0.1), median: q(acc.deathTick, 0.5), p90: q(acc.deathTick, 0.9) }, deadDistFromFood: { median: r1(q(acc.deadFarFood, 0.5)), p90: r1(q(acc.deadFarFood, 0.9)) }, timeline } };
  console.log('FOOTHOLD ' + JSON.stringify(out));
}
const stages = [[12, 16], [12, 22], [12, 28], [12, 36], [pm, 0]];
let total = 0, mapSeed = 1;
for (let si = 0; si < stages.length; si++) {
  const [lo, hi] = stages[si], hist = []; let g = 0;
  while (g < (si === 0 ? maxFirst : maxStage)) {
    setMap(mapSeed++, lo, hi);
    hist.push(e.genRound()); g++; total++;
    const last = hist.slice(-10);
    if (si < stages.length - 1 && last.length === 10 && avg(last, 'fullShare') >= needFull) break;
  }
  const last = hist.slice(-10), ss = { ponds: lo + '..' + (hi || 'any'), gens: g, survived: Math.round(avg(last, 'mean')), full: r1(100 * avg(last, 'fullShare')), drank: r1(100 * avg(last, 'drankShare')) };
  if (si === 3) replay('s4', total, ss);
  if (si === 4) replay('real', total, ss);
}
