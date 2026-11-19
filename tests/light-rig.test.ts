import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { FilmLight } from '../src/core/contract'
import { LightRig, vehicleShadowRegion } from '../src/core/lights'

function emitter(changes: Partial<FilmLight> = {}): FilmLight {
  return {
    id: 'fixture',
    kind: 'area',
    object: new THREE.Object3D(),
    size: [8, 3],
    color: new THREE.Color(0.5, 0.75, 1),
    intensity: 70,
    range: 100,
    beam: true,
    shadow: true,
    level: () => 1,
    ...changes,
  }
}

describe('film lights', () => {
  it('uses the emitter transform, sample position, animated level and matched optical model', () => {
    const area = emitter({ level: (t) => t / 10 })
    area.object.position.set(2, 4, 6)
    area.object.rotation.y = Math.PI / 2
    const compact = emitter({ kind: 'spot', size: [0.04, 0.04], angle: 0.3, penumbra: 0.6 })
    const wide = emitter({ kind: 'spot', size: [0.4, 0.15], angle: 1 })
    const point = emitter({ kind: 'point', shadow: false })
    const rig = new LightRig([area, compact, wide, point], 2048)
    const jitter: [number, number] = [0.25, 0.75]
    rig.update(2, jitter)
    const u = rig.uniforms
    expect(u.filmLightPosition.value[0].distanceTo(new THREE.Vector3(2, 4.75, 8))).toBeLessThan(1e-8)
    expect(u.filmLightAxis.value[0].x).toBeCloseTo(1)
    expect(u.filmLightAxis.value[0].w).toBeCloseTo(Math.cos(84 * Math.PI / 180))
    expect(u.filmLightColor.value[0].toArray()).toEqual([7, 10.5, 14, 100])
    expect(u.filmLightShape.value[0].x).toBe(-1)
    expect(u.filmLightShape.value[1].w).toBe(1)
    expect(u.filmLightShape.value[2].w).toBe(0)
    expect(u.filmLightAxis.value[3].w).toBe(-1)
    const spots = rig.group.children.filter((v): v is THREE.SpotLight => v instanceof THREE.SpotLight)
    expect(Math.cos(spots[0].angle * (1 - spots[0].penumbra))).toBeCloseTo(-1)
    expect(Math.cos(spots[1].angle * (1 - spots[1].penumbra))).toBeCloseTo(-u.filmLightShape.value[1].x)
    rig.update(3, [0.8, 0.3])
    const other = u.filmLightPosition.value[0].clone()
    rig.update(2, jitter)
    expect(u.filmLightPosition.value[0].distanceTo(other)).toBeGreaterThan(1)
    expect(u.filmLightPosition.value[0].distanceTo(new THREE.Vector3(2, 4.75, 8))).toBeLessThan(1e-8)
  })

  it('fits the deck and vehicle in a substantially tighter off-axis area map', () => {
    const area = emitter()
    area.object.position.set(16, 16, -62)
    area.object.lookAt(-8, 3, 0)
    const rig = new LightRig([area], 2048)
    const vehicle = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 5))
    vehicle.position.y = 0.6
    const deck = new THREE.Box2(new THREE.Vector2(-9, -18), new THREE.Vector2(18, 11))
    const bounds = vehicleShadowRegion(new THREE.Box3().setFromObject(vehicle), deck)
    expect(bounds.min.x).toBe(-9)
    expect(bounds.max.z).toBe(11)
    rig.fitContactRegion(vehicle, deck)
    rig.update(0, [0.08, 0.9])
    rig.group.updateMatrixWorld(true)
    const spot = rig.group.children.find((o): o is THREE.SpotLight => o instanceof THREE.SpotLight)!
    spot.shadow.updateMatrices(spot)
    expect(spot.shadow.camera.projectionMatrix.elements[0]).toBeGreaterThan(2)
    expect(Math.abs(spot.shadow.camera.projectionMatrix.elements[8])).toBeGreaterThan(0.1)
    expect(spot.shadow.camera.far).toBeLessThan(area.range)
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const uvz = new THREE.Vector3(x, y, z).applyMatrix4(spot.shadow.matrix)
          expect(uvz.toArray().every((value) => value > 0 && value < 1)).toBe(true)
        }
      }
    }
  })

  it('does not publish a stale shadow when an animated emitter turns off', () => {
    const point = emitter({ kind: 'point', level: (t) => t })
    const rig = new LightRig([point], 2048)
    const native = rig.group.children.find((o): o is THREE.PointLight => o instanceof THREE.PointLight)!
    const depth = new THREE.CubeDepthTexture(4)
    native.shadow.map = Object.assign(new THREE.WebGLCubeRenderTarget(4), { depthTexture: depth })
    rig.update(1, [0.5, 0.5])
    rig.syncShadowUniforms()
    expect(rig.shadowUniforms.filmPointShadow.value[0]).toBe(depth)
    expect(rig.shadowUniforms.filmShadowParams.value[0].x).toBe(-1)
    rig.update(0, [0.2, 0.3])
    rig.syncShadowUniforms()
    expect(rig.shadowUniforms.filmShadowParams.value[0].x).toBe(0)
  })
})
