import type * as THREE from 'three'
import { MeshBuilder } from '../geom/mesh'
import { extrude, roundRect, sweep } from '../geom/shapes'
import { add, cross, norm, scale, type V2, type V3 } from '../geom/vec'

export interface Cabin {
  leather: THREE.BufferGeometry
  trim: THREE.BufferGeometry
  carbon: THREE.BufferGeometry
  screens: THREE.BufferGeometry
}

/**
 * Unwelds a mesh and maps each triangle in metres onto the plane its own face normal faces most, so the carbon weave has a
 * tangent frame with u and v well apart on every face; the welded box projection mixes planes across rounded corners.
 */
function faceMapped(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.toNonIndexed()
  const P = out.getAttribute('position')
  const uv = out.getAttribute('uv')
  for (let i = 0; i < P.count; i += 3) {
    const e1 = [0, 1, 2].map((k) => P.getComponent(i + 1, k) - P.getComponent(i, k))
    const e2 = [0, 1, 2].map((k) => P.getComponent(i + 2, k) - P.getComponent(i, k))
    const n = [Math.abs(e1[1] * e2[2] - e1[2] * e2[1]), Math.abs(e1[2] * e2[0] - e1[0] * e2[2]), Math.abs(e1[0] * e2[1] - e1[1] * e2[0])]
    const [a, b] = n[0] >= n[1] && n[0] >= n[2] ? [2, 1] : n[1] >= n[2] ? [0, 2] : [0, 1]
    for (let j = i; j < i + 3; j++) uv.setXY(j, P.getComponent(j, a), P.getComponent(j, b))
  }
  g.dispose()
  return out
}

/** Winds every triangle to face the way its vertex normals point. */
export function orient(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const P = g.getAttribute('position')
  const N = g.getAttribute('normal')
  const ix = g.index
  if (!ix) return g
  for (let t = 0; t < ix.count; t += 3) {
    const a = ix.getX(t)
    const b = ix.getX(t + 1)
    const c = ix.getX(t + 2)
    const e1 = [P.getX(b) - P.getX(a), P.getY(b) - P.getY(a), P.getZ(b) - P.getZ(a)]
    const e2 = [P.getX(c) - P.getX(a), P.getY(c) - P.getY(a), P.getZ(c) - P.getZ(a)]
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    let s = 0
    for (let i = 0; i < 3; i++) s += n[i] * (N.getComponent(a, i) + N.getComponent(b, i) + N.getComponent(c, i))
    if (s < 0) {
      ix.setX(t + 1, c)
      ix.setX(t + 2, b)
    }
  }
  return g
}

const ccw = (o: V2[]): V2[] => {
  let a = 0
  for (let i = 0; i < o.length; i++) {
    const p = o[i]
    const q = o[(i + 1) % o.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a < 0 ? [...o].reverse() : o
}

/** A side profile in (z, y) extruded across the car from x0 to x1. */
function slab(b: MeshBuilder, zy: V2[], x0: number, x1: number): void {
  extrude(b, ccw(zy), [x1, 0, 0], [0, 0, 1], [0, 1, 0], [-1, 0, 0], x1 - x0)
}

/** A cross section in (x, y) extruded along the car from z0 to z1. */
function bar(b: MeshBuilder, xy: V2[], z0: number, z1: number): void {
  extrude(b, ccw(xy), [0, 0, z0], [1, 0, 0], [0, 1, 0], [0, 0, 1], z1 - z0)
}

const rounded = (x: number, y: number, w: number, h: number, r: number): V2[] => roundRect(w, h, r, 3).map(([a, c]): V2 => [a + x, c + y])

function seat(leather: MeshBuilder, trim: MeshBuilder, x: number): void {
  const cushion: V2[] = [[0.27, 0.2], [0.28, 0.33], [0.2, 0.35], [-0.12, 0.3], [-0.22, 0.29], [-0.22, 0.2]]
  const back: V2[] = [[-0.16, 0.27], [-0.31, 0.83], [-0.3, 0.96], [-0.36, 1.0], [-0.44, 0.97], [-0.45, 0.82], [-0.3, 0.24]]
  slab(leather, cushion, x - 0.17, x + 0.17)
  slab(leather, back, x - 0.15, x + 0.15)
  const bolster: V2[] = [[-0.1, 0.27], [-0.25, 0.8], [-0.36, 0.83], [-0.42, 0.78], [-0.3, 0.22]]
  const thigh: V2[] = [[0.25, 0.2], [0.27, 0.38], [0.15, 0.4], [-0.2, 0.34], [-0.2, 0.2]]
  for (const s of [-1, 1]) {
    slab(leather, bolster, x + s * 0.2 - 0.045, x + s * 0.2 + 0.045)
    slab(leather, thigh, x + s * 0.205 - 0.04, x + s * 0.205 + 0.04)
  }
  slab(trim, [[-0.36, 0.15], [-0.36, 0.22], [0.2, 0.22], [0.2, 0.15]], x - 0.2, x + 0.2)
}

function hub(b: MeshBuilder, c: V3, r: V3, e: number, rows: number, cols: number): void {
  const sp = (x: number): number => Math.sign(x) * Math.abs(x) ** e
  const at = (v: number, u: number): number => {
    const d: V3 = [sp(Math.cos(v)) * sp(Math.cos(u)), sp(Math.sin(v)), sp(Math.cos(v)) * sp(Math.sin(u))]
    return b.vertex([c[0] + r[0] * d[0], c[1] + r[1] * d[1], c[2] + r[2] * d[2]], norm([d[0] / r[0], d[1] / r[1], d[2] / r[2]]))
  }
  const south = b.vertex([c[0], c[1] - r[1], c[2]], [0, -1, 0])
  const north = b.vertex([c[0], c[1] + r[1], c[2]], [0, 1, 0])
  const ring: number[][] = []
  for (let i = 1; i < rows; i++) {
    const v = -Math.PI / 2 + (Math.PI * i) / rows
    ring.push(Array.from({ length: cols }, (_, j) => at(v, (2 * Math.PI * j) / cols)))
  }
  for (let j = 0; j < cols; j++) {
    const k = (j + 1) % cols
    b.tri(south, ring[0][k], ring[0][j])
    b.tri(north, ring[ring.length - 1][j], ring[ring.length - 1][k])
    for (let i = 0; i + 1 < ring.length; i++) {
      b.tri(ring[i][j], ring[i][k], ring[i + 1][k])
      b.tri(ring[i][j], ring[i + 1][k], ring[i + 1][j])
    }
  }
}

function steering(leather: MeshBuilder, carbon: MeshBuilder, c: V3, n: V3): void {
  const up = norm([0, 1, 0])
  const e1 = norm(cross(up, n))
  const e2 = norm(cross(n, e1))
  const at = (a: number, r: number, d = 0): V3 => {
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const k = Math.min(1, 0.155 / Math.max(1e-6, Math.abs(r * sa)))
    return add(add(add(c, scale(e1, r * ca)), scale(e2, r * sa * k)), scale(n, d))
  }
  const path: V3[] = []
  const ups: V3[] = []
  for (let i = 0; i < 48; i++) {
    const a = (2 * Math.PI * i) / 48
    path.push(at(a, 0.18))
    ups.push(n)
  }
  sweep(leather, path, ups, roundRect(0.03, 0.026, 0.011, 3), true)
  hub(carbon, c, [0.06, 0.05, 0.025], 0.4, 10, 20)
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const p: V3[] = [at(a, 0.04, 0.005), at(a, 0.17, 0.005)]
    sweep(carbon, p, [n, n], roundRect(0.045, 0.012, 0.005, 2))
  }
  const column: V3[] = [add(c, scale(n, 0.03)), add(c, scale(n, 0.3))]
  sweep(carbon, column, [e2, e2], roundRect(0.07, 0.07, 0.025, 3))
}

/**
 * The parts of the cabin that read through the glass, in the body frame (x left, y up, z forward), at real size: two shell
 * seats, the dash with its cluster hood, the center frame and tunnel, the floor, the rear bulkhead and a steering wheel
 * on the left.
 */
export function cabin(): Cabin {
  const leather = new MeshBuilder()
  const trim = new MeshBuilder()
  const carbon = new MeshBuilder()
  const screens = new MeshBuilder()
  slab(trim, [[-0.52, 0.12], [-0.52, 0.16], [1.3, 0.16], [1.3, 0.12]], -0.8, 0.8)
  const wall: V2[] = [[-0.84, 0.14], [0.84, 0.14], [0.84, 0.78], [0.78, 0.88], [0.66, 0.98], [0.5, 1.07], [0, 1.1], [-0.5, 1.07], [-0.66, 0.98], [-0.78, 0.88], [-0.84, 0.78]]
  bar(trim, wall, -0.56, -0.49)
  const dash: V2[] = [[0.64, 0.42], [0.58, 0.6], [0.6, 0.74], [0.68, 0.79], [0.95, 0.81], [1.3, 0.79], [1.34, 0.42]]
  slab(trim, dash, -0.8, 0.8)
  slab(trim, [[0.6, 0.79], [0.6, 0.85], [0.7, 0.86], [0.78, 0.81]], 0.24, 0.5)
  slab(screens, [[0.605, 0.795], [0.605, 0.84], [0.612, 0.84], [0.612, 0.795]], 0.26, 0.48)
  bar(carbon, rounded(0, 0.29, 0.24, 0.3, 0.04), -0.32, 0.62)
  slab(carbon, [[0.58, 0.42], [0.55, 0.62], [0.61, 0.76], [0.66, 0.74], [0.63, 0.42]], -0.09, 0.09)
  slab(screens, [[0.565, 0.5], [0.548, 0.63], [0.553, 0.632], [0.571, 0.5]], -0.07, 0.07)
  slab(screens, [[0.62, 0.68], [0.6, 0.74], [0.606, 0.742], [0.626, 0.682]], -0.42, -0.2)
  seat(leather, trim, 0.37)
  seat(leather, trim, -0.37)
  steering(leather, carbon, [0.37, 0.64, 0.4], norm([0, 0.42, -1]))
  return { leather: orient(leather.geometry()), trim: orient(trim.geometry()), carbon: faceMapped(orient(carbon.geometry())), screens: orient(screens.geometry()) }
}
