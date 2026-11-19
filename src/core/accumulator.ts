import * as THREE from 'three'
import type { FormatSpec } from '../config'
import { FullscreenPass, passMaterial } from './fullscreen'

const copyFragment = /* glsl */ `
precision highp float;
uniform sampler2D source;
in vec2 vUv;
out vec4 outColor;
void main() {
  outColor = texelFetch(source, ivec2(gl_FragCoord.xy), 0);
}
`

export class Accumulator {
  readonly sample: THREE.WebGLRenderTarget
  readonly sum: THREE.WebGLRenderTarget
  count = 0
  private readonly add: FullscreenPass
  private readonly copy: FullscreenPass

  constructor(private readonly renderer: THREE.WebGLRenderer, format: FormatSpec) {
    const options: THREE.RenderTargetOptions = {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      colorSpace: THREE.NoColorSpace,
    }
    this.sample = new THREE.WebGLRenderTarget(format.width, format.height, { ...options, depthBuffer: true })
    this.sample.depthTexture = new THREE.DepthTexture(format.width, format.height, THREE.UnsignedIntType)
    this.sum = new THREE.WebGLRenderTarget(format.width, format.height, { ...options, depthBuffer: false })
    this.add = new FullscreenPass(passMaterial(copyFragment, { source: { value: this.sample.texture } }, {
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    }))
    this.copy = new FullscreenPass(passMaterial(copyFragment, { source: { value: null } }, { blending: THREE.NoBlending }))
  }

  resize(format: FormatSpec): void {
    this.sample.setSize(format.width, format.height)
    this.sum.setSize(format.width, format.height)
    this.count = 0
  }

  clear(): void {
    this.renderer.setRenderTarget(this.sum)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.clear(true, false, false)
    this.count = 0
  }

  addSample(): void {
    this.add.render(this.renderer, this.sum)
    this.count += 1
  }

  read(): Float32Array {
    const { width, height } = this.sum
    const data = new Float32Array(new ArrayBuffer(width * height * 16))
    this.renderer.readRenderTargetPixels(this.sum, 0, 0, width, height, data)
    return data
  }

  write(data: Float32Array, count: number): void {
    const { width, height } = this.sum
    if (data.length !== width * height * 4) throw new Error('The stored running sum does not match the frame size.')
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType)
    texture.minFilter = THREE.NearestFilter
    texture.magFilter = THREE.NearestFilter
    texture.needsUpdate = true
    this.copy.material.uniforms.source.value = texture
    this.copy.render(this.renderer, this.sum)
    this.copy.material.uniforms.source.value = null
    texture.dispose()
    this.count = count
  }
}
