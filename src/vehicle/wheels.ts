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

function tireGeometry(w: WheelSize, full: boolean): T.BufferGeometry {
  const H = w.width / 2
  const cross = curve([
    [0, w.rim - .011], [.08, w.rim + .013], [.18, w.radius - .054], [.23, w.radius - .026],
    [.27, w.radius - .010], [.34, w.radius - .0012], [.39, w.radius], [.61, w.radius],
    [.66, w.radius - .0012], [.73, w.radius - .010], [.77, w.radius - .026], [.82, w.radius - .054], [.92, w.rim + .013], [1, w.rim - .011],
  ])
  const width = curve([[0, -.86], [.12, -.974], [.179, -1], [.226, -.985], [.27, -.93], [.50, 0], [.73, .93], [.774, .985], [.821, 1], [.88, .974], [1, .86]])
  const axial = (v: number) => {
    if (v < .27 || v > .73) return width(v) * H
    return mix(-.93, .93, (v - .27) / .46) * H
  }
  const grooves = [.363, .452, .544, .638]
  const depth = (u: number, v: number): number => {
    const groove = grooves.reduce((r, g) => Math.max(r, 1 - smooth(Math.abs(v - g), .0045, .014)), 0)
    const block = (p: number, narrow: number, wide: number) => 1 - smooth(Math.abs(p - Math.round(p)), narrow, wide)
    const pitch = u * (full ? 52 : 24) + .23 * Math.sin(u * tau * 4)
    const inner = block(pitch + .43 + (v - .5) * 6, .075, .17) * smooth(v, .268, .300) * (1 - smooth(v, .363, .377))
    const outer = block(pitch + (v - .638) * 5 + 10 * (v - .69) ** 2, .085, .214)
      * smooth(v, .623, .639) * (1 - smooth(v, .763, .793))
    const sipes = block(pitch - .3 + (v - .49) * 5, .025, full ? .091 : .138)
      * smooth(v, .392, .416) * (1 - smooth(v, .576, .598))
    return Math.max(.0062 * groove, .0041 * inner, .0055 * outer, .0028 * sipes)
  }
  const position = (u: number, v: number): Point => {
    const th = u * tau
    const p = axisRoll(axial(v), cross(v) - depth(u, v), th)
    const ground = p[1] + w.loaded
    const cushion = ground > .010 ? ground : ground < 0 ? 0 : ground ** 2 * (20 - 1000 * ground) * 1000 / 100
    const bulge = .0015 * Math.exp(-((ground - .027) ** 2) / .00069) * Math.sin(Math.PI * v) * Math.sign(p[0])
    return [p[0] + bulge - (p[0] > 0 ? treadInset(w, cross(v)) : 0), cushion - w.loaded, p[2]]
  }
  const rows = [...new Set([
    ...Array.from({ length: full ? 55 : 17 }, (_, i) => i / (full ? 54 : 16)),
    ...grooves.flatMap((v) => [v - .014, v - .004, v + .004, v + .014]),
    .745, .773, .797,
  ])].sort((a, b) => a - b)
  // At u=0.5, v=0.5 the contact flatten + center bulge flip toNormal upward, so [0, 1, 0] keeps the rubber shell outward.
  return patch(position, full ? 576 : 64, rows.length - 1, [0, 1, 0], 0, (_, i) => rows[i])
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
    const maxTan = .42 * Math.min(l1, l2)
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
  forging: T.BufferGeometry
  machinedSpokes: T.BufferGeometry
  flange: T.BufferGeometry
  hub: T.BufferGeometry
  cap: T.BufferGeometry
  lugs: T.BufferGeometry
} {
  const H = w.width / 2, R = w.rim
  const face = H - .008, hubPlane = face - .030, hubFace = hubPlane + .0018
  const rCap = .130 * R, rCollar = .154 * R, rWebOuter = R - .0026
  const rWinOuter = R - .0142
  const theta0 = .22
  const branchSpan = .468
  const stemRootHalf = .072 * R
  const stemForkHalf = .078 * R
  const branchBaseHalf = .056 * R
  const rPentInner = .192 * R
  const rFork = .578 * R
  const rForkJoin = .956 * R
  const tDraft = .0026, tChamfer = .0036, tSeam = tDraft + tChamfer

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
  const pocketLoops: LoopSample[][] = []
  const rimSlotLoops: LoopSample[][] = []
  const lugCenters: Pt2[] = []
  const lugLoops: LoopSample[][] = []
  const rLug = .220 * R, rLugWell = .0072, tLugSeam = .0018
  const cornerSegs = full ? 5 : 2
  const maxLoopEdge = full ? .0095 : .026

  for (let k = 0; k < 5; k++) {
    const th = theta0 + (k / 5) * tau
    const thNext = th + tau / 5

    const pentArcSteps = full ? 4 : 2
    const aPent0 = th + pentBranchOuterAngle
    const aPent1 = thNext - pentBranchOuterAngle
    const pentPts: Pt2[] = [
      local2(th, rPentInner, stemRootHalf),
      local2(th, elbowX, stemForkHalf),
    ]
    for (let j = 0; j <= pentArcSteps; j++) {
      pentPts.push(polar2(rWinOuter, mix(aPent0, aPent1, j / pentArcSteps)))
    }
    pentPts.push(
      local2(thNext, elbowX, -stemForkHalf),
      local2(thNext, rPentInner, -stemRootHalf),
    )
    const pentRadii = [
      .0042, .0062, .0046,
      ...Array.from({ length: pentArcSteps - 1 }, () => 0),
      .0046, .0062, .0042,
    ]
    windowLoops.push(filletConvexCCW(pentPts, pentRadii, cornerSegs, maxLoopEdge))

    const triArcSteps = full ? 8 : 4
    const triPts: Pt2[] = [polar2(crotchR, th)]
    for (let j = 0; j <= triArcSteps; j++) {
      triPts.push(polar2(rWinOuter, th + mix(-triHalfAngle, triHalfAngle, j / triArcSteps)))
    }
    const triRadii = [.0052, .0046, ...Array.from({ length: triArcSteps - 1 }, () => 0), .0046]
    windowLoops.push(filletConvexCCW(triPts, triRadii, cornerSegs, maxLoopEdge))

    const pR0 = .290 * R, pR1 = .515 * R, pTip = .560 * R, pHalf0 = .0145 * R, pHalf1 = .0180 * R
    const pocketPts: Pt2[] = [
      local2(th, pR0, -pHalf0),
      local2(th, pR1, -pHalf1),
      local2(th, pTip, 0),
      local2(th, pR1, pHalf1),
      local2(th, pR0, pHalf0),
    ]
    pocketLoops.push(filletConvexCCW(pocketPts, [.0020, .0030, .0016, .0030, .0020], full ? 3 : 1, maxLoopEdge))

    const sA0 = aPent0 + .018, sA1 = aPent1 - .018
    if (sA1 - sA0 > .035) {
      const sR0 = R - .0062, sR1 = R - .0044
      const slotPts: Pt2[] = [
        polar2(sR0, sA0), polar2(sR1, sA0), polar2(sR1, sA1), polar2(sR0, sA1),
      ]
      rimSlotLoops.push(filletConvexCCW(slotPts, [.0006, .0006, .0006, .0006], full ? 2 : 1, maxLoopEdge))
    }

    const lugCenter = polar2(rLug, th)
    lugCenters.push(lugCenter)
    lugLoops.push(circleLoopCCW(lugCenter, rLugWell, full ? 18 : 8))
  }

  const ridgeTent = (d: number, halfW: number): number => {
    if (d >= halfW) return 0
    const u = d / halfW
    return 1 - Math.sqrt(u * u + .025) / Math.sqrt(1.025)
  }
  const dishAt = (r: number): number => {
    const t = T.MathUtils.clamp((r - rCap) / (rWebOuter - rCap), 0, 1)
    const innerDrop = (1 - smooth(r, rCap, .52 * R)) * .0175
    const outerRise = smooth(r, .46 * R, rWebOuter) * .0105
    return face - .0135 - innerDrop + outerRise + .0030 * t
  }
  const spokeCrown = (y: number, z: number): number => {
    let crown = 0
    for (let k = 0; k < 5; k++) {
      const th = theta0 + (k / 5) * tau
      const ct = Math.cos(th), st = Math.sin(th)
      const rx = y * ct + z * st
      const ay = Math.abs(-y * st + z * ct)
      if (rx > rCollar && rx < rFork + .022) {
        const railOffset = mix(.034 * R, .048 * R, T.MathUtils.clamp((rx - rCollar) / (rFork - rCollar), 0, 1))
        const wAx = smooth(rx, rCollar + .004, rCollar + .022) * (1 - smooth(rx, rFork - .012, rFork + .018))
        crown += .0020 * wAx * ridgeTent(Math.abs(ay - railOffset), .028 * R)
      }
      const px = rx - f0[0], py = ay - f0[1]
      const s = T.MathUtils.clamp(px * bux + py * buy, 0, blen)
      const dB = Math.hypot(px - s * bux, py - s * buy)
      const wBr = smooth(s, 0, .016) * (1 - smooth(s, blen - .014, blen))
      crown += .0025 * wBr * ridgeTent(dB, .052 * R)
    }
    return Math.min(.0030, crown)
  }
  const backAt = (r: number): number => {
    const midClear = smooth(r, .46 * R, .56 * R) * (1 - smooth(r, .86 * R, .94 * R))
    return dishAt(r) - (.0195 - .0032 * midClear)
  }
  const webHeight = (y: number, z: number): number => dishAt(Math.hypot(y, z)) + spokeCrown(y, z)
  const backHeight = (y: number, z: number): number => backAt(Math.hypot(y, z))

  const collarVerts = Array.from({ length: 5 }, (_, k) => polar2(rCollar, theta0 + (k / 5) * tau))
  const collarLoop = filletConvexCCW(collarVerts, [.0085, .0085, .0085, .0085, .0085], full ? 6 : 3, maxLoopEdge)
  const collarSeamOffset = .0022
  const collarSeamPts = collarLoop.map(({ p, n }) => [p[0] + n[0] * collarSeamOffset, p[1] + n[1] * collarSeamOffset] as Pt2)

  const outerCount = full ? 100 : 60
  const outerWebPts = Array.from({ length: outerCount }, (_, i) => polar2(rWebOuter, (i / outerCount) * tau))
  const windowSeamHoles = windowLoops.map((loop) => loop.map(({ p, n }) => [p[0] + n[0] * tSeam, p[1] + n[1] * tSeam] as Pt2))
  const pocketSeamOffset = .0018
  const pocketSeamHoles = pocketLoops.map((loop) => loop.map(({ p, n }) => [p[0] + n[0] * pocketSeamOffset, p[1] + n[1] * pocketSeamOffset] as Pt2))
  const slotSeamOffset = .0006
  const slotSeamHoles = rimSlotLoops.map((loop) => loop.map(({ p, n }) => [p[0] + n[0] * slotSeamOffset, p[1] + n[1] * slotSeamOffset] as Pt2))
  const lugSeamHoles = lugLoops.map((loop) => loop.map(({ p, n }) => [p[0] + n[0] * tLugSeam, p[1] + n[1] * tLugSeam] as Pt2))

  const frontWeb = buildPlanarSurface(
    outerWebPts,
    [collarSeamPts, ...lugSeamHoles, ...pocketSeamHoles, ...slotSeamHoles, ...windowSeamHoles],
    webHeight,
    1,
    full ? .0090 : .024,
    2,
  )
  const backCollarPts = collarLoop.map(({ p }) => p)
  const backWindowHoles = windowLoops.map((loop) => loop.map(({ p, n }) => [p[0] + n[0] * .0008, p[1] + n[1] * .0008] as Pt2))
  const backWeb = buildPlanarSurface(outerWebPts, [backCollarPts, ...backWindowHoles], backHeight, -1, 0)

  const forgedParts: T.BufferGeometry[] = [frontWeb, backWeb]
  const machinedParts: T.BufferGeometry[] = []

  for (const loop of windowLoops) {
    const sidewall: Profile = full
      ? [[.0008, -.0195], [0, -.0186], [.0014, -.0092], [tDraft, -.0019]]
      : [[.0008, -.0195], [0, -.0186], [tDraft, -.0019]]
    const chamfer: Profile = [[tDraft, -.0019], [tSeam, 0]]
    forgedParts.push(sweepLoopRibbon(loop, sidewall, webHeight))
    machinedParts.push(sweepLoopRibbon(loop, chamfer, webHeight))
  }

  for (const loop of pocketLoops) {
    const floorDepth = -.0046
    forgedParts.push(
      sweepLoopRibbon(loop, [[0, floorDepth], [.0007, -.0012]], webHeight),
      polygon(loop.map(({ p }) => [webHeight(p[0], p[1]) + floorDepth, p[0], p[1]] as Point), [1, 0, 0]),
    )
    machinedParts.push(sweepLoopRibbon(loop, [[.0007, -.0012], [pocketSeamOffset, 0]], webHeight))
  }

  for (const loop of rimSlotLoops) {
    const slotDepth = -.0026
    forgedParts.push(
      sweepLoopRibbon(loop, [[0, slotDepth], [slotSeamOffset, 0]], webHeight),
      polygon(loop.map(({ p }) => [webHeight(p[0], p[1]) + slotDepth, p[0], p[1]] as Point), [1, 0, 0]),
    )
  }

  const bezelFloorX = hubPlane - .0015
  machinedParts.push(sweepLoopRibbon(collarLoop, [
    [0, bezelFloorX - dishAt(rCollar)],
    [.0011, .0012],
    [collarSeamOffset, 0],
  ], webHeight))

  const lugFloorX = hubPlane + .0012
  for (let k = 0; k < 5; k++) {
    const loop = lugLoops[k]
    const base = webHeight(lugCenters[k][0], lugCenters[k][1])
    forgedParts.push(
      sweepLoopRibbon(loop, [[0, lugFloorX - base], [.0012, -.0016]], webHeight),
      polygon(loop.map(({ p }) => [lugFloorX, p[0], p[1]] as Point), [1, 0, 0]),
    )
    machinedParts.push(sweepLoopRibbon(loop, [[.0012, -.0016], [tLugSeam, 0]], webHeight))
  }

  const barrelCount = full ? 108 : 36
  // Closed connected stepped barrel: decreasing axial coordinates keep inner barrel and lip steps facing outward/inward toward the lens.
  const barrel = lathe([
    [face - .012, R + .007], [face - .0015, R + .0058], [face + .0008, R + .0030],
    [face + .0008, R + .0004], [face - .0002, R - .0026], [face - .0042, R - .0038],
    [face - .0062, R - .0068], [face - .0125, R - .0076], [face - .0152, R - .0128],
    [face - .0240, R - .0142], [face - .036, R - .0178], [.020, R - .0204],
    [-.028, R - .0220], [-.078, R - .0220], [-w.rimWidth / 2 + .014, R - .0150],
    [-w.rimWidth / 2, R + .004], ...(full ? [[-w.rimWidth / 2, R + .0075], [face - .012, R + .0075], [face - .012, R + .007]] as const : []),
  ], barrelCount)
  forgedParts.push(barrel)

  const flange = lathe([
    [face + .0009, R + .0005], [face - .0001, R - .0025], [face - .0040, R - .0037],
  ], barrelCount)

  const ringSegs = full ? 60 : 28
  const hub = lathe([
    [hubPlane - .0035, rCollar + .003], [hubPlane, rCollar], [hubPlane, rCap - .002],
    [hubPlane - .0020, rCap - .003], [hubPlane - .0020, .0002],
  ], ringSegs)

  const capRing = lathe([
    [hubPlane - .0018, rCap + .0006], [hubPlane + .0013, rCap - .0008], [hubPlane + .0014, rCap - .0038],
    [hubPlane + .0005, rCap - .0052], [hubPlane + .0005, rCap * .56],
  ], ringSegs)
  const pentCapPts: Point[] = Array.from({ length: 5 }, (_, i) => axisRoll(hubFace, rCap * .44, (i / 5) * tau + theta0))
  const pentCapBase: Point[] = Array.from({ length: 5 }, (_, i) => axisRoll(hubPlane + .0005, rCap * .58, (i / 5) * tau + theta0))
  const capFacets: T.BufferGeometry[] = [polygon(pentCapPts, [1, 0, 0])]
  for (let i = 0; i < 5; i++) {
    const j = (i + 1) % 5
    capFacets.push(polygon([pentCapBase[i], pentCapBase[j], pentCapPts[j], pentCapPts[i]], [
      1, (pentCapBase[i][1] + pentCapBase[j][1]) * .35, (pentCapBase[i][2] + pentCapBase[j][2]) * .35,
    ]))
  }
  const cap = joined([capRing, ...capFacets])

  const lugGeoms: T.BufferGeometry[] = []
  for (const [ly, lz] of lugCenters) {
    const bolt = lathe([
      [lugFloorX, .0058], [lugFloorX + .0016, .0054], [lugFloorX + .0052, .0047],
      [lugFloorX + .0056, .0042], [lugFloorX + .0056, .0026], [lugFloorX + .0022, .0022],
      [lugFloorX + .0022, .0002],
    ], full ? 12 : 8).translate(0, ly, lz)
    lugGeoms.push(bolt)
  }

  return {
    forging: joined(forgedParts),
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
  const profile = new T.CatmullRomCurve3([
    [.009, .052], [.016, .17], [.019, .38], [.018, .58], [.012, .84], [.004, .96], [-.014, 1],
    [-.040, .99], [-.055, .86], [-.058, .50], [-.056, .16], [-.051, .071], [-.044, .13],
    [-.043, .76], [-.033, .83], [-.012, .84], [.004, .80], [.005, .11],
  ].map(([x, y]) => new T.Vector3(x, y, 0)), true, 'centripetal')
  const body = (u: number, v: number): Point => {
    const { x, y: t } = profile.getPoint(v)
    const a = middle + half * (2 * u - 1)
    const radius = mix(low + lowAt(u), outer + highAt(u), t)
    const scallop = .0022 * Math.cos(tau * (rear ? 2 : 5) * (u - .035)) * smooth(t, .02, .40) * (1 - smooth(t, .56, .91))
    return axisRoll(axis + x * (.79 + .21 * smooth(u, 0, .13) * (1 - smooth(u, .87, 1))) + scallop, radius, a)
  }
  const sections = full ? 30 : 16
  const cast: T.BufferGeometry[] = [patch(body, full ? 52 : 28, sections, [-1, 0, 0])]
  for (const end of [0, 1]) {
    const a = middle + half * (2 * end - 1)
    const normal = axisRoll(0, 2 * end - 1, a + Math.PI / 2)
    const rim = Array.from({ length: sections }, (_, i) => body(end, i / sections))
    cast.push(polygon(rim, normal))
  }
  const rail = patch((u, v) => {
    const p = body(mix(.135, .864, u), mix(.045, .077, v))
    const taper = Math.sin(Math.PI * u) ** .45
    return [p[0] + .0025 * taper * Math.sin(Math.PI * v), p[1], p[2]]
  }, full ? 24 : 10, 3, [1, 0, 0])
  const clips: T.BufferGeometry[] = []
  const fasteners: T.BufferGeometry[] = []
  for (const u of [.16, .83]) {
    const [x, y, z] = body(u, .129)
    const clip = disk(.0068, .0035, x + .0012, full ? 16 : 8).translate(0, y, z)
    clips.push(clip)
    fasteners.push(disk(.0031, .0028, x + .0036, 6).translate(0, y, z))
  }
  return [joined([...cast, rail]), joined(clips), joined(fasteners)]
}

export function createWheels(parent: T.Group, m: Palette, full: boolean): Point {
  const wheelGloss = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x22252b : 0x383d46,
    metalness: full ? .64 : .44,
    roughness: full ? .19 : .25,
    clearcoat: full ? .94 : .72,
    clearcoatRoughness: .10,
    specularIntensity: .92,
    envMapIntensity: 1.45,
  }), 'none')
  const wheelMachined = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x6a707a : 0x6a707a,
    metalness: full ? .76 : .52,
    roughness: .22,
    clearcoat: .86,
    clearcoatRoughness: .10,
    envMapIntensity: 1.55,
  }), 'none')
  const wheelHardware = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x727a86 : 0x646b76,
    metalness: full ? .86 : .55,
    roughness: .22,
    clearcoat: .60,
    envMapIntensity: 1.40,
  }), 'none')
  const hatFinish = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x1c1f24 : 0x2c3037,
    metalness: full ? .68 : .45,
    roughness: .32,
    clearcoat: .35,
  }), 'none')

  let anchor: Point = [0, 0, 0]
  for (const w of [frontWheel, rearWheel]) {
    const H = w.width / 2, R = w.rim
    const axis = H - .058, face = H - .008, hubPlane = face - .030, hubFace = hubPlane + .0018
    const count = full ? 144 : 48
    const tire = tireGeometry(w, full)
    const { forging, machinedSpokes, flange, hub, cap, lugs } = forgedWheelAssembly(w, full)
    const [brake, apertures, hat] = rotor(w, full, axis)
    const [castCaliper, clips, fasteners] = caliper(w, full, axis)
    const pins = joined(Array.from({ length: 10 }, (_, i) => {
      const [, y, z] = axisRoll(0, .1065, tau * i / 10 + .134)
      return lathe([
        [axis - .0035, .0064], [axis + .0018, .0058], [axis + .0018, .0031], [axis - .0030, .0027],
      ], full ? 16 : 10).translate(0, y, z)
    }))
    const relief: T.BufferGeometry[] = []
    {
      const outerSidewall = curve([
        [R - .011, .86], [R + .013, .975], [w.radius - .054, 1], [w.radius - .026, .986],
        [w.radius - .010, .93], [w.radius, .67],
      ])
      const sideX = (r: number) => outerSidewall(r) * H - treadInset(w, r)
      for (const [r, half, rise] of [[R + .015, .0038, .0018], [w.radius - .044, .0015, .0011], [w.radius - .036, .0014, .0012]]) {
        relief.push(lathe([[sideX(r + half) - .0012, r + half], [sideX(r) + rise, r], [sideX(r - half) - .0012, r - half]], count))
      }
    }
    const sidewall = joined(relief)
    for (const side of [1, -1]) {
      const group = new T.Group()
      group.name = w === frontWheel ? 'front wheel' : 'rear wheel'
      group.position.set(w.x * side, w.loaded, w.z)
      group.scale.x = side
      add(group, 'loaded rubber and tread', tire, m.tire)
      add(group, 'forged divided spokes and barrel', forging, wheelGloss)
      add(group, 'diamond cut spoke faces', machinedSpokes, wheelMachined)
      add(group, 'machined flange', flange, wheelMachined)
      add(group, 'flat recessed hub plate', hub, wheelGloss)
      add(group, 'flat center cap', cap, wheelGloss)
      add(group, 'five lug nuts', lugs, wheelHardware)
      add(group, 'drilled ceramic rotor', brake, m.brake)
      add(group, 'recessed drill wells and rotor vents', apertures, m.dark)
      add(group, 'floating rotor hat', hat, hatFinish)
      add(group, 'rotor hat bobbins', pins, wheelHardware)
      add(group, 'recessed brake shield', disk(R - .018, .008, -.054, full ? 64 : 32), m.dark)
      add(group, 'fixed brake caliper', castCaliper, m.caliper)
      add(group, 'caliper pin seats', clips, m.matte)
      add(group, 'caliper pin heads', fasteners, wheelHardware)
      add(group, 'molded sidewall relief', sidewall, m.tire)
      parent.add(group)
    }
    if (w === frontWheel) anchor = [w.x + hubFace, w.loaded, w.z]
  }
  return anchor
}
