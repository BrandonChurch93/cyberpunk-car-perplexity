"""Door mirror solids in OpenCASCADE: a lofted wedge housing cut flat at the glass plane, its glass pocket, and the stalk.

Coordinates are car space (x out to the left, y up, z forward), left side; the exporter mirrors for the right.
Read from the grant views: nose tip z 0.848 y 0.867 (side), plan leading edge and glass line (top), hexagonal
section with its outer tip at x 1.133 (front)."""
import numpy as np
from OCP.gp import gp_Pnt, gp_Dir, gp_Vec, gp_Pln
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
from OCP.BRepPrimAPI import BRepPrimAPI_MakeHalfSpace, BRepPrimAPI_MakePrism
from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections, BRepOffsetAPI_MakeOffset
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Common
from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCP.BRepTools import BRepTools
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopoDS import TopoDS
from OCP.GeomAbs import GeomAbs_Arc
import occ
import wheel_occ as wo

G0 = np.array([0.910, 0.654])
G1 = np.array([1.128, 0.573])
PLAN = [(0.915, 0.800), (0.95, 0.829), (1.0, 0.812), (1.035, 0.788), (1.071, 0.750), (1.095, 0.703), (1.112, 0.652), (1.128, 0.590)]
SEC = [
    (0.915, 0.842, 0.902, 0.872),
    (0.95, 0.802, 0.917, 0.866),
    (1.0, 0.800, 0.923, 0.866),
    (1.05, 0.805, 0.921, 0.866),
    (1.09, 0.812, 0.914, 0.864),
    (1.115, 0.824, 0.896, 0.862),
    (1.131, 0.846, 0.874, 0.860),
]


def glass_z(x):
    return G0[1] + (x - G0[0]) * (G1[1] - G0[1]) / (G1[0] - G0[0])


def _lead(x):
    p = np.array(PLAN)
    return float(np.interp(x, p[:, 0], p[:, 1]))


def _section(x, yb, yt, yn):
    zf, zr = _lead(x), glass_z(x) - 0.03
    lz = zf - zr
    h = yt - yb
    P = [
        (zr, yt - 0.10 * h), (zr + 0.36 * lz, yt), (zr + 0.78 * lz, yt - 0.55 * (yt - yn)), (zf, yn),
        (zr + 0.80 * lz, yb + 0.42 * (yn - yb)), (zr + 0.42 * lz, yb), (zr, yb + 0.12 * h),
    ]
    return wo._wire_smooth([(x, y, z) for z, y in P])


def housing():
    ts = BRepOffsetAPI_ThruSections(True, False, 1e-6)
    for s in SEC:
        ts.AddWire(_section(*s))
    ts.CheckCompatibility(False)
    ts.Build()
    body = ts.Shape()
    d = np.array([G1[1] - G0[1], -(G1[0] - G0[0])])
    n = np.array([d[0], 0.0, d[1]])
    n /= np.linalg.norm(n)
    if n[2] > 0:
        n = -n
    pl = gp_Pln(gp_Pnt(G0[0], 0.86, G0[1]), gp_Dir(*n))
    face = BRepBuilderAPI_MakeFace(pl).Face()
    hs = BRepPrimAPI_MakeHalfSpace(face, gp_Pnt(*(np.array([G0[0], 0.86, G0[1]]) + 0.2 * n))).Solid()
    cut = BRepAlgoAPI_Cut(body, hs)
    cut.Build()
    shape = cut.Shape()
    return shape, n


def _plane_edges(shape, n, p0, tol=2e-4):
    out = []
    ex = TopExp_Explorer(shape, TopAbs_EDGE)
    while ex.More():
        e = TopoDS.Edge(ex.Current())
        from OCP.BRepAdaptor import BRepAdaptor_Curve
        c = BRepAdaptor_Curve(e)
        ok = True
        for t in np.linspace(c.FirstParameter(), c.LastParameter(), 5):
            q = c.Value(t)
            if abs((np.array([q.X(), q.Y(), q.Z()]) - p0) @ n) > tol:
                ok = False
                break
        if ok:
            out.append(e)
        ex.Next()
    return out


def parts():
    """Returns dict name -> TopoDS shape: housing (with fillet at the glass edge and a 4 mm pocket), glass, stalk."""
    shape, n = housing()
    p0 = np.array([G0[0], 0.86, G0[1]])
    fl = BRepFilletAPI_MakeFillet(shape)
    for e in _plane_edges(shape, n, p0):
        fl.Add(0.003, e)
    fl.Build()
    if fl.IsDone():
        shape = fl.Shape()
    pf = _rear_face(shape, n, p0)
    mo = BRepOffsetAPI_MakeOffset(pf, GeomAbs_Arc)
    mo.Perform(-0.007)
    inner = BRepBuilderAPI_MakeFace(TopoDS.Wire(_first_wire(mo.Shape())), True).Face()
    pocket = BRepPrimAPI_MakePrism(inner, gp_Vec(*(-0.004 * n))).Shape()
    tool = BRepPrimAPI_MakePrism(inner, gp_Vec(*(0.01 * n))).Shape()
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Fuse
    fu = BRepAlgoAPI_Fuse(pocket, tool)
    fu.Build()
    c = BRepAlgoAPI_Cut(shape, fu.Shape())
    c.Build()
    shape = c.Shape()
    from OCP.gp import gp_Trsf
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
    tr = gp_Trsf()
    tr.SetTranslation(gp_Vec(*(-0.003 * n)))
    glass = BRepBuilderAPI_Transform(inner, tr, True).Shape()
    return {'housing': shape, 'glass': glass, 'stalk': stalk()}


def _first_wire(shape):
    from OCP.TopAbs import TopAbs_WIRE
    ex = TopExp_Explorer(shape, TopAbs_WIRE)
    return ex.Current()


def _rear_face(shape, n, p0):
    from OCP.TopAbs import TopAbs_FACE
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    best, ba = None, 0.0
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        f = TopoDS.Face(ex.Current())
        nn, p = wo._face_normal(f)
        q = np.array([p.X(), p.Y(), p.Z()])
        if abs((q - p0) @ n) < 2e-4 and abs(nn @ n) > 0.999:
            g = GProp_GProps()
            BRepGProp.SurfaceProperties_s(f, g)
            if g.Mass() > ba:
                best, ba = f, g.Mass()
        ex.Next()
    return BRepTools.OuterWire_s(best)


def stalk():
    """Thin strut from the door top up into the housing underside, leaning outward and back."""
    secs = []
    for x, y, z in ((0.960, 0.742, 0.826), (0.971, 0.785, 0.800), (0.978, 0.830, 0.772)):
        P = []
        for k in range(16):
            a = 2 * np.pi * k / 16
            P.append((x + 0.006 * np.sin(a), y, z + 0.008 * np.cos(a)))
        secs.append(wo._wire_smooth(P))
    ts = BRepOffsetAPI_ThruSections(True, False, 1e-6)
    for s in secs:
        ts.AddWire(s)
    ts.Build()
    return ts.Shape()


def meshes(fine):
    d, a = (0.0002, 0.12) if fine else (0.0005, 0.3)
    out = {}
    for k, s in parts().items():
        out[k] = mesh(s, d * 2, a * 2) if k == 'stalk' else mesh(s, d, a)
    return out


def mesh(shape, deflection, angle):
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    BRepMesh_IncrementalMesh(shape, deflection, False, angle, True)
    Vs, Ts, Ns = [], [], []
    off = 0
    for f in wo._faces(shape):
        V, T, N, _ = occ._triangulate(f)
        if len(T) == 0:
            continue
        N = occ._orient_normals(V, T, N)
        Vs.append(V)
        Ts.append(T + off)
        Ns.append(N[T])
        off += len(V)
    return np.concatenate(Vs), np.concatenate(Ts), np.concatenate(Ns)
