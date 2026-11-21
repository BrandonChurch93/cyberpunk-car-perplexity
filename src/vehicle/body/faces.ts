import type { Loft } from '../geom/loft'
import { Track3 } from '../geom/spline'
import type { V3 } from '../geom/vec'
import { dims } from './shape'

type Curve = (t: number) => V3

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

function polyline(pts: V3[]): Curve {
  let acc = 0
  const knots: Array<[number, number, number, number]> = [[0, ...pts[0]]]
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2])
    knots.push([acc, ...pts[i]])
  }
  const t = new Track3(knots.map((k) => [k[0] / acc, k[1], k[2], k[3]] as const))
  return (s) => t.at(s)
}

/** The nose below the bonnet's leading edge, from the center line (a = 0) to the corner (a = 1), splitter (b = 0) to the edge (b = 1). */
export function frontFace(loft: Loft): (a: number, b: number) => V3 {
  const vK3 = loft.vAt[3]
  const corner0 = loft.at(0, 0)
  const tip = loft.at(0, 1)
  const top: Curve = (a) => loft.at(0, 1 - a * (1 - vK3))
  const right: Curve = (b) => loft.at(0, vK3 * b)
  const left = polyline([
    [0, 0.15, dims.halfLength - 0.004],
    [0, 0.2, dims.halfLength - 0.03],
    [0, 0.3, dims.halfLength - 0.08],
    [0, 0.39, dims.halfLength - 0.06],
    [0, tip[1], tip[2]],
  ])
  const bottom = polyline([
    [0, 0.15, dims.halfLength - 0.004],
    [0.43, 0.15, 2.37],
    [0.61, 0.15, 2.27],
    [0.75, 0.15, 2.18],
    [0.84, 0.15, 2.08],
    [0.9, 0.15, 1.95],
    corner0,
  ])
  return coons(bottom, top, left, right)
}

/** The tail below the deck edge, from the corner (a = 0) to the center line (a = 1). */
export function rearFace(loft: Loft): (a: number, b: number) => V3 {
  const vK3 = loft.vAt[3]
  const corner0 = loft.at(1, 0)
  const tip = loft.at(1, 1)
  const top: Curve = (a) => loft.at(1, vK3 + a * (1 - vK3))
  const left: Curve = (b) => loft.at(1, vK3 * b)
  const right = polyline([
    [0, 0.32, -dims.halfLength + 0.06],
    [0, 0.48, -dims.halfLength + 0.002],
    [0, 0.7, -dims.halfLength + 0.01],
    [0, tip[1], tip[2]],
  ])
  const bottom = polyline([corner0, [0.4, 0.32, -2.43], [0, 0.32, -dims.halfLength + 0.06]])
  return coons(bottom, top, left, right)
}
