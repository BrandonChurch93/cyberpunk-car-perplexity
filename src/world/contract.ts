import type * as THREE from 'three'
import type { FilmLight, SceneSystem, WetSurface } from '../core/contract'

export interface DeckSurface {
  /** The meshes that make up the walking surface. They lie in the plane y = 0 apart from their relief. */
  meshes: THREE.Mesh[]
  material: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial
  /** The deck in world X and Z: minimum and maximum corner of the area the height map covers. */
  bounds: THREE.Box2
  /** Red channel: height of the surface in meters against y = 0, lowest where water collects. Null in the gray-box. */
  heightMap: THREE.Texture | null
}

export interface WorldModule extends SceneSystem {
  /** Every string that appears on a sign. The gate checks each one against the config. */
  signs: string[]
  deck: DeckSurface
  /** The box the vehicle's reflections are corrected to: the deck below, the parapet and nearest walls around, open sky above. */
  reflectionBox: THREE.Box3
  surfaces: WetSurface[]
  /** Places where steam or vapor leaves the world: roof plant vents, drains. The object's local +Y is the direction it rises. `strength` is 0 to 1. */
  steamSources?: Array<{ object: THREE.Object3D; strength?: number; kind?: 'vent' | 'drain' }>
  /** Every spot fixture at rest, including those that share a film light slot with another, so a lit face keeps its cutoff optic when its slot is lent out. */
  optics?: readonly FilmLight[]
}

export type WorldDetail = 'blockout' | 'full'

export interface WorldOptions {
  detail: WorldDetail
}
