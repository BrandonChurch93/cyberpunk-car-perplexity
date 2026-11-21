import type { Surface, SurfaceCurve } from '../geom/cuts'
import type { Boundary, TessResult, TrimFn } from '../geom/tessellate'
import { add, cross, norm, scale, sub, type V3 } from '../geom/vec'
import { surfaceNormal } from './body'

/** Half the shut gap between the panel walls, and the roll radius of the panel edges either side of it. */
export const gapHalf = 0.002
export const gapRoll = 0.002

/** Positive inside the band cut out of the paint along the shut lines: the paint edge sits gapHalf + gapRoll off each line. */
export function gapCut(gaps: SurfaceCurve[]): (p: V3) => number {
  return (p) => {
    let d = -1
    for (const g of gaps) d = Math.max(d, gapHalf + gapRoll - g.distance(p, 0.3))
    return d
  }
}

/** True on the paint edge of a shut gap. */
export function onGapEdge(gaps: SurfaceCurve[], tol = 0.001): (p: V3) => boolean {
  return (p) => gaps.some((g) => g.distance(p, 0.02) < gapHalf + gapRoll + tol)
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
  const P = c.p
  const UV = c.uv
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
 * The two walls of every shut gap, swept along the line itself so the gap keeps one width through every turn: each paint
 * edge rolls over `gapRoll` into a wall `gapHalf` off the line that runs down to `depth`. `removed` is the paint trim
 * without the gaps (positive where there is no paint); the walls stop where it is.
 */
export function gapLips(S: Surface, gaps: SurfaceCurve[], removed: TrimFn, depth = 0.013, step = 0.005): TessResult {
  const out: TessResult = { positions: [], normals: [], uvs: [], indices: [], boundaries: [] }
  const push = (p: V3, n: V3, uv: [number, number]): number => {
    out.positions.push(p[0], p[1], p[2])
    out.normals.push(n[0], n[1], n[2])
    out.uvs.push(uv[0], uv[1])
    return out.positions.length / 3 - 1
  }
  const steps = 3
  for (const g of gaps) {
    const { p: C, uv: UV } = resample(g, step)
    const n = C.length
    for (const s of [1, -1]) {
      const rows: Array<number[] | null> = []
      for (let i = 0; i < n; i++) {
        const a = C[g.closed ? (i - 1 + n) % n : Math.max(0, i - 1)]
        const c = C[g.closed ? (i + 1) % n : Math.min(n - 1, i + 1)]
        const t = norm(sub(c, a))
        const nn = surfaceNormal(S, UV[i][0], UV[i][1])
        const b = scale(norm(cross(nn, t)), s)
        const edge = add(C[i], scale(b, gapHalf + gapRoll))
        if (removed(UV[i][0], UV[i][1], edge) > 0) {
          rows.push(null)
          continue
        }
        const row: number[] = []
        for (let k = 0; k <= steps; k++) {
          const th = (k / steps) * (Math.PI / 2)
          const w = gapHalf + gapRoll * (1 - Math.sin(th))
          const dn = gapRoll * (1 - Math.cos(th))
          row.push(push(add(add(C[i], scale(b, w)), scale(nn, -dn)), norm(add(scale(nn, Math.cos(th)), scale(b, -Math.sin(th)))), UV[i]))
        }
        row.push(push(add(add(C[i], scale(b, gapHalf)), scale(nn, -depth)), scale(b, -1), UV[i]))
        rows.push(row)
      }
      const m = g.closed ? n : n - 1
      for (let i = 0; i < m; i++) {
        const r0 = rows[i]
        const r1 = rows[(i + 1) % n]
        if (!r0 || !r1) continue
        for (let k = 0; k + 1 < r0.length; k++) {
          if (s < 0) out.indices.push(r0[k], r1[k], r1[k + 1], r0[k], r1[k + 1], r0[k + 1])
          else out.indices.push(r0[k], r0[k + 1], r1[k + 1], r0[k], r1[k + 1], r1[k])
        }
      }
    }
  }
  return out
}
