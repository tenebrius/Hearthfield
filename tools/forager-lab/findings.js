// Findings and Roadmap views. Every number below comes from a line in docs/ (the source is printed on each card); test-page.js checks the per-seed data against the raw files.
(function () {
  'use strict';
  const { el } = Lab;

  // per-seed data of the no-curriculum runs (docs/forager-lab-nocurriculum-raw.txt, TEST_BARS_DRANK): seed 1..8
  const NOCURR = { g1500: [0, 75, 0, 0, 70, 67, 59, 0], g3000: [0, 74, 0, 0, 72, 64, 60, 0] };
  // drank on cups by energy loss, sight 12 + occlusion (docs/forager-lab-generational-plan.md, "Budget frontier")
  const FRONTIER = [{ loss: '0.75', v: 72, note: '4 seeds, earlier batch' }, { loss: '1.0', v: 49, lo: 42, hi: 58, note: '8 seeds' }, { loss: '1.25', v: 31, lo: 20, hi: 42, note: '8 seeds' }, { loss: '1.5', v: 28, note: '8 seeds, earlier test' }];

  function bars(items, o) {   // small bar chart drawn to scale: items = [{ label, v, lo, hi, tone }]
    const Wd = 360, Ht = 120, L = 30, B = 22, T = 8, pw = Wd - L - 6, ph = Ht - B - T, max = o.max, n = items.length, bw = Math.min(34, pw / n * 0.6);
    let s = '';
    for (let i = 0; i <= 2; i++) { const y = T + ph * (1 - i / 2); s += `<line x1="${L}" x2="${Wd - 6}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="0.6"/><text x="${L - 4}" y="${y + 3}" text-anchor="end">${Math.round(max * i / 2)}${o.unit || ''}</text>`; }
    items.forEach((it, i) => {
      const cx = L + pw * (i + 0.5) / n, h = ph * it.v / max, y = T + ph - h;
      s += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 0.6).toFixed(1)}" fill="${it.tone || 'var(--accent)'}"/>`;
      if (it.lo != null) { const y1 = T + ph * (1 - it.hi / max), y2 = T + ph * (1 - it.lo / max); s += `<line x1="${cx}" x2="${cx}" y1="${y1.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--fg)" stroke-width="1.2"/>`; }
      const ly = it.hi != null ? T + ph * (1 - it.hi / max) : y;
      s += `<text x="${cx}" y="${(ly - 3).toFixed(1)}" text-anchor="middle" style="fill:var(--fg)">${it.v}</text><text x="${cx}" y="${Ht - 8}" text-anchor="middle">${it.label}</text>`;
    });
    return `<svg class="chart" viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="${o.aria}">${s}</svg>`;
  }
  const seedChart = () => {
    const items = []; NOCURR.g1500.forEach((v, i) => items.push({ label: 's' + (i + 1), v, tone: v ? 'var(--accent)' : 'var(--bad)' }));
    return bars(items, { max: 100, unit: '%', aria: 'Share that drank on cups, per seed, after 1500 generations without a curriculum: seeds 1, 3, 4 and 8 are at zero' });
  };

  const FINDINGS = [
    { id: 'thirst-wall', title: 'The world\'s budgets decide most outcomes', body: 'A dot that never drinks dies when its hydration store runs out: store ÷ hydration loss, 500 ÷ 0.6 = 833 ticks. Longer rounds hit a supply ceiling, and a pond trip costs about as many ticks as the energy store lasts, so the budget caps what any brain can do.', key: 'Stores of 200, 300, 500 survived 320, 481, 819 ticks. One population below sits exactly at 833.', not: 'It does not say how a population gets past the wall; that is the foothold problem (the no-curriculum and K cards).', src: 'docs/forager-lab-handoff.md section 6A', watch: [{ pop: 'nocurr-stuck', label: 'Watch dots that never drink' }] },
    { id: 'frontier', title: 'Cups pay off only at a loose energy budget', body: 'The same schedule at four energy losses, long sight with occlusion. The share of dots that drink inside a cup falls as the loss rises, and the step happens between 1.0 and 1.25.', chart: () => bars(FRONTIER.map(f => ({ label: f.loss, v: f.v, lo: f.lo, hi: f.hi })), { max: 100, unit: '%', aria: 'Share that drank on cups at energy loss 0.75, 1.0, 1.25 and 1.5: 72, 49, 31, 28 percent' }), key: '72 / 49 [42,58] / 31 [20,42] / 28 % drank at loss 0.75 / 1.0 / 1.25 / 1.5 (bars: 95% interval where there are 8 seeds).', not: 'The 0.75 and 1.5 values come from earlier batches (4 and 8 seeds) with slightly different labelling, so compare only 1.0 with 1.25 within one batch.', src: 'docs/forager-lab-generational-plan.md "Budget frontier"', watch: [{ pop: 'cups-075', label: 'Watch loss 0.75' }, { pop: 'cups-075', sw: { loss: '1.25' }, label: 'Same dots at 1.25' }, { pop: 'budget-125', label: 'Trained at 1.25' }] },
    { id: 'sight', title: 'Long sight and occlusion help only at loose budgets', body: 'Long sight (12 tiles) with occlusion, against sight 5 without it, on the same cup schedule. The gain appears at loss 1.0 and is within noise at 1.25.', key: '+19 points [+11,+29] at loss 1.0; +5 points [−8,+18] at 1.25 (8 seeds each).', not: 'At 1.25 the interval includes zero, so this does not show a benefit there.', src: 'docs/forager-lab-generational-plan.md "Budget frontier", paired differences', watch: [{ pop: 'sight5-10', label: 'Watch sight 5 at loss 1.0' }, { pop: 'cups-075', sw: { loss: '1' }, label: 'Same dots at 1.0 (trained at 0.75)' }] },
    { id: 'aids', title: 'The hand-made training aids for cups were not needed', body: 'The secure-drinking stage, the ramp from one to three cup maps and the early exit were each removed in turn. Training on cups only, from the first cup generation, learned as well.', key: '69% drank [66,73] with the aids, 67% [63,71] with none; difference −2.0 points [−7.2,+2.9]. 8 of 8 seeds learned in every variant.', not: 'Tested at the loose budget (0.75) where cups are easy, and with the pond stages still in place. At tight budgets the aids might matter.', src: 'docs/forager-lab-generational-plan.md "Ablation of the hand-made help"', watch: [{ pop: 'cups-075', label: 'Watch the helped run' }] },
    { id: 'nocurr', title: 'Without any curriculum, half of the seeds never start drinking', body: 'Cups from generation 1, no distance stages. Four of eight seeds never drink and stay at the thirst wall, also after 3000 generations. The four that do start learn cups as well as the curriculum runs. So the curriculum supplies the first discovery of drinking, not the cup skill.', chart: seedChart, key: 'Drank on cups after 1500 generations, seeds 1 to 8: 0, 75, 0, 0, 70, 67, 59, 0 %. 4 of 8 seeds learn (Wilson interval about 22 to 78%).', not: 'One setting (loss 0.75, sight 12, occlusion). Whether open plus cup maps from the start, or a larger K, remove the failures is not tested.', src: 'docs/forager-lab-nocurriculum-raw.txt', watch: [{ pop: 'nocurr-stuck', label: 'Watch seed 1 (stuck)' }, { pop: 'nocurr-ok', label: 'Watch seed 2 (learns)' }], train: { preset: 'cups-none', label: 'Train it yourself' } },
    { id: 'k3', title: 'Scoring each dot on 3 maps instead of 1 fixes most failures to start', body: 'A single random map makes the fitness signal noisy, so a weak first drinking habit is lost. Averaging three maps per generation gets every seed drinking, sooner, and the final dots do better on held-out maps.', key: 'Held-out survival 896 ticks with 41% surviving the round, against 812 and 10% with one map (16 seeds): +84 ticks [+62,+105].', not: 'K = 3 on the random-pond task without walls. A control with K = 1 and three times the generations gained only a third of this, so it is not just more compute.', src: 'docs/forager-lab-generational-plan.md "Step 2" and docs/forager-lab-handoff.md section 6C', train: { preset: 'open', label: 'Train with K = 3' } },
    { id: 'transfer', title: 'Dots trained with a generous budget do not economise at a tight one', body: 'Dots that learned cups at loss 0.75 do worse than a dot that just sits on the food once the loss is 1.5. A schedule that raised the loss in steps (0.75, 1.0, 1.25, 1.5) ended at the same level as dots trained at 1.5 from the start. This is not solved.', key: '685 to 735 ticks at loss 1.5, below a food-sitter\'s 833.', not: 'One budget curriculum was tried. Mixing budgets within a generation (one brain for several budgets) is listed in the roadmap and not tested.', src: 'docs/forager-lab-handoff.md sections 6D and 7', watch: [{ pop: 'cups-075', sw: { loss: '1.5' }, label: 'Watch loss 0.75 dots at 1.5' }] },
    { id: 'memory', title: 'Memory registers are used as state, but what they store is unknown', body: 'Four numbers a dot carries from tick to tick. Zeroing or freezing them costs a lot, so the brains use them. No simple quantity explains them: they sit at plus or minus 1 half the time and flip every 5 to 12 ticks, and each seed invents its own encoding.', key: 'Zeroing cost 284 ticks; freezing from age 25 / 100 / 400 cost 322 / 277 / 130 (16 seeds). A linear model explains about 8% of a register.', not: 'These numbers are from the far-corners task, not the showcase populations here. Switching memory off on a cups population shows the same kind of loss but is not the same measurement.', src: 'docs/forager-lab-handoff.md section 6E', watch: [{ pop: 'cups-075', sw: { mem: '0' }, label: 'Watch with memory off' }] }
  ];

  const ROADMAP = [
    { id: 'watch', group: 'now', title: 'Watch trained dots', question: 'What do the trained populations actually do on the maps they were tested on?', status: 'done', view: 'Watch', adds: 'Population cards, map controls, follow-a-dot, what-if switches, 20-map check.' },
    { id: 'search', group: 'now', title: 'Search changes that need no task knowledge', question: 'Do a bigger K (6, 10), a larger population, diversity preservation or novelty search remove the failure to start drinking, without a curriculum?', status: 'next', view: 'Train', adds: 'Each becomes a line in the Train options table and a preset.', option: 'K' },
    { id: 'trace', group: 'now', title: 'Trace a stuck seed against a working one', question: 'In the first 100 generations, is a stuck seed "never found drinking" or "found it and lost it"?', status: 'next', view: 'Train', adds: 'A per-generation trace of both populations, using the two no-curriculum populations as the pair.' },
    { id: 'mixed', group: 'now', title: 'Mixed budgets in one generation', question: 'Can one brain learn to economise if each generation mixes energy budgets, the way K layouts removed the noisy first step?', status: 'later', view: 'Train', adds: 'A "budgets per generation" option and a preset.' },
    { id: 'memdecode', group: 'now', title: 'Decode the memory registers', question: 'What do the four registers store? Candidates: the dot\'s last few actions, or fewer registers.', status: 'later', view: 'Watch', adds: 'A register-over-time plot for the followed dot, and the decoded meaning if one is found.' },
    { id: 'wallsense', group: 'now', title: 'Wall sense at loss 1.0', question: 'Does the wall-sensing input matter at the budget where dots still do well?', status: 'later', view: 'Train', adds: 'A wall-sense option in the table and a preset.' },
    { id: 'mix-start', group: 'now', title: 'Open plus cup maps from the start', question: 'Does a fixed mix of open and cup maps from generation 1 remove the failures? (A fixed training mix, not "no curriculum".)', status: 'later', view: 'Train', adds: 'A map-mix option and a preset.' },
    { id: 'openworld', group: 'ideas', title: 'Open world, revisited', question: 'Does a continuous world, with reproduction and no rounds and no score we choose, now with walls, cups, occlusion and the fast engine, learn cups without a curriculum?', status: 'idea', view: 'a new view', adds: 'The WebAssembly engine already has the open-ended mode; it has not been tried with walls.' },
    { id: 'richer', group: 'ideas', title: 'Richer worlds', question: 'Seasons or moving food, poison, predators, several species competing for the same ponds: what behaviour appears when the world changes faster than a generation?', status: 'idea', view: 'a new view', adds: 'World options in the Train table.' },
    { id: 'interact', group: 'ideas', title: 'Dots that interact', question: 'Dots that see and react to each other, share food, follow, or signal: does following a dot that knows the way solve the foothold problem without a curriculum?', status: 'idea', view: 'Watch and Train', adds: 'Other-dot inputs and outputs in the engine, shown in Watch.' },
    { id: 'brains', group: 'ideas', title: 'Bigger or growing brains', question: 'Which tasks fail because the 8 + 8 network is too small, and which because evolution cannot find the weights?', status: 'idea', view: 'Train', adds: 'Hidden layer size and growth options.' },
    { id: 'hearthfield', group: 'ideas', title: 'Back to Hearthfield', question: 'Use what was learned (budgets, footholds, memory) for the settlement game\'s characters (docs/version-1-specification.md, docs/expansion-plan.md).', status: 'idea', view: 'not in this page', adds: 'Nothing here; this page stays a learning tool.' }
  ];

  function watchBtn(w) { return el('button', { onclick: () => Lab.watchPop(Lab.pops.find(p => p.id === w.pop), w.sw ? { sw: w.sw } : null), text: w.label }); }
  function buildFindings(sec) {
    sec.appendChild(el('p', { class: 'note', text: 'Each card says what was measured, how many seeds, and what it does not show. Numbers in square brackets are 95% intervals. Press a Watch button to open the matching dots with the matching switches.' }));
    const grid = el('div', { class: 'cards' });
    for (const f of FINDINGS) {
      const acts = [].concat((f.watch || []).map(watchBtn), f.train ? [el('button', { onclick: () => { Lab.show('train'); Lab.train.choose(Lab.train.PRESETS.find(p => p.id === f.train.preset)); }, text: f.train.label })] : []);
      grid.appendChild(el('section', { class: 'panel card', id: 'f-' + f.id }, [el('h3', { text: f.title }), el('p', { text: f.body }), f.chart ? el('div', { html: f.chart() }) : null, el('p', { class: 'keynum', text: f.key }), el('p', { class: 'not', html: '<b>Does not show:</b> ' }), el('p', { class: 'src', text: 'Source: ' + f.src }), acts.length ? el('div', { class: 'actions' }, acts) : null]));
      grid.lastChild.querySelector('.not').appendChild(document.createTextNode(f.not));
    }
    sec.appendChild(grid);
  }
  function buildRoadmap(sec) {
    sec.appendChild(el('p', { class: 'note', text: 'What comes next and where it will show up. Items marked "possible future direction" are ideas that have not been discussed in depth or decided; they are not planned.' }));
    const groups = [['now', 'Planned work'], ['ideas', 'Possible future directions']];
    for (const [g, title] of groups) {
      const wrap = el('div', { class: 'group' }, [el('h2', { text: title })]), grid = el('div', { class: 'cards' });
      for (const r of ROADMAP.filter(x => x.group === g)) {
        const hasOpt = r.option && Lab.train && Lab.train.OPTIONS.some(o => o.key === r.option);
        grid.appendChild(el('section', { class: 'panel card', id: 'r-' + r.id }, [el('div', {}, [el('span', { class: 'pill ' + r.status, text: r.status === 'idea' ? 'possible future direction' : r.status })]), el('h3', { text: r.title }), el('p', { text: r.question }), el('p', { class: 'not', html: '<b>Will appear in:</b> ' + r.view + '. ' + r.adds }), hasOpt ? el('div', { class: 'actions' }, [el('button', { onclick: () => Lab.show('train'), text: 'Open in Train' })]) : null]));
      }
      wrap.appendChild(grid); sec.appendChild(wrap);
    }
  }
  Lab.registerView('findings', 'Findings', { init: buildFindings });
  Lab.registerView('roadmap', 'Roadmap', { init: buildRoadmap });
  Lab.data = { NOCURR, FRONTIER, FINDINGS, ROADMAP };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', Lab.boot); else Lab.boot();
})();
