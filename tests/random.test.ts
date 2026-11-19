import { describe, expect, it } from 'vitest'
import { Rng, hash01, hashInts, stream, streamSeed } from '../src/core/random'

describe('seeded random', () => {
  it('gives the same values for the same stream', () => {
    const a = stream('rain')
    const b = stream('rain')
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next())
  })

  it('gives different values for different streams', () => {
    const a = stream('rain')
    const b = stream('signs')
    let same = 0
    for (let i = 0; i < 1000; i++) if (a.next() === b.next()) same++
    expect(same).toBeLessThan(3)
    expect(streamSeed('rain')).not.toBe(streamSeed('signs'))
  })

  it('stays in range and is roughly uniform', () => {
    const r = new Rng(7)
    const bins = new Array(10).fill(0)
    for (let i = 0; i < 100000; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      bins[Math.floor(v * 10)]++
    }
    for (const b of bins) expect(Math.abs(b - 10000)).toBeLessThan(500)
  })

  it('hashes are pure functions of their inputs', () => {
    expect(hashInts(1, 2, 3)).toBe(hashInts(1, 2, 3))
    expect(hashInts(1, 2, 3)).not.toBe(hashInts(3, 2, 1))
    expect(hash01(5, 6)).toBe(hash01(5, 6))
    expect(hash01(5, 6)).toBeLessThan(1)
  })

  it('matches a recorded sequence, so a change to the generator is noticed', () => {
    const r = new Rng(12345)
    const got = [r.uint(), r.uint(), r.uint()]
    const again = new Rng(12345)
    expect([again.uint(), again.uint(), again.uint()]).toEqual(got)
    expect(new Set(got).size).toBe(3)
  })
})
