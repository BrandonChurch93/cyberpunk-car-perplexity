import * as THREE from 'three'
import { createServer } from 'vite'
import { describe, expect, it } from 'vitest'
import { config } from '../src/config'
import { LightRig } from '../src/core/lights'
import { createReflections, quality } from '../src/core/reflect'
import { boxProject, mirrorCamera } from '../src/core/reflect/mirror'
import { patchesOf } from '../src/materials/patch'
import { launchBrowser } from '../tools/lib/browser'

function camera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 500)
  c.position.set(1.5, 1.2, 9)
  c.lookAt(0, 0.4, 0)
  c.updateMatrixWorld(true)
  return c
}

function clipOf(c: THREE.Camera, p: THREE.Vector3): THREE.Vector4 {
  return new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(c.matrixWorldInverse).applyMatrix4(c.projectionMatrix)
}

describe('mirror camera', () => {
  const source = camera()
  const mirror = new THREE.PerspectiveCamera()
  mirrorCamera(source, mirror)

  it('sees a point above the deck where the source sees its mirror image, flipped left to right', () => {
    const p = new THREE.Vector3(-0.8, 2.3, -4)
    const seen = clipOf(mirror, p)
    const image = clipOf(source, new THREE.Vector3(p.x, -p.y, p.z))
    expect(seen.x / seen.w).toBeCloseTo(-image.x / image.w, 5)
    expect(seen.y / seen.w).toBeCloseTo(image.y / image.w, 5)
  })

  it('lands a deck point on the mirrored pixel of the source', () => {
    const p = new THREE.Vector3(0.6, 0, 2)
    const a = clipOf(mirror, p)
    const b = clipOf(source, p)
    expect(a.x / a.w).toBeCloseTo(-b.x / b.w, 5)
    expect(a.y / a.w).toBeCloseTo(b.y / b.w, 5)
  })

  it('clips everything below the deck and keeps what is above it', () => {
    const below = clipOf(mirror, new THREE.Vector3(0, -0.2, 0))
    const above = clipOf(mirror, new THREE.Vector3(0, 0.2, 0))
    expect(below.z).toBeLessThan(-below.w)
    expect(above.z).toBeGreaterThan(-above.w)
    expect(above.z).toBeLessThan(above.w)
  })

  it('is a proper rigid camera', () => {
    expect(mirror.matrixWorld.determinant()).toBeCloseTo(1, 5)
  })
})

describe('box projection', () => {
  const box = new THREE.Box3(new THREE.Vector3(-10, 0, -5), new THREE.Vector3(10, 20, 5))
  const probe = new THREE.Vector3(0, 0.6, 0)

  it('points from the probe to where the ray leaves the box', () => {
    const p = new THREE.Vector3(4, 0.6, 0)
    const out = boxProject(p, new THREE.Vector3(0, 0, 1), box, probe)
    expect(out.toArray().map((v) => +v.toFixed(5))).toEqual(new THREE.Vector3(4, 0, 5).normalize().toArray().map((v) => +v.toFixed(5)))
  })

  it('leaves the direction alone outside the box', () => {
    const dir = new THREE.Vector3(0.3, 0.4, 0.5).normalize()
    expect(boxProject(new THREE.Vector3(30, 1, 0), dir, box, probe).equals(dir)).toBe(true)
  })
})

describe('quality', () => {
  it('keeps the full setting for the final tier and cheaper ones below it', () => {
    expect(quality.final.planarEverySample).toBe(true)
    expect(quality.final.bounce).toBe(true)
    expect(quality.draft.captureSize).toBeLessThan(quality.review.captureSize)
    expect(quality.review.captureSize).toBeLessThan(quality.final.captureSize)
    for (const q of Object.values(quality)) expect(Math.log2(q.captureSize) % 1).toBe(0)
  })
})

it('uses the deck mirror on bay paint and grate metal without rendering them into their own mirror', () => {
  const scene = new THREE.Scene()
  const world = new THREE.Group()
  const body = new THREE.Group()
  const emitter = new THREE.Object3D()
  emitter.position.set(2, 6, -31)
  const rig = new LightRig([{
    id: 'magenta violet tower screen', kind: 'area', object: emitter, color: new THREE.Color(1, 0, 1),
    intensity: 2, range: 60, size: [4, 6], shadow: false, beam: false, level: () => 1,
  }], 32)
  const dark = new THREE.MeshStandardMaterial()
  const zinc = new THREE.MeshStandardMaterial()
  const floor = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
  stripe.name = 'hero near bay line'
  const rail = new THREE.Mesh(new THREE.BoxGeometry(), zinc)
  rail.position.y = 1
  const grate = new THREE.Group()
  grate.name = 'hero near drain grate'
  const rim = new THREE.Mesh(new THREE.BoxGeometry(), zinc)
  rim.name = 'iron grate end rim'
  const slot = new THREE.Mesh(new THREE.BoxGeometry(), dark)
  slot.name = 'recessed slot bed'
  grate.add(rim, slot)
  world.add(floor, stripe, rail, grate)
  scene.add(world, body, emitter, rig.group)
  const visibility: boolean[][] = []
  const renderer = {
    coordinateSystem: THREE.WebGLCoordinateSystem,
    getRenderTarget: () => null,
    getClearColor: (color: THREE.Color) => color,
    getClearAlpha: () => 1,
    setRenderTarget: () => undefined,
    setClearColor: () => undefined,
    clear: () => undefined,
    render: () => visibility.push([floor.visible, stripe.visible, rim.visible, slot.visible, rail.visible]),
  } as unknown as THREE.WebGLRenderer
  const part = createReflections({
    renderer, scene, rig,
    vehicle: { root: body, lamps: [] },
    world: { root: world, deck: { material: floor.material, meshes: [floor] }, reflectionBox: new THREE.Box3() },
  })
  const fmt = config.formats.preview
  const eye = camera()
  const state = { position: eye.position, quaternion: eye.quaternion, focalMm: 35, sensorWidthMm: 36, focusDistance: 4, fNumber: 2, near: .1, far: 50 }
  rig.update(0, [.75, .25])
  part.beforeSample!({
    camera: eye, state, timeSeconds: 0,
    sample: {
      frame: { format: fmt, frameIndex: 195, frameKey: 195, tier: 'draft', samples: 1, timeSeconds: 0 },
      sampleIndex: 0, timeSeconds: 0, shutter: .5, aperture: [0, 0], misc: [0, 0], pixel: [0, 0], light: [0, 0],
    },
  })
  expect(visibility).toEqual([[false, false, false, false, true]])
  expect(part.planar.reflectBillboard.value.toArray()).toEqual([3, 4.5, -31, 1])
  expect([floor.visible, stripe.visible, rim.visible, slot.visible, rail.visible]).toEqual([true, true, true, true, true])
  expect(patchesOf(floor.material)).toEqual(['reflect-box', 'reflect-planar'])
  expect(patchesOf(stripe.material)).toEqual(['reflect-box', 'reflect-planar-deck-detail'])
  expect(patchesOf(zinc)).toEqual(['reflect-box', 'reflect-planar-deck-detail'])
  expect(patchesOf(dark)).toEqual(['reflect-box'])
  expect(zinc.defines?.REFLECT_DECK_DETAIL).toBe(1)
})

function captureLamp(three: typeof THREE, reflections: typeof createReflections, fmt: typeof config.formats.preview) {
  const renderer = new three.WebGLRenderer()
  const scene = new three.Scene()
  scene.environmentIntensity = .4
  const root = new three.Group()
  const sprung = new three.Group()
  const body = new three.Mesh(new three.PlaneGeometry(2, 2), new three.MeshBasicMaterial({
    color: new three.Color(0, 1, 0), side: three.DoubleSide,
  }))
  body.position.set(0, .6, 1)
  const source = new three.Mesh(new three.PlaneGeometry(.25, .25), new three.MeshStandardMaterial({
    color: 0, emissive: new three.Color(1, 0, 0), emissiveIntensity: 0,
  }))
  source.name = 'test lamp'
  source.position.set(0, .6, 2)
  const origin = new three.Object3D()
  origin.name = 'test lamp emission origin'
  const door = new three.Mesh(new three.PlaneGeometry(1, .4), new three.MeshStandardMaterial({ envMapIntensity: .65 }))
  door.position.set(.996, .551, -.718)
  const deck = new three.MeshStandardMaterial()
  sprung.add(body, source, origin, door)
  root.add(sprung)
  const backdrop = new three.Mesh(new three.PlaneGeometry(2, 2), new three.MeshBasicMaterial({
    color: new three.Color(0, 0, 2), side: three.DoubleSide,
  }))
  backdrop.position.set(6, .6, 0)
  backdrop.rotation.y = Math.PI / 2
  const world = new three.Group()
  world.add(backdrop)
  scene.add(root, world)
  const part = reflections({
    renderer, scene,
    vehicle: { root, lamps: [{ object: origin, stage: 0, beam: true }] },
    world: {
      root: world,
      deck: { material: deck, meshes: [] },
      reflectionBox: new three.Box3(new three.Vector3(-4, 0, -4), new three.Vector3(4, 4, 4)),
    },
  })
  part.resize(fmt)
  const state = { position: new three.Vector3(3.15, .79, 7.87), quaternion: new three.Quaternion(), focalMm: 35, sensorWidthMm: 36, focusDistance: 4, fNumber: 2, near: .1, far: 50 }
  const sampler = new three.Scene()
  const output = new three.WebGLRenderTarget(1, 1)
  const uniforms = { captured: { value: null as THREE.Texture | null }, direction: { value: new three.Vector3() } }
  const material = new three.ShaderMaterial({
    uniforms,
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform samplerCube captured; uniform vec3 direction; void main(){ gl_FragColor = vec4(textureCube(captured, direction).rgb * 0.125, 1.0); }',
  })
  sampler.add(new three.Mesh(new three.PlaneGeometry(2, 2), material))
  const eye = new three.Camera()
  const read = (texture: THREE.Texture | null, direction: THREE.Vector3) => {
    uniforms.captured.value = texture
    uniforms.direction.value.copy(direction).normalize()
    renderer.setRenderTarget(output)
    renderer.render(sampler, eye)
    const pixel = new Uint8Array(4)
    renderer.readRenderTargetPixels(output, 0, 0, 1, 1, pixel)
    return Array.from(pixel.slice(0, 3))
  }
  const test = (frameIndex: number, intensity: number, x: number, z = 2) => {
    source.material.emissiveIntensity = intensity
    sprung.position.x = x
    source.position.z = z
    part.beginFrame!({ camera: state, format: fmt, frame: { format: fmt, frameIndex, frameKey: frameIndex, tier: 'draft', samples: 1, timeSeconds: 0 } })
    return read(scene.environment, new three.Vector3(x, 0, z))
  }
  const off = test(0, 0, 0)
  const dim = test(1, 2, 0)
  const bright = test(2, 6, .48)
  const tail = test(195, 6, 0, -2)
  const incident = door.position.clone().sub(state.position).normalize()
  const normal = new three.Vector3(0, 0, -1).sub(incident).normalize()
  const ray = incident.reflect(normal)
  const doorTail = read(door.material.envMap, ray)
  const deckTail = read(deck.envMap, ray)
  const side = new three.Vector3(1, 0, 0)
  const doorCity = read(door.material.envMap, side)
  const worldCity = read(scene.environment, side)
  const splitIntensity = [door.material.envMapIntensity, deck.envMapIntensity]
  test(0, 0, 0)
  const fullIntensity = [door.material.envMapIntensity, deck.envMapIntensity]
  const usesFullCapture = door.material.envMap === scene.environment && deck.envMap === null
  part.setDiagnostic!('normals')
  const reset = door.material.envMap === null && door.material.envMapIntensity === .65 && deck.envMap === null
  let captureOnly = false
  scene.traverse((node) => { if (node.name === 'cube lamp emitters') captureOnly = !node.visible })
  const bodyRestored = root.visible && body.visible && source.visible && source.material.side === three.FrontSide
  output.dispose()
  renderer.dispose()
  return { off, dim, bright, tail, doorTail, deckTail, doorCity, worldCity, splitIntensity, fullIntensity, usesFullCapture, reset, captureOnly, bodyRestored }
}

it('captures the moving lamp at its current output but keeps the car body out of the cube', async () => {
  const id = '/reflect-test-entry.js'
  const app = await createServer({
    configFile: false,
    server: { host: '127.0.0.1', port: 0, ws: false },
    plugins: [{
      name: 'reflect-test-entry',
      resolveId: (entry) => entry === id ? id : null,
      load: (entry) => entry === id ? `
        import * as THREE from 'three'
        import { createReflections } from '/src/core/reflect/index.ts'
        import { config } from '/src/config.ts'
        export const run = () => (${captureLamp.toString()})(THREE, createReflections, config.formats.preview)
      ` : null,
      configureServer(server) {
        server.middlewares.use('/reflect-test', (_req, res) => {
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
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
      await page.goto(new URL('reflect-test', app.resolvedUrls!.local[0]).href)
      const result: ReturnType<typeof captureLamp> = await page.evaluate(`import("${id}").then(module => module.run())`)
      expect(errors).toEqual([])
      expect(result.off).toEqual([0, 0, 0])
      expect(result.dim[0]).toBeGreaterThan(50)
      expect(result.bright[0]).toBeGreaterThan(result.dim[0] * 2)
      expect(result.bright.slice(1)).toEqual([0, 0])
      expect(result.tail[0]).toBeGreaterThan(150)
      expect(result.doorTail).toEqual([0, 0, 0])
      expect(result.deckTail).toEqual([0, 0, 0])
      expect(result.doorCity[2]).toBeGreaterThan(50)
      expect(result.worldCity).toEqual(result.doorCity)
      expect(result.splitIntensity).toEqual([.65, .4])
      expect(result.fullIntensity).toEqual([.65, 1])
      expect(result.usesFullCapture && result.reset).toBe(true)
      expect(result.captureOnly && result.bodyRestored).toBe(true)
    } finally {
      await browser.close()
    }
  } finally {
    await app.close()
  }
}, 30_000)
