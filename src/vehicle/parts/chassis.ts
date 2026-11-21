import type * as THREE from 'three'
import { MeshBuilder } from '../geom/mesh'
import { blob, extrude, lathe, roundRect, sweep } from '../geom/shapes'
import { lerp3, norm, type V2, type V3 } from '../geom/vec'
import { dims } from '../body/shape'

/** Floor pan between the axles, with notches round the wheels, left half. */
export function floor(): THREE.BufferGeometry {
  const b = new MeshBuilder()
  const y = 0.125
  const fz = dims.frontHubZ
  const rz = dims.rearHubZ
  const outline: V2[] = [
    [0, 2.3],
    [0.5, 2.25],
    [0.62, fz + 0.5],
    [0.66, fz + 0.42],
    [0.66, fz - 0.42],
    [0.93, fz - 0.5],
    [0.95, rz + 0.5],
    [0.66, rz + 0.44],
    [0.66, -1.78],
    [0, -1.78],
  ]
  extrude(
    b,
    outline.map(([x, z]): V2 => [x, -z]),
    [0, y - 0.01, 0],
    [1, 0, 0],
    [0, 0, -1],
    [0, 1, 0],
    0.01,
  )
  return b.geometry()
}

/** Diffuser roof rising to the tail and four vertical fins, left half. */
export function diffuser(zTail: number): { roof: THREE.BufferGeometry; fins: THREE.BufferGeometry } {
  const roof = new MeshBuilder()
  const z0 = -1.78
  const z1 = zTail + 0.02
  const yAt = (z: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (z0 - z) / (z0 - z1)))
    return 0.125 + (0.34 - 0.125 + 0.03 * Math.min(1, x / 0.9)) * t * (0.6 + 0.4 * t)
  }
  const nx = 18
  const nz = 24
  roof.grid(nz + 1, nx + 1, (i, j) => {
    const z = z0 + ((z1 - z0) * i) / nz
    const x = (0.9 * j) / nx
    return { p: [x, yAt(z, x), z], n: [0, -1, 0] }
  }, false, true)
  const fins = new MeshBuilder()
  for (const [x, slant] of [
    [0.4225, 0],
    [0.65, 0.06],
  ] as const) {
    const pts: V2[] = []
    const n = 12
    for (let i = 0; i <= n; i++) {
      const z = z0 + 0.15 + ((z1 - z0 - 0.15) * i) / n
      pts.push([z, yAt(z, x) + 0.01])
    }
    for (let i = n; i >= 0; i--) {
      const z = z0 + 0.15 + ((z1 - z0 - 0.15) * i) / n
      const depth = 0.01 + 0.24 * ((z0 + 0.15 - z) / (z0 + 0.15 - z1)) ** 1.2
      pts.push([z, Math.max(0.13, yAt(z, x) - depth)])
    }
    const g = new MeshBuilder()
    extrude(g, pts.map(([z, y]): V2 => [z, y]), [x - 0.005, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0], 0.01)
    for (let i = 0; i < g.pos.length; i += 3) {
      const y = g.pos[i + 1]
      g.pos[i] += slant * (0.5 - y) * (y < 0.5 ? 1 : 0)
    }
    const base = fins.pos.length / 3
    fins.pos.push(...g.pos)
    fins.nor.push(...g.nor)
    fins.uv.push(...g.uvs())
    for (const k of g.idx) fins.idx.push(base + k)
  }
  return { roof: roof.geometry(), fins: fins.geometry() }
}

/** Front splitter lip under the nose, left half, following the face's lower edge. */
export function splitter(edge: V3[]): THREE.BufferGeometry {
  const b = new MeshBuilder()
  const path = edge.map((p): V3 => [p[0], 0.128, p[2] - 0.02])
  const ups = path.map((): V3 => [0, 1, 0])
  sweep(b, path, ups, roundRect(0.06, 0.02, 0.006, 3))
  return b.geometry()
}

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
