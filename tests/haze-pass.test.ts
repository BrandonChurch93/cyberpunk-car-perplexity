import * as THREE from 'three'
import { expect, it, vi } from 'vitest'
import { config } from '../src/config'
import { atmosphere, createHaze } from '../src/core/haze'
import { LightRig } from '../src/core/lights'
import type { StageDeps } from '../src/core/parts'
import { sampleSet } from '../src/core/sampler'

it('uses the board contrast steps without lifting short-distance sky fill', () => {
  const transmission = (distance: number) => Math.exp(-atmosphere.uniformExtinction * distance)
  expect(transmission(3)).toBeGreaterThan(0.98)
  expect(transmission(50)).toBeCloseTo(0.8, 2)
  expect(transmission(200)).toBeCloseTo(0.4, 1)
  expect(transmission(500)).toBeLessThan(0.15)
  expect(atmosphere.layerHeight).toBeLessThan(0.3)
})

it('keeps a defined forward projector lobe and a much weaker side and rear wing', () => {
  const hg = (c: number, g: number) => (1 - g * g) / (4 * Math.PI * (1 + g * g - 2 * g * c) ** 1.5)
  const atAngle = (degrees: number) => {
    const cosine = Math.cos(THREE.MathUtils.degToRad(degrees))
    return ((1 - atmosphere.projectorWingFraction) * hg(cosine, atmosphere.projectorAnisotropy)
      + atmosphere.projectorWingFraction * hg(cosine, atmosphere.projectorWingAnisotropy)) * atmosphere.projectorScatterFraction
  }
  expect(atAngle(20)).toBeGreaterThan(atAngle(90) * 8)
  expect(atAngle(90)).toBeGreaterThan(atAngle(180))
  expect(atAngle(180)).toBeLessThan(hg(-1, atmosphere.anisotropy) * atmosphere.scatterFraction / 2)
})

it('feeds the current sample camera, depth and seeded jitter to the scattering pass', () => {
  const rig = new LightRig([], 1)
  const sync = vi.spyOn(rig, 'syncShadowUniforms')
  const parts = createHaze({
    rig,
    world: { deck: { bounds: new THREE.Box2(new THREE.Vector2(-8, -4), new THREE.Vector2(8, 5)) } },
  } as StageDeps)
  const setRenderTarget = vi.fn()
  const render = vi.fn()
  const renderer = { setRenderTarget, render } as unknown as THREE.WebGLRenderer
  const output = new THREE.WebGLRenderTarget()
  const color = new THREE.Texture()
  const depth = new THREE.DepthTexture()
  const camera = new THREE.PerspectiveCamera(46, 1, 0.05, 800)
  camera.position.set(2, 1, 5)
  camera.updateMatrixWorld()
  const frameIndex = Math.round(config.film.heroFrameSeconds * config.film.fps)
  const frame = { frameIndex, frameKey: frameIndex, timeSeconds: frameIndex / config.film.fps, tier: 'review' as const, format: config.formats.preview, samples: config.tiers.review.samplesPerFrame }
  const indices = [frame.samples - 1, 1, frame.samples - 1]
  parts.resize(frame.format)
  const observed: [number, number][] = []
  for (const [i, sampleIndex] of indices.entries()) {
    const noise = sampleSet(frame.frameIndex, sampleIndex)
    const sample = { ...noise, sampleIndex, frame, timeSeconds: frame.timeSeconds }
    const state = { position: camera.position, quaternion: camera.quaternion, focalMm: 35, sensorWidthMm: 36, focusDistance: i === 1 ? 0.8 : 5, fNumber: 2.8, near: camera.near, far: camera.far }
    parts.samplePasses![0].render(renderer, { color, depth }, output, { camera, state, sample, timeSeconds: sample.timeSeconds })
    const mesh = render.mock.lastCall![0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
    const u = mesh.material.uniforms
    observed.push(u.sampleJitter.value.toArray())
    expect(u.sceneColor.value).toBe(color)
    expect(u.sceneDepth.value).toBe(depth)
    expect(u.filmLightColor).toBe(rig.uniforms.filmLightColor)
    expect(u.cameraWorld.value.equals(camera.matrixWorld)).toBe(true)
    expect(u.inverseProjection.value.equals(camera.projectionMatrixInverse)).toBe(true)
    expect(u.deckBounds.value.toArray()).toEqual([-8, -4, 8, 5])
    expect(u.sampleJitter.value.toArray()).toEqual(noise.misc)
    expect(u.focusDistance.value).toBe(state.focusDistance)
  }
  expect(observed[0]).not.toEqual(observed[1])
  expect(observed[0]).toEqual(observed[2])
  expect(sync).toHaveBeenCalledTimes(indices.length)
  expect(render).toHaveBeenCalledTimes(indices.length * 2)
  expect(setRenderTarget.mock.calls[0][0].width).toBe(Math.ceil(frame.format.width / 2))
  expect(setRenderTarget).toHaveBeenLastCalledWith(output)
})
