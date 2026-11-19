import type { WorldModule, WorldOptions } from './contract'
import { createBlockoutWorld } from './blockout'
import { createStandInWorld } from './standin'

export type { DeckSurface, WorldDetail, WorldModule, WorldOptions } from './contract'

export async function createWorld(options: WorldOptions): Promise<WorldModule> {
  return options.detail === 'full' ? createStandInWorld() : createBlockoutWorld()
}
