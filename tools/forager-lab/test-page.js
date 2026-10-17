// Browser checks (Playwright, Chromium from /opt/pw-browsers or PW_CHROMIUM): node test-page.js [--quick]
//  1. the bundled wasm bytes equal wasm/forager.wasm and mkbundle.js output is up to date
//  2. every view opens without a page error
//  3. Watch: "Run 20 maps" on a showcase population gives the same numbers as the training run and as run-load.js in Node
//  4. (not --quick) every showcase population reproduces its training test numbers in the page
//  5. Train: a short run of a preset in the page gives the same generation stats as the same run in Node (same seed)
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
let pw; for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(p); break; } catch (e) { /* try next */ } }
if (!pw) { console.log('playwright not found'); process.exit(2); }
const here = __dirname, quick = process.argv.includes('--quick');
let failed = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++; };
(async () => {
  try { execFileSync('node', [path.join(here, 'mkbundle.js'), '--check'], { stdio: 'pipe' }); ok(true, 'bundle files are up to date with forager.wasm, the page defaults and the populations'); }
  catch (e) { ok(false, 'bundle files are out of date: run node mkbundle.js'); }
  const exe = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await pw.chromium.launch(fs.existsSync(exe) ? { executablePath: exe } : {});
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(here, 'forager-lab.html') + '#watch');
  await page.waitForFunction(() => window.Lab && Lab.watch && Lab.watch.S.e, null, { timeout: 30000 });
  const wasm = fs.readFileSync(path.join(here, 'wasm', 'forager.wasm'));
  const same = await page.evaluate(b => { const u = Lab.wasmBytes; if (u.length !== b.length) return false; for (let i = 0; i < u.length; i++) if (u[i] !== b[i]) return false; return true; }, Array.from(wasm));
  ok(same, 'the base64 in forager-wasm.js decodes to the same bytes as wasm/forager.wasm');
  for (const v of ['train', 'findings', 'roadmap', 'open', 'watch']) { await page.evaluate(v2 => Lab.show(v2), v); await page.waitForTimeout(300); }
  ok(errors.length === 0, 'all views open without a page error' + (errors.length ? ': ' + errors[0] : ''));
  const ids = quick ? ['cups-075'] : await page.evaluate(() => Lab.pops.map(p => p.id));
  for (const id of ids) {
    const r = await page.evaluate(async id2 => { const p = Lab.pops.find(q => q.id === id2); await Lab.watch.selectPop(p); Lab.watch.setPlaying(false); await Lab.watch.runEval(); return { last: Lab.watch.S.last, test: p.test }; }, id);
    const t = r.test, got = r.last.res;
    ok(r.last.same, 'Watch ' + id + ': 20 held-out maps in the page = training run (cups ' + got.cups.ticks + ' ticks, ' + got.cups.full + '% full, ' + got.cups.drank + '% drank; open ' + got.open.ticks + ', ' + got.open.full + '%, ' + got.open.drank + '%)');
    if (id === 'cups-075') {
      const out = execFileSync('node', [path.join(here, 'wasm', 'run-load.js'), path.join(here, 'pops', id + '.bin'), '20', '3'], { encoding: 'utf8' }), j = JSON.parse(out.slice(out.indexOf('{')));
      ok(Math.round(j.survived) === +got.cups.ticks && Math.round(j.drank) === +got.cups.drank, 'run-load.js in Node agrees with the page (survived ' + Math.round(j.survived) + ', drank ' + Math.round(j.drank) + '%)');
    }
  }
  // Findings: per-seed data equals the raw file; every Watch button names a showcase population and opens it with its switches
  const raw = fs.readFileSync(path.join(here, '..', '..', 'docs', 'forager-lab-nocurriculum-raw.txt'), 'utf8').split('\n').filter(l => / FINAL seed /.test(l));
  const pick = tag => [1, 2, 3, 4, 5, 6, 7, 8].map(s => +raw.find(l => l.startsWith(tag + ' s' + s + ' ')).match(/TEST_BARS_DRANK (\d+)%/)[1]);
  const data = await page.evaluate(() => ({ n: Lab.data.NOCURR, w: Lab.data.FINDINGS.flatMap(f => (f.watch || []).map(w => w.pop)), p: Lab.pops.map(p => p.id) }));
  ok(JSON.stringify(data.n.g1500) === JSON.stringify(pick('g1500')) && JSON.stringify(data.n.g3000) === JSON.stringify(pick('g3000')), 'Findings: per-seed data equals docs/forager-lab-nocurriculum-raw.txt');
  ok(data.w.every(id => data.p.includes(id)), 'Findings: every Watch button names a showcase population');
  await page.evaluate(() => Lab.show('findings'));
  await page.click('#f-transfer .actions button');
  await page.waitForFunction(() => Lab.current === 'watch' && Lab.watch.S.pop && Lab.watch.S.sw.loss === '1.5' && Lab.watch.S.e && Lab.watch.S.e.cfg.lossE === 1.5, null, { timeout: 15000 });
  ok(true, 'Findings: "Watch loss 0.75 dots at 1.5" opens cups-075 with energy loss 1.5');
  // 5. in-page training equals Node training, generation by generation (same seed, same settings)
  const { Engine } = require('./wasm/engine'), T = require('./wasm/trainer');
  const BASE = { genSpawn: 1, memory: true, maxE: 500, maxW: 500, startE: 500, startW: 500, oscillator: true, oscPeriod: 200, pondSep: 16 };
  const jobs = [
    { name: 'cups without curriculum', seed: 5, cfg: Object.assign({}, BASE, { cupGaps: [3], cupStageCap: 1, noCurriculum: 1, lossE: 0.75, sight: 12, occlude: 1 }), opts: { K: 2, finalGens: 4 } },
    { name: 'open map with the pond stages', seed: 3, cfg: Object.assign({}, BASE, { lossE: 1.5, sight: 5, genP: 60 }), opts: { K: 2, finalGens: 3, maxFirst: 3, maxStage: 3, drinkCap: 3 } }
  ];
  const nodeRun = job => {
    const cfg = Object.assign({}, T.RUN_DEFAULTS, job.cfg), e = new Engine(Object.assign({}, cfg, { layout: 'randpond', mapSeed: 1, walls: 0 }), job.seed); e.genInit(job.seed);
    const gens = []; let tests = null;
    for (const ev of T.train(e, cfg, job.opts)) if (ev.type === 'gen') gens.push([ev.stats.mean, ev.stats.fullShare, ev.stats.drankShare]);
    const t = T.evaluate(e, cfg); tests = [t.wb.ticks, t.wb.full, t.wb.drank, t.nb.ticks, t.nb.full, t.nb.drank];
    return { gens, tests, genomes: Buffer.from(e.genomesToBytes()).toString('base64') };
  };
  const pageRun = (pg, job) => pg.evaluate(job2 => new Promise((resolve, reject) => {
    const gens = []; let tests = null, runner;
    runner = ForagerRunner.make(m => {
      if (m.type === 'gen') gens.push([m.mean, m.full, m.drank]);
      else if (m.type === 'tests') { tests = [(m.cups || m.bars).ticks, (m.cups || m.bars).full, (m.cups || m.bars).drank, m.open.ticks, m.open.full, m.open.drank]; runner.handle({ cmd: 'snapshot', ref: 1 }); }
      else if (m.type === 'snapshot') { let s = ''; for (let i = 0; i < m.bytes.length; i++) s += String.fromCharCode(m.bytes[i]); resolve({ gens, tests, genomes: btoa(s) }); }
      else if (m.type === 'error') reject(new Error(m.message));
    });
    runner.handle({ cmd: 'start', cfg: job2.cfg, opts: job2.opts, seed: job2.seed });
  }), job);
  for (const job of jobs) {
    const n = nodeRun(job), p = await pageRun(page, job);
    ok(JSON.stringify(n.gens) === JSON.stringify(p.gens) && JSON.stringify(n.tests) === JSON.stringify(p.tests) && n.genomes === p.genomes, 'Train in the page = Node, ' + job.name + ' (' + n.gens.length + ' generations: stats, test numbers and the final genomes are identical)');
  }
  // 6. a real Web Worker (needs http: browsers refuse workers from file://): run a short preset through the Train tab
  const http = require('http'), mime = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };
  const srv = http.createServer((q, r) => { const f = path.join(here, decodeURIComponent(q.url.split('?')[0].split('#')[0]).replace(/^\/$/, '/forager-lab.html')); if (!f.startsWith(here) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
  await new Promise(r => srv.listen(0, r));
  const pg2 = await browser.newPage(), errs2 = []; pg2.on('pageerror', e => errs2.push(e.message));
  await pg2.goto('http://127.0.0.1:' + srv.address().port + '/forager-lab.html#train');
  await pg2.waitForFunction(() => window.Lab && Lab.train, null, { timeout: 30000 });
  const job = jobs[0];   // the 'Cups, no curriculum' preset with seed 5, K 2 and 4 final generations (what the panel can set)
  await pg2.evaluate(j => { Lab.train.choose(Lab.train.PRESETS[1]); Object.assign(Lab.train.V, { seed: j.seed, K: j.opts.K, finalGens: j.opts.finalGens }); document.getElementById('t-start').click(); }, job);
  await pg2.waitForFunction(() => Lab.train.run && Lab.train.run.tests, null, { timeout: 120000 });
  const wr = await pg2.evaluate(() => ({ gens: Lab.train.run.points.map(p => [p.mean, p.full, p.drank]), where: document.getElementById('t-where').textContent }));
  ok(/background worker/.test(wr.where), 'Train over http uses a Web Worker');
  ok(errs2.length === 0, 'no page errors in the worker run' + (errs2[0] ? ': ' + errs2[0] : ''));
  const nrun = nodeRun(Object.assign({}, job, { opts: Object.assign({}, job.opts) }));
  ok(JSON.stringify(wr.gens) === JSON.stringify(nrun.gens), 'Train in a Web Worker = Node generation by generation (' + wr.gens.length + ' generations)');
  srv.close();
  await browser.close();
  console.log(failed ? failed + ' check(s) failed' : 'all checks passed'); process.exit(failed ? 1 : 0);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
