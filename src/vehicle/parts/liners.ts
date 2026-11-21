import * as THREE from 'three'
import { waterF0 } from '../../core/emitters-glsl'
import { stream } from '../../core/random'
import { patchMaterial } from '../../materials/patch'
import { surfaceNormal } from '../body/body'
import { arches, wheelOpenings } from '../body/cuts'
import { dims } from '../body/shape'
import { bumper } from '../body/tail'
import type { WetnessKind } from '../contract'
import type { Surface } from '../geom/cuts'
import { mirrorGeometry } from '../geom/mesh'
import { cross, dot, norm, smoothstep, sub, type V3 } from '../geom/vec'
import { ensureValidWheelGeometry, patchEmitterGlintSheen } from './wheel'

export interface LinerMaterials {
  under: THREE.Material
  matte: THREE.Material
  tag?: (material: THREE.Material, wetness: WetnessKind) => THREE.Material
}

interface ArchSample {
  readonly p: V3
  readonly n: V3
  readonly tang: V3
  readonly radIn: V3
  readonly theta: number
  readonly rCut: number
}

function vPeakOnFlank(main: Surface, u: number): number {
  let bestV = 0.24
  let bestY = -Infinity
  for (let k = 0; k <= 12; k++) {
    const v = 0.18 + (0.23 * k) / 12
    const y = main(u, v)[1]
    if (y > bestY) {
      bestY = y
      bestV = v
    }
  }
  return bestV
}

function locateOnMain(main: Surface, zTarget: number, yTarget: number): { u: number; v: number; p: V3 } {
  let u = 0.5
  let v = 0.14
  for (let pass = 0; pass < 3; pass++) {
    let uLo = 0
    let uHi = 1
    for (let k = 0; k < 20; k++) {
      const mid = (uLo + uHi) * 0.5
      if (main(mid, v)[2] > zTarget) uLo = mid
      else uHi = mid
    }
    u = (uLo + uHi) * 0.5
    const yBottom = main(u, 0)[1]
    const vTop = vPeakOnFlank(main, u)
    const yTop = main(u, vTop)[1]
    if (yTarget <= yBottom) {
      v = 0
    } else if (yTarget >= yTop) {
      v = vTop
    } else {
      let vLo = 0
      let vHi = vTop
      for (let k = 0; k < 20; k++) {
        const mid = (vLo + vHi) * 0.5
        if (main(u, mid)[1] < yTarget) vLo = mid
        else vHi = mid
      }
      v = (vLo + vHi) * 0.5
    }
  }
  return { u, v, p: main(u, v) }
}

function uAtRockerZ(main: Surface, zTarget: number): number {
  let lo = 0
  let hi = 1
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) * 0.5
    if (main(mid, 0)[2] > zTarget) lo = mid
    else hi = mid
  }
  return (lo + hi) * 0.5
}

function archRadiusAtTheta(main: Surface, zc: number, yc: number, theta: number, cutFn: (p: V3) => number): number {
  const cz = -Math.cos(theta)
  const sy = Math.sin(theta)
  let rLo = 0.26
  let rHi = 0.58
  for (let k = 0; k < 22; k++) {
    const rMid = (rLo + rHi) * 0.5
    const hit = locateOnMain(main, zc + cz * rMid, yc + sy * rMid)
    if (cutFn(hit.p) > 0) rLo = rMid
    else rHi = rMid
  }
  return (rLo + rHi) * 0.5
}

function sampleArchBoundary(main: Surface, front: boolean, count: number): ArchSample[] {
  const zc = front ? dims.frontHubZ : dims.rearHubZ
  const yc = front ? dims.frontTire.radius : dims.rearTire.radius
  const uHub = uAtRockerZ(main, zc)

  let thetaStart: number
  if (front) {
    let uRearLo = uHub
    let uRearHi = Math.min(1, uHub + 0.24)
    for (let k = 0; k < 26; k++) {
      const mid = (uRearLo + uRearHi) * 0.5
      if (wheelOpenings(main(mid, 0)) > 0) uRearLo = mid
      else uRearHi = mid
    }
    const pRear = main((uRearLo + uRearHi) * 0.5, 0)
    thetaStart = Math.atan2(pRear[1] - yc, -(pRear[2] - zc))
  } else {
    // Rear body quarter is cut away below bumper height by cornerCut so the rear tire tread is exposed from behind.
    let thLo = 0.35
    let thHi = 1.05
    for (let k = 0; k < 22; k++) {
      const thMid = (thLo + thHi) * 0.5
      const rMid = archRadiusAtTheta(main, zc, yc, thMid, arches)
      const hit = locateOnMain(main, zc - Math.cos(thMid) * rMid, yc + Math.sin(thMid) * rMid)
      if (hit.p[1] < bumper + 0.012) thLo = thMid
      else thHi = thMid
    }
    thetaStart = (thLo + thHi) * 0.5
  }

  let uFrontLo = Math.max(0, uHub - 0.24)
  let uFrontHi = uHub
  for (let k = 0; k < 26; k++) {
    const mid = (uFrontLo + uFrontHi) * 0.5
    if (wheelOpenings(main(mid, 0)) > 0) uFrontHi = mid
    else uFrontLo = mid
  }
  const pFront = main((uFrontLo + uFrontHi) * 0.5, 0)
  let thetaEnd = Math.atan2(pFront[1] - yc, -(pFront[2] - zc))
  if (thetaEnd <= thetaStart) thetaEnd += Math.PI * 2

  const samples: ArchSample[] = []
  for (let i = 0; i <= count; i++) {
    const t = i / count
    const theta = thetaStart + (thetaEnd - thetaStart) * t
    const cz = -Math.cos(theta)
    const sy = Math.sin(theta)
    const rCut = archRadiusAtTheta(main, zc, yc, theta, wheelOpenings)
    const hit = locateOnMain(main, zc + cz * rCut, yc + sy * rCut)
    const n = surfaceNormal(main, hit.u, hit.v)
    const radIn: V3 = norm([0, yc - hit.p[1], zc - hit.p[2]])
    const nDot = dot(radIn, n)
    const tang = norm([radIn[0] - n[0] * nDot, radIn[1] - n[1] * nDot, radIn[2] - n[2] * nDot])
    samples.push({ p: hit.p, n, tang, radIn, theta, rCut })
  }
  return samples
}

function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = []
  const nrm: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (const raw of parts) {
    const g = ensureValidWheelGeometry(raw)
    const p = g.getAttribute('position')
    const n = g.getAttribute('normal')
    const u = g.getAttribute('uv')
    const index = g.getIndex()!
    const base = pos.length / 3
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i))
      nrm.push(n.getX(i), n.getY(i), n.getZ(i))
      uv.push(u.getX(i), u.getY(i))
    }
    for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i))
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  out.setIndex(idx)
  return ensureValidWheelGeometry(out)
}

function buildPolygonCap(points: readonly V3[], normalDir: V3): THREE.BufferGeometry {
  const normal = new THREE.Vector3(...normalDir).normalize()
  const tangent = new THREE.Vector3(0, 1, 0).cross(normal)
  if (tangent.lengthSq() < 1e-4) tangent.set(0, 0, 1).cross(normal)
  tangent.normalize()
  const bitangent = normal.clone().cross(tangent)
  const origin = new THREE.Vector3(...points[0])
  const contour = points.map((pt) => {
    const d = new THREE.Vector3(...pt).sub(origin)
    return new THREE.Vector2(d.dot(tangent), d.dot(bitangent))
  })
  const flip = THREE.ShapeUtils.area(contour) < 0
  const tris = THREE.ShapeUtils.triangulateShape(contour, [])
  const pos: number[] = []
  const nrm: number[] = []
  const uv: number[] = []
  for (let i = 0; i < points.length; i++) {
    pos.push(points[i][0], points[i][1], points[i][2])
    nrm.push(normal.x, normal.y, normal.z)
    uv.push(contour[i].x, contour[i].y)
  }
  const idx = tris.flatMap(([a, b, c]) => (flip ? [a, c, b] : [a, b, c]))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return ensureValidWheelGeometry(g)
}

function buildOrientedGrid(
  rows: readonly (readonly V3[])[],
  hintAt: (i: number, j: number) => V3,
): THREE.BufferGeometry {
  const nRows = rows.length
  const nCols = rows[0].length
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const rowArc = new Float32Array(nRows)
  for (let i = 1; i < nRows; i++) {
    const a = rows[i - 1][Math.floor(nCols / 2)]
    const b = rows[i][Math.floor(nCols / 2)]
    rowArc[i] = rowArc[i - 1] + Math.max(1e-4, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]))
  }
  const colArc = new Float32Array(nCols)
  for (let j = 1; j < nCols; j++) {
    const a = rows[Math.floor(nRows / 2)][j - 1]
    const b = rows[Math.floor(nRows / 2)][j]
    colArc[j] = colArc[j - 1] + Math.max(1e-4, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]))
  }
  for (let i = 0; i < nRows; i++) {
    for (let j = 0; j < nCols; j++) {
      const p = rows[i][j]
      pos.push(p[0], p[1], p[2])
      uv.push(rowArc[i], colArc[j])
    }
  }
  for (let i = 0; i < nRows - 1; i++) {
    for (let j = 0; j < nCols - 1; j++) {
      const a = i * nCols + j
      const b = a + 1
      const c = (i + 1) * nCols + j + 1
      const d = (i + 1) * nCols + j
      const pa = rows[i][j]
      const pb = rows[i][j + 1]
      const pc = rows[i + 1][j + 1]
      const fn = cross(sub(pb, pa), sub(pc, pa))
      const h = hintAt(i, j)
      if (dot(fn, h) >= 0) idx.push(a, b, c, a, c, d)
      else idx.push(a, c, b, a, d, c)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return ensureValidWheelGeometry(g)
}

function sampleRearShelfNodes(main: Surface, firstArch: ArchSample, count: number): Array<{ p: V3; n: V3 }> {
  const uJoin = locateOnMain(main, firstArch.p[2], firstArch.p[1]).u
  const uTail = 0.994
  if (uTail - uJoin < 0.015) return []
  const out: Array<{ p: V3; n: V3 }> = []
  for (let i = 0; i < count; i++) {
    const u = uTail + (uJoin - uTail) * (i / count)
    let vLo = 0
    let vHi = 0.48
    for (let k = 0; k < 26; k++) {
      const mid = (vLo + vHi) * 0.5
      if (wheelOpenings(main(u, mid)) > 0) vLo = mid
      else vHi = mid
    }
    const v = (vLo + vHi) * 0.5
    out.push({ p: main(u, v), n: surfaceNormal(main, u, v) })
  }
  return out
}

function quinticStep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * t * (10 - 15 * t + 6 * t * t)
}

function sampleRockerRun(main: Surface, zCorner: number, dirZ: number, spanZ: number, count: number, reverse: boolean): Array<{ p: V3; n: V3 }> {
  const out: Array<{ p: V3; n: V3 }> = []
  for (let k = 1; k <= count; k++) {
    const s = k / count
    const z = zCorner + dirZ * spanZ * (s * 0.85 + 0.15 * s * s)
    const u = uAtRockerZ(main, z)
    out.push({ p: main(u, 0), n: surfaceNormal(main, u, 0.008) })
  }
  return reverse ? out.reverse() : out
}

function fairLipNodes(raw: ReadonlyArray<{ p: V3; n: V3 }>, front: boolean, startCornerIdx: number, rockerSegs: number): Array<{ p: V3; n: V3; tang: V3 }> {
  const m = raw.length
  let pts: V3[] = raw.map(({ p }) => [p[0], p[1], p[2]])
  for (let pass = 0; pass < 16; pass++) {
    const next: V3[] = pts.map((q) => [q[0], q[1], q[2]])
    for (let i = 1; i < m - 1; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      const c = pts[i + 1]
      const nearStartCorner = Math.abs(i - startCornerIdx) <= 8
      const nearEndCorner = Math.abs(i - (m - 1 - rockerSegs)) <= 8
      const wYZ = nearStartCorner || nearEndCorner ? 0.25 : pass < 6 ? 0.2 : 0.06
      const xSmoothed = 0.25 * a[0] + 0.5 * b[0] + 0.25 * c[0]
      next[i] = [
        Math.min(raw[i].p[0], xSmoothed),
        (1 - 2 * wYZ) * b[1] + wYZ * (a[1] + c[1]),
        (1 - 2 * wYZ) * b[2] + wYZ * (a[2] + c[2]),
      ]
    }
    pts = next
  }

  let nrms: V3[] = raw.map(({ n }) => norm([Math.max(0.68, n[0]), Math.max(-0.08, n[1]), n[2]]))
  for (let pass = 0; pass < 18; pass++) {
    const next: V3[] = nrms.map((q) => [q[0], q[1], q[2]])
    for (let i = 1; i < m - 1; i++) {
      const a = nrms[i - 1]
      const b = nrms[i]
      const c = nrms[i + 1]
      next[i] = norm([0.25 * a[0] + 0.5 * b[0] + 0.25 * c[0], 0.25 * a[1] + 0.5 * b[1] + 0.25 * c[1], 0.25 * a[2] + 0.5 * b[2] + 0.25 * c[2]])
    }
    nrms = next
  }

  const zc = front ? dims.frontHubZ : dims.rearHubZ
  const yc = front ? dims.frontTire.radius + 0.04 : dims.rearTire.radius + 0.04
  const rawTang: V3[] = pts.map((p, i) => {
    const prev = pts[Math.max(0, i - 1)]
    const next = pts[Math.min(m - 1, i + 1)]
    const tauArc = norm(sub(next, prev))
    const n = nrms[i]
    let tang = norm(cross(n, tauArc))
    const towardHub: V3 = [0, yc - p[1], zc - p[2]]
    const probe: V3 = [p[0] + tang[0] * 0.006, p[1] + tang[1] * 0.006, p[2] + tang[2] * 0.006]
    const dCut = wheelOpenings(probe) - wheelOpenings(p)
    const signCheck = Math.abs(dCut) > 1e-4 ? dCut : dot(tang, towardHub)
    if (signCheck < 0) tang = [-tang[0], -tang[1], -tang[2]]
    return tang
  })

  let tangs = rawTang
  for (let pass = 0; pass < 8; pass++) {
    const next: V3[] = tangs.map((q) => [q[0], q[1], q[2]])
    for (let i = 1; i < m - 1; i++) {
      const a = tangs[i - 1]
      const b = tangs[i]
      const c = tangs[i + 1]
      next[i] = norm([0.25 * a[0] + 0.5 * b[0] + 0.25 * c[0], 0.25 * a[1] + 0.5 * b[1] + 0.25 * c[1], 0.25 * a[2] + 0.5 * b[2] + 0.25 * c[2]])
    }
    tangs = next
  }

  return pts.map((p, i) => ({ p, n: nrms[i], tang: tangs[i] }))
}

export function archLinerParts(
  main: Surface,
  front: boolean,
  full: boolean,
): { lip: THREE.BufferGeometry; liner: THREE.BufferGeometry } {
  const lipSegs = full ? 96 : 48
  const drumSegs = full ? 40 : 26
  const rockerSegs = full ? 8 : 5
  const shelfSegs = full ? 20 : 12
  const lipSamples = sampleArchBoundary(main, front, lipSegs)
  const samples = sampleArchBoundary(main, front, drumSegs)
  const zc = front ? dims.frontHubZ : dims.rearHubZ
  const yc = front ? dims.frontTire.radius : dims.rearTire.radius

  const endRocker = sampleRockerRun(main, lipSamples[lipSamples.length - 1].p[2], 1, 0.105, rockerSegs, false)
  const rearShelf = front ? [] : sampleRearShelfNodes(main, lipSamples[0], shelfSegs)
  const rawLipNodes: Array<{ p: V3; n: V3 }> = front
    ? [
        ...sampleRockerRun(main, lipSamples[0].p[2], -1, 0.11, rockerSegs, true),
        ...lipSamples.map(({ p, n }) => ({ p, n })),
        ...endRocker,
      ]
    : [
        ...rearShelf,
        ...lipSamples.map(({ p, n }) => ({ p, n })),
        ...endRocker,
      ]

  const startCornerIdx = front ? rockerSegs : rearShelf.length
  const lipNodes = fairLipNodes(rawLipNodes, front, startCornerIdx, rockerSegs)

  const lipSection: ReadonlyArray<readonly [number, number]> = [
    [-0.0045, -0.0138],
    [0.0014, -0.0098],
    [0.0046, -0.0106],
    [0.0057, -0.0138],
    [0.0054, -0.0184],
    [0.0038, -0.0248],
    [0.0008, -0.0325],
    [-0.0045, -0.0365],
    [-0.0045, -0.0138],
  ]
  const totalNodes = lipNodes.length - 1
  const startSpan = front ? (rockerSegs + (full ? 16 : 8)) / totalNodes : (full ? 8 : 4) / totalNodes
  const endSpan = (rockerSegs + (full ? 16 : 8)) / totalNodes
  const lipRows: V3[][] = lipNodes.map(({ p, n, tang }, i) => {
    const t = i / totalNodes
    const wStart = front ? quinticStep(0, startSpan, t) : 0.35 + 0.65 * quinticStep(0, startSpan, t)
    const wEnd = quinticStep(0, endSpan, 1 - t)
    const w = Math.min(wStart, wEnd)
    const rockerRetract = -0.0038 * (1 - w)
    const depthScale = 0.28 + 0.72 * w
    return lipSection.map(([dr, dn]): V3 => {
      const drEff = dr > 0 ? dr * w + rockerRetract : dr * (0.45 + 0.55 * w) + rockerRetract
      const dnEff = -0.0145 + (dn + 0.0145) * depthScale
      const x = p[0] + tang[0] * drEff + n[0] * dnEff
      const y = p[1] + tang[1] * drEff + n[1] * dnEff
      const z = p[2] + tang[2] * drEff + n[2] * dnEff
      return [x, y, z]
    })
  })
  const lipCenter = (i: number): V3 => {
    const row = lipRows[i]
    let sx = 0
    let sy = 0
    let sz = 0
    const m = row.length - 1
    for (let j = 0; j < m; j++) {
      sx += row[j][0]
      sy += row[j][1]
      sz += row[j][2]
    }
    return [sx / m, sy / m, sz / m]
  }
  const lipTube = buildOrientedGrid(lipRows, (i, j) => {
    const mid = lipRows[i][j]
    const c = lipCenter(i)
    return norm(sub(mid, c))
  })
  const startCapPts = lipRows[0].slice(0, -1)
  const endCapPts = lipRows[lipRows.length - 1].slice(0, -1)
  const startTan = norm(sub(lipNodes[1].p, lipNodes[0].p))
  const endTan = norm(sub(lipNodes[lipNodes.length - 1].p, lipNodes[lipNodes.length - 2].p))
  const lip = mergeGeometries([
    lipTube,
    buildPolygonCap(startCapPts, [-startTan[0], -startTan[1], -startTan[2]]),
    buildPolygonCap(endCapPts, endTan),
  ])

  // Closed FrontSide wheelhouse tub: rear tub tucks tightly around the rear tire (x >= 0.635, rTight = 0.381)
  // so it stays strictly inside the wheelhouse clear of the side intake throat and clear of the exposed rear tire tread.
  const xInner = front ? 0.5 : 0.636
  const yFloor = front ? Math.max(0.126, samples[samples.length - 1].p[1] + 0.002) : 0.125
  const wallThick = 0.004
  const drumCols = full ? 6 : 4
  const rTight = (front ? dims.frontTire.radius : dims.rearTire.radius) + 0.026

  const drumPoint = (i: number, t: number, backOffset: number): V3 => {
    const s = samples[i]
    const xStart = s.p[0] - 0.017 - backOffset * 0.25
    const cz = -Math.cos(s.theta)
    const sy = Math.sin(s.theta)
    const tuck = front ? 0 : smoothstep(0.05, 0.35, t)
    const rLip = s.rCut - 0.0048
    const rib =
      full && backOffset === 0
        ? 0.0024 * (0.5 - 0.5 * Math.cos(s.theta * 28)) * smoothstep(0.06, 0.22, t) * (1 - smoothstep(0.76, 0.94, t))
        : 0
    const rCore = mixRadius(rLip, Math.min(rLip, rTight), tuck) - rib
    const fillet = Math.max(0, (t - 0.8) / 0.2)
    const rMaxArch = (front ? s.rCut - 0.0045 : Math.min(s.rCut - 0.0045, 0.4265)) + backOffset
    const rClamped = Math.min(rMaxArch, rCore - 0.014 * fillet * fillet + backOffset)
    const x = xStart + (xInner - backOffset - xStart) * t
    const rearCutShelf = !front && s.theta < 0.85 ? bumper + 0.001 : yFloor
    const yMin = Math.max(rearCutShelf, yFloor)
    const y = Math.max(yMin, yc + sy * rClamped)
    const z = zc + cz * rClamped
    return [x, y, z]
  }

  const rearApronRows = (backOffset: number): V3[][] => {
    if (front) return []
    const apronSteps = full ? 8 : 5
    const rows: V3[][] = []
    const zEnd = -1.945
    const zStart = samples[0].p[2]
    const yApron = bumper + 0.0005 + backOffset
    for (let k = apronSteps; k >= 1; k--) {
      const f = k / apronSteps
      const z = zStart + (zEnd - zStart) * f
      const shelfIdx = Math.min(rearShelf.length - 1, Math.max(0, Math.round((1 - f) * (rearShelf.length - 1))))
      const xOuterSkin = rearShelf.length > 0 ? rearShelf[shelfIdx].p[0] : samples[0].p[0]
      const xOut = Math.max(xInner + 0.04, xOuterSkin - 0.012 - backOffset * 0.25)
      const xIn = z < -1.876 ? 0.602 : xInner - backOffset
      rows.push(
        Array.from({ length: drumCols }, (__, j) => {
          const t = j / (drumCols - 1)
          return [xOut + (xIn - xOut) * t, yApron, z] as V3
        }),
      )
    }
    return rows
  }

  const apronInner = rearApronRows(0)
  const apronOuter = rearApronRows(wallThick)
  const innerDrumRows: V3[][] = [
    ...apronInner,
    ...samples.map((_, i) => Array.from({ length: drumCols }, (__, j) => drumPoint(i, j / (drumCols - 1), 0))),
  ]
  const outerDrumRows: V3[][] = [
    ...apronOuter,
    ...samples.map((_, i) => Array.from({ length: drumCols }, (__, j) => drumPoint(i, j / (drumCols - 1), wallThick))),
  ]

  const innerDrum = buildOrientedGrid(innerDrumRows, (i) =>
    i < apronInner.length ? [0, -1, 0] : samples[i - apronInner.length].radIn,
  )
  const outerDrum = buildOrientedGrid(outerDrumRows, (i) => {
    if (i < apronOuter.length) return [0, 1, 0]
    const r = samples[i - apronOuter.length].radIn
    return [-r[0], -r[1], -r[2]]
  })

  const innerArchEdge = samples.map((_, i) => innerDrumRows[apronInner.length + i][drumCols - 1])
  const zRearWall = -1.888
  const yRearFloor = 0.142
  const bulkheadPts: V3[] = front
    ? [...innerArchEdge]
    : [
        [xInner, yFloor, innerArchEdge[innerArchEdge.length - 1][2]],
        [xInner, 0.132, zc - 0.18],
        [xInner, yRearFloor, zRearWall],
        [xInner, bumper + 0.001, zRearWall],
        ...innerArchEdge,
      ]
  const backBulkheadPts: V3[] = bulkheadPts.map(([x, y, z]): V3 => [x - wallThick, y, z])
  const bulkheadInner = buildPolygonCap(bulkheadPts, [1, 0, 0])
  const bulkheadOuter = buildPolygonCap(backBulkheadPts, [-1, 0, 0])
  const bulkheadBottomPts = !front
    ? [
        [xInner, yRearFloor, zRearWall] as V3,
        [xInner, 0.132, zc - 0.18] as V3,
        [xInner, yFloor, innerArchEdge[innerArchEdge.length - 1][2]] as V3,
      ]
    : []
  const bulkheadBottomOuter = bulkheadBottomPts.map(([x, y, z]): V3 => [x - wallThick, y, z])

  const extraRearParts: THREE.BufferGeometry[] = []
  if (!front) {
    extraRearParts.push(buildOrientedGrid([bulkheadBottomPts, bulkheadBottomOuter], () => [0, -1, 0]))
    const zStepClose = -1.877
    const xStepIn = 0.602
    const stepFront: V3[][] = [
      [
        [xStepIn, yRearFloor, zStepClose],
        [xInner, yRearFloor, zStepClose],
      ],
      [
        [xStepIn, bumper + 0.001, zStepClose],
        [xInner, bumper + 0.001, zStepClose],
      ],
    ]
    const stepBack: V3[][] = stepFront.map((row) => row.map(([x, y, z]): V3 => [x, y, z - wallThick]))
    extraRearParts.push(
      buildOrientedGrid(stepFront, () => [0, 0, 1]),
      buildOrientedGrid(stepBack, () => [0, 0, -1]),
      buildOrientedGrid([stepFront[0], stepBack[0]], () => [0, -1, 0]),
      buildOrientedGrid(
        [
          [stepFront[0][0], stepFront[1][0]],
          [stepBack[0][0], stepBack[1][0]],
        ],
        () => [-1, 0, 0],
      ),
    )
    const outerApronIn = innerDrumRows.slice(0, apronInner.length + 1).map((r) => r[0])
    const outerApronOut = outerDrumRows.slice(0, apronOuter.length + 1).map((r) => r[0])
    extraRearParts.push(buildOrientedGrid([outerApronIn, outerApronOut], () => [1, 0, 0]))
  }

  const endCapRear = buildOrientedGrid([innerDrumRows[0], outerDrumRows[0]], () => [0, 0, -1])
  const endCapFront = buildOrientedGrid(
    [innerDrumRows[innerDrumRows.length - 1], outerDrumRows[outerDrumRows.length - 1]],
    () => [0, -1, 0],
  )

  const liner = mergeGeometries([
    innerDrum,
    outerDrum,
    bulkheadInner,
    bulkheadOuter,
    endCapRear,
    endCapFront,
    ...extraRearParts,
  ])

  return { lip, liner }
}

function mixRadius(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function buildLiners(sprung: THREE.Group, main: Surface, m: LinerMaterials, full: boolean): void {
  const tag = <M extends THREE.Material>(material: M, wetness: WetnessKind): M => (m.tag ? (m.tag(material, wetness) as M) : material)
  const lodTag = full ? 'full' : 'blockout'
  const archLipMat = tag(
    new THREE.MeshPhysicalMaterial({
      color: full ? 0x111317 : 0x3b3f46,
      metalness: 0.16,
      roughness: full ? 0.2 : 0.34,
      clearcoat: full ? 0.88 : 0.32,
      clearcoatRoughness: 0.058,
      specularIntensity: 1.0,
      envMapIntensity: 1.3,
    }),
    'sheet',
  )
  patchEmitterGlintSheen(archLipMat, `liner arch lip emitter glint ${lodTag}`, {
    baseCurv: 0.045,
    coatCurv: 0.038,
    coatF0: waterF0 + 0.024,
    gain: 2.15,
  })

  const linerMat = tag(
    new THREE.MeshPhysicalMaterial({
      color: full ? 0x141619 : 0x2a2d33,
      metalness: 0.06,
      roughness: full ? 0.36 : 0.62,
      clearcoat: full ? 0.6 : 0.28,
      clearcoatRoughness: 0.095,
      specularIntensity: 0.96,
      envMapIntensity: 1.1,
    }),
    'sheet',
  )
  const linerId = `wheelhouse liner molded wet finish ${lodTag}`
  const linerSeed = stream(linerId).range(0.1, 21)
  patchMaterial(linerMat, {
    id: linerId,
    uniforms: {
      wlSeed: { value: linerSeed },
      wlDetail: { value: full ? 1 : 0 },
    },
    apply(shader) {
      shader.vertexShader =
        'varying vec3 wheelLinerPt;\n' +
        shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nwheelLinerPt = position;')
      shader.fragmentShader =
        `varying vec3 wheelLinerPt;
        uniform float wlSeed;
        uniform float wlDetail;
        float wlHash(vec3 p) {
          p = fract(p * vec3(0.1031, 0.0973, 0.1099));
          p += dot(p, p.yzx + wlSeed + 19.19);
          return fract((p.x + p.y) * p.z);
        }
      ` +
        shader.fragmentShader
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            vec3 wlSym = vec3(abs(wheelLinerPt.x), wheelLinerPt.y, wheelLinerPt.z);
            float wlFoot = length(fwidth(wlSym));
            float wlLouverFade = wlDetail * (1.0 - smoothstep(0.004, 0.014, wlFoot));
            float wlLouver = sin(wlSym.y * 165.0 + wlSym.z * 28.0) * wlLouverFade;
            float wlSpray = 1.0 - smoothstep(0.22, 0.72, wlSym.y);
            float wlGrain = wlHash(floor(wlSym * 780.0)) - 0.5;
            float wlGrainW = wlDetail * (1.0 - smoothstep(0.0004, 0.0014, wlFoot));
            diffuseColor.rgb *= (1.0 + 0.14 * wlLouver + 0.08 * wlGrain * wlGrainW) * mix(1.0, 0.88, wlSpray);
          `,
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
            roughnessFactor = clamp(roughnessFactor - 0.12 * wlSpray - 0.04 * wlLouver, 0.15, 0.68);
          `,
          )
          .replace(
            '#include <normal_fragment_maps>',
            `#include <normal_fragment_maps>
            float wlReliefH = 0.0016 * wlLouver;
            vec3 wlDx = dFdx(vViewPosition), wlDy = dFdy(vViewPosition);
            vec3 wlR1 = cross(wlDy, normal), wlR2 = cross(normal, wlDx);
            float wlDet = dot(wlDx, wlR1);
            vec3 wlGrad = (dFdx(wlReliefH) * wlR1 + dFdy(wlReliefH) * wlR2) * sign(wlDet);
            normal = normalize(max(abs(wlDet), 1e-9) * normal - wlGrad);
          `,
          )
          .replace(
            '#include <clearcoat_normal_fragment_maps>',
            `#include <clearcoat_normal_fragment_maps>
            clearcoatNormal = normalize(max(abs(wlDet), 1e-9) * clearcoatNormal - 0.75 * wlGrad);
          `,
          )
    },
  })
  patchEmitterGlintSheen(linerMat, `liner tub emitter glint ${lodTag}`, {
    baseCurv: 0.14,
    coatCurv: 0.095,
    coatF0: waterF0 + 0.024,
    gain: 2.15,
  })

  const addPair = (g: THREE.BufferGeometry, mat: THREE.Material, baseName: string): void => {
    for (const [idx, geom] of [g, mirrorGeometry(g)].entries()) {
      const mesh = new THREE.Mesh(geom, mat)
      mesh.name = `${baseName}-${idx === 0 ? 'left' : 'right'}`
      mesh.castShadow = true
      mesh.receiveShadow = true
      sprung.add(mesh)
    }
  }

  for (const front of [true, false]) {
    const label = front ? 'front' : 'rear'
    const parts = archLinerParts(main, front, full)
    addPair(parts.lip, archLipMat, `arch-lip-${label}`)
    addPair(parts.liner, linerMat, `liner-${label}`)
  }
}
