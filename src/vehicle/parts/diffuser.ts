import * as THREE from 'three'
import { MeshBuilder } from '../geom/mesh'
import { add, clamp, cross, norm, scale, sub, type V2, type V3 } from '../geom/vec'
import { dims } from '../body/shape'
import type { SurfaceCurve, SurfaceMap } from '../geom/cuts'
import { solid } from './solid'

/** Plate and strake thickness. Every free edge is a full round of half this. */
export const sheet = 0.01
const r = sheet / 2

/** Underside of the flat floor. */
export const floorY = 0.115

/** Diffuser angles from the factory release: 11 degrees in the centre, 15 at the sides. */
const centre = { start: -1.15, slope: Math.tan((11 * Math.PI) / 180), blend: 0.3 }
const side = { start: -1.6, slope: Math.tan((15 * Math.PI) / 180), blend: 0.12 }

/** Strakes: two each side, 845 and 1300 apart, the outer ones leaning out at the foot. */
export const strakes = [
  { x: 0.4225, lean: 0, lead: -1.78, foot: -1.92, low: 0.13 },
  { x: 0.65, lean: (6 * Math.PI) / 180, lead: -1.84, foot: -1.97, low: 0.135 },
] as const

/** Outer channel behind the rear tyre, out to this half width. */
const channelFront = dims.rearHubZ - dims.rearTire.radius - 0.037
const channelOut = 0.9

/** Rear lower edge of the body seen from behind, at the diffuser exit height (x, z), measured on build A's body. */
const tailEdge: V2[] = [
  [0, -2.425], [0.1, -2.424], [0.2, -2.426], [0.3, -2.427], [0.4, -2.423], [0.5, -2.41], [0.6, -2.393],
  [0.65, -2.372], [0.7, -2.331], [0.75, -2.287], [0.8, -2.235], [0.85, -2.172], [0.9, -2.085], [0.95, -1.955],
]

/** The plate stops this far inside the body skin. */
const tuck = 0.01

/** Plan outline of the flat floor as half width over z, nose to rear axle. */
const floorPlan: V2[] = [
  [2.3, 0.3], [2.25, 0.5], [dims.frontHubZ + 0.5, 0.62], [dims.frontHubZ + 0.42, 0.65], [dims.frontHubZ - 0.42, 0.65],
  [dims.frontHubZ - 0.5, 0.93], [dims.rearHubZ + 0.5, 0.95], [dims.rearHubZ + 0.44, 0.65],
]

function catmull(pts: V2[], x: number): number {
  let i = 0
  while (i < pts.length - 2 && pts[i + 1][0] < x) i++
  const p0 = pts[Math.max(0, i - 1)]
  const p1 = pts[i]
  const p2 = pts[i + 1]
  const p3 = pts[Math.min(pts.length - 1, i + 2)]
  const t = clamp((x - p1[0]) / (p2[0] - p1[0]), 0, 1)
  const m1 = (p2[1] - p0[1]) / (p2[0] - p0[0])
  const m2 = (p3[1] - p1[1]) / (p3[0] - p1[0])
  const h = p2[0] - p1[0]
  const t2 = t * t
  const t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * h * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * h * m2
}

/** z of the plate's trailing edge at half width x. */
export const tailZ = (x: number): number => catmull(tailEdge, x) + tuck

/** Rise of a ramp that leaves the floor along a quintic slope blend of length `blend`, then runs straight at `slope`. */
function rise(z: number, law: { start: number; slope: number; blend: number }): [number, number] {
  const d = law.start - z
  if (d <= 0) return [0, 0]
  const t = d / law.blend
  if (t >= 1) return [law.slope * (d - law.blend / 2), law.slope]
  const s = t * t * t * (6 * t * t - 15 * t + 10)
  return [law.slope * law.blend * (t ** 6 - 3 * t ** 5 + 2.5 * t ** 4), law.slope * s]
}

/** Underside height of the centre plate and of the outer channels at z, with dy/d(-z). */
export const centreY = (z: number): number => floorY + rise(z, centre)[0]
export const sideY = (z: number): number => floorY + rise(z, side)[0]

interface Face {
  y: (z: number) => number
  dy: (z: number) => number
}
const centreFace: Face = { y: centreY, dy: (z) => rise(z, centre)[1] }
const sideFace: Face = { y: sideY, dy: (z) => rise(z, side)[1] }

/** Up normal of a plate face y(z). */
const upNormal = (f: Face, z: number): V3 => norm([0, 1, f.dy(z)])

const leanAxis = 0.29

/** Half width of the outer strake's mid plane at height y. */
function outerX(y: number): number {
  const s = strakes[1]
  return s.x - ((y - leanAxis) / Math.cos(s.lean)) * Math.sin(s.lean)
}

/** Outer edge of the centre plate at z: the floor plan ahead, the outer strake's mid plane where they meet. */
function centreEdge(z: number): number {
  const notch = dims.rearHubZ + 0.44
  if (z >= notch) return floorWidth(z)
  const fin = outerX(centreY(z) + r) - 0.002
  const t = clamp((notch - z) / (notch - strakes[1].lead), 0, 1)
  return floorWidth(notch) + (fin - floorWidth(notch)) * t * t * (3 - 2 * t)
}

/**
 * A plate of constant thickness over a quad grid of plan points: underside on the face law, top along the normal,
 * every edge but the centre line closed by a full round. Rows run front to back, columns inside out.
 */
function plate(b: MeshBuilder, f: Face, plan: (i: number, j: number) => V2, rows: number, cols: number, openInner: boolean): void {
  const low = (q: V2): V3 => [q[0], f.y(q[1]), q[1]]
  const high = (q: V2): V3 => add(low(q), scale(upNormal(f, q[1]), sheet))
  b.grid(rows + 1, cols + 1, (i, j) => {
    const q = plan(i, j)
    return { p: low(q), n: scale(upNormal(f, q[1]), -1), u: q[0], v: q[1] }
  }, false, true)
  b.grid(rows + 1, cols + 1, (i, j) => {
    const q = plan(i, j)
    return { p: high(q), n: upNormal(f, q[1]), u: q[0], v: q[1] }
  }, false, false)
  const loop: V2[] = []
  for (let i = 0; i <= rows; i++) loop.push(plan(i, cols))
  for (let j = cols - 1; j >= 0; j--) loop.push(plan(rows, j))
  if (!openInner) for (let i = rows - 1; i >= 0; i--) loop.push(plan(i, 0))
  if (!openInner) for (let j = 1; j <= cols; j++) loop.push(plan(0, j))
  if (openInner) for (let j = 0; j <= cols; j++) loop.unshift(plan(0, cols - j))
  rolledEdge(b, f, dedupe(loop), !openInner)
}

function dedupe(loop: V2[]): V2[] {
  const out: V2[] = []
  for (const q of loop) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 1e-6) out.push(q)
  }
  if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop()
  return out
}

/** A half round from the underside to the top along a plan path that runs with the plate on its right. */
function rolledEdge(b: MeshBuilder, f: Face, path: V2[], closed: boolean): void {
  const k = 8
  const n = path.length
  const ring = (i: number): number[] => {
    const q = path[i]
    const a = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]
    const c = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]
    const up = upNormal(f, q[1])
    const p: V3 = [q[0], f.y(q[1]), q[1]]
    const chord = sub([c[0], f.y(c[1]), c[1]], [a[0], f.y(a[1]), a[1]])
    const t = !closed && (i === 0 || i === n - 1) ? ([Math.sign(chord[0]), 0, 0] as V3) : norm(chord)
    const out = norm(cross(t, up))
    const ids: number[] = []
    for (let s = 0; s <= k; s++) {
      const ang = (Math.PI * s) / k
      const pos = add(p, add(scale(up, r * (1 - Math.cos(ang))), scale(out, r * Math.sin(ang))))
      ids.push(b.vertex(pos, norm(add(scale(up, -Math.cos(ang)), scale(out, Math.sin(ang))))))
    }
    return ids
  }
  const rings = path.map((_, i) => ring(i))
  const last = closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const A = rings[i]
    const B = rings[(i + 1) % n]
    for (let s = 0; s < k; s++) b.quad(A[s], B[s], B[s + 1], A[s + 1])
  }
}

function floorWidth(z: number): number {
  for (let i = 0; i < floorPlan.length - 1; i++) {
    const [z0, w0] = floorPlan[i]
    const [z1, w1] = floorPlan[i + 1]
    if (z <= z0 && z >= z1) return w0 + ((w1 - w0) * (z - z0)) / (z1 - z0)
  }
  return floorPlan[floorPlan.length - 1][1]
}

/** Row z values for the centre plate: every plan corner, even steps between, dense through the ramp blend. */
function centreRows(): number[] {
  const zs = new Set<number>()
  for (const [z] of floorPlan) zs.add(z)
  for (let z = 2.3; z > centre.start; z -= 0.25) zs.add(z)
  for (let i = 0; i <= 40; i++) zs.add(centre.start - (i / 40) * (centre.start - -2.2))
  return [...zs].filter((z) => z >= -2.2).sort((a, b) => b - a)
}

/** Rounds the corners of a closed polyline; `radii[i]` is the radius at point i, 0 keeps it sharp. */
function rounded(poly: V2[], radii: number[]): V2[] {
  const out: V2[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const p = poly[i]
    const rad = radii[i]
    if (!rad) {
      out.push(p)
      continue
    }
    const a = poly[(i - 1 + n) % n]
    const c = poly[(i + 1) % n]
    const la = Math.hypot(p[0] - a[0], p[1] - a[1])
    const lc = Math.hypot(c[0] - p[0], c[1] - p[1])
    const ia: V2 = [(p[0] - a[0]) / la, (p[1] - a[1]) / la]
    const oc: V2 = [(c[0] - p[0]) / lc, (c[1] - p[1]) / lc]
    const turn = Math.acos(clamp(ia[0] * oc[0] + ia[1] * oc[1], -1, 1))
    const d = rad * Math.tan(turn / 2)
    const t1: V2 = [p[0] - ia[0] * d, p[1] - ia[1] * d]
    const left = ia[0] * oc[1] - ia[1] * oc[0] > 0 ? 1 : -1
    const nrm: V2 = [-ia[1] * left, ia[0] * left]
    const ctr: V2 = [t1[0] + nrm[0] * rad, t1[1] + nrm[1] * rad]
    const a0 = Math.atan2(t1[1] - ctr[1], t1[0] - ctr[0])
    const steps = 10
    for (let k = 0; k <= steps; k++) {
      const ang = a0 + left * (turn * k) / steps
      out.push([ctr[0] + rad * Math.cos(ang), ctr[1] + rad * Math.sin(ang)])
    }
  }
  return out
}

/** One closed strake: a flat slab with a full round on its leading edge, foot and tail; its root sits inside the plate. */
function strake(b: MeshBuilder, s: (typeof strakes)[number]): void {
  const midX = (y: number): number => s.x - ((y - leanAxis) / Math.cos(s.lean)) * Math.sin(s.lean)
  const root = (z: number): number => centreY(z) + sheet + 0.002
  const top = tailZ(midX(root(tailZ(s.x))) + r) - r
  const bottom = tailZ(midX(s.low) + r) - r
  const poly: V2[] = []
  const radii: number[] = []
  const n = 32
  for (let i = 0; i <= n; i++) {
    const z = top + ((s.lead - top) * i) / n
    poly.push([z, root(z)])
    radii.push(i === 0 || i === n ? 0.006 : 0)
  }
  poly.push([s.foot, s.low + r])
  radii.push(0.06)
  poly.push([bottom, s.low + r])
  radii.push(0.015)
  slab(b, dedupe(rounded(poly, radii)), s)
}

/** Places a point of a strake's plan (z, y) in the vehicle, leaning about the axis at `leanAxis`. */
function strakePoint(s: (typeof strakes)[number], q: V2, w: number): V3 {
  const h = (q[1] - leanAxis) / Math.cos(s.lean)
  return [s.x + w * Math.cos(s.lean) - h * Math.sin(s.lean), leanAxis + w * Math.sin(s.lean) + h * Math.cos(s.lean), q[0]]
}

function slab(b: MeshBuilder, loop: V2[], s: (typeof strakes)[number]): void {
  const across: V3 = [Math.cos(s.lean), Math.sin(s.lean), 0]
  const n = loop.length
  const area = loop.reduce((acc, q, i) => acc + q[0] * loop[(i + 1) % n][1] - loop[(i + 1) % n][0] * q[1], 0)
  const ccw = area > 0
  const tris = THREE.ShapeUtils.triangulateShape(loop.map((q) => new THREE.Vector2(q[0], q[1])), [])
  for (const sign of [1, -1]) {
    const nrm = scale(across, sign)
    const ids = loop.map((q) => b.vertex(strakePoint(s, q, sign * r), nrm, q[0], q[1]))
    for (const [a, c, d] of tris) {
      const flip = (sign > 0) !== ccw
      if (flip) b.tri(ids[a], ids[d], ids[c])
      else b.tri(ids[a], ids[c], ids[d])
    }
  }
  const k = 8
  const rings = loop.map((q, i) => {
    const a = loop[(i - 1 + n) % n]
    const c = loop[(i + 1) % n]
    const tz = c[0] - a[0]
    const ty = c[1] - a[1]
    const l = Math.hypot(tz, ty) || 1
    const o: V2 = ccw ? [ty / l, -tz / l] : [-ty / l, tz / l]
    const ids: number[] = []
    for (let j = 0; j <= k; j++) {
      const ang = (Math.PI * j) / k
      const w = r * Math.cos(ang)
      const e = r * Math.sin(ang)
      const p = strakePoint(s, [q[0] + o[0] * e, q[1] + o[1] * e], w)
      const base = strakePoint(s, q, 0)
      const out = sub(strakePoint(s, [q[0] + o[0], q[1] + o[1]], 0), base)
      ids.push(b.vertex(p, norm(add(scale(across, Math.cos(ang)), scale(norm(out), Math.sin(ang)))), q[0], q[1]))
    }
    return ids
  })
  for (let i = 0; i < n; i++) {
    const A = rings[i]
    const B = rings[(i + 1) % n]
    for (let j = 0; j < k; j++) {
      if (ccw) b.quad(A[j], B[j], B[j + 1], A[j + 1])
      else b.quad(A[j], A[j + 1], B[j + 1], B[j])
    }
  }
}

export interface Underbody {
  /** Flat floor and the diffuser roof rising from it, one plate, left half. */
  floor: THREE.BufferGeometry
  /** The two strakes of the left half. */
  strakes: THREE.BufferGeometry
}

/** Flat floor, diffuser roof and strakes, left half; mirror for the right. */
export function underbody(): Underbody {
  const fb = new MeshBuilder()
  const rows = centreRows()
  const tailRows = 10
  const cols = 14
  const fixed = rows.length - 1
  const centrePlan = (i: number, j: number): V2 => {
    if (i <= fixed) {
      const z = rows[i]
      return [(centreEdge(z) * j) / cols, z]
    }
    const t = (i - fixed) / tailRows
    let z = rows[fixed]
    let x = 0
    for (let k = 0; k < 3; k++) {
      x = (centreEdge(z) * j) / cols
      z = rows[fixed] + (tailZ(x) - rows[fixed]) * t
    }
    return [x, z]
  }
  plate(fb, centreFace, centrePlan, fixed + tailRows, cols, true)
  const sideRows = 24
  const sideCols = 12
  const sidePlan = (i: number, j: number): V2 => {
    const u = j / sideCols
    const v = i / sideRows
    let z = channelFront
    let x = 0
    for (let k = 0; k < 3; k++) {
      const inner = outerX(sideY(z) + r) + 0.002
      x = inner + (channelOut - inner) * u
      z = channelFront + (tailZ(x) - channelFront) * v
    }
    return [x, z]
  }
  plate(fb, sideFace, (i, j) => sidePlan(i, j), sideRows, sideCols, false)
  const sb = new MeshBuilder()
  for (const s of strakes) strake(sb, s)
  return { floor: fb.geometry(), strakes: sb.geometry() }
}

/** Depth of the recessed panel behind the lower tail opening, and the wall it hangs from. */
export const valanceDepth = 0.09
const wallT = 0.004
const flangeDepth = 0.012

/**
 * The recess behind the lower tail opening: a returned wall that continues the paint flange back along the top and outer
 * edges, and a panel across the back from the diffuser plate up, open only on the centre line.
 */
export function valance(lower: SurfaceCurve, rm: SurfaceMap): { wall: THREE.BufferGeometry; panel: THREE.BufferGeometry } {
  const S = rm.S
  const bottom = Math.min(...lower.p.map((p) => p[1])) + 0.004
  const keep = (p: V3): boolean => p[0] > 0.004 && p[1] > bottom
  const pts = lower.p
  const n = pts.length
  let start = 0
  while (keep(pts[start]) || !keep(pts[(start + 1) % n])) start = (start + 1) % n
  const run: V3[] = []
  for (let k = 1; k <= n && keep(pts[(start + k) % n]); k++) run.push(pts[(start + k) % n])
  if (run[0][0] > run[run.length - 1][0]) run.reverse()
  const path = run.filter((_, i) => i % 2 === 0 || i === run.length - 1)
  const normalAt = (p: V3): V3 => {
    const [u, v] = rm.invert('-z', p[0], p[1])
    const h = 1e-4
    return norm(cross(sub(S(Math.min(1, u + h), v), S(Math.max(0, u - h), v)), sub(S(u, Math.min(1, v + h)), S(u, Math.max(0, v - h)))))
  }
  const centre: V3 = [0.28, 0.45, 0]
  const rows: V3[][] = [[], [], [], []]
  for (let j = 0; j < path.length; j++) {
    const p = path[j]
    let nn = normalAt(p)
    if (nn[2] > 0) nn = scale(nn, -1)
    const t = sub(path[Math.min(path.length - 1, j + 1)], path[Math.max(0, j - 1)])
    let h = norm(cross(nn, t))
    if ((centre[0] - p[0]) * h[0] + (centre[1] - p[1]) * h[1] < 0) h = scale(h, -1)
    const q = (inward: number, depth: number): V3 => add(add(p, scale(h, inward)), scale(nn, -depth))
    rows[0].push(q(0.001, flangeDepth))
    rows[1].push(q(0.001, valanceDepth + wallT))
    rows[2].push(q(-wallT, valanceDepth + wallT))
    rows[3].push(q(-wallT, flangeDepth))
  }
  const wall = solid(rows, [true, true, true, true], true, false)

  const top = path[0][1]
  let outer = 0
  for (const p of path) outer = Math.max(outer, p[0])
  const yb = floorY + 0.17
  const cols = 16
  const rowsN = 10
  const panelAt = (x: number, y: number, s: number): V3 => {
    const [u, v] = rm.invert('-z', Math.min(x, outer - 0.002), Math.max(Math.min(y, top - 0.002), bottom + 0.002))
    const p = S(u, v)
    return [x, y, p[2] + valanceDepth + s]
  }
  const pb = new MeshBuilder()
  const xs = Array.from({ length: cols + 1 }, (_, j) => ((outer + 0.002) * j) / cols)
  const ys = Array.from({ length: rowsN + 1 }, (_, i) => yb + ((top + 0.002 - yb) * i) / rowsN)
  const front = ys.map((y) => xs.map((x) => panelAt(x, y, 0)))
  const back = ys.map((y) => xs.map((x) => panelAt(x, y, wallT)))
  const face = (g: V3[][], out: number): void => {
    const base = pb.pos.length / 3
    for (let i = 0; i <= rowsN; i++) for (let j = 0; j <= cols; j++) pb.vertex(g[i][j], [0, 0, out])
    for (let i = 0; i < rowsN; i++) {
      for (let j = 0; j < cols; j++) {
        const a = base + i * (cols + 1) + j
        const quad = [a, a + 1, a + cols + 2, a + cols + 1]
        const e1 = sub(g[i][j + 1], g[i][j])
        const e2 = sub(g[i + 1][j], g[i][j])
        if (cross(e1, e2)[2] * out > 0) pb.quad(quad[0], quad[1], quad[2], quad[3])
        else pb.quad(quad[0], quad[3], quad[2], quad[1])
      }
    }
  }
  face(front, -1)
  face(back, 1)
  const rim = (a: V3[], c: V3[], out: V3): void => {
    const base = pb.pos.length / 3
    for (const p of a) pb.vertex(p, out)
    for (const p of c) pb.vertex(p, out)
    const m = a.length
    for (let k = 0; k < m - 1; k++) {
      const e1 = sub(a[k + 1], a[k])
      const e2 = sub(c[k], a[k])
      const ok = cross(e1, e2)[0] * out[0] + cross(e1, e2)[1] * out[1] + cross(e1, e2)[2] * out[2] > 0
      if (ok) pb.quad(base + k, base + k + 1, base + m + k + 1, base + m + k)
      else pb.quad(base + k, base + m + k, base + m + k + 1, base + k + 1)
    }
  }
  rim(front[rowsN], back[rowsN], [0, 1, 0])
  rim(front[0], back[0], [0, -1, 0])
  rim(front.map((r) => r[cols]), back.map((r) => r[cols]), [1, 0, 0])
  return { wall: wall.geometry(), panel: pb.geometry() }
}
