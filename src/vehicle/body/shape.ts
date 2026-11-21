import { Loft, type LoftDef } from '../geom/loft'
import { Track3 } from '../geom/spline'
import { add, dot, len, norm, scale, smoothstep, sub, type V3 } from '../geom/vec'
import { featureLines, frontSection, type PathNode } from './lines'
import { fasciaDown } from './nose'
import { capZ } from './tail'

export const dims = {
  length: 4.947,
  width: 2.033,
  height: 1.16,
  wheelbase: 2.779,
  frontHubZ: 1.286,
  rearHubZ: -1.493,
  frontHubX: 0.86,
  rearHubX: 0.8505,
  frontTire: { radius: 0.3468, width: 0.265, rim: 0.254 },
  rearTire: { radius: 0.3702, width: 0.345, rim: 0.2667 },
  halfLength: 4.947 / 2,
  halfWidth: 2.033 / 2,
} as const

const zFront = dims.halfLength
const zRear = -dims.halfLength
const blend = 0.3

/** z of a key line at u, given where that key line starts and ends. */
function zAt(u: number, zf: number, zr: number): number {
  const base = zFront + (zRear - zFront) * u
  const wf = 1 - smoothstep(0, blend, u)
  const wr = smoothstep(1 - blend, 1, u)
  return base + (zf - zFront) * wf + (zr - zRear) * wr
}

function uAt(z: number, zf: number, zr: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2
    if (zAt(m, zf, zr) > z) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}

type Zxy = readonly [number, number, number]

/** Converts (z, x, y) samples, first and last at the key line's ends, to (u, x, y, z). */
function line(pts: Zxy[]): Array<[number, number, number, number]> {
  const zf = pts[0][0]
  const zr = pts[pts.length - 1][0]
  return pts.map(([z, x, y]) => [uAt(z, zf, zr), x, y, z])
}

type Key = ReadonlyArray<readonly [number, number, number, number]>

/** A key line whose end is moved onto the tail cap, every u kept: the move fades out over its last half metre. */
const onCap = (k: Key): Key => {
  const [, x, y, end] = k[k.length - 1]
  const dz = capZ(x, y) - end
  return k.map((p) => [p[0], p[1], p[2], p[3] + dz * smoothstep(end + 0.5, end, p[3])] as const)
}

/** The key lines as drawn before pass 2, their ends on the tail cap. Behind the front they still carry the body
 * unchanged. */
export const keyLines = {
  rocker: onCap(line([
    [1.8, 0.93, 0.15],
    [1.5, 0.945, 0.14],
    [1.0, 0.955, 0.135],
    [0, 0.955, 0.132],
    [-1.0, 0.965, 0.132],
    [-1.6, 0.965, 0.14],
    [-2.0, 0.9, 0.2],
    [-2.25, 0.76, 0.27],
    [-2.4, 0.6, 0.32],
  ])),
  sill: onCap(line([
    [1.8, 0.955, 0.3],
    [1.5, 0.975, 0.3],
    [1.0, 0.985, 0.305],
    [0, 0.99, 0.315],
    [-1.0, 1.0, 0.335],
    [-1.6, 1.0, 0.35],
    [-2.0, 0.94, 0.38],
    [-2.25, 0.8, 0.41],
    [-2.42, 0.62, 0.43],
  ])),
  crease: onCap(line([
    [1.8, 0.965, 0.5],
    [1.5, 0.99, 0.53],
    [0.96, 0.997, 0.575],
    [0.5, 1.0, 0.61],
    [0.24, 1.0, 0.646],
    [-0.2, 1.005, 0.68],
    [-0.6, 1.01, 0.7],
    [-1.0, 1.015, 0.72],
    [-1.49, 1.024, 0.73],
    [-1.8, 1.02, 0.73],
    [-2.1, 0.93, 0.72],
    [-2.3, 0.8, 0.7],
    [-2.44, 0.62, 0.68],
  ])),
  // The wing ridge over the front arch, then one straight shoulder from the door to the rear hub, then the deck edge
  // falling straight to the tail. Crisp end to end.
  shoulder: onCap(line([
    [2.14, 0.8, 0.598],
    [2.03, 0.88, 0.645],
    [1.9, 0.93, 0.69],
    [1.8, 0.95, 0.722],
    [1.6, 0.975, 0.78],
    [1.4, 0.982, 0.805],
    [1.2, 0.972, 0.808],
    [1.0, 0.955, 0.8],
    [0.67, 0.925, 0.755],
    [0.4, 0.912, 0.78],
    [0.0, 0.9, 0.818],
    [-0.34, 0.895, 0.849],
    [-0.7, 0.9, 0.883],
    [-1.1, 0.905, 0.92],
    [-1.5, 0.895, 0.958],
    [-1.9, 0.83, 0.93],
    [-2.2, 0.73, 0.91],
    [-2.42, 0.6, 0.895],
  ])),
  // The bonnet's outer crease, straight from the bonnet corner to the A-pillar base, then the pillar, the roof rail and
  // the deck edge falling straight to the tail.
  // It starts on the bonnet's front edge, invisible, and comes in crisp at the bonnet corner.
  rail: onCap(line([
    [2.33, 0.52, 0.488],
    [2.24, 0.512, 0.52],
    [2.15, 0.51, 0.55],
    [1.9, 0.586, 0.62],
    [1.6, 0.678, 0.701],
    [1.4, 0.739, 0.756],
    [1.2, 0.8, 0.81],
    [0.95, 0.76, 0.905],
    [0.7, 0.69, 1.01],
    [0.45, 0.62, 1.11],
    [0.2, 0.605, 1.125],
    [0.0, 0.59, 1.13],
    [-0.25, 0.57, 1.13],
    [-0.5, 0.54, 1.12],
    [-0.75, 0.5, 1.11],
    [-1.0, 0.49, 1.075],
    [-1.5, 0.47, 1.012],
    [-2.0, 0.44, 0.95],
    [-2.3, 0.42, 0.912],
    [-2.44, 0.4, 0.895],
  ])),
  // The bonnet's inner crease, straight from the bonnet corner to the windscreen base; it dies under the glass and
  // carries on as a smooth line over the roof and deck.
  // It starts at the outer end of the V, invisible, and comes in crisp at the bonnet corner.
  inner: onCap(line([
    [2.378, 0.36, 0.432],
    [2.28, 0.42, 0.474],
    [2.173, 0.474, 0.515],
    [1.9, 0.399, 0.592],
    [1.6, 0.315, 0.691],
    [1.513, 0.29, 0.72],
    [1.3, 0.3, 0.803],
    [1.1, 0.31, 0.875],
    [0.9, 0.33, 0.95],
    [0.7, 0.335, 1.023],
    [0.45, 0.34, 1.104],
    [0.2, 0.335, 1.148],
    [0.0, 0.339, 1.16],
    [-0.25, 0.339, 1.158],
    [-0.5, 0.341, 1.146],
    [-0.75, 0.34, 1.123],
    [-1.0, 0.32, 1.072],
    [-1.5, 0.3, 1.0],
    [-2.1, 0.3, 0.935],
    [-2.44, 0.3, 0.895],
  ])),
  // The center line: the bonnet one straight rising line from the nose tip to the windscreen base, the screen raked a
  // little steeper, the roof, the deck.
  // The ridge blend at the V tip rounds the corner back by about 16 mm, and the deck tip's by about 5 mm, so the key
  // line runs that far past each end.
  center: line([
    [zFront + 0.0165, 0, 0.408],
    [2.2, 0, 0.505],
    [1.9, 0, 0.604],
    [1.5, 0, 0.736],
    [1.25, 0, 0.835],
    [1.03, 0, 0.92],
    [0.85, 0, 0.988],
    [0.67, 0, 1.04],
    [0.45, 0, 1.098],
    [0.2, 0, 1.14],
    [0.0, 0, 1.156],
    [-0.2, 0, 1.156],
    [-0.4, 0, 1.149],
    [-0.55, 0, 1.14],
    [-0.7, 0, 1.12],
    [-0.9, 0, 1.06],
    [-1.2, 0, 1.0],
    [-1.5, 0, 0.96],
    [-1.8, 0, 0.93],
    [-2.1, 0, 0.905],
    [-2.3, 0, 0.893],
    [zRear - 0.0045, 0, 0.885],
  ]),
}

/** u at which a key line reaches z. */
const uz = (k: ReadonlyArray<readonly [number, number, number, number]>, z: number): number => uAt(z, k[0][3], k[k.length - 1][3])

/** Crease radius: small and even everywhere, so every edge catches a highlight. */
const edge = 0.004

/** The body before pass 2: still the reference behind the front, where the V end key runs unseen. */
const refDef: LoftDef = {
  keys: [
    { pts: keyLines.rocker },
    { pts: keyLines.sill, round: 0.006, sharp: 1 },
    { pts: keyLines.crease, round: edge, sharp: 1 },
    { pts: keyLines.shoulder, round: edge, sharp: 1 },
    // Ahead of the bonnet corner the bonnet's two creases are only guides: the bonnet and wing top meet the front edge
    // as one surface, and the creases come in over the last few centimeters before the corner. The inner one keeps a
    // short crisp kink where the level V of the front edge turns up over the eye, dying out tangent behind it.
    {
      pts: keyLines.rail,
      monotone: true,
      round: edge,
      sharp: [[0, 0], [uz(keyLines.rail, 2.24), 0], [uz(keyLines.rail, 2.16), 1], [1, 1]],
    },
    // Crisp along the bonnet, dying out tangent under the windscreen.
    {
      pts: keyLines.inner,
      monotone: true,
      round: [[0, edge], [uz(keyLines.inner, 1.477), edge], [uz(keyLines.inner, 1.255), 0.08], [1, 0.08]],
      sharp: [[0, 1], [uz(keyLines.inner, 2.36), 1], [uz(keyLines.inner, 2.33), 0], [uz(keyLines.inner, 2.27), 0], [uz(keyLines.inner, 2.18), 1], [uz(keyLines.inner, 1.477), 1], [uz(keyLines.inner, 1.255), 0], [1, 0]],
    },
    // Along the bonnet the two flat center facets meet at a blended ridge, so the leading edge is a straight V.
    { pts: keyLines.center, round: [[0, 0.08], [0.17, 0.08], [0.24, 0.15], [1, 0.15]], sharp: [[0, 1], [0.17, 1], [0.24, 0], [1, 0]] },
  ],
  segs: [
    { bulgeA: 0.08 },
    // The lower flank: a shallow hollow, scooped deep behind the front wheel and on through the door into the intake.
    {
      bulgeA: [[0, -0.06], [0.25, -0.06], [0.3, -0.3], [0.54, -0.3], [0.62, -0.06], [1, -0.06]],
      // Under the crease the scallop turns in hard, so the upper flank overhangs it with a crisp shadow line.
      bulgeB: [[0, -0.06], [0.25, -0.06], [0.3, -0.8], [0.5, -0.8], [0.6, -0.06], [1, -0.06]],
    },
    // The upper flank: a plane.
    { bulgeA: [[0, 0.06], [0.2, 0.03], [0.3, 0.02], [1, 0.02]] },
    // Wing top: a flat facet over the arch crown. Pillar side and side glass: one flat plane leaning in. Deck flank:
    // nearly flat.
    { bulgeA: [[0, 0], [0.225, 0], [0.3, 0.01], [0.55, 0.01], [0.65, 0.03], [1, 0.03]] },
    // Bonnet side facet, then the windscreen's outer part: flat, meeting the side glass at the A-pillar ridge. Roof:
    // nearly flat. Deck: a little crowned.
    { bulgeA: [[0, 0], [0.4, 0], [0.47, 0.02], [0.55, 0.03], [0.7, 0.06], [1, 0.06]] },
    // Bonnet center, then the windscreen's middle: flat facets. Roof and deck: a little crowned.
    { bulgeA: [[0, 0], [0.4, 0], [0.47, 0.02], [0.55, 0.03], [0.7, 0.06], [1, 0.06]] },
  ],
  vAt: [0, 0.1, 0.22, 0.4, 0.6, 0.78, 1],
  mirrorTop: true,
}


/*
 * Pass 2 front construction. Each feature line is one curve from lines.ts, built once and shared by the two fields
 * either side of it: a field is the surface swept between its two lines with one constant crown, so neighbours share
 * every boundary sample. On the bonnet and wing the lines are straight and the fields flat; on the windscreen every
 * section is a plane of constant z, so the screen is one fair surface. The first 4 mm of every line is a quarter round
 * from the fascia up onto the bonnet or wing, so the front edge is one even roll.
 */

const len0 = dims.length
const uOf = (z: number): number => (zFront - z) / len0
/** Windscreen base. From here back the screen lines share sections of constant z. */
const uCowl = uOf(1.51)
/** The windscreen header: where the rebuilt screen lines hand back to the roof as it was. */
const zRoof = featureLines.header[0][2]
/** Where the rebuilt flank lines hand back to the door as it was: the end of the old front blend. */
const uDoor = blend
const zDoor = zFront - len0 * uDoor
/** u over which the front edge rolls onto the fascia. */
const uRoll = 0.002
const roll = frontSection.roll

type ZFn = (z: number) => V3

/** A path through nodes in z: straight between two nodes, smooth through interior nodes without a slope, and
 * carried on straight past its ends. */
function zPath(nodes: ReadonlyArray<PathNode>): ZFn {
  const n = [...nodes].sort((a, b) => b.z - a.z)
  const slope = (i: number): [number, number] => {
    const d = n[i].d
    if (d) return [d[0], d[1]]
    const a = n[Math.max(0, i - 1)]
    const b = n[Math.min(n.length - 1, i + 1)]
    if (a === b) return [0, 0]
    return [(b.x - a.x) / (b.z - a.z), (b.y - a.y) / (b.z - a.z)]
  }
  const m = n.map((_, i) => slope(i))
  return (z) => {
    if (n.length === 1 || z >= n[0].z) {
      const dz = z - n[0].z
      return [n[0].x + m[0][0] * dz, n[0].y + m[0][1] * dz, z]
    }
    const last = n.length - 1
    if (z <= n[last].z) {
      const dz = z - n[last].z
      return [n[last].x + m[last][0] * dz, n[last].y + m[last][1] * dz, z]
    }
    let i = 0
    while (z < n[i + 1].z) i++
    const a = n[i]
    const b = n[i + 1]
    const h = b.z - a.z
    const t = (z - a.z) / h
    const h00 = (1 + 2 * t) * (1 - t) * (1 - t)
    const h10 = t * (1 - t) * (1 - t)
    const h01 = t * t * (3 - 2 * t)
    const h11 = t * t * (t - 1)
    return [
      h00 * a.x + h10 * h * m[i][0] + h01 * b.x + h11 * h * m[i + 1][0],
      h00 * a.y + h10 * h * m[i][1] + h01 * b.y + h11 * h * m[i + 1][1],
      z,
    ]
  }
}

/** Pieces in z, each handing to the next through a smooth blend of half width `w` around `z`. */
function joined(first: ZFn, ...rest: Array<{ z: number; w: number; f: ZFn }>): ZFn {
  return (z) => {
    let p = first(z)
    for (const r of rest) {
      if (z >= r.z + r.w) break
      const s = smoothstep(r.z + r.w, r.z - r.w, z)
      const q = r.f(z)
      p = [p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s, z]
    }
    return p
  }
}

/** An old key line read by z, valid behind the front blend: u from a fine table of z, then one exact evaluation. */
function byZ(t: Track3): ZFn {
  const n = 4096
  const zs = new Float64Array(n + 1)
  for (let i = 0; i <= n; i++) zs[i] = t.at(i / n)[2]
  return (z) => {
    if (z >= zs[0]) return t.at(0)
    if (z <= zs[n]) return t.at(1)
    let lo = 0
    let hi = n
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1
      if (zs[m] > z) lo = m
      else hi = m
    }
    const f = (zs[lo] - z) / (zs[lo] - zs[hi])
    return t.at((lo + f) / n)
  }
}

/** Slope (dx/dz, dy/dz) of an old key line at u. */
function oldSlopeAt(t: Track3, u: number): [number, number] {
  const a = t.at(u - 1e-4)
  const b = t.at(u + 1e-4)
  return [(a[0] - b[0]) / (a[2] - b[2]), (a[1] - b[1]) / (a[2] - b[2])]
}
const oldSlope = (t: Track3, z: number): [number, number] => oldSlopeAt(t, uOf(z))

const node = (p: V3, d?: readonly [number, number]): PathNode => ({ z: p[2], x: p[0], y: p[1], d })

/**
 * One key line: the roll at the front edge, then the path, then from `uJoin` the old key line unchanged. Until `uMerge`
 * the path is walked with its own smooth spacing in z; from there on it keeps the old key line's spacing, which is the
 * body's common spacing to within a few millimeters, so every key line from the cowl back shares sections of nearly
 * constant z and hands over to the old line with the same position, direction and speed.
 */
function keyFn(v: number, zC: number, path: ZFn, uMerge: number, zJoin: number, old?: Track3): (u: number) => V3 {
  const C = path(zC)
  const d1 = sub(path(zC - 1e-4), path(zC + 1e-4))
  const speedZ = len(d1) / 2e-4
  const z0 = zC - roll / speedZ
  const P0 = path(z0)
  const E = add(C, scale(fasciaDown(v), roll))
  const zOld = (u: number): number => (old ? old.at(u)[2] : zFront - len0 * u)
  const zM = zOld(uMerge)
  const rate = (zOld(uMerge - 1e-4) - zOld(uMerge + 1e-4)) / 2e-4
  const span = uMerge - uRoll
  const m = (rate * span) / (z0 - zM)
  const q = Math.min(2.5, Math.max(0.3, ((2 * roll) / uRoll) * span / (speedZ * (z0 - zM))))
  const uJoin = old ? uOf(zJoin) : Infinity
  return (u) => {
    if (u <= uRoll) {
      const s = Math.max(0, u / uRoll)
      const a = (1 - s) * (1 - s)
      const b = 2 * (1 - s) * s
      const c = s * s
      return [a * E[0] + b * C[0] + c * P0[0], a * E[1] + b * C[1] + c * P0[1], a * E[2] + b * C[2] + c * P0[2]]
    }
    if (old && u >= uJoin - 1e-9) return old.at(u)
    if (u >= uMerge) return path(zOld(u))
    const t = (u - uRoll) / span
    const h = (t * t * t - 2 * t * t + t) * q + (-2 * t * t * t + 3 * t * t) + (t * t * t - t * t) * m
    return path(z0 - (z0 - zM) * h)
  }
}

const old = {
  rocker: new Track3(keyLines.rocker),
  sill: new Track3(keyLines.sill),
  crease: new Track3(keyLines.crease),
  shoulder: new Track3(keyLines.shoulder),
  rail: new Track3(keyLines.rail, true),
  inner: new Track3(keyLines.inner, true),
  center: new Track3(keyLines.center),
}

const F = featureLines
const ref = new Loft(refDef)
/** The V end key behind the screen: on the old surface, a third of the way out from the center line. */
const refVee = (u: number): V3 => ref.at(u, 0.78 + 0.22 * (2 / 3))

/** The screen's center arc hands to the old center line here. */
const zCrown = -0.1
/** Over the rear of the roof the crown eases back onto the old key lines, reached at `zBack1`. */
const zBack0 = -0.45
const zBack1 = -0.85

// Center line: bonnet straight to the cowl, then the screen as one convex arc into the old roof center line, high
// enough over the header that the screen stays crowned across right to its top edge.
const centerPath = joined(
  zPath(F.center),
  {
    z: 1.51,
    w: 0.02,
    f: zPath([
      { z: 1.51, x: 0, y: 0.736, d: [0, -0.5] },
      // Over the header the center stands 8 mm above the A-pillar tops, so the screen is crowned to its top edge.
      { z: zRoof, x: 0, y: 1.116, d: [0, -0.2] },
      { ...node(old.center.at(uOf(zCrown))), d: oldSlope(old.center, zCrown) },
    ]),
  },
  { z: zCrown, w: 0.01, f: byZ(old.center) },
)

// Wing ridge: straight to the cowl, then out round the windscreen's lower corner to the A-pillar base, then the pillar
// straight to the header, where the roof rail carries on as it was.
const pillarBase = F.pillar[0]
const railPath = joined(
  zPath(F.rail),
  { z: F.pillarFoot[0].z, w: 0.02, f: zPath(F.pillarFoot) },
  {
    z: pillarBase.z,
    w: 0.06,
    f: zPath([
      { ...pillarBase, d: [(F.pillar[1].x - pillarBase.x) / (F.pillar[1].z - pillarBase.z), (F.pillar[1].y - pillarBase.y) / (F.pillar[1].z - pillarBase.z)] },
      { ...node(old.rail.at(uOf(zRoof))), d: oldSlope(old.rail, zRoof) },
    ]),
  },
)
/** The wing ridge, then the old roof rail behind the header. */
const oldRail = byZ(old.rail)
const railAt: ZFn = (z) => (z >= zRoof ? railPath(z) : oldRail(z))
/**
 * On the screen and roof a line at x between the center and the rail lies on one crown through both, a parabola
 * across, so every section is convex with its high point on the center line. Over the rear of the roof the line eases
 * back onto its old height `yOld`.
 */
const onCrown = (x: (z: number) => number, yOld: (z: number) => number): ZFn => (z) => {
  const c = centerPath(z)
  const r = railAt(z)
  const xi = x(z) / r[0]
  const y = c[1] - (c[1] - r[1]) * xi * xi
  return [x(z), y + (yOld(z) - y) * smoothstep(zBack0, zBack1, z), z]
}
const lin = (z: number, za: number, a: number, zb: number, b: number): number => a + ((b - a) * (z - za)) / (zb - za)
/** x running straight from the cowl to the header, then easing onto the old line's x. */
const xUp = (za: number, xa: number, oldAt: ZFn): ((z: number) => number) => {
  const xb = oldAt(zRoof)[0]
  return (z) => {
    const a = lin(z, za, xa, zRoof, xb)
    const w = smoothstep(zRoof + 0.06, zRoof - 0.06, z)
    return a + (oldAt(z)[0] - a) * w
  }
}
const oldInner = byZ(old.inner)
const innerPath = joined(
  zPath(F.inner),
  { z: 1.51, w: 0.02, f: onCrown(xUp(1.513, 0.29, oldInner), (z) => oldInner(z)[1]) },
)
const veeOld: ZFn = (z) => refVee(uOf(z))
const veePath = joined(
  zPath(F.vee),
  { z: 1.51, w: 0.02, f: onCrown(xUp(1.51, 0.15, veeOld), (z) => veeOld(z)[1]) },
)
// The arch shoulder: from the brow tip over the arch, into the old shoulder halfway down the door.
const zShoulder = -0.34
const shoulderPath = zPath([...F.shoulder, { ...node(old.shoulder.at(uOf(zShoulder))), d: oldSlope(old.shoulder, zShoulder) }])
const toDoor = (nodes: PathNode[], t: Track3): ZFn => zPath([...nodes, { ...node(t.at(uDoor)), d: oldSlopeAt(t, uDoor) }])

const knot = (name: string): { v: number; p: readonly [number, number, number] } => [...frontSection.brow, ...frontSection.side].find((k) => k.name === name)!
const keyAt = (name: string, path: ZFn, uMerge: number, zJoin: number, t?: Track3): ((u: number) => V3) =>
  keyFn(knot(name).v, knot(name).p[2], path, uMerge, zJoin, t)

const veeKey = (u: number): V3 => (u >= uOf(zBack1) ? refVee(u) : veeFront(u))
const veeFront = keyAt('vee', veePath, uCowl, -Infinity, undefined)

export const frontKeys = {
  rocker: keyAt('rocker', toDoor(F.rocker, old.rocker), uDoor, zDoor, old.rocker),
  sill: keyAt('sill', toDoor(F.sill, old.sill), uDoor, zDoor, old.sill),
  crease: keyAt('crease', toDoor(F.crease, old.crease), uDoor, zDoor, old.crease),
  shoulder: keyAt('brow', shoulderPath, uDoor, zShoulder, old.shoulder),
  rail: keyAt('rail', railPath, uCowl, zRoof, old.rail),
  inner: keyAt('corner', innerPath, uCowl, zBack1, old.inner),
  vee: veeKey,
  center: keyAt('tip', centerPath, uCowl, zCrown, old.center),
}

/** Roll radius of every crease of the pass 2 body, meters: one even edge, whatever the crease's turn. */
const creaseRoll = 0.003
const cowlIn = uOf(1.53)
const screenIn = uOf(1.4)

export const mainDef: LoftDef = {
  keys: [
    { fn: frontKeys.rocker },
    { fn: frontKeys.sill, round: 0.006, sharp: 1 },
    { fn: frontKeys.crease, roll: creaseRoll, sharp: 1 },
    { fn: frontKeys.shoulder, roll: creaseRoll, sharp: 1 },
    { fn: frontKeys.rail, roll: creaseRoll, sharp: 1 },
    // Crisp along the bonnet, dying out tangent under the windscreen.
    {
      fn: frontKeys.inner,
      roll: creaseRoll,
      sharp: [[0, 1], [cowlIn, 1], [screenIn, 0], [1, 0]],
    },
    // Unseen: it only carries the V end of the front edge back inside the flat center facet.
    { fn: frontKeys.vee, sharp: [[0, 1], [cowlIn, 1], [screenIn, 0], [1, 0]] },
    // The center facet is level across, so the center line is no crease; on the screen and roof it is smooth. The
    // screen's crown is level across the center line already, so it takes no blend there: a blend would bunch its
    // curvature into a band down the middle of the glass.
    { fn: frontKeys.center, round: [[0, 0], [uOf(zRoof), 0], [uOf(0.2), 0.15], [1, 0.15]], sharp: [[0, 1], [uCowl, 1], [screenIn, 0], [1, 0]] },
  ],
  segs: [
    refDef.segs[0],
    refDef.segs[1],
    // The wing side and the upper flank: one surface with one even crown.
    // Behind the eye the cheek edge leans the field back 46 degrees at the waist crease; leaving the crease 0.2 rad
    // fuller there and easing to the door spreads that lean over the whole face instead of a tight band above the
    // crease.
    { bulgeA: [[0, 0.2], [0.1, 0.1], [0.2, 0.02], [1, 0.02]], bulgeB: [[0, 0.025], [0.3, 0.02], [1, 0.02]] },
    refDef.segs[3],
    // Bonnet outer facet, flat; on the screen the span from the A-pillar ridge carries the screen's crown right out to
    // the ridge.
    { ...refDef.segs[4], fairA: [[0, 0], [uOf(1.47), 0], [uOf(1.4), 1], [uOf(zRoof), 1], [uOf(0.3), 0], [1, 0]] },
    // Bonnet center, then the windscreen's middle: flat facets. Roof and deck: a little crowned, the old crown split
    // over the two halves.
    { bulgeA: [[0, 0], [0.4, 0], [0.47, 0.01], [0.55, 0.015], [0.7, 0.03], [1, 0.03]] },
    { bulgeA: [[0, 0], [0.4, 0], [0.47, 0.01], [0.55, 0.015], [0.7, 0.03], [1, 0.03]] },
  ],
  vAt: [0, 0.1, 0.22, 0.4, 0.6, 0.72, 0.86, 1],
  mirrorTop: true,
}

/** The reference body before pass 2, for comparisons behind the front. */
export function refLoft(): Loft {
  return new Loft(refDef)
}

/** The last few centimetres of the loft eased onto the tail cap, so its last section lies on the cap exactly. */
class TailLoft extends Loft {
  override at(u: number, v: number): V3 {
    const p = super.at(u, v)
    const du = 0.025
    if (u <= 1 - du) return p
    const e = super.at(1, v)
    const t = (u - (1 - du)) / du
    const w = t * t * t * (t * (6 * t - 15) + 10)
    return [p[0], p[1], p[2] + w * (capZ(e[0], e[1]) - e[2])]
  }
}

export function mainLoft(): Loft {
  return new TailLoft(mainDef)
}

/** The body behind the paint: the same keys with every roll at 20 mm, so its 14 mm inward offset stays a smooth
 * surface instead of folding through a 3 mm roll. At these turns it parts from the paint's offset by under a
 * millimetre. */
export function backingLoft(): Loft {
  const k = 0.02 / creaseRoll
  const scaled = (r: number | ReadonlyArray<readonly [number, number]>) =>
    typeof r === 'number' ? r * k : r.map(([u, x]) => [u, x * k] as const)
  return new TailLoft({ ...mainDef, keys: mainDef.keys.map((key) => (key.roll === undefined ? key : { ...key, roll: scaled(key.roll) })) })
}
