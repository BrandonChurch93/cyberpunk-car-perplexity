import * as THREE from 'three'

export class RainSkyDepth {
  private readonly depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType)
  private readonly snapshot = new THREE.WebGLRenderTarget(1, 1, {
    depthTexture: this.depth,
    format: THREE.RedFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  })
  private source: THREE.DepthTexture | null = null

  beginSample(): void {
    this.source = null
  }

  capture(renderer: THREE.WebGLRenderer): THREE.DepthTexture | null {
    const target = renderer.getRenderTarget()
    const depth = target?.depthTexture
    if (!target || !depth || target.samples !== 0 || renderer.getActiveMipmapLevel() !== 0 ||
        depth.format !== THREE.DepthFormat || depth.type !== THREE.UnsignedIntType) return null
    if (this.source !== depth) {
      this.snapshot.setSize(target.width, target.height)
      const face = renderer.getActiveCubeFace()
      try {
        renderer.initRenderTarget(this.snapshot)
        renderer.copyTextureToTexture(depth, this.depth)
      } finally {
        renderer.setRenderTarget(target, face)
      }
      this.source = depth
    }
    return this.depth
  }
}
