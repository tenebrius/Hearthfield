# Forager Lab: plan for the next session

Written 2026-10-14 for a fresh session to implement. Read `docs/forager-lab-handoff.md` first (repository map, how to run, batch lessons); result tables are in `docs/forager-lab-generational-plan.md`. Everything below uses the standard setup unless stated: far-corners or random ponds, stores of 500 (`maxE`, `maxW`, `startE`, `startW` 500), centre start (`genSpawn` 1), `memory` true, fixed period 200 oscillator (`"oscillator":true,"oscPeriod":200`), survival score, 1000-tick rounds.

## Why this plan

Every new world (random ponds, walls, random bars) stalled on the same thing: **some populations never get a first foothold on drinking, and once a population has missed it nothing rescues it.** Navigation was never actually tested, because the dots that failed never reached the point where steering mattered. So the next session should work on the foothold problem itself, not on more worlds.

A re-read of the random-bars logs sharpens this (new, not yet in the result tables):

- In the "bars added late" runs, the four seeds that failed (1, 3, 4, 6) had **0% drinking at the end of the real-task stage before any bar existed** (400 generations on random far ponds, no bars). The bars did not break a working behaviour; they arrived while drinking had not started.
- The control (same seeds, same first stages, deterministic engine, so identical up to that point; confirmed: seed 2 ends that stage at 822 / 56% drank in both) then trained 1000 more generations without bars, and seeds 3, 4 and 6 **did** start drinking (65%, 45%, 78% drank; seed 1 did not). With bars present for 2200 generations (and 5000 for the four retried seeds), none of them did.
- So, paired on 3 seeds: a late start of drinking that happens without bars does not happen with bars. Bars block the foothold, not the finished skill. "Late" in `barsLate` was not late enough: bars should be added only once a population drinks, which is step 2 below.

Recorded in `forager-lab-generational-plan.md` (random-bars section) on 2026-10-14.

## Step 1: why does a population fail to get the foothold? (DONE 2026-10-14)

**Result (details in `forager-lab-generational-plan.md`, "Foothold traces"):** failing populations never leave the food at the real task (85 to 90% on food at ticks 300 and 600, under 5% ever more than 30 tiles from food) and die of thirst at the wall. They did not differ at the end of the 12..36 stage; they lost their weak drinking during the 400 real-task generations. By the decision rule below, step 2 is next. The correction about late bars is recorded in the random-bars section of the results file. The original step description is kept below for reference.

Goal: a concrete description of what the dots of a failing population do at the real task, compared with a population that succeeds, at the same generation.

Build: a runner `run-foothold.js` that reproduces a `run-randwalls.js` trajectory up to a given stage (the engine is deterministic: same cfg, same seed, same map seeds, same stage lengths give the same genomes; copy the stage loop from `run-randwalls.js`, with `barsLate` 1, `wallN` 0 so no bars at all), then replays 10 held-out random layouts (map seeds 1000000+) without breeding and logs per round, as `run-trace.js` does: share of dots at food / at a pond / elsewhere every 50 ticks, share that ever drank, median tick of first drink, death cause (lower of energy and hydration at the last alive tick) and death tick distribution, and the farthest distance from the centre each dot reached. Use `e.views()` (`ax`, `ay`, `ae`, `aw`, `gwater`, `gdead`) and `genBegin` / `genTick` / `genEnd(false)`.

Run: seeds 1, 3, 4, 6 (fail) and 2, 5, 7, 8 (succeed), at (a) the end of the stage "ponds 12..36" (the last near-ish stage) and (b) the end of the 400-generation real-task stage. One run is one training reproduction (about 700 to 900 generations, 1 to 2 minutes) plus 10 rounds.

Questions the traces must answer:
1. At the real task, do failing dots still leave the food circles at all (farthest distance; share elsewhere at tick 300 to 600), or do they sit on food until the thirst wall?
2. If they leave, do they reach ponds and die anyway (death cause hunger, far from food), or wander without finding ponds (sight range 5, random ponds at 30+ tiles)?
3. Did the failing seeds already differ at the end of the 12..36 stage (for example fewer dots drinking, or drinking only ponds that sit in a particular direction)?

Decision: if failing dots never leave food, the problem is that the first long trip is never rewarded (survival score gives a non-drinker 833 ticks, a failed trip less), and step 2 is the right next test. If they leave and die searching, the problem is search, and a wander heading (`tumble`) or longer sight is the next test instead. Write the answer down with the numbers before building step 2.

## Step 2: a less noisy fitness signal, and bars only after the foothold (DONE 2026-10-14)

**Result (details in `forager-lab-generational-plan.md`, "Step 2"):** scoring every dot on K = 3 layouts per generation got 16 of 16 seeds drinking (15 of 16 with K = 1), sooner (median 28 real-task generations against 67), and raised held-out random-pond survival from 812 / 10% full to 896 / 41% (+84 ticks, 95% interval +62 to +105). A compute control (K = 1 with three times the final generations) gained only a third of that. With K = 3, bars added after the foothold no longer lose seeds (16 of 16 against 9 of 16), but training with bars did not make dots better with bars than dots that never saw one; 14-tile bars are handled by sliding. K = 3 is the new default for random worlds. Next: step 3, then step 4 with obstacles that sliding cannot get around. The original step description is kept below.

Hypothesis from the walls work (untested): with random layouts the same behaviour succeeds or fails by luck of the layout, so selection cannot see the gradient towards drinking. Test it with a change that is not a hand-picked setting: **evaluate each dot on K layouts per generation and breed on the mean score.**

Engine change (`forager.c`): split `gen_end` so that scoring and breeding can be separated. Add `EXPORT("gkey_ptr") double *gkey_ptr(void)` and `EXPORT("gen_breed") void gen_breed(void)` that does only the "next generation" part of `gen_end` (sort by `GKEY`, elitism, tournament, crossover, mutation, `GEN++`). `gen_end(0)` already computes `GKEY` and the stats without breeding, so the JS loop is: for k in 1..K: `setMap(layout k)`, `genBegin()`, ticks, `genEnd(false)`, read `GKEY` into a JS accumulator; then write the mean into `GKEY` via `gkey_ptr` and call `gen_breed()`. Add `genRoundMulti(layouts)` to `engine.js` returning the mean of the K stats. Test in `test-wasm.js`: with K = 1 the result must equal `genRound()` exactly (same stats, same genomes after breeding, same seed), and with K = 3 the per-dot key must equal the mean of the three single-round keys.

Also add to `run-randwalls.js` (or a copy) a stage exit on drinking: the "bars" stages begin only when at least 25% of dots drank (mean of the last 10 generations) on the real task without bars, with a cap of 2000 generations; log the generation at which drinking started.

Runs (16 seeds each; a 2000-generation run with K = 3 is 3 times the rounds, so expect about 10 to 15 minutes per run with four in parallel, 48 runs about 3 hours; set the background timeout to the maximum and rerun missing jobs if killed):
- A: random ponds, no bars, K = 1 (the existing control; 8 seeds exist, add 8).
- B: random ponds, no bars, K = 3.
- C: random ponds, bars added once drinking has started, K = 1.
- D: same as C with K = 3.

Report, per setup: seeds that drink (at least 25% drank on the held-out maps), generation at which drinking started, mean survived / full / drank on held-out maps with and without bars. Paired by seed where the seeds are shared.

Decision: if B beats A on seeds-that-drink or time-to-drinking, the noisy signal is real and K = 3 becomes the default for random worlds. If D keeps the seeds that C loses, bars can then be used for navigation tests (step 4). If neither helps, the foothold problem is not noise, and the step 1 traces decide what to try next (search, or a scoring that rewards the first pond trip, which the user will not like because it is hand-picked; discuss before building it).

## Step 3: the clock comparison in 3000-tick rounds with the supply fixed (DONE 2026-10-15)

**Result (details in `forager-lab-generational-plan.md`, "Step 3"):** with supply at 0.1, no clock 2106 / 56% full (12 of 16 seeds learn to drink), fixed 200 2462 / 68% and brain-set 2489 / 70% (16 of 16); the no-clock seeds that learn do as well as clocked ones, so the clock buys reliability of the foothold, not a higher level; fixed and brain-set are equal. The original step text is kept below.

Already defined, lower priority: `run-gen.js` with `"genLen":3000,"waterRegrow":0.1,"regrow":0.1`, setups no clock / fixed 200 / brain-set oscillator, 16 seeds each, 1000 generations. Reference: fixed 200 at these rates gave 2462 survived and 69% full (6 seeds). About 2 minutes per run alone, 48 runs about 1 hour with four in parallel. Report mean survived, full share, seeds above 2000, and the paired difference with intervals. This tells whether the clocks still matter when several thirst cycles must be survived.

## Step 4: navigation (TRIED 2026-10-15, negative; see "Step 4" in `forager-lab-generational-plan.md`)

**Outcome:** 14-tile bars are handled by sliding, so step 4 used cups (a wall ring with one opening around each pond, `walls: 5`). Cups do defeat sliding, but they are a dead end: dots that get in do not get out, and the curriculum from open ponds to cups removed drinking in every run (36 runs at 1000 ticks, 2 at 3000 ticks, with and without the wall sense, fragile or secure foothold). Open options: rings with two openings on opposite sides or a long corridor (a through-route), a gap-11 ring that gains wall tiles one at a time, more memory or a bigger brain, a trace of a dot inside a ring (does it ever try to leave?). The original step text is kept below.

### Original step 4 text

With K = 3 and bars after the foothold, rerun no wall sense against gated wall sense (`"wallSense":1,"gateWalls":1`), 16 seeds, and ablate the wall inputs at the end (already in `run-randwalls.js`). This is the first setup in which a remembered route cannot work, so it is the first real test of steering. Do not build new wall layouts before this.

## Rules for every batch

- 16 seeds minimum for any comparison you want to conclude from; report seeds-that-learned first, means second, paired bootstrap intervals for differences (the one-liners in the session history do this in node).
- Job scripts that map a tag to a config, never JSON through `xargs`; print the command with `bash -x` once before a batch; run batches as a tracked background command with the maximum timeout (7200000 ms) and rerun only missing jobs.
- Run `node wasm/test-wasm.js` after every engine change and check one unchanged setup reproduces exactly (seed 1, fixed 200, far ponds, 1000 generations: 905 survived, 87% drank, 52% full).
- Record every result in `forager-lab-generational-plan.md` with the per-seed numbers, and say when an estimate or a claim was wrong.
