"""Standalone front wheel: blender -b --python wheel_glb.py -- OUTDIR [full|blockout ...]

Writes d-wheel-full.glb and d-wheel-blockout.glb: hub center at the origin, axle along +X (outboard face toward +X),
glTF Y up, metres. Nodes: tire, rim barrel, spokes, center cap, wheel nuts, disc, caliper."""
import os
import sys
import math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy
import numpy as np
import bl
import parts
import wheel_occ

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(HERE, '..', '..', '..', 'public', 'assets', 'vehicle')
LEVELS = argv[1:] or ['blockout', 'full']
MATS = {
    'rim': ('alloy dark gloss', (0.025, 0.026, 0.028), 0.18, 0.9),
    'nut': ('nut dark gloss', (0.05, 0.05, 0.055), 0.2, 1.0),
    'tire': ('tire rubber', (0.018, 0.018, 0.018), 0.85, 0.0),
    'disc': ('disc carbon ceramic', (0.09, 0.09, 0.095), 0.6, 0.3),
    'caliper': ('caliper graphite gloss', (0.14, 0.14, 0.15), 0.3, 0.5),
    'dark': ('backing plate matte black', (0.02, 0.02, 0.022), 0.8, 0.2),
}


def sidewall(w, n=48):
    """Tire half section with shoulder, rim protector bead and two abstract concentric relief ribs."""
    R, rim, hw = w['R'], w['rim'], w['width'] / 2
    side = R - rim
    pts = []
    for t in np.linspace(0, 1, n):
        r = rim + 0.012 + t * (side - 0.040)
        bulge = 0.012 * math.sin(math.pi * min(1, t * 1.1))
        a = hw * 0.93 + bulge * (1 - 0.3 * t)
        a += 0.0028 * math.exp(-((r - rim - 0.020) / 0.004) ** 2)
        for rc in (rim + 0.050, rim + 0.056):
            a += 0.0008 * (abs(r - rc) < 0.0012)
        a += 0.0006 * ((r > rim + 0.064) & (r < rim + 0.074))
        pts.append((r, a))
    for t in np.linspace(0, math.pi / 2, 12)[1:]:
        pts.append((R - 0.028 + 0.028 * math.sin(t), hw - 0.006 - 0.030 * (1 - math.cos(t))))
    for ax in np.linspace(hw - 0.036, -(hw - 0.036), 18)[1:-1]:
        pts.append((R, ax))
    tail = [(r, -a) for r, a in reversed(pts)]
    return [(rim, hw * 0.95)] + pts + tail + [(rim, -hw * 0.95)]


def build(level):
    full = level == 'full'
    bl.reset()
    for key, (name, col, rough, metal) in MATS.items():
        m = bl.material(key, col, rough, metal)
    w = parts.FRONT
    root = parts.wheel(w, 1, 'wheel', fine=full)
    from mathutils import Matrix
    root.matrix_world = Matrix.Identity(4)
    for c in list(root.children):
        if c.name.endswith('tire'):
            me = c.data
            bpy.data.objects.remove(c)
            bpy.data.meshes.remove(me)
    tire = parts._lathe(sidewall(w, 64 if full else 24), 192 if full else 64, 'wheel tire', 'tire')
    tire.parent = root
    bpy.context.view_layer.update()
    for ob in list(bpy.data.objects):
        if ob.type == 'MESH':
            ob['part'] = ob.name.replace('wheel ', '')
            for m in ob.data.materials:
                if m and m.name in MATS:
                    m.name = MATS[m.name][0]
    root['part'] = 'front wheel'
    os.makedirs(OUT, exist_ok=True)
    path = os.path.abspath(os.path.join(OUT, f'd-wheel-{level}.glb'))
    tris = sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in bpy.data.objects if ob.type == 'MESH')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_extras=True,
                              export_normals=True, export_texcoords=False, export_tangents=False, export_materials='EXPORT',
                              export_animations=False, export_cameras=False, export_lights=False, use_selection=False,
                              export_image_format='NONE')
    print(f'wheel {level}: {tris} triangles, {os.path.getsize(path) / 1e6:.2f} MB -> {path}', flush=True)


for lv in LEVELS:
    build(lv)
