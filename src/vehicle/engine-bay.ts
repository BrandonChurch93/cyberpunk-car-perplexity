import * as T from 'three'
import { bayEdge, zAt } from './body'
import { anchor } from './ends'
import { add, contour, hexMesh, joined, mix, patch, polygon, roundedPath, smooth, type Point } from './geometry'
import type { Palette } from './materials'

export function createEngineBay(parent: T.Group, m: Palette, full: boolean) {
  const carbon: T.BufferGeometry[] = [], internals: T.BufferGeometry[] = [], pins: T.BufferGeometry[] = [], black: T.BufferGeometry[] = []
  const sections = full ? 42 : 24
  const bridge: Point = [0, 1.002, zAt(.702)]
  const bayFloor = (u: number, v: number): Point => [mix(-.407, .407, v), mix(.881, .729, u), zAt(mix(.648, .906, u))]
  black.push(patch(bayFloor, 16, 12, [0, 1, 0], .023))
  for (const side of [1, -1]) {
    const scoop = (u: number, v: number): Point => {
      const s = mix(.647, .907, u)
      const [x, y, z] = bayEdge(s, side)
      const slope = .025 + .042 * Math.sin(Math.PI * u)
      return [x - side * (.003 + .126 * v), y - v ** 1.4 * slope - .009 * Math.sin(v * Math.PI), z]
    }
    carbon.push(patch(scoop, sections, 14, [0, 1, 0], .008))
    const lining = (u: number, v: number): Point => {
      const p = scoop(u, 1)
      return [p[0] - side * .062 * v, p[1] - v * (.13 - .044 * u), p[2]]
    }
    carbon.push(patch(lining, sections, 8, [0, 1, 0], .007))
    const cover = (u: number, v: number): Point => {
      const s = mix(.685, .832, u)
      const end = .73 + .27 * smooth(u, .025, .15) - .22 * smooth(u, .80, .98)
      const x = .15 + mix(-.072, .075, v) * end
      const shoulder = Math.sin(Math.PI * v) ** .67
      return [side * x, mix(.910, .867, u) + .027 * shoulder + .015 * Math.sin(Math.PI * u), zAt(s)]
    }
    internals.push(patch(cover, sections, 16, [0, 1, 0], .034))
    for (const offset of [-.041, -.031, .018, .028, .038]) {
      const ribs = (u: number, v: number): Point => {
        const p = cover(mix(.15, .83, u), .49 + (offset + .004 * (v - .5)) / .147)
        return [p[0], p[1] + .004 * Math.sin(u * Math.PI) + .0012, p[2]]
      }
      pins.push(patch(ribs, 26, 3, [0, 1, 0], .003))
    }
    for (let i = 0; i < 6; i++) {
      const s = .693 + .022 * i
      const p = cover((s - .685) / .147, .92)
      pins.push(new T.CylinderGeometry(.006, .006, .004, 7).translate(p[0], p[1] + .002, p[2]))
      internals.push(new T.CylinderGeometry(.023, .022, .042, 12).rotateZ(Math.PI / 2).translate(side * .225, p[1] - .045, p[2]))
    }
    const brace = (u: number, v: number): Point => {
      const s = mix(.662, .772, u)
      const x = mix(.282, .006, u) + v * (.047 - .023 * u)
      const z0 = zAt(s)
      const z = z0 + .020 * (v - .5)
      const y = mix(1.048, .963, u) + .012 * Math.sin(Math.PI * u) + .003 * Math.sin(Math.PI * v)
      return [side * x, y, z]
    }
    const crossV = (u: number, v: number): Point => {
      const s = mix(.735, .837, u)
      const x = mix(.009, .270, u) + (v - .5) * (.044 + .023 * u)
      const z = zAt(s) + .021 * (v - .5)
      return [side * x, mix(.985, .915, u) + .024 * Math.sin(Math.PI * u) + .004 * Math.sin(Math.PI * v), z]
    }
    carbon.push(patch(brace, sections, 10, [0, 1, 0], .014), patch(crossV, sections, 10, [0, 1, 0], .015))
    for (const p of [brace(.09, .55), crossV(.87, .57)]) {
      pins.push(new T.CylinderGeometry(.012, .012, .004, 14).translate(p[0], p[1] + .002, p[2]))
      black.push(new T.CylinderGeometry(.005, .005, .0065, 6).translate(p[0], p[1] + .0035, p[2]))
    }
    const meshMap = (u: number, v: number): Point => {
      const p = lining(mix(.07, .72, u), mix(.18, .91, v))
      return [p[0] - side * .005, p[1] + .004, p[2]]
    }
    carbon.push(hexMesh(meshMap, .82, .12, full ? .0115 : .019, full ? .00092 : .00155))
    for (let i = 0; i < 5; i++) {
      const s = .659 + i * .032
      const cut = (u: number, v: number): Point => {
        const sd = s + (v - .5) * .021 + .012 * u
        const p = bayEdge(sd, side)
        return [p[0] - side * mix(.015, .109, u), p[1] - .003 - .038 * u - .010 * Math.sin(Math.PI * v), p[2]]
      }
      black.push(patch(cut, 16, 8, [0, 1, 0], .009))
      carbon.push(contour(Array.from({ length: 10 }, (_, j) => cut(j / 9, 1)), .0041))
    }
    const cable: Point[] = [
      [side * .234, .902, zAt(.691)], [side * .241, .929, zAt(.721)], [side * .257, .927, zAt(.752)],
      [side * .253, .906, zAt(.800)], [side * .224, .875, zAt(.830)],
    ]
    black.push(contour(cable, .0103))
  }
  const bridgeSurface = (u: number, v: number): Point => {
    const x = mix(-.30, .30, u), s = .697 + .010 * v + .013 * (Math.abs(x) / .30) ** 1.5
    return [x, bridge[1] + .008 * Math.abs(x) / .3 + .004 * Math.sin(Math.PI * v), zAt(s)]
  }
  carbon.push(patch(bridgeSurface, sections, 8, [0, 1, 0], .017))
  const heatShield = (u: number, v: number): Point => [mix(-.19, .19, v), .842 + .092 * smooth(u, .13, .98) + .012 * Math.sin(v * Math.PI), zAt(mix(.832, .906, u))]
  carbon.push(patch(heatShield, 28, 12, [0, 1, 0], .014))
  for (let i = 0; i < 4; i++) {
    const s = .842 + .014 * i
    const layer = (u: number, v: number): Point => [mix(-.16 + .012 * i, .16 - .012 * i, u), .882 + .0155 * i + .014 * Math.sin(u * Math.PI) + .010 * v, zAt(s + .008 * v)]
    carbon.push(patch(layer, 18, 6, [0, 1, 0], .007))
  }
  const emblemFreeCap: Point[] = [[-.043, .932, zAt(.777)], [.043, .932, zAt(.777)], [.061, .916, zAt(.795)], [-.061, .916, zAt(.795)]]
  internals.push(polygon(roundedPath(emblemFreeCap), [0, 1, 0], .017))
  add(parent, 'open bay resin cross bracing and hex grilles', joined(carbon), m.carbon)
  add(parent, 'engine cover banks and hardware', joined(internals), m.engine)
  add(parent, 'engine covers fasteners and machined ribs', joined(pins), m.brushed)
  add(parent, 'engine bay ground and hoses', joined(black), m.dark)
  return anchor(bridgeSurface(.5, .5), [0, 1, 0], .42)
}
