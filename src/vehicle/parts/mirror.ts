import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { surfaceNormal } from '../body/body'
import { orient } from './cabin'
import type { Surface, SurfaceMap } from '../geom/cuts'
import { MeshBuilder } from '../geom/mesh'
import { roundRect, sweep } from '../geom/shapes'
import { addScaled, cross, dot, lerp3, norm, sub, type V2, type V3 } from '../geom/vec'

export interface MirrorSpec {
  center: V3
  width: number
  height: number
  root: [number, number]
}

export const mirrorSpec: MirrorSpec = { center: [1.04, 0.875, 0.95], width: 0.22, height: 0.105, root: [1.0, 0.715] }

function roundCorners(poly: V2[], radii: number[], k = 6): V2[] {
  const out: V2[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n]
    const p = poly[i]
    const c = poly[(i + 1) % n]
    const da = Math.hypot(a[0] - p[0], a[1] - p[1])
    const dc = Math.hypot(c[0] - p[0], c[1] - p[1])
    const s = Math.min(radii[i], da / 2.05, dc / 2.05)
    const p0: V2 = [p[0] + ((a[0] - p[0]) * s) / da, p[1] + ((a[1] - p[1]) * s) / da]
    const p1: V2 = [p[0] + ((c[0] - p[0]) * s) / dc, p[1] + ((c[1] - p[1]) * s) / dc]
    for (let j = 0; j <= k; j++) {
      const t = j / k
      const w0 = (1 - t) ** 2
      const w1 = 2 * t * (1 - t)
      const w2 = t * t
      out.push([w0 * p0[0] + w1 * p[0] + w2 * p1[0], w0 * p0[1] + w1 * p[1] + w2 * p1[1]])
    }
  }
  return out
}

function even(o: V2[], count: number): V2[] {
  const n = o.length
  const acc = [0]
  for (let i = 0; i < n; i++) acc.push(acc[i] + Math.hypot(o[(i + 1) % n][0] - o[i][0], o[(i + 1) % n][1] - o[i][1]))
  const out: V2[] = []
  let j = 0
  for (let k = 0; k < count; k++) {
    const d = (k / count) * acc[n]
    while (acc[j + 1] < d) j++
    const t = (d - acc[j]) / (acc[j + 1] - acc[j] || 1)
    const a = o[j]
    const b = o[(j + 1) % n]
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return out
}

function inset(o: V2[], d: number): V2[] {
  const n = o.length
  return o.map((p, i) => {
    const a = o[(i - 1 + n) % n]
    const c = o[(i + 1) % n]
    const tx = c[0] - a[0]
    const ty = c[1] - a[1]
    const l = Math.hypot(tx, ty) || 1
    return [p[0] - (ty / l) * d, p[1] + (tx / l) * d]
  })
}

/** Closed solid from rings of equal length, capped at both ends, wound outward from `c`, with smooth normals. */
function solid(rings: V3[][], c: V3): THREE.BufferGeometry {
  const pos: number[] = []
  const tri = (a: V3, b: V3, d: V3): void => {
    const nrm = cross(sub(b, a), sub(d, a))
    if (Math.hypot(nrm[0], nrm[1], nrm[2]) < 1e-12) return
    const mid: V3 = [(a[0] + b[0] + d[0]) / 3 - c[0], (a[1] + b[1] + d[1]) / 3 - c[1], (a[2] + b[2] + d[2]) / 3 - c[2]]
    pos.push(...(dot(nrm, mid) >= 0 ? [...a, ...b, ...d] : [...a, ...d, ...b]))
  }
  const m = rings[0].length
  for (let k = 0; k + 1 < rings.length; k++) {
    for (let j = 0; j < m; j++) {
      const jn = (j + 1) % m
      tri(rings[k][j], rings[k][jn], rings[k + 1][jn])
      tri(rings[k][j], rings[k + 1][jn], rings[k + 1][j])
    }
  }
  for (const ring of [rings[0], rings[rings.length - 1]]) {
    const t = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), [])
    for (const [x, y, z] of t) tri(ring[x], ring[y], ring[z])
  }
  return indexed(pos)
}

function indexed(pos: number[]): THREE.BufferGeometry {
  const keys = new Map<string, number>()
  const verts: number[] = []
  const index: number[] = []
  for (let i = 0; i < pos.length; i += 3) {
    const key = `${Math.round(pos[i] * 1e6)},${Math.round(pos[i + 1] * 1e6)},${Math.round(pos[i + 2] * 1e6)}`
    let k = keys.get(key)
    if (k === undefined) {
      k = verts.length / 3
      keys.set(key, k)
      verts.push(pos[i], pos[i + 1], pos[i + 2])
    }
    index.push(k)
  }
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

/**
 * The left door mirror: a teardrop wedge head, tall and full inboard and tapering outboard over a crisp lower edge, its
 * front a domed shell that rolls into a small even radius at the rim, its glass set in a narrow bezel facing back, on a
 * thin blade that leaves the door skin just below the glass corner. `S` and `map` are the body's main surface and its map.
 */
export function mirror(S: Surface, map: SurfaceMap, spec: MirrorSpec = mirrorSpec): { head: THREE.BufferGeometry; glass: THREE.BufferGeometry; stalk: THREE.BufferGeometry } {
  const [cx, cy, cz] = spec.center
  const w = spec.width / 2
  const h = spec.height / 2
  const raw: V2[] = [[-w, h * 0.55], [-w * 0.93, -h], [w * 0.95, -h], [w, h * 0.05], [w * 0.6, h * 0.72], [-w * 0.72, h]]
  const outline = even(roundCorners(raw, [0.032, 0.01, 0.012, 0.026, 0.05, 0.04], 10), 60)
  const r = 0.006
  const zb = cz - 0.035
  const apex: V2 = [-w * 0.3, h * 0.18]
  const P = (q: V2, z: number): V3 => [cx + q[0], cy + q[1], z]
  const rings: V3[][] = [
    inset(outline, 0.0085).map((q) => P(q, zb + 0.003)),
    inset(outline, 0.0074).map((q) => P(q, zb + 0.0006)),
  ]
  for (let k = 0; k <= 3; k++) {
    const a = (k / 3) * (Math.PI / 2)
    rings.push(inset(outline, r * (1 - Math.sin(a))).map((q) => P(q, zb + r * (1 - Math.cos(a)))))
  }
  const p = 2.1
  const depth = (q: V2): number => 0.064 - 0.03 * ((q[0] + w) / (2 * w))
  const K = 8
  for (let k = 1; k <= K; k++) {
    const f = (k / K) * (Math.PI / 2) * 0.96
    const rho = Math.cos(f) ** (2 / p)
    const s = Math.sin(f) ** (2 / p)
    const b = rho ** 4
    rings.push(outline.map((q): V3 => {
      const d: V2 = [q[0] - apex[0], q[1] - apex[1]]
      const l = Math.hypot(d[0], d[1])
      const e = 1 / Math.hypot(d[0] / l / (d[0] < 0 ? 0.62 * w : 1.2 * w), d[1] / l / (d[1] > 0 ? 0.7 * h : 1.08 * h))
      const k = (rho * (b * l + (1 - b) * e)) / l
      const t: V2 = [apex[0] + d[0] * k, apex[1] + d[1] * k]
      return P(t, zb + r + depth(t) * s)
    }))
  }
  const turn = new THREE.Matrix4().makeTranslation(cx, cy, cz).multiply(new THREE.Matrix4().makeRotationY(0.1)).multiply(new THREE.Matrix4().makeTranslation(-cx, -cy, -cz))
  const hg = solid(rings, [cx + apex[0], cy + apex[1], zb + 0.02]).applyMatrix4(turn)

  const glass = new MeshBuilder()
  const gl = inset(outline, 0.0085)
  const ids = gl.map((q) => glass.vertex(P(q, zb + 0.0024), [0, 0, -1]))
  for (const [x, y, z] of THREE.ShapeUtils.triangulateShape(gl.map((q) => new THREE.Vector2(q[0], q[1])), [])) {
    const e = cross(sub(P(gl[y], 0), P(gl[x], 0)), sub(P(gl[z], 0), P(gl[x], 0)))
    if (Math.abs(e[2]) < 1e-12) continue
    if (e[2] < 0) glass.tri(ids[x], ids[y], ids[z])
    else glass.tri(ids[x], ids[z], ids[y])
  }
  const gg = glass.geometry().applyMatrix4(turn)

  const [u, v] = map.invert('x', spec.root[0], spec.root[1])
  const foot = S(u, v)
  const n = surfaceNormal(S, u, v)
  const on = (z: number, y: number, h: number): { p: V3; n: V3 } => {
    const [a, b] = map.invert('x', z, y)
    const q = surfaceNormal(S, a, b)
    return { p: addScaled(S(a, b), q, h), n: q }
  }
  const [rz, ry] = spec.root
  const L = 0.046
  const Hh = 0.023
  const foot2 = even(roundCorners([[-L, -Hh * 0.8], [L, -Hh], [L * 0.9, Hh], [-L * 0.85, Hh * 0.85]], [0.016, 0.016, 0.018, 0.018], 8), 48)
  const H = 0.009
  const rf = 0.007
  const levels: [number, number][] = [[0, -0.003], [0, 0]]
  for (let k = 1; k <= 5; k++) {
    const a = (k / 5) * (Math.PI / 2)
    levels.push([rf * (1 - Math.cos(a)), rf * 0 + H * 0.78 * Math.sin(a)])
  }
  levels.push([rf * 1.9, H * 0.94], [rf * 3.2, H])
  const ringsB = levels.map(([d, h]) => inset(foot2, d).map((q) => on(rz + q[0], ry + q[1], h).p))
  const top = on(rz, ry, H + 0.0015).p
  const below = addScaled(foot, n, -0.05)
  const posB: number[] = []
  const triB = (a: V3, b: V3, c: V3): void => {
    const e = cross(sub(b, a), sub(c, a))
    if (Math.hypot(e[0], e[1], e[2]) < 1e-14) return
    const mid: V3 = [(a[0] + b[0] + c[0]) / 3 - below[0], (a[1] + b[1] + c[1]) / 3 - below[1], (a[2] + b[2] + c[2]) / 3 - below[2]]
    posB.push(...(dot(e, mid) >= 0 ? [...a, ...b, ...c] : [...a, ...c, ...b]))
  }
  const mB = foot2.length
  for (let k = 0; k + 1 < ringsB.length; k++) {
    for (let j = 0; j < mB; j++) {
      const jn = (j + 1) % mB
      triB(ringsB[k][j], ringsB[k][jn], ringsB[k + 1][jn])
      triB(ringsB[k][j], ringsB[k + 1][jn], ringsB[k + 1][j])
    }
  }
  const last = ringsB[ringsB.length - 1]
  for (let j = 0; j < mB; j++) triB(last[j], last[(j + 1) % mB], top)
  const base = indexed(posB)

  const gasket = new MeshBuilder()
  const gp = foot2.map((q) => on(rz + q[0], ry + q[1], 0.0006))
  sweep(gasket, gp.map((g) => g.p), gp.map((g) => g.n), roundRect(0.0042, 0.0034, 0.0016, 3), true)

  const tv = new THREE.Vector3(cx - w * 0.45, cy - h + 0.03, zb + 0.02).applyMatrix4(turn)
  const tip: V3 = [tv.x, tv.y, tv.z]
  const start = addScaled(top, n, -0.006)
  const path: V3[] = []
  const bow = addScaled(addScaled(foot, n, 0.07), [0, 1, 0], 0.03)
  for (let i = 0; i <= 16; i++) {
    const t = i / 16
    path.push(lerp3(lerp3(start, bow, t), lerp3(bow, tip, t), t))
  }
  const along = norm(sub(tip, start))
  const up = norm(cross(along, cross([0, 0, 1], along)))
  const stalk = new MeshBuilder()
  const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
  sweep(stalk, path, path.map(() => up), roundRect(0.012, 0.036, 0.0055, 4), false, (t) => 1 - 0.22 * t + 0.55 * (1 - ease(t / 0.22)) ** 2 + 0.4 * ease((t - 0.8) / 0.2) ** 2)
  const parts = [base, orient(gasket.geometry()), orient(stalk.geometry())]
  const all = mergeGeometries(parts.map((g) => {
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k)
    return g
  }))
  return { head: hg, glass: gg, stalk: all }
}
