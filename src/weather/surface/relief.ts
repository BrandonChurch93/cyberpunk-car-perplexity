import * as THREE from 'three'
import { stream } from '../../core/random'

/** A depression in the deck in world X and Z. Depth in millimeters below the surrounding relief. */
export interface Basin {
  center: THREE.Vector2
  /** Unit vector of the long axis. */
  axis: THREE.Vector2
  halfLength: number
  halfWidth: number
  depthMm: number
}

export interface ReliefSpec {
  bounds: THREE.Box2
  basins: Basin[]
  /** Raised areas where no water should stand, such as under the vehicle. */
  keepDry: THREE.Box2[]
}

const lattice = 64

class PeriodicLattice {
  private readonly values: Float32Array

  constructor(name: string) {
    const rng = stream(name)
    this.values = new Float32Array(lattice * lattice)
    for (let i = 0; i < this.values.length; i++) this.values[i] = rng.next()
  }

  at(x: number, y: number): number {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const fx = x - xi
    const fy = y - yi
    const ux = fx * fx * (3 - 2 * fx)
    const uy = fy * fy * (3 - 2 * fy)
    const v = (i: number, j: number): number => this.values[(((j % lattice) + lattice) % lattice) * lattice + (((i % lattice) + lattice) % lattice)]
    const a = v(xi, yi)
    const b = v(xi + 1, yi)
    const c = v(xi, yi + 1)
    const d = v(xi + 1, yi + 1)
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
  }
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Synthetic deck relief in millimeters for a world that has no height map. The water line is at 0. */
export class SyntheticRelief {
  private readonly broad = new PeriodicLattice('surface-relief-broad')
  private readonly mid = new PeriodicLattice('surface-relief-mid')
  private readonly edge = new PeriodicLattice('surface-relief-edge')

  constructor(readonly spec: ReliefSpec) {}

  heightMm(x: number, z: number): number {
    let h = 1.4
    h += 3.4 * (this.broad.at(x / 4.2, z / 4.2) - 0.5) + 1.6 * (this.broad.at(x / 1.9 + 17.3, z / 1.9 + 5.1) - 0.5)
    h += 0.7 * (this.mid.at(x / 0.55, z / 0.55) - 0.5)
    for (const b of this.spec.basins) {
      const dx = x - b.center.x
      const dz = z - b.center.y
      const u = (dx * b.axis.x + dz * b.axis.y) / b.halfLength
      const v = (-dx * b.axis.y + dz * b.axis.x) / b.halfWidth
      const wobble = 0.22 * (this.edge.at(x / 0.9 + 3.7, z / 0.9 + 1.3) - 0.5) + 0.1 * (this.edge.at(x / 0.31, z / 0.31) - 0.5)
      const q = Math.sqrt(u * u + v * v) + wobble
      h -= b.depthMm * (1 - smooth(0.25, 1.15, q))
    }
    for (const box of this.spec.keepDry) {
      const ox = Math.max(box.min.x - x, 0, x - box.max.x)
      const oz = Math.max(box.min.y - z, 0, z - box.max.y)
      const outside = Math.hypot(ox, oz)
      h += 4 * (1 - smooth(0, 0.6, outside))
    }
    return h
  }

  /** Bakes the relief into a half float texture over the spec's bounds, in millimeters. */
  bake(size: number): THREE.DataTexture {
    const data = new Uint16Array(size * size)
    const b = this.spec.bounds
    for (let j = 0; j < size; j++) {
      const z = b.min.y + ((j + 0.5) / size) * (b.max.y - b.min.y)
      for (let i = 0; i < size; i++) {
        const x = b.min.x + ((i + 0.5) / size) * (b.max.x - b.min.x)
        data[j * size + i] = THREE.DataUtils.toHalfFloat(this.heightMm(x, z))
      }
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.HalfFloatType)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
    texture.colorSpace = THREE.NoColorSpace
    texture.generateMipmaps = false
    texture.needsUpdate = true
    return texture
  }
}

/**
 * The long shallow puddle of the opening frame lies between the vehicle and the opening camera, across the line of sight,
 * so that from a lens 0.2 m above the deck it mirrors the vehicle and the city behind it.
 */
export function heroBasin(vehicleCenter: THREE.Vector2, camera: THREE.Vector2): Basin {
  const toCamera = camera.clone().sub(vehicleCenter)
  const distance = toCamera.length()
  const dir = toCamera.normalize()
  return {
    center: vehicleCenter.clone().addScaledVector(dir, Math.min(3.7, distance * 0.55)),
    axis: new THREE.Vector2(-dir.y, dir.x),
    halfLength: 2.5,
    halfWidth: 1.05,
    depthMm: 5.5,
  }
}
