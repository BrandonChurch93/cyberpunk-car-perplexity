import type { Loft } from '../geom/loft'
import { projectCurve, SurfaceCurve, type SurfaceMap } from '../geom/cuts'
import type { V2, V3 } from '../geom/vec'
import type { Cuts } from './cuts'
import { elev, map } from './lines'

// The tail cap: one fair height field z(x, y), even in x so the centre line is smooth, with the loft's last section
// as its top and outer edges. The section's own deviation from the field is blended out within a short band.

const hermite = (t: number): number => t * t * (3 - 2 * t)
const fade = (t: number): number => {
  const s = Math.min(1, Math.max(0, t))
  return s * s * s * (s * (6 * s - 15) + 10)
}

/** Width of the band, in face parameters, over which the section's deviation from the field dies out. */
const band = { side: 0.35, top: 0.3 }

function solve(A: number[][], r: number[]): number[] {
  const n = r.length
  const M = A.map((row, i) => [...row, r[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let i = 0; i < n; i++) {
      if (i === c) continue
      const f = M[i][c] / M[c][c]
      for (let k = c; k <= n; k++) M[i][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

const terms = (x: number, y: number): number[] => [1, y, y * y, x * x, x * x * x * x]

/** The tail below the deck edge, from the corner (a = 0) to the center line (a = 1), bottom (b = 0) to top. */
export function rearFace(loft: Loft): (a: number, b: number) => V3 {
  const vK3 = loft.vAt[3]
  const L = (b: number): V3 => loft.at(1, vK3 * b)
  const T = (a: number): V3 => loft.at(1, vK3 + a * (1 - vK3))
  const p00 = L(0)
  const p01 = L(1)
  const p11 = T(1)
  const yB = p00[1]
  const B2 = (a: number): V2 => [p00[0] * (1 - a), yB]
  const R2 = (b: number): V2 => [0, yB + (p11[1] - yB) * b]

  const k = terms(0, 0).length
  const A = Array.from({ length: k }, () => new Array<number>(k).fill(0))
  const r = new Array<number>(k).fill(0)
  const fit = (p: V3, w: number): void => {
    const t = terms(p[0], p[1])
    for (let i = 0; i < k; i++) {
      r[i] += w * t[i] * p[2]
      for (let j = 0; j < k; j++) A[i][j] += w * t[i] * t[j]
    }
  }
  for (let i = 0; i <= 60; i++) {
    fit(L(i / 60), 1)
    fit(T(i / 60), 1)
  }
  const c = solve(A, r)
  const Z = (x: number, y: number): number => terms(x, y).reduce((s, t, i) => s + t * c[i], 0)
  const rL = (b: number): number => {
    const p = L(b)
    return p[2] - Z(p[0], p[1])
  }
  const rT = (a: number): number => {
    const p = T(a)
    return p[2] - Z(p[0], p[1])
  }
  const r00 = rL(0)
  const r01 = rL(1)
  const r11 = rT(1)
  const rB = (a: number): number => r00 * (1 - hermite(a))
  const rR = (b: number): number => r11 * hermite(b)

  return (a, b) => {
    const ha = hermite(a)
    const hb = hermite(b)
    const l = L(b)
    const t = T(a)
    const bo = B2(a)
    const ri = R2(b)
    const x = (1 - ha) * l[0] + ha * ri[0] + (1 - hb) * bo[0] + hb * t[0] - ((1 - ha) * (1 - hb) * p00[0] + ha * (1 - hb) * 0 + (1 - ha) * hb * p01[0] + ha * hb * p11[0])
    const y = (1 - ha) * l[1] + ha * ri[1] + (1 - hb) * bo[1] + hb * t[1] - ((1 - ha) * (1 - hb) * p00[1] + ha * (1 - hb) * yB + (1 - ha) * hb * p01[1] + ha * hb * p11[1])
    const f0 = 1 - fade(a / band.side)
    const g1 = 1 - fade((1 - b) / band.top)
    const f1 = 1 - f0
    const g0 = 1 - g1
    const res = f0 * rL(b) + f1 * rR(b) + g0 * rB(a) + g1 * rT(a) - (f0 * g0 * r00 + f0 * g1 * r01 + f1 * g1 * r11)
    return [x, y, Z(x, y) + res]
  }
}

/** Rear elevation outlines, left half. */
export const lines = {
  exhaust: map(elev, [[495, 246], [516, 211], [655, 211], [677, 246], [655, 282], [516, 282]]),
  surround: map(elev, [[470, 246], [505, 181], [680, 181], [712, 246], [680, 312], [505, 312]]),
  lower: map(elev, [[745, 369], [420, 369], [365, 395], [362, 800], [745, 800]]),
}

/** Tail lamp light guides in metres (|x|, y): a stem from the outlets that splits into a sideways Y closed at the corner. */
export const lampPaths: Record<'stem' | 'upper' | 'lower' | 'end', V2[]> = {
  stem: [[0.415, 0.822], [0.51, 0.822]],
  upper: [[0.51, 0.822], [0.585, 0.872]],
  lower: [[0.51, 0.822], [0.585, 0.776]],
  end: [[0.585, 0.872], [0.585, 0.776]],
}

/** Half width of the lamp recess. */
export const lampSlot = 0.012

/** A closed outline round a straight stroke with round ends. */
function capsule(p: V2, q: V2, h: number): V2[] {
  const d = Math.hypot(q[0] - p[0], q[1] - p[1])
  const ux = (q[0] - p[0]) / d
  const uy = (q[1] - p[1]) / d
  const out: V2[] = []
  const n = 10
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / n
    out.push([q[0] + h * (ux * Math.cos(a) - uy * Math.sin(a)), q[1] + h * (uy * Math.cos(a) + ux * Math.sin(a))])
  }
  for (let i = 0; i <= n; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / n
    out.push([p[0] + h * (ux * Math.cos(a) - uy * Math.sin(a)), p[1] + h * (uy * Math.cos(a) + ux * Math.sin(a))])
  }
  return out
}

/** A hole that runs across the centre line: points on the face's centre edge count as inside. */
class CentreHole extends SurfaceCurve {
  override inside(u: number, v: number): boolean {
    return super.inside(Math.min(u, 1 - 1e-6), v)
  }
}

type TailCurve = 'lampU' | 'lampL' | 'chev' | 'stem' | 'surround' | 'lower'

/** Openings in the tail. Every one is a hole, so the backing opens with the skin and the paint flange is its wall. */
export function tailCuts(rm: SurfaceMap): { cuts: Cuts; curves: Record<TailCurve, SurfaceCurve> } {
  const path = (p: V2[]): SurfaceCurve => projectCurve(rm, '-z', p, false, 0.004, undefined, false, 0.004)
  const slot = (p: V2[]): SurfaceCurve => projectCurve(rm, '-z', capsule(p[0], p[1], lampSlot), true, 0.003, undefined, false, 0.002)
  const surround = projectCurve(rm, '-z', lines.surround, true, 0.005, undefined, false, 0.03)
  const lowerRaw = projectCurve(rm, '-z', lines.lower, true, 0.006, undefined, true, 0.04)
  const lower = new CentreHole(rm.S, lowerRaw.uv, true, true)
  const slots = Object.values(lampPaths).map(slot)
  return {
    cuts: { holes: [surround, lower, ...slots].map((c) => ({ c, inset: 0 })), gaps: [], glass: [], bands: [] },
    curves: { lampU: path(lampPaths.upper), lampL: path(lampPaths.lower), chev: path(lampPaths.end), stem: path(lampPaths.stem), surround, lower },
  }
}

/** World point on the tail at elevation (|x|, y), for parts that sit on it. */
export function onTail(rm: SurfaceMap, x: number, y: number): V3 {
  const [u, v] = rm.invert('-z', x, y)
  return rm.S(u, v)
}
