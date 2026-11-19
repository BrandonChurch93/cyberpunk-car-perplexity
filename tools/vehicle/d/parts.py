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
    return [(rim, hw * 0.95)] + pts + tail + [(rim, -hw * 0.95)]


def wheel(w, side_sign, label):
    root = bpy.data.objects.new(label, None)
    bpy.context.scene.collection.objects.link(root)
    tire = _lathe(tire_profile(w), 160, f'{label} tire', 'tire')
    rimw = w['rim_w'] / 2
    barrel = [(w['rim'] - 0.004, rimw), (w['rim'] + 0.012, rimw), (w['rim'] + 0.012, rimw - 0.012), (w['rim'] - 0.006, rimw - 0.02),
              (w['rim'] - 0.022, rimw - 0.05), (w['rim'] - 0.022, -rimw + 0.02), (w['rim'] + 0.01, -rimw)]
    rim = _lathe(barrel, 128, f'{label} rim barrel', 'rim')
    face = spokes(w, f'{label} spokes')
    disc = _lathe([(0.075, w['disc_t'] / 2), (w['disc'], w['disc_t'] / 2), (w['disc'], -w['disc_t'] / 2), (0.075, -w['disc_t'] / 2)], 96, f'{label} disc', 'disc')
    disc.location.x -= rimw - 0.09
    cal = caliper(w, f'{label} caliper')
    cal.location.x -= rimw - 0.09
    for ob in (tire, rim, face, disc, cal):
        ob.parent = root
    root.matrix_world = Matrix.Translation(Vector(bl.b((side_sign * w['x'], w['hub'], w['z']))))
    if side_sign < 0:
        root.scale.x = -1
    return root


def spokes(w, name):
    bm = bmesh.new()
    rim_in = w['rim'] - 0.022
    face_x = w['rim_w'] / 2 - 0.012
    hub_r = 0.085
    n = 5
    rings = 96
    for k in range(n):
        a0 = 2 * math.pi * k / n
        for off in (-0.10, 0.10):
            pts2 = []
            for t in np.linspace(0, 1, 12):
                r = hub_r + t * (rim_in - hub_r)
                spread = off * t ** 1.2
                width = 0.030 - 0.006 * t
                pts2.append((r, a0 + spread, width / r))
            left = [(r * math.cos(a + h), r * math.sin(a + h)) for r, a, h in pts2]
            right = [(r * math.cos(a - h), r * math.sin(a - h)) for r, a, h in pts2]
            poly = left + right[::-1]
            depth = lambda r: face_x - 0.010 - 0.055 * max(0.0, (r - hub_r) / (rim_in - hub_r)) ** 1.5
            top = [bm.verts.new((depth(math.hypot(*p)), p[0], p[1])) for p in poly]
            bot = [bm.verts.new((depth(math.hypot(*p)) - 0.045, p[0], p[1])) for p in poly]
            bm.faces.new(top)
            bm.faces.new(bot[::-1])
            m = len(poly)
            for i in range(m):
                j = (i + 1) % m
                bm.faces.new((top[i], bot[i], bot[j], top[j]))
    hub = []
    for i in range(rings):
        a = 2 * math.pi * i / rings
        hub.append((hub_r * 1.05 * math.cos(a), hub_r * 1.05 * math.sin(a)))
    top = [bm.verts.new((face_x - 0.004, p[0], p[1])) for p in hub]
    bot = [bm.verts.new((face_x - 0.06, p[0], p[1])) for p in hub]
    bm.faces.new(top)
    bm.faces.new(bot[::-1])
    for i in range(rings):
        j = (i + 1) % rings
        bm.faces.new((top[i], bot[i], bot[j], top[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _obj(name, bm, 'rim', smooth=False)
    md = ob.modifiers.new('chamfer', 'BEVEL')
    md.width = 0.003
    md.segments = 2
    md.limit_method = 'ANGLE'
    return ob


def caliper(w, name):
    bm = bmesh.new()
    r0, r1 = w['disc'] - 0.06, w['disc'] + 0.015
    a0, a1 = math.radians(20), math.radians(80)
    segs = 12
    hw = w['disc_t'] / 2 + 0.03
    vs = []
    for i in range(segs + 1):
        a = a0 + (a1 - a0) * i / segs
        ring = []
        for r, x in ((r0, hw), (r1, hw), (r1, -hw), (r0, -hw)):
            ring.append(bm.verts.new((x, r * math.cos(a), r * math.sin(a))))
        vs.append(ring)
    for i in range(segs):
        for k in range(4):
            bm.faces.new((vs[i][k], vs[i][(k + 1) % 4], vs[i + 1][(k + 1) % 4], vs[i + 1][k]))
    bm.faces.new(vs[0][::-1])
    bm.faces.new(vs[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _obj(name, bm, 'caliper', smooth=False)
    md = ob.modifiers.new('round', 'BEVEL')
    md.width = 0.006
    md.segments = 3
    return ob


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


def tub(w, side_sign, name, outline, lip_x=0.99):
    """Arch liner: a wall following the arch opening at the inner side, closed down to the floor."""
    bm = bmesh.new()
    x0 = w['x'] - w['width'] / 2 - 0.04
    ring = [(max(p[1], 0.13), p[2]) for p in outline]
    ring = [(0.13, ring[0][1])] + ring + [(0.13, ring[-1][1])]
    inner = [bm.verts.new(bl.b((side_sign * x0, y, z))) for y, z in ring]
    outer = [bm.verts.new(bl.b((side_sign * (lip_x - 0.02), y, z))) for y, z in ring]
    bm.faces.new(inner)
    for i in range(len(ring) - 1):
        bm.faces.new((inner[i], inner[i + 1], outer[i + 1], outer[i]))
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


def mirror(side_sign, label):
    """Door mirror: angular painted housing with its glass on the rear face, on a thin blade stalk."""
    root = bpy.data.objects.new(label, None)
    bpy.context.scene.collection.objects.link(root)
    L = 0.288
    pts = [(0.0, 0.0), (L, 0.02), (L * 0.97, 0.10), (0.05, 0.085)]
    xi, xo = 1.035, 1.133
    cin = lambda z, y: (side_sign * xi, 0.83 + y, 0.85 - z)
    cout = lambda z, y: (side_sign * xo, 0.83 + y + 0.004, 0.85 - z + 0.025 * (z / L))
    bm = bmesh.new()
    vs_in = [bm.verts.new(bl.b(cin(z, y))) for z, y in pts]
    vs_out = [bm.verts.new(bl.b(cout(z, y))) for z, y in pts]
    bm.faces.new(vs_in)
    bm.faces.new(vs_out[::-1])
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((vs_in[i], vs_in[j], vs_out[j], vs_out[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    shell = _obj(f'{label} shell', bm, 'paint', root, smooth=False)
    md = shell.modifiers.new('round', 'BEVEL')
    md.width = 0.004
    md.segments = 2
    shell['part'] = 'mirror housing'
    a, b, c, d = cin(*pts[1]), cin(*pts[2]), cout(*pts[2]), cout(*pts[1])
    ctr = np.mean([a, b, c, d], 0)
    quad = [ctr + 0.86 * (np.asarray(p) - ctr) + np.array([0, 0, -0.0015]) for p in (a, b, c, d)]
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new(bl.b(p)) for p in quad])
    if (Vector(bl.b((0, 0, -1))).dot(f.normal)) < 0:
        f.normal_flip()
    g = _obj(f'{label} glass', bm, 'mirror', root, smooth=False)
    g['part'] = 'mirror glass'
    bm = bmesh.new()
    sec = [(0.0, -0.035), (0.004, -0.035), (0.004, 0.035), (0.0, 0.035)]
    ring0 = [bm.verts.new(bl.b((side_sign * (0.965 + dx), 0.795, 0.70 + dz))) for dx, dz in sec]
    ring1 = [bm.verts.new(bl.b((side_sign * (xi + 0.01 + dx), 0.84, 0.70 + dz * 0.8))) for dx, dz in sec]
    bm.faces.new(ring0)
    bm.faces.new(ring1[::-1])
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    st = _obj(f'{label} stalk', bm, 'matte', root, smooth=False)
    st['part'] = 'mirror stalk'
    return root


def bay(net, full):
    """Engine bay placeholder: a closed tray under the opening between the haunches, block and covers."""
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
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        x, y, z = v.co.x, v.co.y, v.co.z
        v.co = Vector(bl.b((x * 0.56, 0.74 + y * 0.26, -1.36 + z * 0.92)))
    obs.append(_obj('engine block', bm, 'engine', smooth=False))
    obs[-1]['part'] = 'engine block'
    for k, xc in enumerate((-0.15, 0.15)):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            x, y, z = v.co.x, v.co.y, v.co.z
            v.co = Vector(bl.b((xc + x * 0.22, 0.90 + y * 0.05 - 0.02 * z, -1.36 + z * 0.80)))
        ob = _obj(f'engine cover {k}', bm, 'carbon', smooth=False)
        md = ob.modifiers.new('round', 'BEVEL')
        md.width = 0.01
        md.segments = 3
        ob['part'] = 'engine cover banks'
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
