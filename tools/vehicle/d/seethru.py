"""Double-sided white mask renders of a glb on black, counting enclosed background pixels:
blender -b --python seethru.py -- OUTDIR model.glb"""
import os
import sys
import math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy
import numpy as np
import bl

argv = sys.argv[sys.argv.index('--') + 1:]
outdir, glb = argv[0], argv[1]
os.makedirs(outdir, exist_ok=True)
bl.reset()
bpy.ops.import_scene.gltf(filepath=glb)
bl.mirror_wheels()
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 1
sc.cycles.max_bounces = 0
sc.cycles.use_denoising = False
sc.render.filter_size = 0.01
sc.view_settings.view_transform = 'Standard'
bl.world_flat(0.0, 0.0)
white = bpy.data.materials.new('mask')
white.use_nodes = True
nt = white.node_tree
nt.nodes.clear()
em = nt.nodes.new('ShaderNodeEmission')
out = nt.nodes.new('ShaderNodeOutputMaterial')
nt.links.new(em.outputs[0], out.inputs['Surface'])
for ob in sc.objects:
    if ob.type == 'MESH':
        ob.data.materials.clear()
        ob.data.materials.append(white)
        for p in ob.data.polygons:
            p.material_index = 0
sc.render.resolution_x, sc.render.resolution_y = 1600, 1000
VIEWS = {}
for i, az in enumerate(range(0, 360, 30)):
    for el in (-20, 5, 30):
        a, e = math.radians(az), math.radians(el)
        VIEWS[f'a{az:03d}e{el:+03d}'] = (7 * math.cos(e) * math.sin(a), 0.5 + 7 * math.sin(e), 7 * math.cos(e) * math.cos(a))
from scipy.ndimage import binary_fill_holes, label
total = 0
for name, loc in VIEWS.items():
    cam = bl.camera(name, loc, (0, 0.5, 0), 40)
    sc.camera = cam
    path = os.path.join(outdir, f'{name}.png')
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    px = np.array(img.pixels[:]).reshape(img.size[1], img.size[0], 4)[..., 0]
    bpy.data.images.remove(img)
    white = px > 0.5
    holes = binary_fill_holes(white) & ~white
    lab, n = label(holes)
    sizes = np.bincount(lab.ravel())[1:]
    big = int((sizes >= 4).sum())
    total += big
    print(f'seethru {name}: {big} holes, {int(sizes[sizes >= 4].sum()) if big else 0} px', flush=True)
print('seethru total holes', total)
