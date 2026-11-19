import { describe, expect, it } from 'vitest'
import { config } from '../src/config'
import { impactCellMeters, impactForCell, impactPeriodSeconds, impactsPerCellPeriod } from '../src/weather/air/impacts'

describe('air impacts', () => {
  it('tiles space and has a separately seeded impact in every time stratum', () => {
    const hits = Array.from({ length: impactsPerCellPeriod }, (_, slot) => impactForCell(-3, 8, -6, slot))
    for (const [slot, hit] of hits.entries()) {
      expect(Math.floor(hit.x / impactCellMeters)).toBe(-3)
      expect(Math.floor(hit.z / impactCellMeters)).toBe(8)
      expect(Math.floor((hit.timeSeconds / impactPeriodSeconds + 6) * impactsPerCellPeriod)).toBe(slot)
      expect(hit.diameter).toBeGreaterThanOrEqual(0.001)
      expect(hit.diameter).toBeLessThan(0.003)
    }
    expect(new Set(hits.map((hit) => hit.seed)).size).toBe(impactsPerCellPeriod)
  })

  it('preserves identity and unwrapped age across the loop seam', () => {
    const duration = config.film.durationSeconds
    const periods = Math.round(duration / impactPeriodSeconds)
    for (const i of [-3, -1, 0, 1, 5]) {
      const { timeSeconds: t0, ...first } = impactForCell(12, -24, i, 3)
      const { timeSeconds: t1, ...next } = impactForCell(12, -24, i + periods, 3)
      expect(next).toEqual(first)
      expect(t1 - t0).toBeCloseTo(duration, 12)
    }
  })
})
