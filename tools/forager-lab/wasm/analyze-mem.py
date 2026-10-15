"""Decode the memory registers from run-memdump.js CSV files (one per seed): per register, how it is distributed, how it correlates with candidate explanations, and
how much of its variance a linear model of those explanations captures (R squared), per seed. Usage: python3 analyze-mem.py file1.csv [file2.csv ...]"""
import sys
import numpy as np

FEATS = ['hyd', 'energy', 'logSinceDrink', 'logSinceEat', 'sin', 'cos', 'dPond', 'dFood', 'tick', 'everDrank', 'hydXdrank']

def load(fn):
    with open(fn) as f:
        head = f.readline().strip().split(',')
    d = np.loadtxt(fn, delimiter=',', skiprows=1)
    c = {k: d[:, i] for i, k in enumerate(head)}
    tick = c['tick']
    sd = np.where(c['sinceDrink'] < 0, tick + 1, c['sinceDrink'] + 1)
    se = np.where(c['sinceEat'] < 0, tick + 1, c['sinceEat'] + 1)
    X = np.column_stack([c['hyd'], c['energy'], np.log(sd), np.log(se), c['sin'], c['cos'], c['dPond'] / 40, c['dFood'] / 40, tick / 1000, c['everDrank'], c['hyd'] * c['everDrank']])
    M = np.column_stack([c['m0'], c['m1'], c['m2'], c['m3']])
    return X, M, c

def r2(X, y):
    A = np.column_stack([X, np.ones(len(X))])
    w, *_ = np.linalg.lstsq(A, y, rcond=None)
    res = y - A @ w
    tot = ((y - y.mean()) ** 2).sum()
    return 1 - (res ** 2).sum() / tot if tot > 0 else float('nan')

allR2 = []
for fn in sys.argv[1:]:
    X, M, c = load(fn)
    print('==', fn, 'rows', len(X))
    for m in range(4):
        y = M[:, m]
        corr = [np.corrcoef(X[:, j], y)[0, 1] if X[:, j].std() > 0 and y.std() > 0 else float('nan') for j in range(len(FEATS))]
        single = [(r2(X[:, [j]], y), FEATS[j]) for j in range(len(FEATS))]
        best = max(single, key=lambda t: (t[0] if t[0] == t[0] else -1))
        full = r2(X, y)
        allR2.append(full)
        print('  m%d mean %+.2f sd %.2f  share |m|>0.9: %.0f%% | linear R2 on all features %.2f | best single feature %s R2 %.2f | corr: %s' % (m, y.mean(), y.std(), 100 * (np.abs(y) > 0.9).mean(), full, best[1], best[0],
              ' '.join('%s %+.2f' % (FEATS[j], corr[j]) for j in range(len(FEATS)) if abs(corr[j]) >= 0.3)))
    # do the registers differ between dots? share of variance that is between dots (same tick) vs over time
    print('  registers move over time: mean absolute change per 5 ticks (all dots): %s' % ' '.join('%.3f' % np.abs(np.diff(M[:, m])[(np.diff(c['tick']) == 5)]).mean() for m in range(4)))
print('median R2 over seeds and registers (linear, all features): %.2f' % np.nanmedian(allR2))
