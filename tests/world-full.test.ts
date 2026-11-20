import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { config } from '../src/config'
import type { FrameContext, SampleContext } from '../src/core/contract'
import { createWorld } from '../src/world'
import { billboardState } from '../src/world/fixtures'
import { deckHeight } from '../src/world/roof-look'

const world = await createWorld({ detail: 'full' })

function radiance(t: number): { position: number; color: THREE.Color } {
  const color = new THREE.Color()
  const { center } = billboardState(t, color, new THREE.Color(), new THREE.Color())
  return { position: center, color }
}

describe('full roof world', () => {
  it('exposes metric relief for the front puddle and an unchanged reflective plane', () => {
    const { deck } = world
    expect(deck.heightMap).toBeInstanceOf(THREE.DataTexture)
    const map = deck.heightMap as THREE.DataTexture
    expect(map.format).toBe(THREE.RedFormat)
    expect(map.type).toBe(THREE.FloatType)
    expect(deckHeight(.92, 3.13)).toBeLessThan(0)
    expect(deckHeight(1.21, 1.64)).toBeLessThan(-.003)
    expect(deckHeight(.96, 1.285)).toBeGreaterThan(0)
    expect(deckHeight(.18, -3.71)).toBeLessThan(0)
    expect(deckHeight(0, 0)).toBeGreaterThan(0)
    const samples = map.image.data as Float32Array
    const w = map.image.width
    const h = map.image.height
    const ix = Math.floor((.92 - deck.bounds.min.x) / (deck.bounds.max.x - deck.bounds.min.x) * w)
    const iz = Math.floor((3.13 - deck.bounds.min.y) / (deck.bounds.max.y - deck.bounds.min.y) * h)
    expect(samples[iz * w + ix]).toBeLessThan(0)
    expect(deck.meshes.every(m => m.material === deck.material)).toBe(true)
    expect(world.surfaces.some(s => s.material === deck.material && s.wetness === 'porous')).toBe(true)
    const stripes = world.root.getObjectByName('parking bay stripes') as THREE.Mesh
    expect(world.surfaces.find(s => s.material === stripes.material)?.wetness).toBe('porous')
    expect((stripes.material as THREE.Material).userData.wetPorosity).toBe(.23)
  })

  it('has rooted vent and drain origins, approved text, and a bounded light rig', () => {
    world.root.updateMatrixWorld(true)
    expect(world.steamSources?.map(s => s.kind)).toEqual(['vent', 'drain'])
    const [vent, drain] = world.steamSources!.map(s => s.object.getWorldPosition(new THREE.Vector3()))
    expect(vent.y).toBeGreaterThan(1)
    expect(drain.y).toBeLessThan(.024)
    expect(world.signs.includes('STAIRS')).toBe(true)
    expect(world.signs.includes('LEVEL 9')).toBe(true)
    expect(new Set(world.signs).size).toEqual(world.signs.length)
    expect(world.signs.every(s => [...config.signage.generic, ...config.signage.invented].includes(s))).toBe(true)
    expect(world.lights.length).toBeLessThanOrEqual(8)
    expect(world.lights.filter(l => l.shadow).length).toBe(3)
  })

  it('sets the billboard for both capture times and supplies a periodic mean to the rig', () => {
    const { durationSeconds } = config.film
    const emitter = world.lights.find(l => l.id === 'billboard')!
    const raking = world.lights.find(l => l.id === 'raking billboard')!
    const originalBillboard = world.root.getObjectByName('billboard')!
    expect(originalBillboard.position.toArray()).toEqual([4, 11.15, -46.77])
    expect(raking.intensity).toBeGreaterThan(emitter.intensity * 3)
    const start = radiance(0)
    const end = radiance(durationSeconds)
    expect(end.position).toBeCloseTo(start.position, 12)
    expect(end.color.b).toBeCloseTo(start.color.b, 12)
    const expected = radiance(2)
    world.beginFrame({ frame: { timeSeconds: 0 } } as FrameContext)
    const face = world.root.getObjectByName('animated cabinet LED face') as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
    expect(face.material.uniforms.centerX.value).toBeCloseTo(start.position, 12)
    world.beginSample({ timeSeconds: 2 } as SampleContext)
    expect(face.material.uniforms.centerX.value).toBeCloseTo(expected.position, 12)
    expect(raking.level(2)).toBeCloseTo(emitter.level(2), 10)
    expect(world.lights.some(l => l.id === 'wheel deck pole' && l.shadow)).toBe(true)
    expect(Math.abs(expected.position - start.position)).toBeGreaterThan(.025)
    const color = new THREE.Color()
    emitter.colorAt!(2, color)
    expect(color.clone().multiplyScalar(emitter.level(2)).b).toBeCloseTo(expected.color.b, 10)
    world.beginFrame({ frame: { timeSeconds: 0 } } as FrameContext)
    expect(face.material.uniforms.centerX.value).toBeCloseTo(start.position, 12)
  })

  it('uses batched geometry for room depths and utility silhouettes within the city budget', () => {
    const rooms: THREE.InstancedMesh[] = []
    let triangles = 0
    world.root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      if (object instanceof THREE.InstancedMesh && object.name.startsWith('recessed room walls')) rooms.push(object)
      triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3 *
        (object instanceof THREE.InstancedMesh ? object.count : 1)
    })
    expect(rooms.length).toBeGreaterThan(10)
    expect(rooms.reduce((sum, m) => sum + m.count, 0)).toBeGreaterThan(1_500)
    expect(world.root.getObjectByName('zoned middle-distance fire stairs, gutters and condenser racks')).toBeDefined()
    expect(triangles).toBeGreaterThan(120_000)
    expect(triangles).toBeLessThan(500_000)
    expect(world.signs.filter(s => config.signage.invented.includes(s)).sort()).toEqual(['BRINESCALE SUSHI', 'SHUTTER HUSH CLUB', 'VAPOR SILL HOTEL'])
  })

  it('rakes the grille from the parapet and tracks the wheel boom without leaking either cue into the seam', () => {
    const service = world.lights.find(l => l.id === 'north deck pole')!
    const wheel = world.lights.find(l => l.id === 'wheel deck pole')!
    const detail = config.beats.find(b => b.id === 'detail')!
    const wheelBeat = config.beats.find(b => b.id === 'wheel')!
    const start = detail.start+.22, end = detail.end-.22
    const axis = (object: THREE.Object3D) =>
      new THREE.Vector3(0,0,1).applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion()))
    const state = () => {
      return [...service.object.getWorldPosition(new THREE.Vector3()).toArray(), ...axis(service.object).toArray(), service.intensity]
    }
    world.beginFrame({ frame: { timeSeconds: 0 } } as FrameContext)
    const resting = state()
    const grazer = world.root.getObjectByName('grazer frosted optic')!
    const parked = axis(grazer).toArray()
    world.beginSample({ timeSeconds: start } as SampleContext)
    const first = state()
    expect(first[2]).toBeLessThan(-16)
    expect(Math.abs(axis(service.object).dot(new THREE.Vector3(.229,.973,.044).normalize()))).toBeLessThan(.09)
    world.beginSample({ timeSeconds: end } as SampleContext)
    expect(state()).not.toEqual(first)
    expect(service.intensity).toBeGreaterThan(resting[6]! * 2)
    world.beginFrame({ frame: { timeSeconds: start } } as FrameContext)
    expect(state()).toEqual(first)
    world.beginSample({ timeSeconds: detail.start-.01, sample: { frame: { timeSeconds: detail.start } } } as SampleContext)
    expect(state()[2]).toBeLessThan(-16)
    world.beginSample({ timeSeconds: config.film.durationSeconds } as SampleContext)
    expect(state()).toEqual(resting)
    expect(axis(grazer).toArray()).toEqual(parked)
    world.beginSample({ timeSeconds: wheelBeat.start+.7 } as SampleContext)
    const shoulderAim = axis(wheel.object).y
    world.beginSample({ timeSeconds: wheelBeat.end-.38 } as SampleContext)
    expect(axis(wheel.object).y).toBeLessThan(shoulderAim-.03)
    expect(wheel.level((wheelBeat.start+wheelBeat.end)/2)).toBeGreaterThan(wheel.level(0)*3)
    expect(wheel.level(config.film.durationSeconds)).toBeCloseTo(wheel.level(0),12)
  })

  it('keeps supported traffic, navigation lights and roof beacons periodic in both hooks', () => {
    const train = world.root.getObjectByName('tracked eight-axle electric train')!
    const aircraft = world.root.getObjectByName('small aircraft')!
    const beacon = world.root.getObjectByName('aviation warning bulb') as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
    const state = () => [...train.position.toArray(), ...aircraft.position.toArray(), aircraft.rotation.y, ...beacon.material.color.toArray()]
    world.beginFrame({ frame: { timeSeconds: 0 } } as FrameContext)
    const first = state()
    world.beginSample({ timeSeconds: config.film.durationSeconds*.7 } as SampleContext)
    expect(state()).not.toEqual(first)
    world.beginSample({ timeSeconds: config.film.durationSeconds } as SampleContext)
    state().forEach((v, i) => expect(v).toBeCloseTo(first[i], 9))
    expect(train.parent?.name).toBe('elevated railway')
  })
})
