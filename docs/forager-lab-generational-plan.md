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
