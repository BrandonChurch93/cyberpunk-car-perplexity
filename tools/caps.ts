import { join } from 'node:path'
import { config, repoRoot, writeJson, distDir, ensureBuild } from './lib/env.ts'
import { launchBrowser } from './lib/browser.ts'
import { startHarness } from './lib/server.ts'

const limitNames = [
  'MAX_TEXTURE_SIZE', 'MAX_3D_TEXTURE_SIZE', 'MAX_CUBE_MAP_TEXTURE_SIZE', 'MAX_ARRAY_TEXTURE_LAYERS', 'MAX_RENDERBUFFER_SIZE',
  'MAX_DRAW_BUFFERS', 'MAX_COLOR_ATTACHMENTS', 'MAX_SAMPLES', 'MAX_TEXTURE_IMAGE_UNITS', 'MAX_VERTEX_TEXTURE_IMAGE_UNITS',
  'MAX_COMBINED_TEXTURE_IMAGE_UNITS', 'MAX_VERTEX_ATTRIBS', 'MAX_VERTEX_UNIFORM_VECTORS', 'MAX_FRAGMENT_UNIFORM_VECTORS',
  'MAX_VARYING_VECTORS', 'MAX_UNIFORM_BUFFER_BINDINGS', 'MAX_UNIFORM_BLOCK_SIZE', 'MAX_ELEMENTS_VERTICES', 'MAX_ELEMENTS_INDICES',
]

async function main(): Promise<void> {
  ensureBuild()
  const harness = await startHarness(distDir)
  const browser = await launchBrowser()
  const page = await browser.newPage()
  await page.goto(`${harness.url}index.html?mode=capture&format=${config.formats.preview.id}`)
  const caps = await page.evaluate(async (names) => {
    const gl = document.createElement('canvas').getContext('webgl2')!
    const limits: Record<string, number> = {}
    for (const n of names) limits[n] = gl.getParameter((gl as unknown as Record<string, number>)[n]) as number
    const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array
    limits.MAX_VIEWPORT_WIDTH = viewport[0]
    limits.MAX_VIEWPORT_HEIGHT = viewport[1]
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic')
    if (aniso) limits.MAX_TEXTURE_MAX_ANISOTROPY = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const codecs: Record<string, boolean> = {}
    const hasEncoder = typeof VideoEncoder !== 'undefined'
    if (hasEncoder) {
      for (const [id, codec] of [['h264-high-4.2', 'avc1.64002a'], ['h264-main-4.0', 'avc1.4d0028'], ['h264-baseline-4.0', 'avc1.420028'], ['vp9', 'vp09.00.40.08'], ['vp8', 'vp8'], ['av1', 'av01.0.08M.08']]) {
        try {
          const r = await VideoEncoder.isConfigSupported({ codec, width: 1920, height: 1080, bitrate: 20_000_000, framerate: 30 })
          codecs[id] = r.supported === true
        } catch {
          codecs[id] = false
        }
      }
    }
    return {
      renderer: info ? (gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as string) : 'unknown',
      userAgent: navigator.userAgent,
      secureContext: isSecureContext,
      videoEncoder: hasEncoder,
      codecs,
      limits,
      extensions: (gl.getSupportedExtensions() ?? []).sort(),
    }
  }, limitNames)
  await browser.close()
  await harness.close()
  if (process.argv.includes('--write')) {
    writeJson(join(repoRoot, 'config', 'webgl-caps.json'), { limits: caps.limits, extensions: caps.extensions })
    console.log('wrote config/webgl-caps.json')
  }
  console.log(JSON.stringify(caps, null, 2))
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
