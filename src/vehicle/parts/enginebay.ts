import * as THREE from 'three'
import type { SurfaceCurve } from '../geom/cuts'
import { MeshBuilder } from '../geom/mesh'
import { add, cross, dot, norm, scale, sub, type V2, type V3 } from '../geom/vec'
import { merge, solid } from './solid'

export interface Bay {
  tub: THREE.BufferGeometry
  covers: THREE.BufferGeometry
  carbon: THREE.BufferGeometry
  /** Parts on the centre line, not mirrored. */
  center: THREE.BufferGeometry
  mesh: THREE.BufferGeometry
  grille: THREE.BufferGeometry
  bezel: THREE.BufferGeometry
  duct: THREE.BufferGeometry
  ledge: THREE.BufferGeometry
  /** Centre of the left airbox grille on its top face, and its outward normal. */
  grilleCenter: V3
  grilleNormal: V3
  meshCenter: V3
}

export const baySpec = {
  floorY: 0.7,
  grille: { center: [0.301, 1.008, -1.0389] as V3, slope: -0.1, length: 0.42, width: 0.184, cell: 0.017, gauge: 0.0028, thick: 0.006, chamfer: 0.0009 },
  bezel: { inset: 0.006, corner: 0.016, wide: 0.022, rise: 0.005, drop: 0.009, round: 0.003 },
  duct: { top: 0.014, bottom: 0.032 },
  covers: { x: 0.1, width: 0.12, height: 0.07, bank: 0.35, z0: -1.0, z1: -1.7, y0: 0.99, y1: 0.905, ribs: 6 },
  plenum: { width: 0.09, height: 0.06, z0: -1.02, z1: -1.66, y0: 0.97, y1: 0.895 },
  mesh: { z0: -1.72, z1: -1.94, y: 0.9, thick: 0.004 },
}

interface Frame {
  c: V3
  a: V3
  b: V3
  n: V3
}

const at = (f: Frame, a: number, b: number, d: number): V3 => add(add(add(f.c, scale(f.a, a)), scale(f.b, b)), scale(f.n, d))

function polygon(m: MeshBuilder, pts: V3[], n: V3): void {
  const base = m.pos.length / 3
  for (const p of pts) m.vertex(p, n)
  for (let i = 1; i + 1 < pts.length; i++) {
    const w = cross(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0]))
    if (dot(w, n) >= 0) m.tri(base, base + i, base + i + 1)
    else m.tri(base, base + i + 1, base + i)
  }
}

/** A closed plate of thickness `thick` perforated by a honeycomb of hexagonal holes, each top edge chamfered. */
export function honeycomb(f: Frame, ha: number, hb: number, cell: number, gauge: number, thick: number, chamfer: number, margin: number): MeshBuilder {
  const m = new MeshBuilder()
  const R = cell / Math.sqrt(3)
  const r = R - gauge / Math.sqrt(3)
  const ap = (r * Math.sqrt(3)) / 2
  const dx = 1.5 * R
  const dy = cell
  const centres: V2[] = []
  for (let i = -Math.ceil(ha / dx); i <= Math.ceil(ha / dx); i++) {
    for (let j = -Math.ceil(hb / dy) - 1; j <= Math.ceil(hb / dy) + 1; j++) {
      const x = i * dx
      const y = (j + (Math.abs(i) % 2 ? 0 : 0.5)) * dy
      if (Math.abs(x) + r + margin > ha || Math.abs(y) + ap + margin > hb) continue
      centres.push([x, y])
    }
  }
  const hex = (c: V2, rad: number): V2[] => Array.from({ length: 6 }, (_, k): V2 => [c[0] + rad * Math.cos((k * Math.PI) / 3), c[1] + rad * Math.sin((k * Math.PI) / 3)])
  const outline: V2[] = [[-ha, -hb], [ha, -hb], [ha, hb], [-ha, hb]]
  const nDown = scale(f.n, -1)
  for (const [d, rad, n] of [[0, r + chamfer, f.n], [-thick, r, nDown]] as const) {
    const holes = centres.map((c) => hex(c, rad))
    const tris = THREE.ShapeUtils.triangulateShape(outline.map(([x, y]) => new THREE.Vector2(x, y)), holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y))))
    const pts = outline.concat(...holes).map(([x, y]) => at(f, x, y, d))
    const base = m.pos.length / 3
    for (const p of pts) m.vertex(p, n)
    for (const [i, j, k] of tris) {
      const w = cross(sub(pts[j], pts[i]), sub(pts[k], pts[i]))
      if (dot(w, n) >= 0) m.tri(base + i, base + j, base + k)
      else m.tri(base + i, base + k, base + j)
    }
  }
  for (const c of centres) {
    const top = hex(c, r + chamfer)
    const mid = hex(c, r)
    for (let k = 0; k < 6; k++) {
      const k1 = (k + 1) % 6
      const mx = (mid[k][0] + mid[k1][0]) / 2 - c[0]
      const my = (mid[k][1] + mid[k1][1]) / 2 - c[1]
      const inward = norm(add(scale(f.a, -mx), scale(f.b, -my)))
      polygon(m, [at(f, top[k][0], top[k][1], 0), at(f, top[k1][0], top[k1][1], 0), at(f, mid[k1][0], mid[k1][1], -chamfer), at(f, mid[k][0], mid[k][1], -chamfer)], norm(add(inward, f.n)))
      polygon(m, [at(f, mid[k][0], mid[k][1], -chamfer), at(f, mid[k1][0], mid[k1][1], -chamfer), at(f, mid[k1][0], mid[k1][1], -thick), at(f, mid[k][0], mid[k][1], -thick)], inward)
    }
  }
  for (let k = 0; k < 4; k++) {
    const p = outline[k]
    const q = outline[(k + 1) % 4]
    const out = norm(add(scale(f.a, (q[1] - p[1]) / Math.hypot(q[0] - p[0], q[1] - p[1])), scale(f.b, -(q[0] - p[0]) / Math.hypot(q[0] - p[0], q[1] - p[1]))))
    polygon(m, [at(f, p[0], p[1], 0), at(f, q[0], q[1], 0), at(f, q[0], q[1], -thick), at(f, p[0], p[1], -thick)], out)
  }
  return m
}

/** Closed loop of a rounded rectangle in a frame, with the outward direction at each point. */
function roundLoop(ha: number, hb: number, rad: number, k = 6): Array<{ p: V2; o: V2 }> {
  const out: Array<{ p: V2; o: V2 }> = []
  const cs: V2[] = [[ha - rad, hb - rad], [-ha + rad, hb - rad], [-ha + rad, -hb + rad], [ha - rad, -hb + rad]]
  cs.forEach((c, q) => {
    for (let i = 0; i <= k; i++) {
      const t = ((q + i / k) * Math.PI) / 2
      const o: V2 = [Math.cos(t), Math.sin(t)]
      out.push({ p: [c[0] + rad * o[0], c[1] + rad * o[1]], o })
    }
  })
  return out
}

/** Rounded rectangle section from (s0, d0) to (s1, d1), counter-clockwise. */
function roundSection(s0: number, s1: number, d0: number, d1: number, rad: number, k = 3): V2[] {
  const out: V2[] = []
  const cs: V2[] = [[s1 - rad, d1 - rad], [s0 + rad, d1 - rad], [s0 + rad, d0 + rad], [s1 - rad, d0 + rad]]
  cs.forEach((c, q) => {
    for (let i = 0; i <= k; i++) {
      const t = ((q + i / k) * Math.PI) / 2
      out.push([c[0] + rad * Math.cos(t), c[1] + rad * Math.sin(t)])
    }
  })
  return out
}

/** A closed slab between two offsets of a rounded rectangle loop. */
function slab(f: Frame, ha: number, hb: number, rad: number, d0: number, d1: number): MeshBuilder {
  const m = new MeshBuilder()
  const loop = roundLoop(ha, hb, rad)
  for (const [d, n] of [[d1, f.n], [d0, scale(f.n, -1)]] as const) polygon(m, loop.map((l) => at(f, l.p[0], l.p[1], d)), n)
  const rows = [loop.map((l) => at(f, l.p[0], l.p[1], d1)), loop.map((l) => at(f, l.p[0], l.p[1], d0))]
  const base = m.pos.length / 3
  for (const row of rows) loop.forEach((l, j) => m.vertex(row[j], norm(add(scale(f.a, l.o[0]), scale(f.b, l.o[1])))))
  const n = loop.length
  for (let j = 0; j < n; j++) {
    const j1 = (j + 1) % n
    const w = cross(sub(rows[0][j1], rows[0][j]), sub(rows[1][j], rows[0][j]))
    const o = add(scale(f.a, loop[j].o[0]), scale(f.b, loop[j].o[1]))
    if (dot(w, o) >= 0) m.quad(base + j, base + j1, base + n + j1, base + n + j)
    else m.quad(base + j, base + n + j, base + n + j1, base + j1)
  }
  return m
}

/** A closed bar of a section swept along a path; section coordinates are along `side` and `up` at each point. */
function prism(path: V3[], side: V3[], up: V3[], sec: V2[]): MeshBuilder {
  return solid(sec.map(([s, d]) => path.map((p, j) => add(add(p, scale(side[j], s)), scale(up[j], d)))), sec.map(() => false), true, false)
}

export function grilleFrame(side = 1): Frame {
  const g = baySpec.grille
  const c: V3 = [side * g.center[0], g.center[1], g.center[2]]
  const a = norm([0, g.slope, -1])
  const b0: V3 = [side, 0.235, 0]
  const b = norm(sub(b0, scale(a, dot(b0, a))))
  let n = norm(cross(a, b))
  if (n[1] < 0) n = scale(n, -1)
  return { c, a, b, n }
}

/** Left half of the open engine bay, built inside the opening `edge`. */
export function engineBay(edge: SurfaceCurve, cell: number): Bay {
  const { floorY } = baySpec
  const rim = edge.p.filter((p) => p[0] > 0.004).sort((a, b) => b[2] - a[2])
  const zf = rim[0][2]
  const zr = rim[rim.length - 1][2]
  const widthAt = (z: number): { x: number; y: number } => {
    let best = rim[0]
    for (const p of rim) if (Math.abs(p[2] - z) < Math.abs(best[2] - z)) best = p
    return { x: best[0], y: best[1] }
  }

  const tub = new MeshBuilder()
  const nz = 40
  const ns = 16
  tub.grid(nz + 1, ns + 1, (i, j) => {
    const z = zf + 0.02 + ((zr - zf - 0.04) * i) / nz
    const w = widthAt(z)
    const s = j / ns
    const p: V3 = s < 0.7 ? [(w.x + 0.01) * (s / 0.7), floorY, z] : [w.x + 0.01, floorY + (w.y - 0.03 - floorY) * ((s - 0.7) / 0.3), z]
    return { p, n: s < 0.7 ? [0, 1, 0] : [-1, 0, 0] }
  }, false, true)
  for (const [zEnd, sign] of [[zf + 0.02, 1], [zr - 0.02, -1]] as const) {
    const w = widthAt(zEnd)
    tub.grid(2, 2, (i, j) => ({ p: [j * (w.x + 0.01), i === 0 ? floorY : w.y - 0.03, zEnd], n: [0, 0, -sign] }), false, sign > 0)
  }

  const g = baySpec.grille
  const bz = baySpec.bezel
  const f = grilleFrame(1)
  const ha = g.length / 2
  const hb = g.width / 2
  const grille = honeycomb(f, ha, hb, g.cell, g.gauge, g.thick, g.chamfer, bz.inset + 0.004)
  const loop = roundLoop(ha - bz.inset, hb - bz.inset, bz.corner)
  const lp = loop.map((l) => at(f, l.p[0], l.p[1], 0))
  const lo = loop.map((l) => norm(add(scale(f.a, l.o[0]), scale(f.b, l.o[1]))))
  const sec = roundSection(0, bz.wide, -bz.drop, bz.rise, bz.round)
  const bezel = solid(sec.map(([s, d]) => lp.map((p, j) => add(add(p, scale(lo[j], s)), scale(f.n, d)))), sec.map(() => false), true, true)
  const d = baySpec.duct
  const duct = slab(f, ha - bz.inset, hb - bz.inset, bz.corner, -d.bottom, -d.top)

  const ledgeRows: V3[][] = [[], [], [], []]
  for (let i = 0; i <= 24; i++) {
    const a = -ha - 0.03 + ((2 * ha + 0.06) * i) / 24
    const inner = at(f, a, hb - bz.inset + bz.wide - 0.006, -0.004)
    const w = widthAt(inner[2])
    const outer: V3 = [w.x + 0.012, w.y - 0.03, inner[2]]
    ledgeRows[0].push(inner)
    ledgeRows[1].push(outer)
    ledgeRows[2].push([outer[0], outer[1] - 0.004, outer[2]])
    ledgeRows[3].push(sub(inner, scale(f.n, 0.004)))
  }
  const ledge = solid(ledgeRows, [true, true, true, true], true, false)

  const carbon = new MeshBuilder()
  const panelPath: V3[] = []
  for (let i = 0; i <= 24; i++) panelPath.push(at(f, -ha - 0.03 + ((2 * ha + 0.06) * i) / 24, 0, 0))
  const lipIn = -hb + bz.inset - 0.004
  const panelSec: V2[] = [[0.002, -0.006], [-0.02, -0.006], [-0.022, -0.03], [-0.045, -0.032], [-0.048, -0.09], [-0.053, -0.09], [-0.05, -0.037], [-0.027, -0.035], [-0.025, -0.011], [0.002, -0.011]]
  const flat = panelPath.map((): V3 => [1, 0, 0])
  const vert = panelPath.map((): V3 => [0, 1, 0])
  const lipBase = panelPath.map((p): V3 => add(p, scale(f.b, lipIn)))
  merge(carbon, solid(panelSec.map(([s, dd]) => lipBase.map((p, j) => add(add(p, scale(flat[j], s)), scale(vert[j], dd)))), panelSec.map(() => true), true, false))
  const braceZ = -0.9
  const lip = at(f, (f.c[2] - braceZ) / -f.a[2], lipIn, -0.006)
  const braceX = lip[0] - 0.005
  const bracePath: V3[] = []
  for (let i = 0; i <= 12; i++) bracePath.push([(braceX * i) / 12, lip[1] + 0.009, braceZ])
  merge(carbon, prism(bracePath, bracePath.map((): V3 => [0, 0, -1]), bracePath.map((): V3 => [0, 1, 0]), roundSection(-0.025, 0.025, -0.009, 0.007, 0.003)))

  const cv = baySpec.covers
  const covers = new MeshBuilder()
  const ex: V3 = [Math.cos(cv.bank), -Math.sin(cv.bank), 0]
  const ey: V3 = [Math.sin(cv.bank), Math.cos(cv.bank), 0]
  const coverPath: V3[] = []
  for (let i = 0; i <= 20; i++) {
    const t = i / 20
    coverPath.push([cv.x, cv.y0 + (cv.y1 - cv.y0) * t, cv.z0 + (cv.z1 - cv.z0) * t])
  }
  const sides = coverPath.map(() => ex)
  const ups = coverPath.map(() => ey)
  merge(covers, prism(coverPath, sides, ups, roundSection(-cv.width / 2, cv.width / 2, -cv.height, 0, 0.012, 4)))
  const ribPath = coverPath.slice(1, -1)
  for (let k = 0; k < cv.ribs; k++) {
    const s = -cv.width / 2 + 0.02 + ((cv.width - 0.04) * k) / (cv.ribs - 1)
    merge(covers, prism(ribPath, ribPath.map(() => ex), ribPath.map(() => ey), roundSection(s - 0.003, s + 0.003, -0.002, 0.004, 0.0015, 2)))
  }

  const center = new MeshBuilder()
  const pl = baySpec.plenum
  const plPath: V3[] = []
  for (let i = 0; i <= 20; i++) {
    const t = i / 20
    plPath.push([0, pl.y0 + (pl.y1 - pl.y0) * t, pl.z0 + (pl.z1 - pl.z0) * t])
  }
  merge(center, prism(plPath, plPath.map((): V3 => [1, 0, 0]), plPath.map((): V3 => [0, 1, 0]), roundSection(-pl.width / 2, pl.width / 2, -pl.height, 0, 0.014, 4)))

  const ms = baySpec.mesh
  const mz = (ms.z0 + ms.z1) / 2
  const hx = Math.min(0.28, widthAt(ms.z1).x - 0.03)
  const meshFrame: Frame = { c: [0, ms.y, mz], a: [1, 0, 0], b: [0, 0, -1], n: [0, 1, 0] }
  const mesh = honeycomb(meshFrame, hx, Math.abs(ms.z1 - ms.z0) / 2, cell, cell * 0.16, ms.thick, 0.0006, 0.008)

  return {
    tub: tub.geometry(),
    covers: covers.geometry(),
    carbon: carbon.geometry(),
    center: center.geometry(),
    mesh: mesh.geometry(),
    grille: grille.geometry(),
    bezel: bezel.geometry(),
    duct: duct.geometry(),
    ledge: ledge.geometry(),
    grilleCenter: f.c,
    grilleNormal: f.n,
    meshCenter: [0, ms.y, mz],
  }
}
