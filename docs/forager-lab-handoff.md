# Forager Lab: handoff notes

Status as of 2026-10-11. This document lets someone pick up the work without the earlier conversation.

**Update (later the same day):** the "Result of last action" inputs and the "Wander heading (run and tumble)" input were added, and code-review problems 1, 2, 8, 9, 10 and 12 were fixed (see section 4). Results in section 5 were measured **before** these changes and the random-input result in particular should be rerun. Section 7 records what changed and how to test it.

## 1. Why this exists

The Hearthfield docs (`version-1-specification.md`, `expansion-plan.md`) describe settlers with hand-written logic for work choice, valuation, trade and migration. We are exploring an alternative: settlers driven by small neural networks evolved through natural selection, so that logic does not have to be designed by hand.

Forager Lab is the first learning sandbox for that idea. Dots on a 64×64 map must find food (and optionally water) to survive and split. It is intentionally much simpler than Hearthfield. It has no households, trade or prices yet.

**The central open problem:** evolved dots often do no better than dots that move at random (section 5). Until evolution reliably beats random motion on a simple map, scaling the idea up to Hearthfield is premature.

## 2. Where things live

| What | Where |
|---|---|
| Live page (claude.ai artifact, private to the owner) | https://claude.ai/artifact/9xTrayZPNYBxB127nBKxmR (published version 33) |
| Source of that page | `tools/forager-lab/forager-lab.html` (a single self-contained file; open it in any browser) |
| Headless harness builder | `tools/forager-lab/mkharness.py`, which writes `base.js` (git-ignored) |
| Experiment runner | `tools/forager-lab/run.js` |

Running headless:

```sh
cd tools/forager-lab
python3 mkharness.py            # regenerate base.js after every HTML edit
node run.js '{"layout":"circles","lossW":0,"lossE":1,"layers":2}' 1 800000 50000
node run.js '{"layout":"circles","lossW":0,"lossE":1,"baseline":true}' 1 200000 20000
# run several seeds in parallel:
printf '%s\n' 1 2 3 4 | xargs -P4 -I{} node run.js '{"layout":"circles","lossW":0,"lossE":1}' {} 400000 50000
```

The JSON argument overrides keys of `cfg` (see section 3). `mkharness.py` extracts the page script, stubs the DOM, reads the real default slider values from the HTML, makes the RNG state snapshot-able and exposes `globalThis.__t` (step, agents, cfg, makeWorld, snap, restore). It also adds two hooks for memory experiments: `cfg.swap` (feed each dot a random other dot's memory) and `cfg.ablate = m` (zero memory register m).

> **Caveat on old results:** an early version of the harness stub returned `'1'` for every slider value. Every headless result produced before that fix was wrong and has been retracted. That covers claims about cliffs, cooldown, moving food, register usage and poison. Only trust numbers produced with the current `mkharness.py`, including the ones below.

## 3. Current design

### World
- 64×64 tiles. Each tile holds food or water with an amount from 0 to 1, regrowing at `regrow` / `waterRegrow` per tick.
- Layouts (`layout`):
  - `mixed`: islands of food and water.
  - `split`: food on one side, water on the other.
  - `circles`: two food discs of radius 9 centred at (48,16) and (16,48), with no water. The discs are about 45 tiles apart, well beyond sight.
- Optional food relocation every `shiftEvery` ticks (`shiftPct` % of islands move).
- Paint mode lets you draw food and water by hand. Painted tiles are pinned.

### Dot (agent)
- **Energy `e`:** loses `lossE` each tick, plus `moveE × speed` when moving. Eating adds `amount × gainE`, capped at `maxE`.
- **Hydration `w`:** symmetric to energy, with `lossW`, `moveW`, `gainW` and `maxW`.
- **Death:** a dot dies when e ≤ 0 (starved) or w ≤ 0 (thirst).
- **Split:** happens when `e ≥ max(reqE, payE+1)` and `w ≥ max(reqW, payW+1)`, cooldown is over and population < `maxPop`. The parent pays `payE`/`payW`. The child starts with `kidE`/`kidW` (created, not taken from the parent) and a mutated copy of the genome.
- **Newcomers:** random-genome dots are added whenever population < `floorN`. They start with `startE`/`startW`. Copying from an archive of successful parents is available but off by default, because it rewarded dots that only split.
- **Random-mover baseline (`baseline: true`):** the brain is ignored. Each tick the dot picks a random heading at full speed and eats with probability 0.2.

### Brain
- **Genome:** a flat `Float32Array` of weights with fixed topology. Mutation changes each weight with probability `mutRate` (0.1), adding Gaussian noise of size `mutSize` (0.2). There is no crossover and no gradient training.
- **Network:** 22 inputs → 1 or 2 hidden tanh layers of `hidden` neurons (default 8) → 11 outputs.
- **Inputs:**

  | idx | meaning |
  |---|---|
  | 0, 1 | food / water amount on own tile |
  | 2–4 | nearest food tile: direction x, y, closeness `1 − d/(R+1)`. Tiles below 0.2 are ignored. R = `sight` (5). |
  | 5–7 | the same for nearest water |
  | 8, 9 | e/maxE, w/maxW |
  | 10 | bias (1) |
  | 11–14 | memory registers |
  | 15, 16 | position x, y (zero if `position` is off) |
  | 18 | last move blocked: 0 = fully moved, 1 = not moved at all (an edge stopped it). Zero if `feedback` is off. |
  | 19 | last eat result: amount eaten, −1 if it tried to eat and found nothing, 0 if it did not try. Zero if `feedback` is off. |
  | 20, 21 | wander heading (cos, sin): a per-dot random direction held for `tumbleEvery` ticks (±50%), then redrawn from a separate stream. Zero if `tumble` is off. |
  | 17 | uniform random in [−1, 1] from a separate stream (zero if `noise` is off) |

- **Outputs:**
  - Move x, move y. The dot moves in any direction at `min(1, |v|) × stepLen` tiles per tick.
  - Eat. If eat > 0 the dot eats instead of moving. This is also the only way to stand still.
  - 4 memory values and 4 gates, with update `mem = gate·tanh(v) + (1−gate)·mem`.

### Defaults
```
regrow 0.03  waterRegrow 0.03  lossE 0.3  lossW 0.6  moveE 0.1  moveW 0
gainE 30 gainW 30  maxE 100 maxW 100  startE 50 startW 150
reqE 85 reqW 40  payE 60 payW 0  kidE 40 kidW 100  cooldown 0
islands 6 islandSize 4  layout mixed  stepLen 1  sight 5
hidden 8  layers 1  memory on  position on  noise off  archive off
floorN 20  maxPop 800  mutRate 0.1  mutSize 0.2
```

UI extras include population, intake and water charts; an inspector for the selected dot showing a live brain diagram; config-only save and load (localStorage); and a seed field.

## 4. Code problems (from code review)

Fixed since the review: **1, 2, 8, 9, 10, 12** (marked FIXED below) and 11 (controls are re-synced from `cfg` on load). Still open: 3 (unfixable by design: old saves do not reproduce), 4, 5, 6, 7.

Two independent reviews agreed that the weight indexing in `think`, `forward` and `buildBrain` is consistent and that nothing crashes. They found these problems, listed roughly by how much they matter:

1. FIXED. **The gain cap lowers values that start above the max.** On eating, the code sets `a.w = Math.min(cfg.maxW, a.w + amt*gainW)`. Newcomers start at w = 150 while maxW = 100, so their first drink drops them to 100. Energy has the same issue whenever `startE` or `kidE` is above `maxE`. Inputs 8 and 9 can also exceed 1.
   - *Fix:* use `Math.max(a.w, Math.min(maxW, a.w + gain))`, or clamp start values to the max.
2. FIXED. **The noise input uses the shared world RNG.** `inp[17] = rng()*2−1` consumes the world RNG, so with noise on, world events (regrowth, newcomers, mutation) diverge from a noise-off run with the same seed. The two runs are not a controlled comparison. **The "random input does not help" result below is therefore unreliable and should be rerun.** The fix: the noise input and the wander heading now draw from a separate stream (`aux()`), seeded from the world seed.
   - *Fix:* give the noise input its own seeded PRNG.
3. **Old saves cannot be reproduced.** Changing `N_IN` from 17 to 18 changed how many RNG draws the initial genomes use, so saved configs from before that change no longer reproduce their runs.
4. **"Clear map" breaks relocation silently.** It pins every tile, so relocation then does nothing, yet the shift counters, markers and recovery stats still update. In the `circles` layout, `relocateFood` returns without doing anything, also silently.
5. **Island size changes mid-run.** `placeIsland` reads the live `islandSize` slider during relocation, so changing the slider affects a running world.
6. **Relocation can erase water** on tiles where water overlapped an island.
7. **Memory off freezes the registers instead of blanking them.** The inputs read 0, but the registers keep updating internally. This is harmless today but misleading.
8. FIXED. **`describe()` is incomplete.** It labels the `circles` layout as "mixed" and omits `layers` and `noise`.
9. FIXED. **Old configs leave `noise` unchanged.** `applyConfig` only copies the keys present, so loading an old config keeps whatever `noise` value is currently set.
10. FIXED. **Seed 0 is inconsistent.** It becomes seed 1 on Reset but seed 4 on Save.
11. FIXED. **Checkboxes can disagree with `cfg`** after the browser restores form state on reload.
12. FIXED. **The numbers 18 and 11 are hard-coded** in the weight-count label and the help text instead of using `N_IN` / `N_OUT`.

Recommended order: fix 1 and 2, then rerun the random-input experiment.

## 5. The main problem: evolved dots vs random movers

### Results

All numbers come from the corrected harness, using 4 seeds unless noted.

**Food only (`lossW 0`), energy loss 0.6, default mixed layout:**

| Setup | Population |
|---|---|
| Random movers (no brain) | ~344 |
| Evolved, no memory, with position (360k ticks) | plateau ~294, **worse than random** |
| Evolved, no memory, no position | 423, but only passes random after ~240–280k ticks |
| Evolved, memory + position | 367 |

**Two circles, food only, energy loss 1.0, cap 800:**

| Setup | Result |
|---|---|
| Random movers | ~262 stable (one seed only 130) |
| Evolved, 2 hidden layers × 8, no memory, with position, 800k ticks | 3 of 4 seeds stuck at ~175 on **one** circle (max 191); one seed reached 352 (max 371) |
| The same plus the random input (17) | all 4 seeds ~175 (max 190). *Unreliable because of bug 2.* |

The evolved dots fill one circle and never colonise the second, which is out of sight about 45 tiles away. Random walkers drift there by chance.

**Two circles, energy loss 0.3 (easy):** every setup reaches the 800 cap. Speed differs hugely, though. Random movers reach 100 dots in about 60–95 ticks; evolved dots take 1k–42k ticks, because they must first evolve any ability to eat.

### What the evolved dots actually learned (measured)
- **Steering:** they steer toward visible food (cosine between movement and food direction 0.4–0.61).
- **Eating:** they eat when standing on food 72–96% of the time.
- **"Eat" on bare tiles:** 40–47% of the time. Because "eat" is the only way to stand still, this is partly resting, but it wastes time and energy.
- **Water:** they seek it only weakly.
- **Freezing (no-memory dots):** they spend about 3.6% of their time stuck in one place for 30+ ticks, against about 1% with memory. They die of thirst 87% of the time, against 62% for random movers.
- **Generations:** 360k ticks gives only 90–117 generations deep, and a typical living dot is at generation ~50–60. Most gains come early, then progress plateaus.

So evolution does produce real, non-random behaviour (local food-seeking), but it does not produce *exploration*. Once a dot cannot see food, a deterministic brain with constant inputs gives a constant output. It then walks in a fixed line into a wall, or stands still. A random walker, by contrast, keeps covering new ground.

### Hypotheses (not yet tested)
1. **No persistent exploration drive.** Without sight of food the inputs barely change, so the output barely changes. Per-tick noise (input 17) only adds jitter and gives no lasting random heading, which is what exploration needs. Memory can in principle act as a slowly drifting "heading" register, which may be why memory helps in some runs.
2. **Position inputs encourage map-specific shortcuts** ("go to x≈48, y≈16") that work for one circle and lock the population there. They also add weights to tune. This would explain why no-position dots did better over long runs.
3. **Too few generations.** About 60 effective generations with mutation-only search on ~250+ weights is very little. Selection pressure is also weak, because any dot that lives long enough to split counts as successful.
4. **Local optimum on the one-circle map.** Exploring for the second circle costs energy and pays nothing until a dot gets there, so selection actively removes explorers while the first circle is not yet full.

## 6. Suggested next steps
1. Fix bugs 1 and 2 (give noise its own PRNG), then redo the random-input test on two circles.
2. **Test an exploration primitive directly.** Options:
   - An input that holds a random value per dot, redrawn every N ticks (a persistent heading seed).
   - A "turn rate" output, so straight-line wandering is easy to express.
   - A separate "rest" output, so "eat" no longer doubles as standing still.
3. Run two circles **without position inputs** to test hypothesis 2.
4. **Speed up evolution:**
   - Run more ticks per second headless (for example 2M+ ticks).
   - Make food scarcer so selection is stronger.
   - Try larger `mutSize` early.
   - Seed newcomers from the current population instead of from scratch.
5. **Measure exploration directly:** count distinct tiles visited per lifetime and how often the second circle gets colonised, for evolved vs random dots.
6. Only once evolved dots clearly beat random movers on two circles should more Hearthfield-like features be added (trade, households).

## 7. Changes made after the first handoff

All in `tools/forager-lab/forager-lab.html`:

- **Result of last action** (checkbox `cFb`, on by default): inputs 18 (move blocked, 0 to 1) and 19 (eat result: amount, −1 for nothing found, 0 for not tried).
- **Wander heading / run and tumble** (checkbox `cTumble`, off by default; slider `rTumble`, 10–1000 ticks, default 100): inputs 20 and 21, a per-dot direction held for a while then redrawn.
- **Memory registers unchanged.** An ungated "extra outputs fed back" design was considered and rejected: the existing gated registers do the same job and hold values better.
- Gain cap no longer lowers a value that starts above the max; inputs 8 and 9 are clamped to at most 1.
- Noise input and wander heading use their own PRNG, so toggling them does not change the world for a given seed.
- `N_IN` went from 18 to 22, so initial genomes (and old saved runs) differ from before. Saved configs from older versions load with the new options off.
- `mkharness.py` hook pattern updated for `seedVal()`.

### How to test whether they help
Use two circles, food only, energy loss 1.0, two hidden layers. Compare, over 4 seeds and at least 200k–800k ticks: no feedback, feedback, feedback + wander heading, random movers. Also try with and without memory and with and without position. 
### First result (200k ticks, 4 seeds, two circles, energy loss 1.0, 2 hidden layers of 8, memory OFF, position on, cap 800)

Population averaged over the last 1000 ticks. ~175 means stuck on one circle; ~345 means both circles colonised.

| Setup | seed 1 | seed 2 | seed 3 | seed 4 | seeds on both circles |
|---|---|---|---|---|---|
| Random movers | 260 | 265 | 265 | 261 | (always ~262) |
| Evolved, no result inputs | 347 | 174 | 174 | 347 | 2 of 4 |
| Evolved + result inputs | 172 | 349 | 173 | 171 | 1 of 4 |
| Evolved + result inputs + wander heading | 344 | 345 | 345 | 341 | **4 of 4** |

- The wander heading is the first change that makes evolved dots beat random movers on this map on every seed (~345 vs ~262).
- The result inputs alone made no clear difference (1 of 4 vs 2 of 4 is within seed luck).
- Caveats: only 200k ticks and 4 seeds; memory was off in all rows; the "no result inputs" row also shows that the earlier "3 of 4 stuck" figure was seed luck (2 of 4 here). Not yet tested: wander heading without result inputs, with memory, without position, or on the mixed map and with thirst on. Run those next.

### Long run: wander heading alone vs wander + result inputs (500k ticks, 4 seeds, same setup as above)

Population averaged over the last 1000 ticks before each mark.

| Setup | seed | 100k | 200k | 300k | 400k | 500k |
|---|---|---|---|---|---|---|
| Wander only | 1 | 340 | 343 | 345 | 345 | 346 |
| | 2 | 341 | 343 | 345 | 346 | 345 |
| | 3 | 343 | 345 | 348 | 348 | 348 |
| | 4 | 343 | 343 | 346 | 346 | 349 |
| Wander + result | 1 | 341 | 344 | 346 | 346 | 347 |
| | 2 | 344 | 345 | 344 | 344 | 347 |
| | 3 | **173** | 345 | 346 | 347 | 347 |
| | 4 | 338 | 341 | 342 | 345 | 346 |

- All 8 runs ended on both circles at ~346 (max 366–370). Random movers: ~262.
- Wander only had both circles by 100k on 4 of 4 seeds. Wander + result had them by 100k on 3 of 4 (seed 3 was still on one circle at 100k and crossed before 200k).
- So the result inputs add nothing measurable here, and may slightly delay colonisation. The difference rests on one seed.
- After about 100k ticks the population is flat (+5 over the next 400k). With both circles full it is probably limited by food supply, not by the brain, so this map can no longer tell better brains apart. A harder map (farther circles, thirst, moving food, mixed layout) is needed.

### Hand-made map with water: random vs evolved (memory + wander heading)

Layout `handmade` (new, no generator): food circles of radius 9 at top right (48,16) and bottom left (16,48); two fixed 7×7 ponds at tiles x,y 13–19 (top left) and 45–51 (bottom right). All tiles pinned. Settings: energy loss 1.0, hydration loss 0.3, 2 hidden layers of 8, position on, result inputs OFF, cap 800, seeds 1–4. Evolved dots: memory on + wander heading on, 500k ticks. Random movers: 200k ticks.

Population averaged over the last 1000 ticks before each mark.

| Setup | seed | 100k | 200k | 300k | 400k | 500k | peak (tick) |
|---|---|---|---|---|---|---|---|
| Evolved, memory + wander | 1 | 263 | 256 | 262 | 252 | 254 | 320 (2k) |
| | 2 | 256 | 255 | 265 | 260 | 257 | 306 (27k) |
| | 3 | 260 | 255 | 256 | 255 | 254 | 316 (5k) |
| | 4 | 265 | 264 | 251 | 250 | 255 | 317 (4k) |
| Random movers | 1 | 235 | 233 | | | | 269 |
| | 2 | 228 | 233 | | | | 266 |
| | 3 | 227 | 231 | | | | 271 |
| | 4 | 232 | 233 | | | | 275 |

- Evolved dots settle at ~255, about 10% above random movers (~232), on all 4 seeds. The evolved populations are flat from 100k onwards, so longer runs would not change this.
- The evolved peaks (306–320) come in the first few thousand ticks, when newcomers' starting hydration and the free child hydration give an early boom. The steady level is lower. The gap over random is small compared with the food-only two-circle map (~345 vs ~262).
- Not known: whether ~255 is a ceiling set by food and water supply (a rough estimate puts water supply alone at roughly 290 dots) or by the brains. Not tested: memory off, wander off, position off, other pond placements, thirst at other rates. Without those the contribution of memory vs wander heading cannot be separated.
