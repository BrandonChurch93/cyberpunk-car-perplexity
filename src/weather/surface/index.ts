import * as THREE from 'three'
import { circleScale, pupilIsActive } from '../../core/bokeh/pupil'
import { config, type FormatSpec } from '../../config'
import type { FrameContext, SampleContext, SceneSystem, WetnessKind } from '../../core/contract'
import { probeHeight } from '../../core/reflect'
import { cameraAt } from '../../director/shots'
import { beatById, events, stateAt } from '../../director/timeline'
import type { WeatherDeps } from '../contract'
import { applyBeads, type BeadClass, trackClear, trackPoints } from './beads'
import { CellDrops } from './cells'
import { addDripEdges } from './drip-edges'
import { DropGeometry, geometryAngle, geometryRange } from './drop-geometry'
import { applyPorous, type Uniforms } from './porous'
import { heroBasin, SyntheticRelief, type Basin } from './relief'
import { type ExtraImpact, RippleField } from './ripples'
import { rivuletPace, rivuletTravel, Runners } from './runners'
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

/** The exhaust pulse rings the floor this far behind the tailpipe. */
const pulseReach = 0.35

/** The puddle the exhaust pulse ripples, set around the ripple point and drawn toward the ignition lens so it fills the bottom of the frame. */
function rearPuddle(anchors: Parameters<typeof cameraAt>[2]): Basin {
  const cam = cameraAt(beatById('ignition').start + 1.5, config.formats.master, anchors)
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion)
  const f = new THREE.Vector2(forward.x, forward.z).normalize()
  const r = new THREE.Vector2(right.x, right.z).normalize()
  const ripple = anchors.exhaust.position.clone().addScaledVector(anchors.exhaust.normal, pulseReach)
  const center = new THREE.Vector2(ripple.x, ripple.z).addScaledVector(f, -0.6).addScaledVector(r, -0.3)
  return { center, axis: f, halfLength: 1.5, halfWidth: 0.85, depthMm: 5 }
}

/**
 * The rivulet waits on the wing above the macro aim in this format: at the macro frame its head has run into the focus and
 * blurs under a pixel, the path behind it is in frame, it faces the lens and it runs down the panel clear of the vents.
 */
export function rivuletStart(vehicle: WeatherDeps['vehicle'], format: FormatSpec): THREE.Vector3 {
  const anchor = vehicle.anchors.paint.position
  const camera = cameraAt(config.film.macroFrameSeconds, format, vehicle.anchors)
  const film = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2 * Math.atan(camera.sensorWidthMm / (format.width / format.height) / 2 / camera.focalMm)), format.width / format.height, 0.01, 10)
  film.position.copy(camera.position)
  film.quaternion.copy(camera.quaternion)
  film.updateMatrixWorld(true)
  const aim = camera.position.clone().addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), camera.focusDistance)
  const later = cameraAt(config.film.macroFrameSeconds + 0.6, format, vehicle.anchors)
  const laterFilm = film.clone()
  laterFilm.position.copy(later.position)
  laterFilm.quaternion.copy(later.quaternion)
  laterFilm.updateMatrixWorld(true)
  const blurFor = (state: typeof camera) => {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(state.quaternion)
    const circle = circleScale(state, format.width)
    return (q: THREE.Vector3) => circle * Math.abs(1 / state.focusDistance - 1 / new THREE.Vector3().subVectors(q, state.position).dot(forward))
  }
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
  const blurAt = blurFor(camera)
  const laterBlurAt = blurFor(later)
  const paint = new Set(vehicle.surfaces.filter((s) => s.wetness === 'beads' && !s.material.transparent).map((s) => s.material))
  const trim = new Set(vehicle.surfaces.filter((s) => s.wetness === 'sheet').map((s) => s.material))
  const slots: THREE.Triangle[] = []
  vehicle.root.updateMatrixWorld(true)
  vehicle.root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material) || !trim.has(mesh.material)) return
    const pos = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.index
    const count = !pos ? 0 : index ? index.count : pos.count
    const corner = (k: number) => new THREE.Vector3().fromBufferAttribute(pos, index ? index.getX(k) : k).applyMatrix4(mesh.matrixWorld)
    for (let k = 0; k < count; k += 3) {
      const t = new THREE.Triangle(corner(k), corner(k + 1), corner(k + 2))
      if (t.a.distanceTo(aim) < 0.4) slots.push(t)
    }
  })
  const near = new THREE.Vector3()
  const clearOfSlots = (q: THREE.Vector3, gap: number) => slots.every((t) => t.closestPointToPoint(q, near).distanceToSquared(q) > gap * gap)
  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector3()
  const rows: Array<{ p: THREE.Vector3; head: THREE.Vector3; score: number }> = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  vehicle.root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material) || !paint.has(mesh.material)) return
    const pos = mesh.geometry.getAttribute('position')
    if (!pos) return
    const index = mesh.geometry.index
    const count = index ? index.count : pos.count
    for (let k = 0; k < count; k += 3) {
      a.fromBufferAttribute(pos, index ? index.getX(k) : k).applyMatrix4(mesh.matrixWorld)
      if (a.distanceTo(aim) > 0.25) continue
      b.fromBufferAttribute(pos, index ? index.getX(k + 1) : k + 1).applyMatrix4(mesh.matrixWorld)
      c.fromBufferAttribute(pos, index ? index.getX(k + 2) : k + 2).applyMatrix4(mesh.matrixWorld)
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a))
      if (n.lengthSq() < 1e-14) continue
      n.normalize()
      const p = a.clone().add(b).add(c).divideScalar(3)
      const toLens = camera.position.clone().sub(p).normalize()
      if (n.dot(toLens) < 0) n.negate()
      if (n.dot(toLens) < 0.2 || n.y < -0.3) continue
      const pace = rivuletPace(Math.sqrt(Math.max(0, 1 - n.y * n.y)))
      if (pace <= 0) continue
      const lead = rivuletTravel(config.film.macroFrameSeconds, pace)
      const ahead = rivuletTravel(config.film.macroFrameSeconds + 0.6, pace) - lead
      const down = new THREE.Vector3(0, -1, 0).addScaledVector(n, n.y).normalize()
      const head = p.clone().addScaledVector(down, lead)
      const blur = Math.max(blurAt(head), blurAt(head.clone().addScaledVector(down, 0.014)), blurAt(p) / 3)
      ndc.copy(p).project(film)
      if (Math.abs(ndc.x) > 0.9 || Math.abs(ndc.y) > 0.9) continue
      ndc.copy(head).project(film)
      if (blur > 1 || Math.abs(ndc.x) > 0.7 || Math.abs(ndc.y) > 0.7) continue
      const centre = Math.hypot(ndc.x, ndc.y)
      const run = head.clone().addScaledVector(down, ahead)
      ndc.copy(run).project(laterFilm)
      const runBlur = laterBlurAt(run)
      if (runBlur > 5 || Math.abs(ndc.x) > 0.75 || Math.abs(ndc.y) > 0.75) continue
      let clear = true
      for (let d = 0; clear && d <= lead + 0.035; d += 0.006) clear = clearOfSlots(p.clone().addScaledVector(down, d), 0.009)
      if (!clear || !clearOfSlots(head.clone().addScaledVector(down, 0.08), 0.02)) continue
      rows.push({ p, head, score: -0.6 * n.y + 0.5 * (1 - Math.abs(down.dot(forward))) - 0.5 * blur - 0.15 * runBlur - 1.5 * centre + (p.y - aim.y) })
    }
  })
  rows.sort((x, y) => y.score - x.score)
  const visible = (q: THREE.Vector3) => {
    ray.set(camera.position, q.clone().sub(camera.position).normalize())
    const hit = ray.intersectObject(vehicle.root, true)[0]
    return !!hit && hit.point.distanceTo(q) < 0.003
  }
  for (const { p, head } of rows.slice(0, 12)) if (visible(p) && visible(head)) return p
  return anchor.clone()
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
    surfBeadTime: { value: 0 },
    surfFocus: { value: 1 },
    surfCocScale: { value: 0 },
    surfSampleRoot: { value: 1 },
    surfPupil: { value: 0 },
    surfShakeAge: { value: 0 },
    surfRefill: { value: 0 },
    surfGeo: { value: new THREE.Vector4(0, 0, 0, 0) },
    surfGeoAngle: { value: 0 },
    surfVehicleCenter: { value: bodyCenter.clone() },
    surfTrack: { value: Array.from({ length: trackPoints }, () => new THREE.Vector4(0, 0, 0, 1e9)) },
    surfTrackBox: { value: new THREE.Vector4() },
    surfTrackLen: { value: 0 },
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

  const beaded = vehicleMeshes(vehicle.root, beadMaterials)
  vehicle.root.updateMatrixWorld(true)
  for (const { mesh } of beaded) addDripEdges(mesh)
  const drops = new DropGeometry(beaded, uniforms)
  const paintCoat = beaded.map(({ mesh }) => mesh.material).find((m): m is THREE.MeshPhysicalMaterial => (m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial === true && (m as THREE.MeshPhysicalMaterial).clearcoat > 0)
  root.add(drops.group)
  const cells = new CellDrops(vehicle, drops.runner)
  // Each format frames its own macro and wheel inserts, so each places its own rivulet and arch drips for its lens.
  const runnersByFormat = new Map<string, Runners>()
  let runners: Runners | null = null
  const runnersFor = (format: FormatSpec): Runners => {
    let r = runnersByFormat.get(format.id)
    if (!r) {
      r = new Runners(vehicle, drops.runner, drops.plain, rivuletStart(vehicle, format), format)
      runnersByFormat.set(format.id, r)
    }
    if (r !== runners) {
      if (runners) root.remove(runners.group)
      runners = r
      const track = r.track(trackPoints)
      track.points.forEach((p, i) => (uniforms.surfTrack.value[i] as THREE.Vector4).copy(p))
      uniforms.surfTrackBox.value.set(track.center.x, track.center.y, track.center.z, track.radius)
    }
    return r
  }

  const shutter = config.film.shutterDegrees / 360 / config.film.fps
  let frameStart = 0
  const pulseStrength = Math.max(0.5, ...vehicle.heatSources.map((h) => h.strength))
  const scratch = new THREE.Vector3()
  const forward = new THREE.Vector3()

  function sampleState(t: number): void {
    const state = stateAt(t)
    uniforms.surfTime.value = t
    uniforms.surfImpactTime.value = t - frameStart
    uniforms.surfPulseTime.value = t
    const pulse = uniforms.surfPulse.value[0] as THREE.Vector4
    if (state.engine > 0) {
      const exhaust = vehicle.anchors.exhaust
      scratch.copy(exhaust.position).addScaledVector(exhaust.normal, pulseReach)
      pulse.set(scratch.x, scratch.z, state.engine * pulseStrength, 0)
    } else pulse.set(0, 0, 0, 0)
    if (runners) {
      runners.beginSample(t)
      uniforms.surfTrackLen.value = runners.travel(t)
    }
  }

  return {
    root,
    lights: [],
    beginFrame(frame: FrameContext) {
      const t = frame.frame.timeSeconds
      const runners = runnersFor(frame.format)
      // Joined late, as the drop chunks are, so the shade stage leaves water out of its screen space occlusion.
      if (!runners.group.parent) root.add(runners.group)
      if (!cells.group.parent) root.add(cells.group)
      frameStart = t - shutter / 2
      const cam = frame.camera
      forward.set(0, 0, -1).applyQuaternion(cam.quaternion)
      const ahead = Math.min(14, Math.max(0, cam.focusDistance * 1.2))
      const flat = new THREE.Vector2(forward.x, forward.z)
      if (flat.lengthSq() > 1e-6) flat.normalize()
      const center = new THREE.Vector2(cam.position.x, cam.position.z).addScaledVector(flat, ahead)
      runners.beginFrame(cam, t)
      cells.beginFrame(cam.position)
      drops.box.reflectBoxMin.value.copy(world.reflectionBox.min)
      drops.box.reflectBoxMax.value.copy(world.reflectionBox.max)
      drops.box.reflectProbe.value.setFromMatrixPosition(vehicle.root.matrixWorld).y += probeHeight
      drops.box.reflectBoxOn.value = 1
      const extra: ExtraImpact[] = runners.impacts(frameStart - 0.6, frameStart + shutter)
      ripples.update(frameStart, frameStart + shutter, center, extra)
      drops.update(cam, frame.format.width, frame.format.width / frame.format.height, (p, r) => runners.sweptDistance(p, t) < trackClear + r)
      uniforms.surfGeo.value.set(cam.position.x, cam.position.y, cam.position.z, drops.count > 0 ? geometryRange : 0)
      uniforms.surfGeoAngle.value = geometryAngle(cam, frame.format.width)
      // Beads hold still for every sample of a frame: sub-shutter motion with few samples shows as offset copies, not blur.
      uniforms.surfBeadTime.value = t
      uniforms.surfFocus.value = cam.focusDistance
      uniforms.surfCocScale.value = circleScale(cam, frame.format.width)
      uniforms.surfSampleRoot.value = Math.sqrt(frame.frame.samples)
      uniforms.surfPupil.value = pupilIsActive(cam, frame.format.width, frame.frame.samples) ? 1 : 0
      uniforms.surfVibration.value = stateAt(t).vibration
      const age = t - shakeStart
      uniforms.surfShakeAge.value = age > 0 && t < refill.end ? age : 0
      uniforms.surfRefill.value = t > refill.start && t < refill.end ? THREE.MathUtils.smoothstep(t, refill.start, refill.end) : 0
      // Captures drawn before the first sample read the deck shader too.
      sampleState(t)
    },
    beginSample(sample: SampleContext) {
      sampleState(sample.timeSeconds)
      if (paintCoat) drops.shareEnvironment(paintCoat)
    },
    setDiagnostic(view: string) {
      uniforms.surfDiag.value = view === 'wetness' ? 1 : 0
    },
  }
}
