// Step 2 of docs/forager-lab-next-plan.md: random ponds, every dot scored on K layouts per generation (mean score), bars added only after drinking has started.
// Stages (fresh random layouts every round, as run-rand-curriculum.js): ponds within 16, 22, 28, 36 tiles of the nearer food centre (each ends when `needFull` of the dots
// survive the round, mean of the last 10 generations, or after maxStage generations; the first after maxFirst), then the real task (ponds at least 30 away, no bars)
// until drinking has started: at least `drinkStart` of the dots drank (mean of the last 10 generations), or `drinkCap` generations. With "wallN" above 0, bars then
// arrive one at a time on the real task (1, 2, then wallN; each stage ends at needFull or maxStage). Then `finalGens` more generations on the real task (with wallN bars).
// Cups (step 4): with "cupGaps":[9,5,3] the bars stages are replaced by cup stages: every pond is enclosed by a wall ring with an opening of that width on a random side
// (walls = 5; set "pondSep":16 so that rings do not touch), each stage until needFull or maxStage generations, then the final stage with the last gap. "wallSense":1 adds the
// wall inputs and "gateWalls":1 holds their first-layer weights at 0 until the first walled stage. With "cupGaps":[] and "testCups":3 the dots never see a ring in training.
// "cupFacings":[1,1,1,0.75,0.5,0.25] (one per cup stage; use with the same number of cupGaps, e.g. [3,3,3,3,3,3]): the opening faces the food with that probability in the stage; the final stage and the tests use random openings (TEST_FACING = cups that always face the food).
// "cupMixes":[1,2,3] (one per cup stage, with K = 3): how many of the K maps each dot plays in a generation are cups, the rest are open maps (mixed training: drinking keeps paying on the open maps). The stage lines then also show the cup maps alone.
// "secureDrink":0.8 (step 4): after drinking has started, keep training the real task without walls until at least that share of the dots drank (mean of the last 10 generations),
// at most "secureCap" generations (default 1500), before any bars or cups arrive (a fragile foothold, 26% drinking, was wiped out by cups in 32 of 32 runs). With "cupStageCap"
// (default maxStage) and "cupExit" (a drank share; a cup stage ends early when the mean of the last 10 generations reaches it) the cup stages can be shortened.
// Tests (no breeding, one round per map): 20 held-out layouts (map seeds 1000000 and up) with `testBars` bars (default 3) or cups of gap `testCups` (default: the last cup gap, or 3), and without walls; with wall sense on, also with the wall inputs at 0.
// "noCurriculum":1 skips the pond-distance stages and the 'until drinking starts' stage: training begins on the real task (cup stages, if any, straight away; use with "cupGaps":[3],"cupStageCap":1 for cups only).
// Usage: node run-multi.js '<cfg overrides as JSON>' <seed> [K=1] [finalGens=500] [maxStage=400] [needFull=0.15] [maxFirst=1000] [drinkCap=2000] [drinkStart=0.25]
const { Engine } = require('./engine');
const T = require('./trainer');
const A = process.argv, mods = JSON.parse(A[2] || '{}'), seed = +A[3], K = +A[4] || 1, finalGens = A[5] === undefined ? 500 : +A[5], maxStage = +A[6] || 400;
const needFull = A[7] === undefined ? 0.15 : +A[7], maxFirst = +A[8] || 1000, drinkCap = +A[9] || 2000, drinkStart = A[10] === undefined ? 0.25 : +A[10];
const cfg = Object.assign({}, T.RUN_DEFAULTS, mods);
const e = new Engine(Object.assign({}, cfg, { layout: 'randpond', mapSeed: 1, walls: 0 }), seed);
e.genInit(seed);
const { pm, TC, NOW, cups, setMap, testW, CUPS } = T.makeCtx(e, cfg);
const f = (v, d) => (+v).toFixed(d === undefined ? 0 : d), avg = T.avg;
let total = 0, started = -1;
for (const ev of T.train(e, cfg, { K, finalGens, maxStage, needFull, maxFirst, drinkCap, drinkStart })) {
  if (ev.type === 'stage') {
    const last = ev.last;
    console.log(ev.label, '| gens used', ev.g, '(total ' + ev.total + ') | survived', f(avg(last, 'mean')), 'full', f(100 * avg(last, 'fullShare')) + '%', 'drank', f(100 * avg(last, 'drankShare')) + '%' + (last[0] && last[0].cupDrank != null ? ' | on the cup maps only: survived ' + f(avg(last, 'cupMean')) + ' full ' + f(100 * avg(last, 'cupFull')) + '% drank ' + f(100 * avg(last, 'cupDrank')) + '%' : ''));
  } else if (ev.type === 'done') { total = ev.total; started = ev.started; }
}
const evalOn = T.evalOn.bind(null, e);
const { wb, nb, fc, abl: ablr } = T.evaluate(e, cfg, { pm, setMap, testW, NOW, CUPS, TC, cups });
const abl = ablr ? ' | ABL_WITHWALLS ' + f(ablr.ticks) + ' ' + f(100 * ablr.full) + '% ' + f(100 * ablr.drank) + '%' : '';
console.log('FINAL seed', seed, '| K', K, '| gens', total, '| DRINK_STARTED', started,
  '| TEST_BARS_TICKS', f(wb.ticks), '| TEST_BARS_FULL', f(100 * wb.full) + '%', '| TEST_BARS_DRANK', f(100 * wb.drank) + '%',
  '| TEST_NOBARS_TICKS', f(nb.ticks), '| TEST_NOBARS_FULL', f(100 * nb.full) + '%', '| TEST_NOBARS_DRANK', f(100 * nb.drank) + '%' + (fc ? ' | TEST_FACING_TICKS ' + f(fc.ticks) + ' | TEST_FACING_FULL ' + f(100 * fc.full) + '% | TEST_FACING_DRANK ' + f(100 * fc.drank) + '%' : '') + abl);


// "traceCups":1 (step 6): after the tests, replay 10 held-out cup maps (gap TC, random openings) with the trained dots and print one TRACE line: where each dot first reaches a ring
// (the open side or a closed one), how many get in from each, how many leave again, how many of the dots that drank survive, die inside or outside the ring. Same quantities as run-cuptrace.js.
if (cfg.traceCups && CUPS) {
  const { W } = require('./engine'), GP = e.cfg.genP, L = e.cfg.genLen, v = e.views(), kindArr = new Uint8Array(e.mem, e.x.kind_ptr(), W * W), R = 10;
  const acc = { dots: 0, arrOpen: 0, arrOpenIn: 0, arrClosed: 0, arrClosedIn: 0, gotIn: 0, leftAgain: 0, drank: 0, drinkSurvived: 0, drinkDiedInside: 0, drinkDiedOutside: 0, reached: 0 };
  let survived = 0, drankAll = 0;
  for (let r = 0; r < R; r++) {
    setMap(1000000 + r, pm, 0, cups(TC, 0));
    const kinds = new Uint8Array(kindArr), ponds = [], seen = new Uint8Array(W * W);
    for (let i = 0; i < W * W; i++) if (kinds[i] === 3 && !seen[i]) { const x0 = i % W, y0 = (i / W) | 0; for (let yy = y0; yy < y0 + 7; yy++) for (let xx = x0; xx < x0 + 7; xx++) seen[yy * W + xx] = 1; ponds.push([x0, y0]); }
    const kk = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= W) ? 4 : kinds[yy * W + xx];
    const openSide = ponds.map(p => [[p[0] - 3, p[1] + 3], [p[0] + 9, p[1] + 3], [p[0] + 3, p[1] - 3], [p[0] + 3, p[1] + 9]].findIndex(m => kk(m[0], m[1]) !== 4));
    const nearRing = (xx, yy) => ponds.some(p => xx >= p[0] - 6 && xx <= p[0] + 13 && yy >= p[1] - 6 && yy <= p[1] + 13);
    const inside = (xx, yy) => ponds.some(p => xx >= p[0] - 2 && xx <= p[0] + 8 && yy >= p[1] - 2 && yy <= p[1] + 8);
    const sideOf = (xx, yy) => { let best = -1, bd = 1e9; ponds.forEach((p, i) => { const d = Math.hypot(xx - (p[0] + 3.5), yy - (p[1] + 3.5)); if (d < bd) { bd = d; best = i; } }); const p = ponds[best], dx = xx - (p[0] + 3.5), dy = yy - (p[1] + 3.5); return { pond: best, side: Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 0 : 1) : (dy < 0 ? 2 : 3) }; };
    const arrived = new Int8Array(GP).fill(-1), entered = new Uint8Array(GP), wasIn = new Uint8Array(GP), exited = new Uint8Array(GP), lastT = new Int32Array(GP).fill(-1), lastX = new Float64Array(GP), lastY = new Float64Array(GP);
    e.genBegin();
    for (let t = 0; t < L; t++) {
      const n = e.genTick(t);
      for (let i = 0; i < n; i++) { const sI = v.ord[i], xx = v.ax[sI], yy = v.ay[sI]; if (nearRing(xx, yy) && arrived[sI] < 0) { const sd = sideOf(xx, yy); arrived[sI] = sd.side === openSide[sd.pond] ? 1 : 0; } const nin = inside(xx, yy) ? 1 : 0; if (nin) entered[sI] = 1; if (wasIn[sI] && !nin) exited[sI] = 1; wasIn[sI] = nin; lastT[sI] = t; lastX[sI] = xx; lastY[sI] = yy; }
      if (n === 0) break;
    }
    const st = e.genEnd(false); survived += st.mean / R; drankAll += st.drankShare / R;
    for (let sI = 0; sI < GP; sI++) {
      acc.dots++; const dr = v.gwater[sI] > 0;
      if (arrived[sI] >= 0) acc.reached++;
      if (arrived[sI] === 1) { acc.arrOpen++; if (entered[sI]) acc.arrOpenIn++; } else if (arrived[sI] === 0) { acc.arrClosed++; if (entered[sI]) acc.arrClosedIn++; }
      if (entered[sI]) { acc.gotIn++; if (exited[sI]) acc.leftAgain++; }
      if (dr) { acc.drank++; if (lastT[sI] >= L - 1) acc.drinkSurvived++; else if (inside(lastX[sI], lastY[sI])) acc.drinkDiedInside++; else acc.drinkDiedOutside++; }
    }
  }
  const pc = (a, b) => b ? Math.round(1000 * a / b) / 10 : null;
  console.log('TRACE ' + JSON.stringify({ seed, survived: Math.round(survived), drank: Math.round(1000 * drankAll) / 10, reachedRing: pc(acc.reached, acc.dots), arrivedAtOpen: pc(acc.arrOpen, acc.arrOpen + acc.arrClosed), enteredFromOpen: pc(acc.arrOpenIn, acc.arrOpen), enteredFromClosed: pc(acc.arrClosedIn, acc.arrClosed),
    gotIn: pc(acc.gotIn, acc.dots), leftAgain: pc(acc.leftAgain, acc.gotIn), drinkers: acc.drank, drinkersSurvived: pc(acc.drinkSurvived, acc.drank), drinkersDiedInside: pc(acc.drinkDiedInside, acc.drank), drinkersDiedOutside: pc(acc.drinkDiedOutside, acc.drank) }));
}
// "saveTo":"path.bin": write the trained population (all genomes) to that file and the settings to path.bin.json, for run-load.js (examine it later without training).
if (cfg.saveTo) { e.saveGenomes(cfg.saveTo); require('fs').writeFileSync(cfg.saveTo + '.json', JSON.stringify({ seed, cfg: Object.assign({}, cfg, { saveTo: undefined }) })); }
// "altLossE":1.5 (step 6): after everything else, evaluate the trained population once more with that energy loss per tick (same 20 held-out cup maps and open maps), printed as an ALT line.
if (cfg.altLossE != null) {
  e.setCfg('lossE', cfg.altLossE);
  const a1 = evalOn(i => setMap(1000000 + i, pm, 0, testW)), a2 = evalOn(i => setMap(1000000 + i, pm, 0, NOW));
  console.log('ALT lossE', cfg.altLossE, '| CUPS_TICKS', f(a1.ticks), '| CUPS_FULL', f(100 * a1.full) + '%', '| CUPS_DRANK', f(100 * a1.drank) + '%', '| OPEN_TICKS', f(a2.ticks), '| OPEN_FULL', f(100 * a2.full) + '%', '| OPEN_DRANK', f(100 * a2.drank) + '%');
}
