# Forager Lab: handoff

Written 2026-10-13; consolidated 2026-10-16 after a long run of experiments. Meant to be read cold by someone (or a fresh Claude session) who has none of the conversation. Result tables, per-seed numbers and every correction are in `docs/forager-lab-generational-plan.md` (long; in the order the experiments were run); the older step-by-step plan is `docs/forager-lab-next-plan.md` (its steps 1 to 6 are done; this file's section 7 says what is next).

## 1. What this is, and where it stands

Forager Lab is a small simulation for learning how far evolved neural networks can go without hand-written behaviour. Dots live on a 64×64 map, must eat food and drink water to stay alive, and their brains (small neural networks, about 300 weights) are evolved by selection. It started as an exploration for the Hearthfield settlement game (`docs/version-1-specification.md`, `docs/expansion-plan.md`); the user has put Hearthfield aside and treats Forager Lab as a learning project in its own right.

The user's stated aims, which should guide choices:
- Learn how this works; understand why things work, not just that they do.
- Avoid hand-picked, "opinionated" parts. If a setting has to be tuned by hand for each world, it is a weak solution; the dots or evolution should find it ("self-solving").
- Wants numbers, intervals or tests, and a time estimate before long runs. Likes being told when a claim turns out wrong (it happened often; section 6 lists the corrections).

**Where it stands, in six sentences.**
1. What decides outcomes is mostly the world's budgets, not the brains: the thirst wall (store ÷ hydration loss), food and water supply (3000-tick rounds), and the energy budget (a pond trip costs about as many ticks as the energy store lasts).
2. Dots that never drink die at the thirst wall; a cycling clock (fixed or brain-set oscillator) is what gets drinking started reliably, and a hand-picked period is not needed.
3. Learning fails at the first foothold, not at refining a skill: scoring each dot on 3 random maps per generation instead of 1 removes most of that, and obstacles must be added only once drinking is secure.
4. Memory registers are used as real state (freezing them costs 130 to 320 ticks) but no simple quantity explains them.
5. Navigation: wall rings ("cups") around the ponds defeat sliding; they are learnable once the energy budget allows (loss 0.75 instead of 1.5), better with long sight plus occlusion, and a wall-sensing input then helps modestly and is used in every seed.
6. Not solved: dots trained with a generous energy budget do not transfer to a tight one, and a generous-to-tight curriculum did not fix that.

## 2. Running locally or in the cloud

Most sessions ran in a Claude Code cloud container (4 cores, clang and wasm-ld installed, scratch files under `/tmp/claude-0/...`); the user's organization has disabled Remote Control, so a local session means running `claude` directly in WSL. Everything is on branch `ccr-2e470314-s2yw51` of `tenebrius/hearthfield`. Do not create a pull request unless the user asks.

```sh
git clone https://github.com/tenebrius/hearthfield.git && cd hearthfield
git checkout ccr-2e470314-s2yw51
cd tools/forager-lab
node wasm/test-wasm.js     # engine checks; needs Node 18 or later
```

- **Check the engine reproduces before trusting a local number:** `node wasm/run-gen.js '{"maxE":500,"maxW":500,"startE":500,"startW":500,"memory":true,"oscillator":true,"oscPeriod":200,"genSpawn":1}' 1 1000 1000` must end at LAST20_MEAN_SCORE 905, drank 87%, full 52% (read the whole line). WebAssembly should be deterministic across machines; if the numbers differ, stop and find out why. Nothing has been run outside the cloud container yet.
- **Rebuilding the engine** (after editing `forager.c`): `sudo apt install clang lld`, then `wasm/build.sh`. The committed `forager.wasm` is enough otherwise.
- **Batches:** the `xargs -P4` and bash job-script pattern (section 4) works in WSL; set `-P` to your core count. Run long batches from the WSL filesystem (`~/...`), not `/mnt/c/...`. Timings in this document are for a 4-core cloud container.

## 3. Repository map

| Path | What it is |
|---|---|
| `tools/forager-lab/forager-lab.html` | The interactive page (open in a browser). Open-ended mode only; the published artifact (https://claude.ai/artifact/9xTrayZPNYBxB127nBKxmR, version 33) is **stale**. Walls, occlusion and the generational mode are not in the page. |
| `wasm/forager.c`, `forager.wasm` | The fast engine (C compiled to WebAssembly, about 42 KB). Open-ended and generational modes. Rebuild with `wasm/build.sh`. |
| `wasm/engine.js` | Node wrapper and map builder (layouts, walls); defaults come from the `cfg` object in the HTML; `CFG_KEYS` must keep the order of `enum Cfg` in `forager.c`. Also `genRoundMulti`, `saveGenomes`, `loadGenomes`. |
| `wasm/test-wasm.js` | Engine checks (about 15 groups: tanh/log accuracy, nearest-tile search against a plain scan, forward pass, crossover, clocks, walls, cups, occlusion, K-layout scoring, save/load, memory inputs). Run after every engine change. |
| `wasm/run-gen.js` | Generational runner (the basic experiment tool). |
| `run-curriculum.js`, `run-objective.js`, `run-ablate.js`, `run-trace.js` | Pond curriculum; drinking-first objective; ablation of an input after training; tick-by-tick trace (death cause, thirst cycle). |
| `run-rand.js`, `run-rand-curriculum.js` | Random-pond training with held-out test maps; curriculum into random ponds. |
| `run-multi.js` | **The main tool of the later work.** Random-pond curriculum with every dot scored on K layouts per generation, real task until drinking starts, then bars or cups, held-out tests. Options in its header comment: `cupGaps`, `cupMixes`, `cupFacings`, `secureDrink`, `wallSense`, `gateWalls`, `lossSteps`, `altLossE`, `traceCups`, `saveTo`. |
| `run-walls.js`, `run-walltrace.js`, `run-randwalls.js` | Fixed-map walls (open map then walls with a narrowing gap); where dots meet walls; random bars curriculum. |
| `run-cuptrace.js`, `cupreplay.js`, `run-load.js`, `diag-cups.js` | What dots do at cup rings (arrival side, entry, exit, deaths), split by where the opening is; examine a saved population in seconds (`run-load.js <file> [maps] [gap] [firstMap] [settings JSON]`); generation-by-generation diagnostic. |
| `run-memfreeze.js`, `run-memdump.js`, `analyze-mem.py` | Memory ablations (zero, freeze at an age, noise); dump register values; regress them on candidate explanations. |
| `run-foothold.js` | Foothold traces (why populations fail to start drinking). |
| `run-wasm.js`, `tools/forager-lab/run.js`, `mkharness.py` | Open-ended runners (WASM and the slower JavaScript reference harness). |
| `docs/forager-lab-generational-plan.md` | All result tables, in order. `docs/forager-lab-next-plan.md`: the step plan (done). `docs/forager-lab-open-ended-results.md`: archive of the first phase. |

## 4. How to run things

```sh
cd tools/forager-lab
node wasm/test-wasm.js                         # engine checks
wasm/build.sh                                  # after editing forager.c
node wasm/run-gen.js '<cfg json>' <seed> <generations> <report every N>
node wasm/run-multi.js '<cfg json>' <seed> [K=1] [finalGens=500] [maxStage=400] [needFull=0.15] [maxFirst=1000] [drinkCap=2000] [drinkStart=0.25]
node wasm/run-load.js <population file> [maps=20] [gap=3] [firstMap=1000000] ['{"lossE":0.75}']
node wasm/run-memfreeze.js '<cfg json>' <seed> <gens> [freezeAges=25,100,400] [evalRounds=10]
```
(The other runners' usage is in their header comments.) The standard setup of most experiments: `genSpawn` 1 (start in the centre), `memory` true, `maxE`, `maxW`, `startE`, `startW` all 500 ("stores of 500"), `oscillator` true with `oscPeriod` 200, 200 dots, 1000-tick rounds, energy loss 1.5, hydration loss 0.6, two hidden layers of 8, survival score. The last line of a `run-gen.js` run (`FINAL ...`) gives means over the last 20 generations. Tests in `run-multi.js` are on 20 held-out map seeds (1000000 and up) with and without walls.

Running batches (lessons):
- Launch batches as a tracked background command (`run_in_background`, maximum timeout 7200000 ms) running `xargs -P4`; detached `nohup` batches were killed part way. Do not pass JSON through `xargs`; use a job script that maps a short tag to a config. After a container restart job scripts can lose their executable bit (the batch then fails instantly with "Permission denied" while the task reports completed): `chmod +x` them and check with `ps aux | grep run-` a few seconds after launching.
- Check the command a job script really runs (a `sed` on `"walls":1` misses `\"walls\":1` in an embedded JSON; this once produced an invalid control). Read check output in full: a regression check printed through `cut` once hid a broken engine build (memory inputs zeroed; test 10 in `test-wasm.js` now guards that).
- Cost on the 4-core container: a 1000-generation run of the standard setup is about 25 to 50 s alone; a `run-multi.js` run with K = 3 and about 1800 generations about 7 to 8 minutes with four in parallel; 3000-tick rounds are 3 times as long. My time estimates were often off by 30% or much more; give a range. `pkill -x node` and `pkill -x xargs`, not `pkill -f`.
- Save populations (`saveTo`) when a run will be examined several ways; re-training to examine it costs minutes per seed.
- Every engine change must keep results bit-identical unless intended: standard check above, `test-wasm.js`, and one `run-multi.js` run compared line by line (the faster tile search once passed the standard check but changed `run-multi.js`).

## 5. Current design

**World.** 64×64 tiles; food and water tiles regrow (0.03 per tick times fertility 0.8; `regrow`, `waterRegrow`). Layouts: `handfar` (ponds in the far corners; the main fixed map), `handnear`, `handcurr` (ponds slide near to far), `circles`, `handmade`, `randpond` (food circles fixed, `pondN` 7×7 ponds at random by map seed, at least `pondMin` tiles from the food, `pondSep` minimum distance between ponds). **Walls** (kind 4, block movement, dots slide along them): `walls` 1 corner cups on the far ponds, 2 long walls, 3 hostile long walls, 4 `wallN` random bars of `wallLen`, 5 **cups** (a square ring 3 tiles around each pond with one opening of `wallGap` tiles on a random side; `cupFacing` biases the opening towards the food). `occlude`: food and water behind a wall tile are not seen. Walls and occlusion are in the WASM engine only.

**Dot.** Energy and hydration fall every tick (`lossE` 1.5, `lossW` 0.6; moving costs `moveE` extra), refilled by eating or drinking a tile (30 times the tile's amount, capped at the store), death at zero. Thirst wall = store ÷ hydration loss (500 ÷ 0.6 = 833 ticks); energy wall (500 ÷ 1.5 about 330 ticks, less when moving).

**Brain.** Fully connected, two hidden layers of 8 tanh neurons, weights mutated with rate 0.1 and size 0.2, no crossover by default. In the standard setup 19 inputs are active (0 to 10, memory 11 to 14, position 15 and 16, oscillator 23 and 24) and 11 outputs: 304 weights. Inputs whose option is off are 0 and have no weights.

| Index | Input | Option |
|---|---|---|
| 0, 1 | food, water on own tile | always |
| 2–4, 5–7 | nearest food / water: direction x, y, closeness (`sight`, default 5; tiles under 0.2 ignored) | always |
| 8, 9 | energy, hydration (÷ store, capped at 1) | always |
| 10 | bias | always |
| 11–14 | memory registers | `memory` |
| 15, 16 | x, y position | `position` (on by default) |
| 17 | random number | `noise` |
| 18, 19 | last move blocked; last eat result | `feedback` |
| 20, 21 | wander heading | `tumble` |
| 22 | age | `age`, `ageScale` |
| 23, 24 | oscillator sine, cosine | `oscillator`, `oscPeriod` (fixed) or brain-set period |
| 25, 26 | latch values | `latch` |
| 27–32 | age thermometer | `ageTherm`, `thermMode` |
| 33 | time since timer reset | `timer` |
| 34–36 | nearest wall tile: direction x, y, closeness | `wallSense` (`gateWalls` in runners: its weights stay 0 until the first walled stage) |

Outputs: move x, move y, eat/drink (above 0 = eat instead of move); with memory, four new memory values and four gates; then, only when enabled and in this order: momentum, latch trigger, oscillator period (unless fixed or a gene), thermometer outputs, timer reset. An input whose option is switched off after training writes 0 (the ablations before 2026-10-14 used a frozen last value instead).

**Generational mode.** 200 dots on a fresh map each round, no splitting. Score = ticks survived (`genWSurv` 1; food and water terms exist, default 0). Tournament of 3, best 2 kept, optional crossover. Measured but not rewarded: share surviving the whole round ("full"), share that drank at least once ("drank"). **K layouts** (`genRoundMulti` in `engine.js`, `K` in `run-multi.js`): every dot plays K maps and is scored on the mean, then bred once.

## 6. Findings

Details, tables and per-seed numbers are in the generational plan file. Seeds per cell are given where it matters; many comparisons are 4 to 8 seeds.

**A. What decides outcomes: the world's budgets**
- Evolution beats random movers (about 150 against 78 ticks on the far map). The thirst wall decides almost everything: dots that never drink die at store ÷ hydration loss. No building block (memory, wander heading, momentum, noise, age, latch) changed that at stores of 100. Bigger stores move the wall (store 200, 300, 500: 320, 481, 819 survived).
- 3000-tick rounds hit a supply ceiling, not a brain limit: fixed 200 survived 1222 of 3000 with 10% lasting the round at regrowth 0.03; water regrowth 0.1 gave 46% full, water and food 0.1 gave 69% (6 seeds).
- **The energy budget limits what a pond trip can pay.** In cup worlds a trip plus the time in the ring costs about as many ticks as the energy store lasts (about 330 at loss 1.5). The same trained dots with half the energy loss: drinkers that survive 21% to 59%, deaths inside the ring 67% to 30%. Training at loss 0.75 makes cups learnable (see D); loss 1.0 is where dots still do well; at 1.5 cups are barely worth entering.

**B. Clocks and time signals**
- A cycling clock is what the task was missing: at stores of 500 an oscillator raises the full-round share from about 8% to 34% (brain-set period) or 45% (fixed 300); 24 seeds. The trace: with a clock a third to a half of the dots are at a pond by tick 100 to 200, long before thirst, then return; without one they stay on food until thirst arrives.
- Fixed period best at 200 to 300 (50% and 45% full), worse at 100, 500, 800. Across three worlds the brain-set oscillator was within 2%, 6% and 2% of each world's best fixed period with no period chosen by hand; the clock gene was worse; the resettable timer did not help. Time signals do not stack (oscillator, linear age, thermometer: no better than the best one); the age counter helps only with a linear encoding.
- With the supply fixed (3000 ticks, regrowth 0.1, 16 seeds) a clock buys reliability of getting started, not a higher level: no clock 2106 and 12 of 16 seeds learn to drink; fixed 200 2462 and brain-set 2489, 16 of 16 (the no-clock seeds that learn do as well as clocked ones).
- Pond curriculum (ponds walk from touching the food to the far corners) with stores of 500: fixed 200 / brain-set / gene clock + timer reach 893 / 911 / 915 against 887 / 871 / 836 trained directly (1000 generations), so self-tuning clocks catch up to the hand-picked one.

**C. Learning dynamics: footholds, noise, curricula**
- Populations that fail to drink on random far ponds stay on the food (85% to 90% on food at ticks 300 and 600) and lose their weak drinking; who gets the first foothold looks random per seed. Scoring each dot on the mean of **K = 3** random layouts per generation instead of 1 fixes most of it (16 seeds): 16 of 16 seeds drink (15 of 16), sooner (median 28 against 67 real-task generations), held-out survival 896 / 41% full against 812 / 10% (+84 ticks, 95% interval +62 to +105); a compute control (K = 1 with three times the final generations) gained only a third of that. K = 3 is the default for random worlds.
- Random ponds: dots trained on the fixed map keep much of their skill on random ponds (832 against 892); training on random ponds from scratch rarely learns to drink; a curriculum into random ponds gets 12 of 16 seeds drinking. Outcomes are often two-valued per seed: report seeds that learned first.
- Obstacles added before drinking is secure wipe it out (cups: 36 of 36 runs; random bars: 1 to 5 of 8 keep drinking against 7 of 8 without), and 4000 more generations do not rescue failed seeds. Mixed training (1, 2, then 3 of the 3 maps being cups) protects open-map drinking.

**D. Navigation: walls and cups**
- On the fixed map, dots that learned the open map keep most of their skill when walls arrive gradually (corner cups 887 to 865, 50% to 36% full), mostly by sliding into the gap (trace: about 90% hit the vertical arm first and slide to the gap); nothing learns with walls from scratch. 14-tile bars are handled by sliding, so they test nothing.
- **Cups** (ring around each pond, one 3-tile opening): sliding cannot solve them (open-map dots 63% to 6% full at 1000 ticks). At the tight energy budget (loss 1.5) no schedule taught them (plain curriculum, secure foothold, 3000 ticks, rotating opening, mixed maps, occlusion): cup drinking stayed at 10% to 45%.
- At the **loose budget (loss 0.75, 4 seeds per setup)** cups are learned: held-out cups sight 5 no occlusion 893 survived / 22% full / 51% drank; sight 12 no occlusion 909 / 27% / 62%; sight 12 with occlusion 931 / 42% / 72% (at loss 1.5: 818 / 0% / 1%, 816 / 2% / 11%, 854 / 6% / 28%, 8 seeds each for the last). Sight and occlusion add on top of the budget. Occlusion's effect grows with sight (entry from a closed side +6, +13, +19 points at sight 5, 8, 12). Dots reach the open side first only at chance (22% to 25%) in every setup.
- **Dots do not transfer back to the tight budget** (685 to 735 ticks at loss 1.5, below a food-sitter's 833), and a generous-to-tight curriculum (0.75, 1.0, 1.25, 1.5) ended at the same level as dots trained straight at 1.5.
- Drinkers die inside rings at the same rate whatever side the opening is on (67%, 68%, 65%); getting in does depend on it (52% against 33% for the far side from the food). 68% of dots that get in leave again.
- **The wall sense** (3 inputs: nearest wall tile) never mattered at the tight budget. At loss 0.75 in the plain world (sight 5, no occlusion) it raises cup drinking by 12.5 points [+6.0, +18.8] and cup survival by 10 ticks [+1.7, +18.3] over 12 seeds (wins 9 of 12; the bar I had set was 10 of 12), no change in the full-round share, open-map drinking 3 points lower; switching it off after training lowers cup drinking in 12 of 12 seeds by 30 points on average, so the dots find a use for it every time. With sight 12 and occlusion it adds little and lowers the full-round share (4 seeds).

**E. Memory**
- The four registers are used as state: zeroing costs 284 ticks, freezing from age 25 / 100 / 400 costs 322 / 277 / 130 (16 seeds), replacing them by fresh noise recovers only 39 of the 284. A linear model of hydration, energy, time since drink or meal, oscillator phase, position and distances explains about 8% of a register's variance; they sit at ±1 half the time and flip every 5 to 12 ticks; each seed invents its own encoding. What they store is not known.

**F. Speed and engine**
- Engine about 1.28 times faster and bit-identical (profile: forward pass 40%, nearest-tile searches 21%, sense 17%); threads, native build and smaller populations were judged not worth it. Populations can be saved and loaded (a loaded population reproduces evaluations exactly).

**G. Open-ended mode** (archive file): a wander heading made evolved dots colonise a second food area (4 of 4 seeds against 2 of 4); on the far-ponds map with momentum 0.7 wander + memory is best (155 against 116, 64 seeds); brain-controlled momentum matches the best hand-picked value.

**Suggestive only (8 seeds or fewer)**
- Thermometer variants and lower clock-gene mutation made no difference. Latch + oscillator was the worst clock combination (unexplained). Dots drinking inside a cup survive less than the budget alone would suggest (only 20% to 43% of drinkers survive at loss 1.5).

**Withdrawn or corrected during the work** (so nobody relies on them)
- Early headless-harness results were wrong (a stub set every slider to 1); discarded.
- "Age does not help": wrong, it was the encoding. "The linear age gives a last-minute crowd at the ponds": withdrawn (averaged only seeds with survivors). "The brain-set oscillator falls short because its period wobbles": not supported (the gene clock has none and did no better). "The gene clock finds each world's best period": not supported (per seed the period is either short or long, both do well).
- The earlier "random input does not help" result (open-ended) was unreliable (shared random number bug, fixed). The ablations of age, oscillator, latch, wander and thermometer before 2026-10-14 fed a frozen value instead of 0; their conclusions probably stand.
- **Steps 4 to 6 first concluded that cups were limited by what the dots can sense and by the training schedule.** That was wrong: the binding constraint was the energy budget (A and D). Explanations I proposed along the way and the traces refuted: cups pay too little for a failed trip to be cheap; a cup is a dead end that dots do not leave (68% leave); the exit fails when the opening faces away from the food (no difference by direction).
- A note said the position inputs are off in generational runs; they are on (page default), so the dots always know where they are on the map.
- An engine bug (zeroed memory inputs, introduced with the noise ablation) invalidated one test run; fixed and covered by a test.

## 7. Open questions and next steps

1. **Budget frontier: measured** (see the last section of the generational plan). Sight 12 + occlusion cup drinking: 72 (0.75), 49 (1.0), 31 (1.25), 28 (1.5); at sight 5 it stays 26 to 30 for loss >= 1.0. The frontier is between 1.0 and 1.25. Still open: does the wall sense matter at loss 1.0?
2. **Why do dots trained with a generous budget not economise?** At loss 1.5 they die earlier than a food-sitter. Ideas: train on a mix of budgets per generation (like K layouts), or give the dots no cue to the budget (they cannot see `lossE`; they see energy ÷ store only).
3. **Ablation done (loss 0.75, sight 12 + occlusion, 8 seeds):** none of the hand-made cup aids (secureDrink stage, mix ramp, early exit) is needed; training on cups only from the start gives 67% vs 69% drank. See the last section of the generational plan. Open: do they matter at loss 1.0, and with the drinking-start stage removed?
4. **Rerun at the loose budget what failed at the tight one:** the rotating-opening curriculum and the wall sense in more settings (loss 1.0), random bars, and the hostile long walls.
4. **Occlusion setups with more seeds:** the 0.75 results are 4 seeds per setup.
5. Why a short gene period (10 to 50 ticks) works as well as a long one; why latch + oscillator is worse than either; what the memory registers store (regress on the dot's last N actions, or train with fewer registers).
6. **Put the generational mode, walls and a replay of trained dots meeting a cup into the page**, and republish the artifact (the user has not seen the dots move, only tables).
7. Remaining code-review items for the open-ended mode (archive file): pinned tiles after "Clear map", island size read live during relocation, relocation can erase water, memory-off freezes registers instead of blanking them. Hearthfield itself is untouched.

Rules for every batch: 8 seeds before 16 (add seeds only if the interval is inconclusive); report seeds that learned first, means second, paired bootstrap intervals for differences; a 4-run pilot with a trace before a batch for anything new; record per-seed numbers and say when a claim turned out wrong.

## 8. Things to know before trusting a number

- The WASM engine reproduces the page's JavaScript only statistically (24 seeds), not seed for seed, and has deliberate differences (own tanh, polar Gaussian, sparse weights, f32 SIMD forward pass). Results from the open-ended chapter were produced by the JavaScript harness. Within the same engine build the same settings reproduce exactly (checked many times; `run-multi.js` with the same seed gives the same lines).
- Outcomes are often two-valued per seed (stuck near food, or good), so means mislead; with 8 seeds the standard error is about 12 to 20 ticks and differences under about 30 ticks should not be ranked. One setup showed 41% against 50% full on the open map before any walls existed (random draws alone).
- Genome layout changed as options were added (inputs 18, 22, 23, 27, 33, 34, 37; outputs 11 to 21 plus a gene); saved page configs from earlier versions load with new options off but do not reproduce old runs. A saved population file only loads into an engine with the same network shape (`run-multi.js` writes the settings next to it).
- "Is a feature used" is tested by switching it off after training and re-evaluating (`run-ablate.js`, `run-memfreeze.js`, `ABL_` lines); the memory results show a feature can be used and still not be explained by any simple quantity.
- The population files in the scratch area (`/tmp/claude-0/pops*`) are not in the repository; they are reproduced exactly by rerunning the same `run-multi.js` command with `saveTo`.
