import * as THREE from 'three'
import { MeshBuilder } from '../geom/mesh'
import { appendGeometry, lathe, type Prof } from '../geom/shapes'
import { norm, type V3 } from '../geom/vec'

export interface WheelSpec {
  /** Unloaded tire radius. */
  radius: number
  width: number
  /** Rim bead seat radius. */
  rim: number
  disc: { radius: number; thickness: number }
  /** Radial deflection at the contact patch. */
  flat: number
  /** Angle of the caliper around the axle, radians, in the (z, y) plane. */
  caliperAngle: number
  caliperLength: number
  quality: number
}

export interface WheelParts {
  tire: THREE.BufferGeometry
  rim: THREE.BufferGeometry
  disc: THREE.BufferGeometry
  hat: THREE.BufferGeometry
  caliper: THREE.BufferGeometry
  /** Outer face center, relative to the hub. */
  face: V3
}

function arc(c: [number, number], r: number, a0: number, a1: number, n: number): Prof {
  const out: Prof = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)])
  }
  return out
}

export function tireProfile(s: WheelSpec): Prof {
  const R = s.radius
  const hw = s.width / 2
  const bead = s.rim + 0.012
  const sh = 0.03
  const prof: Prof = []
  const side = (sign: number): Prof => {
    const pts: Prof = []
    for (let i = 0; i <= 10; i++) {
      const t = i / 10
      const r = bead + (R - sh - bead) * t
      const bulge = Math.sin(Math.PI * (0.25 + 0.75 * t)) * 0.012
      pts.push([r, sign * (hw - 0.012 + bulge - 0.012 * (1 - t))])
    }
    return pts
  }
  prof.push([s.rim - 0.004, -hw + 0.03], [bead - 0.004, -hw + 0.016])
  prof.push(...side(-1))
  prof.push(...arc([R - sh, -hw + sh], sh, -Math.PI / 2, 0, 6).slice(1))
  const grooves = s.width > 0.3 ? [-0.11, -0.04, 0.04, 0.11] : [-0.075, 0, 0.075]
  const tread: Prof = []
  const gx = (x: number): number => Math.min(...grooves.map((g) => Math.abs(x - g)))
  const nt = Math.round(60 * s.quality)
  for (let i = 0; i <= nt; i++) {
    const x = -hw + sh + ((2 * (hw - sh)) * i) / nt
    const crown = -0.004 * (x / hw) ** 2
    const d = gx(x)
    const depth = d < 0.006 ? 0.008 : d < 0.009 ? 0.008 * (1 - (d - 0.006) / 0.003) : 0
    tread.push([R + crown - depth, x])
  }
  prof.push(...tread.slice(1))
  prof.push(...arc([R - sh, hw - sh], sh, 0, Math.PI / 2, 6).slice(1))
  prof.push(...side(1).reverse())
  prof.push([bead - 0.004, hw - 0.016], [s.rim - 0.004, hw - 0.03])
  return prof
}

export function buildWheel(s: WheelSpec): WheelParts {
  const segs = Math.round(192 * s.quality)
  const hw = s.width / 2
  const R = s.radius
  const ground = -(R - s.flat)
  const tb = new MeshBuilder()
  lathe(tb, tireProfile(s), segs, (p, n) => {
    if (p[1] >= ground) {
      const near = Math.max(0, 1 - (p[1] - ground) / 0.05)
      const bulge = near * near * s.flat * 0.8 * Math.sign(p[0]) * (Math.abs(p[0]) > hw - 0.05 ? 1 : 0)
      return [[p[0] + bulge, p[1], p[2]], n]
    }
    const k = ground / p[1]
    const z = p[2] * (1 + (1 - k) * 0.6)
    return [[p[0] * 1.0 + Math.sign(p[0]) * (p[1] - ground) * -0.15, ground, z], norm([n[0] * 0.3, -1, n[2] * 0.2])]
  })
  const rb = new MeshBuilder()
  const rim = s.rim
  const lip = rim + 0.014
  const ox = hw - 0.004
  lathe(
    rb,
    [
      [rim - 0.014, -hw + 0.03],
      [rim - 0.004, -hw + 0.02],
      [lip, -hw + 0.012],
      [lip, -hw + 0.004],
      [rim, -hw + 0.0],
      [rim - 0.012, -hw + 0.02],
      [rim - 0.012, ox - 0.03],
      [rim, ox - 0.005],
      [lip - 0.002, ox],
      [lip, ox + 0.006],
      [lip - 0.006, ox + 0.012],
      [rim - 0.012, ox + 0.006],
      [rim - 0.03, ox - 0.01],
    ].reverse() as Prof,
    segs,
  )
  const face = ox - 0.012
  const dish = 0.05
  const hub = 0.085
  const spokes = 5
  for (let k = 0; k < spokes; k++) {
    const th0 = (k / spokes) * Math.PI * 2
    for (const side of [-1, 1]) {
      const n = 14
      const rows: Array<{ p: V3; t: V3; w: number; d: number }> = []
      for (let i = 0; i <= n; i++) {
        const t = i / n
        const r = hub + (rim - 0.025 - hub) * t
        const split = Math.max(0, (t - 0.35) / 0.65)
        const th = th0 + side * (0.055 + 0.16 * split * split)
        const x = face - dish * (1 - t) * (1 - t) * 0.6 - dish * 0.4 * (1 - t)
        rows.push({ p: [x, r * Math.sin(th), r * Math.cos(th)], t: [0, Math.cos(th), -Math.sin(th)], w: 0.016 + 0.006 * (1 - t), d: 0.03 + 0.02 * (1 - t) })
      }
      const ring = (row: (typeof rows)[number]): V3[] => {
        const { p, t, w, d } = row
        return [
          [p[0], p[1] - t[1] * w, p[2] - t[2] * w],
          [p[0], p[1] + t[1] * w, p[2] + t[2] * w],
          [p[0] - d, p[1] + t[1] * w * 0.8, p[2] + t[2] * w * 0.8],
          [p[0] - d, p[1] - t[1] * w * 0.8, p[2] - t[2] * w * 0.8],
        ]
      }
      const rings = rows.map(ring)
      for (let f = 0; f < 4; f++) {
        const f1 = (f + 1) % 4
        const nrm = (i: number): V3 => {
          const a = rings[i][f]
          const b = rings[i][f1]
          const mid: V3 = [(a[0] + b[0]) / 2 - rows[i].p[0] + rows[i].d / 2, (a[1] + b[1]) / 2 - rows[i].p[1], (a[2] + b[2]) / 2 - rows[i].p[2]]
          return norm(mid)
        }
        rb.grid(n + 1, 2, (i, j) => ({ p: rings[i][j === 0 ? f : f1], n: nrm(i) }), false, side < 0)
      }
    }
  }
  lathe(
    rb,
    [
      [0.001, face + 0.008],
      [0.035, face + 0.008],
      [0.045, face + 0.002],
      [hub + 0.01, face - 0.035],
      [hub + 0.01, face - 0.09],
    ],
    segs,
  )
  for (let k = 0; k < 5; k++) {
    const th = (k / 5) * Math.PI * 2 + Math.PI / 5
    const c: V3 = [0, 0.06 * Math.sin(th), 0.06 * Math.cos(th)]
    const bolt = new MeshBuilder()
    lathe(bolt, [[0.0001, face - 0.0], [0.009, face - 0.0], [0.011, face - 0.006], [0.011, face - 0.03]], 16)
    const g = bolt.geometry()
    g.translate(c[0], c[1], c[2])
    appendGeometry(rb, g)
  }
  const db = new MeshBuilder()
  const dr = s.disc.radius
  const dt = s.disc.thickness
  const dx = face - 0.13
  lathe(
    db,
    [
      [dr * 0.6, dx - dt / 2],
      [dr, dx - dt / 2],
      [dr, dx + dt / 2],
      [dr * 0.6, dx + dt / 2],
    ],
    segs,
  )
  const hb = new MeshBuilder()
  lathe(
    hb,
    [
      [0.03, face - 0.09],
      [dr * 0.62, face - 0.09],
      [dr * 0.62, dx + dt / 2 + 0.002],
      [dr * 0.66, dx + dt / 2 + 0.002],
      [dr * 0.66, dx - dt / 2],
    ],
    segs,
  )
  const cb = new MeshBuilder()
  const a0 = s.caliperAngle - s.caliperLength / 2
  const a1 = s.caliperAngle + s.caliperLength / 2
  const r0 = dr * 0.68
  const r1 = dr + 0.022
  const x0 = dx - dt / 2 - 0.05
  const x1 = dx + dt / 2 + 0.035
  const sect: Array<[number, number]> = []
  for (let i = 0; i <= 12; i++) {
    const t = (i / 12) * Math.PI * 2
    const c = Math.cos(t)
    const sn = Math.sin(t)
    const e = 0.35
    const sx = Math.sign(c) * Math.abs(c) ** e
    const sy = Math.sign(sn) * Math.abs(sn) ** e
    sect.push([(r0 + r1) / 2 + ((r1 - r0) / 2) * sy, (x0 + x1) / 2 + ((x1 - x0) / 2) * sx])
  }
  const n = 16
  cb.grid(
    n + 1,
    sect.length,
    (i, j) => {
      const t = i / n
      const a = a0 + (a1 - a0) * t
      const taper = 1 - 0.5 * (2 * t - 1) ** 8
      const [r, x] = sect[j]
      const rm = (r0 + r1) / 2
      const rr = rm + (r - rm) * taper
      const xm = (x0 + x1) / 2
      const xx = xm + (x - xm) * taper
      return { p: [xx, rr * Math.sin(a), rr * Math.cos(a)], n: norm([x - xm, (r - rm) * Math.sin(a), (r - rm) * Math.cos(a)]) }
    },
    true,
    true,
  )
  return { tire: tb.geometry(), rim: rb.geometry(), disc: db.geometry(), hat: hb.geometry(), caliper: cb.geometry(), face: [face + 0.008, 0, 0] }
}
