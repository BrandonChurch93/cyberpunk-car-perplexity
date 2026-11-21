import * as THREE from 'three'
import { config, type PaintSpec } from '../config'
import { engine as engineCurve, lampThresholds } from '../director/timeline'
import type { Anchor, AnchorId, VehicleModule, VehicleOptions, VehicleState, WetnessKind } from './contract'
import { buildBody } from './body/body'
import { rearLines } from './body/lines'
import { dims } from './body/shape'
import { mirrorGeometry } from './geom/mesh'
import { smoothstep, type V3 } from './geom/vec'
import { bay } from './parts/bay'
import { diffuser, floor, liner, mirror, splitter } from './parts/chassis'
import { exhaust, guide, projectorGeometry, projectors } from './parts/lamps'
import { buildWheel, type WheelSpec } from './parts/wheel'
import { makeMaterials, type Materials } from './materials'

/**
 * The shot anchors the film was framed on (dev/p3 60c6f12), in metres in the vehicle frame. Each anchor of this body is the
 * closest point of the named part to that position, so every shot keeps its framing while the anchor stays on a real surface.
 */
const filmAnchors: Record<AnchorId, { p: V3; n: V3; r: number }> = {
  paint: { p: [0.9799, 0.7533, 1.55], n: [0.9971, 0.0623, 0.0433], r: 0.32 },
  wheel: { p: [0.9563, 0.3405, 1.2852], n: [1, 0, 0], r: 0.36 },
  lamp: { p: [0.7508, 0.5352, 2.1672], n: [0.7111, 0, 0.7031], r: 0.2 },
  detail: { p: [-0.301, 1.008, -1.0389], n: [0.2285, 0.9725, 0.0438], r: 0.16 },
  exhaust: { p: [0, 0.79, -2.4208], n: [0, 0, -1], r: 0.34 },
}

/**
 * The closest point of `parts` to the target and, when `surfaceNormal` is set, the shading normal there, turned to the
 * side the target normal faces. Otherwise the target's normal is kept (a wheel axis, an outlet axis).
 */
function snapAnchor(target: { p: V3; n: V3; r: number }, parts: THREE.Mesh[], useSurfaceNormal: boolean): Anchor {
  const q = new THREE.Vector3(...target.p)
  const hint = new THREE.Vector3(...target.n).normalize()
  const tri = new THREE.Triangle()
  const c = new THREE.Vector3()
  const bary = new THREE.Vector3()
  const na = new THREE.Vector3()
  const nb = new THREE.Vector3()
  const nc = new THREE.Vector3()
  const best = { d: Infinity, p: new THREE.Vector3(), n: new THREE.Vector3() }
  for (const mesh of parts) {
    const pos = mesh.geometry.getAttribute('position')
    const nor = mesh.geometry.getAttribute('normal')
    const idx = mesh.geometry.getIndex()
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)
    const count = idx ? idx.count : pos.count
    for (let i = 0; i < count; i += 3) {
      const ia = idx ? idx.getX(i) : i
      const ib = idx ? idx.getX(i + 1) : i + 1
      const ic = idx ? idx.getX(i + 2) : i + 2
      tri.a.fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld)
      tri.b.fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld)
      tri.c.fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld)
      if (tri.getArea() < 1e-12) continue
      tri.closestPointToPoint(q, c)
      const d = c.distanceToSquared(q)
      if (d >= best.d) continue
      best.d = d
      best.p.copy(c)
      tri.getBarycoord(c, bary)
      if (nor) {
        na.fromBufferAttribute(nor, ia)
        nb.fromBufferAttribute(nor, ib)
        nc.fromBufferAttribute(nor, ic)
        best.n.copy(na.multiplyScalar(bary.x)).addScaledVector(nb, bary.y).addScaledVector(nc, bary.z).applyMatrix3(normalMatrix)
      }
      if (!nor || best.n.lengthSq() < 1e-12) tri.getNormal(best.n)
    }
  }
  const normal = useSurfaceNormal ? best.n.normalize() : hint.clone()
  if (normal.dot(hint) < 0) normal.negate()
  return { position: best.p.clone(), normal, radius: target.r }
}

const ramp = (from: number, x: number): number => smoothstep(from, from + 0.05, x)

/** Both sides of a left side part. */
function pair(g: THREE.BufferGeometry): THREE.BufferGeometry[] {
  return [g, mirrorGeometry(g)]
}

export async function buildVehicle(options: VehicleOptions): Promise<VehicleModule> {
  const full = options.detail === 'full'
  const q = full ? 1 : 0.5
  const m: Materials = await makeMaterials(options.detail, options.paint)
  const root = new THREE.Group()
  root.name = 'vehicle'
  const sprung = new THREE.Group()
  sprung.name = 'sprung'
  root.add(sprung)
  const add = (parent: THREE.Object3D, g: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh => {
    const mesh = new THREE.Mesh(g, mat)
    mesh.name = name
    parent.add(mesh)
    return mesh
  }
  const addPair = (g: THREE.BufferGeometry, mat: THREE.Material, name: string): void => {
    for (const [i, x] of pair(g).entries()) add(sprung, x, mat, `${name}-${i ? 'right' : 'left'}`)
  }

  void full
  const body = buildBody({ maxEdge: 0.08, maxAngle: 0.2, tolerance: 0.0025, edgeLength: 0.007 })
  add(sprung, body.paint, m.paint, 'paint')
  add(sprung, body.glass, m.glass, 'glass')
  add(sprung, body.shell, m.shell, 'inner')
  const { cuts } = body
  const S = body.surfaces

  for (const [name, c] of [
    ['drl-upper', cuts.curves.drlU],
    ['drl-lower', cuts.curves.drlL],
    ['drl-stem', cuts.curves.drlS],
  ] as const) addPair(guide(S.front, c, 0.004, 0.014, 0.006), m.drl, name)
  for (const [name, c] of [
    ['tail-upper', cuts.curves.lampU],
    ['tail-lower', cuts.curves.lampL],
    ['tail-chevron', cuts.curves.chev],
  ] as const) addPair(guide(S.rear, c, 0.004, 0.012, 0.006), m.tail, name)

  const projs = projectors(cuts.maps.front)
  const pg = projectorGeometry(projs)
  addPair(pg.lens, m.beamLens, 'projector-lens')
  addPair(pg.body, m.housing, 'projector-body')

  const ex = exhaust(cuts.maps.rear, rearLines.exhaust)
  addPair(ex.lip, m.ceramic, 'outlet-lip')
  addPair(ex.pipes, m.soot, 'outlet-pipe')
  addPair(ex.soot, m.soot, 'outlet-back')

  const by = bay(cuts.curves.bay, full ? 0.012 : 0.02)
  addPair(by.tub, m.matte, 'bay-tub')
  addPair(by.covers, m.covers, 'cam-cover')
  addPair(by.carbon, m.carbon, 'bay-carbon')
  add(sprung, by.center, m.carbon, 'plenum')
  add(sprung, by.mesh, m.mesh, 'bay-mesh')

  addPair(floor(), m.under, 'floor')
  const df = diffuser(-dims.halfLength)
  addPair(df.roof, m.under, 'diffuser')
  addPair(df.fins, m.carbon, 'diffuser-fin')
  const edge: V3[] = []
  for (let i = 0; i <= 40; i++) edge.push(S.front(i / 40, 0))
  addPair(splitter(edge), m.carbon, 'splitter')
  addPair(liner(dims.frontHubZ, dims.frontTire.radius, 0.415, 0.5, 0.99), m.under, 'liner-front')
  addPair(liner(dims.rearHubZ, dims.rearTire.radius, 0.44, 0.5, 1.01), m.under, 'liner-rear')
  const mr = mirror()
  addPair(mr.head, m.paint, 'mirror-head')
  addPair(mr.glass, m.mirror, 'mirror-glass')
  addPair(mr.stalk, m.matte, 'mirror-stalk')

  const wheelSpec = (front: boolean): WheelSpec => {
    const t = front ? dims.frontTire : dims.rearTire
    return {
      radius: t.radius,
      width: t.width,
      rim: t.rim,
      disc: front ? { radius: 0.205, thickness: 0.038 } : { radius: 0.195, thickness: 0.032 },
      flat: 0.008,
      caliperAngle: front ? Math.PI - 0.35 : 0.35,
      caliperLength: front ? 1.0 : 0.85,
      quality: q,
    }
  }
  for (const front of [true, false]) {
    const spec = wheelSpec(front)
    const w = buildWheel(spec)
    const hubX = front ? dims.frontHubX : dims.rearHubX
    const hubZ = front ? dims.frontHubZ : dims.rearHubZ
    const hubY = spec.radius - spec.flat
    for (const side of [1, -1]) {
      const g = new THREE.Group()
      g.name = `wheel-${front ? 'front' : 'rear'}-${side > 0 ? 'left' : 'right'}`
      g.position.set(side * hubX, hubY, hubZ)
      const geo = (x: THREE.BufferGeometry): THREE.BufferGeometry => (side > 0 ? x : mirrorGeometry(x))
      add(g, geo(w.tire), m.tire, 'tire')
      add(g, geo(w.rim), m.rim, 'rim')
      add(g, geo(w.disc), m.disc, 'disc')
      add(g, geo(w.hat), m.hat, 'disc-hat')
      add(g, geo(w.caliper), m.caliper, 'caliper')
      root.add(g)
    }
  }

  root.traverse((o) => {
    o.castShadow = true
    o.receiveShadow = true
  })
  const fit = fitScale(sprung)
  sprung.scale.set(fit[0], fit[1], fit[2])

  root.updateWorldMatrix(true, true)
  const meshes = (test: (name: string, parent: string) => boolean): THREE.Mesh[] => {
    const out: THREE.Mesh[] = []
    root.traverse((o) => {
      if (o instanceof THREE.Mesh && test(o.name, o.parent?.name ?? '')) out.push(o)
    })
    return out
  }
  const film = filmAnchors
  const anchors = {
    paint: snapAnchor(film.paint, meshes((n) => n === 'paint'), true),
    wheel: snapAnchor(film.wheel, meshes((n, g) => g === 'wheel-front-left' && (n === 'rim' || n === 'disc-hat')), false),
    lamp: snapAnchor(film.lamp, meshes((n) => n === 'projector-lens-left'), true),
    detail: snapAnchor(film.detail, meshes((n) => n.startsWith('bay-') || n.startsWith('cam-cover') || n === 'plenum'), true),
    exhaust: snapAnchor(film.exhaust, meshes((n) => n === 'paint' || n.startsWith('outlet-')), false),
  }

  const lamps: VehicleModule['lamps'] = []
  const lampObject = (name: string, p: V3, dir: V3): THREE.Object3D => {
    const o = new THREE.Object3D()
    o.name = name
    o.position.set(...p)
    o.lookAt(p[0] + dir[0], p[1] + dir[1], p[2] + dir[2])
    sprung.add(o)
    return o
  }
  const drlNode = cuts.curves.drlS.p[0]
  const tailMid = cuts.curves.lampU.p[Math.floor(cuts.curves.lampU.p.length / 2)]
  const main = projs[0].lens
  for (const s of [1, -1]) {
    lamps.push({ object: lampObject(`drl-${s}`, [s * drlNode[0], drlNode[1], drlNode[2] + 0.01], [0, 0, 1]), stage: lampThresholds.running, beam: false, color: new THREE.Color(0.86, 0.92, 1), intensity: 4 })
    lamps.push({ object: lampObject(`beam-${s}`, [s * main[0], main[1], main[2] + 0.02], [s * 0.02, -0.02, 1]), stage: lampThresholds.beamStart, beam: true, color: new THREE.Color(1, 0.96, 0.9), intensity: 250 })
    lamps.push({ object: lampObject(`tail-${s}`, [s * tailMid[0], tailMid[1], tailMid[2] - 0.01], [0, 0, -1]), stage: lampThresholds.running, beam: false, color: new THREE.Color(1, 0.02, 0.01), intensity: 1 })
  }
  const heatSources = [1, -1].map((s) => {
    const o = new THREE.Object3D()
    o.name = `outlet-heat-${s > 0 ? 'left' : 'right'}`
    o.position.set(s * ex.center[0], ex.center[1], ex.center[2])
    sprung.add(o)
    return { object: o, strength: 1 }
  })

  const period = config.film.durationSeconds
  const f1 = Math.round(23 * period) / period
  const f2 = Math.round(31 * period) / period
  const update = (state: VehicleState): void => {
    const t = state.timeSeconds
    const a = 0.0015 * state.vibration
    sprung.position.y = a * (0.7 * Math.sin(2 * Math.PI * f1 * t) + 0.3 * Math.sin(2 * Math.PI * f2 * t + 1.3))
    sprung.rotation.z = a * 0.4 * Math.sin(2 * Math.PI * f2 * t)
    const run = ramp(lampThresholds.running, state.lampStage)
    const beam = ramp(lampThresholds.beamStart, state.lampStage) * (0.3 + 0.7 * smoothstep(lampThresholds.beamStart, lampThresholds.beamFull, state.lampStage))
    const rising = engineCurve(t) > engineCurve(t - 0.02) ? 1 : 0
    const e = Math.min(1, Math.max(0, state.engine))
    const flare = rising * 4 * e * (1 - e)
    const tail = run * (0.6 + 0.4 * flare)
    for (const l of lamps) l.level = l.beam ? beam : l.color && l.color.g < 0.1 ? tail : run
    m.setLevels(run, beam, tail)
  }
  update({ timeSeconds: 0, lampStage: 0, engine: 0, vibration: 0 })

  const surfaces: Array<{ material: THREE.Material; wetness: WetnessKind }> = [
    { material: m.paint, wetness: 'beads' },
    { material: m.glass, wetness: 'beads' },
    { material: m.carbon, wetness: 'beads' },
    { material: m.beamLens, wetness: 'beads' },
    { material: m.drl, wetness: 'beads' },
    { material: m.tail, wetness: 'beads' },
    { material: m.mirror, wetness: 'beads' },
    { material: m.tire, wetness: 'sheet' },
    { material: m.matte, wetness: 'sheet' },
    { material: m.covers, wetness: 'sheet' },
    { material: m.mesh, wetness: 'sheet' },
    { material: m.rim, wetness: 'sheet' },
    { material: m.ceramic, wetness: 'sheet' },
    { material: m.shell, wetness: 'none' },
    { material: m.under, wetness: 'none' },
    { material: m.housing, wetness: 'none' },
    { material: m.soot, wetness: 'none' },
    { material: m.disc, wetness: 'none' },
    { material: m.hat, wetness: 'none' },
    { material: m.caliper, wetness: 'none' },
  ]
  return {
    root,
    anchors,
    surfaces,
    lamps,
    heatSources,
    update,
    setPaint(paint: PaintSpec) {
      m.setPaint(paint)
    },
  }
}

/** Scale that brings the sprung body, mirrors aside, to the factory length, width and height. */
function fitScale(sprung: THREE.Object3D): V3 {
  const box = new THREE.Box3()
  const p = new THREE.Vector3()
  sprung.updateWorldMatrix(true, true)
  sprung.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.name.startsWith('mirror')) return
    const pos = o.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) box.expandByPoint(p.fromBufferAttribute(pos, i))
  })
  return [dims.width / (box.max.x - box.min.x), dims.height / box.max.y, dims.length / (box.max.z - box.min.z)]
}

