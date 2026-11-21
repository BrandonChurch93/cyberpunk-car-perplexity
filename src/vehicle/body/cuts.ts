import { projectCurve, smax, SurfaceCurve, SurfaceMap, type Surface } from '../geom/cuts'
import type { V2, V3 } from '../geom/vec'
import { gapCut } from './gaps'
import { planLines, sideLines } from './lines'
import { noseCuts } from './nose'
import { cornerCut, tailCuts } from './tail'
import { dims } from './shape'
import { dloSide, screenPlan } from '../parts/glass-lines'

const archFront = { z: dims.frontHubZ, y: dims.frontTire.radius, r: 0.405 }
const archRear = { z: dims.rearHubZ, y: dims.rearTire.radius, r: 0.43 }
export { gapHalf, gapRoll } from './gaps'

/** Positive inside a wheel opening, in meters. A faceted arch: a circle flattened into six soft facets. */
export function arches(p: V3): number {
  if (p[0] < 0.5) return -1
  return Math.max(arch(p, archFront), arch(p, archRear))
}

/** The wheel openings plus the lower corner cut away behind each rear wheel, joined smoothly: positive inside. */
export function wheelOpenings(p: V3): number {
  return smax(arches(p), cornerCut(p), 0.04)
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

/** Where each tail lamp wraps the body corner onto the main skin, metres. At the tail edge (u = 1) it spans the
 * lens's own outer end; it runs forward round the corner to |x| = `outX` and closes there in a round end. */
export const lampWrap = { top: 0.868, bottom: 0.748, endTop: 0.842, endBottom: 0.778, outX: 0.85 }

/** A hole that runs off the main skin's tail edge: its stretch along u = 1 is the skin's own edge, not a trim line. */
class TailEdgeHole extends SurfaceCurve {
  private readonly segs: Array<[V3, V3]> = []
  constructor(S: Surface, uv: V2[]) {
    super(S, uv, true)
    for (let i = 0; i < uv.length; i++) {
      const j = (i + 1) % uv.length
      if (!(uv[i][0] > 1 - 1e-6 && uv[j][0] > 1 - 1e-6)) this.segs.push([this.p[i], this.p[j]])
    }
  }

  override inside(u: number, v: number): boolean {
    return super.inside(Math.min(u, 1 - 1e-6), v)
  }

  override distance(q: V3, cap = 1): number {
    let best = cap
    for (const [a, b] of this.segs) {
      const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2]
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1] + (q[2] - a[2]) * ab[2]) / l2)) : 0
      best = Math.min(best, Math.hypot(q[0] - a[0] - ab[0] * t, q[1] - a[1] - ab[1] * t, q[2] - a[2] - ab[2] * t))
    }
    return best
  }
}

/** The lamp wrap on the main skin: its top and bottom edges run at constant height steps from the tail edge to the
 * end, sampled in u, each height turned into v at that u. */
function lampWrapHole(S: Surface): SurfaceCurve {
  const vAtY = (u: number, y: number): number => {
    let lo = 0.22
    let hi = 0.4
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2
      if (S(u, m)[1] < y) lo = m
      else hi = m
    }
    return (lo + hi) / 2
  }
  const mid = (lampWrap.endTop + lampWrap.endBottom) / 2
  let lo = 0.9
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2
    if (S(m, vAtY(m, mid))[0] > lampWrap.outX) lo = m
    else hi = m
  }
  const uEnd = (lo + hi) / 2
  const n = 24
  const ease = (t: number): number => t * t * (3 - 2 * t)
  const top: V2[] = []
  const bottom: V2[] = []
  // The end round spans the end height in u as a half circle in (arc length, y); a short run of u stands in for it.
  const zAt = (u: number): number => S(u, vAtY(u, mid))[2]
  const r = (lampWrap.endTop - lampWrap.endBottom) / 2
  let uR = uEnd
  for (let i = 0; i < 40 && zAt(uR) - zAt(uEnd) < r; i++) uR -= 0.0005
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - (1 - uR) * t
    const e = ease(t)
    top.push([u, vAtY(u, lampWrap.top + (lampWrap.endTop - lampWrap.top) * e)])
    bottom.push([u, vAtY(u, lampWrap.bottom + (lampWrap.endBottom - lampWrap.bottom) * e)])
  }
  const end: V2[] = []
  for (let i = 1; i < 12; i++) {
    const a = Math.PI / 2 - (i / 12) * Math.PI
    const y = mid + r * Math.sin(a)
    // March forward from uR by the half circle's depth at this height.
    const depth = r * Math.cos(a)
    let u = uR
    for (let k = 0; k < 200 && zAt(u) - zAt(uR) < depth; k++) u -= 0.0001
    end.push([u, vAtY(u, y)])
  }
  return new TailEdgeHole(S, [...top, ...end, ...bottom.reverse()])
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

/**
 * An open shut line drawn on past the edge of the skin, ended where it first leaves it. A projected point beyond the
 * front edge clamps onto that edge, and one past the side of the skin in plan falls through to the flank below, so
 * without this the line would run on along the edge, or jump down the flank, and its lips would stand up as spikes.
 */
function onSkin(S: Surface, c: SurfaceCurve, maxJump = 0.05): SurfaceCurve {
  const uv = c.uv
  const p = c.p
  for (let k = 1; k < uv.length; k++) {
    if (uv[k][0] < 5e-4) {
      const a = uv[k - 1]
      const b = uv[k]
      const t = a[0] / Math.max(1e-9, a[0] - b[0])
      return new SurfaceCurve(S, [...uv.slice(0, k), [0, a[1] + (b[1] - a[1]) * t]], false)
    }
    if (Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1], p[k][2] - p[k - 1][2]) > maxJump) return new SurfaceCurve(S, uv.slice(0, k), false)
  }
  return c
}

/** The body's cuts. The front surface is made from the main cuts, because the fascia is fitted to the main skin's
 * tessellated front edge, and the main skin's trims never reach that edge. */
export function makeCuts(main: Surface, frontOf: (mainCuts: Cuts) => Surface, rear: Surface): BodyCuts {
  const mm = new SurfaceMap(main, 0, 1, 0, 1, 500, 200)
  const rm = new SurfaceMap(rear, 0, 1, 0, 1, 160, 160)
  const tail = tailCuts(rm)
  const sideWin: [number, number, number, number] = [0, 1, 0, 0.52]
  const topWin: [number, number, number, number] = [0, 1, 0.36, 1]
  const dlo = projectCurve(mm, 'x', dloSide(main), true, 0.008, [0, 1, 0.36, 0.64], false, 0.02)
  const intake = projectCurve(mm, 'x', sideLines.intake, true, 0.008, sideWin, false, 0.04)
  const upper = projectCurve(mm, 'x', sideLines.upperIntake, true, 0.006, [0, 1, 0.32, 0.645], false, 0.015)
  const door = projectCurve(mm, 'x', sideLines.door, false, 0.006, sideWin, false, 0.05)
  const screen = projectCurve(mm, 'y', screenPlan(main), true, 0.008, topWin, true, 0.03)
  const rearGlass = projectCurve(mm, 'y', planLines.rearGlass, true, 0.008, topWin, true, 0.03)
  const bay = projectCurve(mm, 'y', planLines.bay, true, 0.008, topWin, true, 0.06)
  const bonnet = onSkin(main, projectCurve(mm, 'y', planLines.bonnet, false, 0.006, topWin, false, 0.08))
  const wing = onSkin(main, projectCurve(mm, 'y', planLines.wing, false, 0.006, topWin, false, 0.08))
  const lampWrapCut = lampWrapHole(main)
  const mainCuts: Cuts = {
    holes: [
      { c: dlo, inset: 0 },
      { c: screen, inset: 0 },
      { c: rearGlass, inset: 0 },
      { c: bay, inset: 0 },
      { c: intake, inset: 0 },
      { c: upper, inset: 0 },
      { c: lampWrapCut, inset: 0 },
    ],
    gaps: [door, bonnet, wing],
    glass: [dlo, screen, rearGlass],
    bands: [],
  }
  const fm = new SurfaceMap(frontOf(mainCuts), 0, 1, 0, 1, 160, 160)
  const nose = noseCuts(fm)
  return {
    main: mainCuts,
    front: nose.cuts,
    rear: tail.cuts,
    maps: { main: mm, front: fm, rear: rm },
    curves: { dlo, intake, upper, door, screen, rearGlass, bay, bonnet, wing, lampWrap: lampWrapCut, ...nose.curves, ...tail.curves },
  }
}

/** Kept region of the paint shell: negative where paint remains. */
export function paintTrim(c: Cuts, extra?: (p: V3) => number): (u: number, v: number, p: V3) => number {
  const gaps = gapCut(c.gaps)
  return (u, v, p) => {
    let d = extra ? extra(p) : -1
    for (const h of c.holes) d = Math.max(d, -h.c.signed(u, v, p, 0.3) - h.inset)
    d = Math.max(d, gaps(p))
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
