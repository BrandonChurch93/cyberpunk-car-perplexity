"""Pressure surfaces: each facet is the graph over its best-fit plane of the solution of Poisson's equation
(uniform pressure, so a uniform mean curvature crown) taking the facet's boundary curves as Dirichlet data.
Centerline facets are solved symmetric, with the pressure fitted to the centerline profile."""
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


def solve(loop, holes=(), center=None, inner=(), crown=0.0, hint=None, sym=False, n_cells=220, max_slope=2.75, aniso=None):
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
    Li = lap(rows_in)
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
    BP = np.vstack(bpts)
    Bm = _bilinear(to_uv(BP), u0, v0, h, nx, ny)
    bw = (BP - c) @ n
    wb = 30.0 / h ** 2
    wo = 0.03
    A = sp.vstack([Li, wo * Lo, wb * Bm]).tocsr()
    rhs_b = np.concatenate([np.zeros(Li.shape[0]), np.zeros(Lo.shape[0]), wb * bw])
    ins_rows_v = G[rows_in, 1]
    vn = (ins_rows_v - ins_rows_v.mean()) / max(np.ptp(ins_rows_v), 1e-9)
    basis = [np.ones(len(rows_in))]
    if sym and center is not None:
        basis += [vn, vn ** 2]
    R = [rhs_b]
    for bk in basis:
        R.append(np.concatenate([bk, wo * np.ones(Lo.shape[0]) * bk.mean() * 0.5, np.zeros(len(bw))]))
    AT = A.T.tocsr()
    M = (AT @ A + sp.identity(N) * (1e-10 / h ** 4)).tocsc()
    lu = sla.splu(M)
    sols = [lu.solve(AT @ r) for r in R]
    f0, gk = sols[0], sols[1:]
    if sym and center is not None:
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
    f = f0 + sum(k * g for k, g in zip(kap, gk))
    F = f.reshape(ny, nx)
    if sym:
        F = 0.5 * (F + F[:, ::-1])
    gy, gx = np.gradient(F, h)
    slope = np.hypot(gx, gy).ravel()[inside]
    if slope.max() > max_slope:
        return None
    err = np.abs(Bm @ F.ravel() - bw).max()
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
