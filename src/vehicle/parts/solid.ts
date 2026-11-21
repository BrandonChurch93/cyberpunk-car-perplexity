import * as THREE from 'three'
import type { SurfaceCurve, SurfaceMap } from '../geom/cuts'
import { MeshBuilder } from '../geom/mesh'
import { add, cross, dot, norm, scale, sub, type V2, type V3 } from '../geom/vec'

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
  return barOn(path, path.map((p) => tailNormal(rm, p)), height, thick, depth, corner)
}

/** The same bar along a path with its own outward normals, for paths that leave the tail face. */
export function barOn(path: V3[], normals: V3[], height: number, thick: number, depth: number, corner: number): MeshBuilder {
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
    const n = normals[j]
    const t = sub(path[Math.min(path.length - 1, j + 1)], path[Math.max(0, j - 1)])
    const h = norm(cross(n, t))
    return { p, n, h }
  })
  const rows = sec.map(([s, d]) => frames.map((f) => add(add(f.p, scale(f.h, s)), scale(f.n, -(depth + thick / 2) + d))))
  return solid(rows, sec.map(() => false), true, false)
}

/** A plane frame: origin, two in-plane axes and the normal, ex x ey = ez. */
export interface Plane {
  o: V3
  ex: V3
  ey: V3
  ez: V3
}

export const onPlane = (f: Plane, q: V2, s: number): V3 => add(add(add(f.o, scale(f.ex, q[0])), scale(f.ey, q[1])), scale(f.ez, s))

export const toPlane = (f: Plane, p: V3): V3 => {
  const q = sub(p, f.o)
  return [dot(q, f.ex), dot(q, f.ey), dot(q, f.ez)]
}

const area = (l: V2[]): number => l.reduce((a, q, i) => a + q[0] * l[(i + 1) % l.length][1] - l[(i + 1) % l.length][0] * q[1], 0) / 2

/** A closed flat plate on a plane between s0 and s1 along its normal: an outline with holes, all in plane coordinates. */
export function flat(f: Plane, outline: V2[], holes: V2[][], s0: number, s1: number): MeshBuilder {
  const b = new MeshBuilder()
  const out = area(outline) > 0 ? outline : [...outline].reverse()
  const hs = holes.map((h) => (area(h) < 0 ? h : [...h].reverse()))
  const all = [out, ...hs].flat()
  const tris = THREE.ShapeUtils.triangulateShape(out.map((q) => new THREE.Vector2(q[0], q[1])), hs.map((h) => h.map((q) => new THREE.Vector2(q[0], q[1]))))
  for (const [s, n, up] of [[s1, f.ez, true], [s0, scale(f.ez, -1), false]] as const) {
    const ids = all.map((q) => b.vertex(onPlane(f, q, s), n))
    for (const [i, j, k] of tris) {
      const ccw = (all[j][0] - all[i][0]) * (all[k][1] - all[i][1]) - (all[j][1] - all[i][1]) * (all[k][0] - all[i][0]) > 0
      if (ccw === up) b.tri(ids[i], ids[j], ids[k])
      else b.tri(ids[i], ids[k], ids[j])
    }
  }
  for (const loop of [out, ...hs]) {
    const n = loop.length
    for (let i = 0; i < n; i++) {
      const a = loop[i]
      const c = loop[(i + 1) % n]
      const nn = norm(add(scale(f.ex, c[1] - a[1]), scale(f.ey, a[0] - c[0])))
      const ids = [onPlane(f, a, s0), onPlane(f, c, s0), onPlane(f, c, s1), onPlane(f, a, s1)].map((p) => b.vertex(p, nn))
      const e = cross(sub(onPlane(f, c, s0), onPlane(f, a, s0)), sub(onPlane(f, a, s1), onPlane(f, a, s0)))
      if (dot(e, nn) > 0) b.quad(ids[0], ids[1], ids[2], ids[3])
      else b.quad(ids[0], ids[3], ids[2], ids[1])
    }
  }
  return b
}

/**
 * A recess behind a hole in the tail: a returned wall that continues the paint flange back to a flat floor, and the floor.
 * The floor is square to `f.ez` at depth `floor` in the plane's frame. Points with |x| under `open` are left out and the
 * floor is closed on the centre line instead, so the mirrored halves meet there.
 */
export function pocket(rm: SurfaceMap, c: SurfaceCurve, f: Plane, floor: number, holes: V2[][] = [], open = -1): MeshBuilder {
  const wallT = 0.003
  const flange = 0.012
  const keep = (p: V3): boolean => Math.abs(p[0]) > open
  const pts = c.p
  const n = pts.length
  let path: V3[] = pts
  if (open >= 0) {
    let start = 0
    while (keep(pts[start]) || !keep(pts[(start + 1) % n])) start = (start + 1) % n
    path = []
    for (let k = 1; k <= n && keep(pts[(start + k) % n]); k++) path.push(pts[(start + k) % n])
  }
  const m = path.length
  const closed = open < 0
  const centre = path.reduce<V3>((a, p) => add(a, scale(p, 1 / m)), [0, 0, 0])
  const rows: V3[][] = [[], [], [], []]
  const foot: V2[] = []
  for (let j = 0; j < m; j++) {
    const p = path[j]
    const nn = tailNormal(rm, p)
    const t = closed ? sub(path[(j + 1) % m], path[(j - 1 + m) % m]) : sub(path[Math.min(m - 1, j + 1)], path[Math.max(0, j - 1)])
    let h = norm(cross(nn, t))
    if (dot(sub(centre, p), h) < 0 && closed) h = scale(h, -1)
    if (!closed && h[1] * (centre[1] - p[1]) + h[0] * (centre[0] - p[0]) < 0) h = scale(h, -1)
    const q = (inward: number, s: number): V3 => {
      const a = add(add(p, scale(h, inward)), scale(nn, -flange))
      if (s < 0) return a
      const lp = toPlane(f, a)
      return add(a, scale(f.ez, s - lp[2]))
    }
    rows[0].push(q(0.001, -1))
    rows[1].push(q(0.001, floor + wallT))
    rows[2].push(q(-wallT, floor + wallT))
    rows[3].push(q(-wallT, -1))
    const lp = toPlane(f, q(-wallT, floor))
    foot.push([lp[0], lp[1]])
  }
  const b = solid(rows, [true, true, true, true], true, closed)
  if (!closed) {
    const x0 = toPlane(f, [0, 0, 0])[0]
    foot.unshift([x0, foot[0][1]])
    foot.push([x0, foot[foot.length - 1][1]])
  }
  merge(b, flat(f, foot, holes, floor, floor + wallT))
  return b
}

/** Plane square to the tail's mean normal over a hole, through the hole's centre. */
export function holePlane(rm: SurfaceMap, c: SurfaceCurve): Plane {
  const m = c.p.length
  const o = c.p.reduce<V3>((a, p) => add(a, scale(p, 1 / m)), [0, 0, 0])
  const ez = scale(c.p.reduce<V3>((a, p) => add(a, tailNormal(rm, p)), [0, 0, 0]), -1)
  const z = norm(ez)
  const ex = norm(cross([0, 1, 0], z))
  const ey = norm(cross(z, ex))
  return { o, ex, ey, ez: z }
}

const triArea = (p: number[][], i: number, j: number, k: number): number => {
  const a = p[i], b = p[j], c = p[k]
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2
}

/**
 * Removes every triangle without area, as the geometry stores it: those with two corners in one place are dropped, and
 * a sliver with three corners on a line is split with its neighbour across the long edge, which keeps the shell closed.
 */
export function heal(b: MeshBuilder, minArea = 1e-12): void {
  const p: number[][] = []
  for (let i = 0; i < b.pos.length; i += 3) p.push([Math.fround(b.pos[i]), Math.fround(b.pos[i + 1]), Math.fround(b.pos[i + 2])])
  const key = p.map((q) => q.join(','))
  const weld = new Map<string, number>()
  const w = key.map((k, i) => {
    const h = weld.get(k)
    if (h !== undefined) return h
    weld.set(k, i)
    return i
  })
  let tris: number[][] = []
  for (let t = 0; t < b.idx.length; t += 3) tris.push([b.idx[t], b.idx[t + 1], b.idx[t + 2]])
  const bad = (t: number[]): boolean => w[t[0]] === w[t[1]] || w[t[1]] === w[t[2]] || w[t[0]] === w[t[2]] || triArea(p, t[0], t[1], t[2]) < minArea
  for (let pass = 0; pass < 32; pass++) {
    tris = tris.filter((t) => !(w[t[0]] === w[t[1]] || w[t[1]] === w[t[2]] || w[t[0]] === w[t[2]]))
    if (!tris.some(bad)) break
    const edges = new Map<string, number[]>()
    tris.forEach((t, n) => {
      for (let e = 0; e < 3; e++) {
        const k = `${w[t[e]]}>${w[t[(e + 1) % 3]]}`
        const l = edges.get(k)
        if (l) l.push(n)
        else edges.set(k, [n])
      }
    })
    const gone = new Set<number>()
    const add: number[][] = []
    tris.forEach((t, n) => {
      if (gone.has(n) || !bad(t)) return
      const len = [0, 1, 2].map((e) => {
        const a = p[t[e]], c = p[t[(e + 1) % 3]]
        return Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2])
      })
      const e = len.indexOf(Math.max(...len))
      const back = (edges.get(`${w[t[(e + 1) % 3]]}>${w[t[e]]}`) ?? []).filter((o) => o !== n)
      const ahead = (edges.get(`${w[t[e]]}>${w[t[(e + 1) % 3]]}`) ?? []).filter((o) => o !== n)
      const flipped = back.length === 0 && ahead.length > 0
      const u = flipped ? t[(e + 1) % 3] : t[e], v = flipped ? t[e] : t[(e + 1) % 3], m = t[(e + 2) % 3]
      const near = flipped ? ahead : back
      if (near.length === 0) {
        gone.add(n)
        return
      }
      const across = near.find((o) => !gone.has(o))
      if (across === undefined) return
      gone.add(n)
      const o = tris[across]
      const r = o.findIndex((q) => w[q] === w[v])
      const ov = o[r], ou = o[(r + 1) % 3], ox = o[(r + 2) % 3]
      gone.add(across)
      add.push([ou, ox, m], [ox, ov, m])
    })
    tris = tris.filter((_, n) => !gone.has(n)).concat(add)
  }
  b.idx.length = 0
  for (const t of tris) b.idx.push(t[0], t[1], t[2])
}

/** The builder's geometry with every triangle that has no area taken out. */
export function finish(b: MeshBuilder): THREE.BufferGeometry {
  heal(b)
  return b.geometry()
}
