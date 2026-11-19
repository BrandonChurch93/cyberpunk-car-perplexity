"""Blender side: meshes, modifiers, materials, check renders and glTF export."""
import math
import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix


def b(p):
    return (p[0], -p[2], p[1])


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    return sc


def material(name, color=(0.5, 0.5, 0.5), rough=0.5, metal=0.0, emit=None):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1)
        bsdf.inputs['Emission Strength'].default_value = 1.0
    m.diffuse_color = (*color, 1)
    return m


def mesh_object(name, V, T, mats, crease=(), parent=None, matlib=None, bevel=0.004, segments=3, smooth=True, normals=None):
    me = bpy.data.meshes.new(name)
    Vb = np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1)
    me.from_pydata(Vb.tolist(), [], T.tolist())
    me.validate(clean_customdata=False)
    names = sorted(set(mats))
    for n in names:
        me.materials.append(matlib(n) if matlib else material(n))
    idx = {n: i for i, n in enumerate(names)}
    me.polygons.foreach_set('material_index', [idx[m] for m in mats])
    if smooth:
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    if normals is not None and len(me.polygons) == len(T):
        Nb = np.stack([normals[..., 0], -normals[..., 2], normals[..., 1]], -1).reshape(-1, 3)
        me.normals_split_custom_set(Nb.tolist())
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent:
        ob.parent = parent
    if crease:
        attr = me.attributes.new('crease_w', 'FLOAT', 'EDGE')
        key = {}
        ev = np.zeros(len(me.edges) * 2, dtype=np.int64)
        me.edges.foreach_get('vertices', ev)
        ev = ev.reshape(-1, 2)
        lut = {(min(a, b), max(a, b)): i for i, (a, b) in enumerate(ev)}
        w = np.zeros(len(me.edges))
        for a, b2 in crease:
            i = lut.get((min(a, b2), max(a, b2)))
            if i is not None:
                w[i] = 1.0
        attr.data.foreach_set('value', w)
        sharp = me.attributes.new('sharp_edge', 'BOOLEAN', 'EDGE')
        sharp.data.foreach_set('value', (w > 0).tolist())
        if bevel:
            md = ob.modifiers.new('crease bevel', 'BEVEL')
            md.width = bevel
            md.segments = segments
            md.limit_method = 'WEIGHT'
            md.edge_weight = 'crease_w'
            md.use_clamp_overlap = True
            md.harden_normals = False
            md.profile = 0.5
            md.miter_outer = 'MITER_ARC'
    return ob


def apply_all(ob):
    bpy.context.view_layer.objects.active = ob
    for md in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=md.name)


def world_clay(strength=1.0):
    w = bpy.data.worlds.new('clay')
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'NISHITA' if hasattr(sky, 'sky_type') else sky.sky_type
    try:
        sky.sun_elevation = math.radians(35)
        sky.sun_rotation = math.radians(140)
    except Exception:
        pass
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.25 * strength


def world_flat(c=0.8, strength=1.0):
    w = bpy.data.worlds.new('flat')
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (c, c, c, 1)
    bg.inputs['Strength'].default_value = strength


def world_zebra(freq=26.0, axis='Z'):
    w = bpy.data.worlds.new('zebra')
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    m1 = nt.nodes.new('ShaderNodeMath'); m1.operation = 'MULTIPLY'; m1.inputs[1].default_value = freq
    nt.links.new(sep.outputs[axis], m1.inputs[0])
    s = nt.nodes.new('ShaderNodeMath'); s.operation = 'SINE'
    nt.links.new(m1.outputs[0], s.inputs[0])
    g = nt.nodes.new('ShaderNodeMath'); g.operation = 'GREATER_THAN'; g.inputs[1].default_value = 0.0
    nt.links.new(s.outputs[0], g.inputs[0])
    nt.links.new(g.outputs[0], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0


def camera(name, loc, target, lens=50, ortho=None, sensor=36):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.sensor_width = sensor
    cd.clip_start = 0.01
    cd.clip_end = 100
    if ortho:
        cd.type = 'ORTHO'
        cd.ortho_scale = ortho
    ob = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(b(loc))
    d = Vector(b(target)) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


def render(path, cam, w=1600, h=1000, samples=24, engine='CYCLES', film_transparent=False):
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.engine = engine
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = film_transparent
    sc.render.image_settings.file_format = 'PNG'
    if engine == 'CYCLES':
        sc.cycles.device = 'CPU'
        sc.cycles.samples = samples
        sc.cycles.use_denoising = True
        sc.cycles.max_bounces = 4
    sc.view_settings.view_transform = 'Standard'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def mirror_wheels(names=('front wheel', 'rear wheel')):
    """The glb carries the left wheels only, as the runtime mirrors them: do the same for checks."""
    for nm in names:
        src = bpy.data.objects.get(nm)
        if src is None:
            continue
        new = {}
        for ob in [src] + list(src.children_recursive):
            c = ob.copy()
            bpy.context.scene.collection.objects.link(c)
            new[ob] = c
        for ob, c in new.items():
            if ob.parent in new:
                c.parent = new[ob.parent]
        r = new[src]
        r.parent = None
        r.matrix_world = Matrix.Diagonal((-1, 1, 1, 1)) @ src.matrix_world
