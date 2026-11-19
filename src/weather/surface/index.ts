import * as THREE from 'three'
import type { SceneSystem } from '../../core/contract'
import type { WeatherDeps } from '../contract'

export async function createSurface(_deps: WeatherDeps): Promise<SceneSystem> {
  return { root: new THREE.Group(), lights: [], beginFrame: () => undefined, beginSample: () => undefined }
}
