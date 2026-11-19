import * as THREE from 'three'
import { config, type FormatSpec } from '../../config'
import type { CameraState } from '../../core/lens'
import { sensorWidthMm } from '../rig'

export interface OrbitLimits {
  minHeight: number
  margin: number
  maxDistance: number
  minElevation: number
  maxElevation: number
}

const deg = THREE.MathUtils.degToRad
const up = new THREE.Vector3(0, 1, 0)
const look = new THREE.Matrix4()

export function defaultLimits(box: THREE.Box3): OrbitLimits {
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius
  return { minHeight: 0.12, margin: 0.3, maxDistance: Math.max(14, radius * 6), minElevation: deg(-8), maxElevation: deg(82) }
}

/** Distance from a point inside the box to the box surface along a unit direction. */
export function exitDistance(box: THREE.Box3, from: THREE.Vector3, direction: THREE.Vector3): number {
  let t = Infinity
  for (const axis of ['x', 'y', 'z'] as const) {
    const d = direction[axis]
    if (Math.abs(d) < 1e-9) continue
    const bound = d > 0 ? box.max[axis] : box.min[axis]
    t = Math.min(t, (bound - from[axis]) / d)
  }
  return Number.isFinite(t) ? Math.max(0, t) : 0
}

export class Orbit {
  readonly target: THREE.Vector3
  readonly limits: OrbitLimits
  azimuth = deg(35)
  elevation = deg(9)
  distance: number
  private readonly keepOut: THREE.Box3

  constructor(readonly box: THREE.Box3, limits?: OrbitLimits) {
    const size = box.getSize(new THREE.Vector3())
    this.target = box.getCenter(new THREE.Vector3()).setY(box.min.y + size.y * 0.45)
    this.limits = limits ?? defaultLimits(box)
    this.keepOut = box.clone().expandByScalar(this.limits.margin)
    this.distance = box.getBoundingSphere(new THREE.Sphere()).radius * 2.4
    this.clamp()
  }

  direction(out = new THREE.Vector3()): THREE.Vector3 {
    const c = Math.cos(this.elevation)
    return out.set(Math.sin(this.azimuth) * c, Math.sin(this.elevation), Math.cos(this.azimuth) * c)
  }

  rotate(dAzimuth: number, dElevation: number): void {
    this.azimuth = (this.azimuth + dAzimuth) % (Math.PI * 2)
    this.elevation += dElevation
    this.clamp()
  }

  zoom(factor: number): void {
    this.distance *= factor
    this.clamp()
  }

  clamp(): void {
    const l = this.limits
    for (let pass = 0; pass < 3; pass++) {
      this.elevation = Math.min(l.maxElevation, Math.max(l.minElevation, this.elevation))
      const minDistance = exitDistance(this.keepOut, this.target, this.direction()) + 1e-6
      this.distance = Math.min(l.maxDistance, Math.max(minDistance, this.distance))
      const lowest = Math.asin(Math.max(-1, Math.min(1, (l.minHeight - this.target.y) / this.distance)))
      if (this.elevation < lowest) this.elevation = lowest
    }
  }

  position(): THREE.Vector3 {
    return this.direction().multiplyScalar(this.distance).add(this.target)
  }

  cameraState(format: FormatSpec): CameraState {
    const position = this.position()
    return {
      position,
      quaternion: new THREE.Quaternion().setFromRotationMatrix(look.lookAt(position, this.target, up)),
      focalMm: config.lens.focalLengthsMm[1],
      sensorWidthMm: sensorWidthMm(format),
      focusDistance: this.distance,
      fNumber: 8,
      near: 0.05,
      far: 900,
    }
  }
}
