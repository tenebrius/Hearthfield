// Checks that the WASM engine's building blocks agree with plain JavaScript.
// Run: node test-wasm.js   (exits non-zero on failure)
const { Engine, W, H } = require('./engine');
let failed = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' (' + detail + ')' : '')); if (!ok) failed++; };
let seedState = 12345; const rnd = () => { seedState = (seedState * 1664525 + 1013904223) >>> 0; return seedState / 4294967296; };

const e0 = new Engine({ layout: 'handfar' }, 1), x0 = e0.x;
// 1. tanh and log accuracy
let maxT = 0; for (let v = -12; v <= 12; v += 0.0007) maxT = Math.max(maxT, Math.abs(x0.tanh_test(v) - Math.tanh(v)));
check('tanh approximation', maxT < 1e-6, 'max abs error ' + maxT.toExponential(2));
let maxL = 0; for (let v = 1e-6; v < 1; v *= 1.003) maxL = Math.max(maxL, Math.abs(x0.log_test(v) - Math.log(v)));
check('log approximation', maxL < 1e-9, 'max abs error ' + maxL.toExponential(2));

// 2. nearest-tile search equals a plain row-by-row scan (same tile, same tie-break)
{
  const e = new Engine({ layout: 'handfar' }, 1), x = e.x;
  let bad = 0, queries = 0, withHit = 0;
  for (let trial = 0; trial < 40; trial++) {
    const density = 0.05 + rnd() * 0.5;
    const kind = new Uint8Array(e.mem, x.kind_ptr(), W * H), fert = new Float32Array(e.mem, x.fert_ptr(), W * H), food = new Float32Array(e.mem, x.food_ptr(), W * H);
    for (let i = 0; i < W * H; i++) { const r = rnd(); kind[i] = r < density / 2 ? 1 : r < density ? 3 : 0; fert[i] = kind[i] ? 0.8 : 0; }
    x.init_world(1);
    for (let i = 0; i < W * H; i++) if (kind[i]) food[i] = rnd() < 0.3 ? 0.1 : 0.2 + rnd() * 0.8;   // some tiles below the 0.2 sight threshold
    x.rebuild_masks();
    for (let q = 0; q < 3000; q++) {
      const px = rnd() * W, py = rnd() * H, R = 1 + Math.floor(rnd() * 8), want = rnd() < 0.5 ? 1 : 3;
      const ox = Math.floor(px), oy = Math.floor(py), R2 = R * R;
      let best = 1e9, bi = -1;
      const x0_ = Math.max(0, Math.floor(px - R)), x1_ = Math.min(W - 1, Math.floor(px + R)), y0_ = Math.max(0, Math.floor(py - R)), y1_ = Math.min(H - 1, Math.floor(py + R));
      for (let ty = y0_; ty <= y1_; ty++) for (let tx = x0_; tx <= x1_; tx++) {
        if (tx === ox && ty === oy) continue;
        const j = ty * W + tx; if (food[j] < 0.2) continue;
        const dx = tx + 0.5 - px, dy = ty + 0.5 - py, d2 = dx * dx + dy * dy; if (d2 > R2) continue;
        if (kind[j] === want && d2 < best) { best = d2; bi = j; }
      }
      queries++; if (bi >= 0) withHit++;
      if (x.nearest_test(px, py, R, want) !== bi) bad++;
    }
  }
  check('nearest tile matches plain scan', bad === 0, queries + ' queries, ' + withHit + ' with a hit, ' + bad + ' differences');
}

// 3. forward pass equals a plain JS implementation (Math.tanh, doubles), for 1 and 2 hidden layers and with memory on and off.
//    Weight layout: input-major rows, columns padded to a multiple of 4; only inputs that can be non-zero have rows.
for (const layers of [1, 2]) for (const memory of [true, false]) for (const variant of [{ grip: false, tm: 0 }, { grip: true, tm: 0 }, { grip: true, tm: 1 }, { grip: true, tm: 2 }, { grip: true, tm: 0, gene: true, timer: true }]) {
  const grip = variant.grip, tm = variant.tm, extra = grip, gene = !!variant.gene, timer = !!variant.timer;   // 'grip' also switches on the latch and oscillator; tm > 0 adds the thermometer with brain-set thresholds
  const e = new Engine({ layout: 'circles', layers, memory, brainMomentum: grip, latch: extra, oscillator: extra, ageTherm: tm > 0, thermMode: tm, oscGene: gene, timer, hidden: 8, position: true, noise: true, age: true, feedback: true, tumble: true }, 3), x = e.x;
  const NW = x.genome_stride(), NH = 8, N_IN = 34, HP = x.layout_info(0), OP = x.layout_info(1), OFF2 = x.layout_info(2), OFFO = x.layout_info(3), NACT = x.layout_info(4);
  const NOUT = (memory ? 11 : 3) + (grip ? 3 : 0) + (tm === 1 ? 1 : tm === 2 ? 6 : 0);
  const act = Array.from(new Int32Array(e.mem, x.act_ptr(), NACT));
  check('active inputs, memory ' + (memory ? 'on' : 'off') + ', extras ' + (extra ? 'on' : 'off') + ', thermometer mode ' + tm + (gene ? ', clock gene + timer' : ''), act.length === (memory ? 23 : 19) + (extra ? 4 : 0) + (tm > 0 ? 6 : 0) + (timer ? 1 : 0), act.length + ' active');
  const ord = new Int32Array(e.mem, x.ord_ptr(), 40), G = new Float32Array(e.mem, x.genome_ptr(), 2048 * NW), INP = new Float32Array(e.mem, x.inp_ptr(), 2048 * N_IN);
  const OUT = new Float32Array(e.mem, x.out_ptr(), 24);
  let maxErr = 0;
  for (let t = 0; t < 40; t++) {
    const s = ord[t % 40], g = G.subarray(s * NW, (s + 1) * NW), inp = INP.subarray(s * N_IN, (s + 1) * N_IN);
    for (let i = 0; i < N_IN; i++) inp[i] = rnd() < 0.25 ? 0 : (rnd() * 2 - 1);   // some exact zeros, which the engine skips
    x.think_test(s);
    let h1 = [], h2 = [], last;
    for (let c = 0; c < NH; c++) { let sum = 0; act.forEach((i, k) => { sum += inp[i] * g[k * HP + c]; }); h1.push(Math.tanh(sum)); }
    last = h1;
    if (layers === 2) { for (let c = 0; c < NH; c++) { let sum = 0; for (let j = 0; j < NH; j++) sum += h1[j] * g[OFF2 + j * HP + c]; h2.push(Math.tanh(sum)); } last = h2; }
    for (let o = 0; o < NOUT; o++) { let v = 0; for (let h = 0; h < NH; h++) v += last[h] * g[OFFO + h * OP + o]; maxErr = Math.max(maxErr, Math.abs(v - OUT[o])); }
    // padding columns must stay zero
    for (let k = 0; k < NACT; k++) for (let c = NH; c < HP; c++) if (g[k * HP + c] !== 0) maxErr = 1e9;
  }
  check('forward pass, ' + layers + ' layer(s), memory ' + (memory ? 'on' : 'off') + ', brain momentum ' + (grip ? 'on' : 'off') + ', thermometer mode ' + tm, maxErr < 5e-4, 'max abs error on outputs ' + maxErr.toExponential(2));
}
// 4. crossover builds children from the two parents as described
{
  const e = new Engine({ layout: 'handfar', layers: 2, hidden: 8, memory: true, position: true, tumble: true }, 5), x = e.x;
  x.gen_init(5);
  const NW = x.genome_stride(), HP = x.layout_info(0), OP = x.layout_info(1), OFF2 = x.layout_info(2), OFFO = x.layout_info(3), NACT = x.layout_info(4), NH = 8;
  const G = new Float32Array(e.mem, x.genome_ptr(), 2048 * NW);
  const row = s => G.subarray(s * NW, (s + 1) * NW);
  // identical parents give an identical child, in both modes
  for (const mode of [1, 2]) { x.cross_test(0, 0, mode, 10); check('crossover of identical parents, mode ' + mode, row(10).every((v, i) => v === row(0)[i])); }
  // mode 2: every weight comes from one of the parents, padding stays zero
  x.cross_test(1, 2, 2, 11);
  let bad = 0, fromA = 0, fromB = 0; const A = row(1), B = row(2), C = row(11);
  for (let i = 0; i < NW; i++) { if (C[i] !== A[i] && C[i] !== B[i]) bad++; if (C[i] === A[i] && A[i] !== B[i]) fromA++; if (C[i] === B[i] && A[i] !== B[i]) fromB++; }
  check('crossover mode 2 weights come from the parents', bad === 0 && fromA > 50 && fromB > 50, fromA + ' from A, ' + fromB + ' from B');
  // mode 1: each hidden neuron (layer-1 column, layer-2 row, output row) is entirely from one parent
  x.cross_test(1, 2, 1, 12);
  const D = row(12); let split = 0, ca = 0, cb = 0;
  for (let h = 0; h < NH; h++) {
    const same = (P) => { for (let k = 0; k < NACT; k++) if (D[k * HP + h] !== P[k * HP + h]) return false; for (let c = 0; c < HP; c++) if (D[OFF2 + h * HP + c] !== P[OFF2 + h * HP + c]) return false; for (let o = 0; o < OP; o++) if (D[OFFO + h * OP + o] !== P[OFFO + h * OP + o]) return false; return true; };
    const a = same(A), b = same(B); if (!a && !b) split++; if (a) ca++; if (b) cb++;
  }
  let padOk = true; for (let k = 0; k < NACT; k++) for (let c = NH; c < HP; c++) if (D[k * HP + c] !== 0) padOk = false;
  check('crossover mode 1 keeps each neuron intact', split === 0 && padOk, ca + ' neurons from A, ' + cb + ' from B, ' + split + ' split');
}
// 4b. thermometer age inputs switch on at 50, 100, 200, 400, 800, 1600 ticks
{
  const e = new Engine({ layout: 'handfar', memory: true, ageTherm: true, maxE: 500, maxW: 500, startE: 500, startW: 500, maxPop: 300 }, 3), x = e.x;
  e.step(130);
  const n = x.n_agents(), ord = new Int32Array(e.mem, x.ord_ptr(), n), INP = new Float32Array(e.mem, x.inp_ptr(), 2048 * 34);
  let bad = 0, sawOn = 0;
  for (let i = 0; i < n; i++) { const inp = INP.subarray(ord[i] * 34 + 27, ord[i] * 34 + 33); for (let k = 0; k < 6; k++) if (inp[k] !== 0 && inp[k] !== 1) bad++; for (let k = 1; k < 6; k++) if (inp[k] > inp[k - 1]) bad++; if (inp[0] === 1) sawOn++; }
  check('thermometer inputs are 0/1 and switch on in order', bad === 0 && n > 0, n + ' dots, ' + sawOn + ' past tick 50');
}
// 5. oscillator and latch behave as described
{
  const e = new Engine({ layout: 'handfar', memory: true, oscillator: true, latch: true, maxPop: 300 }, 7), x = e.x;
  e.step(300);
  const n = x.n_agents(), ord = new Int32Array(e.mem, x.ord_ptr(), n), INP = new Float32Array(e.mem, x.inp_ptr(), 2048 * 34);
  let badOsc = 0, nonZero = 0, outOfRange = 0;
  for (let i = 0; i < n; i++) {
    const inp = INP.subarray(ord[i] * 34, (ord[i] + 1) * 34);
    if (Math.abs(inp[23] * inp[23] + inp[24] * inp[24] - 1) > 1e-3) badOsc++;
    if (Math.abs(inp[25]) > 1 || Math.abs(inp[26]) > 1) outOfRange++;
    if (inp[25] !== 0 || inp[26] !== 0) nonZero++;
  }
  check('oscillator inputs lie on the unit circle', badOsc === 0 && n > 0, n + ' dots checked');
  check('latch values are random samples in [-1, 1]', outOfRange === 0 && nonZero === n, nonZero + ' of ' + n + ' non-zero');
  let maxErr = 0; for (let v = -2; v <= 2; v += 0.001) maxErr = Math.max(maxErr, Math.abs(x.sin2pi_test(v) - Math.sin(2 * Math.PI * v)));
  check('sin(2 pi x) approximation', maxErr < 1e-5, 'max abs error ' + maxErr.toExponential(2));
}
// 6. clock gene is inherited, mutated a little, stays in range; timer input stays in [0, 1] and can be reset
{
  const e = new Engine({ layout: 'handfar', memory: true, oscillator: true, oscGene: true, timer: true, genSpawn: 1, maxE: 500, maxW: 500, startE: 500, startW: 500 }, 11), x = e.x;
  x.gen_init(11);
  const NW = x.genome_stride(), GO = x.gene_off(), G = new Float32Array(e.mem, x.genome_ptr(), 2048 * NW);
  const genes = () => { const a = []; for (let s = 0; s < 200; s++) a.push(G[s * NW + GO]); return a; };
  const g0 = genes(); check('clock genes start spread over 8 to 800 ticks', g0.every(v => v >= 3 && v <= 9.7) && Math.max(...g0) - Math.min(...g0) > 3, 'range ' + Math.min(...g0).toFixed(1) + ' to ' + Math.max(...g0).toFixed(1) + ' (log2 ticks)');
  for (let i = 0; i < 40; i++) e.genRound();
  const g1 = genes(); const sd = a => { const m = a.reduce((p, q) => p + q, 0) / a.length; return Math.sqrt(a.reduce((p, q) => p + (q - m) * (q - m), 0) / a.length); };
  check('clock genes stay in range and selection narrows them', g1.every(v => v >= 2 && v <= 10) && sd(g1) < sd(g0), 'spread (sd, log2 ticks) ' + sd(g0).toFixed(2) + ' -> ' + sd(g1).toFixed(2));
  const e2 = new Engine({ layout: 'handfar', memory: true, timer: true, maxPop: 300 }, 4), x2 = e2.x;
  e2.step(200);
  const n = x2.n_agents(), ord = new Int32Array(e2.mem, x2.ord_ptr(), n), INP = new Float32Array(e2.mem, x2.inp_ptr(), 2048 * 34);
  let bad = 0, nonzero = 0; for (let i = 0; i < n; i++) { const v = INP[ord[i] * 34 + 33]; if (!(v >= 0 && v <= 1)) bad++; if (v > 0) nonzero++; }
  check('timer input lies between 0 and 1', bad === 0 && n > 0, n + ' dots, ' + nonzero + ' above 0');
  let maxE2 = 0; for (let v = 0; v <= 12; v += 0.01) maxE2 = Math.max(maxE2, Math.abs(x2.pow2_test(v) / Math.pow(2, v) - 1));
  check('2^x approximation', maxE2 < 1e-4, 'max relative error ' + maxE2.toExponential(2));
}
console.log(failed ? failed + ' check(s) FAILED' : 'all checks passed');
process.exit(failed ? 1 : 0);
