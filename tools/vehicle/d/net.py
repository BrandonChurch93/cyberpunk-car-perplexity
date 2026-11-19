"""Feature network: named 3D points solved from drawing reads, edges through them, facets bounded by edges."""
import numpy as np

L, W, H = 4.947, 2.266, 1.160


def side(px, py):
    return {'z': L / 2 - px * L / 2746, 'y': (654 - py) * H / 654}


def top(px, py):
    return {'z': L / 2 - px * L / 2746, 'x': (py - 630.5) * W / 1261}


def front(px, py):
    return {'x': (px - 711.5) * W / 1423, 'y': (738 - py) * H / 738}


def rear(px, py):
    return {'x': -(px - 712) * W / 1424, 'y': (738 - py) * H / 738}


def to_side(p):
    return ((L / 2 - p[2]) * 2746 / L, 654 - p[1] * 654 / H)


def to_top(p):
    return ((L / 2 - p[2]) * 2746 / L, 630.5 + p[0] * 1261 / W)


def to_front(p):
    return (711.5 + p[0] * 1423 / W, 738 - p[1] * 738 / H)


def to_rear(p):
    return (712 - p[0] * 1424 / W, 738 - p[1] * 738 / H)


class Network:
    def __init__(self):
        self.points = {}
        self.reads = {}
        self.edges = {}
        self.facets = []
        self.cuts = []

    def P(self, name, s=None, t=None, f=None, r=None, x=None, y=None, z=None):
        acc = {'x': [], 'y': [], 'z': []}
        reads = {}
        for key, fn, val in (('side', side, s), ('top', top, t), ('front', front, f), ('rear', rear, r)):
            if val is not None:
                reads[key] = val
                for k, v in fn(*val).items():
                    acc[k].append(v)
        for k, v in (('x', x), ('y', y), ('z', z)):
            if v is not None:
                acc[k] = [v]
        missing = [k for k in 'xyz' if not acc[k]]
        if missing:
            raise ValueError(f'point {name} lacks {missing}')
        p = np.array([np.mean(acc['x']), np.mean(acc['y']), np.mean(acc['z'])])
        self.points[name] = p
        self.reads[name] = reads
        return p

    def at(self, name, **kw):
        p = self.points[name].copy()
        for k, v in kw.items():
            p['xyz'.index(k)] = v
        return p

    def E(self, name, ctrl, kind='crease', spacing=None):
        self.edges[name] = {'ctrl': ctrl, 'kind': kind, 'spacing': spacing}

    def F(self, name, loop, mat='paint', obj='body', crown=0.0, sp=0.012, hint=None, holes=(), smooth=1):
        self.facets.append({'name': name, 'loop': loop, 'mat': mat, 'obj': obj, 'crown': crown, 'sp': sp, 'hint': hint, 'holes': holes, 'smooth': smooth})

    def resolve(self, c):
        if isinstance(c, str):
            return self.points[c]
        return np.asarray(c, float)


def _chain_points(net, loop):
    ends = [(net.edges[e]['ctrl'][0], net.edges[e]['ctrl'][-1]) for e in loop]
    a, b = ends[0]
    if b not in ends[1]:
        a, b = b, a
    pts, flip = [a], [a != ends[0][0]]
    cur = b
    for e, (p, q) in zip(loop[1:], ends[1:]):
        pts.append(cur)
        if p == cur:
            flip.append(False); cur = q
        else:
            flip.append(True); cur = p
    return pts, flip


def recess(net, name, loop, depth, mat='dark', obj='body', back_crown=0.0, hint=None, sp=0.012, back_mat=None):
    """Push a closed opening back by depth (vector or function of the point): walls plus a back face."""
    pts, flip = _chain_points(net, loop)
    off = depth if callable(depth) else (lambda p, d=np.asarray(depth, float): d)
    for p in pts:
        q = net.points[p]
        net.points[f'{name}~{p}'] = q + off(q)
        net.E(f'{name}~c~{p}', [p, f'{name}~{p}'], kind='crease')
    back = []
    for e in loop:
        ctrl = net.edges[e]['ctrl']
        nc = []
        for c in ctrl:
            if isinstance(c, str):
                nc.append(f'{name}~{c}')
            else:
                c = np.asarray(c, float)
                nc.append(c + off(c))
        net.E(f'{name}~{e}', nc, kind='crease')
        back.append(f'{name}~{e}')
        a, b = ctrl[0], ctrl[-1]
        net.F(f'{name}~wall~{e}', [e, f'{name}~c~{b}', f'{name}~{e}', f'{name}~c~{a}'], mat=mat, obj=obj, sp=sp)
    net.F(f'{name}~back', back, mat=back_mat or mat, obj=obj, crown=back_crown, hint=hint, sp=sp)
    return back


def full(net):
    """Whole car network: left half plus its mirror; facets crossing the centerline become one face with the centerline as an inner constraint."""
    out = Network()
    on = lambda c: abs(net.resolve(c)[0]) < 1e-9
    mname = lambda n: n if on(n) else n + '.R'
    for n, p in net.points.items():
        out.points[n] = p
        if abs(p[0]) >= 1e-9:
            q = p.copy(); q[0] = -q[0]
            out.points[n + '.R'] = q
    def mctrl(c):
        if isinstance(c, str):
            return mname(c)
        q = np.asarray(c, float).copy(); q[0] = -q[0]
        return q
    center = set()
    for n, e in net.edges.items():
        out.edges[n] = dict(e)
        if all(on(c) for c in e['ctrl']):
            center.add(n)
        else:
            out.edges[n + '.R'] = dict(e, ctrl=[mctrl(c) for c in e['ctrl']])
    m = lambda loop: [e if e in center else e + '.R' for e in loop]
    for f in net.facets:
        if all(e in center for e in f['loop']):
            continue
        cen = [e for e in f['loop'] if e in center]
        hint = f['hint']
        mh = None if hint is None else (-hint[0], hint[1], hint[2])
        if cen:
            rest = [e for e in f['loop'] if e not in center]
            holes = []
            for h in f['holes']:
                if any(e in center for e in h):
                    holes.append([e for e in h if e not in center] + [e + '.R' for e in h if e not in center])
                else:
                    holes += [list(h), m(h)]
            out.facets.append(dict(f, loop=rest + m(rest), holes=holes, inner=cen, crown=0.0, mirror=False))
        else:
            out.facets.append(dict(f, inner=[], mirror=False))
            out.facets.append(dict(f, name=f['name'] + '.R', loop=m(f['loop']), holes=[m(h) for h in f['holes']], hint=mh, inner=[]))
    return out
