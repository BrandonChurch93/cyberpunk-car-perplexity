import { readdirSync, rmSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defaultPaint, isTier, paintById } from '../src/config.ts'
import { args, buildHash, ensureBuild, readJson, repoRoot, workDir, writeJson } from './lib/env.ts'
import { roundName } from './lib/pack.ts'
import { PackContext, packTable, writePack, type KeyEntry } from './lib/pack-build.ts'
import { detailFrom, runTool } from './lib/render.ts'

interface RoundKey {
  round: number
  phase: number
  paint: string
  detail: string
  tier: string
  buildHash: string
  critics: Record<string, { folder: string; files: Record<string, KeyEntry> }>
}

void runTool(async () => {
  const a = args()
  const phase = Number(a.phase)
  const round = Number(a.round)
  if (!Number.isInteger(round) || round < 1) throw new Error('--round must be a whole number of at least 1')
  const table = packTable[phase]
  if (!table) throw new Error(`no packs are defined for phase ${a.phase}. Phases with packs: ${Object.keys(packTable).join(', ')}`)
  const paint = paintById(a.paint ?? defaultPaint).id
  const detail = detailFrom(a.detail)
  const tier = a.tier
  if (tier !== undefined && !isTier(tier)) throw new Error(`unknown tier ${tier}`)
  const wanted = a.critic ? a.critic.toUpperCase().split(',') : Object.keys(table)
  for (const c of wanted) if (!table[c]) throw new Error(`phase ${phase} has no pack for ${c}. It packs for ${Object.keys(table).join(', ')}`)

  ensureBuild()
  const hash = buildHash()
  const keyPath = join(workDir, 'packs', 'keys', `${roundName(round)}.json`)
  const roundDir = join(workDir, 'packs', roundName(round))
  const previous = readJson<RoundKey>(keyPath)
  const merge = a.critic !== undefined && previous !== null && previous.phase === phase && previous.paint === paint && previous.detail === detail && previous.tier === (tier ?? 'as the brief asks') && previous.buildHash === hash
  if (!merge) rmSync(roundDir, { recursive: true, force: true })
  const key: RoundKey = merge ? previous : { round, phase, paint, detail, tier: tier ?? 'as the brief asks', buildHash: hash, critics: {} }

  const ctx = new PackContext(phase, round, paint, hash, a.budget !== undefined ? Number(a.budget) : undefined, tier)
  try {
    for (const critic of wanted) {
      const pack = await table[critic](ctx)
      const { dir, files, key: entries } = await writePack(ctx, pack)
      key.critics[critic] = { folder: pack.folder, files: entries }
      writeJson(keyPath, key)
      console.log(`${critic}: ${files.length} files in ${relative(repoRoot, dir)}`)
    }
  } finally {
    await ctx.close()
  }
  console.log(`key: ${relative(repoRoot, keyPath)} (${detail} detail, ${tier ? `${tier} tier for every image` : 'tiers as the briefs ask'}, build ${hash})`)
  for (const folder of readdirSync(roundDir).sort()) {
    const dir = join(roundDir, folder)
    for (const f of readdirSync(dir).sort()) console.log(`  ${folder}/${f}  ${(statSync(join(dir, f)).size / 1024).toFixed(0)} KB`)
  }
  return 0
})
