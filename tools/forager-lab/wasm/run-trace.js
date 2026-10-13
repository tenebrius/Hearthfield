// Behaviour trace (WASM engine, generational mode): train for <gens> generations, then replay one round of the trained population
// (no breeding) tick by tick and print a single "TRACE {json}" line with what the dots did.
// Usage: node run-trace.js '<cfg overrides as JSON>' <seed> <gens>
// Regions assume the far-ponds map: food circles of radius 9 around (48,16) and (16,48); ponds around (5,5) and (58,58).
const { Engine } = require('./engine');
const DEFAULTS = { layout: 'handfar', lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false, genSpawn: 1 };
const mods = JSON.parse(process.argv[2] || '{}'), seed = +process.argv[3], gens = +process.argv[4];
const e = new Engine(Object.assign({}, DEFAULTS, mods), seed);
e.genInit(seed);
for (let g = 0; g < gens; g++) e.genRound();
const GP = e.cfg.genP, L = e.cfg.genLen, v = e.views(), osc = !!e.cfg.oscillator;
const firstEat = new Int32Array(GP).fill(-1), firstDrink = new Int32Array(GP).fill(-1), entries = new Int32Array(GP), wasNear = new Uint8Array(GP);
const wl = new Float64Array(GP), mean = new Float64Array(GP), m2 = new Float64Array(GP), cnt = new Int32Array(GP);   // Welford per dot, for the chosen oscillator period
const near = (x, y, cx, cy, r) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
const T = { t: [], alive: [], energy: [], hydration: [], nearFood: [], nearPond: [], ate: [], drank: [] };
e.genBegin();
for (let t = 0; t < L; t++) {
  const n = e.genTick(t);
  for (let s = 0; s < GP; s++) { if (firstEat[s] < 0 && v.gfood[s] > 0) firstEat[s] = t; if (firstDrink[s] < 0 && v.gwater[s] > 0) firstDrink[s] = t; }
  let nf = 0, np = 0, se = 0, sw = 0;
  for (let i = 0; i < n; i++) {
    const s = v.ord[i], x = v.ax[s], y = v.ay[s];
    const f = near(x, y, 48, 16, 9) || near(x, y, 16, 48, 9), p = near(x, y, 5, 5, 8) || near(x, y, 58, 58, 8);
    if (f) nf++; if (p) { np++; if (!wasNear[s]) entries[s]++; } wasNear[s] = p ? 1 : 0;
    se += v.ae[s]; sw += v.aw[s];
    if (osc) { const per = v.aper[s]; cnt[s]++; const d = per - mean[s]; mean[s] += d / cnt[s]; m2[s] += d * (per - mean[s]); }
  }
  if (t % 50 === 0 || t === L - 1) {
    let ate = 0, drank = 0; for (let s = 0; s < GP; s++) { if (firstEat[s] >= 0) ate++; if (firstDrink[s] >= 0) drank++; }
    T.t.push(t); T.alive.push(n / GP); T.energy.push(n ? se / n : 0); T.hydration.push(n ? sw / n : 0); T.nearFood.push(n ? nf / n : 0); T.nearPond.push(n ? np / n : 0); T.ate.push(ate / GP); T.drank.push(drank / GP);
  }
  if (n === 0) break;
}
const stats = e.genEnd(false);
const q = (a, p) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
const drinkers = Array.from(firstDrink).filter(x => x >= 0), eaters = Array.from(firstEat).filter(x => x >= 0);
const out = { seed, timeline: T, drinkers: drinkers.length / GP, firstDrink: { p25: q(drinkers, 0.25), median: q(drinkers, 0.5), p75: q(drinkers, 0.75) }, firstEat: { median: q(eaters, 0.5) },
  pondEntries: Array.from(entries).reduce((a, b) => a + b, 0) / GP, survived: stats.mean, full: stats.fullShare };
if (osc) {
  const ok = []; for (let s = 0; s < GP; s++) if (cnt[s] >= 100) ok.push(s);
  const means = ok.map(s => mean[s]), sds = ok.map(s => Math.sqrt(m2[s] / cnt[s])), cvs = ok.map((s, i) => sds[i] / means[i]);
  out.period = { dots: ok.length, medianOfMeans: q(means, 0.5), p10: q(means, 0.1), p90: q(means, 0.9), medianSdWithinDot: q(sds, 0.5), medianCvWithinDot: q(cvs, 0.5) };
}
console.log('TRACE ' + JSON.stringify(out));
