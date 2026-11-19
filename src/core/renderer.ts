import * as THREE from 'three'
import type { FormatSpec } from '../config'

export const requiredExtensions = ['EXT_color_buffer_float', 'EXT_float_blend', 'OES_texture_float_linear'] as const

export const requiredLimits: Record<string, number> = {
  MAX_TEXTURE_SIZE: 4096,
  MAX_CUBE_MAP_TEXTURE_SIZE: 2048,
  MAX_RENDERBUFFER_SIZE: 4096,
  MAX_TEXTURE_IMAGE_UNITS: 16,
  MAX_DRAW_BUFFERS: 4,
}

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
  return renderer
}

export function sizeRenderer(renderer: THREE.WebGLRenderer, format: FormatSpec): void {
  renderer.setSize(format.width, format.height, false)
}
