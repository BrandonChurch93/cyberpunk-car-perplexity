import * as T from 'three'
import { stream } from '../core/random'
import { patchMaterial } from '../materials/patch'
import { frontWheel, rearWheel, type WheelSize } from './body'
import { add, curve, joined, mix, patch, polygon, smooth, tau, type Point } from './geometry'
import type { Palette } from './materials'

type Profile = ReadonlyArray<readonly [number, number]>
type Pt2 = readonly [number, number]
interface LoopSample {
  readonly p: Pt2
  readonly n: Pt2
}

const axisRoll = (axis: number, radius: number, theta: number): Point => [axis, Math.cos(theta) * radius, Math.sin(theta) * radius]
const polar2 = (radius: number, theta: number): Pt2 => [Math.cos(theta) * radius, Math.sin(theta) * radius]
const local2 = (theta: number, radial: number, tangent: number): Pt2 => [
  Math.cos(theta) * radial - Math.sin(theta) * tangent,
  Math.sin(theta) * radial + Math.cos(theta) * tangent,
]

function lathe(profile: Profile, segments: number): T.BufferGeometry {
  return new T.LatheGeometry(profile.map(([a, r]) => new T.Vector2(r, a)), segments).rotateZ(-Math.PI / 2)
}

function disk(radius: number, depth: number, x: number, segments = 40): T.BufferGeometry {
  return new T.CylinderGeometry(radius, radius, depth, segments).rotateZ(-Math.PI / 2).translate(x, 0, 0)
}

function treadInset(w: WheelSize, r: number): number {
  return (w === frontWheel ? .016 : .005) * smooth(r, w.radius - .051, w.radius - .012)
}

function tireShell(w: WheelSize) {
  const H = w.width / 2
  const cross = curve([
    [0, w.rim - .009], [.035, w.rim + .0065], [.062, w.rim + .011], [.14, w.radius - .052],
    [.21, w.radius - .022], [.27, w.radius - .0075], [.34, w.radius - .0010], [.39, w.radius],
    [.61, w.radius], [.66, w.radius - .0010], [.73, w.radius - .0075], [.79, w.radius - .022],
    [.86, w.radius - .052], [.938, w.rim + .011], [.965, w.rim + .0065], [1, w.rim - .009],
  ])
  const width = curve([
    [0, -.86], [.032, -.978], [.058, -.958], [.145, -1.008], [.215, -.980], [.27, -.925],
    [.50, 0], [.73, .925], [.785, .980], [.855, 1.008], [.942, .958], [.968, .982], [1, .86],
  ])
  const axial = (v: number) => {
    if (v < .27 || v > .73) return width(v) * H
    return mix(-.925, .925, (v - .27) / .46) * H
  }
  const place = (u: number, v: number, depthOffset: number, extraX = 0): Point => {
    const th = u * tau
    const p = axisRoll(axial(v) + extraX, cross(v) - depthOffset, th)
    const sv = v > .5 ? v : 1 - v
    const cheek = Math.sin(Math.PI * T.MathUtils.clamp((sv - .725) / .225, 0, 1)) ** 1.15
    const footChord = Math.exp(-((p[2] / .098) ** 2))
    const shoulderSpan = 1 - smooth(Math.abs(v - .5), .245, .315)
    const loadPress = .0042 * footChord * smooth(-p[1], w.loaded - .062, w.loaded - .004) * shoulderSpan
    const bellyZone = Math.exp(-((p[2] / .102) ** 2)) * smooth(-p[1], w.loaded - .102, w.loaded - .024)
    const cheekSag = .0048 * bellyZone * cheek
    const rawGround = p[1] - loadPress - cheekSag + w.loaded
    const h = .0135
    const s = rawGround / h
    const cushion = rawGround <= 0 ? 0 : rawGround >= h ? rawGround : h * s * s * (2 - s)
    const bulge = .0138 * bellyZone * cheek * Math.sign(p[0])
    const outerInset = smooth(v, .46, .66) * treadInset(w, cross(v))
    return [p[0] + bulge - outerInset, cushion - w.loaded, p[2]]
  }
  return { place }
}

function tireGeometry(w: WheelSize, full: boolean, hero = w === frontWheel): T.BufferGeometry {
  const { place } = tireShell(w)
  const front = w === frontWheel
  const grooves = [.346, .452, .558, .658]
  const block = (p: number, narrow: number, wide: number) => 1 - smooth(Math.abs(p - Math.round(p)), narrow, wide)
  const depth = (u: number, v: number): number => {
    const groove = grooves.reduce((r, g) => Math.max(r, 1 - smooth(Math.abs(v - g), .0066, .0148)), 0)
    const shoulderGroove = 1 - smooth(Math.abs(v - .700), .0024, .0064)
    if (!full) {
      return Math.max(.0076 * groove, .0026 * shoulderGroove)
    }
    const pitch = u * 48
    const inner = block(pitch + .35 - (v - .346) * 2.3, .040, .098)
      * smooth(v, .262, .284) * (1 - smooth(v, .330, .342))
    const dv = Math.max(0, v - .660)
    const outerSlot = block(pitch + dv * 2.5 + dv * dv * 8.0, .042, .100)
      * smooth(v, .660, .672) * (1 - smooth(v, .726, .762))
    const ribOuter = block(pitch - .24 + (v - .608) * 2.2, .036, .092)
      * smooth(v, .570, .582) * (1 - smooth(v, .642, .654))
    const ribMid = block(pitch + .18 - (v - .505) * 2.0, .034, .088)
      * smooth(v, .466, .478) * (1 - smooth(v, .542, .554))
    const ribInner = block(pitch - .36 + (v - .399) * 2.0, .034, .088)
      * smooth(v, .360, .372) * (1 - smooth(v, .436, .448))
    return Math.max(
      .0076 * groove,
      .0028 * shoulderGroove,
      .0022 * inner,
      .0025 * outerSlot,
      .0020 * ribOuter,
      .0018 * ribMid,
      .0018 * ribInner,
    )
  }
  const rows = [...new Set(full
    ? [
        ...Array.from({ length: 49 }, (_, i) => i / 48),
        ...grooves.flatMap((v) => [v - .0148, v - .0066, v + .0066, v + .0148]),
        .035, .060, .262, .276, .308,
        .672, .684, .694, .700, .707, .716, .728, .742, .756, .768, .792,
        .833, .855, .885, .913, .948, .966, .981,
      ]
    : hero
      ? [
          0, .276,
          ...grooves.flatMap((v) => [v - .0148, v, v + .0148]),
          .700, .728, .762, .802, .833, .873, .913, .952, 1,
        ]
      : [0, .22, .36, .50, .64, .74, .84, .94, 1],
  )].sort((a, b) => a - b)
  const uSteps = full ? (front ? 480 : 288) : (hero ? 128 : 36)
  const geom = patch((u, v) => place(u, v, depth(u, v)), uSteps, rows.length - 1, [0, -1, 0], 0, (_, i) => rows[i])
  const cavity = new Float32Array((uSteps + 1) * rows.length)
  const tireUv = new Float32Array((uSteps + 1) * rows.length * 2)
  let ptr = 0
  let uvPtr = 0
  for (let j = 0; j < rows.length; j++) {
    const v = rows[j]
    for (let i = 0; i <= uSteps; i++) {
      const u = i / uSteps
      cavity[ptr++] = Math.min(1, depth(u, v) / .0076)
      tireUv[uvPtr++] = u
      tireUv[uvPtr++] = v
    }
  }
  geom.setAttribute('tireCavity', new T.Float32BufferAttribute(cavity, 1))
  geom.setAttribute('tireUv', new T.Float32BufferAttribute(tireUv, 2))
  return geom
}

function sidewallReliefGeometry(w: WheelSize, full: boolean, hero = w === frontWheel): T.BufferGeometry {
  const { place } = tireShell(w)
  const uSteps = full ? (w === frontWheel ? 360 : 240) : (hero ? 72 : 28)
  const bandKnots: Profile = full
    ? [
        [.833, -.0008], [.837, .00160], [.843, .00160], [.847, .00065],
        [.869, .00065], [.872, .00128], [.875, .00128], [.878, .00065],
        [.899, .00065], [.903, .00160], [.909, .00160], [.913, -.0008],
      ]
    : [
        [.833, -.0008], [.840, .00160], [.847, .00065], [.873, .00128],
        [.899, .00065], [.906, .00160], [.913, -.0008],
      ]
  const beadKnots: Profile = full
    ? [[.948, -.0008], [.955, .00135], [.966, .00140], [.974, .00070], [.981, -.0008]]
    : [[.948, -.0008], [.960, .00140], [.973, .00070], [.981, -.0008]]
  const buildBand = (knots: Profile) => patch(
    (u, s) => {
      const idx = T.MathUtils.clamp(s * (knots.length - 1), 0, knots.length - 1)
      const i = Math.min(knots.length - 2, Math.floor(idx)), f = idx - i
      const v = mix(knots[i][0], knots[i + 1][0], f)
      const h = mix(knots[i][1], knots[i + 1][1], f)
      return place(u, v, 0, h)
    },
    uSteps,
    knots.length - 1,
    [1, 0, 0],
  )
  return joined([buildBand(bandKnots), buildBand(beadKnots)])
}

function rotor(w: WheelSize, full: boolean, axis: number, hero = w === frontWheel): [T.BufferGeometry, T.BufferGeometry, T.BufferGeometry] {
  const front = w === frontWheel
  const face = new T.Shape()
  const segments = full ? 180 : (hero ? 96 : 36)
  const radius = w.disc, ring = .104, lip = radius - .0018
  face.moveTo(lip, 0)
  for (let i = 1; i < segments; i++) {
    const theta = tau * i / segments
    face.lineTo(lip * Math.cos(theta), lip * Math.sin(theta))
  }
  face.closePath()
  const center = new T.Path()
  center.moveTo(ring, 0)
  for (let i = 1; i < segments / 2; i++) {
    const theta = -tau * i / (segments / 2)
    center.lineTo(ring * Math.cos(theta), ring * Math.sin(theta))
  }
  center.closePath()
  face.holes.push(center)
  const bevels: T.BufferGeometry[] = []
  const wells: T.BufferGeometry[] = []
  const count = (full || hero) ? 24 : 8
  const drillRows = (full || hero) ? 4 : 2
  const edges = full ? (front ? 14 : 10) : (hero ? 10 : 5)
  const qOuter = (full || hero) ? .0043 : .0036
  const qInner = .0032
  for (let i = 0; i < count; i++) for (let j = 0; j < drillRows; j++) {
    const a = (i / count) * tau + .043 * j + .0105 * j ** 2
    const r = radius - .018 - .018 * j
    const drill = new T.Path(), y = Math.sin(a) * r, z = -Math.cos(a) * r
    for (let k = 0; k < edges; k++) {
      const phi = -tau * k / edges
      if (k === 0) drill.moveTo(-z + qOuter, y)
      else drill.lineTo(-z + qOuter * Math.cos(phi), y + qOuter * Math.sin(phi))
    }
    drill.closePath()
    face.holes.push(drill)
    if (full || hero) {
      bevels.push(patch((u, v) => {
        const phi = -u * tau, q = mix(qOuter, qInner, v)
        return [axis + .00002 - .00095 * v, y + q * Math.sin(phi), z - q * Math.cos(phi)]
      }, edges, 1, [1, 0, 0]))
    }
    wells.push(patch((u, v) => {
      const phi = -u * tau, q = mix(qInner, .0027, v)
      return [axis - .00095 - .0065 * v, y + q * Math.sin(phi), z - q * Math.cos(phi)]
    }, edges, 1, [1, 0, 0]))
  }
  const rear = axis - w.discDepth, cheek = .0090
  const back = lathe([[rear, ring], [rear, lip], [rear + .0018, radius], [rear + cheek, radius], [rear + cheek, ring]], full ? segments : 16)
  const vaneCount = full ? 40 : (hero ? 32 : 10)
  const edgeVanes: T.BufferGeometry[] = []
  for (let i = 0; i < vaneCount; i++) {
    const a = tau * i / vaneCount + .04
    const thick = .0038
    const halfAng = (.5 * thick) / radius
    edgeVanes.push(patch(
      (u, v) => axisRoll(mix(rear + cheek + .0005, axis - cheek - .0005, v), mix(radius - .0145, radius - .0002, u), a + halfAng),
      1,
      1,
      [0, -Math.sin(a), Math.cos(a)],
      thick,
    ))
  }
  const ceramic = joined([
    new T.ShapeGeometry(face, 1).rotateY(Math.PI / 2).translate(axis + .00002, 0, 0),
    ...bevels,
    lathe([[axis - cheek, ring], [axis - cheek, radius], [axis - .0018, radius], [axis, lip]], segments),
    back,
    ...edgeVanes,
  ])
  const slotFloor = lathe([
    [rear + cheek, .122], [rear + cheek, radius - .0148],
    [axis - cheek, radius - .0148], [axis - cheek, .122],
  ], full ? 80 : (hero ? 36 : 16))
  return [ceramic, joined([...wells, slotFloor]), lathe([
    [axis - .008, .115], [axis - .004, .112], [axis - .004, .105], [axis - .015, .104],
    [axis - .015, .098], [axis - .009, .088], [axis - .005, .081], [axis - .005, .047],
  ], full ? segments / 2 : (hero ? 40 : 20))]
}

function filletConvexCCW(pts: readonly Pt2[], radii: readonly number[], cornerSegs: number, maxEdge = .0075): LoopSample[] {
  const m = pts.length
  const corners: { s1: Pt2; s2: Pt2; arc: LoopSample[] }[] = []
  for (let i = 0; i < m; i++) {
    const prev = pts[(i - 1 + m) % m], cur = pts[i], next = pts[(i + 1) % m]
    let d1x = cur[0] - prev[0], d1y = cur[1] - prev[1]
    let d2x = next[0] - cur[0], d2y = next[1] - cur[1]
    const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y)
    d1x /= l1; d1y /= l1; d2x /= l2; d2y /= l2
    const cross = d1x * d2y - d1y * d2x
    if (cross < 1e-4 || radii[i] <= 1e-5) {
      const nx = (d1y + d2y) * .5, ny = -(d1x + d2x) * .5, nl = Math.hypot(nx, ny) || 1
      corners.push({ s1: cur, s2: cur, arc: [{ p: cur, n: [nx / nl, ny / nl] }] })
      continue
    }
    const dot = T.MathUtils.clamp(-d1x * d2x - d1y * d2y, -.999, .999)
    const halfA = .5 * Math.acos(dot)
    const maxTan = .46 * Math.min(l1, l2)
    const rad = Math.min(radii[i], maxTan * Math.tan(halfA))
    const tanLen = rad / Math.tan(halfA)
    const s1: Pt2 = [cur[0] - d1x * tanLen, cur[1] - d1y * tanLen]
    const s2: Pt2 = [cur[0] + d2x * tanLen, cur[1] + d2y * tanLen]
    const cx = s1[0] - d1y * rad, cy = s1[1] + d1x * rad
    const a0 = Math.atan2(s1[1] - cy, s1[0] - cx)
    let a1 = Math.atan2(s2[1] - cy, s2[0] - cx)
    while (a1 < a0) a1 += tau
    const arc: LoopSample[] = []
    for (let j = 0; j <= cornerSegs; j++) {
      const a = mix(a0, a1, j / cornerSegs)
      const nx = Math.cos(a), ny = Math.sin(a)
      arc.push({ p: [cx + nx * rad, cy + ny * rad], n: [nx, ny] })
    }
    corners.push({ s1, s2, arc })
  }
  const out: LoopSample[] = []
  for (let i = 0; i < m; i++) {
    const cur = corners[i], next = corners[(i + 1) % m]
    out.push(...cur.arc)
    const ex = next.s1[0] - cur.s2[0], ey = next.s1[1] - cur.s2[1]
    const elen = Math.hypot(ex, ey)
    const steps = Math.max(1, Math.ceil(elen / maxEdge))
    if (steps > 1 && elen > 1e-5) {
      const nx = ey / elen, ny = -ex / elen
      for (let k = 1; k < steps; k++) {
        const t = k / steps
        out.push({ p: [cur.s2[0] + ex * t, cur.s2[1] + ey * t], n: [nx, ny] })
      }
    }
  }
  return out
}

function circleLoopCCW(center: Pt2, radius: number, segments: number): LoopSample[] {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * tau
    const nx = Math.cos(a), ny = Math.sin(a)
    return { p: [center[0] + nx * radius, center[1] + ny * radius], n: [nx, ny] }
  })
}

function sweepLoopRibbon(
  loop: readonly LoopSample[],
  stations: ReadonlyArray<readonly [number, number]>,
  baseX: (y: number, z: number) => number,
): T.BufferGeometry {
  const m = loop.length, rows = stations.length
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  const arcU: number[] = [0]
  for (let i = 1; i <= m; i++) {
    const a = loop[i - 1].p, b = loop[i % m].p
    arcU.push(arcU[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  for (let j = 0; j < rows; j++) {
    const [offset, dx] = stations[j]
    for (let i = 0; i <= m; i++) {
      const { p, n } = loop[i % m]
      const y = p[0] + n[0] * offset, z = p[1] + n[1] * offset
      pos.push(baseX(y, z) + dx, y, z)
      uv.push(arcU[i], offset)
    }
  }
  const stride = m + 1
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < m; i++) {
      const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1
      idx.push(a, c, d, a, d, b)
    }
  }
  const g = new T.BufferGeometry()
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function refineInterior2D(verts: Pt2[], tris: [number, number, number][], maxEdge: number, passes: number): void {
  const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`)
  for (let pass = 0; pass < passes; pass++) {
    const counts = new Map<string, [number, number, number]>()
    for (const [a, b, c] of tris) {
      for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
        const k = edgeKey(u, v)
        const cur = counts.get(k)
        if (cur) cur[2]++
        else counts.set(k, [u, v, 1])
      }
    }
    const mids = new Map<string, number>()
    for (const [k, [u, v, count]] of counts) {
      if (count !== 2) continue
      const pu = verts[u], pv = verts[v]
      if (Math.hypot(pu[0] - pv[0], pu[1] - pv[1]) <= maxEdge) continue
      mids.set(k, verts.length)
      verts.push([(pu[0] + pv[0]) * .5, (pu[1] + pv[1]) * .5])
    }
    if (mids.size === 0) break
    const next: [number, number, number][] = []
    for (const [a, b, c] of tris) {
      const mab = mids.get(edgeKey(a, b)), mbc = mids.get(edgeKey(b, c)), mca = mids.get(edgeKey(c, a))
      if (mab !== undefined && mbc !== undefined && mca !== undefined) {
        next.push([a, mab, mca], [mab, b, mbc], [mca, mbc, c], [mab, mbc, mca])
      } else if (mab !== undefined && mbc !== undefined) {
        next.push([a, mab, c], [mab, mbc, c], [mab, b, mbc])
      } else if (mbc !== undefined && mca !== undefined) {
        next.push([a, b, mbc], [a, mbc, mca], [mca, mbc, c])
      } else if (mca !== undefined && mab !== undefined) {
        next.push([a, mab, mca], [mab, b, c], [mab, c, mca])
      } else if (mab !== undefined) {
        next.push([a, mab, c], [mab, b, c])
      } else if (mbc !== undefined) {
        next.push([a, b, mbc], [a, mbc, c])
      } else if (mca !== undefined) {
        next.push([a, b, mca], [mca, b, c])
      } else {
        next.push([a, b, c])
      }
    }
    tris.length = 0
    tris.push(...next)
  }
}

function buildPlanarSurface(
  outer: readonly Pt2[],
  holes: ReadonlyArray<readonly Pt2[]>,
  heightAt: (y: number, z: number) => number,
  outwardSign: 1 | -1,
  maxInteriorEdge: number,
  passes = 2,
): T.BufferGeometry {
  const contour = outer.map(([y, z]) => new T.Vector2(y, z))
  const holeVecs = holes.map((h) => h.map(([y, z]) => new T.Vector2(y, z)))
  const rawFaces = T.ShapeUtils.triangulateShape(contour, holeVecs)
  const verts: Pt2[] = [...contour, ...holeVecs.flat()].map((v) => [v.x, v.y])
  const tris: [number, number, number][] = rawFaces.map(([a, b, c]) => {
    const pa = verts[a], pb = verts[b], pc = verts[c]
    const area2 = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])
    return (area2 * outwardSign > 0 ? [a, b, c] : [a, c, b]) as [number, number, number]
  })
  if (maxInteriorEdge > 0) refineInterior2D(verts, tris, maxInteriorEdge, passes)
  const pos: number[] = [], nrm: number[] = [], uv: number[] = []
  const eps = .0006
  for (const [y, z] of verts) {
    const x = heightAt(y, z)
    const dxdy = (heightAt(y + eps, z) - heightAt(y - eps, z)) / (2 * eps)
    const dxdz = (heightAt(y, z + eps) - heightAt(y, z - eps)) / (2 * eps)
    const nx = outwardSign, ny = -dxdy * outwardSign, nz = -dxdz * outwardSign
    const nl = Math.hypot(nx, ny, nz) || 1
    pos.push(x, y, z)
    nrm.push(nx / nl, ny / nl, nz / nl)
    uv.push(y, z)
  }
  const g = new T.BufferGeometry()
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new T.Float32BufferAttribute(nrm, 3))
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
  g.setIndex(tris.flat())
  return g
}

function forgedWheelAssembly(w: WheelSize, full: boolean, hero = w === frontWheel): {
  satinWeb: T.BufferGeometry
  forging: T.BufferGeometry
  barrel: T.BufferGeometry
  machinedSpokes: T.BufferGeometry
  flange: T.BufferGeometry
  hub: T.BufferGeometry
  cap: T.BufferGeometry
  lugs: T.BufferGeometry
} {
  const front = hero
  const H = w.width / 2, R = w.rim
  const face = H - .008, hubPlane = face - .030, hubFace = hubPlane + .0018
  const rCap = .148 * R, rCollar = .161 * R
  const rHubInner = .248 * R, rHubOuter = .260 * R
  const rWebOuter = R - .0035
  const rWinOuter = R - .0124
  const theta0 = w === frontWheel ? 1.18 : .56
  const branchSpan = .456
  const stemRootHalf = .064 * R
  const stemForkHalf = .052 * R
  const branchBaseHalf = .045 * R
  const rPentInner = .284 * R
  const rPentArc = .296 * R
  const rFork = .425 * R
  const rForkJoin = .955 * R
  const tDraft = .0024, tChamfer = .0031, tSeam = tDraft + tChamfer

  const f0 = polar2(rFork, 0), j0 = polar2(rForkJoin, branchSpan)
  const bdx = j0[0] - f0[0], bdy = j0[1] - f0[1], blen = Math.hypot(bdx, bdy)
  const bux = bdx / blen, buy = bdy / blen
  const nInX = buy, nInY = -bux
  const triEdgePt: Pt2 = [f0[0] + nInX * branchBaseHalf, f0[1] + nInY * branchBaseHalf]
  const crotchR = triEdgePt[0] - (triEdgePt[1] / buy) * bux
  const triB = 2 * crotchR * bux, triC = crotchR * crotchR - rWinOuter * rWinOuter
  const sTri = (-triB + Math.sqrt(Math.max(0, triB * triB - 4 * triC))) * .5
  const triHalfAngle = Math.atan2(sTri * buy, crotchR + sTri * bux)

  const pentOuterPt: Pt2 = [f0[0] - nInX * branchBaseHalf, f0[1] - nInY * branchBaseHalf]
  const sElbow = (stemForkHalf - pentOuterPt[1]) / buy
  const elbowX = pentOuterPt[0] + sElbow * bux
  const pDot = pentOuterPt[0] * bux + pentOuterPt[1] * buy
  const pC = pentOuterPt[0] * pentOuterPt[0] + pentOuterPt[1] * pentOuterPt[1] - rWinOuter * rWinOuter
  const sPentOuter = -pDot + Math.sqrt(Math.max(0, pDot * pDot - pC))
  const pentBranchOuterAngle = Math.atan2(pentOuterPt[1] + sPentOuter * buy, pentOuterPt[0] + sPentOuter * bux)

  const windowLoops: LoopSample[][] = []
  const lugCenters: Pt2[] = []
  const lugLoops: LoopSample[][] = []
  const rLug = .204 * R, rLugWell = .0066, tLugSeam = .0014
  const cornerSegs = full ? 16 : (front ? 7 : 2)
  const maxLoopEdge = full ? .0055 : (front ? .015 : .045)
  const rimArcPts = (a0: number, a1: number, count: number): { pts: Pt2[]; radii: number[] } => {
    const pad = .088
    const pts: Pt2[] = [polar2(rWinOuter, a0)]
    const radii: number[] = [.0148]
    if (a1 - a0 > 2 * pad && count > 1) {
      for (let m = 0; m < count; m++) {
        pts.push(polar2(rWinOuter, mix(a0 + pad, a1 - pad, count === 1 ? .5 : m / (count - 1))))
        radii.push(0)
      }
    }
    pts.push(polar2(rWinOuter, a1))
    radii.push(.0148)
    return { pts, radii }
  }
  const arcSub = full ? 9 : (front ? 4 : 0)

  for (let k = 0; k < 5; k++) {
    const th = theta0 + (k / 5) * tau
    const thNext = th + tau / 5

    const aPent0 = th + pentBranchOuterAngle
    const aPent1 = thNext - pentBranchOuterAngle
    const pentOuterArc = rimArcPts(aPent0, aPent1, arcSub)
    const pentPts: Pt2[] = [
      local2(th, rPentInner, stemRootHalf),
      local2(th, elbowX, stemForkHalf),
      ...pentOuterArc.pts,
      local2(thNext, elbowX, -stemForkHalf),
      local2(thNext, rPentInner, -stemRootHalf),
      polar2(rPentArc, (th + thNext) * .5),
    ]
    const pentRadii = [.0132, .0165, ...pentOuterArc.radii, .0165, .0132, .085]
    windowLoops.push(filletConvexCCW(pentPts, pentRadii, cornerSegs, maxLoopEdge))

    const triOuterArc = rimArcPts(th - triHalfAngle, th + triHalfAngle, arcSub)
    const triPts: Pt2[] = [
      polar2(crotchR, th),
      ...triOuterArc.pts,
    ]
    const triRadii = [.0116, ...triOuterArc.radii]
    windowLoops.push(filletConvexCCW(triPts, triRadii, cornerSegs, maxLoopEdge))

    const lugCenter = polar2(rLug, th + tau / 10)
    lugCenters.push(lugCenter)
    lugLoops.push(circleLoopCCW(lugCenter, rLugWell, full ? 20 : (front ? 12 : 8)))
  }

  const hubBowlX = hubPlane + .0042
  const dishAt = (r: number): number => mix(hubPlane + .0068, face - .0008, smooth(r, rHubOuter, rWebOuter) ** .76)
  const backAt = (r: number): number => dishAt(r) - .0135
  const webHeight = (y: number, z: number): number => dishAt(Math.hypot(y, z))
  const backHeight = (y: number, z: number): number => backAt(Math.hypot(y, z))
  const hubFlatHeight = (): number => hubBowlX

  const collarLoop = circleLoopCCW([0, 0], rCollar, full ? 48 : (front ? 28 : 16))
  const collarSeamOffset = .0018
  const collarSeamPts = collarLoop.map(({ p, n }) => [p[0] + n[0] * collarSeamOffset, p[1] + n[1] * collarSeamOffset] as Pt2)

  const hubDiscSegs = full ? 72 : (front ? 36 : 18)
  const hubInnerPts = Array.from({ length: hubDiscSegs }, (_, i) => polar2(rHubInner, (i / hubDiscSegs) * tau))
  const hubOuterLoop = circleLoopCCW([0, 0], rHubOuter, hubDiscSegs)
  const hubOuterPts = hubOuterLoop.map(({ p }) => p)

  const barrelCount = full ? 180 : (front ? 75 : 30)
  const outerCount = barrelCount
  const outerWebPts = Array.from({ length: outerCount }, (_, i) => polar2(rWebOuter, (i / outerCount) * tau))
  const windowSeamHoles = windowLoops.map((loop) => loop.map(({ p, n }) => [p[0] + n[0] * tSeam, p[1] + n[1] * tSeam] as Pt2))
  const lugSeamHoles = lugLoops.map((loop) => loop.map(({ p, n }) => [p[0] + n[0] * tLugSeam, p[1] + n[1] * tLugSeam] as Pt2))

  const frontWeb = buildPlanarSurface(
    outerWebPts,
    [hubOuterPts, ...windowSeamHoles],
    webHeight,
    1,
    full ? .0085 : 0,
    full ? 2 : 0,
  )
  const hubDisc = buildPlanarSurface(
    hubInnerPts,
    [collarSeamPts, ...lugSeamHoles],
    hubFlatHeight,
    1,
    0,
  )
  const xHubOuter = dishAt(rHubOuter)
  const hubStepWall = lathe([
    [xHubOuter, rHubOuter],
    [mix(hubBowlX, xHubOuter, .76), mix(rHubInner, rHubOuter, .72)],
    [mix(hubBowlX, xHubOuter, .20), mix(rHubInner, rHubOuter, .26)],
    [hubBowlX, rHubInner],
  ], hubDiscSegs)

  const forgedParts: T.BufferGeometry[] = [hubDisc, hubStepWall]
  if (full || hero) {
    const backCollarPts = collarLoop.map(({ p }) => p)
    const backWindowHoles = windowLoops.map((loop) => loop.map(({ p, n }) => [p[0] + n[0] * .0006, p[1] + n[1] * .0006] as Pt2))
    forgedParts.unshift(buildPlanarSurface(outerWebPts, [backCollarPts, ...backWindowHoles], backHeight, -1, 0))
  }
  const machinedParts: T.BufferGeometry[] = []

  for (const loop of windowLoops) {
    const sidewall: Profile = full
      ? [[.0006, -.0135], [0, -.0126], [.0008, -.0074], [tDraft, -.0027]]
      : [[.0006, -.0135], [0, -.0126], [tDraft, -.0027]]
    const chamfer: Profile = full
      ? [[tDraft, -.0027], [tDraft + .0009, -.0013], [tDraft + .0020, -.00035], [tSeam, 0]]
      : front
        ? [[tDraft, -.0027], [tDraft + .0013, -.0010], [tSeam, 0]]
        : [[tDraft, -.0027], [tSeam, 0]]
    forgedParts.push(sweepLoopRibbon(loop, sidewall, webHeight))
    machinedParts.push(sweepLoopRibbon(loop, chamfer, webHeight))
  }

  const bezelFloorX = hubPlane - .0012
  machinedParts.push(sweepLoopRibbon(collarLoop, [
    [0, bezelFloorX - hubBowlX],
    [.0009, .0007],
    [collarSeamOffset, 0],
  ], hubFlatHeight))

  const lugFloorX = hubPlane - .0028
  for (let k = 0; k < 5; k++) {
    const loop = lugLoops[k]
    forgedParts.push(
      sweepLoopRibbon(loop, [[0, lugFloorX - hubBowlX], [.0007, -.0011]], hubFlatHeight),
      polygon(loop.map(({ p }) => [lugFloorX, p[0], p[1]] as Point), [1, 0, 0]),
    )
    machinedParts.push(sweepLoopRibbon(loop, [[.0007, -.0011], [tLugSeam, 0]], hubFlatHeight))
  }

  // Connected stepped barrel behind the outset spoke web: decreasing axial coordinates keep barrel normals inward toward the hub/lens.
  const barrel = lathe([
    [face - .012, R + .0065], [face - .0020, R + .0024], [face - .0056, R + .0020],
    [face - .0170, R - .0042], [face - .0183, R - .0108], [face - .0360, R - .0122],
    [face - .0640, R - .0142], [-.012, R - .0164], [-.064, R - .0182],
    [-w.rimWidth / 2 + .016, R - .0145], [-w.rimWidth / 2, R + .0045],
    ...(full ? [[-w.rimWidth / 2, R + .0070], [face - .012, R + .0070], [face - .012, R + .0065]] as const : []),
  ], barrelCount)

  const flange = lathe([
    [face - .0020, R + .0024], [face + .0007, R + .0014], [face + .0016, R - .0006],
    [face + .0008, R - .0024], [face - .0006, R - .0038], [face - .0014, R - .0042],
  ], barrelCount)

  const ringSegs = full ? 60 : (front ? 32 : 16)
  const hub = lathe([
    [hubPlane - .0030, rCollar + .003], [hubPlane, rCollar], [hubPlane, rCap - .002],
    [hubPlane - .0020, rCap - .003], [hubPlane - .0020, .0002],
  ], ringSegs)

  const capRing = lathe([
    [hubPlane - .0018, rCap + .0006], [hubPlane + .0013, rCap - .0008], [hubPlane + .0014, rCap - .0036],
    [hubPlane + .0005, rCap - .0050], [hubPlane + .0005, rCap * .56],
  ], ringSegs)
  const hexCapPts: Point[] = Array.from({ length: 6 }, (_, i) => axisRoll(hubFace, rCap * .44, (i / 6) * tau + theta0))
  const hexCapBase: Point[] = Array.from({ length: 6 }, (_, i) => axisRoll(hubPlane + .0005, rCap * .58, (i / 6) * tau + theta0))
  const capFacets: T.BufferGeometry[] = [polygon(hexCapPts, [1, 0, 0])]
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6
    capFacets.push(polygon([hexCapBase[i], hexCapBase[j], hexCapPts[j], hexCapPts[i]], [
      1, (hexCapBase[i][1] + hexCapBase[j][1]) * .35, (hexCapBase[i][2] + hexCapBase[j][2]) * .35,
    ]))
  }
  const cap = joined([capRing, ...capFacets])

  const lugTopX = hubPlane + .0030
  const lugGeoms: T.BufferGeometry[] = []
  for (const [ly, lz] of lugCenters) {
    const bolt = lathe([
      [lugFloorX, .0058], [lugFloorX + .0018, .0054], [lugTopX - .0005, .0048],
      [lugTopX, .0042], [lugTopX, .0026], [lugFloorX + .0016, .0022],
      [lugFloorX + .0016, .0002],
    ], full ? 12 : 8).translate(0, ly, lz)
    lugGeoms.push(bolt)
  }

  return {
    satinWeb: frontWeb,
    forging: joined(forgedParts),
    barrel,
    machinedSpokes: joined(machinedParts),
    flange,
    hub,
    cap,
    lugs: joined(lugGeoms),
  }
}

function caliper(w: WheelSize, full: boolean, axis: number, hero = w === frontWheel): [T.BufferGeometry, T.BufferGeometry, T.BufferGeometry] {
  const rear = w === rearWheel
  const middle = rear ? 1.18 : -.98
  const half = rear ? .735 : 1.05
  const low = w.disc - (rear ? .058 : .066)
  const outer = w.disc + (rear ? .026 : .025)
  const lowAt = curve([[0, .032], [.085, .012], [.21, 0], [.41, .001], [.58, .004], [.79, 0], [.92, .012], [1, .031]])
  const highAt = curve([[0, -.031], [.075, -.011], [.18, -.003], [.34, 0], [.58, .001], [.78, -.002], [.925, -.010], [1, -.032]])
  const crossPts: Profile = full
    ? [
        [.0065, .054], [.0148, .105], [.0166, .155],
        [.0169, .24], [.0169, .36], [.0169, .48], [.0169, .60], [.0168, .72],
        [.0166, .815], [.0160, .878], [.0146, .912], [.0102, .962], [.0032, .990],
        [-.012, .998], [-.036, .992], [-.053, .89], [-.058, .50],
        [-.056, .16], [-.051, .072], [-.044, .13], [-.043, .76],
        [-.033, .83], [-.012, .84], [.004, .80], [.005, .11],
      ]
    : [
        [.0065, .054], [.0148, .105], [.0166, .155], [.0169, .32], [.0169, .62],
        [.0166, .815], [.0160, .878], [.0146, .912], [.0102, .962], [.0032, .990],
        [-.012, .998], [-.036, .992], [-.053, .89], [-.058, .50],
        [-.056, .16], [-.051, .072], [-.044, .13], [-.043, .76],
        [-.033, .83], [-.012, .84], [.004, .80], [.005, .11],
      ]
  const nPts = crossPts.length
  const sampleStation = (v: number): Pt2 => {
    const s = ((v % 1) + 1) % 1 * nPts
    const i = Math.floor(s), f = s - i
    const a = crossPts[i % nPts], b = crossPts[(i + 1) % nPts]
    return [mix(a[0], b[0], f), mix(a[1], b[1], f)]
  }
  const grooveAt = (u: number, center: number, halfW: number): number => 1 - smooth(Math.abs(u - center), halfW * .24, halfW)
  const placeArch = (u: number, x: number, t: number, relief = 0): Point => {
    const a = middle + half * (2 * u - 1)
    const endCurve = smooth(u, 0, .09) * (1 - smooth(u, .91, 1))
    const endTaper = .58 + .42 * endCurve
    const noseDrop = .0038 * (1 - endCurve) * smooth(t, .55, .96)
    const radius = mix(low + lowAt(u), outer + highAt(u) - noseDrop, t)
    return axisRoll(axis + x * endTaper + relief, radius, a)
  }
  const body = (u: number, v: number): Point => {
    const [x, t] = sampleStation(v)
    const cheekMask = smooth(x, .010, .0162) * smooth(t, .16, .34) * (1 - smooth(t, .68, .86))
    const flutes = Math.max(grooveAt(u, .365, .048), grooveAt(u, .635, .048))
    let boss = 0
    for (const bu of rear ? [.33, .67] : [.235, .500, .765]) {
      const du = (u - bu) / .086, dt = (t - .48) / .26
      const d = Math.hypot(du, dt)
      boss = Math.max(boss, 1 - smooth(d, .30, 1.0))
    }
    const topWindow = smooth(t, .885, .93) * (1 - smooth(t, .968, .995)) * smooth(x, -.032, -.018) * (1 - smooth(x, .001, .009))
      * Math.max(
        smooth(u, .21, .265) * (1 - smooth(u, .435, .49)),
        smooth(u, .51, .565) * (1 - smooth(u, .735, .79)),
      )
    return placeArch(u, x - .0030 * topWindow, t - .0060 * topWindow, (.0015 * boss - .0015 * flutes) * cheekMask)
  }
  const sections = full ? (rear ? nPts : nPts * 2) : nPts
  const uSpan = full ? (rear ? 36 : 74) : (hero ? 34 : 12)
  const cast: T.BufferGeometry[] = [patch(body, uSpan, sections, [-1, 0, 0])]
  for (const end of [0, 1]) {
    const a = middle + half * (2 * end - 1)
    const normal = axisRoll(0, 2 * end - 1, a + Math.PI / 2)
    const rim = Array.from({ length: sections }, (_, i) => body(end, i / sections))
    cast.push(polygon(rim, normal))
  }
  const rail = patch((u, v) => {
    const p = body(mix(.135, .864, u), mix(.065, .115, v))
    const taper = Math.sin(Math.PI * u) ** .45
    return [p[0] + .0020 * taper * Math.sin(Math.PI * v), p[1], p[2]]
  }, full ? 24 : 10, 3, [1, 0, 0])
  const clips: T.BufferGeometry[] = []
  const fasteners: T.BufferGeometry[] = []
  for (const [u, vPos] of [[.15, .09], [.365, .24], [.635, .24], [.85, .09]] as const) {
    const [x, y, z] = body(u, vPos)
    clips.push(disk(.0058, .0028, x + .0006, full ? 16 : 8).translate(0, y, z))
    fasteners.push(lathe([
      [x + .0006, .0039], [x + .0028, .0035], [x + .0028, .0019], [x + .0012, .0016], [x + .0012, .0002],
    ], full ? 12 : 6).translate(0, y, z))
  }
  if (!rear) {
    const [bx, by, bz] = body(.908, .31)
    clips.push(disk(.0052, .0022, bx + .0005, full ? 14 : 8).translate(0, by, bz))
    fasteners.push(lathe([
      [bx + .0006, .0036], [bx + .0036, .0032], [bx + .0052, .0021], [bx + .0066, .0026], [bx + .0076, .0017], [bx + .0076, .0002],
    ], full ? 12 : 8).translate(0, by, bz))
  }
  return [joined([...cast, rail]), joined(clips), joined(fasteners)]
}

export function createWheels(parent: T.Group, m: Palette, full: boolean): Point {
  const lodTag = full ? 'full' : 'blockout'
  const makeTireRubber = (w: WheelSize, label: string) => {
    const mat = m.tag(new T.MeshPhysicalMaterial({
      color: full ? 0x24282e : 0x343941,
      roughness: full ? .77 : .73,
      metalness: .02,
      clearcoat: .01,
      clearcoatRoughness: .16,
      specularIntensity: .58,
      envMapIntensity: 1.30,
    }), 'sheet')
    const id = `wheel tire vulcanized grain ${lodTag} ${label}`
    const seed = stream(id).range(.1, 21)
    patchMaterial(mat, {
      id,
      uniforms: {
        wheelTireSeed: { value: seed },
        wheelTireRadius: { value: w.radius },
        wheelTireLoaded: { value: w.loaded },
        wheelTireGrainAmt: { value: full ? 1 : 0 },
      },
      apply(shader) {
        shader.vertexShader = 'attribute float tireCavity;\nattribute vec2 tireUv;\nvarying float wheelTireCav;\nvarying vec2 wheelTireUv;\nvarying vec3 wheelTirePt;\nvarying vec3 wheelTireUpView;\n'
          + shader.vertexShader.replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nwheelTirePt = position;\nwheelTireCav = tireCavity;\nwheelTireUv = tireUv;\nwheelTireUpView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);',
          )
        shader.fragmentShader = `varying float wheelTireCav;
          varying vec2 wheelTireUv;
          varying vec3 wheelTirePt;
          varying vec3 wheelTireUpView;
          uniform float wheelTireSeed;
          uniform float wheelTireRadius;
          uniform float wheelTireLoaded;
          uniform float wheelTireGrainAmt;
          float wheelTireHash(vec3 p) {
            p = fract(p * vec3(0.1031, 0.0973, 0.1099));
            p += dot(p, p.yzx + wheelTireSeed + 19.19);
            return fract((p.x + p.y) * p.z);
          }
          float wtSipePulse(float p, float w0, float w1, float fw) {
            float d = abs(p - floor(p + 0.5));
            return 1.0 - smoothstep(w0, w1 + fw, d);
          }
        ` + shader.fragmentShader
          .replace('#include <color_fragment>', `#include <color_fragment>
            float wtGrain = wheelTireHash(floor(wheelTirePt * 1450.0));
            float wtWeight = wheelTireGrainAmt * (1.0 - smoothstep(0.00022, 0.00075, length(fwidth(wheelTirePt))));
            float wtU = wheelTireUv.x;
            float wtV = wheelTireUv.y;
            float wtPitch = wtU * 48.0;
            float wtFw = min(0.20, fwidth(wtPitch));
            float wtSipeFade = 1.0 - smoothstep(0.24, 0.46, wtFw);
            float wtDv = max(0.0, wtV - 0.660);
            float wtSipeOuter = wtSipePulse(wtPitch + wtDv * 2.5 + wtDv * wtDv * 8.0, 0.042, 0.100, wtFw)
              * smoothstep(0.660, 0.672, wtV) * (1.0 - smoothstep(0.726, 0.762, wtV));
            float wtSipeRib1 = wtSipePulse(wtPitch - 0.24 + (wtV - 0.608) * 2.2, 0.036, 0.092, wtFw)
              * smoothstep(0.570, 0.582, wtV) * (1.0 - smoothstep(0.642, 0.654, wtV));
            float wtSipeRib2 = wtSipePulse(wtPitch + 0.18 - (wtV - 0.505) * 2.0, 0.034, 0.088, wtFw)
              * smoothstep(0.466, 0.478, wtV) * (1.0 - smoothstep(0.542, 0.554, wtV));
            float wtSipeRib3 = wtSipePulse(wtPitch - 0.36 + (wtV - 0.399) * 2.0, 0.034, 0.088, wtFw)
              * smoothstep(0.360, 0.372, wtV) * (1.0 - smoothstep(0.436, 0.448, wtV));
            float wtSipeIn = wtSipePulse(wtPitch + 0.35 - (wtV - 0.346) * 2.3, 0.040, 0.098, wtFw)
              * smoothstep(0.262, 0.284, wtV) * (1.0 - smoothstep(0.330, 0.342, wtV));
            float wtSipe = wtSipeFade * max(max(wtSipeOuter, wtSipeRib1), max(max(wtSipeRib2, wtSipeRib3), wtSipeIn));
            float wtMainCh = max(
              max(1.0 - smoothstep(0.0066, 0.0148, abs(wtV - 0.346)), 1.0 - smoothstep(0.0066, 0.0148, abs(wtV - 0.452))),
              max(1.0 - smoothstep(0.0066, 0.0148, abs(wtV - 0.558)), 1.0 - smoothstep(0.0066, 0.0148, abs(wtV - 0.658)))
            );
            float wtShCh = 1.0 - smoothstep(0.0024, 0.0064, abs(wtV - 0.700));
            float wtCav = clamp(max(wheelTireCav, max(wtMainCh, max(0.50 * wtShCh, 0.68 * wtSipe))), 0.0, 1.0);
            float wtTread = smoothstep(0.25, 0.30, wtV) * (1.0 - smoothstep(0.730, 0.770, wtV));
            float wtYRel = wheelTirePt.y + wheelTireLoaded;
            float wtDeckNear = 1.0 - smoothstep(0.02, 0.26, wtYRel);
            float wtSplash = 1.0 - smoothstep(0.01, 0.14, wtYRel);
            float wtRibTop = wtTread * (1.0 - smoothstep(0.04, 0.36, wtCav));
            float wtSideOuter = smoothstep(0.745, 0.795, wtV) * (1.0 - smoothstep(0.955, 0.985, wtV));
            vec3 wtBeadCell = floor(wheelTirePt * 340.0 + wheelTireSeed * 19.0);
            float wtBeadHash = fract(sin(dot(wtBeadCell, vec3(23.1407, 61.9123, 39.4159))) * 43758.5453);
            float wtBead = wheelTireGrainAmt * wtWeight * wtSideOuter * smoothstep(0.86, 0.985, wtBeadHash)
              * smoothstep(0.03, 0.16, wtYRel);
            float wtWetRib = wtRibTop * (0.78 * wtSplash + 0.32 * wtDeckNear * smoothstep(-0.02, 0.22, wheelTirePt.z));
            float wtWetSide = wtSideOuter * (0.55 * wtSplash + 0.26 * wtDeckNear);
            float wtWetChannel = smoothstep(0.34, 0.84, wtMainCh) * (0.28 + 0.72 * wtDeckNear)
              + (0.52 * smoothstep(0.32, 0.88, wtSipe) + 0.36 * wtShCh) * (0.12 + 0.88 * wtDeckNear);
            float wtWetWater = clamp(max(wtWetChannel, max(wtWetRib, max(wtWetSide, 0.75 * wtBead))), 0.0, 1.0);
            float wtRibEdge = wtRibTop * smoothstep(0.004, 0.022, wtYRel);
            float wtFootZ = exp(-pow(wheelTirePt.z / 0.105, 2.0)) * smoothstep(0.73, 0.82, max(wtV, 1.0 - wtV));
            float wtBulgeUpper = wtFootZ * smoothstep(0.016, 0.032, wtYRel) * (1.0 - smoothstep(0.048, 0.075, wtYRel));
            float wtBulgeTuck = wtFootZ * (1.0 - smoothstep(0.003, 0.018, wtYRel));
            diffuseColor.rgb *= (1.0 + (wtGrain - 0.5) * 0.08 * wtWeight)
              * mix(1.0, 0.86, wtTread)
              * mix(1.0, 0.20, wtCav)
              * mix(1.0, 1.16, wtRibEdge * (1.0 - 0.55 * wtSplash))
              * mix(1.0, 0.56, max(wtWetRib, wtWetSide))
              * mix(1.0, 1.18, wtBulgeUpper)
              * mix(1.0, 0.78, wtBulgeTuck);
          `)
          .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
            roughnessFactor = clamp(
              roughnessFactor + (wtGrain - 0.5) * 0.06 * wtWeight - 0.07 * wtTread - 0.08 * wtRibEdge,
              0.54,
              0.92
            );
            roughnessFactor = mix(roughnessFactor, 0.22, max(wtWetRib, wtWetSide));
            roughnessFactor = mix(roughnessFactor, 0.14, max(wtWetChannel * wtDeckNear, wtBead));
          `)
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
            float wtReliefH = -(1.0 - 0.42 * wheelTireGrainAmt) * 0.0024 * wtSipe - (1.0 - 0.65 * wheelTireGrainAmt) * 0.0022 * wtMainCh - 0.0010 * wtShCh + 0.0009 * wtBead;
            vec3 wtDx = dFdx(vViewPosition), wtDy = dFdy(vViewPosition);
            vec3 wtR1 = cross(wtDy, normal), wtR2 = cross(normal, wtDx);
            float wtDet = dot(wtDx, wtR1);
            vec3 wtGrad = (dFdx(wtReliefH) * wtR1 + dFdy(wtReliefH) * wtR2) * sign(wtDet);
            normal = normalize(max(abs(wtDet), 1e-9) * normal - wtGrad);
          `)
          .replace('#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>
            float wtMeniscusH = 0.0012 * (wtMainCh * wtMainCh + 0.45 * wtSipe * wtSipe) + 0.0011 * wtBead;
            vec3 wtCcGrad = (dFdx(wtMeniscusH) * wtR1 + dFdy(wtMeniscusH) * wtR2) * sign(wtDet);
            vec3 wtCcBase = normalize(max(abs(wtDet), 1e-9) * clearcoatNormal - wtCcGrad);
            clearcoatNormal = normalize(mix(wtCcBase, normalize(wtCcBase + 0.55 * wheelTireUpView), wtWetChannel * wtDeckNear));
          `)
          .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
            #ifdef USE_CLEARCOAT
              material.clearcoat = clamp(0.02 + 0.78 * wtWetWater, 0.0, 0.86);
              material.clearcoatRoughness = mix(0.28, 0.10, wtWetWater);
            #endif
          `)
      },
    })
    return mat
  }
  const sidewallBand = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x181b20 : 0x32373f,
    roughness: full ? .39 : .45,
    metalness: .02,
    clearcoat: full ? .18 : .04,
    clearcoatRoughness: .28,
    specularIntensity: .54,
    envMapIntensity: 1.04,
  }), 'none')
  const makeRotorFinish = (w: WheelSize, axis: number, label: string) => {
    const mat = m.tag(new T.MeshPhysicalMaterial({
      color: full ? 0x525862 : 0x60666f,
      metalness: full ? .42 : .35,
      roughness: full ? .48 : .47,
      clearcoat: full ? .16 : .10,
      clearcoatRoughness: .34,
      specularIntensity: .80,
      envMapIntensity: 1.36,
    }), 'none')
    const id = `wheel rotor swept finish ${lodTag} ${label}`
    const seed = stream(id).range(.1, 21)
    patchMaterial(mat, {
      id,
      uniforms: {
        wrSeed: { value: seed },
        wrOuterR: { value: w.disc },
        wrMidX: { value: axis - .5 * w.discDepth },
        wrHalfSlot: { value: .5 * w.discDepth - .0088 },
        wrVanes: { value: full ? 40 : (w === frontWheel ? 32 : 12) },
        wrGrainAmt: { value: full ? 1 : 0 },
      },
      apply(shader) {
        shader.vertexShader = 'varying vec3 wheelRotorPt;\n'
          + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nwheelRotorPt = position;')
        shader.fragmentShader = `varying vec3 wheelRotorPt;
          uniform float wrSeed;
          uniform float wrOuterR;
          uniform float wrMidX;
          uniform float wrHalfSlot;
          uniform float wrVanes;
          uniform float wrGrainAmt;
          float wrHash(vec3 p) {
            p = fract(p * vec3(0.1031, 0.0973, 0.1099));
            p += dot(p, p.yzx + wrSeed + 19.19);
            return fract((p.x + p.y) * p.z);
          }
          float wrNoise1(float x) {
            float i = floor(x);
            float f = fract(x);
            float u = f * f * (3.0 - 2.0 * f);
            float a = wrHash(vec3(i, 3.1, 7.7));
            float b = wrHash(vec3(i + 1.0, 3.1, 7.7));
            return mix(a, b, u) - 0.5;
          }
          float wrRingNoise(float t, float period) {
            float x = fract(t) * period;
            float i = floor(x);
            float f = fract(x);
            float u = f * f * (3.0 - 2.0 * f);
            float a = wrHash(vec3(mod(i, period), 11.3, 5.9));
            float b = wrHash(vec3(mod(i + 1.0, period), 11.3, 5.9));
            return mix(a, b, u) - 0.5;
          }
        ` + shader.fragmentShader
          .replace('#include <color_fragment>', `#include <color_fragment>
            float wrR = length(wheelRotorPt.yz);
            float wrFoot = length(fwidth(wheelRotorPt.yz));
            float wrSwept = smoothstep(0.111, 0.117, wrR) * (1.0 - smoothstep(wrOuterR - 0.0088, wrOuterR - 0.0038, wrR));
            float wrInSlot = 1.0 - smoothstep(wrHalfSlot - 0.0012, wrHalfSlot + 0.0006, abs(wheelRotorPt.x - wrMidX));
            float wrOct1 = (1.0 - smoothstep(0.16, 0.42, wrFoot * 105.0)) * wrNoise1(wrR * 105.0);
            float wrOct2 = (1.0 - smoothstep(0.16, 0.42, wrFoot * 235.0)) * wrNoise1(wrR * 235.0);
            float wrRings = 0.70 * wrOct1 + 0.45 * wrOct2;
            float wrTheta = atan(wheelRotorPt.y, wheelRotorPt.z);
            float wrTurn = wrTheta * 0.15915494 + 0.5;
            float wrAngFoot = wrFoot / max(0.08, wrR);
            float wrVaneFade = 1.0 - smoothstep(0.025, 0.075, wrAngFoot);
            float wrSpokeFade = 1.0 - smoothstep(0.012, 0.036, wrAngFoot);
            float wrRadial = 0.085 * cos(wrTheta * wrVanes) * wrVaneFade
              + 0.095 * wrRingNoise(wrTurn, 72.0) * wrSpokeFade;
            float wrGrain = wrHash(floor(wheelRotorPt * 920.0));
            float wrGrainW = wrGrainAmt * (1.0 - smoothstep(0.00028, 0.00085, wrFoot));
            float wrBandGain = mix(0.50, 1.24, wrSwept);
            wrBandGain = mix(wrBandGain, 1.60, wrInSlot);
            diffuseColor.rgb *= wrBandGain
              * (1.0 + wrSwept * (0.24 * wrRings + wrRadial) + (wrGrain - 0.5) * 0.16 * wrGrainW);
          `)
          .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
            roughnessFactor = clamp(
              roughnessFactor + mix(0.16, -0.11, wrSwept) - 0.17 * wrInSlot - 0.08 * wrSwept * wrRings + (wrGrain - 0.5) * 0.11 * wrGrainW,
              0.25,
              0.88
            );
          `)
      },
    })
    return mat
  }
  const wheelSatinFace = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x1a1e26 : 0x353a43,
    metalness: .42,
    roughness: full ? .25 : .30,
    clearcoat: full ? .78 : .30,
    clearcoatRoughness: .09,
    specularIntensity: .95,
    envMapIntensity: 1.85,
  }), 'sheet')
  const wheelDeepGloss = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x0b0d12 : 0x1b1e25,
    metalness: full ? .24 : .12,
    roughness: full ? .35 : .48,
    clearcoat: full ? .18 : 0,
    clearcoatRoughness: .36,
    specularIntensity: full ? .56 : .38,
    envMapIntensity: full ? 1.12 : .90,
  }), 'none')
  const wheelBarrel = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x191d25 : 0x232730,
    metalness: full ? .44 : .32,
    roughness: full ? .26 : .36,
    clearcoat: full ? .76 : .18,
    clearcoatRoughness: .10,
    specularIntensity: .92,
    envMapIntensity: full ? 1.82 : 1.05,
  }), 'sheet')
  const wheelChamfer = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x353d4c : 0x454c57,
    metalness: full ? .68 : .38,
    roughness: full ? .16 : .29,
    clearcoat: full ? .86 : .28,
    clearcoatRoughness: .07,
    specularIntensity: full ? 1.0 : .74,
    envMapIntensity: full ? 2.10 : 1.24,
  }), 'sheet')
  const wheelLipLine = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x384150 : 0x525966,
    metalness: full ? .68 : .48,
    roughness: .17,
    clearcoat: .84,
    clearcoatRoughness: .08,
    specularIntensity: .98,
    envMapIntensity: 1.98,
  }), 'sheet')
  const lugFinish = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x4e5768 : 0x454b55,
    metalness: full ? .78 : .50,
    roughness: .18,
    clearcoat: .74,
    clearcoatRoughness: .10,
    envMapIntensity: 1.72,
  }), 'sheet')
  const wheelHardware = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x828b98 : 0x606772,
    metalness: full ? .88 : .55,
    roughness: .20,
    clearcoat: .62,
    envMapIntensity: 1.44,
  }), 'none')
  const caliperFinish = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0xb82026 : 0xa8b0bc,
    metalness: full ? .12 : .18,
    roughness: full ? .20 : .23,
    clearcoat: full ? .88 : .66,
    clearcoatRoughness: full ? .09 : .14,
    specularIntensity: .96,
    envMapIntensity: full ? 1.68 : 1.36,
  }), 'none')
  const hatFinish = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x1c1f24 : 0x2c3037,
    metalness: full ? .68 : .45,
    roughness: .32,
    clearcoat: .35,
  }), 'none')

  let anchor: Point = [0, 0, 0]
  for (const w of [frontWheel, rearWheel]) {
    const axleLabel = w === frontWheel ? 'front' : 'rear'
    const tireRubber = makeTireRubber(w, axleLabel)
    const H = w.width / 2
    const axis = H - .058, face = H - .008, hubPlane = face - .030, hubFace = hubPlane + .0018
    const rotorFinish = makeRotorFinish(w, axis, axleLabel)
    const pins = joined(Array.from({ length: 10 }, (_, i) => {
      const [, y, z] = axisRoll(0, .1065, tau * i / 10 + .134)
      return lathe([
        [axis - .0035, .0064], [axis + .0018, .0058], [axis + .0018, .0031], [axis - .0030, .0027],
      ], full ? (w === frontWheel ? 16 : 10) : 6).translate(0, y, z)
    }))
    const buildSet = (hero: boolean) => ({
      tire: tireGeometry(w, full, hero),
      wheel: forgedWheelAssembly(w, full, hero),
      brakeSet: rotor(w, full, axis, hero),
      caliperSet: caliper(w, full, axis, hero),
      sidewall: sidewallReliefGeometry(w, full, hero),
    })
    const primary = buildSet(w === frontWheel)
    const farSide = (!full && w === frontWheel) ? buildSet(false) : primary
    for (const side of [1, -1]) {
      const set = side === 1 ? primary : farSide
      const { satinWeb, forging, barrel, machinedSpokes, flange, hub, cap, lugs } = set.wheel
      const [brake, apertures, hat] = set.brakeSet
      const [castCaliper, clips, fasteners] = set.caliperSet
      const group = new T.Group()
      group.name = w === frontWheel ? 'front wheel' : 'rear wheel'
      group.position.set(w.x * side, w.loaded, w.z)
      group.scale.x = side
      add(group, 'loaded rubber and tread', set.tire, tireRubber)
      add(group, 'satin forged spoke web', satinWeb, wheelSatinFace)
      add(group, 'forged divided spokes and barrel', forging, wheelDeepGloss)
      add(group, 'connected rim barrel', barrel, wheelBarrel)
      add(group, 'diamond cut spoke faces', machinedSpokes, wheelChamfer)
      add(group, 'machined flange', flange, wheelLipLine)
      add(group, 'flat recessed hub plate', hub, wheelDeepGloss)
      add(group, 'flat center cap', cap, wheelSatinFace)
      add(group, 'five lug nuts', lugs, lugFinish)
      add(group, 'drilled ceramic rotor', brake, rotorFinish)
      add(group, 'recessed drill wells and rotor vents', apertures, m.dark)
      add(group, 'floating rotor hat', hat, hatFinish)
      add(group, 'rotor hat bobbins', pins, wheelHardware)
      add(group, 'recessed brake shield', disk(w.disc - .004, .008, -.054, full ? 64 : 16), m.dark)
      add(group, 'fixed brake caliper', castCaliper, caliperFinish)
      add(group, 'caliper pin seats', clips, m.matte)
      add(group, 'caliper pin heads', fasteners, wheelHardware)
      add(group, 'molded sidewall relief', set.sidewall, sidewallBand)
      parent.add(group)
    }
    if (w === frontWheel) anchor = [w.x + hubFace, w.loaded, w.z]
  }
  return anchor
}
