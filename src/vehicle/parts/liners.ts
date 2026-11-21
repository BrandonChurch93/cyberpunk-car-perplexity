import * as THREE from 'three'
import { surfaceNormal } from '../body/body'
import { arches, wheelOpenings } from '../body/cuts'
import { dims } from '../body/shape'
import { bumper } from '../body/tail'
import type { WetnessKind } from '../contract'
import type { Surface } from '../geom/cuts'
import { mirrorGeometry } from '../geom/mesh'
import { cross, dot, norm, smoothstep, sub, type V3 } from '../geom/vec'
import { ensureValidWheelGeometry } from './wheel'

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
    if (yTarget <= yBottom) {
      v = 0
    } else {
      let vLo = 0
      let vHi = 0.48
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

export function archLinerParts(
  main: Surface,
  front: boolean,
  full: boolean,
): { lip: THREE.BufferGeometry; liner: THREE.BufferGeometry } {
  const arcSegs = full ? 64 : 36
  const samples = sampleArchBoundary(main, front, arcSegs)
  const zc = front ? dims.frontHubZ : dims.rearHubZ
  const yc = front ? dims.frontTire.radius : dims.rearTire.radius

  // Seated liner collar behind the body's 14 mm painted arch return (4 mm roll -> dr = +4 mm, dn = -14 mm).
  const lipSection: ReadonlyArray<readonly [number, number]> = [
    [-0.003, -0.0124],
    [0.0041, -0.0126],
    [0.0046, -0.0142],
    [0.0047, -0.0168],
    [0.0038, -0.0198],
    [0.0018, -0.0222],
    [-0.003, -0.0226],
    [-0.003, -0.0124],
  ]
  const lipRows: V3[][] = samples.map(({ p, n, tang }, i) => {
    const t = i / (samples.length - 1)
    const startTaper = front ? 0.35 + 0.65 * smoothstep(0, 0.06, t) : 0.65 + 0.35 * smoothstep(0, 0.05, t)
    const endTaper = 0.35 + 0.65 * smoothstep(0, 0.06, 1 - t)
    const taper = Math.min(startTaper, endTaper)
    const nSafe: V3 = norm([Math.max(0.78, n[0]), Math.max(0, n[1]), n[2]])
    return lipSection.map(([dr, dn]): V3 => {
      const drScaled = dr > 0 ? dr * taper : dr
      const x = p[0] + tang[0] * drScaled + nSafe[0] * dn
      const y = Math.max(p[1] + 0.001, p[1] + tang[1] * drScaled + nSafe[1] * dn)
      const z = p[2] + tang[2] * drScaled + nSafe[2] * dn
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
  const startTan = norm(sub(samples[1].p, samples[0].p))
  const endTan = norm(sub(samples[samples.length - 1].p, samples[samples.length - 2].p))
  const lip = mergeGeometries([
    lipTube,
    buildPolygonCap(startCapPts, [-startTan[0], -startTan[1], -startTan[2]]),
    buildPolygonCap(endCapPts, endTan),
  ])

  // Closed FrontSide wheelhouse tub: rear tub tucks tightly around the rear tire (x >= 0.635, rTight = 0.381)
  // so it stays strictly inside the wheelhouse clear of the side intake throat and clear of the exposed rear tire tread.
  const xInner = front ? 0.5 : 0.635
  const yFloor = Math.max(0.126, samples[samples.length - 1].p[1] + 0.002)
  const wallThick = 0.004
  const drumCols = full ? 5 : 4
  const rTight = (front ? dims.frontTire.radius : dims.rearTire.radius) + 0.026

  const drumPoint = (i: number, t: number, backOffset: number): V3 => {
    const s = samples[i]
    const xStart = s.p[0] - 0.019 - backOffset * 0.25
    const cz = -Math.cos(s.theta)
    const sy = Math.sin(s.theta)
    const tuck = front ? 0 : smoothstep(0.05, 0.35, t)
    const rLip = s.rCut - 0.0055
    const rCore = mixRadius(rLip, Math.min(rLip, rTight), tuck)
    const fillet = Math.max(0, (t - 0.8) / 0.2)
    const rMaxArch = (front ? s.rCut - 0.0055 : Math.min(s.rCut - 0.0055, 0.4255)) + backOffset
    const rClamped = Math.min(rMaxArch, rCore - 0.014 * fillet * fillet + backOffset)
    const x = xStart + (xInner - backOffset - xStart) * t
    const rearCutShelf = !front && s.theta < 0.85 ? bumper + 0.006 : yFloor
    const yMin = Math.max(rearCutShelf, yFloor, s.p[1] + 0.001 * (1 - t))
    const y = Math.max(yMin, yc + sy * rClamped)
    const z = zc + cz * rClamped
    return [x, y, z]
  }

  const innerDrumRows: V3[][] = samples.map((_, i) =>
    Array.from({ length: drumCols }, (__, j) => drumPoint(i, j / (drumCols - 1), 0)),
  )
  const outerDrumRows: V3[][] = samples.map((_, i) =>
    Array.from({ length: drumCols }, (__, j) => drumPoint(i, j / (drumCols - 1), wallThick)),
  )

  const innerDrum = buildOrientedGrid(innerDrumRows, (i) => samples[i].radIn)
  const outerDrum = buildOrientedGrid(outerDrumRows, (i) => {
    const r = samples[i].radIn
    return [-r[0], -r[1], -r[2]]
  })

  const innerArchEdge = samples.map((_, i) => innerDrumRows[i][drumCols - 1])
  const bulkheadPts: V3[] = front
    ? [...innerArchEdge]
    : [[xInner, 0.18, zc - 0.335], ...innerArchEdge]
  const backBulkheadPts: V3[] = bulkheadPts.map(([x, y, z]): V3 => [x - wallThick, y, z])
  const bulkheadInner = buildPolygonCap(bulkheadPts, [1, 0, 0])
  const bulkheadOuter = buildPolygonCap(backBulkheadPts, [-1, 0, 0])

  const endCapRear = buildOrientedGrid([innerDrumRows[0], outerDrumRows[0]], () => [0, -1, 0])
  const endCapFront = buildOrientedGrid(
    [innerDrumRows[samples.length - 1], outerDrumRows[samples.length - 1]],
    () => [0, -1, 0],
  )

  const liner = mergeGeometries([
    innerDrum,
    outerDrum,
    bulkheadInner,
    bulkheadOuter,
    endCapRear,
    endCapFront,
  ])

  return { lip, liner }
}

function mixRadius(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function buildLiners(sprung: THREE.Group, main: Surface, m: LinerMaterials, full: boolean): void {
  const tag = <M extends THREE.Material>(material: M, wetness: WetnessKind): M => (m.tag ? (m.tag(material, wetness) as M) : material)
  const archLipMat = tag(
    new THREE.MeshPhysicalMaterial({
      color: full ? 0x15181e : 0x3b3f46,
      metalness: 0.14,
      roughness: full ? 0.22 : 0.34,
      clearcoat: full ? 0.76 : 0.32,
      clearcoatRoughness: 0.1,
      specularIntensity: 0.9,
      envMapIntensity: 1.35,
    }),
    'sheet',
  )
  const linerMat = tag(
    new THREE.MeshPhysicalMaterial({
      color: full ? 0x14161a : 0x2a2d33,
      metalness: 0.04,
      roughness: 0.84,
      specularIntensity: 0.28,
    }),
    'none',
  )

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
