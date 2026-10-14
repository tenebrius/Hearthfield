// Node wrapper for the WebAssembly simulation core (forager.wasm, source in forager.c).
// Usage: const { Engine } = require('./engine'); const e = new Engine({ layout: 'handfar', lossE: 1.5 }, seed); e.step(1000);
// Defaults are read from the cfg object in ../forager-lab.html, so the page and the engine share one set of defaults.
const fs = require('fs'), path = require('path');
const W = 64, H = 64;
// same order as enum Cfg in forager.c (the engine checks the count)
const CFG_KEYS = ['regrow', 'waterRegrow', 'lossE', 'lossW', 'moveE', 'moveW', 'gainE', 'gainW', 'maxE', 'maxW',
  'startE', 'startW', 'reqE', 'reqW', 'payE', 'payW', 'kidE', 'kidW', 'stepLen', 'cooldown',
  'sight', 'hidden', 'layers', 'memory', 'position', 'noise', 'age', 'feedback', 'tumble',
  'tumbleEvery', 'inertia', 'mutRate', 'mutSize', 'baseline', 'floorN', 'maxPop', 'brainMomentum', 'genP', 'genLen', 'genElite', 'genTourn', 'genXover', 'genSpawn', 'genWSurv', 'genWFood', 'genWWater', 'genScoreMode', 'oscillator', 'latch', 'oscPeriod', 'ageScale', 'ageTherm', 'thermMode', 'oscGene', 'timer', 'geneMut', 'wallSense'];
const CIRCLES = [[W * 0.75, H * 0.25], [W * 0.25, H * 0.75]], CR = 9;

function pageDefaults() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'forager-lab.html'), 'utf8');
  const m = html.match(/var cfg = (\{[^;]*\});/);
  if (!m) throw new Error('could not find the cfg object in forager-lab.html');
  return new Function('return ' + m[1])();
}

// small seeded generator for map layouts (separate from the engine's own random streams)
function mapRng(seed) { let a = seed >>> 0; return () => { a += 0x6D2B79F5; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// randpond: the food circles stay where they are; `n` 7x7 ponds are placed at random, each at least `minDist` tiles
// (centre to centre) from both food circle centres (and, with maxDist, within maxDist of the nearer one), and not touching each other. Same mapSeed gives the same layout.
function randomPonds(mapSeed, n, minDist, maxDist) {
  const r = mapRng(mapSeed * 2654435761 + 12345), out = [];
  for (let tries = 0; out.length < n; tries++) {
    if (tries > 10000) throw new Error('could not place ponds with minDist ' + minDist);
    const x = Math.floor(r() * (W - 6)), y = Math.floor(r() * (H - 6)), cx = x + 3.5, cy = y + 3.5;
    const near = Math.min(...CIRCLES.map(c => Math.hypot(cx - c[0], cy - c[1])));   // distance to the nearer food centre
    if (near < minDist || (maxDist && near > maxDist)) continue;
    if (out.some(p => Math.max(Math.abs(p[0] - x), Math.abs(p[1] - y)) < 8)) continue;
    out.push([x, y]);
  }
  return out;
}

// walls = 1 ("corner cups", meant for the far-corners ponds): an L-shaped wall around each far pond, a horizontal arm along y = 10 and a vertical arm along x = 10
// (mirrored for the other corner), with a gap `wallGap` tiles wide centred on the pond in the vertical arm. Wall tiles (kind 4) block movement and hold no food or water.
function addWalls(kind, fert, walls, gap) {
  if (!walls) return;
  if (walls !== 1) throw new Error('walls must be 0 or 1');
  const g = Math.max(0, Math.min(9, Math.round(gap == null ? 3 : gap))), lo = 5 - Math.floor(g / 2), hi = lo + g;   // open rows lo .. hi - 1 of the vertical arm
  const put = (x, y) => { kind[y * W + x] = 4; fert[y * W + x] = 0; };
  for (let k = 0; k <= 10; k++) {
    put(k, 10); put(W - 1 - k, W - 1 - 10);                                      // horizontal arms
    if (!(k >= lo && k < hi) || k === 0 || k === 10) { put(10, k); put(W - 1 - 10, H - 1 - k); }   // vertical arms, except the gap
  }
}

function buildMap(layout, shift, mapSeed, pondN, pondMin, pondMax, walls, wallGap) {
  const kind = new Uint8Array(W * H), fert = new Float32Array(W * H);
  if (!['circles', 'handmade', 'handfar', 'handnear', 'handcurr', 'randpond'].includes(layout)) throw new Error('layout "' + layout + '" is not supported by the WASM engine (use circles, handmade, handfar, handnear, handcurr or randpond)');
  for (let i = 0; i < W * H; i++) {
    const px = i % W + 0.5, py = Math.floor(i / W) + 0.5;
    for (const c of CIRCLES) { const dx = px - c[0], dy = py - c[1]; if (dx * dx + dy * dy <= CR * CR) { kind[i] = 1; fert[i] = 0.8; } }
  }
  if (layout !== 'circles') {
    const lerp = (a, b, t) => Math.round(a + (b - a) * t), t = shift || 0;
    // handcurr: ponds slide from touching the food circles (t = 0, same as handnear) out to the corners (t = 1, same as handfar)
    const ponds = layout === 'randpond' ? randomPonds(mapSeed || 0, pondN || 2, pondMin || 30, pondMax || 0) : layout === 'handfar' ? [[2, 2], [55, 55]] : layout === 'handnear' ? [[45, 26], [13, 32]] : layout === 'handcurr' ? [[lerp(45, 55, t), lerp(26, 55, t)], [lerp(13, 2, t), lerp(32, 2, t)]] : [[13, 13], [45, 45]];
    for (const p of ponds) for (let y = p[1]; y < p[1] + 7; y++) for (let x = p[0]; x < p[0] + 7; x++) { kind[y * W + x] = 3; fert[y * W + x] = 0.8; }
  }
  addWalls(kind, fert, walls, wallGap);
  return { kind, fert };
}

let moduleCache = null;
class Engine {
  constructor(overrides, seed) {
    this.cfg = Object.assign(pageDefaults(), { genP: 200, genLen: 1000, genElite: 2, genTourn: 3, genXover: 0, genSpawn: 0, genWSurv: 1, genWFood: 0, genWWater: 0, genScoreMode: 0, pondShift: 0, oscPeriod: 0, ageScale: 0, ageTherm: 0, thermMode: 0, oscGene: 0, timer: 0, geneMut: 0.25, wallSense: 0, walls: 0, wallGap: 3 }, overrides || {});
    if (this.cfg.shiftEvery > 0) throw new Error('food relocation (shiftEvery) is not supported by the WASM engine');
    if (this.cfg.archive) throw new Error('"newcomers copy parents" (archive) is not supported by the WASM engine');
    if (this.cfg.maxPop > 2000) throw new Error('maxPop above 2000 is not supported');
    if (!moduleCache) moduleCache = new WebAssembly.Module(fs.readFileSync(path.join(__dirname, 'forager.wasm')));
    const x = this.x = new WebAssembly.Instance(moduleCache, {}).exports;
    if (x.cfg_count() !== CFG_KEYS.length) throw new Error('config key list is out of sync with forager.c');
    const mem = x.memory.buffer;
    this.mem = mem;
    const c = new Float64Array(mem, x.cfg_ptr(), 64);
    CFG_KEYS.forEach((k, i) => { c[i] = +this.cfg[k]; });
    this.setMap(this.cfg.layout, this.cfg.pondShift, this.cfg.mapSeed, this.cfg.pondN, this.cfg.pondMin, this.cfg.pondMax, this.cfg.walls, this.cfg.wallGap);
    this.seed = seed;
    x.init_world(seed >>> 0);
  }
  // replace the map between rounds without touching the dots (used by the curriculum runner)
  // randpond takes a mapSeed (which layout), pondN (number of ponds, default 2) and pondMin (minimum distance from the food, default 30), pondMax (optional: ponds no farther than this from the nearer food centre)
  setMap(layout, shift, mapSeed, pondN, pondMin, pondMax, walls, wallGap) {
    // walls and wallGap default to the engine's cfg values, so curriculum runners that call setMap keep the walls
    const map = buildMap(layout, shift, mapSeed, pondN, pondMin, pondMax, walls === undefined ? this.cfg.walls : walls, wallGap === undefined ? this.cfg.wallGap : wallGap);
    new Uint8Array(this.mem, this.x.kind_ptr(), W * H).set(map.kind);
    new Float32Array(this.mem, this.x.fert_ptr(), W * H).set(map.fert);
  }
  // change a setting between rounds (for example the score weights); the key must be one of CFG_KEYS
  setCfg(key, value) {
    const i = CFG_KEYS.indexOf(key); if (i < 0) throw new Error('unknown setting ' + key);
    new Float64Array(this.mem, this.x.cfg_ptr(), 64)[i] = +value; this.cfg[key] = value;
  }
  step(n) { this.x.step(n); }
  // generational mode: genInit(seed) once, then genRound() per generation; stats describe the generation just evaluated
  genInit(seed) { this.x.gen_init(seed >>> 0); }
  // stepwise round for tracing: genBegin(), then genTick(t) once per tick (returns how many dots are alive), then genEnd(breed)
  genBegin() { this.x.gen_begin(); }
  genTick(t) { return this.x.gen_tick(t); }
  genEnd(breed) {
    this.x.gen_end(breed === false ? 0 : 1);
    const s = new Float64Array(this.mem, this.x.gen_stats_ptr(), 24);
    return { gen: s[0], best: s[1], mean: s[2], median: s[3], fullShare: s[4], food: s[5], water: s[6], pondShare: s[7], bothShare: s[8], diversity: s[9], aliveAtEnd: s[10], score: s[11], drankShare: s[12] };
  }
  // the clock gene of every dot (log2 of its oscillator period), generational mode; only meaningful with oscGene on
  geneValues() {
    const x = this.x, nw = x.genome_stride(), go = x.gene_off(), G = new Float32Array(this.mem, x.genome_ptr(), 2048 * nw), out = [];
    for (let s = 0; s < this.cfg.genP; s++) out.push(G[s * nw + go]);
    return out;
  }
  // typed views of per-dot state (index = dot slot, 0 to genP - 1 in generational mode)
  views() {
    const x = this.x, m = this.mem, n = 2048;
    return { ord: new Int32Array(m, x.ord_ptr(), n), ax: new Float64Array(m, x.ax_ptr(), n), ay: new Float64Array(m, x.ay_ptr(), n), ae: new Float64Array(m, x.ae_ptr(), n), aw: new Float64Array(m, x.aw_ptr(), n),
      aper: new Float64Array(m, x.aper_ptr(), n), gfood: new Float64Array(m, x.gfood_ptr(), n), gwater: new Float64Array(m, x.gwater_ptr(), n), gdead: new Int32Array(m, x.gdead_ptr(), n) };
  }
  genRound(breed) {
    this.x.gen_round_ex(breed === false ? 0 : 1);
    const s = new Float64Array(this.mem, this.x.gen_stats_ptr(), 24);
    return { gen: s[0], best: s[1], mean: s[2], median: s[3], fullShare: s[4], food: s[5], water: s[6], pondShare: s[7], bothShare: s[8], diversity: s[9], aliveAtEnd: s[10], score: s[11], drankShare: s[12] };
  }
  get pop() { return this.x.n_agents(); }
  stats() { const x = this.x; return { tick: x.tick(), pop: x.n_agents(), born: x.born(), starved: x.starved(), thirsty: x.thirsty() }; }
  // positions of all living dots, in the order the engine updates them
  positions() {
    const x = this.x, n = x.n_agents();
    const ord = new Int32Array(this.mem, x.ord_ptr(), n), ax = new Float64Array(this.mem, x.ax_ptr(), 2048), ay = new Float64Array(this.mem, x.ay_ptr(), 2048);
    const out = [];
    for (let i = 0; i < n; i++) out.push([ax[ord[i]], ay[ord[i]]]);
    return out;
  }
  // how many dots stand within r tiles of each food circle centre
  occupancy(r) {
    const o = [0, 0];
    for (const p of this.positions()) CIRCLES.forEach((c, k) => { if (Math.hypot(p[0] - c[0], p[1] - c[1]) <= (r || CR + 3)) o[k]++; });
    return o;
  }
}
module.exports = { Engine, randomPonds, CFG_KEYS, W, H, CIRCLES, CR, pageDefaults };
