import { join } from 'node:path'
import { args, config, distDir, ensureBuild, renderLock, workDir, writeJson } from './lib/env.ts'
import { grabCanvas, launchBrowser, openPage } from './lib/browser.ts'
import { startHarness } from './lib/server.ts'

async function main(): Promise<void> {
  const a = args()
  const samples = Number(a.samples ?? 6)
  const frame = Number(a.frame ?? Math.round(config.film.heroFrameSeconds * config.film.fps))
  const buildHash = ensureBuild()
  await renderLock()
  const harness = await startHarness(distDir)
  harness.sumPath = join(workDir, 'measure.sum')
  const result: Record<string, unknown> = { buildHash, frame }
  let t = Date.now()
  const browser = await launchBrowser()
  result.browserLaunchSeconds = (Date.now() - t) / 1000
  for (const format of Object.values(config.formats)) {
    t = Date.now()
    const page = await openPage(browser, harness, { mode: 'capture', format })
    const pageReady = (Date.now() - t) / 1000
    t = Date.now()
    await page.evaluate((f) => window.showcase!.beginFrame(f, 'final'), frame)
    await page.evaluate(() => window.showcase!.addSamples(1))
    const firstSample = (Date.now() - t) / 1000
    t = Date.now()
    await page.evaluate((n) => window.showcase!.addSamples(n), samples)
    const perSample = (Date.now() - t) / 1000 / samples
    t = Date.now()
    await page.evaluate(() => window.showcase!.saveSum())
    const saveSum = (Date.now() - t) / 1000
    t = Date.now()
    await page.evaluate(() => window.showcase!.loadSum())
    const loadSum = (Date.now() - t) / 1000
    t = Date.now()
    await page.evaluate(() => window.showcase!.finishFrame())
    await grabCanvas(page, harness)
    const finishAndGrab = (Date.now() - t) / 1000
    result[format.id] = { pageReady, firstSample, perSample, saveSum, loadSum, finishAndGrab }
    await page.context().close()
  }
  await browser.close()
  await harness.close()
  writeJson(join(workDir, 'measure.json'), result)
  console.log(JSON.stringify(result, null, 2))
  process.exit(0)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
