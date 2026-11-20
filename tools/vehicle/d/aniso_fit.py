import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from multiprocessing import Pool
from scipy.ndimage import binary_erosion
import mvs, importlib
from net import full
from kernel_np import spline

ANGLES = (0, 30, 60, 90, 120, 150)
RATIOS = (0.04, 0.12)
net = full(importlib.import_module('car').network())
samples = {}


def smp(e):
    if e not in samples:
        samples[e] = spline([net.resolve(c) for c in net.edges[e]['ctrl']], spacing=0.002)
    return samples[e]


def score(f, cand, n_cells):
    loop = mvs.chain([smp(e) for e in f['loop']])
    holes = [mvs.chain([smp(e) for e in h]) for h in f['holes']]
    inner = [smp(e) for e in f.get('inner', ())]
    cen = [p for p in inner if np.abs(p[:, 0]).max() < 1e-6]
    oth = [p for p in inner if np.abs(p[:, 0]).max() >= 1e-6]
    R = mvs.solve(loop, holes, np.vstack(cen) if cen else None, oth, f['crown'], f['hint'], sym=bool(cen), n_cells=n_cells,
                  aniso=None if cand is None else (math.radians(cand[0]), cand[1]))
    if R is None:
        return None
    k1, k2 = mvs.curvature(R)
    e = binary_erosion(R['inside'], iterations=3)
    if e.sum() < 20:
        e = R['inside']
    K = (k1 * k2)[e]
    H = (0.5 * (k1 + k2))[e]
    return float(np.mean(np.abs(K)) / max(np.mean(H ** 2), 1e-9)), float(R['err'])


def fit(name):
    f = next(g for g in net.facets if g['name'] == name)
    sym = any(np.abs(smp(e)[:, 0]).max() < 1e-6 for e in f.get('inner', ()))
    cands = [None] + [(t, a) for t in ((0, 90) if sym else ANGLES) for a in RATIOS]
    best = None
    for c in cands:
        try:
            s = score(f, c, 220)
        except Exception:
            s = None
        if s is None:
            continue
        if best is None or s[0] < best[0] * (0.9 if c is not None else 1):
            best = (s[0], c)
    return name, best


if __name__ == '__main__':
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'aniso.json')
    names = [f['name'] for f in net.facets if not f.get('plate')]
    with Pool(3) as p:
        res = p.map(fit, names, chunksize=1)
    d = {n: (None if b is None or b[1] is None else list(b[1])) for n, b in res}
    for n, b in res:
        print(n, b)
    json.dump(d, open(out, 'w'), indent=1, sort_keys=True)
