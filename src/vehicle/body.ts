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
  [0, .008], [.005, .090], [.010, .173], [.017, .337], [.023, .448], [.04, .607], [.06, .739], [.08, .836], [.10, .875], [.12, .914],
  [.14, .941], [.16, .973], [.18, .980], [.26, .981], [.285, .98], [.31, .961], [.34, .969], [.4, .980], [.48, .988],
  [.55, .992], [.62, .994], [.70, .998], [.747, 1.009], [.766, dimensions.bodyWidth / 2], [.825, dimensions.bodyWidth / 2],
  [.857, 1.009], [.88, .973], [.90, .933], [.92, .896], [.94, .824], [.96, .691], [.98, .535], [.995, .39], [1, .23],
])
const frontWidth = curve([
  [0, .0008], [.090, .0058], [.173, .0108], [.337, .0178], [.448, .0238], [.607, .04], [.739, .06], [.836, .08], [.875, .10], [.914, .12], [.941, .14], [.973, .16], [.982, .18],
])
const nosePlan = curve([[0, 0], [.155, .005], [.239, .01], [.318, .015], [.427, .02], [.543, .03], [.682, .05], [.739, .06], [.836, .08], [.916, .12], [.982, .18]])
const tailWidth = curve([
  [0, .9875], [.39, .985], [.535, .979], [.69, .958], [.824, .939], [.875, .929], [.918, .920], [.947, .902], [.980, .876], [1.012, .855],
])
const tailPlan = curve([[0, 1], [.426, 1], [.437, .995], [.451, .99], [.543, .98], [.657, .97], [.701, .96], [.771, .95], [.837, .94], [.909, .92], [.946, .90], [.986, .88], [1.0165, .825]])
export const limitTailZ = (x: number, z: number) => Math.max(zAt(tailPlan(Math.abs(x))), z)
const shoulder = curve([
  [0, .431], [.016, .447], [.024, .465], [.044, .552], [.08, .623], [.10, .658], [.15, .735], [.20, .779], [.25, .772],
  [.30, .738], [.34, .729], [.40, .725], [.51, .759], [.59, .821], [.67, .881], [.736, .936],
  [.793, .943], [.85, .918], [.89, .888], [.92, .865], [.96, .848], [1, .833],
])
const hoodLine = curve([[0, .431], [.024, .449], [.06, .523], [.105, .608], [.165, .716], [.225, .761], [.265, .769], [.33, .764], [.6, .83]])
const spine = curve([
  [.575, 1.149], [.6, 1.146], [.62, 1.135], [.64, 1.124], [.66, 1.099], [.68, 1.085], [.70, 1.078], [.72, 1.068],
  [.742, 1.056], [.769, 1.040], [.80, 1.02], [.82, 1.011], [.85, .983], [.88, .963], [.90, .957], [.92, .941], [.94, .926], [.96, .908], [.984, .898],
])
const hoodTipS = .0605
const hoodTipX = .472
const hoodInner = (s: number) => hoodTipX - 1.425 * (s - hoodTipS)
const hoodOuter = (s: number) => hoodTipX + 1.955 * (s - hoodTipS)
const lampFold = curve([[.043, .460], [.091, .657], [.136, .834], [.158, .895], [.182, .958]])
const hoodShut = (v: number) => .166 + .098 * v ** 2.18
const cowlStep = (v: number) => .191 + .073 * v ** 2.35
const cabFront = (v: number) => .206 + .058 * v ** 2.50
const wingRadius = (s: number) => .004 * smooth(s, .071, .099) * (1 - smooth(s, .295, .331))
const sideDent = curve([[.29, 0], [.36, .020], [.53, .099], [.625, .123], [.746, 0]])
const rockerY = curve([[0, .155], [.04, .136], [.25, .136], [.69, .136], [.86, .137], [.90, .153], [.95, .187], [1, .40]])
const shoulderInset = (s: number) => .024 * smooth(s, .322, .407) * (1 - smooth(s, .660, .743))
const shoulderX = (s: number) => plan(s) - shoulderInset(s)
const diagonalS = (y: number) => .529 + .119 * (y - .331)
const doorBelt = curve([[.295, .568], [.380, .608], [.460, .650], [.538, .688], [.593, .722], [.650, .783], [.701, .854], [.760, .896], [.812, .924], [.855, .920], [.899, .890]])
const heelFold = curve([[.382, .272], [.530, .338], [.597, .375], [.712, .432]])
const haunchFold = (s: number) => .899 - 2.80 * (s - .682)
const deckIn = curve([[.610, .608], [.670, .641], [.750, .686], [.820, .729], [.856, .762]])
const deckOut = curve([[.697, .942], [.741, .899], [.789, .849], [.828, .798], [.856, .762]])
const foldRadius = .004
const foldAngle = T.MathUtils.degToRad(20)
const foldSlope = Math.tan(foldAngle)
const foldHalf = foldRadius * Math.sin(foldAngle / 2)
const foldTangent = Math.tan(foldAngle / 2)

function hinge(t: number, width: number): number {
  if (t <= -width) return 0
  if (t >= width) return t
  const x = t / width * foldHalf
  const bend = foldRadius - Math.sqrt(foldRadius ** 2 - x ** 2)
  const end = foldRadius - Math.sqrt(foldRadius ** 2 - foldHalf ** 2)
  return (t + width) / 2 + (bend - end) * width / (2 * foldHalf * foldTangent)
}

function sidePoint(s: number, y: number, side: number): Point {
  const span = shoulder(s) - rockerY(s)
  const q = T.MathUtils.clamp((y - rockerY(s)) / span, 0, 1)
  const sill = .059 * (1 - q) ** 5
  const thickness = shoulderInset(s)
  const dent = sideDent(s) * 2.5 * q * (1 - q) ** 2
  const face = .007 * Math.sin(Math.PI * q) * smooth(s, .27, .37)
  const fold = (line: number, first: number, direction: number) => {
    const t = y - line
    const base = mix(hinge(rockerY(s) - line, foldHalf), hinge(shoulder(s) - line, foldHalf), q)
    return direction * first * foldSlope * (hinge(t, foldHalf) - base)
  }
  const belt = fold(doorBelt(s), smooth(s, .271, .302) * (1 - smooth(s, .895, .928)), -.84)
  const heel = fold(heelFold(s), smooth(s, .352, .383) * (1 - smooth(s, .700, .735)), .84)
  const haunch = fold(haunchFold(s), smooth(s, .644, .666) * (1 - smooth(s, .756, .786)), -.68)
  const inset = Math.max(0, sill + thickness * q + dent + face + belt + heel + haunch)
  return [side * (plan(s) - inset), y, zAt(s)]
}

function wingEdge(s: number) {
  const width = plan(s)
  const center = hoodLine(s), outer = shoulder(s)
  const radius = wingRadius(s)
  const angle = Math.PI / 2 + Math.atan((outer - center) / width - .050)
  const x = width - radius + radius * Math.cos(angle)
  const y = outer + radius * Math.sin(angle)
  return { width, center, outer, radius, angle, x, y }
}

function bonnet(s: number, v: number): Point {
  const w = wingEdge(s), x = w.x * v
  const section = (position: number) => (hinge(position - hoodInner(s), foldHalf) - hinge(position - hoodOuter(s), foldHalf))
    * smooth(s, hoodTipS - .00025, hoodTipS + .001) * (1 - smooth(s, .290, .326))
    + .80 * smooth(s, .041, .050) * (1 - smooth(s, .163, .190)) * hinge(position - lampFold(s), foldHalf)
  const across = -.83 * foldSlope * (section(x) - mix(section(0), section(w.x), v))
  const base = mix(w.center, w.y, v * v * (2 - v) + .05 * v ** 6 * (1 - v))
  const cowlDrop = .021 * smooth(s, .127, .236) * (1 - v ** 3)
    - .015 * smooth(s, .122, .189) * (1 - smooth(s, .260, .317)) * (1 - smooth(v, .819, 1))
  return [x, base + across - cowlDrop, zAt(s)]
}

function foldRows(surface: Surface, traces: ((p: Point) => number)[], broad: number) {
  const rows = (traces.length + 1) * broad + traces.length * 4
  const cache = new Map<number, number[]>()
  return { rows, at: (u: number, j: number) => {
    let marks = cache.get(u)
    if (!marks) {
      const ends = (trace: (p: Point) => number) => {
        const start = trace(surface(u, 0)), end = trace(surface(u, 1))
        const sign = Math.sign(end - start) || 1
        const root = (offset: number) => {
          if (sign * (start - offset) >= 0) return 0
          if (sign * (end - offset) <= 0) return 1
          let l = 0, r = 1
          for (let i = 0; i < 19; i++) {
            const m = (l + r) / 2
            if (sign * (trace(surface(u, m)) - offset) < 0) l = m
            else r = m
          }
          return (l + r) / 2
        }
        return [root(-sign * foldHalf), root(sign * foldHalf)]
      }
      const spans = traces.map(ends).sort((a, b) => a[0] - b[0])
      marks = [0]
      const stride = (end: number, count: number) => {
        const start = marks!.at(-1)!
        for (let i = 1; i <= count; i++) marks!.push(mix(start, Math.max(start, end), i / count))
      }
      for (const [a, b] of spans) { stride(a, broad); stride(b, 4) }
      stride(1, broad)
      cache.set(u, marks)
    }
    return marks[j]
  } }
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
const roofWidth = curve([[.417, .637], [.46, .645], [.51, .652], [.56, .620], [.595, .552], [.625, .49]])
const roofHeight = curve([[.417, 1.122], [.445, 1.14], [.472, 1.157], [.5, 1.16], [.545, 1.16], [.578, 1.153], [.595, 1.15]])
const roofCross = curve([[0, -.019], [.25, -.019], [.37, -.016], [.48, 0], [.66, -.006], [.84, -.018], [1, -.042]])
const roofRidge = .318
const roof = (s: number, v: number): Point => {
  const width = roofWidth(s), x = Math.abs(v) * width
  const inner = hinge(roofRidge - x, foldHalf), outer = hinge(x - roofRidge, foldHalf)
  const innerFall = .183 * inner * (1 - inner / roofRidge) ** 2 + .019 * smooth(inner, 0, roofRidge)
  const run = width - roofRidge
  const outerFall = .042 * (1 - Math.max(0, 1 - outer / run) ** (.174 * run / .042))
  const crown = mix(roofCross(Math.abs(v)), -innerFall - outerFall, smooth(s, .4175, .425) * (1 - smooth(s, .589, .5965)))
  return [width * v, roofHeight(s) + crown, zAt(s)]
}
const glassLowerX = curve([[.264, cowl(1)[0]], [.35, .844], [.46, .822], [.55, .790], [.60, .723], [.65, .576]])
const glassLowerY = curve([[.264, cowl(1)[1]], [.35, .750], [.45, .785], [.55, .851], [.60, .918], [.65, .959]])
const glassUpperY = curve([[.261, cowl(1)[1]], [.30, .94], [.35, 1.01], [.40, 1.064], [.417, roof(.417, 1)[1]], [.46, roof(.46, 1)[1]], [.51, roof(.51, 1)[1]], [.565, roof(.565, 1)[1]], [.595, roof(.595, 1)[1]], [.625, 1.048], [.65, .959]])
const glassUpperX = curve([[.261, .803], [.30, .756], [.35, .697], [.40, .645], [.417, .637], [.46, .645], [.51, .652], [.565, .615], [.595, .552], [.625, .552], [.65, .576]])
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
    return [x * side, y, Math.min(zAt(nosePlan(Math.abs(x))), zAt(s) - recess)]
  }
  const s = tailWidth(x) + (.010 * smooth(y, .58, .81)) - .009 * smooth(y, .84, .94)
  const inset = .070 * smooth(y, .47, .70) * (1 - .78 * smooth(x, .32, .70))
  return [x * side, y, limitTailZ(x, zAt(s) + recess + inset)]
}

export function createBody(parent: T.Group, m: Palette, full: boolean): { paintPoint: Point; paintNormal: Point } {
  const n = full ? 64 : 31, k = full ? 26 : 13
  const paint: T.BufferGeometry[] = [], black: T.BufferGeometry[] = []
  const steel: T.BufferGeometry[] = [], cabin: T.BufferGeometry[] = []
  const mirrorShells: T.BufferGeometry[] = [], mirrorMounts: T.BufferGeometry[] = []
  const part = (to: T.BufferGeometry[], surface: Surface, out: Point, length = n, width = k, thickness = .002) => {
    to.push(patch(surface, length, width, out, thickness))
  }
  const folded = (surface: Surface, out: Point, traces: ((p: Point) => number)[], length = n, thickness = .002, broad = full ? 6 : 3) => {
    const { rows, at } = foldRows(surface, traces, broad)
    paint.push(patch(surface, length, rows, out, thickness, at))
  }
  const lateralTrace = (line: (s: number) => number) => (p: Point) => Math.abs(p[0]) - line(sAt(p[2]))
  const hoodTraces = [hoodInner, hoodOuter, lampFold].map(lateralTrace)
  const sideTrace = (line: (s: number) => number) => (p: Point) => p[1] - line(sAt(p[2]))
  const beltLine = sideTrace(doorBelt), heelLine = sideTrace(heelFold), haunchLine = sideTrace(haunchFold)
  const gap = .00055
  const frontEnd = (v: number) => v <= .818 ? hoodShut(v / .818) : mix(hoodShut(1), .295, (v - .818) / .182)
  for (const side of [1, -1]) {
    const mirror = (p: Point): Point => [p[0] * side, p[1], p[2]]
    const sided = (f: Surface): Surface => (u, v) => mirror(f(u, v))
    const uSide: Point = [side, 0, 0]
    folded(sided((u, v) => {
      const s = mix(0, frontEnd(v) - gap, u * (.51 + .49 * u))
      return bonnet(s, v)
    }), [0, 1, 0], hoodTraces, full ? 112 : n, .002, full ? 12 : 3)
    folded(sided((u, v) => {
      const s = mix(frontEnd(mix(.817, 1, v)) + gap, .599, u)
      const q = mix(.817, 1, v)
      const front = bonnet(s, q)
      const inside = edgeGlass(s, 0)
      const w = wingEdge(s)
      const cabin: Point = [mix(inside[0], w.x - shoulderInset(s), v), mix(inside[1], w.y, v), zAt(s)]
      return blend(front, cabin, smooth(s, .272, .335))
    }), [0, 1, 0], [hoodTraces[1]])
    const cowlFace = (s: number, v: number, drop: number): Point => {
      const p = bonnet(s, v * .818)
      return [side * p[0], p[1] - drop * (1 - v * v), p[2]]
    }
    part(paint, (u, v) => cowlFace(mix(hoodShut(v) + gap, cowlStep(v), u), v, .0025), [0, 1, 0], 6, n)
    part(black, (u, v) => cowlFace(mix(cowlStep(v), cabFront(v) + gap, u), v, mix(.006, .0016, u)), [0, 1, 0], 7, n, .003)
    part(black, (u, v) => cowlFace(mix(hoodShut(v) - .004, cabFront(v) + .003, u), v, .012), [0, 1, 0], 4, n, .003)
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
      return [side * (plan(s) - .17), mix(shoulder(s) - .047, Math.max(shoulder(s) - .014, .756), v), zAt(s)]
    }, uSide, 18, 3, .004)

    folded(sided((u, v) => {
      const s = mix(.5984, .942 - .019 * v, u)
      const inside = bayEdge(s, 1)
      const outside: Point = [shoulderX(s), shoulder(s), zAt(s)]
      const forward = edgeGlass(s, 0)
      const t = smooth(s, .6, .68)
      const inX = mix(forward[0], inside[0], t)
      const inY = mix(forward[1], inside[1], t)
      const x = mix(inX, outside[0], v)
      const section = (at: number) => hinge(at - deckIn(s), foldHalf) - hinge(at - deckOut(s), foldHalf)
      const vane = section(x) - mix(section(inX), section(outside[0]), v)
      const y = mix(inY, outside[1], v)
      const line = haunchFold(s)
      const tBend = y - line
      const flatten = mix(hinge(inY - line, foldHalf), hinge(outside[1] - line, foldHalf), v)
      const deckFold = .33 * smooth(s, .610, .665) * (1 - smooth(s, .846, .857)) * vane
      return [x, y + deckFold + .58 * smooth(s, .604, .630) * (hinge(tBend, foldHalf) - flatten), zAt(s)]
    }), [0, 1, 0], [haunchLine, lateralTrace(deckIn), lateralTrace(deckOut)])
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
      const face: Surface = (u, v) => archPanel(u, mix(.028, 1, v))
      if (w === rearWheel) folded(face, uSide, [beltLine, haunchLine], n * 2)
      else folded(face, uSide, [beltLine], n * 2)
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
    folded((u, v) => {
      const s = mix(first.after, cutLeading(v) - gap, u)
      return cap(s, v)
    }, uSide, [beltLine])
    folded((u, v) => {
      const y = mix(.136, intakeBottom, v)
      return sillPoint(mix(doorLeadAt(y) + gap, last.before, u), y)
    }, uSide, [heelLine])
    folded((u, v) => {
      const y = leftY(v)
      return sillPoint(mix(doorLeadAt(y) + gap, intakeLeft(v), u), y)
    }, uSide, [beltLine, heelLine])
    folded((u, v) => {
      const y = rightY(v)
      return sillPoint(mix(intakeRight(v), last.before, u), y)
    }, uSide, [heelLine])
    for (const [a, b, y0, y1] of [
      [doorLeadAt(intakeTopLeft) + gap, intakeLeft(1), intakeTopLeft, intakeTopLeft],
      [intakeLeft(1), intakeRight(1), intakeTopLeft, intakeTopRight],
      [intakeRight(1), last.before, intakeTopRight, intakeTopRight],
    ]) folded((u, v) => {
      const s = mix(a, b, u)
      const lead = a < .5 ? mix(a, cutLeading(1) + gap, v) - a : 0
      return sillPoint(s + lead * (1 - u), mix(mix(y0, y1, u), shoulder(s + lead * (1 - u)), v))
    }, uSide, [beltLine, haunchLine])
    const rearCorner = (u: number) => mix(.19, .64, u)
    part(paint, (u, v) => cap(mix(last.after, .926, u), mix(rearCorner(u), 1, v)), uSide, n, k)
    part(black, (u, v) => cap(mix(last.after, .926, u), rearCorner(u) * v), uSide, n, 6)
    part(black, (u, v) => {
      const s = mix(.926, .995, u)
      const low = mix(.173, .397, u ** 1.55)
      const high = mix(cap(.926, rearCorner(1))[1], .587, u)
      const x = mix(cap(.926, rearCorner(1))[0] * side, .512, u) - .035 * (1 - v)
      return [side * x, mix(low, high, v), limitTailZ(x, zAt(s))]
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
    const aperture = new T.CatmullRomCurve3(mirrorFace.map(vec), true, 'centripetal')
    const apertureMax = Math.max(...aperture.getPoints(192).map((p) => p.x))
    const apertureScale = (far - .003 - center[0]) / (apertureMax - center[0])
    const shellWidth = curve([[0, .97], [.13, 1], [.68, .72], [.88, .47], [.97, .19], [1, 0]])
    const shellDepth = curve([[0, 0], [.13, .018], [.68, .107], [.88, .133], [.97, .144], [1, .147]])
    const shellX = curve([[0, 0], [.13, .003], [.68, -.024], [.94, -.046]])
    const shellY = curve([[0, 0], [.13, 0], [.68, .010], [.94, .004]])
    const shell: Surface = (u, v) => {
      const p = aperture.getPoint(u)
      const x = (p.x - center[0]) * apertureScale, y = p.y - center[1]
      const radius = Math.hypot(x / .106, y / .046)
      const width = shellWidth(v)
      const shoulder = mix(1, 1 / radius, smooth(v, .24, .88)) * width
      const depth = mix(shellDepth(v), .147 - .0634 * width * width, smooth(v, .78, .90))
      return mirror([
        center[0] + x * shoulder + shellX(v),
        center[1] + y * shoulder + shellY(v),
        mix(center[2], p.z, (1 - v) ** 2) + depth,
      ])
    }
    const divisions = full ? 64 : 36
    const loop = (v: number) => Array.from({ length: divisions }, (_, i) => shell(i / divisions, v))
    const shellGeo = patch(shell, divisions, full ? 28 : 16, [side, 0, 0])
    const shellNormals = shellGeo.getAttribute('normal')
    for (let i = shellNormals.count - divisions - 1; i < shellNormals.count; i++) shellNormals.setXYZ(i, 0, 0, 1)
    mirrorShells.push(shellGeo)
    mirrorMounts.push(polygon(loop(0), [0, 0, -1], .010))
    steel.push(polygon(section(.79, .006, 0, -.004), [0, 0, -1], .002))
    const stem = new T.CatmullRomCurve3([
      [.799, .750, zAt(.346)], [.850, .762, zAt(.346)], [.924, .792, zAt(.350)],
      [.991, .824, zAt(.354)], [1.029, .844, zAt(.355)],
    ].map(([x, y, z]) => new T.Vector3(x, y, z)), false, 'centripetal')
    const stalkDepth = curve([[0, .035], [.25, .033], [.66, .024], [1, .031]])
    const stalkHeight = curve([[0, .014], [.25, .013], [.68, .010], [1, .017]])
    part(mirrorMounts, (u, v) => {
      const p = stem.getPoint(u), t = stem.getTangent(u)
      const width = stalkDepth(u) * Math.cos(tau * v)
      const rise = stalkHeight(u) * Math.sin(tau * v)
      return mirror([p.x - t.y * rise, p.y + t.x * rise, p.z + width])
    }, [0, 0, -1], full ? 25 : 14, full ? 24 : 12, 0)

    const doorHandle = (u: number, v: number): Point => {
      const s = mix(.601, .626, u)
      const p = sidePoint(s, .835 + .022 * v + .021 * u, side)
      return [p[0] + side * .022, p[1], p[2]]
    }
    part(black, doorHandle, uSide, 8, 4)
  }

  const windshield: Surface = (u, v) => forwardWind(u, 2 * v - 1)
  add(parent, 'windscreen', patch(windshield, n, k * 2, [0, 1, 1], .0048), m.glass)
  for (const side of [1, -1]) {
    folded((u, v) => roof(mix(.4165, .5965, u), side * v), [0, 1, 0], [lateralTrace(() => roofRidge)], n, .004)
  }
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
