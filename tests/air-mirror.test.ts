import type * as THREE from 'three'
import { createServer } from 'vite'
import { expect, it } from 'vitest'
import type { LightRig } from '../src/core/lights'
import type { mirrorCamera } from '../src/core/reflect/mirror'
import type { makeRibbonGeometry, RibbonView } from '../src/weather/air/ribbons'
import { launchBrowser } from '../tools/lib/browser'

function exercise(
  three: typeof THREE, Rig: typeof LightRig, mirror: typeof mirrorCamera,
  View: typeof RibbonView, geometry: typeof makeRibbonGeometry,
) {
  const size = 192
  const renderer = new three.WebGLRenderer({ antialias: false })
  renderer.setClearColor(0, 0)
  const target = new three.WebGLRenderTarget(size, size, { type: three.FloatType })
  const scene = new three.Scene()
  const light = new three.Object3D()
  light.position.set(0, 0.5, -1.4)
  const rig = new Rig([{
    id: 'warm deck spot', kind: 'spot', object: light, angle: 0.23, color: new three.Color(1, 0.87, 0.8),
    intensity: 3, size: [0.34, 0.21], range: 12, shadow: false, beam: false, level: () => 1,
  }], 1)
  rig.update(0, [0.5, 0.5])
  const view = new View()
  const rows = [
    view.makeMesh(rig.uniforms, geometry(new Float32Array([0.03, 0.66, 0, 0.0024]), new Float32Array([1, 3.2, 6.2, 0.4])), 1, {
      fade: [0.1, 0.8, 10, 14], gain: 1.38, size: new three.Vector3(8, 3.2, 8), center: new three.Vector3(),
      local: true,
    }),
    view.makeMesh(rig.uniforms, geometry(new Float32Array([0.16, 0.46, 0, 0.0011]), new Float32Array([0.014, 0.036, 0, 0.74])), -1),
    view.makeMesh(rig.uniforms, geometry(new Float32Array([-0.14, 0.52, 0, 0.047]), new Float32Array([0.011, 0.013, 0, 0.15])), -2),
  ]
  const capture = (fov: number) => {
    const cubeSide = new three.PerspectiveCamera(fov, 1, 0.05, 100)
    cubeSide.position.set(0, 0.65, 2.8)
    cubeSide.updateMatrixWorld(true)
    const camera = new three.PerspectiveCamera()
    mirror(cubeSide, camera, 1.18)
    return {
      focalY: camera.projectionMatrix.elements[5],
      ribbons: rows.map((row) => {
        scene.add(row)
        renderer.setRenderTarget(target)
        renderer.render(scene, camera)
        scene.remove(row)
        const rgba = new Float32Array(size * size * 4)
        renderer.readRenderTargetPixels(target, 0, 0, size, size, rgba)
        let energy = 0
        let min = 0
        let finite = true
        for (let i = 0; i < rgba.length; i += 4) for (let c = 0; c < 3; c++) {
          const n = rgba[i + c]
          energy += n
          min = Math.min(min, n)
          finite &&= Number.isFinite(n)
        }
        return { energy, min, finite }
      }),
    }
  }
  const positive = capture(90)
  const negative = capture(-90)
  target.dispose()
  renderer.dispose()
  return { positive, negative }
}

it('keeps nonnegative HDR from rain, crowns and spray when a cube mirror flips both projection axes', async () => {
  const id = '/air-mirror-entry.js'
  const app = await createServer({
    configFile: false,
    server: { host: '127.0.0.1', port: 0, ws: false },
    plugins: [{
      name: 'air-mirror-test',
      resolveId: (entry) => entry === id ? id : null,
      load: (entry) => entry === id ? `
        import * as THREE from 'three'
        import { LightRig } from '/src/core/lights.ts'
        import { mirrorCamera } from '/src/core/reflect/mirror.ts'
        import { RibbonView, makeRibbonGeometry } from '/src/weather/air/ribbons.ts'
        export const run = () => (${exercise.toString()})(THREE, LightRig, mirrorCamera, RibbonView, makeRibbonGeometry)
      ` : null,
      configureServer(server) {
        server.middlewares.use('/air-mirror-test', (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end('<!doctype html><link rel="icon" href="data:,"><title>Air mirror test</title>')
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
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
      await page.goto(new URL('air-mirror-test', app.resolvedUrls!.local[0]).href)
      const { positive, negative }: ReturnType<typeof exercise> = await page.evaluate(`import("${id}").then(module => module.run())`)
      expect(errors).toEqual([])
      expect(positive.focalY).toBeGreaterThan(0)
      expect(negative.focalY).toBeLessThan(0)
      for (const [i, row] of negative.ribbons.entries()) {
        const upright = positive.ribbons[i]
        expect(upright.energy).toBeGreaterThan(0.001)
        expect(row.finite).toBe(true)
        expect(row.min).toBeGreaterThanOrEqual(0)
        expect(Math.abs(row.energy / upright.energy - 1)).toBeLessThan(0.01)
      }
    } finally {
      await browser.close()
    }
  } finally {
    await app.close()
  }
}, 30_000)
