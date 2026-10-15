// Diagnostic (WASM engine): train the standard random-pond curriculum (K = 3, fixed 200) to a secure foothold (80% drank), then train on cup maps whose opening faces the food (or with probability argv[3]) and print every generation for the first 40; also evaluates the same population on open maps and cup maps before and after (no breeding). Env: GENLEN, REGROW, GAP. Usage: node diag-cups.js <seed> [facing=1]
const { Engine } = require('./engine');
const cfg = { layout: 'randpond', mapSeed: 1, walls: 0, lossE: 1.5, lossW: 0.6, layers: 2, startE: 500, startW: 500, maxE: 500, maxW: 500, feedback: false, genSpawn: 1, memory: true, oscillator: true, oscPeriod: 200, pondSep: 16, wallN: 0, wallLen: 14, genLen: +(process.env.GENLEN || 1000), waterRegrow: +(process.env.REGROW || 0.03), regrow: +(process.env.REGROW || 0.03) };
const seed = +process.argv[2] || 1, facing = process.argv[3] === undefined ? 1 : +process.argv[3], K = 3;
const e = new Engine(cfg, seed); e.genInit(seed);
let mapSeed = 1; const avg = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
const gen = (lo, hi, w) => { const sets = []; for (let k = 0; k < K; k++) { const ms = mapSeed++; sets.push(() => { e.cfg.cupFacing = w.f; e.setMap('randpond', 0, ms, 2, lo, hi, w.t, w.gap, 0, 14); }); } return e.genRoundMulti(sets); };
const NOW = { t: 0, gap: 0, f: 0 }, CUP = { t: 5, gap: +(process.env.GAP || 3), f: facing };
[[12, 16], [12, 22], [12, 28], [12, 36]].forEach(([lo, hi], i) => { const h = []; for (let g = 0; g < (i === 0 ? 1000 : 400); g++) { h.push(gen(lo, hi, NOW)); const l = h.slice(-10); if (l.length === 10 && avg(l, 'fullShare') >= 0.15) break; } });
let h = []; for (let g = 0; g < 1500; g++) { h.push(gen(30, 0, NOW)); const l = h.slice(-10); if (l.length === 10 && avg(l, 'drankShare') >= 0.8) break; }
console.log('secure foothold after', h.length, 'real-task generations; drank', (100 * avg(h.slice(-10), 'drankShare')).toFixed(0) + '%');
// evaluate the same population on facing cups and open maps, no breeding
const ev = w => { let t = 0, f = 0, d = 0; for (let i = 0; i < 20; i++) { e.cfg.cupFacing = w.f; e.setMap('randpond', 0, 1000000 + i, 2, 30, 0, w.t, w.gap, 0, 14); const s = e.genRound(false); t += s.mean / 20; f += s.fullShare / 20; d += s.drankShare / 20; } return Math.round(t) + ' / ' + Math.round(100 * f) + '% / ' + Math.round(100 * d) + '%'; };
console.log('before cups: open maps', ev(NOW), '| cups facing', facing, ev(CUP));
for (let g = 0; g < 40; g++) { const s = gen(30, 0, CUP); if (g < 12 || g % 5 === 0) console.log('gen', g, 'training on cups: survived', Math.round(s.mean), 'full', Math.round(100 * s.fullShare) + '%', 'drank', Math.round(100 * s.drankShare) + '%'); }
console.log('after 40 generations: open maps', ev(NOW), '| cups facing', facing, ev(CUP));
