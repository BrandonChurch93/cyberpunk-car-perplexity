import type * as THREE from 'three'
import { createServer } from 'vite'
import { expect, it } from 'vitest'
import type { SampleContext } from '../src/core/contract'
import type { LightRig } from '../src/core/lights'
import type { makeRibbonGeometry, RibbonView } from '../src/weather/air/ribbons'
import { launchBrowser } from '../tools/lib/browser'

function exercise(three: typeof THREE, Rig: typeof LightRig, View: typeof RibbonView, geometry: typeof makeRibbonGeometry) {
  const size = 160
  const renderer = new three.WebGLRenderer({ antialias: false })
  renderer.setClearColor(0, 0)
  const target = new three.WebGLRenderTarget(size, size, {
    type: three.FloatType,
    depthTexture: new three.DepthTexture(size, size, three.UnsignedIntType),
  })
  const scene = new three.Scene()
  const facade = new three.Mesh(new three.PlaneGeometry(32, 32), new three.MeshBasicMaterial({ color: 0 }))
  facade.position.z = -8
  const emitter = new three.Object3D()
  emitter.position.set(0, 0.65, -20)
  const rig = new Rig([{
    id: 'test area', kind: 'area', object: emitter, color: new three.Color(1, 0.85, 0.8),
    intensity: 500, size: [8, 5], range: 45, shadow: false, beam: false, level: () => 1,
  }], 1)
  const view = new View()
  const ribbon = view.makeMesh(rig.uniforms, geometry(new Float32Array([0.03, 0.70, 0, 0.0024]), new Float32Array([1, 3.2, 6.2, 0.4])), 1, {
    fade: [0.1, 0.8, 35, 40], gain: 2.0, size: new three.Vector3(8, 3.2, 8), center: new three.Vector3(),
  })
  scene.add(facade, ribbon)
  const camera = new three.PerspectiveCamera(45, 1, 0.05, 100)
  camera.position.set(0, 0.65, 2.8)
  camera.updateMatrixWorld(true)
  const state = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), focalMm: 50, sensorWidthMm: 36,
    focusDistance: 3, fNumber: 2.8, near: camera.near, far: camera.far }
  const sample: SampleContext = {
    camera, state, timeSeconds: 0,
    sample: {
      frame: { frameIndex: 0, frameKey: 0, timeSeconds: 0, tier: 'final', format: { id: 'test', width: size, height: size }, samples: 1 },
      sampleIndex: 0, timeSeconds: 0, pixel: [0.5, 0.5], shutter: 0.5, aperture: [0, 0], light: [0.5, 0.5], misc: [0.5, 0.5],
    },
  }
  const secondary = camera.clone()
  secondary.updateMatrixWorld(true)
  const capture = (covered: boolean, active = camera) => {
    facade.visible = covered
    view.beginSample(sample)
    rig.update(0, [0.5, 0.5])
    renderer.setRenderTarget(target)
    renderer.render(scene, active)
    const rgba = new Float32Array(size * size * 4)
    renderer.readRenderTargetPixels(target, 0, 0, size, size, rgba)
    let energy = 0
    for (let i = 0; i < rgba.length; i += 4) energy += rgba[i] + rgba[i + 1] + rgba[i + 2]
    return energy
  }
  const farWall = capture(true)
  const farSky = capture(false)
  const wallAgain = capture(true)
  const secondaryWall = capture(true, secondary)
  const secondarySky = capture(false, secondary)
  emitter.position.z = -2
  const nearWall = capture(true)
  const nearSky = capture(false)
  camera.position.z = secondary.position.z = state.position.z = 30
  camera.updateMatrixWorld(true)
  secondary.updateMatrixWorld(true)
  const distantWall = capture(true)
  const distantSecondary = capture(true, secondary)
  target.dispose()
  renderer.dispose()
  return { farWall, farSky, wallAgain, secondaryWall, secondarySky, nearWall, nearSky, distantWall, distantSecondary }
}

it('cuts distant fill on sky and resolves individual drops only in the closer air', async () => {
  const id = '/air-sky-entry.js'
  const app = await createServer({
    configFile: false,
    server: { host: '127.0.0.1', port: 0, ws: false },
    plugins: [{
      name: 'air-sky-test',
      resolveId: (entry) => entry === id ? id : null,
      load: (entry) => entry === id ? `
        import * as THREE from 'three'
        import { LightRig } from '/src/core/lights.ts'
        import { RibbonView, makeRibbonGeometry } from '/src/weather/air/ribbons.ts'
        export const run = () => (${exercise.toString()})(THREE, LightRig, RibbonView, makeRibbonGeometry)
      ` : null,
      configureServer(server) {
        server.middlewares.use('/air-sky-test', (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end('<!doctype html><link rel="icon" href="data:,"><title>Air sky test</title>')
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
      await page.goto(new URL('air-sky-test', app.resolvedUrls!.local[0]).href)
      const { farWall, farSky, wallAgain, secondaryWall, secondarySky, nearWall, nearSky, distantWall, distantSecondary }: ReturnType<typeof exercise> = await page.evaluate(`import("${id}").then(module => module.run())`)
      expect(errors).toEqual([])
      expect(farWall).toBeGreaterThan(0.001)
      expect(farSky / farWall).toBeCloseTo(0.04, 4)
      expect(wallAgain).toBeCloseTo(farWall, 6)
      expect(secondaryWall).toBeGreaterThan(0.001)
      expect(secondarySky).toBeCloseTo(secondaryWall, 6)
      expect(nearWall).toBeGreaterThan(0.001)
      expect(nearSky).toBeCloseTo(nearWall, 6)
      expect(distantSecondary).toBeGreaterThan(0.00001)
      expect(distantWall).toBe(0)
    } finally {
      await browser.close()
    }
  } finally {
    await app.close()
  }
}, 30_000)
