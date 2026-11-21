import { scalar, Track3 } from './spline'
import { add, addScaled, cross, dist, dot, len, norm, rotate, scale, sub, type V3 } from './vec'

type Knots = number | ReadonlyArray<readonly [number, number]>

export interface KeyDef {
  /** (u, x, y, z) points the key line passes through. */
  pts?: ReadonlyArray<readonly [number, number, number, number]>
  /** The key line as an exact curve over u, used instead of `pts`. */
  fn?: (u: number) => V3
  /** Distance from the key line over which the section is rounded, meters. 0 keeps a crease. */
  round?: Knots
  /**
   * Roll radius across the key line, meters. The section is rounded over the setback that gives this radius at the
   * local turn, measured across the line, so a crease shows the same edge however sharply it turns. Added to `round`.
   */
  roll?: Knots
  /** 0 bends the section through the key line smoothly, 1 keeps the two segment tangents. */
  sharp?: Knots
  monotone?: boolean
}

export interface SegDef {
  /** Angle between the chord and the start tangent, radians, positive bulging outward. */
  bulgeA: Knots
  bulgeB?: Knots
  /**
   * 1 turns the start tangent to the end tangent mirrored in the chord, so a span leaving a crease onto a crown carries
   * the crown's curvature right to the crease instead of starting straight; 0 keeps `bulgeA`.
   */
  fairA?: Knots
}

export interface LoftDef {
  keys: KeyDef[]
  segs: SegDef[]
  /** v at each key. First is 0, last is 1. */
  vAt: number[]
  /** Fraction of a segment's v span given to each rounding. */
  band?: number
  /** The last key lies on the plane x = 0 and the section meets its mirror there. */
  mirrorTop?: boolean
}

interface Section {
  p: V3[]
  segA: V3[][]
  segL: number[]
  round: number[]
  /** Parameter on the segment ending at each key where its fillet starts. */
  tIn: number[]
  /** Parameter on the segment starting at each key where its fillet ends. */
  tOut: number[]
  /** Arc weight per key: the cosine of half the turn across the line where a roll sets it, else negative. */
  wt: number[]
}

/** A surface swept across key lines. S(u, v): u runs along the key lines, v across them. */
export class Loft {
  private readonly keys: Array<{ at(u: number): V3 }>
  private readonly round: Array<(u: number) => number>
  private readonly roll: Array<(u: number) => number>
  private readonly sharp: Array<(u: number) => number>
  private readonly bulgeA: Array<(u: number) => number>
  private readonly bulgeB: Array<(u: number) => number>
  private readonly fairA: Array<(u: number) => number>
  private readonly cache = new Map<number, Section>()
  readonly vAt: number[]
  readonly band: number
  readonly mirrorTop: boolean

  constructor(def: LoftDef) {
    this.keys = def.keys.map((k) => (k.fn ? { at: k.fn } : new Track3(k.pts ?? [], k.monotone ?? false)))
    this.round = def.keys.map((k) => scalar(k.round ?? 0))
    this.roll = def.keys.map((k) => scalar(k.roll ?? 0))
    this.sharp = def.keys.map((k) => scalar(k.sharp ?? 0))
    this.bulgeA = def.segs.map((s) => scalar(s.bulgeA))
    this.bulgeB = def.segs.map((s) => scalar(s.bulgeB ?? s.bulgeA))
    this.fairA = def.segs.map((s) => scalar(s.fairA ?? 0))
    this.vAt = def.vAt
    this.band = def.band ?? 0.12
    this.mirrorTop = def.mirrorTop ?? false
  }

  key(i: number, u: number): V3 {
    return this.keys[i].at(u)
  }

  private section(u: number): Section {
    const hit = this.cache.get(u)
    if (hit) return hit
    if (this.cache.size > 20000) this.cache.clear()
    const n = this.keys.length
    const h = 1e-4
    const p: V3[] = []
    const along: V3[] = []
    for (let i = 0; i < n; i++) {
      p.push(this.keys[i].at(u))
      along.push(norm(sub(this.keys[i].at(Math.min(1, u + h)), this.keys[i].at(Math.max(0, u - h)))))
    }
    const chordDir: V3[] = []
    const axis: V3[] = []
    for (let k = 0; k < n - 1; k++) {
      const c = norm(sub(p[k + 1], p[k]))
      chordDir.push(c)
      const a = norm(add(along[k], along[k + 1]))
      const ax = norm(sub(a, scale(c, dot(a, c))))
      axis.push(len(ax) > 0.5 ? ax : a)
    }
    const tStart: V3[] = []
    const tEnd: V3[] = []
    for (let k = 0; k < n - 1; k++) {
      tStart.push(rotate(chordDir[k], axis[k], this.bulgeA[k](u)))
      tEnd.push(rotate(chordDir[k], axis[k], -this.bulgeB[k](u)))
    }
    for (let i = 1; i < n - 1; i++) {
      const s = this.sharp[i](u)
      if (s >= 1) continue
      // Each side weighted by the other side's chord, the tangent of the parabola through the three keys, so a line
      // of keys on one even crown gives one even curvature across however unevenly they are spaced.
      const avg = norm(add(scale(tEnd[i - 1], dist(p[i], p[i + 1])), scale(tStart[i], dist(p[i - 1], p[i]))))
      tEnd[i - 1] = norm(add(scale(avg, 1 - s), scale(tEnd[i - 1], s)))
      tStart[i] = norm(add(scale(avg, 1 - s), scale(tStart[i], s)))
    }
    if (this.mirrorTop) {
      const s = this.sharp[n - 1](u)
      tEnd[n - 2] = norm(add(scale([-1, 0, 0], 1 - s), scale(tEnd[n - 2], s)))
    }
    for (let k = 0; k < n - 1; k++) {
      const f = this.fairA[k](u)
      if (f <= 0) continue
      const c = chordDir[k]
      const mirrored = norm(sub(scale(c, 2 * dot(tEnd[k], c)), tEnd[k]))
      tStart[k] = norm(add(scale(tStart[k], 1 - f), scale(mirrored, f)))
    }
    const segA: V3[][] = []
    const segL: number[] = []
    for (let k = 0; k < n - 1; k++) {
      const L = dist(p[k], p[k + 1])
      const d = L / 3
      segA.push([p[k], addScaled(p[k], tStart[k], d), addScaled(p[k + 1], tEnd[k], -d), p[k + 1]])
      segL.push(L)
    }
    const round: number[] = []
    const tIn: number[] = []
    const tOut: number[] = []
    const wt: number[] = []
    for (let i = 0; i < n; i++) {
      let w = -1
      const r0 = this.round[i](u)
      let rA = r0
      let rB = r0
      const rho = i > 0 && i < n - 1 ? this.roll[i](u) : 0
      if (rho > 0) {
        // The two faces turn by the angle between their normals. Across the line a roll of radius rho stands back
        // rho tan(turn / 2) on each face; each segment crosses the line at its own angle, so its own setback along
        // the section is that over its own sine, which leaves both legs equal across the line and the arc circular.
        const ax = along[i]
        const na = cross(tEnd[i - 1], ax)
        const nb = cross(tStart[i], ax)
        const sa = len(na)
        const sb = len(nb)
        if (sa > 1e-3 && sb > 1e-3) {
          const turn = Math.acos(Math.min(1, Math.max(-1, dot(na, nb) / (sa * sb))))
          const d = rho * Math.tan(turn / 2)
          w = Math.cos(turn / 2)
          rA += d / sa
          rB += d / sb
        }
      }
      if (i > 0) rA = Math.min(rA, segL[i - 1] * 0.4)
      if (i < n - 1) rB = Math.min(rB, segL[i] * 0.4)
      if (i === 0 && !this.mirrorTop) {
        rA = 0
        rB = 0
      }
      round.push(Math.max(i > 0 ? rA : 0, i < n - 1 ? rB : 0))
      // Setbacks are distances from the key point, so the fillet ends sit where the radius says whatever the
      // segment's parametric speed.
      tIn.push(i > 0 ? 1 - atDist(segA[i - 1], rA, true) : 1)
      tOut.push(i < n - 1 ? atDist(segA[i], rB, false) : 0)
      wt.push(w)
    }
    const sec = { p, segA, segL, round, tIn, tOut, wt }
    this.cache.set(u, sec)
    return sec
  }

  at(u: number, v: number): V3 {
    const sec = this.section(u)
    const n = this.keys.length
    const V = this.vAt
    let k = 0
    while (k < n - 2 && v > V[k + 1]) k++
    const w = Math.min(1, Math.max(0, (v - V[k]) / (V[k + 1] - V[k])))
    const f = this.band
    const rA = sec.round[k]
    const rB = sec.round[k + 1]
    // The band shrinks with a rounding under half a millimeter, so the parametrization stays continuous where a roll
    // fades out with its crease's turn.
    const fA = f * Math.min(1, rA / 0.0005)
    const fB = f * Math.min(1, rB / 0.0005)
    const ta = sec.tOut[k]
    const tb = sec.tIn[k + 1]
    if (w < fA) return this.fillet(sec, k, 0.5 + 0.5 * (w / fA))
    if (w > 1 - fB) {
      if (k + 1 === n - 1 && this.mirrorTop) return this.topFillet(sec, (w - (1 - fB)) / fB)
      return this.fillet(sec, k + 1, (0.5 * (w - (1 - fB))) / fB)
    }
    const t = ta + ((tb - ta) * (w - fA)) / (1 - fA - fB)
    return bez(sec.segA[k], t)
  }

  private fillet(sec: Section, i: number, s: number): V3 {
    const a = bez(sec.segA[i - 1], sec.tIn[i])
    const b = bez(sec.segA[i], sec.tOut[i])
    const ta = norm(bezD(sec.segA[i - 1], sec.tIn[i]))
    const tb = norm(bezD(sec.segA[i], sec.tOut[i]))
    const c = corner(a, ta, b, tb)
    // A rational quadratic weighted by the cosine of half the turn. Across the line, with legs of equal length, that
    // is the circular arc; the section only sees it obliquely, which is an affine view of the same conic, so the
    // weight is the turn measured across the line, not in the section's plane.
    const w = sec.wt[i] >= 0 ? sec.wt[i] : Math.sqrt(Math.max(0, (1 + dot(ta, tb)) / 2))
    return arc(a, c, b, w, s)
  }

  private topFillet(sec: Section, s: number): V3 {
    const n = sec.p.length
    const seg = sec.segA[n - 2]
    const tA = sec.tIn[n - 1]
    const a = bez(seg, tA)
    const ta = norm(bezD(seg, tA))
    let c: V3 = [0, a[1], a[2]]
    if (ta[0] < -1e-4) {
      const lam = -a[0] / ta[0]
      c = addScaled(a, ta, lam)
      c[0] = 0
    }
    const b: V3 = [-a[0], a[1], a[2]]
    return quad(a, c, b, s * 0.5)
  }
}

function corner(a: V3, ta: V3, b: V3, tb: V3): V3 {
  const w0 = sub(a, b)
  const A = dot(ta, ta)
  const B = dot(ta, tb)
  const C = dot(tb, tb)
  const D = dot(ta, w0)
  const E = dot(tb, w0)
  const den = A * C - B * B
  if (den < 1e-9) return scale(add(a, b), 0.5)
  const s = (B * E - C * D) / den
  const t = (A * E - B * D) / den
  const span = dist(a, b)
  if (s < 0 || s > span * 2 || t > 0 || t < -span * 2) return scale(add(a, b), 0.5)
  return scale(add(addScaled(a, ta, s), addScaled(b, tb, t)), 0.5)
}

/** Parameter at chord distance d from the start (or from the end) of a cubic segment. */
function atDist(seg: V3[], d: number, fromEnd: boolean): number {
  if (d <= 0) return 0
  const o = fromEnd ? seg[3] : seg[0]
  let lo = 0
  let hi = 0.5
  const at = (t: number) => bez(seg, fromEnd ? 1 - t : t)
  if (len(sub(at(hi), o)) < d) return hi
  for (let it = 0; it < 30; it++) {
    const m = (lo + hi) / 2
    if (len(sub(at(m), o)) < d) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}

function arc(a: V3, c: V3, b: V3, w: number, s: number): V3 {
  const q = 1 - s
  const A = q * q
  const B = 2 * q * s * w
  const C = s * s
  const d = A + B + C
  return [(A * a[0] + B * c[0] + C * b[0]) / d, (A * a[1] + B * c[1] + C * b[1]) / d, (A * a[2] + B * c[2] + C * b[2]) / d]
}

function quad(a: V3, c: V3, b: V3, s: number): V3 {
  const q = 1 - s
  return [q * q * a[0] + 2 * q * s * c[0] + s * s * b[0], q * q * a[1] + 2 * q * s * c[1] + s * s * b[1], q * q * a[2] + 2 * q * s * c[2] + s * s * b[2]]
}

export function bez(c: V3[], t: number): V3 {
  const q = 1 - t
  const a = q * q * q
  const b = 3 * q * q * t
  const d = 3 * q * t * t
  const e = t * t * t
  return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1], a * c[0][2] + b * c[1][2] + d * c[2][2] + e * c[3][2]]
}

function bezD(c: V3[], t: number): V3 {
  const q = 1 - t
  const a = 3 * q * q
  const b = 6 * q * t
  const e = 3 * t * t
  return [
    a * (c[1][0] - c[0][0]) + b * (c[2][0] - c[1][0]) + e * (c[3][0] - c[2][0]),
    a * (c[1][1] - c[0][1]) + b * (c[2][1] - c[1][1]) + e * (c[3][1] - c[2][1]),
    a * (c[1][2] - c[0][2]) + b * (c[2][2] - c[1][2]) + e * (c[3][2] - c[2][2]),
  ]
}
