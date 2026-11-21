import type { SurfaceMap } from '../geom/cuts'
import { MeshBuilder } from '../geom/mesh'
import { add, cross, dot, norm, scale, sub, type V3 } from '../geom/vec'

/**
 * A closed solid swept between rows of equal length: every row is a closed loop, and the last row joins the first.
 * Rows marked sharp get a crease; the others share one normal across both neighbouring strips.
 * The result is wound and shaded outward whatever the order of the rows.
 */
export function solid(rows: V3[][], sharp: boolean[], closedRows = true, closedLoop = true): MeshBuilder {
  const b = new MeshBuilder()
  const nr = rows.length
  const m = rows[0].length
  const at = (i: number): V3[] => rows[((i % nr) + nr) % nr]
  const strips = closedRows ? nr : nr - 1
  const isSharp = (i: number): boolean => (!closedRows && (i === 0 || i === nr - 1)) || sharp[((i % nr) + nr) % nr]
  const normalAt = (i: number, j: number, s: number): V3 => {
    const r = at(i)
    const dj = closedLoop ? sub(r[(j + 1) % m], r[(j - 1 + m) % m]) : sub(r[Math.min(m - 1, j + 1)], r[Math.max(0, j - 1)])
    const prev = isSharp(i) && i === s + 1 ? s : i - 1
    const next = isSharp(i) && i === s ? s + 1 : i + 1
    const a = isSharp(i) && i === s ? r[j] : at(prev)[j]
    const c = isSharp(i) && i === s + 1 ? r[j] : at(next)[j]
    let n = cross(dj, sub(c, a))
    if (dot(n, n) < 1e-18) {
      const rk = at(i === s ? s + 1 : s)
      n = cross(closedLoop ? sub(rk[(j + 1) % m], rk[(j - 1 + m) % m]) : sub(rk[Math.min(m - 1, j + 1)], rk[Math.max(0, j - 1)]), sub(c, a))
    }
    return norm(n)
  }
  for (let s = 0; s < strips; s++) {
    const base = b.pos.length / 3
    for (const i of [s, s + 1]) for (let j = 0; j < m; j++) b.vertex(at(i)[j], normalAt(i, j, s), j / m, i / nr)
    for (let j = 0; j < (closedLoop ? m : m - 1); j++) {
      const j1 = (j + 1) % m
      b.quad(base + j, base + j1, base + m + j1, base + m + j)
    }
  }
  if (!closedLoop) {
    let score = 0
    for (let k = 0; k < b.pos.length / 3; k++) {
      const j = k % m
      const ring = rows.map((r) => r[j])
      const c: V3 = [0, 0, 0]
      for (const p of ring) for (let q = 0; q < 3; q++) c[q] += p[q] / ring.length
      score += dot([b.nor[3 * k], b.nor[3 * k + 1], b.nor[3 * k + 2]], sub([b.pos[3 * k], b.pos[3 * k + 1], b.pos[3 * k + 2]], c))
    }
    if (score < 0) {
      for (let t = 0; t < b.idx.length; t += 3) [b.idx[t + 1], b.idx[t + 2]] = [b.idx[t + 2], b.idx[t + 1]]
      for (let k = 0; k < b.nor.length; k++) b.nor[k] = -b.nor[k]
    }
    for (const [j, sign] of [[0, -1], [m - 1, 1]] as const) {
      const ring = rows.map((r) => r[j])
      const c: V3 = [0, 0, 0]
      for (const p of ring) for (let k = 0; k < 3; k++) c[k] += p[k] / ring.length
      const t = sub(rows[0][Math.min(m - 1, j + 1)], rows[0][Math.max(0, j - 1)])
      const n = norm([t[0] * sign, t[1] * sign, t[2] * sign])
      const base = b.pos.length / 3
      const ci = b.vertex(c, n)
      for (const p of ring) b.vertex(p, n)
      for (let i = 0; i < ring.length; i++) {
        const a = base + 1 + i
        const d = base + 1 + ((i + 1) % ring.length)
        if (dot(cross(sub(ring[i], c), sub(ring[(i + 1) % ring.length], c)), n) >= 0) b.tri(ci, a, d)
        else b.tri(ci, d, a)
      }
    }
    return b
  }
  return orient(b)
}

/** Flips a closed mesh whose signed volume is negative. */
export function orient(b: MeshBuilder): MeshBuilder {
  let v = 0
  const p = (k: number): V3 => [b.pos[3 * k], b.pos[3 * k + 1], b.pos[3 * k + 2]]
  for (let t = 0; t < b.idx.length; t += 3) v += dot(p(b.idx[t]), cross(p(b.idx[t + 1]), p(b.idx[t + 2])))
  if (v >= 0) return b
  for (let t = 0; t < b.idx.length; t += 3) [b.idx[t + 1], b.idx[t + 2]] = [b.idx[t + 2], b.idx[t + 1]]
  for (let k = 0; k < b.nor.length; k++) b.nor[k] = -b.nor[k]
  return b
}

/** Appends one builder's mesh to another. */
export function merge(into: MeshBuilder, from: MeshBuilder): void {
  const base = into.pos.length / 3
  for (let k = 0; k < from.pos.length / 3; k++) into.vertex([from.pos[3 * k], from.pos[3 * k + 1], from.pos[3 * k + 2]], [from.nor[3 * k], from.nor[3 * k + 1], from.nor[3 * k + 2]], from.uv[2 * k], from.uv[2 * k + 1])
  for (const i of from.idx) into.idx.push(base + i)
}

/** Outward unit normal of the tail face under a point, facing the rear. */
export function tailNormal(rm: SurfaceMap, p: V3): V3 {
  const S = rm.S
  const [u, v] = rm.invert('-z', p[0], p[1])
  const h = 1e-4
  const n = norm(cross(sub(S(Math.min(1, u + h), v), S(Math.max(0, u - h), v)), sub(S(u, Math.min(1, v + h)), S(u, Math.max(0, v - h)))))
  return n[2] > 0 ? [-n[0], -n[1], -n[2]] : n
}

/** A closed bar of rounded rectangular section along a path on the tail, set into it by `depth` at its front face. */
export function bar(rm: SurfaceMap, path: V3[], height: number, thick: number, depth: number, corner: number): MeshBuilder {
  const sec: Array<[number, number]> = []
  const k = 4
  const hw = height / 2 - corner
  const ht = thick / 2 - corner
  const centres: Array<[number, number, number]> = [[hw, ht, 0], [-hw, ht, Math.PI / 2], [-hw, -ht, Math.PI], [hw, -ht, Math.PI * 1.5]]
  for (const [cx, cy, a0] of centres) for (let i = 0; i <= k; i++) {
    const a = a0 + (Math.PI / 2) * (i / k)
    sec.push([cx + corner * Math.cos(a), cy + corner * Math.sin(a)])
  }
  const frames = path.map((p, j) => {
    const n = tailNormal(rm, p)
    const t = sub(path[Math.min(path.length - 1, j + 1)], path[Math.max(0, j - 1)])
    const h = norm(cross(n, t))
    return { p, n, h }
  })
  const rows = sec.map(([s, d]) => frames.map((f) => add(add(f.p, scale(f.h, s)), scale(f.n, -(depth + thick / 2) + d))))
  return solid(rows, sec.map(() => false), true, false)
}
