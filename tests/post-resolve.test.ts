import { createServer } from 'vite'
import type * as THREE from 'three'
import { expect, test } from 'vitest'
import type { FormatSpec } from '../src/config'
import type { BasicResolver } from '../src/post/resolve'
import { launchBrowser } from '../tools/lib/browser'

function exercise(
  three: typeof THREE, Resolver: typeof BasicResolver, frameCount: number, fps: number, fmt: FormatSpec,
) {
  const { width, height } = fmt
  const renderer = new three.WebGLRenderer({ antialias: false })
  const target = new three.WebGLRenderTarget(width, height, { depthBuffer: false })
  const input = new Float32Array(width * height * 4)
  const sum = new three.DataTexture(input, width, height, three.RGBAFormat, three.FloatType)
  const resolver = new Resolver(renderer)
  resolver.resize(fmt)

  function field(fn: (x: number, y: number) => number | readonly [number, number, number]) {
    for (let i = 0; i < input.length; i += 4) {
      const p = i / 4
      const v = fn(p % width, Math.floor(p / width))
      input.set(typeof v === 'number' ? [v, v, v, 3] : [...v, 3], i)
    }
    sum.needsUpdate = true
  }

  function render(view: string, frameIndex: number) {
    const data = new Uint8Array(input.length)
    resolver.setDiagnostic(view)
    resolver.resolve(sum, 3, {
      frameIndex, frameKey: frameIndex % frameCount, timeSeconds: frameIndex / fps,
      tier: 'draft', format: fmt, samples: 3,
    }, target)
    renderer.readRenderTargetPixels(target, 0, 0, width, height, data)
    return data
  }

  field(() => 0.11)
  const gray = render('clay', 0)
  const codes = new Set<number>()
  for (let i = 0; i < gray.length; i += 4) codes.add(gray[i])
  const first = render('beauty', 0)
  const next = render('beauty', 1)
  const seam = render('beauty', frameCount)

  field(() => 1.5)
  const normals = render('normals', 0)
  const px = (data: Uint8Array, x: number, y: number) => Array.from(data.slice(4 * (y * width + x), 4 * (y * width + x) + 3))
  field((x) => {
    if (x < 16) return 18
    if (x < 32) return 90
    if (x < 48) return 270
    if (x < 64) return 720
    if (x < 80) return [24, 0.9, 1.1]
    return [1.3, 10.4, 18]
  })
  const practicals = render('clay', 0)
  const steps = [8, 24, 40, 56].map(x => px(practicals, x, height >> 1)[0])
  const red = px(practicals, 72, height >> 1)
  const cyan = px(practicals, 88, height >> 1)

  field((x, y) => Math.abs(x - width / 2) <= 2 && Math.abs(y - height / 2) <= 2 ? 2500 : 0)
  const lamp = render('beauty', 0)
  const middleX = width >> 1
  const middleY = height >> 1
  const result = {
    grayCodes: [...codes].sort((a, b) => a - b),
    seamSame: first.every((v, i) => v === seam[i]),
    nextSame: first.every((v, i) => v === next[i]),
    normals: normals[0],
    steps,
    red,
    cyan,
    near: px(lamp, middleX, middleY + 5),
    streak: px(lamp, middleX + 18, middleY),
    far: px(lamp, middleX, middleY + 18),
  }
  sum.dispose()
  target.dispose()
  renderer.dispose()
  return result
}

test('resolves on WebGL2 with dither, lens scatter, diagnostic passthrough and an identical loop seam', async () => {
  const id = '/post-test-entry.js'
  const app = await createServer({
    configFile: false,
    server: { host: '127.0.0.1', port: 0, ws: false },
    plugins: [{
      name: 'post-test-entry',
      resolveId: (entry) => entry === id ? id : null,
      load: (entry) => entry === id ? `
        import * as THREE from 'three'
        import { BasicResolver } from '/src/post/resolve.ts'
        import { config, frameCount } from '/src/config.ts'
        export const run = () => (${exercise.toString()})(THREE, BasicResolver, frameCount, config.film.fps, { id: config.formats.preview.id, width: 96, height: 64 })
      ` : null,
      configureServer(server) {
        server.middlewares.use('/post-test', (_req, res) => {
          res.setHeader('Content-Type', 'text/html')
          res.end('<html><head><link rel="icon" href="data:,"></head><body></body></html>')
        })
      },
    }],
  })
  try {
    await app.listen()
    const browser = await launchBrowser()
    try {
      const page = await browser.newPage()
      const errors: string[] = []
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      await page.goto(new URL('post-test', app.resolvedUrls!.local[0]).href)
      const result: ReturnType<typeof exercise> = await page.evaluate(`import("${id}").then(module => module.run())`)
      expect(errors).toEqual([])
      expect(result.grayCodes.length).toBeGreaterThanOrEqual(2)
      expect(result.grayCodes[result.grayCodes.length - 1] - result.grayCodes[0]).toBeLessThanOrEqual(2)
      expect(result.grayCodes[0]).toBeGreaterThan(0)
      expect(result.seamSame).toBe(true)
      expect(result.nextSame).toBe(false)
      expect(Math.abs(result.normals - 127.5)).toBeLessThanOrEqual(0.5)
      expect(result.steps.every((code, i, steps) => i === 0 || code >= steps[i - 1] + 2)).toBe(true)
      expect(result.steps[3]).toBeLessThan(254)
      expect(result.red[0]).toBeGreaterThan(result.red[1] + 45)
      expect(result.cyan[2]).toBeGreaterThan(result.cyan[0] + 35)
      expect(result.near[0]).toBeGreaterThan(result.near[2])
      expect(result.streak[2]).toBeGreaterThan(result.far[2] + 2)
    } finally {
      await browser.close()
    }
  } finally {
    await app.close()
  }
}, 30_000)
