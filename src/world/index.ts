import type { WorldModule, WorldOptions } from './contract'
import { createBlockoutWorld } from './blockout'

export type { WorldDetail, WorldModule, WorldOptions } from './contract'

export async function createWorld(_options: WorldOptions): Promise<WorldModule> {
  return createBlockoutWorld()
}
