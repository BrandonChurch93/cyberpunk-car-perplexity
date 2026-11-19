# Vehicle D generator

Body surfaces come from an OpenCascade B-rep build (cadquery-ocp, run inside Blender 4.5 python): a 3D feature network traced from the design grant views (`car.py`, `net.py`) becomes B-spline edges, each facet a plate-filled face through its boundary curves, centerline facets one face across both halves, holes trimmed, the shell sewn and tessellated (`occ.py`). Blender adds crease bevels, wheels, liners and renders (`bl.py`, `parts.py`, `look.py`).

Checks, with `DRAWINGS` pointing at the folder holding `view-003.png` .. `view-008.png`:

- `python3 overlay.py OUT` network lines over each drawing, mean and 95th percentile distance in mm
- `python3 silhouette.py OUT [model.glb]` silhouette IoU per view
- `blender -b --python look.py -- OUT f34 side r34 zebra_f34` clay and zebra renders

Python for `occ.py` outside Blender needs `OCP` (cadquery-ocp) and scipy.
