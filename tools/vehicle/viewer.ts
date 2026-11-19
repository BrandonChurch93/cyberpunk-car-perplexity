import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from '../lib/browser.ts'
import { startHarness } from '../lib/server.ts'
import type { Shot } from './view.ts'

export type { Shot }

const repo = fileURLToPath(new URL('../../', import.meta.url))
export const outDir = `${repo}out/work/vehicle`

export interface Viewer {
  info: unknown
  shoot(shot: Shot): Promise<Buffer>
  close(): Promise<void>
}

export async function openViewer(detail: 'blockout' | 'full', paint?: string): Promise<Viewer> {
  await build({ configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)) })
  const harness = await startHarness(`${repo}out/work/vehicle-view`)
  const browser = await launchBrowser()
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  page.setDefaultTimeout(600_000)
  page.on('pageerror', (e) => console.error('page error:', e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.error('page:', m.text())
  })
  await page.goto(`${harness.url}view.html`)
  await page.waitForFunction(() => window.vehicleView !== undefined)
  const info = await page.evaluate(([d, p]) => window.vehicleView!.load(d as 'blockout' | 'full', p ?? undefined), [detail, paint ?? null] as const)
  return {
    info,
    async shoot(shot) {
      const url = await page.evaluate((s) => window.vehicleView!.shoot(s), shot)
      return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
    },
    async close() {
      await browser.close()
      await harness.close()
    },
  }
}
