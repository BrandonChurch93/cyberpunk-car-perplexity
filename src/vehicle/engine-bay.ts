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

function grilleBasis(side: number) {
  const center = new T.Vector3(side * .301, 1.008, zAt(.710))
  const across = new T.Vector3(side, .235, 0)
  across.addScaledVector(grilleAxis, -across.dot(grilleAxis)).normalize()
  const up = new T.Vector3().crossVectors(grilleAxis, across).multiplyScalar(-side).normalize()
  return { center, across, up }
}

function perforatedGrille(face: (u: number, v: number, recess?: number) => Point, up: T.Vector3, side: number, full: boolean) {
  const a = grilleLength / 2, b = grilleWidth / 2
  const cell = full ? .0078 : .01175, gauge = full ? .0015 : .0020
  const radius = cell - gauge / Math.sqrt(3), apothem = radius * Math.sqrt(3) / 2
  const dx = cell * 1.5, dy = cell * Math.sqrt(3)
  const outline = [[-a, -b], [a, -b], [a, b], [-a, b]].map(([x, y]) => new T.Vector2(x, y))
  const holes: T.Vector2[][] = []
  for (let i = -Math.ceil(a / dx); i <= Math.ceil(a / dx); i++) for (let j = -Math.ceil(b / dy); j <= Math.ceil(b / dy); j++) {
    const x = i * dx, y = (j + (i % 2 === 0 ? .5 : 0)) * dy
    if (Math.abs(x) + radius + .0006 >= a || Math.abs(y) + apothem + .0006 >= b) continue
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
  if (full) for (const hole of holes) for (const [i, p] of hole.entries()) {
    const q = hole[(i + 1) % hole.length], at = vertices.length / 3
    const normal = new T.Vector3(...face(q.x, q.y)).sub(new T.Vector3(...face(p.x, p.y))).cross(up).normalize()
      .multiplyScalar(side)
    vertices.push(...face(p.x, p.y), ...face(q.x, q.y), ...face(q.x, q.y, .0014), ...face(p.x, p.y, .0014))
    for (let j = 0; j < 4; j++) normals.push(...normal.toArray())
    uv.push(p.x + a, p.y + b, q.x + a, q.y + b, q.x + a, q.y + b, p.x + a, p.y + b)
    indices.push(...(flip ? [at, at + 2, at + 1, at, at + 3, at + 2] : [at, at + 1, at + 2, at, at + 2, at + 3]))
  }
  return new T.BufferGeometry().setIndex(indices)
    .setAttribute('position', new T.Float32BufferAttribute(vertices, 3))
    .setAttribute('normal', new T.Float32BufferAttribute(normals, 3))
    .setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
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
  const grilleFrames: T.BufferGeometry[] = [], grilleTrays: T.BufferGeometry[] = []
  const rearLouvers: T.BufferGeometry[] = []
  const n = full ? 40 : 18
  black.push(patch((u, v) => {
    const s = mix(.649, .913, u), [edge] = bayEdge(s, 1)
    return [(v * 2 - 1) * (edge + .033), mix(.876, .746, u), zAt(s)]
  }, n, 10, [0, 1, 0], .022))
  const coverSide = curve([[0, -.029], [.09, -.013], [.19, 0], [.76, 0], [.91, -.013], [1, -.037]])
  const cover = (side: number, u: number, v: number): Point => {
    const half = .072 + coverSide(u)
    const inset = (1 - smooth(u, 0, .066)) + smooth(u, .934, 1)
    const shoulder = 1 - smooth(Math.abs(2 * v - 1), .64, 1)
    const x = .121 + .011 * Math.sin(u * Math.PI) - .007 * u + (2 * v - 1) * half
    return [side * x, crown(u) - .018 * (1 - shoulder) - .012 * inset, zAt(mix(coverStart, coverEnd, u))]
  }
  for (const side of [1, -1]) {
    const frame = (u: number, v: number): Point => {
      const [x, y, z] = bayEdge(mix(fore, aft, u), side)
      const span = .071 + .034 * Math.sin(Math.PI * u)
      return [x + side * (.0008 - span * v), y + .0015 - .037 * v - .010 * v ** 3, z]
    }
    finishFaces(patch(frame, n, 7, [0, 1, 0], .0027), n * 7 * 6, surround, returns)
    const wall = (u: number, v: number): Point => {
      const p = frame(u, 1)
      return [p[0] + side * (.025 - .126 * v), p[1] - (.184 - .036 * u) * v, p[2]]
    }
    black.push(patch(wall, n, 7, [0, 1, 0], .014))
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
    const { center, across, up } = grilleBasis(side)
    const airFace = (u: number, v: number, recess = 0): Point => center.clone()
      .addScaledVector(grilleAxis, u).addScaledVector(across, v).addScaledVector(up, -recess).toArray()
    const a = grilleLength / 2, b = grilleWidth / 2, rim = .0032, trayDepth = .024
    mesh.push(perforatedGrille(airFace, up, side, full))
    grilleTrays.push(patch((u, v) => airFace(mix(-a, a, u), mix(-b, b, v), trayDepth), 1, 1, up.toArray()))
    for (const edge of [-1, 1]) {
      grilleFrames.push(patch((u, v) => airFace(mix(-a - rim, a + rim, u), edge * (b + rim * v)), 1, 1, up.toArray()))
      grilleFrames.push(patch((u, v) => airFace(edge * (a + rim * v), mix(-b, b, u)), 1, 1, up.toArray()))
      grilleTrays.push(patch((u, v) => airFace(mix(-a, a, u), edge * b, trayDepth * v), 1, 1, across.clone().multiplyScalar(-edge).toArray()))
      grilleTrays.push(patch((u, v) => airFace(edge * a, mix(-b, b, u), trayDepth * v), 1, 1, grilleAxis.clone().multiplyScalar(-edge).toArray()))
    }

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
  const grilleMaterial = m.tag(new T.MeshStandardMaterial({
    color: full ? 0x555c65 : 0x81868e, roughness: .60, metalness: .28,
  }), 'none')
  add(parent, 'front airbox hex grilles', joined(mesh), grilleMaterial)
  add(parent, 'thin airbox grille frames', joined(grilleFrames), m.engine)
  add(parent, 'recessed airbox grille trays', joined(grilleTrays), m.dark)
  add(parent, 'paired cam cover rib groups and blank pads', joined(ribs), m.diffuser)
  add(parent, 'dark intake plenum and engine hardware', joined(internals), m.engine)
  add(parent, 'recessed bay chamber and blank plate', joined(black), m.dark)
  const detail = grilleBasis(-1)
  return anchor(detail.center.toArray(), detail.up.toArray(), .16)
}
