import * as THREE from 'three'
import type { VehicleModule } from '../vehicle'
import { emitterUniforms, maxEmitters, waterF0, type EmitterUniforms, type GlintEmitter } from './emitters-glsl'
import { atmosphere } from './haze'
import { layers, type FilmLight } from './contract'
import { lampSources } from './reflect/lamps'

export * from './emitters-glsl'

export interface Emitter extends GlintEmitter {
  id: string
  /** Rects of one fixture. A rank keeps only a few of each so a row of identical fittings cannot fill the table. */
  group?: string
  /** A face of one of the world's area FilmLights, the keys of the film. Always in the table. */
  key?: boolean
  /** Lettering or a sign face: what reads as a coloured point in the paint even when white practicals outshine it. */
  sign?: boolean
}

export const perGroup = 2
export const lampSlots = 4
export const signSlots = 6
const signName = /lettering|sign face/
/** Rects ranked by their raw score before the occlusion rays are cast. */
export const visibilityShortlist = 96

/** A face this big on both sides is split 2x2 so an animated wall keeps its colour regions. A strip stays one rect. */
export const splitLength = 8
const tile = 8
const atlasColumns = 32
const minRadiance = 1e-4
const rayInset = 0.02
const overlayTolerance = 0.02
const rayPoints: ReadonlyArray<readonly [number, number]> = [[0, 0], [-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]
export const visibilityLift = 0.5

export function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

/** Solid angle of the rect seen from `at`, with the cosine of the face toward `at`. */
export function solidAngle(e: GlintEmitter, at: THREE.Vector3): number {
  const n = e.u.clone().cross(e.v)
  const area = 4 * n.length()
  const toE = e.center.clone().sub(at)
  const d2 = Math.max(toE.lengthSq(), 1e-6)
  const facing = Math.max(0, -toE.dot(n) / (Math.sqrt(d2) * Math.max(n.length(), 1e-12)))
  return Math.min(area * facing / d2, 2 * Math.PI)
}

/**
 * What the emitter puts into the reflections the camera sees on the car: radiance times its solid angle at the car,
 * times water Fresnel at the half vector between it and the camera, so the city behind the car outranks fittings behind the camera.
 */
export function emitterScore(e: Emitter, focus: THREE.Vector3, eye?: THREE.Vector3): number {
  let fresnel = 1
  if (eye) {
    const D = e.center.clone().sub(focus).normalize()
    const V = eye.clone().sub(focus).normalize()
    const H = D.add(V)
    const c = H.lengthSq() > 1e-12 ? H.normalize().dot(V) : 0
    fresnel = waterF0 + (1 - waterF0) * (1 - Math.min(1, Math.max(0, c))) ** 5
  }
  return luminance(e.radiance) * solidAngle(e, focus) * fresnel * e.visibility
}

const byScore = (a: { e: Emitter; score: number }, b: { e: Emitter; score: number }): number =>
  b.score - a.score || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0)

/**
 * Key faces first, then up to `lampSlots` lamps by radiance times area, then the best face of up to `signSlots` signs, then the rest brightest first with at most `cap` faces of one fixture.
 * Ties keep id order so the table never depends on traversal or sort stability.
 */
export function rankEmitters(list: readonly Emitter[], focus: THREE.Vector3, max = maxEmitters, cap = perGroup, eye?: THREE.Vector3): Emitter[] {
  const scored = list
    .map((e) => ({ e, score: e.lamp ? luminance(e.radiance) * 4 * e.u.clone().cross(e.v).length() * e.visibility : emitterScore(e, focus, eye) }))
    .filter(({ e, score }) => (score > 0 || (e.key && luminance(e.radiance) > 0)) && Number.isFinite(score))
    .sort(byScore)
  const kept: Emitter[] = scored.filter(({ e }) => e.key).map(({ e }) => e).slice(0, max)
  for (const { e } of scored.filter(({ e }) => e.lamp && !e.key).slice(0, lampSlots)) if (kept.length < max) kept.push(e)
  const signs = new Set<string>()
  for (const { e } of scored) {
    if (signs.size >= signSlots || kept.length >= max) break
    if (!e.sign || e.key || e.lamp || signs.has(e.group ?? e.id)) continue
    signs.add(e.group ?? e.id)
    kept.push(e)
  }
  const taken = new Map<string, Set<string>>()
  for (const { e } of scored) {
    if (kept.length >= max) break
    if (e.key || e.lamp || kept.includes(e)) continue
    const group = e.group ?? e.id
    const face = e.id.slice(0, Math.max(0, e.id.lastIndexOf('/'))) || e.id
    const faces = taken.get(group) ?? new Set<string>()
    if (!faces.has(face) && faces.size >= cap) continue
    faces.add(face)
    taken.set(group, faces)
    kept.push(e)
  }
  return kept
}

/** Coplanar faces drawn over each other, such as lettering over its cabinet, add up into one rect. */
export function mergeOverlays(list: readonly Emitter[]): Emitter[] {
  const out: Emitter[] = []
  for (const e of list) {
    const n = e.u.clone().cross(e.v).normalize()
    const sizes = [e.u.length(), e.v.length()].sort((x, y) => x - y)
    const same = out.find((o) => {
      if (o.lamp || e.lamp || o.center.distanceTo(e.center) >= overlayTolerance) return false
      const other = [o.u.length(), o.v.length()].sort((x, y) => x - y)
      return Math.abs(other[0] - sizes[0]) < overlayTolerance && Math.abs(other[1] - sizes[1]) < overlayTolerance && o.u.clone().cross(o.v).normalize().dot(n) > 0.99
    })
    if (!same) {
      out.push({ ...e, center: e.center.clone(), radiance: e.radiance.clone() })
      continue
    }
    same.radiance.add(e.radiance)
    same.key = same.key || e.key
    if (e.sign && !same.sign) Object.assign(same, { id: e.id, group: e.group, sign: true })
  }
  return out
}

export function writeEmitters(list: readonly Emitter[], uniforms: EmitterUniforms = emitterUniforms): void {
  const count = Math.min(list.length, maxEmitters)
  uniforms.emitterCount.value = count
  for (let i = 0; i < maxEmitters; i++) {
    const e = list[i]
    if (i >= count || !e) {
      uniforms.emitterCenter.value[i].set(0, 0, 0, 0)
      uniforms.emitterAxisU.value[i].set(0, 0, 0, 0)
      uniforms.emitterAxisV.value[i].set(0, 0, 0, 0)
      uniforms.emitterRadiance.value[i].set(0, 0, 0, 0)
      continue
    }
    uniforms.emitterCenter.value[i].set(e.center.x, e.center.y, e.center.z, e.visibility)
    uniforms.emitterAxisU.value[i].set(e.u.x, e.u.y, e.u.z, e.lamp ? 1 : 0)
    uniforms.emitterAxisV.value[i].set(e.v.x, e.v.y, e.v.z, 0)
    uniforms.emitterRadiance.value[i].set(e.radiance.r, e.radiance.g, e.radiance.b, 0)
  }
}

/** Haze between the vehicle and the emitter, the near air and the city layer of the haze pass, without height falloff. */
export function airTransmittance(distance: number): number {
  const near = Math.min(distance, atmosphere.localAirRange)
  const city = Math.max(0, distance - atmosphere.localAirRange)
  const outer = Math.max(0, distance - atmosphere.outerCityStart)
  return Math.exp(-(atmosphere.uniformExtinction * near + atmosphere.cityExtinction * city + atmosphere.outerCityExtinction * outer))
}

/** Oriented boxes of the world's big solid blocks, enough to tell a sign behind a tower from one in the open. */
export class Occluders {
  private readonly inverse: THREE.Matrix4[] = []
  private readonly half: THREE.Vector3[] = []
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()

  constructor(root: THREE.Object3D, minThickness = 0.3, minSpan = 3) {
    root.updateWorldMatrix(true, true)
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || !visibleChain(mesh)) return
      if (!(mesh.geometry instanceof THREE.BoxGeometry) || !mesh.layers.isEnabled(layers.scene)) return
      const { width, height, depth } = mesh.geometry.parameters
      const scale = new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld)
      const size = [width * scale.x, height * scale.y, depth * scale.z]
      if (Math.min(...size) < minThickness || Math.max(...size) < minSpan) return
      this.inverse.push(mesh.matrixWorld.clone().invert())
      this.half.push(new THREE.Vector3(width / 2, height / 2, depth / 2))
    })
  }

  get count(): number {
    return this.inverse.length
  }

  blocked(from: THREE.Vector3, to: THREE.Vector3): boolean {
    for (let i = 0; i < this.inverse.length; i++) {
      const h = this.half[i]
      const a = this.a.copy(from).applyMatrix4(this.inverse[i])
      const b = this.b.copy(to).applyMatrix4(this.inverse[i])
      if (Math.abs(b.x) <= h.x && Math.abs(b.y) <= h.y && Math.abs(b.z) <= h.z) continue
      let t0 = 0
      let t1 = 1
      for (const k of ['x', 'y', 'z'] as const) {
        const d = b[k] - a[k]
        if (Math.abs(d) < 1e-12) {
          if (Math.abs(a[k]) > h[k]) {
            t0 = 2
            break
          }
          continue
        }
        let n = (-h[k] - a[k]) / d
        let f = (h[k] - a[k]) / d
        if (n > f) [n, f] = [f, n]
        t0 = Math.max(t0, n)
        t1 = Math.min(t1, f)
        if (t0 > t1) break
      }
      if (t0 <= t1) return true
    }
    return false
  }

  /** Fraction of a few rays from `from` to points on the rect, each stopped just short of the face. */
  visibility(from: THREE.Vector3, e: GlintEmitter): number {
    const normal = e.u.clone().cross(e.v).normalize()
    let open = 0
    const point = new THREE.Vector3()
    for (const [x, y] of rayPoints) {
      point.copy(e.center).addScaledVector(e.u, x).addScaledVector(e.v, y).addScaledVector(normal, rayInset)
      if (!this.blocked(from, point)) open++
    }
    return open / rayPoints.length
  }
}

function visibleChain(object: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false
  return true
}

interface Face {
  mesh: THREE.Mesh
  width: number
  height: number
  /** The material and placement this face's tile was last drawn with. */
  drawn: string
}

function stateOf(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return String(value)
  if (Array.isArray(value)) return `[${value.map(stateOf).join(',')}]`
  const texture = value as THREE.Texture
  if (texture.isTexture) return `t${texture.id}:${texture.version}`
  const any = value as { toArray?: () => number[]; elements?: ArrayLike<number> }
  if (any.elements) return Array.from(any.elements).join(',')
  if (any.toArray) return any.toArray().join(',')
  return '?'
}

/** Everything a face's draw depends on. Same state, same pixels, so the tile can be kept across frames. */
function faceState(face: Face): string {
  const material = face.mesh.material as THREE.Material & { uniforms?: Record<string, THREE.IUniform>; emissive?: THREE.Color; emissiveIntensity?: number; map?: THREE.Texture | null; color?: THREE.Color }
  const parts = [material.uuid, stateOf(Object.values((material as { defines?: Record<string, unknown> }).defines ?? {})), Array.from(face.mesh.matrixWorld.elements).join(',')]
  if (material.uniforms) for (const name of Object.keys(material.uniforms)) parts.push(name, stateOf(material.uniforms[name].value))
  parts.push(stateOf(material.emissive), stateOf(material.emissiveIntensity), stateOf(material.map), stateOf(material.color), String(material.opacity))
  return parts.join('|')
}

function emitsLight(material: THREE.Material): boolean {
  if ((material as THREE.ShaderMaterial).isShaderMaterial || (material as THREE.MeshBasicMaterial).isMeshBasicMaterial) return true
  const standard = material as THREE.MeshStandardMaterial
  return standard.isMeshStandardMaterial === true && standard.emissiveIntensity > 0 && luminance(standard.emissive) > 0
}

function sceneFaces(root: THREE.Object3D): Face[] {
  const faces: Face[] = []
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || !(mesh.geometry instanceof THREE.PlaneGeometry)) return
    if (Array.isArray(mesh.material) || !emitsLight(mesh.material)) return
    const { width, height } = mesh.geometry.parameters
    faces.push({ mesh, width, height, drawn: '' })
  })
  return faces
}

/** World rect of a plane face: centre, half axes, the face's front along cross(u, v). */
function faceRect(face: Face): { center: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 } {
  const m = face.mesh.matrixWorld
  const center = new THREE.Vector3().setFromMatrixPosition(m)
  const u = new THREE.Vector3().setFromMatrixColumn(m, 0).multiplyScalar(face.width / 2)
  const v = new THREE.Vector3().setFromMatrixColumn(m, 1).multiplyScalar(face.height / 2)
  const front = new THREE.Vector3(0, 0, 1).applyMatrix3(new THREE.Matrix3().getNormalMatrix(m))
  if (u.clone().cross(v).dot(front) < 0) v.negate()
  return { center, u, v }
}

/** Split counts along u and v for a face of these half axes. */
export function splitOf(u: THREE.Vector3, v: THREE.Vector3): [number, number] {
  const wall = 2 * Math.min(u.length(), v.length()) >= splitLength
  return wall ? [2, 2] : [1, 1]
}

/** Lamp rect from the lamp mesh's box: the two widest sides, facing along the lamp's light. */
function lampRect(mesh: THREE.Mesh, origin: THREE.Object3D): { center: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 } | null {
  const geometry = mesh.geometry
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const range = geometry.boundingBox
  if (!range || range.isEmpty()) return null
  const m = mesh.matrixWorld
  const center = range.getCenter(new THREE.Vector3()).applyMatrix4(m)
  const size = range.getSize(new THREE.Vector3())
  const axes = [0, 1, 2].map((k) => new THREE.Vector3().setFromMatrixColumn(m, k).multiplyScalar(size.getComponent(k) / 2))
  const order = [0, 1, 2].sort((a, b) => axes[b].length() - axes[a].length() || a - b)
  const u = axes[order[0]].clone()
  const v = axes[order[1]].clone()
  if (u.lengthSq() === 0 || v.lengthSq() === 0) return null
  const light = new THREE.Vector3(0, 0, 1).transformDirection(origin.matrixWorld)
  if (u.clone().cross(v).dot(light) < 0) v.negate()
  return { center, u, v }
}

const bodyMargin = 0.05

/** The vehicle's box in its own space. */
function vehicleBox(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3()
  const inverse = root.matrixWorld.clone().invert()
  const part = new THREE.Box3()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !visibleChain(mesh)) return
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    const range = mesh.geometry.boundingBox
    if (!range || range.isEmpty()) return
    box.union(part.copy(range).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld)))
  })
  return box.isEmpty() ? new THREE.Box3(new THREE.Vector3(), new THREE.Vector3()) : box
}

export interface EmitterTableDeps {
  renderer: THREE.WebGLRenderer
  world: { root: THREE.Object3D; lights?: readonly FilmLight[] }
  vehicle: Pick<VehicleModule, 'root' | 'lamps'>
}

/** The brightest emitting faces of the world and the vehicle lamps, measured as the picture draws them. */
export function createEmitterTable({ renderer, world, vehicle }: EmitterTableDeps) {
  const faces = sceneFaces(world.root)
  const keyParents = new Set((world.lights ?? []).filter((l) => l.kind === 'area').flatMap((l) => [l.object, l.object.parent].filter((o): o is THREE.Object3D => !!o)))
  const lamps = lampSources(vehicle)
  const rows = Math.max(1, Math.ceil(faces.length / atlasColumns))
  const atlas = new THREE.WebGLRenderTarget(atlasColumns * tile, rows * tile, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    generateMipmaps: false,
  })
  const pixels = new Float32Array(atlas.width * atlas.height * 4)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.25, 0.75)
  camera.layers.set(layers.scene)
  let occluders: Occluders | null = null
  let body: THREE.Box3 | null = null
  let table: Emitter[] = []
  let candidates: Emitter[] = []
  let measured = 0
  const focus = new THREE.Vector3()
  const lift = new THREE.Vector3()

  /** Redraws only the tiles whose face changed since it was last drawn. One readback, and none when nothing changed. */
  const measure = (): void => {
    const stale: Array<[Face, number]> = []
    faces.forEach((f, index) => {
      if (!visibleChain(f.mesh) || !f.mesh.layers.isEnabled(layers.scene)) return
      const state = faceState(f)
      if (state === f.drawn) return
      f.drawn = state
      stale.push([f, index])
    })
    if (!stale.length) return
    const previous = renderer.getRenderTarget()
    const face = renderer.getActiveCubeFace()
    const mip = renderer.getActiveMipmapLevel()
    const color = renderer.getClearColor(new THREE.Color())
    const alpha = renderer.getClearAlpha()
    const shadows = renderer.shadowMap.autoUpdate
    renderer.shadowMap.autoUpdate = false
    try {
      renderer.setClearColor(0x000000, 0)
      for (const [f, index] of stale) {
        const { center, u, v } = faceRect(f)
        const normal = u.clone().cross(v).normalize()
        camera.left = -u.length()
        camera.right = u.length()
        camera.top = v.length()
        camera.bottom = -v.length()
        camera.updateProjectionMatrix()
        camera.position.copy(center).addScaledVector(normal, 0.5)
        camera.up.copy(v).normalize()
        camera.lookAt(center)
        camera.updateMatrixWorld(true)
        const x = (index % atlasColumns) * tile
        const y = Math.floor(index / atlasColumns) * tile
        atlas.viewport.set(x, y, tile, tile)
        atlas.scissor.set(x, y, tile, tile)
        atlas.scissorTest = true
        renderer.setRenderTarget(atlas)
        renderer.clear(true, true, false)
        renderer.render(f.mesh, camera)
      }
      const low = Math.floor(Math.min(...stale.map(([, i]) => i)) / atlasColumns) * tile
      const high = (Math.floor(Math.max(...stale.map(([, i]) => i)) / atlasColumns) + 1) * tile
      const band = new Float32Array(atlas.width * (high - low) * 4)
      renderer.readRenderTargetPixels(atlas, 0, low, atlas.width, high - low, band)
      pixels.set(band, low * atlas.width * 4)
      measured += stale.length
    } finally {
      atlas.scissorTest = false
      renderer.shadowMap.autoUpdate = shadows
      renderer.setClearColor(color, alpha)
      renderer.setRenderTarget(previous, face, mip)
    }
  }

  const tileMean = (index: number, i0: number, i1: number, j0: number, j1: number): THREE.Color => {
    const x0 = (index % atlasColumns) * tile
    const y0 = Math.floor(index / atlasColumns) * tile
    const sum = new THREE.Color(0, 0, 0)
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const at = ((y0 + j) * atlas.width + x0 + i) * 4
      sum.r += Math.max(0, pixels[at])
      sum.g += Math.max(0, pixels[at + 1])
      sum.b += Math.max(0, pixels[at + 2])
    }
    return sum.multiplyScalar(1 / ((i1 - i0) * (j1 - j0)))
  }

  return {
    get table(): readonly Emitter[] {
      return table
    },
    /** Every rect measured this frame, before ranking. */
    get candidates(): readonly Emitter[] {
      return candidates
    },
    /** Tiles drawn since the table was made, for tools. */
    get measured(): number {
      return measured
    },
    /** Once per frame, with every system at the frame's center time. `eye` is the film camera. */
    update(eye?: THREE.Vector3): readonly Emitter[] {
      world.root.updateWorldMatrix(true, true)
      vehicle.root.updateWorldMatrix(true, true)
      occluders ??= new Occluders(world.root)
      body ??= vehicleBox(vehicle.root)
      const centre = body.getCenter(new THREE.Vector3())
      emitterUniforms.emitterVehicleHalf.value.copy(body.getSize(new THREE.Vector3())).multiplyScalar(0.5).addScalar(bodyMargin)
      emitterUniforms.emitterVehicleInverse.value.copy(vehicle.root.matrixWorld).multiply(new THREE.Matrix4().makeTranslation(centre)).invert()
      focus.setFromMatrixPosition(vehicle.root.matrixWorld)
      lift.copy(focus)
      lift.y += visibilityLift
      measure()
      const found: Emitter[] = []
      faces.forEach((f, index) => {
        if (!visibleChain(f.mesh) || !f.mesh.layers.isEnabled(layers.scene)) return
        const rect = faceRect(f)
        const [nu, nv] = splitOf(rect.u, rect.v)
        const u = rect.u.clone().divideScalar(nu)
        const v = rect.v.clone().divideScalar(nv)
        for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
          const radiance = tileMean(index, a * tile / nu, (a + 1) * tile / nu, b * tile / nv, (b + 1) * tile / nv)
          if (luminance(radiance) < minRadiance) continue
          const center = rect.center.clone()
            .addScaledVector(rect.u, (2 * a + 1) / nu - 1)
            .addScaledVector(rect.v, (2 * b + 1) / nv - 1)
          radiance.multiplyScalar(airTransmittance(center.distanceTo(focus)))
          const key = !!f.mesh.parent && keyParents.has(f.mesh.parent)
          const sign = signName.test(f.mesh.name)
          found.push({ id: `${f.mesh.name}/${index}/${a}${b}`, group: `${f.mesh.parent?.name ?? ''}|${f.mesh.name}`, center, u: u.clone(), v: v.clone(), radiance, visibility: 1, key, sign })
        }
      })
      const merged = mergeOverlays(found)
      const shortlist = new Set(merged
        .map((e) => ({ e, score: emitterScore(e, focus, eye) }))
        .sort(byScore)
        .slice(0, visibilityShortlist)
        .map(({ e }) => e))
      for (const e of merged) e.visibility = e.key || e.sign || shortlist.has(e) ? occluders.visibility(lift, e) : 0
      found.length = 0
      found.push(...merged)
      lamps.forEach(({ mesh, origin }, index) => {
        const material = mesh.material as THREE.MeshStandardMaterial
        if (!visibleChain(mesh) || material.emissiveIntensity <= 0) return
        const rect = lampRect(mesh, origin)
        if (!rect) return
        const radiance = material.emissive.clone().multiplyScalar(material.emissiveIntensity)
        if (luminance(radiance) < minRadiance) return
        found.push({ id: `lamp/${mesh.name}/${index}`, ...rect, radiance, visibility: 1, lamp: true })
      })
      candidates = found
      table = rankEmitters(found.filter((e) => (e.key || e.visibility > 0) && Number.isFinite(e.visibility)), focus, maxEmitters, perGroup, eye)
      writeEmitters(table)
      return table
    },
    setPixelAngle(camera: THREE.PerspectiveCamera, height: number): void {
      emitterUniforms.emitterPixelAngle.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / (camera.zoom * Math.max(1, height))
    },
    clear(): void {
      table = []
      writeEmitters(table)
    },
    dispose(): void {
      atlas.dispose()
    },
  }
}

export type EmitterTable = ReturnType<typeof createEmitterTable>
