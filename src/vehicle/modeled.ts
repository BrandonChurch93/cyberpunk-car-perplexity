import * as T from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { config } from '../config'
import { events, lampThresholds } from '../director/timeline'
import { smooth, tau } from './geometry'
import { palette, type Palette } from './materials'
import type { Anchor, VehicleDetail, VehicleModule, VehicleOptions, VehicleState } from './contract'

type Lamp = VehicleModule['lamps'][number]
type Lumen = { mesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>; lamp: Lamp; rear: boolean }

const files = new Map<VehicleDetail, Promise<ArrayBuffer>>()

async function read(path: string): Promise<ArrayBuffer> {
  if (typeof document === 'undefined') {
    const module = 'node:fs/promises'
    const fs = await import(/* @vite-ignore */ module) as typeof import('node:fs/promises')
    const file = await fs.readFile(new URL('../../public/' + path, import.meta.url))
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
  }
  const response = await fetch(import.meta.env.BASE_URL + path)
  if (!response.ok) throw new Error(`vehicle asset ${path}: ${response.status}`)
  return response.arrayBuffer()
}

function asset(detail: VehicleDetail): Promise<ArrayBuffer> {
  let file = files.get(detail)
  if (!file) {
    file = read(`assets/vehicle/d-${detail}.glb`)
    files.set(detail, file)
  }
  return file
}

function shared(m: Palette): Record<string, T.Material> {
  return {
    paint: m.paint, matte: m.matte, glass: m.glass, dark: m.dark, hot: m.hot, mirror: m.mirror, engine: m.engine,
    carbon: m.carbon, optics: m.optics, rearOptics: m.rearOptics, brushed: m.brushed, caliper: m.caliper, brake: m.brake,
    forged: m.forged, tire: m.tire, cabin: m.cabin,
  }
}

function cast(meshes: T.Mesh[], origin: T.Vector3Tuple, direction: T.Vector3Tuple, radius: number, normal?: T.Vector3Tuple): Anchor {
  const ray = new T.Raycaster(new T.Vector3(...origin), new T.Vector3(...direction).normalize())
  const hit = ray.intersectObjects(meshes, false)[0]
  if (!hit?.face) throw new Error(`vehicle anchor ray from ${origin.join(', ')} found no surface`)
  const n = normal ? new T.Vector3(...normal) : hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
  return { position: hit.point.clone(), normal: n.normalize(), radius }
}

export async function createModeled(options: VehicleOptions): Promise<VehicleModule> {
  const full = options.detail === 'full'
  const m = palette(options.paint, full)
  const library = shared(m)
  const gltf = await new GLTFLoader().parseAsync((await asset(options.detail)).slice(0), '')
  const root = new T.Group()
  root.name = 'vehicle'
  const lumens: Lumen[] = []
  const lamps: Lamp[] = []
  const heatSources: VehicleModule['heatSources'] = []
  const named: T.Object3D[] = []
  gltf.scene.traverse((node) => {
    if (typeof node.userData.part === 'string') node.name = node.userData.part
    named.push(node)
  })
  const sprung = gltf.scene.getObjectByName('sprung assembly')!
  const emitters: T.Mesh[] = []
  for (const node of named) {
    if (!(node instanceof T.Mesh)) continue
    node.castShadow = node.receiveShadow = true
    const kind = (node.material as T.Material).name
    if (kind === 'emitter' || kind === 'emitter_rear') emitters.push(node)
    else if (library[kind]) node.material = library[kind]
    else throw new Error(`vehicle asset material ${kind} has no palette entry`)
  }
  for (const mesh of emitters) {
    const rear = mesh.name === 'tail running guide'
    const beam = mesh.userData.lamp === 'beam'
    const material = m.tag(new T.MeshStandardMaterial({
      name: mesh.name, color: rear ? 0x571416 : 0x939ca1, roughness: .28, metalness: .05,
      emissive: rear ? 0xff1713 : beam ? 0xe4f3ff : 0xe5f3ff, emissiveIntensity: 0,
    }), 'none') as T.MeshStandardMaterial
    mesh.material = material
    mesh.geometry.computeBoundingBox()
    const origin = mesh.geometry.boundingBox!.getCenter(new T.Vector3()).applyMatrix4(mesh.matrix)
    const object = new T.Object3D()
    object.name = mesh.name + ' emission origin'
    object.position.copy(origin)
    const side = Math.sign(origin.x)
    const direction = rear ? new T.Vector3(side * .16, -.04, -.99) : new T.Vector3(side * .055, -.037, .998)
    object.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), direction.normalize())
    sprung.add(object)
    const candela = typeof mesh.userData.candela === 'number' ? mesh.userData.candela : rear ? .47 : 1.33
    const lamp: Lamp = { object, stage: beam ? lampThresholds.beamStart : lampThresholds.running, beam, level: 0, color: material.emissive.clone(), intensity: candela }
    lamps.push(lamp)
    lumens.push({ mesh: mesh as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>, lamp, rear })
  }
  const outlet = sprung.getObjectByName('formed hexagonal outlet') as T.Mesh
  outlet.geometry.computeBoundingBox()
  const box = outlet.geometry.boundingBox!
  for (const x of [.18, -.18]) {
    const source = new T.Object3D()
    source.name = 'exhaust rim heat origin'
    source.position.set(x, (box.min.y + box.max.y) / 2, box.min.z + .006)
    source.rotation.y = Math.PI
    outlet.add(source)
    heatSources.push({ object: source, strength: 1 })
  }
  root.add(sprung)
  for (const label of ['front wheel', 'rear wheel']) {
    const left = gltf.scene.getObjectByName(label)!
    const right = left.clone()
    right.position.x = -left.position.x
    right.scale.x = -1
    root.add(left, right)
  }
  root.updateMatrixWorld(true)
  const meshes = (test: (mesh: T.Mesh) => boolean): T.Mesh[] => {
    const out: T.Mesh[] = []
    root.traverse((o) => { if (o instanceof T.Mesh && test(o)) out.push(o) })
    return out
  }
  const front = root.getObjectByName('front wheel')!
  const body = meshes((o) => o.material === m.paint || o.material === m.matte || o.material === m.hot || o.material === m.dark)
  const lens = sprung.getObjectByName('headlamp outer lens') as T.Mesh
  const lensBox = new T.Box3()
  const positions = lens.geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) if (positions.getX(i) > 0) lensBox.expandByPoint(new T.Vector3().fromBufferAttribute(positions, i))
  const lensCenter = lensBox.getCenter(new T.Vector3())
  const anchors: VehicleModule['anchors'] = {
    paint: cast(meshes((o) => o.material === m.paint && o.parent === sprung), [.965, 3, 1.0], [0, -1, 0], .32),
    wheel: cast(meshes((o) => front.children.includes(o)), [3, front.position.y + .02, front.position.z + .03], [-1, 0, 0], .36, [1, 0, 0]),
    lamp: cast([lens], [lensCenter.x, lensCenter.y, 4], [0, 0, -1], .20),
    detail: cast(meshes((o) => o.material === m.carbon), [.15, 3, -1.36], [0, -1, 0], .42),
    exhaust: cast(body, [0, (box.min.y + box.max.y) / 2, -4], [0, 0, 1], .34, [0, 0, -1]),
  }
  const update = (state: VehicleState): void => {
    const seconds = state.timeSeconds
    const rise = smooth(state.engine, .02, .20) * Math.exp(-Math.pow((seconds - events.engineStart - .31) / .23, 2))
    const running = smooth(state.lampStage, lampThresholds.running, lampThresholds.running + .05)
    const beam = smooth(state.lampStage, lampThresholds.beamStart, lampThresholds.beamStart + .05)
    const fullBeam = smooth(state.lampStage, lampThresholds.beamStart, lampThresholds.beamFull)
    for (const part of lumens) {
      const level = part.lamp.beam ? beam * (.045 + .955 * fullBeam) : part.rear ? running * (.53 + .47 * rise) : running
      part.lamp.level = level
      part.mesh.material.emissiveIntensity = level * (part.lamp.beam ? 260 : part.rear ? 60 : 144)
    }
    const cycle = seconds / config.film.durationSeconds
    const wave = (count: number) => Math.sin(cycle * (tau * count)) - cycle * Math.sin(tau * count)
    const shake = state.vibration * .002
    sprung.position.y = shake * (.78 * wave(923) + .22 * wave(611))
    sprung.rotation.x = shake * .21 * wave(419)
    sprung.rotation.z = shake * .29 * wave(581)
  }
  await m.load()
  return { root, anchors, surfaces: m.surfaces, lamps, heatSources, update, setPaint: m.setPaint }
}
