import * as THREE from 'three'
import { config, type PaintSpec } from '../config'
import { engine as engineCurve, lampThresholds } from '../director/timeline'
import type { Anchor, VehicleModule, VehicleOptions, VehicleState, WetnessKind } from './contract'
import { buildBody, surfaceNormal } from './body/body'
import { frontLines, rearLines } from './body/lines'
import { dims, mainDef } from './body/shape'
import { mirrorGeometry } from './geom/mesh'
import { norm, smoothstep, type V3 } from './geom/vec'
import { bay } from './parts/bay'
import { diffuser, floor, liner, mirror, splitter } from './parts/chassis'
import { exhaust, guide, onFace, projectorGeometry, projectors } from './parts/lamps'
import { buildWheel, type WheelSpec } from './parts/wheel'
import { makeMaterials, type Materials } from './materials'

function anchor(p: V3, n: V3, r: number): Anchor {
  return { position: new THREE.Vector3(...p), normal: new THREE.Vector3(...n).normalize(), radius: r }
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

  const body = full
    ? buildBody({ maxEdge: 0.025, maxAngle: 0.06, tolerance: 0.0003, edgeLength: 0.0025 })
    : buildBody({ maxEdge: 0.08, maxAngle: 0.2, tolerance: 0.0025, edgeLength: 0.007 })
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
  let wheelFace: V3 = [0, 0, 0]
  for (const front of [true, false]) {
    const spec = wheelSpec(front)
    const w = buildWheel(spec)
    const hubX = front ? dims.frontHubX : dims.rearHubX
    const hubZ = front ? dims.frontHubZ : dims.rearHubZ
    const hubY = spec.radius - spec.flat
    if (front) wheelFace = [hubX + w.face[0], hubY, hubZ]
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

  const shoulder = 3
  const vC = mainDef.vAt[shoulder]
  const uPaint = uForZ(S.main, 1.06, vC)
  const pPaint = S.main(uPaint, vC)
  const nPaint = norm(add3(surfaceNormal(S.main, uPaint, vC - 0.004), surfaceNormal(S.main, uPaint, vC + 0.004)))
  const [lx, ly] = elevCenter(frontLines.eye)
  const lens = onFace(cuts.maps.front, 'z', lx, ly)
  const detailCenter = detailPoint(by)
  const anchors = {
    paint: anchor(pPaint, nPaint, 0.12),
    wheel: anchor(wheelFace, [1, 0, 0], dims.frontTire.radius),
    lamp: anchor(lens.p, lens.n, 0.12),
    detail: anchor(detailCenter, [0, 1, 0], 0.45),
    exhaust: anchor([0, ex.center[1], ex.center[2]], [0, 0, -1], 0.2),
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

function add3(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function uForZ(S: (u: number, v: number) => V3, z: number, v: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (S(mid, v)[2] > z) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

function elevCenter(pts: Array<[number, number]>): [number, number] {
  let x = 0
  let y = 0
  for (const p of pts) {
    x += p[0] / pts.length
    y += p[1] / pts.length
  }
  return [x, y]
}

function detailPoint(b: ReturnType<typeof bay>): V3 {
  const pos = b.center.getAttribute('position')
  let top = -Infinity
  let zc = 0
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getX(i)) < 0.01 && pos.getY(i) > top) {
      top = pos.getY(i)
      zc = pos.getZ(i)
    }
  }
  return [0, top, zc]
}
