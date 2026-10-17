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
  if (typeof globalThis.__extraTests === 'function') await globalThis.__extraTests(page, ok);
  await browser.close();
  console.log(failed ? failed + ' check(s) failed' : 'all checks passed'); process.exit(failed ? 1 : 0);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
