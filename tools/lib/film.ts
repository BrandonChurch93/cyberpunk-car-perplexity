import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatById, frameCount, type FormatSpec, type TierId } from '../../src/config.ts'
import { config, readJson, workDir } from './env.ts'
import { megabytes, probe, type Probe } from './probe.ts'
import type { StageDetail } from '../../src/core/detail.ts'
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
  detail: StageDetail
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
  detail: StageDetail
}

export function framesDir(spec: Pick<FilmSpec, 'format' | 'tier' | 'detail'>): string {
  return join(workDir, 'frames', `${spec.format.id}-${spec.tier}-${spec.detail}`)
}

export function frameFileName(frame: number): string {
  return `f${String(frame).padStart(5, '0')}.png`
}

export function filmPath(spec: Pick<FilmSpec, 'format' | 'tier' | 'detail'>, first = 0, last = frameCount - 1): string {
  const whole = first === 0 && last === frameCount - 1
  return join(workDir, `film-${spec.format.id}-${spec.tier}-${spec.detail}${whole ? '' : `-${first}-${last}`}.mp4`)
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
  return { frame, tier: spec.tier, format: spec.format, diag: spec.diag, paint: spec.paint, detail: spec.detail }
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
  return record !== null && record.buildHash === buildHash && record.format === spec.format.id && record.tier === spec.tier && record.paint === spec.paint && record.diagnostic === spec.diag && record.detail === spec.detail && record.first === first && record.last === last
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

export interface BundleRecord {
  buildHash: string
  format: string
  tier: string
  paint: string
  diagnostic: string
  detail: StageDetail
  frames: number[]
}

/** Group frames so that each bundle of PNG and record files stays under the attachment limit. */
export function bundleGroups(sizes: Array<{ frame: number; bytes: number }>, limitBytes: number): number[][] {
  const groups: number[][] = []
  let current: number[] = []
  let total = 0
  for (const { frame, bytes } of sizes) {
    if (bytes > limitBytes) throw new Error(`frame ${frame} alone is ${megabytes(bytes).toFixed(1)} MB, over the bundle limit`)
    if (current.length > 0 && total + bytes > limitBytes) {
      groups.push(current)
      current = []
      total = 0
    }
    current.push(frame)
    total += bytes
  }
  if (current.length > 0) groups.push(current)
  return groups
}

export const bundleLimitBytes = (): number => config.repo.maxFileMb * 0.95 * 1024 * 1024

/** Tar files of the frames first to last, each under the attachment limit, for sending a part from one machine to another. */
export function bundleFrames(spec: FilmSpec, first: number, last: number, buildHash: string, outDir: string, label: string): string[] {
  const dir = framesDir(spec)
  const sizes: Array<{ frame: number; bytes: number }> = []
  for (let f = first; f <= last; f++) {
    const png = join(dir, frameFileName(f))
    sizes.push({ frame: f, bytes: statSync(png).size + statSync(png.replace(/\.png$/, '.json')).size + 1024 })
  }
  const groups = bundleGroups(sizes, bundleLimitBytes() - 64 * 1024)
  mkdirSync(outDir, { recursive: true })
  const out: string[] = []
  groups.forEach((frames, i) => {
    const file = join(outDir, `${label}-${String(i + 1).padStart(2, '0')}-of-${String(groups.length).padStart(2, '0')}.tar`)
    const record: BundleRecord = { buildHash, format: spec.format.id, tier: spec.tier, paint: spec.paint, diagnostic: spec.diag, detail: spec.detail, frames }
    writeFileSync(join(dir, 'bundle.json'), JSON.stringify(record, null, 2))
    const names = ['bundle.json', ...frames.flatMap((f) => [frameFileName(f), frameFileName(f).replace(/\.png$/, '.json')])]
    execFileSync('tar', ['-cf', file, '-C', dir, ...names])
    rmSync(join(dir, 'bundle.json'), { force: true })
    out.push(file)
  })
  return out
}

/** Unpack bundles into the frame folder their own record names. A frame that is already there is compared byte for byte and kept, so one frame rendered on both machines proves they agree. */
export function unbundleFrames(files: string[]): Array<{ file: string; dir: string; record: BundleRecord; added: number; same: number; differing: number[] }> {
  return files.map((file) => {
    const record = JSON.parse(execFileSync('tar', ['-xOf', file, 'bundle.json'], { encoding: 'utf8' })) as BundleRecord
    if (record.detail !== 'full' && record.detail !== 'blockout') throw new Error(`${file} names no detail`)
    const dir = framesDir({ format: formatById(record.format), tier: record.tier as TierId, detail: record.detail })
    mkdirSync(dir, { recursive: true })
    const temp = join(dir, '.unbundle')
    rmSync(temp, { recursive: true, force: true })
    mkdirSync(temp)
    execFileSync('tar', ['-xf', file, '-C', temp, '--exclude', 'bundle.json'])
    let added = 0
    let same = 0
    const differing: number[] = []
    for (const f of record.frames) {
      const png = frameFileName(f)
      const json = png.replace(/\.png$/, '.json')
      if (existsSync(join(dir, png))) {
        if (readFileSync(join(dir, png)).equals(readFileSync(join(temp, png)))) same++
        else differing.push(f)
        continue
      }
      renameSync(join(temp, png), join(dir, png))
      renameSync(join(temp, json), join(dir, json))
      added++
    }
    rmSync(temp, { recursive: true, force: true })
    return { file, dir, record, added, same, differing }
  })
}
