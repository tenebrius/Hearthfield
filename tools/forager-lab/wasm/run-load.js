// Examine a saved population on held-out cup maps without training (needs the files run-multi.js wrote with "saveTo": <file> and <file>.json).
// Usage: node run-load.js <genome file> [maps=20] [gap=3] [firstMap=1000000]   Prints one LOADED line: survived, drank, and the accounting of cupreplay.js split by where the opening is.
const fs = require('fs');
const { Engine } = require('./engine');
const { replayCups } = require('./cupreplay');
const A = process.argv, file = A[2], R = +A[3] || 20, gap = A[4] === undefined ? 3 : +A[4], first = +A[5] || 1000000;
const saved = JSON.parse(fs.readFileSync(file + '.json', 'utf8'));
const e = new Engine(Object.assign({}, saved.cfg, { layout: 'randpond', mapSeed: 1, walls: 0 }), saved.seed);
e.genInit(saved.seed); e.loadGenomes(file);
const r = replayCups(e, i => { e.cfg.cupFacing = 0; e.setMap('randpond', 0, first + i, saved.cfg.pondN, saved.cfg.pondMin || 30, 0, 5, gap, 0, 14); }, R);
console.log('LOADED ' + JSON.stringify(Object.assign({ file, seed: saved.seed }, r)));
