"""Triangles of a glb or of the live build in film coordinates, for silhouettes: blender -b --python masks.py -- OUTDIR [model.glb]"""
import os
import sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy
import bl

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
outdir = argv[0]
os.makedirs(outdir, exist_ok=True)
bl.reset()
if len(argv) > 1:
    bpy.ops.import_scene.gltf(filepath=argv[1])
else:
    import importlib
    import occ
    import parts
    car = importlib.import_module(os.environ.get('CAR', 'car'))
    NET = car.network()
    for name, o in occ.build(NET).items():
        bl.mesh_object(name, o['V'], o['T'], o['mats'], o['crease'], bevel=0)
    parts.all_parts(NET)

dg = bpy.context.evaluated_depsgraph_get()
V, T, n = [], [], 0
for ob in bpy.context.scene.objects:
    if ob.type != 'MESH':
        continue
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    import numpy as np
    co = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    M = np.array(ob.matrix_world)
    co = co @ M[:3, :3].T + M[:3, 3]
    tri = np.zeros(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get('vertices', tri)
    V.append(np.stack([co[:, 0], co[:, 2], -co[:, 1]], 1))
    T.append(tri.reshape(-1, 3) + n)
    n += len(co)
    ev.to_mesh_clear()
np.savez(os.path.join(outdir, 'tris.npz'), V=np.vstack(V), T=np.vstack(T))
