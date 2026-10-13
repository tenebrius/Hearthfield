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
