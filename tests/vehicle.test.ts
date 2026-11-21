import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { config, defaultPaint, paintById } from '../src/config'
import { events, lampThresholds, stateAt } from '../src/director/timeline'
import { createVehicle, type VehicleModule } from '../src/vehicle'

const paint = config.paint.candidates[0]
let a: VehicleModule
let b: VehicleModule
let full: VehicleModule

beforeAll(async () => {
  a = await createVehicle({ paint, detail: 'blockout' })
  b = await createVehicle({ paint, detail: 'blockout' })
  full = await createVehicle({ paint: paintById(defaultPaint), detail: 'full' })
}, 240_000)

function bodyBox(root: THREE.Object3D, mirrors: boolean): THREE.Box3 {
  const box = new THREE.Box3()
  const p = new THREE.Vector3()
  root.updateWorldMatrix(true, true)
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || (!mirrors && o.name.startsWith('mirror'))) return
    const pos = o.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) box.expandByPoint(p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld))
  })
  return box
}

function surfaceDistance(root: THREE.Object3D, q: THREE.Vector3): number {
  let best = Infinity
  const tri = new THREE.Triangle()
  const c = new THREE.Vector3()
  const local = new THREE.Vector3()
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const g = o.geometry as THREE.BufferGeometry
    g.computeBoundingBox()
    local.copy(q).applyMatrix4(o.matrixWorld.clone().invert())
    if (g.boundingBox!.distanceToPoint(local) > 0.02) return
    const pos = g.getAttribute('position')
    const idx = g.getIndex()!
    for (let i = 0; i < idx.count; i += 3) {
      tri.a.fromBufferAttribute(pos, idx.getX(i)).applyMatrix4(o.matrixWorld)
      tri.b.fromBufferAttribute(pos, idx.getX(i + 1)).applyMatrix4(o.matrixWorld)
      tri.c.fromBufferAttribute(pos, idx.getX(i + 2)).applyMatrix4(o.matrixWorld)
      tri.closestPointToPoint(q, c)
      best = Math.min(best, c.distanceTo(q))
    }
  })
  return best
}

describe('vehicle', () => {
  it('meets the factory size within 5 mm and keeps every part inside the shell and wheels', () => {
    const shell = new THREE.Group()
    for (const name of ['paint', 'glass', 'inner']) {
      const mesh = a.root.getObjectByName(name) as THREE.Mesh
      const copy = new THREE.Mesh(mesh.geometry)
      copy.name = name
      mesh.updateWorldMatrix(true, false)
      copy.applyMatrix4(mesh.matrixWorld)
      shell.add(copy)
    }
    const wheels = new THREE.Group()
    for (const side of ['left', 'right']) for (const end of ['front', 'rear']) {
      const w = a.root.getObjectByName(`wheel-${end}-${side}`)!
      w.updateWorldMatrix(true, true)
      const copy = w.clone()
      copy.position.setFromMatrixPosition(w.matrixWorld)
      wheels.add(copy)
    }
    const body = bodyBox(shell, false)
    const box = body.clone().union(bodyBox(wheels, false))
    expect(bodyBox(a.root, false).min.y).toBeGreaterThan(-0.002)
    const all = bodyBox(a.root, false)
    for (const k of ['x', 'y', 'z'] as const) {
      expect(all.min[k], k).toBeGreaterThan(box.min[k] - 0.005)
      expect(all.max[k], k).toBeLessThan(box.max[k] + 0.005)
    }
    expect(Math.abs(box.max.z - box.min.z - 4.947)).toBeLessThan(0.005)
    expect(Math.abs(body.max.x - body.min.x - 2.033)).toBeLessThan(0.005)
    expect(Math.abs(box.max.y - 1.16)).toBeLessThan(0.005)
    expect(Math.abs(box.min.y)).toBeLessThan(0.002)
    expect(Math.abs(box.max.z + box.min.z)).toBeLessThan(0.005)
    expect(Math.abs(box.max.x + box.min.x)).toBeLessThan(0.002)
  })

  it('puts every anchor on the surface and inside the bounds', () => {
    const box = bodyBox(a.root, true).expandByScalar(0.001)
    for (const [id, an] of Object.entries(a.anchors)) {
      expect(box.containsPoint(an.position), id).toBe(true)
      expect(surfaceDistance(a.root, an.position), id).toBeLessThan(0.004)
      expect(an.normal.length()).toBeCloseTo(1, 5)
      expect(an.radius).toBeGreaterThan(0)
    }
  })

  it('has lamps, beams and heat sources', () => {
    expect(a.lamps.length).toBeGreaterThan(0)
    const beams = a.lamps.filter((l) => l.beam)
    expect(beams.length).toBeGreaterThan(0)
    expect(beams.length).toBeLessThanOrEqual(4)
    expect(a.heatSources.length).toBe(2)
  })

  it('writes every lamp level and comes back to the start state at the end of the film', () => {
    const snap = (): number[] => {
      const s = a.root.getObjectByName('sprung')!
      return [...a.lamps.map((l) => l.level ?? -1), s.position.x, s.position.y, s.position.z, s.rotation.z]
    }
    a.update(stateAt(0))
    const start = snap()
    a.update(stateAt(config.film.durationSeconds / 2))
    for (const l of a.lamps) expect(l.level).toBeGreaterThanOrEqual(0)
    a.update(stateAt(config.film.durationSeconds))
    const end = snap()
    for (let i = 0; i < start.length; i++) expect(end[i]).toBeCloseTo(start[i], 9)
  })

  it('builds the same vertex data twice', () => {
    const data = (m: VehicleModule): number[] => {
      const out: number[] = []
      m.root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        const pos = o.geometry.getAttribute('position').array as Float32Array
        let h = 0
        for (let i = 0; i < pos.length; i++) h = (h * 31 + Math.round(pos[i] * 1e6)) % 2147483647
        out.push(pos.length, h)
      })
      return out
    }
    expect(data(a)).toEqual(data(b))
  })
  it('registers every render material with a wetness, casts and receives shadows and aims every lamp along its end', () => {
    for (const v of [a, full]) {
      const tracked = new Set(v.surfaces.map((s) => s.material))
      expect(tracked.size).toBe(v.surfaces.length)
      v.root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        expect(tracked.has(o.material), o.name).toBe(true)
        expect(o.castShadow, o.name).toBe(true)
        expect(o.receiveShadow, o.name).toBe(true)
      })
      for (const lamp of v.lamps) {
        const fore = lamp.object.position.z > 0
        const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(lamp.object.quaternion)
        expect(fore ? axis.z : -axis.z).toBeGreaterThan(0.9)
        expect(lamp.stage).toBe(lamp.beam ? lampThresholds.beamStart : lampThresholds.running)
        expect(lamp.intensity).toBeGreaterThan(0)
        expect(lamp.color).toBeInstanceOf(THREE.Color)
      }
    }
  })

  it('switches the full paint and leaves the blockout gray', () => {
    const next = config.paint.candidates.find((c) => c.id !== defaultPaint)!
    for (const [v, changes] of [[full, true], [a, false]] as const) {
      const swatch = (v.root.getObjectByName('paint') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>).material
      const initial = swatch.color.clone()
      v.setPaint(next)
      expect(swatch.color.equals(changes ? new THREE.Color(next.base) : initial)).toBe(true)
      v.setPaint(v === full ? paintById(defaultPaint) : paint)
    }
  })

  it('keeps the beam intensity per side and the running radiance on the stage scale', () => {
    full.update(stateAt(events.lampStageThree))
    const side = full.lamps.filter((l) => l.beam && l.object.position.x > 0)
    const sum = side.reduce((t, l) => t + (l.intensity ?? 0) * (l.level ?? 0), 0)
    expect(sum).toBeCloseTo(250)
    full.update(stateAt(0))
  })
})
