import * as THREE from 'three'
import type { Surface } from '../geom/cuts'
import { toGeometry } from '../geom/mesh'
import { tessellate, type TessOptions, type TessResult, type TrimFn } from '../geom/tessellate'
import { cross, norm, sub, type V3 } from '../geom/vec'
import { makeCuts, paintTrim, wheelOpenings, type BodyCuts } from './cuts'
import { gapChannel, gapMask, onGapEdge, withoutGapEdges } from './gaps'
import { fitFascia, tessellateFascia, type FasciaEdge } from './nose'
import { rearFace } from './tail'
import { backingLoft, dims, mainLoft } from './shape'

export interface BodyGeometry {
  paint: THREE.BufferGeometry
  gapFloor: THREE.BufferGeometry
  shell: THREE.BufferGeometry
  cuts: BodyCuts
  surfaces: { main: Surface; front: Surface; rear: Surface }
  grids: { main: Pick<TessOptions, 'us' | 'vs'> }
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

/** Walls along every trimmed edge, running inward from the surface by `depth`. With `roll`, the edge first turns
 * down over a quarter round of that radius, so the lip catches a highlight; the wall then stands that far into the
 * opening. */
export function flange(parts: TessResult[], depth: number, roll?: (p: V3) => number): TessResult {
  const out: TessResult = { positions: [], normals: [], uvs: [], indices: [], boundaries: [] }
  const push = (p: V3, n: V3): number => {
    out.positions.push(p[0], p[1], p[2])
    out.normals.push(n[0], n[1], n[2])
    out.uvs.push(0, 0)
    return out.positions.length / 3 - 1
  }
  const steps = roll ? 2 : 0
  for (const t of parts) {
    for (const b of t.boundaries) {
      const n = b.points.length
      if (n < 2) continue
      const rings: number[][] = Array.from({ length: steps + 2 }, () => [])
      for (let i = 0; i < n; i++) {
        const p = b.points[i]
        const nn = b.normals[i]
        const a = b.points[Math.max(0, i - 1)]
        const c = b.points[Math.min(n - 1, i + 1)]
        const tg = norm(sub(c, a))
        const h = norm(cross(tg, nn))
        if (!roll) {
          rings[0].push(push(p, norm([nn[0] + h[0], nn[1] + h[1], nn[2] + h[2]])))
          rings[1].push(push([p[0] - nn[0] * depth, p[1] - nn[1] * depth, p[2] - nn[2] * depth], h))
          continue
        }
        const r = Math.min(roll(p), depth / 2)
        for (let k = 0; k <= steps; k++) {
          const th = (k / steps) * (Math.PI / 2)
          const s1 = Math.sin(th)
          const c1 = 1 - Math.cos(th)
          rings[k].push(push(
            [p[0] + h[0] * r * s1 - nn[0] * r * c1, p[1] + h[1] * r * s1 - nn[1] * r * c1, p[2] + h[2] * r * s1 - nn[2] * r * c1],
            norm([nn[0] * Math.cos(th) + h[0] * s1, nn[1] * Math.cos(th) + h[1] * s1, nn[2] * Math.cos(th) + h[2] * s1]),
          ))
        }
        rings[steps + 1].push(push([p[0] + h[0] * r - nn[0] * depth, p[1] + h[1] * r - nn[1] * depth, p[2] + h[2] * r - nn[2] * depth], h))
      }
      const m = b.closed ? n : n - 1
      for (let k = 0; k + 1 < rings.length; k++) {
        const top = rings[k]
        const bot = rings[k + 1]
        for (let i = 0; i < m; i++) {
          const j = (i + 1) % n
          out.indices.push(top[i], bot[i], bot[j], top[i], bot[j], top[j])
        }
      }
    }
  }
  return out
}

/** The paint's own vertices on the main surface's front edge (u = 0), in descending v, split at the brow tip. The
 * fascia is fitted to exactly these, so the two meet sample for sample. */
function frontEdges(t: TessResult, S: Surface, split: number): { brow: FasciaEdge; side: FasciaEdge } {
  const vs = new Set<number>()
  for (let i = 0; i < t.uvs.length; i += 2) if (t.uvs[i] === 0) vs.add(t.uvs[i + 1])
  const all = [...vs].sort((a, b) => b - a)
  const edge = (keep: (v: number) => boolean): FasciaEdge => {
    const v = all.filter(keep)
    return { v, p: v.map((x) => S(0, x)) }
  }
  return { brow: edge((v) => v >= split), side: edge((v) => v <= split) }
}

export function buildBody(q: BodyQuality): BodyGeometry {
  const loft = mainLoft()
  const main: Surface = (u, v) => loft.at(u, v)
  const rear = rearFace(loft)
  const base = { maxEdge: q.maxEdge, maxAngle: q.maxAngle, tolerance: q.tolerance, minEdge: 0.0012, edgeLength: q.edgeLength }
  const mainGrid = { us: steps(40), vs: [...loft.vAt] }
  const faceGrid = { us: steps(8), vs: steps(8) }
  const run = (S: Surface, grid: Pick<TessOptions, 'us' | 'vs'>, trim?: TrimFn, coarse = 1, normal?: TessOptions['normal']): TessResult =>
    tessellate(S, { ...base, maxEdge: base.maxEdge * coarse, tolerance: base.tolerance * coarse, edgeLength: base.edgeLength * coarse, ...grid, trim, normal })
  // The main skin goes first: the fascia is fitted to its front edge.
  let mainPaint: TessResult | undefined
  let fascia: ReturnType<typeof fitFascia> | undefined
  const cuts = makeCuts(main, (c) => {
    mainPaint = run(main, mainGrid, paintTrim(c, wheelOpenings))
    const edges = frontEdges(mainPaint, main, loft.vAt[3])
    fascia = fitFascia(edges.brow, edges.side)
    return fascia.surface
  }, rear)
  if (!mainPaint || !fascia) throw new Error('front not fitted')
  const front: Surface = fascia.surface
  const nose = tessellateFascia(cuts.maps.front, cuts.front.holes, fascia.uEdge, fascia.vEdge, fascia.surface.fieldStops)
  const paint = [mainPaint, run(rear, faceGrid, paintTrim(cuts.rear))]
  // Openings roll over 4 mm. Shut gap edges roll over 1.5 mm into walls 2 mm off the line, so the gap between the two
  // walls is an open 4 mm slot, 11 mm deep onto a dark floor. The fascia rolls and returns its own openings.
  const allGaps = [cuts.main, cuts.rear].flatMap((c) => c.gaps)
  const channel = gapChannel(paint, allGaps)
  paint.push(flange(withoutGapEdges(paint, onGapEdge(allGaps)), 0.014, () => 0.004), channel.lips, ...nose.paint)
  const inner = -0.014
  // The backing is open wherever the skin has an opening (glass, bay, intakes, ducts, outlets), so every opening
  // goes through the thick panel and its returned walls are the paint flange. Shut gaps stay closed behind.
  const openings = (c: typeof cuts.main, extra?: (p: V3) => number): TrimFn => {
    const keep = paintTrim({ ...c, gaps: [], bands: [] }, extra)
    return (u, v, p) => keep(u, v, p)
  }
  const bayTrim: TrimFn = (u, v, p) => Math.max(openings(cuts.main, wheelOpenings)(u, v, p), -cuts.curves.bay.signed(u, v, p, 0.3) - 0.02)
  // The backing shell is the paint pushed inward. It keeps the paint's normal: the offset folds on itself where a crease
  // is tighter than the offset, and its own tangents vanish there.
  const backing = (S: Surface, grid: Pick<TessOptions, 'us' | 'vs'>, trim?: TrimFn): TessResult =>
    run(offsetSurface(S, inner), grid, trim, 3, (u, v) => surfaceNormal(S, u, v))
  // The main backing follows a twin of the main loft whose creases roll over 20 mm, wider than the offset.
  const back = backingLoft()
  const mainBack: Surface = (u, v) => back.at(u, v)
  // Its first 15 mm behind the front edge is left off: there the paint rolls 4 mm onto the fascia, and the 14 mm
  // offset of that roll folds forward through the fascia skin.
  const frontBand = 0.015 / dims.length
  const mainBacking: TrimFn = (u, v, p) => Math.max(bayTrim(u, v, p), (frontBand - u) * dims.length)
  const shell = [backing(mainBack, mainGrid, mainBacking), nose.shell, backing(rear, faceGrid, openings(cuts.rear))]
  // The gap mask rides on the paint as the 'gap' attribute: 1 on gap edges and walls, easing to 0 beside them.
  const paintGeometry = toGeometry(paint, true)
  paintGeometry.setAttribute('gap', new THREE.Float32BufferAttribute(gapMask(paint, channel.lips, allGaps, true), 1))
  return { paint: paintGeometry, gapFloor: toGeometry([channel.floor], true), shell: toGeometry(shell, true), cuts, surfaces: { main, front, rear }, grids: { main: mainGrid } }
}
