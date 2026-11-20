"""B-rep surfacing with OpenCascade: network edges become B-spline edges, facets become plate filled faces
(BRepOffsetAPI_MakeFilling, C0 at creases, G1 across soft edges), the faces are sewn into one shell and
tessellated. Output meshes are in the film's coordinates, left half mirrored about X = 0."""
import json
import math
import os
import numpy as np
from OCP.gp import gp_Pnt
from OCP.collections import Array1_gp_Pnt
from OCP.GeomAPI import GeomAPI_PointsToBSpline
from OCP.GeomAbs import GeomAbs_C0, GeomAbs_G1, GeomAbs_C2
from OCP.Approx import Approx_ChordLength
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeVertex, BRepBuilderAPI_Sewing
from OCP.BRepOffsetAPI import BRepOffsetAPI_MakeFilling
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRep import BRep_Tool
from OCP.BRepLProp import BRepLProp_SLProps
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCP.TopoDS import TopoDS
from OCP.TopLoc import TopLoc_Location
from OCP.ShapeAnalysis import ShapeAnalysis_Surface
from kernel_np import spline
G1 = bool(os.environ.get('OCC_G1'))
MVS = os.environ.get('OCC_MVS', '1') == '1'
POLY = os.environ.get('OCC_POLY', '0') == '1'
SKIN = os.environ.get('OCC_SKIN', 'poly')
BASE_DEG = int(os.environ.get('OCC_BASE_DEG', '2'))
RELAX = os.environ.get('OCC_RELAX', '1') == '1'
POLY_MOVE = os.environ.get('OCC_POLY_MOVE', '0') == '1'
POLY_SKIP = ()
VERBOSE = bool(os.environ.get('OCC_VERBOSE'))


CURVE = os.environ.get('OCC_CURVE', 'smooth')
FILL = [float(x) for x in os.environ.get('OCC_FILL', '3,18,3,1e-5,2e-5,0.005,0.1,9,12').split(',')]
CANDIDATES = [FILL] if os.environ.get('OCC_FILL') else [
    (3, 18, 3, 1e-5, 2e-5, 0.005, 0.1, 9, 12), (2, 12, 1, 1e-4, 5e-4, 0.02, 0.1, 6, 4), (2, 15, 2, 1e-5, 1e-4, 0.01, 0.1, 6, 4),
    (2, 20, 1, 1e-5, 1e-4, 0.01, 0.1, 8, 6), (3, 24, 2, 1e-5, 2e-4, 0.01, 0.1, 6, 2), (2, 30, 2, 1e-5, 1e-4, 0.01, 0.1, 6, 3)]


def _curve(P, tol=2e-5):
    a = Array1_gp_Pnt(1, len(P))
    for i, p in enumerate(P):
        a.SetValue(i + 1, gp_Pnt(*map(float, p)))
    if CURVE == 'smooth':
        w = [float(x) for x in os.environ.get('OCC_SMOOTH', '1e-6,1e-5,1e-7,3e-4').split(',')]
        c = GeomAPI_PointsToBSpline(a, w[0], w[1], w[2], 8, GeomAbs_C2, w[3]).Curve()
        c.SetPole(1, gp_Pnt(*map(float, P[0])))
        c.SetPole(c.NbPoles(), gp_Pnt(*map(float, P[-1])))
        return c
    return GeomAPI_PointsToBSpline(a, Approx_ChordLength, 3, 8, GeomAbs_C2, tol).Curve()


def _filling(edges, points=(), g1=(), free=(), params=None):
    d, np_, it, t2, t3, ta, tc, md, ms = params or FILL
    f = BRepOffsetAPI_MakeFilling(int(d), int(np_), int(it), False, t2, t3, ta, tc, int(md), int(ms))
    for e in free:
        f.Add(e, GeomAbs_C0, False)
    for e in edges:
        sup = g1.get(id(e)) if isinstance(g1, dict) else None
        if sup is not None:
            f.Add(e, sup, GeomAbs_G1)
        else:
            f.Add(e, GeomAbs_C0)
    for p in points:
        f.Add(gp_Pnt(*map(float, p)))
    f.Build()
    if not f.IsDone():
        raise RuntimeError('filling failed')
    return TopoDS.Face(f.Shape()), f.G0Error()


def _cut(face, hole_edges):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeWire, BRepBuilderAPI_MakeFace
    from OCP.ShapeFix import ShapeFix_Face
    w = BRepBuilderAPI_MakeWire()
    for e in hole_edges:
        w.Add(e)
    from OCP.ShapeFix import ShapeFix_Wire
    from OCP.BRepLib import BRepLib
    wire = w.Wire()
    sfw = ShapeFix_Wire(wire, face, 1e-4)
    sfw.FixEdgeCurves()
    sfw.Perform()
    wire = sfw.Wire()
    mf = BRepBuilderAPI_MakeFace(face)
    mf.Add(TopoDS.Wire(wire.Reversed()))
    import time
    t0 = time.time()
    fx = ShapeFix_Face(mf.Face())
    fx.Perform()
    if VERBOSE:
        print('fix', f['name'], round(time.time() - t0, 2), flush=True)
    fx.FixOrientation()
    return TopoDS.Face(fx.Face())


_ANISO = None


def _aniso(name):
    global _ANISO
    if _ANISO is None:
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'aniso.json')
        _ANISO = json.load(open(p)) if os.path.exists(p) and os.environ.get('ANISO', '1') == '1' else {}
    if name.endswith('.R') and name[:-2] in _ANISO:
        v = _ANISO[name[:-2]]
        return None if v is None else (math.radians((180 - v[0]) % 180), v[1])
    v = _ANISO.get(name)
    return None if v is None else (math.radians(v[0]), v[1])


def _poly_face(f, p, es, samples):
    import fit
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeWire, BRepBuilderAPI_MakeFace
    from OCP.ShapeFix import ShapeFix_Face
    loop = np.vstack([samples[e] for e in f['loop']])
    surf = fit.occ_surface(p, loop)
    w = BRepBuilderAPI_MakeWire()
    for e in es:
        w.Add(e)
    fx = ShapeFix_Face(BRepBuilderAPI_MakeFace(surf, w.Wire(), True).Face())
    fx.Perform()
    fx.FixOrientation()
    face = TopoDS.Face(fx.Face())
    P = np.vstack([loop] + [samples[e] for h in f['holes'] for e in h] + [samples[e] for e in f.get('inner', ())])
    err = float(np.abs(p.g(P)[0]).max())
    return face, err, 0.0


def _pressure(f, es, samples, edges):
    import mvs
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeWire, BRepBuilderAPI_MakeFace
    from OCP.ShapeFix import ShapeFix_Face
    from OCP.GeomAPI import GeomAPI_ProjectPointOnSurf
    loop = mvs.chain([samples[e] for e in f['loop']])
    holes = [mvs.chain([samples[e] for e in h]) for h in f['holes']]
    inner = [samples[e] for e in f.get('inner', ())]
    cen = [p for p in inner if np.abs(p[:, 0]).max() < 1e-6]
    oth = [p for p in inner if np.abs(p[:, 0]).max() >= 1e-6]
    if SKIN == 'plate':
        R = mvs.plate(loop, holes, np.vstack(cen) if cen else None, oth, f['crown'], f['hint'], sym=bool(cen))
        if R is None:
            return None
        surf = mvs.occ_surface_fit(R, np.vstack([loop] + holes + oth + ([np.vstack(cen)] if cen else [])), sym=bool(cen))
        return _pressure_face(f, es, surf, R, loop, holes, oth, cen)
    an = _aniso(f['name'])
    base = None
    if SKIN == 'poly':
        import fit
        P = np.vstack([loop] + holes + inner)
        r = fit.fit(P, np.ones(len(P)), bool(cen), f['hint'], degrees=(BASE_DEG,))
        if r is not None:
            base, an = r[2], None
    R = None
    for cells in (220, 340):
        R = mvs.solve(loop, holes, np.vstack(cen) if cen else None, oth, f['crown'], f['hint'], sym=bool(cen), n_cells=cells, aniso=an, base=base)
        if R is None or R['err'] <= 1.5e-4:
            break
    if R is None:
        return None
    if base is not None:
        surf = mvs.occ_surface_fit(R, np.vstack([loop] + holes + oth + ([np.vstack(cen)] if cen else [])), sym=bool(cen))
    else:
        surf = mvs.occ_surface(R)
    return _pressure_face(f, es, surf, R, loop, holes, oth, cen)


def _pressure_face(f, es, surf, R, loop, holes, oth, cen):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeWire, BRepBuilderAPI_MakeFace
    from OCP.ShapeFix import ShapeFix_Face
    w = BRepBuilderAPI_MakeWire()
    for e in es:
        w.Add(e)
    mf = BRepBuilderAPI_MakeFace(surf, w.Wire(), True)
    import time
    t0 = time.time()
    fx = ShapeFix_Face(mf.Face())
    fx.Perform()
    if VERBOSE:
        print('fix', f['name'], round(time.time() - t0, 2), flush=True)
    fx.FixOrientation()
    face = TopoDS.Face(fx.Face())
    c, e1, e2, n = R['c'], R['e1'], R['e2'], R['n']
    def dev(P):
        P = np.asarray(P, float)[::4]
        uv = np.stack([(P - c) @ e1, (P - c) @ e2], 1)
        d = 0.0
        for (u, v), p in zip(uv, P):
            q = surf.Value(float(u), float(v))
            d = max(d, abs((np.array([q.X(), q.Y(), q.Z()]) - p) @ n))
        return d
    err = dev(np.vstack([loop] + holes + oth))
    cerr = dev(np.vstack(cen)) if cen else 0.0
    return face, err, cerr


def _center(face, hint):
    ad = BRepAdaptor_Surface(face)
    u = 0.5 * (ad.FirstUParameter() + ad.LastUParameter())
    v = 0.5 * (ad.FirstVParameter() + ad.LastVParameter())
    pr = BRepLProp_SLProps(ad, u, v, 1, 1e-7)
    p = pr.Value()
    n = pr.Normal()
    n = np.array([n.X(), n.Y(), n.Z()])
    if hint is not None and n @ np.asarray(hint, float) < 0:
        n = -n
    if face.Orientation() == TopAbs_REVERSED:
        pass
    return np.array([p.X(), p.Y(), p.Z()]), n


def _triangulate(face):
    loc = TopLoc_Location()
    tri = BRep_Tool.Triangulation_s(face, loc)
    if tri is None:
        return np.zeros((0, 3)), np.zeros((0, 3), int), np.zeros((0, 3))
    tr = loc.Transformation()
    ad = BRepAdaptor_Surface(face)
    pr = BRepLProp_SLProps(ad, 1, 1e-7)
    V, N = [], []
    for i in range(1, tri.NbNodes() + 1):
        p = tri.Node(i).Transformed(tr)
        V.append((p.X(), p.Y(), p.Z()))
        uv = tri.UVNode(i)
        pr.SetParameters(uv.X(), uv.Y())
        if pr.IsNormalDefined():
            n = pr.Normal()
            N.append((n.X(), n.Y(), n.Z()))
        else:
            N.append((0.0, 0.0, 0.0))
    T = []
    for i in range(1, tri.NbTriangles() + 1):
        a, b, c = tri.Triangle(i).Get()
        T.append((a - 1, b - 1, c - 1))
    T = np.array(T, int)
    if face.Orientation() == TopAbs_REVERSED:
        T = T[:, [0, 2, 1]]
    return np.array(V), T, np.array(N)


def _orient_normals(V, T, N):
    fn = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
    vn = np.zeros_like(V)
    for k in range(3):
        np.add.at(vn, T[:, k], fn)
    bad = np.linalg.norm(N, axis=1) < 0.5
    N = N.copy()
    N[bad] = vn[bad]
    s = np.sign((N * vn).sum(1))
    s[s == 0] = 1
    N = N * s[:, None]
    return N / np.maximum(np.linalg.norm(N, axis=1), 1e-12)[:, None]


def build(half, deflection=float(os.environ.get("OCC_DEFL", 0.0003)), angle=float(os.environ.get("OCC_ANGLE", 0.1)), log=print, faces_only=False):
    from net import full
    net = full(half)
    verts = {n: BRepBuilderAPI_MakeVertex(gp_Pnt(*map(float, p))).Vertex() for n, p in net.points.items()}
    used = set()
    for f in net.facets:
        used.update(f['loop'])
        used.update(f.get('inner', ()))
        for h in f['holes']:
            used.update(h)
    edges, samples = {}, {}
    for name in used:
        samples[name] = spline([net.resolve(c) for c in net.edges[name]['ctrl']], spacing=0.002)
    polys = {}
    if RELAX:
        import fit
        samples = fit.relax(net, samples, deg=BASE_DEG, dmax=float(os.environ.get('RELAX_MAX', 0.008)), log=log)
    if POLY_MOVE:
        import fit
        samples, vpos, polys, rep, shift = fit.move(net, samples, skip=POLY_SKIP)
        verts = {n: BRepBuilderAPI_MakeVertex(gp_Pnt(*map(float, vpos.get(n, p)))).Vertex() for n, p in net.points.items()}
        kept = [n for n, r in rep.items() if r == 'kept']
        if kept:
            log('poly kept as boundary filled: ' + ', '.join(kept))
        big = sorted(((v[0], e) for e, v in shift.items() if v[0] > 3e-3), reverse=True)
        if big:
            log('edges moved over 3 mm: ' + ', '.join(f'{e} {d * 1000:.1f}' for d, e in big[:12]))
        if VERBOSE:
            for n, r in rep.items():
                print('poly', n, r, flush=True)
    for name in used:
        e = net.edges[name]
        S = samples[name]
        c = _curve(np.vstack([S[:-1:2], S[-1:]]) if len(S) > 8 else S)
        edges[name] = BRepBuilderAPI_MakeEdge(c, verts[e['ctrl'][0]], verts[e['ctrl'][-1]]).Edge()
    faces = {}
    owner = {}
    chosen = {}
    for f in net.facets:
        g1 = {}
        for en in f['loop']:
            if G1 and net.edges[en]['kind'] == 'soft' and en in owner:
                g1[id(edges[en])] = faces[owner[en]]
        if VERBOSE:
            print('facet', f['name'], flush=True)
        es = [edges[en] for en in f['loop']]
        hs = [[edges[en] for en in h] for h in f['holes']]
        free = [e for h in hs for e in h] if f.get('through', True) else []
        free += [edges[en] for en in f.get('inner', ())]
        pf = None
        if f['name'] in polys:
            try:
                pf = _poly_face(f, polys[f['name']], es, samples)
            except Exception as ex:
                log(f'poly {f["name"]}: {ex}')
                pf = None
        if pf is None and MVS and not f.get('plate'):
            try:
                pf = _pressure(f, es, samples, edges)
            except Exception as ex:
                log(f'pressure {f["name"]}: {ex}')
                pf = None
            if pf is not None and pf[1] > (6e-4 if SKIN in ('plate', 'poly') else 2e-4):
                log(f'pressure {f["name"]}: boundary error {pf[1] * 1000:.2f} mm, plate used')
                pf = None
        if pf is not None:
            face, err, cerr = pf
            if f['name'] in polys and err > 5e-4:
                log(f'poly {f["name"]}: edges off the surface by {err * 1000:.2f} mm')
            if cerr > 3e-3:
                log(f'pressure {f["name"]}: centerline off by {cerr * 1000:.1f} mm')
            if VERBOSE:
                print('pressure', f['name'], f'{err * 1000:.3f} mm', flush=True)
            for h in hs:
                face = _cut(face, h)
            faces[f['name']] = face
            for en in f['loop']:
                owner.setdefault(en, f['name'])
            continue
        try:
            base = f['name'][:-2] if f['name'].endswith('.R') else f['name']
            cands = [chosen[base]] if base in chosen else CANDIDATES
            best = None
            for prm in cands:
                try:
                    face, err = _filling(es, g1=g1, free=free, params=prm)
                    if f['crown']:
                        c, n = _center(face, f['hint'])
                        face, err = _filling(es, [c + f['crown'] * n], g1=g1, free=free, params=prm)
                except Exception:
                    continue
                if len(cands) == 1:
                    best = (0, face, err, prm)
                    break
                from fair import face_stats
                k = face_stats(face, 14)[1]
                score = k * (1 + max(0.0, err - 2e-4) / 1e-4)
                if best is None or score < best[0]:
                    best = (score, face, err, prm)
            if best is None:
                raise RuntimeError('filling failed for every parameter set')
            _, face, err, chosen[base] = best
            for h in hs:
                face = _cut(face, h)
        except Exception as ex:
            raise RuntimeError(f'facet {f["name"]}: {ex}')
        if err > 5e-4:
            log(f'warning: facet {f["name"]} boundary error {err * 1000:.2f} mm')
        faces[f['name']] = face
        for en in f['loop']:
            owner.setdefault(en, f['name'])
    if faces_only:
        return faces
    sew = BRepBuilderAPI_Sewing(1e-4)
    for face in faces.values():
        sew.Add(face)
    sew.Perform()
    shell = sew.SewedShape()
    BRepMesh_IncrementalMesh(shell, deflection, False, angle, True)
    sewn = {}
    for name, face in faces.items():
        m = sew.Modified(face)
        sewn[name] = TopoDS.Face(m) if not m.IsNull() else face
    return _assemble(net, sewn, samples, log)


def _assemble(net, sewn, samples, log):
    finfo = {f['name']: f for f in net.facets}
    objs = {}
    for name, face in sewn.items():
        V, T, N = _triangulate(face)
        hint = finfo[name]['hint']
        if hint is not None and len(T):
            fn = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]]).sum(0)
            if fn @ np.asarray(hint, float) < 0:
                T = T[:, [0, 2, 1]]
        if len(T):
            N = _orient_normals(V, T, N)
        o = objs.setdefault(finfo[name]['obj'], {'V': [], 'T': [], 'N': [], 'mats': [], 'facet': [], 'n': 0})
        o['V'].append(V)
        o['N'].append(N[T] if len(T) else np.zeros((0, 3, 3)))
        o['T'].append(T + o['n'])
        o['n'] += len(V)
        o['mats'] += [finfo[name]['mat']] * len(T)
        o['facet'] += [name] * len(T)
    out = {}
    for oname, o in objs.items():
        V = np.vstack(o['V'])
        T = np.vstack(o['T'])
        V[np.abs(V[:, 0]) < 2e-5, 0] = 0.0
        key = np.round(V / 2e-6).astype(np.int64)
        _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
        V = V[first]
        T = inv.ravel()[T]
        CN = np.vstack(o['N'])
        keep = (T[:, 0] != T[:, 1]) & (T[:, 1] != T[:, 2]) & (T[:, 0] != T[:, 2])
        T, CN = T[keep], CN[keep]
        facets = [f for f, k in zip(o['facet'], keep) if k]
        mats = [m for m, k in zip(o['mats'], keep) if k]
        crease = _feature_edges(V, T, facets, net, samples)
        CN = _soft_normals(V, T, CN, crease)
        out[oname] = {'V': V, 'T': T, 'N': CN, 'mats': mats, 'facet': facets, 'crease': crease}
        log(f'{oname}: {len(out[oname]["V"])} verts {len(out[oname]["T"])} tris')
    return out


def _soft_normals(V, T, CN, crease):
    """Corner normals from the exact surfaces, averaged across faces except at crease vertices."""
    hard = np.zeros(len(V), bool)
    for a, b in crease:
        hard[a] = hard[b] = True
    acc = np.zeros_like(V)
    for k in range(3):
        np.add.at(acc, T[:, k], CN[:, k])
    acc /= np.maximum(np.linalg.norm(acc, axis=1), 1e-12)[:, None]
    out = CN.copy()
    for k in range(3):
        soft = ~hard[T[:, k]]
        out[soft, k] = acc[T[soft, k]]
    return out


def _feature_edges(V, T, facet, net, samples):
    fid = {n: i for i, n in enumerate(sorted(set(facet)))}
    tf = np.array([fid[n] for n in facet])
    E = np.vstack([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
    tri = np.tile(np.arange(len(T)), 3)
    E = np.sort(E, 1)
    order = np.lexsort((E[:, 1], E[:, 0]))
    E, tri = E[order], tri[order]
    same = (E[1:] == E[:-1]).all(1)
    idx = np.nonzero(same)[0]
    pairs = E[idx]
    diff = tf[tri[idx]] != tf[tri[idx + 1]]
    pairs = pairs[diff]
    names = [n for n, e in net.edges.items() if e['kind'] == 'crease' and n in samples]
    if not len(pairs) or not names:
        return []
    from scipy.spatial import cKDTree
    pts = np.vstack([samples[n] for n in names])
    tree = cKDTree(pts)
    mid = 0.5 * (V[pairs[:, 0]] + V[pairs[:, 1]])
    d, _ = tree.query(mid)
    return [tuple(p) for p in pairs[d < 0.002]]


def mirror(o):
    V, T, cr = o['V'], o['T'], o['crease']
    n = len(V)
    onc = np.abs(V[:, 0]) < 1e-9
    mid = np.where(onc, np.arange(n), np.arange(n) + n)
    Vm = V.copy()
    Vm[:, 0] *= -1
    V2 = np.vstack([V, Vm])
    T2 = np.vstack([T, mid[T][:, [0, 2, 1]]])
    cr2 = list(cr) + [(mid[a], mid[b]) for a, b in cr]
    used = np.unique(T2)
    remap = np.full(len(V2), -1)
    remap[used] = np.arange(len(used))
    return {'V': V2[used], 'T': remap[T2], 'mats': o['mats'] * 2, 'facet': o['facet'] + [f + '.R' for f in o['facet']],
            'crease': [(remap[a], remap[b]) for a, b in cr2]}
