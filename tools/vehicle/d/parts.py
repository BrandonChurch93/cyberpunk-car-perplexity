"""Blender side parts that are not network surfaces: wheels, tires, brakes, wheel tubs, floor, mirrors."""
import math
import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix
import bl

FRONT = dict(x=0.860, z=1.2860, R=0.34675, hub=0.3405, width=0.265, rim=0.254, rim_w=0.2413, disc=0.205, disc_t=0.038)
REAR = dict(x=0.8505, z=-1.4930, R=0.3702, hub=0.3625, width=0.325, rim=0.2667, rim_w=0.3048, disc=0.195, disc_t=0.032)


def _obj(name, bm, mat, parent=None, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(bl.material(mat))
    if smooth:
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent:
        ob.parent = parent
    return ob


def _lathe(profile, segs, name, mat):
    """profile: list of (radius, axial) in the wheel frame, axial along +X (outboard)."""
    bm = bmesh.new()
    rings = []
    for k in range(segs):
        a = 2 * math.pi * k / segs
        ring = [bm.verts.new((ax, r * math.cos(a), r * math.sin(a))) for r, ax in profile]
        rings.append(ring)
    for k in range(segs):
        r0, r1 = rings[k], rings[(k + 1) % segs]
        for i in range(len(profile) - 1):
            bm.faces.new((r0[i], r0[i + 1], r1[i + 1], r1[i]))
    return _obj(name, bm, mat)


def tire_profile(w):
    R, rim, hw = w['R'], w['rim'], w['width'] / 2
    side = R - rim
    pts = []
    for t in np.linspace(0, 1, 14):
        r = rim + 0.012 + t * (side - 0.040)
        bulge = 0.012 * math.sin(math.pi * min(1, t * 1.1))
        pts.append((r, hw * 0.93 + bulge * (1 - 0.3 * t)))
    for t in np.linspace(0, math.pi / 2, 10)[1:]:
        pts.append((R - 0.028 + 0.028 * math.sin(t), hw - 0.006 - 0.030 * (1 - math.cos(t))))
    for ax in np.linspace(hw - 0.036, -(hw - 0.036), 18)[1:-1]:
        pts.append((R, ax))
    tail = [(r, -a) for r, a in reversed(pts)]
    return [(rim, hw * 0.95)] + pts + tail + [(rim, -hw * 0.95), (rim - 0.003, -hw * 0.95), (rim - 0.003, hw * 0.95), (rim, hw * 0.95)]


def _occ_obj(name, V, T, N, mat, parent=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.tolist(), [], T.tolist())
    me.validate(clean_customdata=False)
    me.materials.append(bl.material(mat))
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    if len(me.polygons) == len(T):
        me.normals_split_custom_set(N.reshape(-1, 3).tolist())
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent:
        ob.parent = parent
    return ob


_SOLIDS = {}


def _solids(w, fine):
    import wheel_occ
    key = (w['rim'], fine)
    if key not in _SOLIDS:
        d = 0.00015 if fine else 0.0006
        a = 0.12 if fine else 0.35
        _SOLIDS[key] = {
            'spokes': wheel_occ.mesh(wheel_occ.spoke_face(w, pockets=True), d * 1.7, a * 1.5),
            'nuts': wheel_occ.mesh(wheel_occ.nuts(w), d, a),
            'disc': wheel_occ.mesh(wheel_occ.disc(w, holes=True), d * 2, a * 2),
            'caliper': wheel_occ.mesh(wheel_occ.caliper(w), d, a),
        }
    return _SOLIDS[key]


def wheel(w, side_sign, label, fine=False):
    root = bpy.data.objects.new(label, None)
    bpy.context.scene.collection.objects.link(root)
    tire = _lathe(tire_profile(w), 160 if fine else 72, f'{label} tire', 'tire')
    rimw = w['rim_w'] / 2
    fl = w['rim'] + 0.018
    barrel = [(w['rim'] - 0.004, rimw - 0.004), (fl - 0.003, rimw), (fl, rimw - 0.004), (fl - 0.004, rimw - 0.010), (w['rim'] + 0.002, rimw - 0.016),
              (w['rim'] - 0.006, rimw - 0.022), (w['rim'] - 0.022, rimw - 0.05), (w['rim'] - 0.022, -rimw + 0.02), (w['rim'] + 0.01, -rimw)]
    rim = _lathe(barrel, 192 if fine else 96, f'{label} rim barrel', 'rim')
    S = _solids(w, fine)
    face = _occ_obj(f'{label} spokes', *S['spokes'], 'rim')
    disc = _occ_obj(f'{label} disc', *S['disc'], 'disc')
    cal = _occ_obj(f'{label} caliper', *S['caliper'], 'caliper')
    nuts = _occ_obj(f'{label} nuts', *S['nuts'], 'nut')
    fx = rimw - 0.010
    dc = (fx - 0.095) - 0.002 - (w['disc_t'] / 2 + 0.045)
    disc.location.x = dc
    cal.location.x = dc
    cap = _lathe([(0.0, fx - 0.026), (0.024, fx - 0.026), (0.030, fx - 0.028), (0.034, fx - 0.034), (0.034, fx - 0.05)], 64, f'{label} center cap', 'rim')
    for ob in (tire, rim, face, disc, cal, cap, nuts):
        ob.parent = root
    root.matrix_world = Matrix.Translation(Vector(bl.b((side_sign * w['x'], w['hub'], w['z']))))
    if side_sign < 0:
        root.scale.x = -1
    return root


def flatten_contact(objs):
    for ob in objs:
        mw = ob.matrix_world
        inv = mw.inverted()
        for v in ob.data.vertices:
            p = mw @ v.co
            if p.z < 0.0:
                p.z = 0.0
                v.co = inv @ p


def arch_outline(net, names):
    from kernel_np import spline
    pts = []
    for e in names:
        c = [net.resolve(p) for p in net.edges[e]['ctrl']]
        q = spline(c, spacing=0.01)
        if pts and np.linalg.norm(q[0] - pts[-1]) > np.linalg.norm(q[-1] - pts[-1]):
            q = q[::-1]
        pts.extend(q)
    return np.array(pts)


def tub(w, side_sign, name, outline, lip_x=0.99, gap=0.02):
    """Arch liner: a return flange from the arch lip in to a tub ring 20 mm over the tire, closed down to the floor."""
    bm = bmesh.new()
    x0 = w['x'] - w['width'] / 2 - 0.04
    hy, hz = w['hub'], w['z']
    lip, ring = [], []
    for p in outline:
        d = np.array([p[1] - hy, p[2] - hz])
        r = np.linalg.norm(d)
        q = d / r * min(r, w['R'] + gap)
        lip.append((max(p[1], 0.13), p[2]))
        ring.append((max(hy + q[0], 0.13), hz + q[1]))
    lip = [(0.13, lip[0][1])] + lip + [(0.13, lip[-1][1])]
    ring = [(0.13, ring[0][1])] + ring + [(0.13, ring[-1][1])]
    xm = min(lip_x - 0.03, w['x'] + w['width'] / 2 + 0.01)
    inner = [bm.verts.new(bl.b((side_sign * x0, y, z))) for y, z in ring]
    mid = [bm.verts.new(bl.b((side_sign * xm, y, z))) for y, z in ring]
    outer = [bm.verts.new(bl.b((side_sign * (lip_x - 0.02), y, z))) for y, z in lip]
    bm.faces.new(inner)
    for i in range(len(ring) - 1):
        bm.faces.new((inner[i], inner[i + 1], mid[i + 1], mid[i]))
        bm.faces.new((mid[i], mid[i + 1], outer[i + 1], outer[i]))
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(name, bm, 'dark')


def floor(name):
    bm = bmesh.new()
    pts = [(0.45, 2.30), (0.70, 2.02), (0.72, -1.75), (0.52, -1.95), (-0.52, -1.95), (-0.72, -1.75), (-0.70, 2.02), (-0.45, 2.30)]
    vs = [bm.verts.new(bl.b((x, 0.125, z))) for x, z in pts]
    bm.faces.new(vs)
    for x0, x1, z0, z1 in ((0.72, 0.985, 0.94, -1.07), (-0.985, -0.72, 0.94, -1.07)):
        vs = [bm.verts.new(bl.b(p)) for p in ((x0, 0.128, z0), (x1, 0.128, z0), (x1, 0.128, z1), (x0, 0.128, z1))]
        bm.faces.new(vs)
    return _obj(name, bm, 'dark', smooth=False)


_MIRROR = {}


def mirror(side_sign, label, fine=False):
    """Door mirror from the OCC solids in mirror_occ: carbon wedge housing, recessed glass, thin strut."""
    import mirror_occ
    if fine not in _MIRROR:
        _MIRROR[fine] = mirror_occ.meshes(fine)
    root = bpy.data.objects.new(label, None)
    bpy.context.scene.collection.objects.link(root)
    for key, mat, part in (('housing', 'carbon', 'mirror housing'), ('glass', 'mirror', 'mirror glass'), ('stalk', 'matte', 'mirror stalk')):
        V, T, N = _MIRROR[fine][key]
        V = V * np.array([side_sign, 1.0, 1.0])
        N = N * np.array([side_sign, 1.0, 1.0])
        if side_sign < 0:
            T = T[:, ::-1]
            N = N[:, ::-1]
        ob = _occ_obj(f'{label} {key}', V[:, [0, 2, 1]] * np.array([1.0, -1.0, 1.0]), T, N[:, :, [0, 2, 1]] * np.array([1.0, -1.0, 1.0]), mat, root)
        ob['part'] = part
    return root


def bay(net, full):
    """Engine bay: a closed tray under the opening, OCC stepped side panels, ribbed cam covers, block, airboxes with mesh lids."""
    from kernel_np import spline
    out = []
    for e in ('roof_rear', 'bay_edge', 'deck_tail'):
        q = spline([net.resolve(c) for c in net.edges[e]['ctrl']], spacing=0.02)
        if out and np.linalg.norm(q[0] - out[-1]) > np.linalg.norm(q[-1] - out[-1]):
            q = q[::-1]
        out.extend(q if not out else q[1:])
    half = np.array(out)
    if half[0][0] > 0.01:
        half = half[::-1]
    loop = np.r_[half, (half * [-1, 1, 1])[::-1][1:-1]]
    loop = loop - np.array([0, 0.003, 0])
    bm = bmesh.new()
    top = [bm.verts.new(bl.b(p)) for p in loop]
    bot = [bm.verts.new(bl.b((p[0] * 0.92, 0.60, p[2] * 0.98 - 0.02))) for p in loop]
    bm.faces.new(bot)
    for i in range(len(loop)):
        j = (i + 1) % len(loop)
        bm.faces.new((top[i], top[j], bot[j], bot[i]))
    bmesh.ops.triangulate(bm, faces=bm.faces)
    aim = Vector(bl.b((0.0, 1.2, float(np.mean(loop[:, 2])))))
    for f in bm.faces:
        if f.normal.dot(aim - f.calc_center_median()) < 0:
            f.normal_flip()
    obs = [_obj('engine bay tub', bm, 'dark', smooth=False)]
    obs[-1]['part'] = 'engine bay tub'
    import bay_occ
    import lamps
    key = ('bay', bool(full))
    if key not in _MIRROR:
        _MIRROR[key] = bay_occ.meshes(full)
    M = _MIRROR[key]
    paired = (('side panel', 'carbon', 'engine bay side panel'), ('cam cover', 'carbon', 'engine cam cover'), ('airbox', 'dark', 'engine airbox'))
    for key, mat, part in paired:
        for s, sd in ((1, 'left'), (-1, 'right')):
            V, T, N = M[key]
            V = V * np.array([s, 1.0, 1.0])
            N = N * np.array([s, 1.0, 1.0])
            if s < 0:
                T = T[:, ::-1]
                N = N[:, ::-1]
            ob = _occ_obj(f'{part} {sd}', V[:, [0, 2, 1]] * np.array([1.0, -1.0, 1.0]), T, N[:, :, [0, 2, 1]] * np.array([1.0, -1.0, 1.0]), mat, None)
            ob['part'] = part
            obs.append(ob)
    for key, mat, part in (('block', 'engine', 'engine block'), ('valley', 'dark', 'engine valley')):
        V, T, N = M[key]
        ob = _occ_obj(part, V[:, [0, 2, 1]] * np.array([1.0, -1.0, 1.0]), T, N[:, :, [0, 2, 1]] * np.array([1.0, -1.0, 1.0]), mat, None)
        ob['part'] = part
        obs.append(ob)
    x0, x1, z0, z1, y = bay_occ.AIRBOX_LID
    for s, sd in ((1, 'left'), (-1, 'right')):
        poly = [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
        bm = lamps.hex_mesh(poly, lambda u, v, s=s: (np.array([s * u, y, v]), np.array([0.0, 1.0, 0.0])), 0.016, 0.0025, 0.006)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        ob = _obj(f'engine airbox mesh {sd}', bm, 'matte', smooth=False)
        ob['part'] = 'engine airbox mesh'
        obs.append(ob)
    return obs


SHUT = ('door_f', 'shut_up', 'shut_mid', 'shut_low')


def shut_lines(net, paint, width=0.0032, lift=0.00035, depth=0.0006):
    """Door shut gaps: dark ribbons laid onto the paint along the door outline, each side point projected to the skin."""
    from kernel_np import spline
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    trees = [BVHTree.FromObject(o, dg) for o in paint]
    mws = [(o.matrix_world, o.matrix_world.inverted(), o.matrix_world.to_3x3().inverted().transposed()) for o in paint]

    def snap(p):
        best = None
        for t, (mw, inv, nm) in zip(trees, mws):
            loc, n, _, d = t.find_nearest(inv @ Vector(p))
            if loc is not None and (best is None or d < best[2]):
                best = (mw @ loc, (nm @ n).normalized(), d)
        return best

    obs = []
    for sg, sd in ((1, 'left'), (-1, 'right')):
        for e in SHUT:
            P = np.array([bl.b(q * np.array([sg, 1.0, 1.0])) for q in spline([net.resolve(c) for c in net.edges[e]['ctrl']], spacing=0.004)])
            bm = bmesh.new()
            rows = []
            for i, p in enumerate(P):
                tg = P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]
                tg = tg / (np.linalg.norm(tg) + 1e-12)
                c = snap(p)
                if c is None:
                    continue
                n = np.array(c[1])
                sdv = np.cross(n, tg)
                sdv = sdv / (np.linalg.norm(sdv) + 1e-12)
                row = []
                for k in (-0.5, 0.5):
                    q = snap(np.array(c[0]) + sdv * width * k)
                    a = np.array(q[0])
                    m = np.array(q[1])
                    row.append((a + m * lift, a - m * depth))
                rows.append(row)
            vs = [[bm.verts.new(r[0][0]), bm.verts.new(r[1][0]), bm.verts.new(r[1][1]), bm.verts.new(r[0][1])] for r in rows]
            for a, b in zip(vs[:-1], vs[1:]):
                for k in range(4):
                    bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
            bm.faces.new(vs[0][::-1])
            bm.faces.new(vs[-1])
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            ob = _obj(f'door shut {e} {sd}', bm, 'dark', smooth=False)
            ob['part'] = 'door shut line'
            obs.append(ob)
    return obs


FIN_LOW = ((-1.90, 0.13), (-1.976, 0.154), (-2.04, 0.163), (-2.15, 0.191), (-2.255, 0.218), (-2.31, 0.241), (-2.36, 0.30),
           (-2.42, 0.377), (-2.466, 0.468))


def fins(z_end):
    """Diffuser fins: thin chamfered plates hanging from the diffuser, lower edge from the side drawing."""
    dg = bpy.context.evaluated_depsgraph_get()
    obs = []
    for k, (x, rear, lift) in enumerate(((0.425, -2.462, 0.0), (0.656, z_end(0.656) + 0.02, 0.03))):
        zs = np.linspace(-1.90, rear, 24)
        cols = []
        for z in zs:
            hit, loc, *_ = bpy.context.scene.ray_cast(dg, Vector(bl.b((x, 0.02, z))), Vector(bl.b((0, 1, 0))))
            top = (loc.z if hit else 0.5) + 0.02
            low = float(np.interp(-z, *zip(*[(-a, b) for a, b in FIN_LOW]))) + lift
            cols.append((z, min(low, top - 0.03), top))
        for s in (1, -1):
            bm = bmesh.new()
            t = 0.008
            vs = [[bm.verts.new(bl.b((s * x + d, y, z))) for d in (-t, t) for y in (lo, hi)] for z, lo, hi in cols]
            for a, c in zip(vs[:-1], vs[1:]):
                for i, j in ((0, 1), (1, 3), (3, 2), (2, 0)):
                    bm.faces.new((a[i], a[j], c[j], c[i]))
            bm.faces.new((vs[0][0], vs[0][1], vs[0][3], vs[0][2]))
            bm.faces.new((vs[-1][2], vs[-1][3], vs[-1][1], vs[-1][0]))
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            ob = _obj(f'diffuser fin {k} {"left" if s > 0 else "right"}', bm, 'carbon', smooth=False)
            md = ob.modifiers.new('chamfer', 'BEVEL')
            md.width = 0.003
            md.segments = 1
            ob['part'] = 'diffuser fin'
            obs.append(ob)
    return obs


def all_parts(net):
    wheels = []
    arches = {'front': arch_outline(net, ['arch_f1', 'arch_f2', 'arch_f3']), 'rear': arch_outline(net, ['arch_r'])}
    for w, tag in ((FRONT, 'front'), (REAR, 'rear')):
        for s, sd in ((1, 'left'), (-1, 'right')):
            wheels.append(wheel(w, s, f'wheel {tag} {sd}'))
            tub(w, s, f'tub {tag} {sd}', arches[tag])
    bpy.context.view_layer.update()
    flatten_contact([o for o in bpy.data.objects if o.name.endswith('tire')])
    floor('floor')
    mirror(1, 'mirror left')
    mirror(-1, 'mirror right')
    return wheels
