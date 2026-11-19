import * as THREE from 'three'
import type { VehicleDetail } from './contract'
import {
  FRONT_BRAKE,
  FRONT_TIRE,
  REAR_BRAKE,
  REAR_TIRE,
  type BrakeSpec,
  type TireSpec,
} from './dimensions'
import type { VehicleMaterials } from './materials'
import { clamp, makeMesh, mergeGeometries, smoothstep } from './surface'

interface WheelPlacement {
  name: string
  side: 1 | -1
  hubZ: number
  tire: TireSpec
  brake: BrakeSpec
  isFront: boolean
}

function buildTireGeometry(tire: TireSpec, side: 1 | -1, hubY: number, detail: VehicleDetail): { tread: THREE.BufferGeometry; sidewall: THREE.BufferGeometry } {
  const radialSegs = detail === 'full' ? 128 : 80
  const profileTreadSegs = detail === 'full' ? 28 : 14
  const halfW = tire.width * 0.5
  const shoulderW = halfW * 0.86
  const bulgeW = halfW * 1.018
  const rimR = tire.rimRadius + 0.004
  const outerR = tire.radius

  const applyGroundContact = (ax: number, ry: number, rz: number): [number, number, number] => {
    const worldY = hubY + ry
    let ny = ry
    let nx = ax
    if (worldY < 0.0004) {
      ny = -hubY + 0.0002
    } else if (worldY < 0.018) {
      const t = worldY / 0.018
      const blend = t * t * (3 - 2 * t)
      ny = -hubY + 0.0002 + blend * (worldY - 0.0002)
    }
    if (worldY < 0.072) {
      const load = Math.sin(clamp(worldY / 0.072, 0, 1) * Math.PI)
      const zFade = Math.exp(-(rz * rz) / (0.11 * 0.11))
      nx += Math.sign(ax) * 0.0034 * load * zFade
    }
    return [nx * side, ny, rz]
  }

  const treadCols = radialSegs + 1
  const treadRows = profileTreadSegs + 1
  const treadPos = new Float32Array(treadCols * treadRows * 3)
  const treadUv = new Float32Array(treadCols * treadRows * 2)
  const treadIdx: number[] = []

  const grooveCenters = [-0.52, -0.18, 0.18, 0.52]

  for (let j = 0; j < treadRows; j++) {
    const u = (j / profileTreadSegs) * 2 - 1
    const axBase = u * shoulderW
    const crownDrop = 0.013 * Math.pow(Math.abs(u), 2.6)
    let grooveDepth = 0
    for (const gc of grooveCenters) {
      const d = Math.abs(u - gc) / 0.055
      if (d < 1) grooveDepth = Math.max(grooveDepth, 0.0042 * (1 - d * d))
    }

    for (let i = 0; i < treadCols; i++) {
      const theta = (i / radialSegs) * Math.PI * 2
      let sipeDepth = 0
      if (detail === 'full' && Math.abs(u) > 0.24) {
        const phase = (i / radialSegs) * 44 + Math.abs(u) * 2.4
        const f = phase - Math.floor(phase)
        if (f < 0.14) sipeDepth = 0.0018 * Math.sin((f / 0.14) * Math.PI)
      }
      const r = outerR - crownDrop - grooveDepth - sipeDepth
      const ry = -Math.cos(theta) * r
      const rz = Math.sin(theta) * r
      const [px, py, pz] = applyGroundContact(axBase, ry, rz)
      const idx = j * treadCols + i
      treadPos[idx * 3] = px
      treadPos[idx * 3 + 1] = py
      treadPos[idx * 3 + 2] = pz
      treadUv[idx * 2] = (i / radialSegs) * 8
      treadUv[idx * 2 + 1] = (u + 1) * 0.5
    }
  }

  for (let j = 0; j < profileTreadSegs; j++) {
    for (let i = 0; i < radialSegs; i++) {
      const a = j * treadCols + i
      const b = a + 1
      const c = a + treadCols
      const d = c + 1
      if (side > 0) treadIdx.push(a, c, b, b, c, d)
      else treadIdx.push(a, b, c, b, d, c)
    }
  }

  const tread = new THREE.BufferGeometry()
  tread.setAttribute('position', new THREE.BufferAttribute(treadPos, 3))
  tread.setAttribute('uv', new THREE.BufferAttribute(treadUv, 2))
  tread.setIndex(treadIdx)
  tread.computeVertexNormals()

  const sideSegs = detail === 'full' ? 14 : 8
  const sideGeoms: THREE.BufferGeometry[] = []
  const shoulderTopR = outerR - 0.013

  for (const wallSign of [1, -1]) {
    const rows = sideSegs + 1
    const pos = new Float32Array(treadCols * rows * 3)
    const uv = new Float32Array(treadCols * rows * 2)
    const idx: number[] = []
    for (let j = 0; j < rows; j++) {
      const t = j / sideSegs
      const rBase = shoulderTopR * (1 - t) + rimR * t
      const bulge = Math.sin(t * Math.PI)
      let relief = 0
      if (detail === 'full' && wallSign > 0) {
        if (Math.abs(t - 0.34) < 0.035 || Math.abs(t - 0.68) < 0.03) relief = 0.0009
      }
      const ax = wallSign * (shoulderW * (1 - t) + (halfW * 0.93) * t + (bulgeW - shoulderW) * bulge + relief)
      for (let i = 0; i < treadCols; i++) {
        const theta = (i / radialSegs) * Math.PI * 2
        const ry = -Math.cos(theta) * rBase
        const rz = Math.sin(theta) * rBase
        const [px, py, pz] = applyGroundContact(ax, ry, rz)
        const k = j * treadCols + i
        pos[k * 3] = px
        pos[k * 3 + 1] = py
        pos[k * 3 + 2] = pz
        uv[k * 2] = 0.5 + 0.5 * Math.cos(theta)
        uv[k * 2 + 1] = 0.5 + 0.5 * Math.sin(theta)
      }
    }
    for (let j = 0; j < sideSegs; j++) {
      for (let i = 0; i < radialSegs; i++) {
        const a = j * treadCols + i
        const b = a + 1
        const c = a + treadCols
        const d = c + 1
        const flip = side * wallSign > 0
        if (flip) idx.push(a, c, b, b, c, d)
        else idx.push(a, b, c, b, d, c)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    sideGeoms.push(g)
  }

  return { tread, sidewall: mergeGeometries(sideGeoms) }
}

function buildQuadPrism(ptsFront: Array<[number, number, number]>, ptsBack: Array<[number, number, number]>, flip: boolean): THREE.BufferGeometry {
  const pos: number[] = []
  const idx: number[] = []
  const n = ptsFront.length
  for (let i = 0; i < n; i++) pos.push(...ptsFront[i])
  for (let i = 0; i < n; i++) pos.push(...ptsBack[i])

  for (let i = 1; i < n - 1; i++) {
    if (flip) idx.push(0, i + 1, i, n, n + i, n + i + 1)
    else idx.push(0, i, i + 1, n, n + i + 1, n + i)
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const a = i
    const b = j
    const c = n + i
    const d = n + j
    if (flip) idx.push(a, b, c, b, d, c)
    else idx.push(a, c, b, b, c, d)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function buildRimGeometries(tire: TireSpec, side: 1 | -1, detail: VehicleDetail): { alloy: THREE.BufferGeometry; machined: THREE.BufferGeometry } {
  const segs = detail === 'full' ? 96 : 64
  const rimR = tire.rimRadius
  const halfW = tire.width * 0.47
  const faceX = side * (halfW - 0.006)
  const hubFaceX = side * (halfW - 0.036)

  const alloyParts: THREE.BufferGeometry[] = []
  const machinedParts: THREE.BufferGeometry[] = []

  const barrelPts = [
    new THREE.Vector2(rimR - 0.016, -halfW),
    new THREE.Vector2(rimR + 0.005, -halfW),
    new THREE.Vector2(rimR + 0.005, -halfW + 0.014),
    new THREE.Vector2(rimR - 0.018, -halfW + 0.028),
    new THREE.Vector2(rimR - 0.026, 0),
    new THREE.Vector2(rimR - 0.014, halfW - 0.026),
    new THREE.Vector2(rimR + 0.005, halfW - 0.01),
    new THREE.Vector2(rimR + 0.005, halfW),
    new THREE.Vector2(rimR - 0.009, halfW),
    new THREE.Vector2(rimR - 0.016, halfW - 0.012),
    new THREE.Vector2(rimR - 0.032, 0),
    new THREE.Vector2(rimR - 0.022, -halfW + 0.02),
  ]
  const barrel = new THREE.LatheGeometry(barrelPts, segs)
  barrel.rotateZ(side > 0 ? -Math.PI / 2 : Math.PI / 2)
  alloyParts.push(barrel)

  const lipRing = new THREE.RingGeometry(rimR - 0.009, rimR + 0.005, segs)
  lipRing.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2)
  lipRing.translate(side * (halfW + 0.0005), 0, 0)
  machinedParts.push(lipRing)

  const hubCyl = new THREE.CylinderGeometry(0.068, 0.076, 0.044, 40)
  hubCyl.rotateZ(Math.PI / 2)
  hubCyl.translate(hubFaceX - side * 0.016, 0, 0)
  alloyParts.push(hubCyl)

  const cap = new THREE.CylinderGeometry(0.031, 0.034, 0.012, 32)
  cap.rotateZ(Math.PI / 2)
  cap.translate(hubFaceX + side * 0.004, 0, 0)
  alloyParts.push(cap)

  const hexCollar = new THREE.CylinderGeometry(0.022, 0.025, 0.015, 6)
  hexCollar.rotateZ(Math.PI / 2)
  hexCollar.translate(hubFaceX + side * 0.006, 0, 0)
  machinedParts.push(hexCollar)

  const rRoot = 0.062
  const rFork = rimR * 0.47
  const rTip = rimR - 0.008

  for (let k = 0; k < 5; k++) {
    const baseAng = (k / 5) * Math.PI * 2 + 0.14
    const boltAng = baseAng + Math.PI / 5

    const lug = new THREE.CylinderGeometry(0.0085, 0.0085, 0.018, 6)
    lug.rotateZ(Math.PI / 2)
    lug.translate(hubFaceX + side * 0.001, Math.cos(boltAng) * 0.052, Math.sin(boltAng) * 0.052)
    machinedParts.push(lug)

    const lugWell = new THREE.CylinderGeometry(0.013, 0.011, 0.012, 16, 1, true)
    lugWell.rotateZ(Math.PI / 2)
    lugWell.translate(hubFaceX - side * 0.002, Math.cos(boltAng) * 0.052, Math.sin(boltAng) * 0.052)
    alloyParts.push(lugWell)

    const stemPts = 5
    for (let s = 0; s < stemPts; s++) {
      const t0 = s / stemPts
      const t1 = (s + 1) / stemPts
      const r0 = rRoot + (rFork - rRoot) * t0
      const r1 = rRoot + (rFork - rRoot) * t1
      const w0 = 0.017 - 0.003 * t0
      const w1 = 0.017 - 0.003 * t1
      const xF0 = hubFaceX + (faceX - hubFaceX) * (t0 * 0.42)
      const xF1 = hubFaceX + (faceX - hubFaceX) * (t1 * 0.42)
      const d = 0.024

      const mkPt = (r: number, off: number, xVal: number): [number, number, number] => {
        const ca = Math.cos(baseAng)
        const sa = Math.sin(baseAng)
        return [xVal, ca * r - sa * off, sa * r + ca * off]
      }
      const frontQuad: Array<[number, number, number]> = [
        mkPt(r0, -w0, xF0),
        mkPt(r0, w0, xF0),
        mkPt(r1, w1, xF1),
        mkPt(r1, -w1, xF1),
      ]
      const backQuad: Array<[number, number, number]> = [
        mkPt(r0, -w0 * 1.28, xF0 - side * d),
        mkPt(r0, w0 * 1.28, xF0 - side * d),
        mkPt(r1, w1 * 1.28, xF1 - side * d),
        mkPt(r1, -w1 * 1.28, xF1 - side * d),
      ]
      alloyParts.push(buildQuadPrism(frontQuad, backQuad, side > 0))

      const faceStrip: Array<[number, number, number]> = [
        mkPt(r0, -w0 * 0.58, xF0 + side * 0.0012),
        mkPt(r0, w0 * 0.58, xF0 + side * 0.0012),
        mkPt(r1, w1 * 0.58, xF1 + side * 0.0012),
        mkPt(r1, -w1 * 0.58, xF1 + side * 0.0012),
      ]
      const faceBack: Array<[number, number, number]> = faceStrip.map(([px, py, pz]) => [px - side * 0.002, py, pz])
      machinedParts.push(buildQuadPrism(faceStrip, faceBack, side > 0))
    }

    for (const branchSign of [-1, 1]) {
      const segCount = 7
      const tipAng = baseAng + branchSign * (Math.PI / 9.6)
      for (let s = 0; s < segCount; s++) {
        const t0 = s / segCount
        const t1 = (s + 1) / segCount
        const curve0 = smoothstep(0, 1, t0)
        const curve1 = smoothstep(0, 1, t1)
        const a0 = baseAng + (tipAng - baseAng) * curve0
        const a1 = baseAng + (tipAng - baseAng) * curve1
        const r0 = rFork - 0.006 + (rTip - (rFork - 0.006)) * t0
        const r1 = rFork - 0.006 + (rTip - (rFork - 0.006)) * t1
        const w0 = 0.0115 - 0.003 * t0 + (t0 > 0.85 ? 0.004 * (t0 - 0.85) / 0.15 : 0)
        const w1 = 0.0115 - 0.003 * t1 + (t1 > 0.85 ? 0.004 * (t1 - 0.85) / 0.15 : 0)
        const xF0 = hubFaceX + (faceX - hubFaceX) * (0.42 + 0.58 * Math.pow(t0, 0.75))
        const xF1 = hubFaceX + (faceX - hubFaceX) * (0.42 + 0.58 * Math.pow(t1, 0.75))
        const d0 = 0.023 * (1 - 0.3 * t0)
        const d1 = 0.023 * (1 - 0.3 * t1)

        const dirY = Math.cos(a1) * r1 - Math.cos(a0) * r0
        const dirZ = Math.sin(a1) * r1 - Math.sin(a0) * r0
        const dLen = Math.hypot(dirY, dirZ) || 1
        const pY = -dirZ / dLen
        const pZ = dirY / dLen

        const p0Y = Math.cos(a0) * r0
        const p0Z = Math.sin(a0) * r0
        const p1Y = Math.cos(a1) * r1
        const p1Z = Math.sin(a1) * r1

        const frontQuad: Array<[number, number, number]> = [
          [xF0, p0Y - pY * w0, p0Z - pZ * w0],
          [xF0, p0Y + pY * w0, p0Z + pZ * w0],
          [xF1, p1Y + pY * w1, p1Z + pZ * w1],
          [xF1, p1Y - pY * w1, p1Z - pZ * w1],
        ]
        const backQuad: Array<[number, number, number]> = [
          [xF0 - side * d0, p0Y - pY * w0 * 1.35, p0Z - pZ * w0 * 1.35],
          [xF0 - side * d0, p0Y + pY * w0 * 1.35, p0Z + pZ * w0 * 1.35],
          [xF1 - side * d1, p1Y + pY * w1 * 1.35, p1Z + pZ * w1 * 1.35],
          [xF1 - side * d1, p1Y - pY * w1 * 1.35, p1Z - pZ * w1 * 1.35],
        ]
        alloyParts.push(buildQuadPrism(frontQuad, backQuad, side > 0))

        const f0 = w0 * 0.56
        const f1 = w1 * 0.56
        const mFront: Array<[number, number, number]> = [
          [xF0 + side * 0.0012, p0Y - pY * f0, p0Z - pZ * f0],
          [xF0 + side * 0.0012, p0Y + pY * f0, p0Z + pZ * f0],
          [xF1 + side * 0.0012, p1Y + pY * f1, p1Z + pZ * f1],
          [xF1 + side * 0.0012, p1Y - pY * f1, p1Z - pZ * f1],
        ]
        const mBack: Array<[number, number, number]> = mFront.map(([px, py, pz]) => [px - side * 0.002, py, pz])
        machinedParts.push(buildQuadPrism(mFront, mBack, side > 0))
      }
    }
  }

  const valve = new THREE.CylinderGeometry(0.0032, 0.004, 0.018, 10)
  valve.translate(faceX - side * 0.012, -(rimR - 0.018), 0.015)
  machinedParts.push(valve)

  return {
    alloy: mergeGeometries(alloyParts),
    machined: mergeGeometries(machinedParts),
  }
}

function buildBrakeGeometries(
  brake: BrakeSpec,
  tire: TireSpec,
  side: 1 | -1,
  detail: VehicleDetail,
): { disc: THREE.BufferGeometry; hat: THREE.BufferGeometry; caliper: THREE.BufferGeometry } {
  const halfW = tire.width * 0.47
  const discCenterX = side * (halfW - 0.068)
  const segs = detail === 'full' ? 72 : 48

  const discParts: THREE.BufferGeometry[] = []
  const hatParts: THREE.BufferGeometry[] = []
  const caliperParts: THREE.BufferGeometry[] = []

  const rIn = brake.hatRadius + 0.004
  const rOut = brake.discRadius
  const halfT = brake.discThickness * 0.5

  for (const plateSign of [-1, 1]) {
    const ring = new THREE.RingGeometry(rIn, rOut, segs, 4)
    ring.rotateY(plateSign * side > 0 ? Math.PI / 2 : -Math.PI / 2)
    ring.translate(discCenterX + side * plateSign * halfT, 0, 0)
    discParts.push(ring)
  }

  const outerBand = new THREE.CylinderGeometry(rOut, rOut, brake.discThickness * 0.36, segs, 1, true)
  outerBand.rotateZ(Math.PI / 2)
  outerBand.translate(discCenterX + side * halfT * 0.62, 0, 0)
  discParts.push(outerBand)

  const innerBand = new THREE.CylinderGeometry(rOut, rOut, brake.discThickness * 0.36, segs, 1, true)
  innerBand.rotateZ(Math.PI / 2)
  innerBand.translate(discCenterX - side * halfT * 0.62, 0, 0)
  discParts.push(innerBand)

  const vaneCount = detail === 'full' ? 36 : 18
  for (let v = 0; v < vaneCount; v++) {
    const ang = (v / vaneCount) * Math.PI * 2
    const vane = new THREE.BoxGeometry(brake.discThickness * 0.32, 0.012, 0.003)
    vane.rotateX(ang)
    vane.translate(discCenterX, Math.cos(ang) * (rOut - 0.007), Math.sin(ang) * (rOut - 0.007))
    hatParts.push(vane)
  }

  const spiralCount = detail === 'full' ? 24 : 16
  const holesPerSpiral = detail === 'full' ? 5 : 4
  for (let s = 0; s < spiralCount; s++) {
    const baseA = (s / spiralCount) * Math.PI * 2
    for (let h = 0; h < holesPerSpiral; h++) {
      const f = (h + 0.6) / holesPerSpiral
      const hr = rIn + 0.012 + (rOut - rIn - 0.022) * f
      const ha = baseA + f * 0.24
      const hole = new THREE.CylinderGeometry(0.0029, 0.0029, brake.discThickness + 0.0016, 8)
      hole.rotateZ(Math.PI / 2)
      hole.translate(discCenterX, Math.cos(ha) * hr, Math.sin(ha) * hr)
      hatParts.push(hole)
    }
  }

  const hatPts = [
    new THREE.Vector2(0.042, 0.022),
    new THREE.Vector2(brake.hatRadius * 0.72, 0.022),
    new THREE.Vector2(brake.hatRadius, 0.004),
    new THREE.Vector2(brake.hatRadius, -0.005),
    new THREE.Vector2(brake.hatRadius * 0.68, 0.014),
    new THREE.Vector2(0.042, 0.014),
  ]
  const hatBell = new THREE.LatheGeometry(hatPts, 40)
  hatBell.rotateZ(side > 0 ? -Math.PI / 2 : Math.PI / 2)
  hatBell.translate(discCenterX, 0, 0)
  hatParts.push(hatBell)

  for (let b = 0; b < 10; b++) {
    const ba = (b / 10) * Math.PI * 2
    const bobbin = new THREE.CylinderGeometry(0.0055, 0.0055, brake.discThickness + 0.005, 10)
    bobbin.rotateZ(Math.PI / 2)
    bobbin.translate(discCenterX, Math.cos(ba) * brake.hatRadius, Math.sin(ba) * brake.hatRadius)
    discParts.push(bobbin)
  }

  const arcSpan = brake.pistons >= 8 ? 1.44 : 0.96
  const arcSegs = detail === 'full' ? 18 : 10
  const calRIn = rIn + 0.006
  const calROut = rOut + 0.024
  const calHalfX = halfT + 0.028
  const centerAng = brake.caliperAngleRad

  for (let s = 0; s < arcSegs; s++) {
    const t0 = s / arcSegs - 0.5
    const t1 = (s + 1) / arcSegs - 0.5
    const a0 = centerAng + t0 * arcSpan
    const a1 = centerAng + t1 * arcSpan
    const taper0 = 1 - 0.22 * Math.pow(Math.abs(t0) * 2, 2.2)
    const taper1 = 1 - 0.22 * Math.pow(Math.abs(t1) * 2, 2.2)
    const ro0 = calRIn + (calROut - calRIn) * taper0
    const ro1 = calRIn + (calROut - calRIn) * taper1
    const hx0 = calHalfX * (0.86 + 0.14 * taper0)
    const hx1 = calHalfX * (0.86 + 0.14 * taper1)

    const mkFace = (xOff: number): Array<[number, number, number]> => [
      [discCenterX + side * xOff, Math.sin(a0) * calRIn, Math.cos(a0) * calRIn],
      [discCenterX + side * xOff, Math.sin(a0) * ro0, Math.cos(a0) * ro0],
      [discCenterX + side * xOff, Math.sin(a1) * ro1, Math.cos(a1) * ro1],
      [discCenterX + side * xOff, Math.sin(a1) * calRIn, Math.cos(a1) * calRIn],
    ]
    caliperParts.push(buildQuadPrism(mkFace(hx0), mkFace(-hx1), side > 0))
  }

  const bossCount = Math.floor(brake.pistons / 2)
  for (let p = 0; p < bossCount; p++) {
    const f = bossCount === 1 ? 0 : (p / (bossCount - 1) - 0.5) * 0.78
    const pa = centerAng + f * arcSpan
    const pr = (calRIn + calROut) * 0.49
    const boss = new THREE.CylinderGeometry(0.0155, 0.0175, calHalfX * 2.08, 16)
    boss.rotateZ(Math.PI / 2)
    boss.translate(discCenterX, Math.sin(pa) * pr, Math.cos(pa) * pr)
    caliperParts.push(boss)
  }

  for (const bridgeOff of [-0.26, 0, 0.26]) {
    const ba = centerAng + bridgeOff * arcSpan
    const bolt = new THREE.CylinderGeometry(0.0045, 0.0045, calHalfX * 2.12, 8)
    bolt.rotateZ(Math.PI / 2)
    bolt.translate(discCenterX, Math.sin(ba) * (calROut - 0.008), Math.cos(ba) * (calROut - 0.008))
    hatParts.push(bolt)
  }

  return {
    disc: mergeGeometries(discParts),
    hat: mergeGeometries(hatParts),
    caliper: mergeGeometries(caliperParts),
  }
}

export function createWheelAssemblies(materials: VehicleMaterials, detail: VehicleDetail): THREE.Group {
  const wheelsGroup = new THREE.Group()
  wheelsGroup.name = 'wheels'

  const placements: WheelPlacement[] = [
    { name: 'wheel-front-left', side: 1, hubZ: 1.286, tire: FRONT_TIRE, brake: FRONT_BRAKE, isFront: true },
    { name: 'wheel-front-right', side: -1, hubZ: 1.286, tire: FRONT_TIRE, brake: FRONT_BRAKE, isFront: true },
    { name: 'wheel-rear-left', side: 1, hubZ: -1.493, tire: REAR_TIRE, brake: REAR_BRAKE, isFront: false },
    { name: 'wheel-rear-right', side: -1, hubZ: -1.493, tire: REAR_TIRE, brake: REAR_BRAKE, isFront: false },
  ]

  for (const spec of placements) {
    const hubY = spec.tire.radius - 0.0042
    const centerX = spec.side * (spec.tire.outboardX - spec.tire.width * 0.5)
    const unit = new THREE.Group()
    unit.name = spec.name
    unit.position.set(centerX, hubY, spec.hubZ)

    const tireGeoms = buildTireGeometry(spec.tire, spec.side, hubY, detail)
    unit.add(makeMesh(tireGeoms.tread, materials.tireTread, `${spec.name}-tread`))
    unit.add(makeMesh(tireGeoms.sidewall, materials.tireSidewall, `${spec.name}-sidewall`))

    const rimGeoms = buildRimGeometries(spec.tire, spec.side, detail)
    unit.add(makeMesh(rimGeoms.alloy, materials.rimAlloy, `${spec.name}-rim-alloy`))
    unit.add(makeMesh(rimGeoms.machined, materials.rimMachined, `${spec.name}-rim-face`))

    const brakeGeoms = buildBrakeGeometries(spec.brake, spec.tire, spec.side, detail)
    unit.add(makeMesh(brakeGeoms.disc, materials.brakeDisc, `${spec.name}-disc`))
    unit.add(makeMesh(brakeGeoms.hat, materials.brakeHat, `${spec.name}-hat`))
    unit.add(makeMesh(brakeGeoms.caliper, materials.caliper, `${spec.name}-caliper`))

    void spec.isFront
    wheelsGroup.add(unit)
  }

  return wheelsGroup
}
