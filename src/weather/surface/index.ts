import * as THREE from 'three'
import { config } from '../../config'
import { applyLens } from '../../core/lens'
import type { FrameContext, SampleContext, SceneSystem, WetnessKind } from '../../core/contract'
import { cameraAt } from '../../director/shots'
import { beatById, events, stateAt } from '../../director/timeline'
import type { WeatherDeps } from '../contract'
import { applyBeads, type BeadClass } from './beads'
import { DropGeometry, geometryRange } from './drop-geometry'
import { applyPorous, type Uniforms } from './porous'
import { heroBasin, SyntheticRelief, type Basin } from './relief'
import { type ExtraImpact, RippleField } from './ripples'
import { Runners } from './runners'
import { applySheet, looksLikeRubber } from './sheet'

const reliefSize = 1024
const shakeStart = events.engineStart + 0.15
const refill = { start: beatById('return').start + 3, end: config.film.durationSeconds - 1 }

/** Contact angle by material class. Opaque coated parts bead like waxed paint. Transparent parts are coated polycarbonate and glass. */
function beadClass(material: THREE.Material, index: number): BeadClass {
  return { contactDegrees: material.transparent ? 70 : 100, salt: 101 + 17 * index }
}

function vehicleMeshes(root: THREE.Object3D, wanted: Map<THREE.Material, BeadClass>): Array<{ mesh: THREE.Mesh; bead: BeadClass }> {
  const out: Array<{ mesh: THREE.Mesh; bead: BeadClass }> = []
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material) || (mesh as THREE.InstancedMesh).isInstancedMesh) return
    const bead = wanted.get(mesh.material)
    if (bead) out.push({ mesh, bead })
  })
  return out
}

function rearPuddle(anchors: Parameters<typeof cameraAt>[2]): Basin {
  const cam = cameraAt(beatById('ignition').start + 1.5, config.formats.master, anchors)
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion)
  const f = new THREE.Vector2(forward.x, forward.z).normalize()
  const r = new THREE.Vector2(right.x, right.z).normalize()
  const center = new THREE.Vector2(cam.position.x, cam.position.z).addScaledVector(f, 2.2).addScaledVector(r, 0.9)
  return { center, axis: f, halfLength: 1.5, halfWidth: 0.85, depthMm: 5 }
}

/** The point of the panel in the lower middle of the macro frame that lies at the focus distance the pull rests on. */
function rivuletStart(vehicle: WeatherDeps['vehicle']): THREE.Vector3 {
  const format = config.formats.master
  const state = cameraAt(config.film.macroFrameSeconds, format, vehicle.anchors)
  const camera = new THREE.PerspectiveCamera()
  applyLens(camera, state, format.width, format.height, { pixel: [0.5, 0.5], aperture: [0, 0] }, 1)
  const ray = new THREE.Raycaster()
  ray.near = 0
  const hitAt = (y: number): THREE.Intersection | null => {
    ray.setFromCamera(new THREE.Vector2(-0.3, y), camera)
    return ray.intersectObject(vehicle.root, true)[0] ?? null
  }
  let lo = -0.7
  let hi = 0.15
  let best = hitAt(-0.2)
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    const hit = hitAt(mid)
    if (!hit) {
      hi = mid
      continue
    }
    best = hit
    if (hit.distance < state.focusDistance) lo = mid
    else hi = mid
  }
  return best ? best.point.clone() : vehicle.anchors.paint.position.clone()
}

export async function createSurface(deps: WeatherDeps): Promise<SceneSystem> {
  const { world, vehicle } = deps
  const root = new THREE.Group()
  root.name = 'surface water'
  vehicle.root.updateMatrixWorld(true)
  const body = new THREE.Box3().setFromObject(vehicle.root)
  const bodyCenter = body.getCenter(new THREE.Vector3())

  const ripples = new RippleField()
  const uniforms: Uniforms = {
    surfDiag: { value: 0 },
    surfRain: { value: 1 },
    surfTime: { value: 0 },
    surfVibration: { value: 0 },
    surfShakeAge: { value: 0 },
    surfRefill: { value: 0 },
    surfGeo: { value: new THREE.Vector4(0, 0, 0, 0) },
    surfVehicleCenter: { value: bodyCenter.clone() },
    surfImpacts: { value: ripples.texture },
    surfImpactGrid: { value: ripples.origin },
    surfImpactTime: { value: 0 },
    surfPulse: { value: [new THREE.Vector4(), new THREE.Vector4()] },
    surfPulseTime: { value: 0 },
    surfShelter: { value: new THREE.Vector4(body.min.x + 0.2, body.min.z + 0.25, body.max.x - 0.2, body.max.z - 0.25) },
    ...(deps.lights as unknown as Uniforms),
  }

  let relief: THREE.Texture | null = world.deck.heightMap
  let reliefScale = 1000
  const bounds = world.deck.bounds
  if (!relief) {
    const anchors = vehicle.anchors
    const opening = cameraAt(0, config.formats.master, anchors)
    const hero = heroBasin(new THREE.Vector2(bodyCenter.x, bodyCenter.z), new THREE.Vector2(opening.position.x, opening.position.z))
    const keepDry = [new THREE.Box2(new THREE.Vector2(body.min.x + 0.1, body.min.z + 0.1), new THREE.Vector2(body.max.x - 0.1, body.max.z - 0.1))]
    const synthetic = new SyntheticRelief({ bounds, basins: [hero, rearPuddle(anchors)], keepDry })
    relief = synthetic.bake(reliefSize)
    reliefScale = 1
  }
  Object.assign(uniforms, {
    surfRelief: { value: relief },
    surfReliefBounds: { value: new THREE.Vector4(bounds.min.x, bounds.min.y, bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y) },
    surfReliefScale: { value: reliefScale },
    surfReliefOffset: { value: 0 },
  })

  const kinds = new Map<THREE.Material, WetnessKind>()
  const all = [...world.surfaces, ...vehicle.surfaces]
  const beadMaterials = new Map<THREE.Material, BeadClass>()
  applyPorous(world.deck.material, uniforms, true)
  kinds.set(world.deck.material, 'porous')
  all.forEach(({ material, wetness }, i) => {
    if (kinds.has(material) || wetness === 'none') return
    kinds.set(material, wetness)
    if (wetness === 'porous') applyPorous(material, uniforms, false)
    else if (wetness === 'sheet') applySheet(material, uniforms, looksLikeRubber(material))
    else if (wetness === 'beads') {
      const bead = beadClass(material, i)
      beadMaterials.set(material, bead)
      applyBeads(material, uniforms, bead)
    }
  })

  const drops = new DropGeometry(vehicleMeshes(vehicle.root, beadMaterials), uniforms)
  root.add(drops.group)
  const runners = new Runners(vehicle, drops.runner, drops.plain, rivuletStart(vehicle))
  root.add(runners.group)

  const shutter = config.film.shutterDegrees / 360 / config.film.fps
  let frameStart = 0
  const pulseStrength = Math.max(0.5, ...vehicle.heatSources.map((h) => h.strength))
  const scratch = new THREE.Vector3()
  const forward = new THREE.Vector3()

  return {
    root,
    lights: [],
    beginFrame(frame: FrameContext) {
      const t = frame.frame.timeSeconds
      frameStart = t - shutter / 2
      const cam = frame.camera
      forward.set(0, 0, -1).applyQuaternion(cam.quaternion)
      const ahead = Math.min(14, Math.max(0, cam.focusDistance * 1.2))
      const flat = new THREE.Vector2(forward.x, forward.z)
      if (flat.lengthSq() > 1e-6) flat.normalize()
      const center = new THREE.Vector2(cam.position.x, cam.position.z).addScaledVector(flat, ahead)
      const extra: ExtraImpact[] = runners.impacts(frameStart - 0.6, frameStart + shutter)
      ripples.update(frameStart, frameStart + shutter, center, extra)
      drops.update(cam, frame.format.width / frame.format.height)
      uniforms.surfGeo.value.set(cam.position.x, cam.position.y, cam.position.z, drops.count > 0 ? geometryRange : 0)
      runners.beginFrame(cam)
    },
    beginSample(sample: SampleContext) {
      const t = sample.timeSeconds
      const state = stateAt(t)
      uniforms.surfTime.value = t
      uniforms.surfImpactTime.value = t - frameStart
      uniforms.surfPulseTime.value = t
      uniforms.surfVibration.value = state.vibration
      const age = t - shakeStart
      uniforms.surfShakeAge.value = age > 0 && t < refill.end ? age : 0
      uniforms.surfRefill.value = t > refill.start && t < refill.end ? THREE.MathUtils.smoothstep(t, refill.start, refill.end) : 0
      const pulse = uniforms.surfPulse.value[0] as THREE.Vector4
      if (state.engine > 0) {
        const exhaust = vehicle.anchors.exhaust
        scratch.copy(exhaust.position).addScaledVector(exhaust.normal, 0.35)
        pulse.set(scratch.x, scratch.z, state.engine * pulseStrength, 0)
      } else pulse.set(0, 0, 0, 0)
      runners.beginSample(t)
    },
    setDiagnostic(view: string) {
      uniforms.surfDiag.value = view === 'wetness' ? 1 : 0
    },
  }
}
