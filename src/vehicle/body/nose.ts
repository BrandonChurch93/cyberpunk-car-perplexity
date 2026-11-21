import type { Loft } from '../geom/loft'
import { coons, polyline, type Curve } from '../geom/coons'
import { projectCurve, type SurfaceCurve, type SurfaceMap } from '../geom/cuts'
import type { V3 } from '../geom/vec'
import type { Cuts } from './cuts'
import { elev, map } from './lines'
import { dims } from './shape'

// The nose and cheeks: the face below the bonnet's leading edge, its outlines and its openings.
// Its top and outer edges are the main loft's first section, so it meets the bonnet and wings without a step.

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

/** Front elevation outlines, left half. */
export const lines = {
  eye: map(elev, [[193, 374], [270, 386], [345, 398], [353, 406], [346, 415], [270, 417], [205, 419], [188, 400]]),
  outerIntake: map(elev, [[212, 486], [320, 484], [430, 480], [560, 470], [500, 545], [450, 618], [330, 620], [228, 620], [204, 560]]),
  centerIntake: map(elev, [[575, 520], [745, 520], [745, 612], [600, 612], [570, 570]]),
  drlUpper: map(elev, [[146, 328], [168, 385], [192, 445]]),
  drlLower: map(elev, [[192, 445], [170, 520], [148, 598], [196, 636]]),
  drlStem: map(elev, [[192, 445], [300, 458], [425, 466]]),
}

/** Openings and bands in the nose. Curve IDs eye, outer, center, drlU, drlL and drlS are the front module's interface. */
export function noseCuts(fm: SurfaceMap): { cuts: Cuts; curves: Record<'eye' | 'outer' | 'center' | 'drlU' | 'drlL' | 'drlS', SurfaceCurve> } {
  const eye = projectCurve(fm, 'z', lines.eye, true, 0.005, undefined, false, 0.012)
  const outer = projectCurve(fm, 'z', lines.outerIntake, true, 0.006, undefined, false, 0.03)
  const center = projectCurve(fm, 'z', lines.centerIntake, true, 0.006, undefined, true, 0.03)
  const drlU = projectCurve(fm, 'z', lines.drlUpper, false, 0.004, undefined, false, 0.01)
  const drlL = projectCurve(fm, 'z', lines.drlLower, false, 0.004, undefined, false, 0.01)
  const drlS = projectCurve(fm, 'z', lines.drlStem, false, 0.004, undefined, false, 0.01)
  return {
    cuts: { holes: [{ c: eye, inset: 0 }, { c: outer, inset: 0 }, { c: center, inset: 0 }], gaps: [], glass: [eye], bands: [{ c: drlU, half: 0.011 }, { c: drlL, half: 0.011 }, { c: drlS, half: 0.011 }] },
    curves: { eye, outer, center, drlU, drlL, drlS },
  }
}
