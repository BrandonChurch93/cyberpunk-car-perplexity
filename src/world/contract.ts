import type * as THREE from 'three'

export interface WorldModule {
  root: THREE.Object3D
  /** Every string that appears on a sign. The gate checks each one against the config. */
  signs: string[]
  update(timeSeconds: number): void
}

export type WorldDetail = 'blockout' | 'full'

export interface WorldOptions {
  detail: WorldDetail
}
