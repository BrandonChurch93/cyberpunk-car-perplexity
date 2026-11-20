import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { config, shutterSeconds } from '../src/config'
import { LightRig } from '../src/core/lights'
import { ImpactSurfaces, type ImpactSurfacePoint } from '../src/weather/air/impact-surfaces'
import { fallCycle, terminalSpeed } from '../src/weather/air/motion'
import { rainMeshes, RibbonView } from '../src/weather/air/ribbons'
import type { WorldModule } from '../src/world'

describe('air rain motion', () => {
  it('preserves physical drop speed and shutter length while closing the fall cycle', () => {
    const diameters = [0.001, 0.002, 0.003]
    const speeds = diameters.map(terminalSpeed)
    expect(speeds[0]).toBeCloseTo(4, 0)
    expect(speeds[2]).toBeGreaterThan(7.9)
    expect(speeds[0]).toBeLessThan(speeds[1])
    expect(speeds[1]).toBeLessThan(speeds[2])
    for (const diameter of diameters) for (const nominalHeight of [8.5, 9.4, 11.5]) {
      const { cycles, wrapHeight } = fallCycle(diameter, nominalHeight)
      expect(Number.isInteger(cycles)).toBe(true)
      expect(cycles * wrapHeight / config.film.durationSeconds).toBeCloseTo(terminalSpeed(diameter), 12)
      expect(cycles * wrapHeight * shutterSeconds / config.film.durationSeconds).toBeCloseTo(terminalSpeed(diameter) * shutterSeconds, 12)
      expect(Math.abs(wrapHeight - nominalHeight)).toBeLessThan(0.5)
    }
  })

  it('builds a repeatable field of mostly fine drops concentrated in the middle distance', () => {
    const material = new THREE.MeshStandardMaterial()
    const world: WorldModule = {
      root: new THREE.Group(), lights: [], signs: [], surfaces: [], reflectionBox: new THREE.Box3(),
      deck: { meshes: [], material, bounds: new THREE.Box2(new THREE.Vector2(-14, -10), new THREE.Vector2(14, 10)), heightMap: null },
      beginFrame() {},
      beginSample() {},
    }
    const light = new LightRig([], 1).uniforms
    const geometries = rainMeshes(new RibbonView(), world, light).map((mesh) => mesh.geometry)
    const [near, mid, far] = geometries
    const dropCount = (geometry: THREE.BufferGeometry): number =>
      geometry.getAttribute('aDrop').count / (geometry instanceof THREE.InstancedBufferGeometry ? 1 : 4)
    expect(dropCount(mid)).toBeGreaterThan(dropCount(far))
    expect(dropCount(mid)).toBeGreaterThan(dropCount(near) * 2)
    world.deck.bounds.max.x += 3
    const resized = rainMeshes(new RibbonView(), world, light).map((mesh) => mesh.geometry)
    expect(resized[0].getAttribute('aDrop').array).toEqual(near.getAttribute('aDrop').array)
    expect(resized[2].getAttribute('aDrop').array).toEqual(far.getAttribute('aDrop').array)
    const drops = mid.getAttribute('aDrop')
    let fine = 0
    let rangeMatches = true
    for (let i = 0; i < drops.count; i++) {
      const diameter = drops.getW(i)
      if (diameter < 0.002) fine++
      rangeMatches &&= diameter >= 0.001 && diameter <= 0.003
    }
    expect(rangeMatches).toBe(true)
    expect(fine).toBeGreaterThan(drops.count * 0.6)
  })

  it('finds the highest available wet, upward face in transformed world space', () => {
    const root = new THREE.Group()
    const coated = new THREE.MeshStandardMaterial()
    const dry = new THREE.MeshStandardMaterial()
    const slab = new THREE.Mesh(new THREE.BoxGeometry(5, 0.2, 5), coated)
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 1), coated)
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 1), dry)
    ledge.rotation.y = Math.PI / 3
    ledge.position.set(0.6, 0.8, -0.25)
    roof.position.copy(ledge.position).setY(2)
    root.add(slab, ledge, roof)
    root.position.y = 0.2
    const surfaces = new ImpactSurfaces(root, [{ material: coated, wetness: 'sheet' }, { material: dry, wetness: 'none' }], 0.4)
    const hit = {} as ImpactSurfacePoint
    expect(surfaces.at(0.6, -0.25, hit)).toBe(true)
    expect(hit.face.mesh).toBe(ledge)
    expect(hit.face.up.y).toBeCloseTo(1, 8)
    expect(hit.y).toBeCloseTo(1.1, 8)
    expect(surfaces.at(-1.5, 1.5, hit)).toBe(true)
    expect(hit.face.mesh).toBe(slab)
    expect(hit.y).toBeCloseTo(0.3, 8)
    expect(surfaces.at(4.3, 5.2, hit)).toBe(false)
  })
})
