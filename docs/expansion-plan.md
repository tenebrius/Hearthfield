# Settlement Sim — Expansion Plan

Oct 9, 2026 · @Divish Shamloll

## Principles

Expansion is one system at a time, each justified by a behaviour the current build cannot show, each gated by the previous one's checks still passing. The plan below is an order, not a schedule; any phase can be delayed, but none should be skipped past.

1. **One system per step.** A step adds one system, or one data entry, never both a new mechanic and a new good at once. When a behaviour goes wrong, the cause must be the last thing added.
2. **Add only what the watcher would miss.** Each phase names the thing you would see on screen that is missing today. If nobody would notice its absence, it waits.
3. **Every addition is a layer, a data entry, a system or an event.** If a proposed feature does not fit one of those four shapes, the architecture is wrong or the feature is, and the question is settled before any code.
4. **Keep version 1 running as a scenario.** The two-good, two-profession world stays as a preset and its checks keep running. If a later system breaks it, the later system is wrong.
5. **Replace by emitting the same events.** Demography replaces migration by emitting HouseholdCreated and HouseholdRemoved. A recipe system replaces fixed production by writing to the same Stocks. Nothing downstream changes.
6. **No feature for its own realism.** Fallow rotation, inheritance, guilds and lords are all real and all deferred. Realism is added when its absence produces a visibly wrong picture, not before.
7. **Tune, then freeze.** After each phase, the regression thresholds are reset from the new working run and held until the next phase. Tuning drift is as dangerous as code drift.

## Expansion order

Markets come first because they are the one thing version 1 visibly lacks, and they need nothing new except a layer. Terrain comes last because it changes scores everywhere and is easiest to judge once everything else behaves.

&#91;embedded content: expansion roadmap · 6 phases, 6 gates\]

Each gate is a check on the previous phase that must hold before the next begins; the version 1 regression suite runs at every gate. Phases 2 and 3 can swap if crafts feel more urgent than seasons; nothing else should be reordered, because roads need footfall, merchants need clusters, and demography needs labour-sized farms to make sense.

## Phase 1: markets emerge

The missing picture: households trading door to door forever. A village needs a place where sellers gather, and that place must come from where people walk, not from a rule that says where a market is.

### What is added

- **Footfall layer.** Every tile a travelling household crosses gains a small increment; the whole layer decays by a factor each tick. Written by Movement, read by anyone. This one layer later becomes roads.
- **Stall component.** A seller has a stall tile, initially its home. Selling happens at the stall; the seller walks there with its surplus and waits for buyers, then walks home. Buyers target stalls, not homes.
- **Stall placement system.** Every so often, a seller looks within a radius of its home for the tile with the highest footfall. If it beats the current stall by a clear margin, the stall moves there. The margin is the inertia that stops stalls drifting every day.
- **Market days.** A seller attends its stall on a fixed cycle (every third day, say) rather than every day, so that its production and its selling do not conflict and so that buyers can expect it to be there. This is the first thing that makes a market feel like one on screen.

### What is not added

- No competition logic between sellers of the same good. Hotelling clustering appears on its own from footfall; splitting into specialised rows is a later refinement if it ever matters.
- No buyer knowledge of stalls beyond reach. A buyer still knows only what is within reach of home.
- No market entity. A cluster is detected only for display, by grouping stalls within a few tiles of each other, and labelled on the map. The grouping never feeds back into the simulation.

### Expected difficulties

- All stalls collapse to one tile. If the footfall radius is too large relative to reach, every seller sees the same peak. Keep the search radius smaller than reach, and let buyer distance cost do the rest.
- Stalls chase their own footfall. A seller walking to its stall adds footfall along its own route, which can hold the stall in place forever. Exclude a household's own path from the footfall it reads, or weight buyer traffic higher than seller traffic.
- Trade visits to empty stalls. Market days must be known to buyers within reach, or buyers waste trips. Keep the cycle global in this phase.

### Gate to pass

Two or more stall clusters form on a normal map and persist for 1,000 ticks; the version 1 scenario, with stall placement off, still passes its checks; mean trip length per trade falls compared to version 1.

## Phase 2: time

The missing picture: a world with no rhythm. Nothing changes over a year, so prices are flat and nobody plans.

### Step 2a, seasons

A Seasons system computes a season from the tick counter and writes two multipliers to a small shared state: production rate and warmth need. Winter raises the warmth need and lowers farm output; summer the reverse. Production and Needs read the multipliers and nothing else changes. This step is tiny and gives the first visible cycle: wood prices rising in autumn, farmers walking to buy wood before winter.

### Step 2b, annual harvest and storage

Farms stop producing daily and instead yield once a year, at harvest. This is the step that forces planning behaviour, and it is the largest single change in the plan:

- Households need a target stock that covers the whole year, not 30 days, so the urgency curve must be redefined in terms of days until the next harvest. This is a change to the one urgency function, nowhere else.
- Sellers must ration surplus across the year rather than dumping it after harvest. A simple rule works: tradable surplus is stock minus what the household needs until next harvest, and surplusPressure uses the same horizon.
- Prices will swing hard: a glut after harvest, scarcity before it. This is correct. The learning rules must tolerate it; the minimum belief width probably needs to widen.
- Storage loss, a small fraction of stock per tick, gives a reason not to hoard. Add it only if hoarding appears.

### Expected difficulties

- The first annual harvest will reveal every household that was living hand to mouth in version 1. Expect a wave of departures in the first winter; this is a tuning problem, not a bug, and the lever is the starting grain for new arrivals, which must now cover until the first harvest.
- Woodcutters, who still produce daily, become the stable earners; farmers become the ones with seasonal cash. That reversal is historically right and will change the direction of coin flow across the year.

### Gate to pass

Prices for both goods show a yearly cycle; fewer than 10% of households leave in a year after the first; the version 1 scenario with seasons off is unchanged.

## Phase 3: crafts

The missing picture: everyone works a resource and nobody works for other people. A village without a craftsman is a hamlet.

### What is added

- **Recipes.** Production generalises from reading a resource layer to running a recipe: inputs from Stocks, outputs to Stocks, at a rate. Farmer and woodcutter become recipes with no inputs and a layer-dependent rate. This is a refactor of one system; its behaviour for the two existing professions must not change, and the version 1 checks prove it.
- **Tools, a third good.** Consumed slowly by farmers and woodcutters as a need, or as a production multiplier. A need is simpler and reuses the urgency machinery; choose that.
- **Blacksmith.** Recipe: wood in, tools out. No resource layer, so its site score is trade access alone, and it settles among its customers. This is the first profession whose arrival depends entirely on observed demand, and it proves the profession-choice logic generalises.
- **Trade over N goods.** Bid and ask already work per good; visits iterate over all goods in priority order. Priority becomes a field on the good's data entry.

### What is not added

- No second craft. One is enough to prove recipes and demand-driven arrival. A second adds nothing to the test and doubles the tuning.
- No input shortages beyond the natural one. If wood is scarce, the blacksmith buys less and makes less. No special handling.

### Expected difficulties

- Three goods means three price beliefs per household and nine possible trades per visit. The inspector must grow to show them all or tuning becomes blind.
- A blacksmith's income depends on two prices, wood and tools. Expected income must subtract input costs: income is output times tool price minus input times wood price minus food. This is the first time the formula has a middle term; it should be written generally for any recipe now.
- Demand for a slow-consumed good is thin, so a blacksmith may serve twenty households and still barely survive. Tune tool need rate so one blacksmith per ten to fifteen households is viable.

### Gate to pass

A blacksmith arrives only after wood is traded locally, settles within a stall cluster, and survives 1,000 ticks on tool sales; farmers and woodcutters behave as before with tools off.

## Phase 4: roads and merchants

The missing picture: clusters that never talk to each other, and paths that never wear in. This phase connects the map.

### Step 4a, roads

- Footfall above a threshold lowers a tile's movement cost; sustained footfall lowers it further, to a floor. Below the threshold, cost drifts back up. One rule, one layer, read by findPath.
- Pathfinding must now weigh cost, not just distance. This is the point where A\* per trip may become too slow if population has grown; a flow field per popular destination, or path caching with invalidation when the cost layer changes, is the fix. Keep the findPath interface.
- Roads are drawn as a lighter tile colour by cost. This is the first time the map itself visibly records history.

### Step 4b, merchants

- A merchant is a profession with no production. It buys where its belief says a good is cheap and sells where it says the good is dear, carrying stock between stalls.
- The one new mechanic: a merchant's reach is larger than a household's, and it holds beliefs per cluster rather than one belief per good. That is what lets it see a price difference nobody else can see.
- Expected income for a merchant is the price gap between the two best clusters minus travel cost, and it becomes viable only once clusters exist and their prices differ. Nothing special is needed to make merchants appear at the right time.
- Merchants must not be allowed to be the only link: households still trade locally as before.

### Expected difficulties

- Roads reinforce themselves. A road that exists attracts trips, which maintain it. Good, up to a point; if every trip funnels into one road, raise the cost floor so roads shorten trips but never make them free.
- Merchants can oscillate: all merchants spot the same gap, all carry grain the same way, the gap reverses. Per-merchant noise in belief and a small capacity per trip damp it. If it persists, that is the signal for the market-day cycle to vary by cluster.
- Merchants with large purses distort prices in small clusters. Cap carried quantity per trip relative to cluster size.

### Gate to pass

Roads visible between clusters within 2,000 ticks; at least one merchant viable and profitable over 500 ticks; belief midpoints across clusters closer than before merchants, measured on the same seed.

## Phase 5: land and people

The missing picture: every farm the same size, population that only changes by walking on and off the map, and no one ever changing trade. This phase makes households vary and the population self-sustaining.

### Step 5a, labour-sized farms

Replace the fixed tile count with the rule described in version 1's Professions section as deferred: a farmer keeps claiming the best free tile near home while the extra harvest is worth the extra labour, bounded by a labour budget. Only the claim function changes. Farm size then varies with soil, crowding and grain price, and marginal land is worked when prices are high and dropped when they fall.

### Step 5b, prosperity-driven migration

The arrival interval becomes a function of observed prosperity: recent trade volume, low unmet-need counts, and free viable sites. The interval is still capped at both ends so population cannot explode or vanish in a season. This is a change inside the migration system only.

### Step 5c, career change

A household at home re-evaluates expected income for other professions once a year. If another profession beats its own by a clear margin, it switches, paying a cost in lost production during a transition period. The margin and cost are the inertia. The evaluation is the same function new settlers use, so no new logic exists; only a trigger.

### Step 5d, demography

Households gain an age and a size. Births raise size, deaths lower it, and a household that grows past a threshold splits into a new household that settles as a new arrival would. Size scales both consumption and labour, which is the reason to do 5a first. The migration system is then turned down to a trickle and eventually off: the demography system emits the same HouseholdCreated and HouseholdRemoved events, and nothing downstream knows the difference.

### Expected difficulties

- Labour-sized farms interact with annual harvest from phase 2: labour at harvest is the real bottleneck. Model harvest labour as a cap on tiles, not a daily budget, or farms grow unbounded in summer and fail in autumn.
- Career change can cascade: one switch changes local prices, which triggers the next. The yearly cadence plus a margin of at least 20% usually holds it; if not, stagger the evaluation day per household.
- Demography is slow. Population responds to conditions on a scale of decades, so bad tuning takes thousands of ticks to show. Keep migration available as a scenario so fast tests still exist.

### Gate to pass

Farm sizes vary and correlate with fertility; the population holds a stable level for 10,000 ticks with migration off; a fertility shock produces a slow, visible decline rather than a crash.

## Phase 6: terrain

The missing picture: a flat world. Villages sit on fertile land but ignore rivers, hills and marsh, and roads run straight because nothing bends them.

### What is added

- **Elevation layer.** Movement cost rises with slope; site scores penalise steep tiles. Farms avoid hillsides, roads find passes.
- **Rivers.** Generated by flowing water downhill on the elevation layer. River tiles are impassable except at fords, which are cheap crossings where the river is shallow. Later, a river can be a cheap transport lane for merchants; not now.
- **Marsh.** A layer that lowers fertility and raises movement cost. It is the simplest way to create regions that stay empty, which is what makes settled regions read as chosen.
- **Resource deposits.** Point resources, such as ore or stone, as a layer with a few high-value tiles. They give a reason for a profession to settle away from fields and for roads to reach somewhere other than a market.

Every one of these is a layer read by site scoring and findPath. No system is added; existing systems read more inputs.

### Expected difficulties

- Terrain changes every score at once, so all phase thresholds will shift. Re-baseline the regression suite once, deliberately, after terrain is in.
- Path cost becomes genuinely varied, which is where flow fields or hierarchical pathfinding earn their keep. Do the performance work here, not earlier.
- Generation needs care: rivers must reach water, fertile land should lie in valleys near rivers, forest on slopes. Spend the time on the generator; a bad map makes every later judgement wrong.

### Gate to pass

Settlements visibly follow river valleys; roads bend around hills and cross at fords; the medieval-looking map the whole project was meant to produce is on screen, with coloured pixels.

## Deliberately not planned

These come up in every discussion and are refused for now, because each adds a system whose absence the watcher would not notice until the six phases above are done.

| Feature | Why it waits |
| --- | --- |
| Individuals inside households | Multiplies agent count by five for no visible gain; households already walk, trade and leave. |
| Lords, taxes, land tenure | A rules layer on top of a working economy. Add only once the economy is boring without it. |
| Guilds, prices set by decree | Same; social rules over an economy that must first work on its own. |
| Credit and debt | Lets failing households survive longer, which hides balance problems during tuning. |
| Buildings as entities, construction stages | Visual payoff only; a household's home is a tile until something needs buildings to be objects. |
| Combat, raids, disease | Shocks are useful, but a fertility or weather shock gives the same test with one parameter. |
| Sprites and animation | Pixels are enough to see every behaviour above. Art comes when behaviour is finished. |
| Multiple settlements as named towns | A town is a large cluster. Naming it is display work. |

### Ambition traps

- Adding two things at once because they seem related. Seasons and annual harvest are two steps for a reason.
- Fixing a tuning problem with a new mechanic. If woodcutters starve, change a rate; do not invent food storage.
- Modelling what the watcher cannot see. If a mechanism changes no pixel and no chart, it is not worth its bug surface yet.
- Making the sandbox and the real build diverge. The two-good scenario is the regression test for everything; it must keep running through phase 6.

## Keeping systems independent as the count grows

By phase 6 there are roughly fifteen systems and a dozen layers. The rules below are what keep a developer able to add the sixteenth without reading the other fifteen.

### Manifests are the documentation

Every system declares, in code, the components, layers and events it reads, writes, emits and listens for. A script generates a dependency table from the manifests and fails the build if a system touches anything it did not declare. The table, not the source, is what a new developer reads first. If the table cannot explain how two systems interact, they are coupled through something undeclared, and that is a bug.

### One folder per system

A system is a folder: its manifest, its code, its own parameters, its scenario presets, and its checks. Nothing outside the folder imports from inside it except the registry. Deleting the folder must leave a build that runs, with the system's behaviour absent.

### Scenarios per phase

Each phase adds a scenario that enables exactly the systems it needs, and keeps every earlier scenario. The full regression suite runs every scenario at every gate. A system that breaks an earlier scenario is wrong, however good it looks in its own.

### Data over code

Goods, professions, recipes and needs are data files validated at load. The question to ask of any new feature is whether it can be a data entry. Most can, and those cost nothing to add later.

### The debug tools grow with the systems

Every new layer gets an overlay, every new component appears in the inspector, every new event appears in the log, as a condition of merging the system. A system that cannot be watched cannot be tuned, and the tuning is most of the work.

### What this plan is for

The end state is not a finished game. It is a simulation where a new idea, from a tanner to a tax, is one folder and one data entry, whose effect can be watched on a map of coloured pixels within an afternoon. Every phase above protects that property; any proposal that would trade it away is refused, however appealing the picture.
