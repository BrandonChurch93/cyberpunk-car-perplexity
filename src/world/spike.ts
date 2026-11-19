import * as THREE from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'
import { config, type FormatSpec } from '../config'
import type { FrameInfo, SampleInfo, Stage } from '../core/engine'
import { applyLens, type CameraState } from '../core/lens'
import { stream } from '../core/random'

export class SpikeStage implements Stage {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera()
  private readonly clay = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.9 })
  private readonly spinners: THREE.Mesh[] = []
  private format: FormatSpec = config.formats.master

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    const rng = stream('spike')
    this.scene.background = new THREE.Color(0x05060a)
    const knot = new THREE.TorusKnotGeometry(0.45, 0.16, 200, 32)
    const palette = [0xe2520f, 0xaeb4bd, 0x1b1b24, 0x2f6fd6, 0xd62f8a]
    for (let i = 0; i < 24; i++) {
      const material = new THREE.MeshPhysicalMaterial({
        color: rng.pick(palette),
        metalness: rng.next() < 0.5 ? 1 : 0,
        roughness: rng.range(0.15, 0.6),
        clearcoat: 1,
        clearcoatRoughness: 0.05,
      })
      const mesh = new THREE.Mesh(knot, material)
      const angle = (i / 24) * Math.PI * 2
      const radius = 2.2 + 2.6 * rng.next()
      mesh.position.set(Math.cos(angle) * radius, 0.75 + rng.next() * 0.6, Math.sin(angle) * radius)
      mesh.rotation.set(rng.next() * 6, rng.next() * 6, rng.next() * 6)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.userData.rate = Math.round(rng.range(1, 4))
      this.scene.add(mesh)
      this.spinners.push(mesh)
    }
    const floor = new Reflector(new THREE.PlaneGeometry(40, 40), {
      textureWidth: config.formats.master.width,
      textureHeight: config.formats.master.height,
      color: 0x5a5d66,
    })
    floor.rotation.x = -Math.PI / 2
    this.scene.add(floor)
    const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.6 }))
    shadowCatcher.rotation.x = -Math.PI / 2
    shadowCatcher.position.y = 0.002
    shadowCatcher.receiveShadow = true
    this.scene.add(shadowCatcher)
    const key = new THREE.SpotLight(0xff3fa0, 900, 40, 0.6, 0.5, 2)
    key.position.set(6, 9, 4)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0005
    this.scene.add(key, key.target)
    const rim = new THREE.PointLight(0x35c8ff, 400, 0, 2)
    rim.position.set(-7, 4, -5)
    this.scene.add(rim)
    const warm = new THREE.PointLight(0xffb060, 250, 0, 2)
    warm.position.set(2, 3, -8)
    this.scene.add(warm)
    this.scene.add(new THREE.HemisphereLight(0x3a3f66, 0x101014, 0.6))
  }

  resize(format: FormatSpec): void {
    this.format = format
  }

  setDiagnostic(view: string): void {
    this.scene.overrideMaterial = view === 'clay' ? this.clay : null
  }

  setPaint(_id: string): void {}

  beginFrame(_frame: FrameInfo): void {}

  renderSample(sample: SampleInfo, target: THREE.WebGLRenderTarget): void {
    const turn = (sample.timeSeconds / config.film.durationSeconds) * Math.PI * 2
    for (const mesh of this.spinners) mesh.rotation.y = turn * (mesh.userData.rate as number)
    const position = new THREE.Vector3(Math.sin(turn) * 9, 2.2, Math.cos(turn) * 9)
    const look = new THREE.Matrix4().lookAt(position, new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(0, 1, 0))
    const state: CameraState = {
      position,
      quaternion: new THREE.Quaternion().setFromRotationMatrix(look),
      focalMm: config.lens.focalLengthsMm[1],
      sensorWidthMm: 36,
      focusDistance: 9,
      fNumber: 1.4,
      near: 0.1,
      far: 200,
    }
    applyLens(this.camera, state, this.format.width, this.format.height, sample, config.lens.anamorphic ? 1.5 : 1)
    this.renderer.setRenderTarget(target)
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.clear(true, true, false)
    this.renderer.render(this.scene, this.camera)
  }
}
