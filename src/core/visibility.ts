import * as THREE from 'three'

const prepassSamples = 4
const idBits = 6
const idChannels = 4

type Drawable = THREE.Mesh | THREE.Line | THREE.Points | THREE.Sprite

interface Pass {
  target: THREE.WebGLRenderTarget
  pixels: Uint8Array
}

const builtIn = (m: THREE.Material): boolean => {
  const k = m as unknown as Record<string, boolean>
  return !!(k.isMeshStandardMaterial || k.isMeshBasicMaterial || k.isMeshLambertMaterial || k.isMeshPhongMaterial || k.isMeshToonMaterial || k.isMeshMatcapMaterial)
}

const depthOrdered = (m: THREE.Material): boolean => m.depthFunc === THREE.LessEqualDepth || m.depthFunc === THREE.LessDepth

const overwrites = (m: THREE.Material): boolean =>
  m.colorWrite && !m.alphaToCoverage && !m.stencilWrite && (m.blending === THREE.NoBlending || (m.blending === THREE.NormalBlending && !m.transparent))

const transmissive = (m: THREE.Material): boolean => ((m as THREE.MeshPhysicalMaterial).transmission ?? 0) > 0

export function candidate(o: THREE.Object3D): o is THREE.Mesh {
  const mesh = o as THREE.Mesh
  if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || (mesh as unknown as { isBatchedMesh?: boolean }).isBatchedMesh) return false
  if (Array.isArray(mesh.material) || Object.keys(mesh.geometry.morphAttributes).length > 0) return false
  if (mesh.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender && !hooked.has(mesh)) return false
  if (mesh.onAfterRender !== THREE.Object3D.prototype.onAfterRender && !hooked.has(mesh)) return false
  const m = mesh.material as THREE.MeshStandardMaterial
  if (!builtIn(m) || m.transparent || transmissive(m) || !m.visible || !m.depthTest || !m.depthWrite || m.depthFunc !== THREE.LessEqualDepth) return false
  if (!overwrites(m) || m.alphaTest > 0 || m.alphaHash || m.wireframe || m.displacementMap || (m.clippingPlanes?.length ?? 0) > 0) return false
  return true
}

export function unsafe(o: Drawable): boolean {
  for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
    if (!m.visible || (m.transparent && !transmissive(m))) continue
    if (m.stencilWrite) return true
    if (!m.depthTest || !m.depthWrite) continue
    if (!depthOrdered(m) || !overwrites(m)) return true
  }
  return false
}

const hooked = new WeakSet<THREE.Object3D>()

function idTarget(samples: number): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: true,
    samples,
  })
  if (samples === 0) target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType)
  return target
}

export interface VisibilityStats {
  candidates: number
  skippedMain: number
  skippedPrepass: number
  prepass: boolean
  unsafe: string | null
}

export class Visibility {
  private readonly material = new THREE.ShaderMaterial({
    uniforms: { visId: { value: new THREE.Vector4() } },
    vertexShader: 'void main() {\n#include <begin_vertex>\n#include <project_vertex>\n}',
    fragmentShader: 'uniform vec4 visId; void main() { gl_FragColor = visId; }',
    fog: false,
    lights: false,
    toneMapped: false,
  })
  private readonly single: Pass = { target: idTarget(0), pixels: new Uint8Array(0) }
  private readonly multi: Pass = { target: idTarget(prepassSamples), pixels: new Uint8Array(0) }
  private readonly ids = new Map<THREE.Object3D, number>()
  private readonly byId: THREE.Mesh[] = []
  private readonly sums: Uint8Array[] = []
  private coverage: boolean | null = null
  private mainTarget: THREE.WebGLRenderTarget | null = null
  private skipMain = new Set<THREE.Object3D>()
  private skipPrepass = new Set<THREE.Object3D>()
  private active = false
  private readonly saved = new Map<THREE.BufferGeometry, number[]>()
  last: VisibilityStats | null = null

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const visId = this.material.uniforms.visId.value as THREE.Vector4
    this.material.onBeforeRender = (_r, _s, _c, _g, object) => {
      const mesh = object as THREE.Mesh
      const source = mesh.material as THREE.Material
      const id = this.ids.get(object) ?? 0
      visId.set(...channels(id))
      this.material.side = source.side
      this.material.polygonOffset = source.polygonOffset
      this.material.polygonOffsetFactor = source.polygonOffsetFactor
      this.material.polygonOffsetUnits = source.polygonOffsetUnits
      this.material.uniformsNeedUpdate = true
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const renderer = this.renderer
    const target = renderer.getRenderTarget()
    const face = renderer.getActiveCubeFace()
    const mip = renderer.getActiveMipmapLevel()
    this.last = null
    const plain = (): void => renderer.render(scene, camera)
    if (!target || mip !== 0 || scene.overrideMaterial || renderer.clippingPlanes.length > 0) return plain()
    if (target.samples !== 0 && (target.samples !== prepassSamples || !this.coverageNested())) return plain()
    const width = target.width
    const height = target.height
    const viewport = renderer.getCurrentViewport(new THREE.Vector4())
    if (viewport.x !== 0 || viewport.y !== 0 || viewport.z !== width || viewport.w !== height) return plain()
    const plan = this.plan(scene)
    this.skipMain = new Set()
    this.skipPrepass = new Set()
    if (plan.unsafe) {
      this.last = { candidates: plan.candidates.length, skippedMain: 0, skippedPrepass: 0, prepass: plan.prepass, unsafe: plan.unsafe }
      return plain()
    }
    const restore = this.isolate(scene, plan.candidates, plan.omitted)
    try {
      const main = this.winners(scene, camera, target.samples === 0 ? this.single : this.multi, width, height, target.samples)
      for (const mesh of plan.candidates) if (!main.has(mesh)) this.skipMain.add(mesh)
      if (plan.prepass && renderer.capabilities.samples <= prepassSamples && this.coverageNested()) {
        const scale = renderer.transmissionResolutionScale
        const w = Math.floor(width * scale)
        const h = Math.floor(height * scale)
        if (target.samples === prepassSamples && w === width && h === height) this.skipPrepass = this.skipMain
        else {
          const prepass = this.winners(scene, camera, this.multi, w, h, prepassSamples)
          for (const mesh of plan.candidates) if (!prepass.has(mesh)) this.skipPrepass.add(mesh)
        }
      }
    } finally {
      restore()
      renderer.setRenderTarget(target, face, mip)
    }
    this.last = { candidates: plan.candidates.length, skippedMain: this.skipMain.size, skippedPrepass: this.skipPrepass.size, prepass: plan.prepass, unsafe: null }
    for (const mesh of plan.candidates) this.hook(mesh)
    this.mainTarget = target
    this.active = true
    try {
      renderer.render(scene, camera)
    } finally {
      this.active = false
      this.mainTarget = null
      for (const [geometry, counts] of this.saved) geometry.drawRange.count = counts[0]
      this.saved.clear()
    }
  }

  skipped(): { main: THREE.Object3D[]; prepass: THREE.Object3D[] } {
    return { main: [...this.skipMain], prepass: [...this.skipPrepass] }
  }

  private plan(scene: THREE.Scene): { candidates: THREE.Mesh[]; omitted: Drawable[]; prepass: boolean; unsafe: string | null } {
    const candidates: THREE.Mesh[] = []
    const omitted: Drawable[] = []
    let prepass = false
    let reason: string | null = null
    scene.traverse((o) => {
      const d = o as Drawable & { isLine?: boolean; isPoints?: boolean; isSprite?: boolean }
      if (!(d as THREE.Mesh).isMesh && !d.isLine && !d.isPoints && !d.isSprite) return
      if (candidate(d)) {
        candidates.push(d)
        return
      }
      omitted.push(d)
    })
    const chosen = new Set<THREE.Object3D>(candidates)
    scene.traverseVisible((o) => {
      const d = o as Drawable & { isLine?: boolean; isPoints?: boolean; isSprite?: boolean }
      if (!(d as THREE.Mesh).isMesh && !d.isLine && !d.isPoints && !d.isSprite) return
      if (chosen.has(d)) return
      for (const m of Array.isArray(d.material) ? d.material : [d.material]) if (m.visible && transmissive(m)) prepass = true
      if (!reason && unsafe(d)) reason = `${d.name || d.type}`
    })
    return { candidates, omitted, prepass, unsafe: reason }
  }

  private isolate(scene: THREE.Scene, candidates: THREE.Mesh[], omitted: Drawable[]): () => void {
    const renderer = this.renderer
    const masks = omitted.map((o) => o.layers.mask)
    const background = scene.background
    const autoUpdate = renderer.shadowMap.autoUpdate
    const needsUpdate = renderer.shadowMap.needsUpdate
    const clearColor = renderer.getClearColor(new THREE.Color())
    const clearAlpha = renderer.getClearAlpha()
    this.ids.clear()
    this.byId.length = 0
    candidates.forEach((mesh, i) => {
      this.ids.set(mesh, i + 1)
      this.byId[i + 1] = mesh
    })
    for (const o of omitted) o.layers.mask = 0
    scene.background = null
    scene.overrideMaterial = this.material
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.needsUpdate = false
    renderer.setClearColor(0x000000, 0)
    return () => {
      omitted.forEach((o, i) => (o.layers.mask = masks[i]))
      scene.background = background
      scene.overrideMaterial = null
      renderer.shadowMap.autoUpdate = autoUpdate
      renderer.shadowMap.needsUpdate = needsUpdate
      renderer.setClearColor(clearColor, clearAlpha)
    }
  }

  private winners(scene: THREE.Scene, camera: THREE.Camera, pass: Pass, width: number, height: number, samples: number): Set<THREE.Object3D> {
    const renderer = this.renderer
    const gl = renderer.getContext() as WebGL2RenderingContext
    pass.target.setSize(width, height)
    if (pass.pixels.length !== width * height * 4) pass.pixels = new Uint8Array(width * height * 4)
    const found = new Set<THREE.Object3D>()
    const steps = Math.max(1, samples)
    while (this.sums.length < steps) this.sums.push(new Uint8Array(0))
    for (let k = 1; k <= steps; k++) {
      renderer.setRenderTarget(pass.target)
      renderer.clear(true, true, false)
      if (samples > 0 && k < steps) {
        gl.enable(gl.SAMPLE_COVERAGE)
        gl.sampleCoverage(k / samples, false)
      }
      try {
        renderer.render(scene, camera)
      } finally {
        gl.disable(gl.SAMPLE_COVERAGE)
        gl.sampleCoverage(1, false)
      }
      renderer.readRenderTargetPixels(pass.target, 0, 0, width, height, pass.pixels)
      if (samples === 0) {
        collect(pass.pixels, null, 1, this.byId, found)
        continue
      }
      const sum = this.sums[k - 1].length === pass.pixels.length ? this.sums[k - 1] : (this.sums[k - 1] = new Uint8Array(pass.pixels.length))
      sum.set(pass.pixels)
      collect(sum, k > 1 ? this.sums[k - 2] : null, samples, this.byId, found)
    }
    return found
  }

  private coverageNested(): boolean {
    if (this.coverage !== null) return this.coverage
    const renderer = this.renderer
    const gl = renderer.getContext() as WebGL2RenderingContext
    const probe = idTarget(prepassSamples)
    probe.setSize(1, 1)
    const geometry = new THREE.PlaneGeometry(2, 2)
    const quad = (value: number, order: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
        vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `void main() { gl_FragColor = vec4(${value.toFixed(1)}); }`,
        depthTest: false,
        depthWrite: false,
      }))
      mesh.frustumCulled = false
      mesh.renderOrder = order
      return mesh
    }
    const wide = quad(1, 0)
    const narrow = quad(0, 1)
    const scene = new THREE.Scene()
    scene.add(wide, narrow)
    const camera = new THREE.Camera()
    const pixel = new Uint8Array(4)
    const target = renderer.getRenderTarget()
    const clearColor = renderer.getClearColor(new THREE.Color())
    const clearAlpha = renderer.getClearAlpha()
    const level = (n: number): number => Math.round((255 * n) / prepassSamples)
    let ok = true
    try {
      renderer.setClearColor(0x000000, 0)
      for (let n = 1; n < prepassSamples; n++) {
        for (const both of [false, true]) {
          narrow.visible = both
          wide.onBeforeRender = () => {
            gl.enable(gl.SAMPLE_COVERAGE)
            gl.sampleCoverage((n + 1) / prepassSamples, false)
          }
          narrow.onBeforeRender = () => gl.sampleCoverage(n / prepassSamples, false)
          renderer.setRenderTarget(probe)
          renderer.clear(true, true, false)
          try {
            renderer.render(scene, camera)
          } finally {
            gl.disable(gl.SAMPLE_COVERAGE)
            gl.sampleCoverage(1, false)
          }
          renderer.readRenderTargetPixels(probe, 0, 0, 1, 1, pixel)
          ok &&= Math.abs(pixel[0] - level(both ? 1 : n + 1)) <= 1
        }
      }
    } finally {
      renderer.setRenderTarget(target)
      renderer.setClearColor(clearColor, clearAlpha)
      probe.dispose()
      geometry.dispose()
      for (const mesh of [wide, narrow]) (mesh.material as THREE.Material).dispose()
    }
    this.coverage = ok
    return ok
  }

  private hook(mesh: THREE.Mesh): void {
    if (hooked.has(mesh)) return
    hooked.add(mesh)
    mesh.onBeforeRender = (renderer, _scene, _camera, geometry) => {
      if (!this.active) return
      const set = renderer.getRenderTarget() === this.mainTarget ? this.skipMain : this.skipPrepass
      if (!set.has(mesh)) return
      const saved = this.saved.get(geometry)
      if (saved) saved.push(geometry.drawRange.count)
      else this.saved.set(geometry, [geometry.drawRange.count])
      geometry.drawRange.count = 0
    }
    mesh.onAfterRender = (_renderer, _scene, _camera, geometry) => {
      const saved = this.saved.get(geometry)
      if (!saved || saved.length === 0) return
      geometry.drawRange.count = saved.pop()!
      if (saved.length === 0) this.saved.delete(geometry)
    }
  }
}

export function channels(id: number): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0]
  for (let c = 0; c < idChannels; c++) out[c] = (((id >> (idBits * c)) & ((1 << idBits) - 1)) * prepassSamples) / 255
  return out
}

export function collect(sum: Uint8Array, previous: Uint8Array | null, samples: number, byId: THREE.Mesh[], found: Set<THREE.Object3D>): void {
  const scale = samples === 0 || samples === 1 ? prepassSamples : 1
  let last = -1
  for (let i = 0; i < sum.length; i += 4) {
    let id = 0
    for (let c = 0; c < idChannels; c++) {
      const v = previous ? sum[i + c] - previous[i + c] : sum[i + c]
      id |= (scale === 1 ? v : v / scale) << (idBits * c)
    }
    if (id === 0 || id === last) continue
    last = id
    const mesh = byId[id]
    if (mesh) found.add(mesh)
  }
}

const shared = new WeakMap<THREE.WebGLRenderer, Visibility>()

export function visibilityOf(renderer: THREE.WebGLRenderer): Visibility {
  let v = shared.get(renderer)
  if (!v) shared.set(renderer, (v = new Visibility(renderer)))
  return v
}

export function renderVisible(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  visibilityOf(renderer).render(scene, camera)
}
