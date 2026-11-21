import * as THREE from 'three'
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

function roundCorners(poly: V2[], r: number, k = 4): V2[] {
  const out: V2[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n]
    const p = poly[i]
    const c = poly[(i + 1) % n]
    const da = Math.hypot(a[0] - p[0], a[1] - p[1])
    const dc = Math.hypot(c[0] - p[0], c[1] - p[1])
    const s = Math.min(r, da / 2, dc / 2)
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
 * The left door mirror: a flat angular head, longer than tall with a sharp lower edge, its glass facing back, on a thin
 * blade that leaves the door skin just below the glass corner. `S` and `map` are the body's main surface and its map.
 */
export function mirror(S: Surface, map: SurfaceMap, spec: MirrorSpec = mirrorSpec): { head: THREE.BufferGeometry; glass: THREE.BufferGeometry; stalk: THREE.BufferGeometry } {
  const [cx, cy, cz] = spec.center
  const w = spec.width / 2
  const h = spec.height / 2
  const raw: V2[] = [[-w, h * 0.82], [-w * 0.92, -h], [w * 0.97, -h], [w, h * 0.35], [w * 0.8, h], [-w * 0.75, h]]
  const outline = roundCorners(raw, 0.014)
  const r = 0.006
  const zb = cz - 0.035
  const zf = (q: V2): number => zb + 0.014 + 0.062 * ((q[1] + h) / (2 * h)) - 0.012 * ((q[0] + w) / (2 * w))
  const P = (q: V2, z: number): V3 => [cx + q[0], cy + q[1], z]
  const o2 = inset(outline, 1.6 * r)
  const roll: V3[][] = []
  const front: V3[][] = []
  for (let k = 0; k <= 4; k++) {
    const a = (k / 4) * (Math.PI / 2)
    const o = inset(outline, r * (1 - Math.cos(a)))
    roll.push(o.map((q) => P(q, zb + r * (1 - Math.sin(a)))))
    front.push(o.map((q) => P(q, zf(q) - r * (1 - Math.sin(a)))))
  }
  const hg = solid([o2.map((q) => P(q, zb)), ...roll.reverse(), ...front, o2.map((q) => P(q, zf(q)))], [cx, cy, cz - 0.005])

  const glass = new MeshBuilder()
  const gl = inset(outline, 0.009)
  const ids = gl.map((q) => glass.vertex(P(q, zb - 0.0012), [0, 0, -1]))
  for (const [x, y, z] of THREE.ShapeUtils.triangulateShape(gl.map((q) => new THREE.Vector2(q[0], q[1])), [])) {
    const e = cross(sub(P(gl[y], 0), P(gl[x], 0)), sub(P(gl[z], 0), P(gl[x], 0)))
    if (e[2] < 0) glass.tri(ids[x], ids[y], ids[z])
    else glass.tri(ids[x], ids[z], ids[y])
  }

  const [u, v] = map.invert('x', spec.root[0], spec.root[1])
  const foot = S(u, v)
  const n = surfaceNormal(S, u, v)
  const tip: V3 = [cx - w * 0.45, cy - h + 0.03, zb + 0.016]
  const start = addScaled(foot, n, -0.016)
  const path: V3[] = []
  const bow = addScaled(addScaled(foot, n, 0.07), [0, 1, 0], 0.03)
  for (let i = 0; i <= 10; i++) {
    const t = i / 10
    path.push(lerp3(lerp3(start, bow, t), lerp3(bow, tip, t), t))
  }
  const along = norm(sub(tip, start))
  const up = norm(cross(along, cross([0, 0, 1], along)))
  const stalk = new MeshBuilder()
  sweep(stalk, path, path.map(() => up), roundRect(0.012, 0.042, 0.005, 3), false, (t) => 1 - 0.25 * t)
  return { head: hg, glass: glass.geometry(), stalk: orient(stalk.geometry()) }
}
