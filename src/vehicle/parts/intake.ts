import * as THREE from 'three'
import { surfaceNormal } from '../body/body'
import { orient } from './cabin'
import type { Surface, SurfaceCurve } from '../geom/cuts'
import { MeshBuilder } from '../geom/mesh'
import { add, addScaled, cross, dot, lerp3, norm, scale, sub, type V2, type V3 } from '../geom/vec'

export interface ThroatSpec {
  /** Depth of the paint flange the return starts from. */
  flange: number
  depth: number
  taper: number
  /** Rearward shift of the back of the throat. */
  back: number
  louvres: number
  /** Gap from the paint edge to a separate vent insert frame, none when absent. */
  frame?: number
}

export const sideIntake: ThroatSpec = { flange: 0.013, depth: 0.13, taper: 0.74, back: 0.07, louvres: 7 }
export const upperIntake: ThroatSpec = { flange: 0.013, depth: 0.08, taper: 0.7, back: 0.035, louvres: 3, frame: 0.0035 }

export interface Throat {
  wall: THREE.BufferGeometry
  core: THREE.BufferGeometry
  louvres: THREE.BufferGeometry
}

/**
 * A recessed duct behind a closed opening of the left flank: a wall that leaves the paint flange square to the skin and
 * turns into a tapered throat, closed at the back by a dark core with louvres in front of it.
 */
export function throat(S: Surface, c: SurfaceCurve, spec: ThroatSpec): Throat {
  const L = c.p
  const N = c.uv.map(([u, v]) => surfaceNormal(S, u, v))
  const m = L.length
  let center: V3 = [0, 0, 0]
  let nbar: V3 = [0, 0, 0]
  for (let i = 0; i < m; i++) {
    center = add(center, scale(L[i], 1 / m))
    nbar = add(nbar, N[i])
  }
  nbar = norm(nbar)
  const shift: V3 = [0, 0, -spec.back]
  const Q = L.map((p) => add(add(add(center, scale(sub(p, center), spec.taper)), scale(nbar, -spec.depth)), shift))
  const rings = 10
  const wall = new MeshBuilder()
  wall.grid(rings + 1, m, (i, j) => {
    const t = i / rings
    const a = addScaled(L[j], N[j], -spec.flange)
    const b = addScaled(a, N[j], -spec.depth * 0.45)
    const p = lerp3(lerp3(a, b, t), lerp3(b, Q[j], t), t)
    return { p, n: N[j] }
  }, true)
  const wg = wall.geometry()
  wg.computeVertexNormals()

  const e1 = norm(cross([0, 1, 0], nbar))
  const e2 = norm(cross(nbar, e1))
  const qc = Q.reduce<V3>((s, q) => add(s, scale(q, 1 / m)), [0, 0, 0])
  const flat: V2[] = Q.map((q) => [dot(sub(q, qc), e1), dot(sub(q, qc), e2)])
  const core = new MeshBuilder()
  const back = addScaled(qc, nbar, -0.002)
  const ids = flat.map((f) => core.vertex(add(add(back, scale(e1, f[0])), scale(e2, f[1])), nbar))
  for (const [x, y, z] of THREE.ShapeUtils.triangulateShape(flat.map((f) => new THREE.Vector2(f[0], f[1])), [])) {
    const k = (flat[y][0] - flat[x][0]) * (flat[z][1] - flat[x][1]) - (flat[y][1] - flat[x][1]) * (flat[z][0] - flat[x][0])
    if (k > 0) core.tri(ids[x], ids[y], ids[z])
    else core.tri(ids[x], ids[z], ids[y])
  }

  const louvres = new MeshBuilder()
  let lo = Infinity
  let hi = -Infinity
  for (const f of flat) {
    lo = Math.min(lo, f[1])
    hi = Math.max(hi, f[1])
  }
  const pitch = (hi - lo) / (spec.louvres + 1)
  for (let k = 1; k <= spec.louvres; k++) {
    const y = lo + k * pitch
    let x0 = Infinity
    let x1 = -Infinity
    for (let i = 0; i < m; i++) {
      const a = flat[i]
      const b = flat[(i + 1) % m]
      if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue
      const x = a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0])
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
    }
    if (!(x1 - x0 > 0.02)) continue
    const blade = 0.6 * pitch
    const o = add(add(qc, scale(e2, y)), scale(nbar, 0.004))
    const P = (x: number, s: number, d: number): V3 => add(add(add(o, scale(e1, x)), scale(e2, s * 0.5 * blade)), scale(nbar, d - s * 0.35 * blade))
    const corners: V3[] = [P(x0, -1, 0), P(x1, -1, 0), P(x1, 1, 0), P(x0, 1, 0), P(x0, -1, 0.004), P(x1, -1, 0.004), P(x1, 1, 0.004), P(x0, 1, 0.004)]
    const faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [3, 2, 6, 7], [1, 5, 6, 2], [0, 3, 7, 4]]
    for (const f of faces) {
      const q = f.map((i) => corners[i])
      const n = norm(cross(sub(q[1], q[0]), sub(q[3], q[0])))
      const ii = q.map((p) => louvres.vertex(p, n))
      louvres.quad(ii[0], ii[1], ii[2], ii[3])
    }
  }
  if (spec.frame !== undefined) insert(louvres, L, N, center, spec.frame)
  return { wall: orient(wg), core: orient(core.geometry()), louvres: orient(louvres.geometry()) }
}

/** A vent insert frame inside a closed opening: an outer wall `gap` in from the paint edge, a rounded top a little under
 * the skin and an inner wall that drops into the duct, smoothed normals smoothed so the corners keep an even radius. */
function insert(b: MeshBuilder, L: V3[], N: V3[], center: V3, gap: number): void {
  const m = L.length
  const smooth = (a: V3[]): V3[] => a.map((_, i) => scale(add(add(a[(i - 1 + m) % m], a[(i + 1) % m]), scale(a[i], 2)), 0.25))
  const P = L
  let Q = N
  for (let k = 0; k < 3; k++) Q = smooth(Q).map(norm)
  const D = P.map((p, i) => {
    const t = sub(P[(i + 1) % m], P[(i - 1 + m) % m])
    let d = norm(cross(Q[i], t))
    if (dot(d, sub(center, p)) < 0) d = scale(d, -1)
    return d
  })
  const r = 0.0016
  const w = 0.0062
  const top = -0.0022
  const prof: [number, number, number, number][] = [[0, -0.011, -1, 0], [0, top - r, -1, 0]]
  for (let k = 1; k < 4; k++) {
    const a = (k / 4) * (Math.PI / 2)
    prof.push([r - r * Math.cos(a), top - r + r * Math.sin(a), -Math.cos(a), Math.sin(a)])
  }
  prof.push([r, top, 0, 1], [w - r, top, 0, 1])
  for (let k = 1; k < 4; k++) {
    const a = (k / 4) * (Math.PI / 2)
    prof.push([w - r + r * Math.sin(a), top - r + r * Math.cos(a), Math.sin(a), Math.cos(a)])
  }
  prof.push([w, top - r, 1, 0], [w, -0.016, 1, 0])
  b.grid(prof.length, m, (i, j) => {
    const [x, y, nx, ny] = prof[i]
    return { p: add(add(P[j], scale(D[j], gap + x)), scale(Q[j], y)), n: norm(add(scale(D[j], nx), scale(Q[j], ny))) }
  }, true)
}
