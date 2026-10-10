# Settlement Sim — Version 1 Specification

Oct 9, 2026 · @Divish Shamloll

## Purpose

Version 1 exists to prove one thing: that trade between households can emerge organically from needs, scarcity and distance, and that the trade logic is correct. Everything in this version is there because trade cannot be tested without it. Everything else is deferred.

The simulation is a 2D tile world watched from above. Settlers arrive, choose a site, and each day choose what work to do: farm or cut wood. They produce, consume, and walk to each other to trade. Nothing is scripted: no markets are placed, no professions are assigned, no population target is set. Households act in their own interest with knowledge limited to what is within their reach, and villages, markets and a division of labour are what we hope to see.

### Why so small

Each system added before trade works makes trade harder to debug, because any wrong behaviour could come from three places instead of one. With two goods, two activities and two needs, every number on screen has one cause. When prices or flows look wrong, the fault is in the trade logic or nowhere.

### Why not smaller

Trade needs a reason to exist. One good gives nobody anything to exchange. Two goods, each needed by everyone, is the smallest economy where a household can gain by depending on a stranger. Any household can make both goods, so trade only happens when it pays: when a neighbour's land or practice makes them better at one good than you are. That is the division of labour the simulation is meant to show emerging. Migration is kept because the world must fill by people choosing where to live. Distance is kept because without it every tile is equal and no geography emerges.

### Why it is still a miniature of the full thing

Nothing in this version is throwaway. The map is layers; later features are more layers. Activities are data; later activities are more entries. Markets are clusters of sellers, not objects; later market behaviour refines the same rule. Migration emits household created and removed events; a later demography system emits the same events through birth and death. The version 1 code is the foundation, not a prototype to replace.

### Guiding rules for the implementer

1. Prefer a rule that reads the map over a rule that reasons. A seller does not judge where buyers are; a footfall layer records where buyers walked. A household does not predict who will arrive; it looks at who is within reach now.
2. No defaults that pretend to be knowledge. A good is worth what local buyers actually pay. An unknown price is unknown, not a guessed constant.
3. Every system touches only its own components and layers, and tells the world what happened through events.
4. When in doubt between realism and legibility, choose legibility. Version 1 must be easy to watch and easy to debug.

## Scope

Version 1 is two goods, two activities, two needs, one daily work rule and one trade rule, on a flat 2D map, with households arriving and leaving.

| Area | In version 1 | Deferred, and why |
| --- | --- | --- |
| Map | 2D tile grid; fertility and forest layers; water as impassable tiles | Elevation, rivers as transport, marsh, roads. Each is one more layer that changes scores; none is needed for trade. |
| Goods | Grain, wood | Tools, cloth, ore, gold. Each is a data entry once the two-good economy is proven. |
| Needs | Food (grain), warmth (wood), constant rates, equal priority | Seasons, status, housing. Seasons are a multiplier system on existing rates. |
| Activities | Farming, woodcutting. Any household may do either on any day; skill grows with practice | Crafts, mining. Same daily rule, more entries. |
| Production | Continuous daily output; farm area fixed; fields held only while worked | Annual harvest, labour-limited area, draught animals, fallow. Annual harvest forces storage and savings behaviour, a whole planning layer. |
| Households | One unit, fixed size, coins, two stocks, a skill per activity | Individuals, births, marriages, deaths, inheritance. Migration provides population change instead. |
| Trade | Price beliefs, bid/ask matching, buyers walk to sellers | Merchants, credit, stall placement, market days. Stall placement is the first expansion. |
| Rendering | Coloured pixels, smooth movement | Sprites, animation, sound. |
| Time | Fixed tick = 1 day, no seasons, no weather | Seasons, weather, bad harvests. |

### What is deliberately not simplified

- Households still walk; movement is not instant. Distance is the source of geography and must be real.
- Price beliefs and matching are implemented in full. This is the part under test.
- Knowledge is limited by reach (see below). No global price variable exists anywhere in the simulation.
- The daily choice of work uses observed local conditions, not a table of default values.

### Knowledge is limited by reach

A household can observe anything within reach of its home: its neighbours' stocks and urgency, and the trades completed within reach. It observes nothing beyond reach. No global price, population or supply figure exists anywhere in the simulation. Price beliefs are updated only by the household's own trades; a household never reads another household's beliefs after arrival. Arriving settlers judge candidate sites by what is observable within reach of each site; this counts as hearsay and is the one exception.

This rule is what makes price discovery a real test, what lets distant clusters hold different prices, and what later gives merchants a gap to trade on.

Wherever a rule counts neighbours within reach, each neighbour is weighted by closeness, so that a neighbour one tile inside reach does not count fully while one tile outside counts not at all:

```latex
closeness(h) = 1 - pathDistance(h) / reach
```

### What the first run should show

The first settlers arrive and homestead on the forest edge beside fertile land, farming some days and cutting wood on others. As more arrive, some land on rich soil with thin forest and others on poor soil with thick forest. Neighbours begin to trade, because each is better at one good than the other. Practice widens the gap: those who farm most become better farmers, those who cut most become better woodcutters. Farmers walk to buy wood; woodcutters walk to buy grain. Prices settle. The share of time spent on each activity stops changing. Cut fertility in half, and the whole picture visibly shifts.

## Architecture

The simulation is an entity component system with shared grid layers and an event bus. Systems are independent functions that read and write components and layers; they never call each other and never hold references to each other.

&#91;embedded content: architecture · 6 systems, shared state, event bus\]

A new system plugs in by declaring what it reads, writes, emits and listens for. The implementer of a later system reads that declaration, not the rest of the code.

### Entities and components

An entity is an integer id. A component is a plain data record attached to an id. Version 1 needs few: Position, Home, Skills, Activity, Stocks (grain, wood), Coins, Needs state, PriceBeliefs, Travel, and Claimed tiles. Keep components as flat arrays of numbers indexed by entity id, not objects; it is faster and makes serialization for tests trivial.

### Grid layers

A layer is a flat typed array of width times height. Version 1 has fertility (0 to 1), forest stock (0 to 1, regrows), water (boolean), tile owner (entity id or none) and tile last worked (tick). Layers are the simulation's blackboard: a later soil system restores fertility without the farming system knowing it exists.

### Events

Systems record events into a per-tick list; other systems read the list at their turn. Version 1 events: HouseholdCreated, HouseholdRemoved, TradeCompleted, NeedUnmet, ArrivedAt, ActivityChosen. Events are also the log the debug tools and tests read.

### System registry and scenario presets

Each system registers with a name and a manifest of components, layers and events it uses. A scenario file names the map generator, the enabled systems, the enabled activities, the enabled needs and starting conditions. The farming-only stage is a scenario with woodcutting, trade and the warmth need off, not a separate build. A scenario can also schedule interventions: at tick T, multiply layer X by a factor. Nothing in version 1 changes fertility on its own; interventions are how checks apply a shock such as halving fertility mid-run. At startup, the registry warns if an enabled system needs a layer or event no enabled system provides.

### Simulation and rendering are separate

The simulation steps in fixed ticks and knows nothing about the screen. The renderer reads positions and interpolates between the previous and current tick so movement stays smooth at any simulation speed. Running headless, with no renderer at all, must be possible from the first day; tests depend on it.

### Stack

TypeScript. bitECS for entities and components, PixiJS drawing coloured rectangles for rendering, Vite for the dev loop. No framework around it. Keep the simulation in a package with zero browser imports so it runs in Node for tests.

## World

The world is a square grid of tiles, flat, with no elevation. A tile is 1 unit; a household walks a fixed number of tiles per tick.

### Grid and generation

- Size: 128 by 128 for development, 256 by 256 for runs. Both must work; nothing may assume a size.
- Fertility: a noise field scaled to 0 to 1, with a threshold below which land is not arable (around 0.3). Noise octaves should give a few large fertile valleys, not scattered specks, or clustering never appears.
- Forest: a second noise field, 0 to 1, representing standing wood. Correlate it slightly negatively with fertility so forest tends to sit beside fields, not on them. Soil and forest should vary enough between nearby sites that neighbours differ in what their land is good for; this difference is what first makes trade pay.
- Water: tiles above a threshold on a third field are water. Impassable and unusable. Keep it sparse in version 1; it only exists to prove that pathing respects obstacles.
- The generator takes a seed. The same seed produces the same map, always.

### Movement

Movement is point to point on the grid with obstacle avoidance. Use A\* on the tile grid with 8-way movement, orthogonal steps costing 1 and diagonal steps √2 (the same costs define path length for reach), with path results cached per origin and destination pair for the tick. Households are small in number in version 1, so performance is not a concern yet, but the interface must be one function, findPath(from, to), so it can be replaced later by a flow-field or road-aware version.

A household is either at home, walking to a target, or at the target. Walking speed is a constant number of tiles per tick. Nothing teleports, including arriving and departing settlers, who walk from and to the nearest map edge.

### Time

One tick is one day. There are no seasons in version 1; all rates are constant. The simulation keeps a tick counter and nothing else about calendar time. Seasons later become a system that scales production and consumption rates by a factor read from the tick counter.

### Reach

Several rules use a reach radius: forest within reach for woodcutting, neighbours within reach for trade and for site choice. Reach is what a household knows about, what it can trade with, and the distance at which closeness falls to zero. It is measured in path length, not straight line, so water and later terrain shape it.

Reach is defined in days, not tiles: it is as far as a household would walk to trade.

```latex
reach = walkSpeed \times maxTripDays
```

With a walk speed of 6 tiles per tick and a maximum one-way trip of 2 days, reach is 12 tiles, so the furthest neighbour is a 4-day round trip and a typical one 1 to 2 days. Defining it this way keeps trips from quietly becoming week-long when walk speed changes, for instance when roads arrive.

Fields are held to a smaller farm radius around home (around 4 tiles), so that a farm reads as a farm on screen rather than tiles scattered across the whole reach.

## Households

A household is the only agent. It is one entity with a fixed size, a home tile, coins, a stock of each good, and a skill for each activity. There are no individuals inside it, and it has no fixed profession: what it does is decided each day.

### Components

| Component | Fields | Written by |
| --- | --- | --- |
| Position | x, y (floats, for smooth movement) | Movement |
| Home | tile x, y | Settling |
| Skills | per activity: skill (1.0 to skill cap) | Production |
| Activity | today's activity, days per activity over the last 30 ticks | Production |
| Stocks | grain, wood (floats) | Production, Needs, Trade |
| Coins | amount (float) | Trade, Migration (starting purse) |
| NeedState | per need: days unmet | Needs |
| PriceBeliefs | per good: low, high | Trade |
| Travel | target entity or tile, purpose, or none | Trade, Movement, Migration |
| ClaimedTiles | list of tile indices | Production |

A household's **main activity** is the activity it did on the most days in the last 30 ticks. It is used for display, charts and checks, never by the simulation's own decisions.

### Needs

Needs are data entries. Each names the good that meets it, a daily rate, a leave threshold and a priority. Version 1 has two: food, met from the grain stock, and warmth, met from the wood stock. Rates and thresholds are in the parameter table. Both have equal priority in version 1; the priority field exists so that later needs of different severity can use it, and is unused for now.

Each day the Needs system subtracts the daily amount from the stock of every household with a home. A settler walking in from the map edge does not consume until it is home; its starting stock is for its first days at home, not for the walk. If the stock is short, the need is unmet that day and the counter rises; a day fully met resets it to zero. A NeedUnmet event is emitted on each unmet day. There is no gradual hunger, no health, no productivity penalty in version 1. Unmet means the counter rises, nothing more.

### Urgency

Work and trade decisions need a notion of how badly a household wants a good. Urgency is a function of days of stock remaining: stock divided by daily rate. Above a full level (30 days) it is zero and the household treats any extra as surplus to sell. Between full and comfort (10 days) it rises slowly; below comfort it rises steeply toward 1. A starting shape:

| Days of stock | Urgency |
| --- | --- |
| 30 or more | 0 |
| 10 | 0.2 |
| 0 | 1 |

linear between those points. Keep it as a single pure function, urgency(daysRemaining), and tune it in one place.

Every need uses the same curve, so the more urgent good is always the one closer to running out, and a household buys that one first. Work is decided by value, which also scales with output, so a household leans toward its more productive activity and lets the other stock run lower, switching once that stock's urgency makes it worth more. That is reasonable economics, it balances needs without a priority rule, and the starting wood covers the one moment it could cause harm: arrival, when wood is at zero on a site rich in soil and poor in forest.

### Skill

Each household has a skill for each activity, starting at 1.0. A skill of 1.0 is an unskilled generalist, and the base rates in the parameter table are set so that an unskilled household on a normal site can just meet both needs alone. Practice raises skill toward a cap; neglect lets it fall back toward 1.0:

```latex
\text{on a day doing } a: \quad skill_a \mathrel{+}= growth \cdot (cap - skill_a)
```

```latex
\text{on a day not doing } a: \quad skill_a \mathrel{-}= decay \cdot (skill_a - 1)
```

Skill is the source of both specialisation and friction. A household that has practised one activity produces more of it, so it gains by trading for the other good rather than making it. And because a household judges every activity at its current skill, it only switches when the other activity pays more by about the ratio of its skills. A small price gap moves nobody; a real shortage does.

### Leaving

A household leaves when any need counter exceeds that need's leave threshold. It releases its claimed tiles, emits HouseholdRemoved, and walks to the nearest map edge, where it is destroyed. Coins and stock leave with it. This is the only failure mode in version 1. There is no death.

### Starting state

A new household arrives with a small purse of coins, a few days of grain, a few days of wood, and skill 1.0 in every activity. The purse is deliberately small: it should let a household make its first purchases, not fund weeks of buying. If starting purses are large, trade looks healthy for a while on money that nobody earned, and the test is meaningless.

## Activities

An activity is a data entry, not code. The two entries in version 1 are the template for every later one.

| Field | Farming | Woodcutting |
| --- | --- | --- |
| Produces | grain | wood |
| Resource layer | fertility | forest |
| Claims tiles | yes, a fixed count of the best free arable tiles within farm radius of home | no |
| Daily output | sum of fertility over claimed tiles × rate × skill | mean forest within reach × rate × skill, which depletes the layer |

The production system reads the entry and does the same thing for both: look at the resource layer around home, produce output into Stocks, and for depleting resources subtract from the layer. A day's cut is taken from the tiles in reach in proportion to each tile's standing forest. Forest regrows by a fixed amount per tile per tick, never above the tile's generated value. An activity that produces something nobody consumes yet, such as future mining, needs no new production code.

### Fields are held by use

A household that chooses farming and holds no fields claims the best free arable tiles within farm radius of home, in id order, checking the owner layer before each claim. Every day it farms, its fields' last-worked tick is updated. A field not worked for the claim lapse period (around 10 days) is released. The lapse counts only days the household is at home: a trading trip never costs a household its fields, however long it takes; only choosing other work does. A household that farms some days and cuts wood on others keeps its fields as long as it returns to them in time; one that stops farming loses them, and its best tiles may be taken by a neighbour. That loss is a real cost of switching, and it is visible on the map.

### The daily choice

Each day, a household at home chooses one activity. It values each activity by what today's output would be worth to it, and does the one worth most. On a tie, it keeps yesterday's activity, so households do not flicker. If no activity is worth anything today, because its own stocks are full and no neighbour in reach is short, it rests: it produces nothing and depletes nothing. Rest days do not count toward main activity, and every skill decays on them.

```
output(a)      = base rate at this site × skill_a
needed(g)      = max(0, target stock − stock)                 ; target = full level, 30 days
ownUnits(a)    = min(output(a), needed(g))
ownValue(g)    = low_g + (high_g − low_g) × urgency(g)          ; the household's own bid
sellable(a)    = min(output(a) − ownUnits(a),
                     Σ over would-be buyers of g in reach: shortfall × closeness
                     − surplus already held of g)
value(a)       = ownUnits(a) × ownValue(g) + max(0, sellable(a)) × midpoint_g
```

- A good the household needs itself is worth what it would bid for it, which rises with urgency. This is what makes a household short of wood cut its own when nobody nearby sells any.
- Surplus is worth the household's own belief midpoint, the centre of its belief range: its best single guess at the price. It plans with the same beliefs it will trade with.
- Surplus only counts if someone in reach would buy it. A **would-be buyer** is a neighbour below its own target stock of the good, that is, with urgency above zero. Its **shortfall** is its target stock minus its stock. The household subtracts surplus it already holds, so once it holds enough spare to cover its neighbours' shortfall, more of that good is worth nothing until some of it sells. This is the brake that stops over-production.
- A household sees how short its neighbours are; it never sees what they think the good is worth.
- The would-be buyer test and the need trip trigger answer different questions. A neighbour at 25 days of grain will not walk anywhere to buy, but it would buy if a seller came to its door. Using the trip trigger here would leave homesteaders, who keep their stocks near full, never counting as buyers, and trade would never start.
- What makes trade pay is output. A household on rich soil with thin forest produces far more grain per day than wood, so farming for a neighbour's shortfall is worth more to it than cutting its own wood. That is comparative advantage, and it is why the gap persists after belief ranges have narrowed.
- A small per-household random perturbation (around ±10%) is applied to each value, so that neighbours facing the same signal do not all switch on the same day.

Before any trade, beliefs sit at the bootstrap anchor, so the choice is driven by own needs alone: urgency, weighted by how much each activity produces at this site. As neighbours appear and prices form, surplus value takes over and specialisation begins.

## Migration

Migration is the only source of population change in version 1. It replaces births and deaths with arrivals and departures, and it is the system that fills the map.

### Arrival

- A settler is considered every K ticks (around 5). The interval is a parameter; it sets how fast the world fills.
- The settler evaluates candidate sites as described under Site choice. If no site is viable, no settler arrives this interval. This matters: an exhausted map stops attracting people on its own.
- A viable settler is created at the map edge nearest its chosen site, with the starting purse and grain, and walks to its site. Its home is set on arrival and HouseholdCreated is emitted then, not at the edge. Nothing produces, consumes or trades until the settler is home.

Arrival rate should not yet respond to prosperity. A constant interval is simpler and the viability check already stops arrivals when the land cannot support more. A prosperity-driven rate is a later refinement.

### Site choice

A settler does not choose a profession; it chooses a site, and decides its work each day once there. A site is judged by how much spare working time a household would have there after meeting its needs, and by how many neighbours it would have.

For each need, the settler works out the share of its days that meeting the need would take at that site, the cheaper of making the good itself or earning coins to buy it:

```
makeShare(g)   = dailyNeed(g) / output of the activity that makes g at this site (skill 1.0,
                 ; using shared output for depleting activities, see below)
buyShare(g)    = dailyNeed(g) × price(g) / max over activities a: sharedOutput(a) × price(good of a)
                 ; only if some household in reach holds surplus of g and trades of g and of
                 ; the paying good have been observed within reach; otherwise not available
share(g)       = min(makeShare(g), buyShare(g))
slack          = 1 − Σ over needs: share(g)
score          = slack + neighbour weight × Σ over households in reach: closeness
```

- For an activity that draws on a shared, depleting layer (in version 1, woodcutting), the output used here is divided by the number of households effectively sharing it:

  ```
  sharedOutput(a) = output(a) / (1 + Σ over households in reach: closeness × share of their last 30 days spent on a)
  ```

  The forest layer only shows what has already been cut, not what the neighbours will keep cutting, so without this a settler next to three full-time woodcutters would expect full output and find the forest worn down within weeks. The share is read from each neighbour's Activity component; settlers in transit have no history yet and count as zero. Farming needs no such term, because fields are claimed exclusively.
- price is the average of recent TradeCompleted prices within reach of the site. This is hearsay: the settler has no beliefs of its own yet. Where no trade has been observed, buying is simply not an option; the settler never assumes a supplier will come.
- A site is viable only if slack is at least the minimum slack. A settler never settles somewhere it cannot support itself on arrival, either by its own work or by buying from someone already there.
- Settlers already walking toward a site count as households at that site, both in the neighbour term and as claimants of its farm tiles, so that several settlers do not commit to the same opportunity before the first one arrives.
- The neighbour term is what draws settlers together. Without it, homesteaders, who can live alone, would spread across the map out of each other's reach and never trade. Its weight is tuned: zero gives scattered farmsteads, too high crowds everyone onto poor land. It must at least outweigh what a typical homesteader neighbour costs a site through shared forest, about woodcutting share × neighbour's woodcutting share ≈ 0.28 × 0.28 ≈ 0.08 per unit of closeness, or every site next to someone scores worse than one out of reach. A neighbour who cuts wood full time should still outweigh it, so settlers do not crowd a forest already being cut.

Candidate tiles are sampled, not exhaustively scored: take a few hundred random non-water tiles plus the tiles adjacent to existing households, score them, and pick the best. Exhaustive scoring of a 256 by 256 map per arrival is too slow and gains nothing.

On an empty map, the only viable sites are those with both fertile land and forest within reach, and the first settlers homestead on the forest edge. That is correct and intended.

### Departure

Departure is handled under Households: a need counter over threshold triggers leaving. Migration owns nothing about it except listening for HouseholdRemoved to keep its counts.

### Why no births or deaths

A demographic model needs ages, household splitting, inheritance and labour that changes over a life. None of it affects whether trade works. Migration gives the same inputs to the rest of the simulation, households appearing and disappearing, through the same two events. A later demography system replaces this one by emitting the same events for different reasons.

### What to watch for

The interaction between arrival and departure is the first place oscillation can appear: settlers arrive, overload the local land, many leave at once, settlers arrive again. Counting settlers in transit, the minimum slack, and the leave threshold offset all damp this. If a scenario still oscillates, lengthen the arrival interval before touching anything else.

## Trade

Trade in version 1 is a visit: a household walks to another household's home, the two compare prices for both goods, and trade what overlaps. There is no market object, no auction house, and no global price. Everything a household believes about prices it learned from its own trades.

### Roles

There are no fixed roles and no merchants. For each good, a household is a seller when its stock is above its own target, and a buyer when its urgency for the good is above zero. Which it is follows from what it has chosen to work on. In the farming-only stage, every household makes its own grain and nobody needs anything from anyone, so trade does not occur; that is the correct result, and it is the first test.

### Price beliefs

Each household holds, per good, a belief range \[low, high\] of what the good costs. The belief is the household's whole model of the market. Its midpoint, (low + high) / 2, is the household's best single guess at the price.

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
- surplusPressure is how much of what nearby buyers lack the seller is already holding:

  ```
  surplusPressure(g) = min(1, surplus held of g ÷ Σ over would-be buyers of g in reach: shortfall × closeness)
  ```

  It is 0 when the seller holds nothing above its own target, and 1 once it holds enough to cover its neighbours' shortfall, which is exactly when the daily choice stops valuing more of that good. A seller in that position asks its low, and since every buyer bids at least its own low, a first trade between two households holding the anchor belief clears. With no would-be buyer in reach, surplusPressure is 0.
- A household never sells below what it needs itself: tradable quantity is stock minus its own target, never less than zero.

### Matching

If bid is at least ask, a trade happens at the midpoint. Quantity is the smallest of what the buyer wants (target minus stock), what the seller can spare, and what the buyer can afford at that price. Coins and goods move, and a TradeCompleted event records good, price, quantity and tile. If bid is below ask, no trade happens and both record the failure.

Both goods are considered at every visit, in each direction, the visitor's most urgent good first. A household visiting a neighbour may sell wood and buy grain in the same visit. This halves the walking and matches how a real visit would go.

### Learning

After each attempt, each side adjusts its belief for that good:

- Trade happened at price p: move both low and high a step toward p and shrink the range by a factor. Beliefs converge on the clearing price.
- Buyer failed (bid below ask): shift the whole range up by step × (ask − bid), both low and high. The buyer will offer more next time.
- Seller failed (ask above bid): shift the whole range down by step × (ask − bid), both low and high. The seller will accept less next time.
- Shift the whole range rather than one end. The ask a buyer sees is always below its own high, so "raise high toward the ask" would actually lower it and widen the gap after every failure.
- A range that shrinks below a minimum width is widened back to it, so beliefs never freeze.

Step size and shrink factor are parameters. Large steps make prices jumpy, small steps make them slow to find a level. Start at 0.2 and tune by watching the price chart.

### Deciding to make a trip

Each day, a household at home checks two triggers:

1. Need trigger: urgency for a good exceeds a threshold, it has coins, and a neighbour within reach holds surplus of that good. It picks a destination among those neighbours. If nobody in reach holds surplus, it makes no trip; the daily choice will have it make the good itself.
2. Surplus trigger: surplusPressure for a good exceeds a threshold and a would-be buyer is within reach. It picks a destination among the would-be buyers.

A destination is the nearest such neighbour not on cooldown, except that the partner of the last successful trade is preferred if it is no more than half again as far. A household knows neighbours' stocks and urgency but not their prices, so distance and past success are all it has to choose between partners. The household walks there, trades, and walks home. One trip at a time; nothing is produced while away. That lost production is the real cost of distance, and it is what makes households prefer close partners.

A failed trip raises the household's willingness for next time through the learning rules above, so repeated failures are self-correcting: the buyer bids more, the seller asks less, and the trade eventually clears, or the buyer makes the good itself.

### Coins

Coins are a closed system. They enter with arriving settlers' purses and leave with departing households. No coins are minted or destroyed by trade. Total coins in the world must always equal purses in minus purses out; a test asserts this every tick.

A household with no coins and no surplus cannot buy, and must make what it needs itself. That is intended. Credit comes later, if ever.

### What correct looks like

- No household is a net seller of both goods over any 100-tick window. A household may sell one good and make all of the other itself. Grain flows toward households that mostly cut wood and wood toward those that mostly farm.
- The belief range of each household that has traded a good at least five times narrows over time, and the midpoints of neighbouring households that trade converge toward each other.
- Price of wood rises when wood is scarce and falls as more households take up woodcutting. Grain the reverse.
- No household trades below its own target stock, and no coin is created.
- After a change in fertility, prices and the share of time spent on each activity move in the right direction and settle again.

## Tick order and determinism

Systems run in a fixed order every tick. The order is a decision, not an accident; changing it changes behaviour.

1. Migration: consider a new settler; create it at the edge if a viable site exists.
2. Movement: advance every travelling household along its path. Emit ArrivedAt for any that reached a target.
3. Settling: settlers that arrived at a chosen site set home; emit HouseholdCreated.
4. Production: each household at home chooses today's activity or rest, claims fields if it chose farming and holds none, and produces; emit ActivityChosen. Skills are updated, fields of households at home that have gone unworked for the claim lapse period are released, depleting layers are reduced, and forest regrows.
5. Needs: households with a home consume daily rates; update unmet counters; emit NeedUnmet; mark households that must leave.
6. Trade: resolve visits for households that arrived at a trading partner this tick; then evaluate trip triggers for households at home and set travel targets.
7. Departure: households marked to leave release tiles, emit HouseholdRemoved, and set the edge as their target.
8. Events for this tick are handed to listeners and the debug log, then cleared.

Production before Needs means a household eats from today's output. The daily choice reads yesterday's closing stocks, so it decides on what the household had when it woke. Trade after Needs means today's urgency drives today's trips. Departure last means a leaving household still trades on its last day, which is harmless and avoids a special case.

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
- Household: a filled square, 3 by 3 pixels at base zoom, coloured by its main activity. A household doing something other than its main activity today shows a 1-pixel mark in the colour of today's activity.
- Travelling household: the same square, with a 1-pixel dot above it coloured by the good it carries, if any. Empty-handed trips show no dot. This single mark makes flows readable at a glance.
- Claimed tiles: a faint outline in the owner's colour, fading as the claim nears its lapse.
- Home: a slightly larger square, so a household away from home leaves a visible gap.

Positions are interpolated between the last two ticks so motion is smooth at any simulation rate. Pan with drag, zoom with wheel.

### Overlays

Any grid layer can be shown as the tile colour: fertility, forest, tile owner, tile last worked, and later footfall. One key cycles overlays. This costs almost nothing and is the fastest way to see whether woodcutting is depleting forest or settlers are picking sensible land.

### Inspector

Clicking a household opens a panel with every component value: main activity, today's activity, skill per activity, today's value for each activity and the terms that made it up, stocks, coins, days of stock remaining, urgency per good, belief range and midpoint per good, would-be buyers in reach and their shortfall, current travel target and purpose, and its last ten trade events with price and partner. Nearly every trade bug is found by watching one household's beliefs, choices and trips, so this panel is the most important tool in the build.

### Controls and charts

- Pause, step one tick, and speed presets (1, 10, 100 ticks per second).
- Live charts over time: population by main activity, net grain and wood flow between main-activity groups, share of household-days spent on each activity, mean belief midpoint per good, trades per day per good, total coins, number of households with an unmet need.
- A scenario picker to switch between the farming-only and full scenarios, and a seed field.

### Headless mode

The same simulation runs in Node without the renderer. A command runs a scenario for N ticks with a seed and writes the chart series and final state to JSON. Tests and automated checks use this; the renderer is never required to answer a question about behaviour.

## Build stages

Five stages, each with a visible result and an automated check. Do not start a stage before the previous one's checks pass; every later bug is easier to find when the earlier layer is known good.

1. **World and renderer.** Map generation from a seed, overlays, pan and zoom, pause and step, headless runner that writes JSON. Done when the same seed gives the same map twice and the headless run of an empty world completes.
2. **Farmers settle and produce.** Migration with farming as the only activity and food as the only need, site choice, field claiming, production, movement with A\*. Scenario: farming-only. Done when farms visibly cluster on fertile land, new farms sit beside old ones until land runs out, settlers stop arriving when no viable site remains, and a settler never walks through water.
3. **Needs and leaving.** Consumption, unmet counters, departure, field lapse. Scenario: farming-only, with the warmth need off. Done when a map with fertility set to zero receives no settlers, a normal map keeps its farmers, who never leave, and halving fertility mid-run (a scheduled intervention) splits the households present at the shock exactly at the survival line: every one whose fields fall below it leaves within 1,000 ticks of the shock, and every one above it stays. The line is computed from the parameters, not hard-coded, so it stays right when they are tuned:

   ```
   survival line: sum of original fertility over the household's fields
                  = food need ÷ (grain per tile per fertility × shock factor)
   ```

   With the starting values that is 1 ÷ (0.6 × 0.5) ≈ 3.3, a mean of about 0.56 over six fields. A household below the line first eats down its stock, so it leaves after about stock ÷ (need − output) + leave threshold days: a farm 10% below the line with 30 days of grain takes about 325 days, one 5% below about 625. Households within 5% of the line are excluded from the check. Coins and goods conservation tests pass.
4. **Wood, homesteading and trade.** Woodcutting activity, warmth need, forest depletion and regrowth, the daily choice, price beliefs, visits, learning, trip triggers. Skill growth and decay are off in this stage: every skill stays at 1.0, so any trade comes from differences in land alone. Scenario: full. Done when a lone settler on a normal site homesteads and survives 1,000 ticks with no neighbours, every item under Trade, What correct looks like, holds in a 2,000-tick headless run, and the inspector shows a household's grain belief narrowing over its first ten trades.
5. **Skill and specialisation.** Skill growth and decay on. Done when households' time splits into clear specialists, the share of time on each activity settles, no household changes main activity more often than the friction check allows, and halving fertility mid-run raises grain prices and shifts household-days toward farming.

### Automated checks that run every stage

- Determinism: two runs, same seed, identical state hash.
- Conservation: total coins equal purses in minus purses out; no stock goes negative.
- No household trades below its own target stock.
- No trade is recorded with bid below ask.
- No settler is created at a site with slack below the minimum.

### Checks that prove trade works

- Convergence: the mean belief range width per good falls over the run and ends below a threshold.
- Agreement: the standard deviation of belief midpoints across households within reach of each other falls over the run. Only households that have traded the good at least once count, measured from the first trade in that neighbourhood; before any trade every belief is a copy of the anchor and the spread is zero.
- Direction: over every 100-tick window, no household is a net seller of both goods. Net flow between main-activity groups is charted but not tested, because in stage 4 a homesteader's main activity can rest on a few days either way.
- Response: compared to a baseline run, a run with half the forest has a higher wood price and a larger share of household-days spent woodcutting.
- Survival: in the full scenario on a normal map, fewer than 10% of households leave over 2,000 ticks after the first 300.
- Specialisation (stage 5): the share of households spending more than 80% of their days on one activity rises over the run.
- Friction (stage 5): no household changes main activity more than a set number of times per 1,000 ticks.

The thresholds in these checks are set from the first working run, then held. They are regression guards, not targets.

## Implementation pitfalls

These are the problems most likely to appear, with what to do about each.

| Pitfall | What it looks like | What to do |
| --- | --- | --- |
| Viability keyed to trade history | Nobody becomes a woodcutter because no grain has been traded, and no grain is traded because nobody is a woodcutter; or the first farmers freeze waiting for wood | Never require a past trade before something can start. Every household can make every good it needs; trade is an improvement on self-supply, not a precondition for survival. A site is viable if a household can support itself there now, by its own work or by buying from someone already in reach. |
| Beliefs never overlap | Buyers bid 1 coin, sellers ask 3, nobody trades, everyone makes everything themselves | Learning on failure must move both sides. Check that a failed visit shifts the buyer's whole range up and the seller's whole range down, so the gap between bid and ask narrows on every failure. Check that the minimum range width is not zero. |
| Price collapse | Belief midpoints for grain fall to near zero as farmers compete | Verify that sellable surplus is capped by would-be buyers' shortfall, so households stop producing what nobody in reach will buy. Verify sellers never sell below their own target stock. |
| Surplus pile-up | A household's stock of one good grows without limit | The surplus already held must be subtracted in the sellable term, and shortfall must be weighted by closeness. If stock still grows, check that a household with nothing worth doing rests rather than repeating yesterday's activity. |
| Scattered homesteads | Households spread across the map out of each other's reach and never trade | Raise the neighbour weight in site choice. Check that settlers in transit are counted. Check the generator gives contiguous fertile valleys. |
| Crowding the forest | Settlers pile in around the same forest, which is soon cut down, and the newest arrivals find far less wood than their site score promised | Check that site choice uses shared output for woodcutting, counting neighbours' recent woodcutting days by closeness. If crowding persists, the forest regrowth rate is too low for the wood per day, not the score. |
| Activity thrash | Households switch activity every few days, or neighbours all switch together | Check the tie rule keeps yesterday's activity, the per-household perturbation is applied, and fields lapse slowly enough to survive an occasional day of woodcutting. In stage 5, a low skill growth rate gives too little friction. |
| Lock-in | Households never change activity even when one good is badly short | Skill cap too high relative to the price swing a shortage can produce. Lower the cap or raise decay. |
| Hard reach edge | Choices flip when a neighbour moves one tile | Every count of neighbours must use the closeness weight, not a yes/no inside reach. |
| Rich on paper | Households show healthy trade on starting purses alone, then the economy dies when purses run out | Keep the starting purse small, a few days of food. Track total coins and trades per coin; if trades keep running after purses would be spent, the economy works. |
| Trip spam | A household walks to a partner, fails, walks home, walks back the next day | Require the trigger to be re-met and add a cooldown of a few days after a failed visit. The learning step already moves prices; the cooldown just saves the walk. |
| Target chosen, partner gone | Household walks to a home that moved or left | Destinations are entity ids; on arrival, if the entity has no Home, abandon the visit and go home. Never store positions as destinations. |
| Deadlock at the same spot | Two households visit each other at the same time, both away, nobody home | Trade only resolves if the host is at home. A visit to an empty house fails without a belief update and goes home. This is realistic and self-correcting. |
| Everyone leaves at once | Need counters all cross the threshold in the same tick | Give the leave threshold a small per-household random offset at creation. |
| Settling on a crowded tile | Several households claim the same tiles | Claim in id order and check the owner layer before each claim; count settlers in transit as claimants in site choice. |
| Starving on the walk in | Settlers bound for the middle of a large map leave before they arrive | Needs apply only to households with a home. |
| Path cost | A\* on a 256 by 256 grid per trip is fine for hundreds of households, not thousands | Keep findPath behind one interface and cache paths per tick. Replace it later; do not optimise it now. |
| Hidden globals | A system reads a module-level price or population number | Forbid it. If a system needs a number another system produces, that number is a layer, a component, or an event. |
| Tuning by code change | Constants spread through files | Every number in the parameter table lives in one config object, loaded by scenario, and visible in the debug panel. |
| Float drift | Stock slowly goes to minus one millionth and a test fails | Clamp stocks at zero after consumption and treat anything below a small epsilon as zero in checks. |

One more to watch: liquidity. Coins enter only with purses, so the whole economy runs on a few coins per household. Prices will fall until that money is enough to carry daily trade, which is correct, but if beliefs hit the minimum width at tiny values the learning step becomes coarse. If that happens, raise the starting purse slightly rather than loosening the belief rules; the purse is the one number that only sets the price level.

### Where the implementer should expect to spend time

The learning rules, the urgency curve and the balance between skill and price will take most of the tuning. Everything else is plumbing. Build the inspector before building trade, so the tuning happens with the right tool in hand.

## Parameters

Starting values, all in one config object. They will be tuned from the first runs.

| Parameter | Value | Notes |
| --- | --- | --- |
| Map size | 128 (dev), 256 (run) | Tiles per side |
| Arable threshold | 0.3 | Fertility below this cannot be claimed |
| Reach | 12 | Path length, tiles; walk speed × maximum trip days |
| Farm radius | 4 | Fields are claimed within this of home |
| Walk speed | 6 | Tiles per tick |
| Maximum trip | 2 days | One way; sets reach |
| Tick | 1 day | No seasons |
| Farm tiles | 6 | Claimed per farming household |
| Claim lapse | 10 days at home | Fields not worked for this many days at home are released; days away on trips do not count |
| Grain per tile per day | 0.6 × fertility × skill | A farm on fertility 0.7 yields about 2.5 per day unskilled |
| Wood per day | 3.0 × mean forest in reach × skill | Depletes the layer by the amount cut |
| Forest regrowth | 0.004 per tile per tick | Fixed amount, capped at the tile's generated value |
| Food need | 1.0 grain per day | Leave threshold 20 unmet days |
| Warmth need | 0.5 wood per day | Leave threshold 20 unmet days |
| Need priority | equal | Unused in version 1 |
| Comfort stock | 10 days | Urgency rises steeply below this |
| Full stock | 30 days | Target; above it is surplus |
| Leave threshold offset | ± random 5 per household | Applied to every need's threshold |
| Skill | starts 1.0, cap 2.0 | 1.0 is an unskilled generalist |
| Skill growth | 0.01 per day practised | Toward the cap; 0 in stage 4 |
| Skill decay | 0.002 per day not practised | Toward 1.0; 0 in stage 4 |
| Activity noise | ±10% | Per household, on each activity's value |
| Minimum slack | 0.1 | Share of days left spare that a site must offer |
| Neighbour weight | 0.1 | Per household in reach, times closeness; must exceed about 0.08 (see Site choice) |
| Starting purse | 5 coins |  |
| Starting grain | 5 | Days of food |
| Starting wood | 5 | 10 days of warmth; covers the first days, when a settler on rich soil farms first |
| Bootstrap anchor | 1 coin per unit | Belief \[0.5, 2.0\] when no trade observed |
| Belief step | 0.2 | Fraction moved toward price on success |
| Belief shrink | 0.9 | Range multiplier on success |
| Belief min width | 10% of midpoint |  |
| Need trip trigger | urgency > 0.3 | A would-be buyer is any neighbour with urgency > 0 |
| Surplus trip trigger | surplusPressure > 0.5 |  |
| Failed visit cooldown | 3 ticks |  |
| Preferred partner margin | 1.5 × distance | Last successful partner kept if within this |
| Arrival interval | 5 ticks |  |

The first tuning target: an unskilled homesteader on a site with fertility 0.7 and forest 0.6 spends about 40% of its days farming and 28% cutting wood, leaving about a third of its time spare. That spare time is what can become surplus for trade. A household specialised in farming has about 1.5 grain a day to sell, enough to feed about one and a half woodcutters; one specialised in woodcutting has about 1.3 wood to sell on fresh forest, enough to warm about two and a half farmers. Forest within reach of a full-time woodcutter settles where cutting equals regrowth, about 1.6 wood a day with the regrowth above, leaving about 1.1 to sell, enough for about two farmers. With the old regrowth of 0.002 it settled near 0.8 a day, too little to warm even one. If households stay homesteaders and never trade, the gap between sites is too small or the neighbour weight too low; if woodcutting households leave, raise wood per day or lower the warmth need. Change one number per run.
