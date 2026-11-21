import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { config, frameCount } from '../src/config'
import { candelaPerUnit, type FrameContext, type SampleContext } from '../src/core/contract'
import { airTransmittance, luminance, solidAngle } from '../src/core/emitters'
import { apertureRadius, applyLens } from '../src/core/lens'
import { LightRig } from '../src/core/lights'
import { quality } from '../src/core/reflect'
import { cameraAt } from '../src/director/shots'
import { patchesOf } from '../src/materials/patch'
import { createVehicle } from '../src/vehicle'
import { createWorld } from '../src/world'
import { billboardState } from '../src/world/fixtures'
import { approvedHeroSourceSurvey, heroScreenMount } from '../src/world/hero-layout'
import { muralLuma, muralMean, muralPainting, muralRise } from '../src/world/mural-picture'
import { heroLayoutEye, heroPoint, heroScale } from '../src/world/hero-scale'
import { heroCityYaw, streetY } from '../src/world/forms'
import { deckHeight, heroGrate } from '../src/world/roof-look'
import { judgedFrames } from '../tools/lib/judged'

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
  it('recesses the compact glint faces on existing fittings clear of the driven area', () => {
    world.root.updateMatrixWorld(true)
    const faces: THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>[] = []
    world.root.traverse(object => {
      if (object instanceof THREE.Mesh && object.geometry instanceof THREE.PlaneGeometry &&
          object.material instanceof THREE.MeshBasicMaterial && object.name === 'compact bead optic') faces.push(object)
    })
    expect(faces).toHaveLength(4)
    expect(faces.map(face=>face.parent?.parent?.name).sort()).toEqual([
      'deck light pole','sealed cutoff LED head','west corner slab','west market tower',
    ])
    const optics = faces.map(face => {
      const center = face.getWorldPosition(new THREE.Vector3())
      const { width, height } = face.geometry.parameters
      const u = face.localToWorld(new THREE.Vector3(width*.5,0,0)).sub(center)
      const v = face.localToWorld(new THREE.Vector3(0,height*.5,0)).sub(center)
      expect(Math.hypot(center.x,center.z)).toBeGreaterThan(9)
      expect(width).toBe(height)
      expect(width).toBeGreaterThanOrEqual(.08)
      expect(width).toBeLessThanOrEqual(.15)
      expect(face.geometry.attributes.position.count).toBeGreaterThan(20)
      expect(face.material.toneMapped).toBe(false)
      const radiance = face.material.color.clone().multiplyScalar(Math.PI*.25)
      return { face, center, u, v, radiance, visibility: 1, bounds: new THREE.Box3().setFromObject(face.parent!) }
    })
    expect(optics.some(({ radiance: c })=>c.b>c.g*4 && c.r>c.b)).toBe(true)
    const upperBody = [[.08,.53,1.88],[.08,.79,1.29],[0,1.05,.47],[0,1.28,-.24],[-.85,.68,1.72],[.85,.68,1.72]] as const
    for (const [x,y,z] of upperBody) {
      const receiver = new THREE.Vector3(x,y,z)
      const energy = optics.map(optic => {
        const ray = optic.center.clone().sub(receiver)
        const distance = ray.length()
        const hit = new THREE.Raycaster(receiver,ray.normalize(),.01,distance+.01).intersectObject(world.root,true)[0]
        expect(hit?.object.name,optic.face.parent?.name).toBe(optic.face.name)
        expect(hit?.object === optic.face,optic.face.parent?.name).toBe(true)
        return luminance(optic.radiance)*solidAngle(optic,receiver)*airTransmittance(optic.center.length())
      })
      const total = energy.reduce((sum,next)=>sum+next,0)
      expect(total).toBeGreaterThan(.50)
      expect(total).toBeLessThan(.74)
    }
    const hood = new THREE.Vector3(...upperBody[1])
    const azimuths = optics.map(({ center }) => THREE.MathUtils.radToDeg(Math.atan2(center.x-hood.x,hood.z-center.z)))
    expect(Math.max(...azimuths)-Math.min(...azimuths)).toBeGreaterThan(30)
    const half = config.film.shutterDegrees/(720*config.film.fps)
    for (const format of [config.formats.master,config.formats.vertical]) {
      const heroTime = config.film.heroFrameSeconds
      for (const delta of [-half,0,half]) {
        const pose = cameraAt(heroTime+delta,format,anchors,heroTime)
        const camera = new THREE.PerspectiveCamera()
        applyLens(camera,pose,format.width,format.height,{ pixel: [0,0], aperture: [0,0] },1)
        const clip = new THREE.Frustum().setFromProjectionMatrix(camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse))
        for (const { face, bounds } of optics) expect(clip.intersectsBox(bounds),face.parent?.name).toBe(false)
      }
      let clearance = Infinity
      for (let frame = 0; frame <= frameCount; frame++) {
        const time = frame/config.film.fps
        for (const delta of [-half,0,half]) {
          const pose = cameraAt(time+delta,format,anchors,time)
          for (const { bounds } of optics) clearance = Math.min(clearance,bounds.distanceToPoint(pose.position)-apertureRadius(pose))
        }
      }
      expect(clearance).toBeGreaterThan(.10)
    }
    expect(world.lights).toHaveLength(8)
  })

  it('centres the high cloud spill over the mounted city emitters without adding rig lights', () => {
    const sky = world.root.getObjectByName('city-lit cloud base') as THREE.Mesh<THREE.SphereGeometry,THREE.ShaderMaterial>
    const districts = sky.material.uniforms.cloudDistricts!.value as THREE.Vector3[]
    const survey = approvedHeroSourceSurvey()
    expect(districts.map(point=>point.toArray())).toEqual(['magenta violet tower screen','left cyan facade sail'].map(id=>survey.find(source=>source.id===id)!.at))
    expect(sky.material.side).toBe(THREE.BackSide)
    expect(sky.material.depthWrite).toBe(false)
    expect(world.lights).toHaveLength(8)
  })

  it('keeps only the rooftop Vapor Sill Hotel cabinet and clears facade trim in both hero formats', () => {
    world.root.updateMatrixWorld(true)
    const cabinet = world.root.getObjectByName('hotel rooftop cabinet')!
    const bladeSigns = world.root.getObjectByName('supported commercial blade signs')!
    expect(bladeSigns.getObjectByName('VAPOR SILL HOTEL')).toBeUndefined()
    expect(cabinet.getObjectByName('rooftop frame steel leg')).toBeDefined()
    expect(world.signs.filter(s => s === 'VAPOR SILL HOTEL')).toHaveLength(1)
    const face = cabinet.getObjectByName('recessed sign face') as THREE.Mesh<THREE.PlaneGeometry>
    const { width,height } = face.geometry.parameters
    const time = config.film.heroFrameSeconds
    const camera = new THREE.PerspectiveCamera()
    for (const format of [config.formats.master,config.formats.vertical]) {
      applyLens(camera,cameraAt(time,format,anchors),format.width,format.height,{pixel:[0,0],aperture:[0,0]},1)
      for (const y of [-.28,-.18,.25]) for (const x of [-.26,-.14,0,.14,.26]) {
        const delta = face.localToWorld(new THREE.Vector3(x*width,y*height,0)).sub(camera.position)
        const first = new THREE.Raycaster(camera.position,delta.clone().normalize(),.03,delta.length()+.01)
          .intersectObject(world.root,true)[0]
        expect(first?.object.parent,format.id+' '+x+' '+y).toBe(cabinet)
      }
    }
  })

  it('publishes the mounted hero sources and preserves camera clearance', () => {
    world.root.updateMatrixWorld(true)
    const hero = world.root.getObjectByName('approved hero layout')!
    const local = new THREE.Vector3()
    const solid: { bounds: THREE.Box3; inverse: THREE.Matrix4; scale: number; geometry: THREE.BufferGeometry }[] = []
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
      const placements = object instanceof THREE.InstancedMesh
        ? Array.from({ length: object.count }, (_, i) => { const m = new THREE.Matrix4(); object.getMatrixAt(i, m); return m.premultiply(object.matrixWorld) })
        : [object.matrixWorld.clone()]
      for (const placement of placements) solid.push({ bounds: object.geometry.boundingBox!, inverse: placement.clone().invert(),
        scale: Math.min(...new THREE.Vector3().setFromMatrixScale(placement).toArray()), geometry: object.geometry })
    })
    const face = new THREE.Triangle()
    const nearest = new THREE.Vector3()
    const surfaceDistance = (geometry: THREE.BufferGeometry, point: THREE.Vector3): number => {
      const position = geometry.getAttribute('position')
      const index = geometry.getIndex()
      const corners = index ? index.count : position.count
      let best = Infinity
      for (let i = 0; i < corners; i += 3) {
        face.a.fromBufferAttribute(position, index ? index.getX(i) : i)
        face.b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1)
        face.c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2)
        best = Math.min(best, face.closestPointToPoint(point, nearest).distanceTo(point))
      }
      return best
    }
    const shutterHalf = config.film.shutterDegrees / (720 * config.film.fps)
    let clearance = Infinity
    for (const format of [config.formats.master, config.formats.vertical]) {
      for (let i = 0; i <= frameCount; i++) {
        const time = i / config.film.fps
        for (const offset of [-shutterHalf, 0, shutterHalf]) {
          const state = cameraAt(time + offset, format, anchors, time)
          const pupil = apertureRadius(state)
          for (const box of solid) {
            local.copy(state.position).applyMatrix4(box.inverse)
            let distance = box.bounds.distanceToPoint(local)*box.scale - pupil
            if (distance <= .10) distance = surfaceDistance(box.geometry, local)*box.scale - pupil
            clearance = Math.min(clearance, distance)
          }
        }
      }
    }
    expect(clearance).toBeGreaterThan(.10)
  })

  it('grounds non-overlapping real-scale towers and preserves the design rays and emitter falloff', () => {
    const axis = new THREE.Vector3(0,1,0)
    const eye = new THREE.Vector3(...heroLayoutEye)
    const at = new THREE.Vector3(...heroScreenMount.at).applyAxisAngle(axis,heroCityYaw)
    const id = 'magenta violet tower screen'
    const emitter = world.lights.find(l => l.id === id)!
    const k = heroScreenMount.scale
    const screen = new THREE.Vector3(...heroPoint(heroScreenMount.at,k)).applyAxisAngle(axis,heroCityYaw)
    const survey = approvedHeroSourceSurvey().find(s => s.id === id)!
    expect(new THREE.Vector3(...survey.at).distanceTo(screen)).toBeLessThan(1e-10)
    expect(screen.sub(eye).distanceTo(at.sub(eye).multiplyScalar(k))).toBeLessThan(1e-10)
    expect(emitter.size).toEqual(survey.size)
    expect(emitter.intensity/k**2).toBeCloseTo(91,12)
    expect(emitter.range/k).toBeCloseTo(75,12)
    const city = world.root.getObjectByName('hero tower layout')!
    const footprints: { id: string; box: THREE.Box3 }[] = []
    const { master } = config.formats
    const lens = new THREE.PerspectiveCamera()
    applyLens(lens,cameraAt(config.film.heroFrameSeconds,master,anchors),master.width,master.height,{pixel:[0,0],aperture:[0,0]},1)
    world.root.updateMatrixWorld(true)
    const ranks = new Map<string, number>()
    for (const volume of city.children.filter(o => o.name.endsWith(' volume'))) {
      const shell = volume.children[0] as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
      shell.geometry.computeBoundingBox()
      const box = shell.geometry.boundingBox!.clone().translate(shell.position)
      expect(box.min.y).toBeCloseTo(streetY,4)
      for (const other of footprints) expect(box.intersectsBox(other.box),shell.name+' / '+other.id).toBe(false)
      footprints.push({ id: shell.name, box })
      const rank = shell.material.userData.distanceLayer as string
      ranks.set(rank, (ranks.get(rank) ?? 0)+1)
      const { width, height, depth } = shell.geometry.parameters
      const pane = shell.material.userData.clearPaneWidth as number
      expect(pane).toBeGreaterThan(rank === 'near' ? .45 : .90)
      expect(pane).toBeLessThan(rank === 'near' ? .775 : 1.55)
      expect(width).toBeGreaterThan(pane)
      if (rank !== 'near') continue
      const front = shell.localToWorld(new THREE.Vector3(0,height*.25,depth*.5))
      expect(Math.hypot(front.x-eye.x,front.z-eye.z)).toBeGreaterThan(460)
      const edge = shell.localToWorld(new THREE.Vector3(pane,height*.25,depth*.5)).project(lens)
      expect(Math.abs(edge.x-front.project(lens).x)*master.width*.5,shell.name).toBeLessThan(4.3)
    }
    expect(footprints).toHaveLength(44)
    expect([...ranks.keys()].sort()).toEqual(['far','middle','near'])
    expect(Math.min(...ranks.values())).toBeGreaterThan(5)
  })

  it('builds real-meter facade grids with distinct families and uses practical mesh donors in the cube', () => {
    world.root.updateMatrixWorld(true)
    const city = world.root.getObjectByName('hero tower layout')!
    const facadeFamilies = new Set<string>()
    const tenantRhythms = new Set<string>()
    const softenedCrowns: string[] = []
    const claddingRoughness = new Map<string,number>()
    const occupancy = new Map<string,readonly number[]>()
    let rooms = 0
    let finRows = 0
    let roofShafts = 0
    for (const volume of city.children.filter(o => o.name.endsWith(' volume'))) {
      const shell = volume.children[0] as THREE.Mesh<THREE.BoxGeometry,THREE.MeshStandardMaterial>
      const [w,h] = shell.material.userData.moduleMeters as [number,number]
      tenantRhythms.add((shell.material.userData.tenantRhythm as number[]).join('/'))
      const { width,height } = shell.geometry.parameters
      expect(w).toBeGreaterThanOrEqual(1.2)
      expect(w).toBeLessThanOrEqual(1.8)
      expect(h).toBeGreaterThanOrEqual(3)
      expect(h).toBeLessThanOrEqual(3.6)
      expect(shell.material.userData.mechanicalFloorPitch).toBeGreaterThanOrEqual(15)
      expect(shell.material.userData.mechanicalFloorPitch).toBeLessThanOrEqual(25)
      expect(shell.material.userData.roomDepthMeters).toEqual([4,8])
      const { distanceLayer, tenantGate } = shell.material.userData
      const scale = distanceLayer === 'near' ? .5 : 1
      expect(shell.material.userData.windowPitchMeters).toEqual([w*scale,h*scale])
      const [r,g,b] = shell.material.userData.enamel as [number,number,number]
      if (distanceLayer === 'near') {
        expect(r).toBeLessThan(g)
        expect(g).toBeLessThanOrEqual(b)
        expect(b).toBeLessThan(1)
      } else expect([r,g,b]).toEqual([1,1,1])
      if (shell.material.userData.crownMist[2] > 0) {
        expect(distanceLayer).not.toBe('near')
        softenedCrowns.push(shell.name)
      }
      const existingGate = occupancy.get(distanceLayer)
      if (existingGate) expect(tenantGate).toEqual(existingGate)
      occupancy.set(distanceLayer,tenantGate)
      const [openingWidth,openingHeight] = shell.material.userData.litOpeningMeters as [number,number]
      expect(openingWidth).toBeGreaterThanOrEqual(.90*scale)
      expect(openingWidth).toBeLessThanOrEqual(shell.material.userData.clearPaneWidth)
      expect(openingHeight).toBeGreaterThanOrEqual(1.08*scale)
      expect(openingHeight).toBeLessThanOrEqual(1.88*scale)
      facadeFamilies.add(shell.material.userData.facade)
      claddingRoughness.set(shell.material.userData.facade,shell.material.roughness)
      const fins = volume.getObjectByName('extruded curtain wall fins') as THREE.InstancedMesh | undefined
      if (fins) {
        const front = shell.position.z+shell.geometry.parameters.depth*.5
        expect(fins.boundingBox!.min.z).toBeLessThan(front)
        expect(fins.boundingBox!.max.z).toBeGreaterThan(front)
        finRows++
      }
      if (volume.getObjectByName('offset concrete roof shaft')) roofShafts++
      rooms += Math.floor(width/w)*Math.floor(height/h)
    }
    expect(rooms).toBeGreaterThan(10_000)
    expect(tenantRhythms.size).toBe(city.children.filter(o=>o.name.endsWith(' volume')).length)
    expect(softenedCrowns).toContain('c9 center distant crown')
    expect(softenedCrowns.length).toBeLessThan(6)
    expect(facadeFamilies).toEqual(new Set(['curtain','concrete','banded','hotel']))
    expect(claddingRoughness.get('concrete')!).toBeGreaterThan(claddingRoughness.get('curtain')!)
    for (const [i,gate] of occupancy.get('near')!.entries()) {
      expect(gate).toBeLessThan(occupancy.get('middle')![i])
      expect(occupancy.get('middle')![i]).toBeLessThan(occupancy.get('far')![i])
    }
    expect(finRows).toBeGreaterThan(30)
    expect(roofShafts).toBeGreaterThan(5)
    const probe = new THREE.Vector3(0,.6,0)
    const cornice = city.getObjectByName('dashed cyan cornice') as THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>
    const top = cornice.localToWorld(new THREE.Vector3(0,cornice.geometry.parameters.height/2,0)).sub(probe)
    expect(top.y).toBeGreaterThan(Math.hypot(top.x,top.z))
    expect(top.x).toBeLessThan(0)
    expect(top.z).toBeLessThan(0)
    expect(cornice.material.uniforms.gap!.value).toBeGreaterThan(.2)
    const sail = city.getObjectByName('left cyan facade sail')!.getObjectByName('weather-sealed opal face') as THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>
    expect(sail.material.uniforms.gap!.value).toBeGreaterThan(.1)
    expect(city.getObjectByName('left cyan secondary strip')).toBeUndefined()
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

  it('concentrates occupied room fill around the southern hotel, amber block and center ranks', () => {
    const fill = (id: string) => {
      const shell = world.root.getObjectByName(id) as THREE.Mesh<THREE.BoxGeometry,THREE.MeshStandardMaterial>
      return shell.material.userData.tenantFill as [number,number]
    }
    const hotel = fill('hero hotel tower')
    const amber = fill('hero amber tower')
    const center = fill('hero middle center distance')
    const edge = fill('hero right edge tower')
    for (const profile of [hotel, amber, center]) expect(profile[0]).toBeGreaterThan(edge[0])
    expect(hotel[1]).toBeGreaterThan(amber[1])
    expect(center[1]).toBeGreaterThan(amber[1])
    const northShells = world.root.getObjectByName('north tower ranks')!.children
      .filter(item => item.name.startsWith('north tower shells'))
    expect(northShells.length).toBeGreaterThan(0)
    for (const shell of northShells) expect(fill(shell.name)[0]).toBe(0)
  })

  it('concentrates unlit cladding and floor clusters on the southern street faces', () => {
    const profile = (name: string) => {
      const shell = world.root.getObjectByName(name) as THREE.Mesh<THREE.BoxGeometry,THREE.MeshStandardMaterial>
      return shell.material.userData.leasing as [number,number]
    }
    const center = profile('hero screen tower')
    const far = profile('c9 center distant crown')
    for (const name of ['hero left edge tower','hero hotel tower','hero amber tower']) {
      const frontage = profile(name)
      expect(frontage[0]).toBeGreaterThan(center[0])
      expect(frontage[1]).toBeGreaterThan(center[1])
    }
    expect(far[1]).toBeLessThan(center[1])
    for (const shell of world.root.getObjectByName('north tower ranks')!.children) {
      if (shell.name.startsWith('north tower shells')) expect(profile(shell.name)).toEqual([0,0])
    }
  })

  it('mounts distinct stepped rooftop plants on their southern tower footprints', () => {
    const city = world.root.getObjectByName('hero tower layout')!
    const crowns = city.getObjectsByProperty('name','terraced mechanical crown')
    const rises = new Set<number>()
    const silhouettes = new Set<string>()
    expect(crowns).toHaveLength(10)
    for (const crown of crowns) {
      const shell = crown.parent!.children[0] as THREE.Mesh<THREE.BoxGeometry>
      const { width, height, depth } = shell.geometry.parameters
      expect(crown.position.y).toBeCloseTo(shell.position.y+height*.5,7)
      const roofs = crown.children as THREE.Mesh<THREE.BoxGeometry>[]
      rises.add(roofs[0]!.geometry.parameters.height)
      for (const roof of roofs) {
        const box = roof.geometry.parameters
        expect(Math.abs(roof.position.x)+box.width*.5,shell.name).toBeLessThan(width*.5)
        expect(Math.abs(roof.position.z)+box.depth*.5,shell.name).toBeLessThan(depth*.5)
      }
      silhouettes.add(roofs.map(roof=>roof.name).join('/'))
    }
    expect(rises.size).toBe(10)
    expect(silhouettes.size).toBe(3)
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
    const center = new THREE.Box3().setFromObject(vehicle).getCenter(new THREE.Vector3())
    const depth = -center.clone().applyMatrix4(c.matrixWorldInverse).z
    expect(c.near).toBeGreaterThan(depth-105)
    expect(c.far).toBeLessThan(depth+35)
    center.project(c)
    expect(Math.max(Math.abs(center.x),Math.abs(center.y),Math.abs(center.z))).toBeLessThan(1)
    world.beginFrame({ frame: { timeSeconds: config.film.macroFrameSeconds } } as FrameContext)
    rig.update(config.film.macroFrameSeconds,[.5,.5])
    expect(source.distance).toBeCloseTo(44,10)
    world.beginFrame({ frame: { timeSeconds: 0 } } as FrameContext)
  })

  it('keeps the reflection practicals out of both hero views and visible from the probe', () => {
    const required = (name: string) => {
      const match = world.root.getObjectByName(name)
      expect(match,name).toBeDefined()
      return match!
    }
    world.root.updateMatrixWorld(true)
    const frontages = required('offscreen reflection frontages')
    const riser = required('billboard upper media riser')
    const uprights = new Set(['upper cyan facade lightwell','pale cyan lightwell core','west violet media blade','warm tower service floor',
      'high amber rooftop wayfinding','high amber hotel wayfinding'])
    const clear = [...frontages.children,riser]
    const faces: THREE.Mesh[] = []
    world.root.traverse(object => {
      if (uprights.has(object.name)) clear.push(object)
      if (!(object instanceof THREE.Mesh) || !object.material.isShaderMaterial) return
      if (object.parent && uprights.has(object.parent.name)) faces.push(object)
    })
    for (const group of [riser,frontages]) group.traverse(object => {
      if (object instanceof THREE.Mesh && object.material.isShaderMaterial) faces.push(object)
    })
    const bounds = clear.map(object => new THREE.Box3().setFromObject(object))
    const stair = required('southeast stair and lift reflection frontage')
    const stairCore = required('stair and lift core')
    const stairBounds = new THREE.Box3().setFromObject(stair)
    bounds.push(stairBounds)
    expect(stair.parent).toBe(stairCore)
    expect(Math.hypot(stairBounds.min.x,stairBounds.max.z)).toBeGreaterThan(9)
    const emitters = faces.map(object => [object,new THREE.Box3().setFromObject(object)] as const)
    const near = required('northeast roof access')
    bounds.push(new THREE.Box3().setFromObject(near))
    const pupil = config.film.shutterDegrees / (720*config.film.fps)
    const camera = new THREE.PerspectiveCamera()
    const frustum = new THREE.Frustum()
    const matrix = new THREE.Matrix4()
    const wakeEnd = config.beats.find(b=>b.id==='wake')!.end
    const returnStart = config.beats.find(b=>b.id==='return')!.start
    const localCorner = new THREE.Vector3()
    const reachesCrop = (object: THREE.Mesh) => {
      object.geometry.computeBoundingBox()
      const { min,max } = object.geometry.boundingBox!
      let above = true, below = true, left = true, right = true
      for (const x of [min.x,max.x]) for (const y of [min.y,max.y]) for (const z of [min.z,max.z]) {
        object.localToWorld(localCorner.set(x,y,z)).applyMatrix4(camera.matrixWorldInverse)
        if (localCorner.z >= -camera.near) return true
        localCorner.applyMatrix4(camera.projectionMatrix)
        above &&= localCorner.y>1
        below &&= localCorner.y<-1
        left &&= localCorner.x<-1
        right &&= localCorner.x>1
      }
      return !(above || below || left || right)
    }
    let min = Infinity
    for (const format of [config.formats.master,config.formats.vertical]) {
      for (let i=0;i<=frameCount;i++) {
        const time = i/config.film.fps
        for (const offset of [-pupil,0,pupil]) {
          const state = cameraAt(time+offset,format,anchors,time)
          for (const box of bounds) min = Math.min(min,box.distanceToPoint(state.position)-apertureRadius(state))
        }
        if (time >= wakeEnd && time < returnStart) continue
        applyLens(camera,cameraAt(time,format,anchors,time),format.width,format.height,{pixel:[0,0],aperture:[0,0]},1)
        camera.updateMatrixWorld(true)
        frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse))
        for (const [object,box] of emitters) {
          expect(frustum.intersectsBox(box) && reachesCrop(object),`${format.id} ${i} ${object.parent?.name}`).toBe(false)
        }
      }
    }
    expect(min).toBeGreaterThan(.10)
    const installed: [THREE.Mesh,THREE.Box3][] = []
    for (const part of [required('screen tower occupied media gallery'),required('bridge violet media fascia'),required('west media transfer gallery'),stair]) {
      part.traverse(o => {
        if (o instanceof THREE.Mesh) installed.push([o,new THREE.Box3().setFromObject(o)])
      })
    }
    for (const format of [config.formats.master,config.formats.vertical]) for (const frame of new Set([0,60,150,...judgedFrames().map(j=>j.frame)])) {
      const time = frame/config.film.fps
      applyLens(camera,cameraAt(time,format,anchors,time),format.width,format.height,{pixel:[0,0],aperture:[0,0]},1)
      frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse))
      expect(installed.some(([mesh,box])=>frustum.intersectsBox(box) && reachesCrop(mesh)),`${format.id} ${frame}`).toBe(false)
    }
    const mural = required('animated magenta violet mural') as THREE.Mesh<THREE.PlaneGeometry>
    const { width,height } = mural.geometry.parameters
    for (const x of [-.8,0,.8]) for (const z of [-.9,0,.9]) {
      const roof = new THREE.Vector3(x,1.28,z)
      for (const u of [-.4,0,.4]) for (const v of [-.4,0,.4]) {
        const led = mural.localToWorld(new THREE.Vector3(u*width,v*height,0))
        const segment = new THREE.Box3().setFromPoints([roof,led])
        const ray = new THREE.Ray(roof,led.clone().sub(roof).normalize())
        expect(installed.some(([,box])=>box.intersectsBox(segment) && ray.intersectsBox(box))).toBe(false)
      }
    }
    const probe = new THREE.Vector3(0,.6,0)
    const casters: [THREE.Mesh,THREE.Box3][] = []
    world.root.traverseVisible(o => {
      if (o instanceof THREE.Mesh) casters.push([o,new THREE.Box3().setFromObject(o)])
    })
    const firstHit = (caster: THREE.Raycaster) => caster.intersectObjects(
      casters.filter(([,box])=>caster.ray.intersectsBox(box)).map(([object])=>object),false,
    )[0]
    const visible = (fixture: THREE.Object3D, aperture: string) => {
      const face = fixture.getObjectByName(aperture)!
      const ray = face.getWorldPosition(new THREE.Vector3()).sub(probe)
      const caster = new THREE.Raycaster(probe,ray.clone().normalize(),0,ray.length()+.02)
      expect(firstHit(caster)?.object,fixture.name).toBe(face)
      return ray.normalize()
    }
    const media = required('screen tower occupied media gallery')
    const westMedia = required('west media transfer gallery')
    const skybridgeShell = new THREE.Box3().setFromObject(required('skybridge structural shell'))
    expect(media.parent).toBe(riser)
    const carrier = new THREE.Box3().setFromObject(required('gallery bearing and transfer beam'))
    const gallery = new THREE.Box3().setFromObject(required('occupied upper gallery shell'))
    expect(carrier.intersectsBox(gallery)).toBe(true)
    expect(carrier.intersectsBox(skybridgeShell)).toBe(true)
    const westGirder = new THREE.Box3().setFromObject(required('west transfer box girder'))
    expect(westGirder.intersectsBox(skybridgeShell)).toBe(true)
    expect(westGirder.intersectsBox(new THREE.Box3().setFromObject(required('west upper gallery shell')))).toBe(true)
    for (const name of ['bridge violet media fascia','lower violet media bank','upper magenta media bank']) {
      const fixture = required(name)
      expect(fixture.parent).toBe(name.startsWith('bridge') ? required('screen tower upper service skybridge') : media)
      const ray = visible(fixture,'animated magenta violet tiles')
      const azimuth = THREE.MathUtils.radToDeg(Math.atan2(ray.x,ray.z))
      const elevation = THREE.MathUtils.radToDeg(Math.asin(ray.y))
      expect(azimuth).toBeGreaterThan(-163)
      expect(azimuth).toBeLessThan(-141)
      expect(elevation).toBeGreaterThan(30)
      expect(elevation).toBeLessThan(46)
      const face = fixture.getObjectByName('animated magenta violet tiles') as THREE.Mesh<THREE.PlaneGeometry>
      const { width,height } = face.geometry.parameters
      expect(width).toBeGreaterThan(85)
      expect(height).toBeGreaterThan(name.startsWith('bridge') ? 8 : 40)
    }
    expect(riser.getObjectsByProperty('name','gallery cyan strip')).toHaveLength(3)
    expect(media.getObjectsByProperty('name','occupied gallery window').length).toBeGreaterThan(30)
    for (const [name,lo,hi] of [['bonnet media bank',32,37],['bonnet media inset',32,37],
      ['windscreen media bank',41,46],['windscreen media inset',41,46]] as const) {
      const fixture = required(name)
      expect(fixture.parent).toBe(westMedia)
      const ray = visible(fixture,'animated magenta violet tiles')
      expect(THREE.MathUtils.radToDeg(Math.atan2(ray.x,ray.z))).toBeGreaterThan(-150)
      expect(THREE.MathUtils.radToDeg(Math.atan2(ray.x,ray.z))).toBeLessThan(-140)
      expect(THREE.MathUtils.radToDeg(Math.asin(ray.y))).toBeGreaterThan(lo)
      expect(THREE.MathUtils.radToDeg(Math.asin(ray.y))).toBeLessThan(hi)
      const face = fixture.getObjectByName('animated magenta violet tiles') as THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>
      expect(face.geometry.parameters.width*face.geometry.parameters.height).toBeLessThan(780)
      expect(face.material.uniforms.artwork.value).toBeInstanceOf(THREE.DataTexture)
      expect(face.material.uniforms.artworkGain.value).toBeLessThan(1)
    }
    let bonnetRays = 0
    let darkWestRays = 0
    for (const az of [-148,-146,-144,-142]) for (const el of [33.5,34.5,35.5,36.5]) {
      const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el)
      const ray = new THREE.Raycaster(probe,new THREE.Vector3(Math.sin(a)*Math.cos(e),Math.sin(e),Math.cos(a)*Math.cos(e)))
      const object = firstHit(ray)?.object
      if (object?.name === 'animated magenta violet tiles' && object.parent?.name.startsWith('bonnet media ')) bonnetRays++
      if (object?.name === 'lower media folded spandrel' || object?.name === 'folded media divider') darkWestRays++
    }
    expect(bonnetRays).toBeGreaterThanOrEqual(2)
    expect(bonnetRays).toBeLessThanOrEqual(8)
    expect(darkWestRays).toBeGreaterThan(2)
    const hits = new Set<string>()
    let mediaRays = 0
    for (const az of [-161,-158,-155,-152,-149]) for (const el of [35,37,38,39,42,44,45]) {
      const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el)
      const ray = new THREE.Raycaster(probe,new THREE.Vector3(Math.sin(a)*Math.cos(e),Math.sin(e),Math.cos(a)*Math.cos(e)))
      const hit = firstHit(ray)
      if (hit?.object.name === 'animated magenta violet tiles') {
        hits.add(hit.object.parent?.name ?? '')
        mediaRays++
      }
    }
    expect(hits).toEqual(new Set(['bridge violet media fascia','lower violet media bank','upper magenta media bank']))
    expect(mediaRays).toBeGreaterThanOrEqual(17)
    for (const [fixtureName,railName] of [
      ['amber stair entrance sign','amber sign folded wall rail'],
      ['violet stair dado lens','violet lens recessed wall rail'],
      ['violet stair entrance jamb lens','violet stair entrance jamb rail'],
      ['amber stair entrance jamb lens','amber stair entrance jamb rail'],
      ['cyan service fascia strip','cyan service fascia wall rail'],
      ['cyan stair return tracer','tall cyan lens support jamb'],
    ] as const) {
      const wall = new THREE.Box3().setFromObject(required(railName))
      const fixtures = stair.getObjectsByProperty('name',fixtureName)
      expect(fixtures.length).toBeGreaterThan(0)
      for (const fixture of fixtures) {
        for (const cleat of fixture.getObjectsByProperty('name','fixture mounting cleat')) {
          expect(wall.intersectsBox(new THREE.Box3().setFromObject(cleat)),fixture.name).toBe(true)
        }
        const ray = visible(fixture,fixtureName==='amber stair entrance sign' ? 'diffusing cabinet face' : 'sealed opal aperture')
        const azimuth = THREE.MathUtils.radToDeg(Math.atan2(ray.x,ray.z))
        const elevation = THREE.MathUtils.radToDeg(Math.asin(ray.y))
        expect(azimuth).toBeGreaterThan(140)
        expect(azimuth).toBeLessThan(168)
        expect(elevation).toBeGreaterThan(0)
        expect(elevation).toBeLessThan(24)
      }
    }
    const bridge = required('screen tower upper service skybridge')
    const bridgeEmitters = bridge.children.filter(o => o.name === 'high bridge window bay' || o.name === 'high bridge service sign')
    expect(bridgeEmitters).toHaveLength(7)
    for (const fixture of bridgeEmitters) {
      const aperture = fixture.name === 'high bridge service sign' ? 'diffusing cabinet face' : 'sealed opal aperture'
      const ray = visible(fixture,aperture)
      const azimuth = THREE.MathUtils.radToDeg(Math.atan2(ray.x,ray.z))
      expect(azimuth).toBeGreaterThan(-153)
      expect(azimuth).toBeLessThan(-147)
      expect(ray.y).toBeGreaterThan(.54)
      expect(ray.y).toBeLessThan(.62)
      const face = fixture.getObjectByName(aperture) as THREE.Mesh
      face.geometry.computeBoundingBox()
      const { min, max } = face.geometry.boundingBox!
      const slope = (x: number,y: number,axis: 'x' | 'y') => {
        const corner = face.localToWorld(new THREE.Vector3(x,y,0)).sub(probe)
        return corner[axis]/corner.z
      }
      const edge = quality.review.captureSize*.5
      expect(Math.abs(slope(min.x,0,'x')-slope(max.x,0,'x'))*edge).toBeGreaterThan(2)
      expect(Math.abs(slope(0,min.y,'y')-slope(0,max.y,'y'))*edge).toBeGreaterThan(1.8)
    }
    const macro = visible(required('northwest animated LED wall'),'animated magenta violet tiles')
    expect(THREE.MathUtils.radToDeg(Math.atan2(macro.x,macro.z))).toBeCloseTo(-49,0)
    expect(visible(required('recessed amber service sign'),'diffusing cabinet face').z).toBeLessThan(0)
    const getFlow = (timeSeconds: number) => {
      world.beginFrame({ frame: { timeSeconds } } as FrameContext)
      return ['northwest animated LED wall','bridge violet media fascia','lower violet media bank','upper magenta media bank','bonnet media bank','windscreen media bank'].map(name => {
        const tiles = required(name).getObjectByName('animated magenta violet tiles') as THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>
        return (tiles.material.uniforms.flow.value as THREE.Vector2).clone()
      })
    }
    const start = getFlow(0), middle = getFlow(config.film.durationSeconds*.5), end = getFlow(config.film.durationSeconds)
    for (const [i,flow] of start.entries()) {
      expect(flow.distanceTo(end[i])).toBeLessThan(1e-12)
      expect(flow.distanceTo(middle[i])).toBeGreaterThan(1.5)
    }
    world.beginFrame({ frame: { timeSeconds: 0 } } as FrameContext)
    expect(world.lights).toHaveLength(8)
  })

  it('keeps distance haze on the southern tower walls rather than the deck or north district', () => {
    const response = (name: string) => {
      const tower = world.root.getObjectByName(name) as THREE.Mesh<THREE.BoxGeometry,THREE.MeshStandardMaterial>
      return tower.material.userData.skylineAir as [number,number,number]
    }
    const near = response('hero hotel tower')
    const far = response('hero far center distance')
    expect(near[0]).toBe(1)
    expect(far[0]).toBe(1)
    expect(far[1]).toBeGreaterThan(near[1])
    expect(near[2]).toBeLessThan(.2)
    const north = world.root.getObjectByName('north tower ranks')!
    const shells = north.children.filter(shell=>shell.name.startsWith('north tower shells'))
    expect(shells.length).toBeGreaterThan(0)
    for (const shell of shells) expect(response(shell.name)).toEqual([0,0,0])
    expect(world.deck.material.userData.skylineAir).toBeUndefined()
  })

  it('exposes metric relief for the front puddle and an unchanged reflective plane', () => {
    const { deck } = world
    expect(deck.heightMap).toBeInstanceOf(THREE.DataTexture)
    const map = deck.heightMap as THREE.DataTexture
    expect(map.format).toBe(THREE.RedFormat)
    expect(map.type).toBe(THREE.FloatType)
    expect(deckHeight(.55, 1.95)).toBeLessThan(-.008)
    expect(deckHeight(1.21, 1.64)).toBeLessThan(-.003)
    expect(deckHeight(.96, 1.285)).toBeGreaterThan(0)
    expect(deckHeight(.18, -3.71)).toBeLessThan(0)
    expect(deckHeight(0, 0)).toBeGreaterThan(0)
    expect(deckHeight(...heroGrate)).toBeLessThan(-.002)
    expect(deckHeight(heroGrate[0], heroGrate[1] - .42)).toBeGreaterThan(deckHeight(...heroGrate))
    const samples = map.image.data as Float32Array
    const w = map.image.width
    const h = map.image.height
    const ix = Math.floor((.55 - deck.bounds.min.x) / (deck.bounds.max.x - deck.bounds.min.x) * w)
    const iz = Math.floor((1.95 - deck.bounds.min.y) / (deck.bounds.max.y - deck.bounds.min.y) * h)
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
    for (const name of ['hero near bay line','west bay edge marking','west bay edge continuation']) {
      const marking = world.root.getObjectByName(name) as THREE.Mesh
      const vertices = marking.geometry.getAttribute('position')
      for (let i=0;i<vertices.count;i++) {
        const p = marking.localToWorld(new THREE.Vector3().fromBufferAttribute(vertices,i))
        expect(p.y-deckHeight(p.x,p.z)).toBeCloseTo(.003,6)
      }
    }
    const lens = new THREE.PerspectiveCamera()
    const { master } = config.formats
    applyLens(lens,cameraAt(config.film.heroFrameSeconds,master,anchors),master.width,master.height,{ pixel:[0,0],aperture:[0,0] },1)
    for (const u of [.18,.22,.25]) {
      const ray = new THREE.Raycaster(lens.position,new THREE.Vector3(2*u-1,-.82,.5).unproject(lens).sub(lens.position).normalize())
      expect(world.deck.meshes).toContain(ray.intersectObject(world.root,true)[0]?.object)
    }
  })

  it('exposes mounted reflection openings to the outer deck bands across the wide loop', () => {
    world.root.updateMatrixWorld(true)
    vehicle.updateMatrixWorld(true)
    const openings: { mesh: THREE.InstancedMesh; center: THREE.Vector3 }[] = []
    const matrix = new THREE.Matrix4()
    world.root.traverse(mesh => {
      if (!(mesh instanceof THREE.InstancedMesh) ||
        !['parapet warm strip lenses','recessed lit window apertures'].includes(mesh.name)) return
      expect(mesh.parent?.getObjectByName('sealed metal housings')).toBeInstanceOf(THREE.InstancedMesh)
      for (let i=0;i<mesh.count;i++) {
        mesh.getMatrixAt(i,matrix)
        openings.push({ mesh, center: mesh.localToWorld(new THREE.Vector3().setFromMatrixPosition(matrix)) })
      }
    })
    expect(openings.length).toBeGreaterThan(85)
    const candidates: { mesh: THREE.Mesh; box: THREE.Box3 }[] = []
    for (const root of [world.root,vehicle]) root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      if (object instanceof THREE.InstancedMesh && !object.boundingBox) object.computeBoundingBox()
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox()
      const bounds = object instanceof THREE.InstancedMesh ? object.boundingBox! : object.geometry.boundingBox!
      candidates.push({mesh: object, box: bounds.clone().applyMatrix4(object.matrixWorld)})
    })
    const ray = new THREE.Raycaster(), direction = new THREE.Vector3(), entry = new THREE.Vector3()
    const hits: THREE.Mesh[] = []
    const firstHit = (a: THREE.Vector3,b: THREE.Vector3,slack = 0) => {
      direction.subVectors(b,a)
      ray.far = direction.length()+slack
      ray.near = .001
      ray.set(a,direction.normalize())
      hits.length = 0
      for (const { mesh,box } of candidates) {
        if (box.containsPoint(a) || (ray.ray.intersectBox(box,entry) && entry.distanceToSquared(a)<=ray.far**2)) hits.push(mesh)
      }
      return ray.intersectObjects(hits,false)[0]
    }
    const { master } = config.formats
    const lens = new THREE.PerspectiveCamera()
    for (const frame of [0,60,150,195,240,1170,1215,1340]) {
      const wanted = [7,frame===0 || frame===1340 ? 2 : 0,12]
      const t = frame/config.film.fps
      applyLens(lens,cameraAt(t,master,anchors),master.width,master.height,{pixel:[0,0],aperture:[0,0]},1)
      for (const { mesh,center } of openings) {
        const mirrored = center.clone()
        mirrored.y *= -1
        const ndc = mirrored.clone().project(lens)
        if (Math.abs(ndc.x)>.98 || ndc.y>-.18 || ndc.y<-.98) continue
        const band = ndc.x<-.40 ? 0 : ndc.x<.30 ? 1 : 2
        if (!wanted[band]) continue
        const contact = lens.position.clone().lerp(mirrored,lens.position.y/(lens.position.y+center.y))
        if (firstHit(lens.position,contact,-.10)) continue
        const lift = Math.max(.006,deckHeight(contact.x,contact.z)+.006)
        const fixture = firstHit(contact.lerp(center,lift/center.y),center,.02)
        if (fixture?.object===mesh) wanted[band]!--
      }
      expect(wanted,'frame '+frame).toEqual([0,0,0])
    }
  }, 30000)

  it('keeps parapet trim warm white and authors HDR on faces rather than duplicating lights', () => {
    const trim = world.root.getObjectByName('parapet warm strip lenses') as THREE.InstancedMesh
    const wall = world.root.getObjectByName('hero full span concrete parapet') as THREE.Mesh<THREE.BoxGeometry,THREE.MeshStandardMaterial>
    expect(patchesOf(wall.material)).toContain('parapet opal downwash')
    expect(patchesOf(world.deck.material)).not.toContain('parapet opal downwash')
    expect(wall.material.color.b/wall.material.color.r).toBeGreaterThan(.85)
    const tints = new Set<THREE.Color>()
    for (const id of ['left warm parapet strip','right warm parapet strip']) {
      const slot = world.root.getObjectByName(id)
      const face = slot?.getObjectByName('weather-sealed opal face') as THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>
      const tint = face.material.uniforms.tint!.value as THREE.Color
      tints.add(tint)
      expect(tint.r).toBeGreaterThan(15)
      expect(tint.b/tint.r).toBeGreaterThan(.68)
      expect(face.geometry.parameters.height).toBe(approvedHeroSourceSurvey().find(source=>source.id===id)!.size[1])
    }
    expect(tints.size).toBe(2)
    const color = new THREE.Color()
    expect(world.root.getObjectByName('parapet marker lenses')).toBeUndefined()
    expect(trim.count).toBeGreaterThan(2)
    for (let i=0;i<trim.count;i++) {
      trim.getColorAt(i,color)
      expect(color.g/color.r).toBeGreaterThan(.76)
      expect(color.b/color.r).toBeGreaterThan(.55)
      expect(color.r).toBeGreaterThan(4)
    }
    const arrow = world.root.getObjectByName('wayfinding arrow stem') as THREE.Mesh<THREE.BoxGeometry,THREE.MeshBasicMaterial>
    expect(arrow.material.toneMapped).toBe(false)
    expect(arrow.material.color.r).toBeGreaterThan(10)
    const blade = world.root.getObjectByName('violet mid distance blade')
      ?.getObjectByName('weather-sealed opal face') as THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>
    expect((blade.material.uniforms.tint!.value as THREE.Color).b).toBeGreaterThan(10)
    const arcade = world.root.getObjectByName('stacked amber arcade cabinet')!
    const face = arcade.getObjectByName('diffusing cabinet face') as THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>
    expect((face.material.uniforms.tint!.value as THREE.Color).r).toBeGreaterThan(4)
    expect(world.lights.some(light => light.object.parent===arcade)).toBe(false)
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

  it('mounts the left shopfront signs and narrows the cyan optics without changing the rig footprint', () => {
    const format = config.formats.master
    const t = config.film.heroFrameSeconds
    const lens = new THREE.PerspectiveCamera()
    const center = new THREE.Vector3()
    world.root.updateMatrixWorld(true)
    applyLens(lens,cameraAt(t,format,anchors),format.width,format.height,{pixel:[0,0],aperture:[0,0]},1)
    for (const [id,parent,low] of [
      ['west vertical tailor blade','hero left edge tower volume',false],
      ['west cyan arcade shopfront','hero near west garage bay volume',true],
      ['middle cyan noodle shopfront','hero middle west distance volume',true],
      ['low magenta bar shopfront','hero bar tower volume',true],
    ] as const) {
      const fixture = world.root.getObjectByName(id)!
      expect(fixture.parent?.name).toBe(parent)
      const face = fixture.getObjectByName('diffusing cabinet face')!
      const ndc = face.getWorldPosition(center).project(lens)
      const y = (1-ndc.y)*.5
      expect(y).toBeGreaterThan(low ? .39 : 0)
      expect(y).toBeLessThan(low ? .44 : .10)
      const ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2(ndc.x,ndc.y),lens)
      const guard = /^hero (full span steel top rail|steel mid rail|rail post)/
      expect(ray.intersectObject(world.root,true).find(hit=>!guard.test(hit.object.name))?.object.parent?.name).toBe(id)
    }
    const rise = approvedHeroSourceSurvey().find(source=>source.id==='cyan garage rise')!
    const optic = world.root.getObjectByName(rise.id)?.getObjectByName('weather-sealed opal face') as THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>
    expect(optic.geometry.parameters.width*rise.scale).toBeLessThan(rise.size[0]*.72)
    expect(optic.material.uniforms.shaped?.value).toBe(1)
    world.beginFrame({ frame: { timeSeconds: t } } as FrameContext)
    const wideFootprint = world.lights.find(light=>light.id===rise.id)?.size
    world.beginFrame({ frame: { timeSeconds: 0 } } as FrameContext)
    expect(wideFootprint).toEqual(rise.size)
  })

  it('projects stepped facade ledges from the tower shells and shields the amber opal apertures', () => {
    const names = ['hero left edge tower','hero hotel tower','hero near west garage bay','hero amber tower','hero near east garage bay']
    const model = new THREE.Matrix4(), p = new THREE.Vector3(), size = new THREE.Vector3()
    for (const name of names) {
      const tower = world.root.getObjectByName(name+' volume')!
      const wall = tower.getObjectByName(name) as THREE.Mesh<THREE.BoxGeometry>
      const ledges = tower.getObjectByName('projecting slab noses') as THREE.InstancedMesh
      const returns = tower.getObjectByName('inset spandrel returns') as THREE.InstancedMesh
      const bounds = wall.geometry.parameters
      const front = wall.position.z+bounds.depth*.5
      expect(wall.getWorldPosition(p).length()).toBeGreaterThan(350)
      expect(ledges.count).toBeGreaterThanOrEqual(10)
      expect(returns.count).toBe(ledges.count)
      for (let i=0;i<ledges.count;i++) {
        ledges.getMatrixAt(i,model)
        p.setFromMatrixPosition(model)
        size.setFromMatrixScale(model)
        expect(p.z-size.z*.5).toBeLessThan(front)
        expect(p.z+size.z*.5).toBeGreaterThan(front+.45)
        expect(Math.abs(p.x-wall.position.x)+size.x*.5).toBeLessThan(bounds.width*.5)
        expect(p.y+size.y*.5).toBeLessThan(wall.position.y+bounds.height*.5-2)
      }
    }
    for (const id of ['right amber facade sail','amber garage rise','amber garage return']) {
      const source = approvedHeroSourceSurvey().find(source=>source.id===id)!
      const optic = world.root.getObjectByName(id)?.getObjectByName('weather-sealed opal face') as THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>
      expect(optic.geometry.parameters.width*source.scale).toBeLessThan(source.size[0]*.9)
      expect(optic.material.uniforms.gap?.value).toBeGreaterThan(.06)
    }
    const rise = world.lights.find(light=>light.id==='amber garage rise')!
    expect(rise.size).toEqual(approvedHeroSourceSurvey().find(source=>source.id===rise.id)!.size)
    expect(world.lights).toHaveLength(8)
  })

  it('shows metric warm office floors and mounted right facade markers at the hero', () => {
    const tower = world.root.getObjectByName('hero amber tower volume')!
    const shell = tower.getObjectByName('hero amber tower') as THREE.Mesh<THREE.BoxGeometry,THREE.MeshStandardMaterial>
    const panes = tower.getObjectByName('warm office window panes') as THREE.InstancedMesh
    const frame = tower.getObjectByName('east office curtain wall bays')!
    const housings = frame.getObjectByName('sealed metal housings') as THREE.InstancedMesh<THREE.BoxGeometry>
    const front = (wall: THREE.Mesh<THREE.BoxGeometry>)=>wall.position.z+wall.geometry.parameters.depth*.5
    expect(frame.parent).toBe(tower)
    expect(frame.getObjectByName('folded sill mounts')).toBeDefined()
    expect(housings.count).toBe(panes.count)
    expect(shell.material.color.r).toBeLessThan(.016)
    const eye = cameraAt(config.film.heroFrameSeconds,config.formats.master,anchors).position
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), size = new THREE.Vector3(), color = new THREE.Color()
    const hits = (p: THREE.Vector3) => {
      const delta = p.clone().sub(eye)
      return new THREE.Raycaster(eye,delta.clone().normalize(),.01,delta.length()+.017).intersectObject(world.root,true)[0]
    }
    world.root.updateMatrixWorld(true)
    let bright = 0, dark = 0, visible = 0
    for (let i=0;i<panes.count;i++) {
      housings.getMatrixAt(i,matrix)
      const back = position.setFromMatrixPosition(matrix).z-size.setFromMatrixScale(matrix).z*.5
      expect(back).toBeLessThan(front(shell))
      panes.getMatrixAt(i,matrix)
      size.setFromMatrixScale(matrix)
      expect(size.x).toBeGreaterThan(1.25)
      expect(size.x).toBeLessThan(1.50)
      expect(size.y).toBeLessThan(1.65)
      panes.getColorAt(i,color)
      if (color.r===0) dark++
      else if (color.r>4) {
        bright++
        const hit = hits(panes.localToWorld(position.setFromMatrixPosition(matrix)))
        if (hit?.object===panes && hit.instanceId===i) visible++
      }
    }
    expect(dark).toBeGreaterThan(5)
    expect(bright).toBeGreaterThan(18)
    expect(visible).toBeGreaterThan(15)
    const markers = world.root.getObjectsByProperty('name','east facade service marker')
    expect(markers).toHaveLength(13)
    expect(new Set(markers.map(marker=>marker.parent?.name)).size).toBe(3)
    for (const marker of markers) {
      const tower = marker.parent!
      const wall = tower.getObjectByName(tower.name.replace(' volume','')) as THREE.Mesh<THREE.BoxGeometry>
      const cleats = marker.getObjectsByProperty('name','fixture mounting cleat') as THREE.Mesh<THREE.BoxGeometry>[]
      expect(cleats).toHaveLength(2)
      for (const cleat of cleats) expect(marker.position.z+cleat.position.z-cleat.geometry.parameters.depth*.5).toBeLessThan(front(wall))
    }
    expect(markers.filter(marker=>hits(marker.getWorldPosition(position))?.object.parent===marker).length).toBeGreaterThan(6)
    expect(markers.every(marker=>!world.lights.some(light=>light.object.parent===marker))).toBe(true)
  })

  it('shows the stacked accent cabinets from both hero cameras', () => {
    const point = new THREE.Vector3()
    for (const name of ['stacked amber arcade cabinet','stacked amber noodle cabinet']) {
      const cabinet = world.root.getObjectByName(name)!
      expect(cabinet.parent?.name).toBe('hero near east garage bay volume')
      cabinet.getObjectByName('diffusing cabinet face')!.getWorldPosition(point)
      for (const format of [config.formats.master,config.formats.vertical]) {
        const eye = cameraAt(config.film.heroFrameSeconds,format,anchors).position
        const delta = point.clone().sub(eye)
        const ray = new THREE.Raycaster(eye,delta.clone().normalize(),.01,delta.length()+.025)
        expect(ray.intersectObject(world.root,true)[0]?.object.parent).toBe(cabinet)
      }
    }
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

  it('backs the rear reflection optics at every judged camera in both formats', () => {
    world.root.updateMatrixWorld(true)
    const required = (id: string, parent: THREE.Object3D = world.root) => parent.getObjectByName(id)!
    const bounds = (object: THREE.Object3D) => new THREE.Box3().setFromObject(object)
    const floodBank = required('rear service flood bank')
    const floodPole = floodBank.parent!
    const collar = bounds(required('worklight bolted base collar',floodPole))
    expect(collar.intersectsBox(bounds(required('pole base plate',floodPole)))).toBe(true)
    expect(collar.intersectsBox(bounds(required('tapered steel post',floodPole)))).toBe(true)
    expect(bounds(required('worklight bracket plate',floodBank)).intersectsBox(bounds(required('worklight mast socket',floodPole)))).toBe(true)
    const ramp = required('west ramp luminous barrier')
    const extension = required('precast ramp barrier extension',ramp)
    const channel = required('recessed barrier lighting channel',ramp)
    expect(bounds(extension).intersectsBox(bounds(channel))).toBe(true)
    expect(ramp.parent!.getObjectsByProperty('name','ramp guard wall').some(wall=>bounds(wall).intersectsBox(bounds(extension)))).toBe(true)
    const north = required('north deck cyan guidance')
    const parapet = required('solid concrete',north.parent!)
    const footings = north.getObjectsByProperty('name','guardwall saddle footing')
    expect(footings).toHaveLength(8)
    expect(footings.every(foot=>bounds(parapet).intersectsBox(bounds(foot)))).toBe(true)
    const west = required('west low block')
    const penthouse = required('roof plant and duct enclosure',west)
    const westWalls = west.children.filter(o=>o.name==='building mass').map(bounds)
    expect(westWalls.some(wall=>wall.intersectsBox(bounds(penthouse)))).toBe(true)
    const westMarkerBacks = west.getObjectsByProperty('name','recessed frontage beacon mount')
    expect(westMarkerBacks).toHaveLength(4)
    expect(westMarkerBacks.every(back=>westWalls.some(wall=>wall.intersectsBox(bounds(back))))).toBe(true)
    for (const [elevationId,wallId,fixtureId,receiverId] of [
      ['northwest market media elevation','market media podium','northwest animated LED wall','market media podium'],
      ['northwest market media elevation','market media podium','recessed market window bay','market media podium'],
      ['northwest market media elevation','market media podium','horizontal cyan market fascia','recessed market fascia spandrel'],
      ['northwest market media elevation','market media podium','market blade wayfinding','market blade receiver plate'],
      ['east quarter street frontage','brick retail and office wing','stacked east retail box sign','retail sign receiver plate'],
    ]) {
      const elevation = required(elevationId!)
      const localBounds = (object: THREE.Object3D) => {
        const mesh = object as THREE.Mesh<THREE.BoxGeometry>
        mesh.geometry.computeBoundingBox()
        return mesh.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().copy(elevation.matrixWorld).invert().multiply(mesh.matrixWorld))
      }
      const wall = localBounds(required(wallId!,elevation))
      const receivers = elevation.getObjectsByProperty('name',receiverId!).map(localBounds)
      expect(receivers.every(receiver=>receiver.intersectsBox(wall))).toBe(true)
      for (const fixture of elevation.getObjectsByProperty('name',fixtureId!)) {
        const cleats = fixture.getObjectsByProperty('name','fixture mounting cleat').map(localBounds)
        expect(cleats).toHaveLength(2)
        expect(cleats.every(cleat=>receivers.some(receiver=>receiver.intersectsBox(cleat))),fixtureId).toBe(true)
      }
    }
    const supported: [THREE.Mesh<THREE.PlaneGeometry>,THREE.Box3][] = [
      ['west ramp luminous barrier','graded ramp opal strip','recessed barrier lighting channel'],
      ['west parking fascia return','feathered LED ribbon','ribbon casing'],
      ['west roof wayfinding crown','feathered LED ribbon','ribbon casing'],
      ['northwest concourse ribbon','feathered LED ribbon','ribbon casing'],
      ['east glazed concourse return','feathered LED ribbon','ribbon casing'],
      ['west upper service LED cabinet','segmented cool white LED face','sealed practical casing'],
    ].map(([id,optic,back])=>[required(optic!,required(id!)) as THREE.Mesh<THREE.PlaneGeometry>,bounds(required(back!,required(id!)))])
    for (const fixture of north.getObjectsByProperty('name','reflected cyan north guardwall lamp')) {
      supported.push([required('sealed opal aperture',fixture) as THREE.Mesh<THREE.PlaneGeometry>,bounds(required('sealed metal housing',fixture))])
    }
    const camera = new THREE.PerspectiveCamera()
    const point = new THREE.Vector3(), projected = new THREE.Vector3(), direction = new THREE.Vector3()
    const ray = new THREE.Ray()
    const seen = new Set<THREE.Mesh>()
    for (const format of [config.formats.master,config.formats.vertical]) for (const { frame } of judgedFrames()) {
      const state = cameraAt(frame/config.film.fps,format,anchors)
      applyLens(camera,state,format.width,format.height,{pixel:[0,0],aperture:[0,0]},1)
      camera.updateMatrixWorld(true)
      for (const [face,backing] of supported) {
        if (direction.set(0,0,1).transformDirection(face.matrixWorld).dot(point.setFromMatrixPosition(face.matrixWorld).sub(state.position))>=0) continue
        const { width,height } = face.geometry.parameters
        for (const [u,v] of [[0,0],[-.35,-.30],[.35,-.30],[-.35,.30],[.35,.30]] as const) {
          face.localToWorld(point.set(u*width,v*height,0))
          projected.copy(point).project(camera)
          if (Math.max(Math.abs(projected.x),Math.abs(projected.y),Math.abs(projected.z))>1) continue
          ray.set(state.position,direction.copy(point).sub(state.position).normalize())
          expect(ray.intersectsBox(backing),format.id+' '+frame+' '+face.parent?.name).toBe(true)
          seen.add(face)
        }
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(6)
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

  it('paints distinct hot, violet and indigo regions on the media', () => {
    for (const wall of [false,true]) {
      const { data, width, height } = muralPainting(wall).image
      if (!(data instanceof Uint16Array)) throw new Error('Missing half float mural raster')
      const sample = (u: number, v: number) => {
        const i = (Math.floor(v*Math.min(width,height))*width+Math.floor(u*width))*4
        const f = THREE.DataUtils.fromHalfFloat
        return new THREE.Color(f(data[i]),f(data[i+1]),f(data[i+2]))
      }
      const hot = sample(.23,.55)
      const violet = sample(.71,.61)
      const indigo = sample(.79,.21)
      expect(hot.r/hot.b).toBeGreaterThan(2)
      expect(violet.b/violet.r).toBeGreaterThan(2)
      expect(muralLuma(indigo)).toBeLessThan(.6*muralLuma(violet))
    }
    const first = muralMean(1,0,.166,new THREE.Color())
    const shifted = muralMean(-1,0,.166,new THREE.Color())
    expect(Math.abs(first.r-shifted.r)).toBeGreaterThan(.25)
  })

  it('drives the tower mural periodically while leaving macro emitter slots on their original mounts', () => {
    const id = 'magenta violet tower screen'
    const emitter = world.lights.find(l => l.id === id)!
    const face = world.root.getObjectByName('animated magenta violet mural') as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
    const firstFrame = (timeSeconds: number) => world.beginFrame({ frame: { timeSeconds } } as FrameContext)
    firstFrame(0)
    const first = face.material.uniforms.flow.value.clone()
    const sky = world.root.getObjectByName('city-lit cloud base') as THREE.Mesh<THREE.SphereGeometry,THREE.ShaderMaterial>
    const cloud = sky.material.uniforms.muralCloud.value as THREE.Color
    const firstCloud = cloud.clone()
    const wall = world.root.getObjectByName(id)
    const rate = emitter.level(0)
    expect(emitter.object.parent).toBe(wall)
    expect(face.material.uniforms.picture.value).toBe(1)
    world.root.updateMatrixWorld(true)
    const tower = world.root.getObjectByName('hero screen tower volume')!.children[0]
    const supportPlane = new THREE.Box3().setFromObject(tower)
    const ties = wall!.children.filter(node => node.name === 'billboard facade tie plate')
    expect(ties).toHaveLength(12)
    for (const tie of ties) expect(supportPlane.intersectsBox(new THREE.Box3().setFromObject(tie))).toBe(true)
    expect(emitter.intensity).toBe(Math.max(...world.lights.filter(light=>!light.shadow).map(light=>light.intensity)))
    const travel = face.material.uniforms.travel.value as number
    const ink = face.material.uniforms.artwork.value
    const upper = world.root.getObjectByName('bonnet media bank')!.getObjectByName('animated magenta violet tiles') as THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>
    expect(ink).toBe(muralPainting(true))
    expect(upper.material.uniforms.artwork.value).toBe(muralPainting(false))
    firstFrame(.08*config.film.durationSeconds)
    const flow = face.material.uniforms.flow.value as THREE.Vector2
    expect(flow.distanceTo(first)*travel).toBeGreaterThan(.12)
    const mean = muralMean(flow.x,flow.y,travel,new THREE.Color())
    const key = new THREE.Color()
    emitter.colorAt!(.08*config.film.durationSeconds,key)
    expect(key.r/key.b).toBeCloseTo(mean.r/mean.b,12)
    expect(key.g/key.b).toBeCloseTo(mean.g/mean.b,12)
    expect(cloud.toArray()).not.toEqual(firstCloud.toArray())
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
    expect(cloud.toArray()).toEqual(firstCloud.toArray())
    firstFrame(0)
  })

  it('aims the two warm parapet emitters across the deck while retaining the macro fixtures', () => {
    const set = (timeSeconds: number) => world.beginFrame({ frame: { timeSeconds } } as FrameContext)
    set(config.film.heroFrameSeconds)
    const lights = ['left warm parapet strip','right warm parapet strip'].map(id=>world.lights.find(l=>l.id===id)!)
    for (const light of lights) {
      const source = light.object.getWorldPosition(new THREE.Vector3())
      const normal = new THREE.Vector3(0,0,1).applyQuaternion(light.object.getWorldQuaternion(new THREE.Quaternion()))
      const reach = source.y*Math.hypot(normal.x,normal.z)/-normal.y
      expect(reach).toBeGreaterThan(.32)
      expect(reach).toBeLessThan(.65)
      expect(light.color.r).toBeGreaterThan(light.color.g)
      expect(light.color.g).toBeGreaterThan(light.color.b)
    }
    const anchors = lights.map(l=>l.object)
    set(config.film.macroFrameSeconds)
    expect(lights.every((l,i)=>l.object!==anchors[i])).toBe(true)
    set(0)
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
    const hotel = world.root.getObjectByName('hotel rooftop cabinet')!.getObjectByName('folded weatherproof cabinet') as THREE.Mesh<THREE.BoxGeometry>
    const hotelGeometry = hotel.geometry.parameters
    const hotelTop = (1-toScreen(hotel.localToWorld(new THREE.Vector3(0,hotelGeometry.height*.5,hotelGeometry.depth*.5))).y)*.5
    expect(hotelTop).toBeGreaterThan(.105)
    expect(hotelTop).toBeLessThan(.110)
    const wall = world.root.getObjectByName(billboard)!
    const face = wall.getObjectByName('animated magenta violet mural') as THREE.Mesh<THREE.PlaneGeometry>
    const { width,height } = face.geometry.parameters
    const band = height*(1/muralRise-.5)
    const left = toScreen(face.localToWorld(new THREE.Vector3(-width*.5,band,0)))
    const right = toScreen(face.localToWorld(new THREE.Vector3(width*.5,band,0)))
    expect(left.y).toBeLessThan(1)
    expect(toScreen(face.localToWorld(new THREE.Vector3(width*.5,height*.5,0))).y).toBeGreaterThan(1)
    expect(right.y-left.y).toBeGreaterThan(.02)
    const skyRay = (x: number, y: number) => new THREE.Raycaster(camera.position,
      new THREE.Vector3(x, y, .5).unproject(camera).sub(camera.position).normalize(), 0, camera.far+150)
    for (const x of [-.50, -.40, -.32, -.24, -.16]) {
      expect(skyRay(x,.92).intersectObject(world.root, true)[0]?.object.name).toBe('city-lit cloud base')
    }
    const centerTowers = [
      [.291,.175,'hero middle west distance',650,720],
      [.327,.200,'c9 center kiln tower',680,730],
      [.363,.150,'hero far west distance',790,830],
      [.402,.200,'c9 center fluted offices',805,850],
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
    for (const [u,v] of [[.366,.105],[.405,.083],[.456,.095]]) {
      expect(skyRay(2*u-1,1-2*v).intersectObject(world.root,true)[0]?.object.name).toBe('city-lit cloud base')
    }
    for (const name of ['small cyan center lift sign','thin magenta tenant mast','amber clock floor slot',
      'small cyan mechanical floor datum','east violet vertical sauna blade','east amber upper office cabinet']) {
      const ndc = toScreen(position(name))
      expect(Math.abs(ndc.x)).toBeLessThan(1)
      expect(Math.abs(ndc.y)).toBeLessThan(1)
      expect(skyRay(ndc.x,ndc.y).intersectObject(world.root,true)[0]?.object.parent?.name).toBe(name)
    }
    cameraAtTime(vertical, heroFrameSeconds)
    const tallScreen = toScreen(position(billboard))
    expect(Math.abs(tallScreen.x)).toBeLessThan(.7)
    expect(tallScreen.y).toBeGreaterThan(0)
    expect(tallScreen.y).toBeLessThan(1)
  })

  it('opens the hero skyline on both sides of the screen and separates the east ranks', () => {
    const { master } = config.formats
    const camera = new THREE.PerspectiveCamera()
    applyLens(camera,cameraAt(config.film.heroFrameSeconds,master,anchors),master.width,master.height,{pixel:[0,0],aperture:[0,0]},1)
    world.root.updateMatrixWorld(true)
    const ray = new THREE.Raycaster()
    const hit = (x: number, y: number) => {
      ray.setFromCamera(new THREE.Vector2(2*x-1,1-2*y),camera)
      return ray.intersectObject(world.root,true)[0]!
    }
    for (const x of [.494,.738,.864,.879]) for (const y of [.095,.140,.190,.240]) {
      expect(hit(x,y).object.name,`${x}, ${y}`).toBe('city-lit cloud base')
    }
    const near = hit(.805,.091)
    const far = hit(.924,.025)
    expect(near.object.name).toBe('hero amber tower')
    expect(far.object.name).toBe('far east financial tower')
    expect(far.distance-near.distance).toBeGreaterThan(350)
    const amber = world.root.getObjectByName('hero amber tower volume')!
    const bounds = new THREE.Box3().setFromObject(near.object)
    for (const id of ['west jamb pink opal','east jamb amber opal']) {
      const carriers = amber.getObjectsByProperty('name',`${id} carrier`)
      expect(carriers).toHaveLength(5)
      expect(carriers.every(carrier=>bounds.intersectsBox(new THREE.Box3().setFromObject(carrier)))).toBe(true)
    }
    for (const id of ['amber upper tower cabinet','amber lower tower cabinet']) {
      const back = world.root.getObjectByName(id)!.getObjectByName('cabinet anchor channel')!
      expect(bounds.intersectsBox(new THREE.Box3().setFromObject(back))).toBe(true)
    }
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
    expect(world.signs.filter(s => config.signage.invented.includes(s)).sort()).toEqual(['BRINESCALE SUSHI', 'ORBITAL DINER', 'SALT MOTH', 'SHUTTER HUSH CLUB', 'VAPOR SILL HOTEL'])
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
    const to = (point: THREE.Vector3) => point.clone().sub(service.object.getWorldPosition(new THREE.Vector3()))
    expect(axis(service.object).angleTo(to(anchors.detail.position))).toBeLessThan(service.angle!*(1-service.penumbra!))
    expect(axis(service.object).angleTo(to(new THREE.Vector3(.395,1.044,-.98)))).toBeLessThan(service.angle!)
    expect(axis(service.object).angleTo(to(new THREE.Vector3(.4266,1.0225,-1.1392)))).toBeGreaterThan(service.angle!)
    world.beginSample({ timeSeconds: end } as SampleContext)
    expect(state()).not.toEqual(first)
    expect(service.intensity).toBeGreaterThan(0)
    expect(service.intensity).toBeLessThan(1_100)
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

  it('keeps the wide luminaires out of all camera frusta and retains the macro light cues', () => {
    const poles = ['west nose luminaire','east rim luminaire'].map(name=>world.root.getObjectByName(name)!)
    const lights = ['north deck pole','wheel deck pole'].map(id=>world.lights.find(light=>light.id===id)!)
    const camera = new THREE.PerspectiveCamera()
    const projection = new THREE.Matrix4()
    const frustum = new THREE.Frustum()
    const bounds = poles.map(pole=>new THREE.Box3().setFromObject(pole).expandByScalar(.04))
    const shutterHalf = config.film.shutterDegrees/(720*config.film.fps)
    const wake = config.beats.find(beat=>beat.id==='wake')!
    world.beginFrame({ frame: { timeSeconds: config.film.heroFrameSeconds } } as FrameContext)
    expect(world.lights).toHaveLength(8)
    const rig = new LightRig(world.lights,64)
    const spots = new Map(rig.group.children.filter(o=>o instanceof THREE.SpotLight).map(o=>[o.name,o] as const))
    for (const [i,light] of lights.entries()) {
      expect(light.object.parent?.parent).toBe(poles[i])
      expect(light.object.parent!.children.filter(o=>o.name==='opal LED optic')).toHaveLength(2)
      const y = light.object.getWorldPosition(new THREE.Vector3()).y
      expect(y).toBeGreaterThanOrEqual(6)
      expect(y).toBeLessThanOrEqual(8)
      expect(light.beam && light.shadow).toBe(true)
      const angle = light.angle!
      const flux = light.intensity*candelaPerUnit*2*Math.PI*(1-.5*(Math.cos(angle)+Math.cos(angle*(1-light.penumbra!))))
      expect(flux).toBeGreaterThanOrEqual(15_000)
      expect(flux).toBeLessThanOrEqual(20_000)
      const {r,g,b} = light.color
      const X = .4124*r+.3576*g+.1805*b
      const Y = .2126*r+.7152*g+.0722*b
      const Z = .0193*r+.1192*g+.9505*b
      const n = (X/(X+Y+Z)-.332)/(Y/(X+Y+Z)-.1858)
      const kelvin = -449*n**3+3525*n**2-6823.3*n+5520.33
      expect(kelvin).toBeGreaterThanOrEqual(5000)
      expect(kelvin).toBeLessThanOrEqual(5700)
    }
    world.beginSample({ timeSeconds: wake.end+.007, sample: { frame: { timeSeconds: wake.end-.001 } } } as SampleContext)
    expect(lights.every(light=>light.beam)).toBe(true)
    rig.update(wake.end+.007,[.5,.5])
    for (const light of lights) expect(spots.get(light.id)?.angle).toBeCloseTo(light.angle!,12)
    world.beginSample({ timeSeconds: wake.end-.007, sample: { frame: { timeSeconds: wake.end } } } as SampleContext)
    expect(lights.every(light=>!light.beam)).toBe(true)
    rig.update(wake.end-.007,[.5,.5])
    for (const light of lights) expect(spots.get(light.id)?.angle).toBeCloseTo(light.angle!,12)
    expect(lights[0].object.parent?.name).toBe('rear service flood bank')
    for (const format of [config.formats.master,config.formats.vertical]) {
      for (let i=0;i<=frameCount;i++) {
        const t = i/config.film.fps
        for (const offset of [-shutterHalf,0,shutterHalf]) {
          const state = cameraAt(t+offset,format,anchors,t)
          const clearance = Math.min(...bounds.map(box=>box.distanceToPoint(state.position)))-apertureRadius(state)
          expect(clearance).toBeGreaterThan(.10)
          applyLens(camera,state,format.width,format.height,{pixel:[0,0],aperture:[0,0]},1)
          camera.updateMatrixWorld(true)
          frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse))
          expect(bounds.some(box=>frustum.intersectsBox(box)),format.id+' '+i).toBe(false)
        }
      }
    }
    world.beginFrame({ frame: { timeSeconds: 0 } } as FrameContext)
  })

  it('mounts the north and east tenant surrounds on existing facades and exposes them to the cube', () => {
    world.root.updateMatrixWorld(true)
    const eye = new THREE.Vector3(0,.6,0)
    for (const name of ['north central tower','northeast terrace','east residential tower']) {
      const building = world.root.getObjectByName(name)!
      const facade = building.getObjectByName('lit concourse and tenant bays')!
      const walls = building.children.filter(o=>o.name==='building mass').map(o=>new THREE.Box3().setFromObject(o))
      for (const bracket of facade.children.filter(o=>o.name==='concourse shear bracket')) {
        const bounds = new THREE.Box3().setFromObject(bracket)
        expect(walls.some(wall=>wall.intersectsBox(bounds)),name).toBe(true)
      }
      const panes = facade.getObjectsByProperty('name','ceiling reflected through tenant glass')
      expect(panes).toHaveLength(14)
      const visible = panes.reduce((count,pane) => {
        const target = pane.getWorldPosition(new THREE.Vector3()).sub(eye)
        const length = target.length()
        const ray = new THREE.Raycaster(eye,target.normalize(),0,length+.03)
        return count+Number(ray.intersectObject(world.root,true)[0]?.object===pane)
      },0)
      expect(visible,name).toBeGreaterThanOrEqual(4)
    }
  })

  it('gives the north concourse occupied depth, partial blinds and an anchored plant level', () => {
    world.root.updateMatrixWorld(true)
    const tower = world.root.getObjectByName('north central tower')!
    const facade = tower.getObjectByName('lit concourse and tenant bays')!
    const rooms = facade.getObjectsByProperty('name','tenant room')
    const shadeHeights = new Set<number>()
    expect(rooms).toHaveLength(14)
    let occupied = 0
    for (const room of rooms) {
      const pane = room.getObjectByName('ceiling reflected through tenant glass')!
      const back = room.getObjectByName('recessed tenant wall')!
      const mullion = room.getObjectByName('extruded external mullion')!
      const blind = room.getObjectByName('partly lowered roller blind')!
      expect(pane.position.z-back.position.z).toBeGreaterThan(.6)
      expect(mullion.position.z).toBeGreaterThan(pane.position.z)
      expect(blind.position.z).toBeLessThan(pane.position.z)
      shadeHeights.add(blind.position.y)
      if (!room.getObjectByName('interior suspended task light')) continue
      expect(room.getObjectByName('tenant tabletop')).toBeDefined()
      expect(room.getObjectByName('tenant booth seat')).toBeDefined()
      occupied++
    }
    expect(occupied).toBe(5)
    expect(shadeHeights.size).toBeGreaterThan(8)
    const balcony = facade.getObjectByName('tenant balcony and plant level')!
    expect(balcony.getObjectsByProperty('name','balcony planter trough')).toHaveLength(2)
    const beam = new THREE.Box3().setFromObject(balcony.getObjectByName('balcony anchoring beam')!)
    expect(tower.children.some(o=>o.name==='building mass' && beam.intersectsBox(new THREE.Box3().setFromObject(o)))).toBe(true)
    const master = config.formats.master
    const camera = new THREE.PerspectiveCamera()
    const rear = cameraAt(1060/config.film.fps,master,anchors)
    applyLens(camera,rear,master.width,master.height,{ pixel:[0,0],aperture:[0,0] },1)
    camera.updateMatrixWorld(true)
    const balconyScreen = balcony.getWorldPosition(new THREE.Vector3()).project(camera)
    expect(balconyScreen.x).toBeGreaterThan(-.94)
    expect(balconyScreen.x).toBeLessThan(-.62)
    const sign = world.root.getObjectByName('KARAOKE')!
    expect(sign.getObjectsByProperty('name','inclined box bracket')).toHaveLength(2)
    expect(sign.getObjectsByProperty('name','sign box end cap')).toHaveLength(2)
  })

  it('bolts the rear cyan panels and lightwells into occupied buildings', () => {
    world.root.updateMatrixWorld(true)
    const bounds = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o)
    const overlapsWall = (piece: THREE.Object3D, plot: THREE.Object3D) =>
      plot.children.filter(o=>o.name==='building mass').some(o=>bounds(o).intersectsBox(bounds(piece)))
    for (const [name,carrier] of [
      ['wide cool panel','north sign terrace'],['vertical cool panel','north sign terrace'],
      ['small cool panel','northwest tower'],['corner cool panel','northwest tower'],
    ]) {
      const panel = world.root.getObjectByName(name)!
      expect(panel.parent?.name).toBe(carrier)
      const brackets = panel.getObjectsByProperty('name','cool cabinet steel outrigger')
      expect(brackets).toHaveLength(4)
      expect(brackets.every(bracket=>overlapsWall(bracket,panel.parent!)),name).toBe(true)
    }
    const northwest = world.root.getObjectByName('northwest tower')!
    for (const [name,mount] of [['northwest concourse ribbon','concourse fascia wall plate'],['east glazed concourse return','concourse return standoff']]) {
      const straps = northwest.getObjectByName(name)!.getObjectsByProperty('name',mount)
      expect(straps).toHaveLength(3)
      expect(straps.every(strap=>overlapsWall(strap,northwest)),name).toBe(true)
    }
    for (const id of ['north relay tower','northern court tower']) {
      const tower = world.root.getObjectByName(id)!
      const lightwell = tower.getObjectByName('mounted cyan service lightwell')!
      expect(overlapsWall(lightwell.getObjectByName('lightwell backing fixed into core')!,tower),id).toBe(true)
      const camera = new THREE.PerspectiveCamera()
      const format = config.formats.master
      const point = lightwell.getWorldPosition(new THREE.Vector3())
      for (const frame of [990,1060]) {
        const t = frame/config.film.fps
        const pose = cameraAt(t,format,anchors)
        applyLens(camera,pose,format.width,format.height,{ pixel:[0,0], aperture:[0,0] },1)
        camera.updateMatrixWorld(true)
        const uv = point.clone().project(camera)
        expect(uv.x,id).toBeGreaterThan(-.75)
        expect(uv.x,id).toBeLessThan(.33)
        expect(Math.abs(uv.y),id).toBeLessThan(.90)
        expect(uv.z,id).toBeLessThan(1)
      }
    }
  })

  it('keeps the rear city additions clear of both camera sweeps', () => {
    world.root.updateMatrixWorld(true)
    const names = ['north relay tower','KARAOKE','lit concourse and tenant bays','northwest concourse ribbon',
      'wide cool panel','vertical cool panel','small cool panel','corner cool panel','mounted cyan service lightwell']
    const bounds = names.flatMap(name=>world.root.getObjectsByProperty('name',name)).map(o=>new THREE.Box3().setFromObject(o))
    const shutterHalf = config.film.shutterDegrees/(720*config.film.fps)
    let minimum = Infinity
    for (const format of [config.formats.master,config.formats.vertical]) {
      for (let frame=0;frame<=frameCount;frame++) {
        const t = frame/config.film.fps
        for (const offset of [-shutterHalf,0,shutterHalf]) {
          const pose = cameraAt(t+offset,format,anchors,t)
          const clearance = Math.min(...bounds.map(box=>box.distanceToPoint(pose.position)))-apertureRadius(pose)
          minimum = Math.min(minimum,clearance)
        }
      }
    }
    expect(minimum).toBeGreaterThan(.10)
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
