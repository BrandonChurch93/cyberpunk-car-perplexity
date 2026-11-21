import type { Loft } from '../geom/loft'
import { projectCurve, SurfaceCurve, type Surface, type SurfaceMap } from '../geom/cuts'
import type { V2, V3 } from '../geom/vec'
import type { Cuts } from './cuts'

// The tail cap: one fair field z(x, y), a plain crown in x and a small lean in y, with the loft's last section on it
// as its top and outer edges. Any deviation of the section from the field is blended out within a short band.

const hermite = (t: number): number => t * t * (3 - 2 * t)
const fade = (t: number): number => {
  const s = Math.min(1, Math.max(0, t))
  return s * s * s * (s * (6 * s - 15) + 10)
}

/** Width of the band, in face parameters, over which the section's deviation from the field dies out. */
const band = { side: 0.35, top: 0.3 }

/** The cap field: the centre of the deck edge, the crown that brings the corners forward, the lean below the deck. */
export const cap = { z: -2.4744, y: 0.8855, crown: 0.1594, lean: 0.02 }

/** z of the tail cap at (|x|, y): one plain crown, no inflection. The loft's last section lies on it. */
export const capZ = (x: number, y: number): number => cap.z + cap.crown * x * x + cap.lean * (cap.y - y)

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

  const Z = capZ
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

/** Height of the bumper's lower edge: the top of the open lower tail and of the corner cut behind the rear wheel. */
export const bumper = 0.59

/** Front of the corner cut, ahead of the rear arch's trailing edge so the two openings are one. */
export const cornerFront = -1.85

/**
 * Rear elevation outlines in metres (|x|, y), left half, after the patent rear view: one dark housing round both
 * outlets under the deck nose, a lamp lens run off the corner edge into the hole round it, a dark slot under it, and the lower tail open from the
 * bumper edge down and out through the corner.
 */
export const lines: Record<'exhaust' | 'surround' | 'lens' | 'slot' | 'lower', V2[]> = {
  exhaust: [[0.045, 0.787], [0.079, 0.843], [0.286, 0.843], [0.32, 0.787], [0.286, 0.731], [0.079, 0.731]],
  surround: [[-0.03, 0.852], [0, 0.852], [0.06, 0.872], [0.33, 0.872], [0.372, 0.83], [0.372, 0.75], [0.33, 0.706], [-0.03, 0.706]],
  lens: [[0.565, 0.868], [0.5, 0.812], [0.388, 0.8], [0.388, 0.774], [0.5, 0.762], [0.565, 0.748]],
  slot: [[0.395, 0.704], [0.59, 0.704], [0.59, 0.731], [0.395, 0.734]],
  lower: [[-0.03, bumper], [0.72, bumper], [0.72, 0], [-0.03, 0]],
}

/** Tail lamp light guides in metres (|x|, y): a stem from the outlets that splits into a sideways Y closed at the corner. */
export const lampPaths: Record<'stem' | 'upper' | 'lower' | 'end', V2[]> = {
  stem: [[0.398, 0.787], [0.5, 0.787]],
  upper: [[0.5, 0.787], [0.584, 0.853]],
  lower: [[0.5, 0.787], [0.584, 0.763]],
  end: [[0.584, 0.853], [0.584, 0.763]],
}

/** A hole that runs across the centre line: points on the face's centre edge count as inside. */
class CentreHole extends SurfaceCurve {
  override inside(u: number, v: number): boolean {
    return super.inside(Math.min(u, 1 - 1e-6), v)
  }
}

function seg(q: V3, a: V3, b: V3): number {
  const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2]
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1] + (q[2] - a[2]) * ab[2]) / l2)) : 0
  return Math.hypot(q[0] - a[0] - ab[0] * t, q[1] - a[1] - ab[1] * t, q[2] - a[2] - ab[2] * t)
}

/** A hole that runs off the face: its stretches along the face's own edges are not trim lines. */
class EdgeHole extends CentreHole {
  private readonly segs: Array<[V3, V3]> = []
  constructor(S: Surface, uv: V2[]) {
    super(S, uv, true, true)
    const rim = (q: V2): boolean => q[0] < 1e-4 || q[0] > 1 - 1e-4 || q[1] < 1e-4 || q[1] > 1 - 1e-4
    for (let i = 0; i < uv.length; i++) {
      const j = (i + 1) % uv.length
      if (!(rim(uv[i]) && rim(uv[j]))) this.segs.push([this.p[i], this.p[j]])
    }
  }

  override inside(u: number, v: number): boolean {
    return super.inside(Math.max(u, 1e-6), Math.min(1 - 1e-6, Math.max(v, 1e-6)))
  }

  override distance(q: V3, cap = 1): number {
    let best = cap
    for (const [a, b] of this.segs) best = Math.min(best, seg(q, a, b))
    return best
  }
}

/** Heights at which the lamp lens leaves the tail over its corner edge into the corner hole on the main skin. */
export const lensEdge = { top: 0.868, bottom: 0.748 }

/** Face parameter b of the corner edge (a = 0) at height y. */
function edgeB(rm: SurfaceMap, y: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2
    if (rm.S(0, m)[1] < y) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}

/**
 * A hole outline that runs off the face over its corner edge: the open line from the edge at `edge.top` round to the
 * edge at `edge.bottom`, each end continued level to the edge, closed along the edge itself.
 */
function offEdge(rm: SurfaceMap, line: V2[], edge: { top: number; bottom: number }, round: number): V2[] {
  const b0 = edgeB(rm, edge.top)
  const b1 = edgeB(rm, edge.bottom)
  const pts: V2[] = [[rm.S(0, b0)[0] - 0.002, edge.top], ...line, [rm.S(0, b1)[0] - 0.002, edge.bottom]]
  const open = projectCurve(rm, '-z', pts, false, 0.004, undefined, false, round).uv
  open[0] = [0, b0]
  open[open.length - 1] = [0, b1]
  const n = Math.max(2, Math.ceil((edge.top - edge.bottom) / 0.004))
  for (let i = 1; i < n; i++) open.push([0, b1 + ((b0 - b1) * i) / n])
  return open
}

type TailCurve = 'lampU' | 'lampL' | 'chev' | 'stem' | 'surround' | 'lens' | 'slot' | 'lower'

/** Openings in the tail. Every one is a hole, so the backing opens with the skin and the paint flange is its wall. */
export function tailCuts(rm: SurfaceMap): { cuts: Cuts; curves: Record<TailCurve, SurfaceCurve> } {
  const path = (p: V2[]): SurfaceCurve => projectCurve(rm, '-z', p, false, 0.004, undefined, false, 0.004)
  const hole = (p: V2[], round: number): SurfaceCurve => projectCurve(rm, '-z', p, true, 0.004, undefined, false, round)
  const surroundRaw = projectCurve(rm, '-z', lines.surround, true, 0.004, undefined, true, 0.012)
  const surround = new CentreHole(rm.S, surroundRaw.uv, true, true)
  const lens = new EdgeHole(rm.S, offEdge(rm, lines.lens, lensEdge, 0.008))
  const slot = hole(lines.slot, 0.008)
  const lowerRaw = projectCurve(rm, '-z', lines.lower, true, 0.006, undefined, true, 0.03)
  const lower = new EdgeHole(rm.S, lowerRaw.uv)
  return {
    cuts: { holes: [surround, lens, slot, lower].map((c) => ({ c, inset: 0 })), gaps: [], glass: [], bands: [] },
    curves: { lampU: path(lampPaths.upper), lampL: path(lampPaths.lower), chev: path(lampPaths.end), stem: path(lampPaths.stem), surround, lens, slot, lower },
  }
}

/**
 * The lower body corner behind each rear wheel, cut away below the bumper edge so the tyre shows from behind: positive
 * inside, in metres. For the main loft's trim, joined to the rear arch with a smooth max.
 */
export function cornerCut(p: V3): number {
  const r = 0.03
  const a = bumper - p[1]
  const b = cornerFront - p[2]
  const c = Math.abs(p[0]) - 0.5
  const ab = a > -r && b > -r && a < r && b < r ? r - Math.hypot(Math.max(0, r - a), Math.max(0, r - b)) : Math.min(a, b)
  return Math.min(ab, c)
}

/** World point on the tail at elevation (|x|, y), for parts that sit on it. */
export function onTail(rm: SurfaceMap, x: number, y: number): V3 {
  const [u, v] = rm.invert('-z', x, y)
  return rm.S(u, v)
}
