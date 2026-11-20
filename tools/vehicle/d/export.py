"""Build the vehicle D assets: blender -b --python export.py -- OUTDIR [full|blockout ...]

Writes d-full.glb and d-blockout.glb: one node per part, materials named after the runtime palette,
every mesh with normals and box-projected UVs. Left wheels only; the runtime mirrors them."""
import os
import sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy
import bmesh
import numpy as np
from mathutils import Vector
import bl
import occ
import parts
import lamps
import car

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(HERE, '..', '..', '..', 'public', 'assets', 'vehicle')
LEVELS = argv[1:] or ['blockout', 'full']
SETTINGS = {
    'full': dict(deflection=0.00012, angle=0.05, bevel=0.004, segments=3),
    'blockout': dict(deflection=0.0008, angle=0.2, bevel=0.0, segments=1),
}
BODY_MATS = {'paint': 'paint', 'black': 'matte', 'glass': 'glass', 'dark': 'dark', 'hot': 'hot', 'optics': 'optics'}
PART = {
    'paint': 'closed body panels and returns', 'matte': 'black trim, splitter and frames', 'glass': 'windscreen and side glass',
    'dark': 'recessed backing and intake walls', 'hot': 'formed hexagonal outlet', 'optics': 'headlamp outer lens',
}
RENAME = {'rim': 'forged', 'nut': 'forged', 'disc': 'brake', 'black': 'matte'}


def matlib(name):
    return bl.material(BODY_MATS.get(name, name))


def empty(name, parent=None, part=None):
    ob = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(ob)
    ob['part'] = part or name
    if parent:
        ob.parent = parent
    return ob


def apply(ob):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    for md in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=md.name)


def separate_by_material(ob):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='MATERIAL')
    bpy.ops.object.mode_set(mode='OBJECT')
    out = []
    for o in bpy.context.selected_objects:
        used = {p.material_index for p in o.data.polygons}
        mats = [o.data.materials[i] for i in used]
        if len(mats) != 1:
            raise RuntimeError(f'{o.name}: {len(mats)} materials after split')
        m = mats[0]
        for i in range(len(o.data.materials) - 1, -1, -1):
            if o.data.materials[i] != m:
                o.data.materials.pop(index=i)
        o.name = PART[m.name]
        o['part'] = PART[m.name]
        out.append(o)
    return out


def mirrored(ob, parent):
    me = ob.data.copy()
    bm = bmesh.new()
    bm.from_mesh(me)
    for v in bm.verts:
        v.co.x = -v.co.x
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o2 = bpy.data.objects.new(ob.name + ' right', me)
    bpy.context.scene.collection.objects.link(o2)
    for k in ob.keys():
        o2[k] = ob[k]
    for md in ob.modifiers:
        m2 = o2.modifiers.new(md.name, md.type)
        for attr in ('width', 'segments', 'limit_method'):
            setattr(m2, attr, getattr(md, attr))
    o2.parent = parent
    return o2


def box_uv(ob):
    me = ob.data
    if not len(me.polygons):
        return
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    layer = me.uv_layers.new(name='UVMap')
    vi = np.zeros(len(me.loops), np.int64)
    me.loops.foreach_get('vertex_index', vi)
    co = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    M = np.array(ob.matrix_world)
    P = co.reshape(-1, 3)[vi] @ M[:3, :3].T + M[:3, 3]
    pn = np.zeros(len(me.polygons) * 3)
    me.polygons.foreach_get('normal', pn)
    lt = np.zeros(len(me.polygons), np.int64)
    me.polygons.foreach_get('loop_total', lt)
    ax = np.repeat(np.abs(pn.reshape(-1, 3)).argmax(1), lt)
    u = np.where(ax == 0, P[:, 1], P[:, 0])
    v = np.where(ax == 2, P[:, 1], P[:, 2])
    layer.data.foreach_set('uv', np.stack([u, v], 1).ravel())


def build(level):
    st = SETTINGS[level]
    full = level == 'full'
    bl.reset()
    NET = car.network()
    built = occ.build(NET, deflection=st['deflection'], angle=st['angle'])
    sprung = empty('sprung assembly')
    for name, o in built.items():
        mats = ['hot' if f.startswith('exh~wall') else m for m, f in zip(o['mats'], o['facet'])]
        ob = bl.mesh_object(name, o['V'], o['T'], mats, o['crease'], matlib=matlib, bevel=st['bevel'], segments=st['segments'], normals=o.get('N'))
        apply(ob)
        for part in separate_by_material(ob):
            part.parent = sprung
    tire_segs = 160 if full else 48
    for w, label in ((parts.FRONT, 'front wheel'), (parts.REAR, 'rear wheel')):
        root = parts.wheel(w, 1, label, fine=full)
        root['part'] = label
        for c in root.children:
            c['part'] = c.name.replace(label, label.split()[0]).strip()
    bpy.context.view_layer.update()
    parts.flatten_contact([o for o in bpy.data.objects if o.name.endswith('tire')])
    arches = {'front': parts.arch_outline(NET, ['arch_f1', 'arch_f2', 'arch_f3']), 'rear': parts.arch_outline(NET, ['arch_r'])}
    for w, tag in ((parts.FRONT, 'front'), (parts.REAR, 'rear')):
        for s, sd in ((1, 'left'), (-1, 'right')):
            t = parts.tub(w, s, f'{tag} wheelhouse liner {sd}', arches[tag])
            t['part'] = 'wheelhouse liner'
            t.parent = sprung
    fl = parts.floor('underbody floor')
    fl['part'] = 'underbody floor'
    fl.parent = sprung
    mirrors = empty('door mirrors', sprung)
    for s, sd in ((1, 'left'), (-1, 'right')):
        r = parts.mirror(s, f'mirror {sd}')
        for c in list(r.children):
            mw = c.matrix_world.copy()
            c.parent = mirrors
            c.matrix_world = mw
        bpy.data.objects.remove(r)
    for ob in parts.bay(NET, full):
        ob.parent = sprung
    bpy.context.view_layer.update()
    for ob in parts.fins(car.zp):
        ob.parent = sprung
    bpy.context.view_layer.update()
    lamp_obs = lamps.front(NET, full) + lamps.rear(NET, full)
    for ob in lamp_obs:
        ob.parent = sprung
        ob['side'] = 'left'
        o2 = mirrored(ob, sprung)
        o2['side'] = 'right'
    for ob in list(bpy.data.objects):
        if ob.type == 'MESH':
            apply(ob)
            box_uv(ob)
            for m in ob.data.materials:
                if m and m.name in RENAME:
                    m.name = RENAME[m.name]
            if 'part' not in ob.keys():
                ob['part'] = ob.name
    os.makedirs(OUT, exist_ok=True)
    path = os.path.abspath(os.path.join(OUT, f'd-{level}.glb'))
    tris = sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in bpy.data.objects if ob.type == 'MESH')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_extras=True,
                              export_normals=True, export_texcoords=True, export_tangents=False, export_materials='EXPORT',
                              export_animations=False, export_cameras=False, export_lights=False, use_selection=False,
                              export_image_format='NONE')
    print(f'{level}: {tris} triangles, {os.path.getsize(path) / 1e6:.1f} MB -> {path}', flush=True)


for lv in LEVELS:
    build(lv)
