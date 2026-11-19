import { args } from './lib/env.ts'
import { RenderSession, runTool, specFromArgs } from './lib/render.ts'

void runTool(async () => {
  const a = args()
  const spec = specFromArgs(a)
  const session = await RenderSession.open({ budgetMinutes: a.budget !== undefined ? Number(a.budget) : undefined })
  try {
    const { file, record, reused } = await session.still(spec, { force: a.force === 'true' })
    console.log(`${reused ? 'reused' : 'rendered'} ${file}`)
    console.log(`${record.width} x ${record.height}, ${record.samples} samples, ${record.detail} detail, ${record.seconds} s, build ${record.buildHash}`)
    if (!record.check.ok) {
      console.log(`CHECK FAILED: blank ${record.check.blank}, flat ${record.check.flat}, invalid pixels ${record.check.invalidPixels}`)
      return 2
    }
    return 0
  } finally {
    await session.close()
  }
})
