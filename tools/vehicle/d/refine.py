"""Longest edge bisection (Rivara) of a tessellated B-rep: every new vertex is evaluated on the exact faces,
so flat panels get small triangles and their interpolated normals stay true to the surface."""
import numpy as np
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepLProp import BRepLProp_SLProps


class _Eval:
    def __init__(self, faces):
        self.pr = []
        self.ad = []
        for f in faces:
            ad = BRepAdaptor_Surface(f)
            self.ad.append(ad)
            self.pr.append(BRepLProp_SLProps(ad, 1, 1e-7))

    def __call__(self, k, uv):
        pr = self.pr[k]
        pr.SetParameters(float(uv[0]), float(uv[1]))
        p = pr.Value()
        n = pr.Normal() if pr.IsNormalDefined() else None
        return (p.X(), p.Y(), p.Z()), (None if n is None else (n.X(), n.Y(), n.Z()))


def refine(V, T, CN, CUV, TF, faces, lmax, log=print, tol=0.05, lmin=0.003, mask=None):
    """V (n,3), T (m,3), CN (m,3,3) corner normals, CUV (m,3,2) corner uv, TF (m,) face index into faces.
    An edge is split when longer than lmax, or longer than lmin with the exact normal at its midpoint more than
    tol degrees from the interpolated one."""
    ev = _Eval(faces)
    V = [tuple(v) for v in np.asarray(V, float)]
    T = [list(t) for t in np.asarray(T, int)]
    CN = [[tuple(c) for c in t] for t in np.asarray(CN, float)]
    CUV = [[tuple(c) for c in t] for t in np.asarray(CUV, float)]
    TF = [int(f) for f in TF]
    alive = [True] * len(T)
    emap = {}
    for i, t in enumerate(T):
        for k in range(3):
            e = (min(t[k], t[(k + 1) % 3]), max(t[k], t[(k + 1) % 3]))
            emap.setdefault(e, []).append(i)
    L2 = lmax * lmax
    Lmin2 = lmin * lmin
    ctol = np.cos(np.radians(tol))
    flag = {}

    def bad(i):
        t = T[i]
        for k in range(3):
            a, b = t[k], t[(k + 1) % 3]
            l2 = d2(a, b)
            if l2 > L2:
                return True
            if l2 <= Lmin2:
                continue
            e = (min(a, b), max(a, b))
            f = flag.get(e)
            if f is None:
                uv = tuple(0.5 * (CUV[i][k][c] + CUV[i][(k + 1) % 3][c]) for c in range(2))
                p, n = ev(TF[i], uv)
                m = np.add(CN[i][k], CN[i][(k + 1) % 3])
                mid = np.add(V[a], V[b]) * 0.5
                if n is None or np.linalg.norm(np.subtract(p, mid)) > 1e-3 + 0.02 * np.sqrt(l2):
                    f = False
                else:
                    f = abs(np.dot(n, m)) / max(np.linalg.norm(m), 1e-12) < ctol
                flag[e] = f
            if f:
                return True
        return False

    def d2(a, b):
        p, q = V[a], V[b]
        return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2

    def longest(i):
        t = T[i]
        best = None
        for k in range(3):
            a, b = t[k], t[(k + 1) % 3]
            key = (d2(a, b), min(a, b), max(a, b))
            if best is None or key > best[0]:
                best = (key, k)
        return best[1], best[0][0]

    def edge(i, k):
        t = T[i]
        a, b = t[k], t[(k + 1) % 3]
        return (min(a, b), max(a, b))

    def other(i, e):
        for j in emap.get(e, ()):
            if j != i and alive[j]:
                return j
        return None

    def split_edge(e):
        tris = [j for j in emap[e] if alive[j]]
        pts, nrm = [], []
        info = []
        for j in tris:
            t = T[j]
            ka = t.index(e[0])
            kb = t.index(e[1])
            uv = tuple(0.5 * (CUV[j][ka][c] + CUV[j][kb][c]) for c in range(2))
            p, n = ev(TF[j], uv)
            ref = np.add(CN[j][ka], CN[j][kb])
            mid = np.add(V[e[0]], V[e[1]]) * 0.5
            if np.linalg.norm(np.subtract(p, mid)) > 1e-3 + 0.02 * np.sqrt(d2(*e)):
                p, n = tuple(mid), None
            if n is None:
                n = tuple(ref / max(np.linalg.norm(ref), 1e-12))
            elif np.dot(n, ref) < 0:
                n = (-n[0], -n[1], -n[2])
            pts.append(p)
            info.append((j, uv, n))
        p = tuple(np.mean(pts, 0))
        if V[e[0]][0] == 0.0 and V[e[1]][0] == 0.0:
            p = (0.0, p[1], p[2])
        m = len(V)
        V.append(p)
        del emap[e]
        for j, uv, n in info:
            t, cn, cu = T[j], CN[j], CUV[j]
            alive[j] = False
            ka, kb = t.index(e[0]), t.index(e[1])
            for keep in (ka, kb):
                nt, nn, nu = list(t), list(cn), list(cu)
                drop = kb if keep == ka else ka
                nt[drop], nn[drop], nu[drop] = m, n, uv
                T.append(nt)
                CN.append(nn)
                CUV.append(nu)
                TF.append(TF[j])
                alive.append(True)
                i = len(T) - 1
                for k in range(3):
                    ee = edge(i, k)
                    lst = emap.setdefault(ee, [])
                    if ee != e:
                        lst[:] = [x for x in lst if x != j]
                        lst.append(i)
        return m

    sel = None if mask is None else {TF[i] for i in range(len(T)) if mask[i]}
    queue = [i for i in range(len(T)) if mask is None or mask[i]]
    qi = 0
    n0 = len(T)
    while qi < len(queue):
        if len(T) > 3000000: raise RuntimeError('refine runaway')
        i = queue[qi]
        qi += 1
        if not alive[i]:
            continue
        if not bad(i):
            continue
        cur = i
        guard = 0
        while True:
            k, _ = longest(cur)
            e = edge(cur, k)
            nb = other(cur, e)
            if nb is None or edge(nb, longest(nb)[0]) == e:
                break
            cur = nb
            guard += 1
            if guard > 200:
                break
        start = len(T)
        split_edge(e)
        queue.extend(j for j in range(start, len(T)) if mask is None or TF[j] in sel)
        if alive[i]:
            queue.append(i)
    keep = [j for j in range(len(T)) if alive[j]]
    log(f'refine {lmax * 1000:.0f} mm {tol} deg: {sum(alive[:n0])} of {n0} kept, {len(keep)} triangles')
    return (np.array(V), np.array([T[j] for j in keep], int), np.array([CN[j] for j in keep]),
            [TF[j] for j in keep])
