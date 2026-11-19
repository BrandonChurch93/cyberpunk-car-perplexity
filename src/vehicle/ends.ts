import * as T from 'three'
import { lampThresholds } from '../director/timeline'
import { fascia, frontHoodEdge, sAt, zAt } from './body'
import { add, blend, contour, curve, hexMesh, joined, mix, patch, polygon, roundedPath, smooth, tau, vec, type Point } from './geometry'
import type { Palette } from './materials'
import type { Anchor, VehicleModule } from './contract'

type XY = readonly [number, number]
type Face = (x: number, y: number, recess?: number) => Point
export const anchor = (position: Point, normal: Point, radius: number): Anchor => ({ position: vec(position), normal: vec(normal).normalize(), radius })

function ribbon(face: Face, knots: readonly XY[], width: number, depth: number, steps = 36): T.BufferGeometry {
  const path = new T.CatmullRomCurve3(knots.map(([x, y]) => new T.Vector3(x, y, 0)), false, 'centripetal')
  const p0 = face(knots[0][0], knots[0][1]), p1 = face(knots[0][0], knots[0][1], .01)
  const dir = Math.sign(p0[2] - p1[2])
  return patch((u, v) => {
    const { x, y } = path.getPoint(u)
    const tangent = path.getTangent(u)
    const shrink = .63 + .37 * (smooth(u, 0, .043) - smooth(u, .96, 1))
    const w = (v - .5) * width * shrink
    return face(x - tangent.y * w, y + tangent.x * w, depth - .002 * Math.sin(v * Math.PI))
  }, steps, 5, [0, 0, dir], .0035)
}

function mapped(face: Face, points: readonly XY[], out: Point, depth: number, thickness: number, radius = .10): T.BufferGeometry {
  const corners = points.map(([x, y]) => face(x, y, depth))
  return polygon(roundedPath(corners, 4, radius), out, thickness)
}

function joinRim(loop: readonly XY[], scale1: number, scale2: number, face: Face, recessStart: number, recessEnd: number, out: Point): T.BufferGeometry {
  const curve = roundedPath(loop.map(([x, y]) => [x, y, 0]), 6, .18)
  const x0 = loop.reduce((a, p) => a + p[0], 0) / loop.length
  const y0 = loop.reduce((a, p) => a + p[1], 0) / loop.length
  return patch((u, v) => {
    const f = u * curve.length
    const p = blend(curve[Math.floor(f) % curve.length], curve[(Math.floor(f) + 1) % curve.length], f % 1)
    const q = mix(scale1, scale2, v)
    return face(x0 + (p[0] - x0) * q, y0 + (p[1] - y0) * q, mix(recessStart, recessEnd, v))
  }, curve.length, 5, out, .003)
}

function projectorLens(face: Face, x: number, y: number, r: number, depth: number, direction: T.Vector3): T.BufferGeometry {
  const fn = (rr: number, n: number) => new T.SphereGeometry(rr, 32, 10).scale(1.06, .83, n)
  const start = face(x, y, depth)
  return fn(r, .25).applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), direction)).translate(...start)
}

function lightGuide(face: Face, hub: XY, tips: readonly XY[], width: number, depth: number, out: Point): T.BufferGeometry {
  const origin = new T.Vector2(...hub)
  const rays = tips.map((p) => new T.Vector2(...p).sub(origin))
  const tangents = rays.map((ray) => ray.clone().normalize())
  const offsets = tangents.map(({ x, y }) => new T.Vector2(-y, x).multiplyScalar(width / 2))
  const outline = rays.flatMap((ray, i) => {
    const next = (i + 1) % rays.length
    const a = tangents[i], b = tangents[next], left = offsets[i], right = offsets[next].clone().negate()
    const corner = left.clone().addScaledVector(a, right.clone().sub(left).cross(b) / a.cross(b))
    return [ray.clone().sub(left), ray.clone().add(left), corner]
  })
  return polygon(outline.map((v) => face(v.x + hub[0], v.y + hub[1], depth)), out, .0025)
}

export function createEnds(parent: T.Group, m: Palette, full: boolean) {
  const frontPaint: T.BufferGeometry[] = [], rearPaint: T.BufferGeometry[] = []
  const carbon: T.BufferGeometry[] = [], black: T.BufferGeometry[] = [], dark: T.BufferGeometry[] = []
  const rings: T.BufferGeometry[] = [], optical: T.BufferGeometry[] = [], rearOptical: T.BufferGeometry[] = []
  const lamps: VehicleModule['lamps'] = []
  const heatSources: VehicleModule['heatSources'] = []
  const lumens: Array<{ mesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>; lamp: VehicleModule['lamps'][number]; rear: boolean }> = []
  const emit = (objectName: string, geometry: T.BufferGeometry, rear: boolean, beam: boolean, outlet?: Point, candela?: number): void => {
    const material = m.tag(new T.MeshStandardMaterial({
      color: rear ? 0x571416 : 0x939ca1, roughness: .28, metalness: .05,
      emissive: rear ? 0xff1713 : beam ? 0xe4f3ff : 0xe5f3ff, emissiveIntensity: 0,
    }), 'none')
    const mesh = add(parent, objectName, geometry, material) as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>
    const stage = beam ? lampThresholds.beamStart : lampThresholds.running
    geometry.computeBoundingBox()
    const origin = geometry.boundingBox!.getCenter(new T.Vector3())
    geometry.translate(-origin.x, -origin.y, -origin.z)
    mesh.position.copy(origin)
    const object = new T.Object3D()
    object.name = objectName + ' emission origin'
    object.position.copy(outlet ? vec(outlet) : origin)
    const direction = rear ? new T.Vector3(Math.sign(origin.x) * .16, -.04, -.99) : new T.Vector3(Math.sign(origin.x) * .055, -.037, .998)
    object.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), direction.normalize())
    parent.add(object)
    const lamp = { object, stage, beam, level: 0, color: material.emissive.clone(), intensity: candela ?? (rear ? .47 : 1.33) }
    lamps.push(lamp)
    lumens.push({ mesh, lamp, rear })
  }
  const outFront: Point = [0, 0, 1], outRear: Point = [0, 0, -1]
  const lipY = curve([[0, .168], [.27, .151], [.71, .146], [.91, .155], [.967, .174]])
  const fasciaTop = curve([[0, .417], [.29, .419], [.36, .430], [.48, .468], [.60, .509], [.72, .552], [.84, .620], [.928, .695], [.974, .754]])
  const noseTop = (x: number) => mix(frontHoodEdge(x)[1], fasciaTop(x), smooth(x, .70, .85))
  const chin = (x: number) => lipY(x) + .025
  const eyeTop = curve([[.48, .474], [.58, .512], [.68, .552], [.79, .600], [.889, .649], [.918, .658]])
  const eyeLow = curve([[.48, .459], [.58, .462], [.69, .474], [.797, .497], [.865, .564], [.918, .635]])
  const metalFace = (side: number, x: number, y: number, d = 0): Point => {
    const phase = smooth(x, .05, .32)
    return [side * x, y, zAt(.997 - .006 * phase) + d + .012 * smooth(y, .73, .85)]
  }
  const exhaustMid = metalFace(1, .18, .785)[2]
  const rearBridge = (u: number, v: number): Point => {
    const y = mix(.711, .859, v)
    const x = mix(-.058, .058, u) * (.80 + .18 * Math.abs(2 * v - 1))
    return [x, y, exhaustMid + .064 * ((v - .5) ** 2) + .019 * x * x]
  }
  let lens = anchor([0, 0, 0], outFront, .19)
  for (const side of [1, -1]) {
    const f: Face = (x, y, d = 0) => fascia(true, side, x, y, d)
    const r: Face = (x, y, d = 0) => fascia(false, side, x, y, d)
    const points: XY[] = [[.448, .398], [.519, .427], [.674, .436], [.804, .460], [.844, .421], [.869, .299], [.820, .190], [.541, .195]]
    const outline: XY[] = [[.474, .455], [.568, .501], [.685, .554], [.797, .609], [.884, .667], [.923, .675], [.931, .599], [.883, .471], [.912, .354], [.930, .283], [.858, .198], [.819, .179], [.520, .180], [.429, .245], [.405, .360]]
    const frontEdge = curve([[0, .981], [.40, .972], [.67, .939], [1, .953]])
    const outerY = curve([[0, .191], [.42, .37], [.70, .534], [1, .735]])
    const outerX = curve([[0, .896], [.25, .926], [.51, .880], [.79, .918], [1, .958]])
    const fPanel = (u: number, v: number): Point => {
      const x = mix(outerX(v), frontEdge(v), u)
      return f(x, mix(outerY(v), mix(chin(x), noseTop(x), v), u), .003)
    }
    frontPaint.push(patch(fPanel, 22, 28, outFront, .008))
    black.push(patch((u, v) => {
      const x = .487 * u
      const y = mix(lipY(x) + .020, noseTop(x) - .004, v)
      return f(x, y, .126 - .045 * smooth(v, .76, 1))
    }, 36, 16, outFront, .011))
    black.push(patch((u, v) => {
      const x = .48 * u
      return f(x, noseTop(x) - .007 - .029 * v, mix(.005, .129, v))
    }, 34, 6, [0, -1, 0], .004))
    frontPaint.push(patch((u, v) => {
      const x = mix(0, .86, u)
      const edge = frontHoodEdge(x)
      return [side * x, edge[1] - .014 * v, edge[2] - .003 * v]
    }, 84, 4, outFront, .004))
    black.push(mapped(f, outline, outFront, .025, .055))
    dark.push(mapped(f, points, outFront, .123, .036))
    black.push(joinRim(points, 1.035, .88, f, -.002, .085, outFront))
    frontPaint.push(ribbon(f, [[.322, .361], [.400, .294], [.495, .214], [.551, .176], [.657, .170]], .030, .002, 38))
    carbon.push(ribbon(f, [[.554, .176], [.740, .167], [.839, .184], [.895, .272]], .022, .003, 38))
    carbon.push(ribbon(f, [[.462, .395], [.578, .411], [.729, .426], [.801, .436]], .028, .024))
    const dh = full ? .019 : .032
    if (full) {
      carbon.push(hexMesh((u, v) => {
        const x = mix(.55 - .075 * v, .808 + .028 * v, u)
        return f(x, .211 + .165 * v, .097)
      }, .30, .18, dh, .00135))
    } else {
      for (let i = 0; i < 8; i++) {
        const y = .214 + i * .021
        black.push(ribbon(f, [[.55 - i * .008, y], [.63, y + .001], [.808 + .003 * i, y + .004]], .007, .092, 12))
      }
    }
    black.push(patch((u, v) => {
      const x = .546 * u
      return f(x, lipY(x) + .009 + .027 * v, mix(.003, .128, v))
    }, 36, 6, [0, 1, 0], .009))
    carbon.push(patch((u, v) => {
      const x = mix(0, .977, u)
      const y = lipY(x) - .005 + .008 * Math.sin(Math.PI * v)
      const p = f(x, y, mix(-.013, .119, v))
      return [p[0], p[1], p[2]]
    }, 42, 10, [0, 1, 0], .018))
    const hub: XY = [.834, .429]
    const tips: XY[] = [[.877, .285], [.879, .644], [.470, .421]]
    black.push(lightGuide(f, hub, tips, .040, .002, outFront))
    emit('front running guide', lightGuide(f, hub, tips, .015, -.007, outFront), false, false, f(...hub, -.008), 3.99)
    const eyeStart = .495, eyeEnd = .919
    const window = (u: number, v: number, d: number): Point => {
      const x = mix(eyeStart + .022 * (v - .5) ** 2, eyeEnd - .009 * v, u)
      const y = mix(eyeLow(x), eyeTop(x), v)
      return f(x, y, d - .013 * Math.sin(Math.PI * v) * Math.sin(Math.PI * u))
    }
    black.push(patch((u, v) => window(u, v, .071), 44, 17, outFront, .009))
    optical.push(patch((u, v) => window(u, v, -.008), 52, 20, outFront, .0034))
    const eyeOutline = [[.498, .464], [.584, .473], [.704, .480], [.801, .501], [.863, .558], [.915, .635], [.908, .656], [.873, .640], [.780, .597], [.680, .552], [.579, .510]]
    const edge = eyeOutline.map(([x, y]) => f(x, y, -.005))
    black.push(contour(edge, .0043, true, 7))
    for (const [x, y, radius, intensity] of [[.743, .526, .029, 170], [.827, .560, .023, 80]]) {
      const normal = new T.Vector3(side * .51, .12, .851).normalize()
      const transform = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), normal)
      const p = f(x, y, .026)
      black.push(patch((u, v) => {
        const a = u * tau, rr = radius * mix(1.14, .80, v)
        return new T.Vector3(rr * Math.cos(a), rr * .85 * Math.sin(a), -.020 * v)
          .applyQuaternion(transform).add(vec(p)).toArray()
      }, full ? 40 : 22, 3, outFront, .003))
      optical.push(projectorLens(f, x, y, radius * .79, .043, normal))
      emit('main beam projector', projectorLens(f, x, y, radius * .54, .037, normal), false, true, f(x, y, -.025), intensity)
    }
    if (side === 1) {
      const u = .61, v = .52
      const p = window(u, v, -.008)
      const normal = vec(window(u + .001, v, -.008)).sub(vec(window(u - .001, v, -.008)))
        .cross(vec(window(u, v + .001, -.008)).sub(vec(window(u, v - .001, -.008))))
      if (normal.z < 0) normal.negate()
      lens = anchor(p, normal.toArray(), .20)
    }

    const tailUpper = curve([[0, .873], [.18, .922], [.33, .909], [.47, .847], [.69, .849], [.86, .895], [.915, .875], [.967, .845]])
    const tailLower = curve([[0, .619], [.275, .624], [.424, .571], [.66, .560], [.84, .549], [.974, .452]])
    const tailSlot: XY[] = [[.345, .790], [.449, .811], [.698, .818], [.842, .858], [.874, .872], [.897, .834], [.894, .756], [.868, .708], [.760, .699], [.626, .704], [.438, .701], [.350, .716]]
    const tailTopOfSlot = curve([[0, .85], [.19, .903], [.33, .868], [.46, .813], [.70, .818], [.85, .86], [.906, .871], [.95, .822], [.974, .698]])
    const tailUnderSlot = curve([[0, .707], [.31, .714], [.43, .704], [.66, .698], [.83, .691], [.905, .710], [.976, .689]])
    rearPaint.push(patch((u, v) => {
      const x = mix(0, .972, u)
      return r(x, mix(tailTopOfSlot(x), tailUpper(x), v) - .006 * smooth(v, .80, 1), -.007 * Math.sin(Math.PI * v))
    }, 58, 12, outRear, .006))
    rearPaint.push(patch((u, v) => {
      const x = mix(0, .979 - .021 * v, u)
      const fold = Math.exp(-((x - .72) ** 2) / .013) * Math.sin(Math.PI * v)
      return r(x, mix(tailLower(x), tailUnderSlot(x), v), mix(.035, -.005, v) - .028 * fold)
    }, 56, 18, outRear, .008))
    rearPaint.push(mapped(r, [[.884, .882], [.926, .904], [.977, .855], [1.007, .793], [.980, .453], [.914, .519], [.833, .691], [.898, .724]], outRear, -.003, .008))
    black.push(mapped(r, tailSlot, outRear, .028, .031))
    black.push(joinRim(tailSlot, 1.032, .92, r, -.003, .026, outRear))
    const tailPaths: XY[][] = [
      [[.386, .767], [.478, .771], [.604, .773], [.712, .775], [.756, .780]],
      [[.756, .780], [.793, .795], [.839, .818], [.873, .829]],
      [[.756, .780], [.791, .768], [.841, .743], [.869, .735]],
    ]
    for (const path of tailPaths) {
      black.push(ribbon(r, path, .027, .0058, 40))
      rearOptical.push(ribbon(r, path, .020, -.0026, 40))
      emit('tail running guide', ribbon(r, path, .0144, .002, 45), true, false)
    }
    rearOptical.push(ribbon(r, [[.872, .737], [.883, .783], [.874, .828]], .0125, -.001, 16))
    black.push(ribbon(r, [[.454, .684], [.518, .700], [.704, .694], [.858, .681]], .019, .002, 28))
    const hex: XY[] = [[.042, .783], [.093, .839], [.250, .839], [.331, .790], [.333, .769], [.263, .721], [.096, .718]]
    const outlet: Face = (x, y, d = 0) => metalFace(side, x, y, d)
    black.push(joinRim(hex, 1.18, .99, outlet, .034, -.001, outRear))
    const hotRim = joinRim(hex, 1, .87, outlet, 0, .022, outRear)
    const hotReturn = joinRim(hex, .87, .75, outlet, .022, .116, outRear)
    const exhaust = add(parent, 'formed hexagonal outlet', joined([hotRim, hotReturn]), m.hot)
    const source = new T.Object3D()
    source.name = 'exhaust rim heat origin'
    source.position.set(...outlet(.18, .785, .006))
    source.rotation.y = Math.PI
    exhaust.add(source)
    heatSources.push({ object: source, strength: 1 })
    dark.push(mapped(outlet, hex, outRear, .126, .011))
    for (const x of [.118, .232]) rings.push(patch((u, v) => {
      const a = tau * u
      const taper = mix(1, .88, v)
      return outlet(x + .043 * Math.cos(a) * taper, .779 + .041 * Math.sin(a) * taper, mix(.082, .141, v))
    }, full ? 96 : 52, 4, outRear, .003))
    const diffuser = (u: number, v: number): Point => {
      const x = mix(0, .969 - .054 * v, u)
      const edge = r(x, .27, .009)
      const s = mix(.842, sAt(edge[2]) + .015 * (1 - u), v)
      const low = .139 + .020 * smooth(u, .69, 1)
      return [side * x, low + (.34 + .051 * Math.sin(u * Math.PI)) * v ** 1.51, zAt(Math.min(1, s))]
    }
    carbon.push(patch(diffuser, 50, 28, [0, -1, 0], .016))
    carbon.push(patch((u, v) => {
      const x = mix(0, .969, u)
      const diff = diffuser(u, 1)
      return r(x, mix(diff[1] - .011, tailLower(x), v), mix(.027, .036, v))
    }, 48, 18, outRear, .010))
    for (const fin of [.402, .646, .884]) {
      carbon.push(patch((u, v) => {
        const depth = .242 * smooth(u, .02, .82) * (fin > .8 ? .74 : 1)
        const x = fin - .029 * smooth(u, .76, 1) * v * (fin > .5 ? 1 : 0)
        const s = mix(.843, sAt(r(x, .39, 0)[2]) + .009, u)
        const y = .19 + .288 * u ** .68 - v * depth
        return [side * x, y, zAt(Math.min(1, s))]
      }, 37, 11, [side, 0, 0], .012))
    }
    const vent = (u: number, v: number): Point => r(mix(.05, .37, u), mix(.344, .495, v) + .017 * Math.sin(u * Math.PI), .057)
    black.push(patch(vent, 18, 8, outRear, .018))
    carbon.push(hexMesh(vent, .32, .15, full ? .010 : .024, full ? .00083 : .00165))
    rearOptical.push(ribbon(r, [[.545, .434], [.654, .430]], .022, .012, 18))
  }
  black.push(patch(rearBridge, 16, 18, outRear, .009))
  add(parent, 'nose blades, shield and lower lip', joined(frontPaint), m.paint)
  add(parent, 'rear bumper paint surfaces', joined(rearPaint), m.paint)
  add(parent, 'splitter, radiator and diffuser', joined(carbon), m.carbon)
  add(parent, 'lamp bezels and air ducts', joined(black), m.matte)
  add(parent, 'recessed backing', joined(dark), m.dark)
  add(parent, 'projector rings and inner pipe wall', joined(rings), m.brushed)
  add(parent, 'front optical lens shells', joined(optical), m.optics)
  add(parent, 'rear optical lens shells', joined(rearOptical), m.rearOptics)
  const update = (stage: number, rise: number): void => {
    const running = smooth(stage, lampThresholds.running, lampThresholds.running + .05)
    const beam = smooth(stage, lampThresholds.beamStart, lampThresholds.beamStart + .05)
    const fullBeam = smooth(stage, lampThresholds.beamStart, lampThresholds.beamFull)
    for (const part of lumens) {
      const level = part.lamp.beam ? beam * (.045 + .955 * fullBeam) : part.rear ? running * (.53 + .47 * rise) : running
      part.lamp.level = level
      part.mesh.material.emissiveIntensity = level * (part.lamp.beam ? 260 : part.rear ? 60 : 144)
    }
  }
  return { lamps, heatSources, lamp: lens, exhaust: anchor(rearBridge(.5, .5), outRear, .34), update }
}
