import * as THREE from 'three'
import { config, paintById, type FormatSpec } from '../config'
import { cameraAt } from '../director/shots'
import { stateAt } from '../director/timeline'
import { createVehicle, type VehicleModule } from '../vehicle'
import { createWorld, type WorldModule } from '../world'
import type { FrameInfo, SampleInfo, Stage } from './engine'
import { applyLens, type CameraState } from './lens'

export class FilmStage implements Stage {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera()
  cameraOverride: CameraState | null = null
  private readonly clay = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.95 })
  private format: FormatSpec = config.formats.master
  private frameSeconds = 0

  static async create(renderer: THREE.WebGLRenderer, paint: string): Promise<FilmStage> {
    const [world, vehicle] = await Promise.all([createWorld({ detail: 'blockout' }), createVehicle({ paint: paintById(paint), detail: 'blockout' })])
    return new FilmStage(renderer, world, vehicle)
  }

  private constructor(
    private readonly renderer: THREE.WebGLRenderer,
    readonly world: WorldModule,
    readonly vehicle: VehicleModule,
  ) {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.scene.add(this.world.root, this.vehicle.root)
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

  resize(format: FormatSpec): void {
    this.format = format
  }

  setDiagnostic(view: string): void {
    this.scene.overrideMaterial = view === 'clay' ? this.clay : null
  }

  setPaint(id: string): void {
    this.vehicle.setPaint(paintById(id))
  }

  beginFrame(frame: FrameInfo): void {
    this.frameSeconds = frame.timeSeconds
  }

  cameraState(timeSeconds: number): CameraState {
    return this.cameraOverride ?? cameraAt(timeSeconds, this.format, this.vehicle.anchors, this.frameSeconds)
  }

  renderSample(sample: SampleInfo, target: THREE.WebGLRenderTarget): void {
    const state = stateAt(sample.timeSeconds)
    this.vehicle.update({ timeSeconds: sample.timeSeconds, lampStage: state.lampStage, engine: state.engine, vibration: state.vibration })
    this.world.update(sample.timeSeconds)
    applyLens(this.camera, this.cameraState(sample.timeSeconds), this.format.width, this.format.height, sample, config.lens.anamorphic ? 1.5 : 1)
    this.renderer.setRenderTarget(target)
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.clear(true, true, false)
    this.renderer.render(this.scene, this.camera)
  }
}
