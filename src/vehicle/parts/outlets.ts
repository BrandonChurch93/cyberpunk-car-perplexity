import type * as THREE from 'three'
import type { SurfaceCurve, SurfaceMap } from '../geom/cuts'
import { lines } from '../body/tail'
import { MeshBuilder } from '../geom/mesh'
import { add, cross, norm, scale, type V2, type V3 } from '../geom/vec'
import { merge, pocket, solid } from './solid'

/** Hex outlet from the patent rear view and photos: aperture, lip, pipes, depths into the body. */
export const outletSpec = {
  width: 0.29,
  height: 0.112,
  chamfer: 0.034,
  corner: 0.012,
  lip: 0.022,
  roll: 0.004,
  wall: 0.003,
  recess: 0.02,
  floor: 0.03,
  depth: 0.2,
  pipe: { r: 0.042, dx: 0.064, wall: 0.003, front: 0.012, back: 0.194, soot: 0.12, bead: 0.0035 },
} as const

const arcSteps = 16
const quarter = 4

export interface Outlets {
  lip: THREE.BufferGeometry
  pipes: THREE.BufferGeometry
  soot: THREE.BufferGeometry
  housing: THREE.BufferGeometry
  center: V3
  normal: V3
}

interface Frame {
  o: V3
  ex: V3
  ey: V3
  ez: V3
}

const at = (f: Frame, a: number, b: number, s: number): V3 => add(add(add(f.o, scale(f.ex, a)), scale(f.ey, b)), scale(f.ez, s))

/** Least squares line z = c0 + c2 y through the points, so the frame is square to the centre line. */
function fitPlane(pts: V3[]): [number, number, number] {
  let n = 0
  let sy = 0
  let sz = 0
  let syy = 0
  let syz = 0
  for (const p of pts) {
    n++
    sy += p[1]
    sz += p[2]
    syy += p[1] * p[1]
    syz += p[1] * p[2]
  }
  const c2 = (n * syz - sy * sz) / (n * syy - sy * sy)
  return [(sz - c2 * sy) / n, 0, c2]
}

/** Rounded stretched hexagon as fillet centres and unit directions, so any offset keeps the same parameters. */
function hexLoop(): Array<{ c: V2; n: V2 }> {
  const { width: w, height: h, chamfer: k, corner: rc } = outletSpec
  const v: V2[] = [[w / 2, 0], [w / 2 - k, h / 2], [-w / 2 + k, h / 2], [-w / 2, 0], [-w / 2 + k, -h / 2], [w / 2 - k, -h / 2]]
  const out: Array<{ c: V2; n: V2 }> = []
  for (let i = 0; i < 6; i++) {
    const p = v[(i + 5) % 6]
    const q = v[i]
    const s = v[(i + 1) % 6]
    const n0 = edgeNormal(p, q)
    const n1 = edgeNormal(q, s)
    const bis = normalize2([n0[0] + n1[0], n0[1] + n1[1]])
    const half = Math.acos(Math.max(-1, Math.min(1, n0[0] * n1[0] + n0[1] * n1[1]))) / 2
    const c: V2 = [q[0] - (bis[0] * rc) / Math.cos(half), q[1] - (bis[1] * rc) / Math.cos(half)]
    const a0 = Math.atan2(n0[1], n0[0])
    let a1 = Math.atan2(n1[1], n1[0])
    while (a1 < a0) a1 += Math.PI * 2
    for (let t = 0; t < arcSteps; t++) {
      const a = a0 + ((a1 - a0) * t) / (arcSteps - 1)
      out.push({ c, n: [Math.cos(a), Math.sin(a)] })
    }
  }
  return out.map((e) => ({ c: [e.c[0], e.c[1]], n: e.n }))
}

function edgeNormal(p: V2, q: V2): V2 {
  return normalize2([q[1] - p[1], -(q[0] - p[0])])
}

function normalize2(a: V2): V2 {
  const l = Math.hypot(a[0], a[1])
  return [a[0] / l, a[1] / l]
}

function circleLoop(cx: number, m: number): Array<{ c: V2; n: V2 }> {
  return Array.from({ length: m }, (_, j) => {
    const a = (j / m) * Math.PI * 2
    return { c: [cx, 0], n: [Math.cos(a), Math.sin(a)] }
  })
}

/** Profile point (offset from the base loop, depth) and whether the row is a crease. */
type Prof = Array<[number, number, boolean]>

function roll(cd: number, cs: number, r: number, a0: number, a1: number): Prof {
  return Array.from({ length: quarter + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / quarter
    return [cd + r * Math.cos(a), cs + r * Math.sin(a), false] as [number, number, boolean]
  })
}

function sweepLoop(f: Frame, loop: Array<{ c: V2; n: V2 }>, base: number, prof: Prof): MeshBuilder {
  const rows: V3[][] = []
  const sharp: boolean[] = []
  for (const [d, s, k] of prof) {
    rows.push(loop.map((e) => at(f, e.c[0] + e.n[0] * (base + d), e.c[1] + e.n[1] * (base + d), s)))
    sharp.push(k)
  }
  return solid(rows, sharp)
}

/** A flat closed disk of the loop at offset d between depths s0 and s1. */
function disk(f: Frame, loop: Array<{ c: V2; n: V2 }>, base: number, d: number, s0: number, s1: number, cx: number): MeshBuilder {
  const centre = (s: number): V3[] => loop.map(() => at(f, cx, 0, s))
  const ring = (s: number): V3[] => loop.map((e) => at(f, e.c[0] + e.n[0] * (base + d), e.c[1] + e.n[1] * (base + d), s))
  return solid([centre(s0), ring(s0), ring(s1), centre(s1)], [true, true, true, true])
}

/**
 * Two hex outlets, left side (x > 0), seated in the paint's surround aperture: a ceramic lip tube with rolled mouth,
 * two round pipes with rolled ends and soot inside, a back plate, and a dark housing whose returned wall continues the
 * paint's flange down to a floor that the lip stands out of.
 */
export function outlets(rm: SurfaceMap, surround: SurfaceCurve): Outlets {
  const sp = outletSpec
  const pts = surround.p
  const [c0, c1, c2] = fitPlane(pts)
  const cx = (Math.min(...lines.exhaust.map((q) => q[0])) + Math.max(...lines.exhaust.map((q) => q[0]))) / 2
  const cy = (Math.min(...lines.exhaust.map((q) => q[1])) + Math.max(...lines.exhaust.map((q) => q[1]))) / 2
  const ex = norm([1, 0, c1])
  const ey0: V3 = [0, 1, c2]
  const ez = norm(cross(ex, ey0))
  const ey = norm(cross(ez, ex))
  const zc = c0 + c1 * cx + c2 * cy
  const f: Frame = { o: add([cx, cy, zc], scale(ez, sp.recess)), ex, ey, ez }

  const hex = hexLoop()
  const rc = sp.corner
  const r = sp.roll
  const lipProf: Prof = [
    [0, sp.depth, true],
    ...roll(r, r, r, Math.PI, Math.PI * 1.5),
    ...roll(sp.lip - r, r, r, Math.PI * 1.5, Math.PI * 2),
    [sp.lip, sp.floor, true],
    [sp.wall, sp.floor, true],
    [sp.wall, sp.depth, true],
  ]
  const lip = sweepLoop(f, hex, rc, lipProf)

  const plate = disk(f, hex, rc, -0.0005, sp.depth - 0.008, sp.depth - 0.002, 0)
  const soot = new MeshBuilder()
  merge(soot, plate)
  const pipes = new MeshBuilder()
  const pr = sp.pipe
  const pr2 = pr.wall / 2
  for (const dx of [-pr.dx, pr.dx]) {
    const loop = circleLoop(dx, 64)
    const tube = pr.front + pr.bead
    const prof: Prof = [
      [-pr.wall, pr.back, true],
      ...roll(-pr2, tube + pr2, pr2, Math.PI, Math.PI * 2),
      [0, pr.back, true],
    ]
    merge(pipes, sweepLoop(f, loop, pr.r, prof))
    const bead: Prof = [
      [-pr2 - pr.bead, tube + 0.004, true],
      ...Array.from({ length: 2 * quarter + 1 }, (_, i): [number, number, boolean] => {
        const a = Math.PI + (Math.PI * i) / (2 * quarter)
        return [-pr2 + pr.bead * Math.cos(a), tube + pr.bead * Math.sin(a), false]
      }),
      [-pr2 + pr.bead, tube + 0.004, true],
    ]
    merge(lip, sweepLoop(f, loop, pr.r, bead))
    merge(soot, disk(f, loop, pr.r, -pr.wall - 0.0005, pr.soot, pr.soot + 0.004, dx))
  }

  const mouth = hex.map((e): V2 => [e.c[0] + e.n[0] * (rc + sp.wall + 0.001), e.c[1] + e.n[1] * (rc + sp.wall + 0.001)])
  const housing = pocket(rm, surround, { o: f.o, ex, ey, ez }, sp.floor, [mouth], 0.004)

  return { lip: lip.geometry(), pipes: pipes.geometry(), soot: soot.geometry(), housing: housing.geometry(), center: f.o, normal: scale(ez, -1) }
}
