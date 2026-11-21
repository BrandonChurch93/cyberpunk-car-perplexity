import * as THREE from 'three'
import { CapsView } from '../diagnostics/caps'
import { config, paintById, type FormatSpec } from '../config'
import { cameraAt } from '../director/shots'
import { stateAt } from '../director/timeline'
import { createBokeh } from './bokeh'
import { createVehicle, type VehicleModule } from '../vehicle'
import { createWeather } from '../weather'
import { createWorld, type WorldModule } from '../world'
import { layers, type FilmLight, type SamplePass, type SampleContext, type SceneSystem } from './contract'
import { stageDetail, type StageDetail } from './detail'
import type { FrameInfo, SampleInfo, Stage } from './engine'
import { applyLens, type CameraState } from './lens'
import { FullscreenPass, passMaterial } from './fullscreen'
import { createHaze } from './haze'
import { LightRig, projectorHalfAngle } from './lights'
import type { StagePart } from './parts'
import { createReflections } from './reflect'
import { createShade } from './shade'
import { visibilityOf, type Visibility } from './visibility'

const shadowMapSize = 2048
const lensSqueeze = config.lens.anamorphic ? 1.5 : 1

const normalsMaterial = new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `varying vec3 vN;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = m * instanceMatrix;
  #endif
  vN = normalize(mat3(m) * normal);
  gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
}`,
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
type Lamp = VehicleModule['lamps'][number]

const maxWorldLights = 8
const maxBeams = 4
const glowStandOff = 0.35

function beamLight(lamp: Lamp, i: number): FilmLight {
  return {
    id: `vehicle-beam-${i}`,
    kind: 'spot',
    object: lamp.object,
    color: lamp.color ?? new THREE.Color(1, 1, 1),
    intensity: lamp.intensity ?? 250,
    size: [0.04, 0.04],
    angle: projectorHalfAngle,
    penumbra: 0.6,
    range: 120,
    shadow: true,
    beam: true,
    level: () => lamp.level ?? 0,
  }
}

/** Non-beam lamps share one light per corner. */
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
    const tail = corner.lamps.find(({ object }) => /^tail--?1$/.test(object.name))?.object
    const sprung = tail?.parent
    const seated = tail !== undefined && sprung != null
    if (seated) {
      const side = Math.sign(tail.position.x)
      anchor.position.copy(tail.position).add(new THREE.Vector3(side * .018, -.008, -.045))
      anchor.lookAt(anchor.position.clone().add(new THREE.Vector3(side * .35, -.72, -.57)))
      sprung.add(anchor)
    } else {
      const outward = Math.sign(anchor.position.z) || 1
      anchor.position.z += outward * glowStandOff
      anchor.lookAt(anchor.position.x, anchor.position.y - 0.7, anchor.position.z + outward)
      vehicle.root.add(anchor)
    }
    return {
      id: `vehicle-glow-${key}`,
      kind: seated ? 'area' : 'spot',
      object: anchor,
      color,
      intensity: seated ? total * .26 : total,
      size: seated ? [.12, .018] : [0.3, 0.1],
      ...(seated ? {} : { angle: THREE.MathUtils.degToRad(80), penumbra: 1 }),
      range: seated ? 2.3 : 14,
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
  private caps: CapsView | null = null
  private readonly veils: THREE.Mesh[] = []
  private readonly parts: StagePart[] = []
  private readonly passes: SamplePass[] = []
  private readonly bokeh = createBokeh(lensSqueeze)
  private readonly sceneTarget = floatTarget(config.formats.master, true)
  private readonly swap = [floatTarget(config.formats.master, false), floatTarget(config.formats.master, false)]
  readonly visibility: Visibility
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
    this.visibility = visibilityOf(renderer)
    this.camera.layers.enable(layers.cameraOnly)
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
    sun.position.set(16, 13, 12)
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
    if (view === 'normals') this.camera.layers.disable(layers.cameraOnly)
    else this.camera.layers.enable(layers.cameraOnly)
    for (const mesh of this.veils) mesh.visible = true
    this.veils.length = 0
    if (view === 'normals') {
      this.scene.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh || !mesh.visible) return
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        if (materials.every((m) => m.transparent && !m.depthWrite)) this.veils.push(mesh)
      })
      for (const mesh of this.veils) mesh.visible = false
    }
    for (const system of this.systems()) system.setDiagnostic?.(view)
    for (const part of this.parts) part.setDiagnostic?.(view)
  }

  signs(): string[] {
    return this.world.signs
  }

  anchors(): Record<string, { position: number[]; normal: number[]; radius: number }> {
    return Object.fromEntries(Object.entries(this.vehicle.anchors).map(([id, a]) => [id, { position: a.position.toArray(), normal: a.normal.toArray(), radius: a.radius }]))
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

  /** Distance from the lens to the nearest surface through a point of the frame (-1 to 1 on both axes). For tools and tests only. */
  surfaceAlong(timeSeconds: number, screen: [number, number]): number | null {
    const state = this.cameraState(timeSeconds)
    applyLens(this.camera, state, this.format.width, this.format.height, { pixel: [0.5, 0.5], aperture: [0, 0] }, 1)
    this.camera.updateMatrixWorld(true)
    this.scene.updateMatrixWorld(true)
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(screen[0], screen[1]), this.camera)
    ray.near = 0
    const hit = ray.intersectObjects([this.vehicle.root, this.world.root], true)[0]
    return hit ? hit.distance : null
  }

  /** Distance from the lens to the nearest surface of the vehicle or the world in any direction. For tools and tests only. */
  lensClearance(timeSeconds: number): number {
    const point = this.cameraState(timeSeconds).position
    this.scene.updateMatrixWorld(true)
    const box = new THREE.Box3()
    const triangle = new THREE.Triangle()
    const closest = new THREE.Vector3()
    const matrix = new THREE.Matrix4()
    let best = Infinity
    const visit = (mesh: THREE.Mesh, world: THREE.Matrix4): void => {
      const geometry = mesh.geometry
      if (!geometry.boundingBox) geometry.computeBoundingBox()
      if (box.copy(geometry.boundingBox!).applyMatrix4(world).distanceToPoint(point) >= best) return
      const positions = geometry.getAttribute('position')
      const index = geometry.getIndex()
      const count = index ? index.count : positions.count
      for (let i = 0; i < count; i += 3) {
        const [a, b, c] = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2]
        triangle.a.fromBufferAttribute(positions, a).applyMatrix4(world)
        triangle.b.fromBufferAttribute(positions, b).applyMatrix4(world)
        triangle.c.fromBufferAttribute(positions, c).applyMatrix4(world)
        best = Math.min(best, triangle.closestPointToPoint(point, closest).distanceTo(point))
      }
    }
    for (const root of [this.vehicle.root, this.world.root]) {
      root.traverse((object) => {
        if (!(object as THREE.Mesh).isMesh) return
        const mesh = object as THREE.Mesh
        const instanced = mesh as THREE.InstancedMesh
        if (!instanced.isInstancedMesh) return visit(mesh, mesh.matrixWorld)
        for (let i = 0; i < instanced.count; i++) {
          instanced.getMatrixAt(i, matrix)
          visit(mesh, matrix.premultiply(mesh.matrixWorld))
        }
      })
    }
    return best
  }

  private setVehicle(timeSeconds: number): void {
    const state = stateAt(timeSeconds)
    this.vehicle.update({ timeSeconds, lampStage: state.lampStage, engine: state.engine, vibration: state.vibration })
  }

  renderSample(sample: SampleInfo, target: THREE.WebGLRenderTarget): void {
    if (this.diagnostic === 'caps') {
      this.caps ??= new CapsView()
      this.caps.render(this.renderer, target, this.format.width, this.format.height)
      return
    }
    const timeSeconds = sample.timeSeconds
    this.setVehicle(timeSeconds)
    const state = this.cameraState(timeSeconds)
    const aperture = this.detail === 'full' && this.diagnostic !== 'normals' ? this.bokeh.aperture(sample, state) : null
    applyLens(this.camera, state, this.format.width, this.format.height, aperture ? { ...sample, aperture } : sample, lensSqueeze)
    const context: SampleContext = { sample, timeSeconds, camera: this.camera, state }
    for (const system of this.systems()) system.beginSample(context)
    this.rig.update(timeSeconds, sample.light)
    for (const part of this.parts) part.beforeSample?.(context)
    const passes = this.diagnostic === 'normals' ? [] : aperture ? [...this.passes, this.bokeh] : this.passes
    const direct = passes.length === 0 && this.detail !== 'full'
    const first = direct ? target : this.sceneTarget
    this.renderer.setRenderTarget(first)
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.clear(true, true, false)
    if (this.detail === 'full' && this.diagnostic === 'beauty') this.visibility.render(this.scene, this.camera)
    else this.renderer.render(this.scene, this.camera)
    let input = first.texture
    if (passes.length === 0 && !direct) {
      this.copy.material.uniforms.source.value = input
      this.copy.render(this.renderer, target)
    }
    passes.forEach((pass, i) => {
      const output = i === passes.length - 1 ? target : this.swap[i % 2]
      pass.render(this.renderer, { color: input, depth: this.sceneTarget.depthTexture as THREE.DepthTexture }, output, context)
      input = output.texture
    })
  }
}
