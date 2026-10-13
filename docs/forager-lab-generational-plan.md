# Forager Lab: generational mode plan

Status: agreed plan, not built yet (2026-10-13). Forager Lab is now treated as a learning project in its own right, separate from Hearthfield.

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
| Crossover | **Option, off by default:** uniform crossover (each weight from one of two parents). |
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
