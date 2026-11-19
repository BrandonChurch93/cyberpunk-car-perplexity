import { describe, expect, it } from 'vitest'
import { config, frameCount } from '../src/config'
import { sampleSet } from '../src/core/sampler'

const finalCount = config.tiers.final.samplesPerFrame

describe('sampler', () => {
  it('is deterministic', () => {
    for (const frame of [0, 1, 195, frameCount - 1]) {
      for (let i = 0; i < finalCount; i++) expect(sampleSet(frame, i)).toEqual(sampleSet(frame, i))
    }
  })

  it('uses the same sequence for the loop frame as for frame 0', () => {
    for (let i = 0; i < finalCount; i++) expect(sampleSet(frameCount, i)).toEqual(sampleSet(0, i))
  })

  it('differs from frame to frame', () => {
    expect(sampleSet(10, 0)).not.toEqual(sampleSet(11, 0))
  })

  it('a lower tier is a prefix of a higher tier', () => {
    const review = config.tiers.review.samplesPerFrame
    for (let i = 0; i < review; i++) expect(sampleSet(42, i)).toEqual(sampleSet(42, i))
  })

  it('covers the shutter', () => {
    for (const frame of [0, 77, 900]) {
      const strata = new Array(8).fill(0)
      for (let i = 0; i < finalCount; i++) {
        const s = sampleSet(frame, i).shutter
        expect(s).toBeGreaterThanOrEqual(0)
        expect(s).toBeLessThan(1)
        strata[Math.floor(s * 8)]++
      }
      for (const n of strata) expect(n).toBeGreaterThan(0)
    }
  })

  it('covers the pixel', () => {
    for (const frame of [0, 77, 900]) {
      const cells = new Array(16).fill(0)
      let sx = 0
      let sy = 0
      for (let i = 0; i < finalCount; i++) {
        const [x, y] = sampleSet(frame, i).pixel
        expect(Math.abs(x)).toBeLessThanOrEqual(1)
        expect(Math.abs(y)).toBeLessThanOrEqual(1)
        sx += x
        sy += y
        cells[Math.min(3, Math.floor((x + 1) * 2)) + 4 * Math.min(3, Math.floor((y + 1) * 2))]++
      }
      expect(Math.abs(sx / finalCount)).toBeLessThan(0.12)
      expect(Math.abs(sy / finalCount)).toBeLessThan(0.12)
      expect(cells.filter((n) => n > 0).length).toBeGreaterThanOrEqual(10)
    }
  })

  it('covers the aperture disk', () => {
    for (const frame of [0, 77, 900]) {
      const quadrants = [0, 0, 0, 0]
      let inner = 0
      let outer = 0
      for (let i = 0; i < finalCount; i++) {
        const [x, y] = sampleSet(frame, i).aperture
        const r = Math.hypot(x, y)
        expect(r).toBeLessThanOrEqual(1 + 1e-9)
        quadrants[(x >= 0 ? 1 : 0) + (y >= 0 ? 2 : 0)]++
        if (r < Math.SQRT1_2) inner++
        else outer++
      }
      for (const q of quadrants) expect(q).toBeGreaterThanOrEqual(finalCount / 8)
      expect(Math.abs(inner - outer)).toBeLessThanOrEqual(finalCount / 4)
    }
  })

  it('covers the light and spare dimensions', () => {
    const cells = new Array(16).fill(0)
    for (let i = 0; i < finalCount; i++) {
      const [x, y] = sampleSet(5, i).light
      cells[Math.floor(x * 4) + 4 * Math.floor(y * 4)]++
      const [a, b] = sampleSet(5, i).misc
      expect(a).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(1)
    }
    expect(cells.filter((n) => n > 0).length).toBe(16)
  })
})
