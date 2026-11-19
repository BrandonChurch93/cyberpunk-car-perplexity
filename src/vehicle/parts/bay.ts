import type * as THREE from 'three'
import type { SurfaceCurve } from '../geom/cuts'
import { MeshBuilder } from '../geom/mesh'
import { blob, extrude, roundRect, sweep } from '../geom/shapes'
import { lerp3, type V2, type V3 } from '../geom/vec'

export interface Bay {
  tub: THREE.BufferGeometry
  covers: THREE.BufferGeometry
  carbon: THREE.BufferGeometry
  /** Parts on the center line, not mirrored. */
  center: THREE.BufferGeometry
  mesh: THREE.BufferGeometry
  /** Center of the hex mesh panel, on its top face. */
  meshCenter: V3
}

const floorY = 0.7

/** Left half of the open engine bay, built inside the opening `edge`. */
export function bay(edge: SurfaceCurve, cell: number): Bay {
  const rim = edge.p.filter((p) => p[0] > 0.004).sort((a, b) => b[2] - a[2])
  const zf = rim[0][2]
  const zr = rim[rim.length - 1][2]
  const widthAt = (z: number): { x: number; y: number } => {
    let best = rim[0]
    for (const p of rim) if (Math.abs(p[2] - z) < Math.abs(best[2] - z)) best = p
    return { x: best[0], y: best[1] }
  }
  const tub = new MeshBuilder()
  const nz = 40
  const ns = 16
  tub.grid(nz + 1, ns + 1, (i, j) => {
    const z = zf + 0.02 + ((zr - zf - 0.04) * i) / nz
    const w = widthAt(z)
    const s = j / ns
    let p: V3
    if (s < 0.7) p = [(w.x + 0.01) * (s / 0.7), floorY, z]
    else {
      const t = (s - 0.7) / 0.3
      p = [w.x + 0.01, floorY + (w.y - 0.03 - floorY) * t, z]
    }
    return { p, n: s < 0.7 ? [0, 1, 0] : [-1, 0, 0] }
  }, false, true)
  for (const [zEnd, sign] of [
    [zf + 0.02, 1],
    [zr - 0.02, -1],
  ] as const) {
    const w = widthAt(zEnd)
    const top = w.y - 0.03
    tub.grid(2, 2, (i, j) => ({ p: [j * (w.x + 0.01), i === 0 ? floorY : top, zEnd], n: [0, 0, -sign] }), false, sign > 0)
  }
  const covers = new MeshBuilder()
  const zc = (zf + zr) / 2
  const len = (zf - zr) * 0.42
  blob(covers, [0.26, floorY + 0.12, zc - 0.03], [0.085, 0.06, len], 0.35, 12, 24)
  for (let k = 0; k < 12; k++) {
    const z = zc - 0.03 - len * 0.8 + (k * len * 1.6) / 11
    const rib: V3[] = []
    for (let i = 0; i <= 6; i++) {
      const x = 0.2 + (0.12 * i) / 6
      rib.push([x, floorY + 0.12 + 0.06 * Math.sqrt(Math.max(0, 1 - ((x - 0.26) / 0.085) ** 2)) - 0.004, z])
    }
    sweep(covers, rib, rib.map((): V3 => [0, 1, 0]), roundRect(0.008, 0.01, 0.002, 1))
  }
  const carbon = new MeshBuilder()
  const center = new MeshBuilder()
  blob(center, [0, floorY + 0.15, zc + 0.02], [0.1, 0.07, len * 1.05], 0.3, 12, 24)
  const bar = (a: V3, b: V3): void => {
    const pts: V3[] = []
    for (let i = 0; i <= 10; i++) pts.push(lerp3(a, b, i / 10))
    sweep(carbon, pts, pts.map((): V3 => [0, 1, 0]), roundRect(0.05, 0.018, 0.006, 3))
  }
  const wf = widthAt(zf - 0.12)
  const wr = widthAt(zr + 0.12)
  const yc = floorY + 0.28
  const mid: V3 = [0, yc, zc]
  bar([wf.x - 0.01, wf.y - 0.035, zf - 0.12], mid)
  bar(mid, [wr.x - 0.01, wr.y - 0.035, zr + 0.12])
  blob(center, mid, [0.05, 0.014, 0.05], 0.4, 6, 16)
  for (let k = 0; k < 5; k++) {
    const pts: V3[] = []
    for (let i = 0; i <= 16; i++) {
      const z = zf - 0.15 + ((zr - zf + 0.35) * i) / 16
      const w = widthAt(z)
      pts.push([w.x - 0.02 - k * 0.028, w.y - 0.05 - k * 0.035, z])
    }
    sweep(carbon, pts, pts.map((): V3 => [-0.5, 1, 0]), roundRect(0.03, 0.004, 0.0015, 1))
  }
  const mesh = new MeshBuilder()
  const mz0 = zr + 0.03
  const mz1 = zr + 0.26
  const my = floorY + 0.2
  hexLattice(mesh, [0, my, (mz0 + mz1) / 2], Math.min(0.3, wr.x - 0.04), (mz1 - mz0) / 2, cell)
  return { tub: tub.geometry(), covers: covers.geometry(), carbon: carbon.geometry(), center: center.geometry(), mesh: mesh.geometry(), meshCenter: [0.0, my + 0.004, (mz0 + mz1) / 2] }
}

/** A flat hexagonal lattice of real bars in the XZ plane, x within `hx` and z within `hz` of the center. */
export function hexLattice(b: MeshBuilder, c: V3, hx: number, hz: number, cell: number): void {
  const bar = cell * 0.16
  const t = 0.004
  const r = cell / Math.sqrt(3)
  const dz = cell
  const dx = r * 1.5
  for (let i = -Math.ceil(hx / dx) - 1; i * dx <= hx + r; i++) {
    for (let j = -Math.ceil(hz / dz) - 1; j * dz <= hz + dz; j++) {
      const x = i * dx
      const z = c[2] + j * dz + (Math.abs(i) % 2 ? dz / 2 : 0)
      if (Math.abs(z - c[2]) > hz - r * 0.5 || Math.abs(x) > hx - r * 0.5) continue
      const outer: V2[] = []
      const inner: V2[] = []
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3
        outer.push([x + r * Math.cos(a), z + r * Math.sin(a)])
        inner.push([x + (r - bar) * Math.cos(a), z + (r - bar) * Math.sin(a)])
      }
      for (let k = 0; k < 6; k++) {
        const k1 = (k + 1) % 6
        const quad: V2[] = [outer[k], outer[k1], inner[k1], inner[k]]
        extrude(b, quad.map(([qx, qz]): V2 => [qx, -qz]), [0, c[1] - t, 0], [1, 0, 0], [0, 0, -1], [0, 1, 0], t)
      }
    }
  }
}
