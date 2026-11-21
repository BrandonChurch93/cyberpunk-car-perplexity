import type { SurfaceCurve } from '../geom/cuts'
import type { Boundary, TessResult } from '../geom/tessellate'
import { add, cross, norm, scale, sub, type V3 } from '../geom/vec'

/** Half the shut gap between the panel walls, and the roll radius of the panel edges either side of it. The gap is an
 * open 4 mm slot between two returned panel edges; the roll is a pressed edge, small enough that the slot reads as a
 * gap and not a groove, and still a lit line a few pixels wide in the macro at 0.75 m. */
export const gapHalf = 0.002
export const gapRoll = 0.0015
/** Depth of the panel walls returned into each shut gap: the flange a panel edge turns down, 8 to 12 mm on a car. */
export const gapDepth = 0.011

/** Edge rolls set per shut line; a line without one rolls over gapRoll. */
const rolls = new WeakMap<SurfaceCurve, number>()
export function withRoll(c: SurfaceCurve, roll: number): SurfaceCurve {
  rolls.set(c, roll)
  return c
}
const rollOf = (c: SurfaceCurve): number => rolls.get(c) ?? gapRoll

/** Positive inside the band cut out of the paint along the shut lines: the paint edge sits gapHalf + gapRoll off each line. */
export function gapCut(gaps: SurfaceCurve[]): (p: V3) => number {
  return (p) => {
    let d = -1
    for (const g of gaps) d = Math.max(d, gapHalf + rollOf(g) - g.distance(p, 0.3))
    return d
  }
}

/** True on the paint edge of a shut gap. */
export function onGapEdge(gaps: SurfaceCurve[], tol = 0.001): (p: V3) => boolean {
  return (p) => gaps.some((g) => g.distance(p, 0.02) < gapHalf + rollOf(g) + tol)
}

/** The tessellated parts with every boundary run along a shut gap removed, so a flange is not built there twice. */
export function withoutGapEdges(parts: TessResult[], near: (p: V3) => boolean): TessResult[] {
  return parts.map((t) => {
    const boundaries: Boundary[] = []
    for (const b of t.boundaries) {
      const n = b.points.length
      const keep = b.points.map((p) => !near(p))
      if (keep.every(Boolean)) {
        boundaries.push(b)
        continue
      }
      const start = b.closed ? keep.indexOf(false) : 0
      let run: number[] = []
      const flush = (): void => {
        if (run.length > 1) boundaries.push({ points: run.map((i) => b.points[i]), normals: run.map((i) => b.normals[i]), uv: run.map((i) => b.uv[i]), closed: false })
        run = []
      }
      for (let k = 0; k < n; k++) {
        const i = b.closed ? (start + k) % n : k
        if (keep[i]) run.push(i)
        else flush()
      }
      flush()
    }
    return { ...t, boundaries }
  })
}

export function resample(c: SurfaceCurve, step: number): { p: V3[]; uv: Array<[number, number]> } {
  const P: V3[] = []
  const UV: Array<[number, number]> = []
  c.p.forEach((q, i) => {
    const r = P[P.length - 1]
    if (r && Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2]) < 1e-6) return
    P.push(q)
    UV.push(c.uv[i] as [number, number])
  })
  if (c.closed && P.length > 2 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1], P[0][2] - P[P.length - 1][2]) < 1e-6) {
    P.pop()
    UV.pop()
  }
  const n = P.length
  const m = c.closed ? n : n - 1
  const p: V3[] = []
  const uv: Array<[number, number]> = []
  const at = (i: number): number => (c.closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i)))
  for (let i = 0; i < m; i++) {
    const a = P[at(i - 1)]
    const b = P[at(i)]
    const d = P[at(i + 1)]
    const e = P[at(i + 2)]
    const len = Math.hypot(d[0] - b[0], d[1] - b[1], d[2] - b[2])
    const k = Math.max(1, Math.ceil(len / step))
    for (let j = 0; j < k; j++) {
      const t = j / k
      const t2 = t * t
      const t3 = t2 * t
      const w = [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2]
      p.push([0, 1, 2].map((q) => w[0] * a[q] + w[1] * b[q] + w[2] * d[q] + w[3] * e[q]) as V3)
      const ua = UV[at(i)]
      const ub = UV[at(i + 1)]
      uv.push([ua[0] + (ub[0] - ua[0]) * t, ua[1] + (ub[1] - ua[1]) * t])
    }
  }
  if (!c.closed) {
    p.push(P[n - 1])
    uv.push(UV[n - 1])
  }
  return { p, uv }
}

/**
 * One recessed channel along every shut gap, built on the paint's own edge vertices so the lips and the panel share
 * them: each edge rolls over `gapRoll` into a wall `gapHalf` off the line, down to `depth`, onto a floor that runs just
 * past the line. The floor is returned apart so it can take a dark finish.
 */
export function gapChannel(parts: TessResult[], gaps: SurfaceCurve[], depth = gapDepth): { lips: TessResult; floor: TessResult } {
  const lips: TessResult = { positions: [], normals: [], uvs: [], indices: [], boundaries: [] }
  const floor: TessResult = { positions: [], normals: [], uvs: [], indices: [], boundaries: [] }
  const push = (t: TessResult, p: V3, n: V3, uv: [number, number]): number => {
    t.positions.push(p[0], p[1], p[2])
    t.normals.push(n[0], n[1], n[2])
    t.uvs.push(uv[0], uv[1])
    return t.positions.length / 3 - 1
  }
  const near = onGapEdge(gaps)
  const lines = gaps.map((g) => resample(g, 0.002).p)
  const closest = (q: V3): V3 => {
    let best: V3 = q
    let bd = Infinity
    for (const L of lines) {
      for (let i = 0; i + 1 < L.length; i++) {
        const a = L[i]
        const e = sub(L[i + 1], a)
        const ee = e[0] * e[0] + e[1] * e[1] + e[2] * e[2]
        const w = sub(q, a)
        const t = ee > 0 ? Math.max(0, Math.min(1, (w[0] * e[0] + w[1] * e[1] + w[2] * e[2]) / ee)) : 0
        const c = add(a, scale(e, t))
        const d = dist(c, q)
        if (d < bd) {
          bd = d
          best = c
        }
      }
    }
    return best
  }
  // Each run takes the roll of the shut line it lies along, cut in steps of at most 15 degrees.
  const strip = (pts: V3[], nor: V3[], uv: Array<[number, number]>, closed: boolean): void => {
    const n = pts.length
    const mid = pts[n >> 1]
    let roll = gapRoll
    let rd = Infinity
    for (const g of gaps) {
      const d = g.distance(mid, 0.05)
      if (d < rd) {
        rd = d
        roll = rollOf(g)
      }
    }
    const steps = Math.max(6, Math.ceil(roll / 0.0005))
    const reach = (i: number, dir: number): V3 => {
      let j = i
      let l = 0
      for (let k = 0; k < n && l < 0.0015; k++) {
        const nj = closed ? (j + dir + n) % n : j + dir
        if (nj < 0 || nj >= n) break
        l += dist(pts[j], pts[nj])
        j = nj
      }
      return pts[j]
    }
    const lipRows: number[][] = []
    const floorRows: number[][] = []
    for (let i = 0; i < n; i++) {
      const N = nor[i]
      const t = norm(sub(reach(i, 1), reach(i, -1)))
      const b = norm(cross(t, N))
      const row: number[] = []
      for (let k = 0; k <= steps; k++) {
        const th = (k / steps) * (Math.PI / 2)
        row.push(push(lips, add(add(pts[i], scale(b, roll * Math.sin(th))), scale(N, -roll * (1 - Math.cos(th)))), norm(add(scale(N, Math.cos(th)), scale(b, Math.sin(th)))), uv[i]))
      }
      const foot = add(add(pts[i], scale(b, roll)), scale(N, -depth))
      row.push(push(lips, foot, b, uv[i]))
      lipRows.push(row)
      const inner = add(closest(pts[i]), scale(N, -depth))
      floorRows.push([push(floor, foot, N, uv[i]), push(floor, inner, N, uv[i])])
    }
    const m = closed ? n : n - 1
    const P = (t: TessResult, i: number): V3 => [t.positions[i * 3], t.positions[i * 3 + 1], t.positions[i * 3 + 2]]
    const face = (t: TessResult, a: number, b: number, c: number): void => {
      const [pa, pb, pc] = [P(t, a), P(t, b), P(t, c)]
      const x = cross(sub(pb, pa), sub(pc, pa))
      let s = 0
      for (const i of [a, b, c]) s += x[0] * t.normals[i * 3] + x[1] * t.normals[i * 3 + 1] + x[2] * t.normals[i * 3 + 2]
      if (s > 0 && Math.min(dist(pa, pb), dist(pb, pc), dist(pc, pa)) > 2e-5) t.indices.push(a, b, c)
    }
    for (const [rows, t] of [[lipRows, lips], [floorRows, floor]] as const) {
      for (let i = 0; i < m; i++) {
        const r0 = rows[i]
        const r1 = rows[(i + 1) % n]
        for (let k = 0; k + 1 < r0.length; k++) {
          face(t, r0[k], r1[k + 1], r1[k])
          face(t, r0[k], r0[k + 1], r1[k + 1])
        }
      }
    }
  }
  for (const t of parts) {
    for (const b of t.boundaries) {
      const n = b.points.length
      const on = b.points.map((p) => near(p))
      if (!on.some(Boolean)) continue
      const all = on.every(Boolean)
      const runs: number[][] = []
      if (all && b.closed) runs.push(b.points.map((_, i) => i))
      else {
        const start = b.closed ? on.indexOf(false) : 0
        let run: number[] = []
        for (let k = 0; k <= n; k++) {
          const i = b.closed ? (start + k) % n : k
          if (k < n && on[i]) run.push(i)
          else if (run.length) {
            const lo = b.closed ? (run[0] - 1 + n) % n : Math.max(0, run[0] - 1)
            const hi = b.closed ? (run[run.length - 1] + 1) % n : Math.min(n - 1, run[run.length - 1] + 1)
            runs.push([...(lo !== run[0] ? [lo] : []), ...run, ...(hi !== run[run.length - 1] ? [hi] : [])])
            run = []
          }
        }
      }
      for (const r of runs) {
        const idx = thin(r.map((i) => b.points[i])).map((j) => r[j])
        if (idx.length < 2) continue
        const closed = all && b.closed
        strip(idx.map((i) => b.points[i]), idx.map((i) => b.normals[i]), idx.map((i) => b.uv[i] as [number, number]), closed)
      }
    }
  }
  return { lips, floor }
}

/** Indices of a polyline with points at least `gap` apart and no turn sharper than 120 degrees. */
function thin(p: V3[], gap = 0.0005): number[] {
  const keep: number[] = [0]
  for (let i = 1; i < p.length; i++) {
    if (dist(p[i], p[keep[keep.length - 1]]) >= gap) keep.push(i)
    else if (i === p.length - 1 && keep.length > 1) keep[keep.length - 1] = i
  }
  for (let changed = true; changed && keep.length > 2; ) {
    changed = false
    for (let j = 1; j + 1 < keep.length; j++) {
      const a = norm(sub(p[keep[j]], p[keep[j - 1]]))
      const b = norm(sub(p[keep[j + 1]], p[keep[j]]))
      if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < -0.5) {
        keep.splice(j, 1)
        changed = true
        break
      }
    }
  }
  return keep
}

const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/**
 * Per-vertex gap mask for a paint mesh built by toGeometry(parts, mirror): 1 on the rolled edges and walls of every shut
 * gap, easing to 0 over the 3 mm of panel beside each edge. Water and other surface layers read it to keep clear of
 * the gaps. Values follow toGeometry's vertex order, each part then its mirror.
 */
export function gapMask(parts: TessResult[], walls: TessResult, gaps: SurfaceCurve[], mirror: boolean): Float32Array {
  const count = parts.reduce((n, t) => n + (t.positions.length / 3) * (mirror ? 2 : 1), 0)
  const out = new Float32Array(count)
  const ease = 0.003
  let o = 0
  for (const t of parts) {
    const n = t.positions.length / 3
    const m = new Float32Array(n)
    if (t === walls) m.fill(1)
    else {
      for (let i = 0; i < n; i++) {
        const p: V3 = [t.positions[i * 3], t.positions[i * 3 + 1], t.positions[i * 3 + 2]]
        let v = 0
        for (const g of gaps) {
          const edge = gapHalf + rollOf(g)
          const d = g.distance(p, edge + ease)
          if (d < edge + ease) v = Math.max(v, d <= edge + 0.0002 ? 1 : 1 - (d - edge) / ease)
        }
        m[i] = v
      }
    }
    out.set(m, o)
    o += n
    if (mirror) {
      out.set(m, o)
      o += n
    }
  }
  return out
}
