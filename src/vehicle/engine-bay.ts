import * as T from 'three'
import { bayEdge, zAt } from './body'
import { anchor } from './ends'
import { add, contour, curve, joined, mix, patch, polygon, roundedPath, smooth, type Point } from './geometry'
import type { Palette } from './materials'

const coverStart = .684, coverEnd = .834
const crown = (u: number) => mix(.974, .920, u) + .005 * Math.sin(u * Math.PI)
const fore = .664, aft = .897
const grilleLength = .420, grilleWidth = .184
const grilleAxis = new T.Vector3(0, .045, -1).normalize()
const trayDepth = .024, grilleRim = .006
type AirFace = (u: number, v: number, recess?: number) => Point
type GrilleRect = readonly [halfLength: number, halfWidth: number, recess: number]

function grilleBasis(side: number) {
  const center = new T.Vector3(side * .301, 1.008, zAt(.710))
  const across = new T.Vector3(side, .235, 0)
  across.addScaledVector(grilleAxis, -across.dot(grilleAxis)).normalize()
  const up = new T.Vector3().crossVectors(grilleAxis, across).multiplyScalar(-side).normalize()
  return { center, across, up }
}

function perforatedGrille(face: AirFace, up: T.Vector3, side: number, full: boolean) {
  const a = grilleLength / 2, b = grilleWidth / 2
  const cell = full ? .0078 : .01175, gauge = full ? .0015 : .0020
  const radius = cell - gauge / Math.sqrt(3), apothem = radius * Math.sqrt(3) / 2
  const dx = cell * 1.5, dy = cell * Math.sqrt(3)
  const outline = [[-a, -b], [a, -b], [a, b], [-a, b]].map(([x, y]) => new T.Vector2(x, y))
  const holes: T.Vector2[][] = []
  for (let i = -Math.ceil(a / dx); i <= Math.ceil(a / dx); i++) for (let j = -Math.ceil(b / dy); j <= Math.ceil(b / dy); j++) {
    const x = i * dx, y = (j + (i % 2 === 0 ? .5 : 0)) * dy
    if (Math.abs(x) + radius + .007 >= a || Math.abs(y) + apothem + .004 >= b) continue
    holes.push(Array.from({ length: 6 }, (_, k) => {
      const angle = k * Math.PI / 3
      return new T.Vector2(x + radius * Math.cos(angle), y + radius * Math.sin(angle))
    }))
  }
  const flip = side > 0
  const indices = T.ShapeUtils.triangulateShape(outline, holes).flatMap(([a, b, c]) => flip ? [a, c, b] : [a, b, c])
  const points = outline.concat(...holes)
  const vertices = points.flatMap(({ x, y }) => face(x, y))
  const normals = points.flatMap(() => up.toArray())
  const uv = points.flatMap(({ x, y }) => [x + a, y + b])
  const bevel = full ? .00045 : .00118
  const setback = full ? .00036 : .00067
  for (const hole of holes) {
    const center = hole[0].clone().lerp(hole[3], .5)
    const throat = hole.map((point) => point.clone().lerp(center, setback / radius))
    for (const [i, p] of hole.entries()) {
      const j = (i + 1) % hole.length, q = hole[j]
      const inward = new T.Vector3(...face(q.x, q.y)).sub(new T.Vector3(...face(p.x, p.y))).cross(up).normalize()
        .multiplyScalar(side)
      const quad = (outer: T.Vector2[], inner: T.Vector2[], low: number, high: number, normal: T.Vector3) => {
        const at = vertices.length / 3
        for (const [point, depth] of [[outer[i], low], [outer[j], low], [inner[j], high], [inner[i], high]] as const) {
          vertices.push(...face(point.x, point.y, depth))
          normals.push(...normal.toArray())
          uv.push(point.x + a, point.y + b)
        }
        indices.push(...(flip ? [at, at + 2, at + 1, at, at + 3, at + 2] : [at, at + 1, at + 2, at, at + 2, at + 3]))
      }
      quad(hole, throat, 0, bevel, inward.clone().addScaledVector(up, full ? .8 : .50).normalize())
      if (full) quad(throat, throat, bevel, .00165, inward)
    }
  }
  return new T.BufferGeometry().setIndex(indices)
    .setAttribute('position', new T.Float32BufferAttribute(vertices, 3))
    .setAttribute('normal', new T.Float32BufferAttribute(normals, 3))
    .setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
}

function grilleRing(face: AirFace, inner: GrilleRect, outer: GrilleRect, normals: readonly Point[]) {
  const edges = ([a, b, depth]: GrilleRect): Point[] => [[-a, -b, depth], [a, -b, depth], [a, b, depth], [-a, b, depth]]
  const from = edges(inner), to = edges(outer)
  return from.map((p, i) => {
    const j = (i + 1) % from.length
    return patch((u, v) => {
      const coord = (axis: 0 | 1 | 2) => mix(mix(p[axis], from[j][axis], u), mix(to[i][axis], to[j][axis], u), v)
      return face(coord(0), coord(1), coord(2))
    }, 1, 1, normals[i])
  })
}

function notchGrilleSeat(g: T.BufferGeometry, center: T.Vector3, across: T.Vector3, margin = grilleRim / 2) {
  const planes = [grilleAxis, grilleAxis.clone().negate(), across, across.clone().negate()].map((axis, i) => {
    const offset = center.dot(axis) + (i < 2 ? grilleLength : grilleWidth) / 2 + margin
    return (p: number[]) => offset - axis.x * p[0] - axis.y * p[1] - axis.z * p[2]
  })
  const position = g.getAttribute('position'), normal = g.getAttribute('normal'), uv = g.getAttribute('uv')
  const indices = g.getIndex()!
  const vertices = Array.from({ length: position.count }, (_, i) => [
    position.getX(i), position.getY(i), position.getZ(i), normal.getX(i), normal.getY(i), normal.getZ(i), uv.getX(i), uv.getY(i),
  ])
  const out: number[][] = []
  const emit = (points: number[][]) => {
    for (let i = 1; i + 1 < points.length; i++) out.push(points[0], points[i], points[i + 1])
  }
  for (let i = 0; i < indices.count; i += 3) {
    let inner = [vertices[indices.getX(i)], vertices[indices.getX(i + 1)], vertices[indices.getX(i + 2)]]
    if (planes.some((distance) => inner.every((v) => distance(v) < 0))) {
      emit(inner)
      continue
    }
    for (const distance of planes) {
      const outside: number[][] = [], next: number[][] = []
      for (const [j, p] of inner.entries()) {
        const q = inner[(j + 1) % inner.length], dp = distance(p), dq = distance(q)
        if (dp < 0) outside.push(p)
        else next.push(p)
        if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
          const cut = p.map((value, k) => mix(value, q[k], dp / (dp - dq)))
          outside.push(cut)
          next.push(cut)
        } else if (dp === 0) outside.push(p)
      }
      emit(outside)
      inner = next
      if (inner.length < 3) break
    }
  }
  return new T.BufferGeometry()
    .setAttribute('position', new T.Float32BufferAttribute(out.flatMap((p) => p.slice(0, 3)), 3))
    .setAttribute('normal', new T.Float32BufferAttribute(out.flatMap((p) => p.slice(3, 6)), 3))
    .setAttribute('uv', new T.Float32BufferAttribute(out.flatMap((p) => p.slice(6, 8)), 2))
}

function finishFaces(g: T.BufferGeometry, skin: number, wet: T.BufferGeometry[], dry: T.BufferGeometry[]): void {
  const index = g.getIndex()
  if (index) {
    const top = g.clone()
    top.setIndex(new T.BufferAttribute(index.array.slice(0, skin), 1))
    g.setIndex(new T.BufferAttribute(index.array.slice(skin), 1))
    wet.push(top)
    dry.push(g)
  } else {
    const top = new T.BufferGeometry(), returnFaces = new T.BufferGeometry()
    for (const name of ['position', 'normal', 'uv']) {
      const a = g.getAttribute(name)
      const split = skin * a.itemSize
      top.setAttribute(name, new T.BufferAttribute(a.array.slice(0, split), a.itemSize))
      returnFaces.setAttribute(name, new T.BufferAttribute(a.array.slice(split), a.itemSize))
    }
    wet.push(top)
    dry.push(returnFaces)
  }
}

export function createEngineBay(parent: T.Group, m: Palette, full: boolean) {
  const surround: T.BufferGeometry[] = [], covers: T.BufferGeometry[] = [], steps: T.BufferGeometry[] = []
  const returns: T.BufferGeometry[] = [], padWalls: T.BufferGeometry[] = []
  const mesh: T.BufferGeometry[] = [], ribs: T.BufferGeometry[] = [], internals: T.BufferGeometry[] = [], black: T.BufferGeometry[] = []
  const grilleFrames: T.BufferGeometry[] = [], grilleTrays: T.BufferGeometry[] = [], grilleRibs: T.BufferGeometry[] = []
  const rearLouvers: T.BufferGeometry[] = []
  const n = full ? 40 : 18
  black.push(patch((u, v) => {
    const s = mix(.649, .913, u), [edge] = bayEdge(s, 1)
    return [(v * 2 - 1) * (edge + .033), mix(.876, .746, u), zAt(s)]
  }, n, full ? 10 : 1, [0, 1, 0], .022))
  const coverSide = curve([[0, -.029], [.09, -.013], [.19, 0], [.76, 0], [.91, -.013], [1, -.037]])
  const cover = (side: number, u: number, v: number): Point => {
    const half = .072 + coverSide(u)
    const inset = (1 - smooth(u, 0, .066)) + smooth(u, .934, 1)
    const shoulder = 1 - smooth(Math.abs(2 * v - 1), .64, 1)
    const x = .121 + .011 * Math.sin(u * Math.PI) - .007 * u + (2 * v - 1) * half
    return [side * x, crown(u) - .018 * (1 - shoulder) - .012 * inset, zAt(mix(coverStart, coverEnd, u))]
  }
  for (const side of [1, -1]) {
    const { center, across, up } = grilleBasis(side)
    const frame = (u: number, v: number): Point => {
      const [x, y, z] = bayEdge(mix(fore, aft, u), side)
      const span = .071 + .034 * Math.sin(Math.PI * u)
      return [x + side * (.0008 - span * v), y + .0015 - .037 * v - .010 * v ** 3, z]
    }
    const wetSurround: T.BufferGeometry[] = [], drySurround: T.BufferGeometry[] = []
    finishFaces(patch(frame, n, 7, [0, 1, 0], .0027), n * 7 * 6, wetSurround, drySurround)
    surround.push(notchGrilleSeat(wetSurround[0], center, across))
    returns.push(notchGrilleSeat(drySurround[0], center, across))
    const wall = (u: number, v: number): Point => {
      const p = frame(u, 1)
      return [p[0] - side * .101 * v, p[1] - .001 - (.183 - .036 * u) * v, p[2]]
    }
    black.push(notchGrilleSeat(patch(wall, n, full ? 7 : 1, [0, 1, 0], .014), center, across, grilleRim - .0015))
    for (let i = 0; i < 4; i++) {
      const start = .350 + .155 * i
      const step = (u: number, v: number): Point => {
        const sweep = .050 * Math.abs(2 * v - 1)
        const s = start + .122 * u - sweep
        const p = frame(s, 1)
        const inner = .107 - .036 * i / 3
        const height = .015 + .058 * v ** 1.28 + .014 * i / 3
        return [p[0] - side * inner * v, p[1] - height - .010 * u + .005 * smooth(u, .77, 1), p[2]]
      }
      const columns = full ? 18 : 9, rows = full ? 12 : 8
      finishFaces(patch(step, columns, rows, [0, 1, 0], .004), columns * rows * 6, steps, returns)
    }
    const airFace: AirFace = (u, v, recess = 0) => center.clone()
      .addScaledVector(grilleAxis, u).addScaledVector(across, v).addScaledVector(up, -recess).toArray()
    const a = grilleLength / 2, b = grilleWidth / 2, lip = .003, shellDepth = .055
    const vertical: Point[] = [across.clone().negate().toArray(), grilleAxis.toArray(), across.toArray(), grilleAxis.clone().negate().toArray()]
    const inward = vertical.map(([x, y, z]): Point => [-x, -y, -z])
    const opening = [a, b, 0] as const, edge = [a, b, -lip] as const
    const rimTop = [a + grilleRim, b + grilleRim, -lip] as const
    const section = (offset: number, recess: number): GrilleRect => [a + grilleRim + offset, b + grilleRim + offset, recess]
    const shellFoot = section(.002, shellDepth)
    const shell = [rimTop, section(.0016, .0018), section(.0018, .0115),
      section(.0007, .0132), section(.0007, .0154), section(.0017, .0168), shellFoot]
    mesh.push(perforatedGrille(airFace, up, side, full))
    grilleFrames.push(...grilleRing(airFace, edge, rimTop, vertical.map(() => up.toArray())))
    grilleFrames.push(...grilleRing(airFace, opening, edge, inward))
    for (let i = 1; i < shell.length; i++) grilleFrames.push(...grilleRing(airFace, shell[i - 1], shell[i], vertical))
    const mount = shell[1], start = -mount[0] + .0026
    const flangeDepth = (u: number) => mount[2] + .001 + .006 * u
    grilleFrames.push(patch((u, v) => {
      const w = T.MathUtils.clamp(u * 6 / 5, 0, 1)
      const turn = Math.max(0, u * 6 - 5)
      return airFace(start - .117 * v, mix(-mount[1] - .012 * v, mount[1] - .001, w) + turn * (.033 + .023 * v),
        flangeDepth(turn) + .010 * v * v)
    }, 6, 5, up.toArray(), .0024))
    grilleFrames.push(patch((u, v) => {
      const width = .006 + .027 * (1 - smooth(u, .45, 1))
      return airFace(mix(start, -a + .046, u), mount[1] - .001 + width * v, flangeDepth(v) + .001 * u)
    }, 6, 3, up.toArray(), .0021))
    grilleFrames.push(patch((u, v) => {
      const w = 2 * u - 1
      const flange = shell[shell.length - 2]
      const run = .073 - .023 * w ** 2
      return airFace(flange[0] - .0004 + run * v, (flange[1] + .010 * v) * w,
        mix(flange[2], .057, .40 * v + .60 * v * v))
    }, 10, 6, up.toArray(), .0022))
    grilleFrames.push(patch((u, v) => airFace(mix(-shellFoot[0], shellFoot[0], u), mix(-shellFoot[1], shellFoot[1], v), shellDepth),
      1, 1, up.clone().negate().toArray()))
    grilleTrays.push(patch((u, v) => airFace(mix(-a, a, u), mix(-b, b, v), trayDepth), 1, 1, up.toArray()))
    for (const at of [-.078, -.020, .049]) {
      const profile = [[-.011, trayDepth + .0005], [-.007, .0196], [-.0048, .0178],
        [.0048, .0178], [.007, .0196], [.011, trayDepth + .0005]]
      for (let i = 1; i < profile.length; i++) {
        const [fromX, fromY] = profile[i - 1], [toX, toY] = profile[i]
        const normal = up.clone().multiplyScalar(toX - fromX).addScaledVector(grilleAxis, toY - fromY).normalize()
        grilleRibs.push(patch((u, v) => {
          const y = mix(-b, b, v)
          return airFace(at + mix(fromX, toX, u) + .094 * y, y, mix(fromY, toY, u))
        }, 1, 1, normal.toArray()))
      }
    }
    grilleTrays.push(...grilleRing(airFace, opening, [a, b, trayDepth], inward))

    const rows = full ? 18 : 12
    finishFaces(patch((u, v) => cover(side, u, v), n, rows, [0, 1, 0], .038), n * rows * 6, covers, returns)
    for (let tile = 0; tile < 5; tile++) {
      const at = .263 + tile * .116
      for (const lane of [0, 1]) {
        const centerU = at + .026 * lane, centerV = lane ? .705 : .295
        const hex: Point[] = [[-.049, 0], [-.030, -.125], [.030, -.125], [.049, 0], [.030, .125], [-.030, .125]]
          .map(([du, dv]) => {
            const p = cover(side, centerU + du, centerV + dv)
            return [p[0], p[1] + .006, p[2]]
          })
        const outline = roundedPath(hex, 2, .16)
        const pad = polygon(outline, [0, 1, 0], .007)
        finishFaces(pad, (pad.getAttribute('position').count - outline.length * 6) / 2, covers, padWalls)
      }
    }
    const pad: Point[] = [[.325, .465], [.345, .435], [.614, .435], [.649, .469], [.649, .534], [.623, .569],
      [.347, .569], [.325, .537]].map(([u, v]) => {
      const p = cover(side, u, v)
      return [p[0], p[1] + .005, p[2]]
    })
    ribs.push(polygon(roundedPath(pad, 3, .15), [0, 1, 0], .006))
    for (const end of [0, 1]) for (let i = 0; i < 3; i++) {
      ribs.push(patch((u, v) => {
        const f = end === 0 ? mix(.058 + .017 * i, .233 - .013 * i, u) : mix(.972 - .010 * i, .789 + .012 * i, u)
        const p = cover(side, f, .323 + .157 * i + (v - .5) * .045)
        const bump = .005 * Math.sin(Math.PI * v) * smooth(u, 0, .14) * (1 - smooth(u, .86, 1))
        return [p[0], p[1] + .0014 + bump, p[2]]
      }, full ? 16 : 8, 4, [0, 1, 0], .003))
    }
    for (let i = 0; i < 5; i++) {
      const u = .18 + .146 * i
      const p = cover(side, u, .92)
      internals.push(new T.CylinderGeometry(.021, .019, .043, full ? 10 : 7).rotateZ(Math.PI / 2)
        .translate(side * (Math.abs(p[0]) + .007), p[1] - .068, p[2]))
    }
    internals.push(contour([[.204, .872, zAt(.693)], [.221, .888, zAt(.735)], [.219, .864, zAt(.782)], [.204, .843, zAt(.828)]]
      .map(([x, y, z]): Point => [side * x, y, z]), .009, false, 5))
  }
  const plenum = (u: number, v: number): Point => {
    const width = mix(.026, .042, smooth(u, .69, 1))
    return [(2 * v - 1) * width, crown(u) - .026 * Math.abs(2 * v - 1) ** 1.6, zAt(mix(coverStart, coverEnd, u))]
  }
  internals.push(patch(plenum, n, full ? 14 : 8, [0, 1, 0], .028))
  const plate: Point[] = [[-.041, .925, zAt(.827)], [.041, .925, zAt(.827)], [.029, .918, zAt(.843)], [0, .914, zAt(.849)], [-.029, .918, zAt(.843)]]
  black.push(polygon(roundedPath(plate, 3, .17), [0, 1, 0], .006))
  black.push(patch((u, v) => {
    const x = (2 * u - 1) * mix(.163, .232, v)
    return [x, mix(.799, .930, v) + .010 * (2 * u - 1) ** 2, zAt(mix(.842, .906, v) - .008 * (2 * u - 1) ** 2)]
  }, full ? 24 : 14, 8, [0, 1, 0], .010))
  for (let i = 0; i < 3; i++) {
    const panel = patch((u, v) => {
      const a = 2 * u - 1
      const x = a * (.171 - .020 * i + .012 * v)
      const s = .847 + .0172 * i + .0132 * v - .0049 * Math.abs(a)
      const y = .851 + .027 * i + .022 * v + .006 * a ** 2 + .0042 * smooth(v, .78, 1)
      return [x, y, zAt(s)]
    }, full ? 24 : 14, 8, [0, 1, 0], .0045)
    const position = panel.getAttribute('position'), uv = panel.getAttribute('uv')
    for (let j = 0; j < uv.count; j++) uv.setXY(j, Math.abs(position.getX(j)), -position.getZ(j))
    panel.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(position.count * 3).fill(i === 2 ? .25 : .76), 3))
    rearLouvers.push(panel)
  }
  add(parent, 'dark chevron rear bay louvers', joined(rearLouvers), m.rearVent)
  add(parent, 'thin carbon engine bay surround', joined(surround), m.carbon)
  add(parent, 'carbon cam covers with hex relief', joined(covers), m.bayCover)
  add(parent, 'stepped carbon bay vents', joined(steps), m.ventCarbon)
  add(parent, 'dry carbon bay wall returns', joined(returns), m.dark)
  const padEdge = m.dark.clone()
  padEdge.color.setHex(full ? 0x272a2e : 0x414448)
  padEdge.roughness = .72
  add(parent, 'matte hex pad walls', joined(padWalls), m.tag(padEdge, 'none'))
  const grilleFinish = new T.MeshPhysicalMaterial({
    color: full ? 0x6d7176 : 0x737881, roughness: full ? .43 : .57, metalness: full ? .54 : .28,
    clearcoat: full ? .16 : 0, clearcoatRoughness: .32,
  })
  const ductFinish = new T.MeshPhysicalMaterial({
    color: 0x303135, roughness: .86, specularIntensity: .12,
  })
  const trayFinish = new T.MeshPhysicalMaterial({
    color: 0x1a1d21, emissive: 0x050607, roughness: .94, specularIntensity: .08,
  })
  const ribFinish = new T.MeshPhysicalMaterial({
    color: full ? 0x5b6876 : 0x343b43, roughness: .86, specularIntensity: .12, envMapIntensity: full ? 1.50 : 1,
  })
  add(parent, 'front airbox hex grilles', joined(mesh), m.tag(grilleFinish, 'none'))
  add(parent, 'flush airbox grille ducts', joined(grilleFrames), m.tag(ductFinish, 'none'))
  add(parent, 'recessed airbox grille trays', joined(grilleTrays), m.tag(trayFinish, 'none'))
  add(parent, 'low ribs in the airbox trays', joined(grilleRibs), m.tag(ribFinish, 'none'))
  add(parent, 'paired cam cover rib groups and blank pads', joined(ribs), m.diffuser)
  add(parent, 'dark intake plenum and engine hardware', joined(internals), m.engine)
  add(parent, 'recessed bay chamber and blank plate', joined(black), m.dark)
  const detail = grilleBasis(-1)
  return anchor(detail.center.toArray(), detail.up.toArray(), .16)
}
