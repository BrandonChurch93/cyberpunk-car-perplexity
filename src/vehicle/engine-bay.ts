import * as THREE from 'three'
import type { VehicleDetail } from './contract'
import { engineBayHalfWidth } from './body'
import { evalSideMaxTop, sFromZ } from './dimensions'
import type { VehicleMaterials } from './materials'
import {
  buildProfileTube,
  buildRolledPatch,
  lerp,
  makeMesh,
  mergeGeometries,
  mirrorGeometryX,
} from './surface'

function buildHexMeshPanel(
  xHalf: number,
  zFront: number,
  zRear: number,
  yFront: number,
  yRear: number,
  cols: number,
  rows: number,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const dz = (zFront - zRear) / rows
  const dx = (xHalf * 2) / cols
  const cellR = Math.min(dx, dz) * 0.44
  const wallT = cellR * 0.24
  const depth = 0.0045

  for (let r = 0; r < rows; r++) {
    const fz = (r + 0.5) / rows
    const cz = lerp(zRear, zFront, fz)
    const cy = lerp(yRear, yFront, fz)
    const maxW = lerp(xHalf * 0.88, xHalf, fz)
    for (let c = 0; c < cols; c++) {
      const cx = -xHalf + (c + 0.5 + (r % 2) * 0.5) * dx
      if (Math.abs(cx) > maxW - cellR * 0.6) continue
      const ring = new THREE.CylinderGeometry(cellR, cellR, depth, 6, 1, true)
      ring.translate(cx, cy, cz)
      parts.push(ring)
      const capTop = new THREE.RingGeometry(cellR - wallT, cellR, 6)
      capTop.rotateX(-Math.PI / 2)
      capTop.translate(cx, cy + depth * 0.5, cz)
      parts.push(capTop)
    }
  }
  return mergeGeometries(parts)
}

export function createEngineBay(materials: VehicleMaterials, detail: VehicleDetail): THREE.Group {
  const group = new THREE.Group()
  group.name = 'engine-bay'

  const carbonParts: THREE.BufferGeometry[] = []
  const coverParts: THREE.BufferGeometry[] = []
  const metalParts: THREE.BufferGeometry[] = []
  const darkParts: THREE.BufferGeometry[] = []

  const bayTub = buildRolledPatch(
    18,
    24,
    (u, v, out) => {
      const z = lerp(-1.98, -0.66, v)
      const w = engineBayHalfWidth(z)
      const q = u * 2 - 1
      const x = q * w
      const dish = Math.abs(q) < 0.72 ? -0.14 : -0.14 * ((1 - Math.abs(q)) / 0.28)
      const s = sFromZ(z)
      const yRim = evalSideMaxTop(s) - 0.022
      out.set(x, yRim + dish, z)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: true },
  )
  darkParts.push(bayTub)

  const surroundLeft = buildRolledPatch(
    10,
    28,
    (u, v, out) => {
      const z = lerp(-1.96, -0.66, v)
      const s = sFromZ(z)
      const wOut = engineBayHalfWidth(z)
      const wIn = wOut - lerp(0.11, 0.16, v)
      const x = lerp(wIn, wOut, u)
      const yOut = evalSideMaxTop(s) - 0.016 - 0.016 * (1 - v)
      const yIn = yOut - 0.032
      out.set(x, lerp(yIn, yOut, u), z)
    },
    { uMin: true, uMax: true, vMin: true, vMax: true, flipWinding: true },
  )
  carbonParts.push(surroundLeft, mirrorGeometryX(surroundLeft))

  for (let i = 0; i < 5; i++) {
    const f = i / 4
    const zSlot = lerp(-0.78, -1.62, f)
    const s = sFromZ(zSlot)
    const yBase = evalSideMaxTop(s) - 0.032 - 0.012 * f
    const wOut = engineBayHalfWidth(zSlot) - 0.012
    const wIn = wOut - 0.125
    const louver = buildProfileTube(
      [
        [wIn, yBase - 0.012, zSlot - 0.024],
        [(wIn + wOut) * 0.5, yBase + 0.004, zSlot],
        [wOut, yBase + 0.012, zSlot + 0.022],
      ],
      [[-0.038, -0.004], [0.038, -0.004], [0.03, 0.005], [-0.03, 0.005]],
      [0, 1, 0],
    )
    carbonParts.push(louver, mirrorGeometryX(louver))
  }

  const centralPlenum = buildRolledPatch(
    14,
    22,
    (u, v, out) => {
      const z = lerp(-1.52, -0.74, v)
      const ang = (u - 0.5) * Math.PI
      const rx = lerp(0.068, 0.082, Math.sin(v * Math.PI))
      const ry = 0.044
      const x = Math.sin(ang) * rx
      const y = 0.915 + Math.cos(ang) * ry + 0.018 * v
      out.set(x, y, z)
    },
    { uMin: false, uMax: false, vMin: true, vMax: true, flipWinding: true },
  )
  coverParts.push(centralPlenum)

  const bankCoverLeft = buildRolledPatch(
    12,
    22,
    (u, v, out) => {
      const z = lerp(-1.5, -0.76, v)
      const x = lerp(0.088, 0.235, u)
      const arch = Math.sin(u * Math.PI)
      const y = 0.892 + 0.034 * arch + 0.016 * v
      out.set(x, y, z)
    },
    { uMin: true, uMax: true, vMin: true, vMax: true, flipWinding: true },
  )
  coverParts.push(bankCoverLeft, mirrorGeometryX(bankCoverLeft))

  for (let cyl = 0; cyl < 6; cyl++) {
    const f = cyl / 5
    const zRunner = lerp(-0.81, -1.44, f)
    const yRunner = lerp(0.942, 0.928, f)
    const runnerLeft = buildProfileTube(
      [
        [0.055, yRunner + 0.016, zRunner],
        [0.135, yRunner + 0.012, zRunner - 0.008],
        [0.215, yRunner - 0.014, zRunner - 0.014],
      ],
      [[-0.016, -0.011], [0.016, -0.011], [0.013, 0.012], [-0.013, 0.012]],
      [0, 1, 0],
    )
    metalParts.push(runnerLeft, mirrorGeometryX(runnerLeft))
  }

  const braceLeftA = buildProfileTube(
    [
      [0.315, 0.992, -0.75],
      [0.145, 0.978, -1.11],
      [0.026, 0.968, -1.42],
    ],
    [[-0.022, -0.008], [0.022, -0.008], [0.018, 0.009], [-0.018, 0.009]],
    [0, 1, 0],
  )
  const braceLeftB = buildProfileTube(
    [
      [0.026, 0.968, -1.42],
      [0.155, 0.958, -1.66],
      [0.265, 0.952, -1.88],
    ],
    [[-0.02, -0.007], [0.02, -0.007], [0.016, 0.008], [-0.016, 0.008]],
    [0, 1, 0],
  )
  const centerBridge = buildRolledPatch(
    10,
    12,
    (u, v, out) => {
      const z = lerp(-1.54, -1.32, v)
      const x = (u * 2 - 1) * lerp(0.085, 0.055, Math.abs(v - 0.5) * 2)
      const y = 0.972 - 0.004 * Math.abs(u * 2 - 1)
      out.set(x, y, z)
    },
    { uMin: true, uMax: true, vMin: true, vMax: true, flipWinding: true },
  )
  carbonParts.push(braceLeftA, mirrorGeometryX(braceLeftA), braceLeftB, mirrorGeometryX(braceLeftB), centerBridge)

  for (const [bx, by, bz] of [
    [0.315, 0.992, -0.75],
    [-0.315, 0.992, -0.75],
    [0.265, 0.952, -1.88],
    [-0.265, 0.952, -1.88],
  ]) {
    const bracket = new THREE.BoxGeometry(0.054, 0.02, 0.058)
    bracket.translate(bx, by - 0.004, bz)
    metalParts.push(bracket)
  }

  const hexCols = detail === 'full' ? 22 : 12
  const hexRows = detail === 'full' ? 18 : 10
  const hexMesh = buildHexMeshPanel(0.245, -1.5, -1.94, 0.952, 0.922, hexCols, hexRows)
  metalParts.push(hexMesh)

  for (let r = 0; r < 4; r++) {
    const zr = lerp(-1.56, -1.88, r / 3)
    const yr = lerp(0.956, 0.928, r / 3)
    const rib = buildProfileTube(
      [[-0.23, yr, zr], [0, yr + 0.005, zr - 0.012], [0.23, yr, zr]],
      [[-0.014, -0.004], [0.014, -0.004], [0.011, 0.005], [-0.011, 0.005]],
      [0, 1, 0],
    )
    carbonParts.push(rib)
  }

  group.add(makeMesh(mergeGeometries(carbonParts), materials.carbon, 'engine-carbon-bracing'))
  group.add(makeMesh(mergeGeometries(coverParts), materials.engineCover, 'engine-covers'))
  group.add(makeMesh(mergeGeometries(metalParts), materials.engineMetal, 'engine-metal-and-mesh'))
  group.add(makeMesh(mergeGeometries(darkParts), materials.liner, 'engine-bay-tub'))

  return group
}
