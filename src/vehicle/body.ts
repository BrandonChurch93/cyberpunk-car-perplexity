import * as T from 'three'
import { add, blend, contour, curve, joined, mix, patch, polygon, smooth, tau, vec, type Point, type Surface } from './geometry'
import type { Palette } from './materials'
import { addMirrors } from './mirror'

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
  [.14, .941], [.16, .973], [.18, .980], [.26, .981], [.285, .98], [.31, .961], [.34, .969], [.4, .999], [.48, 1.007],
  [.55, 1.013], [.62, 1.016], [.67, 1.016], [.70, 1.0125], [.747, 1.010], [.766, dimensions.bodyWidth / 2], [.825, dimensions.bodyWidth / 2],
  [.857, 1.009], [.88, .973], [.90, .933], [.92, .896], [.94, .824], [.96, .691], [.98, .535], [.995, .39], [1, .23],
])
const frontWidth = curve([
  [0, .0008], [.090, .0058], [.173, .0108], [.337, .0178], [.448, .0238], [.607, .04], [.739, .06], [.836, .08], [.875, .10], [.914, .12], [.941, .14], [.973, .16], [.982, .18],
])
const nosePlan = curve([[0, 0], [.155, .005], [.239, .01], [.318, .015], [.427, .02], [.543, .03], [.682, .05], [.739, .06], [.836, .08], [.916, .12], [.982, .18]])
const tailWidth = curve([
  [0, .9875], [.39, .985], [.535, .979], [.69, .958], [.824, .939], [.875, .929], [.918, .920], [.947, .902], [.980, .876], [1.012, .855],
])
const tailPlan = curve([
  [0, 1], [.424, 1], [.429, .995], [.438, .99], [.489, .985], [.529, .98], [.574, .975], [.633, .972], [.650, .970],
  [.656, .965], [.690, .960], [.758, .950], [.828, .940], [.900, .920], [.943, .900], [.986, .880], [1.0165, .825],
])
export const limitTailZ = (x: number, z: number) => Math.max(zAt(tailPlan(Math.abs(x))), z)
const shoulderBase = curve([
  [0, .431], [.016, .440], [.025, .454], [.044, .549], [.08, .622], [.10, .655], [.15, .735], [.20, .779], [.25, .772],
  [.30, .738], [.34, .747], [.40, .765], [.51, .803], [.56, .842], [.61, .889], [.66, .906], [.71, .919],
  [.758, .927], [.781, .929], [.816, .930], [.85, .927], [.89, .906], [.92, .878], [.96, .848], [1, .833],
])
const haunchShoulderFall = curve([[.596, 0], [.609, 0], [.650, .030], [.675, .045], [.695, .047],
  [.708, .043], [.727, .034], [.746, .024], [.765, .012], [.780, 0], [.792, 0]])
const shoulder = (s: number) => shoulderBase(s) - haunchShoulderFall(s)
const haunchCeiling = curve([[.69, 1.050], [.74, 1.006], [.78, .977], [.82, .947], [.86, .935], [.90, .925], [.94, .921], [1.02, .928]])
const hoodLine = curve([[0, .431], [.028, .466], [.06, .523], [.105, .608], [.165, .716], [.225, .761], [.265, .769], [.33, .764], [.6, .83]])
const hoodDome = curve([[0, .003], [.033, .046], [.074, .095], [.111, .101], [.159, .060], [.207, .009], [.235, 0]])
const bonnetProfileFall = curve([
  [0, .027], [.005, .025], [.010, .015], [.015, .008], [.024, -.001], [.040, .006], [.056, .023], [.065, .028],
  [.085, .032], [.102, .035], [.121, .035], [.150, .024], [.170, .012], [.188, .004], [.209, 0], [.225, 0],
])
const noseCornerFall = curve([[0, .025], [.005, .020], [.010, .013], [.019, .009], [.028, .009], [.050, .006], [.065, .0015], [.073, 0]])
const spine = curve([
  [.575, 1.149], [.6, 1.146], [.62, 1.135], [.64, 1.124], [.66, 1.099], [.68, 1.085], [.70, 1.078], [.72, 1.068],
  [.742, 1.056], [.769, 1.040], [.80, 1.02], [.82, 1.011], [.85, .983], [.88, .963], [.90, .957], [.92, .941], [.94, .926], [.96, .908], [.984, .898],
])
const hoodTipS = .0605
const hoodTipX = .472
const hoodInner = (s: number) => hoodTipX - 1.425 * (s - hoodTipS)
const hoodOuter = curve([[hoodTipS, hoodTipX], [.104, .557], [.140, .627], [.171, .688], [.211, .766], [.237, .758], [.290, .748]])
const hoodFoldStrength = .90
const lampFold = curve([[.044, .470], [.0875, .647], [.102, .7022], [.1292, .797], [.1709, .942], [.182, .963], [.205, .963]])
const hoodShut = (v: number) => .166 + .089 * v ** 2.10
const cabFront = (v: number) => .194 + .067 * v ** 2.40
const cowlStep = (v: number) => mix(hoodShut(v), cabFront(v), .62)
const wingRadius = (s: number) => .004 * smooth(s, .071, .099) * (1 - smooth(s, .295, .331))
const paintWingDrop = .025
const fairStep = (s: number, a: number, b: number) => {
  const t = T.MathUtils.clamp((s - a) / (b - a), 0, 1)
  return t ** 3 * (10 + t * (-15 + 6 * t))
}
const wingDraft = (s: number, drop: number) => {
  const d = drop / paintWingDrop
  return .00160 * d ** 3 * Math.exp(.306 * (1 - d ** 2))
    * fairStep(s, .122, .183) * (1 - fairStep(s, .218, .292))
}
const sideDent = curve([[.29, 0], [.36, .020], [.53, .099], [.611, .110], [.680, .065], [.765, 0]])
const rockerY = curve([[0, .155], [.04, .136], [.25, .136], [.69, .136], [.86, .137], [.90, .153], [.95, .187], [1, .40]])
const shoulderInset = (s: number) => .008 * smooth(s, .322, .407) * (1 - smooth(s, .660, .743))
const shoulderX = (s: number) => plan(s) - shoulderInset(s)
const diagonalS = curve([[.13, .537], [.22, .548], [.33, .561], [.43, .573], [.58, .588], [.64, .596], [.73, .599], [.82, .593], [.90, .581]])
const doorBelt = curve([[.295, .569], [.380, .610], [.460, .650], [.545, .689], [.600, .718], [.655, .793], [.705, .862], [.760, .896], [.812, .924], [.855, .920], [.899, .890]])
const heelFold = curve([[.382, .272], [.530, .338], [.597, .375], [.712, .432]])
const haunchFold = curve([[.631, 1.009], [.646, .975], [.682, .895], [.702, .836], [.724, .774], [.756, .694]])
const deckIn = curve([[.610, .608], [.670, .641], [.750, .686], [.820, .729], [.856, .762], [.882, .746], [.923, .704]])
const deckOut = curve([[.697, .942], [.741, .899], [.789, .849], [.828, .798], [.856, .762]])
const haunchRidgeY = curve([[.625, 1.066], [.650, 1.063], [.697, 1.047], [.750, 1.015],
  [.808, .975], [.851, .938], [.887, .918], [.922, .896]])
const foldRadius = .004
const foldAngle = T.MathUtils.degToRad(20)
const foldSlope = Math.tan(foldAngle)
const foldHalf = foldRadius * Math.sin(foldAngle / 2)
const foldTangent = Math.tan(foldAngle / 2)
const crossOffset = (s: number, y: number) => dimensions.length * (s - diagonalS(y))
const crossStepRun = .032

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
  const belt = fold(doorBelt(s), smooth(s, .271, .302) * (1 - smooth(s, .895, .928)), -.88 - .05 * smooth(s, .60, .73))
  const heel = fold(heelFold(s), smooth(s, .352, .383) * (1 - smooth(s, .700, .735)), .84)
  const haunch = fold(haunchFold(s), smooth(s, .636, .663) * (1 - smooth(s, .729, .763)), -.88)
  const ordinary = sill + thickness * q + dent + face + belt + heel
  const rise = y - doorBelt(s)
  const run = shoulder(s) - doorBelt(s)
  const peak = .0018 + .32 * thickness
  const crest = (t: number) => peak - .137 * t + .378 * hinge(t, foldHalf)
  const close = (thickness - crest(run)) * smooth(rise, Math.min(.0028, run * .64), Math.max(.001, run)) ** 2
  const flank = smooth(s, .572, .644) * (1 - smooth(s, .898, .926))
    * (1 - smooth(-rise, .048, .152))
  const diagonal = crossOffset(s, y)
  const diagonalFade = smooth(y, .135, .188) * (1 - smooth(y, .508, .682)) * (1 - smooth(diagonal, .057, .205))
  const cross = .333 * diagonalFade * (hinge(diagonal, foldHalf) - hinge(diagonal - crossStepRun, foldHalf))
  const inset = Math.max(0, mix(ordinary, crest(rise) + close, flank) + haunch + cross)
  return [side * (plan(s) - inset), y, zAt(s)]
}

function bonnetSection(s: number, x: number) {
  return (hinge(x - hoodInner(s), foldHalf) - hinge(x - hoodOuter(s), foldHalf))
    * fairStep(s, hoodTipS - .00025, hoodTipS + .001) * (1 - fairStep(s, .290, .326))
    + .86 * fairStep(s, .038, .053) * (1 - fairStep(s, .173, .203)) * hinge(x - lampFold(s), foldHalf)
}

function wingEdge(s: number) {
  const width = plan(s)
  const center = hoodLine(s), outer = shoulder(s) - noseCornerFall(s)
  const radius = wingRadius(s)
  let angle = Math.PI / 2
  if (radius > 0) for (let i = 0; i < 3; i++) {
    const x = width - radius + radius * Math.cos(angle)
    const y = outer + radius * Math.sin(angle)
    const sectionTangent = (bonnetSection(s, x + .00005) - bonnetSection(s, x - .00005)) / .0001
    const sectionRise = (bonnetSection(s, x) - bonnetSection(s, 0)) / x
    const slope = (.95 * (y - center) + .063 * smooth(s, .127, .236)) / x - hoodFoldStrength * foldSlope * (sectionTangent - sectionRise)
    angle = Math.PI / 2 + Math.atan(slope)
  }
  const x = width - radius + radius * Math.cos(angle)
  const y = outer + radius * Math.sin(angle)
  return { width, center, outer, radius, angle, x, y }
}

function bonnet(s: number, v: number): Point {
  const w = wingEdge(s), x = w.x * v
  const section = (position: number) => bonnetSection(s, position)
  const weight = v * v * (2 - v)
  const fair = mix(weight, v, smooth(v, .73, .95))
  const across = -hoodFoldStrength * foldSlope * (section(x) - mix(section(0), section(w.x), fair))
  const base = mix(w.center, w.y, weight + .05 * v ** 6 * (1 - v))
  const crown = hoodDome(s) * Math.max(0, 1 - (x / .675) ** 2) ** 2
  const wingCrown = .005 * fairStep(s, .143, .223) * (1 - fairStep(s, .243, .315))
    * fairStep(v, .60, .84) * (1 - fairStep(v, .92, 1))
  const cowlDrop = .021 * fairStep(s, .127, .236) * (1 - v ** 3)
    - .015 * fairStep(s, .122, .189) * (1 - fairStep(s, .260, .335)) * (1 - fairStep(v, .735, 1))
  const profileFall = bonnetProfileFall(s) * (1 - smooth(v, .74, 1))
  return [x, base + across + crown + wingCrown - cowlDrop - profileFall, zAt(s)]
}

function foldRows(surface: Surface, traces: ((p: Point) => number)[], broad: number | readonly number[]) {
  const counts = typeof broad === 'number' ? traces.map(() => broad).concat(broad) : broad
  const rows = counts.reduce((total, count) => total + count, 0) + traces.length * 4
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
      spans.forEach(([a, b], i) => { stride(a, counts[i]); stride(b, 4) })
      stride(1, counts[spans.length])
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
const roofWidth = curve([[.417, .625], [.46, .620], [.51, .621], [.56, .597], [.595, .550], [.625, .49]])
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
  return [width * v, roofHeight(s) + crown - .004 * smooth(Math.abs(v), .70, 1), zAt(s)]
}
const glassLowerX = curve([[cabFront(1), cowl(1)[0]], [.35, .844], [.46, .822], [.55, .790], [.60, .723], [.65, .576]])
const glassLowerY = curve([[cabFront(1), cowl(1)[1]], [.35, .768], [.45, .806], [.55, .863], [.60, .920], [.65, .959]])
const glassUpperY = curve([[cabFront(1), cowl(1)[1]], [.30, .94], [.35, 1.01], [.40, 1.064], [.417, roof(.417, 1)[1]], [.46, roof(.46, 1)[1]], [.51, roof(.51, 1)[1]], [.565, roof(.565, 1)[1]], [.595, roof(.595, 1)[1]], [.625, 1.048], [.65, .959]])
const glassUpperX = curve([[cabFront(1), cowl(1)[0]], [.30, .756], [.35, .697], [.40, .645], [.595, roof(.595, 1)[0]], [.625, .550], [.65, .576]])
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
const deckInnerX = curve([[.5984, edgeGlass(.5984, 0)[0]], [.616, .687], [.638, .608], [.657, .537], [.678, .486], [.706, bayWidth(.706)]])
const deckInnerY = curve([[.5984, edgeGlass(.5984, 0)[1]], [.617, .950], [.641, .993], [.666, 1.044], [.683, 1.066], [.696, 1.071], [.706, bayEdge(.706, 1)[1]]])
export const tailLipY = (x: number): number => .903 - .043 * smooth(x, .22, .935)
export const tailCrestZ = (x: number): number => limitTailZ(x, zAt(.989 - .0082 * smooth(x, .18, .54)))
const tailDeckProfile = curve([[.913, .950], [.925, .940], [.943, .926], [.956, .914], [.970, .906], [.981, .901], [.989, .903]])

export function frontFascia(side: number, x: number, y: number, recess: number, radius = 0): Point {
  const s = frontWidth(x) + .002 * smooth(y, .2, .48) - .0008
  const limit = zAt(nosePlan(Math.abs(x))), depth = zAt(s) - recess
  const t = Math.max(0, radius - Math.abs(limit - depth))
  return [x * side, y, Math.min(limit, depth) - (radius ? t * t / (4 * radius) : 0)]
}

export function fascia(front: boolean, side: number, x: number, y: number, recess = 0): Point {
  if (front) return frontFascia(side, x, y, recess)
  const s = tailWidth(x) + (.010 * smooth(y, .58, .81)) - .009 * smooth(y, .84, .94)
  const inset = .070 * smooth(y, .47, .70) * (1 - .78 * smooth(x, .32, .70))
  return [x * side, y, limitTailZ(x, zAt(s) + recess + inset)]
}

export function createBody(parent: T.Group, m: Palette, full: boolean): { paintPoint: Point; paintNormal: Point } {
  const n = full ? 64 : 31, k = full ? 26 : 13
  const paint: T.BufferGeometry[] = [], black: T.BufferGeometry[] = []
  const cabin: T.BufferGeometry[] = []
  const part = (to: T.BufferGeometry[], surface: Surface, out: Point, length = n, width = k, thickness = .002) => {
    to.push(patch(surface, length, width, out, thickness))
  }
  const folded = (surface: Surface, out: Point, traces: ((p: Point) => number)[], length = n, thickness = .002,
    broad: number | readonly number[] = full ? 6 : 3) => {
    const { rows, at } = foldRows(surface, traces, broad)
    paint.push(patch(surface, length, rows, out, thickness, at))
  }
  const lateralTrace = (line: (s: number) => number) => (p: Point) => Math.abs(p[0]) - line(sAt(p[2]))
  const hoodTraces = [hoodInner, hoodOuter, lampFold].map(lateralTrace)
  const sideTrace = (line: (s: number) => number) => (p: Point) => p[1] - line(sAt(p[2]))
  const beltLine = sideTrace(doorBelt), heelLine = sideTrace(heelFold), haunchLine = sideTrace(haunchFold)
  const wingDraftLine = sideTrace((s) => shoulder(s) - paintWingDrop)
  const crossLine = (p: Point) => crossOffset(sAt(p[2]), p[1])
  const crossToe = (p: Point) => crossLine(p) - crossStepRun
  const gap = .00055
  const bonnetGap = .00033
  const frontEnd = (v: number) => v <= .818 ? hoodShut(v / .818) : mix(hoodShut(1), .295, (v - .818) / .182)
  const bonnetSplit = .72
  const splitEnd = frontEnd(bonnetSplit) - bonnetGap
  const bonnetGrid = curve([[0, 0], [.4, .069], [.68, .154], [.84, .199], [1, splitEnd]])
  const bonnetLengthSteps = full ? 176 : 53
  for (const side of [1, -1]) {
    const mirror = (p: Point): Point => [p[0] * side, p[1], p[2]]
    const sided = (f: Surface): Surface => (u, v) => mirror(f(u, v))
    const uSide: Point = [side, 0, 0]
    folded(sided((u, v) => {
      const q = bonnetSplit * v
      return bonnet(bonnetGrid(u) * (frontEnd(q) - bonnetGap) / splitEnd, q)
    }), [0, 1, 0], hoodTraces, bonnetLengthSteps, 0, full ? [10, 9, 6, 3] : [3, 2, 2, 1])
    folded(sided((u, v) => {
      const q = mix(bonnetSplit, 1, v)
      return bonnet(bonnetGrid(u) + (frontEnd(q) - bonnetGap - splitEnd) * fairStep(u, .81, 1), q)
    }), [0, 1, 0], hoodTraces.slice(1), bonnetLengthSteps, 0, full ? [6, 15, 4] : [2, 6, 2])
    folded(sided((u, v) => {
      const s = mix(frontEnd(mix(.817, 1, v)) + bonnetGap, .599, u * (.43 + .57 * u))
      const q = mix(.817, 1, v)
      const front = bonnet(s, q)
      const inside = edgeGlass(s, 0)
      const w = wingEdge(s)
      const cabin: Point = [mix(inside[0], w.x - shoulderInset(s), v), mix(inside[1], w.y, v), zAt(s)]
      return blend(front, cabin, fairStep(s, .266, .355))
    }), [0, 1, 0], [hoodTraces[1]], full ? 88 : 36, .002, full ? 10 : 4)
    const cowlFace = (s: number, v: number, drop: number): Point => {
      const p = bonnet(s, v * .818)
      return [side * p[0], p[1] - drop * (1 - .67 * v * v), p[2]]
    }
    part(paint, (u, v) => cowlFace(mix(hoodShut(v) + bonnetGap, cowlStep(v), u), v, mix(.00018, .0011, fairStep(u, .22, 1))),
      [0, 1, 0], 6, n)
    part(black, (u, v) => cowlFace(mix(cowlStep(v), cabFront(v) + gap, u), v, mix(.006, .0026, u)), [0, 1, 0], 7, n, .003)
    part(black, (u, v) => cowlFace(mix(hoodShut(v) - .004, cabFront(v) + .003, u), v, .009), [0, 1, 0], 4, n, .003)
    part(paint, sided((u, v) => {
      const p = bonnet(mix(.234, .320, u), mix(.783, .912, v))
      return [p[0], p[1] - mix(.0018, .0045, smooth(u, .64, 1)), p[2]]
    }), [0, 1, 0], full ? 24 : 12, full ? 9 : 6, 0)
    for (const [a, b] of [[.071, frontEnd(1) - bonnetGap], [frontEnd(1) + bonnetGap, .331]]) {
      part(paint, sided((u, v) => {
        const s = mix(a, b, u)
        const w = wingEdge(s)
        const angle = w.angle * (1 - v)
        return [w.width - w.radius + w.radius * Math.cos(angle), w.outer + w.radius * Math.sin(angle), zAt(s)]
      }), [side, 1, 0], b - a > .1 ? n : 14, 5, 0)
    }
    part(black, (u, v) => {
      const s = mix(.276, .331, u)
      const p = bonnet(s, .813)
      return [side * (p[0] - .008), mix(p[1] - .045, p[1] - .012, v), p[2]]
    }, uSide, 18, 3, .004)
    part(black, (u, v) => {
      const s = mix(.280, .348, u)
      return [side * mix(.646, .646 - .14 * u, v), mix(.707, .800 + .030 * u, v), zAt(s)]
    }, uSide, 10, 4, 0)

    const deckShape = (s: number, v: number): Point => {
      const inside = bayEdge(s, 1)
      const outside: Point = [shoulderX(s), shoulder(s), zAt(s)]
      const t = smooth(s, .677, .706)
      const inX = mix(deckInnerX(s), inside[0], t)
      const inY = mix(deckInnerY(s), inside[1], t)
      const x = mix(inX, outside[0], v)
      const ridge = deckIn(s)
      const returnFold = 1 - smooth(s, .794, .874)
      const section = (at: number) => hinge(at - ridge, foldHalf) - returnFold * hinge(at - deckOut(s), foldHalf)
      const vane = section(x) - mix(section(inX), section(outside[0]), v)
      const ridgeV = T.MathUtils.clamp((ridge - inX) / (outside[0] - inX), .14, .86)
      const turn = -.37 * smooth(s, .614, .672) * smooth(ridge - inX, -.009, .055)
        * (1 - smooth(s, .905, .937))
      const ridgeFold = turn * (section(ridge) - mix(section(inX), section(outside[0]), ridgeV))
      const fairCrest = smooth(s, .813, .880)
      const correction = ridgeFold * fairCrest
      const fallAtRidge = T.MathUtils.clamp((inY - haunchRidgeY(s) + ridgeFold - correction) / (inY - outside[1]), .085, .915)
      const reach = smooth(inY - haunchRidgeY(s), -.027, .020)
      const fall = mix(1, ridgeV * (1 - fallAtRidge) / (fallAtRidge * (1 - ridgeV)),
        reach * smooth(s, .635, .695) * (1 - smooth(s, .915, .939)))
      const y = mix(inY, outside[1], v / (fall + (1 - fall) * v))
      const high = Math.max(haunchCeiling(x), outside[1] + .005)
      const crestBlend = smooth(v, 0, ridgeV) * (1 - smooth(v, ridgeV, 1))
      const base = y + turn * vane - correction * crestBlend
      const tBend = base - haunchFold(s)
      const fade = smooth(s, .631, .654) * (1 - smooth(s, .715, .752))
        * (1 - smooth(Math.abs(tBend), .014, .105)) * Math.sin(Math.PI * v)
      const shape = base + .22 * fade * (hinge(tBend, .006) - .5 * tBend)
      const capBlend = smooth(s, .735, .782)
      const cap = hinge(shape - high + mix(.008, .004, capBlend), mix(.014, .004, capBlend))
      const crownTrim = .013 * smooth(s, .833, .874) * (1 - smooth(s, .895, .924))
        * smooth(x, .598, .705) * (1 - smooth(x, .758, .852))
      const sculpted = shape - cap * smooth(x, .695, .765) - crownTrim
      const calm = mix(inY, outside[1], v * (.76 + .24 * v)) + .003 * Math.sin(Math.PI * v) ** 2
      const fair = fairStep(s, .758, .791) * (1 - fairStep(s, .883, .924)) * (1 - fairStep(x, .571, .610))
      return [x, mix(sculpted, calm, fair), zAt(s)]
    }
    const deckSection = (s: number, v: number): Point => {
      const [x, y, z] = deckShape(s, v)
      const mask = fairStep(s, .812, .840) * (1 - fairStep(s, .893, .919))
        * fairStep(x, .588, .648) * (1 - fairStep(x, .878, .952))
      if (mask === 0) return [x, y, z]
      const faired = (deckShape(s - .030, v)[1] + 4 * deckShape(s - .015, v)[1] + 6 * y
        + 4 * deckShape(s + .015, v)[1] + deckShape(s + .030, v)[1]) / 16
      return [x, mix(y, faired, mask), z]
    }
    folded(sided((u, v) => deckSection(mix(.5984, .942 - .019 * v, u), v)),
      [0, 1, 0], [haunchLine, lateralTrace(deckIn), lateralTrace(deckOut)])
    part(paint, sided((u, v) => {
      const s = mix(.594, .676, u)
      const t = smooth(s, .6, .68)
      const inner = bayEdge(s, 1)
      const outside = deckSection(s, 0)
      const roofX = mix(.486, inner[0], t)
      const roofStep = spine(.595) - roof(.595, .486 / roofWidth(.595))[1]
      const roofEnd: Point = [roofX, spine(s) - roofStep * (1 - smooth(s, .597, .658)) - .009 * t, zAt(s)]
      const next = deckSection(s, .006)
      const span = outside[0] - roofEnd[0]
      const slope = T.MathUtils.clamp((next[1] - outside[1]) / (next[0] - outside[0]), -1.20, .22)
      const delta = outside[1] - roofEnd[1]
      const start = mix(delta, -.27 * span, smooth(s, .598, .640))
      const end = mix(delta, slope * span, smooth(span, .026, .116))
      const fair = mix(roofEnd[1], outside[1], v)
        + v * (1 - v) * ((1 - v) * (start - delta) + v * (delta - end))
      const tBend = fair - haunchRidgeY(s)
      const fade = smooth(s, .609, .638) * (1 - smooth(s, .651, .673)) * Math.sin(Math.PI * v) ** 2
      const y = fair - .66 * fade * (hinge(tBend, .004) - .5 * tBend)
      return [mix(roofEnd[0], outside[0], v), y, zAt(s)]
    }), [0, 1, 0], n, full ? 37 : 16, 0)
    part(paint, sided((u, v) => {
      const x = v * .935
      const s0 = mix(.921, .905, smooth(x, .28, .63))
      const y = tailLipY(x)
      const s1 = sAt(tailCrestZ(x))
      const s = mix(Math.min(s0, s1 - .014), s1, u)
      const lead = y + mix(-.020, .023, smooth(x, .21, .74))
      const sideY = mix(lead, y, u * (1.26 - .26 * u))
      const joinY = mix(spine(s) - .009, sideY, fairStep(x, .04, .47))
      const lift = fairStep(s, .919, .938) * (1 - fairStep(s, .970, .989))
      const deckY = mix(mix(joinY, tailDeckProfile(s), lift), y, fairStep(u, .82, 1))
      const skin = mix(deckY, sideY, fairStep(x, .28, .70))
      const merge = fairStep(x, .102, .26) * (1 - fairStep(x, .795, .875)) * (1 - fairStep(u, .13, .55))
      const inboard = bayEdge(s, 1)[0], outer = shoulderX(s)
      const rim = deckSection(s, T.MathUtils.clamp((x - inboard) / (outer - inboard), 0, 1))[1]
      return [x, mix(skin, rim - .00035, merge), zAt(s)]
    }), [0, 1, 0])

    const archEnds = (w: WheelSize) => {
      const a = Math.asin((w.loaded - floorY) / w.arch)
      return { theta0: -a, theta1: Math.PI + a, before: sAt(w.z + w.arch), after: sAt(w.z - w.arch) }
    }
    const arch = (w: WheelSize) => {
      const { theta0, theta1, before, after } = archEnds(w)
      const rear = w === rearWheel
      const lower = (theta: number): Point => {
        const s = sAt(w.z + Math.cos(theta) * w.arch)
        return sidePoint(s, w.loaded + Math.sin(theta) * w.arch, side)
      }
      const trace = (p: Point) => Math.hypot(p[1] - w.loaded, p[2] - w.z) - w.arch - (rear ? .032 : .023)
      const archPanel = (u: number, v: number): Point => {
        const a = lower(Math.PI * u)
        const s = sAt(a[2])
        const p = sidePoint(s, mix(a[1], shoulder(s), v), side)
        const high = sidePoint(s, shoulder(s), side)
        const section = hinge(trace(p), foldHalf) - mix(hinge(trace(a), foldHalf), hinge(trace(high), foldHalf), v)
        const span = (s - before) / (after - before)
        const crown = (rear ? .35 : .32) * section * smooth(span, 0, .10) * (1 - smooth(span, .90, 1))
        const drop = high[1] - p[1]
        return [p[0] + side * (crown + (rear ? 0 : wingDraft(s, drop))), p[1], p[2]]
      }
      const face: Surface = (u, v) => archPanel(u, mix(.028, 1, v))
      const columns = full ? n * 2 : n + 12
      if (rear) folded(face, uSide, [beltLine, haunchLine, trace], columns)
      else {
        const { rows, at } = foldRows(face, [beltLine, trace, wingDraftLine], full ? 6 : 3)
        paint.push(patch(face, columns, rows, uSide, .002, at))
        const height = shoulder(before) - floorY
        const topRows = Array.from({ length: rows + 1 }, (_, j) => (face(0, at(0, j))[1] - floorY) / height)
        const bottomRows = Array.from({ length: 5 }, (_, j) => topRows[0] * j / 5)
        const stations = [...new Set([...bottomRows, ...topRows])]
        paint.push(patch((u, v) => {
          const s = mix(.141, before, u)
          const y = mix(floorY, shoulder(s), v)
          const p = sidePoint(s, y, side)
          return [p[0] + side * wingDraft(s, shoulder(s) - y), y, p[2]]
        }, n, stations.length - 1, uSide, .002, (_, j) => stations[j]))
      }
      for (const [start, end] of [[theta0, 0], [Math.PI, theta1]]) part(paint, (u, v) => {
        const p = lower(mix(start, end, u))
        const y = mix(floorY, p[1], v)
        const skin = sidePoint(sAt(p[2]), y, side)
        const tuck = rear && start === Math.PI ? .041 * (1 - smooth(y, .282, .405)) : 0
        return [skin[0] - side * tuck, y, skin[2]]
      }, uSide, full ? 24 : 8, 4, 0)
      part(paint, (u, v) => {
        const p = archPanel(u, mix(0, .028, v))
        const bead = rear ? .0025 * Math.sin(Math.PI * v) : .0016 * Math.sin(Math.PI * v) ** 2
        return [side * Math.min(dimensions.bodyWidth / 2, Math.abs(p[0]) + bead), p[1], p[2]]
      }, uSide, columns, 6, rear ? .006 : .003)
      const wellX = w.x - w.width / 2 - .025
      const well = (u: number, v: number): Point => {
        const angle = mix(theta0, theta1, u)
        const p = lower(angle)
        const depth = .012 * Math.sin(Math.PI * v)
        const x = mix(Math.abs(p[0]) - (rear ? .002 : .005), wellX, v), z = p[2] + depth * Math.cos(angle)
        const y = p[1] + depth * Math.sin(angle)
        const s = sAt(z)
        const ceiling = rear ? y + .01 : bonnet(s, Math.min(1, x / wingEdge(s).x))[1] - .010
        return [side * x, y - hinge(y - ceiling, .003) * smooth(v, .02, .28), z]
      }
      part(black, well, [0, -1, 0], columns, 10, .006)
      part(black, (u, v) => {
        const p = well(u, 1)
        return [p[0], mix(.126, p[1], v), p[2]]
      }, uSide, columns, full ? 3 : 1, .005)
    }
    arch(frontWheel)
    arch(rearWheel)

    const first = archEnds(frontWheel)
    const last = archEnds(rearWheel)
    const sillPoint = (s: number, y: number) => sidePoint(s, y, side)
    const cutLeading = curve([[0, .374], [.17, .377], [.37, .352], [.56, .323], [.71, .307], [.86, .321], [1, .349]])
    const intakeShift = .035 / dimensions.length
    const intakeFront = curve([[0, .617], [.20, .597], [.49, .570], [1, .538]])
    const intakeBack = curve([[0, .617], [.27, .651], [.55, .635], [1, .590]])
    const intakeTaper = curve([[0, 0], [.40, 0], [.46, .004], [.55, .018], [.65, .028],
      [.77, .032], [.87, .027], [.93, .019], [1, 0]])
    const intakeLeft = (v: number) => intakeFront(v) + intakeShift
    const intakeRight = (v: number) => intakeBack(v) + intakeShift - intakeTaper(v) / dimensions.length
    const intakeBottom = .208, intakeTopLeft = .686, intakeTopRight = .708
    const leftY = (v: number) => mix(intakeBottom, intakeTopLeft, v)
    const rightY = (v: number) => mix(intakeBottom, intakeTopRight, v)
    const slotStart = intakeLeft(1), slotJoin = intakeRight(1), slotEnd = .695 + intakeShift
    const slotRise = curve([[slotJoin, intakeTopRight], [.624 + intakeShift, .748], [.661 + intakeShift, .795], [slotEnd, .846]])
    const slotWidth = curve([[slotStart, 0], [.562 + intakeShift, .020], [slotJoin, .033], [.633 + intakeShift, .028], [.670 + intakeShift, .023], [slotEnd, 0]])
    const slotLow = (s: number) => s < slotJoin ? mix(intakeTopLeft, intakeTopRight, (s - slotStart) / (slotJoin - slotStart)) : slotRise(s)
    const slotHigh = (s: number) => slotLow(s) + slotWidth(s)
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
      const q = mix(.003, .996, u)
      const s = cutLeading(q) + mix(-.003, .007, v)
      const p = cap(s, q)
      const inset = .0037 + .003 * (2 * v - 1) ** 2
      return [p[0] - side * inset, p[1], p[2]]
    }, uSide, full ? 64 : 36, 3, 0)
    part(paint, (u, v) => {
      const y = mix(floorY, shoulder(cutLeading(1)), u)
      const span = .0044 + .0032 * (1 - smooth(u, .20, .47))
      const s = doorLeadAt(y) + mix(-span, span, v)
      const p = sillPoint(s, y)
      const inset = .0018 + .0034 * smooth(Math.abs(2 * v - 1), .28, 1)
      return [p[0] - side * inset, p[1], p[2]]
    }, uSide, full ? 82 : 58, 4, 0)
    part(black, (u, v) => {
      const s = mix(.510, .686, u)
      const p = sillPoint(s, mix(.314, shoulder(s) + .003, v))
      return [p[0] - side * .235, p[1] - .048 * (1 - v), p[2]]
    }, uSide, full ? 25 : 12, full ? 8 : 4, 0)
    part(black, (u, v) => {
      const s = mix(.594, .610, u)
      return [side * .550, mix(.818, .926, v), zAt(s)]
    }, uSide, 5, 5, .006)
    part(black, (u, v) => {
      const s = mix(.887, .989, u)
      const p = sillPoint(s, mix(.542, shoulder(s) - .006, v))
      return [side * (Math.abs(p[0]) * .62), p[1], Math.max(p[2], zAt(mix(.948, .989, smooth(p[1], .713, .746))))]
    }, uSide, full ? 24 : 16, full ? 7 : 5, .008)
    folded((u, v) => {
      const s = mix(first.after, Math.max(first.after, cutLeading(v) - gap), u)
      return cap(s, v)
    }, uSide, [beltLine], n, 0)
    folded((u, v) => {
      const y = mix(.136, intakeBottom, u)
      return sillPoint(mix(doorLeadAt(y) + gap, last.before, v), y)
    }, uSide, [crossLine, crossToe], n, .002, full ? 3 : 1)
    folded((u, v) => {
      const y = leftY(u)
      return sillPoint(mix(doorLeadAt(y) + gap, intakeLeft(u), v), y)
    }, uSide, [beltLine, heelLine, crossLine, crossToe], n, .002, full ? 4 : 1)
    const rightFlank: Surface = (u, v) => {
      const y = rightY(v)
      return sillPoint(mix(intakeRight(v), last.before, u), y)
    }
    const rightRows = foldRows(rightFlank, [heelLine], full ? 22 : 7)
    paint.push(patch(rightFlank, n, rightRows.rows, uSide, .002, rightRows.at))
    for (const [a, b] of [
      [doorLeadAt(intakeTopLeft) + gap, slotStart],
      [slotStart, slotJoin],
      [slotJoin, last.before],
    ]) folded((u, v) => {
      const s = mix(a, b, u)
      const lead = a < .5 ? mix(a, cutLeading(1) + gap, v) - a : 0
      return sillPoint(s + lead * (1 - u), mix(s < slotStart ? intakeTopLeft : slotHigh(s), shoulder(s + lead * (1 - u)), v))
    }, uSide, [beltLine, haunchLine])
    part(paint, (u, v) => {
      const s = mix(slotJoin, last.before, u)
      return sillPoint(s, mix(intakeTopRight, slotLow(s) + .0003 * smooth(s, slotEnd, slotEnd + .005), v))
    }, uSide, n, 4, 0)
    const rearCorner = (u: number) => mix(.19, .64, u)
    folded((u, v) => cap(mix(last.after, .926, u), mix(rearCorner(u), 1, v)), uSide, [beltLine])
    part(black, (u, v) => cap(mix(last.after, .926, u), rearCorner(u) * v), uSide, n, 6)
    part(black, (u, v) => {
      const s = mix(.926, .995, u)
      const low = mix(.173, .397, u ** 1.55)
      const high = mix(cap(.926, rearCorner(1))[1], .587, u)
      const x = mix(cap(.926, rearCorner(1))[0] * side, .512, u) - .035 * (1 - v)
      const y = mix(low, high, v)
      const recess = .155 * smooth(u, .025, .70) * smooth(y, .472, .548)
      const seat = .018 * smooth(x, .614, .652) * (1 - smooth(x, .695, .737))
        * smooth(y, .374, .403) * (1 - smooth(y, .477, .503))
      return [side * x, y, limitTailZ(x, zAt(s) + recess + seat)]
    }, uSide, n, 5, .007)
    const throatDepth = .165
    const intake = (u: number, v: number, inset: number): Point => {
      const s = mix(intakeLeft(v), intakeRight(v), u)
      const p = sillPoint(s, mix(leftY(v), rightY(v), u))
      return [p[0] - side * inset, p[1], p[2]]
    }
    const roll = (u: number, v: number, depth: number): Point => {
      const p = intake(u, v, depth)
      const unit = Math.min(1, depth / foldRadius)
      const returnDepth = foldRadius * Math.sqrt(unit * (2 - unit)) * (1 - smooth(depth, .004, .052))
      return [p[0], p[1] - returnDepth * v, p[2] + returnDepth * u ** 2]
    }
    part(black, (u, v) => intake(u, v, throatDepth), uSide, 18, 20, 0)
    const intakeDepth = (v: number) => v * (.60 + .40 * v)
    part(black, (u, v) => roll(0, u, throatDepth * intakeDepth(v)), uSide, n, full ? 10 : 6, 0)
    const intakeRows = (_: number, j: number) => rightRows.at(0, j)
    paint.push(patch((u, v) => roll(1, v, foldRadius * (1 - Math.cos(u * Math.PI / 2))),
      3, rightRows.rows, uSide, 0, intakeRows))
    black.push(patch((u, v) => roll(1, v, mix(foldRadius, throatDepth, intakeDepth(u))),
      full ? 9 : 7, rightRows.rows, uSide, 0, intakeRows))
    const slot = (s: number, v: number, d: number): Point => {
      const p = sillPoint(s, mix(slotLow(s), slotHigh(s), v))
      return [p[0] - side * d * mix(throatDepth, .054, smooth(s, slotJoin, slotEnd)), p[1], p[2]]
    }
    part(black, (u, v) => slot(mix(slotStart, slotEnd, u), v, 1), uSide, 28, 3, 0)
    part(black, (u, v) => slot(mix(slotStart, slotEnd, u), 1, v), [0, -1, 0], 28, 3, 0)
    part(black, (u, v) => slot(mix(slotJoin, slotEnd, u), 0, v), [0, 1, 0], 20, 3, 0)
    part(black, (u, v) => intake(mix(.032, .965, u), .81 + .021 * v, mix(.147, .162, v)), uSide, 20, 4, .003)
    part(black, (u, v) => {
      const y = mix(.712, .851, u)
      const p = sillPoint(diagonalS(y) + .0006 * v, y)
      return [p[0] + side * .001, p[1], p[2]]
    }, uSide, 18, 2, .001)

    part(black, (u, v) => {
      const y = mix(.131, .174, v)
      const archZ = rearWheel.z + Math.sqrt(rearWheel.arch ** 2 - (y - rearWheel.loaded) ** 2)
      const end = sAt(archZ) + .0009
      const s = mix(first.after, end, u)
      const inset = .006 + .043 * (1 - v) + .016 * smooth(u, .944, 1)
      return [side * (plan(s) - inset), y, zAt(s)]
    }, uSide, n, 8, .008)
    part(black, (u, v) => {
      const s = mix(first.after, last.before, u)
      return [side * (plan(s) - .011 - .16 * v), floorY - .006, zAt(s)]
    }, [0, -1, 0], n, 8, .009)

    const window: Surface = (u, v) => {
      const s = mix(.265 + .001 * v, .646 - .003 * v, u)
      return mirror(edgeGlass(s, v))
    }
    const glassSill = (u: number) => .09 + .068 * smooth(u, .10, .32) * (1 - smooth(u, .70, .92))
    if (full) {
      const ledge = (u: number, v: number) => window(u, v)
      part(paint, (u, v) => ledge(u, mix(0, glassSill(u) + .013, v)), uSide, n, 7, .0075)
      part(paint, (u, v) => ledge(u, mix(.914, 1, v)), uSide, n, 7, .0075)
      part(paint, (u, v) => ledge(mix(0, .059, u), mix(.096, .922, v)), uSide, 9, k, .006)
      part(paint, (u, v) => ledge(mix(.955, 1, u), mix(.096, .922, v)), uSide, 9, k, .006)
      part(black, (u, v) => {
        const p = ledge(u, mix(0, glassSill(u) + .07, v))
        return [p[0] - side * .018, p[1] - .008, p[2]]
      }, uSide, n, 9, .025)
    } else part(paint, window, uSide, n, k, .002)
    const windowGlass: Surface = (u, v) => {
      const s = mix(.278 + .008 * v, .637 - .005 * v, u)
      const p = mirror(edgeGlass(s, mix(glassSill(u), .92, v)))
      return [p[0] + side * .0038, p[1], p[2]]
    }
    add(parent, 'door and quarter glass', patch(windowGlass, n, k, uSide, .0032), m.glass)
    black.push(contour(Array.from({ length: 17 }, (_, i) => windowGlass(.760 + .015 * i / 16, i / 16)), .0075))
    const outline = [[0, 0, 1, 0], [1, 0, 1, 1], [1, 1, 0, 1], [0, 1, 0, 0]].flatMap(([a, b, c, d]) =>
      Array.from({ length: 8 }, (_, i) => windowGlass(mix(a, c, i / 8), mix(b, d, i / 8))))
    black.push(contour(outline, .0035, true))

    const doorHandle = (u: number, v: number): Point => {
      const s = mix(.601, .626, u)
      const p = sidePoint(s, shoulder(s) - .033 + .016 * v + .010 * u, side)
      return [p[0] + side * .0018, p[1], p[2]]
    }
    part(black, doorHandle, uSide, 8, 4)
  }

  const windshield: Surface = (u, v) => forwardWind(u, 2 * v - 1)
  add(parent, 'windscreen', patch(windshield, n, k * 2, [0, 1, 1], .0048), m.windscreen)
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

  part(black, (u, v) => {
    const s = mix(.057, .947, u)
    return [mix(-.71, .71, v), .159 + .051 * smooth(s, .909, .947), zAt(s)]
  }, [0, -1, 0], 20, full ? 9 : 1, .011)
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
  const paintedShell = joined(paint)
  const shellPositions = paintedShell.getAttribute('position')
  const nose = zAt(0)
  for (let i = 0; i < shellPositions.count; i++) if (shellPositions.getZ(i) > nose) shellPositions.setZ(i, nose)
  const skin = add(parent, 'closed body panels and returns', paintedShell, m.paint)
  add(parent, 'stowage, seals and wheelhouse liners', joined(black), m.matte)
  addMirrors(parent, m, full, dimensions.mirrorWidth * .5, edgeGlass(.353, 0), zAt)
  if (cabin.length) add(parent, 'covered cockpit upholstery', joined(cabin), m.cabin)
  const s = sAt(1.55)
  const w = wingEdge(s), y = w.y - paintWingDrop
  const hit = new T.Raycaster(new T.Vector3(w.width + .03, y, zAt(s)), new T.Vector3(-1, 0, 0), 0, .060)
    .intersectObject(skin, false)[0]
  if (!hit?.normal) throw new Error('Paint anchor missed the front wing skin')
  return { paintPoint: hit.point.toArray(), paintNormal: hit.normal.normalize().toArray() }
}
