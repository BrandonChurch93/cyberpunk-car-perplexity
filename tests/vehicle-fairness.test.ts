import { describe, expect, it } from 'vitest'
import { fairCurve, type Knot } from '../src/vehicle/geometry'
import { samplePatchFairness, skinProbes } from '../tools/vehicle/fairness'

describe('fair body splines', () => {
  it('fits a reduced control net, pins the profile and is C2 through its interior knots', () => {
    const trace: Knot[] = Array.from({ length: 21 }, (_, i) => {
      const x = i / 20
      return [x, Math.sin(x * 2) + .012 * Math.sin(i * 3)]
    })
    const f = fairCurve(trace, { interior: [.23, .49, .76], pins: [[.4, Math.sin(.8)]] })
    expect(f(0)).toBe(trace[0][1])
    expect(f(1)).toBe(trace[20][1])
    expect(f(.4)).toBeCloseTo(Math.sin(.8), 10)
    const h = .00004
    for (const x of [.23, .49, .76]) {
      const left = (f(x) - 2 * f(x - h) + f(x - 2 * h)) / h ** 2
      const right = (f(x) - 2 * f(x + h) + f(x + 2 * h)) / h ** 2
      expect(Math.abs(right - left)).toBeLessThan(.006)
    }
  })

  it('lets an explicitly declared crease break tangency while retaining its position', () => {
    const f = fairCurve([[0, 0], [.2, .2], [.4, .4], [.6, .4], [.8, .2], [1, 0]], { breaks: [[.5, .5]] })
    expect(f(.5)).toBe(.5)
    expect(f(.5) - f(.499)).toBeCloseTo(.001, 7)
    expect(f(.5) - f(.501)).toBeCloseTo(.001, 7)
  })
})

const frontLimits = new Map<string, readonly [number, number]>([
  ['bonnet', [.016, .0045]],
  ['foredeck', [.016, .0030]],
  ['front wing', [.015, .0050]],
  ['fascia', [.006, .0010]],
])

describe('vehicle skin normal fairness outside creases', () => {
  it.each(skinProbes().filter(({ name }) => frontLimits.has(name)))('bounds second differences along both axes of $name', (probe) => {
    const limits = frontLimits.get(probe.name)!
    samplePatchFairness(probe).forEach(({ count, max }, axis) => {
      expect(count).toBeGreaterThan(850)
      expect(max).toBeLessThan(limits[axis])
    })
  })
})
