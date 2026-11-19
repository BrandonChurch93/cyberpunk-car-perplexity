import * as THREE from 'three'
import { config, paintById, type FormatSpec } from '../config'
import { cameraAt } from '../director/shots'
import { stateAt } from '../director/timeline'
import { createVehicle, type VehicleModule } from '../vehicle'
import { createWeather } from '../weather'
import { createWorld, type WorldModule } from '../world'
import type { FilmLight, SamplePass, SampleContext, SceneSystem } from './contract'
import { stageDetail, type StageDetail } from './detail'
import type { FrameInfo, SampleInfo, Stage } from './engine'
import { applyLens, type CameraState } from './lens'
import { FullscreenPass, passMaterial } from './fullscreen'
import { createHaze } from './haze'
import { LightRig } from './lights'
import type { StagePart } from './parts'
import { createReflections } from './reflect'
import { createShade } from './shade'

const shadowMapSize = 2048

const normalsMaterial = new THREE.ShaderMaterial({
  vertexShader: 'varying vec3 vN; void main() { vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'varying vec3 vN; void main() { gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0); }',
})

const copyFragment = /* glsl */ `
precision highp float;
uniform sampler2D source;
out vec4 outColor;
void main() {
  outColor = texelFetch(source, ivec2(gl_FragCoord.xy), 0);
}
`

function floatTarget(format: FormatSpec, depth: boolean): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(format.width, format.height, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: depth,
  })
  if (depth) target.depthTexture = new THREE.DepthTexture(format.width, format.height, THREE.UnsignedIntType)
  return target
}
const beamHalfAngle = THREE.MathUtils.degToRad(17)

type Lamp = VehicleModule['lamps'][number]

const maxWorldLights = 8
const maxBeams = 4

function beamLight(lamp: Lamp, i: number): FilmLight {
  return {
    id: `vehicle-beam-${i}`,
    kind: 'spot',
    object: lamp.object,
    color: lamp.color ?? new THREE.Color(1, 1, 1),
    intensity: lamp.intensity ?? 250,
    size: [0.04, 0.04],
    angle: beamHalfAngle,
    penumbra: 0.6,
    range: 120,
    shadow: true,
    beam: true,
    level: () => lamp.level ?? 0,
  }
}

/** Lamps that are not beams light the ground near them. They are merged into one point light per corner of the vehicle. */
function glowLights(vehicle: VehicleModule, lamps: Lamp[]): FilmLight[] {
  vehicle.root.updateWorldMatrix(true, true)
  const toVehicle = vehicle.root.matrixWorld.clone().invert()
  const corners = new Map<string, { lamps: Lamp[]; at: THREE.Vector3[] }>()
  for (const lamp of lamps) {
    const at = lamp.object.getWorldPosition(new THREE.Vector3()).applyMatrix4(toVehicle)
    const key = `${at.z >= 0 ? 'front' : 'rear'}-${at.x >= 0 ? 'left' : 'right'}`
    const corner = corners.get(key) ?? { lamps: [], at: [] }
    corner.lamps.push(lamp)
    corner.at.push(at)
    corners.set(key, corner)
  }
  return [...corners.entries()].map(([key, corner]) => {
    const weights = corner.lamps.map((lamp) => lamp.intensity ?? 4)
    const total = weights.reduce((a, b) => a + b, 0)
    const anchor = new THREE.Object3D()
    const color = new THREE.Color(0, 0, 0)
    corner.lamps.forEach((lamp, i) => {
      const w = weights[i] / total
      anchor.position.addScaledVector(corner.at[i], w)
      const c = lamp.color ?? new THREE.Color(1, 1, 1)
      color.r += c.r * w
      color.g += c.g * w
      color.b += c.b * w
    })
    vehicle.root.add(anchor)
    return {
      id: `vehicle-glow-${key}`,
      kind: 'point',
      object: anchor,
      color,
      intensity: total,
      size: [0.3, 0.1],
      range: 14,
      shadow: false,
      beam: false,
      level: () => corner.lamps.reduce((sum, lamp, i) => sum + (lamp.level ?? 0) * weights[i], 0) / total,
    } satisfies FilmLight
  })
}

function filmLights(world: WorldModule, vehicle: VehicleModule): FilmLight[] {
  if (world.lights.length > maxWorldLights) throw new Error(`The world carries ${world.lights.length} lights. The stage takes ${maxWorldLights}.`)
  const beams = vehicle.lamps.filter((lamp) => lamp.beam)
  if (beams.length > maxBeams) throw new Error(`The vehicle carries ${beams.length} beams. The stage takes ${maxBeams}.`)
  return [...world.lights, ...beams.map(beamLight), ...glowLights(vehicle, vehicle.lamps.filter((lamp) => !lamp.beam))]
}

export class FilmStage implements Stage {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera()
  readonly rig: LightRig
  cameraOverride: CameraState | null = null
  private readonly clay = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.95 })
  private format: FormatSpec = config.formats.master
  private frameSeconds = 0
  private diagnostic = 'beauty'
  private readonly parts: StagePart[] = []
  private readonly passes: SamplePass[] = []
  private readonly sceneTarget = floatTarget(config.formats.master, true)
  private readonly swap = [floatTarget(config.formats.master, false), floatTarget(config.formats.master, false)]
  private readonly copy = new FullscreenPass(passMaterial(copyFragment, { source: { value: null } }, { blending: THREE.NoBlending }))

  static async create(renderer: THREE.WebGLRenderer, paint: string, detail: StageDetail = stageDetail): Promise<FilmStage> {
    const [world, vehicle] = await Promise.all([createWorld({ detail }), createVehicle({ paint: paintById(paint), detail })])
    const lights = detail === 'full' ? filmLights(world, vehicle) : []
    const rig = new LightRig(lights, shadowMapSize)
    const weather = detail === 'full' ? await createWeather({ world, vehicle, lights: rig.uniforms }) : null
    return new FilmStage(renderer, detail, world, vehicle, weather, rig)
  }

  private constructor(
    private readonly renderer: THREE.WebGLRenderer,
    readonly detail: StageDetail,
    readonly world: WorldModule,
    readonly vehicle: VehicleModule,
    readonly weather: SceneSystem | null,
    rig: LightRig,
  ) {
    this.rig = rig
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    this.scene.add(world.root, vehicle.root, rig.group)
    if (weather) {
      this.scene.add(weather.root)
      const deps = { renderer, scene: this.scene, world, vehicle, weather, rig }
      this.parts.push(createShade(deps), createReflections(deps), createHaze(deps))
      this.passes.push(...this.parts.flatMap((part) => part.samplePasses ?? []), ...(weather.samplePasses ?? []))
    }
    if (detail === 'blockout') this.grayBoxLight()
  }

  private grayBoxLight(): void {
    this.scene.background = new THREE.Color(0x23262c)
    this.scene.fog = new THREE.Fog(0x23262c, 60, 420)
    const sun = new THREE.DirectionalLight(0xffffff, 2.2)
    sun.position.set(-14, 22, 9)
    sun.castShadow = true
    sun.shadow.mapSize.set(4096, 4096)
    const s = sun.shadow.camera
    s.left = -14
    s.right = 14
    s.top = 14
    s.bottom = -14
    s.near = 1
    s.far = 70
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.02
    this.scene.add(sun, sun.target)
    this.scene.add(new THREE.HemisphereLight(0xcfd6e6, 0x3a3c42, 1.6))
  }

  private systems(): SceneSystem[] {
    return this.weather ? [this.world, this.weather] : [this.world]
  }

  resize(format: FormatSpec): void {
    this.format = format
    for (const target of [this.sceneTarget, ...this.swap]) target.setSize(format.width, format.height)
    for (const part of this.parts) part.resize(format)
  }

  setDiagnostic(view: string): void {
    this.diagnostic = view
    this.scene.overrideMaterial = view === 'clay' ? this.clay : view === 'normals' ? normalsMaterial : null
    for (const system of this.systems()) system.setDiagnostic?.(view)
    for (const part of this.parts) part.setDiagnostic?.(view)
  }

  signs(): string[] {
    return this.world.signs
  }

  setPaint(id: string): void {
    this.vehicle.setPaint(paintById(id))
  }

  beginFrame(frame: FrameInfo): void {
    this.frameSeconds = frame.timeSeconds
    this.setVehicle(frame.timeSeconds)
    const camera = this.cameraState(frame.timeSeconds)
    const context = { frame, format: this.format, camera }
    for (const system of this.systems()) system.beginFrame(context)
    this.rig.update(frame.timeSeconds, [0.5, 0.5])
    for (const part of this.parts) part.beginFrame?.(context)
  }

  cameraState(timeSeconds: number): CameraState {
    return this.cameraOverride ?? cameraAt(timeSeconds, this.format, this.vehicle.anchors, this.frameSeconds)
  }

  private setVehicle(timeSeconds: number): void {
    const state = stateAt(timeSeconds)
    this.vehicle.update({ timeSeconds, lampStage: state.lampStage, engine: state.engine, vibration: state.vibration })
  }

  renderSample(sample: SampleInfo, target: THREE.WebGLRenderTarget): void {
    const timeSeconds = sample.timeSeconds
    this.setVehicle(timeSeconds)
    const state = this.cameraState(timeSeconds)
    applyLens(this.camera, state, this.format.width, this.format.height, sample, config.lens.anamorphic ? 1.5 : 1)
    const context: SampleContext = { sample, timeSeconds, camera: this.camera, state }
    for (const system of this.systems()) system.beginSample(context)
    this.rig.update(timeSeconds, sample.light)
    for (const part of this.parts) part.beforeSample?.(context)
    const passes = this.diagnostic === 'normals' ? [] : this.passes
    const first = passes.length > 0 ? this.sceneTarget : target
    this.renderer.setRenderTarget(first)
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.clear(true, true, false)
    this.renderer.render(this.scene, this.camera)
    let input = first.texture
    passes.forEach((pass, i) => {
      const output = i === passes.length - 1 ? target : this.swap[i % 2]
      pass.render(this.renderer, { color: input, depth: this.sceneTarget.depthTexture as THREE.DepthTexture }, output, context)
      input = output.texture
    })
  }
}
