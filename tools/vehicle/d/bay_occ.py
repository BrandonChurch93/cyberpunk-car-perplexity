"""Engine bay solids in OpenCASCADE: stepped carbon side panels, two ribbed carbon cam covers, the block between them
and the two airbox boxes at the front of the bay. Car space, left half where the part is paired."""
import math
import numpy as np
from OCP.gp import gp_Pnt, gp_Ax1, gp_Dir, gp_Trsf, gp_Vec
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections
from OCP.BRepAlgoAPI import BRepAlgoAPI_Fuse
from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopoDS import TopoDS
from OCP.BRepAdaptor import BRepAdaptor_Curve
import wheel_occ as wo
import mirror_occ

EDGE = [(-0.76, 0.470, 1.105), (-0.952, 0.454, 1.082), (-1.144, 0.438, 1.059), (-1.335, 0.415, 1.036),
        (-1.525, 0.383, 1.011), (-1.714, 0.346, 0.986), (-1.903, 0.309, 0.961), (-1.95, 0.300, 0.955)]
COVER_X, COVER_W, COVER_Z = 0.150, 0.190, (-0.97, -1.80)
COVER_TOP = (0.958, 0.930)
STEPS = 4


def edge_at(z):
    e = np.array(EDGE)[::-1]
    return float(np.interp(z, e[:, 0], e[:, 1])), float(np.interp(z, e[:, 0], e[:, 2]))


def _stair(z):
    xe, ye = edge_at(z)
    x0, y0 = xe - 0.006, ye - 0.008
    w = min(0.15, xe - 0.275) / STEPS
    h = 0.038
    P = [(x0 + 0.03, y0), (x0, y0)]
    x, y = x0, y0
    for i in range(STEPS):
        y -= h
        P.append((x, y))
        x -= w
        y -= 0.008
        P.append((x, y))
    P.append((x, 0.74))
    P.append((x0 + 0.03, 0.74))
    return wo._wire_poly([(px, py, z) for px, py in P])


def _long_edges(shape, axis, minlen):
    ex = TopExp_Explorer(shape, TopAbs_EDGE)
    out = []
    while ex.More():
        e = TopoDS.Edge(ex.Current())
        c = BRepAdaptor_Curve(e)
        a, b = c.Value(c.FirstParameter()), c.Value(c.LastParameter())
        d = np.array([b.X() - a.X(), b.Y() - a.Y(), b.Z() - a.Z()])
        n = np.linalg.norm(d)
        if n > minlen and abs(d[axis]) / n > 0.9:
            out.append(e)
        ex.Next()
    return out


def _fillet(shape, edges, r):
    if not edges:
        return shape
    mk = BRepFilletAPI_MakeFillet(shape)
    for e in edges:
        mk.Add(r, e)
    try:
        mk.Build()
        if mk.IsDone():
            return mk.Shape()
    except Exception:
        pass
    return shape


def side_panel():
    ts = BRepOffsetAPI_ThruSections(True, True, 1e-6)
    for z in np.linspace(-0.80, -1.92, 8):
        ts.AddWire(_stair(float(z)))
    ts.Build()
    return ts.Shape()


def _box(x0, y0, z0, x1, y1, z1):
    return BRepPrimAPI_MakeBox(gp_Pnt(x0, y0, z0), gp_Pnt(x1, y1, z1)).Shape()


def _move(shape, trsf):
    return BRepBuilderAPI_Transform(shape, trsf, True).Shape()


def cover():
    za, zb = COVER_Z
    L = za - zb
    w, h = COVER_W, 0.065
    body = _box(-w / 2, -h, 0.0, w / 2, 0.0, L)
    body = _fillet(body, _long_edges(body, 2, 0.1), 0.018)
    ex = TopExp_Explorer(body, TopAbs_EDGE)
    ends = []
    while ex.More():
        e = TopoDS.Edge(ex.Current())
        c = BRepAdaptor_Curve(e)
        p = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()))
        if p.Y() > -0.003 and (p.Z() < 0.003 or p.Z() > L - 0.003):
            ends.append(e)
        ex.Next()
    body = _fillet(body, ends, 0.012)
    n = 11
    pitch = (L - 0.10) / n
    for i in range(n):
        z0 = 0.05 + i * pitch + 0.2 * pitch
        rib = _box(-w / 2 + 0.030, -0.004, z0, w / 2 - 0.030, 0.0065, z0 + 0.6 * pitch)
        rib = _fillet(rib, _long_edges(rib, 0, 0.05), 0.0028)
        body = BRepAlgoAPI_Fuse(body, rib).Shape()
    for zz in (0.025, L - 0.045):
        for k in range(3):
            xx = -0.03 + k * 0.03
            bar = _box(xx - 0.005, -0.004, zz, xx + 0.005, 0.004, zz + 0.02)
            body = BRepAlgoAPI_Fuse(body, bar).Shape()
    tilt = math.atan2(COVER_TOP[0] - COVER_TOP[1], L)
    t1 = gp_Trsf()
    t1.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), math.radians(-11))
    t2 = gp_Trsf()
    t2.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0)), -tilt)
    t3 = gp_Trsf()
    t3.SetTranslation(gp_Vec(COVER_X, COVER_TOP[1], zb))
    t = t3.Multiplied(t2).Multiplied(t1)
    return _move(body, t)


def block():
    za, zb = COVER_Z
    return _box(-0.30, 0.66, zb - 0.06, 0.30, 0.875, za + 0.04)


def valley():
    za, zb = COVER_Z
    return _box(-0.06, 0.66, zb, 0.06, 0.915, za)


def airbox():
    return _box(0.035, 0.80, -0.955, 0.31, 0.948, -0.80)


AIRBOX_LID = (0.055, 0.29, -0.94, -0.815, 0.957)


def meshes(fine):
    d, a = (0.00015, 0.1) if fine else (0.0006, 0.35)
    return {
        'side panel': mirror_occ.mesh(side_panel(), d, a),
        'cam cover': mirror_occ.mesh(cover(), d, a),
        'block': mirror_occ.mesh(block(), 0.002, 0.5),
        'valley': mirror_occ.mesh(valley(), 0.002, 0.5),
        'airbox': mirror_occ.mesh(airbox(), 0.002, 0.5),
    }
