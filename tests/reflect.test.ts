import * as THREE from 'three'
import { createServer } from 'vite'
import { describe, expect, it } from 'vitest'
import { config, defaultPaint, paintById } from '../src/config'
import type { FilmLight, SampleContext } from '../src/core/contract'
import type { FrameEngine, Stage } from '../src/core/engine'
import { createHaze, createHazeCapture } from '../src/core/haze'
import type { applyLens } from '../src/core/lens'
import { LightRig, patchFilmLighting } from '../src/core/lights'
import { createReflections, planarTuning, quality, reflectionCaptureSize } from '../src/core/reflect'
import { lampSources, probeLamps } from '../src/core/reflect/lamps'
import { boxProject, mirrorCamera } from '../src/core/reflect/mirror'
import { Probe } from '../src/core/reflect/probe'
import { boxPatch, planarPatch } from '../src/core/reflect/shaders'
import { hash01, streamSeed } from '../src/core/random'
import { events, stateAt } from '../src/director/timeline'
import { patchMaterial, patchesOf } from '../src/materials/patch'
import { applyPorous } from '../src/weather/surface/porous'
import { createVehicle } from '../src/vehicle'
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

  it('keeps perturbed mirror rays inside the padded cube face', () => {
    const eye = new THREE.PerspectiveCamera(-90, 1, .05, 1500)
    eye.position.y = .6
    eye.updateMatrixWorld(true)
    const padded = new THREE.PerspectiveCamera()
    mirrorCamera(eye, padded, 1.18)
    const p = new THREE.Vector3(10.6, 2, -10)
    const a = clipOf(padded, p)
    const b = clipOf(eye, p)
    expect(Math.abs(b.x)).toBeGreaterThan(b.w)
    expect(Math.abs(a.x)).toBeLessThan(a.w)
    expect(a.z).toBeGreaterThan(-a.w)
    expect(a.z).toBeLessThan(a.w)
    const under = clipOf(padded, new THREE.Vector3(p.x, -p.y, p.z))
    expect(under.z).toBeLessThan(-under.w)
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
    expect(quality.draft.planarScale).toBe(quality.review.planarScale)
    expect(quality.review.planarScale).toBe(quality.final.planarScale)
    for (const q of Object.values(quality)) expect(Math.log2(q.captureSize) % 1).toBe(0)
  })

  it('keeps the paint beat at least at review cube resolution without raising the hero or later beats', () => {
    const paint = config.beats.find(({ id }) => id === 'paint')!
    const macro = config.film.macroFrameSeconds
    expect(reflectionCaptureSize('draft', config.film.heroFrameSeconds)).toBe(quality.draft.captureSize)
    expect(reflectionCaptureSize('draft', paint.start)).toBe(quality.final.captureSize)
    expect(reflectionCaptureSize('draft', macro)).toBe(quality.final.captureSize)
    expect(reflectionCaptureSize('draft', paint.end)).toBe(quality.draft.captureSize)
    expect(reflectionCaptureSize('review', macro)).toBe(quality.final.captureSize)
    expect(reflectionCaptureSize('final', macro)).toBe(quality.final.captureSize)
  })
})

it('tracks the ported guides, projector dies and tail through real lamp stages and body transforms', async () => {
  const vehicle = await createVehicle({ paint: paintById(defaultPaint), detail: 'blockout' })
  const probe = probeLamps(vehicle)
  const emitters = probe.root.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[]
  const active = () => emitters.filter((emitter) => emitter.visible)
  expect(emitters).toHaveLength(8)
  const beams = vehicle.lamps.filter(({ beam }) => beam)
  const published = lampSources(vehicle)
  expect(published).toHaveLength(8)
  for (const [index, { object }] of beams.entries()) {
    const source = published.find(({ mesh }) => mesh === probe.mirrorApertures.get(`vehicle-beam-${index}`))
    expect(source?.origin).toBe(object)
  }
  expect([...probe.mirrorApertures].map(([id, mesh]) => [id, mesh.name]).sort()).toEqual([
    ['vehicle-beam-0', 'front projector LED dies 0'],
    ['vehicle-beam-1', 'front projector LED dies 0 right'],
    ['vehicle-beam-2', 'front projector LED dies 1'],
    ['vehicle-beam-3', 'front projector LED dies 1 right'],
    ['vehicle-glow-front-left', 'front Y running guide'],
    ['vehicle-glow-front-right', 'front Y running guide right'],
  ])
  expect(probe.root.visible).toBe(false)
  probe.sync()
  expect(active()).toHaveLength(0)

  vehicle.update(stateAt((events.lampStageOne + events.lampStageTwo) * .5))
  probe.sync()
  expect(active().map((emitter) => emitter.name).sort()).toEqual([
    'front Y running guide', 'front Y running guide right', 'tail-guide-left', 'tail-guide-right',
  ])

  vehicle.root.position.set(-1, .02, 3)
  vehicle.root.rotation.y = .25
  vehicle.update(stateAt(events.lampStageThree))
  probe.sync()
  expect(active()).toHaveLength(emitters.length)
  for (const emitter of emitters) {
    const source = vehicle.root.getObjectByName(emitter.name) as typeof emitter
    expect(emitter.geometry).toBe(source.geometry)
    expect(emitter.matrixWorld.equals(source.matrixWorld)).toBe(true)
    expect(emitter.material.emissive.equals(source.material.emissive)).toBe(true)
    expect(emitter.material.emissiveIntensity).toBe(source.material.emissiveIntensity)
    expect(emitter.material.side).toBe(THREE.DoubleSide)
  }
  const guide = probe.mirrorApertures.get('vehicle-glow-front-left')!.material as THREE.MeshStandardMaterial
  const die = probe.mirrorApertures.get('vehicle-beam-0')!.material as THREE.MeshStandardMaterial
  const before = [guide.emissiveIntensity, die.emissiveIntensity]
  expect(patchesOf(guide)).toContain('deck-guide-arm')
  probe.withDeckRadiance(new THREE.Vector3(3, -.8, 8), () => {
    expect(guide.emissiveIntensity).toBeGreaterThan(0)
    expect(guide.emissiveIntensity).toBeLessThan(before[0])
    expect(die.emissiveIntensity).toBe(before[1])
    expect(emitters.find(({ name }) => name === 'front Y running guide')!.material.emissiveIntensity).toBe(before[0])
  })
  expect([guide.emissiveIntensity, die.emissiveIntensity]).toEqual(before)
  vehicle.update(stateAt(events.lampsOffEnd))
  probe.sync()
  expect(active()).toHaveLength(0)
}, 120_000)

it('uses the deck mirror on bay paint and grate metal without rendering them into their own mirror', () => {
  const scene = new THREE.Scene()
  const world = new THREE.Group()
  const body = new THREE.Group()
  const housing = new THREE.Group()
  const tint = new THREE.Color(.15, .03, .23)
  const aperture = new THREE.Mesh(new THREE.PlaneGeometry(4, 6), new THREE.ShaderMaterial({ uniforms: { tint: { value: tint } } }))
  aperture.name = 'weather-sealed opal face'
  aperture.position.set(2, 6, -31)
  const emitter = new THREE.Object3D()
  emitter.position.set(2, 6, -31)
  housing.add(aperture, emitter)
  const practical: FilmLight = {
    id: 'test luminous opal', kind: 'area', object: emitter, color: new THREE.Color(1, 0, 1),
    intensity: 48, range: 60, size: [4, 6], shadow: false, beam: false, level: () => 1,
  }
  const rig = new LightRig([practical], 32)
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
  world.add(floor, stripe, rail, grate, housing)
  scene.add(world, body, rig.group)
  const visibility: boolean[][] = []
  const radiance: number[][] = []
  const targets: THREE.WebGLRenderTarget[] = []
  let activeTarget: THREE.WebGLRenderTarget | null = null
  const renderer = {
    coordinateSystem: THREE.WebGLCoordinateSystem,
    getRenderTarget: () => activeTarget,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getClearColor: (color: THREE.Color) => color,
    getClearAlpha: () => 1,
    setRenderTarget: (target: THREE.WebGLRenderTarget | null) => { activeTarget = target },
    setClearColor: () => undefined,
    clear: () => undefined,
    render: (object: THREE.Object3D) => {
      targets.push(activeTarget!)
      if (object !== scene) return
      visibility.push([floor.visible, stripe.visible, rim.visible, slot.visible, rail.visible])
      radiance.push(tint.toArray())
    },
  } as unknown as THREE.WebGLRenderer
  const part = createReflections({
    renderer, scene, rig,
    vehicle: { root: body, lamps: [] },
    world: {
      root: world, lights: [practical],
      deck: { material: floor.material, meshes: [floor], bounds: new THREE.Box2(new THREE.Vector2(-10, -10), new THREE.Vector2(10, 10)) },
      reflectionBox: new THREE.Box3(),
    },
  })
  const fmt = config.formats.preview
  const eye = camera()
  const state = { position: eye.position, quaternion: eye.quaternion, focalMm: 35, sensorWidthMm: 36, focusDistance: 4, fNumber: 2, near: .1, far: 50 }
  rig.update(0, [.75, .25])
  const sample: SampleContext = {
    camera: eye, state, timeSeconds: 0,
    sample: {
      frame: { format: fmt, frameIndex: 195, frameKey: 195, tier: 'draft', samples: 1, timeSeconds: 0 },
      sampleIndex: 0, timeSeconds: 0, shutter: .5, aperture: [0, 0], misc: [0, 0], pixel: [0, 0], light: [0, 0],
    },
  }
  part.beforeSample!(sample)
  expect(targets).toHaveLength(2)
  const [raw, finished] = targets
  expect(raw).not.toBe(finished)
  expect(raw!.depthTexture).not.toBeNull()
  expect(raw!.texture.generateMipmaps).toBe(false)
  expect(finished!.texture.generateMipmaps).toBe(true)
  expect(part.planar.reflectDepth.value).toBe(raw!.depthTexture)
  expect(part.planar.reflectMap.value).toBe(finished!.texture)
  expect(activeTarget).toBeNull()
  expect(visibility).toEqual([[false, false, false, false, true]])
  expect(radiance).toEqual([[2, 0, 2]])
  expect(tint.toArray()).toEqual([.15, .03, .23])
  expect(part.planar.reflectEmitters.value.map(position => position.toArray())).toEqual([[3, 4.5, -31, 1]])
  housing.visible = false
  part.beforeSample!(sample)
  expect(part.planar.reflectEmitters.value[0]!.w).toBe(0)
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

function captureAir(three: typeof THREE, createCameraHaze: typeof createHaze, createCubeHaze: typeof createHazeCapture,
  Rig: typeof LightRig, Cube: typeof Probe, fmt: typeof config.formats.preview) {
  const renderer = new three.WebGLRenderer()
  const scene = new three.Scene()
  const origin = new three.Vector3(0, .6, 0)
  const makeLight = (id: string, p: number[], rgb: number[], intensity: number): ConstructorParameters<typeof LightRig>[0][number] => {
    const object = new three.Object3D()
    object.position.fromArray(p)
    object.lookAt(origin)
    return { id, object, color: new three.Color().fromArray(rgb), intensity, kind: 'area', size: [21, 34],
      range: 740, shadow: false, beam: false, level: () => 1 }
  }
  const lights = [
    makeLight('magenta violet tower screen', [45, 35, -480], [1, .14, .63], 14_000),
    makeLight('cyan group', [-90, 30, -380], [.02, .65, 1], 5_500),
    makeLight('amber group', [330, 20, -.1], [1, .52, .16], 5_500),
  ]
  const rig = new Rig(lights, 32)
  scene.add(rig.group, ...lights.map((light) => light.object))
  rig.update(0, [.5, .5])
  const world = { lights, deck: { bounds: new three.Box2(new three.Vector2(-12, -18), new three.Vector2(12, 18)) } }
  const domain = { rig, world }
  const directions = [
    [1, .09, -.1, 395], [1, .24, .27, 460], [-1, .1, .13, 510], [-1, -.19, .25, 6],
    [.13, 1, -.22, 320], [-.22, 1, .1, 780], [.2, -1, .11, 1.1], [-.18, -1, -.2, 1.2],
    [.15, .05, 1, 520], [-.23, .28, 1, 910], [.07, .09, -1, 490], [-.27, .08, -1, 650],
  ]
  const rays = directions.map(([x, y, z, distance], i) => {
    const direction = new three.Vector3(x, y, z).normalize()
    const plate = new three.Mesh(new three.PlaneGeometry(distance * .19, distance * .19), new three.MeshBasicMaterial({
      color: new three.Color(.045 + .0025 * i, .075, .10), side: three.DoubleSide,
    }))
    plate.position.copy(origin).addScaledVector(direction, distance)
    plate.lookAt(origin)
    scene.add(plate)
    return direction
  })
  const emitters = new three.Group()
  const lamp = new three.Mesh(new three.PlaneGeometry(.2, .2), new three.MeshBasicMaterial({
    color: new three.Color(4, .12, .08), side: three.DoubleSide,
  }))
  lamp.position.copy(origin).addScaledVector(rays[0], 2)
  lamp.lookAt(origin)
  emitters.add(lamp)
  emitters.visible = false
  scene.add(emitters)
  const { background: capture, full } = new Cube(renderer, 64, .05, 1500, createCubeHaze(domain)).capture(scene, origin, emitters)
  const clean = new Cube(renderer, 64, .05, 1500).capture(scene, origin)
  const haze = createCameraHaze(domain)
  const format = { ...fmt, width: 1, height: 1 }
  haze.resize(format)
  const frame = { format, frameIndex: 195, frameKey: 195, tier: 'draft' as const, samples: 1, timeSeconds: 0 }
  const sample = { frame, sampleIndex: 0, timeSeconds: 0, shutter: .5, aperture: [0, 0] as [number, number],
    misc: [.5, .5] as [number, number], pixel: [0, 0] as [number, number], light: [.5, .5] as [number, number] }
  const eye = new three.PerspectiveCamera(40, 1, .05, 1500)
  eye.position.copy(origin)
  const input = new three.WebGLRenderTarget(1, 1, { type: three.HalfFloatType, depthTexture: new three.DepthTexture(1, 1, three.UnsignedIntType) })
  const output = new three.WebGLRenderTarget(1, 1, { type: three.FloatType })
  const uniforms = { captured: { value: capture }, direction: { value: new three.Vector3() } }
  const sampler = new three.Mesh(new three.PlaneGeometry(2, 2), new three.ShaderMaterial({
    uniforms,
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform samplerCube captured; uniform vec3 direction; void main(){ gl_FragColor = vec4(textureCube(captured, direction).rgb, 1.0); }',
  }))
  sampler.frustumCulled = false
  const sampleEye = new three.Camera()
  const read = () => {
    const values = new Float32Array(4)
    renderer.readRenderTargetPixels(output, 0, 0, 1, 1, values)
    return Array.from(values.slice(0, 3))
  }
  const lookup = (texture: THREE.Texture, r: THREE.Vector3) => {
    uniforms.captured.value = texture
    uniforms.direction.value.copy(r)
    renderer.setRenderTarget(output)
    renderer.render(sampler, sampleEye)
    return read()
  }
  const values = rays.map((direction) => {
    eye.lookAt(origin.clone().add(direction))
    eye.updateMatrixWorld(true)
    renderer.setRenderTarget(input)
    renderer.render(scene, eye)
    const state = { position: origin, quaternion: eye.quaternion, focalMm: 35, sensorWidthMm: 36, focusDistance: 6, fNumber: 2, near: .05, far: 1500 }
    haze.samplePasses![0].render(renderer, { color: input.texture, depth: input.depthTexture! }, output, { camera: eye, state, sample, timeSeconds: 0 })
    return { direct: read(), cube: lookup(capture, direction), clear: lookup(clean, direction) }
  })
  const lampRadiance = lookup(full, rays[0])
  input.dispose()
  output.dispose()
  renderer.dispose()
  return { values, lampRadiance, emittersHidden: !emitters.visible }
}

function captureProjector(three: typeof THREE, createCameraHaze: typeof createHaze, Rig: typeof LightRig,
  fmt: typeof config.formats.preview, halfAngle: number, lightAt: string, patchLighting: (m: THREE.Material) => void) {
  const renderer = new three.WebGLRenderer()
  const scene = new three.Scene()
  const anchor = new three.Object3D()
  anchor.position.set(0, .52, 0)
  anchor.lookAt(0, .48, 1)
  let level = 0
  const rig = new Rig([{
    id: 'projector', object: anchor, color: new three.Color(.86, .95, 1), intensity: 180,
    kind: 'spot', angle: halfAngle, size: [.04, .04], penumbra: .6,
    range: 30, shadow: false, beam: true, level: () => level,
  }], 32)
  const plate = new three.Mesh(new three.PlaneGeometry(1, 1), new three.MeshBasicMaterial({ color: 0 }))
  scene.add(anchor, rig.group, plate)
  const eye = new three.PerspectiveCamera(40, 1, .05, 60)
  const receiver = new three.Vector3(0, .4, .95)
  eye.position.set(1, .76, 5.5)
  eye.lookAt(receiver)
  eye.updateMatrixWorld(true)
  const haze = createCameraHaze({ rig, world: {
    lights: [], deck: { bounds: new three.Box2(new three.Vector2(-10, -10), new three.Vector2(10, 10)) },
  } } as Parameters<typeof createCameraHaze>[0])
  const format = { ...fmt, width: 1, height: 1 }
  haze.resize(format)
  const frameIndex = 195
  const frame = { format, frameIndex, frameKey: frameIndex, tier: 'draft' as const, samples: 1, timeSeconds: 0 }
  const sample = { frame, sampleIndex: 0, timeSeconds: 0, shutter: .5, aperture: [0, 0] as [number, number],
    misc: [.5, .5] as [number, number], pixel: [0, 0] as [number, number], light: [0, 0] as [number, number] }
  const input = new three.WebGLRenderTarget(1, 1, { type: three.HalfFloatType, depthTexture: new three.DepthTexture(1, 1, three.UnsignedIntType) })
  const output = new three.WebGLRenderTarget(1, 1, { type: three.FloatType })
  const rgb = new Float32Array(4)
  const at = (position: THREE.Vector3, focusDistance: number) => {
    plate.position.copy(position)
    plate.lookAt(eye.position)
    renderer.setRenderTarget(input)
    renderer.render(scene, eye)
    const state = { position: eye.position, quaternion: eye.quaternion, focalMm: 35, sensorWidthMm: 36,
      focusDistance, fNumber: 2, near: eye.near, far: eye.far }
    const pass = haze.samplePasses![0]
    return [0, 1].map(value => {
      level = value
      rig.update(0, [.5, .5])
      pass.render(renderer, { color: input.texture, depth: input.depthTexture! }, output, { camera: eye, state, sample, timeSeconds: 0 })
      renderer.readRenderTargetPixels(output, 0, 0, 1, 1, rgb)
      return rgb[1]
    })
  }
  const open = at(receiver, 6)
  const nose = at(receiver.clone().setZ(.18), 6)
  const closed = at(receiver.clone().lerp(eye.position, .74), 6)
  const macro = at(receiver, .8)
  const beamReceiver = new three.Vector3(.10, .39, 1.25)
  eye.position.set(.10, .46, 5.5)
  eye.lookAt(beamReceiver)
  eye.updateMatrixWorld(true)
  const suspended = at(beamReceiver, 6)
  const suspendedBlocked = at(beamReceiver.clone().lerp(eye.position, .80), 6)
  const lowReceiver = new three.Vector3(.1, .02, 1.8)
  eye.position.set(.1, .19, 5.5)
  eye.lookAt(lowReceiver)
  eye.updateMatrixWorld(true)
  const low = at(lowReceiver, 6)
  const point = new three.Vector3()
  const sampler = new three.Mesh(new three.PlaneGeometry(2, 2), new three.ShaderMaterial({
    glslVersion: three.GLSL3,
    uniforms: { ...rig.uniforms, point: { value: point } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: lightAt + `
      uniform vec3 point;
      out vec4 color;
      void main() { vec3 unused; color = vec4(filmLightAt(0, point, unused), 1.0); }
    `,
  }))
  sampler.frustumCulled = false
  const sampleEye = new three.Camera()
  const material = new three.MeshLambertMaterial()
  patchLighting(material)
  const deck = new three.Mesh(new three.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material)
  scene.remove(plate)
  scene.add(deck)
  const deckEye = new three.OrthographicCamera(-.1, .1, .1, -.1, .05, 10)
  deckEye.up.set(0, 0, 1)
  const footprint = [1, 2, 3.5, 5].map((z) => {
    point.set(0, 0, z)
    renderer.setRenderTarget(output)
    renderer.render(sampler, sampleEye)
    renderer.readRenderTargetPixels(output, 0, 0, 1, 1, rgb)
    const air = rgb[1]
    deck.position.copy(point)
    deckEye.position.copy(point).setY(1)
    deckEye.lookAt(point)
    renderer.render(scene, deckEye)
    renderer.readRenderTargetPixels(output, 0, 0, 1, 1, rgb)
    const cosine = anchor.position.y / anchor.position.distanceTo(point)
    return { air, deck: rgb[1] * Math.PI / cosine }
  })
  input.dispose()
  output.dispose()
  renderer.dispose()
  return { open: open[1] - open[0], nose: nose[1] - nose[0], closed: closed[1] - closed[0], macro: macro[1] - macro[0],
    suspended: suspended[1] - suspended[0], suspendedBlocked: suspendedBlocked[1] - suspendedBlocked[0], nearDeck: low[1] - low[0], footprint }
}

function captureWetDeck(three: typeof THREE, reflections: typeof createReflections, porous: typeof applyPorous,
  fmt: typeof config.formats.preview, draft: typeof quality.draft) {
  const renderer = new three.WebGLRenderer()
  const scene = new three.Scene()
  const root = new three.Group()
  const world = new three.Group()
  const deck = new three.Mesh(new three.PlaneGeometry(18, 20), new three.MeshStandardMaterial({ color: .0, roughness: .92 }))
  deck.rotation.x = -Math.PI / 2
  deck.position.z = -4
  world.add(deck)
  const sign = new three.Mesh(new three.PlaneGeometry(18, .4), new three.MeshBasicMaterial({ color: new three.Color(8, .12, 2) }))
  sign.position.set(0, .85, -12)
  world.add(sign)
  const parapet = new three.Mesh(new three.PlaneGeometry(2, .7), new three.MeshStandardMaterial({ color: 0x676a70, roughness: .85 }))
  parapet.position.set(4.5, .35, -7)
  world.add(parapet)
  const strip = new three.PointLight(new three.Color(1, .38, .11), 5, 3)
  strip.position.set(4.5, .58, -6.55)
  scene.add(world, root, strip)
  const relief = new three.DataTexture(new Uint8Array([0, 0, 0, 255, 255, 0, 0, 255]), 2, 1)
  relief.needsUpdate = true
  porous(deck.material, {
    surfDiag: { value: 0 }, surfRain: { value: 1 }, surfRelief: { value: relief },
    surfReliefBounds: { value: new three.Vector4(-9, -14, 18, 20) },
    surfReliefScale: { value: 64 }, surfReliefOffset: { value: -14 },
    surfShelter: { value: new three.Vector4(90, 90, 92, 92) },
    surfImpacts: { value: null }, surfImpactGrid: { value: new three.Vector4() }, surfImpactTime: { value: 0 },
    surfPulse: { value: [new three.Vector4(), new three.Vector4()] }, surfPulseTime: { value: 0 },
  }, true)
  const ref = reflections({
    renderer, scene, vehicle: { root, lamps: [] },
    world: { root: world, deck: { material: deck.material, meshes: [deck] }, reflectionBox: new three.Box3() },
  })
  const size = draft.captureSize
  const format = { ...fmt, width: size / draft.planarScale, height: size / draft.planarScale }
  ref.resize(format)
  const frame = { format, frameIndex: 195, frameKey: 195, tier: 'draft' as const, samples: 1, timeSeconds: 0 }
  const sample = { frame, sampleIndex: 0, timeSeconds: 0, shutter: .5, aperture: [0, 0] as [number, number],
    misc: [.5, .5] as [number, number], pixel: [0, 0] as [number, number], light: [.5, .5] as [number, number] }
  const eye = new three.PerspectiveCamera(-90, 1, .05, 1500)
  eye.position.y = .6
  eye.updateMatrixWorld(true)
  const state = { position: eye.position, quaternion: eye.quaternion, focalMm: 35, sensorWidthMm: 36, focusDistance: 6, fNumber: 2, near: .05, far: 1500 }
  const input = new three.WebGLRenderTarget(size, size, { type: three.FloatType })
  const output = new three.WebGLRenderTarget(1, 1, { type: three.FloatType })
  const uniforms = { captured: { value: null as THREE.Texture | null }, direction: { value: new three.Vector3() } }
  const sampler = new three.Mesh(new three.PlaneGeometry(2, 2), new three.ShaderMaterial({
    uniforms,
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform samplerCube captured; uniform vec3 direction; void main(){ gl_FragColor = vec4(textureLod(captured, direction, 0.0).rgb, 1.0); }',
  }))
  sampler.frustumCulled = false
  const sampleEye = new three.Camera()
  const read = (target: THREE.WebGLRenderTarget, x: number, y: number) => {
    const values = new Float32Array(4)
    renderer.readRenderTargetPixels(target, x, y, 1, 1, values)
    return Array.from(values.slice(0, 3))
  }
  const pixels = [[177, 143], [78, 143], [45, 131]]
  const rays = pixels.map(([x, y]) => new three.Vector3(1 - (x + .5) * 2 / size, 1 - (y + .5) * 2 / size, -1))
  const lookup = (texture: THREE.Texture) => rays.map((ray) => {
    uniforms.captured.value = texture
    uniforms.direction.value.copy(ray)
    renderer.setRenderTarget(output)
    renderer.render(sampler, sampleEye)
    return read(output, 0, 0)
  })
  ref.beginFrame!({ frame, camera: state, format })
  const cube = lookup(scene.environment!)
  const rebound = ref.planar.reflectOn.value === 0 && ref.planar.reflectSize.value.equals(new three.Vector2(size, size))
  scene.environment = null
  const planarEye = eye.clone()
  planarEye.projectionMatrix.elements[0] /= 1.18
  planarEye.projectionMatrix.elements[5] /= 1.18
  ref.beforeSample!({ camera: planarEye, state, sample, timeSeconds: 0 })
  renderer.setRenderTarget(input)
  renderer.render(scene, eye)
  const direct = pixels.map(([x, y]) => read(input, x, y))
  strip.intensity = 0
  sign.visible = false
  const viewProjection = ref.planar.reflectViewProjection.value.clone()
  const viewProjectionInverse = ref.planar.reflectInverseViewProjection.value.clone()
  ref.beginFrame!({ frame, camera: state, format })
  const cameraRestored = ref.planar.reflectViewProjection.value.equals(viewProjection)
    && ref.planar.reflectInverseViewProjection.value.equals(viewProjectionInverse)
  const off = lookup(scene.environment!)
  input.dispose()
  output.dispose()
  renderer.dispose()
  return { cube, direct, off, rebound, cameraRestored, deckVisible: deck.visible, parapetVisible: parapet.visible }
}

function sweepPlanarFilm(three: typeof THREE, box: typeof boxPatch, planar: typeof planarPatch, patch: typeof patchMaterial,
  mirrorOf: typeof mirrorCamera, tuning: typeof planarTuning, hash: typeof hash01, seed: number) {
  const renderer = new three.WebGLRenderer()
  const edge = 128
  const target = new three.WebGLRenderTarget(edge, edge, { type: three.FloatType })
  const scene = new three.Scene()
  const eye = new three.PerspectiveCamera(-90, 1, .05, 1500)
  eye.position.set(0, .6, 0)
  eye.lookAt(.017, .6, 1)
  eye.updateMatrixWorld(true)
  const mirror = new three.PerspectiveCamera()
  mirrorOf(eye, mirror, 1.18)
  const projection = new three.Matrix4().multiplyMatrices(mirror.projectionMatrix, mirror.matrixWorldInverse)
  const colors = new Uint16Array(edge * edge * 4)
  const half = three.DataUtils.toHalfFloat
  for (let y = 0; y < edge; y++) for (let x = 0; x < edge; x++) {
    const dim = (Math.floor(x / 24) + Math.floor(y / 22)) % 2 ? -.7 : .001
    const value = x % 19 < 3 && y % 13 < 2 ? 300 : dim + (x + y) % 5 * .00002
    colors.set([half(value), half(value * .58), half(value * .23), half(1)], (y * edge + x) * 4)
  }
  const image = new three.DataTexture(colors, edge, edge, three.RGBAFormat, three.HalfFloatType)
  image.generateMipmaps = true
  image.minFilter = three.LinearMipmapLinearFilter
  image.magFilter = three.LinearFilter
  image.needsUpdate = true
  const depths = new Float32Array(edge * edge).fill(.98)
  const depth = new three.DataTexture(depths, edge, edge, three.RedFormat, three.FloatType)
  depth.needsUpdate = true
  const material = new three.MeshPhysicalMaterial({ roughness: .16 })
  const slab = new three.Mesh(new three.PlaneGeometry(32, 28), material)
  slab.rotation.x = -Math.PI / 2
  slab.position.z = 9
  scene.add(slab)
  const noise = { value: 0 }
  patch(material, box({
    reflectBoxMin: { value: new three.Vector3() }, reflectBoxMax: { value: new three.Vector3() },
    reflectProbe: { value: eye.position }, reflectBoxOn: { value: 0 },
  }))
  patch(material, planar({
    reflectMap: { value: image }, reflectDepth: { value: depth },
    reflectViewProjection: { value: projection }, reflectInverseViewProjection: { value: projection.clone().invert() },
    reflectSize: { value: new three.Vector2(edge, edge) }, reflectLodMax: { value: Math.log2(edge) },
    reflectSeed: noise, reflectOn: { value: 1 }, reflectEmitters: { value: [] },
  }, tuning))
  patch(material, {
    id: 'show planar radiance',
    apply(shader) {
      shader.fragmentShader = shader.fragmentShader
        .replace(/return mix\( fallback, planar,[^\n]+;/, 'return planar;')
        .replace('#include <opaque_fragment>', 'outgoingLight = radiance;\n#include <opaque_fragment>')
    },
  })
  renderer.setRenderTarget(target)
  const measures = new Float32Array(edge * edge * 4)
  const first = new Float32Array(measures.length)
  const variation = (roughness: number) => {
    material.roughness = roughness
    noise.value = hash(seed, 195, 0)
    renderer.render(scene, eye)
    renderer.readRenderTargetPixels(target, 0, 0, edge, edge, first)
    noise.value = hash(seed, 196, 0)
    renderer.render(scene, eye)
    renderer.readRenderTargetPixels(target, 0, 0, edge, edge, measures)
    let distinct = 0
    let energy = 0
    let peak = 0
    let finite = true
    for (let p = 0; p < measures.length; p += 4) {
      if (Math.abs(first[p]! - measures[p]!) > .0002) distinct++
      energy += Math.abs(measures[p]!)
      peak = Math.max(peak, measures[p]!)
      if (!Number.isFinite(measures[p]!)) finite = false
    }
    return { distinct, energy, peak, finite }
  }
  const film = variation(.22)
  const puddle = variation(.05)
  target.dispose()
  image.dispose()
  depth.dispose()
  slab.geometry.dispose()
  material.dispose()
  renderer.dispose()
  return { film, puddle }
}

function resumeMirror(three: typeof THREE, reflections: typeof createReflections, Engine: typeof FrameEngine,
  lens: typeof applyLens, fmt: typeof config.formats.preview, frameIndex: number,
  take: number, saved: { sum: number[]; count: number } | null) {
  const renderer = new three.WebGLRenderer()
  const scene = new three.Scene()
  const world = new three.Group()
  const deck = new three.Mesh(new three.PlaneGeometry(20, 20), new three.MeshStandardMaterial({ color: 0, roughness: .11 }))
  deck.rotation.x = -Math.PI / 2
  const sign = new three.Mesh(new three.PlaneGeometry(4, .6), new three.MeshBasicMaterial({ color: new three.Color(12, .4, 2) }))
  sign.position.set(0, 2, -6)
  world.add(deck, sign)
  scene.add(world)
  const part = reflections({
    renderer, scene, vehicle: { root: new three.Group(), lamps: [] },
    world: { root: world, deck: { material: deck.material, meshes: [deck] }, reflectionBox: new three.Box3() },
  })
  const eye = new three.PerspectiveCamera()
  eye.position.set(0, 1, 4)
  eye.lookAt(0, 0, 0)
  const state = { position: eye.position.clone(), quaternion: eye.quaternion.clone(), focalMm: 35, sensorWidthMm: 36, focusDistance: 4, fNumber: 2, near: .05, far: 150 }
  const format = { ...fmt, width: 48, height: 28 }
  const stage: Stage = {
    resize: (next) => part.resize(next),
    setDiagnostic: () => undefined,
    setPaint: () => undefined,
    beginFrame: (frame) => {
      sign.position.x = 0
      part.beginFrame!({ frame, format, camera: state })
    },
    renderSample: (sample, output) => {
      sign.position.x = sample.shutter - .5
      lens(eye, state, format.width, format.height, sample, 1)
      part.beforeSample!({ sample, state, camera: eye, timeSeconds: sample.timeSeconds })
      renderer.setRenderTarget(output)
      renderer.render(scene, eye)
    },
    signs: () => [],
    anchors: () => ({}),
  }
  const engine = new Engine(renderer, stage, { resize: () => undefined, setDiagnostic: () => undefined, resolve: () => undefined }, format)
  engine.beginFrame(frameIndex, 'review')
  if (saved) engine.accumulator.write(Float32Array.from(saved.sum), saved.count)
  const count = engine.addSamples(take)
  const sum = Array.from(engine.accumulator.read())
  renderer.dispose()
  return { sum, count }
}

function verifyEmitterOwnership(three: typeof THREE, reflections: typeof createReflections, Rig: typeof LightRig,
  patch: typeof patchMaterial, filmLighting: typeof patchFilmLighting, lamp = false) {
  const renderer = new three.WebGLRenderer()
  const size = 64
  const target = new three.WebGLRenderTarget(size, size, { type: three.FloatType })
  const scene = new three.Scene()
  const world = new three.Group()
  const body = new three.Group()
  const aperture = new three.Mesh(new three.PlaneGeometry(.9, 1.7), lamp
    ? new three.MeshStandardMaterial({ emissive: new three.Color(8, 0, 0) })
    : new three.MeshBasicMaterial({ color: new three.Color(8, 0, 0) }))
  aperture.name = lamp ? 'front Y running guide' : 'graded opal face'
  aperture.position.set(0, 2, -4)
  const anchor = new three.Object3D()
  if (lamp) anchor.name = 'front running guide left origin'
  anchor.position.copy(aperture.position)
  const housing = new three.Group()
  housing.add(aperture, anchor)
  const paired: FilmLight = {
    id: lamp ? 'vehicle-glow-front-left' : 'paired aperture', kind: 'area', object: anchor, color: new three.Color(1, 0, 0),
    intensity: 25, range: 20, size: [.9, 1.7], shadow: false, beam: false, level: () => 1,
  }
  const secondAnchor = anchor.clone()
  secondAnchor.position.x += 1.2
  const unpaired: FilmLight = { ...paired, id: 'unpaired flood', object: secondAnchor, color: new three.Color(0, 0, 1) }
  const rig = new Rig([paired, unpaired], 32)
  const material = new three.MeshPhysicalMaterial({ roughness: .22, color: new three.Color(.6, .6, .6) })
  filmLighting(material)
  const floor = new three.Mesh(new three.PlaneGeometry(10, 15), material)
  floor.rotation.x = -Math.PI / 2
  floor.position.z = -2
  world.add(floor, secondAnchor)
  const apertureRoot = lamp ? body : world
  apertureRoot.add(housing)
  scene.add(world, body, rig.group)
  const format = { id: 'test', width: size, height: size }
  const eye = new three.PerspectiveCamera(47, 1, .05, 100)
  eye.position.set(0, 1.3, 3)
  eye.lookAt(0, 0, 0)
  eye.updateMatrixWorld(true)
  const state = { position: eye.position, quaternion: eye.quaternion, focalMm: 35, sensorWidthMm: 36, focusDistance: 4, fNumber: 2, near: .05, far: 100 }
  const part = reflections({ renderer, scene, rig, world: { root: world, lights: lamp ? [unpaired] : [paired, unpaired],
    deck: { meshes: [floor], material }, reflectionBox: new three.Box3() },
    vehicle: { root: body, lamps: lamp ? [{ object: anchor, stage: 0, beam: false }] : [] } })
  patch(material, {
    id: 'inspect deck light ownership',
    apply(shader) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        outgoingLight = vec3(reflectedLight.directDiffuse.r, reflectedLight.directSpecular.r, reflectedLight.directSpecular.b);
        #include <opaque_fragment>
      `)
    },
  })
  rig.update(0, [.5, .5])
  part.resize(format)
  const sampleContext: SampleContext = {
    camera: eye, state, timeSeconds: 0,
    sample: {
      frame: { format, frameIndex: 195, frameKey: 195, tier: 'draft', samples: 1, timeSeconds: 0 },
      sampleIndex: 0, timeSeconds: 0, shutter: .5, aperture: [0, 0], misc: [0, 0], pixel: [0, 0], light: [.5, .5],
    },
  }
  part.beforeSample!(sampleContext)
  const values = new Float32Array(size * size * 4)
  function measure(): number[] {
    renderer.setRenderTarget(target)
    renderer.render(scene, eye)
    renderer.readRenderTargetPixels(target, 0, 0, size, size, values)
    const peaks = [0, 0, 0]
    for (let y = 10; y < 43; y++) for (let x = 8; x < size - 8; x++) {
      const p = (y * size + x) * 4
      if (!values[p]) continue
      for (let channel = 0; channel < 3; channel++) peaks[channel] = Math.max(peaks[channel], values[p + channel])
    }
    return peaks
  }
  const owned = measure()
  aperture.visible = false
  part.beforeSample!(sampleContext)
  const analytic = measure()
  target.dispose()
  renderer.dispose()
  return { owned, analytic }
}

it('matches camera and probe reflections, keeps film strata whole, and resumes review mirrors on fresh pages', async () => {
  const id = '/reflect-test-entry.js'
  const app = await createServer({
    configFile: false,
    server: { host: '127.0.0.1', port: 0, ws: false },
    plugins: [{
      name: 'reflect-test-entry',
      resolveId: (entry) => entry === id ? id : null,
      load: (entry) => entry === id ? `
        import * as THREE from 'three'
        import { createHaze, createHazeCapture } from '/src/core/haze/index.ts'
        import { LightRig, filmLightsGlsl, patchFilmLighting, projectorHalfAngle } from '/src/core/lights.ts'
        import { createReflections, planarTuning, quality } from '/src/core/reflect/index.ts'
        import { Probe } from '/src/core/reflect/probe.ts'
        import { boxPatch, planarPatch } from '/src/core/reflect/shaders.ts'
        import { mirrorCamera } from '/src/core/reflect/mirror.ts'
        import { hash01, streamSeed } from '/src/core/random.ts'
        import { patchMaterial } from '/src/materials/patch.ts'
        import { applyPorous } from '/src/weather/surface/porous.ts'
        import { config } from '/src/config.ts'
        import { FrameEngine } from '/src/core/engine.ts'
        import { applyLens } from '/src/core/lens.ts'
        export const run = () => (${captureLamp.toString()})(THREE, createReflections, config.formats.preview)
        export const air = () => (${captureAir.toString()})(THREE, createHaze, createHazeCapture, LightRig, Probe, config.formats.preview)
        export const projector = () => (${captureProjector.toString()})(THREE, createHaze, LightRig, config.formats.preview, projectorHalfAngle, filmLightsGlsl, patchFilmLighting)
        export const deck = () => (${captureWetDeck.toString()})(THREE, createReflections, applyPorous, config.formats.preview, quality.draft)
        export const film = () => (${sweepPlanarFilm.toString()})(THREE, boxPatch, planarPatch, patchMaterial, mirrorCamera, planarTuning, hash01, streamSeed('reflect'))
        export const ownership = lamp => (${verifyEmitterOwnership.toString()})(THREE, createReflections, LightRig, patchMaterial, patchFilmLighting, lamp)
        export const review = (frameIndex, take, saved) =>
          (${resumeMirror.toString()})(THREE, createReflections, FrameEngine, applyLens, config.formats.preview, frameIndex, take, saved)
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
      const { values: views, lampRadiance, emittersHidden }: ReturnType<typeof captureAir> =
        await page.evaluate(`import("${id}").then(module => module.air())`)
      expect(errors).toEqual([])
      expect(views).toHaveLength(12)
      expect(emittersHidden).toBe(true)
      expect(lampRadiance[0]).toBeGreaterThan(views[0].cube[0] + 2)
      expect(lampRadiance[0]).toBeGreaterThan(8 * lampRadiance[1])
      let altered = 0
      for (const [i, { direct, cube, clear }] of views.entries()) {
        const length = (c: number[]) => Math.hypot(...c)
        expect(length(direct), `direction ${i}`).toBeGreaterThan(.001)
        expect(length(cube.map((channel, j) => channel - direct[j])) / length(direct), `direction ${i}`).toBeLessThan(.15)
        if (length(cube.map((channel, j) => channel - clear[j])) / length(cube) > .15) altered++
      }
      expect(altered).toBeGreaterThanOrEqual(4)
      const projector: ReturnType<typeof captureProjector> = await page.evaluate(`import("${id}").then(module => module.projector())`)
      expect(errors).toEqual([])
      expect(projector.open).toBeGreaterThan(.002)
      expect(projector.nose).toBeLessThan(projector.open)
      expect(projector.closed).toBeLessThan(projector.open * .1)
      expect(projector.macro).toBe(0)
      expect(projector.suspended).toBeGreaterThan(.002)
      expect(projector.suspendedBlocked).toBeLessThan(projector.suspended * .1)
      expect(projector.nearDeck).toBeLessThan(projector.suspended * .1)
      expect(projector.footprint[0]).toEqual({ air: 0, deck: 0 })
      for (const { air, deck } of projector.footprint.slice(1)) {
        expect(air).toBeGreaterThan(1)
        expect(deck / air).toBeCloseTo(1, 2)
      }
      const wet: ReturnType<typeof captureWetDeck> = await page.evaluate(`import("${id}").then(module => module.deck())`)
      expect(errors).toEqual([])
      expect(wet.rebound && wet.cameraRestored && wet.deckVisible && wet.parapetVisible).toBe(true)
      for (const lamp of [false, true]) {
        const { owned, analytic }: ReturnType<typeof verifyEmitterOwnership> =
          await page.evaluate(`import("${id}").then(module => module.ownership(${lamp}))`)
        expect(errors).toEqual([])
        expect(analytic[0]).toBeGreaterThan(.0001)
        expect(analytic[1]).toBeGreaterThan(.0001)
        expect(analytic[2]).toBeGreaterThan(.0001)
        expect(owned[0]).toBeCloseTo(analytic[0], 6)
        expect(owned[1]).toBeLessThan(analytic[1] * .01)
        expect(owned[2]).toBeCloseTo(analytic[2], 6)
      }
      for (const [i, direct] of wet.direct.entries()) {
        const cube = wet.cube[i]
        expect(direct[0], `wet deck ray ${i}`).toBeGreaterThan(.002)
        expect(Math.hypot(...cube.map((c, j) => c - direct[j])) / Math.hypot(...direct), `wet deck ray ${i}`).toBeLessThan(.15)
        expect(cube[0], `switched source ${i}`).toBeGreaterThan(wet.off[i][0] + .002)
      }
      expect(wet.cube[0][0]).toBeGreaterThan(wet.cube[1][0])
      expect(wet.cube[2][0]).toBeGreaterThan(2 * wet.cube[2][2])
      const strata: ReturnType<typeof sweepPlanarFilm> = await page.evaluate(`import("${id}").then(module => module.film())`)
      expect(errors).toEqual([])
      expect(strata.film.finite && strata.puddle.finite).toBe(true)
      expect(strata.film.energy).toBeGreaterThan(1)
      expect(strata.film.peak).toBeGreaterThan(1)
      expect(strata.film.distinct).toBe(0)
      expect(strata.puddle.distinct).toBeGreaterThan(0)
      await page.close()
      const total = config.tiers.review.samplesPerFrame
      const frameIndex = Math.round(config.film.heroFrameSeconds * config.film.fps)
      const review = async (take: number, saved: ReturnType<typeof resumeMirror> | null) => {
        const next = await browser.newPage()
        next.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
        try {
          await next.goto(new URL('reflect-test', app.resolvedUrls!.local[0]).href)
          return await next.evaluate(`import("${id}").then(module => module.review(${frameIndex}, ${take}, ${JSON.stringify(saved)}))`) as ReturnType<typeof resumeMirror>
        } finally {
          await next.close()
        }
      }
      const continuous = await review(total, null)
      const chunk = Math.floor(total / 3)
      const first = await review(chunk, null)
      const second = await review(chunk + 1, first)
      const resumed = await review(total - second.count, second)
      expect(errors).toEqual([])
      expect(first.count).toBe(chunk)
      expect(second.count).toBe(2 * chunk + 1)
      expect(continuous.count).toBe(total)
      expect(resumed.count).toBe(total)
      expect(continuous.sum.some((value, i) => i % 4 !== 3 && value > .05)).toBe(true)
      expect(resumed.sum.filter((value, i) => value !== continuous.sum[i])).toHaveLength(0)
    } finally {
      await browser.close()
    }
  } finally {
    await app.close()
  }
}, 45_000)
