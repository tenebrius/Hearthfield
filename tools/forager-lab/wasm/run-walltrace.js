// Where do dots meet the walls? Trains like run-walls.js (open map, then gaps 9, 7, 5, 3 with the chosen wall layout, then more), then replays one round of the
// trained population without breeding and logs every tick on which a dot's move was blocked or slowed by a wall (blocked fraction > 0.02, from the engine's ABLK).
// Usage: node run-walltrace.js '<cfg overrides as JSON>' <seed> [openGens=1000] [stageGens=300] [finalGens=500]   (cfg takes "wallType" 1 to 3 as run-walls.js)
// Positions are folded into the corner-A frame (x + y > 63 is mirrored) so both corners count together. Regions of the L at 20: "vertOuter" x 20 to 23, y < 20
// (outside the vertical arm), "horizOuter" y 20 to 23, x < 20 (outside the horizontal arm), "corner" x and y both 20 to 23, "inside" x and y both < 20 (corridor), "other".
const { Engine } = require('./engine');
const DEFAULTS = { layout: 'handfar', lossE: 1.5, lossW: 0.6, layers: 2, startE: 100, startW: 100, feedback: false, genSpawn: 1 };
const mods = JSON.parse(process.argv[2] || '{}'), seed = +process.argv[3], openGens = +process.argv[4] || 1000, stageGens = +process.argv[5] || 300, finalGens = process.argv[6] === undefined ? 500 : +process.argv[6];
const wt = mods.wallType || 1;
const e = new Engine(Object.assign({}, DEFAULTS, mods, { walls: 0 }), seed);
e.genInit(seed);
for (let g = 0; g < openGens; g++) e.genRound();
for (const gap of [9, 7, 5, 3]) { e.setMap('handfar', 0, undefined, undefined, undefined, undefined, wt, gap); for (let g = 0; g < stageGens; g++) e.genRound(); }
for (let g = 0; g < finalGens; g++) e.genRound();
const GP = e.cfg.genP, L = e.cfg.genLen, v = e.views();
const reg = (x, y) => { if (x + y > 63) { x = 63 - x; y = 63 - y; } if (x < 20 && y < 20) return 'inside'; if (x >= 20 && x < 24 && y < 20) return 'vertOuter'; if (y >= 20 && y < 24 && x < 20) return 'horizOuter'; if (x >= 20 && x < 24 && y >= 20 && y < 24) return 'corner'; return 'other'; };
const K = new Uint8Array(e.mem, e.x.kind_ptr(), 64 * 64);
const nearWall = (x, y) => { const tx = Math.floor(x), ty = Math.floor(y); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = tx + dx, yy = ty + dy; if (xx >= 0 && yy >= 0 && xx < 64 && yy < 64 && K[yy * 64 + xx] === 4) return true; } return false; };   // map edges also block, so only count contacts next to a wall tile
const contactTicks = {}, firstReg = new Array(GP).fill(null), contacts = new Int32Array(GP), prevIn = new Uint8Array(GP), crossed = new Uint8Array(GP);
e.genBegin();
for (let t = 0; t < L; t++) {
  const n = e.genTick(t);
  for (let i = 0; i < n; i++) {
    const s = v.ord[i], x = v.ax[s], y = v.ay[s], r = reg(x, y);
    if (v.ablk[s] > 0.02 && nearWall(x, y)) { contacts[s]++; contactTicks[r] = (contactTicks[r] || 0) + 1; if (!firstReg[s]) firstReg[s] = r; }
    const inside = r === 'inside' ? 1 : 0; if (inside && !prevIn[s]) crossed[s] = 1; prevIn[s] = inside;
  }
  if (n === 0) break;
}
const stats = e.genEnd(false);
const out = { seed, wallType: wt, survived: stats.mean, full: stats.fullShare, drank: stats.drankShare, contactTicksByRegion: contactTicks, byFirstContact: {}, neverTouched: { dots: 0, drank: 0 } };
for (let s = 0; s < GP; s++) {
  const dr = v.gwater[s] > 0 ? 1 : 0;
  if (!firstReg[s]) { out.neverTouched.dots++; out.neverTouched.drank += dr; continue; }
  const b = out.byFirstContact[firstReg[s]] = out.byFirstContact[firstReg[s]] || { dots: 0, drank: 0, enteredCorridor: 0, meanContactTicks: 0 };
  b.dots++; b.drank += dr; b.enteredCorridor += crossed[s]; b.meanContactTicks += contacts[s];
}
for (const k in out.byFirstContact) out.byFirstContact[k].meanContactTicks = +(out.byFirstContact[k].meanContactTicks / out.byFirstContact[k].dots).toFixed(1);
console.log('WTRACE ' + JSON.stringify(out));
