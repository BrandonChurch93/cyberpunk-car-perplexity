import type * as THREE from 'three'
import { flange, offsetSurface, surfaceNormal } from '../body/body'
import type { Surface, SurfaceCurve } from '../geom/cuts'
import { toGeometry } from '../geom/mesh'
import { tessellate, type TessOptions, type TessResult } from '../geom/tessellate'

/** Glazing sizes in meters. The pane sits below the paint, inside a seal ring, with an open gap between the two. */
export interface GlazingSpec {
  seal: number
  gap: number
  sealDrop: number
  paneDrop: number
  thickness: number
  wall: number
}

export const glazingSpec: GlazingSpec = { seal: 0.012, gap: 0.0035, sealDrop: 0.0025, paneDrop: 0.0065, thickness: 0.005, wall: 0.03 }

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

/** Panes, pane edges and seal rings for every closed glass curve on `S`, built on both sides. */
export function glazing(S: Surface, curves: SurfaceCurve[], fine: Tess, spec: GlazingSpec = glazingSpec): Glazing {
  const tess = { ...fine, maxEdge: Math.max(fine.maxEdge ?? 0, 0.16), tolerance: Math.max(fine.tolerance ?? 0, 0.004), edgeLength: Math.max(fine.edgeLength ?? 0, 0.012) }
  const normal = (u: number, v: number) => surfaceNormal(S, u, v)
  const panes: TessResult[] = []
  const edges: TessResult[] = []
  const seals: TessResult[] = []
  const inner = spec.seal + spec.gap
  for (const c of curves) {
    const paneTrim = (u: number, v: number, p: [number, number, number]) => c.signed(u, v, p, 0.3) + inner
    const outer = tessellate(offsetSurface(S, -spec.paneDrop), { ...tess, trim: paneTrim, normal })
    const back = tessellate(offsetSurface(S, -spec.paneDrop - spec.thickness), { ...tess, trim: paneTrim, normal })
    panes.push(outer, flipped(back))
    edges.push(flange([outer], spec.thickness))
    const ring = tessellate(offsetSurface(S, -spec.sealDrop), {
      ...tess,
      trim: (u, v, p) => {
        const d = c.signed(u, v, p, 0.3)
        return Math.max(d, -d - spec.seal)
      },
      normal,
    })
    const lip = { ...ring, boundaries: ring.boundaries.filter((b) => {
      const k = b.uv.length >> 1
      return c.signed(b.uv[k][0], b.uv[k][1], S(b.uv[k][0], b.uv[k][1]), 0.3) < -spec.seal / 2
    }) }
    seals.push(ring, flange([lip], spec.wall))
  }
  return { panes: toGeometry(panes, true), edges: toGeometry(edges, true), seals: toGeometry(seals, true) }
}
