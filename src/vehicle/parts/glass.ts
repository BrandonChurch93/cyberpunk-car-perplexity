import type * as THREE from 'three'
import { flange, offsetSurface, surfaceNormal } from '../body/body'
import { resample } from '../body/gaps'
import type { Surface, SurfaceCurve } from '../geom/cuts'
import { toGeometry } from '../geom/mesh'
import { tessellate, type TessOptions, type TessResult } from '../geom/tessellate'
import { add, cross, dot, norm, scale, sub, type V3 } from '../geom/vec'

/** Glazing sizes in meters, measured inward from the cut line and down from the skin. The paint rolls 4 mm into a wall
 * `wall` inboard of the line; the seal runs from that wall `seal` across at `sealDrop`, rolls over `roll` and stands on
 * the pane, whose edge is `inset` in, under the seal. */
export interface GlazingSpec {
  wall: number
  seal: number
  roll: number
  sealDrop: number
  paneDrop: number
  inset: number
  thickness: number
  step: number
}

export const glazingSpec: GlazingSpec = { wall: 0.004, seal: 0.012, roll: 0.0015, sealDrop: 0.0047, paneDrop: 0.0065, inset: 0.012, thickness: 0.005, step: 0.008 }

export interface Glazing {
  panes: THREE.BufferGeometry
  edges: THREE.BufferGeometry
  seals: THREE.BufferGeometry
}

type Tess = Omit<TessOptions, 'trim' | 'flip' | 'normal'>

function flipped(t: TessResult): TessResult {
  const indices: number[] = []
  for (let i = 0; i < t.indices.length; i += 3) indices.push(t.indices[i], t.indices[i + 2], t.indices[i + 1])
  const normals = t.normals.map((x) => -x)
  return { ...t, indices, normals, boundaries: [] }
}

/** One seal swept along the cut line: a flat top from behind the paint wall, a small roll and a face down onto the pane. */
function seal(S: Surface, c: SurfaceCurve, spec: GlazingSpec): TessResult {
  const out: TessResult = { positions: [], normals: [], uvs: [], indices: [], boundaries: [] }
  const { p: C, uv: UV } = resample(c, spec.step)
  const n = C.length
  const steps = 3
  const w1 = spec.wall + spec.seal
  const prof: Array<[number, number, number, number]> = [[spec.wall - 0.0002, -spec.sealDrop, 0, 1], [w1, -spec.sealDrop, 0, 1]]
  for (let k = 1; k <= steps; k++) {
    const th = (k / steps) * (Math.PI / 2)
    prof.push([w1 + spec.roll * Math.sin(th), -spec.sealDrop - spec.roll * (1 - Math.cos(th)), Math.sin(th), Math.cos(th)])
  }
  prof.push([w1 + spec.roll, -spec.paneDrop + 0.0001, 1, 0])
  const center = (i: number): boolean => Math.abs(C[i][0]) < 2e-3
  const rows: Array<number[] | null> = []
  for (let i = 0; i < n; i++) {
    const a = C[c.closed ? (i - 1 + n) % n : Math.max(0, i - 1)]
    const b = C[c.closed ? (i + 1) % n : Math.min(n - 1, i + 1)]
    const ia = c.closed ? (i - 1 + n) % n : Math.max(0, i - 1)
    const ib = c.closed ? (i + 1) % n : Math.min(n - 1, i + 1)
    const ua = UV[ia]
    const ub = UV[ib]
    const t = center(i) && center(ia) ? norm(sub(b, C[i])) : center(i) && center(ib) ? norm(sub(C[i], a)) : norm(sub(b, a))
    const nn = surfaceNormal(S, UV[i][0], UV[i][1])
    let s = norm(cross(nn, t))
    const e = 1e-3
    const du = ub[0] - ua[0]
    const dv = ub[1] - ua[1]
    const l = Math.hypot(du, dv) || 1
    const probe = (k: number): boolean => c.inside(UV[i][0] - (k * dv * e) / l, UV[i][1] + (k * du * e) / l)
    const left = probe(1)
    const q = sub(S(UV[i][0] - (dv * e) / l, UV[i][1] + (du * e) / l), C[i])
    if ((dot(q, s) > 0) !== left) s = scale(s, -1)
    const row: number[] = []
    for (const [w, h, ns, nh] of prof) {
      const p = add(add(C[i], scale(s, w)), scale(nn, h))
      const nrm = norm(add(scale(s, -ns), scale(nn, nh)))
      out.positions.push(p[0], p[1], p[2])
      out.normals.push(nrm[0], nrm[1], nrm[2])
      out.uvs.push(UV[i][0], UV[i][1])
      row.push(out.positions.length / 3 - 1)
    }
    rows.push(row)
  }
  const m = c.closed ? n : n - 1
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % n
    if (center(i) && center(j)) continue
    const r0 = rows[i]!
    const r1 = rows[j]!
    for (let k = 0; k + 1 < r0.length; k++) out.indices.push(r0[k], r1[k], r1[k + 1], r0[k], r1[k + 1], r0[k + 1])
  }
  const P = out.positions
  const N = out.normals
  const I = out.indices
  for (let t = 0; t < I.length; t += 3) {
    const v = (k: number): V3 => [P[3 * I[t + k]], P[3 * I[t + k] + 1], P[3 * I[t + k] + 2]]
    const g = cross(sub(v(1), v(0)), sub(v(2), v(0)))
    let d = 0
    for (let k = 0; k < 3; k++) d += g[0] * N[3 * I[t + k]] + g[1] * N[3 * I[t + k] + 1] + g[2] * N[3 * I[t + k] + 2]
    if (d < 0) [I[t + 1], I[t + 2]] = [I[t + 2], I[t + 1]]
  }
  return out
}

/** Panes, pane edges and seals for every closed glass curve on `S`, built on both sides. */
export function glazing(S: Surface, curves: SurfaceCurve[], fine: Tess, spec: GlazingSpec = glazingSpec): Glazing {
  const tess = { ...fine, maxEdge: Math.max(fine.maxEdge, 0.16), tolerance: Math.max(fine.tolerance, 0.004), edgeLength: Math.max(fine.edgeLength ?? 0, 0.012) }
  const normal = (u: number, v: number) => surfaceNormal(S, u, v)
  const panes: TessResult[] = []
  const edges: TessResult[] = []
  const seals: TessResult[] = []
  for (const c of curves) {
    const paneTrim = (u: number, v: number, p: [number, number, number]) => c.signed(u, v, p, 0.3) + spec.inset
    const outer = tessellate(offsetSurface(S, -spec.paneDrop), { ...tess, trim: paneTrim, normal })
    const back = tessellate(offsetSurface(S, -spec.paneDrop - spec.thickness), { ...tess, trim: paneTrim, normal })
    panes.push(outer, flipped(back))
    edges.push(flange([outer], spec.thickness))
    seals.push(seal(S, c, spec))
  }
  return { panes: toGeometry(panes, true), edges: toGeometry(edges, true), seals: toGeometry(seals, true) }
}
