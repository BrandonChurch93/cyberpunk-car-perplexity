import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import type { FormatSpec, TierId } from '../../src/config.ts'
import { stream } from '../../src/core/random.ts'
import { buildCrops, type CropManifest } from './crops.ts'
import { config, ensureDir, readJson, repoRoot, workDir, writeJson } from './env.ts'
import { judgedFrames, type JudgedFrame } from './judged.ts'
import { beatMoments, eventRuns, extractSection, heroFrame, hookFrames, juryText, macroFrame, neutralName, neutralProblems, returnFormat, roundName, shuffle } from './pack.ts'
import { recordMatches, RenderSession, stillName, type StillRecord, type StillSpec } from './render.ts'
import { beatOfFrame } from './scene.ts'
import { buildFrameSheet, buildSheet, sheetFrames } from './sheet.ts'

export type Fit = 'long' | 'phone' | 'native'

export interface PackItem {
  set: string
  source: string
  fit: Fit
  shows: string
  what: string
  /** Prepare to exactly this size by a center crop, as controls are. */
  size?: { width: number; height: number }
  meta?: Record<string, unknown>
  text?: string
}

export interface CriticPack {
  critic: string
  folder: string
  brief: string
  items: PackItem[]
  oneAtATime?: boolean
}

export class PackContext {
  private sessionPromise: Promise<RenderSession> | null = null
  readonly quality = readFileSync(join(repoRoot, 'kit', '07-QUALITY-BAR.md'), 'utf8')

  constructor(
    readonly phase: number,
    readonly round: number,
    readonly paint: string,
    readonly buildHash: string,
    readonly budgetMinutes: number | undefined,
  ) {}

  session(): Promise<RenderSession> {
    this.sessionPromise ??= RenderSession.open({ budgetMinutes: this.budgetMinutes })
    return this.sessionPromise
  }

  async close(): Promise<void> {
    if (this.sessionPromise) await (await this.sessionPromise).close()
  }

  spec(frame: number, tier: TierId, format: FormatSpec, diag = 'beauty'): StillSpec {
    return { frame, tier, format, diag, paint: this.paint }
  }

  async still(spec: StillSpec): Promise<string> {
    const file = join(workDir, 'stills', `${stillName(spec)}.png`)
    if (existsSync(file) && recordMatches(readJson<StillRecord>(file.replace(/\.png$/, '.json')), spec, this.buildHash)) return file
    return (await (await this.session()).still(spec)).file
  }

  async sheet(beat: string, tier: TierId, format: FormatSpec): Promise<string> {
    return (await buildSheet(await this.session(), { beat, tier, format, paint: this.paint, diag: 'beauty' })).file
  }

  async run(name: string, frames: number[], tier: TierId, format: FormatSpec): Promise<string> {
    return (await buildFrameSheet(await this.session(), { name, frames, tier, format, paint: this.paint, diag: 'beauty' })).file
  }

  async crops(spec: StillSpec): Promise<CropManifest & { dir: string }> {
    const { dir, manifest } = await buildCrops(await this.session(), spec)
    return { ...manifest, dir }
  }

  /** Phase 3 judges the look lock set. From Phase 4 the list in kit/PROGRESS.md. */
  judged(): JudgedFrame[] {
    if (this.phase === 3) return [heroFrame(), macroFrame()].map((frame) => ({ frame, vertical: true, beat: beatOfFrame(frame), why: 'look lock set' }))
    return judgedFrames()
  }

  brief(heading: string): string {
    return `${extractSection(this.quality, heading)}\n\n${returnFormat(this.quality)}\n`
  }
}

const beatIndex = (beat: string): number => config.beats.findIndex((b) => b.id === beat)
const seconds = (frame: number): string => `${(frame / config.film.fps).toFixed(2)} s`
const beatLabel = (beat: string): string => `beat ${beatIndex(beat) + 1} of ${config.beats.length} (${beat})`
const shape = (f: FormatSpec): string => (f.width >= f.height ? 'wide frame' : 'tall frame')

function sheetCaption(beat: string): string {
  const frames = sheetFrames(beat)
  if (beat === 'seam') return `${frames.length} frames across the loop point, ${seconds(frames[0])} to the end, then from 0 s to ${seconds(frames[frames.length - 1])}`
  return `${frames.length} frames from ${seconds(frames[0])} to ${seconds(frames[frames.length - 1])}, ${beatLabel(beat)}`
}

async function sheetsFor(ctx: PackContext, set: string): Promise<PackItem[]> {
  const out: PackItem[] = []
  for (const beat of [...config.beats.map((b) => b.id), 'seam']) {
    const source = await ctx.sheet(beat, 'review', config.formats.master)
    out.push({ set, source, fit: 'long', shows: `contact sheet, ${sheetCaption(beat)}`, what: `contact sheet ${beat}, review tier, ${config.formats.master.id}`, meta: { beat, frames: sheetFrames(beat) } })
  }
  return out
}

async function framesWithCrops(ctx: PackContext, frames: JudgedFrame[], set: string, cropSet: string, diag = 'beauty', which: 'all' | 'anchors' = 'all'): Promise<PackItem[]> {
  const out: PackItem[] = []
  for (const j of frames) {
    const spec = ctx.spec(j.frame, 'final', config.formats.master, diag)
    out.push({ set, source: await ctx.still(spec), fit: 'long', shows: `frame at ${seconds(j.frame)}, ${beatLabel(j.beat || beatOfFrame(j.frame))}, ${shape(spec.format)}${diag === 'beauty' ? '' : `, ${viewName(diag)}`}`, what: `${stillName(spec)}`, meta: { frame: j.frame, diag } })
    const crops = await ctx.crops(spec)
    for (const c of crops.crops) {
      if (which === 'anchors' && c.kind !== 'anchor') continue
      out.push({ set: cropSet, source: join(crops.dir, c.file), fit: 'native', shows: `full size detail of the frame at ${seconds(j.frame)}${diag === 'beauty' ? '' : ` (${viewName(diag)})`}, ${c.kind === 'anchor' ? `centered on the ${c.on.join(' and ')}` : `${c.on.join(', ')} region`}, ${c.rect.width} x ${c.rect.height} from left ${c.rect.left}, top ${c.rect.top}`, what: `crop ${c.id} of ${stillName(spec)}: ${c.note}`, meta: { frame: j.frame, crop: c.id, rect: c.rect } })
    }
  }
  return out
}

const viewName = (diag: string): string => ({ clay: 'plain gray view', zebra: 'black and white stripe view' } as Record<string, string>)[diag] ?? `${diag} view`

async function verticalFrames(ctx: PackContext, frames: JudgedFrame[], set: string): Promise<PackItem[]> {
  const out: PackItem[] = []
  for (const j of frames.filter((f) => f.vertical)) {
    const spec = ctx.spec(j.frame, 'final', config.formats.vertical)
    out.push({ set, source: await ctx.still(spec), fit: 'long', shows: `frame at ${seconds(j.frame)}, ${beatLabel(j.beat || beatOfFrame(j.frame))}, ${shape(spec.format)}`, what: stillName(spec), meta: { frame: j.frame } })
  }
  return out
}

async function c5Blockout(ctx: PackContext): Promise<CriticPack> {
  return { critic: 'C5', folder: 'c5', brief: ctx.brief('C5 blockout ·'), items: await sheetsFor(ctx, 'A') }
}

async function c8Blockout(ctx: PackContext): Promise<CriticPack> {
  const items: PackItem[] = []
  for (const [set, format] of [['A', config.formats.master], ['B', config.formats.vertical]] as const) {
    for (const m of beatMoments()) {
      const spec = ctx.spec(m.frame, 'review', format)
      items.push({ set, source: await ctx.still(spec), fit: 'long', shows: `frame at ${seconds(m.frame)}, ${m.moment} of ${beatLabel(m.beat)}, ${shape(format)}`, what: stillName(spec), meta: { frame: m.frame, beat: m.beat, moment: m.moment } })
    }
  }
  items.push(...(await sheetsFor(ctx, 'C')))
  return { critic: 'C8', folder: 'c8', brief: ctx.brief('C8 blockout ·'), items }
}

const controlKinds: Record<string, string[]> = {
  arrival: ['low-wide-single-car-rain', 'supercar-wet-night', 'empty-deck-night'],
  wake: ['supercar-wet-night', 'low-wide-single-car-rain'],
  return: ['supercar-wet-night', 'low-wide-single-car-rain', 'empty-deck-night'],
  paint: ['paint-water'],
  wheel: ['front-wheel'],
  lamp: ['lit-lamp'],
  detail: ['fine-detail'],
  exhaust: ['rear-exhaust', 'rear-taillights-wet'],
  ignition: ['rear-exhaust', 'rear-taillights-wet'],
}

interface Control {
  id: string
  category: string
  cacheFile: string
  status: string
}

function controlSource(c: Control): string {
  const original = join(repoRoot, 'reference', 'cache', 'controls', c.cacheFile)
  if (existsSync(original)) return original
  const pool = join(repoRoot, 'reference', 'cache', 'controls', 'pool', `${c.id}.png`)
  if (existsSync(pool)) return pool
  throw new Error(`control ${c.id} is not in reference/cache/controls/. Run npx tsx tools/controls.ts restore`)
}

async function sizeAfterFit(source: string, fit: Fit): Promise<{ width: number; height: number }> {
  const m = await sharp(source).metadata()
  const w = m.width ?? 0
  const h = m.height ?? 0
  if (fit === 'native') return { width: w, height: h }
  const limit = config.critics.maxImageLongEdgePx
  const s = fit === 'phone' ? config.critics.phonePreviewWidthPx / w : Math.min(1, limit / Math.max(w, h))
  return { width: Math.round(w * s), height: Math.round(h * s) }
}

async function c1(ctx: PackContext): Promise<CriticPack> {
  const judged = ctx.judged()
  const subjects: Array<{ item: PackItem; kind: string }> = []
  for (const j of judged) {
    const spec = ctx.spec(j.frame, 'final', config.formats.master)
    const beat = beatOfFrame(j.frame)
    subjects.push({ kind: beat, item: { set: 'A', source: await ctx.still(spec), fit: 'long', shows: '', what: `judged frame ${stillName(spec)}`, meta: { judged: true, frame: j.frame } } })
  }
  const cropFrom = async (frame: number, anchorWanted: string | null, count: number): Promise<void> => {
    const spec = ctx.spec(frame, 'final', config.formats.master)
    const m = await ctx.crops(spec)
    const ordered = [...m.crops.filter((c) => c.kind === 'anchor' && (anchorWanted === null || c.on.includes(anchorWanted))), ...m.crops.filter((c) => c.kind === 'anchor' && anchorWanted !== null && !c.on.includes(anchorWanted)), ...m.crops.filter((c) => c.kind === 'grid')]
    for (const c of ordered.slice(0, count)) {
      subjects.push({ kind: c.kind === 'anchor' ? c.on[0] : beatOfFrame(frame), item: { set: 'A', source: join(m.dir, c.file), fit: 'native', shows: '', what: `judged crop ${c.id} of ${stillName(spec)}: ${c.note}`, meta: { judged: true, frame, crop: c.id } } })
    }
  }
  if (ctx.phase === 3) {
    for (const j of judged) await cropFrom(j.frame, null, 2)
  } else {
    for (const beat of ['paint', 'wheel', 'lamp', 'detail']) {
      const j = judged.find((f) => beatOfFrame(f.frame) === beat)
      if (!j) throw new Error(`the judged list has no frame in the ${beat} beat, so C1 has no crop from it`)
      await cropFrom(j.frame, beat, 1)
    }
  }
  const ledger = (readJson<Control[]>(join(repoRoot, 'reference', 'controls.json')) ?? []).filter((c) => c.status === 'kept')
  const rng = stream(`pack-c1-${roundName(ctx.round)}`)
  const used = new Set<string>()
  const items: PackItem[] = []
  for (const s of subjects) {
    items.push(s.item)
    const size = await sizeAfterFit(s.item.source, s.item.fit)
    for (let k = 0; k < config.quality.blind.controlsPerRender; k++) {
      const kinds = controlKinds[s.kind] ?? []
      let pool = ledger.filter((c) => kinds.includes(c.category) && !used.has(c.id))
      if (pool.length === 0) pool = ledger.filter((c) => !used.has(c.id))
      if (pool.length === 0) pool = ledger
      if (pool.length === 0) throw new Error('reference/controls.json holds no kept control')
      const c = rng.pick(pool)
      used.add(c.id)
      items.push({ set: 'A', source: controlSource(c), fit: 'native', size, shows: '', what: `control ${c.id} (${c.category}) for ${s.item.what}`, meta: { control: c.id, category: c.category, pairedWith: s.item.what } })
    }
  }
  return { critic: 'C1', folder: 'c1', brief: `${juryText(ctx.quality)}\n`, items: shuffle(items, () => rng.next()), oneAtATime: true }
}

const boardElements: Record<string, string[]> = {
  wide: ['Wet asphalt and concrete at night under colored light', 'Puddles in rain', 'Rooftop car park decks', 'Rain lit from behind', 'Rain hitting hard surfaces', 'Neon and LED signage in rain and haze', 'A dense city at night in rain', 'Night automotive photography and film', 'Wet metal, wet rubber, wet painted steel'],
  paint: ['Water on glossy coated paint, macro', 'Neon and LED signage in rain and haze', 'Night automotive photography and film'],
  wheel: ['Wet metal, wet rubber, wet painted steel', 'Wet asphalt and concrete at night under colored light', 'Rain hitting hard surfaces', 'Puddles in rain', 'Rain lit from behind', 'Night automotive photography and film'],
  lamp: ['Water on glass', 'Water on glossy coated paint, macro', 'Rain lit from behind', 'Neon and LED signage in rain and haze', 'Night automotive photography and film'],
  detail: ['Wet metal, wet rubber, wet painted steel', 'Water on glossy coated paint, macro', 'Neon and LED signage in rain and haze', 'Night automotive photography and film'],
  ignition: ['Steam and heat shimmer in rain', 'Wet metal, wet rubber, wet painted steel', 'Puddles in rain', 'Wet asphalt and concrete at night under colored light', 'Rain lit from behind', 'Neon and LED signage in rain and haze', 'A dense city at night in rain', 'Night automotive photography and film'],
}
const elementsForBeat = (beat: string): string[] => boardElements[beat] ?? boardElements.wide

/** Each element's sources and sizes from the board, without URLs and without build notes. */
export function boardObservations(board: string, elements: string[]): string {
  const parts = board.split(/^## /m)
  const out: string[] = []
  for (const name of elements) {
    const part = parts.find((p) => p.split('\n')[0].trim() === name)
    if (!part) throw new Error(`reference/BOARD.md has no element "${name}"`)
    const kept: string[] = [`## ${name}`]
    let keep = true
    for (const line of part.split('\n').slice(1)) {
      if (line.startsWith('### ')) keep = /^### (Sources|Real-world sizes)/.test(line)
      if (!keep || /^- (URL|Image):/.test(line)) continue
      kept.push(line)
    }
    out.push(kept.join('\n').replace(/\n{3,}/g, '\n\n').trim())
  }
  return out.join('\n\n') + '\n'
}

async function c2(ctx: PackContext): Promise<CriticPack> {
  const judged = ctx.judged()
  const items = await framesWithCrops(ctx, judged, 'A', 'B')
  const beats = [...new Set(judged.map((j) => beatOfFrame(j.frame)))].sort((a, b) => beatIndex(a) - beatIndex(b))
  const keyDir = join(repoRoot, 'reference', 'keyframes')
  for (const beat of beats) {
    const prefix = `${String(beatIndex(beat) + 1).padStart(2, '0')}-${beat}.`
    const file = ['jpg', 'jpeg', 'png', 'webp'].map((e) => join(keyDir, prefix + e)).find((f) => existsSync(f))
    if (!file) throw new Error(`no key frame for ${beat} in reference/keyframes/`)
    items.push({ set: 'C', source: file, fit: 'long', shows: `target look for ${beatLabel(beat)}`, what: `key frame ${file}`, meta: { beat } })
  }
  const elements = [...new Set(beats.flatMap(elementsForBeat))]
  const board = readFileSync(join(repoRoot, 'reference', 'BOARD.md'), 'utf8')
  items.push({ set: 'D', source: 'reference/BOARD.md', fit: 'native', shows: 'written observations for every element in frame', what: `board observations: ${elements.join('; ')}`, text: boardObservations(board, elements) })
  return { critic: 'C2', folder: 'c2', brief: ctx.brief('C2 ·'), items }
}

async function c3(ctx: PackContext): Promise<CriticPack> {
  return { critic: 'C3', folder: 'c3', brief: ctx.brief('C3 ·'), items: await framesWithCrops(ctx, ctx.judged(), 'A', 'B') }
}

async function c4(ctx: PackContext): Promise<CriticPack> {
  const items: PackItem[] = []
  const withVehicle: JudgedFrame[] = []
  for (const j of ctx.judged()) {
    const m = await ctx.crops(ctx.spec(j.frame, 'final', config.formats.master))
    if (m.crops.some((c) => c.kind === 'anchor')) withVehicle.push(j)
  }
  for (const [diag, set, cropSet] of [['beauty', 'A', 'B'], ['clay', 'C', 'D'], ['zebra', 'E', 'F']] as const) {
    items.push(...(await framesWithCrops(ctx, withVehicle, set, cropSet, diag, 'anchors')))
  }
  return { critic: 'C4', folder: 'c4', brief: ctx.brief('C4 ·'), items }
}

async function c5(ctx: PackContext): Promise<CriticPack> {
  const items = await sheetsFor(ctx, 'A')
  for (const r of eventRuns()) {
    const source = await ctx.run(r.event, r.frames, 'review', config.formats.master)
    items.push({ set: 'B', source, fit: 'long', shows: `${r.frames.length} consecutive frames from ${seconds(r.frames[0])} to ${seconds(r.frames[r.frames.length - 1])}, around an event at ${r.seconds.toFixed(2)} s`, what: `run of consecutive frames around ${r.event}`, meta: { event: r.event, frames: r.frames } })
  }
  return { critic: 'C5', folder: 'c5', brief: ctx.brief('C5 ·'), items }
}

async function c6(ctx: PackContext): Promise<CriticPack> {
  const items: PackItem[] = []
  for (const [set, format] of [['A', config.formats.master], ['B', config.formats.vertical]] as const) {
    for (const frame of hookFrames()) {
      const spec = ctx.spec(frame, 'review', format)
      items.push({ set, source: await ctx.still(spec), fit: 'phone', shows: `frame at ${seconds(frame)}, ${shape(format)}, ${config.critics.phonePreviewWidthPx} px wide`, what: stillName(spec), meta: { frame } })
    }
  }
  return { critic: 'C6', folder: 'c6', brief: ctx.brief('C6 ·'), items }
}

export interface StressPair {
  beat: string
  frame: number
  before: string
  after: string
  rects: Array<{ id: string; on: string[]; rect: { left: number; top: number; width: number; height: number } }>
}

async function c7(ctx: PackContext): Promise<CriticPack> {
  const manifest = readJson<{ buildHash: string; paint: string; pairs: StressPair[] }>(join(workDir, 'stress', 'manifest.json'))
  if (!manifest || manifest.buildHash !== ctx.buildHash || manifest.paint !== ctx.paint) throw new Error('no stress output for the current build. Run npm run stress first')
  const items: PackItem[] = []
  const cropDir = ensureDir(join(workDir, 'stress', 'crops'))
  for (const p of manifest.pairs) {
    for (const [side, source, set] of [['before', p.before, 'A'], ['after', p.after, 'B']] as const) {
      items.push({ set, source, fit: 'long', shows: `frame at ${seconds(p.frame)}, ${beatLabel(p.beat)}, ${side === 'before' ? 'as made' : 'after the compressed copy'}`, what: `stress ${side} ${source}`, meta: { frame: p.frame, side } })
      for (const r of p.rects) {
        const file = join(cropDir, `${side}-f${p.frame}-${r.id}.png`)
        await sharp(source).extract(r.rect).png().toFile(file)
        items.push({ set: side === 'before' ? 'C' : 'D', source: file, fit: 'native', shows: `full size detail of the frame at ${seconds(p.frame)}, ${side === 'before' ? 'as made' : 'compressed copy'}, centered on the ${r.on.join(' and ')}`, what: `stress ${side} crop ${r.id} of frame ${p.frame}`, meta: { frame: p.frame, side, rect: r.rect } })
      }
    }
  }
  return { critic: 'C7', folder: 'c7', brief: ctx.brief('C7 ·'), items }
}

async function c8(ctx: PackContext): Promise<CriticPack> {
  const judged = ctx.judged()
  const items: PackItem[] = []
  for (const j of judged) {
    const spec = ctx.spec(j.frame, 'final', config.formats.master)
    items.push({ set: 'A', source: await ctx.still(spec), fit: 'long', shows: `frame at ${seconds(j.frame)}, ${beatLabel(beatOfFrame(j.frame))}, ${shape(spec.format)}`, what: stillName(spec), meta: { frame: j.frame } })
  }
  items.push(...(await verticalFrames(ctx, judged, 'B')))
  if (ctx.phase >= 4) items.push(...(await sheetsFor(ctx, 'C')))
  return { critic: 'C8', folder: 'c8', brief: ctx.brief('C8 ·'), items }
}

export type PackBuilder = (ctx: PackContext) => Promise<CriticPack>

/** Which critics each phase packs for. Extra critics from kit/02-VEHICLE.md join phases 3 and 4 here. */
export const packTable: Record<number, Record<string, PackBuilder>> = {
  2: { C5: c5Blockout, C8: c8Blockout },
  3: { C1: c1, C2: c2, C3: c3, C4: c4, C8: c8 },
  4: { C1: c1, C2: c2, C3: c3, C4: c4, C5: c5, C6: c6, C7: c7, C8: c8 },
}

async function prepare(item: PackItem, dst: string): Promise<{ width: number; height: number }> {
  const limit = config.critics.maxImageLongEdgePx
  let img = sharp(item.source).rotate()
  if (item.size) img = img.resize(item.size.width, item.size.height, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
  else if (item.fit === 'long') img = img.resize({ width: limit, height: limit, fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' })
  else if (item.fit === 'phone') img = img.resize({ width: config.critics.phonePreviewWidthPx, kernel: 'lanczos3' })
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true })
  if (Math.max(info.width, info.height) > limit) throw new Error(`${item.what} is ${info.width} x ${info.height}, over the long edge limit of ${limit}`)
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png({ compressionLevel: 9 }).toFile(dst)
  return { width: info.width, height: info.height }
}

export interface KeyEntry {
  what: string
  source: string
  width?: number
  height?: number
  meta?: Record<string, unknown>
}

export async function writePack(ctx: PackContext, pack: CriticPack): Promise<{ dir: string; files: string[]; key: Record<string, KeyEntry> }> {
  const dir = join(workDir, 'packs', roundName(ctx.round), pack.folder)
  rmSync(dir, { recursive: true, force: true })
  ensureDir(dir)
  const counters = new Map<string, number>()
  const files: Array<{ file: string; shows?: string }> = []
  const key: Record<string, KeyEntry> = {}
  for (const item of pack.items) {
    const n = (counters.get(item.set) ?? 0) + 1
    counters.set(item.set, n)
    const file = neutralName(item.set, n, item.text !== undefined ? 'txt' : 'png')
    const problems = [...neutralProblems(file), ...(pack.oneAtATime ? [] : neutralProblems(item.shows))]
    if (problems.length > 0) throw new Error(`"${file}" or its caption "${item.shows}" holds words a critic may not see: ${problems.join(', ')}`)
    if (item.text !== undefined) {
      writeFileSync(join(dir, file), item.text)
      key[file] = { what: item.what, source: item.source, meta: item.meta }
    } else {
      const size = await prepare(item, join(dir, file))
      key[file] = { what: item.what, source: item.source, ...size, meta: item.meta }
    }
    files.push(pack.oneAtATime ? { file } : { file, shows: item.shows })
  }
  writeFileSync(join(dir, 'brief.txt'), pack.brief)
  const manifest: Record<string, unknown> = { files }
  if (pack.oneAtATime) {
    manifest.oneImagePerCall = true
    manifest.jurorsPerImage = config.quality.blind.jurors
  }
  writeJson(join(dir, 'manifest.json'), manifest)
  return { dir, files: files.map((f) => f.file), key }
}
