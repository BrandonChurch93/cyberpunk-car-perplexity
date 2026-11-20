import * as T from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { defaultPaint, paintById } from '../src/config'
import { createVehicle, type VehicleModule } from '../src/vehicle'
import { frontWheel, rearWheel } from '../src/vehicle/body'

const paint = paintById(defaultPaint)
let blockout: VehicleModule
let full: VehicleModule

beforeAll(async () => {
  ;[blockout, full] = await Promise.all([
    createVehicle({ paint, detail: 'blockout' }),
    createVehicle({ paint, detail: 'full' }),
  ])
}, 30_000)

describe('closed-web forged wheel', () => {
  it('closes all five Y-spoke branch junctions into the rim and opens pentagon and triangle windows in both LODs', () => {
    for (const lod of [blockout, full]) {
      for (const [name, spec] of [['front wheel', frontWheel], ['rear wheel', rearWheel]] as const) {
        const wheel = lod.root.getObjectByName(name)
        expect(wheel).toBeDefined()
        if (!wheel) continue
        wheel.updateWorldMatrix(true, true)
        const R = spec.rim
        const ray = new T.Raycaster()
        const dir = new T.Vector3(-1, 0, 0)
        for (let k = 0; k < 5; k++) {
          const th = 0.22 + (k * Math.PI * 2) / 5
          for (const sign of [-1, 1]) {
            const a = th + sign * 0.468
            const p = wheel.localToWorld(new T.Vector3(1, 0.94 * R * Math.cos(a), 0.94 * R * Math.sin(a)))
            ray.set(p, dir)
            const hit = ray.intersectObject(wheel, true)[0]
            expect(hit?.object.name).toMatch(/satin forged spoke web|forged divided spokes and barrel|diamond cut spoke faces/)
          }
          const aPent = th + Math.PI / 5
          ray.set(wheel.localToWorld(new T.Vector3(1, 0.56 * R * Math.cos(aPent), 0.56 * R * Math.sin(aPent))), dir)
          expect(ray.intersectObject(wheel, true)[0]?.object.name ?? 'open').not.toMatch(/satin forged spoke web|forged divided spokes|diamond cut/)
          ray.set(wheel.localToWorld(new T.Vector3(1, 0.84 * R * Math.cos(th), 0.84 * R * Math.sin(th))), dir)
          expect(ray.intersectObject(wheel, true)[0]?.object.name ?? 'open').not.toMatch(/satin forged spoke web|forged divided spokes|diamond cut/)
        }
      }
    }
  })

  it('orients tire normals outward, keeps wheel materials isotropic and stays within the triangle budget', () => {
    let fullWheelTris = 0
    full.root.traverse((node) => {
      if (node.name !== 'front wheel' && node.name !== 'rear wheel') return
      node.traverse((child) => {
        if (!(child instanceof T.Mesh)) return
        const g = child.geometry
        fullWheelTris += g.index ? g.index.count / 3 : g.getAttribute('position').count / 3
        if (child.material instanceof T.MeshPhysicalMaterial && /spoke|barrel|flange|hub|cap|lug|caliper/.test(child.name)) {
          expect(child.material.anisotropy).toBe(0)
        }
      })
    })
    expect(fullWheelTris).toBeLessThan(550_000)

    const tire = full.root.getObjectByName('front wheel')?.getObjectByName('loaded rubber and tread')
    expect(tire).toBeInstanceOf(T.Mesh)
    if (tire instanceof T.Mesh) {
      const pos = tire.geometry.getAttribute('position')
      const nrm = tire.geometry.getAttribute('normal')
      let radialDotSum = 0
      let samples = 0
      for (let i = 0; i < pos.count; i += 37) {
        const y = pos.getY(i), z = pos.getZ(i), r = Math.hypot(y, z)
        if (r > frontWheel.radius - 0.008) {
          radialDotSum += (y * nrm.getY(i) + z * nrm.getZ(i)) / r
          samples++
        }
      }
      expect(samples).toBeGreaterThan(20)
      expect(radialDotSum / samples).toBeGreaterThan(0.75)
    }
  })
})
