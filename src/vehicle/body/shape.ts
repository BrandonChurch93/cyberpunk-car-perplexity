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
  shoulder: line([
    [1.8, 0.95, 0.7],
    [1.6, 0.972, 0.77],
    [1.4, 0.978, 0.8],
    [1.2, 0.97, 0.806],
    [1.0, 0.95, 0.8],
    [0.67, 0.89, 0.755],
    [0.4, 0.875, 0.77],
    [0.0, 0.86, 0.82],
    [-0.34, 0.855, 0.876],
    [-0.7, 0.865, 0.925],
    [-1.1, 0.88, 0.95],
    [-1.5, 0.88, 0.958],
    [-1.9, 0.83, 0.95],
    [-2.2, 0.73, 0.93],
    [-2.42, 0.6, 0.91],
  ]),
  rail: line([
    [2.28, 0.58, 0.6],
    [2.0, 0.7, 0.68],
    [1.7, 0.76, 0.75],
    [1.4, 0.79, 0.79],
    [1.15, 0.8, 0.815],
    [0.9, 0.75, 0.92],
    [0.7, 0.69, 1.01],
    [0.45, 0.62, 1.11],
    [0.2, 0.605, 1.125],
    [0.0, 0.59, 1.13],
    [-0.25, 0.57, 1.13],
    [-0.5, 0.54, 1.12],
    [-0.75, 0.5, 1.11],
    [-1.0, 0.49, 1.075],
    [-1.5, 0.47, 1.02],
    [-2.0, 0.44, 0.96],
    [-2.3, 0.42, 0.93],
    [-2.44, 0.4, 0.91],
  ]),
  center: line([
    [zFront, 0, 0.445],
    [2.2, 0, 0.53],
    [2.0, 0, 0.6],
    [1.8, 0, 0.68],
    [1.5, 0, 0.78],
    [1.2, 0, 0.88],
    [0.9, 0, 0.97],
    [0.7, 0, 1.03],
    [0.45, 0, 1.1],
    [0.2, 0, 1.145],
    [0.0, 0, 1.156],
    [-0.2, 0, 1.156],
    [-0.4, 0, 1.149],
    [-0.55, 0, 1.14],
    [-0.7, 0, 1.12],
    [-0.9, 0, 1.06],
    [-1.2, 0, 1.0],
    [-1.5, 0, 0.96],
    [-1.8, 0, 0.93],
    [-2.1, 0, 0.91],
    [-2.3, 0, 0.9],
    [zRear, 0, 0.89],
  ]),
}

export const mainDef: LoftDef = {
  keys: [
    { pts: keyLines.rocker },
    { pts: keyLines.sill, round: 0.006, sharp: 1 },
    { pts: keyLines.crease, round: 0.004, sharp: 1 },
    { pts: keyLines.shoulder, round: 0.03, sharp: 0.4 },
    { pts: keyLines.rail, round: 0.012, sharp: 1 },
    { pts: keyLines.center, round: 0.15, sharp: 0 },
  ],
  segs: [{ bulgeA: 0.08 }, { bulgeA: -0.06 }, { bulgeA: 0.12 }, { bulgeA: 0.12 }, { bulgeA: 0.22 }],
  vAt: [0, 0.12, 0.28, 0.5, 0.7, 1],
  mirrorTop: true,
}

export function mainLoft(): Loft {
  return new Loft(mainDef)
}
