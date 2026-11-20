"""Pressure surfaces: each facet is the graph over its best-fit plane of the solution of Poisson's equation
(uniform pressure, so a uniform mean curvature crown) taking the facet's boundary curves as Dirichlet data.
Centerline facets are solved symmetric, with the pressure fitted to the centerline profile. With a base surface the
correction to it minimises thin plate bending energy (OCC_CORR=tp) instead of the harmonic one."""
import os
import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as sla
from matplotlib.path import Path


def chain(curves):
    rest = [np.asarray(c, float) for c in curves]
    out = [rest.pop(0)]
    while rest:
        end = out[-1][-1]
        d = [(min(np.linalg.norm(c[0] - end), np.linalg.norm(c[-1] - end)), i) for i, c in enumerate(rest)]
        _, i = min(d)
        c = rest.pop(i)
        if np.linalg.norm(c[-1] - end) < np.linalg.norm(c[0] - end):
            c = c[::-1]
        out.append(c)
    if len(out) > 1 and np.linalg.norm(out[0][0] - out[-1][-1]) > 1e-4 and np.linalg.norm(out[0][-1] - out[1][0]) > 1e-4:
        out[0] = out[0][::-1]
        return chain(out)
    return np.vstack(out)


def _simple(P):
    n = len(P)
    A, B = P, np.roll(P, -1, 0)
    step = max(1, n // 400)
    A, B = A[::step], np.roll(P[::step], -1, 0)
    m = len(A)
    d1 = B - A
    for i in range(m):
        j = np.arange(i + 2, m)
        if i == 0:
            j = j[j < m - 1]
        if not len(j):
            continue
        p, r = A[i], d1[i]
        q, s = A[j], d1[j]
        den = r[0] * s[:, 1] - r[1] * s[:, 0]
        ok = np.abs(den) > 1e-14
        qp = q - p
        t = (qp[:, 0] * s[:, 1] - qp[:, 1] * s[:, 0]) / np.where(ok, den, 1)
        u = (qp[:, 0] * r[1] - qp[:, 1] * r[0]) / np.where(ok, den, 1)
        if np.any(ok & (t > 1e-9) & (t < 1 - 1e-9) & (u > 1e-9) & (u < 1 - 1e-9)):
            return False
    return True


def _bilinear(uv, u0, v0, h, nx, ny):
    fx = (uv[:, 0] - u0) / h
    fy = (uv[:, 1] - v0) / h
    i = np.clip(np.floor(fx).astype(int), 0, nx - 2)
    j = np.clip(np.floor(fy).astype(int), 0, ny - 2)
    a = fx - i
    b = fy - j
    rows = np.repeat(np.arange(len(uv)), 4)
    cols = np.stack([j * nx + i, j * nx + i + 1, (j + 1) * nx + i, (j + 1) * nx + i + 1], 1).ravel()
    w = np.stack([(1 - a) * (1 - b), a * (1 - b), (1 - a) * b, a * b], 1).ravel()
    return sp.csr_matrix((w, (rows, cols)), shape=(len(uv), nx * ny))


CORR = os.environ.get('OCC_CORR', 'tp')


def solve(loop, holes=(), center=None, inner=(), crown=0.0, hint=None, sym=False, n_cells=220, max_slope=2.75, aniso=None, base=None):
    """loop: closed boundary polyline (N,3); holes: closed polylines; center: centerline samples for sym facets;
    inner: extra curves the surface passes through. Returns a dict describing the graph surface or None."""
    loop = np.asarray(loop, float)
    allp = np.vstack([loop] + [np.asarray(h, float) for h in holes])
    c = allp.mean(0)
    if sym:
        c[0] = 0.0
    X = allp - c
    w_, V_ = np.linalg.eigh(X.T @ X)
    n = V_[:, 0]
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
    e2 = np.cross(n, e1)
    to_uv = lambda P: np.stack([(P - c) @ e1, (P - c) @ e2], 1)
    luv = to_uv(loop)
    if not _simple(luv):
        return None
    huv = [to_uv(np.asarray(h, float)) for h in holes]
    span = (luv.max(0) - luv.min(0)).max()
    h = span / n_cells
    m = 5 * h
    if sym:
        U = np.abs(luv[:, 0]).max() + m
        nxh = int(np.ceil(U / h))
        u0 = -nxh * h
        nx = 2 * nxh + 1
    else:
        u0 = luv[:, 0].min() - m
        nx = int(np.ceil((luv[:, 0].max() + m - u0) / h)) + 1
    v0 = luv[:, 1].min() - m
    ny = int(np.ceil((luv[:, 1].max() + m - v0) / h)) + 1
    gu = u0 + h * np.arange(nx)
    gv = v0 + h * np.arange(ny)
    GU, GV = np.meshgrid(gu, gv)
    G = np.stack([GU.ravel(), GV.ravel()], 1)
    inside = Path(luv).contains_points(G)
    for q in huv:
        inside &= ~Path(q).contains_points(G)
    N = nx * ny
    idx = np.arange(N).reshape(ny, nx)
    core = np.zeros((ny, nx), bool)
    core[1:-1, 1:-1] = True
    core = core.ravel()
    rows_in = np.nonzero(inside & core)[0]
    rows_out = np.nonzero(~inside & core)[0]

    if aniso is None:
        cuu, cvv, cuv = 1.0, 1.0, 0.0
    else:
        th, a_ = aniso
        cs, sn = np.cos(th), np.sin(th)
        cuu = a_ * cs * cs + sn * sn
        cvv = a_ * sn * sn + cs * cs
        cuv = 2 * (a_ - 1) * cs * sn

    def lap(r):
        k = len(r)
        rr = np.repeat(np.arange(k), 9)
        cc = np.stack([r, r - 1, r + 1, r - nx, r + nx, r + nx + 1, r + nx - 1, r - nx + 1, r - nx - 1], 1).ravel()
        st = np.array([-2 * cuu - 2 * cvv, cuu, cuu, cvv, cvv, cuv / 4, -cuv / 4, -cuv / 4, cuv / 4])
        vv = np.tile(st, k) / h ** 2
        return sp.csr_matrix((vv, (rr, cc)), shape=(k, N))
    def hess(r):
        k = len(r)
        rr = np.repeat(np.arange(3 * k), 4)
        cu = np.stack([r - 1, r, r + 1, r], 1)
        cv = np.stack([r - nx, r, r + nx, r], 1)
        cx = np.stack([r + nx + 1, r + nx - 1, r - nx + 1, r - nx - 1], 1)
        cc = np.concatenate([cu, cv, cx]).ravel()
        vv = np.concatenate([np.tile([1.0, -2.0, 1.0, 0.0], k), np.tile([1.0, -2.0, 1.0, 0.0], k),
                             np.tile(np.array([1.0, -1.0, -1.0, 1.0]) * np.sqrt(2) / 4, k)]) / h ** 2
        return sp.csr_matrix((vv, (rr, cc)), shape=(3 * k, N))
    Li = hess(rows_in) if base is not None and CORR == 'tp' else lap(rows_in)
    out_mask = ~inside
    rr, cc, vv, k = [], [], [], 0
    for (di, dj) in ((1, 0), (0, 1)):
        jj, ii = np.nonzero(out_mask.reshape(ny, nx))
        ok = (ii - di >= 0) & (ii + di < nx) & (jj - dj >= 0) & (jj + dj < ny)
        ii, jj = ii[ok], jj[ok]
        r = jj * nx + ii
        d = dj * nx + di
        m_ = len(r)
        rr.append(np.repeat(np.arange(k, k + m_), 3))
        cc.append(np.stack([r - d, r, r + d], 1).ravel())
        vv.append(np.tile([1.0, -2.0, 1.0], m_) / h ** 2)
        k += m_
    Lo = sp.csr_matrix((np.concatenate(vv), (np.concatenate(rr), np.concatenate(cc))), shape=(k, N))
    bpts = [loop] + [np.asarray(q, float) for q in holes] + [np.asarray(q, float) for q in inner]
    if base is not None and center is not None:
        bpts.append(np.asarray(center, float))
    BP = np.vstack(bpts)
    Bm = _bilinear(to_uv(BP), u0, v0, h, nx, ny)
    bw = (BP - c) @ n
    Bg = np.zeros(N)
    if base is not None:
        X0 = c + G[:, :1] * e1 + G[:, 1:] * e2
        t = np.zeros(N)
        for _ in range(8):
            r, Gr = base.g(X0 + t[:, None] * n)
            t -= r / np.where(np.abs(Gr @ n) > 1e-6, Gr @ n, 1.0)
        Bg = t
        bw = bw - Bm @ Bg
    wb = 30.0 / h ** 2
    wo = 0.03
    A = sp.vstack([Li, wo * Lo, wb * Bm]).tocsr()
    rhs_b = np.concatenate([np.zeros(Li.shape[0]), np.zeros(Lo.shape[0]), wb * bw])
    ins_rows_v = G[rows_in, 1]
    vn = (ins_rows_v - ins_rows_v.mean()) / max(np.ptp(ins_rows_v), 1e-9)
    basis = [np.ones(len(rows_in))] if base is None else []
    if sym and center is not None and base is None:
        basis += [vn, vn ** 2]
    R = [rhs_b]
    for bk in basis:
        R.append(np.concatenate([bk, wo * np.ones(Lo.shape[0]) * bk.mean() * 0.5, np.zeros(len(bw))]))
    AT = A.T.tocsr()
    M = (AT @ A + sp.identity(N) * (1e-10 / h ** 4)).tocsc()
    lu = sla.splu(M)
    sols = [lu.solve(AT @ r) for r in R]
    f0, gk = sols[0], sols[1:]
    if base is not None:
        kap = np.array([])
    elif sym and center is not None:
        C = np.asarray(center, float)
        Cm = _bilinear(to_uv(C), u0, v0, h, nx, ny)
        cw = (C - c) @ n
        Am = np.stack([Cm @ g for g in gk], 1)
        kap, *_ = np.linalg.lstsq(Am, cw - Cm @ f0, rcond=None)
    elif crown:
        dist = np.full(N, np.inf)
        from scipy.spatial import cKDTree
        tr = cKDTree(np.vstack([luv] + huv))
        dd, _ = tr.query(G[rows_in])
        p = rows_in[np.argmax(dd)]
        kap = np.array([crown / gk[0][p]]) if abs(gk[0][p]) > 1e-12 else np.array([0.0])
    else:
        kap = np.array([0.0] * len(gk))
    f = f0 + sum(k * g for k, g in zip(kap, gk)) + Bg
    F = f.reshape(ny, nx)
    if sym:
        F = 0.5 * (F + F[:, ::-1])
    gy, gx = np.gradient(F, h)
    slope = np.hypot(gx, gy).ravel()[inside]
    if slope.max() > max_slope:
        return None
    err = np.abs(Bm @ F.ravel() - (BP - c) @ n).max()
    return {'c': c, 'e1': e1, 'e2': e2, 'n': n, 'u0': u0, 'v0': v0, 'h': h, 'F': F, 'inside': inside.reshape(ny, nx),
            'err': err, 'kappa': kap, 'slope': float(slope.max())}


def curvature(S):
    F, h = S['F'], S['h']
    fy, fx = np.gradient(F, h)
    fyy, fyx = np.gradient(fy, h)
    fxy, fxx = np.gradient(fx, h)
    g = 1 + fx ** 2 + fy ** 2
    H = ((1 + fx ** 2) * fyy - 2 * fx * fy * fxy + (1 + fy ** 2) * fxx) / (2 * g ** 1.5)
    K = (fxx * fyy - fxy ** 2) / g ** 2
    d = np.sqrt(np.maximum(H ** 2 - K, 0))
    return H - d, H + d


def occ_surface(S, step=1, tol=2e-5):
    from OCP.collections import Array2_double as TColStd_Array2OfReal
    from OCP.GeomAPI import GeomAPI_PointsToBSplineSurface
    from OCP.GeomAbs import GeomAbs_C2
    from OCP.gp import gp_Trsf, gp_Ax3, gp_Pnt, gp_Dir
    F = S['F']
    ny, nx = F.shape
    iy = np.arange(0, ny, step)
    ix = np.arange(0, nx, step)
    Z = TColStd_Array2OfReal(1, len(ix), 1, len(iy))
    for a, i in enumerate(ix):
        for b, j in enumerate(iy):
            Z.SetValue(a + 1, b + 1, float(F[j, i]))
    fit = GeomAPI_PointsToBSplineSurface()
    hs = S['h'] * step
    fit.Interpolate(Z, float(S['u0']), hs, float(S['v0']), hs)
    surf = fit.Surface()
    c, n, e1 = S['c'], S['n'], S['e1']
    ax = gp_Ax3(gp_Pnt(*map(float, c)), gp_Dir(*map(float, n)), gp_Dir(*map(float, e1)))
    tr = gp_Trsf()
    tr.SetTransformation(ax)
    surf.Transform(tr.Inverted())
    return surf


def occ_surface_lsq(S, sym=False, cells=6, deg=3):
    """Least squares B-spline of the height grid on a coarse uniform knot net, with a C0 knot line on the centerline
    of symmetric facets so a crease there stays sharp."""
    from scipy.interpolate import BSpline
    from OCP.Geom import Geom_BSplineSurface
    from OCP.collections import Array2_gp_Pnt, Array1_double, Array1_int
    from OCP.gp import gp_Pnt
    F, h = S['F'], S['h']
    ny, nx = F.shape
    gu = S['u0'] + h * np.arange(nx)
    gv = S['v0'] + h * np.arange(ny)
    def knots(a, b, mid):
        if mid is None:
            k = max(1, int(round((b - a) / (cells * h))))
            inner = list(np.linspace(a, b, k + 1)[1:-1])
            mult = [1] * len(inner)
        else:
            kl = max(1, int(round((mid - a) / (cells * h))))
            kr = max(1, int(round((b - mid) / (cells * h))))
            il = list(np.linspace(a, mid, kl + 1)[1:-1])
            ir = list(np.linspace(mid, b, kr + 1)[1:-1])
            inner = il + [mid] + ir
            mult = [1] * len(il) + [deg] + [1] * len(ir)
        full = [a] * (deg + 1) + [x for x, m in zip(inner, mult) for _ in range(m)] + [b] * (deg + 1)
        return np.array(full), [a] + inner + [b], [deg + 1] + mult + [deg + 1]
    tu, uk, um = knots(gu[0], gu[-1], 0.0 if sym and gu[0] < 0 < gu[-1] else None)
    tv, vk, vm = knots(gv[0], gv[-1], None)
    Bu = BSpline.design_matrix(np.clip(gu, gu[0], gu[-1] - 1e-12), tu, deg).toarray()
    Bv = BSpline.design_matrix(np.clip(gv, gv[0], gv[-1] - 1e-12), tv, deg).toarray()
    Bu[-1] = 0
    Bu[-1, -1] = 1
    Bv[-1] = 0
    Bv[-1, -1] = 1
    lam = 1e-9
    Au = np.linalg.solve(Bu.T @ Bu + lam * np.eye(Bu.shape[1]), Bu.T)
    Av = np.linalg.solve(Bv.T @ Bv + lam * np.eye(Bv.shape[1]), Bv.T)
    C = Au @ F.T @ Av.T
    cu = (tu[1:deg + 1 + len(tu) - 2 * deg - 1][:0])
    gre_u = np.array([tu[i + 1:i + deg + 1].mean() for i in range(Bu.shape[1])])
    gre_v = np.array([tv[i + 1:i + deg + 1].mean() for i in range(Bv.shape[1])])
    c, e1, e2, n = S['c'], S['e1'], S['e2'], S['n']
    poles = Array2_gp_Pnt(1, len(gre_u), 1, len(gre_v))
    for i, uu in enumerate(gre_u):
        for j, vv in enumerate(gre_v):
            P = c + uu * e1 + vv * e2 + C[i, j] * n
            poles.SetValue(i + 1, j + 1, gp_Pnt(*map(float, P)))
    def arr(vals, cls):
        a = cls(1, len(vals))
        for i, x in enumerate(vals):
            a.SetValue(i + 1, x)
        return a
    surf = Geom_BSplineSurface(poles, arr([float(x) for x in uk], Array1_double), arr([float(x) for x in vk], Array1_double),
                               arr([int(x) for x in um], Array1_int), arr([int(x) for x in vm], Array1_int), deg, deg)
    return surf


def plate(loop, holes=(), center=None, inner=(), crown=0.0, hint=None, sym=False, n_cells=200, max_slope=2.75):
    """Thin plate graph through the boundary curves: minimum bending energy under a uniform pressure load, the load
    set by the facet's crown or fitted to its centerline. Symmetric facets are two plates meeting at the centerline."""
    loop = np.asarray(loop, float)
    allp = np.vstack([loop] + [np.asarray(q, float) for q in holes])
    c = allp.mean(0)
    if sym:
        c[0] = 0.0
    X = allp - c
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
    e2 = np.cross(n, e1)
    to_uv = lambda P: np.stack([(P - c) @ e1, (P - c) @ e2], 1)
    luv = to_uv(loop)
    if not _simple(luv):
        return None
    huv = [to_uv(np.asarray(q, float)) for q in holes]
    span = (luv.max(0) - luv.min(0)).max()
    h = span / n_cells
    m = 4 * h
    if sym:
        U = np.abs(luv[:, 0]).max() + m
        nxh = int(np.ceil(U / h))
        u0 = -nxh * h
        nx = 2 * nxh + 1
    else:
        u0 = luv[:, 0].min() - m
        nx = int(np.ceil((luv[:, 0].max() + m - u0) / h)) + 1
    v0 = luv[:, 1].min() - m
    ny = int(np.ceil((luv[:, 1].max() + m - v0) / h)) + 1
    GU, GV = np.meshgrid(u0 + h * np.arange(nx), v0 + h * np.arange(ny))
    G = np.stack([GU.ravel(), GV.ravel()], 1)
    inside = Path(luv).contains_points(G)
    for q in huv:
        inside &= ~Path(q).contains_points(G)
    from scipy.ndimage import binary_dilation
    ins2 = inside.reshape(ny, nx)
    near = binary_dilation(ins2, iterations=2)
    N = nx * ny
    ci = nxh if sym else -10
    rows, cols, vals, wts = [], [], [], []
    k = 0
    J, I = np.meshgrid(np.arange(ny), np.arange(nx), indexing='ij')
    J, I = J.ravel(), I.ravel()
    def add(st, ok):
        nonlocal k
        jj, ii = J[ok], I[ok]
        w = np.where(near[jj, ii], 1.0, 1e-2)
        for (dj, di, cf) in st:
            rows.append(np.arange(k, k + len(jj)))
            cols.append((jj + dj) * nx + ii + di)
            vals.append(np.full(len(jj), cf) * w / h ** 2)
        k += len(jj)
    side = lambda i0, i1: ~((I + i0 < ci) & (I + i1 > ci)) if sym else np.ones(N, bool)
    okx = (I >= 1) & (I <= nx - 2) & side(-1, 1)
    oky = (J >= 1) & (J <= ny - 2)
    add([(0, -1, 1.0), (0, 0, -2.0), (0, 1, 1.0)], okx)
    add([(-1, 0, 1.0), (0, 0, -2.0), (1, 0, 1.0)], oky)
    okxy = (I <= nx - 2) & (J <= ny - 2) & side(0, 1)
    r2 = np.sqrt(2.0)
    add([(0, 0, r2), (0, 1, -r2), (1, 0, -r2), (1, 1, r2)], okxy)
    E = sp.csr_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(k, N))
    bpts = [loop] + [np.asarray(q, float) for q in holes] + [np.asarray(q, float) for q in inner]
    if center is not None:
        bpts.append(np.asarray(center, float))
    BP = np.vstack(bpts)
    Bm = _bilinear(to_uv(BP), u0, v0, h, nx, ny)
    bw = (BP - c) @ n
    wb = 300.0 / h ** 2
    M = (E.T @ E + wb ** 2 * (Bm.T @ Bm) + sp.identity(N) * 1e-8 / h ** 4).tocsc()
    lu = sla.splu(M)
    f0 = lu.solve(wb ** 2 * (Bm.T @ bw))
    load = inside.astype(float) / h ** 2
    g1 = lu.solve(load)
    kap = 0.0
    if crown and center is None:
        from scipy.spatial import cKDTree
        dd, _ = cKDTree(np.vstack([luv] + huv)).query(G[inside])
        p = np.nonzero(inside)[0][np.argmax(dd)]
        kap = crown / g1[p] if abs(g1[p]) > 1e-15 else 0.0
    f = f0 + kap * g1
    F = f.reshape(ny, nx)
    if sym:
        F = 0.5 * (F + F[:, ::-1])
    gy, gx = np.gradient(F, h)
    slope = np.hypot(gx, gy).ravel()[inside]
    if slope.max() > max_slope:
        return None
    err = np.abs(Bm @ F.ravel() - bw).max()
    return {'c': c, 'e1': e1, 'e2': e2, 'n': n, 'u0': u0, 'v0': v0, 'h': h, 'F': F, 'inside': ins2,
            'err': err, 'kappa': np.array([kap]), 'slope': float(slope.max())}


def occ_surface_fit(S, bpts, sym=False, cells=3, deg=3, wb=60.0, smooth=1e-4):
    """Smooth B-spline on a coarse knot net fitted to the height grid inside the facet and, with a heavy weight, to the
    boundary samples, so the face is fair and still lies on its edges; C0 knot line on the centerline when sym."""
    from scipy.interpolate import BSpline
    from OCP.Geom import Geom_BSplineSurface
    from OCP.collections import Array2_gp_Pnt, Array1_double, Array1_int
    from OCP.gp import gp_Pnt
    F, h = S['F'], S['h']
    ny, nx = F.shape
    c, e1, e2, n = S['c'], S['e1'], S['e2'], S['n']
    ua, ub = S['u0'], S['u0'] + h * (nx - 1)
    va, vb = S['v0'], S['v0'] + h * (ny - 1)
    def knots(a, b, mid):
        segs = [(a, b)] if mid is None else [(a, mid), (mid, b)]
        inner, mult = [], []
        for k, (x0, x1) in enumerate(segs):
            m = max(1, int(round((x1 - x0) / (cells * h))))
            pts = list(np.linspace(x0, x1, m + 1)[1:-1])
            inner += pts
            mult += [1] * len(pts)
            if k == 0 and len(segs) == 2:
                inner.append(mid)
                mult.append(deg)
        t = np.array([a] * (deg + 1) + [x for x, mm in zip(inner, mult) for _ in range(mm)] + [b] * (deg + 1))
        return t, [a] + inner + [b], [deg + 1] + mult + [deg + 1]
    tu, uk, um = knots(ua, ub, 0.0 if sym and ua < 0 < ub else None)
    tv, vk, vm = knots(va, vb, None)
    nu, nv = len(tu) - deg - 1, len(tv) - deg - 1
    def design(u, v):
        Bu = BSpline.design_matrix(np.clip(u, ua, ub - 1e-12), tu, deg).tocsr()
        Bv = BSpline.design_matrix(np.clip(v, va, vb - 1e-12), tv, deg).tocsr()
        rows, cols, vals = [], [], []
        for i in range(len(u)):
            su, eu = Bu.indptr[i], Bu.indptr[i + 1]
            sv, ev = Bv.indptr[i], Bv.indptr[i + 1]
            iu, xu = Bu.indices[su:eu], Bu.data[su:eu]
            iv, xv = Bv.indices[sv:ev], Bv.data[sv:ev]
            cc = (iu[:, None] * nv + iv[None, :]).ravel()
            rows.append(np.full(len(cc), i))
            cols.append(cc)
            vals.append((xu[:, None] * xv[None, :]).ravel())
        return sp.csr_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(len(u), nu * nv))
    GU, GV = np.meshgrid(ua + h * np.arange(nx), va + h * np.arange(ny))
    from scipy.ndimage import binary_dilation
    near = binary_dilation(S['inside'], iterations=3).ravel()
    wg = np.where(near, 1.0, 0.05)
    Ag = design(GU.ravel(), GV.ravel())
    BP = np.asarray(bpts, float)
    bu, bv = (BP - c) @ e1, (BP - c) @ e2
    Ab = design(bu, bv)
    bw = (BP - c) @ n
    D1 = sp.diags([1, -2, 1], [0, 1, 2], shape=(nu - 2, nu))
    D2 = sp.diags([1, -2, 1], [0, 1, 2], shape=(nv - 2, nv))
    R = sp.vstack([sp.kron(D1, sp.identity(nv)), sp.kron(sp.identity(nu), D2)])
    Wg = sp.diags(wg)
    M = Ag.T @ Wg @ Ag + wb ** 2 * (Ab.T @ Ab) + smooth * (R.T @ R) * (len(GU.ravel()) / (nu * nv))
    rhs = Ag.T @ (wg * F.ravel()) + wb ** 2 * (Ab.T @ bw)
    C = sla.spsolve(M.tocsc(), rhs).reshape(nu, nv)
    gre_u = np.array([tu[i + 1:i + deg + 1].mean() for i in range(nu)])
    gre_v = np.array([tv[i + 1:i + deg + 1].mean() for i in range(nv)])
    poles = Array2_gp_Pnt(1, nu, 1, nv)
    for i, uu in enumerate(gre_u):
        for j, vv in enumerate(gre_v):
            P = c + uu * e1 + vv * e2 + C[i, j] * n
            poles.SetValue(i + 1, j + 1, gp_Pnt(*map(float, P)))
    def arr(vals, cls, cast):
        a = cls(1, len(vals))
        for i, x in enumerate(vals):
            a.SetValue(i + 1, cast(x))
        return a
    return Geom_BSplineSurface(poles, arr(uk, Array1_double, float), arr(vk, Array1_double, float),
                               arr(um, Array1_int, int), arr(vm, Array1_int, int), deg, deg)
