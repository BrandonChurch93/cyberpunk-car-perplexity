import type * as THREE from 'three'
import type { Surface } from '../geom/cuts'
import { toGeometry } from '../geom/mesh'
import { tessellate, type TessOptions, type TessResult, type TrimFn } from '../geom/tessellate'
import { cross, norm, sub, type V3 } from '../geom/vec'
import { arches, glassTrim, makeCuts, paintTrim, type BodyCuts } from './cuts'
import { frontFace, rearFace } from './faces'
import { mainLoft } from './shape'

export interface BodyGeometry {
  paint: THREE.BufferGeometry
  glass: THREE.BufferGeometry
  shell: THREE.BufferGeometry
  cuts: BodyCuts
  surfaces: { main: Surface; front: Surface; rear: Surface }
}

export interface BodyQuality {
  maxEdge: number
  maxAngle: number
  tolerance: number
  edgeLength: number
}

const steps = (n: number): number[] => Array.from({ length: n + 1 }, (_, i) => i / n)

/** Unit normal of a surface by central differences, S_u x S_v. */
export function surfaceNormal(S: Surface, u: number, v: number): V3 {
  const h = 1e-4
  const ua = Math.max(0, u - h)
  const ub = Math.min(1, u + h)
  const va = Math.max(0, v - h)
  const vb = Math.min(1, v + h)
  const n = cross(sub(S(ub, v), S(ua, v)), sub(S(u, vb), S(u, va)))
  return norm(n)
}

export function offsetSurface(S: Surface, t: number): Surface {
  return (u, v) => {
    const p = S(u, v)
    const n = surfaceNormal(S, u, v)
    return [p[0] + n[0] * t, p[1] + n[1] * t, p[2] + n[2] * t]
  }
}

/** Walls along every trimmed edge, running inward from the surface by `depth`. */
export function flange(parts: TessResult[], depth: number): TessResult {
  const out: TessResult = { positions: [], normals: [], uvs: [], indices: [], boundaries: [] }
  const push = (p: V3, n: V3): number => {
    out.positions.push(p[0], p[1], p[2])
    out.normals.push(n[0], n[1], n[2])
    out.uvs.push(0, 0)
    return out.positions.length / 3 - 1
  }
  for (const t of parts) {
    for (const b of t.boundaries) {
      const n = b.points.length
      if (n < 2) continue
      const top: number[] = []
      const bot: number[] = []
      for (let i = 0; i < n; i++) {
        const p = b.points[i]
        const nn = b.normals[i]
        const a = b.points[Math.max(0, i - 1)]
        const c = b.points[Math.min(n - 1, i + 1)]
        const tg = norm(sub(c, a))
        const h = norm(cross(tg, nn))
        top.push(push(p, norm([nn[0] + h[0], nn[1] + h[1], nn[2] + h[2]])))
        bot.push(push([p[0] - nn[0] * depth, p[1] - nn[1] * depth, p[2] - nn[2] * depth], h))
      }
      const m = b.closed ? n : n - 1
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % n
        out.indices.push(top[i], bot[i], bot[j], top[i], bot[j], top[j])
      }
    }
  }
  return out
}

export function buildBody(q: BodyQuality): BodyGeometry {
  const loft = mainLoft()
  const main: Surface = (u, v) => loft.at(u, v)
  const front = frontFace(loft)
  const rear = rearFace(loft)
  const cuts = makeCuts(main, front, rear)
  const base = { maxEdge: q.maxEdge, maxAngle: q.maxAngle, tolerance: q.tolerance, minEdge: 0.0012, edgeLength: q.edgeLength }
  const mainGrid = { us: steps(40), vs: [...loft.vAt] }
  const faceGrid = { us: steps(8), vs: steps(8) }
  const run = (S: Surface, grid: Pick<TessOptions, 'us' | 'vs'>, trim?: TrimFn, coarse = 1): TessResult =>
    tessellate(S, { ...base, maxEdge: base.maxEdge * coarse, tolerance: base.tolerance * coarse, edgeLength: base.edgeLength * coarse, ...grid, trim })
  const paint = [
    run(main, mainGrid, paintTrim(cuts.main, arches)),
    run(front, faceGrid, paintTrim(cuts.front)),
    run(rear, faceGrid, paintTrim(cuts.rear)),
  ]
  paint.push(flange(paint, 0.014))
  const glass = [run(main, mainGrid, glassTrim(cuts.main, 0.004)), run(front, faceGrid, glassTrim(cuts.front, 0.002))]
  glass.push(flange(glass, 0.006))
  const inner = -0.014
  const noGlass = (c: typeof cuts.main): TrimFn => {
    const g = glassTrim(c, 0)
    return (u, v, p) => Math.max(arches(p), -g(u, v, p))
  }
  const bayTrim: TrimFn = (u, v, p) => Math.max(noGlass(cuts.main)(u, v, p), -cuts.curves.bay.signed(u, v, p, 0.3) - 0.02)
  const shell = [run(offsetSurface(main, inner), mainGrid, bayTrim, 3), run(offsetSurface(front, inner), faceGrid, undefined, 3), run(offsetSurface(rear, inner), faceGrid, undefined, 3)]
  return { paint: toGeometry(paint, true), glass: toGeometry(glass, true), shell: toGeometry(shell, true), cuts, surfaces: { main, front, rear } }
}
