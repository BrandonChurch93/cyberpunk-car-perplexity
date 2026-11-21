import type * as THREE from 'three'
import { type Surface, type SurfaceCurve } from '../geom/cuts'
import { MeshBuilder } from '../geom/mesh'
import { roundRect, sweep } from '../geom/shapes'
import { add, norm, scale } from '../geom/vec'
import { surfaceNormal } from '../body/body'

/** A flat faced light guide following a curve on the body, sunk by `depth` below the surface. */
export function guide(S: Surface, c: SurfaceCurve, depth: number, w: number, h: number): THREE.BufferGeometry {
  const b = new MeshBuilder()
  // A trimmed curve can repeat a point where it meets the trim. A repeated point has no tangent, so it is dropped.
  const keep = c.p.map((p, i) => i === 0 || Math.hypot(p[0] - c.p[i - 1][0], p[1] - c.p[i - 1][1], p[2] - c.p[i - 1][2]) > 1e-5)
  const ns = c.uv.filter((_, i) => keep[i]).map(([u, v]) => surfaceNormal(S, u, v))
  const path = c.p.filter((_, i) => keep[i]).map((p, i) => add(p, scale(ns[i], -depth - h / 2)))
  sweep(b, path, ns, roundRect(w, h, Math.min(w, h) * 0.3, 3))
  for (const end of [0, path.length - 1]) {
    const p = path[end]
    const n = ns[end]
    const dir = norm(end === 0 ? [path[0][0] - path[1][0], path[0][1] - path[1][1], path[0][2] - path[1][2]] : [p[0] - path[end - 1][0], p[1] - path[end - 1][1], p[2] - path[end - 1][2]])
    const side = norm([n[1] * dir[2] - n[2] * dir[1], n[2] * dir[0] - n[0] * dir[2], n[0] * dir[1] - n[1] * dir[0]])
    const q = roundRect(w, h, Math.min(w, h) * 0.3, 3)
    const ids = q.map(([x, y]) => b.vertex(add(p, add(scale(side, x), scale(n, y))), dir))
    for (let i = 1; i < ids.length - 1; i++) {
      if (end === 0) b.tri(ids[0], ids[i + 1], ids[i])
      else b.tri(ids[0], ids[i], ids[i + 1])
    }
  }
  return b.geometry()
}
