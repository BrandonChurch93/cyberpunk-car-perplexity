"""Render the exported car from solved photo cameras: blender -b --python match.py -- GLB OUTDIR CAM.json ..."""
import os
import sys
import json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy
import numpy as np
import bl

argv = sys.argv[sys.argv.index('--') + 1:]
glb, outdir, cams = argv[0], argv[1], argv[2:]
os.makedirs(outdir, exist_ok=True)
bl.reset()
bpy.ops.import_scene.gltf(filepath=glb)
bl.mirror_wheels()
COL = {'paint': ((0.75, 0.22, 0.05), 0.25, 0.0), 'black': ((0.03, 0.03, 0.03), 0.5, 0.0), 'glass': ((0.02, 0.02, 0.025), 0.05, 0.0),
       'dark': ((0.01, 0.01, 0.01), 0.7, 0.0), 'tire': ((0.02, 0.02, 0.02), 0.8, 0.0), 'rim': ((0.18, 0.18, 0.19), 0.3, 1.0),
       'disc': ((0.2, 0.2, 0.2), 0.4, 1.0), 'caliper': ((0.1, 0.1, 0.1), 0.4, 0.0), 'carbon': ((0.04, 0.04, 0.045), 0.3, 0.0),
       'optics': ((0.6, 0.6, 0.65), 0.05, 1.0), 'hot': ((0.15, 0.15, 0.15), 0.4, 1.0), 'chrome': ((0.8, 0.8, 0.8), 0.1, 1.0), 'matte': ((0.025, 0.025, 0.025), 0.6, 0.0),
       'emitter': ((0.9, 0.9, 0.9), 0.2, 0.0), 'mirror': ((0.7, 0.7, 0.7), 0.05, 1.0), 'engine': ((0.05, 0.05, 0.05), 0.5, 0.5)}
for m in bpy.data.materials:
    if not m.node_tree or 'Principled BSDF' not in m.node_tree.nodes:
        continue
    bs = m.node_tree.nodes['Principled BSDF']
    key = next((k for k in COL if m.name.startswith(k)), None)
    if key:
        c, r, mt = COL[key]
        bs.inputs['Base Color'].default_value = (*c, 1)
        bs.inputs['Roughness'].default_value = r
        bs.inputs['Metallic'].default_value = mt
    if key == 'glass':
        bs.inputs['Alpha'].default_value = 1.0
bl.world_clay(float(os.environ.get('WORLD', '1.0')))
for cj in cams:
    mj = json.load(open(cj))
    tgt = mj.get('target') or list(np.add(mj['cam'], np.multiply(mj['fwd'], 5)))
    if 'ortho' in mj:
        c = bl.camera('m', mj['cam'], tgt, ortho=mj['ortho'])
        w = mj['W']
    else:
        c = bl.camera('m', mj['cam'], tgt, mj['f'] / mj['W'] * 36)
        w = int(os.environ.get('W', '1200'))
    name = os.path.basename(cj).replace('-cam.json', '')
    bl.render(os.path.join(outdir, name + '.png'), c, w, int(mj['H'] * w / mj['W']), int(os.environ.get('SAMPLES', '24')))
