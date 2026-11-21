import type { Page } from 'playwright'
import type { BeatSpec, FormatSpec } from '../../src/config.ts'

export function scaledSize(base: FormatSpec, width: number): { width: number; height: number } {
  if (!Number.isInteger(width) || width < 16 || width > base.width) throw new Error(`width ${width} must be a whole number from 16 to ${base.width}`)
  return { width, height: Math.round((width * base.height) / base.width) }
}

export async function shrinkPage(page: Page, base: FormatSpec, width: number): Promise<{ width: number; height: number }> {
  const size = scaledSize(base, width)
  await page.evaluate(([w, h, id]) => {
    const stage = (window as unknown as { filmStage: { format: { width: number; height: number } } }).filmStage
    stage.format.width = w as number
    stage.format.height = h as number
    return window.showcase!.setFormat(id as string)
  }, [size.width, size.height, base.id] as const)
  return size
}

export interface ScanFrame {
  frame: number
  shot: string
  mean: number
  p50: number
  p99: number
  nonFinite: number
  begin: number
  seconds: number
}

export interface ScanFlag {
  frame: number
  shot: string
  reasons: string[]
}

export interface ScanFile {
  buildHash: string
  format: string
  width: number
  height: number
  tier: string
  detail: string
  paint: string
  jump: number
  frames: ScanFrame[]
  flagged: ScanFlag[]
}

export function lumaStats(data: Uint8Array | Buffer, channels = 3): { mean: number; p50: number; p99: number } {
  const histogram = new Float64Array(256)
  let sum = 0
  let count = 0
  for (let i = 0; i + 2 < data.length; i += channels) {
    const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    sum += y
    histogram[Math.min(255, Math.round(y))]++
    count++
  }
  const rank = (q: number): number => {
    const want = q * count
    let seen = 0
    for (let v = 0; v < 256; v++) {
      seen += histogram[v]
      if (seen >= want) return v
    }
    return 255
  }
  return { mean: count ? sum / count : 0, p50: rank(0.5), p99: rank(0.99) }
}

export function parseFrames(spec: string | undefined, frameCount: number): number[] {
  if (!spec || spec === 'all') return Array.from({ length: frameCount }, (_, i) => i)
  const out = new Set<number>()
  for (const part of spec.split(',')) {
    const range = part.split('-').map((s) => s.trim())
    const [a, b] = range.length === 2 ? [Number(range[0]), Number(range[1])] : [Number(range[0]), Number(range[0])]
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b >= frameCount || b < a) throw new Error(`frames ${part} is outside 0 to ${frameCount - 1}`)
    for (let f = a; f <= b; f++) out.add(f)
  }
  return [...out].sort((x, y) => x - y)
}

export function every(frames: number[], step: number): number[] {
  if (!Number.isInteger(step) || step < 1) throw new Error(`every must be a whole number from 1, got ${step}`)
  return frames.filter((_, i) => i % step === 0)
}

export function shard(frames: number[], spec: string | undefined): number[] {
  if (!spec) return frames
  const m = /^(\d+)\/(\d+)$/.exec(spec)
  if (!m) throw new Error(`shard ${spec} must look like 2/5`)
  const i = Number(m[1])
  const n = Number(m[2])
  if (n < 1 || i < 1 || i > n) throw new Error(`shard ${spec} needs 1 <= i <= n`)
  const start = Math.floor(((i - 1) * frames.length) / n)
  const end = Math.floor((i * frames.length) / n)
  return frames.slice(start, end)
}

export function shotOf(timeSeconds: number, beats: readonly BeatSpec[]): string {
  for (const beat of beats) if (timeSeconds < beat.end) return beat.id
  return beats[beats.length - 1].id
}

export function flags(frames: ScanFrame[], jump: number): ScanFlag[] {
  const sorted = [...frames].sort((a, b) => a.frame - b.frame)
  const out: ScanFlag[] = []
  const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(b, 1e-6)
  sorted.forEach((f, i) => {
    const reasons: string[] = []
    if (f.nonFinite > 0) reasons.push(`${f.nonFinite} non-finite`)
    const prev = sorted[i - 1]
    const next = sorted[i + 1]
    if (prev && next && prev.shot === f.shot && next.shot === f.shot) {
      const a = rel(f.mean, prev.mean)
      const b = rel(f.mean, next.mean)
      if (a > jump && b > jump) reasons.push(`mean ${f.mean.toFixed(1)} against ${prev.mean.toFixed(1)} and ${next.mean.toFixed(1)}`)
    }
    if (reasons.length) out.push({ frame: f.frame, shot: f.shot, reasons })
  })
  return out
}

export function merge(files: ScanFile[]): ScanFile {
  if (files.length === 0) throw new Error('nothing to merge')
  const head = files[0]
  for (const f of files) {
    for (const key of ['buildHash', 'format', 'width', 'height', 'tier', 'detail', 'paint'] as const) {
      if (f[key] !== head[key]) throw new Error(`cannot merge scans with different ${key}: ${String(head[key])} and ${String(f[key])}`)
    }
  }
  const byFrame = new Map<number, ScanFrame>()
  for (const f of files) for (const frame of f.frames) byFrame.set(frame.frame, frame)
  const frames = [...byFrame.values()].sort((a, b) => a.frame - b.frame)
  return { ...head, frames, flagged: flags(frames, head.jump) }
}
