import { config, isTier, type TierId } from '../config'

export function samplesFor(tier: TierId): number {
  return config.tiers[tier].samplesPerFrame
}

export function requireTier(id: string): TierId {
  if (!isTier(id)) throw new Error(`unknown tier ${id}`)
  return id
}
