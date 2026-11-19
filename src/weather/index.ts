import * as THREE from 'three'
import type { SceneSystem } from '../core/contract'
import { createAir } from './air'
import type { WeatherDeps } from './contract'
import { createSurface } from './surface'

export type { WeatherDeps } from './contract'

/** Surface water is created first so its material patches come before any the stage adds. */
export async function createWeather(deps: WeatherDeps): Promise<SceneSystem> {
  const surface = await createSurface(deps)
  const air = await createAir(deps)
  const parts = [surface, air]
  const root = new THREE.Group()
  root.name = 'weather'
  for (const part of parts) root.add(part.root)
  return {
    root,
    lights: parts.flatMap((p) => p.lights),
    samplePasses: parts.flatMap((p) => p.samplePasses ?? []),
    beginFrame: (frame) => parts.forEach((p) => p.beginFrame(frame)),
    beginSample: (sample) => parts.forEach((p) => p.beginSample(sample)),
    setDiagnostic: (view) => parts.forEach((p) => p.setDiagnostic?.(view)),
  }
}
