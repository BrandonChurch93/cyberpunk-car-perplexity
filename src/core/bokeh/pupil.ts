import { apertureRadius, type CameraState } from '../lens'
import { hashInts, streamSeed } from '../random'

const blades = 9
const rim = 0.23
const tau = Math.PI * 2
const angleCount = 1024
const angleCdf = new Float64Array(angleCount + 1)
const seed = streamSeed('bokeh-pupil')

const lattice = [
  [0.125, 0.125], [0.375, 0.125], [0.625, 0.125], [0.875, 0.125],
  [0.245, 0.375], [0.495, 0.375], [0.745, 0.375], [0.995, 0.375],
  [0.055, 0.625], [0.305, 0.625], [0.555, 0.625], [0.805, 0.625],
  [0.185, 0.875], [0.435, 0.875], [0.685, 0.875], [0.935, 0.875],
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

function ringCounts(count: number): number[] {
  if (count < 4) return [count]
  const rings = Math.max(2, Math.round(Math.sqrt(count) * 0.71))
  const result: number[] = []
  let previous = 0
  for (let r = 1; r <= rings; r++) {
    const next = Math.round(count * (r / rings) ** 2)
    result.push(next - previous)
    previous = next
  }
  return result
}

const layouts = new Map<number, PupilCell[]>()

export function pupilLayout(count: number): PupilCell[] {
  const existing = layouts.get(count)
  if (existing) return existing
  const cells: PupilCell[] = []
  for (const [ring, sectors] of ringCounts(count).entries()) {
    const inner = cells.length / count
    const radialMass = sectors / count
    const shift = ring * 0.38196601125
    for (let sector = 0; sector < sectors; sector++) {
      const center: Point = [0, 0]
      const taps = lattice.map(([u, v]): Point => {
        const turn = (sector + u) / sectors + shift
        const a = angleAt(turn - Math.floor(turn))
        const r = radiusAt(inner + radialMass * v) * bladeRadius(a)
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
