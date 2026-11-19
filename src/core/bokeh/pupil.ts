import { apertureRadius, type CameraState } from '../lens'
import { hashInts, streamSeed } from '../random'
import { concentricDisk } from '../sampler'

const blades = 9
const rim = 0.23
const tau = Math.PI * 2
const angleCount = 1024
const angleCdf = new Float64Array(angleCount + 1)
const seed = streamSeed('bokeh-pupil')

const lattice = [
  [0.125, 0.125], [0.375, 0.125], [0.625, 0.125], [0.875, 0.125],
  [0.21, 0.375], [0.46, 0.375], [0.71, 0.375], [0.96, 0.375],
  [0.04, 0.625], [0.29, 0.625], [0.54, 0.625], [0.79, 0.625],
  [0.125, 0.875], [0.375, 0.875], [0.625, 0.875], [0.875, 0.875],
] as const

export const pupilTapCount = lattice.length
type Point = [number, number]

export interface PupilCell {
  center: Point
  taps: Point[]
}

function bladeRadius(angle: number): number {
  const step = tau / blades
  const f = angle / step + 0.5
  const edge = ((f - Math.floor(f)) - 0.5) * step
  return 0.34 + 0.66 * Math.cos(step * 0.5) / Math.cos(edge)
}

for (let i = 0; i < angleCount; i++) {
  angleCdf[i + 1] = angleCdf[i] + bladeRadius((i + 0.5) * tau / angleCount) ** 2
}

function angleAt(u: number): number {
  const mass = u * angleCdf[angleCount]
  let lo = 0
  let hi = angleCount
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (angleCdf[mid] > mass) hi = mid
    else lo = mid
  }
  return (lo + (mass - angleCdf[lo]) / (angleCdf[hi] - angleCdf[lo])) * tau / angleCount
}

function radiusAt(mass: number): number {
  const target = mass * (1 + rim / 5)
  let t = mass
  for (let i = 0; i < 3; i++) t -= (t + rim * t ** 5 / 5 - target) / (1 + rim * t ** 4)
  return Math.sqrt(Math.max(0, t))
}

const layouts = new Map<number, PupilCell[]>()

export function pupilLayout(count: number): PupilCell[] {
  const existing = layouts.get(count)
  if (existing) return existing
  const cells: PupilCell[] = []
  const rows = Math.max(1, Math.floor(Math.sqrt(count)))
  for (let row = 0; row < rows; row++) {
    const columns = Math.floor(count / rows) + Number(row < count % rows)
    const v0 = cells.length / count
    const dv = columns / count
    for (let column = 0; column < columns; column++) {
      const center: Point = [0, 0]
      const taps = lattice.map(([u, v]): Point => {
        const [dx, dy] = concentricDisk((column + u) / columns, v0 + v * dv)
        const a = angleAt((Math.atan2(dy, dx) / tau + 1) % 1)
        const r = radiusAt(dx * dx + dy * dy) * bladeRadius(a)
        const x = r * Math.cos(a)
        const y = r * Math.sin(a)
        center[0] += x / pupilTapCount
        center[1] += y / pupilTapCount
        return [x, y]
      })
      cells.push({ center, taps })
    }
  }
  layouts.set(count, cells)
  return cells
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b]
  return a
}

export function pupilCell(frame: number, index: number, count: number): PupilCell {
  const cells = pupilLayout(count)
  const offset = hashInts(seed, frame) % count
  let step = 1 + hashInts(seed, frame, 2) % count
  while (gcd(step, count) > 1) step = step % count + 1
  return cells[(offset + step * index) % count]
}

export function circleScale(state: CameraState, width: number): number {
  return width * state.focalMm * apertureRadius(state) / state.sensorWidthMm
}

export function pupilIsActive(state: CameraState, width: number, samples: number): boolean {
  const distantRadius = circleScale(state, width) / state.focusDistance
  return distantRadius >= 7 && distantRadius / Math.sqrt(samples) > 1.1
}
