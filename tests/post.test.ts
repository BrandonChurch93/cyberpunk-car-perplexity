import { chromium, type Browser } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { config, frameCount } from '../src/config'
import {
  BLACK_FLOOR,
  candidateToneCurves,
  CHOSEN_TONE_CURVE,
  EXPOSURE,
  srgbEncodeChannel,
  srgbEncodeRgb,
  toneMapRgb,
} from '../src/post/curves'

describe('post tone curves and photometric response', () => {
  it('exposes three monotonic candidate curves that keep blacks above code value zero', () => {
    const names = Object.keys(candidateToneCurves) as Array<keyof typeof candidateToneCurves>
    expect(names).toEqual(['cinemaLogShoulder', 'rationalToeShoulder', 'standardShoulder'])
    expect(CHOSEN_TONE_CURVE).toBe('cinemaLogShoulder')

    const samples = [0, 0.001, 0.005, 0.02, 0.1, 0.5, 2, 8, 25, 100, 500]
    for (const name of names) {
      const fn = candidateToneCurves[name]
      const blackSrgb = srgbEncodeChannel(fn(0))
      expect(fn(0)).toBeGreaterThanOrEqual(BLACK_FLOOR)
      expect(Math.round(blackSrgb * 255)).toBeGreaterThan(0)
      for (let i = 1; i < samples.length; i++) {
        expect(fn(samples[i])).toBeGreaterThanOrEqual(fn(samples[i - 1]))
      }
      expect(fn(500)).toBeLessThanOrEqual(1)
    }
  })

  it('places wet deck in lower-mid tones, signs in upper-mid tones, and desaturates bright cores', () => {
    const deckMid = srgbEncodeRgb(toneMapRgb(0.05 * EXPOSURE, 0.05 * EXPOSURE, 0.05 * EXPOSURE))[1]
    const windowMid = srgbEncodeRgb(toneMapRgb(0.45 * EXPOSURE, 0.45 * EXPOSURE, 0.45 * EXPOSURE))[1]
    const signHigh = srgbEncodeRgb(toneMapRgb(9.0 * EXPOSURE, 9.0 * EXPOSURE, 9.0 * EXPOSURE))[1]
    const lampCore = srgbEncodeRgb(toneMapRgb(450 * EXPOSURE, 450 * EXPOSURE, 450 * EXPOSURE))[1]

    expect(deckMid).toBeGreaterThan(0.22)
    expect(deckMid).toBeLessThan(0.48)
    expect(windowMid).toBeGreaterThan(0.55)
    expect(windowMid).toBeLessThan(0.82)
    expect(signHigh).toBeGreaterThan(0.82)
    expect(signHigh).toBeLessThan(0.97)
    expect(lampCore).toBeGreaterThan(0.99)

    const dimRed = srgbEncodeRgb(toneMapRgb(0.15 * EXPOSURE, 0.005 * EXPOSURE, 0.005 * EXPOSURE))
    const hotRed = srgbEncodeRgb(toneMapRgb(22 * EXPOSURE, 0.4 * EXPOSURE, 0.4 * EXPOSURE))
    expect(dimRed[0] - dimRed[1]).toBeGreaterThan(0.30)
    expect(hotRed[1]).toBeGreaterThan(0.72)
    expect(hotRed[2]).toBeGreaterThan(0.72)
  })
})

describe('BasicResolver WebGL2 pipeline', () => {
  let server: ViteDevServer
  let browser: Browser
  let baseUrl: string

  beforeAll(async () => {
    server = await createServer({
      server: { port: 0, host: '127.0.0.1' },
      logLevel: 'silent',
    })
    await server.listen()
    const addr = server.httpServer?.address()
    const port = typeof addr === 'object' && addr ? addr.port : 5173
    baseUrl = `http://127.0.0.1:${port}/`
    browser = await chromium.launch({
      headless: true,
      args: [
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--disable-gpu-vsync',
      ],
    })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  it('dithers a constant gray field without banding and matches frame 0 to frame 1350 identically', async () => {
    // Pick a scene gray whose continuous clay 8-bit sRGB value sits near a half-integer (x.48).
    let targetSceneGray = 0.04
    let bestFracDiff = 1
    let targetContinuous8Bit = 0
    for (let k = 1; k <= 2000; k++) {
      const candidate = k * 0.0001
      const srgb = srgbEncodeRgb(toneMapRgb(candidate * EXPOSURE, candidate * EXPOSURE, candidate * EXPOSURE))[0]
      const v8 = srgb * 255
      const frac = v8 - Math.floor(v8)
      const d = Math.abs(frac - 0.48)
      if (v8 > 40 && v8 < 180 && d < bestFracDiff) {
        bestFracDiff = d
        targetSceneGray = candidate
        targetContinuous8Bit = v8
      }
    }

    const page = await browser.newPage()
    try {
      await page.goto(`${baseUrl}assets/third-party/ATTRIBUTION.md`)
      const result = await page.evaluate(
        async ({ gray, totalFrames, previewFormat }) => {
          const dynImport = new Function('s', 'return import(s)') as (s: string) => Promise<unknown>
          const THREE = (await dynImport('/node_modules/three/build/three.module.js')) as typeof import('three')
          const { createRenderer } = (await dynImport('/src/core/renderer.ts')) as typeof import('../src/core/renderer')
          const { BasicResolver } = (await dynImport('/src/post/resolve.ts')) as typeof import('../src/post/resolve')

          const canvas = document.createElement('canvas')
          const w = 128
          const h = 128
          canvas.width = w
          canvas.height = h
          const renderer = createRenderer(canvas)
          const resolver = new BasicResolver(renderer)
          const format = { id: 'test', width: w, height: h }
          resolver.resize(format)

          const makeConstantSum = (valR: number, valG: number, valB: number, count: number) => {
            const data = new Float32Array(w * h * 4)
            for (let i = 0; i < w * h; i++) {
              data[i * 4] = valR * count
              data[i * 4 + 1] = valG * count
              data[i * 4 + 2] = valB * count
              data[i * 4 + 3] = count
            }
            const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType)
            tex.minFilter = THREE.NearestFilter
            tex.magFilter = THREE.NearestFilter
            tex.needsUpdate = true
            return tex
          }

          const out8 = new THREE.WebGLRenderTarget(w, h, {
            type: THREE.UnsignedByteType,
            format: THREE.RGBAFormat,
            depthBuffer: false,
          })

          const readTarget = () => {
            const buf = new Uint8Array(w * h * 4)
            renderer.readRenderTargetPixels(out8, 0, 0, w, h, buf)
            return buf
          }

          const frameFor = (frameIndex: number) => ({
            frameIndex,
            frameKey: frameIndex % totalFrames,
            timeSeconds: frameIndex / 30,
            tier: 'review' as const,
            format,
            samples: 4,
          })

          // 1. Constant gray field in clay mode (exposure + tone map + triangular dither only)
          const grayTex = makeConstantSum(gray, gray, gray, 4)
          resolver.setDiagnostic('clay')
          resolver.resolve(grayTex, 4, frameFor(0), out8)
          const clayBuf = readTarget()
          const hist = new Map<number, number>()
          let sumR = 0
          let sameNeighborCount = 0
          let totalNeighbors = 0
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const idx = (y * w + x) * 4
              const r = clayBuf[idx]
              sumR += r
              hist.set(r, (hist.get(r) ?? 0) + 1)
              if (x + 1 < w) {
                totalNeighbors++
                if (r === clayBuf[idx + 4]) sameNeighborCount++
              }
            }
          }

          // 2. Constant gray field in beauty mode (vignette ramp across 8-bit levels without skipped bands)
          resolver.setDiagnostic('beauty')
          resolver.resolve(grayTex, 4, frameFor(0), out8)
          const beautyGrayBuf = readTarget()
          const beautyLevels = new Set<number>()
          const beautyVals: number[] = []
          for (let i = 0; i < w * h; i++) {
            const g = beautyGrayBuf[i * 4 + 1]
            beautyLevels.add(g)
            beautyVals.push(g)
          }
          beautyVals.sort((a, b) => a - b)
          const lowLevel = beautyVals[Math.floor(beautyVals.length * 0.05)]
          const highLevel = beautyVals[Math.floor(beautyVals.length * 0.95)]
          let missingIntermediate = 0
          for (let lv = lowLevel; lv <= highLevel; lv++) {
            if (!beautyLevels.has(lv)) missingIntermediate++
          }

          // 3. Loop seam determinism: frame 0 vs frame 1350 vs frame 1 on a rich HDR test scene
          const sceneData = new Float32Array(w * h * 4)
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const i = (y * w + x) * 4
              const dx = x - 64
              const dy = y - 64
              const r2 = dx * dx + dy * dy
              const lamp = r2 < 9 ? 320 : r2 < 36 ? 12 : 0
              sceneData[i] = (0.015 + 0.04 * (x / w) + lamp) * 8
              sceneData[i + 1] = (0.022 + 0.05 * (y / h) + lamp * 0.95) * 8
              sceneData[i + 2] = (0.032 + 0.06 * (y / h) + lamp * 1.05) * 8
              sceneData[i + 3] = 8
            }
          }
          const sceneTex = new THREE.DataTexture(sceneData, w, h, THREE.RGBAFormat, THREE.FloatType)
          sceneTex.minFilter = THREE.NearestFilter
          sceneTex.magFilter = THREE.NearestFilter
          sceneTex.needsUpdate = true

          resolver.setDiagnostic('beauty')
          resolver.resolve(sceneTex, 8, frameFor(0), out8)
          const f0 = readTarget()
          resolver.resolve(sceneTex, 8, frameFor(totalFrames), out8)
          const fLoop = readTarget()
          resolver.resolve(sceneTex, 8, frameFor(1), out8)
          const f1 = readTarget()

          let maxDiffLoop = 0
          let diffPixelsNeighbor = 0
          for (let i = 0; i < f0.length; i++) {
            const dl = Math.abs(f0[i] - fLoop[i])
            if (dl > maxDiffLoop) maxDiffLoop = dl
            if (f0[i] !== f1[i]) diffPixelsNeighbor++
          }

          // 4. Normals diagnostic passthrough check
          const normTex = makeConstantSum(0.25, 0.5, 0.75, 2)
          resolver.setDiagnostic('normals')
          resolver.resolve(normTex, 2, frameFor(0), out8)
          const normBuf = readTarget()
          const normPixel = [normBuf[0], normBuf[1], normBuf[2]]

          // Verify resize across preview format works cleanly
          resolver.resize(previewFormat)

          grayTex.dispose()
          sceneTex.dispose()
          normTex.dispose()
          out8.dispose()
          resolver.dispose()
          renderer.dispose()

          return {
            histEntries: Array.from(hist.entries()).sort((a, b) => a[0] - b[0]),
            meanR: sumR / (w * h),
            sameNeighborRatio: sameNeighborCount / totalNeighbors,
            lowLevel,
            highLevel,
            missingIntermediate,
            maxDiffLoop,
            diffPixelsNeighbor,
            normPixel,
          }
        },
        {
          gray: targetSceneGray,
          totalFrames: frameCount,
          previewFormat: config.formats.preview,
        },
      )

      const floorLv = Math.floor(targetContinuous8Bit)
      const ceilLv = floorLv + 1
      const histMap = new Map(result.histEntries)
      const totalPx = 128 * 128
      expect((histMap.get(floorLv) ?? 0) / totalPx).toBeGreaterThan(0.30)
      expect((histMap.get(ceilLv) ?? 0) / totalPx).toBeGreaterThan(0.30)
      expect(Math.abs(result.meanR - targetContinuous8Bit)).toBeLessThan(0.35)
      expect(result.sameNeighborRatio).toBeLessThan(0.65)

      expect(result.highLevel - result.lowLevel).toBeGreaterThanOrEqual(8)
      expect(result.missingIntermediate).toBe(0)

      expect(result.maxDiffLoop).toBe(0)
      expect(result.diffPixelsNeighbor).toBeGreaterThan(1000)

      expect(Math.abs(result.normPixel[0] - Math.round(0.25 * 255))).toBeLessThanOrEqual(1)
      expect(Math.abs(result.normPixel[1] - Math.round(0.5 * 255))).toBeLessThanOrEqual(1)
      expect(Math.abs(result.normPixel[2] - Math.round(0.75 * 255))).toBeLessThanOrEqual(1)
    } finally {
      await page.close()
    }
  }, 60_000)
})
