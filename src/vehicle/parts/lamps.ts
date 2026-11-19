import type * as THREE from 'three'
import { type Surface, type SurfaceCurve, type SurfaceMap } from '../geom/cuts'
import { MeshBuilder } from '../geom/mesh'
import { extrude, lathe, roundRect, sweep } from '../geom/shapes'
import { add, norm, scale, type V2, type V3 } from '../geom/vec'
import { surfaceNormal } from '../body/body'
import { elev } from '../body/lines'

/** A flat faced light guide following a curve on the body, sunk by `depth` below the surface. */
export function guide(S: Surface, c: SurfaceCurve, depth: number, w: number, h: number): THREE.BufferGeometry {
  const b = new MeshBuilder()
  const ns = c.uv.map(([u, v]) => surfaceNormal(S, u, v))
  const path = c.p.map((p, i) => add(p, scale(ns[i], -depth - h / 2)))
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

export interface Projector {
  /** Lens center on the outside. */
  lens: V3
  axis: V3
  radius: number
}

/** Point and normal on a body face from front or rear elevation coordinates. */
export function onFace(map: SurfaceMap, axis: 'z' | '-z', x: number, y: number): { p: V3; n: V3 } {
  const [u, v] = map.invert(axis, x, y)
  return { p: map.S(u, v), n: surfaceNormal(map.S, u, v) }
}

/** Main and auxiliary projector modules inside the eye slot, left side. */
export function projectors(front: SurfaceMap): Projector[] {
  const spots: Array<[V2, number]> = [
    [elev(300, 402), 0.028],
    [elev(232, 395), 0.018],
  ]
  return spots.map(([[x, y], r]) => {
    const f = onFace(front, 'z', x, y)
    return { lens: add(f.p, scale(f.n, -0.012)), axis: [0, 0, 1], radius: r }
  })
}

export function projectorGeometry(ps: Projector[]): { lens: THREE.BufferGeometry; body: THREE.BufferGeometry } {
  const lens = new MeshBuilder()
  const body = new MeshBuilder()
  for (const p of ps) {
    const r = p.radius
    const lb = new MeshBuilder()
    const prof: Array<[number, number]> = []
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * (Math.PI / 2)
      prof.push([r * Math.sin(a) * 0.98, r * 0.35 * Math.cos(a)])
    }
    lathe(lb, prof, 32)
    const bb = new MeshBuilder()
    lathe(
      bb,
      [
        [r * 1.0, 0.0],
        [r * 1.25, -0.002],
        [r * 1.3, -0.01],
        [r * 1.05, -0.012],
        [r * 1.05, -0.06],
        [0.001, -0.06],
      ].reverse() as Array<[number, number]>,
      32,
    )
    for (const [b, src] of [
      [lens, lb],
      [body, bb],
    ] as const) {
      const base = b.pos.length / 3
      for (let i = 0; i < src.pos.length; i += 3) {
        const x = src.pos[i]
        const y = src.pos[i + 1]
        const z = src.pos[i + 2]
        b.vertex([p.lens[0] + z, p.lens[1] + y, p.lens[2] + x], [src.nor[i + 2], src.nor[i + 1], src.nor[i]])
      }
      for (let i = 0; i < src.idx.length; i += 3) b.tri(base + src.idx[i], base + src.idx[i + 2], base + src.idx[i + 1])
    }
  }
  return { lens: lens.geometry(), body: body.geometry() }
}

export interface Outlet {
  center: V3
  outline: V2[]
}

/** The two high hexagonal outlets, as hex tubes with a thick lip and two round pipes inside. Left one; mirror for the right. */
export function exhaust(rear: SurfaceMap, outline: V2[]): { lip: THREE.BufferGeometry; pipes: THREE.BufferGeometry; soot: THREE.BufferGeometry; center: V3; rim: number } {
  let cx = 0
  let cy = 0
  for (const [x, y] of outline) {
    cx += x / outline.length
    cy += y / outline.length
  }
  const f = onFace(rear, '-z', cx, cy)
  const zFace = f.p[2] - 0.02
  const local = outline.map(([x, y]): V2 => [x - cx, y - cy])
  const hw = Math.max(...local.map((q) => Math.abs(q[0])))
  const hh = Math.max(...local.map((q) => Math.abs(q[1])))
  const grow = (q: V2[], d: number): V2[] => q.map(([x, y]) => [x * (1 + d / hw), y * (1 + d / hh)])
  const lip = new MeshBuilder()
  const o: V3 = [cx, cy, zFace]
  const ex: V3 = [1, 0, 0]
  const ey: V3 = [0, 1, 0]
  const ez: V3 = [0, 0, 1]
  const outer = grow(local, 0.022)
  const inner = local
  const ring = (a: V2[], bq: V2[]): void => {
    const m = a.length
    for (let j = 0; j < m; j++) {
      const k = (j + 1) % m
      const p0 = lip.vertex([o[0] + a[j][0], o[1] + a[j][1], o[2]], [0, 0, -1])
      const p1 = lip.vertex([o[0] + a[k][0], o[1] + a[k][1], o[2]], [0, 0, -1])
      const p2 = lip.vertex([o[0] + bq[k][0], o[1] + bq[k][1], o[2]], [0, 0, -1])
      const p3 = lip.vertex([o[0] + bq[j][0], o[1] + bq[j][1], o[2]], [0, 0, -1])
      lip.quad(p0, p3, p2, p1)
    }
  }
  ring(outer, inner)
  extrude(lip, outer.map(([x, y]): V2 => [x, y]), o, ex, ey, ez, 0.12, false)
  const innerRev = [...inner].reverse()
  extrude(lip, innerRev, o, ex, ey, ez, 0.2, false)
  const soot = new MeshBuilder()
  extrude(soot, inner, add(o, [0, 0, 0.2]), ex, ey, ez, 0.005, true)
  const pipes = new MeshBuilder()
  for (const dx of [-0.065, 0.065]) {
    const pr = 0.042
    const pb = new MeshBuilder()
    lathe(
      pb,
      [
        [pr - 0.003, 0.15],
        [pr - 0.003, 0.03],
        [pr, 0.03],
        [pr, 0.15],
      ],
      40,
    )
    const base = pipes.pos.length / 3
    for (let i = 0; i < pb.pos.length; i += 3) pipes.vertex([cx + dx + pb.pos[i + 2], cy + pb.pos[i + 1], zFace + pb.pos[i]], [pb.nor[i + 2], pb.nor[i + 1], pb.nor[i]])
    for (let i = 0; i < pb.idx.length; i += 3) pipes.tri(base + pb.idx[i], base + pb.idx[i + 2], base + pb.idx[i + 1])
  }
  return { lip: lip.geometry(), pipes: pipes.geometry(), soot: soot.geometry(), center: [cx, cy, zFace], rim: Math.hypot(outer[0][0], outer[0][1]) }
}
