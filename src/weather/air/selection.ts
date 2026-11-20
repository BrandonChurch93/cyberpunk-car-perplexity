import * as THREE from 'three'
import { config, shutterSeconds } from '../../config'
import { prevailingWind, terminalSpeed } from './motion'

export const clipBounds = { x: 1.4, y: 1.7, near: 0.035 }
export const worldRainMotion = { slant: 0.19, variation: 0.075, gust: 0.09, gustCycles: 14, flutter: 0.018, flutterCycles: 91 }
export const rainExtents = { floor: 0.018, middle: [1.9, 25], far: [15, 36] } as const
export const ribbonCorners = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0] as const
const ribbonIndices = [0, 1, 2, 0, 2, 3] as const
const phaseSlack = 0.00002
const positionSlack = 0.002
const fallSpeed = terminalSpeed(0.003)
const { slant, variation, gust, gustCycles, flutter, flutterCycles } = worldRainMotion
const horizontalSpeed = (slant + variation) * fallSpeed +
  2 * Math.PI * (gust * gustCycles + flutter * flutterCycles) / config.film.durationSeconds
const driftReach = Math.hypot(...prevailingWind) * (gust + flutter)
const shutterReach = Math.hypot(horizontalSpeed * Math.hypot(...prevailingWind), fallSpeed) * shutterSeconds / 2

export class WorldRibbonSelection {
  readonly geometry = new THREE.BufferGeometry()
  private readonly index: THREE.BufferAttribute
  private readonly centers: Float32Array
  private readonly modelView = new THREE.Matrix4()
  private readonly viewProjection = new THREE.Matrix4()
  private readonly eye = new THREE.Vector3()
  private readonly planes = new Float64Array(20)
  private phase = -1

  constructor(
    private readonly drops: Float32Array,
    private readonly motion: Float32Array,
    private readonly size: THREE.Vector3,
    private readonly center: THREE.Vector3,
    private readonly extent: readonly [number, number],
  ) {
    const count = drops.length / 4
    this.centers = new Float32Array(count * 3)
    const corners = new Float32Array(count * 12)
    const expandedDrops = new Float32Array(count * 16)
    const expandedMotion = new Float32Array(count * 16)
    const indices = new Uint32Array(count * 6)
    for (let i = 0; i < count; i++) {
      const drop = drops.subarray(i * 4, i * 4 + 4)
      const movement = motion.subarray(i * 4, i * 4 + 4)
      corners.set(ribbonCorners, i * 12)
      for (let v = 0; v < 4; v++) {
        expandedDrops.set(drop, i * 16 + v * 4)
        expandedMotion.set(movement, i * 16 + v * 4)
      }
      for (let j = 0; j < 6; j++) indices[i * 6 + j] = i * 4 + ribbonIndices[j]
    }
    this.index = new THREE.BufferAttribute(indices, 1).setUsage(THREE.DynamicDrawUsage)
    this.geometry.setIndex(this.index)
    this.geometry.setAttribute('position', new THREE.BufferAttribute(corners, 3))
    this.geometry.setAttribute('aDrop', new THREE.BufferAttribute(expandedDrops, 4))
    this.geometry.setAttribute('aMotion', new THREE.BufferAttribute(expandedMotion, 4))
    this.geometry.setDrawRange(0, indices.length)
  }

  private prepare(phase: number): void {
    if (this.phase === phase) return
    this.phase = phase
    const { centers, drops, motion, size, center } = this
    for (let i = 0, j = 0; i < drops.length; i += 4, j += 3) {
      const falls = drops[i + 1] - phase * motion[i]
      const cycle = falls - Math.floor(falls)
      const localY = (cycle - 0.5) * motion[i + 1]
      const drift = -(slant + motion[i + 3] * variation) * localY
      centers[j] = center.x + drops[i] * size.x + prevailingWind[0] * drift
      centers[j + 1] = Math.min(cycle, 1 - cycle) < phaseSlack ? NaN : center.y + localY
      centers[j + 2] = center.z + drops[i + 2] * size.z + prevailingWind[1] * drift
    }
  }

  select(camera: THREE.Camera, world: THREE.Matrix4, opticalEye: THREE.Vector3 | undefined, shift: THREE.Vector2, focus: number, phase: number): void {
    this.prepare(phase)
    const matrix = this.viewProjection.multiplyMatrices(camera.projectionMatrix, this.modelView.multiplyMatrices(camera.matrixWorldInverse, world)).elements
    const eye = opticalEye ?? this.eye.setFromMatrixPosition(camera.matrixWorld)
    const near2 = Math.max(0, this.extent[0] - driftReach - positionSlack) ** 2
    const far2 = (this.extent[1] + driftReach + positionSlack) ** 2
    const clipDrift = driftReach + shutterReach + positionSlack
    this.plane(0, matrix, 0, 0, 1, -clipBounds.near, clipDrift)
    const dx = shift.x * camera.projectionMatrix.elements[0]
    const dy = shift.y * camera.projectionMatrix.elements[5]
    this.plane(4, matrix, 0, 1, clipBounds.x - dx / focus, dx, clipDrift)
    this.plane(8, matrix, 0, -1, clipBounds.x + dx / focus, -dx, clipDrift)
    this.plane(12, matrix, 1, 1, clipBounds.y - dy / focus, dy, clipDrift)
    this.plane(16, matrix, 1, -1, clipBounds.y + dy / focus, -dy, clipDrift)

    const { centers, planes, index } = this
    const indices = index.array as Uint32Array
    let written = 0
    drops: for (let i = 0, vertex = 0; i < centers.length; i += 3, vertex += 4) {
      const x = centers[i], y = centers[i + 1], z = centers[i + 2]
      if (y < rainExtents.floor - positionSlack) continue
      const d2 = (eye.x - x) ** 2 + (eye.y - y) ** 2 + (eye.z - z) ** 2
      if (d2 < near2 || d2 > far2) continue
      for (let p = 0; p < planes.length; p += 4) {
        if (planes[p] * x + planes[p + 1] * y + planes[p + 2] * z + planes[p + 3] < 0) continue drops
      }
      for (const corner of ribbonIndices) indices[written++] = vertex + corner
    }
    this.geometry.setDrawRange(0, written)
    if (written) {
      index.clearUpdateRanges()
      index.addUpdateRange(0, written)
      index.needsUpdate = true
    }
  }

  private plane(i: number, matrix: THREE.Matrix4Tuple, axis: number, sign: number, w: number, offset: number, reach: number): void {
    const x = sign * matrix[axis] + w * matrix[3]
    const y = sign * matrix[axis + 4] + w * matrix[7]
    const z = sign * matrix[axis + 8] + w * matrix[11]
    this.planes[i] = x
    this.planes[i + 1] = y
    this.planes[i + 2] = z
    this.planes[i + 3] = sign * matrix[axis + 12] + w * matrix[15] + offset + reach * Math.hypot(x, y, z)
  }
}
