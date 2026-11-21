import * as THREE from 'three'
import type { FormatSpec, TierId } from '../../config'
import { config } from '../../config'
import { patchMaterial, patchesOf } from '../../materials/patch'
import { layers, type FrameContext, type SampleContext } from '../contract'
import { createEmitterTable, type EmitterTable } from '../emitters'
import { createHazeCapture } from '../haze'
import { applyLens } from '../lens'
import type { StageDeps, StagePart } from '../parts'
import { hash01, streamSeed } from '../random'
import { mirrorEmitters } from './emitters'
import { probeLamps } from './lamps'
import { mirrorCamera } from './mirror'
import { Probe } from './probe'
import { boxPatch, planarPatch, type BoxUniforms, type PlanarUniforms } from './shaders'
import { stripeEnvironment, zebraMirror } from './zebra'

export interface Quality {
  /** Edge of one cube face of the environment capture, in pixels. */
  captureSize: number
  /** Whether the deck inside the capture also gets broad first-bounce lighting. */
  bounce: boolean
  /** Fraction of the frame the planar target is drawn at. Sub-render jitter fills in the detail over the samples. */
  planarScale: number
  /** Redraw for every sample instead of caching a single frame-center mirror. */
  planarEverySample: boolean
}

export const quality: Record<TierId, Quality> = {
  draft: { captureSize: 256, bounce: false, planarScale: 0.5, planarEverySample: false },
  review: { captureSize: 512, bounce: false, planarScale: 0.5, planarEverySample: false },
  final: { captureSize: 1024, bounce: true, planarScale: 0.5, planarEverySample: true },
}
const paintBeat = config.beats.find(({ id }) => id === 'paint')!
const isPaintBeat = (time: number): boolean => time >= paintBeat.start && time < paintBeat.end

export function reflectionCaptureSize(tier: TierId, time: number): number {
  const captureSize = quality[tier].captureSize
  return isPaintBeat(time) ? Math.max(captureSize, quality.final.captureSize) : captureSize
}

/** The first bounce that lights the deck inside the capture only needs the broad shapes of the sky and signs. */
const bounceSize = 128
const probeHeight = 0.6
const captureNear = 0.05
const captureFar = 1500
const cubePlanarGuard = 1.18
export const planarTuning = {
  taps: 4, filter: 0.7, roughStart: 0.55, roughEnd: 0.9, far: 4000, tail: 0.2,
  filmStart: 0.06, filmEnd: 0.13, mipStart: 0.075, mipEnd: 0.20,
}

export interface ReflectionsPart extends StagePart {
  /** For other parts: the planar reflection of the deck and how to look it up. See `src/core/reflect/README.md`. */
  planar: PlanarUniforms
  box: BoxUniforms
  /** The glint emitter table behind `emitterUniforms`. See `src/core/emitters.ts`. */
  glints: EmitterTable
}

interface ReflectionDeps extends Pick<StageDeps, 'renderer' | 'scene'> {
  rig?: StageDeps['rig']
  world: Pick<StageDeps['world'], 'root' | 'reflectionBox'> & {
    lights?: StageDeps['world']['lights']
    optics?: StageDeps['world']['optics']
    deck: Pick<StageDeps['world']['deck'], 'material' | 'meshes'> & Partial<Pick<StageDeps['world']['deck'], 'bounds'>>
  }
  vehicle: Pick<StageDeps['vehicle'], 'root' | 'lamps'>
}

function planarSize(format: FormatSpec, planarScale: number): THREE.Vector2 {
  return new THREE.Vector2(Math.round(format.width * planarScale), Math.round(format.height * planarScale))
}

interface PlanarCapture {
  raw: THREE.WebGLRenderTarget
  color: THREE.WebGLRenderTarget
}

function planarTarget(size: THREE.Vector2, atmosphere: boolean): PlanarCapture {
  const color = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: !atmosphere,
  })
  const raw = atmosphere ? new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  }) : color
  raw.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.FloatType)
  raw.depthTexture.minFilter = THREE.NearestFilter
  raw.depthTexture.magFilter = THREE.NearestFilter
  return { raw, color }
}

function lodMax(size: THREE.Vector2): number {
  return Math.floor(Math.log2(Math.max(size.x, size.y)))
}

function isLit(material: THREE.Material): material is THREE.MeshStandardMaterial {
  return (material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true
}

function materialsOf(root: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const found = new Set<THREE.MeshStandardMaterial>()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (isLit(m)) found.add(m)
  })
  return [...found]
}

function deckDetails(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = []
  const materials = new Set<THREE.MeshStandardMaterial>()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const stripe = /^(parking bay stripes|hero near bay line)$/.test(mesh.name)
    const grate = mesh.parent?.name.endsWith('drain grate')
    if (!stripe && !grate) return
    meshes.push(mesh)
    if (grate && mesh.name.endsWith('slot bed')) return
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (isLit(m)) materials.add(m)
  })
  return { meshes, materials }
}

export function createReflections(deps: ReflectionDeps): ReflectionsPart {
  const { renderer, scene, world, vehicle } = deps
  const lamps = probeLamps(vehicle)
  const emitters = mirrorEmitters(world.lights ?? [], deps.rig, lamps.mirrorApertures)
  const hazeCapture = deps.rig && world.lights && world.deck.bounds
    ? createHazeCapture({ rig: deps.rig, world: { lights: world.lights, deck: { bounds: world.deck.bounds } } })
    : undefined
  const seed = streamSeed('reflect')
  let format = config.formats.master
  let tier: TierId = 'final'
  let size = planarSize(format, quality[tier].planarScale)
  let target = planarTarget(size, !!hazeCapture)
  let diagnostic = 'beauty'
  let captureTime = 0
  let cacheCameraPlanar = false
  const frameEye = new THREE.PerspectiveCamera()
  const mirror = new THREE.PerspectiveCamera()
  mirror.layers.set(layers.scene)

  const planar: PlanarUniforms = {
    reflectMap: { value: target.color.texture },
    reflectDepth: { value: target.raw.depthTexture },
    reflectViewProjection: { value: new THREE.Matrix4() },
    reflectInverseViewProjection: { value: new THREE.Matrix4() },
    reflectSize: { value: size.clone() },
    reflectLodMax: { value: lodMax(size) },
    reflectSeed: { value: 0 },
    reflectOn: { value: 0 },
    reflectEmitters: emitters.positions,
  }
  const box: BoxUniforms = {
    reflectBoxMin: { value: world.reflectionBox.min.clone() },
    reflectBoxMax: { value: world.reflectionBox.max.clone() },
    reflectProbe: { value: new THREE.Vector3() },
    reflectBoxOn: { value: 1 },
  }
  const boxed = boxPatch(box)
  const paintCoatDetail = { value: 0 }
  const boxedPaint = boxPatch(box, paintCoatDetail)
  const patchAll = (): void => {
    for (const m of [world.deck.material, ...materialsOf(world.root)]) patchMaterial(m, boxed)
    for (const m of materialsOf(vehicle.root)) {
      patchMaterial(m, patchesOf(m).includes('vehicle paint stack') ? boxedPaint : boxed)
    }
  }
  patchAll()
  patchMaterial(world.deck.material, planarPatch(planar, planarTuning))
  const details = deckDetails(world.root)
  const detailPlanar = planarPatch(planar, planarTuning, true)
  for (const material of details.materials) {
    if (material !== world.deck.material) patchMaterial(material, detailPlanar)
  }
  const planarMeshes = [...world.deck.meshes, ...details.meshes]

  const probes = new Map<number, Probe>()
  const bindPlanar = (destination: PlanarCapture): void => {
    planar.reflectMap.value = destination.color.texture
    planar.reflectDepth.value = destination.raw.depthTexture
    planar.reflectSize.value.set(destination.color.width, destination.color.height)
    planar.reflectLodMax.value = lodMax(planar.reflectSize.value)
  }
  const fitTarget = (): void => {
    const next = planarSize(format, quality[tier].planarScale)
    if (next.equals(size)) return
    size = next
    if (target.raw !== target.color) target.raw.dispose()
    target.color.dispose()
    target = planarTarget(size, !!hazeCapture)
    bindPlanar(target)
  }
  const bounce = new Probe(renderer, bounceSize, captureNear, captureFar)
  const glints = createEmitterTable({ renderer, world, vehicle })
  scene.add(lamps.root)
  const probePosition = new THREE.Vector3()
  const cameraPlanarVP = new THREE.Matrix4()
  const cameraPlanarInverseVP = new THREE.Matrix4()
  const carCaptureReceivers = new Set<THREE.MeshStandardMaterial>()
  let deckCaptureIntensity: number | undefined
  let stripes: THREE.Texture | null = null
  const mirrorMaterial = zebraMirror()
  const swapped = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()

  const hide = (objects: THREE.Object3D[]): (() => void) => {
    const was = objects.map((o) => o.visible)
    for (const o of objects) o.visible = false
    return () => objects.forEach((o, i) => (o.visible = was[i]))
  }

  const renderPlanar = (eye: THREE.PerspectiveCamera, destination: PlanarCapture, time: number, guard = 1): void => {
    planar.reflectOn.value = 0
    planar.reflectMap.value = null
    planar.reflectDepth.value = null
    mirrorCamera(eye, mirror, guard)
    planar.reflectViewProjection.value.multiplyMatrices(mirror.projectionMatrix, mirror.matrixWorldInverse)
    planar.reflectInverseViewProjection.value.copy(planar.reflectViewProjection.value).invert()
    const previous = renderer.getRenderTarget()
    const face = renderer.getActiveCubeFace()
    const mip = renderer.getActiveMipmapLevel()
    const color = renderer.getClearColor(new THREE.Color())
    const alpha = renderer.getClearAlpha()
    const showDeck = hide(planarMeshes)
    try {
      renderer.setRenderTarget(destination.raw)
      renderer.setClearColor(0x000000, 1)
      renderer.clear(true, true, false)
      emitters.withRadiance(time, () => lamps.withDeckRadiance(mirror.position, () => renderer.render(scene, mirror)))
      hazeCapture?.renderFarAir(renderer, destination.raw, destination.color, mirror)
    } finally {
      showDeck()
      renderer.setClearColor(color, alpha)
      renderer.setRenderTarget(previous, face, mip)
    }
    bindPlanar(destination)
    emitters.update(planar.reflectViewProjection.value, mirror.layers)
    planar.reflectOn.value = 1
  }

  const probeOf = (edge: number): Probe => {
    let probe = probes.get(edge)
    if (!probe) {
      const deckMirror = planarMeshes.length ? planarTarget(new THREE.Vector2(edge, edge), !!hazeCapture) : null
      probe = new Probe(renderer, edge, captureNear, captureFar, hazeCapture, deckMirror
        ? (eye, face) => {
            if (face === 2) planar.reflectOn.value = 0
            else renderPlanar(eye, deckMirror, captureTime, cubePlanarGuard)
          }
        : undefined)
      probes.set(edge, probe)
    }
    return probe
  }

  const clearBackground = (): void => {
    for (const material of carCaptureReceivers) material.envMap = null
    carCaptureReceivers.clear()
    if (deckCaptureIntensity !== undefined) {
      world.deck.material.envMap = null
      world.deck.material.envMapIntensity = deckCaptureIntensity
      deckCaptureIntensity = undefined
    }
  }

  const setCarEnvironment = (texture: THREE.Texture): void => {
    for (const material of materialsOf(vehicle.root)) {
      if (material.envMap) continue
      carCaptureReceivers.add(material)
      material.envMap = texture
    }
  }

  const setDeckEnvironment = (texture: THREE.Texture): void => {
    const material = world.deck.material
    if (material.envMap) return
    deckCaptureIntensity = material.envMapIntensity
    material.envMap = texture
    material.envMapIntensity = scene.environmentIntensity
  }

  const setEnvironment = (full: THREE.Texture, background?: THREE.Texture): void => {
    scene.environment = full
    setCarEnvironment(background ?? full)
    if (background) setDeckEnvironment(background)
  }

  const capture = (frameKey: number): void => {
    vehicle.root.updateWorldMatrix(true, false)
    probePosition.setFromMatrixPosition(vehicle.root.matrixWorld)
    probePosition.y += probeHeight
    box.reflectProbe.value.copy(probePosition)
    box.reflectBoxMin.value.copy(world.reflectionBox.min)
    box.reflectBoxMax.value.copy(world.reflectionBox.max)
    box.reflectBoxOn.value = 1
    cameraPlanarVP.copy(planar.reflectViewProjection.value)
    cameraPlanarInverseVP.copy(planar.reflectInverseViewProjection.value)
    planar.reflectOn.value = 0
    planar.reflectSeed.value = hash01(seed, frameKey, 0)
    clearBackground()
    lamps.sync()
    const showVehicle = hide([vehicle.root])
    const showDeck = hide(world.deck.meshes)
    try {
      scene.environment = null
      if (quality[tier].bounce) scene.environment = bounce.capture(scene, probePosition)
      showDeck()
      const probe = probeOf(reflectionCaptureSize(tier, captureTime))
      if (lamps.root.children.some((emitter) => emitter.visible)) {
        const { full, background } = probe.capture(scene, probePosition, lamps.root)
        setEnvironment(full, background)
      } else setEnvironment(probe.capture(scene, probePosition))
    } finally {
      planar.reflectOn.value = 0
      bindPlanar(target)
      planar.reflectViewProjection.value.copy(cameraPlanarVP)
      planar.reflectInverseViewProjection.value.copy(cameraPlanarInverseVP)
      showDeck()
      showVehicle()
    }
  }

  const setZebra = (on: boolean): void => {
    if (on) {
      stripes ??= stripeEnvironment(renderer)
      vehicle.root.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh || swapped.has(mesh)) return
        swapped.set(mesh, mesh.material)
        mesh.material = mirrorMaterial
      })
    } else {
      for (const [mesh, material] of swapped) mesh.material = material
      swapped.clear()
    }
  }

  return {
    planar,
    box,
    glints,
    resize(next) {
      format = next
      fitTarget()
    },
    setDiagnostic(view) {
      clearBackground()
      diagnostic = view
      setZebra(view === 'zebra')
    },
    beginFrame({ frame, camera }: FrameContext) {
      tier = frame.tier
      captureTime = frame.timeSeconds
      paintCoatDetail.value = Number(isPaintBeat(captureTime))
      cacheCameraPlanar = frame.samples > 1 && !quality[tier].planarEverySample
      fitTarget()
      patchAll()
      if (diagnostic === 'normals' || diagnostic === 'zebra') glints.clear()
      else glints.update(camera.position)
      if (diagnostic === 'normals') return
      if (diagnostic === 'zebra') {
        box.reflectBoxOn.value = 0
        planar.reflectOn.value = 0
        scene.environment = stripes
        return
      }
      capture(frame.frameKey)
      if (cacheCameraPlanar && (diagnostic === 'beauty' || diagnostic === 'wetness')) {
        applyLens(frameEye, camera, format.width, format.height, { pixel: [0, 0], aperture: [0, 0] }, 1)
        renderPlanar(frameEye, target, frame.timeSeconds)
      }
    },
    beforeSample(sample: SampleContext) {
      planar.reflectOn.value = 0
      glints.setPixelAngle(sample.camera, format.height)
      if (diagnostic !== 'beauty' && diagnostic !== 'wetness') return
      planar.reflectSeed.value = hash01(seed, sample.sample.frame.frameKey, sample.sample.sampleIndex)
      if (cacheCameraPlanar) {
        emitters.update(planar.reflectViewProjection.value, mirror.layers)
        planar.reflectOn.value = 1
      } else renderPlanar(sample.camera, target, sample.timeSeconds)
    },
  }
}
