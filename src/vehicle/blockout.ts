import * as THREE from 'three'
import type { Anchor, VehicleModule, VehicleOptions, VehicleState } from './contract'

const length = 4.947
const width = 2.033
const height = 1.16
const frontHubZ = 1.286
const rearHubZ = -1.494
const frontHubX = 0.86
const rearHubX = 0.8505
const frontTire = { radius: 0.3468, width: 0.265 }
const rearTire = { radius: 0.3702, width: 0.345 }

const side: Array<[number, number]> = [
  [0.0, 0.2], [0.004, 0.33], [0.06, 0.47], [0.16, 0.6], [0.26, 0.7], [0.36, 0.9], [0.45, 0.99], [0.54, 1.0],
  [0.62, 0.93], [0.76, 0.84], [0.9, 0.8], [0.985, 0.78], [1.0, 0.6], [0.99, 0.3], [0.96, 0.13], [0.04, 0.12],
]

function anchor(position: [number, number, number], normal: [number, number, number], radius: number): Anchor {
  return { position: new THREE.Vector3(...position), normal: new THREE.Vector3(...normal).normalize(), radius }
}

function body(material: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape()
  side.forEach(([s, h], i) => {
    const z = length * (0.5 - s)
    const y = height * h
    if (i === 0) shape.moveTo(z, y)
    else shape.lineTo(z, y)
  })
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSize: 0.16, bevelThickness: 0.22, bevelSegments: 6, curveSegments: 4 })
  geometry.translate(0, 0, -width / 2)
  geometry.scale(1, 1, width / (width + 0.44))
  geometry.rotateY(-Math.PI / 2)
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    const z = position.getZ(i)
    const y = position.getY(i)
    const s = 0.5 - z / length
    const plan = 0.82 + 0.18 * Math.sin(Math.PI * Math.min(1, Math.max(0, (s + 0.12) / 1.05)))
    const cabin = y > 0.74 ? 1 - 0.42 * Math.min(1, (y - 0.74) / 0.4) : 1
    position.setX(i, position.getX(i) * plan * cabin)
  }
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

export function createBlockout(_options: VehicleOptions): VehicleModule {
  const root = new THREE.Group()
  root.name = 'vehicle'
  const shell = new THREE.MeshStandardMaterial({ color: 0x8d9299, roughness: 0.55, metalness: 0 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.8 })
  const metal = new THREE.MeshStandardMaterial({ color: 0x6a6e76, roughness: 0.5 })
  const bodyGroup = new THREE.Group()
  bodyGroup.add(body(shell))
  root.add(bodyGroup)

  const wheels: Array<[number, number, typeof frontTire]> = [
    [frontHubX, frontHubZ, frontTire], [-frontHubX, frontHubZ, frontTire], [rearHubX, rearHubZ, rearTire], [-rearHubX, rearHubZ, rearTire],
  ]
  for (const [x, z, tire] of wheels) {
    const group = new THREE.Group()
    const rubber = new THREE.Mesh(new THREE.CylinderGeometry(tire.radius, tire.radius, tire.width, 64, 1), dark)
    rubber.rotation.z = Math.PI / 2
    rubber.castShadow = true
    const rimRadius = tire === frontTire ? 0.254 : 0.2667
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(rimRadius, rimRadius, tire.width + 0.012, 48, 1), metal)
    rim.rotation.z = Math.PI / 2
    group.add(rubber, rim)
    for (let k = 0; k < 5; k++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.02, rimRadius * 0.95, 0.05), dark)
      spoke.position.set(Math.sign(x) * (tire.width / 2 + 0.008), 0, 0)
      spoke.rotation.x = (k / 5) * Math.PI * 2
      spoke.translateY(rimRadius * 0.5)
      group.add(spoke)
    }
    group.position.set(x, tire.radius, z)
    root.add(group)
  }

  const lampMaterial = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: 0x1b1c20, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.4 })
  const lamps: VehicleModule['lamps'] = []
  const addLamp = (geometry: THREE.BufferGeometry, position: [number, number, number], rotation: [number, number, number], stage: number, beam: boolean, color = 0xffffff): void => {
    const material = lampMaterial()
    material.emissive.setHex(color)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...position)
    mesh.rotation.set(...rotation)
    root.add(mesh)
    lamps.push({ object: mesh, stage, beam })
  }
  for (const sx of [1, -1]) {
    addLamp(new THREE.BoxGeometry(0.34, 0.025, 0.05), [sx * 0.7, 0.6, 2.2], [0, sx * 0.5, sx * 0.35], 0.08, false)
    addLamp(new THREE.BoxGeometry(0.3, 0.025, 0.05), [sx * 0.72, 0.5, 2.24], [0, sx * 0.5, -sx * 0.35], 0.08, false)
    addLamp(new THREE.BoxGeometry(0.16, 0.07, 0.05), [sx * 0.62, 0.56, 2.26], [0, sx * 0.4, 0], 0.45, true)
    addLamp(new THREE.BoxGeometry(0.4, 0.03, 0.05), [sx * 0.62, 0.76, -2.42], [0, 0, sx * 0.3], 0.08, false, 0xff1a10)
    addLamp(new THREE.BoxGeometry(0.34, 0.03, 0.05), [sx * 0.66, 0.68, -2.43], [0, 0, -sx * 0.3], 0.08, false, 0xff1a10)
  }

  const heatSources: VehicleModule['heatSources'] = []
  for (const sx of [1, -1]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.12, 32, 1, true), metal)
    pipe.rotation.x = Math.PI / 2
    pipe.position.set(sx * 0.18, 0.8, -2.44)
    root.add(pipe)
    heatSources.push({ object: pipe, strength: 1 })
  }

  const bay = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 1.1), dark)
  bay.position.set(0, 0.93, -1.3)
  root.add(bay)

  const anchors: VehicleModule['anchors'] = {
    paint: anchor([0.78, 0.8, 1.15], [0.25, 0.95, 0.1], 0.35),
    wheel: anchor([frontHubX + frontTire.width / 2, frontTire.radius, frontHubZ], [1, 0, 0], 0.36),
    lamp: anchor([0.7, 0.57, 2.22], [0.45, 0.25, 0.85], 0.2),
    detail: anchor([0, 0.95, -1.3], [0, 1, 0], 0.5),
    exhaust: anchor([0, 0.8, -2.47], [0, 0, -1], 0.28),
  }

  const update = (state: VehicleState): void => {
    for (const lamp of lamps) {
      const lit = THREE.MathUtils.smoothstep(state.lampStage, lamp.stage, lamp.stage + 0.12)
      const material = (lamp.object as THREE.Mesh).material as THREE.MeshStandardMaterial
      material.emissiveIntensity = lit * (lamp.beam ? 6 : 3)
    }
    const shake = state.vibration * 0.0012
    bodyGroup.position.y = shake * Math.sin(state.timeSeconds * 2 * Math.PI * 25)
    bodyGroup.rotation.z = shake * 0.6 * Math.sin(state.timeSeconds * 2 * Math.PI * 12.5)
  }

  return { root, anchors, surfaces: [{ material: shell, wetness: 'beads' }, { material: dark, wetness: 'sheet' }], lamps, heatSources, update, setPaint: () => undefined }
}
