import * as THREE from 'three'
import type { VehicleDetail, VehicleModule } from './contract'
import { evalBodyLower, evalPlanHalfWidth, sFromZ } from './dimensions'
import type { VehicleMaterials } from './materials'
import {
  buildProfileTube,
  buildRolledPatch,
  clamp,
  lerp,
  makeMesh,
  mergeGeometries,
  mirrorGeometryX,
  smoothstep,
} from './surface'

function buildActiveWing(detail: VehicleDetail): { painted: THREE.BufferGeometry; underside: THREE.BufferGeometry } {
  const nu = detail === 'full' ? 40 : 24
  const nv = detail === 'full' ? 20 : 12
  const gap = 0.0018

  const halfTop = buildRolledPatch(
    nu,
    nv,
    (u, v, out) => {
      const x = u * 0.845
      const zFront = lerp(-1.965, -2.035, Math.pow(u, 1.4)) - gap
      const zBack = lerp(-2.382, -2.125, Math.pow(u, 1.65))
      const z = lerp(zBack, zFront, v)
      const doubleArch = 0.036 * Math.exp(-Math.pow((x - 0.215) / 0.145, 2))
      const centerDip = -0.022 * Math.exp(-Math.pow(x / 0.095, 2)) * (1 - v * 0.6)
      const gurneyKick = (1 - v) < 0.22 ? 0.007 * (1 - (1 - v) / 0.22) : 0
      const yBase = lerp(0.882, 0.916, v) - 0.014 * u * u
      out.set(x, yBase + doubleArch + centerDip + gurneyKick, z)
    },
    { uMin: false, uMax: true, vMin: true, vMax: true, flipWinding: true },
  )

  const halfBottom = buildRolledPatch(
    18,
    10,
    (u, v, out) => {
      const x = u * 0.84
      const zFront = lerp(-1.97, -2.04, Math.pow(u, 1.4))
      const zBack = lerp(-2.378, -2.128, Math.pow(u, 1.65))
      const z = lerp(zBack, zFront, v)
      const doubleArch = 0.032 * Math.exp(-Math.pow((x - 0.215) / 0.145, 2))
      const y = lerp(0.864, 0.892, v) + doubleArch - 0.014 * u * u
      out.set(x, y, z)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: false },
  )

  return {
    painted: mergeGeometries([halfTop, mirrorGeometryX(halfTop)]),
    underside: mergeGeometries([halfBottom, mirrorGeometryX(halfBottom)]),
  }
}

function buildHexExhaustUnit(side: 1 | -1): { bezel: THREE.BufferGeometry; pipes: THREE.BufferGeometry } {
  const cx = side * 0.195
  const cy = 0.795
  const cz = -2.425

  const hexRing: Array<[number, number, number]> = [
    [cx - 0.132, cy, cz + 0.012],
    [cx - 0.088, cy + 0.056, cz + 0.004],
    [cx + 0.088, cy + 0.056, cz + 0.004],
    [cx + 0.132, cy, cz + 0.012],
    [cx + 0.088, cy - 0.054, cz + 0.008],
    [cx - 0.088, cy - 0.054, cz + 0.008],
  ]

  const bezel = buildProfileTube(
    hexRing,
    [[-0.011, -0.026], [0.011, -0.026], [0.009, 0.026], [-0.009, 0.026]],
    [0, 0, -1],
    true,
    false,
  )

  const pipeGeoms: THREE.BufferGeometry[] = []
  for (const offX of [-0.05, 0.05]) {
    const outerPipe = new THREE.CylinderGeometry(0.039, 0.039, 0.145, 28, 1, true)
    outerPipe.rotateX(Math.PI / 2)
    outerPipe.translate(cx + offX, cy, cz + 0.072)
    pipeGeoms.push(outerPipe)

    const lip = new THREE.TorusGeometry(0.038, 0.0032, 8, 28)
    lip.translate(cx + offX, cy, cz + 0.002)
    pipeGeoms.push(lip)

    const baffle = new THREE.CircleGeometry(0.038, 20)
    baffle.rotateY(Math.PI)
    baffle.translate(cx + offX, cy, cz + 0.138)
    pipeGeoms.push(baffle)
  }

  return { bezel, pipes: mergeGeometries(pipeGeoms) }
}

function buildDiffuserAndRearFascia(detail: VehicleDetail): {
  carbon: THREE.BufferGeometry
  darkCoves: THREE.BufferGeometry
} {
  const carbonParts: THREE.BufferGeometry[] = []
  const darkParts: THREE.BufferGeometry[] = []

  const halfBumperBar = buildRolledPatch(
    detail === 'full' ? 28 : 16,
    10,
    (u, v, out) => {
      const x = u * 0.875
      const zPeak = lerp(-2.4735, -2.18, Math.pow(u, 1.52))
      const yMid = lerp(0.545, 0.505, u * u)
      const ang = (v - 0.5) * Math.PI * 0.92
      const y = yMid + Math.sin(ang) * lerp(0.048, 0.032, u)
      const z = zPeak + (1 - Math.cos(ang)) * 0.042
      out.set(x, y, z)
    },
    { uMin: false, uMax: true, vMin: true, vMax: true, flipWinding: true },
  )
  carbonParts.push(halfBumperBar, mirrorGeometryX(halfBumperBar))

  const halfDiffuserRoof = buildRolledPatch(
    detail === 'full' ? 28 : 16,
    detail === 'full' ? 24 : 14,
    (u, v, out) => {
      const z = lerp(-2.465, -1.86, v)
      const s = sFromZ(z)
      const maxW = Math.min(0.82, evalPlanHalfWidth(s) * 0.92)
      const x = u * maxW
      const yRear = lerp(0.478, 0.365, Math.pow(u, 1.4))
      const yFront = 0.135
      const tunnelArch = 0.024 * Math.abs(Math.sin(u * Math.PI * 2.5)) * (1 - v)
      const y = lerp(yRear, yFront, Math.pow(v, 0.82)) + tunnelArch
      out.set(x, y, z)
    },
    { uMin: false, uMax: true, vMin: false, vMax: false, flipWinding: false },
  )
  carbonParts.push(halfDiffuserRoof, mirrorGeometryX(halfDiffuserRoof))

  const finSamples = 14
  for (const [xTop, xBot, zFrontShift] of [
    [0.415, 0.408, 0],
    [0.645, 0.572, 0.05],
  ] as Array<[number, number, number]>) {
    const frontEdge: Array<[number, number, number]> = []
    const pos: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= finSamples; i++) {
      const f = i / finSamples
      const z = lerp(-2.425 + zFrontShift, -1.94 + zFrontShift, f)
      const s = clamp(sFromZ(z), 0, 1)
      const yBot = evalBodyLower(s) + (xTop > 0.5 ? 0.022 : 0.002)
      const yTop = lerp(0.555, 0.24, Math.pow(f, 0.85))
      const xB = lerp(xBot, xTop, smoothstep(0.35, 1.0, 1 - f))
      const halfT = 0.009
      pos.push(
        xTop + halfT, yTop, z,
        xB + halfT, yBot, z,
        xTop - halfT, yTop, z,
        xB - halfT, yBot, z,
      )
      frontEdge.push([xB, yBot, z])
    }
    void frontEdge
    for (let i = 0; i < finSamples; i++) {
      const base = i * 4
      idx.push(
        base, base + 1, base + 4, base + 1, base + 5, base + 4,
        base + 2, base + 6, base + 3, base + 3, base + 6, base + 7,
        base + 1, base + 3, base + 5, base + 3, base + 7, base + 5,
        base, base + 4, base + 2, base + 2, base + 4, base + 6,
      )
    }
    const finGeom = new THREE.BufferGeometry()
    finGeom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    finGeom.setIndex(idx)
    finGeom.computeVertexNormals()
    carbonParts.push(finGeom, mirrorGeometryX(finGeom))
  }

  const endplateLeft = buildProfileTube(
    [
      [0.825, 0.245, -2.02],
      [0.835, 0.365, -2.12],
      [0.855, 0.495, -2.2],
    ],
    [[-0.01, -0.045], [0.01, -0.045], [0.008, 0.045], [-0.008, 0.045]],
    [1, 0, 0],
  )
  carbonParts.push(endplateLeft, mirrorGeometryX(endplateLeft))

  const exhaustShroud = buildRolledPatch(
    24,
    12,
    (u, v, out) => {
      const x = (u * 2 - 1) * 0.355
      const y = lerp(0.705, 0.885, v)
      const z = -2.395 - 0.025 * Math.sin(v * Math.PI) * (1 - Math.pow(Math.abs(u * 2 - 1), 2))
      out.set(x, y, z)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: true },
  )
  darkParts.push(exhaustShroud)

  const rearUpperBridge = buildRolledPatch(
    28,
    14,
    (u, v, out) => {
      const x = (u * 2 - 1) * 0.86
      const xAbs = Math.abs(x)
      const y = lerp(0.555, 0.875, v)
      const zOut = lerp(-2.42, -2.08, Math.pow(xAbs / 0.86, 1.5))
      const coveDepth = xAbs > 0.34 && y > 0.69 ? 0.095 * smoothstep(0.34, 0.5, xAbs) : 0
      out.set(x, y, zOut + coveDepth)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: true },
  )
  darkParts.push(rearUpperBridge)

  const centerPillar = buildProfileTube(
    [[0, 0.585, -2.435], [0, 0.715, -2.415], [0, 0.855, -2.385]],
    [[-0.036, -0.024], [0.036, -0.024], [0.024, 0.026], [-0.024, 0.026]],
    [0, 0, -1],
  )
  carbonParts.push(centerPillar)

  return {
    carbon: mergeGeometries(carbonParts),
    darkCoves: mergeGeometries(darkParts),
  }
}

export function createRearAssembly(
  materials: VehicleMaterials,
  detail: VehicleDetail,
): { group: THREE.Group; heatSources: VehicleModule['heatSources'] } {
  const group = new THREE.Group()
  group.name = 'rear-assembly'

  const wing = buildActiveWing(detail)
  group.add(makeMesh(wing.painted, materials.paint, 'active-wing'))
  group.add(makeMesh(wing.underside, materials.carbon, 'active-wing-underside'))

  const diffuser = buildDiffuserAndRearFascia(detail)
  group.add(makeMesh(diffuser.carbon, materials.carbon, 'rear-diffuser'))
  group.add(makeMesh(diffuser.darkCoves, materials.liner, 'rear-coves'))

  const heatSources: VehicleModule['heatSources'] = []
  for (const [side, label] of [[1, 'exhaust-left'], [-1, 'exhaust-right']] as Array<[1 | -1, string]>) {
    const exGeoms = buildHexExhaustUnit(side)
    group.add(makeMesh(exGeoms.bezel, materials.exhaustBezel, `${label}-bezel`))
    group.add(makeMesh(exGeoms.pipes, materials.exhaustPipe, `${label}-pipes`))

    const heatEmitter = new THREE.Object3D()
    heatEmitter.name = `${label}-heat`
    heatEmitter.position.set(side * 0.195, 0.795, -2.44)
    heatEmitter.rotation.y = Math.PI
    group.add(heatEmitter)
    heatSources.push({ object: heatEmitter, strength: 1 })
  }

  return { group, heatSources }
}
