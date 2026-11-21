import { Track3 } from './spline'
import type { V3 } from './vec'

export type Curve = (t: number) => V3

/** Bilinearly blended Coons patch from four boundary curves. bottom(0)=left(0), bottom(1)=right(0), top(0)=left(1), top(1)=right(1). */
export function coons(bottom: Curve, top: Curve, left: Curve, right: Curve): (a: number, b: number) => V3 {
  const p00 = bottom(0)
  const p10 = bottom(1)
  const p01 = top(0)
  const p11 = top(1)
  return (a, b) => {
    const B = bottom(a)
    const T = top(a)
    const L = left(b)
    const R = right(b)
    const out: V3 = [0, 0, 0]
    for (let i = 0; i < 3; i++) {
      out[i] = (1 - b) * B[i] + b * T[i] + (1 - a) * L[i] + a * R[i] - ((1 - a) * (1 - b) * p00[i] + a * (1 - b) * p10[i] + (1 - a) * b * p01[i] + a * b * p11[i])
    }
    return out
  }
}

/** Arc length parametrised spline through the points. */
export function polyline(pts: V3[]): Curve {
  let acc = 0
  const knots: Array<[number, number, number, number]> = [[0, ...pts[0]]]
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2])
    knots.push([acc, ...pts[i]])
  }
  const t = new Track3(knots.map((k) => [k[0] / acc, k[1], k[2], k[3]] as const))
  return (s) => t.at(s)
}
