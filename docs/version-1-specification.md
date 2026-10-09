# Settlement Sim — Version 1 Specification

Oct 9, 2026 · @Divish Shamloll

## Purpose

Version 1 exists to prove one thing: that trade between households can emerge organically from needs, scarcity and distance, and that the trade logic is correct. Everything in this version is there because trade cannot be tested without it. Everything else is deferred.

The simulation is a 2D tile world watched from above. Settlers arrive, choose a profession and a site, produce, consume, and walk to each other to trade. Nothing is scripted: no markets are placed, no professions are assigned, no population target is set. Households act in their own interest with limited knowledge, and villages, markets and a division of labour are what we hope to see.

### Why so small

Each system added before trade works makes trade harder to debug, because any wrong behaviour could come from three places instead of one. With two goods, two professions and two needs, every number on screen has one cause. When prices or flows look wrong, the fault is in the trade logic or nowhere.

### Why not smaller

Trade needs a reason to exist. One good gives nobody anything to exchange. Two goods, each produced by one profession and consumed by both, is the smallest economy where every household depends on a stranger. Migration is kept because the farmer-to-woodcutter ratio must find itself through prices, and that needs new settlers choosing. Distance is kept because without it every tile is equal and no geography emerges.

### Why it is still a miniature of the full thing

Nothing in this version is throwaway. The map is layers; later features are more layers. Professions are data; later professions are more entries. Markets are clusters of sellers, not objects; later market behaviour refines the same rule. Migration emits household created and removed events; a later demography system emits the same events through birth and death. The version 1 code is the foundation, not a prototype to replace.

### Guiding rules for the implementer

1. Prefer a rule that reads the map over a rule that reasons. A seller does not judge where buyers are; a footfall layer records where buyers walked.
2. No defaults that pretend to be knowledge. A good is worth what local buyers actually pay. An unknown price is unknown, not a guessed constant.
3. Every system touches only its own components and layers, and tells the world what happened through events.
4. When in doubt between realism and legibility, choose legibility. Version 1 must be easy to watch and easy to debug.

## Scope

Version 1 is two goods, two professions, two needs, one decision rule and one trade rule, on a flat 2D map, with households arriving and leaving.

| Area | In version 1 | Deferred, and why |
| --- | --- | --- |
| Map | 2D tile grid; fertility and forest layers; water as impassable tiles | Elevation, rivers as transport, marsh, roads. Each is one more layer that changes scores; none is needed for trade. |
| Goods | Grain, wood | Tools, cloth, ore, gold. Each is a data entry once the two-good economy is proven. |
| Needs | Food (grain), warmth (wood), constant rates | Seasons, status, housing. Seasons are a multiplier system on existing rates. |
| Professions | Farmer, woodcutter, chosen at arrival, fixed for life | Career change, crafts, mining. Same scoring, more entries. |
| Production | Continuous daily output; farm area fixed | Annual harvest, labour-limited area, draught animals, fallow. Annual harvest forces storage and savings behaviour, a whole planning layer. |
| Households | One unit, fixed size, coins and two stocks | Individuals, births, marriages, deaths, inheritance. Migration provides population change instead. |
| Trade | Price beliefs, bid/ask matching, buyers walk to sellers | Merchants, credit, stall placement, market days. Stall placement is the first expansion. |
| Rendering | Coloured pixels, smooth movement | Sprites, animation, sound. |
| Time | Fixed tick = 1 day, no seasons, no weather | Seasons, weather, bad harvests. |

### What is deliberately not simplified

- Households still walk; movement is not instant. Distance is the source of geography and must be real.
- Price beliefs and matching are implemented in full. This is the part under test.
- Knowledge is local. Households know only prices they have seen. No global price variable exists anywhere in the simulation.
- Profession choice uses observed local conditions, not a table of default values.

### What the first run should show

Settlers arrive and farm the fertile land. Grain becomes cheap and land scarce. Wood, which nobody sells, becomes the only way to earn, so new settlers cut wood at the forest edge nearest the farms. Farmers walk to buy wood; woodcutters walk to buy grain. Prices settle. The ratio of the two professions stops changing. Cut fertility in half, and the whole picture visibly shifts.

## Architecture

The simulation is an entity component system with shared grid layers and an event bus. Systems are independent functions that read and write components and layers; they nepver call each other and never hold references to each other.

&#91;embedded content: architecture · 6 systems, shared state, event bus\]

A new system plugs in by declaring what it reads, writes, emits and listens for. The implementer of a later system reads that declaration, not the rest of the code.

### Entities and components

An entity is an integer id. A component is a plain data record attached to an id. Version 1 needs few: Position, Profession, Stocks (grain, wood), Coins, Needs state, PriceBeliefs, Movement target, and Claimed tiles for farmers. Keep components as flat arrays of numbers indexed by entity id, not objects; it is faster and makes serialization for tests trivial.

### Grid layers

A layer is a flat typed array of width times height. Version 1 has fertility (0 to 1), forest stock (0 to 1, regrows), water (boolean) and tile owner (entity id or none). Layers are the simulation's blackboard: a later soil system restores fertility without the farming system knowing it exists.

### Events

Systems record events into a per-tick list; other systems read the list at their turn. Version 1 events: HouseholdCreated, HouseholdRemoved, TradeCompleted, NeedUnmet, ArrivedAt. Events are also the log the debug tools and tests read.

### System registry and scenario presets

Each system registers with a name and a manifest of components, layers and events it uses. A scenario file names the map generator, the enabled systems and starting conditions. The farmers-only stage is a scenario with trade and woodcutting off, not a separate build. At startup, the registry warns if an enabled system needs a layer or event no enabled system provides.

### Simulation and rendering are separate

The simulation steps in fixed ticks and knows nothing about the screen. The renderer reads positions and interpolates between the previous and current tick so movement stays smooth at any simulation speed. Running headless, with no renderer at all, must be possible from the first day; tests depend on it.

### Stack

TypeScript. bitECS for entities and components, PixiJS drawing coloured rectangles for rendering, Vite for the dev loop. No framework around it. Keep the simulation in a package with zero browser imports so it runs in Node for tests.

## World

The world is a square grid of tiles, flat, with no elevation. A tile is 1 unit; a household walks a fixed number of tiles per tick.

### Grid and generation

- Size: 128 by 128 for development, 256 by 256 for runs. Both must work; nothing may assume a size.
- Fertility: a noise field scaled to 0 to 1, with a threshold below which land is not arable (around 0.3). Noise octaves should give a few large fertile valleys, not scattered specks, or clustering never appears.
- Forest: a second noise field, 0 to 1, representing standing wood. Correlate it slightly negatively with fertility so forest tends to sit beside fields, not on them.
- Water: tiles above a threshold on a third field are water. Impassable and unusable. Keep it sparse in version 1; it only exists to prove that pathing respects obstacles.
- The generator takes a seed. The same seed produces the same map, always.

### Movement

Movement is point to point on the grid with obstacle avoidance. Use A\* on the tile grid with 8-way movement, with path results cached per origin and destination pair for the tick. Households are small in number in version 1, so performance is not a concern yet, but the interface must be one function, findPath(from, to), so it can be replaced later by a flow-field or road-aware version.

A household is either at home, walking to a target, or at the target. Walking speed is a constant number of tiles per tick. Nothing teleports, including arriving and departing settlers, who walk from and to the nearest map edge.

### Time

One tick is one day. There are no seasons in version 1; all rates are constant. The simulation keeps a tick counter and nothing else about calendar time. Seasons later become a system that scales production and consumption rates by a factor read from the tick counter.

### Reach

Several rules use a reach radius: free land within reach for a farmer, forest within reach for a woodcutter, trade partners within reach for viability. Reach is measured in path length, not straight line, so water and later terrain shape it. One global constant for version 1, around 12 tiles, kept in the parameter table.

## Households

A household is the only agent. It is one entity with a fixed size, one profession, a home tile, coins, and a stock of each good. There are no individuals inside it.

### Components

| Component | Fields | Written by |
| --- | --- | --- |
| Position | x, y (floats, for smooth movement) | Movement |
| Home | tile x, y | Settling |
| Profession | id (farmer, woodcutter) | Settling, at creation only |
| Stocks | grain, wood (floats) | Production, Needs, Trade |
| Coins | amount (float) | Trade, Migration (starting purse) |
| NeedState | daysFoodUnmet, daysWarmthUnmet | Needs |
| PriceBeliefs | per good: low, high | Trade |
| Travel | target x, y, purpose, or none | Trade, Movement, Migration |
| ClaimedTiles | list of tile indices (farmers) | Settling |

### Needs

Two needs, both consumed daily at a constant rate: food, met from the grain stock, and warmth, met from the wood stock. Rates are in the parameter table.

Each day the Needs system subtracts the daily amount from the stock. If the stock is short, the need is unmet that day and the counter rises; a day fully met resets it to zero. A NeedUnmet event is emitted on each unmet day. There is no gradual hunger, no health, no productivity penalty in version 1. Unmet means the counter rises, nothing more.

Food is the priority need. When a household decides what to buy, it buys grain before wood if both are short. Warmth matters only once food is covered.

### Urgency

Trade decisions need a notion of how badly a household wants a good. Urgency is a function of days of stock remaining: stock divided by daily rate. Below a comfort level (say 10 days), urgency rises steeply; above a full level (say 30 days), it is zero and the household treats any extra as surplus to sell. This one curve drives both buying and selling and replaces any explicit surplus or shortage logic. Keep it as a single pure function, urgency(daysRemaining), and tune it in one place.

### Leaving

A household leaves when either need counter exceeds a threshold (around 20 days). It releases its claimed tiles, emits HouseholdRemoved, and walks to the nearest map edge, where it is destroyed. Coins and stock leave with it. This is the only failure mode in version 1. There is no death.

### Starting state

A new household arrives with a small purse of coins and a few days of grain, and no wood. The purse is deliberately small: it should let a woodcutter survive the walk to its first sale, not fund weeks of buying. If starting purses are large, trade looks healthy for a while on money that nobody earned, and the test is meaningless.

## Professions

A profession is a data entry, not code. The two entries in version 1 are the template for every later one.

| Field | Farmer | Woodcutter |
| --- | --- | --- |
| Produces | grain | wood |
| Resource layer | fertility | forest |
| Claims tiles | yes, a fixed count of the best free arable tiles within reach of home | no |
| Daily output | sum of fertility over claimed tiles times a rate | forest stock within reach times a rate, which depletes the layer |
| Feeds itself | yes | no, must buy grain |
| Site score | resource access minus trade access cost | resource access minus trade access cost |

The production system reads the entry and does the same thing for both: look at the resource layer around home, produce output into Stocks, and for depleting resources subtract from the layer. Forest regrows by a small amount per tick toward its generated value. A profession that produces something nobody consumes yet, such as a future miner, needs no new production code.

### Site scoring

When a settler chooses where to live, every candidate tile is scored the same way for every profession:

```latex
score = resourceAccess(tile) - tradeCost(tile)
```

- resourceAccess: for a farmer, the sum of fertility over the best N free arable tiles within reach of this tile; for a woodcutter, the sum of forest stock within reach. Zero if nothing usable is in reach.
- tradeCost: the path distance to the nearest household that sells the good this profession must buy, times a weight. Infinite if no such household is within reach and the profession cannot feed itself.

Candidate tiles are sampled, not exhaustively scored: take a few hundred random non-water tiles plus the tiles adjacent to existing households, score them, and pick the best. Exhaustive scoring of a 256 by 256 map per arrival is too slow and gains nothing.

A farmer's tradeCost is zero in the farmers-only stage, because farmers need nothing yet. Once wood exists, farmers also score distance to woodcutters, which pulls the two professions together.

### Viability and expected income

Before choosing a site, the settler decides what to be. For each profession it computes expected daily income at that profession's best site:

```latex
income = min(output, localDemand) \times localPrice - costOfFood
```

- localPrice is the price the settler can observe for its output: the average of recent TradeCompleted prices for that good within reach of the site. If there are none, but households within reach have an unmet need for that good and coins to spend, the price is the bootstrap anchor; those households are buyers who have found no seller, and without this rule the first woodcutter could never appear. If there are neither trades nor unmet buyers, the price is zero. There are no other defaults.
- localDemand is a cap on sales: the number of households within reach that consume the good, times their daily rate, minus what sellers within reach already supply. This stops the tenth woodcutter from valuing a market that four woodcutters already saturate.
- costOfFood is zero for a farmer. For a woodcutter it is the daily grain need times the observed local grain price, and infinite if no grain is sold within reach.

The settler picks the profession with the highest income, with a small random perturbation so that a change in conditions produces a drift in arrivals rather than a wave. A profession whose income is infinite negative is not an option. On an empty map, only farming is viable; that is correct and intended.

### Why the fixed farm area

Farm size is a labour and land question that would add a whole decision layer. A fixed count of claimed tiles keeps farms comparable, and fertility still varies the harvest, so rich and poor farms exist. The claim logic lives in one function so the fixed count can be replaced later without touching the rest.

## Migration

Migration is the only source of population change in version 1. It replaces births and deaths with arrivals and departures, and it is the system that lets the profession ratio find itself.

### Arrival

- A settler is considered every K ticks (around 5). The interval is a parameter; it sets how fast the world fills.
- The settler evaluates professions and sites as described under Professions. If no profession is viable, no settler arrives this interval. This matters: an exhausted map stops attracting people on its own.
- A viable settler is created at the map edge nearest its chosen site, with the starting purse and grain, and walks to its site. Its home is set on arrival, tiles are claimed on arrival, and HouseholdCreated is emitted then, not at the edge. Nothing produces or trades until the settler is home.

Arrival rate should not yet respond to prosperity. A constant interval is simpler and the viability check already stops arrivals when the land cannot support more. A prosperity-driven rate is a later refinement.

### Departure

Departure is handled under Households: a need counter over threshold triggers leaving. Migration owns nothing about it except listening for HouseholdRemoved to keep its counts.

### Why no births or deaths

A demographic model needs ages, household splitting, inheritance and labour that changes over a life. None of it affects whether trade works. Migration gives the same inputs to the rest of the simulation, households appearing and disappearing, through the same two events. A later demography system replaces this one by emitting the same events for different reasons.

### What to watch for

The interaction between arrival and departure is the first place oscillation can appear: settlers arrive, overload the local grain supply, many leave at once, prices crash, settlers arrive again. The randomness in profession choice and the demand cap in expected income both damp this. If a scenario still oscillates, lengthen the arrival interval before touching anything else.

## Trade

Trade in version 1 is a visit: a household walks to another household's home, the two compare prices for both goods, and trade what overlaps. There is no market object, no auction house, and no global price. Everything a household knows about prices it learned from its own trades.

### Roles

Every household sells the good it produces and buys the good it does not. There are no merchants. In the farmers-only stage, nobody needs anything from anyone, and trade does not occur; that is the correct result, and it is the first test.

### Price beliefs

Each household holds, per good, a belief range \[low, high\] of what the good costs. The belief is the household's whole model of the market.

- Initial belief: a new settler copies the beliefs of the nearest household within reach. If no household within reach has traded that good, the belief is set to the bootstrap anchor (1 coin per unit) with a wide range. The anchor is not knowledge of value; it only fixes the coin unit so that the first trades can happen. It is used only when no trade of that good has ever been observed in reach, and beliefs move away from it immediately.
- Beliefs are updated only by the household's own trades and failed attempts. Households do not read each other's beliefs after arrival.

### Bid and ask

When two households meet, each forms a bid for what it wants to buy and an ask for what it wants to sell, from its belief range and its urgency:

```latex
bid = low + (high - low) \cdot urgency
```

```latex
ask = high - (high - low) \cdot surplusPressure
```

- urgency is the buyer's urgency for that good (see Households), 0 when stock is at or above full, rising toward 1 as it runs out. A desperate buyer bids its high; a comfortable one bids its low.
- surplusPressure is 0 when the seller holds no more than its own target stock and rises toward 1 as its surplus grows. A seller sitting on a glut asks its low.
- A household never sells below what it needs itself: tradable quantity is stock minus its own target, never less than zero.

### Matching

If bid is at least ask, a trade happens at the midpoint. Quantity is the smallest of what the buyer wants (target minus stock), what the seller can spare, and what the buyer can afford at that price. Coins and goods move, and a TradeCompleted event records good, price, quantity and tile. If bid is below ask, no trade happens and both record the failure.

Both goods are considered at every visit, in each direction, food first. A woodcutter visiting a farmer may sell wood and buy grain in the same visit. This halves the walking and matches how a real visit would go.

### Learning

After each attempt, each side adjusts its belief for that good:

- Trade happened at price p: move both low and high a step toward p and shrink the range by a factor. Beliefs converge on the clearing price.
- Buyer failed (bid below ask): raise high toward the ask seen. The buyer will offer more next time.
- Seller failed (ask above bid): lower low toward the bid seen. The seller will accept less next time.
- A range that shrinks below a minimum width is widened back to it, so beliefs never freeze.

Step size and shrink factor are parameters. Large steps make prices jumpy, small steps make them slow to find a level. Start at 0.2 and tune by watching the price chart.

### Deciding to make a trip

Each day, a household at home checks two triggers:

1. Need trigger: urgency for a good it does not produce exceeds a threshold and it has coins. It picks a destination among known sellers.
2. Surplus trigger: surplusPressure for its product exceeds a threshold. It picks a destination among known consumers of that good.

Known means within reach of home. A destination is the nearest known partner not on cooldown, except that the partner of the last successful trade is preferred if it is no more than half again as far. A household knows nothing about other households' prices, so distance and past success are all it has to go on. The household walks there, trades, and walks home. One trip at a time; nothing is produced while away. That lost production is the real cost of distance, and it is what makes households prefer close partners.

A failed trip raises the household's willingness for next time through the learning rules above, so repeated failures are self-correcting: the buyer bids more, the seller asks less, and the trade eventually clears or the household leaves.

### Coins

Coins are a closed system. They enter with arriving settlers' purses and leave with departing households. No coins are minted or destroyed by trade. Total coins in the world must always equal purses in minus purses out; a test asserts this every tick.

A household with no coins and no surplus cannot buy, and its need counter rises until it leaves. That is intended. Credit comes later, if ever.

### What correct looks like

- Grain flows from farmers to woodcutters and wood from woodcutters to farmers. Net flow of each good is in one direction only.
- Each household's belief range for a good narrows over time, and neighbouring households' belief midpoints converge toward each other.
- Price of wood rises when woodcutters are scarce and falls as they arrive. Grain the reverse.
- No household trades below its own target stock, and no coin is created.
- After a change in fertility, prices and the profession ratio move in the right direction and settle again.

## Tick order and determinism

Systems run in a fixed order every tick. The order is a decision, not an accident; changing it changes behaviour.

1. Migration: consider a new settler; create it at the edge if viable.
2. Movement: advance every travelling household along its path. Emit ArrivedAt for any that reached a target.
3. Settling: households that arrived at a chosen site set home and claim tiles; emit HouseholdCreated.
4. Production: households at home produce; depleting layers are reduced; forest regrows.
5. Needs: consume daily rates; update unmet counters; emit NeedUnmet; mark households that must leave.
6. Trade: resolve visits for households that arrived at a trading partner this tick; then evaluate trip triggers for households at home and set travel targets.
7. Departure: households marked to leave release tiles, emit HouseholdRemoved, and set the edge as their target.
8. Events for this tick are handed to listeners and the debug log, then cleared.

Production before Needs means a household eats from today's output. Trade after Needs means today's urgency drives today's decisions. Departure last means a leaving household still trades on its last day, which is harmless and avoids a special case.

### Determinism

- One seeded random generator for the whole simulation, passed to systems; never Math.random.
- Entities are iterated in id order, never in object or hash order.
- Floating point sums are done in the same order every time; avoid parallel reductions.
- Given the same seed, scenario and tick count, the world state must be identical byte for byte. A test runs the same scenario twice and compares a hash of all components.

Determinism is not a nicety. Every trade bug found later will be a specific run at a specific tick, and it must be reproducible from a seed and a number.

## Rendering and debug tools

Rendering is coloured pixels. Its job is to make every mechanism visible, not to look good.

### Pixels

- Tile: a rectangle coloured by the active overlay. Default overlay: fertility as green intensity, forest as dark green, water as blue.
- Household: a filled square, 3 by 3 pixels at base zoom, coloured by profession. Farmers one colour, woodcutters another.
- Travelling household: the same square, with a 1-pixel dot above it coloured by the good it carries, if any. Empty-handed trips show no dot. This single mark makes flows readable at a glance.
- Claimed tiles: a faint outline in the owner's colour.
- Home: a slightly larger square, so a household away from home leaves a visible gap.

Positions are interpolated between the last two ticks so motion is smooth at any simulation rate. Pan with drag, zoom with wheel.

### Overlays

Any grid layer can be shown as the tile colour: fertility, forest, tile owner, and later footfall. One key cycles overlays. This costs almost nothing and is the fastest way to see whether woodcutters are depleting forest or settlers are picking sensible land.

### Inspector

Clicking a household opens a panel with every component value: profession, stocks, coins, days of stock remaining, urgency per good, belief range per good, current travel target and purpose, and its last ten trade events with price and partner. Nearly every trade bug is found by watching one household's beliefs and trips, so this panel is the most important tool in the build.

### Controls and charts

- Pause, step one tick, and speed presets (1, 10, 100 ticks per second).
- Live charts over time: population by profession, mean belief midpoint per good, trades per day per good, total coins, number of households with an unmet need.
- A scenario picker to switch between the farmers-only and full scenarios, and a seed field.

### Headless mode

The same simulation runs in Node without the renderer. A command runs a scenario for N ticks with a seed and writes the chart series and final state to JSON. Tests and automated checks use this; the renderer is never required to answer a question about behaviour.

## Build stages

Five stages, each with a visible result and an automated check. Do not start a stage before the previous one's checks pass; every later bug is easier to find when the earlier layer is known good.

1. **World and renderer.** Map generation from a seed, overlays, pan and zoom, pause and step, headless runner that writes JSON. Done when the same seed gives the same map twice and the headless run of an empty world completes.
2. **Farmers settle and produce.** Migration with farming as the only profession, site scoring, tile claiming, production, movement with A\*. Scenario: farmers-only. Done when farms visibly cluster on fertile land, new farms sit beside old ones until land runs out, settlers stop arriving when no arable land is in reach, and a settler never walks through water.
3. **Needs and leaving.** Consumption, unmet counters, departure. Done when a map with fertility set to zero fills briefly and then empties completely, and a normal map keeps its farmers, who never leave. Coins and goods conservation tests pass.
4. **Wood and trade.** Woodcutter profession, forest depletion and regrowth, price beliefs, visits, learning, trip triggers. Scenario: full. Done when every item under Trade, What correct looks like, holds in a 2,000-tick headless run, and when the inspector shows a woodcutter's grain belief narrowing over its first ten visits.
5. **Profession choice.** Expected income, demand cap, random perturbation. Done when a fresh map fills with farmers first and woodcutters appear only after grain is traded locally, the ratio settles, and halving fertility mid-run raises grain prices and shifts arrivals toward farming.

### Automated checks that run every stage

- Determinism: two runs, same seed, identical state hash.
- Conservation: total coins equal purses in minus purses out; no stock goes negative.
- No household trades below its own target stock.
- No trade is recorded with bid below ask.
- No settler is created with a non-viable profession.

### Checks that prove trade works

- Convergence: the mean belief range width per good falls over the run and ends below a threshold.
- Agreement: the standard deviation of belief midpoints across households within reach of each other falls over the run.
- Direction: net grain flow is farmer to woodcutter and net wood flow the reverse, every 100-tick window.
- Response: compared to a baseline run, a run with half the forest has a higher wood price and a higher woodcutter share of arrivals.
- Survival: in the full scenario on a normal map, fewer than 10% of households leave over 2,000 ticks after the first 300.

The thresholds in these checks are set from the first working run, then held. They are regression guards, not targets.

## Implementation pitfalls

These are the problems most likely to appear, with what to do about each.

| Pitfall | What it looks like | What to do |
| --- | --- | --- |
| Beliefs never overlap | Woodcutters bid 1 coin, farmers ask 3, nobody trades, everyone leaves | Learning on failure must move both sides. Check that a failed visit raises the buyer's high and lowers the seller's low. Check that the minimum range width is not zero. |
| Price collapse | Belief midpoints for grain fall to near zero as farmers compete | Verify the demand cap in expected income stops arrivals when supply exceeds demand. Verify sellers never sell below their own target stock. |
| Rich on paper | Households show healthy trade on starting purses alone, then the economy dies when purses run out | Keep the starting purse small, a few days of food. Track total coins and trades per coin; if trades keep running after purses would be spent, the economy works. |
| Trip spam | A household walks to a partner, fails, walks home, walks back the next day | Require the trigger to be re-met and add a cooldown of a few days after a failed visit. The learning step already moves prices; the cooldown just saves the walk. |
| Target chosen, partner gone | Household walks to a home that moved or left | Destinations are entity ids; on arrival, if the entity has no Home, abandon the visit and go home. Never store positions as destinations. |
| Deadlock at the same spot | Two households visit each other at the same time, both away, nobody home | Trade only resolves if the host is at home. A visit to an empty house fails without a belief update and goes home. This is realistic and self-correcting. |
| Everyone leaves at once | Need counters all cross the threshold in the same tick | Give the leave threshold a small per-household random offset at creation. |
| Settling on a crowded tile | Several households claim the same tiles | Claim at the moment of arrival, in id order, and check the owner layer before each claim; re-score if the best tiles are gone. |
| Path cost | A\* on a 256 by 256 grid per trip is fine for hundreds of households, not thousands | Keep findPath behind one interface and cache paths per tick. Replace it later; do not optimise it now. |
| Hidden globals | A system reads a module-level price or population number | Forbid it. If a system needs a number another system produces, that number is a layer, a component, or an event. |
| Tuning by code change | Constants spread through files | Every number in the parameter table lives in one config object, loaded by scenario, and visible in the debug panel. |
| Float drift | Stock slowly goes to minus one millionth and a test fails | Clamp stocks at zero after consumption and treat anything below a small epsilon as zero in checks. |

One more to watch: liquidity. Coins enter only with purses, so the whole economy runs on a few coins per household. Prices will fall until that money is enough to carry daily trade, which is correct, but if beliefs hit the minimum width at tiny values the learning step becomes coarse. If that happens, raise the starting purse slightly rather than loosening the belief rules; the purse is the one number that only sets the price level.

### Where the implementer should expect to spend time

The learning rules and the urgency curve will take most of the tuning. Everything else is plumbing. Build the inspector before building trade, so the tuning happens with the right tool in hand.

## Parameters

Starting values, all in one config object. They are guesses chosen so that two farmers' surplus feeds about one woodcutter and one woodcutter's surplus warms about two farmers; they will be tuned from the first runs.

| Parameter | Value | Notes |
| --- | --- | --- |
| Map size | 128 (dev), 256 (run) | Tiles per side |
| Arable threshold | 0.3 | Fertility below this cannot be claimed |
| Reach | 12 | Path length, tiles |
| Walk speed | 2 | Tiles per tick |
| Tick | 1 day | No seasons |
| Farm tiles | 6 | Claimed per farmer |
| Grain per tile per day | 0.4 × fertility | A farm on fertility 0.7 yields about 1.7 per day |
| Wood per day | 3.0 × mean forest in reach | Depletes the layer by the amount cut |
| Forest regrowth | 0.002 per tick | Toward generated value |
| Food need | 1.0 grain per day |  |
| Warmth need | 0.5 wood per day |  |
| Comfort stock | 10 days | Urgency starts rising below this |
| Full stock | 30 days | Target; above it is surplus |
| Leave threshold | 20 unmet days | ± random 5 per household |
| Starting purse | 5 coins |  |
| Starting grain | 5 | Days of food |
| Bootstrap anchor | 1 coin per unit | Belief \[0.5, 2.0\] when no trade observed |
| Belief step | 0.2 | Fraction moved toward price on success |
| Belief shrink | 0.9 | Range multiplier on success |
| Belief min width | 10% of midpoint |  |
| Need trip trigger | urgency > 0.3 |  |
| Surplus trip trigger | surplusPressure > 0.5 |  |
| Failed visit cooldown | 3 ticks |  |
| Preferred partner margin | 1.5 × distance | Last successful partner kept if within this |
| Arrival interval | 5 ticks |  |
| Profession noise | ±10% | On expected income |

The first tuning target: with these values a map should support roughly two farmers per woodcutter, and a woodcutter's income should cover its food with a margin. If woodcutters leave, raise wood per day or lower warmth need; if farmers go short of wood, do the reverse. Change one number per run.
