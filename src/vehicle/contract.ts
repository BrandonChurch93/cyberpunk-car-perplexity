import type * as THREE from 'three'
import type { PaintSpec } from '../config'

export type WetnessKind = 'beads' | 'sheet' | 'porous' | 'none'

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
  lamps: Array<{ object: THREE.Object3D; stage: number; beam: boolean }>
  heatSources: Array<{ object: THREE.Object3D; strength: number }>
  update(state: VehicleState): void
  setPaint(paint: PaintSpec): void
}

export type VehicleDetail = 'blockout' | 'full'

export interface VehicleOptions {
  paint: PaintSpec
  detail: VehicleDetail
}
