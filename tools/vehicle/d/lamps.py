"""Lamp parts: light guides swept along the network's Y arms, projector stacks, tail guides."""
import math
import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix
import bl
from kernel_np import spline


def _unit(v):
    v = np.asarray(v, float)
    return v / max(np.linalg.norm(v), 1e-12)


def _obj(name, bm, mat, part=None, smooth=True, bevel=0.0):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(bl.material(mat))
    me.polygons.foreach_set('use_smooth', [smooth] * len(me.polygons))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob['part'] = part or name
    if bevel:
        md = ob.modifiers.new('round', 'BEVEL')
        md.width = bevel
        md.segments = 2
        md.limit_method = 'ANGLE'
    return ob


def strip(pts, width, thick, out, ends=0.35, n=None):
    """Bar of a given width along a 3D path, its face looking along `out`, ends rounded down to `ends` of the width."""
    pts = np.asarray(pts, float)
    if n:
        s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
        t = np.linspace(0, s[-1], n)
        pts = np.stack([np.interp(t, s, pts[:, k]) for k in range(3)], 1)
    m = len(pts)
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        tg = _unit(pts[min(i + 1, m - 1)] - pts[max(i - 1, 0)])
        o = _unit(np.asarray(out, float) - np.dot(out, tg) * tg)
        sd = np.cross(o, tg)
        u = i / (m - 1)
        cap = min(u, 1 - u) * (m - 1) / max(1, round(0.12 * (m - 1)))
        w = width * (ends + (1 - ends) * math.sqrt(max(0.0, min(1.0, cap) * (2 - min(1.0, cap)))))
        q = [p + sd * w / 2 + o * thick / 2, p - sd * w / 2 + o * thick / 2, p - sd * w / 2 - o * thick / 2, p + sd * w / 2 - o * thick / 2]
        rings.append([bm.verts.new(bl.b(c)) for c in q])
    for i in range(m - 1):
        for k in range(4):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % 4], rings[i + 1][(k + 1) % 4], rings[i + 1][k]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def lathe(profile, segs, frame):
    """profile: (radius, axial) pairs; frame: 4x4 car-space matrix whose column 2 is the axis."""
    bm = bmesh.new()
    rings = []
    for k in range(segs):
        a = 2 * math.pi * k / segs
        ring = []
        for r, ax in profile:
            p = frame @ np.array([r * math.cos(a), r * math.sin(a), ax, 1.0])
            ring.append(bm.verts.new(bl.b(p[:3])))
        rings.append(ring)
    for k in range(segs):
        r0, r1 = rings[k], rings[(k + 1) % segs]
        for i in range(len(profile) - 1):
            bm.faces.new((r0[i], r0[i + 1], r1[i + 1], r1[i]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def frame_at(p, axis):
    z = _unit(axis)
    x = _unit(np.cross((0, 1, 0), z))
    y = np.cross(z, x)
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2], M[:3, 3] = x, y, z, p
    return M


def curve(net, name, a=0.0, b=1.0):
    c = [net.resolve(p) for p in net.edges[name]['ctrl']]
    S = spline(c, spacing=0.004)
    s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(S, axis=0), axis=1))]
    s /= s[-1]
    keep = (s >= a - 1e-9) & (s <= b + 1e-9)
    return S[keep]


def toward(S, start):
    return S if np.linalg.norm(S[0] - start) < np.linalg.norm(S[-1] - start) else S[::-1]


def projector(c, r, axis, label, segs, candela):
    """Recessed projector: reflector bowl, dark shield, emitter, clear lens, all along `axis` (outward)."""
    F = frame_at(c, axis)
    out = []
    bowl = [(r * 1.18, 0.0), (r * 1.15, -0.012), (r * 0.95, -0.032), (r * 0.55, -0.050), (r * 0.18, -0.058), (0.0, -0.059)]
    out.append(_obj(f'{label} reflector', lathe(bowl, segs, F), 'brushed', 'projector reflector'))
    ring = [(r * 1.32, 0.004), (r * 1.32, -0.004), (r * 1.08, -0.006), (r * 1.08, 0.006), (r * 1.32, 0.004)]
    out.append(_obj(f'{label} bezel', lathe(ring, segs, F), 'matte', 'projector bezel'))
    S = frame_at(c + F[:3, 2] * -0.020 - F[:3, 1] * r * 0.25, axis)
    shield = [(0.0, 0.0015), (r * 0.80, 0.0015), (r * 0.80, -0.0015), (0.0, -0.0015)]
    sh = lathe(shield, segs, S)
    Si = np.linalg.inv(S)
    cut = [v for v in sh.verts if (Si @ np.array([*bl_inv(v.co), 1.0]))[1] > r * 0.12]
    bmesh.ops.delete(sh, geom=cut, context='VERTS')
    out.append(_obj(f'{label} cutoff shield', sh, 'dark', 'projector cutoff shield', smooth=False))
    em = [(0.0, -0.028), (r * 0.42, -0.030), (r * 0.42, -0.034), (0.0, -0.034)]
    e = _obj('main beam projector', lathe(em, segs, F), 'emitter', 'main beam projector')
    e['candela'] = candela
    e['lamp'] = 'beam'
    out.append(e)
    lens = [(0.0, 0.006 + r * 0.22), (r * 0.5, 0.004 + r * 0.18), (r * 0.85, r * 0.08), (r, 0.0), (r, -0.006), (r * 0.6, -0.004 - 0.0), (0.0, -0.002)]
    out.append(_obj(f'{label} lens', lathe(lens, segs, F), 'optics', 'projector lens'))
    return out


def bl_inv(co):
    return (co.x, co.z, -co.y)


def front(net, full):
    """Left front lamps; the exporter mirrors them."""
    obs = []
    yn = net.points['Yn']
    arms = [toward(curve(net, 'lamp_outer', 0.0, 0.92), yn), toward(curve(net, 'lamp_low', 0.35, 1.0), yn), toward(curve(net, 'arm_low', 0.0, 0.85), yn)]
    inward = [(-0.010, -0.004, -0.018), (0.0, 0.010, -0.018), (-0.012, 0.004, -0.018)]
    n = 40 if full else 14
    for S, d in zip(arms, inward):
        S = S[::-1] + np.asarray(d)
        obs.append(_obj('front running guide', strip(S, 0.012, 0.005, (0.15, 0.1, 1.0), n=n), 'emitter', 'front running guide'))
        obs[-1]['lamp'] = 'running'
        obs.append(_obj('front guide channel', strip(S - np.array([0, 0, 0.004]), 0.022, 0.006, (0.15, 0.1, 1.0), n=n), 'matte', 'front guide channel'))
    segs = 48 if full else 16
    N1, Lo = net.points['N1'], net.points['Lo']
    for w, r, cd in (((0.22, 0.42, 0.36), 0.030, 170.0), ((0.50, 0.24, 0.26), 0.024, 80.0)):
        x, y = (w[0] * N1 + w[1] * Lo + w[2] * yn)[:2]
        c = np.array([x, y, _depth(x, y) - 0.052])
        obs += projector(c, r, (0.06, -0.03, 1.0), f'projector {cd:.0f}', segs, cd)
    return obs + intake(net, full)


def _inside(P, q):
    x, y = q
    c = False
    n = len(P)
    for i in range(n):
        (x0, y0), (x1, y1) = P[i], P[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            c = not c
    return c


def _edge_dist(P, q):
    q = np.asarray(q)
    best = 1e9
    for i in range(len(P)):
        a, b = P[i], P[(i + 1) % len(P)]
        t = np.clip(np.dot(q - a, b - a) / max(np.dot(b - a, b - a), 1e-12), 0, 1)
        best = min(best, np.linalg.norm(q - a - t * (b - a)))
    return best


def hex_mesh(poly, place, cell, bar, depth, margin=0.0):
    """Hexagonal mesh as real bars over the plane region poly (2D); place(u, v) gives the 3D point and normal."""
    poly = np.asarray(poly, float)
    lo, hi = poly.min(0), poly.max(0)
    rc = cell / math.sqrt(3)
    ri = rc - bar / math.cos(math.pi / 6) / 2
    bm = bmesh.new()
    dx, dy = cell, cell * math.sqrt(3) / 2
    j = 0
    y = lo[1]
    while y <= hi[1] + dy:
        x = lo[0] + (cell / 2 if j % 2 else 0.0)
        while x <= hi[0] + cell:
            c = np.array([x, y])
            if _inside(poly, c) and _edge_dist(poly, c) > margin:
                rings = []
                for r in (rc, ri):
                    for side in (0.5, -0.5):
                        ring = []
                        for k in range(6):
                            a = math.pi / 6 + k * math.pi / 3
                            u = c + r * np.array([math.cos(a), math.sin(a)])
                            p, nrm = place(*u)
                            ring.append(bm.verts.new(bl.b(p + nrm * depth * side)))
                        rings.append(ring)
                of, ob, inf, inb = rings
                for k in range(6):
                    m = (k + 1) % 6
                    bm.faces.new((of[k], of[m], inf[m], inf[k]))
                    bm.faces.new((ob[k], inb[k], inb[m], ob[m]))
                    bm.faces.new((inf[k], inf[m], inb[m], inb[k]))
                    bm.faces.new((of[k], ob[k], ob[m], of[m]))
            x += dx
        y += dy
        j += 1
    return bm


def intake(net, full):
    """Front intake internals: the dark strut from the blade tip up to the intake top and the hexagonal mesh behind."""
    obs = []
    top = curve(net, 'int_top')
    zt = float(np.interp(0.252, top[:, 0], top[:, 2])) if top[0, 0] < top[-1, 0] else float(np.interp(0.252, top[::-1, 0], top[::-1, 2]))
    a = np.asarray(net.points['Dt'], float)
    b = np.array([0.252, 0.384, zt])
    S = np.array([a + t * (b - a) for t in np.linspace(0, 1, 8)]) + np.array([0, 0, -0.065])
    obs.append(_obj('intake strut', strip(S, 0.030, 0.13, (0.0, 0.0, 1.0), ends=1.0), 'matte', 'intake strut', smooth=False, bevel=0.003))
    loop = []
    for e in ('int_top', 'lamp_low', 'arm_low', 'arm_down', 'bl_top', 'bl_in', 'lip_top', 'int_ctr'):
        c = curve(net, e)
        if loop:
            c = toward(c, loop[-1])
        elif np.linalg.norm(c[0] - net.points['I0']) > 1e-6:
            c = c[::-1]
        loop.extend(c if not loop else c[1:])
    L = np.array(loop)
    cf = np.polyfit(L[:, 0], L[:, 2], 2)
    place = lambda u, v: (np.array([u, v, float(np.polyval(cf, abs(u))) - 0.11]), np.array([0.0, 0.0, 1.0]))
    half = L[:, :2].copy()
    half[np.abs(half[:, 0]) < 1e-6, 0] = -0.012
    bm = hex_mesh(half, place, 0.022 if full else 0.034, 0.0026, 0.008, margin=0.004)
    obs.append(_obj('front intake mesh', bm, 'dark', 'front intake hexagonal mesh', smooth=False))
    return obs


def _depth(x, y):
    """Front surface z at (x, y), casting along -z against the body parts already in the scene."""
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    best = None
    for ob in bpy.data.objects:
        if ob.type != 'MESH' or not ob.name.startswith(('closed body', 'recessed backing', 'black trim', 'headlamp outer lens')):
            continue
        tree = BVHTree.FromObject(ob.evaluated_get(dg), dg)
        hit = tree.ray_cast(Vector(bl.b((x, y, 4.0))), Vector(bl.b((0, 0, -1))))
        if hit[0] is not None and (best is None or -hit[0].y > best):
            best = -hit[0].y
    return best if best is not None else 2.4


def rear(net, full):
    obs = []
    L = [net.points[f'L{i}'] for i in range(4)]
    top, bot = L[0][1], L[3][1]
    xi, xo = L[0][0], L[1][0]
    from car import zb
    z = lambda x: zb(x) + 0.024
    ym = 0.5 * (top + bot)
    paths = [
        [(xi + 0.01, ym + 0.002), (xi + 0.10, ym + 0.004), (xi + 0.17, ym + 0.006)],
        [(xi + 0.17, ym + 0.006), (xo - 0.06, top - 0.016), (xo - 0.012, top - 0.014)],
        [(xi + 0.17, ym + 0.006), (xo - 0.06, bot + 0.020), (xo - 0.012, bot + 0.018)],
    ]
    n = 36 if full else 12
    for P in paths:
        S = spline([np.array([x, y, z(x)]) for x, y in P], spacing=0.004)
        ob = _obj('tail running guide', strip(S, 0.011, 0.005, (0.6, 0.0, -1.0), n=n), 'emitter_rear', 'tail running guide')
        ob['lamp'] = 'running'
        obs.append(ob)
        obs.append(_obj('tail guide channel', strip(S + np.array([0, 0, 0.004]), 0.020, 0.006, (0.6, 0.0, -1.0), n=n), 'matte', 'tail guide channel'))
    return obs
