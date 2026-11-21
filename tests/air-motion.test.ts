import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { config, frameCount, shutterSeconds } from '../src/config'
import { layers } from '../src/core/contract'
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
    for (const diameter of diameters) for (const nominalHeight of [3.2, 7.8, 9.4, 11.6, 20.5]) {
      const { cycles, wrapHeight } = fallCycle(diameter, nominalHeight)
      expect(Number.isInteger(cycles)).toBe(true)
      expect(cycles * wrapHeight / config.film.durationSeconds).toBeCloseTo(terminalSpeed(diameter), 12)
      expect(cycles * wrapHeight * shutterSeconds / config.film.durationSeconds).toBeCloseTo(terminalSpeed(diameter) * shutterSeconds, 12)
      expect(Math.abs(wrapHeight - nominalHeight)).toBeLessThan(Math.max(0.5, nominalHeight * 0.03))
    }
  })

  it('builds repeatable drops and enables camera fields only on their shots', () => {
    const material = new THREE.MeshStandardMaterial()
    const world: WorldModule = {
      root: new THREE.Group(), lights: [], signs: [], surfaces: [], reflectionBox: new THREE.Box3(),
      deck: { meshes: [], material, bounds: new THREE.Box2(new THREE.Vector2(-14, -10), new THREE.Vector2(14, 10)), heightMap: null },
      beginFrame() {},
      beginSample() {},
    }
    const light = new LightRig([], 1).uniforms
    const body = new THREE.Vector3(2, 0, -1)
    const view = new RibbonView()
    const meshes = rainMeshes(view, world, light, body)
    expect(meshes.map((mesh) => mesh.name)).toEqual(['rain-near', 'rain-close', 'rain-middle', 'rain-distance', 'rain-beam', 'rain-paint', 'rain-beam-grain', 'rain-media-grain'])
    const [near, close, mid, far, beam, paint, hero, media] = meshes.map((mesh) => mesh.geometry)
    const dropCount = (geometry: THREE.BufferGeometry): number =>
      geometry.getAttribute('aDrop').count / (geometry instanceof THREE.InstancedBufferGeometry ? 1 : 4)
    expect(dropCount(close)).toBeGreaterThan(dropCount(near) * 2)
    expect(dropCount(far)).toBeGreaterThan(dropCount(close))
    world.deck.bounds.max.x += 3
    const shifted = rainMeshes(new RibbonView(), world, light, new THREE.Vector3(-2, 0, 3))
    const resized = shifted.map((mesh) => mesh.geometry)
    const bytes = (geometry: THREE.BufferGeometry, name: string): Buffer => {
      const { array } = geometry.getAttribute(name)
      return Buffer.from(array.buffer, array.byteOffset, array.byteLength)
    }
    for (const [index, field] of [[0, near], [1, close], [3, far], [4, beam], [5, paint], [6, hero], [7, media]] as const) {
      for (const name of ['aDrop', 'aMotion']) expect(bytes(resized[index], name).equals(bytes(field, name))).toBe(true)
    }
    const center = (mesh: THREE.Mesh): THREE.Vector3 =>
      (mesh.material as THREE.ShaderMaterial).uniforms.uVolumeCenter.value as THREE.Vector3
    expect(center(meshes[4]).toArray()).toEqual([2, 3.2 * 0.48, -1])
    expect(center(shifted[4]).toArray()).toEqual([-2, 3.2 * 0.48, 3])
    for (const field of [near, close, mid, far, beam, paint, hero, media]) {
      const drops = field.getAttribute('aDrop')
      const motion = field.getAttribute('aMotion')
      let fine = 0
      let rangeMatches = true
      let worstSpeedError = 0
      const stride = field instanceof THREE.InstancedBufferGeometry ? 1 : 4
      for (let i = 0; i < drops.count; i += stride) {
        const diameter = drops.getW(i)
        if (diameter < 0.0012) fine++
        rangeMatches &&= diameter >= 0.001 && diameter <= 0.003
        worstSpeedError = Math.max(worstSpeedError, Math.abs(terminalSpeed(diameter) - motion.getZ(i)))
      }
      expect(rangeMatches).toBe(true)
      expect(fine).toBeGreaterThan(dropCount(field) * 0.58)
      expect(worstSpeedError).toBeLessThan(1e-6)
    }
    expect(meshes[5].layers.isEnabled(layers.cameraOnly)).toBe(true)
    expect(meshes[5].layers.isEnabled(layers.scene)).toBe(false)
    const heroFields = meshes.slice(6)
    for (const mesh of heroFields) {
      expect(mesh.layers.isEnabled(layers.cameraOnly)).toBe(true)
      expect(mesh.layers.isEnabled(layers.scene)).toBe(false)
      expect((mesh.material as THREE.ShaderMaterial).uniforms.uShutter.value).toBe(shutterSeconds)
    }
    const paintGeometry = paint as THREE.InstancedBufferGeometry
    const expose = (timeSeconds: number, format = config.formats.master) => {
      const frameIndex = Math.round(timeSeconds * config.film.fps)
      view.beginFrame({
        format,
        frame: { frameIndex, frameKey: frameIndex % frameCount, timeSeconds, tier: 'draft', format, samples: config.tiers.draft.samplesPerFrame },
        camera: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), focalMm: config.lens.focalLengthsMm[4],
          sensorWidthMm: 36, focusDistance: 0.75, fNumber: 4, near: 0.02, far: 100 },
      })
      return paintGeometry.instanceCount
    }
    expect(expose(config.film.heroFrameSeconds)).toBe(0)
    expect(heroFields.every(mesh => mesh.visible)).toBe(true)
    expect(expose(config.film.macroFrameSeconds)).toBe(dropCount(paint))
    expect(heroFields.some(mesh => mesh.visible)).toBe(false)
    expect(expose(config.film.macroFrameSeconds, config.formats.vertical)).toBe(dropCount(paint))
    const paintBeat = config.beats.find(beat => beat.id === 'paint')!
    expect(expose(paintBeat.end)).toBe(0)
    expect(heroFields.some(mesh => mesh.visible)).toBe(false)
    expect(expose(config.film.durationSeconds)).toBe(0)
    expect(heroFields.every(mesh => mesh.visible)).toBe(true)
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
