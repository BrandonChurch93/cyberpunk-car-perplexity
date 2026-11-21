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

export const glazingSpec: GlazingSpec = { wall: 0.004, seal: 0.012, roll: 0.0024, sealDrop: 0.0034, paneDrop: 0.0065, inset: 0.012, thickness: 0.005, step: 0.008 }

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

/** Black ceramic frit width at `p`: 32 mm at the header, about 65 mm down the sides and 77 mm along the base. */
const fritWidth = (p: V3): number => 0.032 + 0.033 * smooth(0.5, 0.75, p[2]) + 0.012 * smooth(1.3, 1.5, p[2])

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** The frit behind the outer face, `depth` under the skin: a solid band from the pane edge in, trimmed by the distance to
 * the glass line leaving out its run along the centerline, then rows of dots that get smaller inboard. */
function frit(S: Surface, c: SurfaceCurve, spec: GlazingSpec, depth: number, tess: TessOptions): TessResult[] {
  const pitch = 0.0055
  const { p: C, uv: UV } = resample(c, pitch)
  const n = C.length
  const center = (i: number): boolean => Math.abs(C[i][0]) < 2e-3
  const segs: Array<[V3, V3]> = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    if (!(center(i) && center(j))) segs.push([C[i], C[j]])
  }
  const reach = 0.11
  const key = (x: number, y: number, z: number): string => `${Math.floor(x / reach)},${Math.floor(y / reach)},${Math.floor(z / reach)}`
  const cells = new Map<string, Array<[V3, V3]>>()
  for (const sg of segs) {
    const m: V3 = scale(add(sg[0], sg[1]), 0.5)
    const k = key(m[0], m[1], m[2])
    let l = cells.get(k)
    if (!l) cells.set(k, (l = []))
    l.push(sg)
  }
  const edge = (q: V3): number => {
    let best = reach
    const [cx, cy, cz] = [Math.floor(q[0] / reach), Math.floor(q[1] / reach), Math.floor(q[2] / reach)]
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      for (const [a, b] of cells.get(`${cx + i},${cy + j},${cz + k}`) ?? []) {
        const ab = sub(b, a)
        const l2 = dot(ab, ab)
        const t = l2 > 0 ? Math.min(1, Math.max(0, dot(sub(q, a), ab) / l2)) : 0
        const e = sub(q, add(a, scale(ab, t)))
        const d = Math.hypot(e[0], e[1], e[2])
        if (d < best) best = d
      }
    }
    return best
  }
  const band = (u: number, v: number, p: V3): number => {
    if (!c.inside(u, v)) return 0.05
    const d = edge(p)
    return Math.max(spec.inset - 0.001 - d, d - spec.inset - fritWidth(p))
  }
  const span = (k: number[], lo: number, hi: number): number[] => {
    let i0 = 0
    while (i0 + 1 < k.length && k[i0 + 1] <= lo) i0++
    let i1 = k.length - 1
    while (i1 - 1 > i0 && k[i1 - 1] >= hi) i1--
    return k.slice(i0, i1 + 1)
  }
  const us = UV.map((q) => q[0])
  const vs = UV.map((q) => q[1])
  const solid = tessellate(offsetSurface(S, -depth), { ...tess, us: span(tess.us, Math.min(...us), Math.max(...us)), vs: span(tess.vs, Math.min(...vs), Math.max(...vs)), trim: band })
  const out: TessResult = { positions: [], normals: [], uvs: [], indices: [], boundaries: [] }
  const radii = [0.0021, 0.0015, 0.0009]
  const sides = 8
  for (let i = 0; i < n; i++) {
    if (center(i)) continue
    const ia = (i - 1 + n) % n
    const ib = (i + 1) % n
    const t = norm(sub(C[ib], C[ia]))
    const nn0 = surfaceNormal(S, UV[i][0], UV[i][1])
    const s0 = norm(cross(nn0, t))
    const w = spec.inset + fritWidth(C[i])
    const [u0, v0] = UV[i]
    const h = 1e-4
    const su = scale(sub(S(Math.min(1, u0 + h), v0), C[i]), 1 / h)
    const sv = scale(sub(S(u0, Math.min(1, v0 + h)), C[i]), 1 / h)
    const ga = dot(su, su)
    const gb = dot(su, sv)
    const gc = dot(sv, sv)
    const det = ga * gc - gb * gb
    if (!(Math.abs(det) > 1e-20)) continue
    const toUv = (d: V3): [number, number] => {
      const x = dot(su, d)
      const y = dot(sv, d)
      return [(gc * x - gb * y) / det, (ga * y - gb * x) / det]
    }
    let sign = 0
    for (const [k, r] of radii.entries()) {
      const want = w + (k + 0.75) * pitch
      for (const sg of sign ? [sign] : [1, -1]) {
        const [du, dv] = toUv(add(scale(s0, sg * want), scale(t, k % 2 ? 0.5 * pitch : 0)))
        const uv: [number, number] = [Math.min(1, Math.max(0, u0 + du)), Math.min(1, Math.max(0, v0 + dv))]
        const on = S(uv[0], uv[1])
        if (!c.inside(uv[0], uv[1]) || Math.abs(edge(on) - want) > 0.004) continue
        sign = sg
        const nn = surfaceNormal(S, uv[0], uv[1])
        const o = add(on, scale(nn, -depth))
        const e1 = norm(sub(t, scale(nn, dot(t, nn))))
        const e2 = cross(nn, e1)
        const base = out.positions.length / 3
        out.positions.push(o[0], o[1], o[2])
        out.normals.push(nn[0], nn[1], nn[2])
        out.uvs.push(uv[0], uv[1])
        for (let j = 0; j < sides; j++) {
          const th = (j / sides) * Math.PI * 2
          const q = add(o, add(scale(e1, r * Math.cos(th)), scale(e2, r * Math.sin(th))))
          out.positions.push(q[0], q[1], q[2])
          out.normals.push(nn[0], nn[1], nn[2])
          out.uvs.push(uv[0], uv[1])
        }
        for (let j = 0; j < sides; j++) {
          const x = base + 1 + j
          const y = base + 1 + ((j + 1) % sides)
          const px: V3 = [out.positions[3 * x], out.positions[3 * x + 1], out.positions[3 * x + 2]]
          const py: V3 = [out.positions[3 * y], out.positions[3 * y + 1], out.positions[3 * y + 2]]
          if (dot(cross(sub(px, o), sub(py, o)), nn) >= 0) out.indices.push(base, x, y)
          else out.indices.push(base, y, x)
        }
        break
      }
    }
  }
  return [solid, out]
}

/** Panes, pane edges and seals for every closed glass curve on `S`, built on both sides. Roof glass, the windscreen and
 * the rear glass, carries a black frit band behind its outer face with a dotted fade inboard, merged into the edges. */
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
    const mid = c.uv[Math.floor(c.uv.length / 2)]
    if (Math.abs(surfaceNormal(S, mid[0], mid[1])[1]) > 0.5) {
      edges.push(...frit(S, c, spec, spec.paneDrop + 0.0012, { ...tess, normal }))
    }
  }
  return { panes: toGeometry(panes, true), edges: toGeometry(edges, true), seals: toGeometry(seals, true) }
}
