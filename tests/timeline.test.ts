import { describe, expect, it } from 'vitest'
import { config, frameCount } from '../src/config'
import { beatAt, engine, events, lampStage, stateAt, vibration } from '../src/director/timeline'

const duration = config.film.durationSeconds

describe('timeline', () => {
  it('puts every beat boundary in the beat that starts there', () => {
    config.beats.forEach((beat, index) => {
      const at = beatAt(beat.start)
      expect(at.beat.id).toBe(beat.id)
      expect(at.index).toBe(index)
      expect(at.local).toBeCloseTo(0, 12)
      const before = beatAt(beat.end - 1e-9)
      expect(before.beat.id).toBe(beat.id)
      expect(before.local).toBeGreaterThan(0.999)
    })
  })

  it('covers every frame with exactly one beat', () => {
    for (let f = 0; f < frameCount; f++) {
      const t = f / config.film.fps
      const hits = config.beats.filter((b) => t >= b.start && t < b.end)
      expect(hits.length).toBe(1)
      expect(beatAt(t).beat.id).toBe(hits[0].id)
    }
  })

  it('returns to its start state at the film length without wrapping time', () => {
    const a = stateAt(0)
    const b = stateAt(duration)
    expect(b.lampStage).toBe(a.lampStage)
    expect(b.engine).toBe(a.engine)
    expect(b.vibration).toBe(a.vibration)
    expect(b.beat.beat.id).toBe(a.beat.beat.id)
    expect(b.beat.local).toBeCloseTo(a.beat.local, 12)
    expect(a.lampStage).toBe(0)
    expect(a.engine).toBe(0)
    expect(a.vibration).toBe(0)
  })

  it('holds the start state across the shutter interval at the seam', () => {
    for (const dt of [-0.02, -0.01, 0, 0.01, 0.02]) {
      expect(lampStage(dt)).toBe(0)
      expect(engine(dt)).toBe(0)
      expect(lampStage(duration + dt)).toBe(0)
      expect(engine(duration + dt)).toBe(0)
      expect(vibration(duration + dt)).toBeCloseTo(vibration(dt), 12)
    }
  })

  it('runs the lamps up across the wake beat and down in the return beat', () => {
    const wake = config.beats.find((b) => b.id === 'wake')!
    const finale = config.beats.find((b) => b.id === 'return')!
    expect(lampStage(wake.start)).toBe(0)
    expect(lampStage(wake.end)).toBe(1)
    expect(lampStage(finale.start)).toBe(1)
    expect(lampStage(finale.end)).toBe(0)
    let last = 0
    for (let t = wake.start; t <= wake.end; t += 0.05) {
      const v = lampStage(t)
      expect(v).toBeGreaterThanOrEqual(last)
      last = v
    }
  })

  it('starts the engine in the ignition beat and stops it in the return beat', () => {
    const ignition = config.beats.find((b) => b.id === 'ignition')!
    const finale = config.beats.find((b) => b.id === 'return')!
    expect(engine(ignition.start)).toBe(0)
    expect(engine(ignition.end)).toBe(1)
    expect(engine(finale.end)).toBe(0)
    expect(events.engineStart).toBeGreaterThan(ignition.start)
    expect(events.engineRunning).toBeLessThan(ignition.end)
    expect(events.engineStopped).toBeLessThanOrEqual(events.lampsOffStart)
    expect(vibration(events.engineStart + 0.15)).toBeGreaterThan(0.9)
  })
})
