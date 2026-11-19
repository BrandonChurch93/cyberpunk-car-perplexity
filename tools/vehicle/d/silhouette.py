"""Silhouette overlap per view against the grant drawings.

python3 silhouette.py OUTDIR [model.glb]   renders masks with Blender, then prints IoU for side, top, front, rear.
The drawing outline is the ink closed and filled from outside; both masks are cropped to their bounding
boxes and the model mask is resized onto the drawing's box, so only shape differences count."""
import os
import subprocess
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
DRAW = {'side': 'view-004.png', 'top': 'view-003.png', 'front': 'view-006.png', 'rear': 'view-007.png'}


def drawing_mask(path):
    ink = np.array(Image.open(path).convert('L')) < 160
    ink = ndimage.binary_dilation(ink, iterations=3)
    pad = np.pad(ink, 2)
    outside = ndimage.binary_fill_holes(pad) == 0
    filled = ~outside[2:-2, 2:-2]
    filled = ndimage.binary_erosion(filled, iterations=3)
    return ndimage.binary_fill_holes(filled)


def crop(m):
    ys, xs = np.nonzero(m)
    return m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def iou(model, drawing, out=None):
    d = crop(drawing)
    m = crop(model)
    m = np.array(Image.fromarray(m.astype(np.uint8) * 255).resize((d.shape[1], d.shape[0]), Image.BILINEAR)) > 127
    inter = (m & d).sum()
    union = (m | d).sum()
    if out:
        rgb = np.zeros(d.shape + (3,), np.uint8) + 255
        rgb[d & ~m] = (230, 60, 40)
        rgb[m & ~d] = (40, 90, 230)
        rgb[m & d] = (190, 190, 190)
        Image.fromarray(rgb).save(out)
    return inter / union


AXES = {'side': (lambda V: -V[:, 2], lambda V: -V[:, 1]), 'top': (lambda V: -V[:, 2], lambda V: V[:, 0]),
        'front': (lambda V: V[:, 0], lambda V: -V[:, 1]), 'rear': (lambda V: -V[:, 0], lambda V: -V[:, 1])}


def raster(tris, view, px_per_m=550):
    from PIL import ImageDraw
    V, T = tris['V'], tris['T']
    u, w = AXES[view][0](V), AXES[view][1](V)
    u = (u - u.min()) * px_per_m + 4
    w = (w - w.min()) * px_per_m + 4
    im = Image.new('L', (int(u.max()) + 8, int(w.max()) + 8), 0)
    d = ImageDraw.Draw(im)
    P = np.stack([u, w], 1)
    for t in P[T]:
        d.polygon([tuple(p) for p in t], fill=255)
    return np.array(im) > 127


def main():
    outdir = sys.argv[1]
    glb = sys.argv[2:3]
    drawings = os.environ.get('DRAWINGS', '/home/user/work/d')
    if not os.environ.get('NO_RENDER'):
        subprocess.run(['blender', '-b', '--python', os.path.join(HERE, 'masks.py'), '--', outdir] + glb, check=True,
                       stdout=subprocess.DEVNULL)
    tris = np.load(os.path.join(outdir, 'tris.npz'))
    res = {}
    for v, f in DRAW.items():
        mm = raster(tris, v)
        Image.fromarray(mm.astype(np.uint8) * 255).save(os.path.join(outdir, f'mask-{v}.png'))
        dm = drawing_mask(os.path.join(drawings, f))
        res[v] = iou(mm, dm, os.path.join(outdir, f'iou-{v}.png'))
    for v, r in res.items():
        print(f'{v}: IoU {r:.3f}')


if __name__ == '__main__':
    main()
