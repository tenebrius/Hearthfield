# Forager Lab: generational mode plan

Status: step 1 built (2026-10-13): generational mode in the WASM engine (`tools/forager-lab/wasm/run-gen.js`). First results below. Forager Lab is now treated as a learning project in its own right, separate from Hearthfield.

## Why

In the open-ended mode, dots live, eat, split and die whenever their energy allows. That is natural but slow: about 60 generations in 200k ticks, and early lucky dots can fill the map and crowd out the rest. A generational mode runs evolution in rounds, giving hundreds of generations in minutes on the WASM engine and a clean comparison between brain building blocks.

## How a round works

1. **Population:** 200 dots, fixed size. There is no splitting within a round.
2. **Fresh map each round:** `handfar` (two food circles, two far ponds), with all food and water full.
3. **Start:** random positions anywhere; energy and hydration full (100 / 100).
4. **Length:** 1000 ticks. With energy loss 1.5 and hydration loss 0.6 a dot must eat about 15 times and drink about 6 times to last the round. The ponds are about 45 tiles from the food, so dots have to travel. Dots that run out die and stop scoring.
5. **End of round:** score, select parents, make the next 200, reset the map.

## Decisions (agreed)

| Topic | Choice |
|---|---|
| Score | **Ticks survived**, ties broken by food + water gathered. Exploration is not rewarded directly. |
| Start positions | **Random anywhere.** Centre start can be added later as an option. |
| Selection | Tournament of 3 for each child, plus **elitism**: the best 2 are copied unchanged. |
| Mutation | As in the open-ended mode: rate 0.1, size 0.2. |
| Crossover | **Option, off by default.** Mode 1: whole-neuron swap, so each hidden neuron index arrives intact from one parent (its incoming weights in layer 1, its outgoing weights in layer 2 and to the outputs). Mode 2: each weight from one of the two parents at random, for comparison. Crossover happens before mutation. |
| Competition | All 200 dots share one map, so they compete for food and water within a round. |

## Measured every generation (measured, not rewarded)

- best, mean and median score
- share of dots surviving the full round
- mean food and mean water gathered
- share that reached a pond; share that visited both food circles
- genome diversity (mean distance between sampled pairs)
- random movers' score on the same settings, as a reference line

The output is one line per generation, so charts and seed-to-seed comparisons are easy.

## Building blocks to compare

All optional, so evolution can use whichever helps:

1. memory registers (exist)
2. wander heading (exists)
3. **latch registers** (new): sample-and-hold of a random value; the brain has a trigger output, and the register keeps its value until triggered again
4. **oscillator input** (new): a regular wave whose period the brain sets with an output
5. momentum, fixed or brain-set (exists)

## Build order

1. **Engine:** generational mode in the WASM engine, with the round, scoring, selection and reproduction loop in C, plus a runner printing per-generation stats. Expected cost: about 0.1 s per generation (200 dots × 1000 ticks), so 500 generations take about a minute.
2. **First experiments:** baseline brain vs random movers, then what each existing option adds. Several seeds each.
3. **New building blocks:** latch registers and the oscillator input, in both engines, with checks.
4. **Page:** a generational mode in the browser, to watch rounds play out with a score-per-generation chart.

## What was added after the first results

- `genSpawn` 1: every dot starts each round at the centre (32, 32).
- Score weights `genWSurv`, `genWFood`, `genWWater` (defaults 1, 0, 0): score = wSurv × ticks survived + wFood × food tiles eaten + wWater × water tiles drunk. Each term is reported separately, plus the share of dots that drank.
- Layout `handnear`: same food circles, one pond touching each (also in the browser page).

## Added later: min score, pond curriculum, objective curriculum

- `genScoreMode` 1: score = the smaller of (wFood × food tiles) and (wWater × water tiles), plus a small survival term (wSurv × ticks × 0.001) and a tiny tie-break on total intake.
- Layout `handcurr` with `pondShift` 0 to 1: the ponds slide from touching the food circles (same as `handnear`) to the corners (same as `handfar`). `wasm/run-curriculum.js` walks the ponds out in 8 steps (0, 0.15, ... 1) keeping the population.
- `wasm/run-objective.js`: first reward only drinking until most dots stand on a pond, then switch to the normal score. `Engine.setCfg(key, value)` changes a setting between rounds.

## Added later: latch register, oscillator

- `latch` (inputs 25, 26; output "take a new random sample"): two random numbers held until the brain triggers a new sample; a dot starts with a random sample.
- `oscillator` (inputs 23, 24; output "period"): sine and cosine of a phase that advances by 1 / period each tick, period set by the brain between 4 and 400 ticks.
- Both are in the page (checkboxes) and the WASM engine, off by default. `Engine.setCfg` and `run-objective.js` are unchanged.

## How to run it

```sh
cd tools/forager-lab
node wasm/run-gen.js '{"memory":true,"tumble":true}' <seed> <generations> <report every N>
node wasm/test-wasm.js     # engine checks, including crossover
```

Defaults: far-ponds map, energy loss 1.5, hydration loss 0.6, 2 hidden layers of 8, start energy and hydration 100, 200 dots, 1000-tick rounds, elitism 2, tournament of 3, crossover off (`genXover` 1 = whole neurons, 2 = single weights). `"baseline":true` gives random movers as a reference. Cost: 1000 generations take about 15–25 s. The final line gives the means over the last 20 generations.

## First results (8 seeds, 1000 generations each, far ponds, energy loss 1.5, hydration loss 0.6)

Mean score = ticks survived, averaged over the last 20 generations; "pond" = share of dots that stood on a water tile during the round.

| Setup | mean score | survived full round | reached pond |
|---|---|---|---|
| Random movers | 78 | 0% | 6.8% |
| Evolved, memory off | 149 | 0% | 3.2% |
| Evolved, memory on | 144 | 0% | 3.0% |
| + wander heading | 132 | 0% | 4.0% |
| + wander heading + momentum 0.7 | 130 | 0% | 4.0% |
| + wander heading + brain-set momentum | 133 | 0% | 3.5% |
| + noise + age, momentum 0.9 | 142 | 0% | 4.2% |
| + noise + age, brain-set momentum | 145 | 0% | 3.6% |

On the near-ponds map (`handmade`), memory, wander and wander + brain-set momentum give 138–140, with 10–12% reaching a pond; random movers give 78.

- **Evolution works in this mode:** the score roughly doubles over random movers (about 150 vs 78) within about 200 generations, and food gathered rises from about 15 to over 300 per dot.
- **Every evolved setup then stops at the same wall.** The median is exactly 167 ticks, which is 100 hydration at 0.6 per tick: those dots eat well but never drink. With hydration loss 0.2 the median is exactly 500 (100 ÷ 0.2). No dot survives the full 1000-tick round in any setup.
- **None of the building blocks changes that.** All evolved setups land between 130 and 149 (memory off is nominally the best); differences are small next to this wall.
- **Evolved dots reach ponds no more often than random movers** (3–4% vs 6.8%). Staying on food and farming it is a good strategy up to the thirst wall, and leaving costs food, so selection does not push towards water.
- **Why it is hard (reasoning, not tested):** to live past 167 ticks a dot must find food within about 65 ticks, then travel about 45 tiles to a pond it cannot see and drink, and later return to food. That is a coordinated plan with no reward until it all works.
- **Ideas, in rough order of cost:** (1) make water the binding need earlier or food less binding (for example lower energy loss), so drinking is selected sooner; (2) a curriculum: ponds touching the food first, then moving them away; (3) the planned latch register and oscillator building blocks; (4) shape the score to reward drinking (more opinionated); (5) longer rounds or more dots.

## Centre start, separate scoring, lower energy loss and near ponds (8 seeds, 1000 generations each, memory on)

All rows start every dot in the centre. "survived" = mean ticks survived over the last 20 generations; food and water are tiles eaten and drunk per dot; "stood on pond" is the share of dots that stood on a water tile; "full" is the share that survived all 1000 ticks. Energy loss 1.5 and hydration loss 0.6 unless stated.

| Map and setup | survived | food | water | drank | stood on pond | full |
|---|---|---|---|---|---|---|
| Far ponds, random movers | 64 | 0 | 0 | 0% | 0% | 0% |
| Far, score = survival | 159 | 10.7 | 0.0 | 0% | 0% | 0% |
| Far, score = food only | 159 | 10.7 | 0.0 | 0% | 0% | 0% |
| Far, score = water only | 64 | 0.0 | 0.6 | 51% | 92% | 0% |
| Far, score = food + water (equal weights) | 159 | 10.7 | 0.0 | 0% | 0% | 0% |
| Far, energy loss 0.3, score = survival | 232 | 0.0 | 3.0 | 52% | 91% | 0% |
| Far, energy loss 0.3, score = food + water | 213 | 11.9 | 2.4 | 21% | 21% | 3% |
| Near ponds, random movers | 64 | 0 | 0 | 1% | 1% | 0% |
| Near, score = survival | 415 | 35.6 | 8.2 | 76% | 77% | 25% |
| Near, score = water only | 401 | 25.2 | 9.5 | 92% | 93% | 24% |
| Near, score = food + water | 397 | 35.0 | 7.9 | 73% | 74% | 23% |

- **From the centre, random movers all die at tick 64** (they never reach food), so the centre start is a much harder task than random starts. Evolved dots with survival scoring reach 159: they find food but not water.
- **Scoring drinking directly works only when it is the only reward:** with water-only scoring 92% of dots walk to a pond (about 38 tiles away, out of sight) and half drink, so evolution *can* find far ponds from the centre. But those dots never eat and starve at tick 64.
- **Summing food and water does not escape the food trap:** with equal weights evolution takes the easy reward (10.7 food tiles) and gets no water, because a pond trip earns less than a food tile does and costs the food. Both rewards are needed together, which a sum does not demand (a minimum or product would).
- **Lower energy loss (0.3) makes survival scoring evolve water seeking** (91% stand on a pond) but at the cost of food: dots live on their starting energy (about 250 ticks) and ignore food. Mixed scoring gives mixed behaviour; one seed reached 363.
- **The near-ponds map is solved in most seeds:** 25% of dots survive the full 1000 ticks and 76% drink, with survival scoring alone. Per seed (survival scoring): 498, 492, 469, 208, 475, 505, 176, 496; two seeds stalled near 180–210. So the curriculum idea works as a first step, and direct scoring of water is not needed once water is easy to find.
- **Next candidates:** a score that needs both (minimum or product of food and water tiles); a curriculum that moves the ponds away in steps, starting from the near-ponds solution; then the planned latch register and oscillator input.

## Min score and the two curricula (8 seeds each, far ponds, centre start, memory on, energy loss 1.5, hydration loss 0.6)

Means over the last 20 generations (last 10 of the final far-ponds stage for the curriculum). Compare with far ponds and survival scoring: survived 159, food 10.7, water 0.0, no drinking.

| Setup | survived | full | food | water | drank | stood on pond |
|---|---|---|---|---|---|---|
| Far, min score (food, water) | 143 | 0% | 8.0 | 0.3 | 23% | 25% |
| Far, min score + survival term | 148 | 0% | 8.9 | 0.2 | 15% | 17% |
| Pond curriculum, survival score | 158 | 0% | 10.0 | 0.0 | 0% | 0% |
| Pond curriculum, min score + survival | 124 | 0% | 4.2 | 1.0 | 64% | 67% |
| Objective curriculum (water only, then survival) | 158 | 0% | 10.6 | 0.0 | 0% | 0% |
| Objective curriculum (water only, then min + survival) | 144 | 0% | 7.8 | 0.1 | 11% | 12% |

- **None of them gets a single dot through the 1000-tick round on the far-ponds map.**
- **Pond curriculum:** with survival scoring the early stages learn to drink (ponds touching the food solve the task in most seeds, as before), but as the ponds move out the learning is lost: most seeds could not reach 15% full survivors at shift 0.3 or beyond and were moved on after 400 generations, and by the final far map nobody drinks. A pond at shift 0.3 is about 10 tiles beyond the food circle's edge, outside the sight range of 5, so dots can no longer see it and their drinking behaviour has nothing to follow.
- **Min score keeps drinking alive but costs food:** with the curriculum, 64% of dots drink, but food falls to 4.2 tiles and survival to 124. The score only counts the smaller total, and water stays near 1 tile, so improving food is not rewarded.
- **Objective curriculum:** drinking-only scoring gets 80% of dots to a far pond in about 31 generations (so evolution finds the far ponds easily when it is the only reward), but once survival is scored the behaviour vanishes within the 700 generations: a dot that heads for the pond from the start dies of hunger at tick 64, while a dot that farms food lives to 159, so selection removes the pond trip.
- **What the three failures have in common (reasoning, not tested):** living past about tick 160 needs a trip that comes *after* eating, triggered by thirst, to a pond that is out of sight, and an energy store that is too small (100, only about 65 ticks of energy at loss 1.5) to make that trip affordable. The things to try next target exactly that: a bigger energy and hydration store (`maxE`, `maxW`, `startE`, `startW` 300), a bigger sight range (8), and the planned latch register and oscillator input.

## Bigger stores and sight range (8 seeds, 1000 generations, far ponds, centre start, memory on, survival score)

`maxE`, `maxW`, `startE` and `startW` set together. Baseline (store 100): survived 159, no drinking.

| Setup | survived | food | water | drank | full round |
|---|---|---|---|---|---|
| Store 200 | 320 | 20.8 | 0.0 | 0% | 0% |
| Store 300 | 481 | 29.8 | 0.5 | 17% | 0.5% |
| Store 500 | 819 | 47.7 | 1.9 | 37% | 14.5% |
| Sight 8 | 160 | 10.6 | 0.0 | 0% | 0% |
| Sight 12 | 160 | 10.7 | 0.0 | 0% | 0% |
| Store 300 + sight 8 | 506 | 31.3 | 1.7 | 27% | 5% |

- **A bigger store mostly moves the thirst wall:** survival tracks store ÷ hydration loss (200 ÷ 0.6 = 333, 300 ÷ 0.6 = 500, 500 ÷ 0.6 = 833) and comes out at 320, 481 and 819. At 200 and 300 the dots still mostly do not drink. At 500 the wall is close enough to the round length that drinking adds survivors: 37% drink and 14.5% survive the whole round, the first time anyone has on the far map.
- **Sight range makes no difference** (160 vs 159) even at 12: the ponds are 38 or more tiles away.

## Latch register and oscillator (8 seeds, 1000 generations, far ponds, centre start, memory on, survival score)

Store 100 (default): latch 159, oscillator 158, latch + oscillator 159. No effect: the thirst wall at 167 ticks decides everything.

Store 500 (`maxE`, `maxW`, `startE`, `startW` = 500); reference without extras: survived 819, drank 37%, full round 14.5%.

| Setup | survived | food | water | drank | full round |
|---|---|---|---|---|---|
| Wander heading | 788 | 44.1 | 0.8 | 12% | 3.6% |
| Latch | 817 | 50.9 | 1.1 | 18% | 9.1% |
| **Oscillator** | **871** | 51.2 | **4.1** | **67%** | **36.2%** |
| Latch + oscillator | 807 | 47.9 | 0.0 | 0.4% | 0% |

Survived per seed: no extras 898, 891, 789, 799, 816, 718, 808, 833 (mean 819); oscillator 943, 898, 863, 894, 889, 828, 810, 841 (mean 871); every oscillator seed is at least 810.

- **The oscillator is the one building block that helped:** at store 500, 67% of dots drink (vs 37%) and 36% survive the whole round (vs 14.5%). The wander heading made it worse (12% drink), the latch alone made no clear difference, and latch + oscillator together was worst (0.4% drink), which I cannot explain yet.
- **Reading (reasoning, not tested):** a clock lets a dot schedule the trip, eat first and then go drink at a set time, which is the "trip after eating, triggered by time or thirst" the earlier results pointed to. The oscillator also costs nothing unless used.
- **Caveats:** one batch of 8 seeds; the survived difference (about 52 ticks, seed spread 40–55) is suggestive (t about 2.2), the full-round share is the larger effect. Not tested: the age input as a clock, a fixed-period oscillator, store 500 without memory, other sight ranges.
- **Run note:** the first attempt at this batch stopped part-way (33 of 56 runs finished) and I re-ran the 23 missing ones; the numbers above come from complete runs.
- **Next:** repeat store 500 with 24 seeds for no extras, oscillator, age and fixed-period variants; look into why latch + oscillator is worse.

## Oscillator, age input and fixed-period oscillator at store 500 (24 seeds, 1000 generations each)

Far ponds, centre start, memory on, survival score, `maxE`, `maxW`, `startE`, `startW` = 500. Values are means over the last 20 generations, averaged over seeds. "oscfix" is `oscillator` with `oscPeriod` 300 (the brain has no period output).

| Setup | survived | food | water | drank | full round |
|---|---|---|---|---|---|
| No extras | 804 | 48.0 | 1.1 | 25% | 8.0% |
| Oscillator (brain sets period) | 856 | 48.8 | 3.9 | 65% | 33.5% |
| Age input | 800 | 46.9 | 1.3 | 27% | 7.7% |
| Oscillator, fixed period 300 | **884** | 51.8 | **5.0** | **85%** | **44.9%** |

- **Survival gain over no extras (95% bootstrap interval):** oscillator +53 [+24, +80]; age −4 [−28, +20]; fixed oscillator +80 [+59, +102].
- **Seeds where at least 15% of dots survive the full round:** no extras 5 of 24; oscillator 17 of 24 (p = 0.001, Fisher's exact test); age 5 of 24; fixed oscillator 22 of 24 (p < 0.001).
- **The oscillator effect is confirmed:** the 8-seed result was not luck. A cycling clock roughly quadruples the share of dots that survive the whole round (8% to 34% or 45%).
- **A rising counter does not help:** the age input is no better than nothing, so the benefit comes from a clock that cycles, not from any time signal.
- **Letting the brain choose the period was worse than fixing it at 300** (856 vs 884, and 17 vs 22 good seeds); the fixed version also varies less between seeds (sd 31 vs 53). The period output is probably one more thing evolution has to get right. Caveat: 300 was my guess and not tuned, and a fixed period is more opinionated than a brain-set one.
- **Not tested:** other fixed periods; why a cycle helps (my reading is that it times the pond trip, not checked by looking at what the dots do); stores below 500, where the extras made no difference earlier because the thirst wall is too close.
- **Run note:** this batch also stopped twice part-way (28, then the rest re-run as a tracked task); all 96 runs are complete in the numbers above.

## Are the dots using the age input and the oscillator? Ablation and a linear age (16 seeds each, store 500)

Setup as above (far ponds, centre start, memory on, survival score, 1000 generations of training). After training, the same population is evaluated for 10 rounds with no breeding, first as trained ("on") and then with the feature switched off so its inputs stay at 0 ("off"). `ageScale` 1000 makes the age input linear (`age / 1000`, capped at 1); without it the input is the saturating `age / (age + 250)`.

| Feature | on: survived | full | drank | off: survived | full | drank | drop when off (se) | seeds with a drop of 50+ ticks |
|---|---|---|---|---|---|---|---|---|
| Age, saturating `age / (age + 250)` | 807 | 9.3% | 30% | 687 | 6.2% | 24% | 120 (26) | 10 of 16 |
| **Age, linear `age / 1000`** | **856** | **27.9%** | **55%** | 735 | 16.3% | 39% | 121 (19) | 13 of 16 |
| Oscillator, fixed period 300 | 885 | 45.0% | 88% | 599 | 5.1% | 46% | 287 (18) | 16 of 16 |
| Oscillator, brain-set period | 853 | 29.6% | 63% | 655 | 5.6% | 33% | 199 (21) | 16 of 16 |

For comparison, no extras scored 804 survived with 8.0% full-round survivors (24 seeds, sd 46).

- **The earlier conclusion that age does not help was wrong, or at least premature.** With the saturating encoding the dots do use the input (switching it off costs 120 ticks), but it brings no net gain (807 vs 804). With a linear encoding it helps clearly: 856 survived and 28% full-round survivors vs 804 and 8% with nothing (about +52 ticks, roughly 3.5 standard errors), similar to the brain-set oscillator (853, 30%).
- **The encoding mattered.** The saturating form changes by only about 0.2 between ticks 300 and 800, exactly where timing matters, so evolution would need very large weights to read it. A straight line gives a clear signal throughout.
- **The oscillator is still the strongest** (fixed 885 and 45% full; and the biggest drop when off, 287 ticks, in every seed).
- **Caveat:** `age / 1000` uses the round length (1000 ticks) as its scale, so I handed the dots the horizon. A fair check would try scales unrelated to the round length (for example 500 and 2000), and a thermometer-style encoding (several threshold inputs).
- **Run note:** the batch took 18 minutes, longer than my 12–15 minute estimate.

## Combining clocks, and the age thermometer (16 seeds each, store 500)

Same setup as the previous sections (far ponds, centre start, memory on, survival score, 1000 generations of training, then 10 evaluation rounds on and off). Thermometer = `ageTherm`: six inputs that switch on once a dot is at least 50, 100, 200, 400, 800 and 1600 ticks old. The "drop when off" columns switch one feature off at a time while the other stays on.

| Setup | survived | full round | drank | drop when age feature off (se) | drop when oscillator off (se) |
|---|---|---|---|---|---|
| Oscillator (brain period) + linear age | 837 | 30.0% | 76% | 112 (15), 12 of 16 seeds | 211 (23), 15 of 16 |
| Oscillator (brain period) + old age | 820 | 24.8% | 67% | 52 (9), 10 of 16 | 198 (29), 14 of 16 |
| Oscillator (fixed 300) + linear age | 876 | 35.2% | 77% | 107 (17), 14 of 16 | 200 (23), 15 of 16 |
| Thermometer alone | 826 | 24.9% | 81% | 198 (21), 16 of 16 | n/a |
| Oscillator (brain period) + thermometer | 817 | 18.8% | 86% | 212 (22), 16 of 16 | 163 (18), 15 of 16 |

References (earlier runs, same settings): no extras 804 survived and 8.0% full-round; brain-set oscillator alone 853 to 856 and 30% to 34%; fixed oscillator alone 884 and 45%; linear age alone 856 and 28%; old age alone 807 and 9%. The build was checked to reproduce the earlier numbers exactly.

- **Time signals do not stack.** Adding linear age or the old age to the brain-set oscillator gives 837 and 820, no better than the oscillator alone (about 855). Adding linear age to the fixed oscillator gives 876 against 884 alone. The thermometer together with the oscillator is lower than either alone (817, 18.8% full). The dots use both signals when both are present (switching either off costs 100 to 200 ticks), so this is not a case of one being ignored, but the second signal brings no extra survival.
- **The thermometer works as a clock on its own:** 826 survived, 25% full-round survivors (vs 8% with nothing) and 81% of dots drink (vs 25%). Its survival is below the linear age and the brain-set oscillator (about 855), by roughly 2 standard errors, so I would not call that difference settled.
- **The best setup stays the fixed-period oscillator alone** (884 and 45%). It beats the thermometer by about 58 ticks (about 4 standard errors).
- **Reading (reasoning, not tested):** any clean time signal gets most of the benefit; a second one adds inputs and weights for evolution to tune without adding information. The more opinionated the signal (fixed period 300), the better it did here.
- **Run note:** the batch took 24 minutes (estimate 23 to 28).

## Brain-set age thermometer (16 seeds each, store 500)

`thermMode` 1: one extra output sets the unit u = 12.5 x 16^sigmoid (12.5 to 200 ticks), steps at u x 1, 2, 4, 8, 16, 32. `thermMode` 2: six extra outputs, each step picks its own threshold, 10 x 200^sigmoid (10 to 2000 ticks). Thresholds change from the next tick on. Same setup as the other store-500 sections; evaluated on and off after training.

| Setup | survived | full round | drank | off: survived | off: full | drop when off (se) |
|---|---|---|---|---|---|---|
| Thermometer, fixed steps (earlier) | 826 | 24.9% | 81% | n/a | n/a | 198 (21) |
| Thermometer, brain sets the scale (1 output) | 804 | 18.2% | 77% | 541 | 3.6% | 263 (20), 16 of 16 seeds |
| Thermometer, brain sets each step (6 outputs) | 840 | 22.0% | 47% | 472 | 1.4% | 368 (25), 16 of 16 seeds |

References: no extras 804 and 8.0% full; fixed oscillator 885 and 45%; brain-set oscillator 853 and 30%.

- **The dots depend on the brain-set thermometer in every seed** (switching it off costs 263 and 368 ticks), but neither version beats the fixed one: 804 and 840 against 826 survived, and 18% and 22% against 25% full-round survivors. The differences are within about 2 standard errors (about 12 each), so I would not rank them.
- **Same pattern as the oscillator:** the hand-set version (fixed period, fixed steps) was as good as or better than the version where the brain sets the numbers. Letting the brain choose probably adds outputs and weights to tune without adding information. The cost of a fixed clock is that we chose the numbers.
- **Odd detail, not explained:** with six outputs the dots survive longer (840) but only 47% drink, against 77% with one output and 81% with the fixed steps. Survival and drinking do not move together here, so something else must be adding survival; I have not looked.
- **Run note:** the batch took 11 minutes (estimate 10 to 12).

## What the dots actually do, why a brain-set period falls short, and how special period 300 is

Tool: `wasm/run-trace.js` trains for 1000 generations, then replays one round of the trained population tick by tick (no breeding) and logs where the dots are, their energy and hydration, who has eaten or drunk, and (for the oscillator) the period each dot chooses. 4 seeds per setup, store 500, far ponds, centre start, memory on. "At a pond" means within 8 tiles of a pond centre, "at food" within 9 tiles of a food circle centre.

| Setup (4 seeds) | survived | full | ever drank | median tick of first drink | pond entries per dot |
|---|---|---|---|---|---|
| No extras | 794 | 9% | 33% | 270 | 0.5 |
| Oscillator, fixed 300 | 875 | 42% | 86% | 228 | 1.5 |
| Oscillator, brain-set | 854 | 23% | 46% | 218 | 1.0 |
| Linear age | 827 | 14% | 32% | 517 | 0.6 |
| Thermometer, fixed steps | 831 | 34% | 90% | 272 | 1.5 |
| Thermometer, six brain-set steps | 872 | 46% | 89% | 250 | 1.6 |

Share of ALL dots at a pond (%) / share that have drunk (%) / share still alive (%), by tick (corrected: a seed in which every dot has died counts as 0 alive and 0 at a pond, and "drunk" keeps its last value; the first version of this table averaged only over seeds that still had living dots, which flattered three setups at tick 900):

| Setup (4 seeds) | tick 100 | 300 | 500 | 800 | 900 |
|---|---|---|---|---|---|
| No clock | 7 / 20 / 100 | 1 / 22 / 100 | 2 / 25 / 91 | 2 / 32 / 80 | 2 / 33 / 12 |
| Oscillator, fixed 300 | 33 / 35 / 100 | 4 / 49 / 100 | 11 / 66 / 92 | 14 / 84 / 83 | 8 / 86 / 61 |
| Oscillator, brain-set | 12 / 16 / 100 | 6 / 27 / 100 | 8 / 33 / 96 | 11 / 46 / 90 | 11 / 46 / 32 |
| Linear age | 6 / 8 / 100 | 3 / 11 / 100 | 4 / 15 / 93 | 11 / 29 / 87 | 6 / 32 / 20 |
| Thermometer, fixed steps | 47 / 45 / 100 | 7 / 53 / 100 | 12 / 72 / 86 | 12 / 90 / 75 | 4 / 90 / 53 |
| Thermometer, six brain-set steps | 27 / 32 / 100 | 10 / 54 / 100 | 11 / 72 / 90 | 14 / 88 / 81 | 13 / 89 / 64 |

- **Without a clock the dots farm food and wait.** About 85% stand at a food circle from tick 200; hydration falls in a straight line to about 40 by tick 800 and most die of thirst around tick 830 to 900 (alive 80% at tick 800, 12% at 900 after the correction). Only a third ever drink.
- **With a cycling or stepped clock, a third to a half of the dots are at a pond already by tick 100 to 200** (33% oscillator, 47% thermometer), long before they are thirsty (average hydration is still about 450), then most return to food by tick 300, and pond visits continue at 10% to 17% through the rest of the round. Almost everyone (86% to 90%) drinks at least once, and far more dots are alive at tick 900. So the clock gives the dots a timed, repeated pond trip instead of one trip they are too late for.
- **A rising counter gives a slow, late build-up, not an early trip:** with the linear age only 6% of dots are at a pond at tick 100 and 8% have drunk; the share at a pond creeps up to 11% by tick 800 and by tick 900 only 20% of dots are still alive. (An earlier version of this note said 54% of dots crowd at the ponds at tick 900; that came from averaging only over the two seeds that still had living dots and is withdrawn.)
- **Why a brain-set period falls short (measured):** the period a dot chooses is not steady. For the brain-set oscillator, one dot's period wobbles by a typical standard deviation of 145 to 177 ticks around its own mean (coefficient of variation 0.67 to 0.94), because the period output depends on the same inputs as the rest of the brain (position, energy, hydration). The average period across dots is near the good range (medians 180 to 237 ticks), but spread widely across dots (10th to 90th percentile 77 to 268). So the dots find about the right average period, but not a steady clock, which is what the fixed oscillator provides exactly. Making the output steady would need the weights from all of the inputs to the period output to shrink to nearly zero, and a small wobble costs little, so selection pushes weakly while mutation keeps adding noise.
- **Period sweep (fixed period oscillator, 12 seeds each; no oscillator 804 survived, 8% full, 25% drank):**

| Period | survived | drank | full | sd of survived |
|---|---|---|---|---|
| 100 | 830 | 68% | 27% | 86 |
| 200 | **886** | 88% | 50% | 21 |
| 300 (24 seeds) | 884 | 85% | 45% | 46 |
| 500 | 857 | 64% | 31% | 39 |
| 800 | 833 | 46% | 15% | 32 |

  The best periods are about 200 to 300; 300 is not special. The brain-set oscillator (853, 30%) has an average period inside that band but a blurry clock.
- **Idea not yet tried:** make the period a per-dot gene (one number that never changes during a life) instead of a network output. If that matches the fixed oscillator, the wobble is the cause. Caveat: four seeds per trace setup is small; for example six-output thermometer shows 89% drinking here against 47% in the 16-seed batch, so its numbers should not be read as typical.
- **Run note:** the batch took 21 minutes (estimate 17 to 20).

## Clock gene and resettable timer, across three worlds (8 seeds per cell, 1000 generations)

Built: `oscGene` (the oscillator's period is a per-dot gene, log2 of the period, starts uniform over 8 to 800 ticks, always drifts by sd 0.25 log2 units per generation, never changes during a life, no period output) and `timer` (input: log2(1 + ticks since last reset) / 11; output: reset when above 0). Both are in the page and the engine. Model after The Bibites: a clock whose speed is a gene (their ClockSpeed) and a resettable counter (their Minute and ClkReset).

Worlds (far ponds, centre start, memory on, survival score, energy loss 1.5): W0 hydration loss 0.6 with stores of 500 (thirst wall 833 ticks); W1 hydration loss 0.9 with stores of 500 (wall 556); W2 hydration loss 0.4 with stores of 300 (wall 750). Mean ticks survived over the last 20 generations, with the share of dots that drank at least once and the share that survived the full 1000-tick round:

| Setup | W0 survived / drank / full | W1 survived / drank / full | W2 survived / drank / full |
|---|---|---|---|
| No clock | 819 / 37% / 14.5% | 595 / 70% / 1.1% | 685 / 1% / 0% |
| Fixed period 100 | 845 / 62% / 28% | 592 / 84% / 2.1% | **721** / 17% / 4.9% |
| Fixed period 200 | **887** / 87% / 50% | 609 / 84% / 3.4% | 706 / 48% / 8.8% |
| Fixed period 400 | 860 / 72% / 31% | **643** / 92% / 3.8% | 686 / 22% / 0.4% |
| Fixed period 800 | 837 / 48% / 16% | 606 / 87% / 0.1% | 703 / 21% / 0.1% |
| Oscillator, brain sets the period | 871 / 67% / 36% | 605 / 76% / 2.0% | 709 / 29% / 11% |
| Oscillator, period is a gene | 846 / 47% / 23% | 609 / 84% / 1.6% | 710 / 0% / 0% |
| Timer only | 800 / 18% / 2.5% | 578 / 56% / 1.1% | 693 / 15% / 2.9% |
| Gene clock + timer | 836 / 43% / 22% | 624 / 89% / 4.1% | 706 / 0.2% / 0% |

Evolved gene period (median of the population, averaged over seeds; 10th to 90th percentile): W0 281 (110 to 569); W1 321 (189 to 581); W2 70 (25 to 344). Gene + timer: W0 243, W1 366, W2 53.

- **The gene's period tracks the world.** The best fixed period was 200 in W0, 400 in W1 and 100 in W2 (on a coarse grid), and the evolved gene medians were 281, 321 and 70: the right band each time, without anyone choosing it. The spread inside a population is wide (for example 110 to 569 in W0), so it is far from converged.
- **But the gene clock performs worse than the best fixed period in every world** (gene minus best fixed: -41 in W0, 95% interval -67 to -10; -35 in W1, -64 to -10; -11 in W2, -27 to +1) and, in W0, worse than the brain-set oscillator (846 vs 871). In W2 the gene clock produced no drinking at all (0%).
- **The earlier explanation does not hold up.** I had suggested the brain-set period fell short because it wobbles during a life; the gene clock has no wobble at all, yet it did not beat the brain-set one. Wobble is not the main reason, or at least removing it is not enough. Another candidate, not tested: the gene mutates by about 19% per generation, so the weights are tuned to a clock that keeps moving; a smaller gene mutation might help.
- **The brain-set oscillator is the most robust choice across worlds.** Its shortfall from the best fixed period is 16 ticks (2%) in W0, 38 (6%) in W1 and 12 (2%) in W2, with no period chosen by hand. Any single fixed period is a good choice in one world and a worse one elsewhere (for example 100 is best in W2 and 42 ticks worse in W0). Fixed 200 is the best single hand-pick (regret 0, 34, 15), about the same as the brain-set version's.
- **The resettable timer did not help:** timer alone was below no clock in W0 (800 vs 819) and about equal elsewhere; gene + timer is about the same as the gene clock. Evolution did not find a use for it in 1000 generations.
- **Worlds with fast thirst (W1) and slow thirst (W2) show small differences** between setups (W1: 578 to 643; W2: 685 to 721) and almost nobody survives the full round, so those worlds say less than W0. Eight seeds per cell is small; differences of under about 30 ticks should not be ranked.
- **Run note:** the batch (216 runs) took 53 minutes against my estimate of 65 to 80.

## Pond curriculum with self-tuning clocks, and a lower clock-gene mutation (8 seeds per cell)

World: hydration loss 0.6, stores of 500, centre start, memory on, survival score. Curriculum: ponds slide from touching the food circles to the far corners in 8 steps (shift 0, 0.15, ... 1; a step ends when at least 15% of dots survive the whole round, averaged over 10 generations, or at the cap of 1000 generations for the first step and 400 for the others), keeping the population; after the last step it trains 300 more generations on the far map (the last step always runs its 400 generations because it has no early exit). Control: the same setup trained directly on the far map for 4000 generations. "Low mutation" sets `geneMut` to 0.05 (about 3.5% change in the period per generation) instead of 0.25 (about 19%). Cells are survived / full-round share / share that drank, on the far map, over the last generations.

| Setup | After the curriculum (about 870 generations in total) | Direct, 4000 generations | Direct, 1000 generations (earlier W0 run) |
|---|---|---|---|
| Fixed period 200 | 893 / 50.5% / 87% | **921** / 63.5% / 91% | 887 / 50% / 87% |
| Brain-set oscillator | 911 / 59.0% / 88% | 892 / 49.6% / 81% | 871 / 36% / 67% |
| Gene clock + timer | **915** / 61.8% / 89% | 878 / 37.5% / 59% | 836 / 22% / 43% |
| Gene clock + timer, low mutation | **915** / 57.4% / 92% | 870 / 39.2% / 59% | not run |

- **The curriculum solves the far-pond task quickly:** every step took only 10 to 70 generations on average (one seed needed about 60 at the 0.75 step), compared with about 500 generations when the near ponds were learned with stores of 100. With stores of 500 the whole walk to the far corners took about 170 generations, plus the final 400 and 300.
- **The curriculum helps the self-tuning clocks most.** Against direct training for a similar number of generations (the 1000-generation column), the curriculum gives gene clock + timer 915 against 836 (full-round share 62% against 22%) and the brain-set oscillator 911 against 871 (59% against 36%), but the fixed period only 893 against 887. After the curriculum the self-tuning versions are as good as the hand-picked fixed 200 (911 and 915 against 893; differences of this size are within the noise for 8 seeds). So with a curriculum nobody has to choose the period.
- **More training helps the fixed clock more than the others:** direct training for 4000 generations takes fixed 200 to 921 (63.5%), above the self-tuning versions (870 to 892).
- **Lower clock-gene mutation made no difference:** 915 / 57% against 915 / 62% after the curriculum, and 870 against 878 with direct training.
- **Correction to the three-world section:** I wrote that the gene's period "tracks the world" because the averaged per-seed medians (281, 321, 70) were near each world's best fixed period. The per-seed values here show the average hides a split. In the direct 4000-generation runs the evolved median period was about 500 to 610 ticks in some seeds (550, 511, 536, 609 with the default mutation; 397, 322, 340 with low mutation) and only 11 to 50 ticks in others (15, 22, 47 and 11, 28, 48), with a few in between. Both short and long periods did well (a median period of 15 gave 925 survived; seeds with 540 to 610 gave 935 to 961), so the gene clock does not converge on one period. The claim that it finds each world's best period without being told is not supported.
- **Not tested:** why short periods work as well (with the timer present the clock may be doing something else); the gene clock without the timer in the curriculum; more than 8 seeds.
- **Run note:** the batch (64 runs) took 51 minutes against my estimate of 50 to 60.

## Random ponds and held-out test maps (2026-10-14)

**New tools.** `randpond` layout (engine.js): the food circles stay put, two 7×7 ponds are placed at random, at least 30 tiles from both food centres and not touching each other. `run-rand.js` trains either on a fresh random layout every generation (`random`) or on the fixed far-corners map (`fixed`), and tests the population without breeding on 20 held-out random layouts (map seeds 1,000,000 and up, never used for training) and on far-corners. Setup: stores of 500, start in the centre, memory on, 1000-tick rounds, 1000 generations, 8 seeds. Random movers on the test maps: about 340 to 380 ticks, under 2% drink.

| Setup | Training | Test: random ponds (ticks / full / drank) | Test: far corners (ticks / full) |
|---|---|---|---|
| Fixed period 200 | fixed far corners | 832 ± 7 / 33% / 64% | 892 ± 7 / 50% |
| Fixed period 200 | random ponds | 812 ± 8 / 5% / 16% | 814 ± 10 / 4% |
| Brain-set oscillator | fixed far corners | 832 ± 10 / 23% / 48% | 870 ± 15 / 35% |
| Brain-set oscillator | random ponds | 815 ± 6 / 0% / 5% | 814 ± 5 / 0% |
| No clock | fixed far corners | 786 ± 14 / 8% / 20% | 818 ± 19 / 16% |
| No clock | random ponds | 802 ± 7 / 2% / 5% | 800 ± 7 / 2% |

(± is the standard error over 8 seeds. The thirst wall is 833 ticks.)

- **After 1000 generations, random-ponds training has not learned to drink** (0 to 16% drank, survival at the wall). Dots trained on one fixed map and then tested on random maps do better (up to 64% drank), and their far-corners score matches the earlier fixed-map results (892 for fixed 200).
- **The fixed-map result is partly a memorised route, but not entirely.** Fixed-trained dots lose about 60 ticks and about half their drinkers when the ponds move (892 to 832 for fixed 200; 50% to 33% full). Some of what they keep is probably luck: many random layouts put a pond near a corner or an edge, where a fixed route still finds it. I have not checked how much.
- **Random training is not proven worse, only slower or harder to start.** With no consistent signal early on, drinking never gets a foothold in 1000 generations. A longer run (4000 generations) is under way to separate "slower" from "cannot".
- Per-seed results are close to the wall in the random-trained runs (all seeds 772 to 862), so the means are not hiding a split. In the fixed-trained runs there is spread (for example brain-set oscillator on random ponds: 795 to 896).

### Random-ponds training for 4000 generations (4 seeds per setup)

Same setup as above, test pass every 250 generations. Test on random ponds after 4000 generations (ticks / full / drank):

| Seed | Fixed period 200 | Brain-set oscillator |
|---|---|---|
| 1 | 803 / 0% / 0% | 794 / 0% / 0% |
| 2 | **855 / 18% / 70%** | 818 / 0% / 0% |
| 3 | 820 / 5% / 28% (drinking began near gen 3000) | 809 / 0% / 0% |
| 4 | 784 / 0% / 0% | 829 / 0% / 0% |

- **Random-ponds training can learn to drink, but rarely and late:** 2 of 4 runs with the fixed period and 0 of 4 with the brain-set oscillator had started drinking after 4000 generations; in the two that did, it began between generation 3000 and 4000. The other six sat at the thirst wall (784 to 829) the whole time. So the 1000-generation result was not just "slower": most seeds do not find drinking at all when the ponds keep moving.
- Where drinking appeared, it transferred equally to far-corners (seed 2: 865 on far-corners against 855 on random ponds), so these dots learned a search-and-drink behaviour, not a layout.
- Next: a curriculum into random ponds (`run-rand-curriculum.js`: ponds within 16, 22, 28 and 36 tiles of the nearer food centre, then the real task), the same trick that took the far-corners map from 36% to 59% full.

### Curriculum into random ponds (8 seeds per setup)

`run-rand-curriculum.js`, stores of 500, ponds placed within 16, 22, 28, 36 tiles of the nearer food centre (never closer than 12) and then the real task (at least 30 tiles away). A stage ends when 15% of the dots survive the whole round (mean of the last 10 generations), capped at 400 generations (first stage 1000). The real-task stage runs its 400 generations, then 1000 more. Tested on 20 held-out random layouts and on far-corners.

| Setup | Random ponds (ticks / full / drank) | Far corners (ticks / full) | Seeds drinking (at least 25% drank) |
|---|---|---|---|
| Fixed period 200 | 826 ± 21 / 16% / 54% | 830 ± 22 / 16% | 7 of 8 |
| Brain-set oscillator | 824 ± 19 / 16% / 34% | 821 ± 21 / 15% | 5 of 8 |

Per seed (random ponds, ticks / full share): fixed period 200: 812/0, 873/29, 729/1, 746/0, 853/23, 863/16, 882/37, 853/24. Brain-set oscillator: 860/31, 850/25, 801/0, 801/0, 920/49, 795/0, 824/23, 745/2.

- **The curriculum gets drinking started much more reliably than direct training:** 12 of 16 runs drink (at least 25% of dots), against 2 of 8 after 4000 generations of direct training (and 2000 or so generations in total here against 4000 there). Where the early stages are passed, the near-pond stage is learned in under 300 generations in every seed.
- **But the outcomes are two-valued and the means barely move.** Mean survival on random ponds (826, 824) is no better than dots trained for 1000 generations on the fixed far-corners map and then tested on random ponds (832, 832, see above). The curriculum's good runs (853 to 920, up to 49% full) are about as good as the best fixed-map runs; its bad runs sit at the wall or just above it. With 8 seeds and a standard error near 20 ticks, I cannot rank the curriculum against fixed-map training on the random test maps.
- **Fixed-period 200 started drinking in more seeds than the brain-set oscillator (7 against 5)**, in line with the earlier finding that a hand-picked period is the easier clock, but 8 seeds do not separate them.
- **Seeds that drank but stayed under the wall** (osc200 seeds 3 and 4: 729 and 746 with 65% and 45% drank) drink too late or too early to gain from it. They may be mid-learning; the final stage was cut at 1400 generations.
- **What this means for the plan:** the far-corners task was already easy enough that most of its result survives moving the ponds. The random layout adds a hard start but not a much higher ceiling (best 920 of 1000). To push the brains, the next worlds need to change what has to be done, not where the ponds are: longer rounds with several thirst cycles, then obstacles.

## Longer rounds: 3000 ticks, several thirst cycles (8 seeds per setup, 1000 generations)

Setup: far corners, stores of 500, centre start, memory on, survival score, `genLen` 3000 (the thirst wall stays at 833 ticks, so a dot needs about four drinking trips to last the round). Direct training, no curriculum. Batch script kept outside the repo; one run takes about 1 min 46 s (3x a 1000-tick run); 24 runs took about 12 minutes.

| Setup | survived (of 3000) | drank | full round (3000) | seeds above 1000 ticks |
|---|---|---|---|---|
| No clock | 1030 | 52% | 5.8% | 3 of 8 |
| Fixed period 200 | 1222 | 89% | 10.2% | 7 of 8 |
| Brain-set oscillator | 1222 | 83% | 11.9% | 6 of 8 |

Per seed (survived): no clock 1186, 808, 816, 894, 819, 1617, 801, 1295; fixed 200: 1267, 1270, 891, 1166, 1330, 1322, 1267, 1259; brain-set: 828, 1763, 1362, 1315, 726, 1288, 1233, 1261.

- **Nobody solves it.** The best mean is 1222 of 3000, and only 6 to 12% of dots last the whole round. Most dots get through the first thirst cycle (wall 833) and die in the second or third.
- **A clock still helps, mostly by making drinking start.** 89% / 83% of dots drink with a clock against 52% without; 7 and 6 of 8 seeds get past 1000 ticks against 3 of 8. Fixed 200 and brain-set are equal within noise (1222 each).
- **Seeds are two-valued again:** a seed either learns drinking (1200 to 1760) or stays at the wall (726 to 894).
- Not yet known: where the dots die (second or third cycle, thirst or hunger), and whether a curriculum (near ponds first) or more generations lifts the 10% ceiling.
