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
      // a quarter of the positions each on a tile corner, a tile centre and just past a corner: exact ties between columns happen there
      const at = v => q % 4 === 0 ? v : q % 4 === 1 ? Math.floor(v) : q % 4 === 2 ? Math.floor(v) + 0.5 : Math.floor(v) + 1e-12;
      const px = at(rnd() * W), py = at(rnd() * H), R = 1 + Math.floor(rnd() * 8), want = rnd() < 0.5 ? 1 : 3;
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
  const NW = x.genome_stride(), NH = 8, N_IN = 37, HP = x.layout_info(0), OP = x.layout_info(1), OFF2 = x.layout_info(2), OFFO = x.layout_info(3), NACT = x.layout_info(4);
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
  const n = x.n_agents(), ord = new Int32Array(e.mem, x.ord_ptr(), n), INP = new Float32Array(e.mem, x.inp_ptr(), 2048 * 37);
  let bad = 0, sawOn = 0;
  for (let i = 0; i < n; i++) { const inp = INP.subarray(ord[i] * 37 + 27, ord[i] * 37 + 33); for (let k = 0; k < 6; k++) if (inp[k] !== 0 && inp[k] !== 1) bad++; for (let k = 1; k < 6; k++) if (inp[k] > inp[k - 1]) bad++; if (inp[0] === 1) sawOn++; }
  check('thermometer inputs are 0/1 and switch on in order', bad === 0 && n > 0, n + ' dots, ' + sawOn + ' past tick 50');
}
// 5. oscillator and latch behave as described
{
  const e = new Engine({ layout: 'handfar', memory: true, oscillator: true, latch: true, maxPop: 300 }, 7), x = e.x;
  e.step(300);
  const n = x.n_agents(), ord = new Int32Array(e.mem, x.ord_ptr(), n), INP = new Float32Array(e.mem, x.inp_ptr(), 2048 * 37);
  let badOsc = 0, nonZero = 0, outOfRange = 0;
  for (let i = 0; i < n; i++) {
    const inp = INP.subarray(ord[i] * 37, (ord[i] + 1) * 37);
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
  const n = x2.n_agents(), ord = new Int32Array(e2.mem, x2.ord_ptr(), n), INP = new Float32Array(e2.mem, x2.inp_ptr(), 2048 * 37);
  let bad = 0, nonzero = 0; for (let i = 0; i < n; i++) { const v = INP[ord[i] * 37 + 33]; if (!(v >= 0 && v <= 1)) bad++; if (v > 0) nonzero++; }
  check('timer input lies between 0 and 1', bad === 0 && n > 0, n + ' dots, ' + nonzero + ' above 0');
  let maxE2 = 0; for (let v = 0; v <= 12; v += 0.01) maxE2 = Math.max(maxE2, Math.abs(x2.pow2_test(v) / Math.pow(2, v) - 1));
  check('2^x approximation', maxE2 < 1e-4, 'max relative error ' + maxE2.toExponential(2));
}
// 7. walls: layout, a route to each pond exists, dots never stand in a wall, they slide along it, and the wall sense looks right
{
  const mk = (gap, extra) => new Engine(Object.assign({ layout: 'handfar', walls: 1, wallGap: gap, memory: true, genSpawn: 1, wallSense: 1 }, extra || {}), 3);
  const kindOf = e => new Uint8Array(e.mem, e.x.kind_ptr(), W * H);
  for (const [wt, gap] of [[1, 0], [1, 3], [1, 9], [2, 0], [2, 3]]) {
    const K = kindOf(mk(gap, { walls: wt })), walls = K.reduce((a, v) => a + (v === 4 ? 1 : 0), 0);
    // flood fill (4-neighbour) from the centre over non-wall tiles; the pond tiles must be reachable unless the gap is closed
    const seen = new Uint8Array(W * H), q = [32 * W + 32]; seen[q[0]] = 1;
    while (q.length) { const i = q.pop(), x = i % W, y = (i / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (!seen[j] && K[j] !== 4) { seen[j] = 1; q.push(j); } } }
    const pondA = seen[5 * W + 5], pondB = seen[58 * W + 58];
    check('walls ' + wt + ', gap ' + gap + ': ' + walls + ' wall tiles, ponds ' + (gap === 0 ? 'sealed' : 'reachable'), gap === 0 ? (!pondA && !pondB) : (pondA && pondB));
  }
  { // long walls: the gap is in rows 1 to 3 of the vertical arm at x = 20 (and mirrored)
    const K = kindOf(mk(3, { walls: 2 })), open = [0, 1, 2, 3, 4, 19, 20].map(y => K[y * W + 20] !== 4), openB = [0, 1, 2, 3, 4].map(k => K[(H - 1 - k) * W + (W - 1 - 20)] !== 4);
    check('long walls: gap rows 1 to 3 next to the edge', open.join() === 'false,true,true,true,false,false,false' && openB.join() === 'false,true,true,true,false', open.join() + ' / ' + openB.join());
  }
  { // hostile long walls: the gap is at the corner end (rows 17 to 19 of the vertical arm at x = 20); random bars are placed by seed and keep clear of food, ponds and the centre
    const K = kindOf(mk(3, { walls: 3 })), open = [0, 1, 2, 16, 17, 18, 19, 20].map(y => K[y * W + 20] !== 4);
    check('hostile long walls: gap rows 17 to 19 next to the corner of the L', open.join() === 'false,false,false,false,true,true,true,false', open.join());
    const bars = seedv => kindOf(new Engine({ layout: 'randpond', mapSeed: seedv, pondMin: 30, walls: 4, wallN: 3, wallLen: 14, genSpawn: 1 }, 1)).slice();
    const B1 = bars(5), B2 = bars(5), B3 = bars(6); let bad = 0, n = 0;
    for (let i = 0; i < W * H; i++) { if (B1[i] === 4) { n++; const x = i % W, y = (i / W) | 0; if (x >= 26 && x <= 37 && y >= 26 && y <= 37) bad++; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && (B1[yy * W + xx] === 1 || B1[yy * W + xx] === 3)) bad++; } } }
    check('random bars: up to 3 bars of 14 (they may cross), same seed same map, different seed different map, clear of food, water and the centre', n >= 30 && n <= 42 && bad === 0 && B1.every((v, i) => v === B2[i]) && B1.some((v, i) => v !== B3[i]), n + ' wall tiles, ' + bad + ' too close');
  }
  const e = mk(3, { baseline: true }), K = kindOf(e);
  let inside = 0; for (let t = 0; t < 400; t++) { e.step(1); const n = e.x.n_agents(), ord = new Int32Array(e.mem, e.x.ord_ptr(), n), ax = new Float64Array(e.mem, e.x.ax_ptr(), 2048), ay = new Float64Array(e.mem, e.x.ay_ptr(), 2048); for (let i = 0; i < n; i++) if (K[Math.floor(ay[ord[i]]) * W + Math.floor(ax[ord[i]])] === 4) inside++; }
  check('random movers never stand in a wall tile', inside === 0, inside + ' dot-ticks inside walls');
  // wall sense: a dot just right of the vertical arm sees the wall to its left
  const e3 = mk(3), x3 = e3.x; x3.gen_init(3); x3.gen_begin();
  const AX = new Float64Array(e3.mem, x3.ax_ptr(), 2048), AY = new Float64Array(e3.mem, x3.ay_ptr(), 2048);
  AX[0] = 11.5; AY[0] = 2.5; x3.gen_tick(0);
  const INP = new Float32Array(e3.mem, x3.inp_ptr(), 2048 * 37), v = INP.subarray(34, 37);
  check('wall sense points at the nearest wall tile', v[0] < -0.9 && Math.abs(v[1]) < 0.1 && v[2] > 0.5, 'dir (' + v[0].toFixed(2) + ', ' + v[1].toFixed(2) + '), closeness ' + v[2].toFixed(2));
  // sliding: random movers placed against the horizontal arm (y = 10) that try to step into it keep their sideways motion
  const e4 = mk(3, { baseline: true }), x4 = e4.x; x4.gen_init(3); x4.gen_begin();
  const AX4 = new Float64Array(e4.mem, x4.ax_ptr(), 2048), AY4 = new Float64Array(e4.mem, x4.ay_ptr(), 2048);
  for (let s2 = 0; s2 < 200; s2++) { AX4[s2] = 5.5; AY4[s2] = 9.5; }
  x4.gen_tick(0);
  let slid = 0, wallIn = 0; for (let s2 = 0; s2 < 200; s2++) { if (AY4[s2] === 9.5 && AX4[s2] !== 5.5) slid++; if (Math.floor(AY4[s2]) === 10) wallIn++; }
  check('a dot pushed into a wall slides along it', slid > 20 && wallIn === 0, slid + ' of 200 slid, ' + wallIn + ' ended inside the wall');
}

// 8. scoring on several layouts: one layout is exactly genRound(); three identical layouts (rounds are deterministic in this setup) give the same genomes as one;
//    three different layouts give the mean of the three single-layout scores
{
  const cfg = { layout: 'randpond', mapSeed: 1, pondMin: 30, memory: true, oscillator: true, oscPeriod: 200, genSpawn: 1, maxE: 500, maxW: 500, startE: 500, startW: 500, genLen: 300 };
  const mk = () => { const e = new Engine(cfg, 5); e.genInit(5); return e; };
  const genomes = e => new Float32Array(e.mem, e.x.genome_ptr(), 200 * e.x.genome_stride()).slice();
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const A = mk(), B = mk(), C = mk(); let ok1 = true, ok3 = true;
  for (let g = 0; g < 6; g++) {
    const set = () => A.setMap('randpond', 0, 10 + g, 2, 30, 0); set();
    const sa = A.genRound(), sb = B.genRoundMulti([() => B.setMap('randpond', 0, 10 + g, 2, 30, 0)]);
    const m = () => C.setMap('randpond', 0, 10 + g, 2, 30, 0), sc = C.genRoundMulti([m, m, m]);
    if (sa.mean !== sb.mean || sa.drankShare !== sb.drankShare) ok1 = false;
    if (Math.abs(sa.mean - sc.mean) > 1e-9) ok3 = false;
  }
  check('one layout per generation is exactly genRound() (6 generations, same stats and genomes)', ok1 && same(genomes(A), genomes(B)));
  check('three identical layouts breed the same population as one', ok3 && same(genomes(A), genomes(C)));
  // different layouts: the stats are the mean of three evaluations without breeding, done on an identical copy
  const mk2 = () => { const e = new Engine(Object.assign({}, cfg, { genLen: 1000, maxW: 300, startW: 300 }), 5); e.genInit(5); return e; };   // rounds long enough that survival differs by layout
  const D = mk2(), E2 = mk2(), ms = [21, 22, 23], keyRef = new Float64Array(200);
  let ref = 0; for (const m of ms) { D.setMap('randpond', 0, m, 2, 30, 0); ref += D.genRound(false).mean / 3; const k = new Float64Array(D.mem, D.x.gkey_ptr(), 200); for (let i = 0; i < 200; i++) keyRef[i] += k[i] / 3; }
  const sm = E2.genRoundMulti(ms.map(m => () => E2.setMap('randpond', 0, m, 2, 30, 0)));
  const k2 = new Float64Array(E2.mem, E2.x.gkey_ptr(), 200); let maxd = 0; for (let i = 0; i < 200; i++) maxd = Math.max(maxd, Math.abs(k2[i] - keyRef[i]));
  const spread = Math.max(...keyRef) - Math.min(...keyRef);
  check('three different layouts: each dot is scored on the mean of its three rounds, stats are the mean', Math.abs(sm.mean - ref) < 1e-9 && maxd < 1e-9 && spread > 1, 'mean ' + sm.mean.toFixed(2) + ' vs ' + ref.toFixed(2) + ', max key difference ' + maxd.toExponential(1) + ', key spread ' + spread.toFixed(0));
}
// 9. cups (walls = 5): every pond is reachable from the centre when the gap is open (3 and 11 wide) and sealed when it is 0; rings keep off food and water; same seed, same map
{
  const mkc = (seedv, gap) => new Engine({ layout: 'randpond', mapSeed: seedv, pondMin: 30, pondSep: 16, walls: 5, wallGap: gap, genSpawn: 1 }, 1);
  const kindOf = e => new Uint8Array(e.mem, e.x.kind_ptr(), W * H).slice();
  const reach = K => { const seen = new Uint8Array(W * H), q = [32 * W + 32]; seen[q[0]] = 1; while (q.length) { const i = q.pop(), x = i % W, y = (i / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (!seen[j] && K[j] !== 4) { seen[j] = 1; q.push(j); } } } return seen; };
  const stat = gap => { let reachable = 0, sealed = 0, ponds = 0, walls = 0; for (let m = 1; m <= 40; m++) { const K = kindOf(mkc(m, gap)), seen = reach(K); let any = 0, all = 1; for (let i = 0; i < W * H; i++) { if (K[i] === 4) walls++; } for (let i = 0; i < W * H; i++) if (K[i] === 3) { any |= seen[i]; all &= seen[i]; } ponds++; if (all) reachable++; if (!any) sealed++; } return { reachable, sealed, ponds, walls }; };
  const g3 = stat(3), g11 = stat(11), g0 = stat(0);
  check('cups: all ponds reachable from the centre with gap 3 and gap 11 (40 maps each)', g3.reachable === 40 && g11.reachable === 40, g3.reachable + ' and ' + g11.reachable + ' of 40');
  check('cups: with gap 0 no pond is reachable', g0.sealed === 40 && g0.reachable === 0, g0.sealed + ' of 40 sealed');
  let bad = 0; for (let m = 1; m <= 40; m++) { const K = kindOf(mkc(m, 3)), F = kindOf(new Engine({ layout: 'randpond', mapSeed: m, pondMin: 30, pondSep: 16, walls: 0, genSpawn: 1 }, 1)); for (let i = 0; i < W * H; i++) { if (F[i] === 1 || F[i] === 3) { if (K[i] !== F[i]) bad++; } } }
  check('cups: food and water tiles are the same as without walls (rings never overwrite them)', bad === 0, bad + ' tiles changed');
  const A1 = kindOf(mkc(5, 3)), A2 = kindOf(mkc(5, 3)), A3 = kindOf(mkc(6, 3));
  check('cups: same seed same map, different seed different map; ponds at least 16 apart', A1.every((v, i) => v === A2[i]) && A1.some((v, i) => v !== A3[i]));
}
// 10. memory inputs: with memory on the brain sees the registers (non-zero values after a while); memory off and memNoise change that as documented
{
  const run = extra => { const e = new Engine(Object.assign({ layout: 'handfar', memory: true, maxPop: 300 }, extra), 4), x = e.x; e.step(150); const n = x.n_agents(), ord = new Int32Array(e.mem, x.ord_ptr(), n), INP = new Float32Array(e.mem, x.inp_ptr(), 2048 * 37); let nz = 0, sat = 0; for (let i = 0; i < n; i++) for (let m = 0; m < 4; m++) { const v = INP[ord[i] * 37 + 11 + m]; if (v !== 0) nz++; if (Math.abs(v) === 1) sat++; } return { n, nz, sat }; };
  const on = run({}), off = run({}), noise = (() => { const e = new Engine({ layout: 'handfar', memory: true, maxPop: 300 }, 4), x = e.x; e.step(100); e.setCfg('memNoise', 1); e.step(1); const n = x.n_agents(), ord = new Int32Array(e.mem, x.ord_ptr(), n), INP = new Float32Array(e.mem, x.inp_ptr(), 2048 * 37); let sat = 0, tot = 0; for (let i = 0; i < n; i++) for (let m = 0; m < 4; m++) { tot++; if (Math.abs(INP[ord[i] * 37 + 11 + m]) === 1) sat++; } return { sat, tot }; })();
  const zero = (() => { const e = new Engine({ layout: 'handfar', memory: true, maxPop: 300 }, 4), x = e.x; e.step(100); e.setCfg('memory', 0); e.step(1); const n = x.n_agents(), ord = new Int32Array(e.mem, x.ord_ptr(), n), INP = new Float32Array(e.mem, x.inp_ptr(), 2048 * 37); let nz = 0; for (let i = 0; i < n; i++) for (let m = 0; m < 4; m++) if (INP[ord[i] * 37 + 11 + m] !== 0) nz++; return nz; })();
  check('memory on: the brain sees non-zero register values', on.n > 0 && on.nz > 0, on.nz + ' of ' + on.n * 4 + ' register inputs non-zero');
  check('memory switched off after the start: the register inputs read 0', zero === 0, zero + ' non-zero');
  check('memNoise: the register inputs are replaced by noise (about 30% + 30% saturated)', noise.sat / noise.tot > 0.4 && noise.sat / noise.tot < 0.8, Math.round(100 * noise.sat / noise.tot) + '% at +-1');
}
// 11. cup facing: cupFacing 0 leaves the maps as before (checksum of 5 maps), cupFacing 1 puts the opening on the side facing the food whenever that side is usable
{
  let h = 0; for (let m = 1; m <= 5; m++) { const e = new Engine({ layout: 'randpond', mapSeed: m, pondMin: 30, pondSep: 16, walls: 5, wallGap: 3, genSpawn: 1 }, 1), K = new Uint8Array(e.mem, e.x.kind_ptr(), W * H); for (let i = 0; i < W * H; i++) h = (h * 31 + K[i] * (i + 1)) >>> 0; }
  check('cups: cupFacing 0 gives the same maps as before the option existed (checksum of 5 maps)', h === 2383721437, String(h));
  let facing = 0, usable = 0, total = 0;
  for (let m = 1; m <= 40; m++) {
    const e = new Engine({ layout: 'randpond', mapSeed: m, pondMin: 30, pondSep: 16, walls: 5, wallGap: 3, cupFacing: 1, genSpawn: 1 }, 1), K = new Uint8Array(e.mem, e.x.kind_ptr(), W * H), CIR = [[48, 16], [16, 48]];
    const seen = new Uint8Array(W * H), ponds = [];
    for (let i = 0; i < W * H; i++) if (K[i] === 3 && !seen[i]) { const x0 = i % W, y0 = (i / W) | 0; for (let y = y0; y < y0 + 7; y++) for (let x = x0; x < x0 + 7; x++) seen[y * W + x] = 1; ponds.push([x0, y0]); }
    for (const [px, py] of ponds) {
      total++;
      const cx = px + 3.5, cy = py + 3.5, fc = CIR.reduce((b2, c) => Math.hypot(c[0] - cx, c[1] - cy) < Math.hypot(b2[0] - cx, b2[1] - cy) ? c : b2), fdx = fc[0] - cx, fdy = fc[1] - cy;
      const foodSide = Math.abs(fdx) > Math.abs(fdy) ? (fdx < 0 ? 0 : 1) : (fdy < 0 ? 2 : 3);
      const ok = [px - 4 >= 0, px + 10 <= W - 1, py - 4 >= 0, py + 10 <= H - 1][foodSide];
      const mids = [[px - 3, py + 3], [px + 9, py + 3], [px + 3, py - 3], [px + 3, py + 9]], openNow = mids.map(([x, y]) => (x < 0 || y < 0 || x >= W || y >= H) ? 4 : K[y * W + x]).map(v => v !== 4);
      if (ok) { usable++; if (openNow[foodSide] && openNow.filter(Boolean).length === 1) facing++; }
    }
  }
  check('cups: cupFacing 1 opens the side facing the food whenever it is usable (40 maps)', usable > 0 && facing === usable, facing + ' of ' + usable + ' usable ponds, ' + total + ' ponds');
}
// 12. occlusion: with occlude on, the nearest food / water tile is the nearest one whose line of sight (dot to tile centre) crosses no wall tile.
//     Reference: plain scan in order of distance (ties by index) and an exact segment test against the open interior of every wall square.
//     With occlude on but no walls, a whole round is the same as with occlude off.
{
  const e = new Engine({ layout: 'handfar' }, 1), x = e.x;
  e.setCfg('occlude', 1);
  const blockedRef = (kind, px, py, ex, ey) => {
    const dx = ex - px, dy = ey - py;
    const xa = Math.max(0, Math.floor(Math.min(px, ex))), xb = Math.min(W - 1, Math.floor(Math.max(px, ex))), ya = Math.max(0, Math.floor(Math.min(py, ey))), yb = Math.min(H - 1, Math.floor(Math.max(py, ey)));
    for (let ty = ya; ty <= yb; ty++) for (let tx = xa; tx <= xb; tx++) {
      if (kind[ty * W + tx] !== 4) continue;
      let t0 = 0, t1 = 1, ok = true;   // segment parameter range strictly inside the open square (tx, tx + 1) x (ty, ty + 1)
      for (const [p0, d, lo] of [[px, dx, tx], [py, dy, ty]]) {
        if (d === 0) { if (!(p0 > lo && p0 < lo + 1)) ok = false; continue; }
        let a = (lo - p0) / d, b = (lo + 1 - p0) / d; if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      }
      if (ok && t0 < t1 - 1e-9) return true;   // a line that only grazes a corner (within 1e-9) is not blocked, as in the engine
    }
    return false;
  };
  let bad = 0, queries = 0, withHit = 0, hidden = 0, visBad = 0;
  for (let trial = 0; trial < 40; trial++) {
    const density = 0.05 + rnd() * 0.4, wd = 0.05 + rnd() * 0.25;
    const kind = new Uint8Array(e.mem, x.kind_ptr(), W * H), fert = new Float32Array(e.mem, x.fert_ptr(), W * H), food = new Float32Array(e.mem, x.food_ptr(), W * H);
    for (let i = 0; i < W * H; i++) { const r = rnd(); kind[i] = r < wd ? 4 : r < wd + density / 2 ? 1 : r < wd + density ? 3 : 0; fert[i] = (kind[i] === 1 || kind[i] === 3) ? 0.8 : 0; }
    x.init_world(1);
    for (let i = 0; i < W * H; i++) if (kind[i] === 1 || kind[i] === 3) food[i] = rnd() < 0.3 ? 0.1 : 0.2 + rnd() * 0.8;
    x.rebuild_masks();
    for (let q = 0; q < 3000; q++) {
      const at = v => q % 4 === 0 ? v : q % 4 === 1 ? Math.floor(v) : q % 4 === 2 ? Math.floor(v) + 0.5 : Math.floor(v) + 1e-12;
      const px = at(rnd() * W), py = at(rnd() * H), R = 1 + Math.floor(rnd() * 8), want = rnd() < 0.5 ? 1 : 3;
      const ox = Math.floor(px), oy = Math.floor(py), R2 = R * R;
      if (kind[oy * W + ox] === 4) continue;   // dots never stand in a wall
      const cand = [];
      const x0_ = Math.max(0, Math.floor(px - R)), x1_ = Math.min(W - 1, Math.floor(px + R)), y0_ = Math.max(0, Math.floor(py - R)), y1_ = Math.min(H - 1, Math.floor(py + R));
      let wallInBox = false;
      for (let ty = y0_; ty <= y1_; ty++) for (let tx = x0_; tx <= x1_; tx++) {
        const j = ty * W + tx; if (kind[j] === 4) wallInBox = true;
        if (tx === ox && ty === oy) continue;
        if (food[j] < 0.2 || kind[j] !== want) continue;
        const dx = tx + 0.5 - px, dy = ty + 0.5 - py, d2 = dx * dx + dy * dy; if (d2 > R2) continue;
        cand.push([d2, j]);
      }
      cand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let bi = -1;
      for (const [, j] of cand) {
        const tx = j % W, ty = (j / W) | 0, blk = blockedRef(kind, px, py, tx + 0.5, ty + 0.5);
        if (x.visible_test(px, py, tx, ty) !== (blk ? 0 : 1)) visBad++;
        if (!wallInBox || !blk) { bi = j; break; }
      }
      queries++; if (bi >= 0) withHit++; if (cand.length && bi !== cand[0][1]) hidden++;
      if (x.nearest_test(px, py, R, want) !== bi) bad++;
    }
  }
  check('occlusion: nearest visible tile matches a plain scan with an exact line-of-sight test', bad === 0 && visBad === 0 && hidden > 100, queries + ' queries, ' + withHit + ' with a hit, ' + hidden + ' where the nearest tile was hidden, ' + bad + ' differences, ' + visBad + ' line-of-sight differences');
  // open map: occlude on and off give the same generation (stats and genomes)
  const run = occ => { const g = new Engine({ layout: 'handfar', maxE: 500, maxW: 500, startE: 500, startW: 500, memory: true, oscillator: true, oscPeriod: 200, genSpawn: 1, occlude: occ }, 3); g.genInit(3); let st; for (let k = 0; k < 3; k++) st = g.genRound(); const nw = g.x.genome_stride(); return { st, G: new Float32Array(g.mem, g.x.genome_ptr(), 200 * nw).slice() }; };
  const a = run(0), b = run(1);
  check('occlusion on a map without walls changes nothing (3 generations)', a.st.mean === b.st.mean && a.G.every((v, i) => v === b.G[i]), 'mean ' + a.st.mean.toFixed(3) + ' vs ' + b.st.mean.toFixed(3));
  // a cup: from outside a closed side the pond is hidden, from in front of the opening it is seen
  const c = new Engine({ layout: 'randpond', mapSeed: 3, pondMin: 30, pondSep: 16, walls: 5, wallGap: 3, genSpawn: 1, occlude: 1 }, 1), K = new Uint8Array(c.mem, c.x.kind_ptr(), W * H);
  c.x.rebuild_masks();
  let px = -1, py = -1; for (let i = 0; i < W * H && px < 0; i++) if (K[i] === 3) { px = i % W; py = (i / W) | 0; }
  const mids = [[px - 3, py + 3, -1, 0], [px + 9, py + 3, 1, 0], [px + 3, py - 3, 0, -1], [px + 3, py + 9, 0, 1]];
  let seenClosed = 0, closed = 0, seenOpen = 0, open = 0;
  for (const [mx, my, ux, uy] of mids) {
    const sx = mx + 2 * ux + 0.5, sy = my + 2 * uy + 0.5;   // two tiles outside the middle of the side
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
    const isOpen = K[my * W + mx] !== 4, hit = c.x.nearest_test(sx, sy, 5, 3) >= 0;
    if (isOpen) { open++; seenOpen += hit; } else { closed++; seenClosed += hit; }
  }
  c.setCfg('occlude', 0); let seenNoOcc = 0; for (const [mx, my, ux, uy] of mids) { const sx = mx + 2 * ux + 0.5, sy = my + 2 * uy + 0.5; if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue; seenNoOcc += c.x.nearest_test(sx, sy, 5, 3) >= 0; }
  check('occlusion: the pond is hidden behind a closed side of the ring and seen through the opening', open === 1 && seenOpen === 1 && closed >= 1 && seenClosed === 0 && seenNoOcc === open + closed, 'open sides ' + seenOpen + '/' + open + ' seen, closed sides ' + seenClosed + '/' + closed + ' seen, without occlusion ' + seenNoOcc + '/' + (open + closed));
}
// 12. save and load a population: a new engine with the loaded genomes reproduces the original's evaluation exactly
{
  const fs = require('fs'), cfg = { layout: 'randpond', mapSeed: 3, pondMin: 30, pondSep: 16, memory: true, oscillator: true, oscPeriod: 200, genSpawn: 1, maxE: 500, maxW: 500, startE: 500, startW: 500, genLen: 300 };
  const a = new Engine(cfg, 9); a.genInit(9); for (let g = 0; g < 8; g++) { a.setMap('randpond', 0, 20 + g, 2, 30, 0); a.genRound(); }
  const file = '/tmp/forager-test-pop.bin'; a.saveGenomes(file);
  const b = new Engine(cfg, 1); b.genInit(1); b.loadGenomes(file);
  let same = true; for (const m of [100, 101, 102]) { a.setMap('randpond', 0, m, 2, 30, 0); b.setMap('randpond', 0, m, 2, 30, 0); const sa = a.genRound(false), sb = b.genRound(false); if (sa.mean !== sb.mean || sa.drankShare !== sb.drankShare || sa.fullShare !== sb.fullShare || sa.score !== sb.score) same = false; }
  let bad = false; try { const c = new Engine(Object.assign({}, cfg, { hidden: 12 }), 1); c.genInit(1); c.loadGenomes(file); } catch (err) { bad = /does not fit/.test(String(err)); }
  check('a saved and reloaded population gives the same evaluation (3 maps, stats equal)', same);
  check('loading a population into an engine with another network shape is refused', bad);
  fs.unlinkSync(file);
}
console.log(failed ? failed + ' check(s) FAILED' : 'all checks passed');
process.exit(failed ? 1 : 0);
