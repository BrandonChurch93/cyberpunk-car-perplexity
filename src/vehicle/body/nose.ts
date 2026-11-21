import { ShapeUtils, Vector2 } from 'three'
import { coons, type Curve } from '../geom/coons'
import type { Loft } from '../geom/loft'
import { sample2, smax, smin, SurfaceCurve, type Surface, type SurfaceMap } from '../geom/cuts'
import type { TessResult } from '../geom/tessellate'
import { add, addScaled, clamp, cross, dot, len, lerp3, mix, norm, scale, smoothstep, sub, type V2, type V3 } from '../geom/vec'
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
    let a = 0, b = stations.length - 1
    if (u <= stations[a]) return points[a]
    if (u >= stations[b]) return points[b]
    while (b - a > 1) {
      const i = (a + b) >> 1
      if (u === stations[i]) return points[i]
      if (u > stations[i]) a = i
      else b = i
    }
    return lerp3(points[a], points[b], (u - stations[a]) / (stations[b] - stations[a]))
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
  const chinTip: V3 = [0, side(0)[1], plane(brow(0), brow(fold), foldBottom).depth(0, side(0)[1])]
  const chin = (u: number) => u < fold ? lerp3(chinTip, foldBottom, u / fold) : lerp3(foldBottom, side(0), (u - fold) / (1 - fold))
  return { surface: ruledFascia({ brow, chin, side, fold }), uEdge, vEdge }
}

function plane(a: V3, b: V3, c: V3) {
  const n = norm(cross(sub(b, a), sub(c, a)))
  const dx = -n[0] / n[2], dy = -n[1] / n[2]
  return { dx, dy, depth: (x: number, y: number) => a[2] + dx * (x - a[0]) + dy * (y - a[1]) }
}

function facet(points: V3[], field = plane(points[0], points[1], points[2])) {
  const perimeter = points.map(([x, y]): V2 => [x, y])
  const sign = ShapeUtils.area(perimeter.map(p => new Vector2(...p))) < 0 ? -1 : 1
  const tests = perimeter.map((a, i) => {
    const b = perimeter[(i + 1) % points.length]
    const k = sign / Math.hypot(b[0] - a[0], b[1] - a[1])
    return (p: V2) => area(a, b, p) * k
  })
  return { ...field, margin: (p: V2) => Math.min(...tests.map(t => t(p))) }
}

const creaseRoll = .003
function rolledCrease(name: string, a: V3, b: V3, left: ReturnType<typeof plane>, right: ReturnType<typeof plane>) {
  const axis = sub(b, a)
  const span = Math.hypot(axis[0], axis[1])
  const tx = axis[0] / span, ty = axis[1] / span, nx = -ty, ny = tx
  const vertical = span / len(axis)
  const ml = (left.dx * nx + left.dy * ny) * vertical, mr = (right.dx * nx + right.dy * ny) * vertical
  const l = norm([-1, 0, -ml]), r = norm([1, 0, mr])
  const half = .5 * Math.acos(clamp(dot(l, r), -1, 1))
  const inset = creaseRoll / Math.tan(half), c = scale(norm(add(l, r)), creaseRoll / Math.sin(half))
  const low = l[0] * inset, high = r[0] * inset
  const q = ([x, y]: V2) => (x - a[0]) * nx + (y - a[1]) * ny
  const along = ([x, y]: V2) => (x - a[0]) * tx + (y - a[1]) * ty
  return {
    name, a, b, angle: Math.PI - 2 * half,
    stops: [low, mix(low, high, .25), mix(low, high, .5), mix(low, high, .75), high].map(k => (p: V2) => q(p) - k),
    sample: (p: V2) => {
      const d = q(p), t = along(p) / span
      if (t < 0 || t > 1 || d < low || d > high) return undefined
      const h = Math.sqrt(Math.max(0, creaseRoll ** 2 - (d - c[0]) ** 2))
      const base = (d < 0 ? left : right).depth(...p)
      const cap = Math.min(1, t * span / creaseRoll, (1 - t) * span / creaseRoll)
      const arc = mix(a[2], b[2], t) + (c[2] - Math.sign(c[2]) * h) / vertical
      return { weight: Math.abs(d) / Math.max(1e-7, d < 0 ? -low : high), z: mix(base, arc, cap) }
    },
  }
}

const fasciaCreases = new WeakMap<Surface, ReturnType<typeof rolledCrease>[]>()
export const fittedFasciaCreases = (s: Surface) => fasciaCreases.get(s) ?? []

export function ruledFascia({ brow, chin, side, fold }: FasciaRails): FasciaSurface {
  const topAt = (v: number) => brow((1 - v) / (1 - cheekV))
  const nominal = (name: string) => {
    const k = sectionKnots.find(k => k.name === name)!
    const expected = addScaled([...k.p], fasciaDown(k.v), frontSection.roll)
    const actual = k.v >= cheekV ? topAt(k.v) : side(k.v / cheekV)
    return len(sub(actual, expected)) < .012 ? actual : expected
  }
  const tip = brow(0), vee = topAt(shieldV), corner = nominal('corner'), browTip = brow(1)
  const outer = nominal('crease'), foot = side(0), split = chin(fold), centerFoot = chin(0)
  const cheekPlane = plane(corner, foot, split)
  const edge = side((frontSection.side[1].v + frontSection.side[2].v) / (2 * cheekV))
  const shoulder: V3 = [edge[0], edge[1], cheekPlane.depth(edge[0], edge[1])]
  const shield = facet([tip, vee, split, centerFoot])
  const ramp = facet([vee, corner, split])
  const duct = facet([corner, shoulder, foot, split], cheekPlane)
  const eye = facet([corner, browTip, shoulder])
  const wrap = facet([browTip, outer, shoulder])
  const fields = [shield, ramp, duct, eye, wrap]
  const eyeShoulder = .044, browShoulder = .068
  const support = (a: typeof eye, b: typeof eye, width: number) => {
    const slope = Math.hypot(a.dx - b.dx, a.dy - b.dy)
    return [-1, -.5, 0, .5, 1].map(k => (p: V2) => (a.depth(...p) - b.depth(...p) - width * k) / slope)
  }
  const creases = [
    rolledCrease('shield center spine', centerFoot, tip, shield, { ...shield, dx: -shield.dx }),
    rolledCrease('shield-to-cheek V', split, vee, ramp, shield),
    rolledCrease('inboard intake fold', split, corner, duct, ramp),
  ]
  const field = (p: V2) => {
    const t = smoothstep(corner[0], corner[0] + .105, p[0])
    const fair = () => smax(duct.depth(...p), smin(eye.depth(...p), wrap.depth(...p), browShoulder), eyeShoulder)
    if (t === 1) return fair()
    let pick = fields[0], best = -Infinity
    for (const f of fields) {
      const m = f.margin(p)
      if (m > best) { best = m; pick = f }
    }
    let closest: ReturnType<ReturnType<typeof rolledCrease>['sample']>
    for (const c of creases) {
      const sample = c.sample(p)
      if (sample && (!closest || sample.weight < closest.weight)) closest = sample
    }
    const z = closest?.z ?? pick.depth(...p)
    return t === 0 ? z : mix(z, fair(), t)
  }
  const center = segment(centerFoot, tip), crease = segment(split, vee)
  const inner = coons(u => chin(u * fold), u => brow(u * fold), center, crease)
  const outerChart = coons(u => chin(mix(fold, 1, u)), u => brow(mix(fold, 1, u)), crease, side)
  const lift = (p: V3, q: V3, span: number) => {
    const t = Math.max(0, 1 - Math.hypot(p[0] - q[0], p[1] - q[1]) / span)
    return t * t * (3 - 2 * t)
  }
  const residual = (q: V3) => q[2] - field([q[0], q[1]])
  const topCorner = residual(brow(1)), lowerCorner = residual(side(0))
  const surface: Surface = (u, v) => {
    if (v === 1) return brow(u)
    if (u === 1) return side(v)
    if (v === 0) return chin(u)
    const p = u <= fold ? inner(u / fold, v) : outerChart((u - fold) / (1 - fold), v)
    const top = brow(u), outerEdge = side(v), bottom = chin(u)
    const t = lift(p, top, .052), o = lift(p, outerEdge, .068), b = lift(p, bottom, .046)
    const blend = (t && t * residual(top)) + (b && b * residual(bottom))
      + (o && o * (residual(outerEdge) - t * topCorner - b * lowerCorner))
    const undercut = .046 * Math.sin(Math.PI * v) ** 2 * (1 - smoothstep(.19, .59, p[0]))
    return [p[0], p[1], field([p[0], p[1]]) + blend - undercut]
  }
  fasciaCreases.set(surface, [...creases,
    { ...rolledCrease('eye-to-duct facet', shoulder, corner, eye, duct), stops: support(eye, duct, eyeShoulder) },
    { ...rolledCrease('outer brow return', shoulder, browTip, wrap, eye), stops: support(eye, wrap, browShoulder) },
  ])
  return Object.assign(surface, { fieldStops: [] })
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

const junction: [number, number] = [205, 455]

export const lines = {
  eye: map(elev, [[185, 380], [251, 389], [315, 408], [330, 419], [316, 431], [251, 427], [195, 426], [182, 405]]),
  outerIntake: map(elev, [[224, 476], [356, 486], [490, 511], [451, 561], [357, 621], [200, 622], [184, 581]]),
  centerIntake: map(elev, [[553, 551], [745, 551], [745, 625], [589, 625], [551, 586]]),
  drlUpper: map(elev, [[163, 408], junction]),
  drlLower: map(elev, [junction, [153, 584]]),
  drlStem: map(elev, [junction, [379, 462]]),
}

export const guideWidth = { cut: .0165, seat: .0135, lens: .0075 } as const

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
    const width = tip === lines.drlUpper[0] ? radius * .64 : radius
    const cap = Array.from({ length: 13 }, (_, j): V2 => {
      const th = a + Math.PI * (j / 12 - .5)
      return [tip[0] + width * Math.cos(th), tip[1] + width * Math.sin(th)]
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
  const eye = project(lines.eye.map(([x, y]) => [x - .009, y]), true, .005, .012)
  const outer = project(lines.outerIntake, true, .005, .013)
  const center = project(lines.centerIntake, true, .005, .012, true)
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
// Reuse the endpoint where a crease stop nearly grazes a fan of edges.
const stopSnap = 1e-5
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
    if (dp <= stopSnap) a.push(p)
    if (dp >= -stopSnap) b.push(p)
    if (dp < -stopSnap && dq > stopSnap || dp > stopSnap && dq < -stopSnap) {
      const t = dp / (dp - dq)
      const r: V2 = [mix(p[0], q[0], t), mix(p[1], q[1], t)]
      a.push(r)
      b.push(r)
    }
  }
  return [finish(a), finish(b)]
}

const lerp2 = (a: V2, b: V2, t: number): V2 => [mix(a[0], b[0], t), mix(a[1], b[1], t)]
const edgeStops = (p: V2, q: V2, stops: readonly Stop[]) => stops.flatMap(stop => {
  const a = stop(p), b = stop(q)
  return a < -stopSnap && b > stopSnap || a > stopSnap && b < -stopSnap ? [a / (a - b)] : []
}).sort((a, b) => a - b)
const addStops = (loop: V2[], stops: readonly Stop[]): V2[] => loop.flatMap((p, i) => {
  const q = loop[(i + 1) % loop.length]
  return [p, ...edgeStops(p, q, stops).map(t => lerp2(p, q, t))]
})

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
  for (let pass = 0; pass < 16; pass++) {
    const edited = new Set<number>()
    for (const e of pairs()) {
      if (e.length !== 2) continue
      const [{ tri: i, a, b, c }, { tri: j, c: d }] = e
      if (edited.has(i) || edited.has(j)) continue
      const width = span2(a, b)
      if (pass >= 3 && pass <= 9 && width > .030 ** 2 &&
        Math.min(area(a, b, c), area(b, a, d)) > .001 * Math.sqrt(width)) {
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
    if (!edited.size && pass >= 10) break
  }
  return tris
}

function triangulate(border: V2[], holes: V2[][], stops: readonly Stop[], emit: (a: V2, b: V2, c: V2) => void): void {
  const points = [...border, ...holes.flat()]
  let start = 0
  const loops = [border, ...holes]
  // Earcut can drop near-collinear stations, so restore them on their owning chord.
  const anchors = loops.map(loop => {
    const ids = loop.flatMap((p, i) => {
      const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length]
      const between = (p[0] - a[0]) * (p[0] - b[0]) + (p[1] - a[1]) * (p[1] - b[1]) < 0
      return between && Math.abs(area(a, b, p)) < 1e-6 * Math.hypot(b[0] - a[0], b[1] - a[1]) ? [] : [start + i]
    })
    start += loop.length
    return ids
  })
  const [outline, ...inner] = anchors.map(ids => ids.map(i => new Vector2(...points[i])))
  const kept = anchors.flat()
  const tris = ShapeUtils.triangulateShape(outline, inner)
    .map(ids => ids.map(i => kept[i]))
    .filter(([a, b, c]) => Math.abs(area(points[a], points[b], points[c])) > 1e-13)
  const used = new Set(tris.flat())
  const omitted = new Map<string, number[]>()
  start = 0
  for (const loop of loops) {
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
  const bands = new Map<number, PlaneTriangle[]>()
  const fan = (poly: V2[], band: number) => {
    if (poly.length < 3) return
    const batch = bands.get(band) ?? []
    bands.set(band, batch)
    if (poly.length === 3) {
      batch.push([poly[0], poly[1], poly[2]])
      return
    }
    const c: V2 = [0, 0]
    for (const p of poly) {
      c[0] += p[0] / poly.length
      c[1] += p[1] / poly.length
    }
    for (const [i, p] of poly.entries()) batch.push([c, p, poly[(i + 1) % poly.length]])
  }
  const clip = (poly: V2[], i: number, band: number): void => {
    if (poly.length < 3) return
    if (i === stops.length) return fan(poly, band)
    const stop = stops[i], bit = 2 ** i
    if (!poly.some(p => stop(p) < -stopSnap)) return clip(poly, i + 1, band + bit)
    if (!poly.some(p => stop(p) > stopSnap)) return clip(poly, i + 1, band)
    const [a, b] = splitAt(poly, stop)
    clip(a, i + 1, band)
    clip(b, i + 1, band + bit)
  }
  for (const ids of tris) {
    const poly = ids.flatMap((a, i) => [a, ...(omitted.get(`${a}:${ids[(i + 1) % 3]}`) ?? [])]).map(i => points[i])
    clip(poly, 0, 0)
  }
  for (const band of bands.values()) for (const tri of gradeTriangles(band)) emit(...tri)
}

const rollDepth = .014
const openingRoll = frontSection.roll
type Aperture = 'eye' | 'outer' | 'center' | 'slot'
type Throat = { point: V3; seat: V3; inward: V3; normal: V3 }
const ringCache = new WeakMap<SurfaceMap, Partial<Record<Aperture, Throat[]>>>()
export const fasciaReturn = (map: SurfaceMap, aperture: Aperture): V3[] | undefined =>
  ringCache.get(map)?.[aperture]?.map(s => s.point)
export const fasciaThroat = (map: SurfaceMap, aperture: Aperture): Throat[] | undefined => ringCache.get(map)?.[aperture]

type FasciaSample = (p: V2) => { point: V3; normal: V3 }
const orientation = (loop: V2[]) => ShapeUtils.area(loop.map(p => new Vector2(...p))) > 0 ? 1 : -1
function rimMiters(loop: V2[], sign: number): V2[] {
  const count = loop.length
  const tangentIn = (a: V2, b: V2) => {
    const x = b[0] - a[0], y = b[1] - a[1], length = Math.hypot(x, y)
    return [-sign * y / length, sign * x / length] as V2
  }
  return loop.map((p, i): V2 => {
    const a = tangentIn(loop[(i + count - 1) % count], p), b = tangentIn(p, loop[(i + 1) % count])
    const d = 1 + a[0] * b[0] + a[1] * b[1]
    return [(a[0] + b[0]) / d, (a[1] + b[1]) / d]
  })
}

function returnOpening(loop: V2[], sample: FasciaSample, out: TessResult, round = openingRoll): Throat[] {
  const sign = orientation(loop), count = loop.length, miters = rimMiters(loop, sign)
  const radius = round * .72
  const profiles = [0, 1, 2, 3, 4].map(i => {
    const a = i * Math.PI / 8
    return [radius * Math.sin(a), round * (1 - Math.cos(a))]
  }).concat([[radius + .0006, .008], [radius + .0014, rollDepth]])
  const rows = profiles.map(([inset, depth]) => loop.map(([x, y], i): V3 => {
    const { point: p } = sample([x + inset * miters[i][0], y + inset * miters[i][1]])
    return [p[0], p[1], p[2] - depth]
  }))
  const base = out.positions.length / 3
  const normals = rows.map((row, j) => row.map((p, i) => {
    const before = sub(p, row[(i + count - 1) % count]), after = sub(row[(i + 1) % count], p)
    const along = add(norm(before), norm(after))
    const across = sub(rows[Math.min(j + 1, rows.length - 1)][i], rows[Math.max(j - 1, 0)][i])
    const n = j === 0 ? sample(loop[i]).normal : scale(norm(cross(along, across)), sign)
    vertex(out, p, n)
    return n
  }))
  for (let j = 1; j < rows.length; j++) {
    for (let i = 0; i < count; i++) {
      const a = base + (j - 1) * count + i, b = base + (j - 1) * count + (i + 1) % count
      if (sign > 0) out.indices.push(a, b, b + count, a, b + count, a + count)
      else out.indices.push(a, b + count, b, a, a + count, b + count)
    }
  }
  const last = rows.length - 1
  return rows[last].map((point, i) => ({
    point, seat: rows[4][i], inward: norm(sub(point, rows[last - 1][i])), normal: normals[last][i],
  }))
}

type Collar = { rim: V2[]; field: V2[]; blade: (p: V2) => number }
function collar(loop: V2[], stops: readonly Stop[], width: (p: V2) => number, blade: (p: V2) => number): Collar {
  const miters = rimMiters(loop, orientation(loop))
  const edge = loop.map(([x, y], i): V2 => {
    const w = width(loop[i])
    return [x - w * miters[i][0], y - w * miters[i][1]]
  })
  const stations = loop.flatMap((p, i) => {
    const j = (i + 1) % loop.length, a = edge[i], b = edge[j]
    return [0, ...edgeStops(a, b, stops)].map(t => ({ rim: lerp2(p, loop[j], t), field: lerp2(a, b, t) }))
  }).filter((p, i, all) => {
    const q = all[(i + 1) % all.length]
    return Math.hypot(p.field[0] - q.field[0], p.field[1] - q.field[1]) > 1e-8
  })
  return { rim: stations.map(p => p.rim), field: stations.map(p => p.field), blade }
}

function collarSurface({ rim, field, blade }: Collar, sample: FasciaSample, out: TessResult, shell: TessResult): void {
  const stations = [0, .22, .48, .72, 1]
  const rows = stations.map(t => rim.map((p, i) => {
    const s = sample(lerp2(field[i], p, t))
    return { normal: s.normal, point: [s.point[0], s.point[1], s.point[2] + blade(p) * Math.sin(Math.PI * t) ** 2] as V3 }
  }))
  const count = rim.length, sign = orientation(rim)
  const base = out.positions.length / 3, back = shell.positions.length / 3
  for (const [j, row] of rows.entries()) {
    for (const [i, s] of row.entries()) {
      const before = norm(sub(s.point, row[(i + count - 1) % count].point))
      const after = norm(sub(row[(i + 1) % count].point, s.point))
      const along = add(before, after)
      const across = sub(rows[Math.min(j + 1, rows.length - 1)][i].point, rows[Math.max(j - 1, 0)][i].point)
      const n = j === 0 || j === rows.length - 1 ? s.normal : scale(norm(cross(along, across)), sign)
      vertex(out, s.point, n)
      vertex(shell, [s.point[0], s.point[1], s.point[2] - rollDepth], n)
    }
  }
  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < count; i++) {
      const a = j * count + i, b = j * count + (i + 1) % count
      const quad = sign > 0 ? [a, b, b + count, a, b + count, a + count] : [a, b + count, b, a, a + count, b + count]
      out.indices.push(...quad.map(k => base + k))
      shell.indices.push(...quad.map(k => back + k))
    }
  }
}

const bumperGap = .004, bumperEdgeRoll = .0015, bumperReturn = .0108
function bumperEdge(map: SurfaceMap, uEdge: readonly number[], vEdge: readonly number[]) {
  const row = (p: V2, distance: number): V2 => {
    const start = map.S(...p)
    const at = (axis: 0 | 1) => {
      if (p[axis] !== 1) return p[axis]
      const q = [...p] as V2
      let lo = .95, hi = 1
      for (let i = 0; i < 14; i++) {
        const t = (lo + hi) / 2
        q[axis] = t
        if (len(sub(start, map.S(...q))) > distance) lo = t
        else hi = t
      }
      return (lo + hi) / 2
    }
    return [at(0), at(1)]
  }
  const skinDistance = bumperGap + bumperEdgeRoll
  const [u, v] = row([1, 1], skinDistance)
  const pins: V2[] = [
    ...vEdge.filter(t => t < v - .0005).map((t): V2 => [1, t]),
    [1, 1],
    ...[...uEdge].reverse().filter(t => t < u - .0005).map((t): V2 => [t, 1]),
  ]
  return pins.map(p => ({
    section: [0, 1, 2, 3, 4, 5].map(i => {
      const a = Math.min(i, 4) * Math.PI / 8
      return row(p, skinDistance - bumperEdgeRoll * Math.sin(a))
    }),
  }))
}

function bumperFlange(rail: V2[][], sample: FasciaSample, stops: readonly Stop[], out: TessResult): void {
  const columns = rail.flatMap((a, i) => {
    if (i === rail.length - 1) return [a]
    const b = rail[i + 1]
    return [a, ...edgeStops(a[0], b[0], stops).map(t => a.map((p, j) => lerp2(p, b[j], t)))]
  })
  const points = columns.map(column => column.map((p, j) => {
    const { point, normal } = sample(p)
    const a = Math.min(j, 4) * Math.PI / 8
    const depth = j === 5 ? bumperReturn : bumperEdgeRoll * (1 - Math.cos(a))
    return { point: addScaled(point, normal, -depth), normal }
  }))
  const base = out.positions.length / 3, rows = rail[0].length
  for (const [i, column] of points.entries()) {
    for (const [j, { point, normal }] of column.entries()) {
      const along = sub(points[Math.min(i + 1, points.length - 1)][j].point, points[Math.max(0, i - 1)][j].point)
      const across = sub(column[Math.min(j + 1, rows - 1)].point, column[Math.max(0, j - 1)].point)
      let n = j === 0 ? normal : norm(cross(across, along))
      if (i === points.length - 1) n = norm([0, n[1], n[2]])
      vertex(out, point, n)
    }
  }
  for (let i = 1; i < points.length; i++) {
    for (let j = 0; j < rows - 1; j++) {
      const a = base + (i - 1) * rows + j, b = a + rows
      out.indices.push(a, a + 1, b + 1, a, b + 1, b)
    }
  }
}

function rolledOpening(positions: V3[], normals: V3[], out: TessResult): Throat[] {
  const orientation = ShapeUtils.area(positions.map(p => new Vector2(p[0], p[1]))) > 0 ? 1 : -1
  const indices = positions.map((p, i) => {
    const n = normals[i]
    const count = positions.length
    const t = norm(add(norm(sub(p, positions[(i + count - 1) % count])), norm(sub(positions[(i + 1) % count], p))))
    const h = norm(cross(n, t)).map(x => x * orientation) as V3
    const ring: number[] = []
    for (let j = 0; j <= 4; j++) {
      const a = Math.PI * j / 8
      const q = addScaled(addScaled(p, h, openingRoll * Math.sin(a)), n, -openingRoll * (1 - Math.cos(a)))
      const d = addScaled(n.map(x => x * Math.cos(a)) as V3, h, Math.sin(a))
      ring.push(vertex(out, q, d))
    }
    const shoulder = addScaled(p, h, openingRoll)
    const seat = addScaled(shoulder, n, -openingRoll)
    const throat = addScaled(shoulder, n, -rollDepth)
    ring.push(vertex(out, throat, h))
    return { ring, throat: { point: throat, seat, inward: scale(n, -1), normal: h } }
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
  const exact = new Map<string, V2>()
  const project = (uv: V2): V2 => {
    const [x, y] = map.S(...uv), xy: V2 = [x, y]
    exact.set(chartKey(xy), uv)
    return xy
  }
  const numeric = fieldStops.map((u): Stop => {
    const atBrow = uEdge.reduce((best, next) => Math.abs(u - next) < Math.abs(u - best) ? next : best)
    const a = project([u, 0]), b = project([atBrow, 1])
    const span = Math.hypot(b[0] - a[0], b[1] - a[1])
    return p => -area(a, b, p) / span
  })
  const edge = bumperEdge(map, uEdge, vEdge)
  const rail = edge.map(p => p.section.map(project))
  const side: V2[] = [
    ...uEdge.filter(u => u < edge[0].section[0][0] - .0005).map(u => project([u, 0])),
    ...rail.map(r => r[0]),
    ...notch.map(project),
  ]
  const stops = [...numeric, ...fittedFasciaCreases(map.S).flatMap(c => c.stops)]
  const sample = (p: V2) => {
    const uv = exact.get(chartKey(p)) ?? fasciaUV(map, ...p)
    return { point: [p[0], p[1], map.S(...uv)[2]] as V3, normal: normalAt(map.S, uv) }
  }
  const border = addStops(finish(side), stops)
  const chart = (loop: V2[]) => finish(loop.map(project))
  const eyeLoop = addStops(chart(eye), stops)
  const outerCollar = collar(chart(outer), stops,
    ([x, y]) => .007 + .021 * (1 - smoothstep(.21, .36, y)) * (1 - smoothstep(.66, .87, x)),
    ([x, y]) => .014 * (1 - smoothstep(.235, .36, y)) * (1 - smoothstep(.68, .89, x)))
  const slotCollar = collar(chart(slot), stops, () => .0045, () => 0)
  const grilleLoop = notch.length ? [] : addStops(chart(grille), stops)
  const holes = [eyeLoop, outerCollar.field, slotCollar.field, ...(grilleLoop.length ? [grilleLoop] : [])]
  const skin = blank(), shell = blank(), lip = blank()
  const cache = new Map<string, number>()
  const floatKeys: string[] = []
  const id = (xy: V2) => {
    const k = chartKey(xy)
    let i = cache.get(k)
    if (i === undefined) {
      const { point: p, normal: n } = sample(xy)
      i = vertex(skin, p, n)
      vertex(shell, [p[0], p[1], p[2] - rollDepth], n)
      floatKeys.push(p.map(Math.fround).join(':'))
      cache.set(k, i)
    }
    return i
  }
  triangulate(border, holes, stops, (a, b, c) => {
    const ar = area(a, b, c)
    if (Math.abs(ar) < 1e-13) return
    const abc = ar > 0 ? [id(a), id(b), id(c)] : [id(a), id(c), id(b)]
    if (new Set(abc.map(i => floatKeys[i])).size < 3) return
    skin.indices.push(...abc)
    shell.indices.push(...abc)
  })
  bumperFlange(rail, sample, stops, lip)
  collarSurface(outerCollar, sample, lip, shell)
  collarSurface(slotCollar, sample, lip, shell)
  const rings: Partial<Record<Aperture, Throat[]>> = {
    eye: returnOpening(eyeLoop, sample, lip),
    outer: returnOpening(outerCollar.rim, sample, lip),
    slot: returnOpening(slotCollar.rim, sample, lip, .0024),
  }
  if (grilleLoop.length) {
    const ps = grilleLoop.map(sample)
    rings.center = rolledOpening(ps.map(p => p.point), ps.map(p => p.normal), lip)
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
