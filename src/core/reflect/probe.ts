import * as THREE from 'three'
import { layers } from '../contract'
import { Prefilter } from './prefilter'

function cubeTarget(size: number): THREE.WebGLCubeRenderTarget {
  return new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  })
}

/** Draws the six faces of a cube from one point and filters them for roughness. Shadow maps are drawn once, for the first face. */
export class Probe {
  readonly cube: THREE.CubeCamera
  private readonly target: THREE.WebGLCubeRenderTarget
  private readonly prefilter: Prefilter
  private withEmitters: Prefilter | null = null

  constructor(private readonly renderer: THREE.WebGLRenderer, size: number, near: number, far: number) {
    this.target = cubeTarget(size)
    this.cube = new THREE.CubeCamera(near, far, this.target)
    this.cube.coordinateSystem = renderer.coordinateSystem
    this.cube.updateCoordinateSystem()
    for (const camera of this.cube.children) camera.layers.set(layers.scene)
    this.prefilter = new Prefilter(renderer, size)
  }

  capture(scene: THREE.Scene, position: THREE.Vector3): THREE.Texture
  capture(scene: THREE.Scene, position: THREE.Vector3, emitters: THREE.Object3D): { background: THREE.Texture; full: THREE.Texture }
  capture(scene: THREE.Scene, position: THREE.Vector3, emitters?: THREE.Object3D) {
    const renderer = this.renderer
    this.cube.position.copy(position)
    this.cube.updateMatrixWorld(true)
    const shadows = renderer.shadowMap.autoUpdate
    const target = renderer.getRenderTarget()
    const color = renderer.getClearColor(new THREE.Color())
    const alpha = renderer.getClearAlpha()
    const autoClear = renderer.autoClear
    renderer.setClearColor(0x000000, 1)
    try {
      this.cube.children.forEach((camera, face) => {
        this.target.texture.generateMipmaps = face === 5
        renderer.setRenderTarget(this.target, face)
        renderer.clear(true, true, false)
        renderer.render(scene, camera as THREE.PerspectiveCamera)
        renderer.shadowMap.autoUpdate = false
        renderer.shadowMap.needsUpdate = false
      })
      const background = this.prefilter.run(this.target.texture)
      if (!emitters) return background
      // Keep scenery color and depth so the second map only redraws the emitters.
      const wasVisible = emitters.visible
      emitters.visible = true
      renderer.autoClear = false
      try {
        this.cube.children.forEach((camera, face) => {
          this.target.texture.generateMipmaps = face === 5
          renderer.setRenderTarget(this.target, face)
          renderer.render(emitters, camera as THREE.PerspectiveCamera)
        })
      } finally {
        emitters.visible = wasVisible
        renderer.autoClear = autoClear
      }
      this.withEmitters ??= new Prefilter(renderer, this.target.width)
      return { background, full: this.withEmitters.run(this.target.texture) }
    } finally {
      renderer.shadowMap.autoUpdate = shadows
      renderer.setClearColor(color, alpha)
      renderer.setRenderTarget(target)
    }
  }

}
