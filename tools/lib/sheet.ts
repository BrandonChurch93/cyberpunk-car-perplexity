import { join } from 'node:path'
import sharp, { type OverlayOptions } from 'sharp'
import { frameCount, type FormatSpec, type TierId } from '../../src/config.ts'
import { config, ensureDir, readJson, workDir, writeJson } from './env.ts'
import type { RenderSession, StillSpec } from './render.ts'

export interface SheetSpec {
  beat: string
  tier: TierId
  format: FormatSpec
  paint: string
  diag: string
}

export interface SheetRecord {
  buildHash: string
  format: string
  tier: string
  paint: string
  diagnostic: string
  beat: string
  frames: number[]
  width: number
  height: number
}

export function sheetFrames(beat: string): number[] {
  const n = config.critics.contactSheetFrames
  if (beat === 'seam') {
    const half = Math.floor(n / 2)
    const step = Math.max(1, Math.round((1.4 * config.film.fps) / half))
    const before = Array.from({ length: half }, (_, i) => frameCount - 1 - (half - 1 - i) * step)
    const after = Array.from({ length: n - half }, (_, i) => i * step)
    return [...before, ...after]
  }
  const spec = config.beats.find((b) => b.id === beat)
  if (!spec) throw new Error(`unknown beat ${beat}`)
  const first = Math.round(spec.start * config.film.fps)
  const last = Math.round(spec.end * config.film.fps) - 1
  return Array.from({ length: n }, (_, i) => Math.round(first + ((last - first) * i) / (n - 1)))
}

export function sheetName(spec: SheetSpec): string {
  return `sheet-${spec.beat}-${spec.format.id}-${spec.tier}-${spec.diag}-${spec.paint}`
}

function label(text: string, width: number, height: number): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#16181c"/><text x="6" y="${height - 6}" font-family="DejaVu Sans Mono, monospace" font-size="${height - 8}" fill="#d8d5cd">${text}</text></svg>`,
  )
}

export async function buildSheet(session: RenderSession, spec: SheetSpec): Promise<{ file: string; record: SheetRecord; reused: boolean }> {
  const dir = ensureDir(join(workDir, 'sheets'))
  const file = join(dir, `${sheetName(spec)}.png`)
  const recordPath = file.replace(/\.png$/, '.json')
  const frames = sheetFrames(spec.beat)
  const existing = readJson<SheetRecord>(recordPath)
  if (existing && existing.buildHash === session.buildHash && existing.format === spec.format.id && existing.tier === spec.tier && existing.paint === spec.paint && existing.diagnostic === spec.diag && existing.beat === spec.beat) {
    return { file, record: existing, reused: true }
  }
  const landscape = spec.format.width >= spec.format.height
  const limit = config.critics.maxImageLongEdgePx
  const columns = landscape ? Math.ceil(Math.sqrt((frames.length * 4) / 3)) : Math.ceil(frames.length / 2)
  const rows = Math.ceil(frames.length / columns)
  const strip = 20
  const gap = 4
  let tileW = Math.floor((limit - gap * (columns - 1)) / columns)
  let tileH = Math.round((tileW * spec.format.height) / spec.format.width)
  if (rows * (tileH + strip) + gap * (rows - 1) > limit) {
    tileH = Math.floor((limit - gap * (rows - 1)) / rows) - strip
    tileW = Math.round((tileH * spec.format.width) / spec.format.height)
  }
  const width = columns * tileW + gap * (columns - 1)
  const height = rows * (tileH + strip) + gap * (rows - 1)
  const layers: OverlayOptions[] = []
  for (let i = 0; i < frames.length; i++) {
    const still: StillSpec = { frame: frames[i], tier: spec.tier, format: spec.format, diag: spec.diag, paint: spec.paint }
    const { file: source } = await session.still(still)
    const left = (i % columns) * (tileW + gap)
    const top = Math.floor(i / columns) * (tileH + strip + gap)
    layers.push({ input: await sharp(source).resize(tileW, tileH, { kernel: 'lanczos3' }).toBuffer(), left, top: top + strip })
    layers.push({ input: label(`${i + 1}  ${(frames[i] / config.film.fps).toFixed(2)} s`, tileW, strip), left, top })
  }
  await sharp({ create: { width, height, channels: 3, background: '#16181c' } }).composite(layers).png({ compressionLevel: 6 }).toFile(file)
  const record: SheetRecord = { buildHash: session.buildHash, format: spec.format.id, tier: spec.tier, paint: spec.paint, diagnostic: spec.diag, beat: spec.beat, frames, width, height }
  writeJson(recordPath, record)
  return { file, record, reused: false }
}
