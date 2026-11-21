import * as THREE from 'three'
import type { FormatSpec } from '../config'
import { requiredExtensions, requiredLimits } from './requirements'

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  })
  const gl = renderer.getContext() as WebGL2RenderingContext
  for (const name of requiredExtensions) {
    if (!gl.getExtension(name)) throw new Error(`This browser lacks the WebGL2 extension ${name}, which the film needs.`)
  }
  for (const [name, min] of Object.entries(requiredLimits)) {
    const have = gl.getParameter((gl as unknown as Record<string, number>)[name]) as number
    if (have < min) throw new Error(`This browser reports ${name} = ${have}. The film needs at least ${min}.`)
  }
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.autoClear = false
  renderer.info.autoReset = false
  singleSampleTransmission(renderer)
  return renderer
}

export const transmissionSamples: number = 0

/**
 * Three makes its transmission target multisampled so that a back face pass cannot read the texture it writes. No
 * transmissive material here draws back faces, and the film accumulates jittered samples, so the target is made
 * single sampled before its first use.
 */
export function singleSampleTransmission(renderer: THREE.WebGLRenderer): void {
  const seen = new WeakSet<object>()
  const set = renderer.setRenderTarget.bind(renderer)
  renderer.setRenderTarget = (target, face, level) => {
    if (target && !seen.has(target)) {
      seen.add(target)
      const t = target as unknown as THREE.WebGLRenderTarget
      if (t.samples === 4 && !t.resolveDepthBuffer && t.texture.generateMipmaps && t.texture.minFilter === THREE.LinearMipmapLinearFilter) t.samples = transmissionSamples
    }
    set(target, face, level)
  }
}

export function sizeRenderer(renderer: THREE.WebGLRenderer, format: FormatSpec): void {
  renderer.setSize(format.width, format.height, false)
}
