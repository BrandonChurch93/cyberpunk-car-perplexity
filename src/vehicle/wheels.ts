import * as T from 'three'
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
    [0, -.86], [.032, -.978], [.058, -.958], [.145, -1.012], [.215, -.982], [.27, -.925],
    [.50, 0], [.73, .925], [.785, .982], [.855, 1.012], [.942, .958], [.968, .984], [1, .86],
  ])
  const sidewallRib = (v: number) => {
    const r1 = Math.max(0, 1 - Math.abs(v - .818) / .0075)
    const r2 = Math.max(0, 1 - Math.abs(v - .866) / .0070)
    return .00075 * (r1 * r1 * (3 - 2 * r1) + r2 * r2 * (3 - 2 * r2))
  }
  const axial = (v: number) => {
    if (v < .27 || v > .73) return width(v) * H + (v > .73 ? sidewallRib(v) : 0)
    return mix(-.925, .925, (v - .27) / .46) * H
  }
  const place = (u: number, v: number, depthOffset: number, extraX = 0): Point => {
    const th = u * tau
    const p = axisRoll(axial(v) + extraX, cross(v) - depthOffset, th)
    const ground = p[1] + w.loaded
    const cushion = ground > .010 ? ground : ground < 0 ? 0 : ground ** 2 * (20 - 1000 * ground) * 1000 / 100
    const bulge = .0024 * Math.exp(-((ground - .028) ** 2) / .00085) * Math.sin(Math.PI * v) * Math.sign(p[0])
    return [p[0] + bulge - (p[0] > 0 ? treadInset(w, cross(v)) : 0), cushion - w.loaded, p[2]]
  }
  return { place }
}

function tireGeometry(w: WheelSize, full: boolean): T.BufferGeometry {
  const { place } = tireShell(w)
  const grooves = [.345, .460, .568, .668]
  const depth = (u: number, v: number): number => {
    const groove = grooves.reduce((r, g) => Math.max(r, 1 - smooth(Math.abs(v - g), .0062, .0160)), 0)
    const block = (p: number, narrow: number, wide: number) => 1 - smooth(Math.abs(p - Math.round(p)), narrow, wide)
    const pitch = u * (full ? 30 : 20)
    const inner = block(pitch + .43 + (v - .5) * 6, .09, .22) * smooth(v, .275, .305) * (1 - smooth(v, .335, .348))
    const outer = block(pitch + (v - .668) * 6.5, .09, .21)
      * smooth(v, .666, .680) * (1 - smooth(v, .718, .742))
    const sipes = block(pitch - .3 + (v - .51) * 5.5, .055, .15)
      * smooth(v, .465, .482) * (1 - smooth(v, .552, .568))
    return Math.max(.0068 * groove, .0030 * inner, .0032 * outer, .0020 * sipes)
  }
  const rows = [...new Set([
    ...Array.from({ length: full ? 57 : 15 }, (_, i) => i / (full ? 56 : 14)),
    ...(full
      ? [
          ...grooves.flatMap((v) => [v - .016, v - .006, v + .006, v + .016]),
          .035, .060, .720, .745, .790, .810, .818, .826, .855, .859, .866, .873, .918, .942, .966, .984,
        ]
      : [...grooves.flatMap((v) => [v - .014, v, v + .014]), .740, .818, .866, .942, .968]),
  ])].sort((a, b) => a - b)
  // At u=0.5, v=0.5 the contact flatten + center bulge flip toNormal upward, so [0, 1, 0] keeps the rubber shell outward.
  return patch((u, v) => place(u, v, depth(u, v)), full ? 480 : 64, rows.length - 1, [0, 1, 0], 0, (_, i) => rows[i])
}

function sidewallReliefGeometry(w: WheelSize, full: boolean): T.BufferGeometry {
  const { place } = tireShell(w)
  return patch(
    (u, t) => {
      const crown = Math.max(0, 1 - Math.abs(t * 2 - 1))
      return place(u, mix(.956, .978, t), 0, .00030 + .00085 * crown * crown * (3 - 2 * crown))
    },
    full ? 480 : 64,
    4,
    [1, 0, 0],
  )
}

function rotor(w: WheelSize, full: boolean, axis: number): [T.BufferGeometry, T.BufferGeometry, T.BufferGeometry] {
  const face = new T.Shape()
  const segments = full ? 160 : 96
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
  const wells: T.BufferGeometry[] = []
  const count = full ? 24 : 16, edges = full ? 10 : 6
  for (let i = 0; i < count; i++) for (let j = 0; j < 4; j++) {
    const a = (i / count) * tau + .043 * j + .0105 * j ** 2
    const r = radius - .018 - .018 * j
    const drill = new T.Path(), y = Math.sin(a) * r, z = -Math.cos(a) * r
    for (let k = 0; k <= edges; k++) {
      const phi = -tau * k / edges
      const q = .0036
      if (k === 0) drill.moveTo(-z + q, y)
      else drill.lineTo(-z + q * Math.cos(phi), y + q * Math.sin(phi))
    }
    face.holes.push(drill)
    wells.push(patch((u, v) => {
      const phi = -u * tau, q = mix(.0036, .00285, v)
      return [axis - .007 * v, y + q * Math.sin(phi), z - q * Math.cos(phi)]
    }, edges, 1, [1, 0, 0]))
  }
  const rear = axis - w.discDepth, cheek = .0095
  const back = lathe([[rear, ring], [rear, lip], [rear + .0018, radius], [rear + cheek, radius], [rear + cheek, ring]], full ? segments : 64)
  const ceramic = joined([
    new T.ShapeGeometry(face, 1).rotateY(Math.PI / 2).translate(axis + .00002, 0, 0),
    lathe([[axis - cheek, ring], [axis - cheek, radius], [axis - .0018, radius], [axis, lip]], segments), back,
  ])
  const ventRibs: T.BufferGeometry[] = [lathe([[rear + cheek, .122], [axis - cheek, .122]], segments / 2)]
  for (let i = 0; i < (full ? 42 : 26); i++) {
    const a = tau * i / (full ? 42 : 26)
    ventRibs.push(patch((u, v) => axisRoll(mix(rear + cheek, axis - cheek, v), mix(.127, lip - .0015, u), a + .23 * u),
      full ? 2 : 1, 1, [0, -Math.sin(a), Math.cos(a)], .0038))
  }
  return [ceramic, joined([...wells, ...ventRibs]), lathe([
    [axis - .008, .115], [axis - .004, .112], [axis - .004, .105], [axis - .015, .104],
    [axis - .015, .098], [axis - .009, .088], [axis - .005, .081], [axis - .005, .047],
  ], full ? segments / 2 : 48)]
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

function forgedWheelAssembly(w: WheelSize, full: boolean): {
  satinWeb: T.BufferGeometry
  forging: T.BufferGeometry
  barrel: T.BufferGeometry
  machinedSpokes: T.BufferGeometry
  flange: T.BufferGeometry
  hub: T.BufferGeometry
  cap: T.BufferGeometry
  lugs: T.BufferGeometry
} {
  const H = w.width / 2, R = w.rim
  const face = H - .008, hubPlane = face - .030, hubFace = hubPlane + .0018
  const rCap = .128 * R, rCollar = .146 * R
  const rHubInner = .244 * R, rHubOuter = .258 * R
  const rWebOuter = R - .0038
  const rWinOuter = R - .0124
  const theta0 = .22
  const branchSpan = .468
  const stemRootHalf = .088 * R
  const stemForkHalf = .072 * R
  const branchBaseHalf = .064 * R
  const rPentInner = .292 * R
  const rPentArc = .304 * R
  const rFork = .545 * R
  const rForkJoin = .955 * R
  const tDraft = .0018, tChamfer = .0034, tSeam = tDraft + tChamfer

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
  const rLug = .194 * R, rLugWell = .0072, tLugSeam = .0014
  const cornerSegs = full ? 10 : 5
  const maxLoopEdge = full ? .0075 : .022

  for (let k = 0; k < 5; k++) {
    const th = theta0 + (k / 5) * tau
    const thNext = th + tau / 5

    const aPent0 = th + pentBranchOuterAngle
    const aPent1 = thNext - pentBranchOuterAngle
    const pentPts: Pt2[] = [
      local2(th, rPentInner, stemRootHalf),
      local2(th, elbowX, stemForkHalf),
      polar2(rWinOuter, aPent0),
      polar2(rWinOuter, (aPent0 + aPent1) * .5),
      polar2(rWinOuter, aPent1),
      local2(thNext, elbowX, -stemForkHalf),
      local2(thNext, rPentInner, -stemRootHalf),
      polar2(rPentArc, (th + thNext) * .5),
    ]
    const pentRadii = [.0135, .0185, .0150, .185, .0150, .0185, .0135, .085]
    windowLoops.push(filletConvexCCW(pentPts, pentRadii, cornerSegs, maxLoopEdge))

    const triPts: Pt2[] = [
      polar2(crotchR, th),
      polar2(rWinOuter, th - triHalfAngle),
      polar2(rWinOuter, th),
      polar2(rWinOuter, th + triHalfAngle),
    ]
    const triRadii = [.0155, .0160, .210, .0160]
    windowLoops.push(filletConvexCCW(triPts, triRadii, cornerSegs, maxLoopEdge))

    const lugCenter = polar2(rLug, th + tau / 10)
    lugCenters.push(lugCenter)
    lugLoops.push(circleLoopCCW(lugCenter, rLugWell, full ? 20 : 10))
  }

  const hubBowlX = hubPlane + .0046
  const dishAt = (r: number): number => mix(hubPlane + .0132, face - .0008, smooth(r, rHubOuter, rWebOuter) ** .82)
  const backAt = (r: number): number => dishAt(r) - .0175
  const webHeight = (y: number, z: number): number => dishAt(Math.hypot(y, z))
  const backHeight = (y: number, z: number): number => backAt(Math.hypot(y, z))
  const hubFlatHeight = (): number => hubBowlX

  const collarLoop = circleLoopCCW([0, 0], rCollar, full ? 48 : 24)
  const collarSeamOffset = .0018
  const collarSeamPts = collarLoop.map(({ p, n }) => [p[0] + n[0] * collarSeamOffset, p[1] + n[1] * collarSeamOffset] as Pt2)

  const hubDiscSegs = full ? 72 : 28
  const hubInnerPts = Array.from({ length: hubDiscSegs }, (_, i) => polar2(rHubInner, (i / hubDiscSegs) * tau))
  const hubOuterLoop = circleLoopCCW([0, 0], rHubOuter, hubDiscSegs)
  const hubOuterPts = hubOuterLoop.map(({ p }) => p)

  const outerCount = full ? 120 : 50
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

  const backCollarPts = collarLoop.map(({ p }) => p)
  const backWindowHoles = windowLoops.map((loop) => loop.map(({ p, n }) => [p[0] + n[0] * .0006, p[1] + n[1] * .0006] as Pt2))
  const backWeb = buildPlanarSurface(outerWebPts, [backCollarPts, ...backWindowHoles], backHeight, -1, 0)

  const forgedParts: T.BufferGeometry[] = [backWeb, hubDisc, hubStepWall]
  const machinedParts: T.BufferGeometry[] = []

  for (const loop of windowLoops) {
    const sidewall: Profile = full
      ? [[.0006, -.0175], [0, -.0166], [.0008, -.0092], [tDraft, -.0028]]
      : [[.0006, -.0175], [0, -.0166], [tDraft, -.0028]]
    const chamfer: Profile = [[tDraft, -.0028], [tSeam, 0]]
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

  const barrelCount = full ? 144 : 44
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
    [face + .0008, R - .0024], [face - .0008, R - .0038],
  ], barrelCount)

  const ringSegs = full ? 60 : 28
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

function caliper(w: WheelSize, full: boolean, axis: number): [T.BufferGeometry, T.BufferGeometry, T.BufferGeometry] {
  const rear = w === rearWheel
  const middle = rear ? 1.18 : -.86
  const half = rear ? .735 : 1.05
  const low = w.disc - (rear ? .058 : .066)
  const outer = w.disc + (rear ? .026 : .025)
  const lowAt = curve([[0, .031], [.085, .012], [.21, 0], [.41, .001], [.58, .004], [.79, 0], [.92, .012], [1, .030]])
  const highAt = curve([[0, -.029], [.08, -.011], [.19, -.004], [.34, 0], [.58, .001], [.76, -.002], [.92, -.008], [1, -.030]])
  const crossPts: Profile = [
    [.007, .052], [.0162, .125], [.0168, .175], [.0168, .765], [.0154, .825],
    [.0055, .955], [-.014, 1], [-.040, .99], [-.055, .86], [-.058, .50],
    [-.056, .16], [-.051, .071], [-.044, .13], [-.043, .76], [-.033, .83],
    [-.012, .84], [.004, .80], [.005, .11],
  ]
  const sampleProfile = (v: number): Pt2 => {
    const s = ((v % 1) + 1) % 1 * crossPts.length
    const i = Math.floor(s), f = s - i
    const a = crossPts[i % crossPts.length], b = crossPts[(i + 1) % crossPts.length]
    return [mix(a[0], b[0], f), mix(a[1], b[1], f)]
  }
  const grooveAt = (u: number, center: number, halfW: number): number => 1 - smooth(Math.abs(u - center), halfW * .42, halfW)
  const body = (u: number, v: number): Point => {
    const [x, t] = sampleProfile(v)
    const a = middle + half * (2 * u - 1)
    const radius = mix(low + lowAt(u), outer + highAt(u), t)
    const frontMask = smooth(x, .009, .0155) * smooth(t, .16, .22) * (1 - smooth(t, .74, .82))
    const channels = Math.max(grooveAt(u, .36, .046), grooveAt(u, .64, .046))
    const endTaper = .78 + .22 * smooth(u, 0, .11) * (1 - smooth(u, .89, 1))
    const padPocket = -(.0038 * smooth(t, .77, .83) * (1 - smooth(t, .92, .97)) * smooth(u, .22, .27) * (1 - smooth(u, .73, .78)) * (1 - grooveAt(u, .50, .048)))
    const bossRelief = -.0028 * channels * frontMask + padPocket
    return axisRoll(axis + x * endTaper + bossRelief, radius, a)
  }
  const sections = full ? 36 : 18
  const cast: T.BufferGeometry[] = [patch(body, full ? 64 : 32, sections, [-1, 0, 0])]
  for (const end of [0, 1]) {
    const a = middle + half * (2 * end - 1)
    const normal = axisRoll(0, 2 * end - 1, a + Math.PI / 2)
    const rim = Array.from({ length: sections }, (_, i) => body(end, i / sections))
    cast.push(polygon(rim, normal))
  }
  const rail = patch((u, v) => {
    const p = body(mix(.135, .864, u), mix(.135, .178, v))
    const taper = Math.sin(Math.PI * u) ** .45
    return [p[0] + .0022 * taper * Math.sin(Math.PI * v), p[1], p[2]]
  }, full ? 24 : 10, 3, [1, 0, 0])
  const clips: T.BufferGeometry[] = []
  const fasteners: T.BufferGeometry[] = []
  for (const [u, vPos] of [[.15, .11], [.36, .19], [.64, .19], [.85, .11]] as const) {
    const [x, y, z] = body(u, vPos)
    clips.push(disk(.0062, .0030, x + .0008, full ? 16 : 8).translate(0, y, z))
    fasteners.push(lathe([
      [x + .0008, .0042], [x + .0032, .0038], [x + .0032, .0020], [x + .0014, .0017], [x + .0014, .0002],
    ], full ? 12 : 6).translate(0, y, z))
  }
  return [joined([...cast, rail]), joined(clips), joined(fasteners)]
}

export function createWheels(parent: T.Group, m: Palette, full: boolean): Point {
  const wheelSatinFace = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x1b1e25 : 0x353a43,
    metalness: .48,
    roughness: full ? .25 : .29,
    clearcoat: full ? .62 : .36,
    clearcoatRoughness: .18,
    specularIntensity: .95,
    envMapIntensity: 1.50,
  }), 'none')
  const wheelDeepGloss = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x090b0f : 0x181b21,
    metalness: full ? .32 : .34,
    roughness: full ? .12 : .16,
    clearcoat: 1.0,
    clearcoatRoughness: .05,
    specularIntensity: 1.0,
    envMapIntensity: 1.45,
  }), 'none')
  const wheelBarrel = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x1e222a : 0x232730,
    metalness: full ? .46 : .45,
    roughness: .24,
    clearcoat: .90,
    clearcoatRoughness: .10,
    envMapIntensity: 1.55,
  }), 'none')
  const wheelChamfer = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x808a9a : 0x727a88,
    metalness: full ? .52 : .58,
    roughness: .19,
    clearcoat: .95,
    clearcoatRoughness: .09,
    specularIntensity: 1.0,
    envMapIntensity: 2.00,
  }), 'none')
  const wheelLipLine = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x6d7685 : 0x727a88,
    metalness: full ? .62 : .58,
    roughness: .20,
    clearcoat: .94,
    clearcoatRoughness: .09,
    envMapIntensity: 1.60,
  }), 'none')
  const lugFinish = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x3e444f : 0x454b55,
    metalness: full ? .58 : .50,
    roughness: .25,
    clearcoat: .55,
    envMapIntensity: 1.35,
  }), 'none')
  const wheelHardware = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x707884 : 0x606772,
    metalness: full ? .86 : .55,
    roughness: .22,
    clearcoat: .58,
    envMapIntensity: 1.35,
  }), 'none')
  const caliperFinish = full
    ? m.tag(new T.MeshPhysicalMaterial({
        color: 0x5c171b,
        metalness: .28,
        roughness: .44,
        clearcoat: .20,
        clearcoatRoughness: .36,
        envMapIntensity: .85,
      }), 'none')
    : m.caliper
  const hatFinish = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x1c1f24 : 0x2c3037,
    metalness: full ? .68 : .45,
    roughness: .32,
    clearcoat: .35,
  }), 'none')

  let anchor: Point = [0, 0, 0]
  for (const w of [frontWheel, rearWheel]) {
    const H = w.width / 2
    const axis = H - .058, face = H - .008, hubPlane = face - .030, hubFace = hubPlane + .0018
    const tire = tireGeometry(w, full)
    const { satinWeb, forging, barrel, machinedSpokes, flange, hub, cap, lugs } = forgedWheelAssembly(w, full)
    const [brake, apertures, hat] = rotor(w, full, axis)
    const [castCaliper, clips, fasteners] = caliper(w, full, axis)
    const pins = joined(Array.from({ length: 10 }, (_, i) => {
      const [, y, z] = axisRoll(0, .1065, tau * i / 10 + .134)
      return lathe([
        [axis - .0035, .0064], [axis + .0018, .0058], [axis + .0018, .0031], [axis - .0030, .0027],
      ], full ? 16 : 10).translate(0, y, z)
    }))
    const sidewall = sidewallReliefGeometry(w, full)
    for (const side of [1, -1]) {
      const group = new T.Group()
      group.name = w === frontWheel ? 'front wheel' : 'rear wheel'
      group.position.set(w.x * side, w.loaded, w.z)
      group.scale.x = side
      add(group, 'loaded rubber and tread', tire, m.tire)
      add(group, 'satin forged spoke web', satinWeb, wheelSatinFace)
      add(group, 'forged divided spokes and barrel', forging, wheelDeepGloss)
      add(group, 'connected rim barrel', barrel, wheelBarrel)
      add(group, 'diamond cut spoke faces', machinedSpokes, wheelChamfer)
      add(group, 'machined flange', flange, wheelLipLine)
      add(group, 'flat recessed hub plate', hub, wheelDeepGloss)
      add(group, 'flat center cap', cap, wheelSatinFace)
      add(group, 'five lug nuts', lugs, lugFinish)
      add(group, 'drilled ceramic rotor', brake, m.brake)
      add(group, 'recessed drill wells and rotor vents', apertures, m.dark)
      add(group, 'floating rotor hat', hat, hatFinish)
      add(group, 'rotor hat bobbins', pins, wheelHardware)
      add(group, 'recessed brake shield', disk(w.disc - .004, .008, -.054, full ? 64 : 32), m.dark)
      add(group, 'fixed brake caliper', castCaliper, caliperFinish)
      add(group, 'caliper pin seats', clips, m.matte)
      add(group, 'caliper pin heads', fasteners, wheelHardware)
      add(group, 'molded sidewall relief', sidewall, m.tire)
      parent.add(group)
    }
    if (w === frontWheel) anchor = [w.x + hubFace, w.loaded, w.z]
  }
  return anchor
}
