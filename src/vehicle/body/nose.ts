import { ShapeUtils, Vector2 } from 'three'
import { coons, type Curve } from '../geom/coons'
import type { Loft } from '../geom/loft'
import { sample2, smin, SurfaceCurve, type Surface, type SurfaceMap } from '../geom/cuts'
import type { TessResult } from '../geom/tessellate'
import { add, addScaled, clamp, cross, dot, len, lerp3, mix, norm, rotate, scale, sub, type V2, type V3 } from '../geom/vec'
import type { Cuts } from './cuts'
import { elev, fasciaBreak, frontSection, map } from './lines'

export interface FasciaRails {
  brow: Curve
  chin: Curve
  side: Curve
  fold: number
}

export type FasciaSurface = Surface & { readonly fieldStops: readonly number[] }
export interface FasciaEdge { v: readonly number[]; p: readonly V3[] }

const segment = (a: V3, b: V3): Curve => t => lerp3(a, b, t)
const reflect = (p: V3): V3 => [-p[0], p[1], p[2]]
const cheekV = frontSection.side[0].v
const shieldV = frontSection.brow.find(k => k.name === 'vee')!.v
const cornerV = frontSection.brow.find(k => k.name === 'corner')!.v
const foldBottom: V3 = [...fasciaBreak[0]]
const sectionKnots = [...frontSection.brow, ...frontSection.side.slice(1)].reverse()

export function fasciaDown(v: number): V3 {
  const i = sectionKnots.findIndex(k => k.v >= v && k.v > 0)
  const k = i < 1 ? 1 : i
  const interval = (j: number): V3 => {
    const a = sectionKnots[j - 1], b = sectionKnots[j]
    const t = norm(sub([...b.p], [...a.p])), mid = (a.v + b.v) / 2
    const d: V3 = mid > shieldV ? [0, -1, -.42] : mid > cheekV ? [0, -1, -.48] : [-1, 0, .66]
    return norm(addScaled(d, t, -dot(d, t)))
  }
  const d = interval(k)
  if (v === 1) return norm([0, d[1], d[2]])
  if (v === sectionKnots[k].v && k + 1 < sectionKnots.length) return norm(add(d, interval(k + 1)))
  return d
}

function edgeCurve(stations: readonly number[], points: readonly V3[]): Curve {
  return u => {
    const i = stations.findIndex(s => s >= u)
    if (i <= 0) return points[i === 0 ? 0 : points.length - 1]
    if (stations[i] === u) return points[i]
    return lerp3(points[i - 1], points[i], (u - stations[i - 1]) / (stations[i] - stations[i - 1]))
  }
}

export function fitFascia(browEdge: FasciaEdge, noseSide: FasciaEdge) {
  const ascending = (xs: Array<readonly [number, V3]>) => xs.sort(([a], [b]) => a - b)
  const top = ascending(browEdge.v.map((v, i) => [(1 - v) / (1 - cheekV), browEdge.p[i]] as const))
  const flank = ascending(noseSide.v.map((v, i) => [v / cheekV, noseSide.p[i]] as const))
  const uEdge = top.map(([u]) => u), vEdge = flank.map(([v]) => v)
  const brow = edgeCurve(uEdge, top.map(([, p]) => p))
  const side = edgeCurve(vEdge, flank.map(([, p]) => p))
  const fold = (1 - shieldV) / (1 - cheekV)
  const chinTip: V3 = [0, side(0)[1], brow(0)[2] - .109]
  const chin = (u: number) => u < fold ? lerp3(chinTip, foldBottom, u / fold) : lerp3(foldBottom, side(0), (u - fold) / (1 - fold))
  return { surface: ruledFascia({ brow, chin, side, fold }), uEdge, vEdge }
}

function roundSection(p: V3, a: V3, b: V3, axis: V3, radius: number) {
  const l = norm(sub(a, p)), r = norm(sub(b, p))
  const lp = addScaled(l, axis, -dot(l, axis)), rp = addScaled(r, axis, -dot(r, axis))
  const u = norm(lp), v = norm(rp)
  const half = .5 * Math.acos(clamp(dot(u, v), -1, 1))
  const setback = radius / Math.tan(half)
  const left = addScaled(p, l, setback / Math.max(.1, len(lp)))
  const right = addScaled(p, r, setback / Math.max(.1, len(rp)))
  const bisector = norm(add(u, v))
  if (len(bisector) < 1e-6 || Math.abs(Math.PI / 2 - half) < 1e-5) {
    return { left: p, right: p, arc: segment(p, p) }
  }
  const c = addScaled(p, bisector, radius / Math.sin(half))
  const s = sub(addScaled(p, u, setback), c)
  const e = sub(addScaled(p, v, setback), c)
  const angle = Math.atan2(dot(axis, cross(s, e)), dot(s, e))
  const arc: Curve = t => addScaled(add(c, rotate(s, axis, angle * t)), axis,
    mix(dot(sub(left, p), axis), dot(sub(right, p), axis), t))
  return { left, right, arc }
}

export function ruledFascia({ brow, chin, side, fold }: FasciaRails): FasciaSurface {
  const center = segment(chin(0), brow(0)), edge = segment(chin(fold), brow(fold))
  const top = (a: number) => brow(mix(fold, 1, a))
  const bottom = (a: number) => chin(mix(fold, 1, a))
  const chart = coons(bottom, top, edge, side)
  const r = .48
  const corner = top((shieldV - cornerV) / (shieldV - cheekV))
  const a0 = top(0), a1 = top(1)
  const k = (corner[0] - a0[0]) / (a1[0] - a0[0])
  const baseDepth = (p: V3, a: V3, b: V3, t: number) => mix(a[2], b[2], t) + r * (p[1] - mix(a[1], b[1], t))
  const hinge = (q: number) => .5 * (q + Math.hypot(q, .075))
  const bulge = (t: number) => hinge(t - k) - mix(hinge(-k), hinge(1 - k), t)
  const crown = (corner[2] - baseDepth(corner, a0, a1, k)) / bulge(k)
  const cheek: Surface = (u, v) => {
    if (u === 0) return edge(v)
    if (u === 1) return side(v)
    const p = chart(u, v), a = edge(v), b = side(v)
    const t = (p[0] - a[0]) / (b[0] - a[0])
    return [p[0], p[1], baseDepth(p, a, b, t) + v * crown * bulge(t)]
  }
  const shield: Surface = (u, v) => {
    const a = center(v), b = edge(v)
    const t = u / fold, s = .32
    const q = t / s
    const ease = (t >= s ? t - s / 2 : s * q ** 3 * (1 - q / 2)) / (1 - s / 2)
    return [mix(a[0], b[0], t), mix(a[1], b[1], ease), mix(a[2], b[2], ease)]
  }
  const axis1 = norm(sub(edge(1), edge(0)))
  const radius = .003
  const start = fold - .009, end = fold + .009
  const fieldStops = [fold * .1, fold * .2, fold * .32, ...Array.from({ length: 7 }, (_, i) => mix(start, end, i / 6))]
  const field: Surface = (u, v) => {
    const f = edge(v)
    const upper = roundSection(f, shield(fold - .001, v), cheek(.001, v), axis1, radius)
    if (u < start) {
      const t = u / start
      const stop = 1 - clamp((f[0] - upper.left[0]) / (f[0] - center(v)[0]), 0, .05)
      const p = shield(t * stop * fold, v)
      return addScaled(p, sub(upper.left, shield(stop * fold, v)), t)
    }
    if (u <= end) return upper.arc((u - start) / (end - start))
    const dist = len(sub(upper.right, f)), scaleU = len(sub(cheek(.001, v), f)) / .001
    const right = scaleU > 1e-8 ? clamp(dist / scaleU, 0, .035) : 0
    const a = mix(right, 1, (u - end) / (1 - end))
    return addScaled(cheek(a, v), sub(upper.right, cheek(right, v)), (1 - a) / (1 - right))
  }
  const surface: Surface = (u, v) => {
    if (v === 1) return brow(u)
    if (u === 1) return side(v)
    const s = field(u, v)
    return v > 0 ? addScaled(s, sub(brow(u), field(u, 1)), v ** 4) : s
  }
  return Object.assign(surface, { fieldStops })
}

export function frontFace(loft: Loft): (a: number, b: number) => V3 {
  const split = loft.vAt[3]
  const base = loft.at(0, 0)
  const cheek = loft.at(0, split)
  const tip = loft.at(0, 1)
  const setback = .109
  const centerZ = tip[2] - setback
  const rise = setback / (tip[1] - base[1])
  const hub = lines.drlLower[0]
  const upper = lines.drlUpper[0], lower = lines.drlLower.at(-1)!, stem = lines.drlStem.at(-1)!
  const upperSlope = (upper[0] - hub[0]) / (upper[1] - hub[1])
  const lowerSlope = (lower[0] - hub[0]) / (hub[1] - lower[1])
  const stemSlope = (stem[1] - hub[1]) / (stem[0] - hub[0])
  const angle = .45
  const outerHigh = -angle * (1 + lowerSlope * stemSlope) / (lowerSlope + upperSlope)
  const outerLow = outerHigh + angle * stemSlope
  const cutsAt = (x: number, y: number) => {
    const dx = x - hub[0], dy = y - hub[1]
    return [-angle * (dy - stemSlope * dx), outerLow * (dx + lowerSlope * dy)]
  }
  const shieldWidth = (y: number) => .17 + .49 * (y - base[1])
  const intakeSweep = (centerZ + Math.min(0, ...cutsAt(base[0], base[1])) - base[2]) / (base[0] - shieldWidth(base[1]))
  const baseZ = (x: number, y: number) => {
    const shield = centerZ + rise * (y - base[1])
    const intake = shield - intakeSweep * (x - shieldWidth(y))
    const [top, cheek] = cutsAt(x, y)
    return smin(shield, smin(intake, smin(intake + top, intake + cheek, .0026), .0026), .0035)
  }
  const cheekResidual = cheek[2] - baseZ(cheek[0], cheek[1])
  const railAt = (a: number) => loft.at(0, mix(1, split, a))
  const count = 14
  const residuals = Array.from({ length: count + 1 }, (_, i) => {
    let lo = 0, hi = 1
    const x = cheek[0] * i / count
    for (let j = 0; j < 20; j++) {
      const m = (lo + hi) / 2
      if (railAt(m)[0] < x) lo = m
      else hi = m
    }
    const [px, y, z] = railAt(i === 0 ? 0 : i === count ? 1 : (lo + hi) / 2)
    return z - baseZ(px, y)
  })
  const residualAt = (i: number): number => i < 0 ? 2 * residuals[0] - residuals[1]
    : i > count ? 2 * residuals[count] - residuals[count - 1] : residuals[i]
  const sweep = (x: number) => {
    const q = count * x / cheek[0], i = Math.min(count - 1, Math.floor(q)), t = q - i
    const a = residualAt(i - 1), b = residualAt(i), c = residualAt(i + 1), d = residualAt(i + 2)
    return ((1 - t) ** 3 * a + (4 - 6 * t * t + 3 * t ** 3) * b
      + (1 + 3 * t + 3 * t * t - 3 * t ** 3) * c + t ** 3 * d) / 6
  }
  return (a, b) => {
    if (a === 1) return loft.at(0, split * b)
    const rail = railAt(a)
    if (b === 1) return rail
    const side = loft.at(0, split * b)
    const station = rail[0] / cheek[0]
    const along = station * station
    const x = mix(station * base[0], rail[0], b) + along * (side[0] - mix(base[0], cheek[0], b))
    const y = mix(base[1], rail[1], b) + along * (side[1] - mix(base[1], cheek[1], b))
    const top = rail[2] - baseZ(rail[0], rail[1])
    const broad = sweep(rail[0])
    const outer = side[2] - baseZ(side[0], side[1]) - cheekResidual * b
    // The broad sweep carries the fit without dragging every bonnet crease across the fascia.
    return [x, y, baseZ(x, y) + broad * b + (top - broad) * b ** 6 * (7 - 6 * b) + outer * along * along]
  }
}

const junction: [number, number] = [192, 445]

export const lines = {
  eye: map(elev, [[193, 378], [254, 394], [318, 410], [328, 416], [320, 429], [254, 425], [205, 423], [189, 404]]),
  outerIntake: map(elev, [[218, 490], [318, 490], [424, 480], [481, 469], [461, 522], [416, 615], [329, 620], [235, 620], [208, 557]]),
  centerIntake: map(elev, [[575, 520], [745, 520], [745, 612], [600, 612], [570, 570]]),
  drlUpper: map(elev, [[175, 394], junction]),
  drlLower: map(elev, [junction, [158, 608]]),
  drlStem: map(elev, [junction, [387, 461]]),
}

export const guideWidth = { cut: .014, seat: .011, lens: .0075 } as const

export function guideProfile(radius: number) {
  const hub = lines.drlLower[0]
  const angle = ([x, y]: V2) => Math.atan2(y - hub[1], x - hub[0])
  const ends = [lines.drlUpper[0], lines.drlLower.at(-1)!, lines.drlStem.at(-1)!].sort((a, b) => angle(a) - angle(b))
  const adjacent = (i: number) => angle(ends[(i + 1) % ends.length]) + (i === ends.length - 1 ? 2 * Math.PI : 0)
  const corners = ends.map((tip, i): V2 => {
    const a = angle(tip), b = adjacent(i), c = (a + b) / 2
    const r = radius / Math.sin((b - a) / 2)
    return [hub[0] + r * Math.cos(c), hub[1] + r * Math.sin(c)]
  })
  return ends.map((tip, i) => {
    const a = angle(tip)
    const cap = Array.from({ length: 13 }, (_, j): V2 => {
      const th = a + Math.PI * (j / 12 - .5)
      return [tip[0] + radius * Math.cos(th), tip[1] + radius * Math.sin(th)]
    })
    const base: [V2, V2] = [corners[(i + 2) % 3], corners[i]]
    return { base, tip, cap }
  })
}

const inverseSeeds = new WeakMap<SurfaceMap, Array<{ uv: V2; point: V3 }>>()

export function fasciaUV(map: SurfaceMap, x: number, y: number): V2 {
  const error = (p: V3) => (p[0] - x) ** 2 + (p[1] - y) ** 2
  const start = map.invert('z', x, y)
  if (error(map.S(...start)) < 1e-12) return start
  const solve = (start: V2) => {
    let [u, v] = start
    let p = map.S(u, v), e = error(p)
    const h = .0001
    for (let i = 0; i < 24 && e > 1e-14; i++) {
      const a = clamp(u - h, 0, 1), b = clamp(u + h, 0, 1)
      const c = clamp(v - h, 0, 1), d = clamp(v + h, 0, 1)
      const j = scale(sub(map.S(b, v), map.S(a, v)), 1 / (b - a))
      const k = scale(sub(map.S(u, d), map.S(u, c)), 1 / (d - c))
      const det = j[0] * k[1] - j[1] * k[0]
      if (Math.abs(det) < 1e-10) break
      const dx = p[0] - x, dy = p[1] - y
      const du = (k[1] * dx - k[0] * dy) / det, dv = (j[0] * dy - j[1] * dx) / det
      let accept = false
      for (let t = 1; t >= 1 / 32; t /= 2) {
        const s = clamp(u - t * du, 0, 1), r = clamp(v - t * dv, 0, 1)
        const q = map.S(s, r), next = error(q)
        if (next >= e) continue
        accept = true
        u = s
        v = r
        p = q
        e = next
        break
      }
      if (!accept) break
    }
    return { uv: [u, v] as V2, e }
  }
  let best = solve(start)
  if (best.e < 1e-12) return best.uv
  let seeds = inverseSeeds.get(map)
  if (!seeds) {
    seeds = Array.from({ length: 441 }, (_, i) => {
      const uv: V2 = [Math.floor(i / 21) / 20, i % 21 / 20]
      return { uv, point: map.S(...uv) }
    })
    inverseSeeds.set(map, seeds)
  }
  const nearby = seeds.map(s => ({ uv: s.uv, e: error(s.point) })).sort((a, b) => a.e - b.e).slice(0, 3)
  for (const seed of nearby) {
    const res = solve(seed.uv)
    if (res.e < best.e) best = res
    if (best.e < 1e-12) break
  }
  return best.uv
}

export function noseCuts(fm: SurfaceMap): { cuts: Cuts; curves: Record<'eye' | 'outer' | 'center' | 'drlU' | 'drlL' | 'drlS', SurfaceCurve> } {
  const project = (xs: V2[], closed: boolean, step: number, radius: number, acrossCenter = false) => {
    const outline = sample2(xs, step, closed, radius)
    const shape = acrossCenter ? splitAt(outline, p => p[0])[1] : outline
    return new SurfaceCurve(fm.S, shape.map(([x, y]) => fasciaUV(fm, x, y)), closed, acrossCenter)
  }
  const eye = project(lines.eye, true, .005, .012)
  const outer = project(lines.outerIntake, true, .006, .020)
  const center = project(lines.centerIntake, true, .006, .020, true)
  const drlU = project(lines.drlUpper, false, .004, .01)
  const drlL = project(lines.drlLower, false, .004, .01)
  const drlS = project(lines.drlStem, false, .004, .01)
  const slot = project(guideProfile(guideWidth.cut).flatMap(arm => [arm.base[0], ...arm.cap]), true, .004, 0)
  return {
    cuts: { holes: [eye, outer, center, slot].map(c => ({ c, inset: 0 })), gaps: [], glass: [], bands: [] },
    curves: { eye, outer, center, drlU, drlL, drlS },
  }
}

const area = (a: V2, b: V2, c: V2): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
type Stop = (p: V2) => number
type PlaneTriangle = [V2, V2, V2]
const chartKey = (p: V2) => p.map(x => x.toFixed(10)).join(':')
const finish = (loop: V2[]): V2[] => loop.filter((p, i) => {
  const q = loop[(i + 1) % loop.length]
  return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > 1e-9
})
const normalAt = (s: Surface, [u, v]: V2): V3 => {
  for (const h of [.00001, .0002, .001]) {
    const n = cross(sub(s(Math.min(u + h, 1), v), s(Math.max(u - h, 0), v)),
      sub(s(u, Math.min(v + h, 1)), s(u, Math.max(v - h, 0))))
    const l = len(n)
    if (l > 1e-16) return scale(n, (n[2] < 0 ? -1 : 1) / l)
  }
  return [0, 0, 1]
}
const blank = (): TessResult => ({ positions: [], normals: [], uvs: [], indices: [], boundaries: [] })
const vertex = (m: TessResult, p: V3, n: V3): number => {
  m.positions.push(...p)
  m.normals.push(...n)
  m.uvs.push(p[0], p[1])
  return m.positions.length / 3 - 1
}

function splitAt(loop: V2[], stop: Stop): [V2[], V2[]] {
  const a: V2[] = [], b: V2[] = []
  for (const [i, p] of loop.entries()) {
    const q = loop[(i + 1) % loop.length]
    const dp = stop(p), dq = stop(q)
    if (dp <= 1e-10) a.push(p)
    if (dp >= -1e-10) b.push(p)
    if (dp < -1e-10 && dq > 1e-10 || dp > 1e-10 && dq < -1e-10) {
      const t = dp / (dp - dq)
      const r: V2 = [mix(p[0], q[0], t), mix(p[1], q[1], t)]
      a.push(r)
      b.push(r)
    }
  }
  return [finish(a), finish(b)]
}

function addStops(loop: V2[], stops: readonly Stop[]): V2[] {
  return loop.flatMap((p, i) => {
    const q = loop[(i + 1) % loop.length]
    const ts = stops.flatMap(stop => {
      const dp = stop(p), dq = stop(q)
      return dp < -1e-10 && dq > 1e-10 || dp > 1e-10 && dq < -1e-10 ? [dp / (dp - dq)] : []
    }).sort((a, b) => a - b)
    return [p, ...ts.map((t): V2 => [mix(p[0], q[0], t), mix(p[1], q[1], t)])]
  })
}

function gradeTriangles(input: PlaneTriangle[]): PlaneTriangle[] {
  const tris = input.filter(([a, b, c]) => Math.abs(area(a, b, c)) > 1e-13).map(([a, b, c]): PlaneTriangle =>
    area(a, b, c) > 0 ? [a, b, c] : [a, c, b])
  type Edge = { tri: number; a: V2; b: V2; c: V2 }
  const pairs = () => {
    const adj = new Map<string, Edge[]>()
    for (const [i, t] of tris.entries()) for (let j = 0; j < 3; j++) {
      const a = t[j], b = t[(j + 1) % 3], c = t[(j + 2) % 3]
      const p = chartKey(a), q = chartKey(b)
      const id = p < q ? `${p}|${q}` : `${q}|${p}`
      const edge = { tri: i, a, b, c }, list = adj.get(id)
      if (list) list.push(edge)
      else adj.set(id, [edge])
    }
    return adj.values()
  }
  const span2 = (a: V2, b: V2) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
  const circle = (a: V2, b: V2, c: V2, d: V2) =>
    span2(a, d) * area(d, b, c) - span2(b, d) * area(d, a, c) + span2(c, d) * area(d, a, b)
  for (let pass = 0; pass < 9; pass++) {
    const edited = new Set<number>()
    for (const e of pairs()) {
      if (e.length !== 2) continue
      const [{ tri: i, a, b, c }, { tri: j, c: d }] = e
      if (edited.has(i) || edited.has(j)) continue
      if (pass >= 3 && pass <= 5 && span2(a, b) > .075 ** 2) {
        const m: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        tris[i] = [a, m, c]
        tris[j] = [m, a, d]
        tris.push([m, b, c], [b, m, d])
      } else if (area(c, d, b) > 1e-13 && area(d, c, a) > 1e-13 && circle(a, b, c, d) > 1e-13) {
        tris[i] = [c, d, b]
        tris[j] = [d, c, a]
      } else continue
      edited.add(i)
      edited.add(j)
    }
    if (!edited.size && pass >= 6) break
  }
  return tris
}

function triangulate(border: V2[], holes: V2[][], stops: readonly Stop[], emit: (a: V2, b: V2, c: V2) => void): void {
  const asVectors = (loop: V2[]) => loop.map(p => new Vector2(...p))
  const tris = ShapeUtils.triangulateShape(asVectors(border), holes.map(asVectors))
  const points = [...border, ...holes.flat()]
  const used = new Set(tris.flat())
  const omitted = new Map<string, number[]>()
  let start = 0
  for (const loop of [border, ...holes]) {
    const n = loop.length
    for (let i = 0; i < n; i++) {
      if (!used.has(start + i)) continue
      const path: number[] = []
      let j = (i + 1) % n
      while (j !== i && !used.has(start + j)) {
        path.push(start + j)
        j = (j + 1) % n
      }
      if (path.length && j !== i) {
        omitted.set(`${start + i}:${start + j}`, path)
        omitted.set(`${start + j}:${start + i}`, [...path].reverse())
      }
    }
    start += n
  }
  const bands = Array.from({ length: stops.length + 1 }, (): PlaneTriangle[] => [])
  const fan = (poly: V2[], band: number) => {
    if (poly.length < 3) return
    if (poly.length === 3) {
      bands[band].push([poly[0], poly[1], poly[2]])
      return
    }
    const c: V2 = [0, 0]
    for (const p of poly) {
      c[0] += p[0] / poly.length
      c[1] += p[1] / poly.length
    }
    for (const [i, p] of poly.entries()) bands[band].push([c, p, poly[(i + 1) % poly.length]])
  }
  for (const ids of tris) {
    let poly = ids.flatMap((a, i) => [a, ...(omitted.get(`${a}:${ids[(i + 1) % 3]}`) ?? [])]).map(i => points[i])
    for (const [i, stop] of stops.entries()) {
      if (!poly.some(p => stop(p) < -1e-10)) continue
      if (!poly.some(p => stop(p) > 1e-10)) {
        fan(poly, i)
        poly = []
        break
      }
      const [a, b] = splitAt(poly, stop)
      fan(a, i)
      poly = b
    }
    fan(poly, stops.length)
  }
  for (const band of bands) for (const tri of gradeTriangles(band)) emit(...tri)
}

const rollDepth = .014
const openingRoll = frontSection.roll
type Aperture = 'eye' | 'outer' | 'center' | 'slot'
const ringCache = new WeakMap<SurfaceMap, Partial<Record<Aperture, V3[]>>>()
export const fasciaReturn = (map: SurfaceMap, aperture: Aperture): V3[] | undefined => ringCache.get(map)?.[aperture]

function rolledOpening(positions: V3[], normals: V3[], out: TessResult): V3[] {
  const orientation = ShapeUtils.area(positions.map(p => new Vector2(p[0], p[1]))) > 0 ? 1 : -1
  const indices = positions.map((p, i) => {
    const n = normals[i]
    const count = positions.length
    const t = norm(sub(positions[(i + 1) % count], positions[(i + count - 1) % count]))
    const h = norm(cross(n, t)).map(x => x * orientation) as V3
    const ring: number[] = []
    for (let j = 0; j <= 4; j++) {
      const a = Math.PI * j / 8
      const q = addScaled(addScaled(p, h, openingRoll * Math.sin(a)), n, -openingRoll * (1 - Math.cos(a)))
      const d = addScaled(n.map(x => x * Math.cos(a)) as V3, h, Math.sin(a))
      ring.push(vertex(out, q, d))
    }
    const throat = addScaled(addScaled(p, h, openingRoll), n, -rollDepth)
    ring.push(vertex(out, throat, h))
    return { ring, throat }
  })
  for (const [i, { ring: a }] of indices.entries()) {
    const { ring: b } = indices[(i + 1) % indices.length]
    for (let j = 0; j < a.length - 1; j++) {
      if (orientation < 0) out.indices.push(a[j], a[j + 1], b[j + 1], a[j], b[j + 1], b[j])
      else out.indices.push(a[j], b[j + 1], a[j + 1], a[j], b[j], b[j + 1])
    }
  }
  return indices.map(r => r.throat)
}

export function tessellateFascia(map: SurfaceMap, openings: Cuts['holes'], uEdge: readonly number[], vEdge: readonly number[], fieldStops: readonly number[]) {
  const [eye, outer, grille, slot] = openings.map(({ c }) => finish(c.uv))
  const inner = grille.findIndex((p, i) => p[0] < 1e-6 && grille[(i + 1) % grille.length][0] >= 1e-6)
  const notch: V2[] = []
  if (inner >= 0) {
    notch.push([0, grille[inner][1]])
    for (let i = 1; i <= grille.length; i++) {
      const p = grille[(inner + i) % grille.length]
      if (p[0] < 1e-6) {
        notch.push([0, p[1]])
        break
      }
      notch.push(p)
    }
    if (notch[0][1] < notch.at(-1)![1]) notch.reverse()
  }
  const side: V2[] = [
    ...uEdge.map((u): V2 => [u, 0]),
    ...vEdge.slice(1).map((v): V2 => [1, v]),
    ...[...uEdge].reverse().slice(1).map((u): V2 => [u, 1]),
    ...notch,
  ]
  const exact = new Map<string, V2>()
  const project = (uv: V2): V2 => {
    const [x, y] = map.S(...uv), xy: V2 = [x, y]
    exact.set(chartKey(xy), uv)
    return xy
  }
  const stops = fieldStops.map((u): Stop => {
    const atBrow = uEdge.reduce((best, next) => Math.abs(u - next) < Math.abs(u - best) ? next : best)
    const a = project([u, 0]), b = project([atBrow, 1])
    return p => -area(a, b, p)
  })
  const sample = (p: V2) => {
    const uv = exact.get(chartKey(p)) ?? fasciaUV(map, ...p)
    return { point: [p[0], p[1], map.S(...uv)[2]] as V3, normal: normalAt(map.S, uv) }
  }
  const border = addStops(finish(side.map(project)), stops)
  const holes = [eye, outer, slot, ...(notch.length ? [] : [grille])].map(loop => addStops(finish(loop.map(project)), stops))
  const skin = blank(), shell = blank()
  const cache = new Map<string, number>()
  const id = (xy: V2) => {
    const k = chartKey(xy)
    let i = cache.get(k)
    if (i === undefined) {
      const { point: p, normal: n } = sample(xy)
      i = vertex(skin, p, n)
      vertex(shell, [p[0], p[1], p[2] - rollDepth], n)
      cache.set(k, i)
    }
    return i
  }
  triangulate(border, holes, stops, (a, b, c) => {
    const ar = area(a, b, c)
    if (Math.abs(ar) < 1e-13) return
    const abc = ar > 0 ? [id(a), id(b), id(c)] : [id(a), id(c), id(b)]
    skin.indices.push(...abc)
    shell.indices.push(...abc)
  })
  const lip = blank()
  const rings: Partial<Record<Aperture, V3[]>> = {}
  for (const [i, loop] of holes.entries()) {
    const ps = loop.map(sample)
    rings[(['eye', 'outer', 'slot', 'center'] as const)[i]] = rolledOpening(ps.map(p => p.point), ps.map(p => p.normal), lip)
  }
  if (notch.length) {
    const half = addStops(finish(notch.map(project)), stops).map(sample)
    for (const i of [0, half.length - 1]) {
      half[i].point[0] = 0
      half[i].normal = norm([0, half[i].normal[1], half[i].normal[2]])
    }
    const whole = [...half, ...half.slice(1, -1).reverse().map(p => ({ point: reflect(p.point), normal: reflect(p.normal) }))]
    const centre = blank()
    rings.center = rolledOpening(whole.map(p => p.point), whole.map(p => p.normal), centre)
    const ringSize = 6
    lip.positions.push(...centre.positions.slice(0, half.length * ringSize * 3))
    lip.normals.push(...centre.normals.slice(0, half.length * ringSize * 3))
    lip.uvs.push(...centre.uvs.slice(0, half.length * ringSize * 2))
    const offset = lip.positions.length / 3 - half.length * ringSize
    for (let i = 0; i < (half.length - 1) * (ringSize - 1) * 6; i++) lip.indices.push(offset + centre.indices[i])
  }
  ringCache.set(map, rings)
  return { paint: [skin, lip], shell }
}
