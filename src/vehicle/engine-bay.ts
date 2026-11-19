import * as T from 'three'
import { bayEdge, zAt } from './body'
import { anchor } from './ends'
import { add, contour, hexMesh, joined, mix, patch, smooth, type Point } from './geometry'
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
    black.push(patch(scoop, sections, 14, [0, 1, 0], .008))
    const lining = (u: number, v: number): Point => {
      const p = scoop(u, 1)
      return [p[0] - side * .062 * v, p[1] - v * (.13 - .044 * u), p[2]]
    }
    if (full) {
      const border = (u0: number, u1: number, v0: number, v1: number) =>
        patch((u, v) => lining(mix(u0, u1, u), mix(v0, v1, v)), sections, 7, [0, 1, 0], .006)
      black.push(border(0, .072, 0, 1), border(.721, 1, 0, 1), border(.072, .721, 0, .18), border(.072, .721, .91, 1))
      black.push(patch((u, v) => {
        const p = lining(mix(.052, .742, u), mix(.14, .94, v))
        return [p[0] + side * .029, p[1] - .041, p[2]]
      }, sections, 13, [0, 1, 0], .009))
    } else black.push(patch(lining, sections, 8, [0, 1, 0], .007))
    const cover = (u: number, v: number): Point => {
      const s = mix(.685, .832, u)
      const end = .73 + .27 * smooth(u, .025, .15) - .22 * smooth(u, .80, .98)
      const x = .15 + mix(-.072, .075, v) * end
      const shoulder = smooth(v, .023, .20) * (1 - smooth(v, .78, .968))
      const crown = .037 * shoulder * (.66 + .34 * Math.sin(Math.PI * u) ** .8)
      const scallop = .008 * (smooth(u, .04, .19) - smooth(u, .80, .99)) * (1 - smooth(v, .22, .41))
      return [side * x, mix(.910, .867, u) + crown - scallop, zAt(s)]
    }
    internals.push(patch(cover, sections, 16, [0, 1, 0], .034))
    for (const offset of [-.041, -.031, .018, .028, .038]) {
      const ribs = (u: number, v: number): Point => {
        const p = cover(mix(.15, .83, u), .49 + (offset + .006 * (v - .5)) / .147)
        const bump = .0055 * Math.sin(Math.PI * v) * smooth(u, 0, .07) * (1 - smooth(u, .92, 1))
        return [p[0], p[1] + .0011 + bump, p[2]]
      }
      black.push(patch(ribs, 26, 3, [0, 1, 0], .003))
    }
    for (let i = 0; i < 6; i++) {
      const s = .693 + .022 * i
      const p = cover((s - .685) / .147, .92)
      pins.push(new T.CylinderGeometry(.006, .006, .004, 7).translate(p[0], p[1] + .002, p[2]))
      internals.push(new T.CylinderGeometry(.023, .022, .042, 12).rotateZ(Math.PI / 2).translate(side * .225, p[1] - .045, p[2]))
    }
    const brace = (u: number, v: number): Point => {
      const s = mix(.662, .772, u)
      const x = mix(.290, .002, u) + v * (.078 - .040 * u)
      const z0 = zAt(s)
      const z = z0 + .031 * (v - .5)
      const y = mix(1.043, .963, u) + .016 * Math.sin(Math.PI * u) + .009 * Math.sin(Math.PI * v)
      return [side * x, y, z]
    }
    const crossV = (u: number, v: number): Point => {
      const s = mix(.735, .837, u)
      const x = mix(.001, .237, u) + v * (.046 + .034 * u)
      const z = zAt(s) + .030 * (v - .5)
      return [side * x, mix(.985, .913, u) + .020 * Math.sin(Math.PI * u) + .009 * Math.sin(Math.PI * v), z]
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
      black.push(contour(Array.from({ length: 10 }, (_, j) => cut(j / 9, 1)), .0041))
    }
    const cable: Point[] = [
      [side * .234, .902, zAt(.691)], [side * .241, .929, zAt(.721)], [side * .257, .927, zAt(.752)],
      [side * .253, .906, zAt(.800)], [side * .224, .875, zAt(.830)],
    ]
    black.push(contour(cable, .0103))
  }
  const bridgeSurface = (u: number, v: number): Point => {
    const x = mix(-.349, .349, u), end = Math.abs(x) / .349
    const s = .697 + .010 * v + .013 * end ** 1.5 + .005 * (2 * v - 1) * smooth(end, .08, .57)
    return [x, bridge[1] + .013 * end ** 2 - .024 * smooth(end, .58, 1) + .004 * Math.sin(Math.PI * v), zAt(s)]
  }
  carbon.push(patch(bridgeSurface, full ? 82 : sections, 10, [0, 1, 0], .017))
  const heatShield = (u: number, v: number): Point => [mix(-.19, .19, v), .842 + .092 * smooth(u, .13, .98) + .012 * Math.sin(v * Math.PI), zAt(mix(.832, .906, u))]
  carbon.push(patch(heatShield, 28, 12, [0, 1, 0], .014))
  for (let i = 0; i < 4; i++) {
    const s = .842 + .014 * i
    const layer = (u: number, v: number): Point => [mix(-.16 + .012 * i, .16 - .012 * i, u), .882 + .0155 * i + .014 * Math.sin(u * Math.PI) + .010 * v, zAt(s + .008 * v)]
    carbon.push(patch(layer, 18, 6, [0, 1, 0], .007))
  }
  const plenum = (u: number, v: number): Point => {
    const half = .057 + .027 * smooth(u, .025, .22) - .020 * smooth(u, .78, .98)
    const rib = .007 * smooth(u, .07, .15) * (1 - smooth(u, .85, .95)) * (.5 + .5 * Math.cos(10 * Math.PI * u))
    const crown = (.034 + rib) * (1 - Math.abs(2 * v - 1) ** 3.5)
    return [(2 * v - 1) * half, mix(.905, .878, u) + crown, zAt(mix(.698, .829, u))]
  }
  internals.push(patch(plenum, full ? 54 : 20, full ? 18 : 9, [0, 1, 0], .026))
  const braceWeb = (u: number, v: number): Point => {
    const half = .046 + .011 * Math.sin(Math.PI * u)
    const y = mix(.968, .950, u) + .006 * Math.sin(Math.PI * v)
    return [(2 * v - 1) * half, y, zAt(mix(.733, .777, u))]
  }
  carbon.push(patch(braceWeb, 14, 8, [0, 1, 0], .019))
  add(parent, 'open bay resin cross bracing and hex grilles', joined(carbon), m.carbon)
  add(parent, 'engine cover banks and hardware', joined(internals), m.engine)
  add(parent, 'engine cover fasteners', joined(pins), m.brushed)
  add(parent, 'engine bay ground and hoses', joined(black), m.dark)
  return anchor(bridgeSurface(.5, .5), [0, 1, 0], .42)
}
