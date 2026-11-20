import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { config, frameCount } from '../src/config'
import type { FrameContext, SampleContext } from '../src/core/contract'
import { apertureRadius, applyLens } from '../src/core/lens'
import { LightRig } from '../src/core/lights'
import { cameraAt } from '../src/director/shots'
import { patchesOf } from '../src/materials/patch'
import { createVehicle } from '../src/vehicle'
import { createWorld } from '../src/world'
import { heroDrain } from '../src/world/deck'
import { billboardState } from '../src/world/fixtures'
import { approvedHeroSourceSurvey } from '../src/world/hero-layout'
import { heroLayoutEye, heroPoint, heroScale } from '../src/world/hero-scale'
import { heroCityYaw, streetY } from '../src/world/forms'
import { deckHeight } from '../src/world/roof-look'

const [world, { anchors, root: vehicle }] = await Promise.all([
  createWorld({ detail: 'full' }),
  createVehicle({ paint: config.paint.candidates[0], detail: 'blockout' }),
])

function radiance(t: number): { position: number; color: THREE.Color } {
  const color = new THREE.Color()
  const { center } = billboardState(t, color, new THREE.Color(), new THREE.Color())
  return { position: center, color }
}

describe('full roof world', () => {
  it('publishes the mounted hero sources and preserves camera clearance', () => {
    world.root.updateMatrixWorld(true)
    const hero = world.root.getObjectByName('approved hero layout')!
    const local = new THREE.Vector3()
    const solid: { bounds: THREE.Box3; inverse: THREE.Matrix4; scale: number }[] = []
    for (const { id, at, normal, size, scale } of approvedHeroSourceSurvey()) {
      const fixture = hero.getObjectByName(id)!
      expect(fixture.getWorldPosition(local).distanceTo(new THREE.Vector3(...at))).toBeLessThan(1e-10)
      expect(local.set(0, 0, 1).transformDirection(fixture.matrixWorld).distanceTo(new THREE.Vector3(...normal))).toBeLessThan(1e-10)
      expect(size.every(n => n > 0)).toBe(true)
      for (const format of [config.formats.master, config.formats.vertical]) {
        const eye = cameraAt(config.film.heroFrameSeconds,format,anchors).position
        const frame = ['hotel rooftop cabinet', 'white parking blade', 'far cyan bar cabinet', 'violet mid distance blade', 'magenta violet tower screen',
          'amber upper tower cabinet', 'amber lower tower cabinet', 'amber parapet exit'].includes(id)
        const marks = frame ? [[0,0],[-.45,-.40],[.45,-.40],[-.45,.40],[.45,.40]] : [[0,0]]
        for (const [u,v] of marks) {
          const delta = fixture.localToWorld(local.set(u*size[0]/scale,v*size[1]/scale,-.012)).sub(eye)
          const distance = delta.length()
          const ray = new THREE.Raycaster(eye,delta.normalize(),.01,distance+.10)
          expect(ray.intersectObject(world.root,true)[0]?.object.parent?.name,id).toBe(id)
        }
      }
    }
    hero.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !object.geometry.attributes.position) return
      object.geometry.computeBoundingBox()
      solid.push({ bounds: object.geometry.boundingBox!, inverse: object.matrixWorld.clone().invert(),
        scale: object.getWorldScale(new THREE.Vector3()).x })
    })
    const shutterHalf = config.film.shutterDegrees / (720 * config.film.fps)
    let clearance = Infinity
    for (const format of [config.formats.master, config.formats.vertical]) {
      for (let i = 0; i <= frameCount; i++) {
        const time = i / config.film.fps
        for (const offset of [-shutterHalf, 0, shutterHalf]) {
          const state = cameraAt(time + offset, format, anchors, time)
          const pupil = apertureRadius(state)
          for (const box of solid) clearance = Math.min(clearance,
            box.bounds.distanceToPoint(local.copy(state.position).applyMatrix4(box.inverse))*box.scale - pupil)
        }
      }
    }
    expect(clearance).toBeGreaterThan(.10)
  })

  it('grounds non-overlapping real-scale towers and preserves the design rays and emitter falloff', () => {
    const axis = new THREE.Vector3(0,1,0)
    const eye = new THREE.Vector3(...heroLayoutEye)
    const at = new THREE.Vector3(2.94,5.61,-29.80).applyAxisAngle(axis,heroCityYaw)
    const id = 'magenta violet tower screen'
    const emitter = world.lights.find(l => l.id === id)!
    const k = heroScale.screen
    const screen = new THREE.Vector3(...heroPoint([2.94,5.61,-29.80],k)).applyAxisAngle(axis,heroCityYaw)
    const survey = approvedHeroSourceSurvey().find(s => s.id === id)!
    expect(new THREE.Vector3(...survey.at).distanceTo(screen)).toBeLessThan(1e-10)
    expect(screen.sub(eye).distanceTo(at.sub(eye).multiplyScalar(k))).toBeLessThan(1e-10)
    expect(emitter.size).toEqual(survey.size)
    expect(emitter.intensity/k**2).toBeCloseTo(91,12)
    expect(emitter.range/k).toBeCloseTo(75,12)
    const city = world.root.getObjectByName('hero tower layout')!
    const footprints: { id: string; box: THREE.Box3 }[] = []
    for (const volume of city.children.filter(o => o.name.endsWith(' volume'))) {
      const shell = volume.children[0] as THREE.Mesh
      shell.geometry.computeBoundingBox()
      const box = shell.geometry.boundingBox!.clone().translate(shell.position)
      expect(box.min.y).toBeCloseTo(streetY,4)
      for (const other of footprints) expect(box.intersectsBox(other.box),shell.name+' / '+other.id).toBe(false)
      footprints.push({ id: shell.name, box })
    }
    expect(footprints).toHaveLength(30)
  })

  it('builds real-meter facade grids with distinct families and uses practical mesh donors in the cube', () => {
    world.root.updateMatrixWorld(true)
    const city = world.root.getObjectByName('hero tower layout')!
    const facadeFamilies = new Set<string>()
    let rooms = 0
    for (const volume of city.children.filter(o => o.name.endsWith(' volume'))) {
      const shell = volume.children[0] as THREE.Mesh<THREE.BoxGeometry,THREE.MeshStandardMaterial>
      const [w,h] = shell.material.userData.moduleMeters as [number,number]
      const { width,height } = shell.geometry.parameters
      expect(w).toBeGreaterThanOrEqual(1.2)
      expect(w).toBeLessThanOrEqual(1.8)
      expect(h).toBeGreaterThanOrEqual(3)
      expect(h).toBeLessThanOrEqual(3.6)
      expect(shell.material.userData.mechanicalFloorPitch).toBeGreaterThanOrEqual(15)
      expect(shell.material.userData.mechanicalFloorPitch).toBeLessThanOrEqual(25)
      facadeFamilies.add(shell.material.userData.facade)
      rooms += Math.floor(width/w)*Math.floor(height/h)
    }
    expect(rooms).toBeGreaterThan(10_000)
    expect(facadeFamilies).toEqual(new Set(['curtain','concrete','banded','hotel']))
    const probe = new THREE.Vector3(0,.6,0)
    const cornices = city.getObjectByName('hero left edge tower volume')!.children.filter(o=>o.name === 'full height cyan cornice')
    expect(cornices).toHaveLength(2)
    for (const cornice of cornices as THREE.Mesh<THREE.BoxGeometry,THREE.MeshBasicMaterial>[]) {
      const top = cornice.localToWorld(new THREE.Vector3(0,cornice.geometry.parameters.height/2,0)).sub(probe)
      expect(top.y).toBeGreaterThan(Math.hypot(top.x,top.z))
      expect(top.x).toBeLessThan(0)
      expect(top.z).toBeLessThan(0)
    }
    const access = world.root.getObjectByName('northeast roof access')!
    const fixtures = ['northeast stair and lift core','northeast pay station','northeast access light pole']
      .map(name=>world.root.getObjectByName(name)!)
    const visibleTarget = (name: string) => {
      const fixture = world.root.getObjectByName(name)!
      const direction = fixture.getWorldPosition(new THREE.Vector3()).sub(probe)
      const ray = new THREE.Raycaster(probe,direction.clone().normalize(),0,direction.length()+.25)
      expect(ray.intersectObject(world.root,true)[0]?.object.name).toBe(name)
    }
    visibleTarget('door reveal back')
    visibleTarget('pay station backlit screen')
    visibleTarget('access pole opal face')
    const camera = new THREE.PerspectiveCamera()
    const frustum = new THREE.Frustum()
    const matrix = new THREE.Matrix4()
    const bounds = fixtures.map(o=>new THREE.Box3().setFromObject(o))
    const openingEnd = config.beats.find(b=>b.id==='wake')!.end
    const returnStart = config.beats.find(b=>b.id==='return')!.start
    for (const format of Object.values(config.formats)) {
      for (let i=0;i<=frameCount;i++) {
        const t = i/config.film.fps
        const state = cameraAt(t,format,anchors)
        expect(bounds.every(box=>box.distanceToPoint(state.position)-apertureRadius(state)>.10)).toBe(true)
        if (t >= openingEnd && t < returnStart) continue
        applyLens(camera,state,format.width,format.height,{pixel:[0,0],aperture:[0,0]},1)
        camera.updateMatrixWorld(true)
        frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse))
        expect(bounds.some(box=>frustum.intersectsBox(box)),format.id+' '+i).toBe(false)
      }
    }
    expect(access.children).toHaveLength(2)
    expect(world.lights).toHaveLength(8)
  })

  it('fits the distant cyan shadow around the car and returns to the local macro cutoff', () => {
    const t = config.film.heroFrameSeconds
    world.beginFrame({ frame: { timeSeconds: t } } as FrameContext)
    const rig = new LightRig(world.lights,256)
    rig.fitContactRegion(vehicle,world.deck.bounds)
    rig.update(t,[.5,.5])
    const source = rig.group.getObjectByName('cyan garage rise') as THREE.SpotLight
    expect(source.castShadow).toBe(true)
    expect(source.distance).toBeCloseTo(66*heroScale.westFrontage,10)
    rig.group.updateMatrixWorld(true)
    source.shadow.updateMatrices(source)
    const c = source.shadow.camera
    expect(c.near).toBeGreaterThan(270)
    expect(c.far).toBeLessThan(430)
    const center = new THREE.Box3().setFromObject(vehicle).getCenter(new THREE.Vector3()).project(c)
    expect(Math.max(Math.abs(center.x),Math.abs(center.y),Math.abs(center.z))).toBeLessThan(1)
    world.beginFrame({ frame: { timeSeconds: config.film.macroFrameSeconds } } as FrameContext)
    rig.update(config.film.macroFrameSeconds,[.5,.5])
    expect(source.distance).toBeCloseTo(44,10)
    world.beginFrame({ frame: { timeSeconds: 0 } } as FrameContext)
  })

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
    expect(deckHeight(...heroDrain)).toBeLessThan(-.002)
    expect(deckHeight(heroDrain[0], heroDrain[1] - .42)).toBeGreaterThan(deckHeight(...heroDrain))
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

  it('holds standing water across the portrait foreground without flattening its shore', () => {
    const { bounds, heightMap } = world.deck
    const { data, width, height } = (heightMap as THREE.DataTexture).image
    for (const [x, z] of [[2.03, 4.02], [2.37, 4.72], [3.32, 3.37], [.88, 4.58]]) {
      expect(deckHeight(x, z)).toBeLessThan(-.0004)
      const i = Math.floor((x - bounds.min.x) / (bounds.max.x - bounds.min.x) * width)
      const j = Math.floor((z - bounds.min.y) / (bounds.max.y - bounds.min.y) * height)
      expect((data as Float32Array)[j * width + i]).toBeLessThan(-.0004)
    }
    expect(deckHeight(2.64, 5.28)).toBeGreaterThan(0)
    expect(deckHeight(3.63, 3.21)).toBeGreaterThan(0)
  })

  it('keeps the hero drain slotted and the bay line porous', () => {
    const drain = world.root.getObjectByName('hero near drain grate')!
    const { x, z } = drain.getWorldPosition(new THREE.Vector3())
    expect(deckHeight(x,z)).toBeLessThan(.003)
    expect(deckHeight(x-.18,z+.38)).toBeGreaterThan(deckHeight(x,z))
    expect(drain.children.filter(o=>o.name==='iron drainage bar')).toHaveLength(21)
    const bayLine = world.root.getObjectByName('hero near bay line') as THREE.Mesh
    expect(world.surfaces.find(s=>s.material===bayLine.material)?.wetness).toBe('porous')
    const lens = new THREE.PerspectiveCamera()
    const { master } = config.formats
    applyLens(lens,cameraAt(config.film.heroFrameSeconds,master,anchors),master.width,master.height,{ pixel:[0,0],aperture:[0,0] },1)
    for (const u of [.18,.22,.25]) {
      const ray = new THREE.Raycaster(lens.position,new THREE.Vector3(2*u-1,-.82,.5).unproject(lens).sub(lens.position).normalize())
      expect(world.deck.meshes).toContain(ray.intersectObject(world.root,true)[0]?.object)
    }
  })

  it('retains the lit sign mount and distinguishes city cladding from wet parapet', () => {
    const cladding = world.root.getObjectByName('weathered cladding panels and spandrels') as THREE.InstancedMesh
    const parapet = world.root.getObjectByName('solid concrete') as THREE.Mesh
    expect(patchesOf(cladding.material as THREE.Material)).toContain('facade cladding and rain trails')
    expect(world.surfaces.find(s => s.material === parapet.material)?.wetness).toBe('porous')
    expect(patchesOf(parapet.material as THREE.Material)).toContain('world-roof-parapet')
    const hotel = world.root.getObjectByName('HOTEL')!
    expect(hotel.getObjectByName('steel sign frame brace')).toBeDefined()
    expect(hotel.getObjectByName('cabinet back')).toBeDefined()
    expect(world.signs).toContain('HOTEL')
  })

  it('mounts the reflection strip to the ramp without adding a film light', () => {
    const ramp = world.root.getObjectByName('drive-down ramp and control island')!
    ramp.updateWorldMatrix(true, true)
    const fixture = ramp.getObjectByName('west ramp luminous barrier')!
    const strip = fixture.getObjectByName('graded ramp opal strip') as THREE.Mesh
    expect(fixture.parent).toBe(ramp)
    const cleats = fixture.children.filter(o => o.name === 'ramp guard anchoring cleat')
    const guards = ramp.children.filter(o => o.name === 'ramp guard wall').map(o => new THREE.Box3().setFromObject(o))
    expect(cleats).toHaveLength(4)
    for (const cleat of cleats) expect(guards.some(guard => guard.intersectsBox(new THREE.Box3().setFromObject(cleat)))).toBe(true)
    expect(strip.material).toBeInstanceOf(THREE.ShaderMaterial)
    expect(strip.getWorldPosition(new THREE.Vector3()).x).toBeLessThan(-9)
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(strip.getWorldQuaternion(new THREE.Quaternion())).x).toBeCloseTo(1, 10)
    expect(world.lights).toHaveLength(8)
  })

  it('anchors the macro reflection sources to the city and retains the rear service light', () => {
    const west = world.root.getObjectByName('west low block')!
    const north = world.root.getObjectByName('northwest tower')!
    west.updateWorldMatrix(true, true)
    north.updateWorldMatrix(true, true)
    for (const [tower, fixture, face, arm] of [
      [west, 'west upper service LED cabinet', 'segmented cool white LED face', 'facade practical cantilever'],
      [west, 'west south frontage neon badge', 'red opal neon badge', 'facade practical cantilever'],
      [north, 'east glazed concourse return', 'feathered LED ribbon', 'concourse return standoff'],
    ] as const) {
      const housing = tower.getObjectByName(fixture)!
      const emitter = housing.getObjectByName(face) as THREE.Mesh
      expect(housing.parent).toBe(tower)
      const mounts = housing.children.filter(o => o.name === arm)
      expect(mounts.length).toBeGreaterThanOrEqual(3)
      const wall = tower.children.filter(o => o.name === 'building mass').map(o => new THREE.Box3().setFromObject(o))
      for (const mount of mounts) expect(wall.some(box => box.intersectsBox(new THREE.Box3().setFromObject(mount)))).toBe(true)
      expect(emitter.material).toBeInstanceOf(THREE.ShaderMaterial)
      expect(new THREE.Vector3(0, 0, 1).transformDirection(emitter.matrixWorld).x).toBeCloseTo(1, 10)
    }
    expect(world.root.getObjectByName('rear service flood bank')!.children.filter(o => o.name === 'rear service flood diffuser')).toHaveLength(3)
    expect(world.lights).toHaveLength(8)
  })

  it('sets the billboard for both capture times and supplies a periodic mean to the rig', () => {
    const { durationSeconds } = config.film
    const raking = world.lights.find(l => l.id === 'raking billboard')!
    expect(raking.intensity).toBeGreaterThan(9.216 * 3)
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
    expect(world.lights.some(l => l.id === 'wheel deck pole' && l.shadow)).toBe(true)
    expect(Math.abs(expected.position - start.position)).toBeGreaterThan(.025)
    const color = new THREE.Color()
    raking.colorAt!(2, color)
    expect(color.clone().multiplyScalar(raking.level(2)).b).toBeCloseTo(expected.color.b, 10)
    world.beginFrame({ frame: { timeSeconds: 0 } } as FrameContext)
    expect(face.material.uniforms.centerX.value).toBeCloseTo(start.position, 12)
  })

  it('drives the tower mural periodically while leaving macro emitter slots on their original mounts', () => {
    const id = 'magenta violet tower screen'
    const emitter = world.lights.find(l => l.id === id)!
    const face = world.root.getObjectByName('animated magenta violet mural') as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
    const firstFrame = (timeSeconds: number) => world.beginFrame({ frame: { timeSeconds } } as FrameContext)
    firstFrame(0)
    const first = face.material.uniforms.flow.value.clone()
    const wall = world.root.getObjectByName(id)
    const rate = emitter.level(0)
    expect(emitter.object.parent).toBe(wall)
    expect(emitter.intensity).toBe(Math.max(...world.lights.filter(light=>!light.shadow).map(light=>light.intensity)))
    const wake = config.beats.find(beat=>beat.id==='wake')!
    world.beginSample({ timeSeconds: wake.end+.003, sample: { frame: { timeSeconds: wake.end-.001 } } } as SampleContext)
    expect(emitter.object.parent).toBe(wall)
    expect(face.material.uniforms.flow.value.distanceTo(first)).toBeGreaterThan(.2)
    firstFrame(config.film.macroFrameSeconds)
    expect(emitter.object.parent?.name).toBe('billboard')
    expect(emitter.intensity).toBeCloseTo(9.216,10)
    firstFrame(config.film.durationSeconds)
    expect(emitter.object.parent).toBe(wall)
    expect(face.material.uniforms.flow.value.toArray()).toEqual(first.toArray())
    expect(emitter.level(config.film.durationSeconds)).toBeCloseTo(rate,12)
    firstFrame(0)
  })

  it('holds the hero screen, parapet, cyan and amber division in the fitted master', () => {
    const { master, vertical } = config.formats
    const { heroFrameSeconds } = config.film
    const camera = new THREE.PerspectiveCamera()
    world.root.updateMatrixWorld(true)
    const position = (id: string) => world.root.getObjectByName(id)!.getWorldPosition(new THREE.Vector3())
    const toScreen = (at: THREE.Vector3) => at.project(camera)
    const cameraAtTime = (format: typeof master, time: number) => {
      applyLens(camera, cameraAt(time, format, anchors), format.width, format.height, { pixel: [0, 0], aperture: [0, 0] }, 1)
    }
    const billboard = 'magenta violet tower screen'
    for (const time of [0, heroFrameSeconds, config.film.durationSeconds]) {
      cameraAtTime(master, time)
      expect(toScreen(position(billboard)).x).toBeGreaterThan(.10)
      expect(toScreen(position(billboard)).x).toBeLessThan(.40)
      expect(toScreen(position('left cyan facade sail')).x).toBeLessThan(-.60)
      expect(toScreen(position('amber upper tower cabinet')).x).toBeGreaterThan(.48)
      expect(toScreen(position('hero full span steel top rail')).y).toBeGreaterThan(.05)
      expect(toScreen(position('hero full span steel top rail')).y).toBeLessThan(.20)
    }
    cameraAtTime(master, heroFrameSeconds)
    const skyRay = (x: number, y: number) => new THREE.Raycaster(camera.position,
      new THREE.Vector3(x, y, .5).unproject(camera).sub(camera.position).normalize(), 0, camera.far+150)
    for (const x of [-.50, -.40, -.32, -.24, -.16]) {
      expect(skyRay(x,.92).intersectObject(world.root, true)[0]?.object.name).toBe('city-lit cloud base')
    }
    expect(skyRay(-.16,.75).intersectObject(world.root,true)[0]?.object.name).toBe('city-lit cloud base')
    const centerTowers = [
      [.291,.175,'hero middle west distance',650,720],
      [.327,.200,'far west narrow crown',980,1_025],
      [.363,.150,'hero far west distance',790,830],
      [.402,.200,'far inner west glass crown',965,1_015],
      [.440,.175,'hero far center distance',845,900],
      [.478,.120,'hero violet tower',630,690],
    ] as const
    for (const [x,y,name,near,far] of centerTowers) {
      const hit = skyRay(x*2-1,1-y*2).intersectObject(world.root, true)[0]
      expect(hit?.object.name).toBe(name)
      expect(hit?.distance).toBeGreaterThan(near)
      expect(hit?.distance).toBeLessThan(far)
      expect(patchesOf((hit?.object as THREE.Mesh).material as THREE.Material)).toContain('hero tower cladding and window rooms')
    }
    expect(skyRay(.402*2-1,1-.175*2).intersectObject(world.root,true)[0]?.object.name).toBe('city-lit cloud base')
    expect(skyRay(.421*2-1,1-.175*2).intersectObject(world.root,true)[0]?.object.name).toBe('city-lit cloud base')
    cameraAtTime(vertical, heroFrameSeconds)
    const tallScreen = toScreen(position(billboard))
    expect(Math.abs(tallScreen.x)).toBeLessThan(.7)
    expect(tallScreen.y).toBeGreaterThan(0)
    expect(tallScreen.y).toBeLessThan(1)
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
