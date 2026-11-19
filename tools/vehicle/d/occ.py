"""B-rep surfacing with OpenCascade: network edges become B-spline edges, facets become plate filled faces
(BRepOffsetAPI_MakeFilling, C0 at creases, G1 across soft edges), the faces are sewn into one shell and
tessellated. Output meshes are in the film's coordinates, left half mirrored about X = 0."""
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
import os
G1 = bool(os.environ.get('OCC_G1'))
VERBOSE = bool(os.environ.get('OCC_VERBOSE'))


def _curve(P, tol=2e-5):
    a = Array1_gp_Pnt(1, len(P))
    for i, p in enumerate(P):
        a.SetValue(i + 1, gp_Pnt(*map(float, p)))
    return GeomAPI_PointsToBSpline(a, Approx_ChordLength, 3, 8, GeomAbs_C2, tol).Curve()


def _filling(edges, points=(), g1=(), free=()):
    f = BRepOffsetAPI_MakeFilling(3, 18, 3, False, 1e-5, 2e-5, 0.005, 0.1, 9, 12)
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
    fx = ShapeFix_Face(mf.Face())
    fx.Perform()
    fx.FixOrientation()
    return TopoDS.Face(fx.Face())


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
        return np.zeros((0, 3)), np.zeros((0, 3), int)
    tr = loc.Transformation()
    V = []
    for i in range(1, tri.NbNodes() + 1):
        p = tri.Node(i).Transformed(tr)
        V.append((p.X(), p.Y(), p.Z()))
    T = []
    for i in range(1, tri.NbTriangles() + 1):
        a, b, c = tri.Triangle(i).Get()
        T.append((a - 1, b - 1, c - 1))
    T = np.array(T, int)
    if face.Orientation() == TopAbs_REVERSED:
        T = T[:, [0, 2, 1]]
    return np.array(V), T


def build(half, deflection=float(os.environ.get("OCC_DEFL", 0.0003)), angle=float(os.environ.get("OCC_ANGLE", 0.1)), log=print):
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
        e = net.edges[name]
        ctrl = [net.resolve(c) for c in e['ctrl']]
        S = spline(ctrl, spacing=0.004)
        c = _curve(S)
        edges[name] = BRepBuilderAPI_MakeEdge(c, verts[e['ctrl'][0]], verts[e['ctrl'][-1]]).Edge()
        samples[name] = spline(ctrl, spacing=0.002)
    faces = {}
    owner = {}
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
        try:
            face, err = _filling(es, g1=g1, free=free)
            if f['crown']:
                c, n = _center(face, f['hint'])
                face, err = _filling(es, [c + f['crown'] * n], g1=g1, free=free)
            for h in hs:
                face = _cut(face, h)
        except Exception as ex:
            raise RuntimeError(f'facet {f["name"]}: {ex}')
        if err > 5e-4:
            log(f'warning: facet {f["name"]} boundary error {err * 1000:.2f} mm')
        faces[f['name']] = face
        for en in f['loop']:
            owner.setdefault(en, f['name'])
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
        V, T = _triangulate(face)
        if face.Orientation() != TopAbs_REVERSED:
            pass
        hint = finfo[name]['hint']
        if hint is not None and len(T):
            fn = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]]).sum(0)
            if fn @ np.asarray(hint, float) < 0:
                T = T[:, [0, 2, 1]]
        o = objs.setdefault(finfo[name]['obj'], {'V': [], 'T': [], 'mats': [], 'facet': [], 'n': 0})
        o['V'].append(V)
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
        T = T[(T[:, 0] != T[:, 1]) & (T[:, 1] != T[:, 2]) & (T[:, 0] != T[:, 2])]
        facet = np.array(o['facet'])[: len(T)] if False else o['facet']
        crease = _feature_edges(V, T, o['facet'], net, samples)
        out[oname] = {'V': V, 'T': T, 'mats': o['mats'], 'facet': o['facet'], 'crease': crease}
        log(f'{oname}: {len(out[oname]["V"])} verts {len(out[oname]["T"])} tris')
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
