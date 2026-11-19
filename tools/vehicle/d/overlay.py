"""Draw the feature network over each grant drawing and measure line distances.

python3 overlay.py OUTDIR [view ...]
"""
import sys, os, importlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import net as N
from kernel_np import spline

VIEWS = {
    'side': ('view-004.png', N.to_side, lambda p: p[0] >= -1e-6),
    'top': ('view-003.png', N.to_top, lambda p: True),
    'front': ('view-006.png', N.to_front, lambda p: True),
    'rear': ('view-007.png', N.to_rear, lambda p: True),
}
COLORS = [(230, 30, 30), (20, 140, 30), (30, 60, 230), (200, 0, 200), (0, 160, 170), (230, 120, 0)]


def curves(netw, mirror=True):
    out = []
    for name, e in netw.edges.items():
        S = spline([netw.resolve(c) for c in e['ctrl']], spacing=0.005)
        out.append((name, e, S))
        if mirror and np.abs(S[:, 0]).max() > 1e-6:
            M = S.copy(); M[:, 0] *= -1
            out.append((name + '.R', e, M))
    return out


def run(netw, outdir, views=None, drawdir=None, scale=1.0, labels=True, only=None):
    drawdir = drawdir or os.environ.get('DRAWINGS', '/home/user/work/d')
    os.makedirs(outdir, exist_ok=True)
    stats = {}
    for view, (fname, proj, vis) in VIEWS.items():
        if views and view not in views:
            continue
        g = Image.open(os.path.join(drawdir, fname)).convert('L')
        ink = np.array(g) < 128
        dist = ndimage.distance_transform_edt(~ink)
        im = Image.merge('RGB', [g.point(lambda v: 150 + v * 105 // 255)] * 3)
        d = ImageDraw.Draw(im)
        font = ImageFont.load_default()
        ds = []
        for k, (name, e, S) in enumerate(curves(netw)):
            if only and not any(name.startswith(o) for o in only):
                continue
            if view == 'side' and name.endswith('.R'):
                continue
            if view == 'front' and S[:, 0].mean() < -1e-6 and not labels:
                pass
            pts = [proj(p) for p in S]
            col = COLORS[k % len(COLORS)] if e['kind'] != 'gap' else (255, 140, 0)
            d.line(pts, fill=col, width=2)
            if labels and not name.endswith('.R'):
                mid = pts[len(pts) // 2]
                d.text((mid[0] + 3, mid[1] + 3), name, fill=col, font=font)
            if not name.endswith('.R') or view in ('top',):
                P = np.array(pts)
                ok = (P[:, 0] >= 0) & (P[:, 0] < ink.shape[1] - 1) & (P[:, 1] >= 0) & (P[:, 1] < ink.shape[0] - 1)
                P = P[ok].astype(int)
                if len(P):
                    ds.append(dist[P[:, 1], P[:, 0]])
        if ds:
            a = np.concatenate(ds)
            mmpp = 1.8
            stats[view] = (a.mean() * mmpp, np.percentile(a, 95) * mmpp)
        if labels:
            for name, p in netw.points.items():
                q = proj(p)
                d.ellipse([q[0] - 3, q[1] - 3, q[0] + 3, q[1] + 3], outline=(0, 0, 0))
        if scale != 1.0:
            im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
        im.save(os.path.join(outdir, f'net-{view}.png'))
    return stats


if __name__ == '__main__':
    mod = importlib.import_module(os.environ.get('CAR', 'car'))
    netw = mod.network()
    st = run(netw, sys.argv[1], sys.argv[2:] or None)
    for k, (m, p95) in st.items():
        print(f'{k}: mean {m:.1f} mm, p95 {p95:.1f} mm')
