import * as THREE from 'three'
import type { VehicleDetail } from './contract'
import {
  evalBodyLower,
  evalHeightWidthFactor,
  evalPlanHalfWidth,
  evalSideCenterTop,
  evalSideMaxTop,
  FRONT_HUB_Z,
  HEIGHT,
  REAR_HUB_Z,
  sFromZ,
} from './dimensions'
import type { VehicleMaterials } from './materials'
import {
  buildProfileTube,
  buildRolledPatch,
  clamp,
  filletAbs,
  lerp,
  makeMesh,
  mergeGeometries,
  mirrorGeometryX,
  smootherstep,
  smoothstep,
} from './surface'

export function bonnetSeamX(z: number): number {
  const t = clamp((z - 1.24) / (2.14 - 1.24), 0, 1)
  return lerp(0.76, 0.29, Math.pow(t, 0.88))
}

export function engineBayHalfWidth(z: number): number {
  const t = clamp((-0.66 - z) / (1.96 - 0.66), 0, 1)
  return lerp(0.47, 0.335, smootherstep(0, 1, t))
}

export function frontDoorSeamZ(y: number): number {
  if (y >= 0.58) {
    const t = clamp((y - 0.58) / (0.8 - 0.58), 0, 1)
    return lerp(0.955, 0.865, t)
  }
  const t = clamp((y - 0.14) / (0.58 - 0.14), 0, 1)
  return lerp(0.655, 0.955, Math.pow(t, 0.86))
}

export function rearDoorSeamZ(y: number): number {
  if (y >= 0.69) {
    const t = clamp((y - 0.69) / (0.86 - 0.69), 0, 1)
    return lerp(-0.46, -0.33, t)
  }
  if (y >= 0.31) {
    const t = clamp((y - 0.31) / (0.69 - 0.31), 0, 1)
    return lerp(-0.79, -0.46, t)
  }
  const t = clamp((y - 0.13) / (0.31 - 0.13), 0, 1)
  return lerp(-0.67, -0.79, t)
}

export function shoulderHeightAtZ(z: number): number {
  if (z >= 1.286) {
    const t = clamp((z - 1.286) / (2.36 - 1.286), 0, 1)
    return lerp(0.812, 0.485, Math.pow(t, 1.18))
  }
  if (z >= 0.2) {
    const t = (z - 0.2) / (1.286 - 0.2)
    return lerp(0.768, 0.812, smoothstep(0, 1, t))
  }
  if (z >= -1.493) {
    const t = (z - -1.493) / (0.2 - -1.493)
    return lerp(0.922, 0.768, smoothstep(0, 1, t))
  }
  const t = clamp((z - -2.36) / (-1.493 - -2.36), 0, 1)
  return lerp(0.865, 0.922, smoothstep(0, 1, t))
}

export function beltlineHeightAtZ(z: number): number {
  if (z >= 0.78) {
    const t = clamp((z - 0.78) / (1.35 - 0.78), 0, 1)
    return lerp(0.775, 0.822, t)
  }
  const t = clamp((0.78 - z) / (0.78 - -0.52), 0, 1)
  return lerp(0.775, 0.962, Math.pow(t, 1.08))
}

export function archCutoutY(z: number): number {
  const df = Math.abs(z - FRONT_HUB_Z)
  if (df < 0.398) {
    const u = (z - FRONT_HUB_Z) / 0.392
    const hexFlat = 1 - 0.055 * Math.pow(1 - u * u, 3)
    const h = 0.343 + 0.388 * hexFlat * Math.sqrt(Math.max(0, 1 - u * u))
    return h
  }
  const dr = Math.abs(z - REAR_HUB_Z)
  if (dr < 0.424) {
    const u = (z - REAR_HUB_Z) / 0.418
    const hexFlat = 1 - 0.055 * Math.pow(1 - u * u, 3)
    const h = 0.366 + 0.414 * hexFlat * Math.sqrt(Math.max(0, 1 - u * u))
    return h
  }
  return evalBodyLower(sFromZ(z))
}

export function evalFrontDeckHeight(xAbs: number, z: number): number {
  const s = sFromZ(z)
  const halfW = Math.max(0.08, evalPlanHalfWidth(s))
  const yCenter = evalSideCenterTop(s)
  const yMax = evalSideMaxTop(s)
  const yShoulder = shoulderHeightAtZ(z)
  const vCreaseX = lerp(0.54, 0.22, clamp((z - 1.24) / (2.25 - 1.24), 0, 1))
  const crestX = halfW * 0.73

  if (xAbs <= vCreaseX) {
    const q = xAbs / Math.max(0.05, vCreaseX)
    const spine = 0.0065 * (1 - filletAbs(q, 0.08))
    const dish = -0.011 * smoothstep(0.25, 0.95, q) * smoothstep(2.3, 1.4, z)
    return yCenter + spine + dish
  }
  if (xAbs <= crestX) {
    const q = (xAbs - vCreaseX) / Math.max(0.04, crestX - vCreaseX)
    const rise = smootherstep(0, 1, q)
    return lerp(yCenter - 0.008, yMax, rise)
  }
  const q = clamp((xAbs - crestX) / Math.max(0.03, halfW - crestX), 0, 1)
  return lerp(yMax, yShoulder, Math.pow(q, 1.45))
}

export function evalFlankX(y: number, z: number): number {
  const s = sFromZ(z)
  const halfPlan = evalPlanHalfWidth(s)
  const ySh = shoulderHeightAtZ(z)
  const hFactor = evalHeightWidthFactor(clamp(y / HEIGHT, 0, 1))

  let xOut = halfPlan * Math.min(1, hFactor / 0.992)
  if (y < ySh) {
    const lowFrac = clamp((ySh - y) / Math.max(0.18, ySh - 0.13), 0, 1)
    const rockerTuck = 0.026 * Math.pow(lowFrac, 1.7) * smoothstep(0.2, 0.5, 1 - Math.abs(z - FRONT_HUB_Z) / 0.5)
    xOut -= rockerTuck

    const doorZone = smoothstep(0.92, 0.62, z) * smoothstep(-1.05, -0.45, z)
    const vertScoop = Math.sin(clamp((y - 0.2) / 0.52, 0, 1) * Math.PI)
    const scoopDepth = 0.078 * doorZone * vertScoop * smoothstep(0.88, -0.52, z)
    xOut -= scoopDepth
  } else {
    const upFrac = clamp((y - ySh) / Math.max(0.12, HEIGHT - ySh), 0, 1)
    const tumbleX = halfPlan * evalHeightWidthFactor(clamp(y / HEIGHT, 0, 1))
    xOut = lerp(xOut, tumbleX, smootherstep(0, 0.35, upFrac))
  }

  const df = Math.abs(z - FRONT_HUB_Z)
  if (df < 0.44 && y < ySh) {
    const flare = 0.011 * Math.cos((df / 0.44) * Math.PI * 0.5) * smoothstep(0.25, 0.72, y)
    xOut = Math.min(1.012, xOut + flare)
  }
  const dr = Math.abs(z - REAR_HUB_Z)
  if (dr < 0.48 && y < ySh) {
    const flare = 0.012 * Math.cos((dr / 0.48) * Math.PI * 0.5) * smoothstep(0.28, 0.78, y)
    xOut = Math.min(1.0165, xOut + flare)
  }

  return Math.max(0.02, xOut)
}

function buildBonnet(detail: VehicleDetail): THREE.BufferGeometry {
  const nu = detail === 'full' ? 44 : 26
  const nv = detail === 'full' ? 52 : 30
  const gap = 0.0018

  const halfGeom = buildRolledPatch(
    nu,
    nv,
    (u, v, out) => {
      const zCowl = 1.445 - 0.21 * u * u
      const zFront = 2.135 - 0.035 * u * u
      const z = lerp(zCowl + gap, zFront - gap, v)
      const xMax = Math.max(0.04, bonnetSeamX(z) - gap)
      const x = u * xMax
      const y = evalFrontDeckHeight(x, z)
      out.set(x, y, z)
    },
    { uMin: false, uMax: true, vMin: true, vMax: true, flipWinding: true },
  )
  return mergeGeometries([halfGeom, mirrorGeometryX(halfGeom)])
}

function buildNoseShield(detail: VehicleDetail): THREE.BufferGeometry {
  const nu = detail === 'full' ? 36 : 22
  const nv = detail === 'full' ? 28 : 16
  const gap = 0.0018

  const halfGeom = buildRolledPatch(
    nu,
    nv,
    (u, v, out) => {
      const zBack = 2.135 - 0.035 * u * u + gap
      const zTip = lerp(2.444, 2.26, Math.pow(u, 1.35))
      const z = lerp(zBack, zTip, v)
      const s = sFromZ(z)
      const xMax = Math.min(evalPlanHalfWidth(s) * 0.94, lerp(bonnetSeamX(2.135) + 0.19, 0.035, Math.pow(v, 1.4)))
      const x = u * Math.max(0.002, xMax * (1 - 0.72 * Math.pow(v, 2.2)))
      let y = evalFrontDeckHeight(x, z)
      if (v > 0.78) {
        const drop = smoothstep(0.78, 1.0, v)
        y -= 0.022 * drop * (1 - 0.5 * u)
      }
      out.set(x, y, z)
    },
    { uMin: false, uMax: true, vMin: true, vMax: true, flipWinding: true },
  )
  return mergeGeometries([halfGeom, mirrorGeometryX(halfGeom)])
}

function buildFrontWingLeft(detail: VehicleDetail): THREE.BufferGeometry {
  const nu = detail === 'full' ? 32 : 18
  const nv = detail === 'full' ? 56 : 32
  const gap = 0.0018

  const topStrip = buildRolledPatch(
    nu,
    nv,
    (u, v, out) => {
      const zRear = lerp(1.19, 0.88, u)
      const zFront = lerp(2.12, 1.72, u)
      const z = lerp(zRear + gap, zFront - gap, v)
      const s = sFromZ(z)
      const xIn = bonnetSeamX(z) + gap
      const xOut = Math.max(xIn + 0.03, evalPlanHalfWidth(s) * 0.985)
      const x = lerp(xIn, xOut, u)
      let y = evalFrontDeckHeight(x, z)
      if (z > 1.72 && u > 0.35) {
        const brow = smoothstep(1.72, 2.08, z) * smoothstep(0.35, 1.0, u)
        y = Math.max(y, lerp(0.665, 0.555, clamp((z - 1.72) / 0.38, 0, 1)) + 0.01 * (1 - brow))
      }
      out.set(x, y, z)
    },
    { uMin: true, uMax: false, vMin: true, vMax: true, flipWinding: true },
  )

  const flankRear = buildRolledPatch(
    detail === 'full' ? 28 : 16,
    detail === 'full' ? 36 : 20,
    (u, v, out) => {
      const y = lerp(0.145, 0.805, v)
      const zSeam = frontDoorSeamZ(y) + gap
      const uArch = clamp((y - 0.343) / 0.388, -0.98, 0.98)
      const zArchRear = y < 0.725 ? FRONT_HUB_Z - 0.392 * Math.sqrt(Math.max(0.02, 1 - uArch * uArch)) : 1.24
      const z = lerp(zSeam, Math.max(zSeam + 0.025, zArchRear), u)
      const x = evalFlankX(y, z)
      out.set(x, y, z)
    },
    { uMin: true, uMax: true, vMin: true, vMax: false, flipWinding: true },
  )

  const flankArchBridge = buildRolledPatch(
    detail === 'full' ? 40 : 24,
    detail === 'full' ? 18 : 10,
    (u, v, out) => {
      const z = lerp(FRONT_HUB_Z - 0.385, FRONT_HUB_Z + 0.42, u)
      const yLow = Math.max(0.42, archCutoutY(z) + 0.003)
      const yHigh = Math.max(yLow + 0.025, shoulderHeightAtZ(z))
      const y = lerp(yLow, yHigh, v)
      const x = evalFlankX(y, z)
      out.set(x, y, z)
    },
    { uMin: false, uMax: true, vMin: true, vMax: false, flipWinding: true },
  )

  const flankFrontLower = buildRolledPatch(
    detail === 'full' ? 22 : 14,
    detail === 'full' ? 22 : 14,
    (u, v, out) => {
      const yMax = lerp(0.655, 0.495, u)
      const y = lerp(0.138, yMax, v)
      const uArch = clamp((y - 0.343) / 0.388, -0.98, 0.98)
      const zArchFront = y < 0.71 ? FRONT_HUB_Z + 0.392 * Math.sqrt(Math.max(0.02, 1 - uArch * uArch)) : FRONT_HUB_Z + 0.36
      const zNoseEdge = lerp(2.22, 1.84, v)
      const z = lerp(zArchFront, Math.max(zArchFront + 0.03, zNoseEdge), u)
      const x = evalFlankX(y, z)
      out.set(x, y, z)
    },
    { uMin: true, uMax: true, vMin: true, vMax: true, flipWinding: true },
  )

  return mergeGeometries([topStrip, flankRear, flankArchBridge, flankFrontLower])
}

function buildScissorDoorLeft(detail: VehicleDetail): THREE.BufferGeometry {
  const nu = detail === 'full' ? 56 : 32
  const nv = detail === 'full' ? 44 : 26
  const gap = 0.0018

  return buildRolledPatch(
    nu,
    nv,
    (u, v, out) => {
      const yLow = 0.215
      const zEst = lerp(-0.62, 0.9, u)
      const yTop = beltlineHeightAtZ(zEst) - gap
      const y = lerp(yLow, yTop, v)
      const zBack = rearDoorSeamZ(y) + gap
      const zFront = frontDoorSeamZ(y) - gap
      const z = lerp(zBack, zFront, u)
      let x = evalFlankX(y, z)

      if (z < -0.18 && z > -0.44 && Math.abs(y - 0.68) < 0.022) {
        const hz = Math.sin(clamp((z - -0.44) / 0.26, 0, 1) * Math.PI)
        const hy = 1 - Math.abs(y - 0.68) / 0.022
        x -= 0.016 * hz * hy
      }
      out.set(x, y, z)
    },
    { uMin: true, uMax: true, vMin: true, vMax: true, flipWinding: true },
  )
}

function buildRearHaunchLeft(detail: VehicleDetail): THREE.BufferGeometry {
  const gap = 0.0018

  const upperButtress = buildRolledPatch(
    detail === 'full' ? 32 : 18,
    detail === 'full' ? 56 : 32,
    (u, v, out) => {
      const z = lerp(-2.04, -0.56, v)
      const s = sFromZ(z)
      const xIn = z > -1.96 ? engineBayHalfWidth(z) + gap : lerp(0.34, 0.82, clamp((-z - 1.96) / 0.1, 0, 1))
      const xSh = evalFlankX(shoulderHeightAtZ(z), z)
      const x = lerp(xIn, Math.max(xIn + 0.03, xSh), u)
      const yIn = evalSideMaxTop(s) - 0.014 - 0.018 * smoothstep(-0.7, -1.9, z)
      const yOut = shoulderHeightAtZ(z)
      const crown = 0.026 * Math.sin(u * Math.PI) * smoothstep(-2.05, -1.2, z)
      const y = lerp(yIn, yOut, Math.pow(u, 1.35)) + crown
      out.set(x, y, z)
    },
    { uMin: true, uMax: false, vMin: true, vMax: true, flipWinding: true },
  )

  const flankMid = buildRolledPatch(
    detail === 'full' ? 36 : 22,
    detail === 'full' ? 34 : 20,
    (u, v, out) => {
      const y = lerp(0.145, 0.905, v)
      const zFront = y < 0.72 ? rearDoorSeamZ(y) - 0.08 : rearDoorSeamZ(y) - gap
      const uArch = clamp((y - 0.366) / 0.414, -0.98, 0.98)
      const zArchLead = y < 0.775 ? REAR_HUB_Z + 0.418 * Math.sqrt(Math.max(0.02, 1 - uArch * uArch)) : -1.493
      const z = lerp(Math.min(zFront - 0.02, zArchLead), zFront, u)
      let x = evalFlankX(y, z)
      if (z > -0.78 && y > 0.28 && y < 0.72) {
        const lip = smoothstep(-0.78, -0.52, z) * Math.sin(clamp((y - 0.28) / 0.44, 0, 1) * Math.PI)
        x -= 0.022 * lip
      }
      out.set(x, y, z)
    },
    { uMin: true, uMax: true, vMin: true, vMax: false, flipWinding: true },
  )

  const flankOverArch = buildRolledPatch(
    detail === 'full' ? 40 : 24,
    detail === 'full' ? 18 : 10,
    (u, v, out) => {
      const z = lerp(REAR_HUB_Z - 0.415, REAR_HUB_Z + 0.415, u)
      const yLow = Math.max(0.44, archCutoutY(z) + 0.003)
      const yHigh = Math.max(yLow + 0.025, shoulderHeightAtZ(z))
      const y = lerp(yLow, yHigh, v)
      const x = evalFlankX(y, z)
      out.set(x, y, z)
    },
    { uMin: false, uMax: false, vMin: true, vMax: false, flipWinding: true },
  )

  const flankRearCorner = buildRolledPatch(
    detail === 'full' ? 28 : 16,
    detail === 'full' ? 28 : 16,
    (u, v, out) => {
      const y = lerp(0.46, 0.885, v)
      const uArch = clamp((y - 0.366) / 0.414, -0.98, 0.98)
      const zArchTrail = y < 0.775 ? REAR_HUB_Z - 0.418 * Math.sqrt(Math.max(0.02, 1 - uArch * uArch)) : -1.68
      const zBack = lerp(-2.22, -2.04, v)
      const z = lerp(zBack, zArchTrail, u)
      const x = evalFlankX(y, z)
      out.set(x, y, z)
    },
    { uMin: true, uMax: true, vMin: true, vMax: true, flipWinding: true },
  )

  return mergeGeometries([upperButtress, flankMid, flankOverArch, flankRearCorner])
}

function buildRoofAndPillars(detail: VehicleDetail): THREE.BufferGeometry {
  const nu = detail === 'full' ? 40 : 24
  const nv = detail === 'full' ? 44 : 26

  const halfRoof = buildRolledPatch(
    nu,
    nv,
    (u, v, out) => {
      const z = lerp(-0.655, 0.475, v)
      const s = sFromZ(z)
      const xCantrail = lerp(0.51, 0.615, v)
      const x = u * xCantrail
      const yRailPeak = evalSideMaxTop(s)

      let y = yRailPeak
      if (x < 0.285) {
        y = yRailPeak - 0.024 + 0.002 * (1 - (x / 0.285) * (x / 0.285))
      } else if (x < 0.355) {
        const t = smoothstep(0.285, 0.355, x)
        y = lerp(yRailPeak - 0.024, yRailPeak, t)
      } else if (x > 0.415) {
        const t = clamp((x - 0.415) / Math.max(0.04, xCantrail - 0.415), 0, 1)
        y = lerp(yRailPeak, yRailPeak - 0.068, Math.pow(t, 1.55))
      }
      out.set(x, y, z)
    },
    { uMin: false, uMax: true, vMin: true, vMax: true, flipWinding: true },
  )

  const aPillarLeft = buildRolledPatch(
    detail === 'full' ? 12 : 8,
    detail === 'full' ? 32 : 18,
    (u, v, out) => {
      const z = lerp(0.46, 1.21, v)
      const s = sFromZ(z)
      const yTop = evalSideMaxTop(s) - lerp(0.064, 0.015, v)
      const xIn = lerp(0.565, 0.745, Math.pow(v, 0.92))
      const xOut = xIn + lerp(0.052, 0.072, v)
      const x = lerp(xIn, xOut, u)
      const y = yTop - 0.018 * u
      out.set(x, y, z)
    },
    { uMin: true, uMax: true, vMin: false, vMax: true, flipWinding: true },
  )

  return mergeGeometries([halfRoof, mirrorGeometryX(halfRoof), aPillarLeft, mirrorGeometryX(aPillarLeft)])
}

function buildGlazing(detail: VehicleDetail): { glass: THREE.BufferGeometry; fritAndWipers: THREE.BufferGeometry } {
  const nu = detail === 'full' ? 34 : 20
  const nv = detail === 'full' ? 34 : 20

  const halfWindscreen = buildRolledPatch(
    nu,
    nv,
    (u, v, out) => {
      const zHeader = 0.475 - 0.045 * u * u
      const zBase = 1.445 - 0.235 * u * u
      const z = lerp(zHeader, zBase, v)
      const xMax = lerp(0.562, 0.742, Math.pow(v, 0.92))
      const x = u * xMax
      const s = sFromZ(z)
      const yCenter = lerp(evalSideMaxTop(s) - 0.026, evalFrontDeckHeight(0, zBase) + 0.004, Math.pow(v, 1.04))
      const crownDrop = lerp(0.038, 0.012, v) * u * u
      out.set(x, yCenter - crownDrop, z)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, bevelRadius: 0.001, flangeDepth: 0.002, flipWinding: true },
  )

  const sideGlassLeft = buildRolledPatch(
    detail === 'full' ? 32 : 18,
    detail === 'full' ? 20 : 12,
    (u, v, out) => {
      const z = lerp(-0.52, 0.98, u)
      const s = sFromZ(z)
      const yLow = beltlineHeightAtZ(z) + 0.002
      const yHigh = z > 0.46
        ? evalSideMaxTop(s) - lerp(0.068, 0.025, clamp((z - 0.46) / 0.52, 0, 1))
        : lerp(0.968, evalSideMaxTop(s) - 0.072, smoothstep(-0.52, 0.25, z))
      const y = lerp(yLow, Math.max(yLow + 0.015, yHigh), v)
      const xLow = evalFlankX(yLow, z) - 0.008
      const xHigh = z > 0.46
        ? lerp(0.61, 0.78, clamp((z - 0.46) / 0.52, 0, 1))
        : lerp(0.52, 0.61, smoothstep(-0.52, 0.46, z))
      const x = lerp(xLow, xHigh, Math.pow(v, 0.92))
      out.set(x, y, z)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: true },
  )

  const rearCabinGlass = buildRolledPatch(
    14,
    10,
    (u, v, out) => {
      const x = (u * 2 - 1) * lerp(0.41, 0.35, v)
      const y = lerp(0.93, 1.075, v)
      const z = lerp(-0.71, -0.655, v)
      out.set(x, y, z)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: true },
  )

  const bPillarLeft = buildProfileTube(
    [
      [0.835, 0.885, -0.26],
      [0.71, 0.985, -0.22],
      [0.575, 1.072, -0.19],
    ],
    [[-0.018, -0.005], [0.018, -0.005], [0.015, 0.005], [-0.015, 0.005]],
    [1, 0, 0],
  )

  const cowlTray = buildRolledPatch(
    24,
    6,
    (u, v, out) => {
      const x = (u * 2 - 1) * 0.74
      const uAbs = Math.abs(u * 2 - 1)
      const zBase = 1.445 - 0.235 * uAbs * uAbs
      const z = lerp(zBase - 0.035, zBase + 0.015, v)
      const y = evalFrontDeckHeight(Math.abs(x), zBase) - 0.014 + 0.008 * v
      out.set(x, y, z)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: true },
  )

  const wiper1 = buildProfileTube(
    [[-0.48, 0.778, 1.31], [-0.06, 0.785, 1.415], [0.28, 0.786, 1.395]],
    [[-0.008, -0.004], [0.008, -0.004], [0.005, 0.005], [-0.005, 0.005]],
    [0, 1, 0],
  )
  const wiper2 = buildProfileTube(
    [[0.08, 0.784, 1.41], [0.38, 0.788, 1.365], [0.66, 0.798, 1.245]],
    [[-0.008, -0.004], [0.008, -0.004], [0.005, 0.005], [-0.005, 0.005]],
    [0, 1, 0],
  )

  return {
    glass: mergeGeometries([halfWindscreen, mirrorGeometryX(halfWindscreen), sideGlassLeft, mirrorGeometryX(sideGlassLeft), rearCabinGlass]),
    fritAndWipers: mergeGeometries([bPillarLeft, mirrorGeometryX(bPillarLeft), cowlTray, wiper1, wiper2]),
  }
}

function buildMirrorAssembly(side: 1 | -1): { painted: THREE.BufferGeometry; trim: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const stalk = buildProfileTube(
    [
      [0.905, 0.732, 0.768],
      [0.942, 0.768, 0.735],
      [0.978, 0.808, 0.695],
    ],
    [[-0.026, -0.006], [0.026, -0.006], [0.018, 0.007], [-0.018, 0.007]],
    [0, 0, 1],
  )

  const capShell = buildRolledPatch(
    18,
    14,
    (u, v, out) => {
      const x = lerp(0.924, 1.133, u)
      const arch = Math.sin(u * Math.PI)
      const yMid = lerp(0.848, 0.862, u)
      const halfH = lerp(0.044, 0.052, arch) * (1 - 0.26 * Math.pow(u, 2.4))
      const ang = (v - 0.5) * Math.PI * 1.06
      const y = yMid + Math.sin(ang) * halfH
      const zRear = 0.562 + 0.022 * Math.abs(v - 0.5)
      const zNose = lerp(0.806, 0.688, Math.pow(u, 1.25)) - 0.032 * Math.pow(Math.abs(v - 0.5) * 2, 1.6)
      const z = lerp(zRear, zNose, Math.cos(ang * 0.82))
      out.set(x, y, z)
    },
    { uMin: true, uMax: true, vMin: true, vMax: true, bevelRadius: 0.0015, flangeDepth: 0.004, flipWinding: false },
  )

  const bezel = buildRolledPatch(
    14,
    10,
    (u, v, out) => {
      const x = lerp(0.93, 1.126, u)
      const yMid = lerp(0.848, 0.862, u)
      const halfH = 0.042 * (1 - 0.24 * u * u)
      const y = yMid + (v * 2 - 1) * halfH
      const z = 0.564 + 0.006 * u
      out.set(x, y, z)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: true },
  )

  const mirrorPane = buildRolledPatch(
    12,
    8,
    (u, v, out) => {
      const x = lerp(0.938, 1.118, u)
      const yMid = lerp(0.848, 0.862, u)
      const halfH = 0.036 * (1 - 0.24 * u * u)
      const y = yMid + (v * 2 - 1) * halfH
      const z = 0.561 + 0.006 * u
      out.set(x, y, z)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: true },
  )

  const paintedLeft = capShell
  const trimLeft = mergeGeometries([stalk, bezel])
  const glassLeft = mirrorPane

  if (side > 0) return { painted: paintedLeft, trim: trimLeft, glass: glassLeft }
  return {
    painted: mirrorGeometryX(paintedLeft),
    trim: mirrorGeometryX(trimLeft),
    glass: mirrorGeometryX(glassLeft),
  }
}

function buildSplitterAndFrontIntakes(detail: VehicleDetail): {
  carbon: THREE.BufferGeometry
  paintedBlades: THREE.BufferGeometry
  darkRecess: THREE.BufferGeometry
} {
  const carbonParts: THREE.BufferGeometry[] = []
  const bladeParts: THREE.BufferGeometry[] = []
  const darkParts: THREE.BufferGeometry[] = []

  const halfSplitter = buildRolledPatch(
    detail === 'full' ? 34 : 20,
    detail === 'full' ? 14 : 8,
    (u, v, out) => {
      const zFront = lerp(2.4735, 2.22, Math.pow(u, 1.38))
      const zBack = lerp(1.95, 1.69, u)
      const z = lerp(zBack, zFront, v)
      const s = sFromZ(z)
      const xMax = Math.min(evalPlanHalfWidth(s) * 0.985, lerp(0.96, 0.045, Math.pow(v, 3.2) * (1 - u)))
      const x = u * evalPlanHalfWidth(s) * 0.985
      const yBase = evalBodyLower(s)
      const y = yBase + 0.028 * (1 - v * 0.65) + (u > 0.86 ? 0.025 * ((u - 0.86) / 0.14) : 0)
      void xMax
      out.set(x, y, z)
    },
    { uMin: false, uMax: true, vMin: false, vMax: true, bevelRadius: 0.002, flangeDepth: 0.012, flipWinding: true },
  )
  carbonParts.push(halfSplitter, mirrorGeometryX(halfSplitter))

  const centerStrut = new THREE.BoxGeometry(0.036, 0.17, 0.14)
  centerStrut.translate(0, 0.255, 2.35)
  carbonParts.push(centerStrut)

  const diagBladeLeft = buildProfileTube(
    [
      [0.255, 0.375, 2.385],
      [0.395, 0.275, 2.365],
      [0.545, 0.155, 2.325],
    ],
    [[-0.026, -0.055], [0.026, -0.045], [0.018, 0.055], [-0.018, 0.045]],
    [0, 0, 1],
  )
  bladeParts.push(diagBladeLeft, mirrorGeometryX(diagBladeLeft))

  const intakeFrameLeft = buildProfileTube(
    [
      [0.535, 0.165, 2.315],
      [0.795, 0.175, 2.225],
      [0.835, 0.265, 2.175],
      [0.775, 0.405, 2.155],
      [0.445, 0.415, 2.285],
      [0.375, 0.275, 2.335],
    ],
    [[-0.016, -0.028], [0.016, -0.028], [0.014, 0.028], [-0.014, 0.028]],
    [0, 0, 1],
    true,
    false,
  )
  carbonParts.push(intakeFrameLeft, mirrorGeometryX(intakeFrameLeft))

  const intakeVaneLeft = buildProfileTube(
    [[0.46, 0.29, 2.24], [0.64, 0.285, 2.2], [0.8, 0.28, 2.15]],
    [[-0.008, -0.032], [0.008, -0.032], [0.006, 0.032], [-0.006, 0.032]],
    [0, 1, 0],
  )
  carbonParts.push(intakeVaneLeft, mirrorGeometryX(intakeVaneLeft))

  const frontCavityBack = buildRolledPatch(
    28,
    12,
    (u, v, out) => {
      const x = (u * 2 - 1) * 0.88
      const y = lerp(0.145, 0.445, v)
      const z = 2.14 - 0.12 * Math.abs(u * 2 - 1)
      out.set(x, y, z)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: false },
  )
  darkParts.push(frontCavityBack)

  const sensorBox = new THREE.BoxGeometry(0.072, 0.054, 0.04)
  sensorBox.translate(0, 0.375, 2.365)
  darkParts.push(sensorBox)

  return {
    carbon: mergeGeometries(carbonParts),
    paintedBlades: mergeGeometries(bladeParts),
    darkRecess: mergeGeometries(darkParts),
  }
}

function buildSillsUnderbodyAndLiners(detail: VehicleDetail): {
  sillsCarbon: THREE.BufferGeometry
  linersAndBacking: THREE.BufferGeometry
} {
  const sillParts: THREE.BufferGeometry[] = []
  const linerParts: THREE.BufferGeometry[] = []

  const sillLeft = buildRolledPatch(
    detail === 'full' ? 36 : 20,
    8,
    (u, v, out) => {
      const z = lerp(-1.07, 0.89, u)
      const s = sFromZ(z)
      const xBody = evalPlanHalfWidth(s)
      const y = lerp(0.127, 0.222, v)
      const finOut = v < 0.38 ? 0.012 * (1 - v / 0.38) : -0.014 * ((v - 0.38) / 0.62)
      const x = xBody * 0.982 + finOut
      out.set(x, y, z)
    },
    { uMin: true, uMax: true, vMin: true, vMax: true, bevelRadius: 0.002, flangeDepth: 0.015, flipWinding: true },
  )
  sillParts.push(sillLeft, mirrorGeometryX(sillLeft))

  const frontArchFinLeft = buildProfileTube(
    [
      [0.972, 0.15, 0.875],
      [0.978, 0.34, 0.895],
      [0.968, 0.54, 0.925],
    ],
    [[-0.012, -0.032], [0.012, -0.032], [0.008, 0.032], [-0.008, 0.032]],
    [1, 0, 0],
  )
  sillParts.push(frontArchFinLeft, mirrorGeometryX(frontArchFinLeft))

  const sideScoopSplitterLeft = buildProfileTube(
    [
      [0.82, 0.355, -0.58],
      [0.91, 0.362, -0.68],
      [0.975, 0.37, -0.82],
    ],
    [[-0.007, -0.045], [0.007, -0.045], [0.005, 0.045], [-0.005, 0.045]],
    [0, 1, 0],
  )
  sillParts.push(sideScoopSplitterLeft, mirrorGeometryX(sideScoopSplitterLeft))

  const undertray = buildRolledPatch(
    20,
    36,
    (u, v, out) => {
      const s = lerp(0.02, 0.94, v)
      const z = 4.947 * (0.5 - s)
      let halfW = evalPlanHalfWidth(s) * 0.94
      if (Math.abs(z - FRONT_HUB_Z) < 0.43) halfW = Math.min(halfW, 0.64)
      if (Math.abs(z - REAR_HUB_Z) < 0.46) halfW = Math.min(halfW, 0.61)
      const x = (u * 2 - 1) * halfW
      const y = evalBodyLower(s) + 0.003
      out.set(x, y, z)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: true },
  )
  linerParts.push(undertray)

  for (const [hubZ, rOuter, wIn, wOut] of [
    [FRONT_HUB_Z, 0.398, 0.62, 0.992],
    [REAR_HUB_Z, 0.424, 0.59, 1.002],
  ] as Array<[number, number, number, number]>) {
    const archHood = buildRolledPatch(
      28,
      8,
      (u, v, out) => {
        const ang = lerp(-0.22, Math.PI + 0.22, u)
        const z = hubZ + Math.cos(ang) * rOuter
        const y = Math.max(0.132, 0.355 + Math.sin(ang) * rOuter)
        const x = lerp(wIn, wOut, v)
        out.set(x, y, z)
      },
      { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: false },
    )
    const archBackWall = buildRolledPatch(
      14,
      14,
      (u, v, out) => {
        const z = hubZ + (u * 2 - 1) * rOuter
        const y = lerp(0.132, 0.74, v)
        out.set(wIn, y, z)
      },
      { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: true },
    )
    linerParts.push(archHood, mirrorGeometryX(archHood), archBackWall, mirrorGeometryX(archBackWall))
  }

  const sideIntakeThroatLeft = buildRolledPatch(
    18,
    18,
    (u, v, out) => {
      const z = lerp(-1.12, -0.44, u)
      const y = lerp(0.16, 0.88, v)
      const pocketDepth = 0.165 * smoothstep(-0.44, -0.68, z) * smoothstep(-1.12, -0.82, z)
      const x = evalFlankX(y, z) - 0.012 - pocketDepth
      out.set(x, y, z)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: true },
  )
  linerParts.push(sideIntakeThroatLeft, mirrorGeometryX(sideIntakeThroatLeft))

  const upperButtressScoopLeft = buildProfileTube(
    [
      [0.755, 0.835, -0.48],
      [0.725, 0.865, -0.64],
      [0.695, 0.875, -0.78],
    ],
    [[-0.042, -0.024], [0.042, -0.024], [0.036, 0.024], [-0.036, 0.024]],
    [1, 0.6, 0],
  )
  linerParts.push(upperButtressScoopLeft, mirrorGeometryX(upperButtressScoopLeft))

  const shutBackingLeft = buildRolledPatch(
    44,
    18,
    (u, v, out) => {
      const z = lerp(-2.12, 2.28, u)
      const s = sFromZ(z)
      const yTop = evalSideMaxTop(s) - 0.018
      const yLow = Math.max(0.145, archCutoutY(z) + 0.01)
      const y = lerp(yLow, Math.max(yLow + 0.05, yTop), v)
      const x = Math.min(evalFlankX(y, z) - 0.012, evalPlanHalfWidth(s) * 0.96)
      out.set(Math.max(0.02, x), y, z)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: true },
  )
  linerParts.push(shutBackingLeft, mirrorGeometryX(shutBackingLeft))

  const frontDeckBacking = buildRolledPatch(
    24,
    24,
    (u, v, out) => {
      const z = lerp(1.22, 2.38, v)
      const s = sFromZ(z)
      const x = (u * 2 - 1) * evalPlanHalfWidth(s) * 0.88
      const y = evalFrontDeckHeight(Math.abs(x), z) - 0.011
      out.set(x, y, z)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: true },
  )
  linerParts.push(frontDeckBacking)

  return {
    sillsCarbon: mergeGeometries(sillParts),
    linersAndBacking: mergeGeometries(linerParts),
  }
}

function buildCabinInterior(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []

  const tub = new THREE.BoxGeometry(1.32, 0.42, 1.55)
  tub.translate(0, 0.48, 0.22)
  parts.push(tub)

  const dash = buildRolledPatch(
    18,
    10,
    (u, v, out) => {
      const x = (u * 2 - 1) * 0.68
      const z = lerp(0.68, 1.18, v)
      const binnacle = x > 0.14 && x < 0.52 ? 0.038 * Math.sin(((x - 0.14) / 0.38) * Math.PI) * (1 - v * 0.5) : 0
      const y = lerp(0.76, 0.79, v) + binnacle
      out.set(x, y, z)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: true },
  )
  parts.push(dash)

  const consoleSpine = buildProfileTube(
    [[0, 0.56, -0.35], [0, 0.64, 0.28], [0, 0.74, 0.78]],
    [[-0.085, -0.04], [0.085, -0.04], [0.068, 0.045], [-0.068, 0.045]],
    [0, 1, 0],
  )
  parts.push(consoleSpine)

  for (const sx of [-1, 1]) {
    const seatBack = buildProfileTube(
      [
        [sx * 0.33, 0.44, -0.18],
        [sx * 0.33, 0.74, -0.34],
        [sx * 0.32, 0.99, -0.44],
      ],
      [[-0.19, -0.045], [0.19, -0.045], [0.15, 0.048], [-0.15, 0.048]],
      [0, 0, 1],
    )
    const seatBase = new THREE.BoxGeometry(0.4, 0.09, 0.46)
    seatBase.translate(sx * 0.33, 0.43, 0.06)
    parts.push(seatBack, seatBase)
  }

  const wheelRing = new THREE.TorusGeometry(0.155, 0.017, 10, 28)
  wheelRing.rotateX(-0.36)
  wheelRing.translate(0.33, 0.77, 0.56)
  const wheelCol = new THREE.CylinderGeometry(0.032, 0.038, 0.24, 12)
  wheelCol.rotateX(Math.PI / 2 - 0.36)
  wheelCol.translate(0.33, 0.79, 0.67)
  parts.push(wheelRing, wheelCol)

  const bulkhead = new THREE.BoxGeometry(1.18, 0.66, 0.08)
  bulkhead.translate(0, 0.74, -0.62)
  parts.push(bulkhead)

  return mergeGeometries(parts)
}

export function createBodyPanels(materials: VehicleMaterials, detail: VehicleDetail): THREE.Group {
  const group = new THREE.Group()
  group.name = 'body-panels'

  group.add(makeMesh(buildBonnet(detail), materials.paint, 'bonnet'))
  group.add(makeMesh(buildNoseShield(detail), materials.paint, 'nose-shield'))

  const frontWingL = buildFrontWingLeft(detail)
  group.add(makeMesh(frontWingL, materials.paint, 'front-wing-left'))
  group.add(makeMesh(mirrorGeometryX(frontWingL), materials.paint, 'front-wing-right'))

  const doorL = buildScissorDoorLeft(detail)
  group.add(makeMesh(doorL, materials.paint, 'door-left'))
  group.add(makeMesh(mirrorGeometryX(doorL), materials.paint, 'door-right'))

  const haunchL = buildRearHaunchLeft(detail)
  group.add(makeMesh(haunchL, materials.paint, 'rear-haunch-left'))
  group.add(makeMesh(mirrorGeometryX(haunchL), materials.paint, 'rear-haunch-right'))

  group.add(makeMesh(buildRoofAndPillars(detail), materials.paint, 'roof'))

  const glazing = buildGlazing(detail)
  group.add(makeMesh(glazing.glass, materials.glass, 'cabin-glass'))
  group.add(makeMesh(glazing.fritAndWipers, materials.glossBlack, 'cabin-trim'))

  for (const [side, label] of [[1, 'mirror-left'], [-1, 'mirror-right']] as Array<[1 | -1, string]>) {
    const mGroup = new THREE.Group()
    mGroup.name = label
    const mGeoms = buildMirrorAssembly(side)
    mGroup.add(makeMesh(mGeoms.painted, materials.paint, `${label}-cap`))
    mGroup.add(makeMesh(mGeoms.trim, materials.carbon, `${label}-stalk`))
    mGroup.add(makeMesh(mGeoms.glass, materials.mirrorGlass, `${label}-glass`, false))
    group.add(mGroup)
  }

  const frontAero = buildSplitterAndFrontIntakes(detail)
  group.add(makeMesh(frontAero.carbon, materials.carbon, 'front-splitter'))
  group.add(makeMesh(frontAero.paintedBlades, materials.paint, 'front-intake-blades'))
  group.add(makeMesh(frontAero.darkRecess, materials.liner, 'front-intake-recess'))

  const lower = buildSillsUnderbodyAndLiners(detail)
  group.add(makeMesh(lower.sillsCarbon, materials.carbon, 'rocker-sills'))
  group.add(makeMesh(lower.linersAndBacking, materials.liner, 'underbody-and-liners'))

  group.add(makeMesh(buildCabinInterior(), materials.interior, 'cabin-interior'))

  return group
}
