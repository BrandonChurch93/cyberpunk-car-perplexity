import { paintById, defaultPaint, formatById, isTier } from '../src/config.ts'
import { args, config } from './lib/env.ts'
import { RenderSession, runTool } from './lib/render.ts'
import { buildSheet } from './lib/sheet.ts'

void runTool(async () => {
  const a = args()
  const tier = a.tier ?? 'draft'
  if (!isTier(tier)) throw new Error(`unknown tier ${tier}`)
  const beats = a.beat === 'all' || a.beat === undefined ? [...config.beats.map((b) => b.id), 'seam'] : a.beat.split(',')
  const session = await RenderSession.open({ budgetMinutes: a.budget !== undefined ? Number(a.budget) : undefined })
  try {
    for (const beat of beats) {
      const { file, reused } = await buildSheet(session, { beat, tier, format: a.format ? formatById(a.format) : config.formats.master, paint: paintById(a.paint ?? defaultPaint).id, diag: a.diag ?? 'beauty' })
      console.log(`${reused ? 'reused' : 'built'} ${file}`)
    }
    return 0
  } finally {
    await session.close()
  }
})
