import * as THREE from 'three'
import { MeshBuilder } from './mesh'
import { add, cross, norm, scale, sub, type V2, type V3 } from './vec'

export type Prof = Array<[number, number]>

/** Revolves (radius, x) points about the X axis. */
export function lathe(b: MeshBuilder, prof: Prof, segs: number, deform?: (p: V3, n: V3) => [V3, V3], a0 = 0, a1 = Math.PI * 2): void {
  const pn: Array<[number, number]> = prof.map((_, i) => {
    const a = prof[Math.max(0, i - 1)]
    const c = prof[Math.min(prof.length - 1, i + 1)]
    const dr = c[0] - a[0]
    const dx = c[1] - a[1]
    const l = Math.hypot(dr, dx) || 1
    return [dx / l, -dr / l]
  })
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-9
  const cols = full ? segs : segs + 1
  b.grid(
    prof.length,
    cols,
    (i, j) => {
      const th = a0 + ((a1 - a0) * j) / segs
      const c = Math.cos(th)
      const s = Math.sin(th)
      const [r, x] = prof[i]
      const [nr, nx] = pn[i]
      let p: V3 = [x, r * s, r * c]
      let n: V3 = [nx, nr * s, nr * c]
      if (deform) [p, n] = deform(p, n)
      return { p, n, u: j / segs, v: i / (prof.length - 1) }
    },
    full,
  )
}

/** Sweeps a closed 2D section (a along the side vector, b along the up vector) along a path. */
export function sweep(b: MeshBuilder, path: V3[], ups: V3[], section: V2[], closedPath = false, taper?: (t: number) => number): void {
  const n = path.length
  const frames = path.map((p, i) => {
    const a = path[closedPath ? (i - 1 + n) % n : Math.max(0, i - 1)]
    const c = path[closedPath ? (i + 1) % n : Math.min(n - 1, i + 1)]
    const t = norm(sub(c, a))
    const side = norm(cross(ups[i], t))
    const up = cross(t, side)
    return { p, side, up }
  })
  const m = section.length
  const sn: V2[] = section.map((_, j) => {
    const a = section[(j - 1 + m) % m]
    const c = section[(j + 1) % m]
    const dx = c[0] - a[0]
    const dy = c[1] - a[1]
    const l = Math.hypot(dx, dy) || 1
    return [dy / l, -dx / l]
  })
  b.grid(
    closedPath ? n + 1 : n,
    m,
    (i, j) => {
      const f = frames[i % n]
      const k = taper ? taper(i / (n - 1)) : 1
      const [x, y] = section[j]
      const [nx, ny] = sn[j]
      return { p: add(f.p, add(scale(f.side, x * k), scale(f.up, y * k))), n: norm(add(scale(f.side, nx), scale(f.up, ny))) }
    },
    true,
    true,
  )
}

/** A rounded rectangle section, w by h, corner radius r, counter clockwise. */
export function roundRect(w: number, h: number, r: number, k = 4): V2[] {
  const out: V2[] = []
  const cs: V2[] = [
    [w / 2 - r, h / 2 - r],
    [-w / 2 + r, h / 2 - r],
    [-w / 2 + r, -h / 2 + r],
    [w / 2 - r, -h / 2 + r],
  ]
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i <= k; i++) {
      const a = ((c + i / k) * Math.PI) / 2
      out.push([cs[c][0] + r * Math.cos(a), cs[c][1] + r * Math.sin(a)])
    }
  }
  return out
}

/** Extrudes a 2D outline (counter clockwise in the ex, ey plane) along ez by depth, with flat caps. */
export function extrude(b: MeshBuilder, outline: V2[], o: V3, ex: V3, ey: V3, ez: V3, depth: number, caps = true): void {
  const at = (q: V2, d: number): V3 => add(o, add(add(scale(ex, q[0]), scale(ey, q[1])), scale(ez, d)))
  const m = outline.length
  for (let j = 0; j < m; j++) {
    const a = outline[j]
    const c = outline[(j + 1) % m]
    const e = norm(sub(at(c, 0), at(a, 0)))
    const nrm = norm(cross(e, ez))
    const i0 = b.vertex(at(a, 0), nrm)
    const i1 = b.vertex(at(c, 0), nrm)
    const i2 = b.vertex(at(c, depth), nrm)
    const i3 = b.vertex(at(a, depth), nrm)
    b.quad(i0, i3, i2, i1)
  }
  if (!caps) return
  const tris = THREE.ShapeUtils.triangulateShape(
    outline.map((q) => new THREE.Vector2(q[0], q[1])),
    [],
  )
  const back = scale(ez, -1)
  const b0 = outline.map((q) => b.vertex(at(q, 0), back))
  const b1 = outline.map((q) => b.vertex(at(q, depth), ez))
  for (const [x, y, z] of tris) {
    b.tri(b0[x], b0[z], b0[y])
    b.tri(b1[x], b1[y], b1[z])
  }
}

/** A superellipsoid centered at c with half sizes r, squareness e (1 is an ellipsoid). */
export function blob(b: MeshBuilder, c: V3, r: V3, e: number, rows = 16, cols = 32, shape?: (p: V3) => V3): void {
  const sp = (x: number): number => Math.sign(x) * Math.abs(x) ** e
  b.grid(
    rows + 1,
    cols,
    (i, j) => {
      const v = -Math.PI / 2 + (Math.PI * i) / rows
      const u = (2 * Math.PI * j) / cols
      const d: V3 = [sp(Math.cos(v)) * sp(Math.cos(u)), sp(Math.sin(v)), sp(Math.cos(v)) * sp(Math.sin(u))]
      let p: V3 = [c[0] + r[0] * d[0], c[1] + r[1] * d[1], c[2] + r[2] * d[2]]
      if (shape) p = shape(p)
      const n = norm([d[0] / r[0], d[1] / r[1], d[2] / r[2]])
      return { p, n }
    },
    true,
    true,
  )
}

export function appendGeometry(b: MeshBuilder, g: THREE.BufferGeometry): void {
  const p = g.getAttribute('position')
  const n = g.getAttribute('normal')
  const base = b.pos.length / 3
  for (let i = 0; i < p.count; i++) b.vertex([p.getX(i), p.getY(i), p.getZ(i)], [n.getX(i), n.getY(i), n.getZ(i)])
  const idx = g.getIndex()
  if (idx) for (let i = 0; i < idx.count; i += 3) b.tri(base + idx.getX(i), base + idx.getX(i + 1), base + idx.getX(i + 2))
}

/** Computes smooth normals from faces for builders whose normals are rough guesses. */
export function smoothNormals(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.computeVertexNormals()
  return g
}
