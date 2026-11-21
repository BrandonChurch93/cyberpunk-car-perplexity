import { Loft, type LoftDef } from '../geom/loft'
import { smoothstep } from '../geom/vec'

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

export const keyLines = {
  rocker: line([
    [1.8, 0.93, 0.15],
    [1.5, 0.945, 0.14],
    [1.0, 0.955, 0.135],
    [0, 0.955, 0.132],
    [-1.0, 0.965, 0.132],
    [-1.6, 0.965, 0.14],
    [-2.0, 0.9, 0.2],
    [-2.25, 0.76, 0.27],
    [-2.4, 0.6, 0.32],
  ]),
  sill: line([
    [1.8, 0.955, 0.3],
    [1.5, 0.975, 0.3],
    [1.0, 0.985, 0.305],
    [0, 0.99, 0.315],
    [-1.0, 1.0, 0.335],
    [-1.6, 1.0, 0.35],
    [-2.0, 0.94, 0.38],
    [-2.25, 0.8, 0.41],
    [-2.42, 0.62, 0.43],
  ]),
  crease: line([
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
  ]),
  // The wing ridge over the front arch, then one straight shoulder from the door to the rear hub, then the deck edge
  // falling straight to the tail. Crisp end to end.
  shoulder: line([
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
  ]),
  // The bonnet's outer crease, straight from the bonnet corner to the A-pillar base, then the pillar, the roof rail and
  // the deck edge falling straight to the tail.
  // It starts on the bonnet's front edge, invisible, and comes in crisp at the bonnet corner.
  rail: line([
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
  ]),
  // The bonnet's inner crease, straight from the bonnet corner to the windscreen base; it dies under the glass and
  // carries on as a smooth line over the roof and deck.
  // It starts at the outer end of the V, invisible, and comes in crisp at the bonnet corner.
  inner: line([
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
  ]),
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

export const mainDef: LoftDef = {
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

export function mainLoft(): Loft {
  return new Loft(mainDef)
}
