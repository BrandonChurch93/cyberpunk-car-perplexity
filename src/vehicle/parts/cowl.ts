import type * as THREE from 'three'
import { flange, offsetSurface, surfaceNormal } from '../body/body'
import type { Surface, SurfaceCurve, SurfaceMap } from '../geom/cuts'
import { MeshBuilder, toGeometry } from '../geom/mesh'
import { tessellate, type TessOptions } from '../geom/tessellate'
import { glazingSpec } from './glass'
import { add, cross, norm, scale, sub, type V3 } from '../geom/vec'

/**
 * The cowl: a satin black panel between the bonnet's rear edge and the windscreen's base, set 8 mm under the skin, with
 * a row of vent slots over a dark plenum, and two wipers parked along the foot of the glass. Car-local meters.
 */
export const cowlSpec = {
  /** Panel depth under the skin. */
  drop: 0.008,
  /** Depth of the panel's edge walls. */
  wall: 0.012,
  /** Plenum floor depth under the skin. */
  floor: 0.035,
  /** Vent slots: centers from x0 to x1 at a pitch, each w wide and running z0 to z1. */
  slots: { x0: 0.02, x1: 0.31, pitch: 0.017, w: 0.008, z0: 1.592, z1: 1.632, r: 0.003 },
  wiper: {
    /** Blade spans in x along the foot of the glass, 3 cm up the screen. */
    blades: [[-0.6, -0.07], [-0.02, 0.51]] as const,
    /** Pivot of each arm on the cowl panel. */
    pivots: [[-0.47, 1.56], [0.1, 1.56]] as const,
    up: 0.03,
    blade: { w: 0.01, h: 0.012 },
    arm: { w: 0.016, h: 0.008 },
    capR: 0.014,
  },
}

export interface Cowl {
  panel: THREE.BufferGeometry
  plenum: THREE.BufferGeometry
  arms: THREE.BufferGeometry
  blades: THREE.BufferGeometry
}

type Tess = Pick<TessOptions, 'us' | 'vs' | 'maxEdge' | 'maxAngle' | 'tolerance' | 'minEdge' | 'edgeLength'>

/** Signed distance to a rounded rectangle in (x, z), negative inside. */
function box(x: number, z: number, cx: number, cz: number, hx: number, hz: number, r: number): number {
  const qx = Math.abs(x - cx) - hx + r
  const qz = Math.abs(z - cz) - hz + r
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r
}

/** Distance into the nearest vent slot, negative inside a slot; the main skin is the x >= 0 half. */
function slotField(p: V3): number {
  const s = cowlSpec.slots
  const x = Math.abs(p[0])
  const k = Math.max(0, Math.min(Math.round((x - s.x0) / s.pitch), Math.round((s.x1 - s.x0) / s.pitch)))
  const cz = (s.z0 + s.z1) / 2
  return box(x, p[2], s.x0 + k * s.pitch, cz, s.w / 2, (s.z1 - s.z0) / 2, s.r)
}

/** The plenum floor's outline: the slot row with a 6 mm margin. */
function plenumField(p: V3): number {
  const s = cowlSpec.slots
  return box(Math.abs(p[0]), p[2], (s.x0 + s.x1) / 2 - 0.004, (s.z0 + s.z1) / 2, (s.x1 - s.x0) / 2 + s.w / 2 + 0.01, (s.z1 - s.z0) / 2 + 0.006, 0.004)
}

/** A skin point and normal at car-local (x, z) seen from above, offset `up` along the normal. */
function onTop(S: Surface, map: SurfaceMap, x: number, z: number, up: number): { p: V3; n: V3 } {
  const [u, v] = map.invert('y', z, Math.abs(x), [0, 1, 0.36, 1])
  const q = S(u, v)
  const n = surfaceNormal(S, u, v)
  const sign = x < 0 ? -1 : 1
  return { p: [sign * (q[0] + n[0] * up), q[1] + n[1] * up, q[2] + n[2] * up], n: [sign * n[0], n[1], n[2]] }
}

/** A rounded bar of width w and height h swept along a path of points with normals, its bottom on the path. */
function bar(mb: MeshBuilder, path: Array<{ p: V3; n: V3 }>, w: number, h: number): void {
  const ring = 12
  const prof: Array<[number, number, number, number]> = []
  for (let k = 0; k < ring; k++) {
    const a = (k / ring) * Math.PI * 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    // A superellipse: flat faces, rounded corners.
    const e = 0.35
    const px = Math.sign(c) * Math.pow(Math.abs(c), e) * (w / 2)
    const py = Math.sign(s) * Math.pow(Math.abs(s), e) * (h / 2) + h / 2
    prof.push([px, py, c * h, s * w])
  }
  const frames = path.map((q, i) => {
    const a = path[Math.max(0, i - 1)].p
    const b = path[Math.min(path.length - 1, i + 1)].p
    const t = norm(sub(b, a))
    const side = norm(cross(q.n, t))
    const up = norm(cross(t, side))
    return { p: q.p, side, up, t }
  })
  mb.grid(path.length, ring, (i, j) => {
    const f = frames[i]
    const [px, py, nx, ny] = prof[j]
    return { p: add(add(f.p, scale(f.side, px)), scale(f.up, py)), n: norm(add(scale(f.side, nx), scale(f.up, ny))) }
  }, true)
  for (const [i, dir] of [[0, -1], [path.length - 1, 1]] as const) {
    const f = frames[i]
    const n = scale(f.t, dir)
    const c = mb.vertex(add(f.p, scale(f.up, h / 2)), n)
    const ids = prof.map(([px, py]) => mb.vertex(add(add(f.p, scale(f.side, px)), scale(f.up, py)), n))
    for (let k = 0; k < ring; k++) {
      const a = ids[k]
      const b = ids[(k + 1) % ring]
      if (dir > 0) mb.tri(c, a, b)
      else mb.tri(c, b, a)
    }
  }
}

/** A short upright cylinder of radius r and height h on a skin point. */
function cap(mb: MeshBuilder, at: { p: V3; n: V3 }, r: number, h: number): void {
  const n = norm(at.n)
  const a = norm(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]))
  const b = cross(n, a)
  const seg = 20
  const top = add(at.p, scale(n, h))
  mb.grid(2, seg, (i, j) => {
    const th = (j / seg) * Math.PI * 2
    const d = add(scale(a, Math.cos(th)), scale(b, Math.sin(th)))
    return { p: add(add(at.p, scale(n, i * h - 0.004)), scale(d, r)), n: d }
  }, true, true)
  const c = mb.vertex(top, n)
  const ids = Array.from({ length: seg }, (_, j) => {
    const th = (j / seg) * Math.PI * 2
    return mb.vertex(add(top, add(scale(a, Math.cos(th) * r), scale(b, Math.sin(th) * r))), n)
  })
  for (let j = 0; j < seg; j++) mb.tri(c, ids[j], ids[(j + 1) % seg])
}

/** z of the windscreen's base edge at x, from the screen curve's points. */
function screenBase(screen: SurfaceCurve, x: number): number {
  let best = -Infinity
  const ax = Math.abs(x)
  for (let i = 0; i < screen.p.length; i++) {
    const p = screen.p[i]
    const q = screen.p[(i + 1) % screen.p.length]
    if ((p[0] - ax) * (q[0] - ax) > 0 || p[0] === q[0]) continue
    const t = (ax - p[0]) / (q[0] - p[0])
    best = Math.max(best, p[2] + (q[2] - p[2]) * t)
  }
  return best
}

export function cowl(S: Surface, map: SurfaceMap, cowlCurve: SurfaceCurve, screen: SurfaceCurve, tess: Tess): Cowl {
  const normal = (u: number, v: number): V3 => surfaceNormal(S, u, v)
  const t = { ...tess, maxEdge: Math.min(tess.maxEdge, 0.02), edgeLength: 0.004, minEdge: 0.0008 }
  const panel = tessellate(offsetSurface(S, -cowlSpec.drop), {
    ...t,
    trim: (u, v, p) => Math.max(cowlCurve.signed(u, v, p, 0.3), -slotField(p)),
    normal,
  })
  const walls = flange([panel], cowlSpec.wall)
  const floor = tessellate(offsetSurface(S, -cowlSpec.floor), { ...t, trim: (u, v, p) => plenumField(p), normal })
  const floorWalls = flange([floor], cowlSpec.floor - cowlSpec.drop)

  const w = cowlSpec.wiper
  const arms = new MeshBuilder()
  const blades = new MeshBuilder()
  // The blade rests 1.5 mm over the screen pane, which sits under the skin.
  const glassUp = 0.0015 - glazingSpec.paneDrop
  w.blades.forEach(([x0, x1], i) => {
    const n = 48
    const path = Array.from({ length: n + 1 }, (_, k) => {
      const x = x0 + ((x1 - x0) * k) / n
      return onTop(S, map, x, screenBase(screen, x) - w.up, glassUp)
    })
    bar(blades, path, w.blade.w, w.blade.h)
    // The arm: from its pivot on the cowl up the glass to the blade's middle, lying along the blade's outer half.
    const [px, pz] = w.pivots[i]
    const mid = (x0 + x1) / 2
    const zb = screenBase(screen, mid) - w.up
    const armPath = Array.from({ length: 33 }, (_, k) => {
      const s = k / 32
      const x = px + (mid - px) * s
      const z = pz + (zb - pz) * Math.sin((s * Math.PI) / 2)
      return onTop(S, map, x, z, glassUp + w.blade.h * Math.min(1, s * 1.5) + 0.001)
    })
    bar(arms, armPath, w.arm.w, w.arm.h)
    cap(arms, onTop(S, map, px, pz, -cowlSpec.drop), w.capR, cowlSpec.drop + 0.012)
  })

  return {
    panel: toGeometry([panel, walls], true),
    plenum: toGeometry([floor, floorWalls], true),
    arms: arms.geometry(),
    blades: blades.geometry(),
  }
}
