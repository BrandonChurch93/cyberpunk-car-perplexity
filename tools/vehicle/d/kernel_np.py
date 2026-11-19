"""Curve sampling shared by the Blender build and the drawing checks."""
import math
import numpy as np


def spline(ctrl, n=None, spacing=None):
    """Centripetal Catmull-Rom through ctrl points, resampled at even arc length."""
    P = np.asarray(ctrl, dtype=float)
    if len(P) == 2:
        dense = np.linspace(P[0], P[1], 64)
    else:
        ext = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
        out = []
        for i in range(1, len(ext) - 2):
            p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
            t0 = 0.0
            t1 = t0 + max(np.linalg.norm(p1 - p0), 1e-9) ** 0.5
            t2 = t1 + max(np.linalg.norm(p2 - p1), 1e-9) ** 0.5
            t3 = t2 + max(np.linalg.norm(p3 - p2), 1e-9) ** 0.5
            for t in np.linspace(t1, t2, 48, endpoint=False):
                a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
                a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
                a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
                b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
                b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
                out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
        out.append(P[-1])
        dense = np.array(out)
    seg = np.linalg.norm(np.diff(dense, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]
    if n is None:
        n = max(2, int(math.ceil(L / spacing)) + 1)
    u = np.linspace(0, L, n)
    return np.stack([np.interp(u, s, dense[:, k]) for k in range(3)], axis=1)
