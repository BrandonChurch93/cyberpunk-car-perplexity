import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { frameCount } from '../src/config.ts'
import { args, config, ensureDir, workDir, writeJson } from './lib/env.ts'
import { decode, identical } from './lib/image.ts'
import { RenderSession, runTool, specFromArgs, stillName, type StillSpec } from './lib/render.ts'
import { grabCanvas } from './lib/browser.ts'

void runTool(async () => {
  const a = args()
  const base = specFromArgs(a, { tier: 'review', format: config.formats.preview })
  const fps = config.film.fps
  const frames = a.frames
    ? a.frames.split(',').map(Number)
    : [0, Math.round(config.film.heroFrameSeconds * fps), Math.round(config.film.macroFrameSeconds * fps), Math.round(0.72 * frameCount), frameCount - 1]
  const dir = ensureDir(join(workDir, 'determinism'))
  const session = await RenderSession.open({ budgetMinutes: 0 })
  const lines: string[] = []
  let failed = 0
  const check = (label: string, ok: boolean, detail: string): void => {
    lines.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
    console.log(lines[lines.length - 1])
    if (!ok) failed++
  }
  try {
    const spec = (frame: number): StillSpec => ({ ...base, frame })
    const file = (pass: string, frame: number): string => join(dir, `${pass}-${stillName(spec(frame))}.png`)

    await session.freshPage(base.format, base.diag, base.paint)
    for (const f of frames) await session.renderTo(spec(f), file('a', f), { force: true })

    await session.freshPage(base.format, base.diag, base.paint)
    for (const f of [...frames].reverse()) await session.renderTo(spec(f), file('b', f), { force: true })

    for (const f of frames) {
      const r = identical(await decode(file('a', f)), await decode(file('b', f)))
      check(`frame ${f}: fresh page loads and a different order`, r.same, r.same ? '' : `${r.differing} pixels differ, largest step ${r.maxDelta}`)
    }

    const chunkFrame = frames[1] ?? frames[0]
    const total = config.tiers[base.tier].samplesPerFrame
    const harness = session.rawHarness
    const sumPath = join(dir, 'chunk.sum')
    harness.sumPath = sumPath
    const first = Math.max(1, Math.floor(total / 3))
    let page = await session.freshPage(base.format, base.diag, base.paint)
    await page.evaluate(([f, t]) => window.showcase!.beginFrame(f as number, t as string), [chunkFrame, base.tier] as const)
    let have = await page.evaluate((n) => window.showcase!.addSamples(n), first)
    await page.evaluate(() => window.showcase!.saveSum())
    let loads = 1
    while (have < total) {
      page = await session.freshPage(base.format, base.diag, base.paint)
      await page.evaluate(([f, t]) => window.showcase!.beginFrame(f as number, t as string), [chunkFrame, base.tier] as const)
      await page.evaluate(() => window.showcase!.loadSum())
      have = await page.evaluate((n) => window.showcase!.addSamples(n), Math.max(1, Math.ceil((total - first) / 2)))
      await page.evaluate(() => window.showcase!.saveSum())
      loads++
    }
    await page.evaluate(() => window.showcase!.finishFrame())
    const chunked = await decode(await grabCanvas(page, harness))
    harness.sumPath = null
    rmSync(sumPath, { force: true })
    rmSync(sumPath + '.count', { force: true })
    const r = identical(await decode(file('a', chunkFrame)), chunked)
    check(`frame ${chunkFrame}: samples added in chunks across ${loads} page loads`, r.same || total === 1, total === 1 ? 'the tier has one sample, so the chunk test only reloads the sum' : r.same ? '' : `${r.differing} pixels differ, largest step ${r.maxDelta}`)

  } finally {
    await session.close()
  }
  writeJson(join(dir, 'result.json'), { buildHash: session.buildHash, format: base.format.id, tier: base.tier, paint: base.paint, diagnostic: base.diag, frames, pass: failed === 0, lines })
  console.log(failed === 0 ? 'DETERMINISM PASS' : `DETERMINISM FAIL: ${failed} check(s)`)
  return failed === 0 ? 0 : 2
})
