"""Fairness numbers per face: inflections of normal curvature along iso lines and curvature range: python fair.py"""
import importlib
import os
import sys
import numpy as np
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepLProp import BRepLProp_SLProps
import occ


def face_stats(face, n=24):
    ad = BRepAdaptor_Surface(face)
    u0, u1, v0, v1 = ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()
    pr = BRepLProp_SLProps(ad, 2, 1e-7)
    from OCP.gp import gp_Vec
    ku = np.zeros((n, n)); kv = np.zeros((n, n))
    for i, u in enumerate(np.linspace(u0, u1, n + 2)[1:-1]):
        for j, v in enumerate(np.linspace(v0, v1, n + 2)[1:-1]):
            pr.SetParameters(u, v)
            if not pr.IsCurvatureDefined():
                continue
            nn = gp_Vec(pr.Normal())
            a, b = pr.D1U(), pr.D1V()
            ku[i, j] = pr.D2U().Dot(nn) / max(a.SquareMagnitude(), 1e-18)
            kv[i, j] = pr.D2V().Dot(nn) / max(b.SquareMagnitude(), 1e-18)
    def infl(k, axis):
        s = np.sign(np.where(np.abs(k) < 0.05, 0, k))
        s = np.moveaxis(s, axis, 0)
        c = 0
        for line in s.T:
            line = line[line != 0]
            c += int((line[1:] != line[:-1]).sum())
        return c
    return infl(ku, 0) + infl(kv, 1), float(np.abs(np.r_[ku.ravel(), kv.ravel()]).max())


if __name__ == '__main__':
    car = importlib.import_module(os.environ.get('CAR', 'car'))
    faces = occ.build(car.network(), faces_only=True)
    rows = sorted(((face_stats(f), n) for n, f in faces.items() if not n.endswith('.R')), reverse=True)
    tot = sum(r[0][0] for r in rows)
    for (c, k), n in rows[: int(os.environ.get('TOP', 25))]:
        print(f'{n:28s} inflections {c:4d}  max |k| {k:7.1f} 1/m')
    print('total inflections', tot)
