import { args } from './lib/env.ts'
import { buildCrops } from './lib/crops.ts'
import { RenderSession, runTool, specFromArgs } from './lib/render.ts'

void runTool(async () => {
  const a = args()
  const spec = specFromArgs(a)
  const session = await RenderSession.open({ budgetMinutes: a.budget !== undefined ? Number(a.budget) : undefined })
  try {
    const { dir, manifest, reused } = await buildCrops(session, spec)
    console.log(`${reused ? 'reused' : 'built'} ${manifest.crops.length} crops in ${dir}`)
    for (const c of manifest.crops) console.log(`${c.file}  ${c.rect.width} x ${c.rect.height} at ${c.rect.left},${c.rect.top}  on ${c.on.join(', ')}  (${c.note})`)
    return 0
  } finally {
    await session.close()
  }
})
