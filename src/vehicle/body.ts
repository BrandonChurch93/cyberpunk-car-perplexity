import * as T from 'three'
import { add, blend, contour, curve, joined, mix, patch, polygon, roundedPath, smooth, tau, vec, type Point, type Surface } from './geometry'
import type { Palette } from './materials'

export const dimensions = {
  length: 4.947, bodyWidth: 2.033, mirrorWidth: 2.266, height: 1.16, wheelbase: 2.779,
  frontX: 0.86, rearX: 0.8505, frontOverhang: 2.168 * 661 / 1206,
}
export const zAt = (s: number) => dimensions.length * (0.5 - s)
export const sAt = (z: number) => 0.5 - z / dimensions.length
export const frontHub = zAt(dimensions.frontOverhang / dimensions.length)
export const rearHub = frontHub - dimensions.wheelbase
export const frontWheel = { x: dimensions.frontX, z: frontHub, radius: .34675, loaded: .3405, width: .265, rim: .254, rimWidth: .2413, disc: .205, discDepth: .038, arch: .385 }
export const rearWheel = { x: dimensions.rearX, z: rearHub, radius: .3702, loaded: .3625, width: .345, rim: .2667, rimWidth: .3048, disc: .195, discDepth: .032, arch: .410 }
export type WheelSize = typeof frontWheel
export const floorY = .132

const plan = curve([
  [0, .008], [.005, .113], [.010, .197], [.017, .337], [.023, .448], [.04, .607], [.06, .739], [.08, .836], [.10, .875], [.12, .914],
  [.14, .941], [.16, .973], [.18, .980], [.26, .981], [.285, .98], [.31, .961], [.34, .969], [.4, .980], [.48, .988],
  [.55, .992], [.62, .994], [.70, .998], [.747, 1.009], [.766, dimensions.bodyWidth / 2], [.825, dimensions.bodyWidth / 2],
  [.857, 1.009], [.88, .973], [.90, .933], [.92, .896], [.94, .824], [.96, .691], [.98, .535], [.995, .39], [1, .23],
])
const frontWidth = curve([
  [0, .0008], [.113, .0058], [.197, .0108], [.337, .0178], [.448, .0238], [.607, .04], [.739, .06], [.836, .08], [.875, .10], [.914, .12], [.941, .14], [.973, .16], [.982, .18],
])
const tailWidth = curve([
  [0, .995], [.39, .994], [.555, .990], [.716, .969], [.824, .945], [.875, .932], [.918, .920], [.947, .902], [.980, .876], [1.012, .855],
])
const shoulder = curve([
  [0, .421], [.016, .447], [.024, .465], [.044, .552], [.08, .623], [.10, .658], [.15, .735], [.20, .779], [.25, .772],
  [.30, .738], [.34, .729], [.40, .725], [.51, .759], [.59, .821], [.67, .881], [.736, .936],
  [.793, .943], [.85, .918], [.89, .888], [.92, .865], [.96, .848], [1, .833],
])
const hoodLine = curve([[0, .431], [.024, .449], [.06, .523], [.105, .608], [.165, .716], [.225, .761], [.265, .769], [.33, .764], [.6, .83]])
const spine = curve([
  [.575, 1.149], [.6, 1.146], [.62, 1.135], [.64, 1.124], [.66, 1.099], [.68, 1.085], [.70, 1.078], [.72, 1.068],
  [.742, 1.056], [.769, 1.040], [.80, 1.02], [.82, 1.011], [.85, .983], [.88, .963], [.90, .957], [.92, .941], [.94, .926], [.96, .908], [.984, .898],
])
const hoodCreaseX = (s: number) => .475 - .178 * T.MathUtils.clamp((s - .059) / .141, 0, 1)
const cabFront = (v: number) => .189 + .075 * v ** 2.1
const wingRadius = (s: number) => .004 * smooth(s, .071, .099) * (1 - smooth(s, .295, .331))
const sideDent = curve([[.29, 0], [.36, .020], [.53, .099], [.625, .123], [.746, 0]])
const rockerY = curve([[0, .155], [.04, .136], [.25, .136], [.69, .136], [.86, .137], [.90, .153], [.95, .187], [1, .40]])
const shoulderInset = (s: number) => .024 * smooth(s, .322, .407) * (1 - smooth(s, .660, .743))
const shoulderX = (s: number) => plan(s) - shoulderInset(s)
const diagonalS = (y: number) => .529 + .119 * (y - .331)
const doorBelt = curve([[.303, .583], [.538, .686], [.650, .743], [.746, .798], [.830, .811], [.930, .777]])
const heelFold = curve([[.32, .176], [.39, .216], [.53, .285], [.617, .332], [.70, .366]])

function hinge(t: number, width: number): number {
  return t <= -width ? 0 : t >= width ? t : (t + width) ** 2 / (4 * width)
}

function sidePoint(s: number, y: number, side: number): Point {
  const span = shoulder(s) - rockerY(s)
  const at = (h: number) => (h - rockerY(s)) / span
  const q = T.MathUtils.clamp(at(y), 0, 1)
  const sill = (.058 + .017 * smooth(s, .20, .32)) * (1 - smooth(q, 0, .21))
  const heel = T.MathUtils.clamp(at(heelFold(s)), .073, .38)
  const belt = T.MathUtils.clamp(at(doorBelt(s)), .66, .89)
  const dent = sideDent(s)
  const thickness = shoulderInset(s)
  const a = (.020 + .70 * dent - .063) / heel
  const b = (.013 + .20 * dent - (.020 + .70 * dent)) / (belt - heel)
  const c = (thickness - (.013 + .20 * dent)) / (1 - belt)
  const section = .063 + a * q + (b - a) * hinge(q - heel, .005 / span) + (c - b) * hinge(q - belt, .004 / span)
  const rearShoulder = .19 * Math.max(0, Math.max(0, shoulder(s) - doorBelt(s)) * q - hinge(y - doorBelt(s), .004))
    * smooth(s, .588, .675) * (1 - smooth(s, .875, .950))
  const shape = smooth(s, .307, .359) * (1 - smooth(s, .690, .741))
  const inset = mix(sill, section, shape) + rearShoulder + thickness * (1 - shape) * smooth(q, .74, 1)
  return [side * (plan(s) - inset), y, zAt(s)]
}

function wingEdge(s: number) {
  const width = plan(s)
  const center = hoodLine(s), outer = shoulder(s)
  const edge = Math.min(width * .93, hoodCreaseX(s))
  const crease = smooth(s, .026, .080) * (1 - smooth(s, .244, .319))
  const crest = .022 + .017 * (1 - smooth(s, .112, .198))
  const ridge = mix(center, outer, .32 * edge / width) + crest * crease
  const radius = wingRadius(s)
  const angle = Math.PI / 2 + Math.atan((outer - ridge) / (width - edge))
  const x = width - radius + radius * Math.cos(angle)
  const y = outer + radius * Math.sin(angle)
  return { width, center, outer, edge, crease, ridge, radius, angle, x, y }
}

function bonnet(s: number, v: number): Point {
  const w = wingEdge(s), x = w.x * v
  const { center, edge, crease, ridge } = w
  const a = (ridge - center) / edge, b = (w.y - ridge) / (w.x - edge)
  const e = x - edge, fillet = .0035
  const corner = Math.abs(e) > fillet ? Math.abs(e) : .5 * (e * e / fillet + fillet)
  const facets = ridge + .5 * (a + b) * e + .5 * (b - a) * corner
  const base = mix(center, w.y, v * (.77 + .23 * v))
  const cowlDrop = .021 * smooth(s, .127, .236) * (1 - v ** 3)
  return [x, mix(base, facets, crease) - cowlDrop, zAt(s)]
}

export function frontHoodEdge(x: number): Point {
  let low = 0, high = .18
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2
    if (wingEdge(middle).x < x) low = middle
    else high = middle
  }
  const p = bonnet((low + high) / 2, 1)
  return [x, p[1], p[2]]
}

const cowl = (v: number): Point => bonnet(cabFront(v), v * .818)
const roofWidth = curve([[.417, .617], [.46, .625], [.51, .632], [.56, .60], [.595, .542], [.625, .49]])
const roofHeight = curve([[.417, 1.122], [.445, 1.14], [.472, 1.157], [.5, 1.16], [.545, 1.16], [.578, 1.153], [.595, 1.15]])
const roofCross = curve([[0, -.019], [.25, -.019], [.37, -.016], [.48, 0], [.66, -.006], [.84, -.018], [1, -.042]])
const roof = (s: number, v: number): Point => [roofWidth(s) * v, roofHeight(s) + roofCross(Math.abs(v)), zAt(s)]
const glassLowerX = curve([[.264, cowl(1)[0]], [.35, .824], [.46, .802], [.55, .77], [.60, .710], [.65, .576]])
const glassLowerY = curve([[.264, cowl(1)[1]], [.35, .750], [.45, .785], [.55, .851], [.60, .918], [.65, .959]])
const glassUpperY = curve([[.261, cowl(1)[1]], [.30, .94], [.35, 1.01], [.40, 1.064], [.417, roof(.417, 1)[1]], [.46, roof(.46, 1)[1]], [.51, roof(.51, 1)[1]], [.565, roof(.565, 1)[1]], [.595, roof(.595, 1)[1]], [.625, 1.048], [.65, .959]])
const glassUpperX = curve([[.261, .803], [.30, .756], [.35, .697], [.40, .625], [.417, .617], [.46, .625], [.51, .632], [.565, .595], [.595, .542], [.625, .542], [.65, .576]])
const forwardWind = (u: number, q: number): Point => {
  const p = cowl(Math.abs(q))
  const low: Point = [Math.sign(q) * p[0], p[1] + .0013, p[2]]
  const high = roof(.4175, q)
  const p1 = blend(low, high, u)
  return [p1[0], p1[1] + .009 * Math.sin(Math.PI * u) * (1 - .43 * Math.abs(q)), p1[2]]
}
const edgeGlass = (s: number, v: number): Point => {
  const q = T.MathUtils.clamp((s - cabFront(1)) / (.4175 - cabFront(1)), 0, 1)
  const upper = s < .4175 ? forwardWind(q, 1) : s < .5965 ? roof(s, 1) : [glassUpperX(s), glassUpperY(s), zAt(s)]
  return [
    mix(glassLowerX(s), upper[0], v),
    mix(glassLowerY(s), upper[1], v),
    zAt(s),
  ]
}

const bayWidth = curve([[.60, .36], [.641, .431], [.68, .477], [.75, .452], [.82, .389], [.873, .326], [.901, .218], [.918, .04]])
export const bayEdge = (s: number, side: number): Point => [side * bayWidth(s), spine(s) - .009, zAt(s)]
export const tailLipY = (x: number): number => .882 - .011 * x - .022 * (1 - smooth(x, .038, .131))

export function fascia(front: boolean, side: number, x: number, y: number, recess = 0): Point {
  if (front) {
    const s = frontWidth(x) + .002 * smooth(y, .2, .48) - .0008
    return [x * side, y, Math.min(zAt(0), zAt(s) - recess)]
  }
  const s = tailWidth(x) + (.010 * smooth(y, .58, .81)) - .009 * smooth(y, .84, .94)
  const inset = .070 * smooth(y, .47, .70) * (1 - .78 * smooth(x, .32, .70))
  return [x * side, y, Math.max(zAt(1), zAt(s) + recess + inset)]
}

export function createBody(parent: T.Group, m: Palette, full: boolean): { paintPoint: Point; paintNormal: Point } {
  const n = full ? 64 : 31, k = full ? 26 : 13
  const paint: T.BufferGeometry[] = [], black: T.BufferGeometry[] = []
  const steel: T.BufferGeometry[] = [], cabin: T.BufferGeometry[] = []
  const mirrorShells: T.BufferGeometry[] = [], mirrorMounts: T.BufferGeometry[] = []
  const part = (to: T.BufferGeometry[], surface: Surface, out: Point, length = n, width = k, thickness = .002) => {
    to.push(patch(surface, length, width, out, thickness))
  }
  const gap = .00055
  const frontEnd = (v: number) => v <= .818 ? cabFront(v / .818) : mix(cabFront(1), .295, (v - .818) / .182)
  for (const side of [1, -1]) {
    const mirror = (p: Point): Point => [p[0] * side, p[1], p[2]]
    const sided = (f: Surface): Surface => (u, v) => mirror(f(u, v))
    const uSide: Point = [side, 0, 0]
    part(paint, sided((u, v) => {
      const s = mix(0, frontEnd(v) - gap, u)
      return bonnet(s, v)
    }), [0, 1, 0])
    part(paint, sided((u, v) => {
      const s = mix(frontEnd(mix(.817, 1, v)) + gap, .599, u)
      const q = mix(.817, 1, v)
      const front = bonnet(s, q)
      const inside = edgeGlass(s, 0)
      const w = wingEdge(s)
      const cabin: Point = [mix(inside[0], w.x - shoulderInset(s), v), mix(inside[1], w.y, v), zAt(s)]
      return blend(front, cabin, smooth(s, .272, .335))
    }), [0, 1, 0])
    for (const [a, b] of [[.071, frontEnd(1) - gap], [frontEnd(1) + gap, .331]]) {
      part(paint, sided((u, v) => {
        const s = mix(a, b, u)
        const w = wingEdge(s)
        const angle = w.angle * (1 - v)
        return [w.width - w.radius + w.radius * Math.cos(angle), w.outer + w.radius * Math.sin(angle), zAt(s)]
      }), [side, 1, 0], b - a > .1 ? n : 14, 5, 0)
    }
    part(black, (u, v) => {
      const s = mix(.276, .331, u)
      return [side * (plan(s) - .095), mix(shoulder(s) - .022, .776 - .020 * u, v), zAt(s)]
    }, uSide, 18, 3, .004)

    part(paint, sided((u, v) => {
      const s = mix(.5995, .942 - .019 * v, u)
      const inside = bayEdge(s, 1)
      const outside: Point = [shoulderX(s), shoulder(s), zAt(s)]
      const forward = edgeGlass(s, 0)
      const t = smooth(s, .6, .68)
      const inX = mix(forward[0], inside[0], t)
      const inY = mix(forward[1], inside[1], t)
      return [mix(inX, outside[0], v), mix(inY, outside[1], v), zAt(s)]
    }), [0, 1, 0])
    part(paint, sided((u, v) => {
      const s = mix(.594, .676, u)
      const q = edgeGlass(s, 0)
      const t = smooth(s, .6, .68)
      const inner = bayEdge(s, 1)
      const outside: Point = [mix(q[0], inner[0], t), mix(q[1], inner[1], t), zAt(s)]
      const roofEnd: Point = [mix(.490, inner[0], t), spine(s), zAt(s)]
      return blend(roofEnd, outside, smooth(v, 0, 1))
    }), [0, 1, 0])
    part(paint, sided((u, v) => {
      const x = v * .935
      const s0 = .896 + .009 * v
      const y = tailLipY(x)
      const end = fascia(false, 1, x, y)
      const s1 = sAt(end[2]) - .004 * (1 - smooth(x, .038, .131))
      const s = mix(Math.min(s0, s1 - .014), s1, u)
      return [x, y + .027 * (1 - u), zAt(s)]
    }), [0, 1, 0])

    const archEnds = (w: WheelSize) => {
      const a = Math.asin((w.loaded - floorY) / w.arch)
      return { theta0: -a, theta1: Math.PI + a, before: sAt(w.z + Math.cos(a) * w.arch), after: sAt(w.z - Math.cos(a) * w.arch) }
    }
    const arch = (w: WheelSize) => {
      const { theta0, theta1, before, after } = archEnds(w)
      const lower = (u: number): Point => {
        const theta = mix(theta0, theta1, u)
        const faceted = w.arch * (1 + .012 * Math.cos(6 * theta) * Math.sin(Math.PI * u) ** 2)
        const s = sAt(w.z + Math.cos(theta) * faceted)
        return sidePoint(s, w.loaded + Math.sin(theta) * faceted, side)
      }
      const archPanel = (u: number, v: number): Point => {
        const a = lower(u)
        const s = mix(sAt(a[2]), mix(before, after, u), v)
        return sidePoint(s, mix(a[1], shoulder(s), v), side)
      }
      part(paint, (u, v) => archPanel(u, mix(.028, 1, v)), uSide, n * 2, k)
      part(paint, (u, v) => {
        const p = archPanel(u, mix(0, .028, v))
        return [side * Math.min(dimensions.bodyWidth / 2, Math.abs(p[0]) + .0025 * Math.sin(Math.PI * v)), p[1], p[2]]
      }, uSide, n * 2, 6, .006)
      const wellX = w.x - w.width / 2 - .025
      const well = (u: number, v: number): Point => {
        const p = lower(u)
        const angle = mix(theta0, theta1, u)
        const depth = .012 * Math.sin(Math.PI * v)
        return [side * mix(Math.abs(p[0]) - .002, wellX, v), p[1] + depth * Math.sin(angle), p[2] + depth * Math.cos(angle)]
      }
      part(black, well, [0, -1, 0], n * 2, 10, .006)
      part(black, (u, v) => {
        const p = well(u, 1)
        return [p[0], mix(.126, p[1], v), p[2]]
      }, uSide, n * 2, 3, .005)
    }
    arch(frontWheel)
    arch(rearWheel)

    const first = archEnds(frontWheel)
    const last = archEnds(rearWheel)
    const sillPoint = (s: number, y: number) => sidePoint(s, y, side)
    const cutLeading = curve([[0, .374], [.17, .377], [.37, .352], [.56, .323], [.71, .307], [.86, .321], [1, .349]])
    const intakeLeft = curve([[0, .617], [.18, .601], [.49, .570], [1, .538]])
    const intakeRight = curve([[0, .617], [.27, .647], [.55, .626], [1, .590]])
    const intakeBottom = .332, intakeTopLeft = .686, intakeTopRight = .708
    const leftY = (v: number) => mix(intakeBottom, intakeTopLeft, v)
    const rightY = (v: number) => mix(intakeBottom, intakeTopRight, v)
    const doorLeadAt = (y: number) => {
      let a = 0, b = 1
      for (let i = 0; i < 14; i++) {
        const q = (a + b) / 2, s = cutLeading(q)
        if (mix(rockerY(s), shoulder(s), q) < y) a = q
        else b = q
      }
      return cutLeading((a + b) / 2)
    }
    const cap = (s: number, v: number): Point => sillPoint(s, mix(rockerY(s), shoulder(s), v))
    part(black, (u, v) => {
      const s = mix(.130, .149, u)
      return [side * (plan(s) - .083), mix(shoulder(s) - .086, shoulder(s) + .008, v), zAt(s)]
    }, uSide, 8, 5, .006)
    part(black, (u, v) => {
      const s = cutLeading(v) + mix(-.009, .011, u)
      const p = cap(s, v)
      return [p[0] - side * mix(.007, .034, smooth(v, 0, .085) * (1 - smooth(v, .91, 1))), p[1], p[2]]
    }, uSide, 5, n, .006)
    part(black, (u, v) => {
      const s = mix(.510, .686, u)
      const p = sillPoint(s, mix(.314, shoulder(s) + .003, v))
      return [p[0] - side * .202, p[1], p[2]]
    }, uSide, 25, 8, .006)
    part(black, (u, v) => {
      const s = mix(.594, .610, u)
      return [side * .550, mix(.818, .926, v), zAt(s)]
    }, uSide, 5, 5, .006)
    part(black, (u, v) => {
      const s = mix(.887, .989, u)
      const p = sillPoint(s, mix(.542, shoulder(s) - .006, v))
      return [side * (Math.abs(p[0]) * .62), p[1], p[2]]
    }, uSide, 24, 7, .008)
    part(paint, (u, v) => cap(mix(.141, first.before, u), v), uSide, n, k)
    part(paint, (u, v) => {
      const s = mix(first.after, cutLeading(v) - gap, u)
      return cap(s, v)
    }, uSide, n, k)
    part(paint, (u, v) => {
      const y = mix(.136, intakeBottom, v)
      return sillPoint(mix(doorLeadAt(y) + gap, last.before, u), y)
    }, uSide, n, k)
    part(paint, (u, v) => {
      const y = leftY(v)
      return sillPoint(mix(doorLeadAt(y) + gap, intakeLeft(v), u), y)
    }, uSide, n, k)
    part(paint, (u, v) => {
      const y = rightY(v)
      return sillPoint(mix(intakeRight(v), last.before, u), y)
    }, uSide, n, 10)
    for (const [a, b, y0, y1] of [
      [doorLeadAt(intakeTopLeft) + gap, intakeLeft(1), intakeTopLeft, intakeTopLeft],
      [intakeLeft(1), intakeRight(1), intakeTopLeft, intakeTopRight],
      [intakeRight(1), last.before, intakeTopRight, intakeTopRight],
    ]) part(paint, (u, v) => {
      const s = mix(a, b, u)
      const lead = a < .5 ? mix(a, cutLeading(1) + gap, v) - a : 0
      return sillPoint(s + lead * (1 - u), mix(mix(y0, y1, u), shoulder(s + lead * (1 - u)), v))
    }, uSide, n, 13)
    const rearCorner = (u: number) => mix(.19, .64, u)
    part(paint, (u, v) => cap(mix(last.after, .926, u), mix(rearCorner(u), 1, v)), uSide, n, k)
    part(black, (u, v) => cap(mix(last.after, .926, u), rearCorner(u) * v), uSide, n, 6)
    part(black, (u, v) => {
      const s = mix(.926, .995, u)
      const low = mix(.173, .397, u ** 1.55)
      const high = mix(cap(.926, rearCorner(1))[1], .587, u)
      const x = mix(cap(.926, rearCorner(1))[0] * side, .512, u) - .035 * (1 - v)
      return [side * x, mix(low, high, v), zAt(s)]
    }, uSide, n, 5, .007)
    const intake = (u: number, v: number, inset: number): Point => {
      const s = mix(intakeLeft(v), intakeRight(v), u)
      const p = sillPoint(s, mix(leftY(v), rightY(v), u))
      return [p[0] - side * inset, p[1], p[2]]
    }
    part(black, (u, v) => intake(u, v, .120), uSide, 18, 20, .005)
    for (const wall of [
      (u: number, v: number) => intake(0, u, .120 * v),
      (u: number, v: number) => intake(1, u, .120 * v),
      (u: number, v: number) => intake(u, 1, .120 * v),
    ]) part(black, wall, uSide, 20, 6, .004)
    part(black, (u, v) => intake(mix(.032, .965, u), .81 + .021 * v, mix(.102, .118, v)), uSide, 20, 4, .005)
    part(black, (u, v) => {
      const y = mix(.158, .421, u)
      const p = sillPoint(diagonalS(y) + .00036 * v * smooth(u, 0, .08), y)
      return [p[0] + side * .0009, p[1], p[2]]
    }, uSide, n, 2)

    part(black, (u, v) => {
      const s = mix(first.after, last.before, u)
      return [side * (plan(s) - .009 - .059 * (1 - v)), rockerY(s) - .017 * (1 - v) + .037 * v, zAt(s)]
    }, uSide, n, 8, .013)
    part(black, (u, v) => {
      const s = mix(first.after, last.before, u)
      return [side * (plan(s) - .011 - .16 * v), floorY - .006, zAt(s)]
    }, [0, -1, 0], n, 8, .009)

    const window: Surface = (u, v) => {
      const s = mix(.265 + .001 * v, .646 - .003 * v, u)
      return mirror(edgeGlass(s, v))
    }
    if (full) {
      const ledge = (u: number, v: number) => window(u, v)
      part(paint, (u, v) => ledge(u, mix(0, .103, v)), uSide, n, 7, .0075)
      part(paint, (u, v) => ledge(u, mix(.914, 1, v)), uSide, n, 7, .0075)
      part(paint, (u, v) => ledge(mix(0, .059, u), mix(.096, .922, v)), uSide, 9, k, .006)
      part(paint, (u, v) => ledge(mix(.955, 1, u), mix(.096, .922, v)), uSide, 9, k, .006)
      part(black, (u, v) => {
        const p = ledge(u, mix(0, .16, v))
        return [p[0] - side * .018, p[1] - .008, p[2]]
      }, uSide, n, 9, .025)
    } else part(paint, window, uSide, n, k, .002)
    const windowGlass: Surface = (u, v) => {
      const s = mix(.278 + .008 * v, .637 - .005 * v, u)
      const p = mirror(edgeGlass(s, mix(.09, .92, v)))
      return [p[0] + side * .0038, p[1], p[2]]
    }
    add(parent, 'door and quarter glass', patch(windowGlass, n, k, uSide, .0032), m.glass)
    black.push(contour(Array.from({ length: 17 }, (_, i) => windowGlass(.760 + .015 * i / 16, i / 16)), .0075))
    const outline = [[0, 0, 1, 0], [1, 0, 1, 1], [1, 1, 0, 1], [0, 1, 0, 0]].flatMap(([a, b, c, d]) =>
      Array.from({ length: 8 }, (_, i) => windowGlass(mix(a, c, i / 8), mix(b, d, i / 8))))
    black.push(contour(outline, .0035, true))

    const far = dimensions.mirrorWidth / 2
    const mirrorFace: Point[] = [[.910, .815, zAt(.365)], [.936, .801, zAt(.367)],
      [far - .026, .807, zAt(.374)], [far - .003, .830, zAt(.373)], [far - .003, .870, zAt(.368)],
      [far - .040, .892, zAt(.364)], [.949, .880, zAt(.358)], [.912, .851, zAt(.359)]]
    const center: Point = [1.024, .848, zAt(.368)]
    const section = (scale: number, dx: number, dy: number, dz: number) => roundedPath(mirrorFace.map((p) => {
      const q = blend(center, p, scale)
      return mirror([q[0] + dx, q[1] + dy, q[2] + dz])
    }), 3, .13)
    const rings = [section(.97, 0, 0, 0), section(1, .003, 0, .018), section(.61, -.027, .012, .119), section(.23, -.044, .008, .145)]
    for (let r = 1; r < rings.length; r++) {
      const a = rings[r - 1], b = rings[r]
      const at = (loop: Point[], u: number) => {
        const i = Math.floor(u * loop.length)
        return blend(loop[i % loop.length], loop[(i + 1) % loop.length], u * loop.length - i)
      }
      const rim = (u: number, v: number) => blend(at(a, u), at(b, u), v)
      for (let i = 0; i < a.length; i++) {
        const middle = rim((i + .5) / a.length, .5)
        const normal: Point = [middle[0] - side * (center[0] - .020 * r), middle[1] - center[1], 0]
        part(mirrorShells, (u, v) => rim((i + u) / a.length, v), normal, 1, 1)
      }
    }
    mirrorShells.push(polygon(rings[3], [0, 0, 1]))
    mirrorMounts.push(polygon(rings[0], [0, 0, -1], .010))
    steel.push(polygon(section(.79, .006, 0, -.004), [0, 0, -1], .002))
    const foot: Point[] = [[.805, .756, zAt(.337)], [.826, .749, zAt(.357)],
      [1.015, .823, zAt(.361)], [.968, .840, zAt(.347)]].map((p) => mirror(p as unknown as Point))
    mirrorMounts.push(polygon(roundedPath(foot), uSide, .026))

    const doorHandle = (u: number, v: number): Point => {
      const s = mix(.601, .626, u)
      const p = sidePoint(s, .835 + .022 * v + .021 * u, side)
      return [p[0] + side * .022, p[1], p[2]]
    }
    part(black, doorHandle, uSide, 8, 4)
  }

  const windshield: Surface = (u, v) => forwardWind(u, 2 * v - 1)
  add(parent, 'windscreen', patch(windshield, n, k * 2, [0, 1, 1], .0048), m.glass)
  part(paint, (u, v) => roof(mix(.4165, .5965, u), 2 * v - 1), [0, 1, 0], n, k * 2, .004)
  for (const v of [0, 1]) {
    const p = (u: number) => windshield(u, v)
    if (full) {
      part(paint, (u, w) => {
        const a = p(u)
        return blend(windshield(u, mix(v, .5, .017)), [a[0] + (2 * v - 1) * .010, a[1] - .0035, a[2]], w)
      }, [0, 1, 1], n, 7, .009)
    } else paint.push(contour(Array.from({ length: 17 }, (_, i) => p(i / 16)), .014))
    black.push(contour(Array.from({ length: 17 }, (_, i) => windshield(i / 16, mix(v, .5, .029))), .004))
  }
  black.push(contour(Array.from({ length: 21 }, (_, i) => windshield(.008, i / 20)), .0061))
  const hatch: Surface = (u, v) => blend(roof(.597, mix(-.89, .89, v)), [mix(-.41, .41, v), .951, zAt(.665)], u)
  add(parent, 'recessed rear window', patch(hatch, n, k, [0, 1, -1], .0041), m.glass)
  black.push(contour(Array.from({ length: 15 }, (_, i) => hatch(.97, i / 14)), .009))

  part(black, (u, v) => [mix(-.71, .71, v), .159, zAt(mix(.057, .947, u))], [0, -1, 0], 12, 9, .011)
  part(black, (u, v) => [mix(-.64, .64, v) * (1 - .2 * u), mix(.61, .819, u) + .017 * Math.sin(Math.PI * v), zAt(mix(.198, .304, u))], [0, 1, 0], 16, 12, .025)
  for (const side of [1, -1]) {
    const seatProfile = curve([[0, .36], [.29, .414], [.55, .404], [.68, .32], [.80, .209], [.95, .178], [1, .127]])
    const seat = (u: number, v: number): Point => {
      const wing = Math.cos(tau * v) * .032 + .018 * Math.sin(Math.PI * v)
      const x = side * .338 + (v - .5) * seatProfile(u)
      return [x, mix(.48, 1.018, u) - .032 * Math.abs(v - .5) ** 2.6, zAt(mix(.442, .567, u)) + wing]
    }
    part(full ? cabin : black, seat, [0, 0, 1], full ? 56 : 20, full ? 24 : 14, .055)
    if (full) {
      const cushion = (u: number, v: number): Point => {
        const x = side * .338 + (v - .5) * (.382 + .042 * Math.sin(Math.PI * u))
        return [x, .47 + .022 * (2 * v - 1) ** 4 + .025 * Math.sin(Math.PI * u), zAt(mix(.360, .467, u))]
      }
      part(cabin, cushion, [0, 1, 0], 32, 22, .035)
      for (const p of [.13, .87]) {
        const seam = Array.from({ length: 25 }, (_, i) => {
          const q = seat(i / 24, p)
          return [q[0], q[1], q[2] + .0016] as Point
        })
        black.push(contour(seam, .0016))
      }
    }
  }
  if (full) {
    const dash = (u: number, v: number): Point => {
      const x = (v - .5) * (1.40 - .16 * u)
      return [x, mix(.775, .729, u) - .085 * Math.abs(v - .5) ** 1.45 + .011 * Math.sin(u * Math.PI), zAt(mix(.281, .342, u)) + .020 * Math.cos(v * tau)]
    }
    part(cabin, dash, [0, 1, 0], n, k, .025)
    const console = (u: number, v: number): Point => [mix(-.116, .116, v), mix(.629, .510, u) + .024 * Math.sin(v * Math.PI), zAt(mix(.343, .542, u))]
    part(cabin, console, [0, 1, 0], n, 14, .028)
    const instrument = (u: number, v: number): Point => [mix(.200, .469, u), .781 + .052 * Math.sin(u * Math.PI) - .024 * v, zAt(mix(.314, .348, v))]
    part(cabin, instrument, [0, 1, 0], n, 12, .018)
    const steeringWheel = (u: number, v: number): Point => {
      const t = u * tau, phi = v * tau
      const rad = .124 + .016 * Math.cos(phi)
      const y = (Math.min(.102, Math.max(-.095, rad * Math.cos(t)))) * .86
      return [.342 + rad * Math.sin(t), .753 + y - .007 * Math.sin(phi), zAt(.365) + .44 * y + .014 * Math.sin(phi)]
    }
    part(cabin, steeringWheel, [0, 0, -1], 100, 16, 0)
    const plate = (u: number, v: number): Point => [.342 + mix(-.043, .043, u), mix(.727, .775, v), zAt(.372) + .013 * Math.sin(Math.PI * u)]
    part(cabin, plate, [0, 0, -1], 16, 12, .022)
    for (const end of [-1, 1]) {
      const spoke = (u: number, v: number): Point => [.342 + end * mix(.037, .116, u), .740 + .021 * u + (v - .5) * .024, zAt(.369) + .014 * u]
      part(cabin, spoke, [0, 0, -1], 11, 5, .009)
    }
  }
  const skin = add(parent, 'closed body panels and returns', joined(paint), m.paint)
  add(parent, 'stowage, seals and wheelhouse liners', joined(black), m.matte)
  const mirrors = new T.Group()
  mirrors.name = 'door mirrors'
  add(mirrors, 'painted mirror shells', joined(mirrorShells), m.paint)
  add(mirrors, 'mirror mounting blades', joined(mirrorMounts), m.matte)
  add(mirrors, 'mirror glass', joined(steel), m.mirror)
  parent.add(mirrors)
  if (cabin.length) add(parent, 'covered cockpit upholstery', joined(cabin), m.cabin)
  const s = .236, v = .883
  const paintPoint = bonnet(s, v)
  const paintNormal = new T.Vector3(...bonnet(s, v + .001)).sub(new T.Vector3(...bonnet(s, v - .001)))
    .cross(new T.Vector3(...bonnet(s + .001, v)).sub(new T.Vector3(...bonnet(s - .001, v)))).normalize().toArray()
  const normal = vec(paintNormal)
  const hit = new T.Raycaster(vec(paintPoint).addScaledVector(normal, .03), normal.clone().negate(), 0, .060)
    .intersectObject(skin, false)[0]
  if (hit) return { paintPoint: hit.point.toArray(), paintNormal: hit.normal?.normalize().toArray() ?? paintNormal }
  return { paintPoint, paintNormal }
}
