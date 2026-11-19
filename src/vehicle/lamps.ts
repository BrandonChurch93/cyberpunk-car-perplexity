import * as THREE from 'three'
import { lampThresholds } from '../director/timeline'
import type { VehicleDetail, VehicleModule } from './contract'
import type { VehicleMaterials } from './materials'
import {
  buildProfileTube,
  buildRolledPatch,
  lerp,
  makeMesh,
  mergeGeometries,
  mirrorGeometryX,
} from './surface'

export interface LampRigResult {
  group: THREE.Group
  lamps: VehicleModule['lamps']
}

function buildFrontLampSide(side: 1 | -1, detail: VehicleDetail): {
  housing: THREE.BufferGeometry
  bezels: THREE.BufferGeometry
  drlBlade: THREE.BufferGeometry
  projectorLens: THREE.BufferGeometry
  outerLens: THREE.BufferGeometry
} {
  const housingParts: THREE.BufferGeometry[] = []
  const bezelParts: THREE.BufferGeometry[] = []
  const drlParts: THREE.BufferGeometry[] = []
  const projParts: THREE.BufferGeometry[] = []

  const drlJunction: [number, number, number] = [0.808, 0.478, 2.075]
  const upperArm: Array<[number, number, number]> = [
    drlJunction,
    [0.842, 0.575, 1.905],
    [0.872, 0.662, 1.735],
  ]
  const lowerArm: Array<[number, number, number]> = [
    drlJunction,
    [0.842, 0.355, 2.125],
    [0.805, 0.235, 2.185],
  ]
  const inboardArm: Array<[number, number, number]> = [
    drlJunction,
    [0.645, 0.455, 2.205],
    [0.475, 0.428, 2.305],
  ]

  const bladeSec: Array<[number, number]> = [[-0.008, -0.004], [0.008, -0.004], [0.0065, 0.014], [-0.0065, 0.014]]
  const channelSec: Array<[number, number]> = [[-0.015, -0.022], [0.015, -0.022], [0.013, -0.005], [-0.013, -0.005]]

  for (const arm of [upperArm, lowerArm, inboardArm]) {
    drlParts.push(buildProfileTube(arm, bladeSec, [0.45, 0.2, 0.87]))
    housingParts.push(buildProfileTube(arm, channelSec, [0.45, 0.2, 0.87]))
  }

  const eyePocket = buildRolledPatch(
    16,
    12,
    (u, v, out) => {
      const x = lerp(0.51, 0.845, u)
      const yLow = lerp(0.44, 0.485, u)
      const yHigh = lerp(0.535, 0.648, u)
      const y = lerp(yLow, yHigh, v)
      const zFront = lerp(2.26, 1.88, u)
      const depth = 0.115 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI)
      out.set(x, y, zFront - 0.035 - depth)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: false },
  )
  housingParts.push(eyePocket)

  const mainProjPos: [number, number, number] = [0.676, 0.541, 2.012]
  const secProjPos: [number, number, number] = [0.764, 0.566, 1.938]

  for (const [px, py, pz, r] of [
    [...mainProjPos, 0.027],
    [...secProjPos, 0.021],
  ] as Array<[number, number, number, number]>) {
    const lens = new THREE.SphereGeometry(r, detail === 'full' ? 28 : 18, detail === 'full' ? 16 : 10, 0, Math.PI * 2, 0, Math.PI * 0.46)
    lens.rotateX(Math.PI / 2)
    lens.rotateY(0.32)
    lens.translate(px, py, pz)
    projParts.push(lens)

    const shroud = new THREE.CylinderGeometry(r * 1.18, r * 1.38, 0.046, 6, 1, true)
    shroud.rotateX(Math.PI / 2)
    shroud.rotateY(0.32)
    shroud.translate(px - 0.006, py, pz - 0.016)
    bezelParts.push(shroud)

    const trimRing = new THREE.TorusGeometry(r * 1.12, 0.0032, 8, 6)
    trimRing.rotateY(0.32)
    trimRing.translate(px + 0.002, py, pz + 0.005)
    bezelParts.push(trimRing)
  }

  const ribCount = detail === 'full' ? 9 : 5
  for (let i = 0; i < ribCount; i++) {
    const f = i / (ribCount - 1)
    const rx = lerp(0.555, 0.815, f)
    const rz = lerp(2.19, 1.89, f) - 0.042
    const ry = lerp(0.47, 0.525, f)
    const rib = new THREE.BoxGeometry(0.004, 0.028, 0.042)
    rib.rotateY(0.35)
    rib.translate(rx, ry, rz)
    bezelParts.push(rib)
  }

  const outerLensLeft = buildRolledPatch(
    detail === 'full' ? 22 : 14,
    detail === 'full' ? 14 : 10,
    (u, v, out) => {
      const x = lerp(0.515, 0.842, u)
      const yLow = lerp(0.445, 0.488, u)
      const yHigh = lerp(0.532, 0.642, u)
      const y = lerp(yLow, yHigh, v)
      const z = lerp(2.265, 1.885, u) + 0.008 * Math.sin(v * Math.PI)
      out.set(x, y, z)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: false },
  )

  const hL = mergeGeometries(housingParts)
  const bL = mergeGeometries(bezelParts)
  const dL = mergeGeometries(drlParts)
  const pL = mergeGeometries(projParts)

  if (side > 0) {
    return { housing: hL, bezels: bL, drlBlade: dL, projectorLens: pL, outerLens: outerLensLeft }
  }
  return {
    housing: mirrorGeometryX(hL),
    bezels: mirrorGeometryX(bL),
    drlBlade: mirrorGeometryX(dL),
    projectorLens: mirrorGeometryX(pL),
    outerLens: mirrorGeometryX(outerLensLeft),
  }
}

function buildRearLampSide(side: 1 | -1): {
  blade: THREE.BufferGeometry
  housing: THREE.BufferGeometry
  outerLens: THREE.BufferGeometry
} {
  const mainStem: Array<[number, number, number]> = [
    [0.345, 0.796, -2.355],
    [0.545, 0.796, -2.312],
    [0.735, 0.796, -2.235],
  ]
  const upperFork: Array<[number, number, number]> = [
    [0.735, 0.796, -2.235],
    [0.822, 0.838, -2.155],
    [0.878, 0.864, -2.092],
  ]
  const lowerFork: Array<[number, number, number]> = [
    [0.735, 0.796, -2.235],
    [0.822, 0.752, -2.158],
    [0.875, 0.728, -2.102],
  ]
  const outerArrowClose: Array<[number, number, number]> = [
    [0.878, 0.864, -2.092],
    [0.892, 0.796, -2.072],
    [0.875, 0.728, -2.102],
  ]

  const bladeSec: Array<[number, number]> = [[-0.0085, -0.004], [0.0085, -0.004], [0.007, 0.014], [-0.007, 0.014]]
  const channelSec: Array<[number, number]> = [[-0.016, -0.024], [0.016, -0.024], [0.014, -0.005], [-0.014, -0.005]]

  const bladeParts: THREE.BufferGeometry[] = []
  const houseParts: THREE.BufferGeometry[] = []
  for (const seg of [mainStem, upperFork, lowerFork, outerArrowClose]) {
    bladeParts.push(buildProfileTube(seg, bladeSec, [0, 0, -1]))
    houseParts.push(buildProfileTube(seg, channelSec, [0, 0, -1]))
  }

  const lowerReflector = buildProfileTube(
    [[0.46, 0.515, -2.37], [0.58, 0.51, -2.32]],
    [[-0.006, -0.006], [0.006, -0.006], [0.005, 0.006], [-0.005, 0.006]],
    [0, 0, -1],
  )
  bladeParts.push(lowerReflector)

  const lensLeft = buildRolledPatch(
    16,
    8,
    (u, v, out) => {
      const x = lerp(0.345, 0.89, u)
      const spread = u > 0.7 ? ((u - 0.7) / 0.3) * 0.068 : 0.014
      const y = 0.796 + (v * 2 - 1) * spread
      const z = lerp(-2.362, -2.078, Math.pow(u, 1.35)) - 0.005
      out.set(x, y, z)
    },
    { uMin: false, uMax: false, vMin: false, vMax: false, flipWinding: true },
  )

  const bL = mergeGeometries(bladeParts)
  const hL = mergeGeometries(houseParts)
  if (side > 0) return { blade: bL, housing: hL, outerLens: lensLeft }
  return { blade: mirrorGeometryX(bL), housing: mirrorGeometryX(hL), outerLens: mirrorGeometryX(lensLeft) }
}

export function createLampAssemblies(materials: VehicleMaterials, detail: VehicleDetail): LampRigResult {
  const group = new THREE.Group()
  group.name = 'lamp-assemblies'
  const lamps: VehicleModule['lamps'] = []

  const drlColor = new THREE.Color(0.92, 0.96, 1.0)
  const beamColor = new THREE.Color(0.94, 0.97, 1.0)
  const tailColor = new THREE.Color(1.0, 0.075, 0.022)

  for (const [side, tag] of [[1, 'left'], [-1, 'right']] as Array<[1 | -1, string]>) {
    const front = buildFrontLampSide(side, detail)
    group.add(makeMesh(front.housing, materials.liner, `headlamp-${tag}-housing`))
    group.add(makeMesh(front.bezels, materials.engineMetal, `headlamp-${tag}-bezels`))
    group.add(makeMesh(front.drlBlade, materials.drl, `headlamp-${tag}-drl`, false))
    group.add(makeMesh(front.projectorLens, materials.projector, `headlamp-${tag}-projector`, false))
    group.add(makeMesh(front.outerLens, materials.lampLens, `headlamp-${tag}-outer-lens`, false))

    const drlEmitter = new THREE.Object3D()
    drlEmitter.name = `emitter-drl-${tag}`
    drlEmitter.position.set(side * 0.75, 0.48, 2.14)
    drlEmitter.rotation.set(-0.04, side * 0.22, 0)
    group.add(drlEmitter)
    lamps.push({
      object: drlEmitter,
      stage: lampThresholds.running,
      beam: false,
      level: 0,
      color: drlColor.clone(),
      intensity: 4.5,
    })

    const beamEmitter = new THREE.Object3D()
    beamEmitter.name = `emitter-beam-${tag}`
    beamEmitter.position.set(side * 0.676, 0.541, 2.04)
    beamEmitter.rotation.set(THREE.MathUtils.degToRad(-2.2), THREE.MathUtils.degToRad(side * 1.6), 0)
    group.add(beamEmitter)
    lamps.push({
      object: beamEmitter,
      stage: lampThresholds.beamStart,
      beam: true,
      level: 0,
      color: beamColor.clone(),
      intensity: 260,
    })

    const rear = buildRearLampSide(side)
    group.add(makeMesh(rear.housing, materials.liner, `taillamp-${tag}-housing`))
    group.add(makeMesh(rear.blade, materials.tailLight, `taillamp-${tag}-blade`, false))
    group.add(makeMesh(rear.outerLens, materials.tailLens, `taillamp-${tag}-lens`, false))

    const tailEmitter = new THREE.Object3D()
    tailEmitter.name = `emitter-tail-${tag}`
    tailEmitter.position.set(side * 0.66, 0.796, -2.28)
    tailEmitter.rotation.set(-0.05, Math.PI - side * 0.18, 0)
    group.add(tailEmitter)
    lamps.push({
      object: tailEmitter,
      stage: lampThresholds.running,
      beam: false,
      level: 0,
      color: tailColor.clone(),
      intensity: 1.4,
    })
  }

  const thirdBrakeGeom = buildProfileTube(
    [[-0.24, 1.088, -0.68], [0, 1.092, -0.69], [0.24, 1.088, -0.68]],
    [[-0.004, -0.004], [0.004, -0.004], [0.004, 0.004], [-0.004, 0.004]],
    [0, 0, -1],
  )
  group.add(makeMesh(thirdBrakeGeom, materials.thirdBrake, 'third-brake-lamp', false))

  return { group, lamps }
}
