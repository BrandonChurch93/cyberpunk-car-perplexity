import type { Loft } from '../geom/loft'
import { coons, polyline, type Curve } from '../geom/coons'
import { projectCurve, type SurfaceCurve, type SurfaceMap } from '../geom/cuts'
import type { V3 } from '../geom/vec'
import type { Cuts } from './cuts'
import { elev, map } from './lines'
import { dims } from './shape'

// The tail cap: the face below the deck edge, its outlines and its openings.
// Its top and outer edges are the main loft's last section, so it meets the deck and haunch without a step.

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

/** Rear elevation outlines, left half. */
export const lines = {
  lampUpper: map(elev, [[172, 196], [250, 186], [350, 190], [470, 200]]),
  lampLower: map(elev, [[180, 272], [260, 262], [350, 255], [470, 245]]),
  lampChevron: map(elev, [[172, 200], [250, 228], [180, 270]]),
  exhaust: map(elev, [[512, 230], [532, 196], [652, 196], [680, 230], [652, 266], [532, 266]]),
  surround: map(elev, [[470, 230], [505, 165], [680, 165], [712, 230], [680, 300], [505, 300]]),
  lower: map(elev, [[96, 395], [300, 392], [745, 392], [745, 760], [60, 760]]),
  mesh: map(elev, [[100, 300], [470, 300], [560, 370], [745, 370], [745, 400], [160, 405]]),
}

/** Openings and bands in the tail. */
export function tailCuts(rm: SurfaceMap): { cuts: Cuts; curves: Record<'lampU' | 'lampL' | 'chev' | 'surround' | 'mesh' | 'lower', SurfaceCurve> } {
  const lampU = projectCurve(rm, '-z', lines.lampUpper, false, 0.004, undefined, false, 0.02)
  const lampL = projectCurve(rm, '-z', lines.lampLower, false, 0.004, undefined, false, 0.02)
  const chev = projectCurve(rm, '-z', lines.lampChevron, false, 0.004, undefined, false, 0.01)
  const surround = projectCurve(rm, '-z', lines.surround, true, 0.005, undefined, false, 0.03)
  const mesh = projectCurve(rm, '-z', lines.mesh, true, 0.006, undefined, true, 0.03)
  const lower = projectCurve(rm, '-z', lines.lower, true, 0.006, undefined, true, 0.02)
  return {
    cuts: { holes: [{ c: surround, inset: 0 }, { c: mesh, inset: 0 }, { c: lower, inset: 0 }], gaps: [], glass: [], bands: [{ c: lampU, half: 0.011 }, { c: lampL, half: 0.011 }, { c: chev, half: 0.009 }] },
    curves: { lampU, lampL, chev, surround, mesh, lower },
  }
}
