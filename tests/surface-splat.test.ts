import { describe, expect, it } from 'vitest'
import { splatSigma } from '../src/weather/surface/beads'

const pixelSum = (x: number, y: number): number => {
  let sum = 0
  for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) sum += Math.exp(-((i - x) ** 2 + (j - y) ** 2) / (splatSigma * splatSigma))
  return sum / (Math.PI * splatSigma * splatSigma)
}

describe('unresolved bead spots', () => {
  it('sum to the same energy on one sample per pixel wherever the bead lands', () => {
    const sums: number[] = []
    for (let y = 0; y <= 1; y += 0.125) for (let x = 0; x <= 1; x += 0.125) sums.push(pixelSum(x, y))
    expect(Math.max(...sums)).toBeLessThan(1.05)
    expect(Math.min(...sums)).toBeGreaterThan(0.95)
  })
})
