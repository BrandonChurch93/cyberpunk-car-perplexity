export const requiredExtensions = ['EXT_color_buffer_float', 'EXT_float_blend', 'OES_texture_float_linear'] as const

export const requiredLimits: Record<string, number> = {
  MAX_TEXTURE_SIZE: 4096,
  MAX_CUBE_MAP_TEXTURE_SIZE: 2048,
  MAX_RENDERBUFFER_SIZE: 4096,
  MAX_TEXTURE_IMAGE_UNITS: 16,
  MAX_DRAW_BUFFERS: 4,
}
