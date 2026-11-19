import * as THREE from 'three'
import type { SceneSystem } from '../../core/contract'
import type { WeatherDeps } from '../contract'
import { rainMeshes, RibbonView } from './ribbons'
import { Splashes } from './splashes'
import { AirVolume } from './vapor'

export async function createAir(deps: WeatherDeps): Promise<SceneSystem> {
  const root = new THREE.Group()
  root.name = 'air'
  const view = new RibbonView()
  const splashes = new Splashes(deps, view)
  const volume = new AirVolume(deps)
  root.add(...rainMeshes(view, deps.world, deps.lights), splashes.mesh)
  return {
    root,
    lights: [],
    samplePasses: [volume],
    beginFrame: (frame) => {
      view.beginFrame(frame)
      splashes.beginFrame(frame)
    },
    beginSample: (sample) => {
      view.beginSample(sample)
      splashes.beginSample(sample)
    },
    setDiagnostic: (diagnostic) => {
      root.visible = diagnostic === 'beauty'
      volume.enabled = root.visible
    },
  }
}
