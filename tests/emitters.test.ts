import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  airTransmittance, beadReference, createEmitterTable, emitterGlsl, emitterUniforms, glintReference, maxEmitters,
  mergeOverlays, Occluders, rankEmitters, splitOf, waterF0, withEmitters, type Emitter,
} from '../src/core/emitters'
import type { FilmLight } from '../src/core/contract'

function face(name: string, width: number, height: number, tint: THREE.Color, at: THREE.Vector3, look: THREE.Vector3): THREE.Mesh {
  const material = new THREE.ShaderMaterial({ uniforms: { tint: { value: tint } } })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
  mesh.name = name
  mesh.position.copy(at)
  mesh.lookAt(look)
  return mesh
}

/** Draws each face as its own `tint`, flat, so a tile's mean is the tint. */
function fakeRenderer(count = { renders: 0, reads: 0 }) {
  let target: THREE.WebGLRenderTarget | null = null
  let tiles: Array<{ x: number; y: number; w: number; h: number; color: THREE.Color }> = []
  const renderer = {
    shadowMap: { autoUpdate: true },
    getRenderTarget: () => target,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getClearColor: (c: THREE.Color) => c.set(0, 0, 0),
    getClearAlpha: () => 1,
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { target = t },
    setClearColor: () => undefined,
    clear: () => {
      const { x, y } = target!.scissor
      tiles = tiles.filter((t) => t.x !== x || t.y !== y)
    },
    render: (object: THREE.Object3D) => {
      count.renders++
      const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
      const { x, y, z: w, w: h } = target!.viewport
      tiles.push({ x, y, w, h, color: (mesh.material.uniforms.tint.value as THREE.Color).clone() })
    },
    readRenderTargetPixels: (t: THREE.WebGLRenderTarget, _x: number, y0: number, width: number, height: number, out: Float32Array) => {
      count.reads++
      out.fill(0)
      for (const tile of tiles) for (let j = Math.max(tile.y, y0); j < Math.min(tile.y + tile.h, y0 + height); j++) for (let i = tile.x; i < tile.x + tile.w; i++) {
        const at = ((j - y0) * width + i) * 4
        out[at] = tile.color.r
        out[at + 1] = tile.color.g
        out[at + 2] = tile.color.b
      }
      expect(t.width).toBe(width)
    },
  }
  return renderer as unknown as THREE.WebGLRenderer
}

function scene(options: { lit?: boolean; wall?: boolean; crowd?: number; count?: { renders: number; reads: number }; hold?: { world?: THREE.Group } } = {}) {
  const lit = options.lit ?? true
  const world = new THREE.Group()
  const off = new THREE.Color(0, 0, 0)
  world.add(face('magenta sign', 4, 2, lit ? new THREE.Color(3, 0.2, 2) : off, new THREE.Vector3(0, 5, -20), new THREE.Vector3(0, 1, 0)))
  world.add(face('cyan strip', 0.4, 6, lit ? new THREE.Color(0.1, 2, 2.4) : off, new THREE.Vector3(12, 3, -8), new THREE.Vector3(0, 1, 0)))
  world.add(face('amber wall', 20, 10, lit ? new THREE.Color(2, 0.9, 0.1) : off, new THREE.Vector3(-30, 8, -40), new THREE.Vector3(0, 1, 0)))
  world.add(face('hidden sign', 3, 3, lit ? new THREE.Color(4, 4, 4) : off, new THREE.Vector3(0, 2, 30), new THREE.Vector3(0, 1, 0)))
  const tower = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 2), new THREE.MeshStandardMaterial())
  tower.name = 'tower block'
  tower.position.set(0, 4, 20)
  world.add(tower)
  if (options.wall) world.add(face('second wall', 20, 10, new THREE.Color(1, 1, 1), new THREE.Vector3(30, 8, -40), new THREE.Vector3(0, 1, 0)))
  for (let i = 0; i < (options.crowd ?? 0); i++) {
    const fixture = new THREE.Group()
    fixture.name = `fitting ${i}`
    fixture.add(face('opal', 0.5, 0.5, new THREE.Color(300, 300, 300), new THREE.Vector3(i - 15, 3, -4), new THREE.Vector3(i - 15, 0, 0)))
    world.add(fixture)
  }
  if (options.hold) options.hold.world = world
  const screen = new THREE.Group()
  screen.name = 'key screen'
  screen.add(face('key mural', 60, 60, lit ? new THREE.Color(1.5, 0.3, 1.2) : off, new THREE.Vector3(-150, 50, -420), new THREE.Vector3(0, 1, 0)))
  const keyLight = new THREE.Object3D()
  screen.add(keyLight)
  world.add(screen)
  const vehicle = new THREE.Group()
  const lampMaterial = new THREE.MeshStandardMaterial({ emissive: new THREE.Color(1, 0.9, 0.8), emissiveIntensity: lit ? 40 : 0 })
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.02), lampMaterial)
  lamp.name = 'front lamp'
  lamp.position.set(0.6, 0.7, 2.2)
  const origin = new THREE.Object3D()
  origin.name = 'front lamp emission origin'
  origin.position.copy(lamp.position)
  vehicle.add(lamp, origin)
  world.updateMatrixWorld(true)
  vehicle.updateMatrixWorld(true)
  const lights = [{ id: 'key', kind: 'area', object: keyLight, color: new THREE.Color(1, 1, 1), intensity: 1, size: [60, 60], range: 1000, shadow: false, beam: false, level: () => 1 }] as FilmLight[]
  return createEmitterTable({ renderer: fakeRenderer(options.count), world: { root: world, lights }, vehicle: { root: vehicle, lamps: [{ object: origin, stage: 0, beam: true }] } })
}

function snapshot(list: readonly Emitter[]) {
  return list.map((e) => [e.id, e.center.toArray(), e.u.toArray(), e.v.toArray(), e.radiance.toArray(), e.visibility])
}

describe('emitter table', () => {
  it('is the same table for the same frame', () => {
    const a = snapshot(scene().update())
    const b = scene()
    b.update()
    expect(snapshot(b.update())).toEqual(a)
    expect(a.length).toBeGreaterThan(0)
    expect(a.length).toBeLessThanOrEqual(maxEmitters)
  })

  it('measures each face as drawn, splits wide faces, and faces each rect outward', () => {
    const table = scene().update()
    const sign = table.find((e) => e.id.startsWith('magenta sign'))!
    expect(sign.radiance.r).toBeCloseTo(3 * airTransmittance(sign.center.length()), 5)
    expect(sign.u.clone().cross(sign.v).dot(new THREE.Vector3(0, 0, 1))).toBeGreaterThan(0)
    expect(table.filter((e) => e.id.startsWith('amber wall'))).toHaveLength(4)
    expect(splitOf(new THREE.Vector3(10, 0, 0), new THREE.Vector3(0, 1, 0))).toEqual([1, 1])
    expect(splitOf(new THREE.Vector3(10, 0, 0), new THREE.Vector3(0, 5, 0))).toEqual([2, 2])
    const lamp = table.find((e) => e.id.startsWith('lamp/'))!
    expect(lamp.u.clone().cross(lamp.v).z).toBeGreaterThan(0)
  })

  it('drops faces hidden behind big blocks', () => {
    const table = scene().update()
    expect(table.some((e) => e.id.startsWith('hidden sign'))).toBe(false)
    expect(table.every((e) => e.visibility > 0)).toBe(true)
  })

  it('is empty when the signs and lamps are off', () => {
    const table = scene({ lit: false })
    expect(table.update()).toHaveLength(0)
    expect(emitterUniforms.emitterCount.value).toBe(0)
    const P = new THREE.Vector3(0, 1, 0)
    const N = new THREE.Vector3(0, 1, 0)
    const V = new THREE.Vector3(0, 0.5, 1).normalize()
    expect(glintReference(table.table, P, N, V, 0.05, 0.002, new THREE.Vector3(0, 2, 4), 7e-4).toArray()).toEqual([0, 0, 0])
    expect(beadReference(table.table, P, N, V, 0.002, 4, 7e-4).toArray()).toEqual([0, 0, 0])
  })

  it('ranks brightest first with a fixed order on ties', () => {
    const make = (id: string): Emitter => ({ id, center: new THREE.Vector3(0, 0, -10), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0), radiance: new THREE.Color(1, 1, 1), visibility: 1 })
    const list = ['c', 'a', 'b'].map(make)
    expect(rankEmitters(list, new THREE.Vector3()).map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(rankEmitters([...list].reverse(), new THREE.Vector3()).map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('emitter glint', () => {
  const sign = (radiance = new THREE.Color(5, 0.5, 3)): Emitter => ({
    id: 'sign', center: new THREE.Vector3(0, 6, -20), u: new THREE.Vector3(2, 0, 0), v: new THREE.Vector3(0, 1, 0), radiance, visibility: 1,
  })
  const eye = new THREE.Vector3(0, 1.2, 4)
  const P = new THREE.Vector3(0, 1, 0)
  const aim = (e: Emitter) => {
    const D = e.center.clone().sub(P).normalize()
    const V = eye.clone().sub(P).normalize()
    return { N: D.clone().add(V).normalize(), V }
  }

  it('shows the emitter at its radiance times Fresnel inside its mirror image', () => {
    const e = sign()
    const { N, V } = aim(e)
    const out = glintReference([e], P, N, V, 0.01, 0, eye, 7e-4)
    const F = waterF0 + (1 - waterF0) * (1 - N.dot(V)) ** 5
    expect(out.r).toBeCloseTo(e.radiance.r * F, 5)
    expect(out.g).toBeCloseTo(e.radiance.g * F, 5)
  })

  it('never exceeds radiance times Fresnel, resolved or unresolved', () => {
    const e = sign()
    for (const rough of [0, 0.02, 0.2, 0.8]) for (const radius of [0.0005, 0.002, 0.05]) for (const tilt of [-0.4, 0, 0.3]) {
      const { N, V } = aim(e)
      N.applyAxisAngle(new THREE.Vector3(1, 0, 0), tilt * 0.1).normalize()
      const F = waterF0 + (1 - waterF0) * (1 - Math.max(0, N.dot(V))) ** 5
      const resolved = glintReference([e], P, N, V, rough, radius, eye, 7e-4)
      expect(resolved.r).toBeLessThanOrEqual(e.radiance.r * F + 1e-9)
      const bead = beadReference([e], P, N, V, radius, 4, 7e-4)
      expect(bead.r).toBeLessThanOrEqual(e.radiance.r + 1e-9)
      expect(bead.r).toBeGreaterThanOrEqual(0)
    }
  })

  it('minifies a small bead image instead of painting the whole pixel', () => {
    const e = sign()
    const { V } = aim(e)
    const N = new THREE.Vector3(0, 1, 0)
    const small = beadReference([e], P, N, V, 0.0005, 4, 7e-4)
    const big = beadReference([e], P, N, V, 0.05, 4, 7e-4)
    expect(small.r).toBeGreaterThan(0)
    expect(small.r).toBeLessThan(big.r)
    const omega = 4 * 2 * 1 * e.center.clone().sub(P).normalize().z * -1 / e.center.distanceToSquared(P)
    const H = e.center.clone().sub(P).normalize().add(V).normalize()
    const F = waterF0 + (1 - waterF0) * (1 - H.dot(V)) ** 5
    expect(small.r).toBeCloseTo(e.radiance.r * F * 0.0005 ** 2 * omega / (4 * (4 * 7e-4) ** 2), 6)
    const resolved = glintReference([e], P, aim(e).N, V, 0, 0.0005, eye, 7e-4)
    const pixel = eye.distanceTo(P) * 7e-4
    expect(resolved.r).toBeLessThan(e.radiance.r * 0.05)
    expect(resolved.r).toBeGreaterThan(e.radiance.r * waterF0 * 0.0005 ** 2 * omega / (64 * pixel * pixel))
  })

  it('stays finite at grazing and with edge-on faces', () => {
    const edge: Emitter = { id: 'edge', center: new THREE.Vector3(0, 1, -10), u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1e-9), radiance: new THREE.Color(9, 9, 9), visibility: 1 }
    const N = new THREE.Vector3(0, 1, 0)
    for (const V of [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1e-7, -1).normalize(), new THREE.Vector3(0, 1, 0)]) {
      for (const list of [[sign()], [edge], [sign(), edge]]) {
        for (const value of [
          ...glintReference(list, P, N, V, 0, 0, P.clone(), 7e-4).toArray(),
          ...glintReference(list, P, N, V, 1, 0.001, eye, 0).toArray(),
          ...beadReference(list, P, N, V, 0.001, 0, 0).toArray(),
          ...beadReference(list, P, N, V.clone().negate(), 0.001, 4, 7e-4).toArray(),
        ]) expect(Number.isFinite(value)).toBe(true)
      }
    }
  })

  it('needs the emitter above the surface and in front of its own face', () => {
    const e = sign()
    const { N, V } = aim(e)
    const back = { ...e, v: e.v.clone().negate() }
    expect(glintReference([back], P, N, V, 0.01, 0, eye, 7e-4).r).toBe(0)
    const below = { ...e, center: new THREE.Vector3(0, -6, -20) }
    expect(beadReference([below], P, new THREE.Vector3(0, 1, 0), V, 0.002, 4, 7e-4).r).toBe(0)
  })

  it('patches a shader once', () => {
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, fragmentShader: 'uniform vec3 cameraPosition;\nvoid main() {}' }
    withEmitters(shader)
    withEmitters(shader)
    expect(shader.uniforms.emitterCount).toBe(emitterUniforms.emitterCount)
    expect(shader.fragmentShader.split('#define EMITTER_GLSL').length).toBe(2)
    expect(emitterGlsl).toContain('vec3 emitterGlint(vec3 P, vec3 N, vec3 V, float roughness, float curvatureRadius)')
  })
})

describe('occluders', () => {
  it('blocks a segment through a box and not one beside it', () => {
    const root = new THREE.Group()
    const block = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4))
    block.position.set(0, 0, -10)
    block.rotation.y = 0.3
    root.add(block)
    const occluders = new Occluders(root)
    expect(occluders.count).toBe(1)
    expect(occluders.blocked(new THREE.Vector3(), new THREE.Vector3(0, 0, -20))).toBe(true)
    expect(occluders.blocked(new THREE.Vector3(), new THREE.Vector3(8, 0, -20))).toBe(false)
    expect(occluders.blocked(new THREE.Vector3(), new THREE.Vector3(0, 0, -5))).toBe(false)
  })
})

describe('emitter rank groups', () => {
  it('keeps only a few rects of one fixture kind', () => {
    const list: Emitter[] = Array.from({ length: 10 }, (_, i) => ({
      id: `opal/${i}/00`, group: 'row|opal', center: new THREE.Vector3(i, 2, -5), u: new THREE.Vector3(0.2, 0, 0), v: new THREE.Vector3(0, 0.2, 0), radiance: new THREE.Color(9, 9, 9), visibility: 1,
    }))
    list.push({ id: 'far sign', group: 'tower|mural', center: new THREE.Vector3(0, 50, -400), u: new THREE.Vector3(15, 0, 0), v: new THREE.Vector3(0, 15, 0), radiance: new THREE.Color(2, 0.2, 1), visibility: 1 })
    const ranked = rankEmitters(list, new THREE.Vector3(), 24, 4)
    expect(ranked.filter((e) => e.group === 'row|opal')).toHaveLength(4)
    expect(ranked.at(-1)!.id).toBe('far sign')
  })
})

describe('emitter rank keys and cache', () => {
  const rect = (id: string, center: THREE.Vector3, extra: Partial<Emitter> = {}): Emitter => ({
    id, center, u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0), radiance: new THREE.Color(1, 1, 1), visibility: 1, ...extra,
  })

  it('always keeps the key light faces, split, however crowded the near fittings are', () => {
    const table = scene({ crowd: 40 })
    const ranked = table.update(new THREE.Vector3(0, 1.5, 8))
    const keys = ranked.filter((e) => e.key)
    expect(keys).toHaveLength(4)
    expect(keys.every((e) => e.id.startsWith('key mural'))).toBe(true)
    expect(ranked).toHaveLength(maxEmitters)
    expect(ranked.filter((e) => e.group?.startsWith('fitting ')).length).toBeGreaterThan(10)
  })

  it('weights by solid angle at the car and Fresnel toward the camera', () => {
    const eye = new THREE.Vector3(0, 1, 10)
    const behindCar = rect('behind car', new THREE.Vector3(0, 1, -20))
    const behindCamera = rect('behind camera', new THREE.Vector3(0, 1, 20), { v: new THREE.Vector3(0, -1, 0) })
    expect(rankEmitters([behindCamera, behindCar], new THREE.Vector3(), 24, 2).map((e) => e.id)).toEqual(['behind camera', 'behind car'])
    expect(rankEmitters([behindCamera, behindCar], new THREE.Vector3(), 24, 2, eye).map((e) => e.id)).toEqual(['behind car', 'behind camera'])
    const near = rect('near', new THREE.Vector3(0, 1, -5))
    const far = rect('far', new THREE.Vector3(0, 1, -50), { radiance: new THREE.Color(50, 50, 50) })
    expect(rankEmitters([far, near], new THREE.Vector3()).map((e) => e.id)).toEqual(['near', 'far'])
  })

  it('keeps the best face of a few signs even when white practicals outshine them', () => {
    const white = Array.from({ length: 30 }, (_, i) => rect(`flood ${i}/0/00`, new THREE.Vector3(i - 15, 3, -4), { group: `flood ${i}|diffuser`, radiance: new THREE.Color(200, 200, 200) }))
    const signs = ['HOTEL', 'BAR', 'EXIT'].flatMap((name, k) => [0, 1].map((j) => rect(`lettering ${name}/${k}/0${j}`, new THREE.Vector3(k * 10 + j, 20, -300), { group: `${name}|lettering`, sign: true, radiance: new THREE.Color(2, 0.3, 1) })))
    const ranked = rankEmitters([...white, ...signs], new THREE.Vector3())
    expect(ranked).toHaveLength(maxEmitters)
    expect(new Set(ranked.filter((e) => e.sign).map((e) => e.group))).toEqual(new Set(['HOTEL|lettering', 'BAR|lettering', 'EXIT|lettering']))
    expect(ranked.filter((e) => e.sign)).toHaveLength(3)
  })

  it('caps the vehicle lamps', () => {
    const lamps = Array.from({ length: 7 }, (_, i) => rect(`lamp ${i}`, new THREE.Vector3(i, 0.7, -3), { lamp: true }))
    expect(rankEmitters(lamps, new THREE.Vector3()).length).toBe(4)
  })

  it('adds lettering drawn over its cabinet into one rect', () => {
    const cabinet = rect('cabinet', new THREE.Vector3(0, 2, -6))
    const lettering = rect('lettering', new THREE.Vector3(0, 2, -6.01), { radiance: new THREE.Color(2, 0, 0) })
    const merged = mergeOverlays([cabinet, lettering, rect('beside', new THREE.Vector3(3, 2, -6))])
    expect(merged.map((e) => e.id)).toEqual(['cabinet', 'beside'])
    expect(merged[0].radiance.toArray()).toEqual([3, 1, 1])
    expect(cabinet.radiance.toArray()).toEqual([1, 1, 1])
  })

  it('redraws only faces that changed and skips the readback when none did', () => {
    const count = { renders: 0, reads: 0 }
    const hold: { world?: THREE.Group } = {}
    const table = scene({ count, hold })
    const first = snapshot(table.update())
    const drawn = count.renders
    expect(drawn).toBeGreaterThan(3)
    expect(count.reads).toBe(1)
    expect(snapshot(table.update())).toEqual(first)
    expect(count.renders).toBe(drawn)
    expect(count.reads).toBe(1)
    const sign = hold.world!.getObjectByName('magenta sign') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
    sign.material.uniforms.tint.value = new THREE.Color(0, 3, 0)
    const after = table.update()
    expect(count.renders).toBe(drawn + 1)
    expect(count.reads).toBe(2)
    expect(after.find((e) => e.id.startsWith('magenta sign'))!.radiance.g).toBeGreaterThan(2)
    expect(after.find((e) => e.id.startsWith('cyan strip'))!.radiance.toArray()).toEqual(table.candidates.find((e) => e.id.startsWith('cyan strip'))!.radiance.toArray())
  })
})

describe('vehicle lamps', () => {
  it('glint on the world but not on the vehicle itself', () => {
    const lamp = { center: new THREE.Vector3(0, 0.7, 2.2), u: new THREE.Vector3(0.15, 0, 0), v: new THREE.Vector3(0, 0.04, 0), radiance: new THREE.Color(100, 100, 100), visibility: 1, lamp: true }
    const P = new THREE.Vector3(0, 0, 6)
    const V = new THREE.Vector3(0, 0.3, 1).normalize()
    const N = new THREE.Vector3(0, 1, 0)
    expect(beadReference([lamp], P, N, V, 0.002, 4, 7e-4, waterF0, 0, false).r).toBeGreaterThan(0)
    expect(beadReference([lamp], P, N, V, 0.002, 4, 7e-4, waterF0, 0, true).r).toBe(0)
  })

  it('flags lamps in the uniforms and fits the vehicle box', () => {
    const table = scene()
    const list = table.update()
    const i = list.findIndex((e) => e.lamp)
    expect(emitterUniforms.emitterAxisU.value[i].w).toBe(1)
    expect(emitterUniforms.emitterAxisU.value[list.findIndex((e) => !e.lamp)].w).toBe(0)
    expect(emitterUniforms.emitterVehicleHalf.value.x).toBeGreaterThan(0.15)
    const inside = new THREE.Vector3(0.6, 0.7, 2.2).applyMatrix4(emitterUniforms.emitterVehicleInverse.value)
    expect(Math.abs(inside.x)).toBeLessThan(emitterUniforms.emitterVehicleHalf.value.x)
  })
})
