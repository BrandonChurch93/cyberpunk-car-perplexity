import type { V2, V3 } from './vec'

export type Surface = (u: number, v: number) => V3
/** Projection axis: the viewer sits on the positive side of this world axis. */
export type Axis = 'x' | 'y' | 'z' | '-z'

const axisIndex = { x: 0, y: 1, z: 2, '-z': 2 } as const
const axisSign = { x: 1, y: 1, z: 1, '-z': -1 } as const
const planeAxes = { x: [2, 1], y: [2, 0], z: [0, 1], '-z': [0, 1] } as const
const cell = 0.03

/** Finds surface parameters from projected drawing coordinates. */
export class SurfaceMap {
  private readonly pts: V3[] = []
  private readonly uvs: V2[] = []
  private readonly nu: number
  private readonly nv: number
  private readonly buckets = new Map<Axis, Map<string, number[]>>()

  constructor(
    readonly S: Surface,
    readonly u0: number,
    readonly u1: number,
    readonly v0: number,
    readonly v1: number,
    nu = 400,
    nv = 160,
  ) {
    this.nu = nu
    this.nv = nv
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        const u = u0 + ((u1 - u0) * i) / nu
        const v = v0 + ((v1 - v0) * j) / nv
        this.uvs.push([u, v])
        this.pts.push(S(u, v))
      }
    }
  }

  private bucket(axis: Axis): Map<string, number[]> {
    let g = this.buckets.get(axis)
    if (g) return g
    g = new Map()
    const [ia, ib] = planeAxes[axis]
    for (let k = 0; k < this.pts.length; k++) {
      const key = `${Math.floor(this.pts[k][ia] / cell)},${Math.floor(this.pts[k][ib] / cell)}`
      let l = g.get(key)
      if (!l) g.set(key, (l = []))
      l.push(k)
    }
    this.buckets.set(axis, g)
    return g
  }

  /** The (u, v) whose point projects to `a, b` along `axis` and is nearest the viewer. */
  invert(axis: Axis, a: number, b: number, window?: [number, number, number, number]): V2 {
    const [ia, ib] = planeAxes[axis]
    const ic = axisIndex[axis]
    const sign = axisSign[axis]
    let best = -1
    let bestScore = Infinity
    const reach = 0.03
    const grid = this.bucket(axis)
    const ca = Math.floor(a / cell)
    const cb = Math.floor(b / cell)
    const near: number[] = []
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) near.push(...(grid.get(`${ca + i},${cb + j}`) ?? []))
    for (const k of near) {
      const p = this.pts[k]
      const uv = this.uvs[k]
      if (window && (uv[0] < window[0] || uv[0] > window[1] || uv[1] < window[2] || uv[1] > window[3])) continue
      const d = Math.hypot(p[ia] - a, p[ib] - b)
      if (d > reach) continue
      const score = d - sign * p[ic] * 0.5
      if (score < bestScore) {
        bestScore = score
        best = k
      }
    }
    if (best < 0) {
      for (let k = 0; k < this.pts.length; k++) {
        const p = this.pts[k]
        const d = Math.hypot(p[ia] - a, p[ib] - b)
        if (d < bestScore) {
          bestScore = d
          best = k
        }
      }
    }
    let [u, v] = this.uvs[best]
    const h = 1e-5
    for (let it = 0; it < 20; it++) {
      const p = this.S(u, v)
      const pu = this.S(Math.min(this.u1, u + h), v)
      const pv = this.S(u, Math.min(this.v1, v + h))
      const ra = p[ia] - a
      const rb = p[ib] - b
      if (Math.hypot(ra, rb) < 1e-7) break
      const j11 = (pu[ia] - p[ia]) / h
      const j21 = (pu[ib] - p[ib]) / h
      const j12 = (pv[ia] - p[ia]) / h
      const j22 = (pv[ib] - p[ib]) / h
      const det = j11 * j22 - j12 * j21
      if (Math.abs(det) < 1e-12) break
      let du = (j22 * ra - j12 * rb) / det
      let dv = (-j21 * ra + j11 * rb) / det
      const lim = 0.02
      const m = Math.max(Math.abs(du), Math.abs(dv))
      if (m > lim) {
        du *= lim / m
        dv *= lim / m
      }
      u = Math.min(this.u1, Math.max(this.u0, u - du))
      v = Math.min(this.v1, Math.max(this.v0, v - dv))
    }
    void this.nu
    void this.nv
    return [u, v]
  }
}

/** A polygon with each corner rounded by a quadratic arc of up to `round` meters, sampled evenly. */
export function sample2(points: ReadonlyArray<readonly [number, number]>, step: number, closed: boolean, round = 0.03): V2[] {
  const n = points.length
  const dense: V2[] = []
  const at = (i: number): V2 => [points[(i + n) % n][0], points[(i + n) % n][1]]
  for (let i = 0; i < n; i++) {
    const p = at(i)
    if (!closed && (i === 0 || i === n - 1)) {
      dense.push(p)
      continue
    }
    const a = at(i - 1)
    const b = at(i + 1)
    const la = Math.hypot(a[0] - p[0], a[1] - p[1])
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1])
    const r = Math.min(round, la * 0.45, lb * 0.45)
    const pa: V2 = [p[0] + ((a[0] - p[0]) * r) / la, p[1] + ((a[1] - p[1]) * r) / la]
    const pb: V2 = [p[0] + ((b[0] - p[0]) * r) / lb, p[1] + ((b[1] - p[1]) * r) / lb]
    for (let k = 0; k <= 8; k++) {
      const t = k / 8
      dense.push([(1 - t) * (1 - t) * pa[0] + 2 * t * (1 - t) * p[0] + t * t * pb[0], (1 - t) * (1 - t) * pa[1] + 2 * t * (1 - t) * p[1] + t * t * pb[1]])
    }
  }
  if (closed) dense.push(dense[0])
  const acc: number[] = [0]
  for (let i = 1; i < dense.length; i++) acc.push(acc[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]))
  const L = acc[acc.length - 1]
  const m = Math.max(2, Math.ceil(L / step))
  const out: V2[] = []
  let j = 0
  for (let i = 0; i <= (closed ? m - 1 : m); i++) {
    const s = (L * i) / m
    while (j < acc.length - 2 && acc[j + 1] < s) j++
    const t = acc[j + 1] > acc[j] ? (s - acc[j]) / (acc[j + 1] - acc[j]) : 0
    out.push([dense[j][0] + (dense[j + 1][0] - dense[j][0]) * t, dense[j][1] + (dense[j + 1][1] - dense[j][1]) * t])
  }
  return out
}

/** A curve lying on the surface, kept both as parameters and as 3D points, with fast distance queries. */
export class SurfaceCurve {
  readonly uv: V2[]
  readonly p: V3[]
  readonly closed: boolean
  private readonly boxes: Array<{ lo: V3; hi: V3; i0: number; i1: number }> = []
  private readonly uvBox: [number, number, number, number]
  private readonly skip: boolean[]
  private readonly center: boolean

  constructor(S: Surface, uv: V2[], closed: boolean, skipCenter = false) {
    this.uv = uv
    this.closed = closed
    this.p = uv.map(([u, v]) => S(u, v))
    const n = this.segCount()
    this.skip = Array.from({ length: n }, (_, i) => skipCenter && Math.abs(this.p[i][0]) < 2e-3 && Math.abs(this.p[(i + 1) % this.p.length][0]) < 2e-3)
    this.center = this.skip.some(Boolean)
    for (let i0 = 0; i0 < n; i0 += 16) {
      const i1 = Math.min(n, i0 + 16)
      const lo: V3 = [Infinity, Infinity, Infinity]
      const hi: V3 = [-Infinity, -Infinity, -Infinity]
      for (let i = i0; i <= i1; i++) {
        const q = this.p[i % this.p.length]
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], q[k])
          hi[k] = Math.max(hi[k], q[k])
        }
      }
      this.boxes.push({ lo, hi, i0, i1 })
    }
    let a = Infinity
    let b = -Infinity
    let c = Infinity
    let d = -Infinity
    for (const [u, v] of uv) {
      a = Math.min(a, u)
      b = Math.max(b, u)
      c = Math.min(c, v)
      d = Math.max(d, v)
    }
    this.uvBox = [a, b, c, d]
  }

  private segCount(): number {
    return this.closed ? this.p.length : this.p.length - 1
  }

  /** Unsigned 3D distance, capped at `cap`. */
  distance(q: V3, cap = 1): number {
    let best = cap
    for (const b of this.boxes) {
      const dx = Math.max(b.lo[0] - q[0], 0, q[0] - b.hi[0])
      const dy = Math.max(b.lo[1] - q[1], 0, q[1] - b.hi[1])
      const dz = Math.max(b.lo[2] - q[2], 0, q[2] - b.hi[2])
      if (dx * dx + dy * dy + dz * dz >= best * best) continue
      for (let i = b.i0; i < b.i1; i++) {
        if (this.skip[i]) continue
        const d = segDist(q, this.p[i], this.p[(i + 1) % this.p.length])
        if (d < best) best = d
      }
    }
    return best
  }

  /** Whether (u, v) lies inside the closed curve. */
  inside(u: number, v: number): boolean {
    const [a, b, c, d] = this.uvBox
    // A curve closed along the centerline has its center run on the domain edge itself; a point on that edge belongs
    // to the region next to it, so it is tested a hair inboard instead of landing on the polygon edge.
    if (this.center && v >= d) v = d - 1e-7
    if (u < a || u > b || v < c || v > d) return false
    let ins = false
    const n = this.uv.length
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [ui, vi] = this.uv[i]
      const [uj, vj] = this.uv[j]
      if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) ins = !ins
    }
    return ins
  }

  /** Signed distance, negative inside. Closed curves only. */
  signed(u: number, v: number, q: V3, cap = 1): number {
    const d = this.distance(q, cap)
    return this.inside(u, v) ? -d : d
  }
}

function segDist(q: V3, a: V3, b: V3): number {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const abz = b[2] - a[2]
  const aqx = q[0] - a[0]
  const aqy = q[1] - a[1]
  const aqz = q[2] - a[2]
  const l2 = abx * abx + aby * aby + abz * abz
  let t = l2 > 0 ? (aqx * abx + aqy * aby + aqz * abz) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const dx = aqx - abx * t
  const dy = aqy - aby * t
  const dz = aqz - abz * t
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** Maps a drawn 2D curve onto the surface. Points are (a, b) in the projection plane of `axis`. */
export function projectCurve(map: SurfaceMap, axis: Axis, points: ReadonlyArray<readonly [number, number]>, closed: boolean, step = 0.01, window?: [number, number, number, number], skipCenter = false, round = 0.03): SurfaceCurve {
  const flat = sample2(points, step, closed, round)
  const uv = flat.map(([a, b]) => map.invert(axis, a, b, window))
  return new SurfaceCurve(map.S, uv, closed, skipCenter)
}

/** Smooth max for combining removal fields, radius r. */
export function smax(a: number, b: number, r: number): number {
  const h = Math.max(r - Math.abs(a - b), 0) / r
  return Math.max(a, b) + (h * h * r) / 4
}

/** Smooth min, radius r. */
export function smin(a: number, b: number, r: number): number {
  return -smax(-a, -b, r)
}
