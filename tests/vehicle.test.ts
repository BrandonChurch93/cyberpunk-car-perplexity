import { createHash } from 'node:crypto'
import * as T from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { config, defaultPaint, paintById } from '../src/config'
import { cameraAt } from '../src/director/shots'
import { events, lampThresholds, stateAt } from '../src/director/timeline'
import { patchesOf } from '../src/materials/patch'
import { createVehicle, type VehicleModule, type VehicleState } from '../src/vehicle'
import { frontWheel, rearWheel, sAt, zAt } from '../src/vehicle/body'

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
  it('turns the hood and flank normals at the folds while retaining fair adjoining panels', () => {
    full.root.updateMatrixWorld(true)
    const normalAt = (across: number, s: number, side = false): T.Vector3 => {
      const eye = side ? new T.Vector3(2, across, zAt(s)) : new T.Vector3(across, 2, zAt(s))
      const ray = new T.Raycaster(eye, side ? new T.Vector3(-1, 0, 0) : new T.Vector3(0, -1, 0))
      const hit = ray.intersectObject(full.root, true)[0]
      return hit.normal!.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(hit.object.matrixWorld))
    }
    for (const [x, s] of [[.410, .104], [.557, .104], [.359, .140], [.627, .140], [.7022, .102]]) {
      const a = normalAt(x - .002, s), b = normalAt(x + .002, s)
      expect(T.MathUtils.radToDeg(a.angleTo(b))).toBeGreaterThan(15)
      expect(T.MathUtils.radToDeg(a.angleTo(b))).toBeLessThan(25)
      expect(T.MathUtils.radToDeg(a.angleTo(normalAt(x - .010, s)))).toBeLessThan(3)
      expect(T.MathUtils.radToDeg(b.angleTo(normalAt(x + .010, s)))).toBeLessThan(3)
    }
    for (const [y, s] of [[.338, .530], [.650, .460], [.896, .760], [.924, .812], [.774, .724]]) {
      const a = normalAt(y - .002, s, true), b = normalAt(y + .002, s, true)
      expect(T.MathUtils.radToDeg(a.angleTo(b))).toBeGreaterThan(15)
      expect(T.MathUtils.radToDeg(a.angleTo(b))).toBeLessThan(25)
    }
    for (const [wheel, offset] of [[frontWheel, .023], [rearWheel, .032]] as const) {
      const crown = wheel.loaded + wheel.arch + offset, s = sAt(wheel.z)
      const a = normalAt(crown - .002, s, true), b = normalAt(crown + .002, s, true)
      expect(T.MathUtils.radToDeg(a.angleTo(b))).toBeGreaterThan(15)
      expect(T.MathUtils.radToDeg(a.angleTo(b))).toBeLessThan(25)
    }
    for (const [x, s] of [[-.318, .520], [.318, .490], [.686, .750], [.849, .789]]) {
      const a = normalAt(x - .003, s), b = normalAt(x + .003, s)
      expect(T.MathUtils.radToDeg(a.angleTo(b))).toBeGreaterThan(15)
      expect(T.MathUtils.radToDeg(a.angleTo(b))).toBeLessThan(25)
    }
  })

  it('keeps the haunch crown inside the front projection envelope', () => {
    for (const vehicle of [blockout, full]) {
      vehicle.root.updateMatrixWorld(true)
      for (const side of [-1, 1]) for (const [x, y] of [[.82, .964], [.86, .952], [.94, .936]]) {
        const ray = new T.Raycaster(new T.Vector3(side * x, y, 3), new T.Vector3(0, 0, -1))
        expect(ray.intersectObject(vehicle.root, true)).toHaveLength(0)
      }
    }
  })

  it('keeps the bonnet skin over its backing and separates the shield from the low opening', () => {
    for (const vehicle of [full, blockout]) {
      vehicle.root.updateMatrixWorld(true)
      for (const side of [-1, 1]) {
        for (const x of [.119, .162, .216]) for (const s of [.027, .031, .035]) {
          const ray = new T.Raycaster(new T.Vector3(side * x, .9, zAt(s)), new T.Vector3(0, -1, 0))
          expect(ray.intersectObject(vehicle.root, true)[0]?.object.name).toBe('closed body panels and returns')
        }
        const sight = (y: number) => {
          const ray = new T.Raycaster(new T.Vector3(side * .120, y, 3), new T.Vector3(0, 0, -1))
          return ray.intersectObject(vehicle.root, true)[0]
        }
        const shield = sight(.362), opening = sight(.256)
        expect(shield?.object.name).toBe('nose blades, shield and lower lip')
        expect(shield.point.z - opening.point.z).toBeGreaterThan(.065)
      }
    }
  })

  it('keeps the bonnet crowned and the wheelhouse below the paint at the screen foot', () => {
    for (const vehicle of [full, blockout]) {
      vehicle.root.updateMatrixWorld(true)
      const top = (x: number, s: number) => new T.Raycaster(new T.Vector3(x, 1.5, zAt(s)), new T.Vector3(0, -1, 0))
        .intersectObject(vehicle.root)[0]
      for (const [x, s, height] of [
        [0, .005, .422], [0, .010, .446], [0, .015, .463], [.535, .060, .585],
        [0, .080, .624], [0, .100, .663], [0, .120, .697], [.344, .150, .746],
      ]) {
        expect(Math.abs(top(x, s).point.y - height)).toBeLessThan(.008)
      }
      for (const s of [.075, .100, .130]) {
        for (const side of [-1, 1]) {
          const crest = top(0, s), outer = top(side * .31, s)
          expect(crest.object.name).toBe('closed body panels and returns')
          expect(crest.point.y - outer.point.y).toBeGreaterThan(.001)
        }
      }
      for (const side of [-1, 1]) for (const x of [.750, .776, .800]) for (const s of [.232, .237, .242]) {
        expect(top(side * x, s).object.name).toBe('closed body panels and returns')
      }
    }
  })

  it('keeps the outer bonnet normals continuous past the lamp fold and profile taper', () => {
    for (const vehicle of [blockout, full]) {
      vehicle.root.updateMatrixWorld(true)
      const skin = vehicle.root.getObjectByName('closed body panels and returns')!
      const ray = new T.Raycaster()
      const down = new T.Vector3(0, -1, 0)
      const normal = (x: number, s: number) => {
        ray.set(new T.Vector3(x, 1.5, zAt(s)), down)
        return ray.intersectObject(skin)[0].normal!
      }
      for (const s of [.182, .209]) for (const x of [.82, .86, .90, .94]) {
        expect(T.MathUtils.radToDeg(normal(x, s - .0005).angleTo(normal(x, s + .0005)))).toBeLessThan(.65)
      }
    }
  })

  it('carries the upper haunch fold across the deck and clears the quarter at the rear arch', () => {
    for (const vehicle of [full, blockout]) {
      vehicle.root.updateMatrixWorld(true)
      const body = vehicle.root.getObjectByName('closed body panels and returns')!
      const hit = (y: number, z: number) => new T.Raycaster(new T.Vector3(2, y, z), new T.Vector3(-1, 0, 0))
        .intersectObject(body)[0]
      for (const [s, y] of [[.697, 1.047], [.750, 1.015], [.808, .975]]) {
        const a = hit(y - .004, zAt(s)), b = hit(y + .004, zAt(s))
        const turn = T.MathUtils.radToDeg(a.normal!.angleTo(b.normal!))
        expect(turn).toBeGreaterThan(15)
        expect(turn).toBeLessThan(25)
      }
      const tangent = rearWheel.z + rearWheel.arch
      expect(hit(rearWheel.loaded, tangent - .012)).toBeUndefined()
      expect(hit(rearWheel.loaded, tangent + .006).point.x).toBeGreaterThan(rearWheel.x)
      const inside = hit(.622, tangent - .002), outside = hit(.622, tangent + .002)
      expect(T.MathUtils.radToDeg(inside.normal!.angleTo(outside.normal!))).toBeLessThan(8)
      for (const [s, y] of [[.636, .766], [.653, .790], [.677, .824]]) {
        const ray = new T.Raycaster(new T.Vector3(2, y, zAt(s)), new T.Vector3(-1, 0, 0))
        const throat = ray.intersectObject(vehicle.root, true)[0]
        expect(throat.object.name).toBe('stowage, seals and wheelhouse liners')
        expect(hit(y - .032, zAt(s)).point.x - throat.point.x).toBeGreaterThan(.045)
        expect(hit(y + .040, zAt(s)).point.x - throat.point.x).toBeGreaterThan(.045)
      }
    }
  })

  it('forms a true diagonal turn and a deep intake that reaches the lower flank', () => {
    for (const vehicle of [full, blockout]) {
      vehicle.root.updateMatrixWorld(true)
      for (const side of [-1, 1]) {
        const profile = (s: number, y: number) => new T.Raycaster(new T.Vector3(side * 2, y, zAt(s)), new T.Vector3(-side, 0, 0))
          .intersectObject(vehicle.root)[0]
        for (const [s, y] of [[.548, .22], [.561, .33]]) {
          const a = profile(s - .001, y), b = profile(s + .001, y)
          const turn = T.MathUtils.radToDeg(a.normal!.angleTo(b.normal!))
          expect(a.object.name).toBe('closed body panels and returns')
          expect(b.object.name).toBe(a.object.name)
          expect(turn).toBeGreaterThan(15)
          expect(turn).toBeLessThan(25)
          const toe = profile(s + .0066, y)
          expect(toe.object.name).toBe(a.object.name)
          expect((b.point.x - toe.point.x) * side).toBeGreaterThan(.007)
          expect((b.point.x - toe.point.x) * side).toBeLessThan(.011)
        }
        expect(profile(.617, .230).object.name).toBe('closed body panels and returns')
        for (const [s, y] of [[.624, .230], [.625, .400], [.583, .650]]) {
          const mouth = profile(s, y), panel = profile(s - .05, y)
          expect(mouth.object.name).toBe('stowage, seals and wheelhouse liners')
          expect((panel.point.x - mouth.point.x) * side).toBeGreaterThan(.145)
        }
      }
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

  it('places the paint anchor on the upward-facing outer wing below its crest', () => {
    for (const vehicle of [blockout, full]) {
      const { position, normal, radius } = vehicle.anchors.paint
      expect(position.z).toBeCloseTo(1.55, 2)
      expect(position.distanceTo(new T.Vector3(.97986, .75324, 1.55))).toBeLessThan(.002)
      expect(radius).toBe(.32)
      expect(normal.x).toBeGreaterThan(.9)
      expect(normal.y).toBeGreaterThan(0)
      const { x, y, z } = position
      const overhead = new T.Raycaster(new T.Vector3(x - .006, 2, z), new T.Vector3(0, -1, 0))
      vehicle.root.updateMatrixWorld(true)
      const drop = overhead.intersectObject(vehicle.root)[0].point.y - y
      expect(drop).toBeGreaterThan(.020)
      expect(drop).toBeLessThan(.040)
    }
  })

  it('keeps the outer wing reflection sweep smooth beside the paint anchor', () => {
    for (const vehicle of [blockout, full]) {
      vehicle.root.updateMatrixWorld(true)
      const skin = vehicle.root.getObjectByName('closed body panels and returns')!
      const ray = new T.Raycaster()
      const direction = new T.Vector3(-1, 0, 0)
      const archStart = frontWheel.z + frontWheel.arch
      const hit = (y: number, z: number) => {
        ray.set(new T.Vector3(1.1, y, z), direction)
        return ray.intersectObject(skin)[0]
      }
      for (const y of [.715, .725, .735, .745]) {
        const ahead = hit(y, archStart + .001), behind = hit(y, archStart - .001)
        expect(Math.abs(ahead.point.x - behind.point.x)).toBeLessThan(.0006)
        expect(T.MathUtils.radToDeg(ahead.normal!.angleTo(behind.normal!))).toBeLessThan(.5)
      }
      for (const y of [.745, .753, .757]) {
        let previous: T.Vector3 | undefined
        let sweep = 0
        for (let step = 0; step <= 32; step++) {
          const normal = hit(y, 1.622 - .008 * step).normal!.normalize()
          expect(normal.x).toBeGreaterThan(.95)
          if (previous) {
            const turn = T.MathUtils.radToDeg(normal.angleTo(previous))
            expect(turn).toBeLessThan(1.0)
            sweep += turn
          }
          previous = normal
        }
        expect(sweep / 32).toBeLessThan(.42)
      }
    }
  }, 30_000)

  it('keeps a closed mirror seam and an unobstructed glass face on both sides', () => {
    for (const car of [blockout, full]) {
      const mirrors = car.root.getObjectByName('door mirrors')!
      mirrors.updateWorldMatrix(true, true)
      for (const side of [-1, 1]) {
        const sideHit = (y: number) => new T.Raycaster(
          new T.Vector3(side * 1.45, y, .718), new T.Vector3(-side, 0, 0),
        ).intersectObject(mirrors, true)[0].object.name
        expect(sideHit(.865)).toBe('painted upper mirror wings')
        expect(sideHit(.851)).toBe('mirror shell seam and rear gaskets')
        expect(sideHit(.827)).toBe('lower mirror shells')
        for (const x of [.96, 1.015, 1.07]) for (const y of [.821, .846, .868]) {
          const hit = new T.Raycaster(new T.Vector3(side * x, y, .4), new T.Vector3(0, 0, 1)).intersectObject(mirrors, true)[0]
          expect(hit.object.name).toBe('mirror glass')
        }
      }
    }
  })

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
      expect(vehicle.lamps).toHaveLength(9)
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

  it('keeps both cam covers and the dark center gap exposed in both LODs', () => {
    for (const car of [blockout, full]) {
      const topHit = (x: number, z = zAt(.784)) => new T.Raycaster(
        new T.Vector3(x, 2, z), new T.Vector3(0, -1, 0),
      ).intersectObject(car.root, true)[0]
      const gap = topHit(0)
      expect(gap.object.name).toBe('dark intake plenum and engine hardware')
      for (const x of [-.125, .125]) {
        const hit = topHit(x)
        expect(hit.object.name).toBe('carbon cam covers with hex relief')
        expect(Math.abs(hit.point.y - gap.point.y)).toBeLessThan(.005)
      }
      expect(car.root.getObjectByName('high rear brake lamp bar')).toBeDefined()
      let previous = 0
      for (const s of [.853, .870, .887]) {
        const hit = topHit(0, zAt(s))
        expect(hit.object.name).toBe('dark chevron rear bay louvers')
        expect(hit.point.y - previous).toBeGreaterThan(.02)
        const color = (hit.object as T.Mesh).geometry.getAttribute('color')
        expect(color.getX(hit.face!.a)).toBeCloseTo(s === .887 ? .25 : .76)
        previous = hit.point.y
      }
    }
  })

  it('anchors the detail above a clear, perforated airbox on the right', () => {
    for (const car of [blockout, full]) {
      car.root.updateMatrixWorld(true)
      const { position, normal, radius } = car.anchors.detail
      const grille = car.root.getObjectByName('front airbox hex grilles') as T.Mesh
      const p = grille.geometry.getAttribute('position')
      const corners = Array.from({ length: 4 }, (_, i) => new T.Vector3().fromBufferAttribute(p, p.count / 2 + i))
      const axis = corners[1].clone().sub(corners[0])
      const across = corners[3].clone().sub(corners[0])
      expect(axis.length()).toBeCloseTo(.420, 5)
      expect(across.length()).toBeCloseTo(.184, 5)
      expect(position.distanceTo(corners[0].clone().lerp(corners[2], .5))).toBeLessThan(.000001)
      expect(position.x).toBeLessThan(0)
      expect(normal.y).toBeGreaterThan(Math.cos(T.MathUtils.degToRad(25)))
      expect(radius).toBe(.16)
      const ray = new T.Raycaster()
      const look = (eye: T.Vector3, at: T.Vector3) => {
        ray.set(eye, at.clone().sub(eye).normalize())
        return ray.intersectObject(car.root, true)[0]
      }
      const apothem = (car === full ? .0078 : .01175) * Math.sqrt(3) / 2
      const hole = position.clone().addScaledVector(across.clone().normalize(), apothem)
      const backing = look(hole.clone().addScaledVector(normal, .4), hole)
      expect(backing.object.name).toBe('recessed airbox grille trays')
      expect(backing.distance).toBeCloseTo(.424, 5)
      for (const [u, v] of [[1, 0], [0, 1], [-1, 0], [0, -1], [0, 0]]) {
        const eye = position.clone().addScaledVector(normal, .7)
          .addScaledVector(axis.clone().normalize(), .32 * u).addScaledVector(across.clone().normalize(), .32 * v)
        const hit = look(eye, position)
        expect(hit.object).toBe(grille)
        expect(hit.point.distanceTo(position)).toBeLessThan(.000001)
      }
    }
  })

  it('keeps the exposed bay cover and vent faces beaded and the cavity returns dry', () => {
    for (const vehicle of [blockout, full]) {
      for (const [name, wetness] of [
        ['carbon cam covers with hex relief', 'beads'],
        ['stepped carbon bay vents', 'beads'],
        ['dry carbon bay wall returns', 'none'],
        ['matte hex pad walls', 'none'],
        ['front airbox hex grilles', 'none'],
        ['dark chevron rear bay louvers', 'none'],
      ]) {
        const mesh = vehicle.root.getObjectByName(name) as T.Mesh
        expect(mesh).toBeDefined()
        expect(vehicle.surfaces.find((surface) => surface.material === mesh.material)?.wetness).toBe(wetness)
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

  it('recesses the flat cap behind the machined rim and seats the lugs above the hub plate', () => {
    for (const vehicle of [full, blockout]) {
      const wheel = vehicle.root.getObjectByName('front wheel')!
      const outerX = (name: string) => {
        const mesh = wheel.getObjectByName(name) as T.Mesh
        mesh.geometry.computeBoundingBox()
        return mesh.geometry.boundingBox!.max.x
      }
      const plate = outerX('flat recessed hub plate')
      const cap = outerX('flat center cap')
      expect(cap - plate).toBeCloseTo(.0018, 5)
      expect(outerX('machined flange') - cap).toBeGreaterThan(.025)
      expect(outerX('five lug nuts')).toBeGreaterThan(cap)
    }
  })

  it('keeps a full-size upper brake caliper and an open drilled ring in both LODs', () => {
    for (const vehicle of [full, blockout]) {
      const wheel = vehicle.root.getObjectByName('front wheel')!
      const part = (name: string) => wheel.getObjectByName(name) as T.Mesh<T.BufferGeometry>
      const caliper = part('fixed brake caliper')
      const shell = caliper.geometry.getAttribute('position')
      const angles: number[] = [], radii: number[] = []
      for (let i = 0; i < shell.count; i++) {
        angles.push(Math.atan2(shell.getZ(i), shell.getY(i)))
        radii.push(Math.hypot(shell.getY(i), shell.getZ(i)))
      }
      const radial = Math.max(...radii) - Math.min(...radii)
      const arcLength = (Math.max(...angles) - Math.min(...angles)) * (Math.max(...radii) + Math.min(...radii)) / 2
      expect(radial).toBeGreaterThan(.080)
      expect(radial).toBeLessThan(.100)
      expect(arcLength).toBeGreaterThan(.365)
      expect(arcLength).toBeLessThan(.420)
      caliper.geometry.computeBoundingBox()
      expect(caliper.geometry.boundingBox!.max.y).toBeGreaterThan(.20)
      expect(caliper.geometry.boundingBox!.min.z).toBeLessThan(-.21)

      const disc = part('drilled ceramic rotor').clone()
      const cast = part('fixed brake caliper').clone()
      disc.updateMatrixWorld(true)
      cast.updateMatrixWorld(true)
      disc.geometry.computeBoundingBox()
      const box = disc.geometry.boundingBox!
      const face = box.max.x
      expect(box.max.x - box.min.x).toBeCloseTo(frontWheel.discDepth, 3)
      const ring = (y: number, z: number) => new T.Raycaster(new T.Vector3(1, y, z), new T.Vector3(-1, 0, 0))
      const drill = ring(0, -(frontWheel.disc - .018)).intersectObject(disc)[0]
      expect(!drill || drill.point.x < face - .015).toBe(true)
      expect(ring(.010, -(frontWheel.disc - .018)).intersectObject(disc)[0].point.x).toBeCloseTo(face, 4)
      expect(ring(.152 * Math.cos(-.86), .152 * Math.sin(-.86)).intersectObject(cast)[0].point.x).toBeGreaterThan(face)
      for (let i = 0; i < 24; i++) {
        const a = (i + .314) * Math.PI / 12
        expect(ring(.202 * Math.cos(a), .202 * Math.sin(a)).intersectObject(disc).length).toBeGreaterThan(0)
        expect(ring(.206 * Math.cos(a), .206 * Math.sin(a)).intersectObject(disc)).toHaveLength(0)
      }
      expect(part('floating rotor hat')).toBeDefined()
      expect(part('recessed drill wells and rotor vents')).toBeDefined()
      expect(part('molded sidewall relief')).toBeDefined()
      const localWheel = new T.Group().add(...wheel.children.map((child) => child.clone()))
      localWheel.updateMatrixWorld(true)
      for (const [angle, reach] of [[48, 1.7], [58, 1.6], [68, 1.5]]) {
        const a = T.MathUtils.degToRad(angle)
        const eye = new T.Vector3(reach * Math.sin(a) + .0963, -.18, reach * Math.cos(a))
        let visible = 0
        for (let i = 0; i < 18; i++) {
          const b = -1.7 + .10 * i
          const target = new T.Vector3(face, .183 * Math.cos(b), .183 * Math.sin(b))
          const hit = new T.Raycaster(eye, target.sub(eye).normalize()).intersectObject(localWheel, true)[0]
          if (hit?.object.name.startsWith('fixed brake caliper') || hit?.object.name.startsWith('caliper pin')) visible++
        }
        expect(visible).toBeGreaterThanOrEqual(5)
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
        expect(size.x / size.y).toBeGreaterThan(2.87)
        expect(size.x / size.y).toBeLessThan(2.97)
      }
    }
  })

  it('keeps both hexagonal cavities open to the ignition camera', () => {
    for (const vehicle of [full, blockout]) {
      vehicle.root.updateMatrixWorld(true)
      const { position } = cameraAt(950 / config.film.fps, config.formats.preview, vehicle.anchors)
      for (const { object } of vehicle.heatSources) {
        const center = object.getWorldPosition(new T.Vector3())
        for (const [x, y] of [[0, 0], [.064, .022], [-.064, -.022]]) {
          const target = center.clone().add(new T.Vector3(x, y, 0))
          const ray = new T.Raycaster(position, target.sub(position).normalize())
          expect(ray.intersectObject(vehicle.root, true)[0]?.object.name).toBe('hexagonal outlet cavities')
        }
      }
    }
  })

  it('joins the rear outlet mask to the lamps and preserves the painted crest', () => {
    for (const vehicle of [full, blockout]) {
      vehicle.root.updateMatrixWorld(true)
      for (const x of [-.42, -.36, -.15, 0, .15, .36, .42]) {
        const y = Math.abs(x) === .15 ? .864 : .800
        const ray = new T.Raycaster(new T.Vector3(x, y, -4), new T.Vector3(0, 0, 1))
        expect(ray.intersectObject(vehicle.root)[0]?.object.name).toBe('lamp bezels and air ducts')
      }
      for (const x of [-.22, 0, .22]) {
        const top = (s: number) => new T.Raycaster(new T.Vector3(x, 1.8, zAt(s)), new T.Vector3(0, -1, 0))
          .intersectObject(vehicle.root)[0].point.y
        expect(top(.985)).toBeGreaterThan(.889)
        expect(top(.995)).toBeGreaterThan(.570)
        expect(top(.995)).toBeLessThan(.630)
      }
    }
  })

  it('keeps the high brake lamp clear of the bay louvers in both detail cameras', () => {
    for (const vehicle of [full, blockout]) {
      const name = 'high rear brake lamp bar'
      const bar = vehicle.root.getObjectByName(name) as T.Mesh
      vehicle.root.updateMatrixWorld(true)
      const position = bar.geometry.getAttribute('position')
      const index = bar.geometry.getIndex()!
      const face = new T.Triangle(), normal = new T.Vector3(), points: T.Vector3[] = []
      for (let i = 0; i < index.count; i += 3) {
        face.a.fromBufferAttribute(position, index.getX(i))
        face.b.fromBufferAttribute(position, index.getX(i + 1))
        face.c.fromBufferAttribute(position, index.getX(i + 2))
        face.getNormal(normal)
        if (normal.y > .4 && normal.z < -.4) points.push(bar.localToWorld(face.getMidpoint(new T.Vector3())))
      }
      expect(points.length).toBeGreaterThan(5)
      points.sort((a, b) => a.x - b.x)
      for (const format of [config.formats.master, config.formats.vertical]) for (const frame of [775, 800, 849]) {
        const eye = cameraAt(frame / config.film.fps, format, vehicle.anchors).position
        for (const fraction of [.1, .3, .5, .7, .9]) {
          const point = points[Math.floor(fraction * points.length)]
          const hit = new T.Raycaster(eye, point.clone().sub(eye).normalize()).intersectObject(vehicle.root)[0]
          expect(hit?.object.name).toBe(name)
        }
      }
    }
  })

  it('keeps the diffuser inside the lower side profile at the tail', () => {
    for (const vehicle of [full, blockout]) {
      const surfaces = ['channeled graphite rear diffuser', 'thin graphite diffuser blades'].map((name) =>
        (vehicle.root.getObjectByName(name) as T.Mesh).geometry.getAttribute('position'))
      for (const [station, minY] of [[.98, .309], [.995, .407]]) {
        let bottom = Number.POSITIVE_INFINITY
        for (const points of surfaces) for (let i = 0; i < points.count; i++) {
          if (Math.abs(points.getZ(i) - zAt(station)) < .008) bottom = Math.min(bottom, points.getY(i))
        }
        expect(bottom).toBeLessThan(.54)
        expect(bottom).toBeGreaterThan(minY)
      }
    }
  })

  it('keeps rear-facing diffuser blade edges below the bumper lip', () => {
    for (const vehicle of [full, blockout]) {
      vehicle.root.updateMatrixWorld(true)
      const blades = vehicle.root.getObjectByName('thin graphite diffuser blades') as T.Mesh
      blades.geometry.computeBoundingBox()
      expect(blades.geometry.boundingBox!.max.y).toBeLessThan(.538)
      const { position } = cameraAt(950 / config.film.fps, config.formats.preview, vehicle.anchors)
      for (const eye of [position, new T.Vector3(2.8, .75, -5.25)]) for (const side of [-1, 1]) {
        for (const [x, y, z] of [
          [.42741, .48303, -2.43442], [.42963, .46428, -2.42908], [.43203, .44553, -2.42565],
          [.43546, .42053, -2.42315], [.43817, .40178, -2.42050],
          [.65166, .51733, -2.29931], [.65537, .49909, -2.29570], [.65980, .48084, -2.29209],
          [.67768, .42000, -2.28149], [.68372, .40175, -2.27774],
        ]) {
          const ray = new T.Raycaster(eye, new T.Vector3(side * x, y, z).sub(eye).normalize())
          const hit = ray.intersectObject(vehicle.root, true)[0]
          expect(hit?.object.name, `${side * x}, ${y}`).toBe('thin graphite diffuser blades')
          expect(hit.normal!.z).toBeLessThan(-.44)
        }
      }
    }
  }, 15_000)

  it('keeps the painted rear fascia in front of the internal liner', () => {
    for (const vehicle of [full, blockout]) {
      vehicle.root.updateMatrixWorld(true)
      const { position } = cameraAt(950 / config.film.fps, config.formats.preview, vehicle.anchors)
      for (const [x, y, z] of [
        [.390, .648, -2.310], [.374, .637, -2.307], [.354, .609, -2.314], [.287, .656, -2.294],
        [.725, .574, -2.226], [.617, .548, -2.302], [.536, .557, -2.348], [-.62, .625, -2.3],
      ]) {
        const ray = new T.Raycaster(position, new T.Vector3(x, y, z).sub(position).normalize())
        expect(ray.intersectObject(vehicle.root, true)[0]?.object.name).toBe('rear bumper paint surfaces')
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

  it('shows both projector cores through two separate lens surfaces in the lamp shot', () => {
    for (const vehicle of [blockout, full]) {
      const cores = vehicle.root.getObjectsByProperty('name', 'main beam projector')
        .filter((node): node is T.Mesh => node instanceof T.Mesh && node.position.x > 0)
      expect(cores).toHaveLength(2)
      vehicle.root.updateMatrixWorld(true)
      for (const frame of [610, 690]) {
        const { position } = cameraAt(frame / config.film.fps, config.formats.preview, vehicle.anchors)
        for (const core of cores) {
          core.geometry.computeBoundingBox()
          const size = core.geometry.boundingBox!.getSize(new T.Vector3()).multiplyScalar(.31)
          for (const [x, y] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const p = core.localToWorld(new T.Vector3(size.x * x, size.y * y, 0))
            const ray = new T.Raycaster(position, p.sub(position).normalize())
            expect(ray.intersectObject(vehicle.root, true).slice(0, 3).map(({ object }) => object.name)).toEqual([
              'front optical lens shells', 'convex projector lenses', 'main beam projector',
            ])
          }
        }
      }
    }
  })

  it('keeps the optical shell normals continuous across the front plan limit', () => {
    for (const vehicle of [blockout, full]) {
      vehicle.root.updateMatrixWorld(true)
      const shell = vehicle.root.getObjectByName('front optical lens shells')!
      const ray = new T.Raycaster(new T.Vector3(), new T.Vector3(0, 0, -1))
      for (const [x, y0] of [[.609, .508], [.625, .472], [.646, .471], [.682, .474]]) {
        let prior: T.Vector3 | undefined
        for (let i = 0; i <= 12; i++) {
          ray.ray.origin.set(x, y0 + .0005 * i, 3)
          const normal = ray.intersectObject(shell)[0]?.normal
          expect(normal).toBeDefined()
          if (prior) expect(prior.angleTo(normal!)).toBeLessThan(T.MathUtils.degToRad(1.3))
          prior = normal
        }
      }
    }
  })

  it('keeps the upper running guide free of opaque trim in the lamp shot', () => {
    for (const vehicle of [blockout, full]) {
      vehicle.root.updateMatrixWorld(true)
      const guide = vehicle.root.getObjectsByProperty('name', 'front running guide').find((node) => node.position.x > 0)!
      for (const y of [.515, .552, .585]) {
        const x = T.MathUtils.mapLinear(y, .429, .644, .834, .879)
        const target = new T.Raycaster(new T.Vector3(x, y, 3), new T.Vector3(0, 0, -1)).intersectObject(guide)[0].point
        for (const frame of [615, 690]) {
          const { position } = cameraAt(frame / config.film.fps, config.formats.preview, vehicle.anchors)
          const ray = new T.Raycaster(position, target.clone().sub(position).normalize())
          const opaque = ray.intersectObject(vehicle.root).find(({ object }) => object.name !== 'front optical lens shells')
          expect(opaque?.object).toBe(guide)
        }
      }
    }
  })

  it('uses the same running-guide optical coordinates and emitted intensity on each side', () => {
    for (const vehicle of [blockout, full]) {
      const guides = vehicle.root.getObjectsByProperty('name', 'front running guide')
        .filter((node): node is T.Mesh => node instanceof T.Mesh)
      expect(guides).toHaveLength(2)
      const coords = guides.map(({ geometry, material }) => {
        const plane = geometry.getAttribute('guidePlane')
        expect(plane.itemSize).toBe(2)
        expect(plane.count).toBe(geometry.getAttribute('position').count)
        expect(patchesOf(material as T.Material)).toContain('front-guide-optics')
        return plane.array
      })
      expect(coords[0]).toEqual(coords[1])
      const lamps = vehicle.lamps.filter(({ object }) => object.name === 'front running guide emission origin')
      expect(lamps.map(({ intensity }) => intensity)).toEqual([3.99, 3.99])
      expect(lamps.every(({ stage, beam }) => stage === lampThresholds.running && !beam)).toBe(true)
    }
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
