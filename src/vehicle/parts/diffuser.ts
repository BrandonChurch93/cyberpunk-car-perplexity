import * as THREE from 'three'
import { MeshBuilder } from '../geom/mesh'
import { add, clamp, cross, dot, norm, scale, sub, type V2, type V3 } from '../geom/vec'
import { dims, mainLoft } from '../body/shape'
import { bumper } from '../body/tail'
import type { SurfaceCurve, SurfaceMap } from '../geom/cuts'
import { finish, flat, merge, zipCap } from './solid'
import { honeycomb } from './enginebay'

/** Plate and strake thickness. Every free edge is a full round of half this. */
export const sheet = 0.01
const r = sheet / 2

/** Underside of the flat floor. */
export const floorY = 0.115

/** Diffuser angle from the factory release: 11 degrees in the centre. Outboard of the outer strakes the corner is open. */
const centre = { start: -1.15, slope: Math.tan((11 * Math.PI) / 180), blend: 0.3 }

/**
 * Strakes: three thin blades each side at even spacing, wedges that deepen toward the exit while their lower edge climbs
 * from `toe` to `exit`, so air and deck show between and under them. The inner two rise through the open tail to the
 * bumper in front of the mesh; the outer one leans out at the foot and starts behind the tyre.
 */
export const strakes = [
  { x: 0.65 / 3, lean: 0, lead: -1.72, rake: 0.12, toe: 0.135, exit: 0.155, rise: true },
  { x: 1.3 / 3, lean: 0, lead: -1.72, rake: 0.12, toe: 0.135, exit: 0.155, rise: true },
  { x: 0.65, lean: (6 * Math.PI) / 180, lead: -1.88, rake: 0.1, toe: 0.14, exit: 0.16, rise: false },
] as const

/** Chord of the inner strakes where they rise above the roof, ahead of the trailing edge: blades, not walls. */
const riseChord = 0.12

/** Strake blade thickness; its edges are full rounds of half this. */
const blade = 0.006
const br = blade / 2
const outer = strakes[strakes.length - 1]

/** Rear lower edge of the body seen from behind, at the diffuser exit height (x, z), measured on build A's body. */
const tailEdge: V2[] = [
  [0, -2.425], [0.1, -2.424], [0.2, -2.426], [0.3, -2.427], [0.4, -2.423], [0.5, -2.41], [0.6, -2.393],
  [0.65, -2.372], [0.7, -2.331], [0.75, -2.287], [0.8, -2.235], [0.85, -2.172], [0.9, -2.085], [0.95, -1.955],
]

/** The plate stops this far inside the body skin. */
const tuck = 0.01

/** Plan outline of the flat floor as half width over z, nose to rear axle; the nose sits 15 mm behind the splitter's trailing edge. */
const floorPlan: V2[] = [
  [2.22, 0.15], [2.12, 0.3], [1.97, 0.5], [dims.frontHubZ + 0.5, 0.62], [dims.frontHubZ + 0.42, 0.65], [dims.frontHubZ - 0.42, 0.65],
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

/** Underside height of the centre plate at z. */
export const centreY = (z: number): number => floorY + rise(z, centre)[0]

interface Face {
  y: (z: number) => number
  dy: (z: number) => number
}
const centreFace: Face = { y: centreY, dy: (z) => rise(z, centre)[1] }

/** Up normal of a plate face y(z). */
const upNormal = (f: Face, z: number): V3 => norm([0, 1, f.dy(z)])

const leanAxis = 0.29

/** Half width of the outer strake's mid plane at height y. */
function outerX(y: number): number {
  const s = outer
  return s.x - ((y - leanAxis) / Math.cos(s.lean)) * Math.sin(s.lean)
}

/** Outer edge of the centre plate at z: the floor plan ahead, the outer strake's mid plane where they meet. */
function centreEdge(z: number): number {
  const notch = dims.rearHubZ + 0.44
  if (z >= notch) return floorWidth(z)
  const fin = outerX(centreY(z) + r) - 0.002
  const t = clamp((notch - z) / (notch - outer.lead), 0, 1)
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
  const along = [0]
  for (let i = 1; i <= n; i++) {
    const a = path[i - 1]
    const c = path[i % n]
    along.push(along[i - 1] + Math.hypot(c[0] - a[0], f.y(c[1]) - f.y(a[1]), c[1] - a[1]))
  }
  const ring = (i: number, u: number): number[] => {
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
      ids.push(b.vertex(pos, norm(add(scale(up, -Math.cos(ang)), scale(out, Math.sin(ang)))), u, r * ang))
    }
    return ids
  }
  const rings = path.map((_, i) => ring(i, along[i]))
  if (closed) rings.push(ring(0, along[n]))
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i]
    const B = rings[i + 1]
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
  for (let z = floorPlan[0][0]; z > centre.start; z -= 0.25) zs.add(z)
  for (let i = 0; i <= 40; i++) zs.add(centre.start - (i / 40) * (centre.start - -2.2))
  return [...zs].filter((z) => z >= -2.2).sort((a, b) => b - a)
}

/** Strake section: half thickness at the root and at the free edge, and the fillet radius where it joins a plate. */
const fin = { root: 0.004, tip: 0.0025, fillet: 0.008 } as const

interface SectionPoint {
  w: number
  y: number
  nw: number
  ny: number
}

/** Left half of a concave fillet from the plate face at `y0` (going `dir` away from it) onto a blade face of half width `w`. */
function filletArc(w: number, y0: number, f: number, dir: 1 | -1, k: number): SectionPoint[] {
  const out: SectionPoint[] = []
  for (let i = 0; i <= k; i++) {
    const a = (Math.PI / 2) * (i / k)
    out.push({ w: -(w + f - f * Math.sin(a)), y: y0 + dir * (f - f * Math.cos(a)), nw: -Math.sin(a), ny: dir * Math.cos(a) })
  }
  return out
}

/** Mirrors a left half section (listed along the loop) into the whole closed loop. */
function mirrored(left: SectionPoint[], middle: SectionPoint[]): SectionPoint[] {
  const right = [...left].reverse().map((q) => ({ w: -q.w, y: q.y, nw: -q.nw, ny: q.ny }))
  return [...left, ...middle, ...right]
}

/** A fin section hanging from a plate underside at `yr`, its free edge at `yl`; the top is closed inside the plate. */
function finSection(yr: number, yl: number): SectionPoint[] {
  const d = yr - yl
  const f = Math.max(0.0005, Math.min(fin.fillet, 0.4 * (d - 2 * fin.tip)))
  const left: SectionPoint[] = [{ w: -(fin.root + f), y: yr + 0.004, nw: -Math.SQRT1_2, ny: Math.SQRT1_2 }, ...filletArc(fin.root, yr, f, -1, 6)]
  const y1 = yr - f
  const y2 = yl + fin.tip
  const slope = (fin.root - fin.tip) / Math.max(1e-6, y1 - y2)
  const l = Math.hypot(1, slope)
  for (let i = 1; i < 6; i++) {
    const t = i / 6
    left.push({ w: -(fin.root + (fin.tip - fin.root) * t), y: y1 + (y2 - y1) * t, nw: -1 / l, ny: -slope / l })
  }
  const bottom: SectionPoint[] = []
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI + (Math.PI * i) / 10
    bottom.push({ w: fin.tip * Math.cos(a), y: y2 + fin.tip * Math.sin(a), nw: Math.cos(a), ny: Math.sin(a) })
  }
  return mirrored(left, bottom)
}

/** A blade standing on a plate top at `yb` and filleted into a ceiling underside at `yc`, closed inside both. */
function riserSection(yb: number, yc: number): SectionPoint[] {
  const f = fin.fillet
  const left: SectionPoint[] = [
    { w: -(fin.root + f), y: yb - 0.004, nw: -Math.SQRT1_2, ny: -Math.SQRT1_2 },
    ...filletArc(fin.root, yb, f, 1, 6),
    ...filletArc(fin.root, yc, f, -1, 6).reverse(),
    { w: -(fin.root + f), y: yc + 0.002, nw: -Math.SQRT1_2, ny: Math.SQRT1_2 },
  ]
  return mirrored(left, [])
}

/**
 * Sweeps a section along z from `z0` (front) to `z1` (back) with a bullnose of radius `fin.root` at both ends,
 * every quad between neighbouring rings, both noses closed by a strip across their last ring.
 */
function sweep(b: MeshBuilder, s: (typeof strakes)[number], zs: number[], section: (z: number) => SectionPoint[]): void {
  const across: V3 = [Math.cos(s.lean), Math.sin(s.lean), 0]
  const up: V3 = [-Math.sin(s.lean), Math.cos(s.lean), 0]
  const nose = 5
  const top = (80 * Math.PI) / 180
  type Ring = { p: V3; n: V3; v: number }[]
  const ring = (z: number, sec: SectionPoint[], phi: number, dir: number): Ring => {
    let v = 0
    return sec.map((q, j) => {
      if (j > 0) v += Math.hypot(q.w - sec[j - 1].w, q.y - sec[j - 1].y)
      const zz = z + dir * fin.root * Math.sin(phi)
      const n2 = add(scale(across, q.nw), scale(up, q.ny))
      const n = add(scale(n2, Math.cos(phi)), [0, 0, dir * Math.sin(phi)])
      const g = bow(s, zz)[1]
      return { p: strakePoint(s, [zz, q.y], q.w * Math.cos(phi)), n: norm([n[0], n[1], n[2] - g * n[0]]), v }
    })
  }
  const rings: Ring[] = []
  const first = section(zs[0])
  for (let k = nose; k > 0; k--) rings.push(ring(zs[0], first, (top * k) / nose, 1))
  for (const z of zs) rings.push(ring(z, section(z), 0, 0))
  const last = section(zs[zs.length - 1])
  for (let k = 1; k <= nose; k++) rings.push(ring(zs[zs.length - 1], last, (top * k) / nose, -1))
  const m = rings[0].length
  const mid = rings[Math.floor(rings.length / 2)]
  const next = rings[Math.floor(rings.length / 2) + 1]
  const j = 9
  const face = cross(sub(mid[j + 1].p, mid[j].p), sub(next[j].p, mid[j].p))
  const flip = dot(face, mid[j].n) < 0
  b.grid(rings.length, m, (i, j) => ({ p: rings[i][j].p, n: rings[i][j].n, u: rings[i][j].p[2], v: rings[i][j].v }), true, flip)
  zipCap(b, rings[0].map((q) => q.p), rings[0].map(() => [0, 0, 1] as V3))
  zipCap(b, rings[rings.length - 1].map((q) => q.p), rings[rings.length - 1].map(() => [0, 0, -1] as V3))
}

/**
 * One strake: a blade tapering to its free edge, filleted into the underside of the roof, with a rounded nose ahead
 * and a bullnose at the tail. The inner ones carry a riser above the roof in front of the mesh, filleted into the roof
 * and the ceiling, so the strake reads as one blade passing through.
 */
function strake(b: MeshBuilder, s: (typeof strakes)[number]): void {
  const midX = (y: number): number => s.x + bow(s, fanEnd)[0] - ((y - leanAxis) / Math.cos(s.lean)) * Math.sin(s.lean)
  const root = (z: number): number => centreY(z) + sheet + 0.002
  let back = tailZ(s.x) - br
  for (let k = 0; k < 3; k++) back = tailZ(midX(root(back)) + br) - br - 0.002
  const bottom = tailZ(midX(s.exit) + br) - br
  const end = Math.max(back, bottom) + fin.root
  const foot = s.lead - s.rake
  const low = (z: number): number => s.toe + ((s.exit - s.toe) * (foot - z)) / (foot - bottom)
  const full = centreY(foot) - s.toe
  const edge = (z: number): number => {
    if (z <= foot) return low(z)
    const t = (s.lead - z) / (s.lead - foot)
    return centreY(z) - Math.max(0.016, full * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))))
  }
  const zs: number[] = []
  for (let i = 0; i < 16; i++) zs.push(s.lead - (s.lead - foot) * (i / 16) ** 2)
  for (let i = 0; i <= 36; i++) zs.push(foot + ((end - foot) * i) / 36)
  sweep(b, s, zs, (z) => finSection(centreY(z), edge(z)))
  if (!s.rise) return
  const plateTop = (z: number): number => centreY(z) + sheet / Math.cos(Math.atan(rise(z, centre)[1])) - 0.0005
  const zf = Math.min(meshZ - fin.root - fin.fillet - 0.002, back + riseChord)
  const rz: number[] = []
  for (let i = 0; i <= 12; i++) rz.push(zf - fin.root + ((end - zf + fin.root) * i) / 12)
  sweep(b, s, rz, (z) => riserSection(plateTop(z), ceilingY))
}

/** The inner strakes fan out toward the exit with the air, by this share of their station at the tail. */
const fan = 0.06
const fanEnd = -2.43

/** Outboard offset of a strake's mid plane at z, and its rate along z. */
function bow(s: (typeof strakes)[number], z: number): [number, number] {
  if (!s.rise) return [0, 0]
  const span = s.lead - fanEnd
  const t = clamp((s.lead - z) / span, 0, 1)
  return [s.x * fan * t * t, (-2 * s.x * fan * t) / span]
}

/** Places a point of a strake's plan (z, y) in the vehicle, leaning about the axis at `leanAxis`. */
function strakePoint(s: (typeof strakes)[number], q: V2, w: number): V3 {
  const h = (q[1] - leanAxis) / Math.cos(s.lean)
  return [s.x + bow(s, q[0])[0] + w * Math.cos(s.lean) - h * Math.sin(s.lean), leanAxis + w * Math.sin(s.lean) + h * Math.cos(s.lean), q[0]]
}

export interface Underbody {
  /** Flat floor and the diffuser roof rising from it, one plate, left half. */
  floor: THREE.BufferGeometry
  /** The three strakes of the left half. */
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
  const sb = new MeshBuilder()
  for (const s of strakes) strake(sb, s)
  return { floor: finish(fb), strakes: finish(sb) }
}

/** Front of the mesh across the back of the open lower tail, well inside the paint. */
export const meshZ = -2.13
const meshT = 0.004
/** The mesh sits deep in the dark, so its cells are coarse. */
const cell = 0.036
const gauge = 0.005
/** The dark plate behind the mesh. */
const meshBack = 0.09
/** The dark plate inboard of the side vent. */
const ventBack = 0.08
const wallT = 0.004
const ceilingY = bumper + 0.002
/** Inboard wall of the corner cavity behind the rear tyre, and how far forward it runs. */
const innerX = 0.6
const cavityFront = -1.875

/** Point on the tail at elevation (x, y), and its outward normal in plan. */
function faceAt(rm: SurfaceMap, x: number, y: number): { p: V3; n: V2 } {
  const [u, v] = rm.invert('-z', x, y)
  const p = rm.S(u, v)
  const h = 1e-4
  const a = sub(rm.S(Math.min(1, u + h), v), rm.S(Math.max(0, u - h), v))
  const c = sub(rm.S(u, Math.min(1, v + h)), rm.S(u, Math.max(0, v - h)))
  let nn = norm(cross(a, c))
  if (nn[2] > 0) nn = scale(nn, -1)
  const l = Math.hypot(nn[0], nn[2])
  return { p, n: [nn[0] / l, nn[2] / l] }
}

/** Point on the body corner at section u and height y, and its outward normal in plan. */
function cornerAt(u: number, y: number): { p: V3; n: V2 } {
  const loft = mainLoft()
  let lo = 0
  let hi = loft.vAt[2]
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2
    if (loft.at(u, m)[1] < y) lo = m
    else hi = m
  }
  const v = (lo + hi) / 2
  const p = loft.at(u, v)
  const h = 1e-4
  const a = sub(loft.at(Math.min(1, u + h), v), loft.at(Math.max(0, u - h), v))
  const c = sub(loft.at(u, v + h), loft.at(u, v - h))
  let nn = norm(cross(a, c))
  if (nn[0] < 0) nn = scale(nn, -1)
  const l = Math.hypot(nn[0], nn[2])
  return { p, n: [nn[0] / l, nn[2] / l] }
}

/**
 * The open lower tail behind the bumper edge, left half: a ceiling that continues the paint flange back to a mesh set well
 * inside the body and out through the corner cut to the rear tyre, the mesh itself from the diffuser up, and an inboard
 * wall that closes the corner cavity off from the engine.
 */
export function valance(lower: SurfaceCurve, rm: SurfaceMap): { wall: THREE.BufferGeometry; panel: THREE.BufferGeometry } {
  void lower
  const inset = 0.008
  const y = ceilingY + wallT / 2
  const skin: V2[] = []
  for (let i = 0; i <= 12; i++) {
    const f = faceAt(rm, (0.6 * i) / 12, y)
    skin.push([f.p[0] - f.n[0] * inset, f.p[2] - f.n[1] * inset])
  }
  for (let i = 1; i <= 40; i++) {
    const c = cornerAt(1 - (0.12 * i) / 40, y)
    const q: V2 = [c.p[0] - c.n[0] * inset, c.p[2] - c.n[1] * inset]
    if (q[1] > cavityFront) break
    if (q[0] > skin[skin.length - 1][0]) skin.push(q)
  }
  const last = skin[skin.length - 1]
  const plan: V2[] = [[0, meshZ + meshBack + wallT], ...skin, [last[0], cavityFront], [innerX + wallT, cavityFront], [innerX + wallT, meshZ + meshBack + wallT]]
  const horiz = { o: [0, ceilingY, 0] as V3, ex: [1, 0, 0] as V3, ey: [0, 0, -1] as V3, ez: [0, 1, 0] as V3 }
  const wall = new MeshBuilder()
  merge(wall, flat(horiz, plan.map(([x, z]) => [x, -z]), [], 0, wallT))
  const side = { o: [innerX, 0, 0] as V3, ex: [0, 1, 0] as V3, ey: [0, 0, 1] as V3, ez: [1, 0, 0] as V3 }
  const sideLine: V2[] = []
  for (let i = 0; i <= 16; i++) {
    const z = meshZ + ((cavityFront - meshZ) * i) / 16
    sideLine.push([centreY(z) + 0.002, z])
  }
  const ventLow = centreY(meshZ) + 0.012
  merge(wall, flat(side, [...sideLine, [ventLow, cavityFront], [ventLow, meshZ]], [], 0, wallT))
  const inside = { ...side, o: [innerX - ventBack, 0, 0] as V3 }
  const zs = meshZ + meshBack + wallT
  const inLine: V2[] = [[centreY(zs) + 0.002, zs], ...sideLine.filter(([, z]) => z > zs + 0.005)]
  merge(wall, flat(inside, [...inLine, [ceilingY + wallT, cavityFront], [ceilingY + wallT, zs]], [], 0, wallT))
  const yb = centreY(meshZ + meshBack) + 0.004
  const yt = ceilingY + wallT
  const back = { o: [0, 0, meshZ + meshBack] as V3, ex: [1, 0, 0] as V3, ey: [0, 1, 0] as V3, ez: [0, 0, 1] as V3 }
  merge(wall, flat(back, [[0, yb], [innerX + wallT, yb], [innerX + wallT, yt], [0, yt]], [], 0, wallT))
  const ym = centreY(meshZ) + 0.004
  const ha = (innerX + wallT) / 2
  const hb = (yt - ym) / 2
  const panel = honeycomb({ c: [ha, ym + hb, meshZ + meshT / 2], a: [1, 0, 0], b: [0, 1, 0], n: [0, 0, -1] }, ha, hb, cell, gauge, meshT, 0.0006, 0.006)
  const va = (cavityFront - meshZ) / 2
  const vb = (yt - ventLow) / 2
  merge(panel, honeycomb({ c: [innerX + meshT / 2, ventLow + vb, meshZ + va], a: [0, 0, 1], b: [0, 1, 0], n: [1, 0, 0] }, va, vb, cell, gauge, meshT, 0.0006, 0.006))
  return { wall: finish(wall), panel: finish(panel) }
}
