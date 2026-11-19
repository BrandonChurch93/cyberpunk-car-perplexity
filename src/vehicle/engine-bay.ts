import * as T from 'three'
import { bayEdge, zAt } from './body'
import { anchor } from './ends'
import { add, contour, curve, hexMesh, joined, mix, patch, polygon, roundedPath, smooth, type Point } from './geometry'
import type { Palette } from './materials'

const coverStart = .684, coverEnd = .834
const crown = (u: number) => mix(.974, .920, u) + .005 * Math.sin(u * Math.PI)
const fore = .664, aft = .897

export function createEngineBay(parent: T.Group, m: Palette, full: boolean) {
  const surround: T.BufferGeometry[] = [], covers: T.BufferGeometry[] = [], steps: T.BufferGeometry[] = []
  const mesh: T.BufferGeometry[] = [], ribs: T.BufferGeometry[] = [], internals: T.BufferGeometry[] = [], black: T.BufferGeometry[] = []
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
    surround.push(patch(frame, n, 7, [0, 1, 0], .0027))
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
      steps.push(patch(step, full ? 18 : 9, full ? 12 : 8, [0, 1, 0], .004))
    }
    const airFace = (u: number, v: number): Point => {
      const s = mix(.673, .731, u)
      const [x, y, z] = bayEdge(s, side)
      return [x - side * (.114 + .080 * v), y - .042 - .099 * v + .013 * u, z - .016 * v]
    }
    black.push(patch((u, v) => {
      const p = airFace(u, v)
      return [p[0] + side * .012, p[1] - .022, p[2]]
    }, 10, 6, [0, 1, 0], .014))
    mesh.push(hexMesh((u, v) => airFace(mix(.035, .972, u), mix(.044, .985, v)), .270, .118,
      full ? .0078 : .018, full ? .0008 : .0013))
    const airBorder: Point[] = [airFace(0, 0), airFace(1, 0), airFace(1, 1), airFace(0, 1)]
    surround.push(contour([...airBorder, airBorder[0]], .0038, false, 5))

    covers.push(patch((u, v) => cover(side, u, v), n, full ? 18 : 12, [0, 1, 0], .038))
    for (let tile = 0; tile < 5; tile++) {
      const at = .263 + tile * .116
      for (const lane of [0, 1]) {
        const centerU = at + .029 * lane, centerV = lane ? .638 : .340
        const hex: Point[] = [[-.045, 0], [-.028, -.127], [.028, -.127], [.045, 0], [.028, .127], [-.028, .127]]
          .map(([du, dv]) => {
            const p = cover(side, centerU + du, centerV + dv)
            return [p[0], p[1] + .0033, p[2]]
          })
        covers.push(polygon(roundedPath(hex, 2, .15), [0, 1, 0], .004))
      }
    }
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
  steps.push(patch((u, v) => {
    const x = (2 * u - 1) * mix(.232, .151, v)
    return [x, mix(.947, .866, v) + .010 * (2 * u - 1) ** 2, zAt(mix(.898, .851, v) - .011 * (2 * u - 1) ** 2)]
  }, full ? 24 : 14, 8, [0, 1, 0], .012))
  add(parent, 'thin carbon engine bay surround', joined(surround), m.carbon)
  add(parent, 'carbon cam covers with hex relief', joined(covers), m.bayCover)
  add(parent, 'stepped carbon bay vents', joined(steps), m.carbon)
  add(parent, 'front airbox hex grilles', joined(mesh), m.carbon)
  add(parent, 'paired cam cover rib groups', joined(ribs), m.diffuser)
  add(parent, 'dark intake plenum and engine hardware', joined(internals), m.engine)
  add(parent, 'recessed bay chamber and blank plate', joined(black), m.dark)
  return anchor(plenum(2 / 3, .5), [0, 1, 0], .42)
}
