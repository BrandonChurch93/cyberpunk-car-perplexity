import { createHash } from 'node:crypto'
import * as T from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { config, defaultPaint, paintById } from '../src/config'
import { events, lampThresholds, stateAt } from '../src/director/timeline'
import { createVehicle, type VehicleModule, type VehicleState } from '../src/vehicle'
import { zAt } from '../src/vehicle/body'

const paint = paintById(defaultPaint)
let blockout: VehicleModule
let full: VehicleModule

beforeAll(async () => {
  ;[blockout, full] = await Promise.all([createVehicle({ paint, detail: 'blockout' }), createVehicle({ paint, detail: 'full' })])
}, 30_000)

function setFrom(object: T.Object3D, omitMirrors = false): T.Box3 {
  const box = new T.Box3(), point = new T.Vector3()
  object.updateWorldMatrix(true, true)
  object.traverse((node) => {
    if (!(node instanceof T.Mesh) || (omitMirrors && node.parent?.name === 'door mirrors')) return
    const position = node.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) box.expandByPoint(point.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld))
  })
  return box
}

function surfaceDistance(root: T.Object3D, at: T.Vector3): number {
  let distance = Number.POSITIVE_INFINITY
  const point = new T.Vector3(), local = new T.Vector3(), triangle = new T.Triangle()
  root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return
    const geometry = node.geometry
    geometry.computeBoundingBox()
    node.worldToLocal(local.copy(at))
    if (geometry.boundingBox!.distanceToPoint(local) > .010) return
    const positions = geometry.getAttribute('position')
    const indices = geometry.getIndex()
    const vertices = indices?.count ?? positions.count
    for (let i = 0; i < vertices; i += 3) {
      triangle.a.fromBufferAttribute(positions, indices?.getX(i) ?? i)
      triangle.b.fromBufferAttribute(positions, indices?.getX(i + 1) ?? i + 1)
      triangle.c.fromBufferAttribute(positions, indices?.getX(i + 2) ?? i + 2)
      if (triangle.getArea() < 1e-12) continue
      triangle.closestPointToPoint(local, point)
      distance = Math.min(distance, point.distanceToSquared(local))
    }
  })
  return Math.sqrt(distance)
}

function fingerprint(root: T.Object3D): string {
  const hash = createHash('sha256')
  const append = (arr: ArrayBufferView) => hash.update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength))
  root.traverse((obj) => {
    append(new Float64Array([...obj.position, ...obj.quaternion, ...obj.scale]))
    if (!(obj instanceof T.Mesh)) return
    for (const name of ['position', 'normal', 'uv']) append(obj.geometry.getAttribute(name).array)
    if (obj.geometry.index) append(obj.geometry.index.array)
  })
  return hash.digest('hex')
}

function triangles(vehicle: VehicleModule): number {
  let n = 0
  vehicle.root.traverse((o) => {
    if (o instanceof T.Mesh) n += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3
  })
  return n
}

function instantaneous(car: VehicleModule, state: VehicleState) {
  car.update(state)
  const positions: number[][] = []
  car.root.traverse((o) => positions.push([...o.position, ...o.quaternion]))
  return { positions, levels: car.lamps.map((lamp) => lamp.level) }
}

describe('vehicle geometry and state', () => {
  it('turns the hood normal at each fold while retaining fair panels on either side', () => {
    full.root.updateMatrixWorld(true)
    const normalAt = (x: number, s: number): T.Vector3 => {
      const ray = new T.Raycaster(new T.Vector3(x, 2, zAt(s)), new T.Vector3(0, -1, 0))
      const hit = ray.intersectObject(full.root, true)[0]
      return hit.normal!.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(hit.object.matrixWorld))
    }
    for (const [x, s] of [[.410, .104], [.557, .104], [.359, .140], [.627, .140]]) {
      const a = normalAt(x - .002, s), b = normalAt(x + .002, s)
      expect(T.MathUtils.radToDeg(a.angleTo(b))).toBeGreaterThan(8)
      expect(T.MathUtils.radToDeg(a.angleTo(b))).toBeLessThan(15)
      expect(T.MathUtils.radToDeg(a.angleTo(normalAt(x - .010, s)))).toBeLessThan(3)
      expect(T.MathUtils.radToDeg(b.angleTo(normalAt(x + .010, s)))).toBeLessThan(3)
    }
  })

  it.each(['blockout', 'full'] as const)('rests at the origin and meets factory dimensions in %s', (detail) => {
    const vehicle = detail === 'full' ? full : blockout
    const whole = setFrom(vehicle.root)
    const size = whole.getSize(new T.Vector3())
    const sprung = vehicle.root.getObjectByName('sprung assembly')!
    const width = setFrom(sprung, true).getSize(new T.Vector3()).x
    expect(Math.abs(size.x - 2.266)).toBeLessThan(.005)
    expect(Math.abs(width - 2.033)).toBeLessThan(.005)
    expect(Math.abs(size.y - 1.160)).toBeLessThan(.005)
    expect(Math.abs(size.z - 4.947)).toBeLessThan(.005)
    expect(Math.abs(whole.min.y)).toBeLessThan(.00005)
    expect(Math.abs(whole.getCenter(new T.Vector3()).z)).toBeLessThan(.002)
    const front = vehicle.root.getObjectByName('front wheel')!
    const rear = vehicle.root.getObjectByName('rear wheel')!
    expect(front.position.x).toBeCloseTo(.860, 4)
    expect(rear.position.x).toBeCloseTo(.8505, 4)
    expect(front.position.z - rear.position.z).toBeCloseTo(2.779, 4)
  })

  it.each(['blockout', 'full'] as const)('puts all five macro anchors on the surface in %s', (detail) => {
    const vehicle = detail === 'full' ? full : blockout
    const bounds = setFrom(vehicle.root)
    for (const [id, a] of Object.entries(vehicle.anchors)) {
      expect(bounds.containsPoint(a.position), id).toBe(true)
      expect(a.normal.length(), id).toBeCloseTo(1, 7)
      expect(a.radius, id).toBeGreaterThan(0)
      expect(surfaceDistance(vehicle.root, a.position), id).toBeLessThan(.0015)
    }
  }, 30_000)

  it('registers every render material, shadow and light at both levels of detail', () => {
    for (const [vehicle, budget] of [[blockout, 400_000], [full, 2_000_000]] as const) {
      const trackedMaterials = new Set(vehicle.surfaces.map((surface) => surface.material))
      vehicle.root.traverse((o) => {
        if (!(o instanceof T.Mesh)) return
        expect(trackedMaterials.has(o.material)).toBe(true)
        expect(o.castShadow).toBe(true)
        expect(o.receiveShadow).toBe(true)
      })
      expect(triangles(vehicle)).toBeLessThan(budget)
      expect(vehicle.lamps).toHaveLength(8)
      expect(vehicle.lamps.filter((lamp) => !lamp.beam && lamp.object.position.z > 0)).toHaveLength(2)
      expect(vehicle.lamps.filter((lamp) => lamp.beam)).toHaveLength(4)
      expect(vehicle.heatSources).toHaveLength(2)
      for (const lamp of vehicle.lamps) {
        const fore = lamp.object.position.z > 0
        const axis = new T.Vector3(0, 0, 1).applyQuaternion(lamp.object.quaternion)
        expect(fore ? axis.z : -axis.z).toBeGreaterThan(.9)
        expect(lamp.stage).toBe(lamp.beam ? lampThresholds.beamStart : lampThresholds.running)
        expect(lamp.intensity).toBeGreaterThan(0)
        expect(lamp.color).toBeInstanceOf(T.Color)
      }
    }
  })

  it('responds to the lamp sequence and the kick without reconstructing the previous frame', () => {
    const car = full
    const fullBeam = stateAt(events.lampStageThree)
    car.update(stateAt(events.lampStageOne - .1))
    expect(car.lamps.every((lamp) => lamp.level === 0)).toBe(true)
    car.update(stateAt(events.lampStageTwo - .5))
    expect(car.lamps.filter((lamp) => lamp.beam).every((lamp) => lamp.level === 0)).toBe(true)
    expect(car.lamps.filter((lamp) => !lamp.beam && lamp.object.position.z > 0).every((lamp) => lamp.level === 1)).toBe(true)
    car.update(fullBeam)
    expect(car.lamps.filter((lamp) => lamp.beam).every((lamp) => lamp.level === 1)).toBe(true)
    const tail = car.lamps.find((lamp) => lamp.object.position.z < 0)!
    const base = tail.level!
    car.update(stateAt(events.engineStart + .41))
    expect(tail.level).toBeGreaterThan(base)
    const wheel = car.root.getObjectByName('front wheel')!
    const sprung = car.root.getObjectByName('sprung assembly')!
    expect(sprung.position.y).not.toBe(0)
    expect(Math.abs(sprung.position.y)).toBeLessThan(.002)
    expect(wheel.position.y).toBeCloseTo(.3405, 5)
    const first = instantaneous(car, stateAt(0))
    expect(instantaneous(car, stateAt(config.film.durationSeconds))).toEqual(first)
    const firstForced = instantaneous(car, { ...stateAt(0), vibration: 1 })
    expect(instantaneous(car, { ...stateAt(config.film.durationSeconds), vibration: 1 })).toEqual(firstForced)
  })

  it('keeps the machined spoke tips inside the bead-seat radius', () => {
    for (const vehicle of [full, blockout]) {
      for (const [name, radius] of [['front wheel', .254], ['rear wheel', .2667]] as const) {
        const wheel = vehicle.root.getObjectByName(name)!
        const face = wheel.getObjectByName('diamond cut spoke faces') as T.Mesh
        const positions = face.geometry.getAttribute('position')
        let outer = 0
        for (let i = 0; i < positions.count; i++) outer = Math.max(outer, Math.hypot(positions.getY(i), positions.getZ(i)))
        expect(outer).toBeLessThan(radius - .004)
        expect(outer).toBeGreaterThan(radius - .010)
      }
    }
  })

  it('holds both outlet centers and their rear-facing heat origins across LODs', () => {
    for (const vehicle of [full, blockout]) {
      const ports = vehicle.root.getObjectsByProperty('name', 'formed hexagonal outlet')
      expect(ports).toHaveLength(2)
      const origins = vehicle.heatSources.map(({ object }) => object).sort((a, b) => a.position.x - b.position.x)
      for (const [i, origin] of origins.entries()) {
        const outlet = origin.parent as T.Mesh
        expect(ports).toContain(outlet)
        expect(origin.position.x).toBeCloseTo(i === 0 ? -.18 : .18, 6)
        expect(origin.position.y).toBeCloseTo(.80, 6)
        expect(new T.Vector3(0, 0, 1).applyQuaternion(origin.quaternion).z).toBeLessThan(-.999)
        outlet.geometry.computeBoundingBox()
        const size = outlet.geometry.boundingBox!.getSize(new T.Vector3())
        expect(size.x / size.y).toBeGreaterThan(2.53)
        expect(size.x / size.y).toBeLessThan(2.63)
      }
    }
  })

  it('keeps surface radiance and emitted light intensity on the stage scale', () => {
    const lampsOn = stateAt(events.lampStageThree)
    const material = (name: string) =>
      (full.root.getObjectByName(name) as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>).material
    full.update(stateAt(0))
    expect(material('front running guide').emissiveIntensity).toBe(0)
    full.update(lampsOn)
    const front = material('front running guide'), rear = material('tail running guide')
    expect(front.emissiveIntensity * front.emissive.g).toBeGreaterThan(80)
    expect(front.emissiveIntensity * front.emissive.g).toBeLessThan(200)
    expect(rear.emissiveIntensity * rear.emissive.r).toBeGreaterThan(20)
    expect(rear.emissiveIntensity * rear.emissive.r).toBeLessThan(60)
    const sum = full.lamps.filter((lamp) => lamp.beam && lamp.object.position.x > 0)
      .reduce((total, lamp) => total + (lamp.intensity ?? 0) * (lamp.level ?? 0), 0)
    expect(sum).toBeCloseTo(250)
  })

  it('switches the full base paint and leaves the phase blockout gray', () => {
    const next = config.paint.candidates.find((candidate) => candidate.id !== defaultPaint)!
    for (const [vehicle, shouldChange] of [[full, true], [blockout, false]] as const) {
      const swatch = (vehicle.root.getObjectByName('closed body panels and returns') as T.Mesh<T.BufferGeometry, T.MeshPhysicalMaterial>).material
      const initial = swatch.color.clone()
      vehicle.setPaint(next)
      expect(swatch.color.equals(shouldChange ? new T.Color(next.base) : initial)).toBe(true)
      vehicle.setPaint(paint)
    }
  })

  it('rebuilds vertex, normal, UV and index bytes deterministically', async () => {
    for (const detail of ['blockout', 'full'] as const) {
      const current = detail === 'blockout' ? blockout : full
      const identical = await createVehicle({ paint, detail })
      const fresh = { timeSeconds: 0, lampStage: 0, engine: 0, vibration: 0 }
      current.update(fresh)
      identical.update(fresh)
      expect(fingerprint(current.root)).toBe(fingerprint(identical.root))
    }
  }, 30_000)
})
