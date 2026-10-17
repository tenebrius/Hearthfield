// Node wrapper for the WebAssembly simulation core (forager.wasm, source in forager.c). The engine itself lives in engine-core.js, which the browser page shares.
// Usage: const { Engine } = require('./engine'); const e = new Engine({ layout: 'handfar', lossE: 1.5 }, seed); e.step(1000);
// Defaults are read from the cfg object in ../forager-lab.html, so the page and the engine share one set of defaults.
const fs = require('fs'), path = require('path');
const core = require('./engine-core');

function pageDefaults() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'forager-lab.html'), 'utf8');
  const m = html.match(/var cfg = (\{[^;]*\});/);
  if (!m) throw new Error('could not find the cfg object in forager-lab.html');
  return new Function('return ' + m[1])();
}

let moduleCache = null;
class Engine extends core.Engine {
  constructor(overrides, seed) {
    if (!moduleCache) moduleCache = new WebAssembly.Module(fs.readFileSync(path.join(__dirname, 'forager.wasm')));
    super(overrides, seed, { module: moduleCache, defaults: pageDefaults() });
  }
  saveGenomes(file) { fs.writeFileSync(file, this.genomesToBytes()); }
  loadGenomes(file) { this.genomesFromBytes(new Uint8Array(fs.readFileSync(file))); }
}
module.exports = { Engine, randomPonds: core.randomPonds, CFG_KEYS: core.CFG_KEYS, W: core.W, H: core.H, CIRCLES: core.CIRCLES, CR: core.CR, pageDefaults };
