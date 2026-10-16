// Replay a trained population on held-out cup maps without breeding and account for what the dots do at the rings, split by where the opening of the ring is relative to the food:
// "faces" (the opening is on the side facing the nearer food circle), "opposite" (the far side), "sideways" (one of the two other sides). A dot belongs to the ring it reached first
// (within 3 tiles outside the ring); "inside" is inside the ring wall. Used by run-multi.js (traceCups) and run-load.js.
// replayCups(e, mapFor, R): mapFor(r) must set the map for held-out map r (a cup map with random openings); returns the accounting object.
const { W } = require('./engine');
const FOODC = [[48, 16], [16, 48]];
function replayCups(e, mapFor, R) {
  const GP = e.cfg.genP, L = e.cfg.genLen, v = e.views(), kindArr = new Uint8Array(e.mem, e.x.kind_ptr(), W * W);
  const mk = () => ({ dots: 0, entered: 0, left: 0, drank: 0, drinkSurvived: 0, drinkDiedInside: 0, drinkDiedOutside: 0, diedInsideHunger: 0, diedInsideThirst: 0, insideTicks: 0 });
  const cls = { faces: mk(), opposite: mk(), sideways: mk() }, tot = { dots: 0, reached: 0, arrOpen: 0, arrClosed: 0, survived: 0, drank: 0, drankAll: 0 };
  for (let r = 0; r < R; r++) {
    mapFor(r);
    const kinds = new Uint8Array(kindArr), ponds = [], seen = new Uint8Array(W * W);
    for (let i = 0; i < W * W; i++) if (kinds[i] === 3 && !seen[i]) { const x0 = i % W, y0 = (i / W) | 0; for (let yy = y0; yy < y0 + 7; yy++) for (let xx = x0; xx < x0 + 7; xx++) seen[yy * W + xx] = 1; ponds.push([x0, y0]); }
    const kk = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= W) ? 4 : kinds[yy * W + xx];
    const info = ponds.map(p => {
      const open = [[p[0] - 3, p[1] + 3], [p[0] + 9, p[1] + 3], [p[0] + 3, p[1] - 3], [p[0] + 3, p[1] + 9]].findIndex(m => kk(m[0], m[1]) !== 4);
      const cx = p[0] + 3.5, cy = p[1] + 3.5, fc = FOODC.reduce((b, c) => Math.hypot(c[0] - cx, c[1] - cy) < Math.hypot(b[0] - cx, b[1] - cy) ? c : b), fdx = fc[0] - cx, fdy = fc[1] - cy;
      const food = Math.abs(fdx) > Math.abs(fdy) ? (fdx < 0 ? 0 : 1) : (fdy < 0 ? 2 : 3);
      return { open, food, cls: open < 0 ? null : open === food ? 'faces' : open === (food ^ 1) ? 'opposite' : 'sideways' };
    });
    const nearRing = (xx, yy) => ponds.some(p => xx >= p[0] - 6 && xx <= p[0] + 13 && yy >= p[1] - 6 && yy <= p[1] + 13);
    const inside = (xx, yy) => ponds.some(p => xx >= p[0] - 2 && xx <= p[0] + 8 && yy >= p[1] - 2 && yy <= p[1] + 8);
    const arrive = (xx, yy) => { let best = -1, bd = 1e9; ponds.forEach((p, i) => { const d = Math.hypot(xx - (p[0] + 3.5), yy - (p[1] + 3.5)); if (d < bd) { bd = d; best = i; } }); const p = ponds[best], dx = xx - (p[0] + 3.5), dy = yy - (p[1] + 3.5); return { pond: best, side: Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 0 : 1) : (dy < 0 ? 2 : 3) }; };
    const pondOf = new Int8Array(GP).fill(-1), arrOpen = new Int8Array(GP).fill(-1), entered = new Uint8Array(GP), wasIn = new Uint8Array(GP), exited = new Uint8Array(GP), inT = new Int32Array(GP), lastT = new Int32Array(GP).fill(-1), lastX = new Float64Array(GP), lastY = new Float64Array(GP), lastE = new Float64Array(GP), lastW = new Float64Array(GP);
    e.genBegin();
    for (let t = 0; t < L; t++) {
      const n = e.genTick(t);
      for (let i = 0; i < n; i++) {
        const s = v.ord[i], xx = v.ax[s], yy = v.ay[s];
        if (pondOf[s] < 0 && nearRing(xx, yy)) { const a = arrive(xx, yy); pondOf[s] = a.pond; arrOpen[s] = a.side === info[a.pond].open ? 1 : 0; }
        const nin = inside(xx, yy) ? 1 : 0; if (nin) { entered[s] = 1; inT[s]++; } if (wasIn[s] && !nin) exited[s] = 1; wasIn[s] = nin;
        lastT[s] = t; lastX[s] = xx; lastY[s] = yy; lastE[s] = v.ae[s]; lastW[s] = v.aw[s];
      }
      if (n === 0) break;
    }
    const st = e.genEnd(false); tot.survived += st.mean / R; tot.drankAll += st.drankShare / R;
    for (let s = 0; s < GP; s++) {
      tot.dots++; if (pondOf[s] < 0) continue;
      tot.reached++; if (arrOpen[s] === 1) tot.arrOpen++; else tot.arrClosed++;
      const c = cls[info[pondOf[s]].cls]; if (!c) continue;
      c.dots++; if (entered[s]) { c.entered++; c.insideTicks += inT[s]; if (exited[s]) c.left++; }
      if (v.gwater[s] > 0) { c.drank++; if (lastT[s] >= L - 1) c.drinkSurvived++; else if (inside(lastX[s], lastY[s])) { c.drinkDiedInside++; (lastW[s] <= lastE[s] ? c.diedInsideThirst++ : c.diedInsideHunger++); } else c.drinkDiedOutside++; }
    }
  }
  return { survived: Math.round(tot.survived), drank: Math.round(1000 * tot.drankAll) / 10, reachedRing: Math.round(1000 * tot.reached / tot.dots) / 10, arrivedAtOpenSide: Math.round(1000 * tot.arrOpen / Math.max(1, tot.arrOpen + tot.arrClosed)) / 10, byOpening: cls };
}
module.exports = { replayCups };
