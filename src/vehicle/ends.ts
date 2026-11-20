import * as T from 'three'
import { lampThresholds } from '../director/timeline'
import { insertAfter, patchMaterial } from '../materials/patch'
import { fascia, frontBezelSeat, frontFascia, frontHoodEdge, limitTailZ, sAt, tailCrestZ, tailLipY, zAt } from './body'
import { add, blend, curve, fairCurve, hexMesh, joined, mix, patch, polygon, roundedPath, smooth, tau, vec, type Point, type Surface } from './geometry'
import type { Palette } from './materials'
import type { Anchor, VehicleModule } from './contract'

type XY = readonly [number, number]
type Face = (x: number, y: number, recess?: number) => Point
export const anchor = (position: Point, normal: Point, radius: number): Anchor => ({ position: vec(position), normal: vec(normal).normalize(), radius })

const diffuserProfile = [[.908, .159], [.929, .191], [.940, .203], [.960, .233], [.970, .265], [.975, .295], [.980, .325], [.990, .399], [.995, .430], [1, .470]] as const
const diffuserRise = curve(diffuserProfile)
const diffuserRun = curve(diffuserProfile.map(([s, y]) => [y, s]))
const roundMax = (a: number, b: number, width: number): number =>
  Math.max(a, b) + (width ? Math.max(0, width - Math.abs(a - b)) ** 2 / (4 * width) : 0)
const diffuserZ = (x: number, y: number, z: number, blendWidth = 0): number => {
  const floor = zAt(diffuserRun(y))
  return roundMax(limitTailZ(x, -3), roundMax(z, floor, blendWidth), blendWidth)
}

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

const radiatorLeft = curve([[.184, .552], [.217, .525], [.268, .493], [.334, .458], [.389, .452], [.420, .530], [.461, .693]])
const radiatorRight = curve([[.184, .799], [.223, .837], [.297, .875], [.346, .864], [.404, .851], [.461, .826]])
const radiatorDepth = (x: number, y: number) => .144 + .019 * smooth(x, .60, .86) + .009 * smooth(y, .38, .461)

function frontRadiator(face: Face, full: boolean, side: number, out: Point) {
  const faceX = (u: number, y: number) => mix(radiatorLeft(y), radiatorRight(y), u)
  const faceY = (v: number) => mix(.184, .461, v)
  const backing = patch((u, v) => {
    const y = faceY(v), x = faceX(u, y)
    return face(x, y, radiatorDepth(x, y))
  }, full ? 36 : 14, full ? 18 : 8, out)
  const returnWall = patch((u, v) => {
    const y = faceY(u)
    const x = radiatorRight(y) + mix(.009, -.013, v)
    return face(x, y, mix(.052, radiatorDepth(x, y) + .014, v))
  }, full ? 25 : 14, 6, [-side, 0, 0])
  const chamberWall = patch((u, v) => {
    const y = faceY(u)
    const x = .886 + .028 * smooth(y, .365, .450) - .026 * (1 - smooth(y, .195, .266))
    return face(x, y, mix(-.014, .218, v))
  }, full ? 25 : 14, 4, [-side, 0, 0])
  const rows = full ? 20 : 11
  const fins = joined(Array.from({ length: rows }, (_, i) => patch((u, v) => {
    const y = faceY((i + .5) / rows) + .0040 * (v - .5)
    const x = faceX(u, y)
    const depth = radiatorDepth(x, y) - (.004 + .017 * (1 - Math.abs(v * 2 - 1)))
    return face(x, y, depth)
  }, full ? 25 : 11, full ? 4 : 2, out)))
  return { backing: joined([backing, returnWall, chamberWall]), fins }
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
  return joined(outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length]
    return patch((u, v) => {
      return face(hub[0] + v * mix(a.x, b.x, u), hub[1] + v * mix(a.y, b.y, u), depth)
    }, Math.max(1, Math.ceil(a.distanceTo(b) / .016)), 3, out)
  }))
}

function profileGuide(mesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>, hub: XY, tips: readonly XY[], width: number): void {
  const positions = mesh.geometry.getAttribute('position')
  const plane = new T.Float32BufferAttribute(new Float32Array(positions.count * 2), 2)
  for (let i = 0; i < positions.count; i++) {
    plane.setXY(i, Math.abs(positions.getX(i) + mesh.position.x) - hub[0], positions.getY(i) + mesh.position.y - hub[1])
  }
  mesh.geometry.setAttribute('guidePlane', plane)
  const rays = tips.map(([x, y]) => new T.Vector2(x - hub[0], y - hub[1]))
  patchMaterial(mesh.material, {
    id: 'front-guide-optics',
    uniforms: { guideRays: { value: rays }, guideHalfWidth: { value: width / 2 } },
    apply(shader) {
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <common>', `
        attribute vec2 guidePlane;
        varying vec2 vGuidePlane;`)
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <begin_vertex>', 'vGuidePlane = guidePlane;')
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <common>', `
      uniform vec2 guideRays[3];
      uniform float guideHalfWidth;
      varying vec2 vGuidePlane;
      float guideRadiance() {
        float nearest = 1.0;
        float along = 0.0;
        float facetStrength = 0.16;
        for (int i = 0; i < 3; ++i) {
          vec2 axis = guideRays[i];
          float t = clamp(dot(vGuidePlane, axis) / dot(axis, axis), 0.0, 1.0);
          float dist = length(vGuidePlane - t * axis);
          if (dist < nearest) {
            nearest = dist;
            along = t * length(axis);
            facetStrength = i == 2 ? 0.0 : 0.08;
          }
        }
        float crossSection = nearest / guideHalfWidth;
        float sleeve = 0.0015 + 0.043 * (1.0 - smoothstep(0.25, 0.99, crossSection));
        float core = crossSection / 0.145;
        float pocket = smoothstep(0.28, 0.44, crossSection) * (1.0 - smoothstep(0.67, 0.91, crossSection));
        float pitch = along / 0.010;
        float facets = facetStrength * pocket * cos(PI2 * pitch) * smoothstep(0.003, 0.014, along)
          * (1.0 - smoothstep(0.12, 0.45, fwidth(pitch)));
        float resolve = 1.0 - smoothstep(0.065, 0.20, length(fwidth(vGuidePlane)) / guideHalfWidth);
        return mix(1.05, sleeve * (1.0 + facets) + 5.65 * exp(-0.5 * core * core), resolve);
      }`)
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <emissivemap_fragment>',
        'totalEmissiveRadiance *= guideRadiance();')
    },
  })
}

function projectorSource(radius: number, rotation: T.Quaternion, center: T.Vector3) {
  const face = (x: number, y: number, z: number, w: number, h: number, gain: number) => {
    const geometry = new T.PlaneGeometry(radius * w, radius * h).translate(radius * x, radius * y, z)
    geometry.setAttribute('sourceGain', new T.Float32BufferAttribute(new Float32Array(4).fill(gain), 1))
    return geometry
  }
  const base = face(0, 0, -.0005, .51, .38, .0008)
  const dies = [-1, 1].flatMap(y => [-1, 1].map(x =>
    face(x * .108, y * .075, 0, .181, .121, x === y ? .60 : 1.12)))
  const contacts = [-1, 1].flatMap(x => [-1, 1].map(y =>
    face(x * .222, y * .075, -.00018, .031, .042, .003)))
  return joined([base, ...dies, ...contacts]).applyQuaternion(rotation).translate(...center.toArray())
}

function profileProjector(material: T.MeshStandardMaterial) {
  patchMaterial(material, {
    id: 'projector-source',
    apply(shader) {
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <common>', 'attribute float sourceGain; varying float vSourceGain;')
      shader.vertexShader = insertAfter(shader.vertexShader, '#include <begin_vertex>', 'vSourceGain = sourceGain;')
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <common>', 'varying float vSourceGain;')
      shader.fragmentShader = insertAfter(shader.fragmentShader, '#include <emissivemap_fragment>',
        'diffuseColor.rgb *= mix(0.13, 1.0, step(0.1, vSourceGain)); totalEmissiveRadiance *= vSourceGain;')
    },
  })
}

export function createEnds(parent: T.Group, m: Palette, full: boolean) {
  const frontPaint: T.BufferGeometry[] = [], rearPaint: T.BufferGeometry[] = []
  const carbon: T.BufferGeometry[] = [], black: T.BufferGeometry[] = [], dark: T.BufferGeometry[] = []
  const radiatorBacks: T.BufferGeometry[] = [], radiatorFins: T.BufferGeometry[] = []
  const outletCavities: T.BufferGeometry[] = [], diffuserShell: T.BufferGeometry[] = [], diffuserFins: T.BufferGeometry[] = []
  const optical: T.BufferGeometry[] = [], rearOptical: T.BufferGeometry[] = []
  const projectorGlass: T.BufferGeometry[] = [], projectorCollars: T.BufferGeometry[] = [], projectorBowls: T.BufferGeometry[] = []
  const lamps: VehicleModule['lamps'] = []
  const heatSources: VehicleModule['heatSources'] = []
  const lumens: Array<{ mesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>; lamp: VehicleModule['lamps'][number]; rear: boolean; luminance: number }> = []
  const emit = (objectName: string, geometry: T.BufferGeometry, rear: boolean, beam: boolean, outlet?: Point, candela?: number,
    luminance = beam ? 260 : rear ? 60 : 144) => {
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
    lumens.push({ mesh, lamp, rear, luminance })
    return mesh
  }
  const outFront: Point = [0, 0, 1], outRear: Point = [0, 0, -1]
  const fair = T.MathUtils.smootherstep
  const lipY = fairCurve([[0, .168], [.27, .151], [.71, .146], [.91, .155], [.967, .174]], { controls: 5 })
  const fasciaTop = fairCurve([[0, .417], [.29, .419], [.36, .430], [.48, .468], [.60, .509], [.72, .552], [.84, .620], [.928, .695], [.974, .754]])
  const noseTop = (x: number) => mix(frontHoodEdge(x)[1], fasciaTop(x), fair(x, .70, .85))
  const chin = (x: number) => lipY(x) + .025
  const eyeCrest = curve([[.48, .474], [.58, .512], [.68, .552], [.79, .600], [.889, .649], [.918, .658]])
  const eyeTop = (x: number) => eyeCrest(x) - .015 * (1 - smooth(x, .535, .601))
    - .0055 * smooth(x, .784, .821) * (1 - smooth(x, .828, .859))
  const eyeLow = curve([[.48, .459], [.58, .462], [.69, .474], [.797, .497], [.865, .564], [.918, .635]])
  const outletZ = zAt(.995) + .006
  const outletCenter = .18, outletHeight = .8, halfOutletHeight = .0545
  const outletRound = .055, outletPoint = .57
  const halfOutletWidth = 2.94 * halfOutletHeight / (1 - (1 - outletPoint) * outletRound / 2)
  const metalFace = (side: number, x: number, y: number, d = 0): Point =>
    [side * x, y, limitTailZ(x, outletZ + d + .017 * smooth(x, .12, .35))]
  const maskHigh = curve([[0, .873], [.18, .876], [.32, .870], [.407, .835], [.453, .821]])
  const maskLow = curve([[0, .715], [.18, .716], [.327, .725], [.405, .755], [.453, .760]])
  let lens = anchor([0, 0, 0], outFront, .19)
  for (const side of [1, -1]) {
    const f: Face = (x, y, d = 0) => fascia(true, side, x, y, d)
    const r: Face = (x, y, d = 0) => fascia(false, side, x, y, d)
    const points: XY[] = [[.448, .398], [.519, .427], [.674, .436], [.804, .460], [.875, .421], [.915, .299], [.820, .190], [.541, .195]]
    const outline: XY[] = [[.474, .455], [.568, .501], [.685, .554], [.797, .609], [.884, .667], [.923, .675], [.931, .599], [.883, .471], [.912, .354], [.930, .283], [.858, .198], [.819, .179], [.520, .180], [.429, .245], [.405, .360]]
    const frontEdge = fairCurve([[0, .981], [.40, .972], [.67, .939], [1, .953]])
    const outerY = fairCurve([[0, .191], [.42, .37], [.70, .534], [1, .716]])
    const outerX = fairCurve([[0, .835], [.25, .904], [.51, .872], [.79, .906], [1, .929]], { controls: 4 })
    const fPanel = (u: number, v: number): Point => {
      const apron = fair(v, .10, .27) * (1 - fair(v, .52, .75)) * (1 - fair(u, 0, .42))
      const x = mix(outerX(v), frontEdge(v), u) - .045 * apron
      const y = mix(outerY(v), mix(chin(x), noseTop(x), v), u)
      const tuck = fair(x, .912, .927) * fair(y, .655, .711)
      const recess = mix(-.007, .011, u) - .005 * Math.sin(Math.PI * u) + .008 * apron
      return f(x - .006 * tuck, y - .024 * tuck, recess)
    }
    frontPaint.push(patch(fPanel, 22, 28, outFront, .003))
    black.push(patch((u, v) => {
      const x = .487 * u
      const y = mix(lipY(x) + .020, noseTop(x) - .004, v)
      return f(x, y, .149 - .045 * smooth(v, .76, 1) - .017 * smooth(x, .20, .46))
    }, 36, 16, outFront, .011))
    black.push(patch((u, v) => {
      const x = .48 * u
      return f(x, noseTop(x) - .007 - .029 * v, mix(.005, .129, v))
    }, 34, 6, [0, -1, 0], .004))
    const shield: Surface = (u, v) => {
      const x = u * mix(.240, .320, v)
      const edge = frontHoodEdge(x)
      const y = mix(.354 + .030 * u ** 2, edge[1] - .008, v)
      const retreat = (.054 + .020 * u * u) * (1 - v) ** 1.22
      return [side * x, y, edge[2] - .006 - retreat]
    }
    frontPaint.push(patch(shield, full ? 28 : 18, full ? 14 : 8, outFront, .004))
    black.push(patch((u, v) => {
      const p = shield(u, 0)
      return [p[0], p[1] - .011 * v, p[2] - .039 * v]
    }, full ? 28 : 18, 4, [0, -1, 1], .004))
    black.push(patch((u, v) => {
      const s = mix(.019 - .007 * v, .035, u)
      return [side * .072, mix(.369, .411, v), zAt(s)]
    }, 6, 5, [side, 0, 0], .004))
    if (full) carbon.push(hexMesh((u, v) => {
      const x = .438 * u
      return f(x, mix(lipY(x) + .031, .304 + .055 * smooth(x, .17, .419), v), .132 - .020 * smooth(x, .20, .46))
    }, .439, .149, .024, .00095))
    black.push(mapped(f, outline, outFront, .183, .018))
    black.push(joinRim(points, 1.035, .88, f, -.002, .085, outFront))
    const radiator = frontRadiator(f, full, side, outFront)
    radiatorBacks.push(radiator.backing)
    radiatorFins.push(radiator.fins)
    const blade = [
      [.909, .362, .894, .360], [.929, .287, .907, .286], [.861, .182, .842, .218],
      [.818, .172, .808, .205], [.531, .167, .548, .198], [.456, .238, .467, .252],
    ]
    const trace = (i: number) => fairCurve(blade.map((row, j) => [j / (blade.length - 1), row[i]]), {
      controls: 6, pins: [[.20, blade[1][i]], [.60, blade[3][i]]],
    })
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
    const hub: XY = [.834, .429]
    const tips: XY[] = [[.877, .285], [.879, .644], [.470, .421]]
    const guideWidth = .015
    const guideDepth = -.007
    const upper = tips[1]
    const hubZ = f(...hub, guideDepth)[2]
    const upperZ = f(...upper, guideDepth)[2] + .0034
    const guideFace: Face = (x, y, depth) => {
      const p = f(x, y, depth)
      const t = Math.max(0, (y - hub[1]) / (upper[1] - hub[1]))
      const center = f(mix(hub[0], upper[0], t), y, depth)[2]
      const rise = mix(hubZ, upperZ, t) + .0148 * Math.sin(Math.PI * t) - center
      const lift = rise * smooth(y, hub[1], .45)
      return [p[0], p[1], p[2] + lift]
    }
    const guide = emit('front running guide', lightGuide(guideFace, hub, tips, guideWidth, guideDepth, outFront),
      false, false, f(...hub, -.008), 3.99)
    profileGuide(guide, hub, tips, guideWidth)
    const eyeStart = .495, eyeEnd = .919
    const lensTuck = (x: number, y: number) => .021 * smooth(x, .895, .912) * smooth(y, .589, .625)
    const window = (u: number, v: number, d: number): Point => {
      const x = mix(eyeStart + .022 * (v - .5) ** 2, eyeEnd - .009 * v, u)
      const y = mix(eyeLow(x), eyeTop(x), v)
      return frontFascia(side, x, y, d - .013 * Math.sin(Math.PI * v) * Math.sin(Math.PI * u), .006)
    }
    black.push(patch((u, v) => {
      const lower = window(u, 1, -.002)
      const x = Math.abs(lower[0])
      const edge = frontHoodEdge(x), seat = frontBezelSeat(edge)
      const rise = edge[1] - lower[1]
      const outer = lower[1] + .5 * (rise + Math.hypot(rise, .008))
      const low = lower[1] - .005, clearance = seat[1] - .0015 - low
      const seatedY = low + .5 * (clearance + Math.hypot(clearance, .005))
      const cover = fair(x, .797, .873)
      const upperY = mix(seatedY, outer - .0008, cover)
      const upperZ = mix(seat[2] - .0015, edge[2] - .009, cover)
      return [lower[0], mix(low, upperY, v), mix(lower[2], upperZ, v)]
    }, 100, 8, outFront))
    black.push(patch((u, v) => window(u, v, .071), full ? 44 : 32, full ? 17 : 12, outFront, .009))
    optical.push(patch((u, v) => {
      const p = window(u, v, -.008)
      return [p[0], p[1], p[2] - lensTuck(Math.abs(p[0]), p[1])]
    }, 100, 20, outFront))
    black.push(patch((u, v) => {
      const x = mix(.462, .936, u)
      const edge = eyeLow(x)
      const low = .404 - .128 * smooth(x, .828, .866)
      const y = mix(low, edge + .004, v)
      const d = .0005 + .039 * smooth(edge - y, -.004, .085)
        - .017 * smooth(x, .833, .887) * smooth(y, .276, .36)
        + .010 * smooth(x, .823, .859) + .031 * smooth(x, .889, .929) * smooth(y, .548, .624)
      return f(x, y, d)
    }, 100, 16, outFront))
    for (const edge of [0, 1]) {
      const sign = 2 * edge - 1
      black.push(patch((u, v) => {
        const p = window(edge + sign * mix(-.004, .012, v), u, mix(-.006, .005, v))
        return [p[0], p[1], p[2] - 1.12 * lensTuck(Math.abs(p[0]), p[1])]
      }, 14, 4, outFront, .003))
    }
    for (const [x, y, radius, lift, intensity] of [[.743, .526, .029, .002, 170], [.827, .560, .023, .008, 80]]) {
      const normal = new T.Vector3(side * .51, .12, .851).normalize()
      const transform = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), normal)
      const p = vec(f(x, y + lift, .018))
      const segments = full ? 96 : 56
      const fit = (g: T.BufferGeometry) => g.rotateX(Math.PI / 2).scale(1, .84, 1).applyQuaternion(transform).translate(...p.toArray())
      const lathe = (profile: readonly XY[], count = segments) =>
        new T.LatheGeometry(profile.map(([r, z]) => new T.Vector2(radius * r, z)), count)
      const turn = (profile: readonly XY[]) => fit(lathe(profile))
      black.push(turn([[0, -.034], [1.12, -.034], [1.17, -.028], [1.16, -.017], [1.085, -.007], [1.063, -.005]]))
      projectorCollars.push(turn([[1.063, -.005], [1.055, -.0023], [1.025, -.0006], [1.009, -.0005],
        [1.003, -.0009], [.989, -.0009], [.984, -.00035], [.970, -.00035], [.964, -.00075],
        [.951, -.00075], [.944, -.0011], [.931, -.0024], [.927, -.0041], [.908, -.0053], [.878, -.0053], [.875, -.007]]))
      const bowlProfile = [[.875, -.007], [.857, -.0077], [.818, -.0088], [.754, -.0113], [.688, -.0137],
        [.665, -.015], [.633, -.0153], [.608, -.0149], [.555, -.0171], [.485, -.0194], [.414, -.0212],
        [.373, -.023], [.352, -.0244], [.311, -.0245], [.286, -.0237], [0, -.0237]] as const
      const bowl = lathe(bowlProfile, full ? 96 : 48)
      const wall = bowl.getAttribute('position')
      for (let i = 0; i < wall.count; i++) {
        const bx = wall.getX(i), bz = wall.getZ(i), r = Math.hypot(bx, bz) / radius
        const a = Math.atan2(bx, bz) / tau * 16
        const facet = Math.abs(2 * (a - Math.floor(a)) - 1)
        const fade = smooth(r, .28, .49) * (1 - smooth(r, .79, .873))
        wall.setY(i, wall.getY(i) - .00165 * fade * facet)
      }
      bowl.computeVertexNormals()
      const normals = bowl.getAttribute('normal')
      for (let j = 0; j < bowlProfile.length; j++) {
        const last = wall.count - bowlProfile.length + j
        const n = new T.Vector3().fromBufferAttribute(normals, j).add(new T.Vector3().fromBufferAttribute(normals, last)).normalize()
        normals.setXYZ(j, ...n.toArray())
        normals.setXYZ(last, ...n.toArray())
      }
      projectorBowls.push(fit(bowl))
      const domeSteps = full ? 24 : 12
      const dome = Array.from({ length: domeSteps + 1 }, (_, j): XY => {
        const a = mix(Math.PI / 2, 0, j / domeSteps)
        return [.910 * Math.sin(a), -.0043 + radius * .235 * Math.cos(a)]
      })
      projectorGlass.push(turn([[0, -.0059], [.885, -.0059], [.910, -.0055], ...dome]))
      const core = p.clone().addScaledVector(normal, -.0145)
      const source = emit('main beam projector', projectorSource(radius, transform, core), false, true, f(x, y, -.025), intensity)
      profileProjector(source.material)
    }
    if (side === 1) {
      const u = .61, v = .52
      const p = window(u, v, -.008)
      const normal = vec(window(u + .001, v, -.008)).sub(vec(window(u - .001, v, -.008)))
        .cross(vec(window(u, v + .001, -.008)).sub(vec(window(u, v - .001, -.008))))
      if (normal.z < 0) normal.negate()
      lens = anchor(p, normal.toArray(), .20)
    }

    const tailLower = curve([[0, .561], [.275, .561], [.424, .545], [.78, .535], [.914, .513], [.974, .468]])
    const bumperSweep = curve([[0, -2.466], [.210, -2.465], [.310, -2.459], [.414, -2.437], [.506, -2.392],
      [.608, -2.341], [.691, -2.269], [.758, -2.222], [.824, -2.167], [.910, -2.065], [.979, -1.873]])
    const bumperSkin = (x: number, v: number) => {
      const underMask = mix(.060, .008, smooth(x, .115, .665))
      const cutoff = .0037 * (1 - smooth(x, .110, .610)) * (1 - v * v)
      const z = bumperSweep(x) + cutoff + underMask * v * (1.10 - .10 * v)
      const limit = limitTailZ(x, -3)
      const offset = z - limit
      return limit + .5 * (offset + Math.hypot(offset, .011))
    }
    const tailSlot: XY[] = [[.345, .802], [.449, .817], [.698, .820], [.857, .865], [.889, .854], [.897, .809], [.895, .755], [.867, .718], [.743, .758], [.450, .763], [.353, .778]]
    const tailTopOfSlot = (x: number) => mix(maskHigh(x), .821 + .043 * smooth(x, .70, .86) - .045 * smooth(x, .86, .938), smooth(x, .396, .467))
    const tailUnderSlot = (x: number) => mix(maskLow(x), .756 - .041 * smooth(x, .73, .89) - .016 * smooth(x, .890, .978), smooth(x, .404, .490))
    rearPaint.push(patch((u, v) => {
      const x = .935 * u
      const lowY = tailTopOfSlot(x) - .002
      const lowerZ = Math.min(r(x, lowY, .012)[2], tailCrestZ(x) + .020)
      const z = mix(lowerZ, tailCrestZ(x), Math.sin(Math.PI * v / 2))
      return [side * x, mix(lowY, tailLipY(x), v), limitTailZ(x, z)]
    }, full ? 56 : 48, full ? 11 : 7, outRear, full ? .003 : 0))
    rearPaint.push(patch((u, v) => {
      const x = (.979 - .024 * v) * u
      const low = tailLower(x), high = tailUnderSlot(x) + .002
      const y = mix(low, high, v)
      const local = smooth(x, .247, .377) * (1 - smooth(x, .593, .743))
      const smoothRun = [1, 8, 28, 56, 70, 56, 28, 8, 1]
        .reduce((z, w, i) => z + w * bumperSkin(x + (i - 4) * .034, v), 0) / 256
      const fair = mix(bumperSkin(x, v), smoothRun + .003, local)
      const d = x - .650
      const shoulderRun = -2.288 + d * (.735 + .23 * d) + (.017 - .070 * d) * v + .002 * v * (1 - v)
      const join = smooth(x, .485, .592) * (1 - smooth(x, .727, .842))
      return [side * x, y, limitTailZ(x, mix(fair, shoulderRun, join))]
    }, 70, 16, outRear, .008))
    rearPaint.push(patch((u, v) => {
      const left = mix(.909, .887, smooth(v, .15, .89))
      const right = .969 + .027 * Math.sin(Math.PI * v) ** 1.12
      const x = mix(left, right, u)
      const y = mix(.473 + .042 * (1 - u), .859 - .041 * u ** 2, v)
      return r(x, y, mix(-.011, -.004, u) - .010 * Math.sin(Math.PI * v) * Math.sin(Math.PI * u))
    }, full ? 24 : 16, full ? 31 : 16, outRear, full ? .004 : 0))
    black.push(mapped(r, tailSlot, outRear, .014, .028, .05))
    black.push(joinRim(tailSlot, 1.025, .92, r, -.009, .026, outRear))
    const tailHub: XY = [.741, .794]
    const tailTips: XY[] = [[.864, .745], [.869, .842], [.392, .787]]
    rearOptical.push(lightGuide(r, tailHub, tailTips, .023, -.016, outRear))
    emit('tail running guide', lightGuide(r, tailHub, tailTips, .011, -.013, outRear), true, false, r(...tailHub, -.014), 1.41)
    const hex: XY[] = ([[1, 0], [outletPoint, 1], [-outletPoint, 1], [-1, 0], [-outletPoint, -1], [outletPoint, -1]] as const)
      .map(([x, y]) => [outletCenter + halfOutletWidth * x, outletHeight + halfOutletHeight * y])
    const outlet: Face = (x, y, d = 0) => metalFace(side, x, y, d)
    const surround = 1.03, w = halfOutletWidth * surround, h = halfOutletHeight * surround
    const cuts = [0, outletCenter - w, outletCenter - w * outletPoint, outletCenter + w * outletPoint, outletCenter + w, .453]
    for (let i = 1; i < cuts.length; i++) for (const polarity of [-1, 1]) {
      black.push(patch((u, v) => {
        const x = mix(cuts[i - 1], cuts[i], u)
        const boundary = Math.min(1, Math.max(0, (1 - Math.abs(x - outletCenter) / w) / (1 - outletPoint)))
        const y = mix(outletHeight + polarity * h * boundary, (polarity > 0 ? maskHigh : maskLow)(x), v)
        const z = mix(outlet(x, y, mix(.022, .020, smooth(x, .006, .070)))[2], r(x, y, .005)[2], smooth(x, .326, .453))
        return [side * x, y, z]
      }, full ? 12 : 7, 6, outRear, 0))
    }
    black.push(joinRim(hex, 1.065, .999, outlet, .019, .001, outRear, outletRound, 0))
    const hotRim = joinRim(hex, 1, .855, outlet, 0, .021, outRear, outletRound, 0)
    outletCavities.push(joinRim(hex, .855, .80, outlet, .021, .154, outRear, outletRound))
    const exhaust = add(parent, 'formed hexagonal outlet', hotRim, m.hot)
    const source = new T.Object3D()
    source.name = 'exhaust rim heat origin'
    source.position.set(...outlet(outletCenter, outletHeight, .006))
    source.rotation.y = Math.PI
    exhaust.add(source)
    heatSources.push({ object: source, strength: 1 })
    outletCavities.push(mapped(outlet, hex, outRear, .158, .011, outletRound))
    const rampEdge = (u: number) => {
      const x = .915 * u
      return limitTailZ(x, zAt(sAt(r(x, .27, .009)[2]) + .029 * (1 - u)))
    }
    const diffuser = (u: number, v: number): Point => {
      const x = mix(0, .969 - .054 * v, u)
      const z = mix(zAt(.842), rampEdge(u), v)
      const low = .161 + .026 * smooth(u, .66, 1)
      const crown = (.019 * (1 - smooth(u, .32, .48)) + .035 * smooth(u, .63, .78)) * smooth(v, .24, 1)
      const y = low + mix(.161, .184, u) * v + crown
      return [side * x, y, diffuserZ(x, y, z, .012)]
    }
    diffuserShell.push(patch(diffuser, 64, 20, [0, -1, 0], .016))
    diffuserShell.push(patch((u, v) => {
      const x = .807 * u
      const t = x / .915
      const upper = tailLower(x) - .002
      const p = r(x, upper, .022)
      const lip = .521 - .065 * t ** 1.6
      const recess = .091 * smooth(x, .48, .57) * (1 - smooth(x, .79, .91)) * smooth(v, 0, .56)
      return [side * x, mix(upper, lip, v) + .004 * Math.sin(Math.PI * v), mix(p[2] + .022, rampEdge(t) + .008, v) + recess + .054 * smooth(x, .735, .807)]
    }, 47, 6, [0, -1, 0], .012))
    dark.push(patch((u, v) => {
      const x = .885 * u
      const s = mix(.844, .943 - .039 * u, v)
      const y = .153 + .067 * v
      return [side * x, y, diffuserZ(x, y, zAt(s))]
    }, 25, 9, [0, -1, 0], .016))
    dark.push(patch((u, v) => {
      const x = .926 * u, flare = smooth(x, .38, .89)
      const tuck = smooth(x, .711, .897)
      const y = mix(.167 + .031 * flare + .030 * tuck, .325 + .061 * flare, v)
      const z = mix(zAt(.877), rampEdge(u) + .038, v * (.53 + .47 * v)) + .070 * tuck
      return [side * x, y, diffuserZ(x, y, z, .017)]
    }, full ? 33 : 22, 7, outRear))
    const rampMouth = (u: number, v: number): Point => {
      const x = mix(0, .969, u)
      const diff = diffuser(u, 1)
      const low = diff[1] - .009 - .015 * smooth(u, .38, .49) * (1 - smooth(u, .62, .77))
      const center = 1 - smooth(x, .385, .447)
      const y = mix(low, tailLower(x), v)
      const recess = Math.sin(Math.PI * v) ** 1.16
      const lane = smooth(x, .485, .538) * (1 - smooth(x, .754, .82))
      const p = r(x, y, .029 + .017 * v + (.046 + .069 * center + .056 * lane) * recess)
      return [p[0], y, diffuserZ(x, y, mix(diff[2], p[2], smooth(v, 0, .78)), .012)]
    }
    const mouthSplit = .454, lipStart = .84
    diffuserShell.push(patch((u, v) => rampMouth(mix(mouthSplit, 1, u), v), 37, 19, outRear, .010))
    dark.push(patch((u, v) => rampMouth(mouthSplit * u, lipStart * v), 30, 17, outRear, .012))
    diffuserShell.push(patch((u, v) => rampMouth(mouthSplit * u, mix(lipStart, 1, v)), 30, 5, outRear, .007))
    const meshFace: Surface = (u, v) => {
      const q = rampMouth(mix(.020, .387, u), mix(.27, .75, v))
      return [q[0], q[1], q[2] - .0037]
    }
    black.push(hexMesh(meshFace, .355, .114, full ? .012 : .027, full ? .0008 : .0011))
    dark.push(patch((u, v) => {
      const x = mix(.39, .62, u)
      const y = mix(.421, tailLower(x) - .007, v)
      return r(x, y, .079 + .021 * smooth(y, .54, .63))
    }, 16, 12, outRear, .008))
    for (const fin of [.423, .650]) {
      const inner = fin < .5
      const blendWidth = inner ? .009 : .016
      const tip = tailLower(fin) - .008
      const railZ = curve(inner
        ? [[0, -2.364], [.12, -2.407], [.255, -2.446], [.36, -2.445], [.70, -2.432], [1, -2.411]]
        : [[0, -2.292], [.14, -2.311], [.27, -2.306], [.42, -2.298], [.70, -2.286], [1, -2.274]])
      const rows = full ? 36 : 24
      const edge: Surface = (u, v) => {
        const angle = Math.PI * u
        const axis = fin + (inner ? .018 : .040) * v ** 1.28
        const half = .0067 - .0013 * v
        const y = tip - (inner ? .150 : .146) * v
        const z = diffuserZ(axis + half, y - .010, railZ(v), blendWidth)
        return [side * (axis - half * Math.cos(angle)), y, z - .0034 * Math.sin(angle)]
      }
      diffuserFins.push(patch(edge, 6, rows, outRear))
      const web = (u: number, v: number, face: number): Point => {
        const p = edge(face, v)
        const ease = u + u ** 3 * (1 - u)
        const x = mix(fin - .019 + .004 * (2 * face - 1), Math.abs(p[0]), ease)
        const y = mix(.237 - .071 * v, p[1], ease ** 1.28)
        const rail = mix(zAt(.833), p[2], u)
        const run = diffuserZ(x, y - .010, rail, blendWidth)
        return [side * x, y, mix(run, rail, smooth(u, .965, 1))]
      }
      const columns = full ? 25 : 16
      for (const face of [0, 1]) diffuserFins.push(patch((u, v) => web(u, v, face), columns, rows, [side * (2 * face - 1), 0, 0]))
      for (const v of [0, 1]) diffuserFins.push(patch((u, b) => blend(web(u, v, 0), web(u, v, 1), b), columns, 2, [0, 1 - 2 * v, 0]))
      for (const v of [0, 1]) diffuserFins.push(patch((u, b) => blend(edge(u, v), blend(edge(0, v), edge(1, v), (1 - Math.cos(Math.PI * u)) / 2), b),
        6, 1, [0, 1 - 2 * v, 0]))
    }
  }
  diffuserShell.push(patch((u, v) => {
    const lateral = 2 * v - 1, side = Math.abs(lateral)
    const channel = smooth(side, .425, .755) * (1 - smooth(side, .855, 1))
    const s = mix(.949, .977 + .02235 * channel, u)
    const x = mix(.455, .398, smooth(u, 0, 1)) * lateral
    const lower = diffuserRise(s) + .001
    const wall = .153 * smooth(side, .76, 1) * smooth(u, .1, .80)
    return [x, lower + wall, zAt(s)]
  }, 31, 32, [0, -1, 0], .012))
  black.push(patch((u, v) => {
    const x = mix(-.912, .912, u)
    const y = mix(.713, tailLipY(Math.abs(x)) - .004, v)
    return [x, y, fascia(false, 1, Math.abs(x), y, .121)[2]]
  }, 49, 9, outRear, .013))
  const stopBar = (u: number, v: number): Point => {
    const x = mix(-.169, .169, u), edge = Math.abs(x) / .169
    return [x, .919 + .005 * edge ** 2 + .007 * v, zAt(.898 - .005 * edge) + .008 * v]
  }
  black.push(patch((u, v) => {
    const p = stopBar(u, mix(-1.24, 1.26, v))
    return [p[0], p[1], p[2] + .005]
  }, 26, 3, outRear, .006))
  emit('high rear brake lamp bar', patch(stopBar, 32, 3, outRear, .002), true, false, undefined, .13, 23)
  add(parent, 'nose blades, shield and lower lip', joined(frontPaint), m.paint)
  add(parent, 'rear bumper paint surfaces', joined(rearPaint), m.paint)
  if (carbon.length) add(parent, 'radiator mesh', joined(carbon), m.carbon)
  const finFinish = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x222427 : 0x33363a, roughness: .74, metalness: .18,
    specularIntensity: .17, envMapIntensity: .49,
  }), 'none')
  add(parent, 'recessed front radiator fins', joined(radiatorFins), finFinish)
  const coreFinish = m.tag(new T.MeshPhysicalMaterial({
    color: full ? 0x101214 : 0x222529, roughness: .92, specularIntensity: .09, envMapIntensity: .37,
  }), 'none')
  add(parent, 'recessed front radiator backing', joined(radiatorBacks), coreFinish)
  add(parent, 'lamp bezels and air ducts', joined(black), m.matte)
  add(parent, 'recessed backing', joined(dark), m.dark)
  const outletFinish = m.tag(new T.MeshPhysicalMaterial({
    color: 0x060607, roughness: .96, specularIntensity: .11, envMapIntensity: .4,
  }), 'none')
  add(parent, 'hexagonal outlet cavities', joined(outletCavities), outletFinish)
  const channelFinish = m.diffuser.clone()
  channelFinish.roughness = .73
  channelFinish.metalness = .10
  channelFinish.clearcoat = .08
  channelFinish.specularIntensity = .45
  add(parent, 'channeled graphite rear diffuser', joined(diffuserShell), m.tag(channelFinish, 'sheet'))
  const bladeFinish = m.tag(m.diffuser.clone(), 'sheet')
  bladeFinish.color.setHex(full ? 0x33363a : 0x3c3f42)
  bladeFinish.roughness = .74
  bladeFinish.metalness = .12
  add(parent, 'thin graphite diffuser blades', joined(diffuserFins), bladeFinish)
  add(parent, 'machined projector collars', joined(projectorCollars), m.brushed)
  add(parent, 'ribbed dark projector bowls', joined(projectorBowls), m.forged)
  add(parent, 'convex projector lenses', joined(projectorGlass), m.projector)
  add(parent, 'front optical lens shells', joined(optical), m.optics)
  add(parent, 'rear optical lens shells', joined(rearOptical), m.rearOptics)
  const update = (stage: number, rise: number): void => {
    const running = smooth(stage, lampThresholds.running, lampThresholds.running + .05)
    const beam = smooth(stage, lampThresholds.beamStart, lampThresholds.beamStart + .05)
    const fullBeam = smooth(stage, lampThresholds.beamStart, lampThresholds.beamFull)
    for (const part of lumens) {
      const level = part.lamp.beam ? beam * (.045 + .955 * fullBeam) : part.rear ? running * (.53 + .47 * rise) : running
      part.lamp.level = level
      part.mesh.material.emissiveIntensity = level * part.luminance
    }
  }
  return { lamps, heatSources, lamp: lens, exhaust: anchor([0, mix(.719, .861, .5), outletZ + .022], outRear, .34), update }
}
