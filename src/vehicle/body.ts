import * as T from 'three'
import { add, blend, contour, curve, hexMesh, joined, mix, patch, polygon, roundedPath, smooth, tau, vec, type Point, type Surface } from './geometry'
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
const tailWidth = curve([
  [0, .9875], [.39, .985], [.535, .979], [.69, .959], [.824, .939], [.896, .919], [.945, .895], [.975, .877], [1.012, .855],
])
const shoulder = curve([
  [0, .407], [.016, .431], [.024, .450], [.044, .545], [.08, .618], [.10, .649], [.15, .724], [.20, .779], [.25, .772],
  [.30, .738], [.34, .729], [.40, .725], [.51, .759], [.59, .821], [.67, .881], [.736, .936],
  [.793, .943], [.85, .918], [.89, .888], [.92, .865], [.96, .848], [1, .833],
])
const hoodLine = curve([[0, .418], [.024, .437], [.06, .520], [.105, .606], [.165, .723], [.25, .783], [.33, .770], [.6, .83]])
const spine = curve([
  [.575, 1.149], [.6, 1.146], [.62, 1.135], [.64, 1.124], [.66, 1.099], [.68, 1.085], [.70, 1.078], [.72, 1.068],
  [.742, 1.056], [.769, 1.040], [.80, 1.02], [.82, 1.011], [.85, .983], [.88, .963], [.90, .957], [.92, .941], [.94, .926], [.96, .908], [.984, .898],
])
const hoodCreaseX = (s: number) => .475 - .178 * T.MathUtils.clamp((s - .059) / .141, 0, 1)
const wingRadius = (s: number) => .004 * smooth(s, .071, .099) * (1 - smooth(s, .295, .331))
const sideDent = curve([[0, 0], [.10, .006], [.34, .025], [.43, .11], [.51, .17], [.56, .215], [.62, .238], [.67, .105], [.73, .012], [1, 0]])
const rockerY = curve([[0, .155], [.04, .136], [.25, .136], [.69, .136], [.86, .137], [.90, .153], [.95, .187], [1, .40]])

function sidePoint(s: number, y: number, side: number): Point {
  const q = T.MathUtils.clamp((y - rockerY(s)) / (shoulder(s) - rockerY(s)), 0, 1)
  const sill = (.058 + .017 * smooth(s, .20, .32)) * (1 - smooth(q, 0, .21))
  const door = sideDent(s) * Math.pow(Math.sin(Math.PI * q), .8) * (1 - .35 * q)
  const crease = .018 * smooth(s, .32, .50) * (1 - smooth(s, .62, .74)) * Math.exp(-((q - .82) ** 2) / .012)
  return [side * (plan(s) - sill - door + crease * (1 - smooth(q, .83, .99))), y, zAt(s)]
}

function wingEdge(s: number) {
  const width = plan(s)
  const center = hoodLine(s), outer = shoulder(s)
  const edge = Math.min(width * .93, hoodCreaseX(s))
  const crease = smooth(s, .034, .084) * (1 - smooth(s, .244, .319))
  const ridge = mix(center, outer, .32 * edge / width) + .022 * crease
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
  return [x, mix(base, facets, crease), zAt(s)]
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

const cabFront = (v: number) => .166 + .095 * v ** 2.35
const cowl = (v: number): Point => bonnet(cabFront(v), v * .818)
const roofWidth = curve([[.417, .617], [.46, .625], [.51, .632], [.56, .60], [.595, .542], [.625, .49]])
const roofHeight = curve([[.417, 1.122], [.445, 1.14], [.472, 1.157], [.5, 1.16], [.545, 1.16], [.578, 1.153], [.595, 1.15]])
const roofCross = curve([[0, -.019], [.25, -.019], [.37, -.016], [.48, 0], [.66, -.006], [.84, -.018], [1, -.042]])
const roof = (s: number, v: number): Point => [roofWidth(s) * v, roofHeight(s) + roofCross(Math.abs(v)), zAt(s)]
const glassLowerX = curve([[.261, .803], [.32, .839], [.39, .827], [.46, .807], [.53, .779], [.58, .749], [.625, .664], [.65, .576]])
const glassLowerY = curve([[.261, cowl(1)[1]], [.32, .77], [.37, .763], [.49, .808], [.56, .862], [.60, .932], [.65, .959]])
const glassUpperY = curve([[.261, cowl(1)[1]], [.30, .94], [.35, 1.01], [.40, 1.064], [.417, roof(.417, 1)[1]], [.46, roof(.46, 1)[1]], [.51, roof(.51, 1)[1]], [.565, roof(.565, 1)[1]], [.595, roof(.595, 1)[1]], [.625, 1.048], [.65, .959]])
const glassUpperX = curve([[.261, .803], [.30, .756], [.35, .697], [.40, .625], [.417, .617], [.46, .625], [.51, .632], [.565, .595], [.595, .542], [.625, .542], [.65, .576]])
const forwardWind = (u: number, q: number): Point => {
  const p = cowl(Math.abs(q))
  const low: Point = [Math.sign(q) * p[0], p[1] + .0013, p[2]]
  const high = roof(.4175, q)
  const p1 = blend(low, high, u)
  return [p1[0], p1[1] + .022 * Math.sin(Math.PI * u) * (1 - .36 * Math.abs(q)), p1[2]]
}
const edgeGlass = (s: number, v: number): Point => {
  const q = T.MathUtils.clamp((s - cabFront(1)) / (.4175 - cabFront(1)), 0, 1)
  const upper = s < .4175 ? forwardWind(q, 1) : s < .5965 ? roof(s, 1) : [glassUpperX(s), glassUpperY(s), zAt(s)]
  return [
    mix(glassLowerX(s), upper[0], v) + .009 * Math.sin(Math.PI * v) * smooth(s, .27, .38) * (1 - smooth(s, .58, .65)),
    mix(glassLowerY(s), upper[1], v),
    zAt(s),
  ]
}

const bayWidth = curve([[.60, .36], [.641, .431], [.68, .477], [.75, .452], [.82, .389], [.873, .326], [.901, .218], [.918, .04]])
export const bayEdge = (s: number, side: number): Point => [side * bayWidth(s), spine(s) - .009, zAt(s)]

export function fascia(front: boolean, side: number, x: number, y: number, recess = 0): Point {
  if (front) {
    const s = frontWidth(x) + .002 * smooth(y, .2, .48) - .0008
    return [x * side, y, Math.min(zAt(0), zAt(s) - recess)]
  }
  const s = tailWidth(x) + (.010 * smooth(y, .58, .81)) - .009 * smooth(y, .84, .94)
  return [x * side, y, Math.max(zAt(1), zAt(s) + recess)]
}

export function createBody(parent: T.Group, m: Palette, full: boolean): { paintPoint: Point; paintNormal: Point } {
  const n = full ? 64 : 31, k = full ? 26 : 13
  const paint: T.BufferGeometry[] = [], black: T.BufferGeometry[] = [], carbon: T.BufferGeometry[] = []
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
      const cabin: Point = [mix(inside[0], w.x, v), mix(inside[1], w.y, v) + .013 * Math.sin(Math.PI * v), zAt(s)]
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

    part(paint, sided((u, v) => {
      const s = mix(.5995, .942 - .019 * v, u)
      const inside = bayEdge(s, 1)
      const outside: Point = [plan(s), shoulder(s), zAt(s)]
      const forward = edgeGlass(s, 0)
      const t = smooth(s, .6, .68)
      const inX = mix(forward[0], inside[0], t)
      const inY = mix(forward[1], inside[1], t)
      return [mix(inX, outside[0], v), mix(inY, outside[1], v ** .84) + .036 * Math.sin(Math.PI * v) * smooth(s, .60, .73), zAt(s)]
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
      const s0 = .90 + .025 * smooth(v, .45, .9)
      const end = fascia(false, 1, x, .89)
      const s1 = sAt(end[2]) - .003
      const s = mix(Math.min(s0, s1 - .004), s1, u)
      const top = mix(spine(s), shoulder(s), smooth(v, .13, 1))
      return [x, top - .020 * Math.exp(-((x - .015) ** 2) / .011) * smooth(u, .1, .94), zAt(s)]
    }), [0, 1, 0])

    const archEnds = (w: WheelSize) => {
      const a = Math.asin((w.loaded - floorY) / w.arch)
      return { theta0: -a, theta1: Math.PI + a, before: sAt(w.z + Math.cos(a) * w.arch), after: sAt(w.z - Math.cos(a) * w.arch) }
    }
    const arch = (w: WheelSize) => {
      const { theta0, theta1, before, after } = archEnds(w)
      const lower = (u: number): Point => {
        const theta = mix(theta0, theta1, u)
        const faceted = w.arch * (1 + .012 * Math.cos(6 * theta))
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
        return [p[0] + side * .0025 * Math.sin(Math.PI * v), p[1], p[2]]
      }, uSide, n * 2, 6, .006)
      part(black, (u, v) => {
        const p = lower(u)
        return [p[0] - side * mix(.004, .159, v), p[1] - .005 * v, p[2]]
      }, [0, -1, 0], n * 2, 8, .005)
    }
    arch(frontWheel)
    arch(rearWheel)

    const first = archEnds(frontWheel)
    const last = archEnds(rearWheel)
    const sillPoint = (s: number, y: number) => sidePoint(s, y, side)
    const cutLeading = curve([[0, .374], [.17, .377], [.37, .352], [.56, .323], [.71, .307], [.86, .321], [1, .349]])
    const cutTrailing = curve([[0, .545], [.23, .573], [.40, .603], [.52, .610], [.66, .575], [.86, .541], [1, .59]])
    const intakeLeft = curve([[0, .603], [.21, .604], [.55, .574], [1, .539]])
    const intakeRight = curve([[0, .623], [.25, .649], [.55, .621], [1, .590]])
    const intakeBottom = .331, intakeTop = .69
    const cap = (s: number, v: number): Point => sillPoint(s, mix(rockerY(s), shoulder(s), v))
    part(paint, (u, v) => cap(mix(.141, first.before, u), v), uSide, n, k)
    part(paint, (u, v) => {
      const s = mix(first.after, cutLeading(v) - gap, u)
      return cap(s, v)
    }, uSide, n, k)
    part(paint, (u, v) => {
      const s = mix(cutLeading(v) + gap, .573, u)
      const y = mix(rockerY(s), intakeBottom, v)
      return sillPoint(mix(cutLeading((y - rockerY(s)) / (shoulder(s) - rockerY(s))) + gap, intakeLeft(0), u), y)
    }, uSide, n, k)
    part(paint, (u, v) => {
      const y = mix(intakeBottom, intakeTop, v)
      const yQ = (y - .136) / (.757 - .136)
      const s = mix(cutLeading(yQ) + gap, intakeLeft(v) - gap, u)
      return sillPoint(s, y)
    }, uSide, n, k)
    part(paint, (u, v) => {
      const s = mix(cutLeading(mix(.89, 1, v)) + gap, mix(intakeLeft(1), cutTrailing(1), v) - gap, u)
      return sillPoint(s, mix(intakeTop, Math.max(intakeTop + .019, shoulder(s)), v))
    }, uSide, n, 10)
    part(paint, (u, v) => {
      const s = mix(intakeLeft(0), last.before, u)
      return sillPoint(s, mix(rockerY(s), intakeBottom, v))
    }, uSide, n, k)
    part(paint, (u, v) => {
      const s = mix(intakeRight(v) + gap, last.before, u)
      return sillPoint(s, mix(intakeBottom, intakeTop, v))
    }, uSide, n, k)
    part(paint, (u, v) => {
      const s = mix(mix(intakeRight(1), cutTrailing(1), v) + gap, last.before, u)
      return sillPoint(s, mix(intakeTop, shoulder(s), v))
    }, uSide, n, 12)
    part(paint, (u, v) => cap(mix(last.after, .926, u), v), uSide, n, k)
    const intake = (u: number, v: number, inset: number): Point => {
      const s = mix(intakeLeft(v), intakeRight(v), u)
      const p = sillPoint(s, mix(intakeBottom, intakeTop, v))
      return [p[0] - side * inset, p[1], p[2]]
    }
    part(black, (u, v) => intake(u, v, full ? .134 + .045 * u : .079 + .035 * u), uSide, 18, 20)
    for (const wall of [
      (u: number, v: number) => intake(0, u, .11 * v),
      (u: number, v: number) => intake(1, u, .114 * v),
      (u: number, v: number) => intake(u, 0, .114 * v),
      (u: number, v: number) => intake(u, 1, .114 * v),
    ]) part(carbon, wall, uSide, 20, 6)
    if (full) {
      const grille = (u: number, v: number): Point => intake(.04 + .93 * u, .04 + .90 * v, .116 + .040 * u)
      carbon.push(hexMesh(grille, .21, .34, .013, .00135))
      for (let i = 0; i < 3; i++) {
        const h = .18 + .29 * i
        part(carbon, (u, v) => intake(mix(.016, .983, u), h + .022 * v, .075 + .042 * v), uSide, 20, 4, .003)
      }
    }

    part(black, (u, v) => {
      const s = mix(first.after, last.before, u)
      return [side * (plan(s) - .009 - .059 * (1 - v)), rockerY(s) - .017 * (1 - v) + .037 * v, zAt(s)]
    }, uSide, n, 8, .013)
    part(black, (u, v) => {
      const s = mix(first.after, last.before, u)
      return [side * (plan(s) - .011 - .16 * v), floorY - .006, zAt(s)]
    }, [0, -1, 0], n, 8, .009)

    const window: Surface = (u, v) => {
      const s = mix(.263 + .002 * v, .649 - .004 * v, u)
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
    const outline: Point[] = [[0, 0], [.25, 0], [.50, 0], [.75, 0], [1, 0], [1, .5], [1, 1], [.75, 1], [.5, 1], [.25, 1], [0, 1], [0, .5]].map(([u, v]) => windowGlass(u, v))
    black.push(contour(outline, .0035, true))

    const mirrorSection = (u: number, v: number): Point => {
      const x = mix(.886, dimensions.mirrorWidth / 2, u)
      const theta = v * Math.PI * 2
      const radial = Math.sin(Math.PI * (u * .94 + .03)) ** .57
      const sharpen = (a: number) => Math.sign(a) * Math.pow(Math.abs(a), full ? .55 : 1)
      return [side * x, mix(.861, .849, u) + radial * (.058 * sharpen(Math.cos(theta)) + .009 * Math.sin(theta)), zAt(mix(.326, .381, u)) + radial * .137 * sharpen(Math.sin(theta))]
    }
    part(mirrorShells, mirrorSection, uSide, k, n, .002)
    const foot: Point[] = [[.827, .785, zAt(.333)], [.877, .760, zAt(.351)], [.966, .833, zAt(.355)], [.931, .864, zAt(.342)]].map((p) => mirror(p as unknown as Point))
    mirrorMounts.push(polygon(roundedPath(foot), uSide, .032))
    const mirrorBack = (u: number, v: number): Point => {
      const p = mirrorSection(mix(.13, .975, u), mix(.56, .90, v))
      return [p[0], p[1], p[2] - .003]
    }
    part(steel, mirrorBack, [0, 0, -1], 16, 12, .002)

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
  add(parent, 'intake returns', joined(carbon), m.carbon)
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
