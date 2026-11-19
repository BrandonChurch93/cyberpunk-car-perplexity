import { config } from '../../config'

export const prevailingWind = [0.82, -0.57] as const

export function terminalSpeed(diameterMeters: number): number {
  return 9.65 - 10.3 * Math.exp(-600 * diameterMeters)
}

export function fallCycle(diameter: number, height: number): { cycles: number; wrapHeight: number } {
  const travel = terminalSpeed(diameter) * config.film.durationSeconds
  const cycles = Math.max(1, Math.round(travel / height))
  return { cycles, wrapHeight: travel / cycles }
}
