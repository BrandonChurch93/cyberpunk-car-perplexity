import * as THREE from 'three'
import recorded from '../../config/webgl-caps.json'
import { requiredExtensions, requiredLimits } from '../core/requirements'

export interface CapsLine { name: string; here: string; recorded: string; differs: boolean; required: boolean }
export interface CapsReport { renderer: string; limits: CapsLine[]; extensions: CapsLine[]; differing: number }

const recordedLimits = recorded.limits as Record<string, number>
const recordedExtensions = recorded.extensions as string[]

export function compareCaps(limits: Record<string, number | undefined>, extensions: readonly string[], renderer: string): CapsReport {
  const limitLines = Object.keys(recordedLimits).map((name) => {
    const here = limits[name]
    return { name, here: here === undefined ? 'absent' : String(here), recorded: String(recordedLimits[name]), differs: here !== recordedLimits[name], required: name in requiredLimits }
  })
  const names = [...new Set([...recordedExtensions, ...extensions])].sort()
  const extensionLines = names.map((name) => {
    const here = extensions.includes(name), was = recordedExtensions.includes(name)
    return { name, here: here ? 'yes' : 'no', recorded: was ? 'yes' : 'no', differs: here !== was, required: (requiredExtensions as readonly string[]).includes(name) }
  })
  return { renderer, limits: limitLines, extensions: extensionLines, differing: [...limitLines, ...extensionLines].filter((l) => l.differs).length }
}

export function readCaps(gl: WebGL2RenderingContext): CapsReport {
  const limits: Record<string, number | undefined> = {}
  const constants = gl as unknown as Record<string, number>
  for (const name of Object.keys(recordedLimits)) if (name in constants) limits[name] = gl.getParameter(constants[name]) as number
  const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array
  limits.MAX_VIEWPORT_WIDTH = viewport[0]
  limits.MAX_VIEWPORT_HEIGHT = viewport[1]
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic')
  if (aniso) limits.MAX_TEXTURE_MAX_ANISOTROPY = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = info ? (gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as string) : 'renderer not reported'
  return compareCaps(limits, gl.getSupportedExtensions() ?? [], renderer)
}

function drawCaps(report: CapsReport, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const c = canvas.getContext('2d')!
  c.fillStyle = '#0c0e11'
  c.fillRect(0, 0, width, height)
  const all = [...report.limits, ...report.extensions]
  const columns = width >= height ? 2 : 1
  const rows = Math.ceil((all.length + 2) / columns)
  const margin = Math.round(Math.min(width, height) * 0.04)
  const head = Math.round(Math.min(width, height) * 0.03)
  const line = Math.min(Math.floor((height - margin * 2 - head * 4) / rows), Math.round(head * 1.5))
  const size = Math.max(8, Math.floor(line * 0.68))
  const columnWidth = (width - margin * 2) / columns
  c.textBaseline = 'top'
  c.font = `600 ${head}px ui-monospace, Menlo, Consolas, monospace`
  c.fillStyle = '#e8eaed'
  c.fillText('WebGL2 limits and extensions of this machine against the recorded set', margin, margin)
  c.font = `${Math.round(head * 0.72)}px ui-monospace, Menlo, Consolas, monospace`
  c.fillStyle = report.differing === 0 ? '#7fd18b' : '#ffb454'
  c.fillText(`${report.differing === 0 ? 'no difference' : `${report.differing} differ, marked >>`}   ·   ${report.renderer}`.slice(0, Math.floor((width - margin * 2) / (head * 0.44))), margin, margin + head * 1.5)
  c.font = `${size}px ui-monospace, Menlo, Consolas, monospace`
  const fit = Math.floor(columnWidth / (size * 0.61)) - 1
  const entries: (CapsLine | string)[] = ['LIMITS (here / recorded)', ...report.limits, 'EXTENSIONS (here / recorded)', ...report.extensions]
  entries.forEach((entry, i) => {
    const x = margin + Math.floor(i / rows) * columnWidth
    const y = margin + head * 3.4 + (i % rows) * line
    if (typeof entry === 'string') {
      c.fillStyle = '#8ab4f8'
      c.fillText(entry, x, y)
      return
    }
    c.fillStyle = entry.differs ? '#ffb454' : entry.required ? '#e8eaed' : '#9aa3ad'
    const value = `${entry.here} / ${entry.recorded}`
    const name = `${entry.differs ? '>> ' : '   '}${entry.name}${entry.required ? ' *' : ''}`
    const room = fit - value.length - 1
    c.fillText(`${name.length > room ? name.slice(0, room) : name.padEnd(room)} ${value}`, x, y)
  })
  c.fillStyle = '#9aa3ad'
  c.fillText('* required by the film', margin, height - margin - size)
  return canvas
}

export class CapsView {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly material = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, toneMapped: false })
  private size = ''

  constructor() {
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material))
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, width: number, height: number): void {
    const key = `${width}x${height}`
    if (key !== this.size) {
      this.material.map?.dispose()
      const texture = new THREE.CanvasTexture(drawCaps(readCaps(renderer.getContext() as WebGL2RenderingContext), width, height))
      texture.colorSpace = THREE.SRGBColorSpace
      texture.generateMipmaps = false
      texture.minFilter = texture.magFilter = THREE.NearestFilter
      this.material.map = texture
      this.material.needsUpdate = true
      this.size = key
    }
    renderer.setRenderTarget(target)
    renderer.setClearColor(0x000000, 1)
    renderer.clear(true, true, false)
    renderer.render(this.scene, this.camera)
  }
}
