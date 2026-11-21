import * as THREE from 'three'
import { expect, it } from 'vitest'
import { config } from '../src/config'
import type { FrameInfo } from '../src/core/engine'
import { LightRig } from '../src/core/lights'
import { sampleSet } from '../src/core/sampler'
import { events } from '../src/director/timeline'
import { AirVolume } from '../src/weather/air/vapor'

it('emits one deterministic vehicle plume at the transformed exhaust anchor', () => {
  const root = new THREE.Group()
  root.position.set(2, 4, 7)
  root.rotation.y = Math.PI / 2
  const exhaust = { position: new THREE.Vector3(0.15, 0.8, -2), normal: new THREE.Vector3(0, 0, -1), radius: 0.3 }
  const unrelatedHeat = new THREE.Object3D()
  unrelatedHeat.position.set(0.7, 0.3, 1)
  root.add(unrelatedHeat)
  const vehicle = {
    root,
    anchors: { paint: exhaust, wheel: exhaust, lamp: exhaust, detail: exhaust, exhaust },
    heatSources: [{ object: unrelatedHeat, strength: 100 }],
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
  const renderer = {
    setRenderTarget() {},
    render(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>) {
      const u = mesh.material.uniforms
      const read = (rows: THREE.Vector4[]): number[][] => rows.slice(0, u.uCount.value).map((v) => v.toArray())
      sources = read(u.uSources.value)
      axes = read(u.uAxes.value)
      shimmer = u.uHot?.value ?? 0
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
    return { sources, axes, shimmer }
  }
  expect(draw(events.engineStart - 0.1)).toEqual({ sources: [[9, 2, 3, 1]], axes: [[0, 1, 0, 1]], shimmer: 0 })
  const running = draw(events.engineRunning + 0.5)
  expect(running.sources).toHaveLength(2)
  expect(running.sources[0].slice(0, 3)).toEqual(root.localToWorld(exhaust.position.clone()).toArray())
  const normal = exhaust.normal.clone().transformDirection(root.matrixWorld)
  expect(running.axes[0]).toEqual([...normal.toArray(), 4])
  expect(running.shimmer).toBe(1)
  unrelatedHeat.position.set(-75, 14, 18)
  draw(events.engineStopped + 1)
  expect(draw(events.engineRunning + 0.5)).toEqual(running)
  exhaust.position.addScaledVector(exhaust.normal, 0.027)
  const moved = draw(events.engineRunning + 0.5)
  expect(moved.sources[0].slice(0, 3)).toEqual(root.localToWorld(exhaust.position.clone()).toArray())
  expect(new THREE.Vector3(...moved.sources[0].slice(0, 3)).distanceTo(new THREE.Vector3(...running.sources[0].slice(0, 3)))).toBeCloseTo(0.027, 12)
  expect(moved.axes).toEqual(running.axes)
})
