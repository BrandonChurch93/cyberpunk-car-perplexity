import type * as THREE from 'three'
import type { FormatSpec } from '../config'
import type { FrameInfo, SampleInfo } from './engine'
import type { CameraState } from './lens'

/**
 * Scene units. Colors are linear sRGB. Radiance 1.0 is 100 cd/m2.
 * A light's intensity is its luminous intensity in candela divided by 100.
 * An emissive surface's color times its emissiveIntensity is its luminance in cd/m2 divided by 100.
 */
export const candelaPerUnit = 100

export type LightKind = 'spot' | 'point' | 'area'

export interface FilmLight {
  id: string
  kind: LightKind
  /** World transform of the emitter. A spot or an area light emits along the object's local +Z. */
  object: THREE.Object3D
  color: THREE.Color
  /** Intensity on the axis in scene units, before `level`. For an area light: the whole panel seen face on. */
  intensity: number
  /** Emitter width and height in meters along the object's local X and Y. One point of it is used per sample, so shadows come out soft. */
  size: [number, number]
  /** Spot only: half angle of the cone in radians. */
  angle?: number
  /** Spot only: the soft fraction of the cone edge, 0 to 1. */
  penumbra?: number
  /** Distance in meters past which the light is ignored. */
  range: number
  shadow: boolean
  /** The haze pass ray marches this light as a visible beam. Every light still adds a glow to the haze around it. */
  beam: boolean
  /** Brightness in time, 0 to about 1: lamp stage, flicker, animation. Periodic over the film. */
  level(timeSeconds: number): number
  /** Optional color in time, for an animated source. Writes into `out`. */
  colorAt?(timeSeconds: number, out: THREE.Color): void
}

export interface FrameContext {
  frame: FrameInfo
  format: FormatSpec
  /** The film camera at the frame's center time, without lens jitter. */
  camera: CameraState
}

export interface SampleContext {
  sample: SampleInfo
  /** The time of this sub-render inside the shutter interval. */
  timeSeconds: number
  /** The camera used for this sub-render, lens jitter applied. */
  camera: THREE.PerspectiveCamera
  state: CameraState
}

/** Scene layers. The film camera sees both. Reflection and capture cameras see only `scene`. */
export const layers = { scene: 0, cameraOnly: 1 } as const

/** A screen pass that runs on every sub-render after the scene is drawn and before it is added to the running sum. */
export interface SamplePass {
  id: string
  render(renderer: THREE.WebGLRenderer, input: { color: THREE.Texture; depth: THREE.Texture }, output: THREE.WebGLRenderTarget, sample: SampleContext): void
}

/** Anything that lives in the scene. The stage calls every system in a fixed order. */
export interface SceneSystem {
  root: THREE.Object3D
  lights: FilmLight[]
  /** Once per frame, before the first sub-render. Anything left out of the time jitter is set here. */
  beginFrame(frame: FrameContext): void
  /** Before every sub-render. Everything animated is set to `sample.timeSeconds` here. */
  beginSample(sample: SampleContext): void
  setDiagnostic?(view: string): void
  samplePasses?: SamplePass[]
}

export type WetnessKind = 'beads' | 'sheet' | 'porous' | 'none'

export interface WetSurface {
  material: THREE.Material
  wetness: WetnessKind
}
