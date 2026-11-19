import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { config } from '../src/config'
import { applyLens, type CameraState } from '../src/core/lens'
import { circleScale, pupilCell, pupilIsActive, pupilLayout, pupilTapCount } from '../src/core/bokeh/pupil'

const width = config.formats.master.width
const height = config.formats.master.height
const state: CameraState = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  focalMm: 100,
  sensorWidthMm: 36,
  focusDistance: 0.6,
  fNumber: 4,
  near: 0.04,
  far: 800,
}

describe('pupil coverage', () => {
  it('has one deterministic equal-mass cell per sample', () => {
    for (const { samplesPerFrame: n } of Object.values(config.tiers)) {
      const layout = pupilLayout(n)
      const order = Array.from({ length: n }, (_, i) => pupilCell(360, i, n))
      expect(new Set(order).size).toBe(n)
      expect(layout.length).toBe(n)
      const mean = new THREE.Vector2()
      for (const { center, taps } of layout) {
        expect(taps.length).toBe(pupilTapCount)
        expect(taps.every(([x, y]) => x * x + y * y < 1)).toBe(true)
        const sum = taps.reduce(([u, v], [x, y]) => [u + x, v + y], [0, 0])
        expect(center[0]).toBeCloseTo(sum[0] / pupilTapCount, 12)
        expect(center[1]).toBeCloseTo(sum[1] / pupilTapCount, 12)
        mean.add(new THREE.Vector2(...center))
      }
      expect(mean.length() / n).toBeLessThan(0.01)
      expect(order.slice().reverse().map((_, i) => pupilCell(360, n - 1 - i, n))).toEqual(order.slice().reverse())
    }
  })

  it('preserves the optical focal plane and agrees with projected far parallax', () => {
    const camera = new THREE.PerspectiveCamera()
    const aperture = pupilCell(360, 3, config.tiers.review.samplesPerFrame).center
    const squeeze = 1.5
    const focus = new THREE.Vector3(0.03, 0.01, -state.focusDistance)
    const far = new THREE.Vector3(0, 0, -70)
    applyLens(camera, state, width, height, { pixel: [0, 0], aperture: [0, 0] }, squeeze)
    const focusBefore = focus.clone().project(camera)
    const farBefore = far.clone().project(camera)
    applyLens(camera, state, width, height, { pixel: [0, 0], aperture }, squeeze)
    const focusAfter = focus.clone().project(camera)
    const farAfter = far.clone().project(camera)
    const expected = circleScale(state, width) * (1 / state.focusDistance - 1 / 70)
    expect(focusBefore.distanceTo(focusAfter)).toBeLessThan(1e-10)
    expect((farAfter.x - farBefore.x) * width / 2).toBeCloseTo(expected * aperture[0] / squeeze, 8)
    expect((farAfter.y - farBefore.y) * height / 2).toBeCloseTo(expected * aperture[1], 8)
  })

  it('bypasses wide angles and uses sensor scale for both master formats', () => {
    for (const format of [config.formats.master, config.formats.vertical]) {
      expect(pupilIsActive(state, format.width, config.tiers.final.samplesPerFrame)).toBe(true)
      expect(pupilIsActive({ ...state, focusDistance: 5.2, focalMm: 24, fNumber: 2 }, format.width, config.tiers.review.samplesPerFrame)).toBe(false)
    }
  })
})
