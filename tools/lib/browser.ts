import { chromium, type Browser, type Page } from 'playwright'
import { config } from './env.ts'
import type { Harness } from './server.ts'
import type { FormatSpec } from '../../src/config.ts'

export const driverTimeoutMs = (config.sandbox.stepTimeoutMinutes + config.sandbox.chunkBudgetMinutes) * 60_000

export async function launchBrowser(extra: string[] = []): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync', ...extra],
  })
}

export interface PageOptions {
  mode: string
  format: FormatSpec
  diag?: string
  paint?: string
  tier?: string
  extra?: Record<string, string>
}

export async function openPage(browser: Browser, harness: Harness, options: PageOptions): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: options.format.width, height: options.format.height },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(driverTimeoutMs)
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text())
  })
  const query = new URLSearchParams({ mode: options.mode, format: options.format.id })
  if (options.diag) query.set('diag', options.diag)
  if (options.paint) query.set('paint', options.paint)
  if (options.tier) query.set('tier', options.tier)
  if (process.env.SHOWCASE_DETAIL) query.set('detail', process.env.SHOWCASE_DETAIL)
  for (const [k, v] of Object.entries(options.extra ?? {})) query.set(k, v)
  await page.goto(`${harness.url}index.html?${query.toString()}`)
  await page.waitForFunction(() => window.showcase !== undefined || document.body.textContent?.trim() !== '', undefined, { timeout: 120_000 })
  if (!(await page.evaluate(() => window.showcase !== undefined))) {
    throw new Error(`the page did not start: ${problems.join(' | ') || (await page.evaluate(() => document.body.textContent))}`)
  }
  await page.evaluate(() => window.showcase!.ready)
  ;(page as Page & { problems: string[] }).problems = problems
  return page
}

export function pageProblems(page: Page): string[] {
  return (page as Page & { problems?: string[] }).problems ?? []
}

export async function grabCanvas(page: Page, harness: Harness): Promise<Buffer> {
  const upload = harness.nextUpload()
  await page.evaluate(async () => {
    const canvas = document.getElementById('stage') as HTMLCanvasElement
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('the canvas could not be read')
    await fetch('__harness/upload', { method: 'POST', body: blob })
  })
  return upload
}
