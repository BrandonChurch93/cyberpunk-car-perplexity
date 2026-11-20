"""Facet surfaces as low order polynomial graphs fitted to the facet's boundary, and network edges moved onto the
intersections of the fitted surfaces so every face is one fair surface trimmed by its neighbours."""
import os
import numpy as np

CEN = 1e-6


def frame(P, sym, hint):
    c = P.mean(0)
    if sym:
        c[0] = 0.0
    X = P - c
    n = np.linalg.eigh(X.T @ X)[1][:, 0]
    if sym:
        n = n.copy()
        n[0] = 0.0
        n /= np.linalg.norm(n)
    hv = np.asarray(hint if hint is not None else (0.0, 1.0, 0.0), float)
    if n @ hv < 0:
        n = -n
    if sym or abs(n[0]) < 0.9:
        e1 = np.array([1.0, 0.0, 0.0]) - n[0] * n
    else:
        e1 = np.array([0.0, 0.0, 1.0]) - n[2] * n
    e1 /= np.linalg.norm(e1)
    return c, e1, np.cross(n, e1), n


class Poly:
    def __init__(self, c, e1, e2, n, s, d, sym, coef=None):
        self.c, self.e1, self.e2, self.n, self.s, self.d, self.sym = c, e1, e2, n, s, d, sym
        self.terms = [(i, j) for i in range(d + 1) for j in range(d + 1 - i)]
        self.coef = coef

    def uv(self, P):
        X = np.atleast_2d(P) - self.c
        return X @ self.e1 / self.s, X @ self.e2 / self.s

    def basis(self, u, v, der=0):
        a = np.abs(u) if self.sym else u
        sg = np.sign(u) if self.sym else np.ones_like(u)
        cols, du, dv = [], [], []
        for i, j in self.terms:
            cols.append(a ** i * v ** j)
            du.append((i * a ** max(i - 1, 0) * sg if i else 0 * u) * v ** j)
            dv.append(a ** i * (j * v ** max(j - 1, 0) if j else 0 * v))
        B = np.stack(cols, 1)
        if not der:
            return B
        return B, np.stack(du, 1), np.stack(dv, 1)

    def height(self, u, v):
        return self.s * (self.basis(u, v) @ self.coef)

    def g(self, P):
        """Signed distance-like residual and its gradient in world space."""
        u, v = self.uv(P)
        B, Bu, Bv = self.basis(u, v, 1)
        h = self.s * (B @ self.coef)
        fu, fv = Bu @ self.coef, Bv @ self.coef
        X = np.atleast_2d(P) - self.c
        r = X @ self.n - h
        G = self.n[None] - fu[:, None] * self.e1[None] - fv[:, None] * self.e2[None]
        return r, G

    def point(self, u, v):
        return self.c + (u * self.s)[..., None] * self.e1 + (v * self.s)[..., None] * self.e2 + self.height(u, v)[..., None] * self.n


def fit(P, W, sym, hint, degrees=(2, 3, 4), tol=1.0e-3, ridge=1e-7):
    c, e1, e2, n = frame(P, sym, hint)
    X = P - c
    s = max(np.abs(X @ e1).max(), np.abs(X @ e2).max())
    best = None
    for d in degrees:
        p = Poly(c, e1, e2, n, s, d, sym)
        u, v = p.uv(P)
        B = p.basis(u, v)
        z = (X @ n) / s
        reg = np.array([ridge * (i + j > 2) * (i + j) ** 2 for i, j in p.terms])
        A = B.T @ (W[:, None] * B) + np.diag(reg + 1e-12)
        p.coef = np.linalg.solve(A, B.T @ (W * z))
        res = np.abs(X @ n - p.height(u, v))
        out = (float(res.max()), float(np.sqrt(np.mean(res ** 2))), p)
        if best is None or out[0] < best[0]:
            best = out
        if out[0] <= tol:
            return out
    return best


def project(q0, polys, w=1e6, iters=12):
    """Closest point to q0 that lies on all the given surfaces (damped least squares)."""
    q = np.array(q0, float)
    for _ in range(iters):
        rs, Gs = [], []
        for p in polys:
            r, G = p.g(q)
            rs.append(r[0])
            Gs.append(G[0])
        r = np.array(rs)
        G = np.array(Gs)
        A = np.eye(3) + w * G.T @ G
        b = -(q - q0) - w * G.T @ r
        dq = np.linalg.solve(A, b)
        q = q + dq
        if np.abs(dq).max() < 1e-9:
            break
    return q


def choose(P, sym, hint, tol=1.0e-3, worst=1.0e-2):
    fits = {d: fit(P, np.ones(len(P)), sym, hint, degrees=(d,)) for d in (2, 3, 4)}
    best = min(r[0] for r in fits.values())
    if best > worst:
        return None
    for d in (2, 3, 4):
        if fits[d][0] <= max(tol, 1.25 * best):
            return fits[d]
    return fits[4]


def move(net, samples, skip=()):
    """Fit a polynomial graph per facet; move every edge onto the intersection of its facets' surfaces and every
    vertex onto the common point of its facets. Returns new samples, vertex positions, the polys and a report."""
    polys, report = {}, {}
    inc = {}
    for f in net.facets:
        es = list(f['loop']) + [e for h in f['holes'] for e in h] + list(f.get('inner', ()))
        for e in es:
            inc.setdefault(e, []).append(f['name'])
        if f['name'] in skip or f.get('plate'):
            continue
        P = np.vstack([samples[e][::2] for e in es])
        sym = any(np.abs(samples[e][:, 0]).max() < CEN for e in f.get('inner', ()))
        r = choose(P, sym, f['hint'])
        if r is None:
            report[f['name']] = 'kept'
            continue
        polys[f['name']] = r[2]
        report[f['name']] = (r[2].d, r[0], r[1])
    vinc = {}
    for e, fs in inc.items():
        c = net.edges[e]['ctrl']
        for v in (c[0], c[-1]):
            vinc.setdefault(v, set()).update(fs)
    vpos = {}
    for v, fs in vinc.items():
        ps = [polys[n] for n in sorted(fs) if n in polys]
        p0 = np.asarray(net.points[v], float)
        vpos[v] = project(p0, ps) if ps else p0
        if abs(p0[0]) < CEN:
            vpos[v][0] = 0.0
    out, shift = {}, {}
    for e, S in samples.items():
        ps = [polys[n] for n in inc.get(e, ()) if n in polys]
        c = net.edges[e]['ctrl']
        if not ps:
            Q = S.copy()
        else:
            Q = np.array([project(p, ps) for p in S])
        if np.abs(S[:, 0]).max() < CEN:
            Q[:, 0] = 0.0
        L = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(Q, axis=0), axis=1))])
        lb = min(0.03, 0.3 * L[-1]) + 1e-9
        d0 = vpos[c[0]] - Q[0]
        d1 = vpos[c[-1]] - Q[-1]
        w0 = np.clip(1 - L / lb, 0, 1) ** 2
        w1 = np.clip(1 - (L[-1] - L) / lb, 0, 1) ** 2
        Q = Q + w0[:, None] * d0 + w1[:, None] * d1
        Q[0], Q[-1] = vpos[c[0]], vpos[c[-1]]
        out[e] = Q
        shift[e] = (float(np.linalg.norm(Q - S, axis=1).max()), float(max(np.linalg.norm(d0), np.linalg.norm(d1))))
    return out, vpos, polys, report, shift


def grid(p, loop_pts, margin=0.06, n=24):
    """Sample the poly on a uv rectangle around the facet for a B-spline: returns a dict in the form mvs.occ_surface takes."""
    u, v = p.uv(loop_pts)
    u0, u1 = u.min() - margin, u.max() + margin
    v0, v1 = v.min() - margin, v.max() + margin
    h = max(u1 - u0, v1 - v0) / n
    nx = int(np.ceil((u1 - u0) / h)) + 1
    ny = int(np.ceil((v1 - v0) / h)) + 1
    U, V = np.meshgrid(u0 + h * np.arange(nx), v0 + h * np.arange(ny))
    F = p.height(U.ravel(), V.ravel()).reshape(U.shape)
    return {'F': F, 'u0': u0 * p.s, 'v0': v0 * p.s, 'h': h * p.s, 'c': p.c, 'e1': p.e1, 'e2': p.e2, 'n': p.n}


def _bern(p, t):
    from math import comb
    t = np.asarray(t, float)
    return np.stack([comb(p, k) * t ** k * (1 - t) ** (p - k) for k in range(p + 1)], 1)


def occ_surface(p, loop_pts, margin=0.05):
    """Exact B-spline of the graph: one Bezier span per side, with a C0 knot on the centerline for symmetric facets."""
    from OCP.Geom import Geom_BSplineSurface
    from OCP.collections import Array2_gp_Pnt, Array1_double, Array1_int
    from OCP.gp import gp_Pnt
    u, v = p.uv(loop_pts)
    ua, ub = u.min() - margin, u.max() + margin
    va, vb = v.min() - margin, v.max() + margin
    deg = max(p.d, 1)
    spans = [(ua, 0.0), (0.0, ub)] if p.sym and ua < 0 < ub else [(ua, ub)]
    t = np.linspace(0, 1, deg + 1)
    Mi = np.linalg.inv(_bern(deg, t))
    vv = va + t * (vb - va)
    cols = []
    for k, (a, b) in enumerate(spans):
        uu = a + t * (b - a)
        U, V = np.meshgrid(uu, vv, indexing='ij')
        X = p.point(U.ravel(), V.ravel()).reshape(deg + 1, deg + 1, 3)
        C = np.einsum('ik,kld->ild', Mi, X)
        C = np.einsum('jl,ild->ijd', Mi, C)
        cols.append(C if k == 0 else C[1:])
    Pn = np.concatenate(cols, 0)
    nu, nv = Pn.shape[:2]
    poles = Array2_gp_Pnt(1, nu, 1, nv)
    for i in range(nu):
        for j in range(nv):
            poles.SetValue(i + 1, j + 1, gp_Pnt(*map(float, Pn[i, j])))
    uk = [ua * p.s] + ([0.0] if len(spans) == 2 else []) + [ub * p.s]
    um = [deg + 1] + ([deg] if len(spans) == 2 else []) + [deg + 1]
    UK, VK = Array1_double(1, len(uk)), Array1_double(1, 2)
    UM, VM = Array1_int(1, len(um)), Array1_int(1, 2)
    for i, (k, m) in enumerate(zip(uk, um)):
        UK.SetValue(i + 1, float(k))
        UM.SetValue(i + 1, int(m))
    for i, k in enumerate((va * p.s, vb * p.s)):
        VK.SetValue(i + 1, float(k))
        VM.SetValue(i + 1, deg + 1)
    return Geom_BSplineSurface(poles, UK, VK, UM, VM, deg, deg)


RELAX_WAVE = float(os.environ.get('RELAX_WAVE', '0.3'))
RELAX_SKIP = set(os.environ.get('RELAX_SKIP', 'lip,splitter,intake~back,diffuser,nose_face').split(','))


def relax(net, samples, deg=2, dmax=0.008, iters=int(os.environ.get('RELAX_ITERS', '2')), log=print):
    """Pull each edge toward the intersection of its two facets' fitted low order surfaces, vertices fixed, the
    move a few sine modes along the edge, zero at the ends and capped, so the boundary curves agree with fair facet surfaces."""
    inc = {}
    for f in net.facets:
        for e in list(f['loop']) + [e for h in f['holes'] for e in h] + list(f.get('inner', ())):
            inc.setdefault(e, []).append(f)
    S = {k: v.copy() for k, v in samples.items()}
    worst = {}
    for it in range(iters):
        polys = {}
        for f in net.facets:
            if f.get('plate'):
                continue
            es = list(f['loop']) + [e for h in f['holes'] for e in h] + list(f.get('inner', ()))
            P = np.vstack([S[e][::2] for e in es])
            sym = any(np.abs(S[e][:, 0]).max() < CEN for e in f.get('inner', ()))
            if f['name'].removesuffix('.R') not in RELAX_SKIP:
                polys[f['name']] = fit(P, np.ones(len(P)), sym, f['hint'], degrees=(deg,))[2]
        for e, fs in inc.items():
            ps = [polys[f['name']] for f in fs if f['name'] in polys]
            if len(ps) != len(fs) or not ps or len(ps) > 2 or e not in S:
                continue
            Q0 = samples[e]
            cur = S[e]
            T = np.array([project(p, ps) for p in cur]) - Q0
            L = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(Q0, axis=0), axis=1))])
            t = L / max(L[-1], 1e-9)
            K = int(np.clip(round(L[-1] / RELAX_WAVE), 1, 6))
            B = np.stack([np.sin((j + 1) * np.pi * t) for j in range(K)], 1)
            T = B @ np.linalg.lstsq(B, T, rcond=None)[0]
            m = np.linalg.norm(T, axis=1).max()
            T *= min(1.0, dmax / max(m, 1e-12))
            w = np.ones_like(t)
            if np.abs(Q0[:, 0]).max() < CEN:
                T[:, 0] = 0.0
            S[e] = Q0 + w[:, None] * T
            worst[e] = float(np.linalg.norm(w[:, None] * T, axis=1).max())
    big = sorted(((v, e) for e, v in worst.items() if v > 4e-3), reverse=True)
    if big:
        log('relaxed edges over 4 mm: ' + ', '.join(f'{e} {d * 1000:.1f}' for d, e in big[:16]))
    return S
