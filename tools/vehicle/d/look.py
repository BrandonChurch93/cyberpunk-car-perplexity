"""Check renders of the surfaced body: blender -b --python look.py -- OUTDIR [view ...]

Views: f34 side r34 front rear top zebra_f34 zebra_side mask_*."""
import os
import sys
import importlib
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy
import numpy as np
import bl
import occ
import parts

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
outdir = argv[0] if argv else '/tmp/look'
views = argv[1:] or ['f34', 'side', 'r34']
os.makedirs(outdir, exist_ok=True)
car = importlib.import_module(os.environ.get('CAR', 'car'))
NET = car.network()
built = occ.build(NET)

bl.reset()
COL = {'paint': (0.62, 0.62, 0.62), 'black': (0.05, 0.05, 0.05), 'glass': (0.08, 0.09, 0.1), 'dark': (0.03, 0.03, 0.03)}
IDS = os.environ.get('IDS')
for name, o in built.items():
    mats = o['facet'] if IDS and name == 'body' else o['mats']
    ob = bl.mesh_object(name, o['V'], o['T'], mats, o['crease'], bevel=float(os.environ.get('BEVEL', '0.004')), normals=o.get('N'))
    if IDS and name == 'body':
        import zlib
        for fn in set(o['facet']):
            h = zlib.crc32(fn.replace('.R', '').encode())
            COL[fn] = ((h & 255) / 255 * 0.8 + 0.1, ((h >> 8) & 255) / 255 * 0.8 + 0.1, ((h >> 16) & 255) / 255 * 0.8 + 0.1)
parts.all_parts(NET)
COL.update({'tire': (0.03, 0.03, 0.03), 'rim': (0.5, 0.5, 0.52), 'disc': (0.15, 0.15, 0.15), 'caliper': (0.3, 0.3, 0.3)})
if os.environ.get('LINES'):
    from kernel_np import spline
    netw = car.network()
    lm = bl.material('lines', (0.8, 0.05, 0.02), 0.6)
    for en, e in netw.edges.items():
        S = spline([netw.resolve(c) for c in e['ctrl']], spacing=0.01)
        for sgn in (1, -1):
            cu = bpy.data.curves.new(en, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = 0.004
            sp = cu.splines.new('POLY'); sp.points.add(len(S) - 1)
            for i, p in enumerate(S):
                sp.points[i].co = (sgn * p[0], -p[2], p[1], 1)
            cu.materials.append(lm)
            ob = bpy.data.objects.new(en, cu); bpy.context.scene.collection.objects.link(ob)
COL['lines'] = (0.8, 0.05, 0.02)
for m in bpy.data.materials:
    bs = m.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (*COL.get(m.name, (0.6, 0.6, 0.6)), 1)
    bs.inputs['Roughness'].default_value = 0.45

CAMS = {
    'f34': ((3.6, 1.35, 4.6), (0.0, 0.55, 0.6), 50),
    'side': ((7.2, 0.6, 0.0), (0.0, 0.6, 0.0), 50),
    'r34': ((3.4, 1.4, -4.6), (0.0, 0.6, -0.7), 50),
    'front': ((0.0, 0.6, 12), (0, 0.6, 0), 70),
    'rear': ((0.0, 0.6, -12), (0, 0.6, 0), 70),
    'top': ((0.0, 12, 0.0), (0, 0, 0.001), 70),
    'nose': ((1.6, 1.1, 3.6), (0.5, 0.5, 1.9), 50),
    'fhigh': ((2.2, 2.6, 4.4), (0.3, 0.5, 1.6), 50),
}


def zebra_mats():
    for m in bpy.data.materials:
        bs = m.node_tree.nodes['Principled BSDF']
        bs.inputs['Base Color'].default_value = (0.95, 0.95, 0.95, 1)
        bs.inputs['Roughness'].default_value = 0.0
        bs.inputs['Metallic'].default_value = 1.0


mode = None
for v in views:
    kind, _, cam = v.rpartition('_')
    if kind != mode:
        if kind == 'zebra':
            bl.world_zebra(float(os.environ.get('FREQ', '40')))
            zebra_mats()
        elif kind == '':
            bl.world_flat(0.55, 1.0)
            sd = bpy.data.lights.new('sun', 'SUN'); sd.energy = 3.0; sd.angle = 0.2
            so = bpy.data.objects.new('sun', sd); bpy.context.scene.collection.objects.link(so)
            so.rotation_euler = (0.7, 0.2, 2.3)
        mode = kind
    if cam.startswith('m-'):
        import json
        mj = json.load(open(os.path.join(os.environ.get('MATCH', '/home/user/work/match'), cam[2:] + '-cam.json')))
        tgt = mj.get('target') or list(np.add(mj['cam'], np.multiply(mj['fwd'], 5)))
        c = bl.camera(v, mj['cam'], tgt, mj['f'] / mj['W'] * 36)
        sc = 1200 / mj['W']
        bl.render(os.path.join(outdir, f'{v}.png'), c, 1200, int(mj['H'] * sc), int(os.environ.get('SAMPLES', '16')))
        continue
    loc, tgt, lens = CAMS[cam]
    c = bl.camera(v, loc, tgt, lens)
    bl.render(os.path.join(outdir, f'{v}.png'), c, 1600, 1000, int(os.environ.get('SAMPLES', '16')))
