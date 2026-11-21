import type * as THREE from 'three'
import { MeshBuilder } from '../geom/mesh'
import { lathe } from '../geom/shapes'

/** Wheel arch liner: an open drum round the wheel, left side. */
export function liner(z: number, y: number, r: number, x0: number, x1: number): THREE.BufferGeometry {
  const b = new MeshBuilder()
  const a0 = Math.asin(Math.min(1, (y - 0.14) / r))
  lathe(b, [
    [r, x1],
    [r * 1.02, (x0 + x1) / 2],
    [r * 0.98, x0],
    [0.002, x0],
  ], 64, undefined, -a0, Math.PI + a0)
  const g = b.geometry()
  g.translate(0, y, z)
  return g
}
