import type * as THREE from 'three'
import type { PaintSpec } from '../config'

import type { WetnessKind } from '../core/contract'

export type { WetnessKind }

export interface Anchor {
  position: THREE.Vector3
  normal: THREE.Vector3
  radius: number
}

export interface VehicleState {
  timeSeconds: number
  lampStage: number
  engine: number
  vibration: number
}

export type AnchorId = 'paint' | 'wheel' | 'lamp' | 'detail' | 'exhaust'

export interface VehicleModule {
  root: THREE.Object3D
  anchors: Record<AnchorId, Anchor>
  surfaces: Array<{ material: THREE.Material; wetness: WetnessKind }>
  /**
   * `object` sits at the emitter and its local +Z is the direction of the light.
   * `update` writes `level`, the lamp's brightness from 0 to 1. `color` is linear. `intensity` is candela on the axis divided by 100.
   */
  lamps: Array<{ object: THREE.Object3D; stage: number; beam: boolean; level?: number; color?: THREE.Color; intensity?: number }>
  heatSources: Array<{ object: THREE.Object3D; strength: number }>
  update(state: VehicleState): void
  setPaint(paint: PaintSpec): void
}

export type VehicleDetail = 'blockout' | 'full'

export interface VehicleOptions {
  paint: PaintSpec
  detail: VehicleDetail
}
