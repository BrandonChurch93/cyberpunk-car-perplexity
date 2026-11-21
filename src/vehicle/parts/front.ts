import * as T from 'three'
import { lampThresholds } from '../../director/timeline'
import type { BodyCuts } from '../body/cuts'
import { fasciaReturn, fasciaThroat, fasciaUV, guideProfile, guideWidth } from '../body/nose'
import type { VehicleModule, WetnessKind } from '../contract'
import type { Surface, SurfaceCurve, SurfaceMap } from '../geom/cuts'
import { MeshBuilder, mirrorGeometry } from '../geom/mesh'
import type { V2, V3 } from '../geom/vec'
import { floorY } from './diffuser'
import { forward, guideOptics, projectorOptics, projectorParts } from './front-optics'

type FrontMaterials = Pick<import('../materials').Materials, 'housing' | 'mesh' | 'carbon' | 'drl' | 'beamLens'> & {
  optics?: T.Material
  projector?: T.Material
  brushed?: T.Material
  reflector?: T.Material
  tag?: (material: T.Material, wetness: WetnessKind) => T.Material
}

const vector = (p: V3) => new T.Vector3(...p)
const average = (ps: T.Vector3[]) => ps.reduce((sum, p) => sum.add(p), new T.Vector3()).multiplyScalar(1 / ps.length)
const signedArea = (ps: T.Vector3[]) => T.ShapeUtils.area(ps.map(p => new T.Vector2(p.x, p.y)))

function grid(rows: T.Vector3[][], flip = false, ring = false): T.BufferGeometry {
  const builder = new MeshBuilder()
  builder.grid(rows.length, rows[0].length, (i, j) => ({ p: rows[i][j].toArray(), n: [0, 0, 0] }), ring, flip)
  const g = builder.geometry()
  g.computeVertexNormals()
  return g
}

function append(builder: MeshBuilder, g: T.BufferGeometry): void {
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv'), idx = g.index
  const base = builder.pos.length / 3
  for (let i = 0; i < p.count; i++) {
    builder.vertex([p.getX(i), p.getY(i), p.getZ(i)], [n.getX(i), n.getY(i), n.getZ(i)], uv?.getX(i), uv?.getY(i))
  }
  for (let i = 0; i < (idx?.count ?? p.count); i += 3) {
    builder.tri(base + (idx?.getX(i) ?? i), base + (idx?.getX(i + 1) ?? i + 1), base + (idx?.getX(i + 2) ?? i + 2))
  }
}

function merged(parts: T.BufferGeometry[]): T.BufferGeometry {
  const b = new MeshBuilder()
  for (const g of parts) {
    append(b, g)
    g.dispose()
  }
  return b.geometry()
}

function compactSurface(g: T.BufferGeometry): T.BufferGeometry {
  const p = g.getAttribute('position'), idx = g.index
  const count = idx?.count ?? p.count
  const remap = new Int32Array(p.count).fill(-1)
  const vertices: number[] = []
  const valid: number[] = []
  const groups = g.groups.map(({ start, count, materialIndex }) => ({ start, end: start + count, materialIndex }))
  let group = 0, groupStart = 0
  g.clearGroups()
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3()
  for (let i = 0; i < count; i += 3) {
    if (i === groups[group]?.end) {
      g.addGroup(groupStart, valid.length - groupStart, groups[group].materialIndex)
      groupStart = valid.length
      group++
    }
    const j = idx?.getX(i) ?? i, k = idx?.getX(i + 1) ?? i + 1, l = idx?.getX(i + 2) ?? i + 2
    a.fromBufferAttribute(p, j)
    b.fromBufferAttribute(p, k).sub(a)
    c.fromBufferAttribute(p, l).sub(a)
    if (!(b.cross(c).lengthSq() > 1e-20)) continue
    for (const v of [j, k, l]) {
      if (remap[v] < 0) {
        remap[v] = vertices.length
        vertices.push(v)
      }
      valid.push(remap[v])
    }
  }
  if (groups[group]) g.addGroup(groupStart, valid.length - groupStart, groups[group].materialIndex)
  if (valid.length === count && vertices.length === p.count) return g
  for (const [name, attr] of Object.entries(g.attributes)) {
    const data = attr.array.slice(0, vertices.length * attr.itemSize)
    for (const [i, v] of vertices.entries()) {
      const start = v * attr.itemSize
      data.set(attr.array.subarray(start, start + attr.itemSize), i * attr.itemSize)
    }
    g.setAttribute(name, new T.BufferAttribute(data, attr.itemSize, attr.normalized))
  }
  g.setIndex(valid)
  return g
}

function outline(curve: SurfaceCurve, acrossCenter = false): T.Vector3[] {
  let ps = curve.p.map(vector)
  if (acrossCenter) {
    const p = ps.findIndex(q => q.x < 1e-5)
    if (p >= 0) ps = ps.slice(p).concat(ps.slice(0, p))
    while (ps.length > 2 && ps[1].x < 1e-5) ps.shift()
    while (ps.length > 2 && ps.at(-1)!.x < 1e-5 && ps.at(-2)!.x < 1e-5) ps.pop()
    const other = [...ps].reverse().filter(q => q.x >= 1e-5).map(q => new T.Vector3(-q.x, q.y, q.z))
    ps.push(...other)
  }
  return signedArea(ps) < 0 ? ps.reverse() : ps
}

function face(outer: T.Vector3[], depth = 0): T.BufferGeometry {
  // Triangulate at GPU precision so nearly collinear stations cannot fold after packing.
  const contour = outer.map(p => new T.Vector2(Math.fround(p.x), Math.fround(p.y)))
  const b = new MeshBuilder()
  for (const p of outer) b.vertex([p.x, p.y, p.z - depth], [0, 0, 1])
  for (const [a, c, d] of T.ShapeUtils.triangulateShape(contour, [])) {
    const p = contour[a], q = contour[c], r = contour[d]
    if ((q.x - p.x) * (r.y - p.y) > (r.x - p.x) * (q.y - p.y)) b.tri(a, c, d)
  }
  const g = compactSurface(b.geometry())
  g.computeVertexNormals()
  return g
}

function chamber(loop: T.Vector3[], depth: number, taper: number, slope: number, setback: number,
  shared?: NonNullable<ReturnType<typeof fasciaThroat>>) {
  const center = average(loop)
  const throat = (p: T.Vector3) => {
    const x = T.MathUtils.lerp(center.x, p.x, taper)
    return new T.Vector3(x, T.MathUtils.lerp(center.y, p.y, taper), center.z - depth + slope * (Math.abs(x) - Math.abs(center.x)))
  }
  const blend = .18
  const at = (t: number) => loop.map((p, i) => {
    const q = throat(p)
    const point = p.clone().lerp(q, t).addScaledVector(forward, -setback * (1 - t))
    if (shared && t < blend) {
      const direction = vector(shared[i].inward).multiplyScalar(p.distanceTo(q)).sub(q).add(p)
      point.addScaledVector(direction, t * (1 - t / blend) ** 2)
    }
    return point
  })
  const rings = [0, .022, .07, .12, blend, .44, .72, 1].map(at)
  const wall = grid(rings, false, true)
  const normals = wall.getAttribute('normal')
  shared?.forEach(({ normal }, i) => normals.setXYZ(i, ...normal))
  return { wall, throat: rings.at(-1)!, center: center.z - depth }
}

function grille(throat: T.Vector3[], frontZ: number, full: boolean): T.BufferGeometry {
  const outer = throat.filter((_, i) => i % 4 === 0).map(p => new T.Vector2(p.x, p.y))
  const bounds = new T.Box2().setFromPoints(outer)
  const holes: T.Vector2[][] = []
  const pitch = full ? .019 : .024, land = full ? .0014 : .0018
  const r = (pitch - land) / Math.sqrt(3), dy = pitch * Math.sqrt(3) / 2
  const outlineShape = new T.Shape(outer)
  const inset = (v: T.Vector2) => {
    let inside = false
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const a = outer[j], b = outer[i]
      const edge = b.clone().sub(a), local = v.clone().sub(a)
      const along = T.MathUtils.clamp(local.dot(edge) / Math.max(1e-12, edge.lengthSq()), 0, 1)
      if (local.addScaledVector(edge, -along).lengthSq() < land * land) return false
      if ((a.y > v.y) !== (b.y > v.y) && v.x < a.x + (v.y - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside
    }
    return inside
  }
  for (let row = 0; bounds.min.y + row * dy < bounds.max.y; row++) {
    const y = bounds.min.y + row * dy
    for (let x = (row % 2) * pitch / 2; x < bounds.max.x + pitch; x += pitch) {
      for (const sign of x === 0 ? [1] : [-1, 1]) {
        const hex = Array.from({ length: 6 }, (_, i) => {
          const a = (i + .5) * Math.PI / 3
          return new T.Vector2(sign * x + r * Math.cos(a), y + r * Math.sin(a))
        })
        if (hex.every(inset)) holes.push(hex)
      }
    }
  }
  outlineShape.holes = holes.map(h => new T.Path(h))
  const g = new T.ExtrudeGeometry(outlineShape, { steps: 1, depth: .008, bevelEnabled: false, curveSegments: 1 })
  return compactSurface(g.translate(0, 0, frontZ - .008))
}

function radiator(throat: T.Vector3[], full: boolean): T.BufferGeometry {
  const points = [...throat, throat[0]], rows = full ? 20 : 11
  const box = new T.Box3().setFromPoints(throat)
  const fins: T.BufferGeometry[] = []
  for (let row = 0; row < rows; row++) {
    const y = T.MathUtils.lerp(box.min.y, box.max.y, (row + .5) / rows)
    const section: T.Vector3[] = []
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i]
      if ((a.y > y) !== (b.y > y)) section.push(a.clone().lerp(b, (y - a.y) / (b.y - a.y)))
    }
    if (section.length < 2) continue
    section.sort((a, b) => a.x - b.x)
    const a = section[0], b = section.at(-1)!
    if (b.x - a.x < .008) continue
    const g = new T.BoxGeometry(Math.hypot(b.x - a.x, b.z - a.z) - .005, .0032, .019)
    g.rotateY(Math.atan2(a.z - b.z, b.x - a.x)).translate((a.x + b.x) / 2, y, (a.z + b.z) / 2 - .015)
    fins.push(g)
  }
  return merged(fins)
}

function radiatorSeat(throat: T.Vector3[]): T.BufferGeometry {
  const center = average(throat)
  const edge = throat.map(p => p.clone().lerp(center, .08))
  const inner = edge.map(p => p.clone().addScaledVector(forward, -.016))
  return grid([throat, edge, inner], false, true)
}

function cover(loop: T.Vector3[], map: SurfaceMap, full: boolean): T.BufferGeometry {
  const center = average(loop), count = full ? 12 : 6
  const edgeDepth = loop.map(p => p.z - .002 - map.S(...fasciaUV(map, p.x, p.y))[2])
  const rows = Array.from({ length: count }, (_, i) => {
    const t = (count - i) / count
    return loop.map((p, j) => {
      const q = center.clone().lerp(p, t)
      q.z = map.S(...fasciaUV(map, q.x, q.y))[2] + T.MathUtils.lerp(-.004, edgeDepth[j], t * t)
      return q
    })
  })
  return merged([grid(rows, false, true), face(rows.at(-1)!)])
}

function guide(map: SurfaceMap, radius: number, depth: number, crown: number): T.BufferGeometry {
  const arms = guideProfile(radius)
  const point = ([x, y]: V2, rise = 0) => new T.Vector3(x, y, map.S(...fasciaUV(map, x, y))[2] - depth + rise)
  const blend = (a: V2, b: V2, t: number): V2 => [T.MathUtils.lerp(a[0], b[0], t), T.MathUtils.lerp(a[1], b[1], t)]
  const across = (a: V2, b: V2, bulge: number) => Array.from({ length: 5 }, (_, j) => {
    const t = j / 4
    return point(blend(a, b, t), bulge * (4 * t * (1 - t)))
  })
  const parts = [face(arms.flatMap(({ base }) => across(...base, 0).slice(0, -1)))]
  for (const { base: [a, b], tip, cap } of arms) {
    const c = cap[0], d = cap.at(-1)!
    const mid = blend(a, b, .5)
    const count = Math.max(2, Math.ceil(Math.hypot(tip[0] - mid[0], tip[1] - mid[1]) / .007))
    const rows = Array.from({ length: count + 1 }, (_, i) => {
      const t = i / count
      return across(blend(a, c, t), blend(b, d, t), crown * Math.min(1, 4 * t))
    })
    parts.push(grid(rows, true))
    const builder = new MeshBuilder()
    const axis = Math.hypot(tip[0] - mid[0], tip[1] - mid[1])
    const inside = builder.vertex(point(blend(mid, tip, 1 + .4 * radius / axis), .8 * crown).toArray(), [0, 0, 1])
    const ring = [...cap.map(q => point(q)), ...rows.at(-1)!.slice(1, -1).reverse()]
    const ids = ring.map(q => builder.vertex(q.toArray(), [0, 0, 1]))
    for (let i = 0; i < ids.length; i++) builder.tri(inside, ids[i], ids[(i + 1) % ids.length])
    const g = builder.geometry()
    g.computeVertexNormals()
    parts.push(g)
  }
  return merged(parts)
}

function reflectorReturns(g: T.BufferGeometry): T.BufferGeometry {
  if (!(g instanceof T.LatheGeometry) || !g.index) throw new Error('Expected an indexed projector reflector')
  const points = g.parameters.points
  const wall: number[] = [], steps: number[] = []
  for (let i = 0; i < g.index.count; i += 6) {
    const j = (i / 6) % (points.length - 1)
    const destination = points[j + 1].x < points[j].x && points[j + 1].y > points[j].y ? steps : wall
    for (let k = 0; k < 6; k++) destination.push(g.index.getX(i + k))
  }
  const returns = g.clone().setIndex(steps)
  g.setIndex(wall)
  compactSurface(returns).computeVertexNormals()
  return returns
}

function lensRetainers(center: T.Vector3, axis: T.Vector3, radius: number): T.BufferGeometry {
  const rotation = new T.Quaternion().setFromUnitVectors(forward, axis)
  return merged(Array.from({ length: 4 }, (_, i) =>
    new T.BoxGeometry(radius * .14, radius * .045, .00055)
      .translate(0, radius * .973, 0)
      .rotateZ((i + .5) * Math.PI / 2)
      .scale(1, .84, 1).applyQuaternion(rotation).translate(...center.toArray())))
}

function splitter(S: Surface, full: boolean): T.BufferGeometry {
  const count = full ? 72 : 36, end = Math.max(S(0, 0)[2], S(0, 1)[2]) - .001
  const positions = Array.from({ length: 2 * count + 1 }, (_, i) => {
    const u = (i - count) / count
    const [x, y, z] = S(Math.abs(u), 0)
    return new T.Vector3(Math.sign(u) * x, y, z)
  })
  const rolls = [[-.015, .004], [.038, .002], [.057, 0], [.064, -.004],
    [.066, -.009], [.062, -.014], [.045, -.019]]
  const rows = positions.map((p, i) => rolls.map(([dz, dy]) => {
    const t = Math.abs(i - count) / count
    const tip = p.z + dz * (dz > 0 ? 1 - T.MathUtils.smoothstep(t, .89, 1) : 1)
    const z = dz > 0 ? (tip + end - Math.hypot(tip - end, .006)) / 2 : tip
    return new T.Vector3(p.x, p.y + dy, z)
  }))
  for (const [i, p] of positions.entries()) {
    const x = .44 * p.x, z = Math.min(2.265, p.z - .13)
    const t = Math.abs(i - count) / count
    const y = T.MathUtils.lerp(floorY - .001, p.y - .022, T.MathUtils.smoothstep(t, .55, 1))
    rows[i].push(new T.Vector3(p.x, y, p.z - .018))
    rows[i].unshift(new T.Vector3(x, floorY + .006, z))
    rows[i].push(new T.Vector3(x, floorY - .001, z))
  }
  const caps = [rows[0], rows.at(-1)!].map((ps, i) => face(ps.map(p => new T.Vector3(p.z * (i ? -1 : 1), p.y, 0)))
    .rotateY(i ? Math.PI / 2 : -Math.PI / 2).translate(ps[0].x, 0, 0))
  const geometry = merged([grid(rows, false, true), ...caps])
  const p = geometry.getAttribute('position'), uv = geometry.getAttribute('uv')
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 2, p.getZ(i) / 2)
  return geometry
}

export function buildFront(parent: T.Object3D, cuts: BodyCuts, m: FrontMaterials, full: boolean) {
  const add = (name: string, g: T.BufferGeometry, material: T.Material, pair = false) => {
    const install = (name: string, geometry: T.BufferGeometry) => {
      const mesh = new T.Mesh(geometry, material)
      mesh.name = name
      parent.add(mesh)
    }
    install(name, compactSurface(g))
    if (pair) install(name + ' right', mirrorGeometry(g))
  }
  const tag = <M extends T.Material>(material: M, wetness: WetnessKind): M => {
    m.tag?.(material, wetness)
    return material
  }
  const { eye, drlL } = cuts.curves
  const map = cuts.maps.front
  const pocketAt = (id: 'outer' | 'center' | 'eye', depth: number, taper: number, slope: number) => {
    const stations = fasciaThroat(map, id)
    const loop = stations ? stations.map(s => vector(s.point)) : outline(cuts.curves[id], id === 'center')
    const flip = signedArea(loop) < 0
    const shared = flip && stations ? [...stations].reverse() : stations
    return chamber(flip ? loop.reverse() : loop, depth, taper, slope, shared ? 0 : .009, shared)
  }
  const lamps: VehicleModule['lamps'] = []
  const emit = (name: string, p: T.Vector3, beam: boolean, material: T.MeshStandardMaterial, intensity: number) => {
    for (const sign of [1, -1]) {
      const object = new T.Object3D()
      object.name = name + (sign === 1 ? ' left origin' : ' right origin')
      object.position.copy(p).setX(sign * p.x)
      object.quaternion.setFromUnitVectors(forward, new T.Vector3(sign * .055, -.037, .998).normalize())
      parent.add(object)
      lamps.push({ object, beam, stage: beam ? lampThresholds.beamStart : lampThresholds.running, level: 0, color: material.emissive.clone(), intensity })
    }
  }
  const intake = pocketAt('outer', .177, .93, -.38)
  add('front outer duct returns', merged([intake.wall, radiatorSeat(intake.throat)]), m.housing, true)
  add('front radiator fins', radiator(intake.throat, full), m.mesh, true)
  add('front radiator cores', face(intake.throat, .028), m.housing, true)
  const mouth = pocketAt('center', .137, .92, 0)
  add('front centre duct returns', mouth.wall, m.housing)
  add('front extruded hex grille', grille(mouth.throat, mouth.center, full), m.mesh)
  add('centre duct core', face(mouth.throat, .076), m.housing)
  add('front rolled splitter', splitter(map.S, full), m.carbon)

  const lensMaterial = m.optics ?? tag(new T.MeshPhysicalMaterial({ color: 0xc1c7cd, roughness: .06, transmission: 1, ior: 1.46, thickness: .003, side: T.FrontSide }), 'beads')
  const projector = m.projector ?? tag(new T.MeshPhysicalMaterial({ color: 0xbec6d0, roughness: .09, transmission: .96, ior: 1.51, thickness: .007 }), 'none')
  const brushed = m.brushed ?? tag(new T.MeshStandardMaterial({ color: 0x9ca4ae, metalness: .9, roughness: .26 }), 'none')
  const reflector = m.reflector ?? tag(new T.MeshStandardMaterial({ color: 0xc4c9ce, metalness: 1, roughness: .11 }), 'none')
  const facetReturn = tag(new T.MeshStandardMaterial({ color: 0x626262, metalness: .71, roughness: .32 }), 'none')
  const bowl = outline(eye)
  const pocket = pocketAt('eye', .092, .94, -.95)
  add('front eye housing returns', pocket.wall, m.housing, true)
  add('front eye housing back', face(pocket.throat), m.housing, true)
  const coverRing = fasciaThroat(map, 'eye')?.map(s => vector(s.seat)) ?? bowl
  add('front clear contoured eye lens', cover(signedArea(coverRing) < 0 ? coverRing.reverse() : coverRing, map, full), lensMaterial, true)
  const drl = tag(m.drl.clone(), 'none')
  drl.emissive.setHex(0xe5f3ff)
  drl.color.setHex(0x939ca1)
  drl.roughness = .28
  drl.emissiveIntensity = 0
  guideOptics(drl, [cuts.curves.drlU, drlL, cuts.curves.drlS], guideWidth.lens)
  const slot = fasciaReturn(map, 'slot')?.map(vector)
  if (slot) {
    const low = slot.map(p => p.clone().addScaledVector(forward, -.014))
    const flip = signedArea(slot) < 0
    add('front Y guide seat', merged([grid([slot, low], flip, true), face(flip ? [...low].reverse() : low)]), m.housing, true)
  } else add('front Y guide seat', guide(map, guideWidth.seat, .019, 0), m.housing, true)
  add('front Y running guide', guide(map, guideWidth.lens, -.001, .001), drl, true)
  emit('front running guide', vector(drlL.p[0]).addScaledVector(forward, .008), false, drl, 3.99)
  const beam = tag(m.beamLens.clone(), 'none')
  beam.emissive.setHex(0xe4f3ff)
  beam.color.setHex(0x939ca1)
  beam.roughness = .28
  beam.transmission = 0
  beam.emissiveIntensity = 0
  projectorOptics(beam)
  const eyeBox = new T.Box3().setFromPoints(bowl)
  const [cases, collars, bowls, rings, retainers, lenses, dies] = Array.from({ length: 7 }, () => [] as T.BufferGeometry[])
  for (const [along, maxRadius, intensity] of [[.46, .029, 170], [.76, .023, 80]]) {
    const x = T.MathUtils.lerp(eyeBox.min.x, eyeBox.max.x, along)
    const ys: number[] = []
    for (let i = 0; i < bowl.length; i++) {
      const a = bowl[i], b = bowl[(i + 1) % bowl.length]
      if ((a.x > x) !== (b.x > x)) ys.push(T.MathUtils.lerp(a.y, b.y, (x - a.x) / (b.x - a.x)))
    }
    if (ys.length < 2) continue
    const min = Math.min(...ys), max = Math.max(...ys)
    const y = (min + max) / 2, r = Math.min(maxRadius, .42 * (max - min))
    const seat = vector(map.S(...fasciaUV(map, x, y)))
    const axis = new T.Vector3(.51, .12, .851).normalize()
    const p = seat.clone().addScaledVector(forward, -.022)
    const parts = projectorParts(p, axis, r, full)
    cases.push(parts.casework)
    collars.push(parts.collar)
    rings.push(reflectorReturns(parts.bowl))
    bowls.push(parts.bowl)
    retainers.push(lensRetainers(p, axis, r))
    lenses.push(parts.lens)
    dies.push(parts.source)
    emit('main beam projector', seat.addScaledVector(forward, .022), true, beam, intensity)
  }
  add('front projector casings', merged(cases), m.housing, true)
  add('front machined projector collars', merged(collars), brushed, true)
  add('front projector lens retainers', merged(retainers), m.housing, true)
  add('front faceted projector reflector bowls', merged(bowls), reflector, true)
  add('front projector reflector step returns', merged(rings), facetReturn, true)
  add('front convex projector lenses', merged(lenses), projector, true)
  for (const [i, g] of dies.entries()) add('front projector LED dies ' + i, g, beam, true)

  return {
    lamps,
    update(stage: number) {
      const running = stage * stage
      const level = T.MathUtils.smoothstep(stage, lampThresholds.beamStart, lampThresholds.beamFull)
      for (const l of lamps) l.level = l.beam ? level : running
      drl.emissiveIntensity = 144 * running
      beam.emissiveIntensity = 260 * level
    },
  }
}
