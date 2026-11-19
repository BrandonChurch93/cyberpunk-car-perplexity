import type { WorldModule, WorldOptions } from './contract'
import { createBlockoutWorld } from './blockout'
import { createFullWorld } from './full'

export type { DeckSurface, WorldDetail, WorldModule, WorldOptions } from './contract'

export async function createWorld(options: WorldOptions): Promise<WorldModule> {
  return options.detail === 'full' ? createFullWorld() : createBlockoutWorld()
}
