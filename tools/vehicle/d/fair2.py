"""Curvature inside each trimmed facet: area share curving against the facet's crown, and max |k|.
python fair2.py [facet ...]"""
import os
import sys
import importlib
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRep import BRep_Tool
from OCP.BRepLProp import BRepLProp_SLProps
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.TopLoc import TopLoc_Location
from OCP.TopAbs import TopAbs_REVERSED
import occ


def stats(face, hint, crown=1.0):
    BRepMesh_IncrementalMesh(face, 0.0005, False, 0.05, True)
    loc = TopLoc_Location()
    tri = BRep_Tool.Triangulation_s(face, loc)
    if tri is None:
        return None
    ad = BRepAdaptor_Surface(face)
    pr = BRepLProp_SLProps(ad, 2, 1e-7)
    P, K1, K2 = [], [], []
    flip = face.Orientation() == TopAbs_REVERSED
    for i in range(1, tri.NbNodes() + 1):
        uv = tri.UVNode(i)
        pr.SetParameters(uv.X(), uv.Y())
        if not pr.IsCurvatureDefined():
            continue
        n = pr.Normal()
        n = np.array([n.X(), n.Y(), n.Z()])
        s = -1.0 if flip else 1.0
        if hint is not None:
            s = 1.0 if (s * n) @ np.asarray(hint, float) > 0 else -1.0
            s = s if not flip else s
        a, b = pr.MinCurvature(), pr.MaxCurvature()
        P.append(tri.Node(i).Coord())
        K1.append(-s * a if not flip else s * a)
        K2.append(-s * b if not flip else s * b)
    K = np.stack([K1, K2], 1)
    kmin = K.min(1)
    kmax = K.max(1)
    sgn = 1.0 if crown >= 0 else -1.0
    against = np.mean(sgn * kmin < -0.1)
    return against, float(np.abs(K).max()), float(np.percentile(kmin, 5)), float(np.percentile(kmax, 95))


if __name__ == '__main__':
    car = importlib.import_module(os.environ.get('CAR', 'car'))
    net = car.network()
    faces = occ.build(net, faces_only=True, log=lambda *a: None)
    info = {f['name']: f for f in net.facets}
    from net import full
    finfo = {f['name']: f for f in full(net).facets}
    want = sys.argv[1:] or [n for n, f in finfo.items() if f['mat'] == 'paint' and not n.endswith('.R')]
    tot = 0
    for n in want:
        f = finfo[n]
        r = stats(faces[n], f['hint'], f['crown'] or 1.0)
        if r is None:
            continue
        tot += r[0]
        print(f'{n:20s} against {r[0] * 100:5.1f}%  max|k| {r[1]:7.2f}  k5 {r[2]:7.2f}  k95 {r[3]:7.2f}  crown {f["crown"]}')
    print('sum against', round(tot * 100, 1))
