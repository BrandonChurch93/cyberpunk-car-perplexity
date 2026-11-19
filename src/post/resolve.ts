import * as THREE from 'three'
import { config, type FormatSpec } from '../config'
import type { FrameInfo, Resolver } from '../core/engine'
import { FullscreenPass, passMaterial } from '../core/fullscreen'
import { hashInts, streamSeed } from '../core/random'
import {
  CHOSEN_TONE_CURVE,
  EXPOSURE,
  TONE_CURVE_IDS,
  type ToneCurveName,
} from './curves'
import {
  ANAMORPHIC_STREAK_LEVEL_WEIGHTS,
  ANAMORPHIC_STREAK_STRIDES,
  ANAMORPHIC_STREAK_TINT,
  ANAMORPHIC_STREAK_WEIGHT,
  BLOOM_LEVEL_WEIGHTS,
  BLOOM_WEIGHT,
  HALATION_LEVEL_WEIGHTS,
  HALATION_TINT,
  HALATION_WEIGHT,
  beautyResolveFragment,
  compositeFragment,
  diagnosticResolveFragment,
  downsampleFragment,
  exposeFragment,
  halationFragment,
  streakBlurFragment,
  upsampleFragment,
} from './shaders'

const REFERENCE_PYRAMID_HEIGHT = 540
const PYRAMID_LEVELS = BLOOM_LEVEL_WEIGHTS.length

const grainStream = streamSeed('post-grain')
const ditherStream = streamSeed('dither')

function linearFloatTarget(width: number, height: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false,
    depthBuffer: false,
    stencilBuffer: false,
    colorSpace: THREE.NoColorSpace,
  })
}

export class BasicResolver implements Resolver {
  private diagnostic = 'beauty'
  private toneCurve: ToneCurveName = CHOSEN_TONE_CURVE
  private width = 0
  private height = 0

  private exposedTarget: THREE.WebGLRenderTarget | null = null
  private compositeTarget: THREE.WebGLRenderTarget | null = null
  private preMips: THREE.WebGLRenderTarget[] = []
  private downMips: THREE.WebGLRenderTarget[] = []
  private upMips: THREE.WebGLRenderTarget[] = []
  private halationTarget: THREE.WebGLRenderTarget | null = null
  private streakTargets: THREE.WebGLRenderTarget[] = []

  private readonly exposePass: FullscreenPass
  private readonly downsamplePass: FullscreenPass
  private readonly upsamplePass: FullscreenPass
  private readonly halationPass: FullscreenPass
  private readonly streakPass: FullscreenPass
  private readonly compositePass: FullscreenPass
  private readonly beautyPass: FullscreenPass
  private readonly diagnosticPass: FullscreenPass

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.exposePass = new FullscreenPass(passMaterial(exposeFragment, {
      sum: { value: null },
      inverseCount: { value: 1 },
      exposure: { value: EXPOSURE },
    }))

    this.downsamplePass = new FullscreenPass(passMaterial(downsampleFragment, {
      source: { value: null },
      texelSize: { value: new THREE.Vector2(1, 1) },
      karis: { value: 0 },
    }))

    this.upsamplePass = new FullscreenPass(passMaterial(upsampleFragment, {
      coarse: { value: null },
      detail: { value: null },
      radiusUv: { value: new THREE.Vector2(0.01, 0.01) },
      coarseWeight: { value: 1 },
      detailWeight: { value: 1 },
    }))

    this.halationPass = new FullscreenPass(passMaterial(halationFragment, {
      mip0: { value: null },
      mip1: { value: null },
      mip2: { value: null },
      r0: { value: new THREE.Vector2(0.01, 0.01) },
      r1: { value: new THREE.Vector2(0.01, 0.01) },
      r2: { value: new THREE.Vector2(0.01, 0.01) },
      weights: { value: new THREE.Vector3(...HALATION_LEVEL_WEIGHTS) },
      tint: { value: new THREE.Vector3(...HALATION_TINT) },
    }))

    this.streakPass = new FullscreenPass(passMaterial(streakBlurFragment, {
      source: { value: null },
      stepU: { value: 0.002 },
    }))

    this.compositePass = new FullscreenPass(passMaterial(compositeFragment, {
      exposedTex: { value: null },
      bloomTex: { value: null },
      halationTex: { value: null },
      streak0: { value: null },
      streak1: { value: null },
      streak2: { value: null },
      streak3: { value: null },
      bloomRadiusUv: { value: new THREE.Vector2(0.004, 0.004) },
      bloomWeight: { value: BLOOM_WEIGHT },
      halationWeight: { value: HALATION_WEIGHT },
      halationTint: { value: new THREE.Vector3(...HALATION_TINT) },
      anamorphic: { value: config.lens.anamorphic ? 1 : 0 },
      streakWeight: { value: ANAMORPHIC_STREAK_WEIGHT },
      streakTint: { value: new THREE.Vector3(...ANAMORPHIC_STREAK_TINT) },
      streakLevelWeights: { value: new THREE.Vector4(...ANAMORPHIC_STREAK_LEVEL_WEIGHTS) },
    }))

    this.beautyPass = new FullscreenPass(passMaterial(beautyResolveFragment, {
      compositeTex: { value: null },
      resolution: { value: new THREE.Vector2(config.formats.master.width, config.formats.master.height) },
      curveId: { value: TONE_CURVE_IDS[this.toneCurve] },
      grainSeed: { value: 0 },
      ditherSeed: { value: 0 },
    }))

    this.diagnosticPass = new FullscreenPass(passMaterial(diagnosticResolveFragment, {
      sum: { value: null },
      inverseCount: { value: 1 },
      exposure: { value: EXPOSURE },
      mode: { value: 0 },
      curveId: { value: TONE_CURVE_IDS[this.toneCurve] },
      ditherSeed: { value: 0 },
    }))
  }

  setToneCurve(curve: ToneCurveName): void {
    this.toneCurve = curve
    const id = TONE_CURVE_IDS[curve]
    this.beautyPass.material.uniforms.curveId.value = id
    this.diagnosticPass.material.uniforms.curveId.value = id
  }

  setDiagnostic(view: string): void {
    this.diagnostic = view
  }

  resize(format: FormatSpec): void {
    const w = Math.max(1, format.width)
    const h = Math.max(1, format.height)
    if (w === this.width && h === this.height && this.exposedTarget !== null) return
    this.disposeTargets()
    this.width = w
    this.height = h
    const aspect = w / h

    this.exposedTarget = linearFloatTarget(w, h)
    this.compositeTarget = linearFloatTarget(w, h)

    this.preMips = []
    let curH = h
    while (curH > REFERENCE_PYRAMID_HEIGHT) {
      curH = Math.max(REFERENCE_PYRAMID_HEIGHT, Math.round(curH * 0.5))
      const curW = Math.max(1, Math.round(curH * aspect))
      this.preMips.push(linearFloatTarget(curW, curH))
    }

    const baseH = Math.min(h, REFERENCE_PYRAMID_HEIGHT)
    this.downMips = []
    for (let i = 0; i < PYRAMID_LEVELS; i++) {
      const mipH = Math.max(1, Math.round(baseH / Math.pow(2, i + 1)))
      const mipW = Math.max(1, Math.round(mipH * aspect))
      this.downMips.push(linearFloatTarget(mipW, mipH))
    }

    this.upMips = []
    for (let i = 0; i < PYRAMID_LEVELS - 1; i++) {
      this.upMips.push(linearFloatTarget(this.downMips[i].width, this.downMips[i].height))
    }

    const topW = this.downMips[0].width
    const topH = this.downMips[0].height
    this.halationTarget = linearFloatTarget(topW, topH)
    this.streakTargets = ANAMORPHIC_STREAK_STRIDES.map(() => linearFloatTarget(topW, topH))
  }

  resolve(sum: THREE.Texture, count: number, frame: FrameInfo, target: THREE.WebGLRenderTarget | null): void {
    if (this.exposedTarget === null || frame.format.width !== this.width || frame.format.height !== this.height) {
      this.resize(frame.format)
    }

    const invCount = 1 / Math.max(1, count)
    const ditherSeed = hashInts(ditherStream, frame.frameKey) >>> 0

    if (this.diagnostic !== 'beauty') {
      const u = this.diagnosticPass.material.uniforms
      u.sum.value = sum
      u.inverseCount.value = invCount
      u.exposure.value = EXPOSURE
      u.mode.value = this.diagnostic === 'normals' ? 1 : this.diagnostic === 'caps' ? 2 : 0
      u.curveId.value = TONE_CURVE_IDS[this.toneCurve]
      u.ditherSeed.value = ditherSeed
      this.diagnosticPass.render(this.renderer, target)
      return
    }

    const exposed = this.exposedTarget!
    const composite = this.compositeTarget!
    const halation = this.halationTarget!
    const aspect = this.width / this.height

    const eu = this.exposePass.material.uniforms
    eu.sum.value = sum
    eu.inverseCount.value = invCount
    eu.exposure.value = EXPOSURE
    this.exposePass.render(this.renderer, exposed)

    let prevTarget = exposed
    let firstStep = true
    const du = this.downsamplePass.material.uniforms
    for (const pre of this.preMips) {
      du.source.value = prevTarget.texture
      du.texelSize.value.set(1 / prevTarget.width, 1 / prevTarget.height)
      du.karis.value = firstStep ? 1 : 0
      firstStep = false
      this.downsamplePass.render(this.renderer, pre)
      prevTarget = pre
    }

    for (const mip of this.downMips) {
      du.source.value = prevTarget.texture
      du.texelSize.value.set(1 / prevTarget.width, 1 / prevTarget.height)
      du.karis.value = firstStep ? 1 : 0
      firstStep = false
      this.downsamplePass.render(this.renderer, mip)
      prevTarget = mip
    }

    const uu = this.upsamplePass.material.uniforms
    for (let i = PYRAMID_LEVELS - 2; i >= 0; i--) {
      const coarse = i === PYRAMID_LEVELS - 2 ? this.downMips[PYRAMID_LEVELS - 1] : this.upMips[i + 1]
      const detail = this.downMips[i]
      const radiusH = 1.25 / coarse.height
      uu.coarse.value = coarse.texture
      uu.detail.value = detail.texture
      uu.radiusUv.value.set(radiusH / aspect, radiusH)
      uu.coarseWeight.value = i === PYRAMID_LEVELS - 2 ? BLOOM_LEVEL_WEIGHTS[PYRAMID_LEVELS - 1] : 1
      uu.detailWeight.value = BLOOM_LEVEL_WEIGHTS[i]
      this.upsamplePass.render(this.renderer, this.upMips[i])
    }

    const hu = this.halationPass.material.uniforms
    hu.mip0.value = this.downMips[0].texture
    hu.mip1.value = this.downMips[1].texture
    hu.mip2.value = this.downMips[2].texture
    const hr0 = 1.15 / this.downMips[0].height
    const hr1 = 1.15 / this.downMips[1].height
    const hr2 = 1.15 / this.downMips[2].height
    hu.r0.value.set(hr0 / aspect, hr0)
    hu.r1.value.set(hr1 / aspect, hr1)
    hu.r2.value.set(hr2 / aspect, hr2)
    this.halationPass.render(this.renderer, halation)

    const useAnamorphic = config.lens.anamorphic
    if (useAnamorphic) {
      const su = this.streakPass.material.uniforms
      let streakInput = this.downMips[0].texture
      const baseStreakH = this.downMips[0].height
      for (let i = 0; i < ANAMORPHIC_STREAK_STRIDES.length; i++) {
        su.source.value = streakInput
        su.stepU.value = (ANAMORPHIC_STREAK_STRIDES[i] / baseStreakH) / aspect
        this.streakPass.render(this.renderer, this.streakTargets[i])
        streakInput = this.streakTargets[i].texture
      }
    }

    const cu = this.compositePass.material.uniforms
    const bloomTopRadiusH = 1.15 / this.upMips[0].height
    cu.exposedTex.value = exposed.texture
    cu.bloomTex.value = this.upMips[0].texture
    cu.halationTex.value = halation.texture
    cu.bloomRadiusUv.value.set(bloomTopRadiusH / aspect, bloomTopRadiusH)
    cu.bloomWeight.value = BLOOM_WEIGHT
    cu.halationWeight.value = HALATION_WEIGHT
    cu.anamorphic.value = useAnamorphic ? 1 : 0
    cu.streak0.value = this.streakTargets[0].texture
    cu.streak1.value = this.streakTargets[1].texture
    cu.streak2.value = this.streakTargets[2].texture
    cu.streak3.value = this.streakTargets[3].texture
    this.compositePass.render(this.renderer, composite)

    const bu = this.beautyPass.material.uniforms
    bu.compositeTex.value = composite.texture
    bu.resolution.value.set(this.width, this.height)
    bu.curveId.value = TONE_CURVE_IDS[this.toneCurve]
    bu.grainSeed.value = hashInts(grainStream, frame.frameKey) >>> 0
    bu.ditherSeed.value = ditherSeed
    this.beautyPass.render(this.renderer, target)
  }

  private disposeTargets(): void {
    this.exposedTarget?.dispose()
    this.compositeTarget?.dispose()
    this.halationTarget?.dispose()
    for (const t of this.preMips) t.dispose()
    for (const t of this.downMips) t.dispose()
    for (const t of this.upMips) t.dispose()
    for (const t of this.streakTargets) t.dispose()
    this.exposedTarget = null
    this.compositeTarget = null
    this.halationTarget = null
    this.preMips = []
    this.downMips = []
    this.upMips = []
    this.streakTargets = []
  }

  dispose(): void {
    this.disposeTargets()
    this.exposePass.material.dispose()
    this.downsamplePass.material.dispose()
    this.upsamplePass.material.dispose()
    this.halationPass.material.dispose()
    this.streakPass.material.dispose()
    this.compositePass.material.dispose()
    this.beautyPass.material.dispose()
    this.diagnosticPass.material.dispose()
  }
}
