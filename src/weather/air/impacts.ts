import { config } from '../../config'
import { hash01, hashInts, stream } from '../../core/random'

export const impactCellMeters = 0.42
export const impactsPerCellPeriod = 8
const periods = Math.max(1, Math.round(config.film.durationSeconds / 0.1))
export const impactPeriodSeconds = config.film.durationSeconds / periods
const impactSeed = stream('air-impacts').uint()

export interface RainImpact {
  x: number
  z: number
  timeSeconds: number
  diameter: number
  seed: number
}

export function impactForCell(cellX: number, cellZ: number, timeCell: number, slot = 0): RainImpact {
  const canonicalCell = ((timeCell % periods) + periods) % periods
  const seed = hashInts(impactSeed, cellX, cellZ, canonicalCell, slot)
  return {
    x: (cellX + hash01(seed, 0)) * impactCellMeters,
    z: (cellZ + hash01(seed, 1)) * impactCellMeters,
    timeSeconds: (timeCell + (slot + hash01(seed, 2)) / impactsPerCellPeriod) * impactPeriodSeconds,
    diameter: (1 + 2 * Math.pow(hash01(seed, 3), 1.6)) * 0.001,
    seed,
  }
}
