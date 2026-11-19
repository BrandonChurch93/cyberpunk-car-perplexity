import * as T from 'three'
import { lampThresholds } from '../director/timeline'
import { fascia, frontHoodEdge, limitTailZ, sAt, tailLipY, zAt } from './body'
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

function joinRim(loop: readonly XY[], scale1: number, scale2: number, face: Face, recessStart: number, recessEnd: number, out: Point, bevel = .18, thickness = .003): T.BufferGeometry {
  const curve = roundedPath(loop.map(([x, y]) => [x, y, 0]), 6, bevel)
  const x0 = loop.reduce((a, p) => a + p[0], 0) / loop.length
  const y0 = loop.reduce((a, p) => a + p[1], 0) / loop.length
  return patch((u, v) => {
    const f = u * curve.length
    const p = blend(curve[Math.floor(f) % curve.length], curve[(Math.floor(f) + 1) % curve.length], f % 1)
    const q = mix(scale1, scale2, v)
    return face(x0 + (p[0] - x0) * q, y0 + (p[1] - y0) * q, mix(recessStart, recessEnd, v))
  }, curve.length, 5, out, thickness)
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
  const outletCavities: T.BufferGeometry[] = [], diffuserShell: T.BufferGeometry[] = []
  const optical: T.BufferGeometry[] = [], rearOptical: T.BufferGeometry[] = []
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
  const outletZ = zAt(.995) + .006
  const outletCenter = .18, outletHeight = .8, halfOutletHeight = .0525
  const outletRound = .055, outletPoint = .57
  const halfOutletWidth = 2.6 * halfOutletHeight / (1 - (1 - outletPoint) * outletRound / 2)
  const metalFace = (side: number, x: number, y: number, d = 0): Point =>
    [side * x, y, limitTailZ(x, outletZ + d + .017 * smooth(x, .12, .35))]
  const rearBridge = (u: number, v: number): Point => {
    const y = mix(.719, .861, v)
    const x = mix(-.059, .059, u)
    return [x, y, outletZ + .022]
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
    const blade = [
      [.909, .362, .894, .360], [.929, .287, .907, .286], [.861, .182, .842, .218],
      [.818, .172, .808, .205], [.531, .167, .548, .198], [.456, .238, .467, .252],
    ]
    const trace = (i: number) => curve(blade.map((row, j) => [j / (blade.length - 1), row[i]]))
    const [outerXAt, outerYAt, innerXAt, innerYAt] = [0, 1, 2, 3].map(trace)
    const bladeSkin = (u: number, v: number) => {
      const x = mix(outerXAt(u), innerXAt(u), v), y = mix(outerYAt(u), innerYAt(u), v)
      return f(x, y, mix(-.006, .020, v) - .004 * Math.sin(Math.PI * v))
    }
    frontPaint.push(patch(bladeSkin, 65, 8, outFront, .008))
    black.push(patch((u, v) => {
      const lip = bladeSkin(u, 1)
      return f(Math.abs(lip[0]), lip[1] + .009 * v, mix(.020, .085, v))
    }, 65, 6, [0, 1, 1], .006))
    dark.push(ribbon(f, [[.462, .395], [.578, .411], [.729, .426], [.801, .436]], .028, .024))
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
    dark.push(patch((u, v) => {
      const x = mix(0, .977, u)
      const y = lipY(x) - .006 + .004 * v
      const p = f(x, y, mix(-.017, .135, v))
      return [p[0], p[1], p[2]]
    }, 48, 3, [0, 1, 0], .024))
    dark.push(patch((u, v) => {
      const x = .969 * u
      return f(x, lipY(x) - .012 + .095 * v, mix(.019, .154, v))
    }, 38, 7, [0, 1, 0], .005))
    dark.push(patch((u, v) => {
      const x = mix(.012, .925, u)
      const outer = frontHoodEdge(x)
      const height = Math.min(outer[1] - .008, .484)
      return [side * x * .48, mix(lipY(x) + .009, height, v), outer[2] - .002]
    }, 44, 9, [side, 0, 1], .008))
    dark.push(patch((u, v) => {
      const y = mix(.171, .446, u)
      return f(mix(.873, .727, v), y, mix(.012, .170, v))
    }, 18, 9, [side, 0, 1], .009))
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

    const tailLower = curve([[0, .594], [.275, .595], [.424, .548], [.78, .535], [.914, .513], [.974, .468]])
    const tailSlot: XY[] = [[.345, .802], [.449, .817], [.698, .820], [.857, .865], [.889, .854], [.897, .809], [.895, .755], [.867, .718], [.743, .758], [.450, .763], [.353, .778]]
    const tailTopOfSlot = curve([[0, .844], [.12, .873], [.23, .873], [.32, .855], [.46, .820], [.70, .821], [.86, .864], [.90, .851], [.935, .814]])
    const tailUnderSlot = curve([[0, .714], [.27, .712], [.34, .722], [.43, .758], [.70, .752], [.87, .713], [.90, .735], [.979, .697]])
    rearPaint.push(patch((u, v) => {
      const x = .935 * u
      return r(x, mix(tailTopOfSlot(x), tailLipY(x), v), .020 * (1 - v) * (1 - smooth(x, .3, .44)) + .020 * v * (1 - smooth(x, .038, .131)))
    }, 48, 5, outRear, .006))
    rearPaint.push(patch((u, v) => {
      const x = mix(0, .979 - .021 * v, u)
      const scallop = .038 * Math.sin(v * Math.PI) * smooth(x, .10, .37) * (1 - smooth(x, .58, .91))
      const depth = mix(.017, -.008, v) + scallop + .027 * (1 - smooth(x, .27, .40))
      return r(x, mix(tailLower(x), tailUnderSlot(x), v), depth)
    }, 50, 12, outRear, .008))
    rearPaint.push(mapped(r, [[.891, .854], [.935, .872], [.972, .843], [1.006, .788], [.980, .468], [.914, .523], [.897, .735]], outRear, -.002, .008, .025))
    black.push(mapped(r, tailSlot, outRear, .014, .028, .05))
    black.push(joinRim(tailSlot, 1.025, .92, r, -.009, .026, outRear))
    const tailHub: XY = [.741, .794]
    const tailTips: XY[] = [[.864, .745], [.869, .842], [.392, .787]]
    rearOptical.push(lightGuide(r, tailHub, tailTips, .023, -.016, outRear))
    emit('tail running guide', lightGuide(r, tailHub, tailTips, .011, -.013, outRear), true, false, r(...tailHub, -.014), 1.41)
    const hex: XY[] = ([[1, 0], [outletPoint, 1], [-outletPoint, 1], [-1, 0], [-outletPoint, -1], [outletPoint, -1]] as const)
      .map(([x, y]) => [outletCenter + halfOutletWidth * x, outletHeight + halfOutletHeight * y])
    const outlet: Face = (x, y, d = 0) => metalFace(side, x, y, d)
    black.push(joinRim(hex, 1.20, .999, outlet, .025, .001, outRear, outletRound))
    const hotRim = joinRim(hex, 1, .855, outlet, 0, .021, outRear, outletRound, 0)
    outletCavities.push(joinRim(hex, .855, .82, outlet, .021, .117, outRear, outletRound))
    const exhaust = add(parent, 'formed hexagonal outlet', hotRim, m.hot)
    const source = new T.Object3D()
    source.name = 'exhaust rim heat origin'
    source.position.set(...outlet(outletCenter, outletHeight, .006))
    source.rotation.y = Math.PI
    exhaust.add(source)
    heatSources.push({ object: source, strength: 1 })
    outletCavities.push(mapped(outlet, hex, outRear, .123, .011, outletRound))
    const diffuser = (u: number, v: number): Point => {
      const x = mix(0, .969 - .054 * v, u)
      const edge = r(x, .27, .009)
      const s = mix(.842, sAt(edge[2]) + .029 * (1 - u), v)
      const low = .181 + .021 * smooth(u, .69, 1)
      const crown = (.023 * (1 - smooth(u, .32, .48)) + .035 * smooth(u, .63, .78)) * smooth(v, .24, 1)
      return [side * x, low + .258 * v + crown, limitTailZ(x, zAt(s))]
    }
    diffuserShell.push(patch(diffuser, 64, 20, [0, -1, 0], .016))
    dark.push(patch((u, v) => {
      const x = .885 * u
      const s = mix(.844, .943 - .039 * u, v)
      return [side * x, .153 + .067 * v, zAt(s)]
    }, 25, 9, [0, -1, 0], .016))
    diffuserShell.push(patch((u, v) => {
      const x = mix(0, .969, u)
      const diff = diffuser(u, 1)
      const low = diff[1] - .011 - .027 * smooth(u, .36, .48) * (1 - smooth(u, .62, .75))
      const p = r(x, mix(low, tailLower(x), v), mix(.030, .040, v))
      return [p[0], p[1], limitTailZ(x, mix(diff[2], p[2], smooth(v, 0, .96)))]
    }, 60, 19, outRear, .010))
    dark.push(patch((u, v) => {
      const x = mix(.39, .62, u)
      const y = mix(.421, .638 + .040 * Math.sin(Math.PI * u), v)
      return r(x, y, .079 + .021 * smooth(y, .54, .63))
    }, 16, 12, outRear, .008))
    dark.push(patch((u, v) => {
      const s = mix(.987, .999, u)
      return [side * mix(.37, .23, u), mix(.436, .481, v), zAt(s)]
    }, 5, 2, [side, 0, 0], .004))
    for (const fin of [.416, .645]) {
      diffuserShell.push(patch((u, v) => {
        const depth = .153 * smooth(u, .02, .82)
        const x = fin - .034 * smooth(u, .76, 1) * v * (fin > .5 ? 1 : 0)
        const s = mix(.843, sAt(r(x, .39, -.019)[2]) + .009, u)
        const y = mix(.225, tailLower(x) + .058, u) - v * depth
        return [side * x, y, limitTailZ(x, zAt(s))]
      }, 37, 11, [side, 0, 0], .018))
    }
    const vent = (u: number, v: number): Point => r(mix(.019, .395, u), mix(.420, .533, v) - .027 * u ** 4, -.023)
    dark.push(patch((u, v) => { const p = vent(u, v); return [p[0], p[1], p[2] + .009] }, 18, 8, outRear, .018))
    black.push(hexMesh(vent, .36, .12, full ? .010 : .024, full ? .00083 : .00165))
    rearOptical.push(ribbon(r, [[.545, .434], [.654, .430]], .022, .012, 18))
  }
  black.push(patch((u, v) => {
    const x = mix(-.912, .912, u)
    const y = mix(.713, tailLipY(Math.abs(x)) - .004, v)
    return [x, y, fascia(false, 1, Math.abs(x), y, .121)[2]]
  }, 49, 9, outRear, .013))
  black.push(patch(rearBridge, 16, 18, outRear, .009))
  add(parent, 'nose blades, shield and lower lip', joined(frontPaint), m.paint)
  add(parent, 'rear bumper paint surfaces', joined(rearPaint), m.paint)
  if (carbon.length) add(parent, 'radiator mesh', joined(carbon), m.carbon)
  add(parent, 'lamp bezels and air ducts', joined(black), m.matte)
  add(parent, 'recessed backing', joined(dark), m.dark)
  add(parent, 'hexagonal outlet cavities', joined(outletCavities), m.dark)
  add(parent, 'channeled graphite rear diffuser', joined(diffuserShell), m.diffuser)
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
