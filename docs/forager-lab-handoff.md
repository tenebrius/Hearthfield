# Forager Lab: handoff

Written 2026-10-13 and updated 2026-10-14 (random ponds, longer rounds, resource supply, walls, foothold traces, K-layout scoring) and 2026-10-15 (clocks in 3000-tick rounds, cups, memory decoding; next session: speed-ups). It is meant to be read cold by someone (or a fresh Claude session) who has none of the conversation.

## 1. What this is

Forager Lab is a small simulation for learning how far evolved neural networks can go without hand-written behaviour. Dots live on a 64×64 map, must eat food and drink water to stay alive, and their brains (small neural networks) are evolved by selection. It started as an exploration for the Hearthfield settlement game (`docs/version-1-specification.md`, `docs/expansion-plan.md`); the user has put Hearthfield aside and is treating Forager Lab as a learning project in its own right.

The user's stated aims, which should guide choices:
- Learn how this works; understand why things work, not just that they do.
- Avoid hand-picked, "opinionated" parts. If a setting has to be tuned by hand for each world, it is a weak solution; the dots or evolution should find it ("self-solving").
- Wants results with numbers, interval or test, and a time estimate before long runs. Likes being told when a claim turns out wrong.

## Running locally or in the cloud

Most sessions ran in a Claude Code cloud container (4 cores, clang and wasm-ld installed, scratch files under `/tmp/claude-0/...`); the user's organization has disabled Remote Control, so a local session means running `claude` directly in WSL. The notes below are for a local (WSL) run. Everything is on branch `ccr-2e470314-s2yw51` of `tenebrius/hearthfield`.

```sh
git clone https://github.com/tenebrius/hearthfield.git && cd hearthfield
git checkout ccr-2e470314-s2yw51
cd tools/forager-lab
node wasm/test-wasm.js     # engine checks; needs Node 18 or later
```

- **Check the engine matches before trusting any local number:** `node wasm/run-gen.js '{"maxE":500,"maxW":500,"startE":500,"startW":500,"memory":true,"oscillator":true,"oscPeriod":200,"genSpawn":1}' 1 1000 100` should end at 905 survived, 87% drank, 52% full. A second check: `node wasm/run-foothold.js '{"maxE":500,"maxW":500,"startE":500,"startW":500,"memory":true,"oscillator":true,"oscPeriod":200,"pondN":2}' 2` prints a "real" stage line with survived 822 and drank 55.6. (Neither has been run outside the cloud container yet; WebAssembly should be deterministic across machines, but if the numbers differ, stop and find out why before running batches.)
- **Rebuilding the engine** (needed for step 2 of the next plan, which edits `forager.c`): `sudo apt install clang lld`, then `wasm/build.sh`. The committed `forager.wasm` is enough for everything else.
- **Batches:** the `xargs -P4` and bash job-script pattern in section 3 works in WSL. Set `-P` to the number of cores you want to use (`nproc`); the timings in this document are for a 4-core cloud container and will differ. Run long batches from the WSL filesystem (`~/...`), not from `/mnt/c/...`, which is much slower for many small reads. Scratch files went to `/tmp/claude-0/...` in the cloud; any scratch directory will do locally.
- **Commits:** keep working on `ccr-2e470314-s2yw51` and push there. Do not create a pull request unless the user asks.

## 2. Repository map

| Path | What it is |
|---|---|
| `tools/forager-lab/forager-lab.html` | The interactive page (single file, open it in a browser). Open-ended mode only. Has every option listed in section 4 as a checkbox or slider. Not published as an artifact in its current state: the last published claude.ai artifact (https://claude.ai/artifact/9xTrayZPNYBxB127nBKxmR, version 33) is **stale**. |
| `tools/forager-lab/wasm/forager.c` | The fast engine (C, compiled to WebAssembly). Open-ended and generational modes. |
| `tools/forager-lab/wasm/forager.wasm` | The built engine (about 39 KB, committed). Rebuild with `wasm/build.sh` (needs clang with the wasm32 target and wasm-ld; both were present in the container). |
| `tools/forager-lab/wasm/engine.js` | Node wrapper: defaults come from the `cfg` object in the HTML page; `CFG_KEYS` must stay in the same order as `enum Cfg` in `forager.c` (the wrapper checks the count). |
| `tools/forager-lab/wasm/run-gen.js` | Generational runner (the main experiment tool). |
| `.../run-curriculum.js`, `run-objective.js`, `run-ablate.js`, `run-trace.js` | Pond curriculum; drinking-first objective curriculum; ablation of an input after training; tick-by-tick behaviour trace (now also logs death cause and thirst cycle). |
| `.../run-rand.js`, `run-rand-curriculum.js` | Random-pond training (`randpond` layout) with held-out test maps; curriculum into random ponds. |
| `.../run-walls.js`, `run-walltrace.js`, `run-randwalls.js` | Walls: open map then walls with a narrowing gap (options `wallType`, `wallSense`, `gateWalls`; ends with an ablation of the wall inputs); where dots meet the walls; random ponds plus random bars with a curriculum (`barsLate`, `testBars`). |
| `.../run-multi.js` | Step 2: random-pond curriculum with every dot scored on K layouts per generation (`genRoundMulti`), real task until drinking starts, optional bars after that, held-out tests with and without bars. Usage: `node wasm/run-multi.js '<cfg json>' <seed> [K=1] [finalGens=500] ...` (cfg `wallN` for bars). |
| `.../run-cuptrace.js` | What open-map dots do on cup maps: leave the food, reach the ring, get inside, drink, die inside or outside the ring. |
| `.../run-memfreeze.js` | Memory ablations on one trained population: as trained, registers frozen from a given age (`memFreeze`), registers zeroed. |
| `.../run-foothold.js` | Foothold traces: reproduces a no-bars `barsLate` trajectory of `run-randwalls.js`, stops at the end of the 12..36 stage and of the real-task stage, and replays 10 held-out layouts without breeding (where the dots are every 50 ticks, who drank and when, how far they went, death cause). Prints `FOOTHOLD {json}` lines. |
| `.../run-wasm.js` | Open-ended runner, same arguments and output as `tools/forager-lab/run.js`. |
| `.../test-wasm.js` | Engine checks (tanh and log accuracy, nearest-tile search against a plain scan, forward pass against plain JavaScript for every output layout, crossover, oscillator, latch, thermometer, clock gene, timer). Run it after every engine change. |
| `tools/forager-lab/run.js`, `mkharness.py` | Slower JavaScript harness built from the page's own code (`python3 mkharness.py` writes `base.js`, which is git-ignored). Kept as the reference implementation. |
| `docs/forager-lab-generational-plan.md` | The plan and **all result tables for the generational mode** (about 350 lines, in the order the experiments were run). |
| `docs/forager-lab-open-ended-results.md` | Archive: the first phase (open-ended mode), including the code review findings. |

## 3. How to run things

```sh
cd tools/forager-lab
node wasm/test-wasm.js                         # engine checks
wasm/build.sh                                  # rebuild forager.wasm after editing forager.c
node wasm/run-gen.js '<cfg json>' <seed> <generations> <report every N>
node wasm/run-curriculum.js '<cfg json>' <seed> [maxStage=400] [needFull=0.15] [finalGens=300] [maxFirst=1000]
node wasm/run-ablate.js '<cfg json>' <seed> <gens> <feature[,feature]> [evalRounds=10]
node wasm/run-trace.js '<cfg json>' <seed> <gens>
node wasm/run-rand.js '<cfg json>' <seed> <gens> <report every N> [random|fixed] [testMaps=20]
node wasm/run-rand-curriculum.js '<cfg json>' <seed> [maxStage=400] [needFull=0.15] [finalGens=300] [maxFirst=1000]
node wasm/run-walls.js '<cfg json>' <seed> [openGens=1000] [stageGens=300] [finalGens=500] [gaps=9,7,5,3]   # cfg: wallType 1 to 3, wallSense, gateWalls
node wasm/run-walltrace.js '<cfg json>' <seed>
node wasm/run-randwalls.js '<cfg json>' <seed> [maxStage=400] [needFull=0.15] [finalGens=300]              # cfg: wallN, wallLen, wallSense, gateWalls, barsLate, testBars
node wasm/run-foothold.js '<cfg json>' <seed> [maxStage=400] [needFull=0.15] [maxFirst=1000] [rounds=10]   # cfg as run-randwalls (pondN 2); one run is about 1 minute alone
```
`genLen` sets the round length (3000 for the longer-round tests); `waterRegrow` and `regrow` set the tile regrowth rates (0.03 default).

`run-gen.js` defaults: far-ponds map, energy loss 1.5, hydration loss 0.6, two hidden layers of 8, 200 dots, 1000-tick rounds, elitism 2, tournament of 3, survival score. The experiments in this document (unless stated) also set `genSpawn` 1 (start in the centre), `memory` true, and `maxE`, `maxW`, `startE`, `startW` all equal to 500 ("stores of 500"). The last line of a run (`FINAL ...`) gives means over the last 20 generations: `LAST20_MEAN_SCORE` is the mean number of ticks survived.

Running batches (hard-won lessons):
- **Launch batches as a tracked background command** (the Bash tool with `run_in_background`) that runs `xargs -P4` and prints a summary at the end. Batches started detached with `nohup`/`setsid` and then left while the turn ended were killed twice, part way.
- `xargs` strips quotes from JSON arguments. Do not pass JSON through `xargs`; use a job script that looks the configuration up by a short tag.
- Rough cost on the 4-core container: about 18–20 s of wall time per run at default stores, up to about 25 s at stores of 500; a 1000-generation run of one setup is 15–60 s alone. With four runs in parallel each run is slower: a 3000-tick-round run of 1000 generations took 1 min 46 s alone; the wall runs (about 2800 generations) took about 6 minutes each with four in parallel (24 runs: about 40 minutes). Estimates I gave were often off by 30% or much more; give a range, set the background timeout generously (the maximum is 7200000 ms), and rerun only the missing jobs if a batch is killed.
- Shell quoting: when a job script embeds JSON, a `sed` that edits `"walls":1` will miss the escaped `\"walls\":1`; check the printed command with `bash -x` before trusting a control run (this once produced an invalid control).
- `pkill -f` can match the shell itself; use `pkill -x node` and `pkill -x xargs`.
- After a container restart, scratch job scripts can lose their executable bit (a whole batch then fails at once with "Permission denied" while the task reports completed): `chmod +x` them, and check that the `node` processes are really running (`ps aux | grep run-`) a few seconds after launching.
- Read check output in full. A regression check printed through `cut` once hid a broken engine build (memory inputs zeroed); test 10 in `test-wasm.js` now guards that case.
- `bash -x ./job.sh ...` runs the whole job; to see the command only, background it and kill it after a few seconds, or `echo` the command instead.

## 4. Current design

**World.** 64×64 tiles; food and water tiles regrow (0.03 per tick times fertility 0.8). Layouts supported by the WASM engine: `circles` (two food discs, no water), `handmade` (+ two ponds midway), `handfar` (ponds in the far corners, about 45 tiles from the food; the main test map), `handnear` (a pond touching each food disc), `handcurr` (ponds slide from near to far with `pondShift`), `randpond` (food circles fixed, `pondN` 7×7 ponds at random by `mapSeed`, at least `pondMin` tiles from the food, optionally within `pondMax`). **Walls** (`walls` 1 to 4, JavaScript map builder in `engine.js`; wall tiles are kind 4, block movement, dots slide along them): 1 corner cups (L-shaped wall 10 tiles out with a short gap), 2 long walls (L at 20 tiles, gap at the edge end), 3 hostile long walls (gap at the corner end, so sliding leads away from it), 4 random bars (`wallN` bars of `wallLen`). Walls are in the WASM engine only, not in the page. Mixed and split layouts, food relocation, and the "newcomers copy parents" archive exist only in the page and the JS harness.

**Dot.** Energy and hydration fall every tick (`lossE`, `lossW`; moving costs `moveE` extra), are refilled by eating or drinking a tile (gain 30 times the tile's amount, capped at the store), and a dot dies at zero. In generational mode the thirst wall is store ÷ hydration loss (for example 500 ÷ 0.6 = 833 ticks).

**Brain.** Two hidden layers of 8 tanh neurons by default, weights mutated with rate 0.1 and size 0.2, optional crossover. Inputs are always zero unless their option is on (zero inputs have no weights in the WASM engine). Input indices:

| Index | Input | Option |
|---|---|---|
| 0, 1 | food, water on own tile | always |
| 2–4, 5–7 | nearest food / water: direction x, y, closeness (sight 5, tiles under 0.2 ignored) | always |
| 8, 9 | energy, hydration (÷ store, capped at 1) | always |
| 10 | bias | always |
| 11–14 | memory registers | `memory` |
| 15, 16 | x, y position | `position` |
| 17 | random number | `noise` |
| 18, 19 | last move blocked; last eat result | `feedback` |
| 20, 21 | wander heading | `tumble` |
| 22 | age (`age/(age+250)`, or `age/ageScale` capped at 1) | `age`, `ageScale` |
| 23, 24 | oscillator sine, cosine | `oscillator` |
| 25, 26 | latch values | `latch` |
| 27–32 | age thermometer (on once age ≥ 50, 100, 200, 400, 800, 1600; thresholds can be brain-set) | `ageTherm`, `thermMode` |
| 33 | time since timer reset, `log2(1 + t)/11` | `timer` |
| 34–36 | nearest wall tile: direction x, y, closeness (within sight) | `wallSense` |

`occlude` (no input of its own): food and water tiles behind a wall tile are left out of inputs 2–7.

An input whose option is off writes 0 (this was not the case before 2026-10-14: switching an input off after training used to leave it at its last value, so the older ablations of age, oscillator, latch, wander and thermometer used frozen values).

Outputs, in order: move x, move y, eat/drink (above 0 means eat instead of move); with memory, four new memory values and four gates; then, only for enabled options and in this order: momentum (`brainMomentum`), latch trigger (`latch`), oscillator period (`oscillator`, unless `oscPeriod` or `oscGene` is set), thermometer outputs (`thermMode` 1: one, 2: six), timer reset (`timer`). Other settings: `inertia` (momentum slider, 0 to 0.95), `oscPeriod` (fixed oscillator period), `oscGene` (period is a per-dot gene), `geneMut` (gene mutation sd in log2 units, default 0.25).

**Generational mode.** 200 dots on a fresh map each round (default 1000 ticks), no splitting. Score = `genWSurv` × ticks survived + `genWFood` × food tiles + `genWWater` × water tiles (defaults 1, 0, 0), `genScoreMode` 1 uses the smaller of the food and water terms. Tournament of 3, the best 2 copied unchanged, optional crossover (`genXover` 1 whole neurons, 2 single weights). Measured but not rewarded: share surviving the whole round ("full"), share that drank at least once ("drank"), share that stood on a pond, share that visited both circles.

## 5. Findings

These are in decreasing order of confidence. Details, tables and sample sizes are in `forager-lab-generational-plan.md` unless noted.

**Solid (large effects, 16 to 64 seeds, or reproduced several ways)**
1. **Evolution beats random movers** (about 150 against 78 ticks on the far map from random starts; from the centre random movers all die at tick 64 and evolved dots reach 159).
2. **The thirst wall decides almost everything.** Dots that never drink die at store ÷ hydration loss ticks (167 with stores of 100). Evolved dots farm food and wait. No building block (memory, wander heading, momentum, noise, age, latch) changed this at stores of 100. Scoring drinking directly only works if it is the only reward (water-only: 92% reach a pond but starve; food + water summed: no drinking).
3. **Bigger stores mostly move the wall** (store 200, 300, 500: survived 320, 481, 819). At 500 drinking starts to pay (14.5% survive the whole round). Sight range 8 or 12 makes no difference.
4. **A cycling clock is what the task was missing.** At stores of 500, an oscillator raises the share of dots that survive the whole round from about 8% to 34% (brain-set period) or 45% (fixed period 300); 24 seeds, p ≈ 0.001 or better. The trace shows why: with a clock a third to a half of the dots are at a pond by tick 100 to 200 (long before thirst), most return to food, and pond visits repeat; almost all dots drink (86% to 90%). Without a clock they stay on food until thirst arrives.
5. **Time signals do not stack.** A rising age counter helps only with a linear encoding (`age/1000`: 856 survived, 28% full against 804 and 8% with nothing); the saturating default (`age/(age+250)`) gave no gain although the dots use it. Combining oscillator, age or thermometer is no better than the best single one (817 to 876). The thermometer works as a clock on its own (826, 25% full).
6. **Fixed-period sweep:** best at 200 to 300 (886, 884; 50% and 45% full), worse at 100 (830), 500 (857), 800 (833).
7. **Across three worlds (hydration loss 0.6/0.9/0.4 with different stores), the brain-set oscillator was within 2%, 6% and 2% of each world's best fixed period** without anyone choosing it. The gene clock was worse than the best fixed period in all three (−41, −35, −11 ticks). The resettable timer did not help.
8. **Pond curriculum with stores of 500** (ponds walk from touching the food to the far corners; about 170 generations to reach the far map): final far-map result 893 / 911 / 915 survived and 51% / 59% / 62% full for fixed 200 / brain-set oscillator / gene clock + timer, against 887 / 871 / 836 and 50% / 36% / 22% for direct training of 1000 generations. So the curriculum helps the self-tuning clocks most, and then they match the fixed 200. With 4000 generations of direct training fixed 200 reaches 921 (63.5%) and the others 870 to 892. A curriculum with stores of 100 fails (the dots unlearn drinking once the ponds leave their sight range).
9. **Longer rounds (3000 ticks) hit a resource ceiling, not a brain limit.** Fixed 200 survived 1222 of 3000 with only 10% lasting the round (no clock 1030 and 6%); deaths pile up in the second thirst cycle and half are hunger. Raising water regrowth from 0.03 to 0.1 gave 1984 and 46% full, and water and food both to 0.1 gave 2462 and 69% (6 seeds). Regrow rate is now a tunable of the world like the thirst wall; the 1000-tick results are probably not affected.
10. **Random ponds:** dots trained on the fixed far-corners map keep much of their skill on random ponds (fixed 200: 832 against 892, 33% against 50% full); training on random ponds from scratch rarely learns to drink (0 to 16% drank after 1000 generations, 2 of 8 seeds after 4000); a curriculum into random ponds gets drinking started in 12 of 16 seeds but the mean (826) is no better than fixed-map training. Outcomes are two-valued per seed.
11. **Walls** (`forager-lab-generational-plan.md`, section "Walls"): dots that learned the open map keep most of their skill when walls are added gradually (corner cups: fixed 200 887 to 865, 50% to 36% full) but nothing learns with walls from scratch. The trace shows sliding does the navigating on the long walls. The wall-sensing inputs never gave a measurable advantage in any layout (gating their weights to 0 until the walls arrive helps them but not past no sense); where a seed used them (ablation drops of 60 to 190 ticks) other seeds without them did as well. Random bars in the curriculum prevent learning that the same dots handle fine without (7 of 8 seeds drink when trained without bars, 2 to 5 of 8 when bars were in training). Correction from a re-read of the logs: in the late-bars runs the failed seeds had 0% drinking *before* any bar arrived; three of them started drinking later without bars but not with bars. Bars block the first start of drinking (the foothold), not a finished skill.
13. **Foothold traces** (8 seeds, `run-foothold.js`; section "Foothold traces" in the plan file): populations that fail to drink on random far ponds **stay on the food** (85 to 90% of living dots on food at ticks 300 and 600, 0.5 to 5% ever more than 30 tiles from food) and die of thirst at the wall. They were not different at the end of the near-pond stage (4 to 15% drank on real-task maps, against 1 to 12% for seeds that succeeded); during the 400 real-task generations they lost their weak drinking while the others gained it. Reading: a trip that fails costs more than staying (833 ticks guaranteed), so selection removes trips unless some succeed; who wins that race looks random per seed. Two snapshots and 8 seeds, so suggestive.
14. **A less noisy fitness signal solves most of the foothold problem** (step 2, 16 seeds per setup): scoring each dot on the mean of K = 3 random layouts per generation instead of one got 16 of 16 seeds drinking on random far ponds (15 of 16), sooner (median 28 against 67 real-task generations), and raised held-out survival from 812 / 10% full to 896 / 41% (+84 ticks, interval +62 to +105). A compute control (K = 1, three times the final generations) gained only +32 ticks. With K = 3, bars added after the foothold no longer lose seeds; dots that never saw bars handle them as well as dots trained with them (sliding). `genRoundMulti` in `engine.js`, runner `run-multi.js`.
15. **Clocks in 3000-tick rounds with the supply fixed** (step 3, 16 seeds): no clock 2106 / 56% full, 12 of 16 seeds learn to drink; fixed 200 2462 / 68% and brain-set 2489 / 70%, 16 of 16. The no-clock seeds that learn do as well as clocked ones: the clock buys reliability of the first foothold, not a higher level. Fixed and brain-set are equal (-27 ticks, interval -101 to +44).
16. **Cups (step 4, negative):** a wall ring with one opening around each pond defeats sliding (open-map dots: 63% to 6% full at 1000 ticks, 74% to 2% at 3000), but the curriculum from open ponds to cups removed drinking in every run (36 at 1000 ticks, 2 at 3000, with and without the wall sense, fragile or secure foothold). The traces say dots that enter do not leave (34% to 44% of the drinkers die inside the ring), so entering is a net loss and nothing rewards enter-and-leave. Not tried: rings with two openings, a corridor, gap-11 rings that gain wall tiles one at a time, more memory. `walls: 5`, `pondSep`, `run-cuptrace.js`.
19. **Mixed open and cup maps (pilot, negative):** with 1 and then 2 of the 3 maps per generation being cups, the open maps keep their drinking, but cup drinking does not improve in 300 generations (14 to 21%, 25 to 16%, 11 to 10%, 11 to 12%), with or without the wall sense, and all four runs end at the thirst wall once cups are the only maps. So the cups' limit is what the dots can do with their senses, not the training schedule (`cupMixes`).
18. **Cups with a rotating opening (pilot, negative):** even when the opening always faces the food, a population with a secure open-map foothold drinks in only 24% to 37% of the cup maps (77% to 88% on open maps) and loses its drinking within the first cup stage (4 of 4 runs, with and without the wall sense). In 1000-tick rounds a failed trip costs about 70 ticks, so selection removes trips; in 3000-tick rounds 40 generations of cup training did not improve cups and cost open-map skill. Untried: occlusion, an opening-direction input, a bigger ring, a bigger network, longer training in the 3000-tick world. `cupFacing`, `cupFacings`, `diag-cups.js`.
17. **Memory is used as memory, and entering a cup is partly luck** (2026-10-15): freezing the four memory registers at age 25 costs 322 ticks (16 seeds, 95% interval 279 to 364), at age 100 277, at age 400 130, zeroing 284: the registers carry state that changes over hundreds of ticks, not a constant offset (`run-memfreeze.js`, `memFreeze`). What they store: no simple quantity (linear R squared 0.08 on hydration, energy, time since drink/meal, oscillator phase, positions), they saturate at +-1 and flip every 5 to 12 ticks, and replacing them by random noise recovers only 39 of the 284 ticks that zeroing loses (16 seeds): a compound state of the dot's own history, not noise and not a timer. On cup maps (8 seeds, 15,566 dots) dots whose first contact is the open side enter 71.6%, those at a closed side 18.6%; 76% arrive at a closed side; 68% of the entrants leave again. The 'dead end' explanation in finding 16 was partly wrong.
20. **Occlusion (step 6, pilots, mostly negative):** with `occlude` on, food and water behind a wall are not seen. Open-map dots then get into cups a little more often from a closed side (16.6% to 22.6%, 4 seeds), but they still arrive at the open side only by chance (25%). In training, cup drinking does not rise with occlusion, a 16-wide network or 3000-tick rounds (10 runs). The 3000-tick world (regrowth 0.1) keeps cup drinking at 30 to 45% through cups-only training (3 of 4 seeds without occlusion, 4 of 4 with it; occlusion +18 to +133 ticks on cups, 4 of 4 seeds). Likely limit: with sight 5 the pond is seen only 1 to 3 tiles outside the ring.
20. **Occlusion with a longer sight (pilot 4, 16 runs; 2 seeds per training cell):** the effect of occlusion grows with sight (entry from a closed side of a cup +6 points at sight 5, +13 at 8, +19 at 12, to 42%). In mixed training with sight 12 and occlusion, cups pay for the first time in the 1000-tick world (865 and 875 ticks on held-out cups against 833 for a food-sitter, 38% to 39% drank, against 0% and 10% at sight 5), and in the 3000-tick world cup drinking rises during cups-only training. **Batch (8 seeds per setup):** with sight 12 and occlusion, 7 of 8 populations survive held-out cups past a food-sitter (854 against 833 on average), 6 of 8 drink in at least 25% of cup maps, cup drinking rose during training in 5 of 8, and the open-map skill is kept (65% drank); sight 12 alone and sight 5 with occlusion give none of that (cups +36 and +38 ticks for the combination, intervals +22 to +47 and +15 to +62). First navigation result that works.
**Trace of those dots on cups** (`traceCups`, seeds 1 to 4): 79% reach a ring, 36% get in, but they still reach the open side first only 22.5% of the time (chance 25%); 78% of those arriving at the open side and 36% of those arriving at a closed side get in; of the dots that drank, 61% die inside the ring and 27% survive: the weak point is the exit.
**Where drinkers die in a ring** (saved populations, `run-load.js`, `cupreplay.js`): not the opening direction (67%, 68%, 65% of the drinkers die inside whether it faces the food, sideways or away), but the energy budget: the same dots with half the energy loss per tick have 59% of their drinkers surviving (21% at the trained loss) and half the deaths inside. Dots spend about 160 ticks inside a ring. Getting in does depend on the opening (52% vs 33% for an opening on the far side from the food). Populations can now be saved with `saveTo` and examined in seconds.
12. **Open-ended mode** (see the archive file): a wander heading (random direction held for a while) made evolved dots colonise a second food area (4 of 4 seeds against 2 of 4); on the far-ponds map with momentum 0.7, wander + memory is best (mean 155 against 116 for noise + age, 64 seeds). Brain-controlled momentum matches the best hand-picked value (152 against 155.5).

**Suggestive only (8 seeds or fewer; do not rank differences under about 30 ticks)**
- Thermometer with six brain-set steps (840, 22% full) and one brain-set scale (804, 18%) are not better than fixed steps (826, 25%).
- Lowering the clock gene's mutation (0.05) made no difference (915 against 915 after the curriculum).
- Random-bars curriculum: bars added late lose fewer seeds than bars from the start (3 and 5 of 8 keep drinking against 2 and 1) but still more than no bars (7 of 8); the explanation (a noisier fitness signal) is untested. More generations do not fix it for the seeds that failed: four of them trained 4000 more generations on the real task with bars and none started drinking.
- Latch alone did nothing; latch + oscillator was the worst of the clock combinations (807, almost no drinking). Unexplained.

**Withdrawn or corrected during the work** (so nobody relies on them)
- Early headless-harness results were wrong (the stub set every slider to 1) and were discarded; all numbers here come from the corrected harness or the WASM engine.
- "Age does not help": wrong; it was the encoding (item 5).
- "The linear age gives a last-minute crowd at the ponds (54% at tick 900)": withdrawn; it came from averaging only seeds that still had survivors (corrected table in the plan).
- "The brain-set oscillator falls short because its period wobbles during a life": not supported. The wobble is real (a dot's period varies by about 150 ticks around its mean, coefficient of variation 0.67 to 0.94) but the gene clock, which has none, did not do better.
- "The gene clock finds each world's best period": not supported. The averaged medians looked right, but per seed the evolved period is either short (11 to 50 ticks) or long (320 to 610), and both do well.
- The earlier ablations (age, oscillator, latch, wander, thermometer) fed frozen last values instead of zeros (fixed 2026-10-14); their conclusions probably stand but the numbers came from that version.
- The earlier "random input does not help" result (open-ended) was unreliable because of a shared-random-number bug (fixed).

## 6. Open questions and suggested next steps

**Speed-ups (step 5) done 2026-10-15:** the engine is about 1.28 times faster and bit-identical (same standard check, same `run-multi.js` stage lines); see "Step 5 results" in `docs/forager-lab-next-plan.md`. A first version of the faster tile search was not identical (a tie on tile boundaries) although the standard check passed; compare a `run-multi.js` run byte for byte after any engine change, not only the standard check. Background: the plan is `docs/forager-lab-next-plan.md`, section "Step 5: speed-ups". Steps 1 to 4 of that plan are done: failing populations never leave food (step 1); scoring each dot on K = 3 layouts per generation fixes most of that (step 2, finding 14); clocks buy reliability of the foothold in 3000-tick rounds (step 3, finding 15); navigation with cups is negative for these senses whatever the schedule (step 4, findings 16, 18, 19). Memory registers carry a compound state that matters (finding 17). The user chose speed-ups next (step 5), **then back to navigation (step 6 in the plan file): occlusion first (piloted 2026-10-15, finding 20; next suggested: occlusion with sight 8 or 12)** (ponds and food not visible through walls, so the pond is seen only through a cup's opening), with pilots and traces before batches. The list below is the longer backlog.

1. **Why does a short gene period (10 to 50 ticks) work as well as a long one?** With the timer present the clock may be doing something else. Test the gene clock without the timer, with and without the curriculum.
2. **Firm up the curriculum result** with more seeds (8 per cell now) and other worlds (hydration loss 0.9, smaller stores), and compare a curriculum for the brain-set oscillator against a longer direct training.
3. **The timer** never helped. Either find a world where "time since an event" matters (for example resetting on drinking) or drop it.
4. **Why latch + oscillator is worse than either alone** (unexplained).
5. **Look at behaviour more:** `run-trace.js` shows where dots are over a round; extend it to log the period each dot uses and what triggers pond trips.
6. **Put the generational mode into the page** (watch rounds, score chart) and republish the artifact; the page currently runs only the open-ended mode and the published version is old.
7. **Remaining code-review items** (open-ended mode, see the archive): pinned tiles after "Clear map" (4), island size read live during relocation (5), relocation can erase water (6), memory-off freezes registers instead of blanking them (7). Unfixable by design: old saved configs do not reproduce (3).
8. **Walls and navigation:** none of the wall worlds separates steering from a remembered route (the dots know their position on a fixed map) except random bars, which the dots cannot learn in about 1500 generations. A real test needs a less noisy training signal or a better curriculum. Ideas: more generations (see below), longer evaluation per layout (average several layouts per dot), bars with a pond curriculum of their own.
9. **Longer rounds with the supply fixed:** rerun the clock comparison (no clock, fixed 200, brain-set) at water and food regrowth 0.1 in 3000-tick rounds.
10. **Seed counts:** several 8-seed comparisons have intervals that include 0; the wall-sense runs gave 41% against 50% full on the open map before any walls existed (random draws alone). Use 16 to 24 seeds and report counts of seeds that learned.
11. Hearthfield itself is untouched; nothing here has been designed for it yet.

## 7. Things to know before trusting a number

- **Equivalence of engines:** the WASM engine reproduces the page's JavaScript only statistically (24 seeds: population and births within noise), not seed for seed, and has deliberate differences (own tanh, polar Gaussian, sparse weights, f32 SIMD forward pass). Results from before the engine existed (the open-ended chapter, mostly) were produced by the JavaScript harness.
- Outcomes in the far-ponds map are often **two-valued per seed** (stuck near one colony or good), so means can mislead; look at counts per seed. In generational mode with a wall, many setups differ by only 20 to 40 ticks; with 8 seeds the standard error is about 12 to 20.
- Genome layout changed several times as options were added (inputs 18, then 22, 23, 27, 33, 34, 37; outputs 11 to 21 plus a gene). Saved page configs from earlier versions load with new options off but cannot reproduce old runs. Within the same engine build, the same settings reproduce exactly (checked more than once).
- The test for "is a feature used" is `run-ablate.js` (switch an input off after training and re-evaluate). It showed all the clocks are relied on (survival drops by 100 to 370 ticks when removed).
