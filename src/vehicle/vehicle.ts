import * as THREE from 'three'
import { config, type PaintSpec } from '../config'
import { engine as engineCurve, lampThresholds } from '../director/timeline'
import type { Anchor, AnchorId, VehicleModule, VehicleOptions, VehicleState } from './contract'
import { buildBody } from './body/body'
import { lines as rearLines } from './body/tail'
import { dims } from './body/shape'
import { mirrorGeometry } from './geom/mesh'
import { smoothstep, type V3 } from './geom/vec'
import { engineBay } from './parts/enginebay'
import { mirror } from './parts/mirror'
import { underbody, valance } from './parts/diffuser'
import { outlets } from './parts/outlets'
import { taillamps } from './parts/taillamps'
import { guide } from './parts/lamps'
import { buildFront } from './parts/front'
import { buildLiners } from './parts/liners'
import { buildWheels } from './parts/wheel'
import { glazing } from './parts/glass'
import { cabin } from './parts/cabin'
import { sideIntake, throat, upperIntake } from './parts/intake'
import { makeMaterials, type Materials } from './materials'

/**
 * The shot anchors the film was framed on (dev/p3 60c6f12), in metres in the vehicle frame. Each anchor of this body is the
 * closest point of the named part to that position, so every shot keeps its framing while the anchor stays on a real surface.
 */
const filmAnchors: Record<AnchorId, { p: V3; n: V3; r: number }> = {
  paint: { p: [-0.62, 0.976, -1.7], n: [-0.085, 0.989, -0.12], r: 0.32 },
  wheel: { p: [0.9563, 0.3405, 1.2852], n: [1, 0, 0], r: 0.36 },
  lamp: { p: [0.7508, 0.5352, 2.1672], n: [0.7111, 0, 0.7031], r: 0.2 },
  detail: { p: [0.301, 1.008, -1.0389], n: [-0.2285, 0.9725, 0.0438], r: 0.16 },
  exhaust: { p: [0, 0.787, -2.415], n: [0, 0, -1], r: 0.34 },
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
  const sn = new THREE.Vector3()
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
      tri.getBarycoord(c, bary)
      if (nor) {
        na.fromBufferAttribute(nor, ia)
        nb.fromBufferAttribute(nor, ib)
        nc.fromBufferAttribute(nor, ic)
        sn.copy(na.multiplyScalar(bary.x)).addScaledVector(nb, bary.y).addScaledVector(nc, bary.z).applyMatrix3(normalMatrix)
      }
      if (!nor || sn.lengthSq() < 1e-12) tri.getNormal(sn)
      // A surface anchor lands only on a face turned within 60 degrees of the film car's normal, either side: the
      // nearest point can sit on a wall or edge beside the panel, and a camera aimed along that wall's normal sees
      // the wrong side of the part.
      if (useSurfaceNormal && Math.abs(sn.dot(hint)) < 0.5 * sn.length()) continue
      best.d = d
      best.p.copy(c)
      best.n.copy(sn)
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
  const m: Materials = await makeMaterials(options.detail, options.paint)
  const tag = (material: THREE.Material, wetness: Parameters<Materials['tag']>[1]): THREE.Material =>
    m.tag(material as THREE.MeshStandardMaterial, wetness)
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

  const body = buildBody({ maxEdge: 0.04, maxAngle: 0.06, tolerance: 0.0025, edgeLength: 0.012 })
  add(sprung, body.paint, m.paint, 'paint')
  add(sprung, body.gapFloor, m.shell, 'gap-floor')
  const tess = { ...body.grids.main, maxEdge: 0.08, maxAngle: 0.2, tolerance: 0.0025, minEdge: 0.0012, edgeLength: 0.012 }
  const side = glazing(body.surfaces.main, [body.cuts.curves.dlo, body.cuts.curves.rearGlass], tess)
  const screen = glazing(body.surfaces.main, [body.cuts.curves.screen], tess)
  add(sprung, side.panes, m.glass, 'glass')
  add(sprung, screen.panes, m.windscreen, 'glass-screen')
  for (const [i, g] of [side, screen].entries()) {
    add(sprung, g.edges, m.glassEdge, `glass-edge-${i}`)
    add(sprung, g.seals, m.seal, `glass-seal-${i}`)
  }
  for (const [name, c, spec] of [['intake', body.cuts.curves.intake, sideIntake], ['upper-intake', body.cuts.curves.upper, upperIntake]] as const) {
    const t = throat(body.surfaces.main, c, spec)
    addPair(t.wall, m.housing, `${name}-throat`)
    addPair(t.core, m.soot, `${name}-core`)
    addPair(t.louvres, m.mesh, `${name}-louvres`)
  }
  const cab = cabin()
  add(sprung, cab.leather, m.leather, 'cabin-seats')
  add(sprung, cab.trim, m.cabinTrim, 'cabin-trim')
  add(sprung, cab.carbon, m.cabinCarbon, 'cabin-carbon')
  add(sprung, cab.screens, m.screen, 'cabin-screens')
  add(sprung, body.shell, m.shell, 'inner')
  const { cuts } = body
  const S = body.surfaces

  const tl = taillamps(cuts.maps.rear, [cuts.curves.stem, cuts.curves.lampU, cuts.curves.lampL], cuts.curves.lens, cuts.curves.slot, { map: cuts.maps.main, curve: cuts.curves.lampWrap })
  addPair(tl.guide, m.tail, 'tail-guide')
  addPair(tl.housing, m.tailRecess, 'tail-housing')
  addPair(tl.reflector, m.retro, 'tail-reflector')
  addPair(tl.optic, m.tailInner, 'tail-optic')

  // Front module: eyes, Y guides, projectors, ducts, grille and splitter (parts/front.ts).
  // The registry accepts any material; the front module tags its own lens, guide and die finishes.
  const front = buildFront(sprung, cuts, { ...m, tag }, full)

  const ex = outlets(cuts.maps.rear, cuts.curves.surround)
  addPair(ex.lip, m.ceramic, 'outlet-lip')
  addPair(ex.pipes, m.soot, 'outlet-pipe')
  addPair(ex.soot, m.soot, 'outlet-back')
  addPair(ex.housing, m.exhaust, 'outlet-housing')

  const by = engineBay(cuts.curves.bay, full ? 0.012 : 0.02)
  addPair(by.tub, m.matte, 'bay-tub')
  addPair(by.covers, m.covers, 'cam-cover')
  addPair(by.carbon, m.carbon, 'bay-carbon')
  addPair(by.grille, m.mesh, 'bay-grille')
  addPair(by.bezel, m.satin, 'bay-bezel')
  addPair(by.duct, m.soot, 'bay-duct')
  addPair(by.ledge, m.carbon, 'bay-ledge')
  addPair(by.hose, m.seal, 'bay-hose')
  addPair(by.clamp, m.hat, 'bay-clamp')
  add(sprung, by.center, m.covers, 'plenum')
  add(sprung, by.mesh, m.mesh, 'bay-mesh')

  const ub = underbody()
  addPair(ub.floor, m.darkCarbon, 'diffuser')
  addPair(ub.strakes, m.satin, 'diffuser-fin')
  const va = valance(cuts.curves.lower, cuts.maps.rear)
  addPair(va.wall, m.exhaust, 'diffuser-wall')
  addPair(va.panel, m.diffuserMesh, 'diffuser-mesh')
  buildLiners(sprung, S.main, { ...m, tag }, full)
  const mr = mirror(body.surfaces.main, body.cuts.maps.main)
  addPair(mr.head, m.paint, 'mirror-head')
  addPair(mr.glass, m.mirror, 'mirror-glass')
  addPair(mr.stalk, m.matte, 'mirror-stalk')

  buildWheels(root, { ...m, tag }, full)

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
    lamp: snapAnchor(film.lamp, meshes((n) => n === 'front convex projector lenses'), true),
    // The detail beat looks across the left-hand airbox grille. The anchor lands on that grille and keeps the film
    // car's normal: the grille is a field of hex cell walls, and any one wall's normal aims the camera off the panel.
    detail: snapAnchor(film.detail, meshes((n) => n === 'bay-grille-left'), false),
    exhaust: snapAnchor(film.exhaust, meshes((n) => n === 'paint' || n.startsWith('outlet-')), false),
  }

  const lamps: VehicleModule['lamps'] = [...front.lamps]
  const own = new Set<VehicleModule['lamps'][number]>()
  const lampObject = (name: string, p: V3, dir: V3): THREE.Object3D => {
    const o = new THREE.Object3D()
    o.name = name
    o.position.set(...p)
    o.lookAt(p[0] + dir[0], p[1] + dir[1], p[2] + dir[2])
    sprung.add(o)
    return o
  }
  const tailMid = cuts.curves.lampU.p[Math.floor(cuts.curves.lampU.p.length / 2)]
  for (const s of [1, -1]) {
    const tail = { object: lampObject(`tail-${s}`, [s * tailMid[0], tailMid[1], tailMid[2] - 0.01], [0, 0, -1]), stage: lampThresholds.running, beam: false, color: new THREE.Color(1, 0.02, 0.01), intensity: 1 }
    lamps.push(tail)
    own.add(tail)
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
    // Running and tail lamps follow the stage continuously, as the square of it like the front running light, so
    // they come up softly with the ramp and the lamps-off ramp leaves a last faint glow instead of a switch.
    const stage = Math.min(1, Math.max(0, state.lampStage))
    const run = stage * stage
    const beam = ramp(lampThresholds.beamStart, state.lampStage) * (0.3 + 0.7 * smoothstep(lampThresholds.beamStart, lampThresholds.beamFull, state.lampStage))
    const rising = engineCurve(t) > engineCurve(t - 0.02) ? 1 : 0
    const e = Math.min(1, Math.max(0, state.engine))
    const flare = rising * 4 * e * (1 - e)
    const tail = run * (0.6 + 0.4 * flare)
    for (const l of own) l.level = tail
    m.setLevels(run, beam, tail)
    front.update(state.lampStage)
  }
  update({ timeSeconds: 0, lampStage: 0, engine: 0, vibration: 0 })

  return {
    root,
    anchors,
    surfaces: m.surfaces,
    lamps,
    heatSources,
    update,
    setPaint(paint: PaintSpec) {
      m.setPaint(paint)
    },
  }
}

/** Scale that brings the body shell (paint, glass and backing) to the factory length, width and height. Parts fitted to it do not change it. */
function fitScale(sprung: THREE.Object3D): V3 {
  const shell = new Set(['paint', 'inner'])
  const box = new THREE.Box3()
  const p = new THREE.Vector3()
  sprung.updateWorldMatrix(true, true)
  sprung.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !shell.has(o.name)) return
    const pos = o.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) box.expandByPoint(p.fromBufferAttribute(pos, i))
  })
  return [dims.width / (box.max.x - box.min.x), dims.height / box.max.y, dims.length / (box.max.z - box.min.z)]
}

