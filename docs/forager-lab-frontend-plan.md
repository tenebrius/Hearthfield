# Forager Lab: frontend plan (watch the dots, bring the page up to date)

Written 2026-10-17 for an implementing session (Sonnet) that has not seen the conversation. Read `docs/forager-lab-handoff.md` first (sections 1, 3, 5, 8), then this file. Work on branch `ccr-2e470314-s2yw51`; do not open a pull request unless asked.

## 0. Why, and what the user wants

The user has run about two weeks of experiments but has **never seen a trained dot move**; everything so far has been tables. The page `tools/forager-lab/forager-lab.html` still shows only the first phase (the open-ended world with births, its own JavaScript engine). Everything learned since (generational training, random ponds, walls and cups, occlusion, energy budgets, curricula, the foothold problem) lives only in the WebAssembly engine and Node runners.

The user asked for three things:
1. **Show the dots on the page**: watch trained populations live, on the maps they were tested on.
2. **Update the frontend with the new things**: generational mode, walls/cups, occlusion, budgets, curriculum, the findings.
3. **Overhaul where needed so the page can show what comes next**: the upcoming simulation upgrades (search changes such as bigger K, diversity, novelty; mixed budgets; memory decoding) should have a place to land without another rewrite.

The user's general preferences (they apply to the page too): understand why things work; avoid hand-picked parts; numbers with intervals; plain language; say when a claim was wrong. They plan to run this on their own PC (WSL) in about two days, so the page must work **opened locally** as well as as a published artifact.

## 1. Architecture decisions (made; do not re-litigate without a reason)

1. **One engine for everything new: the WebAssembly engine.** The page gets a browser build of the WASM wrapper. The open-ended mode keeps its existing inline JavaScript engine unchanged (porting it is not in scope; it is the archived first phase).
2. **Shared wrapper, Node and browser.** Split `wasm/engine.js` into:
   - `wasm/engine-core.js`: everything that does not need Node (`CFG_KEYS`, `mapRng`, `randomPonds`, `addWalls`, `buildMap`, `class Engine`, `genRoundMulti`, views, positions). It takes the compiled `WebAssembly.Module` and the default cfg object as constructor inputs. Written as a UMD-style file: `module.exports = ...` when `module` exists, else `globalThis.ForagerEngine = ...`.
   - `wasm/engine.js`: the Node wrapper. Reads `forager.wasm` and the page defaults from disk (as now), re-exports the same names, adds `saveGenomes(file)` / `loadGenomes(file)` (Buffer and fs). **Every existing runner must keep working unchanged and give bit-identical output** (gate in section 5).
   - Add `genomesToBytes()` / `genomesFromBytes(u8)` to the core (no fs), and let the Node `saveGenomes`/`loadGenomes` use them. Same file format as today: 16-byte header (uint32 LE population, uint32 LE stride, 8 bytes zero) then float32 genomes.
3. **No fetch of local files.** Browsers block `fetch()` from `file://`, and artifacts are simplest with few files. So a small Node script `tools/forager-lab/mkbundle.js` writes:
   - `tools/forager-lab/forager-wasm.js`: `globalThis.FORAGER_WASM_B64 = "<base64 of forager.wasm>";` (about 56 KB).
   - `tools/forager-lab/pops/pops.js`: `globalThis.FORAGER_POPS = [{ id, title, story, cfg, seed, testNumbers, b64 }, ...]` for the showcase populations (section 3; about 330 KB each in base64; keep the total under 3 MB).
   The page loads `wasm/engine-core.js`, `forager-wasm.js`, `pops/pops.js` with plain `<script src>` tags, which works from `file://`, a local server, and an artifact (publish them via `files`). Rerun `mkbundle.js` after every engine rebuild; a test checks the bundle matches `forager.wasm` (section 5).
4. **Training in the browser runs in a Web Worker** so the page stays responsive. Worker code goes in `tools/forager-lab/train-worker.js` (loaded with `new Worker('train-worker.js')`; on `file://` some browsers block workers: detect the failure and fall back to running a few generations per animation frame on the main thread, with a visible note).
5. **No framework, no build tool.** Plain HTML, CSS, JS like the current page. Charts as small canvas or inline SVG (the page already has `drawLine`). Keep the page's existing colour tokens and dark mode.
6. **Single page with views (tabs), not several pages.** Views: **Watch** (default), **Train**, **Findings**, **Roadmap**, **Open world** (the current page content, unchanged). The tab bar remembers the last view in `localStorage` (wrapped in try/catch).

## 2. The views

### 2.1 Watch (default view): trained dots, live

Purpose: see what a trained population does on a held-out map.

- **Population picker**: one card per showcase population (section 3), each with a one-line story ("learned cups at a generous budget", "never discovered drinking", ...) and its test numbers from training (drank on cups, full round, survived, with seed).
- **Map controls**: map seed (held-out seeds start at 1000000, as in the tests; buttons "previous map", "next map", "random map"), map type matching the population (cups on/off). Changing the map restarts the round.
- **Round controls**: play/pause, step 1 tick, speed (ticks per frame, 1 to 50), restart round, a tick counter out of the round length (1000).
- **Rendering** on a 64×64 canvas scaled to fit: ground, food tiles shaded by amount, water tiles shaded by amount, wall tiles dark. Dots as small circles; colour by state: healthy, low energy, low hydration (two cues, not colour alone: add a small ring or shape for "low"). Dead dots: a faded cross where they died, with the cause (starved if energy ≤ 0 at death, else thirsty; the engine keeps `ae`/`aw` after death; `views().ae`, `views().aw`, `views().gdead`). Optional faint trails (toggle, last 30 positions per dot).
- **Live counters**: alive, drank at least once so far, inside a cup ring now, died of thirst, died of hunger. For cups: count a dot as "inside" when its tile is within a ring's 13×13 square (rings: from the map's pond list; expose it from `buildMap`).
- **Click a dot** to follow it: highlight, show energy and hydration bars, its 4 memory registers as small bars, its current outputs (move x/y, eat, memory gates), and its brain diagram (reuse the page's SVG brain view, adapted to the WASM genome layout: `layout_info(0..4)`, `act_ptr`, `genome_stride`, weights from `genome_ptr`; see how `run-memfreeze.js`/`run-memdump.js` read genomes). Draw its sight radius; with occlusion on, shade tiles it cannot see (a small JS copy of the engine's line-of-sight rule is fine for display; label it "display approximation" if it is not bit-identical).
  - Memory and outputs per dot: check how `run-memdump.js` gets the register values. If it needs an engine change, add read-only exports (`mem_ptr` for the `MEM` array, and per-dot last outputs if needed). Adding exports must not change results (gate in section 5).
- **What-if switches** on the same population, applied live (via `setCfg` or by rebuilding the map): energy loss (0.75, 1.0, 1.25, 1.5), walls on/off (cups vs the same map open), occlusion on/off, memory off (the ablation). Each switch shows a one-line explanation of the finding it demonstrates (for example "Energy loss: this is the budget frontier; at 1.25 or above a cup trip costs about as much as the energy store").
- **Run 20 maps**: a button that evaluates the population on the 20 held-out maps without animation and prints survived / full / drank, which must equal the training run's test numbers for an unchanged population (shown next to them; this is the proof that the page runs the same engine).

### 2.2 Train: evolution live, in the browser

Purpose: watch learning happen, including the failures (the foothold).

- **Presets** mirroring the experiments (each preset is a cfg plus a stage list): "Cups with the curriculum" (pond distances 16, 22, 28, 36, then until drinking starts, then cups), "Cups, no curriculum" (cups from generation 1), "Tight budget" (loss 1.5), "Open map, basic drinking". Show the settings each preset uses; let the user edit seed, K (maps per generation), energy loss, sight, occlusion, population size.
- **Stage logic**: move the stage machine of `run-multi.js` into a shared module `wasm/trainer.js` (pure JS: given the engine, cfg and options, run stages generation by generation and yield per-generation stats) and make `run-multi.js` use it. Gate: `run-multi.js` must reproduce committed raw lines exactly (section 5). If that refactor gets hairy, stop and instead write a separate, simpler stage machine for the page, and say so in the docs; do not change `run-multi.js` output.
- **Live charts** per generation: mean ticks survived, share that drank, share that survived the full round (and on cup maps, the cup-map numbers). Mark stage changes on the x axis. Show the thirst wall (833 at stores of 500 and hydration loss 0.6) as a reference line on the survival chart, so a stuck population reads as "flat at the wall".
- **Watch now**: at any point, copy the current genomes from the worker and open them in the Watch view (same renderer).
- **Save/load population**: download the genomes as a `.bin` file in the same format as `saveGenomes` plus a `.json` of settings; load such a pair (from `run-multi.js` `saveTo` or from this page) into Watch. This is how populations trained on the PC with Node get into the page.
- **Speed**: show generations per second and an estimate of time to finish. Expect roughly 1 to 4 generations per second in one worker with K = 3 (measure; the 4-core container did one run-multi run of about 1800 generations in 7 to 8 minutes while running four at once).

### 2.3 Findings: what we learned, each with "watch it"

A short, plain-language summary of the main findings, each as a card with the key numbers and interval, a small chart where it helps, and a **"Watch it"** button that opens the matching showcase population in Watch with the right switches. Source: `docs/forager-lab-handoff.md` section 6 and the last four sections of `docs/forager-lab-generational-plan.md`. At least:
1. Budgets decide outcomes (thirst wall 833 ticks; the energy budget limits pond trips).
2. Budget frontier for cups: 72 / 49 / 31 / 28% drank at loss 0.75 / 1.0 / 1.25 / 1.5 (sight 12 + occlusion; the 0.75 and 1.5 values are from earlier batches).
3. Sight and occlusion help only at loose budgets (+19 points at loss 1.0, +5 at 1.25).
4. The hand-made cup aids are not needed (67 vs 69% drank, 8 seeds each).
5. Without any curriculum 4 of 8 seeds never start drinking (stuck at 833 ticks, also after 3000 generations); the four that start learn cups as well as with the curriculum. Include the per-seed chart (`docs/forager-lab-nocurriculum-seeds.png` data, redrawn in the page).
6. Memory is used as real state, but what it stores is unknown.
Each card says what the result does **not** show (the caveats in the plan file), in one line.

### 2.4 Roadmap: what comes next, and where it will show

A data-driven list (`ROADMAP` array in the page: id, title, question, status `done | next | later`, which view it will appear in, and the switch or preset it will add). Items now:
- done: watch trained dots (this plan).
- next: search changes that need no task knowledge to fix the foothold: bigger K (6, 10), larger population, diversity preservation, novelty search. Each becomes a Train option and a preset.
- next: trace a stuck vs a working seed for the first 100 generations ("never found" vs "found and lost").
- later: mixed budgets per generation (one brain for several budgets); memory decoding (Watch gets a register-over-time plot for the followed dot, and the page shows the decoded meaning if found); wall sense at loss 1.0; open plus cup maps from the start (labelled as a fixed training mix, not "no curriculum").
Design the Train options panel so a new option (a boolean or a number with a label and one-line explanation) is one entry in an options table, not new HTML by hand. The Roadmap card for an item links to that option once it exists.

### 2.5 Open world

The current page content, unchanged in behaviour, moved under its tab. Keep `mkharness.py` working (it extracts the inline script by a regular expression `<script>\n(.*)</script>` and the `var cfg = {...};` object; `engine.js` `pageDefaults()` also reads that `cfg` object). If the restructure moves or splits the script, update `mkharness.py` and `pageDefaults()` and check both (section 5).

## 3. Showcase populations (generate, commit, bundle)

Train with `run-multi.js` and `"saveTo"` (writes `<file>` and `<file>.json`), into `tools/forager-lab/pops/` (commit the `.bin` and `.json` files; about 250 KB each). Use the exact job-script configs from the scratch scripts reproduced in `docs/forager-lab-generational-plan.md`; the commands below are the starting point; check them against the raw files.

| id | story | config (all: genSpawn 1, memory, stores 500, oscillator 200, pondSep 16, K = 3) | seed | expected test (must match) |
|---|---|---|---|---|
| `cups-075` | learned cups at a generous budget | lossE 0.75, sight 12, occlude 1, cupGaps [3,3,3], cupMixes [1,2,3], secureDrink 0.8, cupExit 0.99, cupStageCap 300, finalGens 700 | 1 | the `help s1` line in `docs/forager-lab-ablation-raw.txt` (drank 78%) |
| `nocurr-stuck` | never discovered drinking | lossE 0.75, sight 12, occlude 1, noCurriculum 1, cupGaps [3], cupStageCap 1, finalGens 1500 | 1 | `g1500 s1` in `docs/forager-lab-nocurriculum-raw.txt` (0%, 833 ticks) |
| `nocurr-ok` | learned cups without any curriculum | same as above | 2 | `g1500 s2` (75%) |
| `budget-125` | at a tight budget, cups barely pay | lossE 1.25, sight 12, occlude 1, cupGaps [3,3,3], cupMixes [1,2,3], secureDrink 0.8, cupExit 0.99, cupStageCap 300, finalGens 700 | 1 | `L1.25 S12 s1` in `docs/forager-lab-budget-frontier-raw.txt` |
| `sight5-10` | short sight, loss 1.0 | lossE 1.0, sight 5, occlude 0, same schedule | 1 | `L1.0 S5 s1` in the frontier raw file |

Gate: each saved run's FINAL line must equal the committed raw line for that seed and setting (the engine is deterministic; any difference means the config is not the one that was run, so find out why before going on). Then `run-load.js <file> 20 3` must report the same test survival and drinking as the FINAL line's `TEST_BARS_*`. Budget: 5 runs in parallel take about 10 to 15 minutes on the 4-core container. **The container is reclaimed when the session goes idle**: run batches while staying in the turn (foreground wait loops of under 10 minutes each), or they die part way (happened twice on 2026-10-16).

## 4. Work order (phases), with what "done" means

| Phase | Work | Done when | Rough time |
|---|---|---|---|
| A | Split `engine.js` into `engine-core.js` + Node wrapper; add byte (de)serialisers; add read-only exports if needed for memory/outputs; rebuild | all gates in section 5 pass; no runner changed output | 1 to 2 h |
| B | Showcase populations (section 3); `mkbundle.js`; `forager-wasm.js`, `pops/pops.js` | FINAL lines match raw files; bundle test passes | 0.5 to 1 h (mostly waiting) |
| C | Page shell: tab bar, Open world moved under its tab, `mkharness.py`/`pageDefaults()` still work | Open world behaves as before; `node run.js` example gives the same output as before the change | 1 h |
| D | Watch view (section 2.1) | 20-map evaluation in the page equals the training run's test numbers for each showcase population | 3 to 5 h |
| E | Train view with worker (section 2.2); `trainer.js` shared with `run-multi.js` | run-multi reproduces raw lines; a short in-browser run of a preset matches the same run in Node generation by generation (same seed: same stats) | 3 to 5 h |
| F | Findings and Roadmap views (2.3, 2.4) | every card's numbers trace to a doc line; every "Watch it" opens the right population | 1 to 2 h |
| G | Publish the artifact; update the handoff | artifact shows all views; handoff section 3 no longer calls the page stale | 0.5 h |

Do phases in order; commit and push after each phase (the stop hook requires a clean, pushed tree). If time is short, A to D is the priority (the user's first ask is seeing the dots).

## 5. Gates (run them; paste the output into the commit message or the doc, do not summarise from memory)

1. `node wasm/test-wasm.js` passes (all groups).
2. Standard check: `node wasm/run-gen.js '{"maxE":500,"maxW":500,"startE":500,"startW":500,"memory":true,"oscillator":true,"oscPeriod":200,"genSpawn":1}' 1 1000 1000` ends at LAST20_MEAN_SCORE 905, drank 87%, full 52%. Read the whole line.
3. `run-multi.js` reproduction: rerun at least two committed raw lines exactly, one with cups and the curriculum (`help s1` from the ablation raw file) and one with `noCurriculum` (`g1500 s2`). Diff the FINAL lines character by character. Do this after phase A and again after phase E.
4. Page/engine identity: in a headless browser (Playwright is installed; Chromium at `/opt/pw-browsers`, do not run `playwright install`), load the page, run the 20-map evaluation of `cups-075` and compare to the Node `run-load.js` numbers. Add this as `tools/forager-lab/test-page.js`.
5. Bundle check (part of `test-page.js` or `test-wasm.js`): the base64 in `forager-wasm.js` decodes to the same bytes as `wasm/forager.wasm`.
6. Open world unchanged: `node run.js '{"layout":"circles","lossW":0,"lossE":1,"layers":2}' 1 100000 50000` gives the same lines before and after phase C (save the "before" output first).
7. Layout: screenshot each view at 1400 px and 390 px wide (Playwright) and look at them: no horizontal scroll at phone width, no overlapping labels. Dark mode via `prefers-color-scheme` emulation.

## 6. Artifact publishing notes

- The old artifact is https://claude.ai/artifact/9xTrayZPNYBxB127nBKxmR (version 33, stale). Read it with the Artifact tool (`action: "read"`) before publishing to the same URL; publish the page with `files` for `wasm/engine-core.js`, `forager-wasm.js`, `pops/pops.js`, `train-worker.js` (published paths must match the `<script src>` paths in the page).
- External scripts only from cdnjs, jsdelivr, unpkg (exact versions) if any are used; fonts only from Google Fonts (the page already uses IBM Plex from there). Keep everything else inline or in the published files.
- Keep the page under 16 MB including files (the bundle should be about 2 MB).

## 7. Things to watch out for

- `CFG_KEYS` order must match `enum Cfg` in `forager.c` (the engine checks the count only, not the order).
- `pageDefaults()` reads `var cfg = {...};` from the HTML with a regular expression; generational defaults are added in the `Engine` constructor. If the page's `cfg` object moves or changes, every Node runner changes too. Keep it byte-identical unless a gate shows otherwise.
- `wallSense`, `occlude`, `sight`, `memory`, `oscillator` change the genome layout or inputs; a saved population must be run with the settings in its `.json`. The page must refuse (with a clear message) to load a population whose stride does not match.
- Evaluation without breeding uses no random numbers for the options used so far, so replays are exact; the open-ended mode and anything with `memNoise` or `latch` are not.
- Speed in the browser: one round of 200 dots for 1000 ticks is the unit; drawing every tick at speed 50 is fine on canvas, but do not rebuild the brain SVG every tick (update it at most 10 times per second).
- Plain language in all page text; numbers with their interval or seed count; no model names anywhere in the repo or the page.
