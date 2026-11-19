import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { defaultPaint, frameCount, paintById, type FormatSpec } from '../../src/config.ts'
import { createWorld } from '../../src/world/index.ts'
import { openPage } from './browser.ts'
import { buildHash, config, readJson, repoRoot, workDir } from './env.ts'
import { filmMatches, filmPath, recordPathFor, type FilmRecord } from './film.ts'
import { decode, meanAbsDiff, ssim } from './image.ts'
import { judgedFrames } from './judged.ts'
import { heroFrame, macroFrame } from './pack.ts'
import { megabytes, probe } from './probe.ts'
import { recordMatches, RenderSession, stillName, type StillRecord, type StillSpec } from './render.ts'

export interface Result {
  ok: boolean
  detail: string
}

const tierOrder = ['final', 'review', 'draft'] as const

/** The kept preview film if it is current, otherwise the newest current preview film in out/work/. */
export function currentPreviewFilm(hash = buildHash(), paint = defaultPaint): { file: string; record: FilmRecord } | null {
  const kept = readJson<FilmRecord>(join(repoRoot, 'out', 'preview.json'))
  const keptFile = join(repoRoot, 'out', 'preview.mp4')
  if (kept && existsSync(keptFile) && filmMatches(kept, { tier: kept.tier as 'draft', format: config.formats.preview, paint, diag: 'beauty' }, hash, 0, frameCount - 1)) return { file: keptFile, record: kept }
  for (const tier of tierOrder) {
    const spec = { tier, format: config.formats.preview, paint, diag: 'beauty' }
    const file = filmPath(spec)
    const record = readJson<FilmRecord>(recordPathFor(file))
    if (existsSync(file) && filmMatches(record, spec, hash, 0, frameCount - 1)) return { file, record }
  }
  return null
}

function stillProblems(specs: StillSpec[], hash: string): { missing: string[]; bad: string[] } {
  const missing: string[] = []
  const bad: string[] = []
  for (const spec of specs) {
    const record = readJson<StillRecord>(join(workDir, 'stills', `${stillName(spec)}.json`))
    if (!existsSync(join(workDir, 'stills', `${stillName(spec)}.png`)) || !recordMatches(record, spec, hash)) missing.push(stillName(spec))
    else if (!record.check.ok) bad.push(`${stillName(spec)} (blank ${record.check.blank}, flat ${record.check.flat}, invalid ${record.check.invalidPixels})`)
  }
  return { missing, bad }
}

export function lookLockSpecs(paint: string): StillSpec[] {
  const out: StillSpec[] = []
  for (const frame of [heroFrame(), macroFrame()]) {
    for (const diag of ['beauty', 'clay', 'zebra']) out.push({ frame, tier: 'final', format: config.formats.master, diag, paint })
    out.push({ frame, tier: 'final', format: config.formats.vertical, diag: 'beauty', paint })
  }
  return out
}

export function judgedSpecs(paint: string): StillSpec[] {
  const out: StillSpec[] = []
  for (const j of judgedFrames()) {
    out.push({ frame: j.frame, tier: 'final', format: config.formats.master, diag: 'beauty', paint })
    if (j.vertical) out.push({ frame: j.frame, tier: 'final', format: config.formats.vertical, diag: 'beauty', paint })
  }
  return out
}

export function g5(phase: number, paintArg?: string): Result {
  const hash = buildHash()
  const parts: string[] = []
  let ok = true
  if (phase !== 3) {
    const film = currentPreviewFilm(hash, paintArg ? paintById(paintArg).id : defaultPaint)
    if (!film) {
      ok = false
      parts.push(`no ${config.formats.preview.id} film record matches build ${hash}`)
    } else if (!film.record.g5.ok || film.record.g5.frames.length !== frameCount) {
      ok = false
      parts.push(`preview film: ${film.record.g5.failed.length} frames failed, first ${film.record.g5.failed.slice(0, 8).join(', ')}, ${film.record.g5.frames.length} checked`)
    } else parts.push(`${film.record.g5.frames.length} preview frames clean (${film.record.tier} tier)`)
  }
  if (phase >= 3) {
    const paints = paintArg ? [paintById(paintArg).id] : phase === 3 && config.paint.locked === null ? config.paint.candidates.map((c) => c.id) : [defaultPaint]
    const specs = paints.flatMap((p) => (phase === 3 ? lookLockSpecs(p) : judgedSpecs(p)))
    const { missing, bad } = stillProblems(specs, hash)
    if (phase >= 4 && specs.length === 0) {
      ok = false
      parts.push('the judged frame table in kit/PROGRESS.md is empty')
    }
    if (missing.length > 0 || bad.length > 0) ok = false
    if (missing.length > 0) parts.push(`${missing.length} stills in scope missing or stale: ${missing.slice(0, 4).join(', ')}`)
    if (bad.length > 0) parts.push(`bad: ${bad.slice(0, 4).join('; ')}`)
    if (missing.length === 0 && bad.length === 0 && specs.length > 0) parts.push(`${specs.length} ${phase === 3 ? 'look lock' : 'judged'} stills clean`)
  }
  return { ok, detail: parts.join('; ') }
}

export async function g6(paint = defaultPaint): Promise<Result> {
  const format = config.formats.preview
  const fps = config.film.fps
  const session = await RenderSession.open({ budgetMinutes: 0 })
  try {
    const frame = async (f: number) => decode((await session.still({ frame: f, tier: 'draft', format, diag: 'beauty', paint })).file)
    const first = await frame(0)
    const wrap = await frame(frameCount)
    const s = ssim(first, wrap)
    const tail = []
    for (let f = frameCount - fps - 1; f <= frameCount - 1; f++) tail.push(await frame(f))
    let largest = 0
    let at = 0
    for (let i = 0; i + 1 < tail.length; i++) {
      const d = meanAbsDiff(tail[i], tail[i + 1])
      if (d > largest) {
        largest = d
        at = frameCount - fps - 1 + i
      }
    }
    const seam = meanAbsDiff(tail[tail.length - 1], first)
    const ok1 = s >= config.quality.loopSeamMinSsim
    const ok2 = seam <= largest
    return {
      ok: ok1 && ok2,
      detail: `SSIM frame 0 to frame ${frameCount} is ${s.toFixed(4)} (at least ${config.quality.loopSeamMinSsim} ${ok1 ? 'holds' : 'fails'}); mean difference frame ${frameCount - 1} to 0 is ${seam.toFixed(3)}, largest neighbor difference in the last second ${largest.toFixed(3)} at ${at} to ${at + 1} (${ok2 ? 'holds' : 'fails'})`,
    }
  } finally {
    await session.close()
  }
}

interface InterfaceResult {
  ok: boolean
  visible: boolean
  detail: string
  elements: string[]
  differingPixels: number
  maxDelta: number
}

export async function g7(paint = defaultPaint): Promise<Result> {
  const path = './proof.ts'
  if (!existsSync(join(repoRoot, 'tools', 'lib', 'proof.ts'))) return { ok: false, detail: 'not built yet: tools/lib/proof.ts has no checkInterface' }
  const mod = (await import(path)) as { checkInterface?: (page: Page) => Promise<InterfaceResult> }
  if (typeof mod.checkInterface !== 'function') return { ok: false, detail: 'not built yet: tools/lib/proof.ts exports no checkInterface' }
  const session = await RenderSession.open({ budgetMinutes: 0 })
  const parts: string[] = []
  let ok = true
  try {
    for (const mode of ['capture', 'autopilot'] as const) {
      const page = await openPage(session.rawBrowser, session.rawHarness, { mode, format: config.formats.preview, paint })
      try {
        if (mode === 'capture') await page.evaluate(() => window.showcase!.renderFrame(0, 'draft'))
        const r = await mod.checkInterface(page)
        if (!r.ok) ok = false
        parts.push(`${mode}: ${r.ok ? 'no interface visible' : `interface visible (${r.elements.join(', ') || 'pixels'}, ${r.differingPixels} pixels differ, max delta ${r.maxDelta})`}${r.detail ? `, ${r.detail}` : ''}`)
      } finally {
        await page.context().close()
      }
    }
  } finally {
    await session.close()
  }
  return { ok, detail: parts.join('; ') }
}

export function g8(): Result {
  const hash = buildHash()
  const file = join(repoRoot, 'out', 'preview.mp4')
  const record = readJson<FilmRecord>(join(repoRoot, 'out', 'preview.json'))
  if (!existsSync(file)) return { ok: false, detail: 'out/preview.mp4 is missing. Run npm run keep' }
  if (!record) return { ok: false, detail: 'out/preview.json is missing. Run npm run keep' }
  if (record.buildHash !== hash) return { ok: false, detail: `out/preview.json is for build ${record.buildHash}, the current build is ${hash}` }
  if (record.format !== config.formats.preview.id) return { ok: false, detail: `out/preview.json is for format ${record.format}` }
  const p = probe(file)
  const bad = verifyProbe(p, config.formats.preview, frameCount)
  if (p.bytes !== record.bytes) bad.push(`file is ${p.bytes} bytes, the record says ${record.bytes}`)
  return { ok: bad.length === 0, detail: bad.length ? bad.join('; ') : `${p.frames} frames at ${p.fps} fps, ${p.width} x ${p.height}, ${megabytes(p.bytes).toFixed(1)} MB, ${record.tier} tier, build ${hash}` }
}

function verifyProbe(p: ReturnType<typeof probe>, format: FormatSpec, count: number): string[] {
  const bad: string[] = []
  if (Math.abs(p.fps - config.film.fps) > 1e-6) bad.push(`ffprobe reports ${p.fps} fps`)
  if (p.frames !== count) bad.push(`ffprobe counts ${p.frames} frames, expected ${count}`)
  if (p.width !== format.width || p.height !== format.height) bad.push(`ffprobe reports ${p.width} x ${p.height}`)
  if (megabytes(p.bytes) >= config.repo.maxFileMb) bad.push(`${megabytes(p.bytes).toFixed(1)} MB, limit ${config.repo.maxFileMb}`)
  return bad
}

interface ProofRecord {
  buildHash: string
  format: string
  tier: string
  frames: number
  fps: number
  width: number
  height: number
  minPsnrAgainstCapture: number
  ok: boolean
  codecProven?: boolean
}

export const minProofPsnr = 30

export function g9(): Result {
  const hash = buildHash()
  const file = join(workDir, 'export', config.export.files.preview)
  const record = readJson<ProofRecord>(file.replace(/\.[a-z0-9]+$/i, '.json'))
  if (!existsSync(file) || !record) return { ok: false, detail: `the Export proof out/work/export/${config.export.files.preview} or its record is missing. Run npm run proof` }
  const bad: string[] = []
  if (record.buildHash !== hash) bad.push(`record is for build ${record.buildHash}, current is ${hash}`)
  if (record.format !== config.formats.preview.id) bad.push(`format ${record.format}`)
  if (record.tier !== 'draft') bad.push(`tier ${record.tier}`)
  const count = Math.round(config.export.proofSeconds * config.film.fps)
  if (record.frames !== count) bad.push(`record holds ${record.frames} frames, expected ${count}`)
  if (!(record.minPsnrAgainstCapture >= minProofPsnr)) bad.push(`lowest PSNR against capture ${record.minPsnrAgainstCapture} dB, needs ${minProofPsnr}`)
  if (!record.ok) bad.push('the proof record is not ok (interface visible or a check failed)')
  bad.push(...verifyProbe(probe(file), config.formats.preview, count))
  return { ok: bad.length === 0, detail: bad.length ? bad.join('; ') : `${count} frames, ${config.formats.preview.width} x ${config.formats.preview.height}, lowest PSNR against capture ${record.minPsnrAgainstCapture.toFixed(1)} dB, no interface, build ${hash}` }
}

export function signProblems(signs: string[]): string[] {
  const allowed = new Set([...config.signage.generic, ...config.signage.invented])
  return [...new Set(signs.filter((s) => !allowed.has(s)))]
}

export async function g11(paint = defaultPaint): Promise<Result> {
  const sources: string[] = []
  const signs: string[] = []
  for (const detail of ['blockout', 'full'] as const) {
    try {
      const world = await createWorld({ detail })
      signs.push(...world.signs)
      sources.push(`${detail} world in Node: ${world.signs.length}`)
    } catch (error) {
      sources.push(`${detail} world could not be built in Node (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`)
    }
  }
  const session = await RenderSession.open({ budgetMinutes: 0 })
  try {
    const page = await session.pageFor({ frame: 0, tier: 'draft', format: config.formats.preview, diag: 'beauty', paint })
    const fromPage = await page.evaluate(() => (window.showcase as unknown as { signs?: () => string[] }).signs?.() ?? null)
    if (fromPage === null) sources.push('page: no signs() on window.showcase')
    else {
      signs.push(...fromPage)
      sources.push(`page: ${fromPage.length}`)
    }
  } finally {
    await session.close()
  }
  const bad = signProblems(signs)
  return { ok: bad.length === 0, detail: `${bad.length ? `not in signage: ${bad.map((s) => `"${s}"`).join(', ')}` : `${new Set(signs).size} distinct sign strings, all in signage`} (${sources.join('; ')})` }
}
