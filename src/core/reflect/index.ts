import * as THREE from 'three'
import type { FormatSpec } from '../../config'
import { config } from '../../config'
import { patchMaterial } from '../../materials/patch'
import { layers, type FrameContext, type SampleContext } from '../contract'
import type { StageDeps, StagePart } from '../parts'
import { hash01, streamSeed } from '../random'
import { mirrorCamera } from './mirror'
import { Probe } from './probe'
import { boxPatch, planarPatch, type BoxUniforms, type PlanarUniforms } from './shaders'
import { stripeEnvironment, zebraMirror } from './zebra'

/** Edge of one cube face of the environment capture, in pixels. */
export const captureSize = 1024
/** The first bounce that lights the deck inside the capture only needs the broad shapes of the sky and signs. */
const bounceSize = 128
const probeHeight = 0.6
const captureNear = 0.05
const captureFar = 1500
/** The planar target is drawn at this fraction of the frame. Sub-render jitter fills in the rest over the samples. */
const planarScale = 0.5
const planarTuning = { taps: 4, filter: 0.7, roughStart: 0.55, roughEnd: 0.9, far: 4000, tail: 0.2 }

export interface ReflectionsPart extends StagePart {
  /** For other parts: the planar reflection of the deck and how to look it up. See `src/core/reflect/README.md`. */
  planar: PlanarUniforms
  box: BoxUniforms
}

function planarSize(format: FormatSpec): THREE.Vector2 {
  return new THREE.Vector2(Math.round(format.width * planarScale), Math.round(format.height * planarScale))
}

function planarTarget(format: FormatSpec): THREE.WebGLRenderTarget {
  const size = planarSize(format)
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: true,
  })
  target.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.FloatType)
  target.depthTexture.minFilter = THREE.NearestFilter
  target.depthTexture.magFilter = THREE.NearestFilter
  return target
}

function lodMax(format: FormatSpec): number {
  const size = planarSize(format)
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

export function createReflections(deps: StageDeps): ReflectionsPart {
  const { renderer, scene, world, vehicle } = deps
  const seed = streamSeed('reflect')
  let format = config.formats.master
  let target = planarTarget(format)
  let diagnostic = 'beauty'
  const mirror = new THREE.PerspectiveCamera()
  mirror.layers.set(layers.scene)

  const planar: PlanarUniforms = {
    reflectMap: { value: target.texture },
    reflectDepth: { value: target.depthTexture },
    reflectViewProjection: { value: new THREE.Matrix4() },
    reflectInverseViewProjection: { value: new THREE.Matrix4() },
    reflectSize: { value: planarSize(format) },
    reflectLodMax: { value: lodMax(format) },
    reflectSeed: { value: 0 },
    reflectOn: { value: 0 },
  }
  const box: BoxUniforms = {
    reflectBoxMin: { value: world.reflectionBox.min.clone() },
    reflectBoxMax: { value: world.reflectionBox.max.clone() },
    reflectProbe: { value: new THREE.Vector3() },
    reflectBoxOn: { value: 1 },
  }
  const boxed = boxPatch(box)
  const patchAll = (): void => {
    for (const m of [world.deck.material, ...materialsOf(world.root), ...materialsOf(vehicle.root)]) patchMaterial(m, boxed)
  }
  patchAll()
  patchMaterial(world.deck.material, planarPatch(planar, planarTuning))

  const probe = new Probe(renderer, captureSize, captureNear, captureFar)
  const bounce = new Probe(renderer, bounceSize, captureNear, captureFar)
  const probePosition = new THREE.Vector3()
  let stripes: THREE.Texture | null = null
  const mirrorMaterial = zebraMirror()
  const swapped = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()

  const hide = (objects: THREE.Object3D[]): (() => void) => {
    const was = objects.map((o) => o.visible)
    for (const o of objects) o.visible = false
    return () => objects.forEach((o, i) => (o.visible = was[i]))
  }

  const capture = (): void => {
    vehicle.root.updateWorldMatrix(true, false)
    probePosition.setFromMatrixPosition(vehicle.root.matrixWorld)
    probePosition.y += probeHeight
    box.reflectProbe.value.copy(probePosition)
    box.reflectBoxMin.value.copy(world.reflectionBox.min)
    box.reflectBoxMax.value.copy(world.reflectionBox.max)
    box.reflectBoxOn.value = 1
    planar.reflectOn.value = 0
    const showVehicle = hide([vehicle.root])
    const showDeck = hide(world.deck.meshes)
    scene.environment = null
    scene.environment = bounce.capture(scene, probePosition)
    showDeck()
    scene.environment = probe.capture(scene, probePosition)
    showVehicle()
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
    resize(next) {
      format = next
      target.dispose()
      target = planarTarget(format)
      planar.reflectMap.value = target.texture
      planar.reflectDepth.value = target.depthTexture
      planar.reflectSize.value.copy(planarSize(format))
      planar.reflectLodMax.value = lodMax(format)
    },
    setDiagnostic(view) {
      diagnostic = view
      setZebra(view === 'zebra')
    },
    beginFrame(_frame: FrameContext) {
      patchAll()
      if (diagnostic === 'normals') return
      if (diagnostic === 'zebra') {
        box.reflectBoxOn.value = 0
        planar.reflectOn.value = 0
        scene.environment = stripes
        return
      }
      capture()
    },
    beforeSample(sample: SampleContext) {
      planar.reflectOn.value = 0
      if (diagnostic !== 'beauty' && diagnostic !== 'wetness') return
      mirrorCamera(sample.camera, mirror)
      planar.reflectViewProjection.value.multiplyMatrices(mirror.projectionMatrix, mirror.matrixWorldInverse)
      planar.reflectInverseViewProjection.value.copy(planar.reflectViewProjection.value).invert()
      planar.reflectSeed.value = hash01(seed, sample.sample.frame.frameKey, sample.sample.sampleIndex)
      const previous = renderer.getRenderTarget()
      const color = renderer.getClearColor(new THREE.Color())
      const alpha = renderer.getClearAlpha()
      const showDeck = hide(world.deck.meshes)
      renderer.setRenderTarget(target)
      renderer.setClearColor(0x000000, 1)
      renderer.clear(true, true, false)
      renderer.render(scene, mirror)
      showDeck()
      renderer.setClearColor(color, alpha)
      renderer.setRenderTarget(previous)
      planar.reflectOn.value = 1
    },
  }
}
