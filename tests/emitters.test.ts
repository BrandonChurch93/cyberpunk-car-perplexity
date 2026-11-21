import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  airTransmittance, beadReference, createEmitterTable, emitterGlsl, emitterUniforms, glintReference, maxEmitters,
  Occluders, rankEmitters, splitOf, waterF0, withEmitters, type Emitter,
} from '../src/core/emitters'

function face(name: string, width: number, height: number, tint: THREE.Color, at: THREE.Vector3, look: THREE.Vector3): THREE.Mesh {
  const material = new THREE.ShaderMaterial({ uniforms: { tint: { value: tint } } })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
  mesh.name = name
  mesh.position.copy(at)
  mesh.lookAt(look)
  return mesh
}

/** Draws each face as its own `tint`, flat, so a tile's mean is the tint. */
function fakeRenderer() {
  let target: THREE.WebGLRenderTarget | null = null
  const tiles: Array<{ x: number; y: number; w: number; h: number; color: THREE.Color }> = []
  const renderer = {
    shadowMap: { autoUpdate: true },
    getRenderTarget: () => target,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getClearColor: (c: THREE.Color) => c.set(0, 0, 0),
    getClearAlpha: () => 1,
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { target = t },
    setClearColor: () => undefined,
    clear: () => { tiles.length = 0 },
    render: (object: THREE.Object3D) => {
      const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
      const { x, y, z: w, w: h } = target!.viewport
      tiles.push({ x, y, w, h, color: (mesh.material.uniforms.tint.value as THREE.Color).clone() })
    },
    readRenderTargetPixels: (t: THREE.WebGLRenderTarget, _x: number, _y: number, width: number, _h: number, out: Float32Array) => {
      out.fill(0)
      for (const tile of tiles) for (let j = tile.y; j < tile.y + tile.h; j++) for (let i = tile.x; i < tile.x + tile.w; i++) {
        const at = (j * width + i) * 4
        out[at] = tile.color.r
        out[at + 1] = tile.color.g
        out[at + 2] = tile.color.b
      }
      expect(t.width).toBe(width)
    },
  }
  return renderer as unknown as THREE.WebGLRenderer
}

function scene(options: { lit?: boolean; wall?: boolean } = {}) {
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
  return createEmitterTable({ renderer: fakeRenderer(), world: { root: world }, vehicle: { root: vehicle, lamps: [{ object: origin, stage: 0, beam: true }] } })
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
    expect(splitOf(new THREE.Vector3(10, 0, 0), new THREE.Vector3(0, 1, 0))).toEqual([2, 1])
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
