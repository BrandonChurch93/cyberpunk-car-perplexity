import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { config, shutterSeconds, type TierId } from '../src/config'
import { layers } from '../src/core/contract'
import { LightRig } from '../src/core/lights'
import { impactCellMeters, impactForCell, impactPeriodSeconds, impactsPerCellPeriod } from '../src/weather/air/impacts'
import { RibbonView } from '../src/weather/air/ribbons'
import { Splashes, sprayExposure } from '../src/weather/air/splashes'

describe('air impacts', () => {
  it('tiles space and has a separately seeded impact in every time stratum', () => {
    const hits = Array.from({ length: impactsPerCellPeriod }, (_, slot) => impactForCell(-3, 8, -6, slot))
    for (const [slot, hit] of hits.entries()) {
      expect(Math.floor(hit.x / impactCellMeters)).toBe(-3)
      expect(Math.floor(hit.z / impactCellMeters)).toBe(8)
      expect(Math.floor((hit.timeSeconds / impactPeriodSeconds + 6) * impactsPerCellPeriod)).toBe(slot)
      expect(hit.diameter).toBeGreaterThanOrEqual(0.001)
      expect(hit.diameter).toBeLessThan(0.003)
    }
    expect(new Set(hits.map((hit) => hit.seed)).size).toBe(impactsPerCellPeriod)
  })

  it('preserves identity and unwrapped age across the loop seam', () => {
    const duration = config.film.durationSeconds
    const periods = Math.round(duration / impactPeriodSeconds)
    for (const i of [-3, -1, 0, 1, 5]) {
      const { timeSeconds: t0, ...first } = impactForCell(12, -24, i, 3)
      const { timeSeconds: t1, ...next } = impactForCell(12, -24, i + periods, 3)
      expect(next).toEqual(first)
      expect(t1 - t0).toBeCloseTo(duration, 12)
    }
  })

  it('integrates body spray smoothly over the frame shutter, clipping emission to its lifetime', () => {
    const life = 0.2
    const edge = shutterSeconds / 2
    const onset = sprayExposure(0, shutterSeconds, life)
    const full = sprayExposure(life / 2, shutterSeconds, life)
    expect(sprayExposure(-edge, shutterSeconds, life).weight).toBe(0)
    expect(sprayExposure(life + edge, shutterSeconds, life).weight).toBe(0)
    expect(onset.age).toBeCloseTo(edge / 2, 10)
    expect(onset.weight).toBeGreaterThan(0)
    expect(onset.weight).toBeCloseTo(sprayExposure(life, shutterSeconds, life).weight, 12)
    expect(full.weight).toBeGreaterThan(0.99)
    expect(full.weight).toBeLessThan(1)
    expect(full.age).toBeCloseTo(life / 2, 12)
  })

  it('keeps visible far-deck crowns when nearby off-frame strikes fill the buffer', () => {
    const material = new THREE.MeshStandardMaterial()
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(50, 45), material)
    deck.rotation.x = -Math.PI / 2
    const world = { root: new THREE.Group(), surfaces: [{ material, wetness: 'sheet' as const }], deck: { meshes: [deck] } }
    world.root.add(deck)
    const vehicle = { root: new THREE.Group(), surfaces: [{ material, wetness: 'beads' as const }] }
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    roof.rotation.x = -Math.PI / 2
    roof.position.y = 1
    vehicle.root.add(roof)
    const deps = {
      world,
      vehicle,
      lights: new LightRig([], 1).uniforms,
    }
    const splashes = new Splashes(deps, new RibbonView())
    const format = config.formats.master
    const frameKey = Math.round(config.film.heroFrameSeconds * config.film.fps)
    const expose = (tier: TierId) => splashes.beginFrame({
      format,
      frame: { frameIndex: frameKey, frameKey, timeSeconds: frameKey / config.film.fps, tier, format, samples: config.tiers[tier].samplesPerFrame },
      camera: {
        position: new THREE.Vector3(0, 0.8, 7.9), quaternion: new THREE.Quaternion(), focalMm: config.lens.focalLengthsMm[2], sensorWidthMm: 36,
        focusDistance: 8, fNumber: 2.8, near: 0.05, far: 100,
      },
    })
    expose('draft')
    const geometry = splashes.mesh.geometry as THREE.InstancedBufferGeometry
    const impacts = geometry.getAttribute('aDrop')
    let far = 0
    for (let i = 0; i < geometry.instanceCount; i++) {
      if (impacts.getZ(i) < -7.5 && Math.abs(impacts.getX(i)) < 2) far++
    }
    expect(far).toBeGreaterThan(30)
    const snapshot = (mesh: THREE.Mesh) => {
      const g = mesh.geometry as THREE.InstancedBufferGeometry
      return ['aDrop', 'aMotion'].map((name) => g.getAttribute(name).array.slice(0, g.instanceCount * 4))
    }
    const draft = [snapshot(splashes.mesh), snapshot(splashes.spray), snapshot(splashes.deckSpray)]
    expect(draft[1][0].length).toBeGreaterThan(0)
    expect(draft[2][0].length).toBeGreaterThan(320)
    expect(splashes.deckSpray.layers.mask).toBe(1 << layers.cameraOnly)
    const glints = draft[2][0]
    const time = frameKey / config.film.fps
    const perSlot = impactPeriodSeconds / impactsPerCellPeriod
    for (let i = 0; i < glints.length; i += 64) {
      const x = glints[i], y = glints[i + 1], z = glints[i + 2]
      expect(y).toBeGreaterThan(0.001)
      expect(y).toBeLessThan(0.04)
      const cellX = Math.floor(x / impactCellMeters)
      const cellZ = Math.floor(z / impactCellMeters)
      let shared = false
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        for (let slot = Math.floor((time - 0.12) / perSlot); slot <= Math.floor((time + shutterSeconds / 2) / perSlot); slot++) {
          const period = Math.floor(slot / impactsPerCellPeriod)
          const hit = impactForCell(cellX + dx, cellZ + dz, period, slot - period * impactsPerCellPeriod)
          if (Math.hypot(x - hit.x, z - hit.z) < 0.067) shared = true
        }
      }
      expect(shared).toBe(true)
    }
    for (const tier of ['review', 'final'] as const) {
      expose(tier)
      expect([snapshot(splashes.mesh), snapshot(splashes.spray), snapshot(splashes.deckSpray)]).toEqual(draft)
    }
  })
})
