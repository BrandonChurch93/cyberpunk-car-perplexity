import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { formatById, isTier, paintById, defaultPaint, frameCount, type FormatSpec, type TierId } from '../../src/config.ts'
import { diagnosticViews } from '../../src/diagnostics/views.ts'
import type { StageDetail } from '../../src/core/detail.ts'
import { detailFrom } from './detail.ts'

export { detailFrom }
import { config, distDir, ensureBuild, ensureDir, readJson, renderLock, workDir, writeJson } from './env.ts'
import { startHarness, type Harness } from './server.ts'
import { grabCanvas, launchBrowser, openPage, pageProblems } from './browser.ts'
import { checkFrame, decode, type FrameCheck } from './image.ts'

export interface StillSpec {
  frame: number
  tier: TierId
  format: FormatSpec
  diag: string
  paint: string
  /** Unset means the detail asked for by SHOWCASE_DETAIL or the build default. */
  detail?: StageDetail
}


export function detailOf(spec: Pick<StillSpec, 'detail'>): StageDetail {
  return spec.detail ?? detailFrom()
}

export interface StillRecord {
  buildHash: string
  format: string
  tier: string
  paint: string
  diagnostic: string
  detail: StageDetail
  frame: number
  samples: number
  width: number
  height: number
  check: FrameCheck
  seconds: number
}

export class OutOfBudget extends Error {
  constructor(message: string) {
    super(message)
  }
}

export function specFromArgs(a: Record<string, string>, defaults: Partial<StillSpec> = {}): StillSpec {
  const tier = a.tier ?? defaults.tier ?? 'draft'
  if (!isTier(tier)) throw new Error(`unknown tier ${tier}`)
  const diag = a.diag ?? defaults.diag ?? 'beauty'
  if (!diagnosticViews.includes(diag)) throw new Error(`unknown diagnostic view ${diag}`)
  const frame = a.frame !== undefined ? Number(a.frame) : defaults.frame ?? 0
  if (!Number.isInteger(frame) || frame < 0 || frame > frameCount) throw new Error(`frame ${a.frame} is outside 0 to ${frameCount}`)
  return {
    frame,
    tier,
    format: a.format ? formatById(a.format) : defaults.format ?? config.formats.master,
    diag,
    paint: paintById(a.paint ?? defaults.paint ?? defaultPaint).id,
    detail: detailFrom(a.detail ?? defaults.detail),
  }
}

export function stillName(spec: StillSpec): string {
  return `f${String(spec.frame).padStart(5, '0')}-${spec.format.id}-${spec.tier}-${spec.diag}-${spec.paint}-${detailOf(spec)}`
}

export function recordMatches(record: StillRecord | null, spec: StillSpec, buildHash: string): record is StillRecord {
  return (
    record !== null &&
    record.buildHash === buildHash &&
    record.format === spec.format.id &&
    record.tier === spec.tier &&
    record.paint === spec.paint &&
    record.diagnostic === spec.diag &&
    record.detail === detailOf(spec) &&
    record.frame === spec.frame
  )
}

export interface SessionOptions {
  budgetMinutes?: number
  root?: string
  prefix?: string
  build?: boolean
}

export class RenderSession {
  buildHash = ''
  private harness!: Harness
  private browser!: Browser
  private page: Page | null = null
  private pageKey = ''
  private release: (() => void) | null = null
  private deadline = Infinity
  readonly started = Date.now()

  static async open(options: SessionOptions = {}): Promise<RenderSession> {
    const s = new RenderSession()
    s.buildHash = options.build === false ? '' : ensureBuild()
    s.release = await renderLock()
    s.harness = await startHarness(options.root ?? distDir, options.prefix ?? '/')
    s.browser = await launchBrowser()
    const budget = options.budgetMinutes ?? config.sandbox.chunkBudgetMinutes
    if (budget > 0) s.deadline = Date.now() + budget * 60_000
    return s
  }

  get harnessUrl(): string {
    return this.harness.url
  }

  get rawBrowser(): Browser {
    return this.browser
  }

  get rawHarness(): Harness {
    return this.harness
  }

  timeLeftMs(): number {
    return this.deadline - Date.now()
  }

  async freshPage(format: FormatSpec, diag: string, paint: string, detail: StageDetail = detailFrom()): Promise<Page> {
    if (this.page) await this.page.context().close()
    this.page = await openPage(this.browser, this.harness, { mode: 'capture', format, diag, paint, detail })
    this.pageKey = `${format.id}|${diag}|${paint}|${detail}`
    const info = await this.page.evaluate(() => window.showcase!.info())
    if (this.buildHash && info.buildHash !== this.buildHash) {
      throw new Error(`the page reports build ${info.buildHash}, the harness expected ${this.buildHash}`)
    }
    return this.page
  }

  async pageFor(spec: StillSpec): Promise<Page> {
    const key = `${spec.format.id}|${spec.diag}|${spec.paint}|${detailOf(spec)}`
    if (this.page && this.pageKey === key) return this.page
    return this.freshPage(spec.format, spec.diag, spec.paint, detailOf(spec))
  }

  async renderTo(spec: StillSpec, file: string, options: { force?: boolean; fresh?: boolean; sumEvery?: number } = {}): Promise<{ record: StillRecord; reused: boolean }> {
    const recordPath = file.replace(/\.png$/, '.json')
    const existing = readJson<StillRecord>(recordPath)
    if (!options.force && existsSync(file) && recordMatches(existing, spec, this.buildHash)) return { record: existing, reused: true }
    const sumPath = join(ensureDir(join(workDir, 'sums')), `${stillName(spec)}.sum`)
    const sumRecordPath = sumPath + '.json'
    const total = config.tiers[spec.tier].samplesPerFrame
    const page = options.fresh ? await this.freshPage(spec.format, spec.diag, spec.paint, detailOf(spec)) : await this.pageFor(spec)
    const t0 = Date.now()
    this.harness.sumPath = sumPath
    await page.evaluate(([f, t]) => window.showcase!.beginFrame(f as number, t as string), [spec.frame, spec.tier] as const)
    let have = 0
    let spent = 0
    const partial = readJson<{ buildHash: string; name: string; count: number; seconds: number }>(sumRecordPath)
    if (partial && partial.buildHash === this.buildHash && partial.name === stillName(spec) && existsSync(sumPath)) {
      await page.evaluate(() => window.showcase!.loadSum())
      have = partial.count
      spent = partial.seconds
    }
    let perSample = 0
    let lastSave = Date.now()
    while (have < total) {
      const s0 = Date.now()
      have = await page.evaluate(() => window.showcase!.addSamples(1))
      perSample = Math.max(perSample, Date.now() - s0)
      const save = async (): Promise<void> => {
        await page.evaluate(() => window.showcase!.saveSum())
        writeJson(sumRecordPath, { buildHash: this.buildHash, name: stillName(spec), count: have, seconds: spent + (Date.now() - t0) / 1000 })
        lastSave = Date.now()
      }
      if (have < total && this.timeLeftMs() < perSample * 1.5 + 20_000) {
        await save()
        throw new OutOfBudget(`${stillName(spec)} holds ${have} of ${total} samples. Run the command again to continue.`)
      }
      if (have < total && Date.now() - lastSave > 120_000) await save()
    }
    await page.evaluate(() => window.showcase!.finishFrame())
    const png = await grabCanvas(page, this.harness)
    const problems = pageProblems(page)
    if (problems.length > 0) throw new Error(`the page reported errors: ${problems.join(' | ')}`)
    const raw = await decode(png)
    const record: StillRecord = {
      buildHash: this.buildHash,
      format: spec.format.id,
      tier: spec.tier,
      paint: spec.paint,
      diagnostic: spec.diag,
      detail: detailOf(spec),
      frame: spec.frame,
      samples: total,
      width: raw.width,
      height: raw.height,
      check: checkFrame(raw),
      seconds: Math.round((spent + (Date.now() - t0) / 1000) * 10) / 10,
    }
    writeFileSync(file, png)
    writeJson(recordPath, record)
    rmSync(sumPath, { force: true })
    rmSync(sumPath + '.count', { force: true })
    rmSync(sumRecordPath, { force: true })
    this.harness.sumPath = null
    return { record, reused: false }
  }

  async still(spec: StillSpec, options: { force?: boolean; fresh?: boolean } = {}): Promise<{ file: string; record: StillRecord; reused: boolean }> {
    const file = join(ensureDir(join(workDir, 'stills')), `${stillName(spec)}.png`)
    return { file, ...(await this.renderTo(spec, file, options)) }
  }

  async close(): Promise<void> {
    if (this.page) await this.page.context().close().catch(() => undefined)
    await this.browser.close().catch(() => undefined)
    await this.harness.close()
    this.release?.()
  }
}

export async function runTool(main: () => Promise<number | void>): Promise<void> {
  try {
    const code = await main()
    process.exit(code ?? 0)
  } catch (error) {
    if (error instanceof OutOfBudget) {
      console.log(`CONTINUE: ${error.message}`)
      process.exit(75)
    }
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exit(1)
  }
}
