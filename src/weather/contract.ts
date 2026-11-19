import type { SceneSystem } from '../core/contract'
import type { FilmLightUniforms } from '../core/lights'
import type { VehicleModule } from '../vehicle'
import type { WorldModule } from '../world'

export interface WeatherDeps {
  world: WorldModule
  vehicle: VehicleModule
  /** The film's lights as shader uniforms, updated before every sub-render. */
  lights: FilmLightUniforms
}

export type WeatherPart = (deps: WeatherDeps) => Promise<SceneSystem>
