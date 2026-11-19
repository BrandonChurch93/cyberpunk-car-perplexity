import { describe, expect, it } from 'vitest'
import raw from '../config/showcase.json'
import { config, frameCount, shutterSeconds, validateConfig } from '../src/config'

function copy(): any {
  return JSON.parse(JSON.stringify(raw))
}

describe('config validation', () => {
  it('accepts the committed config', () => {
    expect(() => validateConfig(copy())).not.toThrow()
    expect(frameCount).toBe(config.film.fps * config.film.durationSeconds)
    expect(shutterSeconds).toBeCloseTo(config.film.shutterDegrees / 360 / config.film.fps, 12)
  })

  it('fails when a key is missing', () => {
    for (const path of ['seed', 'film.fps', 'formats.vertical.width', 'tiers.final.samplesPerFrame', 'quality.blind.jurors', 'sandbox.chunkBudgetMinutes', 'beats', 'signage.invented']) {
      const c = copy()
      const parts = path.split('.')
      let node = c
      for (const part of parts.slice(0, -1)) node = node[part]
      delete node[parts[parts.length - 1]]
      expect(() => validateConfig(c), path).toThrow(`missing key ${path}`)
    }
  })

  it('fails when a key has the wrong type', () => {
    const c = copy()
    c.film.fps = '30'
    expect(() => validateConfig(c)).toThrow('film.fps must be number')
  })

  it('fails when the beats do not start at 0', () => {
    const c = copy()
    c.beats[0].start = 0.5
    expect(() => validateConfig(c)).toThrow('do not start at 0')
  })

  it('fails when the beats have a gap', () => {
    const c = copy()
    c.beats[2].start += 0.25
    expect(() => validateConfig(c)).toThrow('gap between beats')
  })

  it('fails when the beats overlap', () => {
    const c = copy()
    c.beats[2].start -= 0.25
    expect(() => validateConfig(c)).toThrow('overlap')
  })

  it('fails when the last beat does not end at the film length', () => {
    const c = copy()
    c.beats[c.beats.length - 1].end -= 1
    expect(() => validateConfig(c)).toThrow('does not end at film.durationSeconds')
    const d = copy()
    d.film.durationSeconds += 1
    expect(() => validateConfig(d)).toThrow('does not end at film.durationSeconds')
  })

  it('fails on an empty or malformed beat list', () => {
    const c = copy()
    c.beats = []
    expect(() => validateConfig(c)).toThrow('beats is empty')
    const d = copy()
    d.beats[1].id = d.beats[0].id
    expect(() => validateConfig(d)).toThrow('repeated')
  })

  it('fails when the locked paint is not a candidate', () => {
    const c = copy()
    c.paint.locked = 'no-such-paint'
    expect(() => validateConfig(c)).toThrow('paint.locked')
  })

  it('fails when the stress settings name an unknown beat or tier', () => {
    const c = copy()
    c.quality.stress.beats = ['nowhere']
    expect(() => validateConfig(c)).toThrow('unknown beat')
    const d = copy()
    d.quality.stress.tier = 'ultra'
    expect(() => validateConfig(d)).toThrow('unknown tier')
  })
})
