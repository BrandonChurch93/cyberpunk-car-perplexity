import * as THREE from 'three'
import { expect, it } from 'vitest'
import { config } from '../src/config'
import type { FrameInfo } from '../src/core/engine'
import { LightRig } from '../src/core/lights'
import { sampleSet } from '../src/core/sampler'
import { events } from '../src/director/timeline'
import { AirVolume } from '../src/weather/air/vapor'

it('emits two deterministic exhaust banks in the transformed anchor frame', () => {
  const root = new THREE.Group()
  root.position.set(2, 4, 7)
  root.rotation.y = Math.PI / 2
  const exhaust = { position: new THREE.Vector3(0.15, 0.8, -2), normal: new THREE.Vector3(0, 0, -1), radius: 0.3 }
  const unrelatedHeat = new THREE.Object3D()
  unrelatedHeat.position.set(0.7, 0.3, 1)
  root.add(unrelatedHeat)
  const tail = new THREE.Object3D()
  tail.position.copy(exhaust.position).add(new THREE.Vector3(0.44, 0, 0.08))
  tail.rotation.y = Math.PI
  root.add(tail)
  const liveTail = { object: tail, stage: 0, beam: false, color: new THREE.Color(1, 0.02, 0.01), intensity: 2, level: 0.25 }
  const vehicle = {
    root,
    anchors: { paint: exhaust, wheel: exhaust, lamp: exhaust, detail: exhaust, exhaust },
    heatSources: [{ object: unrelatedHeat, strength: 100 }],
    lamps: [liveTail, { ...liveTail, object: unrelatedHeat }],
  }
  const steam = new THREE.Object3D()
  steam.position.set(9, 2, 3)
  const pass = new AirVolume({
    vehicle,
    world: {
      deck: { meshes: [], material: new THREE.MeshStandardMaterial(), bounds: new THREE.Box2(new THREE.Vector2(-20, -20), new THREE.Vector2(20, 20)), heightMap: null },
      steamSources: [{ object: steam, kind: 'vent' }],
    },
    lights: new LightRig([], 1).uniforms,
  })
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 0, 10)
  camera.updateMatrixWorld()
  const output = new THREE.WebGLRenderTarget(8, 8)
  const input = { color: new THREE.Texture(), depth: new THREE.DepthTexture(8, 8) }
  let sources: number[][] = []
  let axes: number[][] = []
  let shimmer = 0
  let tailFlux: number[][] = []
  const renderer = {
    setRenderTarget() {},
    render(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>) {
      const u = mesh.material.uniforms
      const read = (rows: THREE.Vector4[]): number[][] => rows.slice(0, u.uCount.value).map((v) => v.toArray())
      sources = read(u.uSources.value)
      axes = read(u.uAxes.value)
      shimmer = u.uHot?.value ?? 0
      if (u.uTailCount) tailFlux = u.uTailFlux.value.slice(0, u.uTailCount.value).map((v: THREE.Vector3) => v.toArray())
    },
  } as unknown as THREE.WebGLRenderer
  const draw = (timeSeconds: number) => {
    const frameKey = Math.round(timeSeconds * config.film.fps)
    const format = config.formats.master
    const frame: FrameInfo = { frameIndex: frameKey, frameKey, timeSeconds, tier: 'draft', format, samples: config.tiers.draft.samplesPerFrame }
    pass.render(renderer, input, output, {
      camera, timeSeconds,
      sample: { ...sampleSet(frameKey, 0), sampleIndex: 0, timeSeconds, frame },
      state: { position: camera.position, quaternion: camera.quaternion, focalMm: config.lens.focalLengthsMm[0], sensorWidthMm: camera.filmGauge,
        focusDistance: camera.focus, fNumber: 2.8, near: camera.near, far: camera.far },
    })
    return { sources, axes, shimmer, tailFlux }
  }
  expect(draw(events.engineStart - 0.1)).toEqual({ sources: [[9, 2, 3, 1]], axes: [[0, 1, 0, 1]], shimmer: 0, tailFlux: [] })
  const firstCatch = draw(events.engineStart + 2 / config.film.fps)
  expect(firstCatch.sources).toHaveLength(3)
  expect(firstCatch.sources.slice(0, 2).every((source) => source[3] > 0.8)).toBe(true)
  expect(draw(events.engineStart + 1.2).sources[0][3]).toBeGreaterThan(0.9)
  const running = draw(events.engineRunning + 0.5)
  expect(running.sources).toHaveLength(3)
  const normal = exhaust.normal.clone().transformDirection(root.matrixWorld)
  const banks = [-1, 1].map((side) => root.localToWorld(exhaust.position.clone().add(new THREE.Vector3(side * 0.171, 0, 0))).toArray())
  expect(running.sources.slice(0, 2).map((source) => source.slice(0, 3))).toEqual(banks)
  expect(running.axes.slice(0, 2)).toEqual([[...normal.toArray(), 4], [...normal.toArray(), 4]])
  expect(running.shimmer).toBe(1)
  expect(running.tailFlux).toEqual([[0.5, 0.01, 0.005]])
  liveTail.level = 0
  expect(draw(events.engineRunning + 0.5).tailFlux).toEqual([])
  liveTail.level = 0.25
  unrelatedHeat.position.set(-75, 14, 18)
  draw(events.engineStopped + 1)
  expect(draw(events.engineRunning + 0.5)).toEqual(running)
  exhaust.position.addScaledVector(exhaust.normal, 0.027)
  const moved = draw(events.engineRunning + 0.5)
  for (let i = 0; i < 2; i++) {
    expect(new THREE.Vector3(...moved.sources[i].slice(0, 3)).distanceTo(new THREE.Vector3(...banks[i]))).toBeCloseTo(0.027, 12)
  }
  expect(moved.axes).toEqual(running.axes)
})
