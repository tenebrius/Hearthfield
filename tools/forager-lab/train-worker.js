// Runs a training run (wasm/trainer.js) off the page's main thread. Used two ways with the same code:
//   as a Web Worker:  new Worker('train-worker.js')  (imports the engine files itself)
//   on the main thread (file:// in browsers that refuse workers): ForagerRunner.make(post) after the page loaded the same scripts.
// Messages to the runner:  { cmd: 'start', cfg, opts, seed, id } | { cmd: 'pause' } | { cmd: 'resume' } | { cmd: 'stop' } | { cmd: 'snapshot', ref }
// Messages from the runner: { type: 'started' } | { type: 'gen', ... } | { type: 'stage', ... } | { type: 'done', ... } | { type: 'tests', ... } | { type: 'snapshot', ref, bytes, cfg, seed, total } | { type: 'error', message }
(function (root) {
  'use strict';
  if (typeof importScripts === 'function') importScripts('wasm/engine-core.js', 'wasm/trainer.js', 'forager-wasm.js');
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let modulePromise = null;
  function compiled() {
    if (!modulePromise) {
      const bin = atob(root.FORAGER_WASM_B64), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      modulePromise = WebAssembly.compile(u);
    }
    return modulePromise;
  }
  async function newEngine(cfg, seed) {
    const inst = await WebAssembly.instantiate(await compiled(), {});
    return new root.ForagerEngine.Engine(cfg, seed, { exports: inst.exports, defaults: root.FORAGER_DEFAULTS });
  }
  function make(post) {
    const T = root.ForagerTrainer;
    let st = null, serial = 0;
    const slim = s => ({ mean: s.mean, fullShare: s.fullShare, drankShare: s.drankShare, best: s.best });
    async function start(m) {
      const my = ++serial; st = null;
      try {
        const cfg = Object.assign({}, T.RUN_DEFAULTS, m.cfg), e = await newEngine(Object.assign({}, cfg, { layout: 'randpond', mapSeed: 1, walls: 0 }), m.seed);
        if (my !== serial) return;
        e.genInit(m.seed);
        st = { e, cfg, seed: m.seed, opts: m.opts, it: T.train(e, cfg, m.opts), paused: false, stopped: false, my, total: 0, t0: now(), timer: 0, finished: false };
        post({ type: 'started', cfg, seed: m.seed });
        pump(st);
      } catch (err) { post({ type: 'error', message: err.message }); }
    }
    function pump(s) {
      s.timer = 0;
      if (s !== st || s.paused || s.stopped || s.finished) return;
      try {
        const t0 = now();
        while (now() - t0 < 40) {
          const r = s.it.next();
          if (r.done) { s.finished = true; break; }
          const ev = r.value;
          if (ev.type === 'gen') {
            s.total = ev.total;
            const x = ev.stats, o = { type: 'gen', stage: ev.stage, g: ev.g, cap: ev.cap, total: ev.total, mean: x.mean, full: x.fullShare, drank: x.drankShare, elapsed: now() - s.t0 };
            if (ev.cups) { o.cupMean = x.cupMean; o.cupFull = x.cupFull; o.cupDrank = x.cupDrank; }
            post(o);
          } else if (ev.type === 'stage') {
            const a = k => ev.last.reduce((q, y) => q + (y[k] || 0), 0) / ev.last.length, o = { type: 'stage', label: ev.label, g: ev.g, total: ev.total, mean: a('mean'), full: a('fullShare'), drank: a('drankShare') };
            if (ev.last[0] && ev.last[0].cupDrank != null) { o.cupMean = a('cupMean'); o.cupFull = a('cupFull'); o.cupDrank = a('cupDrank'); }
            post(o);
          } else if (ev.type === 'done') {
            post({ type: 'done', started: ev.started, total: ev.total });
            const t = T.evaluate(s.e, s.cfg);
            post({ type: 'tests', cups: s.cfg.cupGaps ? t.wb : null, open: t.nb, bars: s.cfg.cupGaps ? null : t.wb, facing: t.fc, total: ev.total });
          }
        }
      } catch (err) { s.stopped = true; post({ type: 'error', message: err.message }); return; }
      if (!s.finished) s.timer = setTimeout(() => pump(s), 0);
    }
    return {
      handle(m) {
        if (m.cmd === 'start') start(m);
        else if (!st) { if (m.cmd === 'snapshot') post({ type: 'snapshot', ref: m.ref, error: 'no run yet' }); }
        else if (m.cmd === 'pause') st.paused = true;
        else if (m.cmd === 'resume') { if (st.paused) { st.paused = false; if (!st.timer) pump(st); } }
        else if (m.cmd === 'stop') { st.stopped = true; clearTimeout(st.timer); }
        else if (m.cmd === 'snapshot') { const bytes = st.e.genomesToBytes(); post({ type: 'snapshot', ref: m.ref, bytes, cfg: st.cfg, seed: st.seed, total: st.total }, [bytes.buffer]); }
      }
    };
  }
  root.ForagerRunner = { make, newEngine };
  if (typeof importScripts === 'function') { const r = make((m, tr) => root.postMessage(m, tr || [])); root.onmessage = e => r.handle(e.data); }
})(typeof globalThis !== 'undefined' ? globalThis : self);
