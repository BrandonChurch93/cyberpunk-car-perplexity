import * as THREE from 'three'
import { surfaceNormal } from '../body/body'
import { arches } from '../body/cuts'
import { dims } from '../body/shape'
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

function sampleArchBoundary(main: Surface, front: boolean, count: number): ArchSample[] {
  const zc = front ? dims.frontHubZ : dims.rearHubZ
  const yc = front ? dims.frontTire.radius : dims.rearTire.radius
  const uHub = uAtRockerZ(main, zc)

  let uRearLo = uHub
  let uRearHi = Math.min(1, uHub + 0.24)
  for (let k = 0; k < 26; k++) {
    const mid = (uRearLo + uRearHi) * 0.5
    if (arches(main(mid, 0)) > 0) uRearLo = mid
    else uRearHi = mid
  }
  const pRear = main((uRearLo + uRearHi) * 0.5, 0)
  const thetaStart = Math.atan2(pRear[1] - yc, -(pRear[2] - zc))

  let uFrontLo = Math.max(0, uHub - 0.24)
  let uFrontHi = uHub
  for (let k = 0; k < 26; k++) {
    const mid = (uFrontLo + uFrontHi) * 0.5
    if (arches(main(mid, 0)) > 0) uFrontHi = mid
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
    let rLo = 0.26
    let rHi = 0.58
    for (let k = 0; k < 22; k++) {
      const rMid = (rLo + rHi) * 0.5
      const hit = locateOnMain(main, zc + cz * rMid, yc + sy * rMid)
      if (arches(hit.p) > 0) rLo = rMid
      else rHi = rMid
    }
    const rCut = (rLo + rHi) * 0.5
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
  const arcSegs = full ? 96 : 48
  const samples = sampleArchBoundary(main, front, arcSegs)
  const zc = front ? dims.frontHubZ : dims.rearHubZ
  const yc = front ? dims.frontTire.radius : dims.rearTire.radius

  // Closed 9-station rolled arch lip collar (dr > 0 into wheel opening, dn < 0 inward from body skin).
  // Stays >= 2 mm inside S.main while giving a 3.2 mm even highlight radius and 7.6 mm radial lip thickness.
  const lipSection: ReadonlyArray<readonly [number, number]> = [
    [-0.002, -0.0142],
    [0.0004, -0.0032],
    [0.0022, -0.002],
    [0.0048, -0.0024],
    [0.0068, -0.0042],
    [0.0076, -0.0072],
    [0.0072, -0.0165],
    [0.003, -0.022],
    [-0.002, -0.022],
    [-0.002, -0.0142],
  ]
  const lipRows: V3[][] = samples.map(({ p, n, tang }, i) => {
    const t = i / (samples.length - 1)
    const endTaper = 0.25 + 0.75 * smoothstep(0, 0.08, t) * smoothstep(0, 0.08, 1 - t)
    const nSafe: V3 = norm([Math.max(0.78, n[0]), Math.max(0, n[1]), n[2]])
    return lipSection.map(([dr, dn]): V3 => {
      const drScaled = dr > 0 ? dr * endTaper : dr
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

  // Closed, 4 mm-thick FrontSide wheelhouse tub: drum + inner chassis bulkhead + sealed sill end-caps.
  const xInner = front ? 0.5 : 0.48
  const yFloor = Math.max(0.126, Math.min(samples[0].p[1], samples[samples.length - 1].p[1]) + 0.002)
  const wallThick = 0.004
  const drumCols = full ? 8 : 5

  const drumPoint = (i: number, t: number, backOffset: number): V3 => {
    const s = samples[i]
    const xOuter = s.p[0] - 0.0185
    const cz = -Math.cos(s.theta)
    const sy = Math.sin(s.theta)
    const fillet = Math.max(0, (t - 0.82) / 0.18)
    const rib = full ? -0.0018 * Math.sin(t * Math.PI * 3) * Math.sin(Math.PI * t) : 0
    const rBase = s.rCut - 0.0055 + rib - 0.016 * fillet * fillet + backOffset
    const rClamped = Math.min(s.rCut - 0.0015, rBase)
    const x = xOuter + (xInner - backOffset - xOuter) * t
    const y = Math.max(Math.max(yFloor, s.p[1] + 0.001 * (1 - t)), yc + sy * rClamped)
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

  // Solid inner chassis bulkhead at x = xInner (faces +X) and its 4 mm back wall (faces -X).
  const innerArchEdge = samples.map((_, i) => innerDrumRows[i][drumCols - 1])
  const bulkheadPts: V3[] = [...innerArchEdge]
  const backBulkheadPts: V3[] = bulkheadPts.map(([x, y, z]): V3 => [x - wallThick, y, z])
  const bulkheadInner = buildPolygonCap(bulkheadPts, [1, 0, 0])
  const bulkheadOuter = buildPolygonCap(backBulkheadPts, [-1, 0, 0])

  // Sealed sill end-caps closing the 4 mm wall between innerDrum and outerDrum at both rocker ends.
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
