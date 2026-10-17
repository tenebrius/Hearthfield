// Shell of the page: tabs, the WebAssembly engine in the browser, helpers shared by the views (Watch, Train, Findings, Roadmap).
// Load order: wasm/engine-core.js, wasm/trainer.js, forager-wasm.js, pops/pops.js, then this file and the view files.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const Lab = window.Lab = { views: {}, order: [] };

  Lab.el = function (tag, attrs, kids) {
    const n = document.createElement(tag);
    for (const k in attrs || {}) { if (k === 'text') n.textContent = attrs[k]; else if (k === 'html') n.innerHTML = attrs[k]; else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]); }
    for (const c of [].concat(kids || [])) if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  };
  Lab.store = {
    get(k) { try { return localStorage.getItem('forager.' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('forager.' + k, v); } catch (e) { /* storage blocked: the page still works */ } }
  };

  // ---- the engine in the browser ----
  const b64 = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  Lab.b64ToBytes = b64;
  Lab.bytesToB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  Lab.wasmBytes = b64(globalThis.FORAGER_WASM_B64);
  // browsers refuse a synchronous Module or Instance over 4 KB on the main thread, so everything here is asynchronous
  Lab.ready = WebAssembly.compile(Lab.wasmBytes).then(m => { Lab.module = m; });
  Lab.newEngine = async function (cfg, seed) {
    await Lab.ready;
    const inst = await WebAssembly.instantiate(Lab.module, {});
    return new ForagerEngine.Engine(cfg, seed, { exports: inst.exports, defaults: globalThis.FORAGER_DEFAULTS });
  };
  // engine plus a population: pop = { cfg, seed, bytes | b64 }; the settings are the ones the population was trained with
  Lab.engineForPop = async function (pop, overrides) {
    const cfg = Object.assign({}, pop.cfg, { layout: 'randpond', mapSeed: 1, walls: 0 }, overrides || {});
    const e = await Lab.newEngine(cfg, pop.seed);
    e.genInit(pop.seed);
    e.genomesFromBytes(pop.bytes || b64(pop.b64));   // throws a plain message if the network shape does not match
    return e;
  };
  Lab.pops = (globalThis.FORAGER_POPS || []).map(p => Object.assign({}, p, { bytes: null }));

  // ---- tabs ----
  Lab.registerView = function (id, title, impl) { Lab.views[id] = Object.assign({ id, title, inited: false }, impl); Lab.order.push(id); };
  Lab.show = function (id) {
    if (!Lab.views[id]) id = Lab.order[0];
    for (const k of Lab.order) {
      const v = Lab.views[k], sec = $('view-' + k), on = k === id;
      sec.hidden = !on;
      if (on && !v.inited) { v.inited = true; v.init && v.init(sec); }
      if (v.active !== on) { v.active = on; (on ? v.show : v.hide) && (on ? v.show : v.hide).call(v, sec); }
    }
    $('view-open').hidden = id !== 'open';
    if (id === 'open') window.dispatchEvent(new Event('resize'));
    for (const b of $('tabs').children) b.setAttribute('aria-current', b.dataset.view === id ? 'page' : 'false');
    Lab.current = id;
    Lab.store.set('view', id);
    try { history.replaceState(null, '', '#' + id); } catch (e) { /* file:// in some browsers */ }
  };
  Lab.boot = function () {
    Lab.registerView('open', 'Open world', {});
    const tabs = $('tabs');
    for (const id of Lab.order) tabs.appendChild(Lab.el('button', { 'data-view': id, onclick: () => Lab.show(id), text: Lab.views[id].title }));
    const h = (location.hash || '').slice(1), want = Lab.views[h] ? h : (Lab.views[Lab.store.get('view')] ? Lab.store.get('view') : Lab.order[0]);
    Lab.show(want);
    window.addEventListener('hashchange', () => { const x = location.hash.slice(1); if (Lab.views[x] && x !== Lab.current) Lab.show(x); });
  };
  // the view files call Lab.registerView; findings.js (last) calls Lab.boot() on DOMContentLoaded-safe timing
})();
