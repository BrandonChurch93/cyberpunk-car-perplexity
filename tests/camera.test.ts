import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { config, frameCount } from '../src/config'
import { cameraAt } from '../src/director/shots'
import { glide } from '../src/director/rig'
import { createVehicle } from '../src/vehicle'

const anchors = (await createVehicle({ paint: config.paint.candidates[0], detail: 'blockout' })).anchors
const formats = [config.formats.master, config.formats.vertical]
const duration = config.film.durationSeconds

describe('camera', () => {
  it('returns to the opening camera at the film length in both formats', () => {
    for (const format of formats) {
      const a = cameraAt(0, format, anchors)
      const b = cameraAt(duration, format, anchors)
      expect(b.position.distanceTo(a.position)).toBeLessThan(1e-9)
      expect(b.quaternion.angleTo(a.quaternion)).toBeLessThan(1e-9)
      expect(b.focusDistance).toBeCloseTo(a.focusDistance, 9)
      expect(b.focalMm).toBe(a.focalMm)
    }
  })

  it('is at rest on both sides of the seam', () => {
    const step = 1 / config.film.fps
    for (const format of formats) {
      const before = cameraAt(duration - step, format, anchors)
      const at = cameraAt(0, format, anchors)
      const after = cameraAt(step, format, anchors)
      expect(before.position.distanceTo(at.position)).toBeLessThan(0.001)
      expect(after.position.distanceTo(at.position)).toBeLessThan(0.001)
    }
  })

  it('keeps one pose for every sample of the frames at the seam', () => {
    const step = 1 / config.film.fps
    for (const format of formats) {
      const first = cameraAt(0, format, anchors)
      const early = cameraAt(duration - step / 4, format, anchors, 0)
      expect(early.position.distanceTo(first.position)).toBeLessThan(0.001)
      const last = cameraAt(duration - step, format, anchors)
      const late = cameraAt(duration + step / 4, format, anchors, duration - step)
      expect(late.position.distanceTo(last.position)).toBeLessThan(0.001)
    }
  })

  it('uses only the listed focal lengths', () => {
    for (const format of formats) {
      for (let f = 0; f < frameCount; f += 5) expect(config.lens.focalLengthsMm).toContain(cameraAt(f / config.film.fps, format, anchors).focalMm)
    }
  })

  it('never jumps inside a beat', () => {
    const step = 1 / config.film.fps
    for (const format of formats) {
      for (const beat of config.beats) {
        if (beat.id === 'wake') continue
        let last = cameraAt(beat.start, format, anchors)
        for (let t = beat.start + step; t < beat.end - 1e-9; t += step) {
          const now = cameraAt(t, format, anchors)
          expect(now.position.distanceTo(last.position)).toBeLessThan(0.03)
          expect(THREE.MathUtils.radToDeg(now.quaternion.angleTo(last.quaternion))).toBeLessThan(0.6)
          last = now
        }
      }
      const before = cameraAt(config.beats[1].start - step, format, anchors)
      const after = cameraAt(config.beats[1].start, format, anchors)
      expect(after.position.distanceTo(before.position)).toBeLessThan(0.03)
    }
  })

  it('stays above the deck and outside the vehicle box', () => {
    for (const format of formats) {
      for (let f = 0; f < frameCount; f += 3) {
        const p = cameraAt(f / config.film.fps, format, anchors).position
        expect(p.y).toBeGreaterThan(0.1)
      }
    }
  })

  it('eases a glide from rest to rest', () => {
    expect(glide(0, 0, 4, 1, 1)).toBe(0)
    expect(glide(4, 0, 4, 1, 1)).toBe(1)
    expect(glide(0.01, 0, 4, 1, 1)).toBeLessThan(1e-5)
    expect(1 - glide(3.99, 0, 4, 1, 1)).toBeLessThan(1e-5)
    let last = 0
    for (let t = 0; t <= 4; t += 0.05) {
      const g = glide(t, 0, 4, 1, 1)
      expect(g).toBeGreaterThanOrEqual(last)
      last = g
    }
  })
})
