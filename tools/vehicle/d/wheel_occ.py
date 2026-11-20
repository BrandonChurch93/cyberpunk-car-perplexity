"""Wheel parts as OpenCascade solids: Y spoke face cut with drafted windows and chamfered, drilled disc, angular caliper.
Wheel frame: axial along +Z (outboard), radial in XY. mesh() returns per-corner arrays in the Blender wheel frame (axial, X, Y)."""
import math
import numpy as np
from OCP.gp import gp_Pnt, gp_Ax1, gp_Ax2, gp_Dir, gp_Vec, gp_Trsf
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire, BRepBuilderAPI_MakeFace, BRepBuilderAPI_Transform
from OCP.BRepPrimAPI import BRepPrimAPI_MakeRevol, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakePrism
from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepFilletAPI import BRepFilletAPI_MakeChamfer, BRepFilletAPI_MakeFillet
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepLProp import BRepLProp_SLProps
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_EDGE, TopAbs_REVERSED
from OCP.TopoDS import TopoDS, TopoDS_Compound
from OCP.BRep import BRep_Builder
from OCP.GeomAPI import GeomAPI_Interpolate
from OCP.collections import HArray1_gp_Pnt as TColgp_HArray1OfPnt
import occ


def _wire_poly(P3, closed=True):
    mk = BRepBuilderAPI_MakeWire()
    n = len(P3)
    for i in range(n if closed else n - 1):
        a, b = P3[i], P3[(i + 1) % n]
        mk.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(*map(float, a)), gp_Pnt(*map(float, b))).Edge())
    return mk.Wire()


def _wire_smooth(P3):
    arr = TColgp_HArray1OfPnt(1, len(P3))
    for i, p in enumerate(P3):
        arr.SetValue(i + 1, gp_Pnt(*map(float, p)))
    it = GeomAPI_Interpolate(arr, True, 1e-7)
    it.Perform()
    e = BRepBuilderAPI_MakeEdge(it.Curve()).Edge()
    return BRepBuilderAPI_MakeWire(e).Wire()


def _lines_x(p, u, q, v):
    m = np.array([u, -v]).T
    t = np.linalg.solve(m, q - p)
    return p + u * t[0]


def _circle_x(p, u, r):
    b = 2 * p.dot(u)
    c = p.dot(p) - r * r
    a = u.dot(u)
    t = (-b + math.sqrt(b * b - 4 * a * c)) / (2 * a)
    return p + u * t


def _side(p0, p1, h0, h1, sgn):
    d = p1 - p0
    d = d / np.linalg.norm(d)
    n = np.array([-d[1], d[0]]) * sgn
    a, b = p0 + n * h0, p1 + n * h1
    return a, (b - a) / np.linalg.norm(b - a)


def _offset(P, d):
    """Convex CCW polygon P offset inward by d (negative grows)."""
    n = len(P)
    lines = []
    for i in range(n):
        a, b = P[i], P[(i + 1) % n]
        u = (b - a) / np.linalg.norm(b - a)
        nn = np.array([-u[1], u[0]])
        lines.append((a + nn * d, u))
    out = []
    for i in range(n):
        (p, u), (q, v) = lines[i - 1], lines[i]
        if abs(u[0] * v[1] - u[1] * v[0]) < 1e-9:
            out.append(q)
        else:
            out.append(_lines_x(p, u, q, v))
    return np.array(out)


def _rounded(P, r, d, n=72):
    """Outline of convex P offset inward by d, with corner radius r, resampled to n points from a fixed start."""
    area = 0.5 * abs(np.sum(P[:, 0] * np.roll(P[:, 1], -1) - np.roll(P[:, 0], -1) * P[:, 1]))
    per = np.sum(np.linalg.norm(np.diff(np.r_[P, P[:1]], axis=0), axis=1))
    r = min(r, 0.45 * (2 * area / per - max(d, 0.0)))
    Q = _offset(P, d + r)
    m = len(Q)
    pts = []
    for i in range(m):
        a, b, c = Q[i - 1], Q[i], Q[(i + 1) % m]
        u0 = (b - a) / np.linalg.norm(b - a)
        u1 = (c - b) / np.linalg.norm(c - b)
        a0 = math.atan2(-u0[0], u0[1])
        a1 = math.atan2(-u1[0], u1[1])
        da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        k = max(1, int(abs(da) / 0.12))
        for t in np.linspace(0, 1, k + 1):
            ang = a0 + da * t
            pts.append(b + r * np.array([math.cos(ang), math.sin(ang)]))
    pts = np.array(pts)
    seg = np.linalg.norm(np.diff(np.r_[pts, pts[:1]], axis=0), axis=1)
    keep = np.r_[True, seg[:-1] > 1e-6]
    pts = pts[keep]
    cl = np.r_[0, np.cumsum(np.linalg.norm(np.diff(np.r_[pts, pts[:1]], axis=0), axis=1))]
    s = np.linspace(0, cl[-1], n, endpoint=False)
    loop = np.r_[pts, pts[:1]]
    return np.stack([np.interp(s, cl, loop[:, 0]), np.interp(s, cl, loop[:, 1])], 1)


def _ccw(P):
    P = np.asarray(P)
    a = 0.5 * np.sum(P[:, 0] * np.roll(P[:, 1], -1) - np.roll(P[:, 0], -1) * P[:, 1])
    return P if a > 0 else P[::-1]


def windows(rh=0.054, rs=0.115, rw=0.226, hs=0.0165, ha0=0.0135, ha1=0.0115, delta=math.radians(17), n=5, phase=math.pi / 2):
    """2D window polygons of a five-arm Y spoke: one between each pair of Ys and one inside each Y."""
    out = []
    rt = rw + 0.01
    pol = lambda r, a: np.array([r * math.cos(a), r * math.sin(a)])
    def arms(phi):
        S = pol(rs, phi)
        return S, pol(rt, phi + delta), pol(rt, phi - delta)
    for k in range(n):
        fa = phase + 2 * math.pi * k / n
        fb = fa + 2 * math.pi / n
        SA, TAp, TAm = arms(fa)
        SB, TBp, TBm = arms(fb)
        sA = _side(np.zeros(2), SA, hs, hs, 1)
        sB = _side(np.zeros(2), SB, hs, hs, -1)
        aA = _side(SA, TAp, ha0, ha1, 1)
        aB = _side(SB, TBm, ha0, ha1, -1)
        h1 = _circle_x(*sA, rh)
        s1 = _lines_x(*sA, *aA)
        r1 = _circle_x(*aA, rw)
        r2 = _circle_x(*aB, rw)
        s2 = _lines_x(*aB, *sB)
        h2 = _circle_x(*sB, rh)
        a1, a2 = math.atan2(r1[1], r1[0]), math.atan2(r2[1], r2[0])
        a2 = a1 + (a2 - a1) % (2 * math.pi)
        arc = [pol(rw, a) for a in np.linspace(a1, a2, 9)[1:-1]]
        out.append(_ccw([h1, s1, r1] + arc + [r2, s2, h2]))
        ip = _side(SA, TAp, ha0, ha1, -1)
        im = _side(SA, TAm, ha0, ha1, 1)
        t0 = _lines_x(*ip, *im)
        r3 = _circle_x(*ip, rw)
        r4 = _circle_x(*im, rw)
        a3, a4 = math.atan2(r4[1], r4[0]), math.atan2(r3[1], r3[0])
        a4 = a3 + (a4 - a3) % (2 * math.pi)
        arc = [pol(rw, a) for a in np.linspace(a3, a4, 7)[1:-1]]
        out.append(_ccw([t0, r4] + arc + [r3]))
    return out


def _compound(shapes):
    c = TopoDS_Compound()
    b = BRep_Builder()
    b.MakeCompound(c)
    for s in shapes:
        b.Add(c, s)
    return c


def _revolve(profile):
    """profile: (r, axial) closed polyline in the XZ plane, revolved about Z."""
    w = _wire_poly([(r, 0.0, a) for r, a in profile])
    f = BRepBuilderAPI_MakeFace(w).Face()
    return BRepPrimAPI_MakeRevol(f, gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1))).Shape()


def _faces(shape):
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        yield TopoDS.Face(ex.Current())
        ex.Next()


def _face_normal(face):
    ad = BRepAdaptor_Surface(face)
    u = 0.5 * (ad.FirstUParameter() + ad.LastUParameter())
    v = 0.5 * (ad.FirstVParameter() + ad.LastVParameter())
    pr = BRepLProp_SLProps(ad, 1, 1e-7)
    pr.SetParameters(u, v)
    n = pr.Normal()
    s = -1 if face.Orientation() == TopAbs_REVERSED else 1
    return np.array([n.X(), n.Y(), n.Z()]) * s, pr.Value()


def _chamfer_front(shape, d, pick):
    """Chamfer every edge of the faces selected by pick(face)."""
    ch = BRepFilletAPI_MakeChamfer(shape)
    seen = 0
    for f in _faces(shape):
        if not pick(f):
            continue
        ex = TopExp_Explorer(f, TopAbs_EDGE)
        while ex.More():
            e = TopoDS.Edge(ex.Current())
            ch.Add(d, e)
            seen += 1
            ex.Next()
    ch.Build()
    if not ch.IsDone():
        raise RuntimeError('chamfer failed')
    return ch.Shape()


def spoke_face(w, draft=math.radians(3.5), pockets=False):
    """The five Y spoke face: a dished disc revolved from its section, windows cut as drafted lofts, front edges chamfered."""
    rimw = w['rim_w'] / 2
    fx = rimw - 0.010
    r_end = w['rim'] - 0.004
    front = [(0.0, fx - 0.034), (0.06, fx - 0.034), (0.10, fx - 0.027), (0.16, fx - 0.016), (0.20, fx - 0.010), (r_end, fx - 0.006)]
    back = [(r_end, fx - 0.050), (0.20, fx - 0.054), (0.14, fx - 0.070), (0.085, fx - 0.095), (0.0, fx - 0.095)]
    disc = _revolve(front + back)
    a_top, a_ref, a_bot = rimw + 0.03, fx - 0.020, fx - 0.11
    cut = []
    k = w['rim'] / 0.254
    af = lambda r: float(np.interp(r, [p[0] for p in front], [p[1] for p in front]))
    wins = windows(rh=0.054 * k, rs=0.115 * k, rw=w['rim'] - 0.009)
    for P in wins[1::2]:
        rr = np.hypot(P[:, 0], P[:, 1])
        apex = P[np.argmin(rr)]
        ra, phi = float(rr.min()), math.atan2(apex[1], apex[0])
        e = np.array([math.cos(phi), math.sin(phi), 0.0])
        t = np.array([-math.sin(phi), math.cos(phi), 0.0])
        r0, r1 = 0.060 * k, ra - 0.004
        prof = [r0 * e + [0, 0, a_top], r1 * e + [0, 0, a_top], r1 * e + [0, 0, af(r1) - 0.005], r0 * e + [0, 0, af(r0) - 0.005]]
        prof = [p - 0.0035 * t for p in prof]
        f = BRepBuilderAPI_MakeFace(_wire_poly(prof)).Face()
        cut.append(BRepPrimAPI_MakePrism(f, gp_Vec(*map(float, 0.007 * t))).Shape())
    for P in wins:
        hi = _rounded(P, 0.009, -math.tan(draft) * (a_top - a_ref))
        lo = _rounded(P, 0.009, math.tan(draft) * (a_ref - a_bot))
        ts = BRepOffsetAPI_ThruSections(True, False, 1e-6)
        ts.AddWire(_wire_smooth([(x, y, a_top) for x, y in hi]))
        ts.AddWire(_wire_smooth([(x, y, a_bot) for x, y in lo]))
        ts.CheckCompatibility(False)
        ts.Build()
        cut.append(ts.Shape())
    body = BRepAlgoAPI_Cut(disc, _compound(cut)).Shape()
    def is_front(f):
        n, p = _face_normal(f)
        r = math.hypot(p.X(), p.Y())
        return n[2] > 0.8 and abs(p.Z() - af(r)) < 0.002 and r < r_end - 0.004
    try:
        body = _chamfer_front(body, 0.0025, is_front)
    except Exception:
        pass
    if pockets:
        pk = [BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, y, fx - 0.046), gp_Dir(0, 0, 1)), NUT_POCKET, a_top - fx + 0.046).Shape() for x, y in nut_xy(w)]
        body = BRepAlgoAPI_Cut(body, _compound(pk)).Shape()
    return body


NUT_PCD, NUT_AF, NUT_POCKET = 0.040, 0.013, 0.0090


def nut_xy(w, n=5, phase=math.pi / 2):
    return [(NUT_PCD * math.cos(phase + math.pi / n + 2 * math.pi * k / n), NUT_PCD * math.sin(phase + math.pi / n + 2 * math.pi * k / n)) for k in range(n)]


def nuts(w):
    """Hex nuts sunk in the hub pockets, tops 3 mm below the hub face, top edges chamfered."""
    fx = w['rim_w'] / 2 - 0.010
    out = []
    rc = NUT_AF / 2 / math.cos(math.pi / 6)
    for x, y in nut_xy(w):
        P = [(x + rc * math.cos(math.pi / 6 + k * math.pi / 3), y + rc * math.sin(math.pi / 6 + k * math.pi / 3), fx - 0.046) for k in range(6)]
        f = BRepBuilderAPI_MakeFace(_wire_poly(P)).Face()
        body = BRepPrimAPI_MakePrism(f, gp_Vec(0, 0, 0.009)).Shape()
        tip = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, y, fx - 0.040), gp_Dir(0, 0, 1)), 0.0055, 0.004).Shape()
        body = BRepAlgoAPI_Fuse(body, tip).Shape()
        try:
            body = _chamfer_front(body, 0.0012, lambda fc: _face_normal(fc)[0][2] > 0.9 and _face_normal(fc)[1].Z() > fx - 0.0375 - 1e-4 and _face_normal(fc)[1].Z() < fx - 0.0365)
        except RuntimeError:
            pass
        out.append(body)
    return _compound(out)


def disc(w, holes=True):
    """Brake disc ring with its bell, cross drilled in staggered rows."""
    R, t = w['disc'], w['disc_t']
    r0 = R - 0.072
    ring = _revolve([(r0, t / 2), (R, t / 2), (R, -t / 2), (r0, -t / 2)])
    bell = _revolve([(0.07, t / 2 + 0.045), (r0 + 0.004, t / 2 + 0.045), (r0 + 0.004, -t / 2 + 0.006), (r0 - 0.004, -t / 2 + 0.006),
                     (r0 - 0.004, t / 2 + 0.039), (0.07, t / 2 + 0.039)])
    body = BRepAlgoAPI_Fuse(ring, bell).Shape()
    if holes:
        drills = []
        rows = np.linspace(r0 + 0.012, R - 0.012, 4)
        for i, r in enumerate(rows):
            for k in range(36):
                a = 2 * math.pi * (k + 0.25 * i) / 36
                c = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(r * math.cos(a), r * math.sin(a), -t), gp_Dir(0, 0, 1)), 0.0032, 2 * t).Shape()
                drills.append(c)
        body = BRepAlgoAPI_Cut(body, _compound(drills)).Shape()
    return body


def caliper(w):
    """Angular caliper straddling the disc at the trailing top: a faceted sector with a slot for the disc, edges chamfered."""
    R, t = w['disc'], w['disc_t']
    r0, r1 = R - 0.068, R + 0.026
    hw = t / 2 + 0.032
    a0, a1 = math.radians(12), math.radians(84)
    na = 6
    ring_o = [(r1 * math.cos(a), r1 * math.sin(a)) for a in np.linspace(a0, a1, na)]
    ring_i = [(r0 * math.cos(a), r0 * math.sin(a)) for a in np.linspace(a1, a0, 3)]
    P2 = ring_o + ring_i
    w2 = _wire_poly([(x, y, -hw) for x, y in P2])
    f = BRepBuilderAPI_MakeFace(w2).Face()
    body = BRepPrimAPI_MakePrism(f, gp_Vec(0, 0, 2 * hw)).Shape()
    slot = _revolve([(r0 - 0.01, t / 2 + 0.004), (R + 0.006, t / 2 + 0.004), (R + 0.006, -t / 2 - 0.004), (r0 - 0.01, -t / 2 - 0.004)])
    body = BRepAlgoAPI_Cut(body, slot).Shape()
    ch = BRepFilletAPI_MakeChamfer(body)
    for f in _faces(body):
        n, p = _face_normal(f)
        if abs(n[2]) > 0.9 and abs(p.Z()) > hw - 0.002:
            ex = TopExp_Explorer(f, TopAbs_EDGE)
            while ex.More():
                ch.Add(0.008, TopoDS.Edge(ex.Current()))
                ex.Next()
    ch.Build()
    return ch.Shape() if ch.IsDone() else body


def mesh(shape, deflection=0.0003, angle=0.25):
    """Per-face triangulation; returns V (n,3), T (m,3), N (m,3,3) in the wheel frame (axial, X, Y), sharp between faces."""
    BRepMesh_IncrementalMesh(shape, deflection, False, angle, True)
    Vs, Ts, Ns = [], [], []
    off = 0
    for f in _faces(shape):
        V, T, N = occ._triangulate(f)
        if len(T) == 0:
            continue
        N = occ._orient_normals(V, T, N)
        Vs.append(V)
        Ts.append(T + off)
        Ns.append(N[T])
        off += len(V)
    V = np.concatenate(Vs)
    V = V[:, [2, 0, 1]]
    N = np.concatenate(Ns)[:, :, [2, 0, 1]]
    return V, np.concatenate(Ts), N
