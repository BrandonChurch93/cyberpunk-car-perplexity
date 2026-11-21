import { projectCurve, SurfaceMap, type Surface, type SurfaceCurve } from '../geom/cuts'
import type { V3 } from '../geom/vec'
import { planLines, sideLines } from './lines'
import { noseCuts } from './nose'
import { tailCuts } from './tail'
import { dims } from './shape'

const archFront = { z: dims.frontHubZ, y: dims.frontTire.radius, r: 0.405 }
const archRear = { z: dims.rearHubZ, y: dims.rearTire.radius, r: 0.43 }
export const gapHalf = 0.002

/** Positive inside a wheel opening, in meters. A faceted arch: a circle flattened into six soft facets. */
export function arches(p: V3): number {
  if (p[0] < 0.5) return -1
  return Math.max(arch(p, archFront), arch(p, archRear))
}

function arch(p: V3, a: { z: number; y: number; r: number }): number {
  const dz = p[2] - a.z
  const dy = p[1] - a.y
  const r = Math.hypot(dz, dy)
  const th = Math.atan2(dy, dz)
  const facet = Math.cos(3 * (th - Math.PI / 2))
  const R = a.r * (1 - 0.018 * facet)
  return R - r
}

export interface Cuts {
  /** Regions cut out of the paint shell, signed distance negative inside. */
  holes: Array<{ c: SurfaceCurve; inset: number }>
  /** Shut lines cut as narrow bands. */
  gaps: SurfaceCurve[]
  /** Regions filled with glass. */
  glass: SurfaceCurve[]
  /** Open curves cut as wide slots, half width in meters. */
  bands: Array<{ c: SurfaceCurve; half: number }>
}

export interface BodyCuts {
  main: Cuts
  front: Cuts
  rear: Cuts
  curves: Record<string, SurfaceCurve>
  maps: { main: SurfaceMap; front: SurfaceMap; rear: SurfaceMap }
}

export function makeCuts(main: Surface, front: Surface, rear: Surface): BodyCuts {
  const mm = new SurfaceMap(main, 0, 1, 0, 1, 500, 200)
  const fm = new SurfaceMap(front, 0, 1, 0, 1, 160, 160)
  const rm = new SurfaceMap(rear, 0, 1, 0, 1, 160, 160)
  const nose = noseCuts(fm)
  const tail = tailCuts(rm)
  const sideWin: [number, number, number, number] = [0, 1, 0, 0.62]
  const topWin: [number, number, number, number] = [0, 1, 0.45, 1]
  const dlo = projectCurve(mm, 'x', sideLines.glass, true, 0.008, [0, 1, 0.45, 0.75], false, 0.02)
  const intake = projectCurve(mm, 'x', sideLines.intake, true, 0.008, sideWin, false, 0.04)
  const upper = projectCurve(mm, 'x', sideLines.upperIntake, true, 0.006, [0, 1, 0.4, 0.75], false, 0.015)
  const door = projectCurve(mm, 'x', sideLines.door, false, 0.006, sideWin, false, 0.05)
  const screen = projectCurve(mm, 'y', planLines.windscreen, true, 0.008, topWin, true, 0.03)
  const rearGlass = projectCurve(mm, 'y', planLines.rearGlass, true, 0.008, topWin, true, 0.03)
  const bay = projectCurve(mm, 'y', planLines.bay, true, 0.008, topWin, true, 0.06)
  const bonnet = projectCurve(mm, 'y', planLines.bonnet, false, 0.006, topWin, false, 0.08)
  const wing = projectCurve(mm, 'y', planLines.wing, false, 0.006, topWin, false, 0.08)
  return {
    main: {
      holes: [
        { c: dlo, inset: 0 },
        { c: screen, inset: 0 },
        { c: rearGlass, inset: 0 },
        { c: bay, inset: 0 },
        { c: intake, inset: 0 },
        { c: upper, inset: 0 },
      ],
      gaps: [door, bonnet, wing],
      glass: [dlo, screen, rearGlass],
      bands: [],
    },
    front: nose.cuts,
    rear: tail.cuts,
    maps: { main: mm, front: fm, rear: rm },
    curves: { dlo, intake, upper, door, screen, rearGlass, bay, bonnet, wing, ...nose.curves, ...tail.curves },
  }
}

/** Kept region of the paint shell: negative where paint remains. */
export function paintTrim(c: Cuts, extra?: (p: V3) => number): (u: number, v: number, p: V3) => number {
  return (u, v, p) => {
    let d = extra ? extra(p) : -1
    for (const h of c.holes) d = Math.max(d, -h.c.signed(u, v, p, 0.3) - h.inset)
    for (const g of c.gaps) d = Math.max(d, gapHalf - g.distance(p, 0.3))
    for (const b of c.bands) d = Math.max(d, b.half - b.c.distance(p, 0.3))
    return d
  }
}

/** Kept region of glass: inside any glass curve, pulled in by `inset`. */
export function glassTrim(c: Cuts, inset: number): (u: number, v: number, p: V3) => number {
  return (u, v, p) => {
    let d = 1
    for (const g of c.glass) d = Math.min(d, g.signed(u, v, p, 0.3) + inset)
    return d
  }
}
