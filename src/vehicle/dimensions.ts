export const LENGTH = 4.947
export const HALF_LENGTH = LENGTH * 0.5
export const BODY_WIDTH = 2.033
export const HALF_BODY_WIDTH = BODY_WIDTH * 0.5
export const MIRROR_WIDTH = 2.266
export const HALF_MIRROR_WIDTH = MIRROR_WIDTH * 0.5
export const HEIGHT = 1.16

export const FRONT_HUB_Z = 1.286
export const REAR_HUB_Z = -1.493
export const FRONT_HUB_X = 0.86
export const REAR_HUB_X = 0.8505

export interface TireSpec {
  radius: number
  rimRadius: number
  width: number
  outboardX: number
}

export interface BrakeSpec {
  discRadius: number
  discThickness: number
  hatRadius: number
  pistons: number
  caliperAngleRad: number
}

export const FRONT_TIRE: TireSpec = {
  radius: 0.3468,
  rimRadius: 0.254,
  width: 0.265,
  outboardX: 1.008,
}

export const REAR_TIRE: TireSpec = {
  radius: 0.3702,
  rimRadius: 0.2667,
  width: 0.345,
  outboardX: 1.014,
}

export const FRONT_BRAKE: BrakeSpec = {
  discRadius: 0.205,
  discThickness: 0.038,
  hatRadius: 0.112,
  pistons: 10,
  caliperAngleRad: Math.PI,
}

export const REAR_BRAKE: BrakeSpec = {
  discRadius: 0.195,
  discThickness: 0.032,
  hatRadius: 0.108,
  pistons: 4,
  caliperAngleRad: 0.18,
}

export function zFromS(s: number): number {
  return LENGTH * (0.5 - s)
}

export function sFromZ(z: number): number {
  return 0.5 - z / LENGTH
}

const sideCenterTopKnots: Array<[number, number]> = [
  [0.0, 0.432],
  [0.008, 0.446],
  [0.02, 0.48],
  [0.04, 0.537],
  [0.07, 0.605],
  [0.1, 0.662],
  [0.14, 0.731],
  [0.18, 0.775],
  [0.21, 0.79],
  [0.24, 0.816],
  [0.28, 0.905],
  [0.32, 0.98],
  [0.36, 1.044],
  [0.4, 1.096],
  [0.44, 1.126],
  [0.48, 1.136],
  [0.52, 1.137],
  [0.56, 1.132],
  [0.6, 1.122],
  [0.64, 1.094],
  [0.68, 1.078],
  [0.72, 1.058],
  [0.76, 1.036],
  [0.8, 1.012],
  [0.84, 0.988],
  [0.88, 0.962],
  [0.92, 0.938],
  [0.96, 0.908],
  [0.982, 0.896],
  [0.992, 0.72],
  [1.0, 0.492],
]

const sideMaxTopKnots: Array<[number, number]> = [
  [0.0, 0.432],
  [0.008, 0.446],
  [0.02, 0.48],
  [0.04, 0.537],
  [0.08, 0.626],
  [0.12, 0.7],
  [0.16, 0.764],
  [0.2, 0.801],
  [0.24, 0.833],
  [0.28, 0.914],
  [0.32, 0.985],
  [0.36, 1.048],
  [0.4, 1.101],
  [0.44, 1.139],
  [0.48, 1.158],
  [0.52, 1.16],
  [0.56, 1.158],
  [0.6, 1.148],
  [0.64, 1.131],
  [0.68, 1.09],
  [0.72, 1.071],
  [0.76, 1.048],
  [0.8, 1.023],
  [0.84, 0.999],
  [0.88, 0.967],
  [0.92, 0.944],
  [0.96, 0.912],
  [0.981, 0.899],
  [0.991, 0.716],
  [1.0, 0.493],
]

const bodyLowerKnots: Array<[number, number]> = [
  [0.0, 0.166],
  [0.01, 0.148],
  [0.02, 0.139],
  [0.04, 0.13],
  [0.08, 0.127],
  [0.16, 0.128],
  [0.32, 0.127],
  [0.5, 0.127],
  [0.7, 0.127],
  [0.87, 0.158],
  [0.9, 0.152],
  [0.93, 0.186],
  [0.96, 0.227],
  [0.98, 0.318],
  [0.99, 0.393],
  [1.0, 0.462],
]

const planBodyHalfWidthKnots: Array<[number, number]> = [
  [0.0, 0.045],
  [0.01, 0.242],
  [0.02, 0.448],
  [0.03, 0.542],
  [0.04, 0.616],
  [0.06, 0.748],
  [0.08, 0.842],
  [0.12, 0.918],
  [0.16, 0.978],
  [0.2, 0.989],
  [0.24, 0.989],
  [0.3, 0.986],
  [0.36, 0.988],
  [0.42, 0.992],
  [0.5, 0.998],
  [0.58, 1.004],
  [0.66, 1.009],
  [0.74, 1.014],
  [0.8, 1.0165],
  [0.85, 1.014],
  [0.88, 0.982],
  [0.92, 0.903],
  [0.94, 0.836],
  [0.96, 0.703],
  [0.98, 0.546],
  [0.99, 0.453],
  [1.0, 0.426],
]

const heightWidthFactorKnots: Array<[number, number]> = [
  [0.0, 0.955],
  [0.11, 0.992],
  [0.14, 1.0],
  [0.28, 0.998],
  [0.45, 0.994],
  [0.62, 0.992],
  [0.68, 0.988],
  [0.74, 0.935],
  [0.79, 0.855],
  [0.83, 0.792],
  [0.87, 0.735],
  [0.91, 0.665],
  [0.95, 0.608],
  [0.98, 0.535],
  [1.0, 0.395],
]

export function sampleLinearKnots(knots: ReadonlyArray<[number, number]>, t: number): number {
  if (t <= knots[0][0]) return knots[0][1]
  const last = knots[knots.length - 1]
  if (t >= last[0]) return last[1]
  let lo = 0
  let hi = knots.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (knots[mid][0] <= t) lo = mid
    else hi = mid
  }
  const [t0, v0] = knots[lo]
  const [t1, v1] = knots[hi]
  const u = (t - t0) / Math.max(1e-8, t1 - t0)
  const p0 = knots[Math.max(0, lo - 1)]
  const p3 = knots[Math.min(knots.length - 1, hi + 1)]
  const m0 = ((v1 - p0[1]) / Math.max(1e-8, t1 - p0[0])) * (t1 - t0)
  const m1 = ((p3[1] - v0) / Math.max(1e-8, p3[0] - t0)) * (t1 - t0)
  const s0 = v1 - v0
  const clampSlope = (m: number): number => {
    if (Math.abs(s0) < 1e-8) return 0
    if (m * s0 <= 0) return 0
    return Math.sign(m) * Math.min(Math.abs(m), 3 * Math.abs(s0))
  }
  const cm0 = clampSlope(m0)
  const cm1 = clampSlope(m1)
  const u2 = u * u
  const u3 = u2 * u
  return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * cm0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * cm1
}

export function evalSideMaxTop(s: number): number {
  return sampleLinearKnots(sideMaxTopKnots, s)
}

export function evalSideCenterTop(s: number): number {
  return sampleLinearKnots(sideCenterTopKnots, s)
}

export function evalBodyLower(s: number): number {
  return sampleLinearKnots(bodyLowerKnots, s)
}

export function evalPlanHalfWidth(s: number): number {
  return sampleLinearKnots(planBodyHalfWidthKnots, s)
}

export function evalHeightWidthFactor(hNorm: number): number {
  return sampleLinearKnots(heightWidthFactorKnots, hNorm)
}
