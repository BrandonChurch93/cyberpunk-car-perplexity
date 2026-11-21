import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { defaultPaint, isTier, paintById, type TierId } from '../src/config.ts'
import { planCrops } from './lib/crops.ts'
import { args, buildHash, config, ensureBuild, readJson, repoRoot, writeJson } from './lib/env.ts'
import { bundleStills, farmDir, farmJobs, jobSpec, missingStills, reviewJobs, shardJobs, unbundleStills, type FarmPlan } from './lib/farm.ts'
import { eventRuns, hookFrames } from './lib/pack.ts'
import { sheetFrames } from './lib/sheet.ts'
import { PackContext, zebraAngleFrames } from './lib/pack-build.ts'
import { detailFrom, RenderSession, runTool } from './lib/render.ts'
import { cameraForFrame, extraCropPoints, sceneAnchors } from './lib/scene.ts'

const help = `npm run farm -- --phase P --shard i/n [--review] [--tier final] [--paint id] [--detail full] [--budget minutes] [--list]
  Renders shard i of n of the stills the phase packs need at the tier (with --review also the review
  tier cells of the Phase 4 contact sheets, event runs and phone previews), then writes
  out/work/farm/farm-pP-<tier>-iofn-NN-of-MM.tar. Exit 75 with CONTINUE means the budget ran out:
  run the same command again, it keeps finished stills and continues a still from its saved samples.
npm run farm -- --unbundle <folder or a.tar,b.tar>
  Unpacks into out/work/stills, compares any still already there byte for byte, refuses another build
  and lists what the plan still misses. Then npm run pack reuses every unpacked still.`

async function makePlan(session: RenderSession, phase: number, tier: TierId, paint: string, detail: ReturnType<typeof detailFrom>, review: boolean): Promise<FarmPlan> {
  const path = join(farmDir(), `plan-p${phase}-${tier}-${paint}-${detail}${review ? '-review' : ''}.json`)
  const old = readJson<FarmPlan>(path)
  if (old && old.buildHash === session.buildHash) return old
  const master = config.formats.master
  const ctx = new PackContext(phase, 0, paint, session.buildHash, 0)
  const judged = ctx.judged()
  const page = await session.pageFor({ frame: 0, tier, format: master, diag: 'beauty', paint, detail })
  const { anchors } = await sceneAnchors(page, paint)
  const extra = await extraCropPoints()
  const withVehicle = new Set(judged.filter((j) => planCrops(cameraForFrame(j.frame, master, anchors), master, anchors, extra).some((c) => c.kind === 'anchor')).map((j) => j.frame))
  const jobs = farmJobs(phase, judged, withVehicle, zebraAngleFrames, { tier, paint, detail })
  if (review) {
    const wide = [...[...config.beats.map((b) => b.id), 'seam'].flatMap((b) => sheetFrames(b)), ...eventRuns().flatMap((r) => r.frames)]
    jobs.push(...reviewJobs({ wide, hook: hookFrames() }, { tier, paint, detail }, jobs))
  }
  const plan: FarmPlan = { phase, tier, paint, detail, buildHash: session.buildHash, jobs }
  writeJson(path, plan)
  return plan
}

void runTool(async () => {
  const a = args()
  if (a.help === 'true') {
    console.log(help)
    return 0
  }
  if (a.unbundle !== undefined) {
    const list = existsSync(a.unbundle) && statSync(a.unbundle).isDirectory() ? readdirSync(a.unbundle).filter((n) => n.endsWith('.tar')).sort().map((n) => join(a.unbundle, n)) : a.unbundle.split(',')
    if (list.length === 0) throw new Error(`no tar files in ${a.unbundle}`)
    ensureBuild()
    const hash = buildHash()
    const plan = new Set<string>()
    let bad = 0
    for (const u of unbundleStills(list, hash)) {
      u.bundle.plan.forEach((n) => plan.add(n))
      console.log(`${basename(u.file)} (shard ${u.bundle.shard}): ${u.added.length} added, ${u.same.length} already here and identical`)
      for (const n of u.differing) console.log(`DIFFERS ${n}: the copy here and the bundled copy are not the same bytes`)
      for (const n of u.stale) console.log(`STALE ${n}: rendered on build ${u.bundle.buildHash}, this checkout is ${hash}`)
      bad += u.differing.length + u.stale.length
    }
    const missing = missingStills([...plan], hash)
    console.log(`${plan.size - missing.length} of ${plan.size} planned stills present for build ${hash}`)
    for (const n of missing) console.log(`MISSING ${n}`)
    return bad > 0 ? 1 : missing.length > 0 ? 2 : 0
  }
  const phase = Number(a.phase)
  if (!Number.isInteger(phase) || phase < 2) throw new Error('--phase must be a whole number of at least 2')
  const tier = a.tier ?? 'final'
  if (!isTier(tier)) throw new Error(`unknown tier ${tier}`)
  const paint = paintById(a.paint ?? defaultPaint).id
  const detail = detailFrom(a.detail)
  const session = await RenderSession.open({ budgetMinutes: a.budget !== undefined ? Number(a.budget) : undefined })
  try {
    if (a.review === 'true' && phase < 4) throw new Error('--review adds the contact sheet, run and phone stills, which only Phase 4 packs ask for')
    const plan = await makePlan(session, phase, tier, paint, detail, a.review === 'true')
    if (a.list === 'true' || !a.shard) {
      const n = a.shard ? Number(a.shard.split('/')[1]) : 1
      plan.jobs.forEach((j, k) => console.log(`${String(k + 1).padStart(3)} shard ${(k % n) + 1}/${n}  ${j.name}  (${j.why})`))
      console.log(`${plan.jobs.length} stills, build ${plan.buildHash}`)
      return 0
    }
    const pageKey = (j: { format: string; diag: string }): string => `${j.format}|${j.diag}`
    // Final stills first, so a shard that is stopped early has the judged set.
    const rank = (j: { tier?: string }): number => (j.tier && j.tier !== tier ? 1 : 0)
    const mine = shardJobs(plan.jobs, a.shard).sort((x, y) => rank(x) - rank(y) || pageKey(x).localeCompare(pageKey(y)) || x.frame - y.frame)
    console.log(`shard ${a.shard}: ${mine.length} of ${plan.jobs.length} stills at ${tier}, ${paint}, ${detail}, build ${plan.buildHash}`)
    for (const job of mine) {
      const { file, record, reused } = await session.still(jobSpec(job, plan))
      console.log(`${reused ? 'reused' : 'rendered'} ${relative(repoRoot, file)}: ${record.samples} samples, ${record.seconds} s${record.check.ok ? '' : `, CHECK FAILED (blank ${record.check.blank}, flat ${record.check.flat}, invalid ${record.check.invalidPixels})`}`)
    }
    const label = `farm-p${phase}-${tier}-${a.shard.replace('/', 'of')}`
    const tars = bundleStills(mine.map((j) => j.name), { buildHash: plan.buildHash, phase, shard: a.shard, tier, paint, detail, plan: plan.jobs.map((j) => j.name) }, label)
    for (const t of tars) console.log(`bundled ${relative(repoRoot, t)}: ${(statSync(t).size / 1048576).toFixed(1)} MB`)
    return 0
  } finally {
    await session.close()
  }
})
