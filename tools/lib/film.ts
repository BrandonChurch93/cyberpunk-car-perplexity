import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { frameCount, type FormatSpec, type TierId } from '../../src/config.ts'
import { config, readJson, workDir } from './env.ts'
import { megabytes, probe, type Probe } from './probe.ts'
import { recordMatches, type StillRecord, type StillSpec } from './render.ts'

export interface FilmFrameCheck {
  frame: number
  blank: boolean
  flat: boolean
  invalidPixels: number
}

export interface FilmRecord {
  buildHash: string
  format: string
  tier: string
  paint: string
  diagnostic: string
  first: number
  last: number
  frameCount: number
  fps: number
  crf: number
  bytes: number
  probe: Probe
  g5: { ok: boolean; failed: number[]; frames: FilmFrameCheck[] }
  renderSeconds: number
}

export interface FilmSpec {
  tier: TierId
  format: FormatSpec
  paint: string
  diag: string
}

export function framesDir(spec: Pick<FilmSpec, 'format' | 'tier'>): string {
  return join(workDir, 'frames', `${spec.format.id}-${spec.tier}`)
}

export function frameFileName(frame: number): string {
  return `f${String(frame).padStart(5, '0')}.png`
}

export function filmPath(spec: Pick<FilmSpec, 'format' | 'tier'>, first = 0, last = frameCount - 1): string {
  const whole = first === 0 && last === frameCount - 1
  return join(workDir, `film-${spec.format.id}-${spec.tier}${whole ? '' : `-${first}-${last}`}.mp4`)
}

export const recordPathFor = (file: string): string => file.replace(/\.mp4$/, '.json')

/** Part I of K, counted from 1, as a contiguous slice of first to last. */
export function partRange(first: number, last: number, parts: number, part: number): [number, number] {
  if (!Number.isInteger(parts) || parts < 1) throw new Error(`--parts must be a whole number of at least 1`)
  if (!Number.isInteger(part) || part < 1 || part > parts) throw new Error(`--part must be from 1 to ${parts}`)
  const count = last - first + 1
  const a = first + Math.floor((count * (part - 1)) / parts)
  const b = first + Math.floor((count * part) / parts) - 1
  return [a, b]
}

export function rangeFromArgs(a: Record<string, string>): { first: number; last: number; slice: [number, number] } {
  const first = a.first !== undefined ? Number(a.first) : 0
  const last = a.last !== undefined ? Number(a.last) : frameCount - 1
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last > frameCount - 1 || first > last) throw new Error(`the range ${first} to ${last} is outside 0 to ${frameCount - 1}`)
  const slice = a.parts !== undefined ? partRange(first, last, Number(a.parts), Number(a.part)) : ([first, last] as [number, number])
  return { first, last, slice }
}

export function frameSpec(spec: FilmSpec, frame: number): StillSpec {
  return { frame, tier: spec.tier, format: spec.format, diag: spec.diag, paint: spec.paint }
}

/** Which frames in the range still need a frame file whose record matches the current build. */
export function missingFrames(spec: FilmSpec, first: number, last: number, buildHash: string): number[] {
  const dir = framesDir(spec)
  const missing: number[] = []
  for (let f = first; f <= last; f++) {
    const file = join(dir, frameFileName(f))
    const record = readJson<StillRecord>(file.replace(/\.png$/, '.json'))
    if (!existsSync(file) || !recordMatches(record, frameSpec(spec, f), buildHash) || record.width !== spec.format.width || record.height !== spec.format.height) missing.push(f)
  }
  return missing
}

export function filmMatches(record: FilmRecord | null, spec: FilmSpec, buildHash: string, first: number, last: number): record is FilmRecord {
  return record !== null && record.buildHash === buildHash && record.format === spec.format.id && record.tier === spec.tier && record.paint === spec.paint && record.diagnostic === spec.diag && record.first === first && record.last === last
}

function x264(dir: string, first: number, count: number, out: string, crf: number): void {
  execFileSync('ffmpeg', [
    '-y', '-v', 'error',
    '-framerate', String(config.film.fps), '-start_number', String(first), '-i', join(dir, 'f%05d.png'),
    '-frames:v', String(count),
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-tune', 'film',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-r', String(config.film.fps), '-movflags', '+faststart', out,
  ], { stdio: ['ignore', 'inherit', 'inherit'] })
}

/** Encode with the lowest CRF that keeps the file under the repo size limit. */
export function encodeFilm(dir: string, first: number, last: number, out: string): { crf: number; probe: Probe } {
  const count = last - first + 1
  const ceiling = config.repo.maxFileMb * 0.95
  for (const crf of [14, 17, 20, 23, 26, 29]) {
    x264(dir, first, count, out, crf)
    const p = probe(out)
    if (megabytes(p.bytes) < ceiling) return { crf, probe: p }
    console.log(`crf ${crf} gives ${megabytes(p.bytes).toFixed(1)} MB, trying a higher crf`)
  }
  throw new Error(`the film does not fit under ${config.repo.maxFileMb} MB even at crf 29`)
}

export function verifyFilm(p: Probe, format: FormatSpec, count: number): string[] {
  const bad: string[] = []
  if (Math.abs(p.fps - config.film.fps) > 1e-6) bad.push(`fps ${p.fps}`)
  if (p.frames !== count) bad.push(`${p.frames} frames, expected ${count}`)
  if (p.width !== format.width || p.height !== format.height) bad.push(`size ${p.width} x ${p.height}`)
  if (megabytes(p.bytes) >= config.repo.maxFileMb) bad.push(`${megabytes(p.bytes).toFixed(1)} MB`)
  if (p.pixelFormat !== 'yuv420p') bad.push(`pixel format ${p.pixelFormat}`)
  return bad
}

export function frameChecks(spec: FilmSpec, first: number, last: number): FilmFrameCheck[] {
  const dir = framesDir(spec)
  const out: FilmFrameCheck[] = []
  for (let f = first; f <= last; f++) {
    const r = readJson<StillRecord>(join(dir, frameFileName(f)).replace(/\.png$/, '.json'))
    if (!r) throw new Error(`frame ${f} has no record`)
    out.push({ frame: f, blank: r.check.blank, flat: r.check.flat, invalidPixels: r.check.invalidPixels })
  }
  return out
}

export function emptyFrames(spec: FilmSpec): void {
  const dir = framesDir(spec)
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) rmSync(join(dir, name), { force: true, recursive: true })
}
