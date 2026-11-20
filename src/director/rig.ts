import * as THREE from 'three'
import { config, type FormatSpec } from '../config'
import type { CameraState } from '../core/lens'
import { Rng, streamSeed } from '../core/random'

const duration = config.film.durationSeconds
const longSideMm = 36

/** Progress from 0 to 1 between start and end, with the speed eased in and out like a rig with mass. */
export function glide(t: number, start: number, end: number, easeIn: number, easeOut: number): number {
  const span = end - start
  const a = Math.min(easeIn, span / 2)
  const b = Math.min(easeOut, span / 2)
  const area = span - a / 2 - b / 2
  const x = t - start
  if (x <= 0) return 0
  if (x >= span) return 1
  if (x < a) {
    const u = x / a
    return (a * (u * u * u - (u * u * u * u) / 2)) / area
  }
  if (x <= span - b) return (a / 2 + (x - a)) / area
  const w = (x - (span - b)) / b
  return (a / 2 + (span - a - b) + b * (w - w * w * w + (w * w * w * w) / 2)) / area
}

export function ease(t: number, start: number, end: number): number {
  const u = Math.min(1, Math.max(0, (t - start) / (end - start)))
  return u * u * u * (u * (6 * u - 15) + 10)
}

export function mix(a: number, b: number, u: number): number {
  return u === 1 ? b : a + (b - a) * u
}

export function mixV(a: THREE.Vector3, b: THREE.Vector3, u: number): THREE.Vector3 {
  return u === 1 ? b.clone() : a.clone().lerp(b, u)
}

export function sensorWidthMm(format: FormatSpec): number {
  return format.width >= format.height ? longSideMm : (longSideMm * format.width) / format.height
}

export type OperatorClass = 'wide' | 'macro'

interface Wave {
  cycles: number
  phase: number
  weight: number
}

const channels: Wave[][] = (() => {
  const rng = new Rng(streamSeed('operator'))
  const low = Math.ceil(0.2 * duration)
  const high = Math.floor(1.5 * duration)
  return Array.from({ length: 6 }, () => {
    const waves = Array.from({ length: 4 }, (_, i) => ({
      cycles: low + rng.int(Math.max(1, Math.round((high - low) * (i < 2 ? 0.3 : 1)))),
      phase: rng.next() * Math.PI * 2,
      weight: 1 / (1 + i),
    }))
    const total = waves.reduce((s, w) => s + w.weight, 0)
    for (const w of waves) w.weight /= total
    return waves
  })
})()

function channel(index: number, t: number): number {
  let v = 0
  const turns = (t / duration) % 1
  for (const w of channels[index]) v += w.weight * Math.sin(2 * Math.PI * w.cycles * turns + w.phase)
  return v
}

const limits: Record<OperatorClass, { degrees: number; meters: number }> = {
  wide: { degrees: 0.12, meters: 0.002 },
  macro: { degrees: 0.03, meters: 0.0005 },
}

export interface Shot {
  position: THREE.Vector3
  target: THREE.Vector3
  /** Where the target sits in frame: x from -1 at the left edge to 1 at the right, y from -1 at the bottom to 1 at the top. */
  screen?: [number, number]
  focalMm: number
  focus: THREE.Vector3 | number
  focusOffset?: number
  tStop: number
  operator: OperatorClass
  near?: number
  /** Degrees about the lens axis, for a head levelled to a tilted subject. */
  roll?: number
}

const up = new THREE.Vector3(0, 1, 0)
const look = new THREE.Matrix4()
const turn = new THREE.Quaternion()
const euler = new THREE.Euler()
const forward = new THREE.Vector3()
const offset = new THREE.Vector3()

export function resolveShot(shot: Shot, format: FormatSpec, timeSeconds: number): CameraState {
  const sensor = sensorWidthMm(format)
  const halfW = sensor / 2 / shot.focalMm
  const halfH = (halfW * format.height) / format.width
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(look.lookAt(shot.position, shot.target, up))
  const [sx, sy] = shot.screen ?? [0, 0]
  const limit = limits[shot.operator]
  const rad = THREE.MathUtils.degToRad(limit.degrees)
  euler.set(-Math.atan(sy * halfH) + rad * channel(0, timeSeconds), Math.atan(sx * halfW) + rad * channel(1, timeSeconds), THREE.MathUtils.degToRad(shot.roll ?? 0) + rad * 0.5 * channel(2, timeSeconds), 'YXZ')
  quaternion.multiply(turn.setFromEuler(euler))
  offset.set(channel(3, timeSeconds), channel(4, timeSeconds), channel(5, timeSeconds)).multiplyScalar(limit.meters).applyQuaternion(quaternion)
  const position = shot.position.clone().add(offset)
  forward.set(0, 0, -1).applyQuaternion(quaternion)
  const focusDistance = (typeof shot.focus === 'number' ? shot.focus : Math.max(0.05, offset.copy(shot.focus).sub(position).dot(forward))) + (shot.focusOffset ?? 0)
  return {
    position,
    quaternion,
    focalMm: shot.focalMm,
    sensorWidthMm: sensor,
    focusDistance,
    fNumber: shot.tStop,
    near: shot.near ?? 0.1,
    far: 900,
  }
}
