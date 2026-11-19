import type * as THREE from 'three'
import type { FormatSpec } from '../config'
import type { VehicleModule } from '../vehicle'
import type { WorldModule } from '../world'
import type { FrameContext, SampleContext, SamplePass, SceneSystem } from './contract'
import type { LightRig } from './lights'

export interface StageDeps {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  world: WorldModule
  vehicle: VehicleModule
  weather: SceneSystem
  rig: LightRig
}

/** A piece of the render pipeline that the stage runs around every sub-render. */
export interface StagePart {
  resize(format: FormatSpec): void
  setDiagnostic?(view: string): void
  /** Once per frame, after every scene system has been set to the frame's center time. */
  beginFrame?(frame: FrameContext): void
  /** Before the scene is drawn for one sub-render. Systems, lights and the camera are already set. The part may draw into its own targets here. */
  beforeSample?(sample: SampleContext): void
  /** Screen passes that run on the drawn sub-render, in order. */
  samplePasses?: SamplePass[]
}
