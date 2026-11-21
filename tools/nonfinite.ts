import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { args, ensureDir, workDir } from './lib/env.ts'
import { RenderSession, runTool, specFromArgs, stillName } from './lib/render.ts'

void runTool(async () => {
  const a = args()
  const spec = specFromArgs(a)
  const samples = Number(a.samples ?? 1)
  const session = await RenderSession.open({ budgetMinutes: 0 })
  try {
    const page = await session.pageFor(spec)
    const sumPath = join(ensureDir(join(workDir, 'sums')), `${stillName(spec)}.probe.sum`)
    session.rawHarness.sumPath = sumPath
    await page.evaluate(([f, t]) => window.showcase!.beginFrame(f as number, t as string), [spec.frame, spec.tier] as const)
    for (let i = 0; i < samples; ++i) await page.evaluate(() => window.showcase!.addSamples(1))
    await page.evaluate(() => window.showcase!.saveSum())
    session.rawHarness.sumPath = null
    const bytes = readFileSync(sumPath)
    const data = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
    const { width, height } = spec.format
    const channels = data.length / (width * height)
    const found: string[] = []
    let total = 0
    for (let y = 0; y < height; ++y) {
      for (let x = 0; x < width; ++x) {
        const i = (y * width + x) * channels
        if (Number.isFinite(data[i]) && Number.isFinite(data[i + 1]) && Number.isFinite(data[i + 2])) continue
        ++total
        if (found.length < 64) found.push(`${x},${height - 1 - y} [${data[i]}, ${data[i + 1]}, ${data[i + 2]}]`)
      }
    }
    console.log(`${stillName(spec)}: ${total} non-finite pixels after ${samples} sample(s), ${channels} channels, x,y from the top left`)
    for (const line of found) console.log(line)
    return total === 0 ? 0 : 2
  } finally {
    await session.close()
  }
})
