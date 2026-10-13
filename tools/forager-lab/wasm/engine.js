// Node wrapper for the WebAssembly simulation core (forager.wasm, source in forager.c).
// Usage: const { Engine } = require('./engine'); const e = new Engine({ layout: 'handfar', lossE: 1.5 }, seed); e.step(1000);
// Defaults are read from the cfg object in ../forager-lab.html, so the page and the engine share one set of defaults.
const fs = require('fs'), path = require('path');
const W = 64, H = 64;
// same order as enum Cfg in forager.c (the engine checks the count)
const CFG_KEYS = ['regrow', 'waterRegrow', 'lossE', 'lossW', 'moveE', 'moveW', 'gainE', 'gainW', 'maxE', 'maxW',
  'startE', 'startW', 'reqE', 'reqW', 'payE', 'payW', 'kidE', 'kidW', 'stepLen', 'cooldown',
  'sight', 'hidden', 'layers', 'memory', 'position', 'noise', 'age', 'feedback', 'tumble',
  'tumbleEvery', 'inertia', 'mutRate', 'mutSize', 'baseline', 'floorN', 'maxPop', 'brainMomentum', 'genP', 'genLen', 'genElite', 'genTourn', 'genXover', 'genSpawn', 'genWSurv', 'genWFood', 'genWWater', 'genScoreMode', 'oscillator', 'latch', 'oscPeriod'];
const CIRCLES = [[W * 0.75, H * 0.25], [W * 0.25, H * 0.75]], CR = 9;

function pageDefaults() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'forager-lab.html'), 'utf8');
  const m = html.match(/var cfg = (\{[^;]*\});/);
  if (!m) throw new Error('could not find the cfg object in forager-lab.html');
  return new Function('return ' + m[1])();
}

function buildMap(layout, shift) {
  const kind = new Uint8Array(W * H), fert = new Float32Array(W * H);
  if (!['circles', 'handmade', 'handfar', 'handnear', 'handcurr'].includes(layout)) throw new Error('layout "' + layout + '" is not supported by the WASM engine (use circles, handmade, handfar, handnear or handcurr)');
  for (let i = 0; i < W * H; i++) {
    const px = i % W + 0.5, py = Math.floor(i / W) + 0.5;
    for (const c of CIRCLES) { const dx = px - c[0], dy = py - c[1]; if (dx * dx + dy * dy <= CR * CR) { kind[i] = 1; fert[i] = 0.8; } }
  }
  if (layout !== 'circles') {
    const lerp = (a, b, t) => Math.round(a + (b - a) * t), t = shift || 0;
    // handcurr: ponds slide from touching the food circles (t = 0, same as handnear) out to the corners (t = 1, same as handfar)
    const ponds = layout === 'handfar' ? [[2, 2], [55, 55]] : layout === 'handnear' ? [[45, 26], [13, 32]] : layout === 'handcurr' ? [[lerp(45, 55, t), lerp(26, 55, t)], [lerp(13, 2, t), lerp(32, 2, t)]] : [[13, 13], [45, 45]];
    for (const p of ponds) for (let y = p[1]; y < p[1] + 7; y++) for (let x = p[0]; x < p[0] + 7; x++) { kind[y * W + x] = 3; fert[y * W + x] = 0.8; }
  }
  return { kind, fert };
}

let moduleCache = null;
class Engine {
  constructor(overrides, seed) {
    this.cfg = Object.assign(pageDefaults(), { genP: 200, genLen: 1000, genElite: 2, genTourn: 3, genXover: 0, genSpawn: 0, genWSurv: 1, genWFood: 0, genWWater: 0, genScoreMode: 0, pondShift: 0, oscPeriod: 0 }, overrides || {});
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
    this.setMap(this.cfg.layout, this.cfg.pondShift);
    this.seed = seed;
    x.init_world(seed >>> 0);
  }
  // replace the map between rounds without touching the dots (used by the curriculum runner)
  setMap(layout, shift) {
    const map = buildMap(layout, shift);
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
  genRound() {
    this.x.gen_round();
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
module.exports = { Engine, CFG_KEYS, W, H, CIRCLES, CR, pageDefaults };
