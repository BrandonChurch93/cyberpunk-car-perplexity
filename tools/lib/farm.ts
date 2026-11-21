import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { formatById, type FormatSpec, type TierId } from '../../src/config.ts'
import type { StageDetail } from '../../src/core/detail.ts'
import { config, readJson, workDir, writeJson } from './env.ts'
import { bundleGroups, bundleLimitBytes } from './film.ts'
import type { JudgedFrame } from './judged.ts'
import { stillName, type StillRecord, type StillSpec } from './render.ts'

export interface FarmJob {
  name: string
  tier?: TierId
  frame: number
  format: string
  diag: string
  why: string
}

export interface FarmPlan {
  phase: number
  tier: TierId
  paint: string
  detail: StageDetail
  buildHash: string
  jobs: FarmJob[]
}

export interface FarmBundle {
  buildHash: string
  phase: number
  shard: string
  tier: TierId
  paint: string
  detail: StageDetail
  stills: string[]
  plan: string[]
}

export const farmDir = (): string => join(workDir, 'farm')
export const stillsDir = (): string => join(workDir, 'stills')

export function jobSpec(job: FarmJob, plan: Pick<FarmPlan, 'tier' | 'paint' | 'detail'>): StillSpec {
  return { frame: job.frame, tier: job.tier ?? plan.tier, format: formatById(job.format), diag: job.diag, paint: plan.paint, detail: plan.detail }
}

/** The final tier stills the phase packs ask for: every judged frame wide, the vertical ones tall, and the plain gray and stripe views of each judged frame with a vehicle anchor crop. */
export function farmJobs(phase: number, judged: JudgedFrame[], withVehicle: Set<number>, angleFrames: number[], base: Pick<FarmPlan, 'tier' | 'paint' | 'detail'>): FarmJob[] {
  const master = config.formats.master
  const vertical = config.formats.vertical
  const job = (frame: number, format: FormatSpec, diag: string, why: string): FarmJob => ({ name: stillName({ frame, format, diag, tier: base.tier, paint: base.paint, detail: base.detail }), frame, format: format.id, diag, why })
  const out: FarmJob[] = []
  for (const j of judged) out.push(job(j.frame, master, 'beauty', 'judged'))
  for (const j of judged) if (j.vertical) out.push(job(j.frame, vertical, 'beauty', 'judged, vertical'))
  const views = judged.filter((j) => withVehicle.has(j.frame)).map((j) => j.frame)
  if (phase === 3) for (const f of angleFrames) if (!views.includes(f)) views.push(f)
  for (const diag of ['clay', 'zebra']) for (const f of views) out.push(job(f, master, diag, `C4 ${diag}`))
  const seen = new Set<string>()
  return out.filter((j) => (seen.has(j.name) ? false : (seen.add(j.name), true)))
}

export interface ReviewFrames {
  wide: number[]
  hook: number[]
}

/** The review tier stills of the Phase 4 contact sheets, event runs and phone previews. With a tier override every job takes that tier. */
export function reviewJobs(frames: ReviewFrames, base: Pick<FarmPlan, 'tier' | 'paint' | 'detail'>, known: FarmJob[]): FarmJob[] {
  const tier: TierId = base.tier === 'final' ? 'review' : base.tier
  const seen = new Set(known.map((j) => j.name))
  const out: FarmJob[] = []
  const add = (frame: number, format: FormatSpec, why: string): void => {
    const name = stillName({ frame, format, diag: 'beauty', tier, paint: base.paint, detail: base.detail })
    if (seen.has(name)) return
    seen.add(name)
    out.push({ name, tier, frame, format: format.id, diag: 'beauty', why })
  }
  for (const f of [...new Set(frames.wide)].sort((a, b) => a - b)) add(f, config.formats.master, 'sheet or run cell')
  for (const format of [config.formats.master, config.formats.vertical]) for (const f of frames.hook) add(f, format, 'phone preview')
  return out
}

/** Job k of the plan goes to shard (k mod n) + 1, so every shard gets a mix of formats and views. */
export function shardJobs<T>(jobs: T[], spec: string): T[] {
  const m = /^(\d+)\/(\d+)$/.exec(spec)
  if (!m) throw new Error(`shard ${spec} must look like 2/5`)
  const i = Number(m[1])
  const n = Number(m[2])
  if (n < 1 || i < 1 || i > n) throw new Error(`shard ${spec} needs 1 <= i <= n`)
  return jobs.filter((_, k) => k % n === i - 1)
}

export function bundleStills(names: string[], record: Omit<FarmBundle, 'stills'>, label: string): string[] {
  const dir = stillsDir()
  const sizes = names.map((name, frame) => ({ frame, bytes: statSync(join(dir, `${name}.png`)).size + statSync(join(dir, `${name}.json`)).size + 1024 }))
  const groups = bundleGroups(sizes, bundleLimitBytes() - 256 * 1024)
  const outDir = farmDir()
  mkdirSync(outDir, { recursive: true })
  const stage = join(outDir, '.stage')
  return groups.map((group, g) => {
    const file = join(outDir, `${label}-${String(g + 1).padStart(2, '0')}-of-${String(groups.length).padStart(2, '0')}.tar`)
    const stills = group.map((k) => names[k])
    rmSync(stage, { recursive: true, force: true })
    mkdirSync(stage)
    writeJson(join(stage, 'bundle.json'), { ...record, stills })
    execFileSync('tar', ['-cf', file, '-C', stage, 'bundle.json', '-C', dir, ...stills.flatMap((s) => [`${s}.png`, `${s}.json`])])
    rmSync(stage, { recursive: true, force: true })
    return file
  })
}

export interface Unbundled {
  file: string
  bundle: FarmBundle
  added: string[]
  same: string[]
  differing: string[]
  stale: string[]
}

/** Unpack into out/work/stills. A still that is already there is compared byte for byte; one whose record names another build is refused. */
export function unbundleStills(files: string[], buildHash: string): Unbundled[] {
  const dir = stillsDir()
  mkdirSync(dir, { recursive: true })
  return files.map((file) => {
    const bundle = JSON.parse(execFileSync('tar', ['-xOf', file, 'bundle.json'], { encoding: 'utf8' })) as FarmBundle
    const temp = join(farmDir(), '.unbundle')
    rmSync(temp, { recursive: true, force: true })
    mkdirSync(temp, { recursive: true })
    execFileSync('tar', ['-xf', file, '-C', temp, '--exclude', 'bundle.json'])
    const out: Unbundled = { file, bundle, added: [], same: [], differing: [], stale: [] }
    for (const name of bundle.stills) {
      const record = readJson<StillRecord>(join(temp, `${name}.json`))
      if (!record || record.buildHash !== buildHash) {
        out.stale.push(name)
        continue
      }
      const png = join(dir, `${name}.png`)
      if (existsSync(png)) {
        if (readFileSync(png).equals(readFileSync(join(temp, `${name}.png`)))) out.same.push(name)
        else out.differing.push(name)
        continue
      }
      renameSync(join(temp, `${name}.json`), join(dir, `${name}.json`))
      renameSync(join(temp, `${name}.png`), png)
      out.added.push(name)
    }
    rmSync(temp, { recursive: true, force: true })
    return out
  })
}

export function missingStills(names: string[], buildHash: string): string[] {
  return names.filter((n) => {
    const r = readJson<StillRecord>(join(stillsDir(), `${n}.json`))
    return !r || r.buildHash !== buildHash || !existsSync(join(stillsDir(), `${n}.png`))
  })
}
