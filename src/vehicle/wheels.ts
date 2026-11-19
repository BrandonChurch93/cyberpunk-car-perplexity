import * as T from 'three'
import { frontWheel, rearWheel, type WheelSize } from './body'
import { add, blend, contour, curve, joined, mix, patch, polygon, roundedPath, smooth, tau, type Point } from './geometry'
import type { Palette } from './materials'

type Profile = ReadonlyArray<readonly [number, number]>
const axisRoll = (axis: number, radius: number, theta: number): Point => [axis, Math.cos(theta) * radius, Math.sin(theta) * radius]

function lathe(profile: Profile, segments: number): T.BufferGeometry {
  return new T.LatheGeometry(profile.map(([a, r]) => new T.Vector2(r, a)), segments).rotateZ(-Math.PI / 2)
}

function disk(radius: number, depth: number, x: number, segments = 40): T.BufferGeometry {
  return new T.CylinderGeometry(radius, radius, depth, segments).rotateZ(-Math.PI / 2).translate(x, 0, 0)
}

function tireGeometry(w: WheelSize, full: boolean): T.BufferGeometry {
  const H = w.width / 2
  const cross = curve([
    [0, w.rim - .011], [.08, w.rim + .013], [.18, w.radius - .054], [.23, w.radius - .026],
    [.27, w.radius - .010], [.33, w.radius - .0012], [.39, w.radius], [.61, w.radius],
    [.67, w.radius - .0012], [.73, w.radius - .010], [.77, w.radius - .026], [.82, w.radius - .054], [.92, w.rim + .013], [1, w.rim - .011],
  ])
  const width = curve([[0, -.86], [.12, -.974], [.179, -1], [.226, -.985], [.27, -.93], [.50, 0], [.73, .93], [.774, .985], [.821, 1], [.88, .974], [1, .86]])
  const axial = (v: number) => {
    if (v < .27 || v > .73) return width(v) * H
    return mix(-.93, .93, (v - .27) / .46) * H
  }
  const depth = (u: number, v: number): number => {
    const grooves = [.362, .448, .552, .638]
    const groove = grooves.reduce((r, g) => Math.max(r, 1 - smooth(Math.abs(v - g), .004, .01)), 0)
    if (!full) return .0025 * groove
    const pitch = u * 70 + (v - .5) * 7 + .24 * Math.sin(u * tau * 7)
    const stagger = Math.abs(pitch - Math.round(pitch))
    const crossSipe = (1 - smooth(stagger, .05, .16)) * (smooth(v, .265, .31) - smooth(v, .68, .735))
    return .0064 * groove + .0045 * crossSipe
  }
  const position = (u: number, v: number): Point => {
    const th = u * tau
    const p = axisRoll(axial(v), cross(v) - depth(u, v), th)
    const ground = p[1] + w.loaded
    const cushion = ground > .010 ? ground : ground < 0 ? 0 : ground ** 2 * (20 - 1000 * ground) * 1000 / 100
    const bulge = .0015 * Math.exp(-((ground - .027) ** 2) / .00069) * Math.sin(Math.PI * v) * Math.sign(p[0])
    return [p[0] + bulge, cushion - w.loaded, p[2]]
  }
  return patch(position, full ? 560 : 128, full ? 68 : 30, [0, -1, 0])
}

function rotor(w: WheelSize, full: boolean, axis: number): T.BufferGeometry {
  const face = new T.Shape()
  const dia = w.disc
  face.absarc(0, 0, dia, 0, tau, false)
  const center = new T.Path()
  center.absarc(0, 0, .081, 0, tau, true)
  face.holes.push(center)
  const count = full ? 24 : 14
  for (let i = 0; i < count; i++) for (let j = 0; j < 4; j++) {
    const a = (i / count) * tau + (.05 * j + .011 * j ** 2)
    const r = dia - .018 - .015 * j
    const drill = new T.Path()
    drill.absarc(Math.cos(a) * r, Math.sin(a) * r, full ? .00315 : .0035, 0, tau, true)
    face.holes.push(drill)
  }
  return new T.ExtrudeGeometry(face, { depth: w.discDepth, bevelEnabled: false, steps: 1, curveSegments: full ? 8 : 4 })
    .rotateY(Math.PI / 2).translate(axis - w.discDepth, 0, 0)
}

function spoke(w: WheelSize, theta: number, axial: number, full: boolean): T.BufferGeometry {
  const rr = w.rim
  const local: readonly [number, number][] = [[.041, -.020], [.094, -.025], [.148, -.026], [rr * .84, -.075],
    [rr * .93, -.078], [rr * .968, -.060], [rr * .90, -.044], [.179, -.019], [.168, -.006], [.169, .009],
    [.188, .028], [rr * .938, .058], [rr * .977, .071], [rr * .965, .089], [rr * .90, .087], [.156, .034], [.103, .028], [.045, .019]]
  const point = (r: number, t: number, depth: number): Point => {
    const a = theta + .15 * (r / rr - .48)
    return [axial - .032 * (1 - (r / rr) ** .7) - depth, Math.cos(a) * r - Math.sin(a) * t, Math.sin(a) * r + Math.cos(a) * t]
  }
  const outline = roundedPath(local.map(([r, t]) => point(r, t, 0)), full ? 5 : 3, .19)
  if (!full) return polygon(outline, [1, 0, 0], .021)
  const side = Math.sign(outline.reduce((sum, p, i) => {
    const [, y, z] = outline[(i + 1) % outline.length]
    return sum + p[1] * z - p[2] * y
  }, 0))
  const normalYZ = (a: Point, b: Point) => new T.Vector2(b[2] - a[2], a[1] - b[1]).normalize().multiplyScalar(side)
  const inner = outline.map((p, i): Point => {
    const a = normalYZ(outline[(i - 1 + outline.length) % outline.length], p)
    const b = normalYZ(p, outline[(i + 1) % outline.length])
    const m = a.clone().add(b).normalize()
    const bevel = Math.min(.0035, .0018 / Math.max(.5, m.dot(b)))
    return [p[0], p[1] - m.x * bevel, p[2] - m.y * bevel]
  })
  const skin = polygon(inner, [1, 0, 0])
  const pos = skin.getAttribute('position'), normal = skin.getAttribute('normal')
  const n = new T.Vector3()
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), z = pos.getZ(i), r = Math.hypot(y, z)
    const slope = .0224 * (r / rr) ** -.30 / rr
    n.set(1, -slope * y / r, -slope * z / r).normalize()
    normal.setXYZ(i, n.x, n.y, n.z)
  }
  const part = (arr: Point[], u: number) => {
    const phase = u * arr.length
    return blend(arr[Math.floor(phase) % arr.length], arr[(Math.floor(phase) + 1) % arr.length], phase % 1)
  }
  const bevel = patch((u, v) => {
    const outer = part(outline, u)
    const q = blend(part(inner, u), outer, Math.sin(Math.PI * .5 * Math.min(1, v * 3)))
    const depth = (1 - Math.cos(Math.PI * .5 * Math.min(1, v * 3))) * .0025 + .017 * Math.max(0, (v - 1 / 3) * 1.5)
    return [q[0] - depth, q[1], q[2]]
  }, inner.length, 7, [1, 0, 0])
  const interior = polygon(outline.map(([x, y, z]) => [x - .0195, y, z]), [-1, 0, 0])
  return joined([skin, bevel, interior])
}

function caliper(w: WheelSize, full: boolean, axis: number): T.BufferGeometry {
  const rear = w === rearWheel
  const angle = rear ? 1.28 : -1.15
  const point = (x: number, r: number, a: number): Point => axisRoll(x, r, angle + a)
  const geom = patch((u, v) => {
    const angle0 = (u - .5) * (rear ? .71 : 1.01)
    const shoulder = Math.sin(Math.PI * u) ** .46
    const thickness = .041 + .020 * shoulder
    const radial = w.disc - .012 + (v - .5) * thickness
    return point(axis + .019 + .013 * Math.sin(v * Math.PI) * shoulder, radial, angle0)
  }, full ? 42 : 22, 16, [1, 0, 0], .062)
  const attachments = [
    disk(.017, .014, axis + .021, 18).translate(0, ...point(0, w.disc - .043, rear ? .27 : .41).slice(1) as [number, number]),
    disk(.017, .014, axis + .021, 18).translate(0, ...point(0, w.disc - .043, rear ? -.27 : -.41).slice(1) as [number, number]),
  ]
  if (full) {
    attachments.push(contour([
      point(axis + .010, w.disc - .039, -.35), point(axis + .031, w.disc - .036, -.26),
      point(axis + .038, w.disc - .035, .01), point(axis + .025, w.disc - .041, .27), point(axis + .010, w.disc - .039, .35),
    ], .0037))
  }
  return joined([geom, ...attachments])
}

export function createWheels(parent: T.Group, m: Palette, full: boolean): Point {
  let anchor: Point = [0, 0, 0]
  for (const w of [frontWheel, rearWheel]) {
    const H = w.width / 2, R = w.rim
    const axis = H - .040, face = H - .008, hubFace = H - .011
    const count = full ? 144 : 96
    const tire = tireGeometry(w, full)
    const barrel = lathe([
      [-w.rimWidth / 2, R + .004], [-w.rimWidth / 2 + .006, R + .006], [-w.rimWidth / 2 + .014, R - .012],
      [-.049, R - .017], [-.026, R - .026], [.020, R - .022], [face - .016, R - .013], [face - .004, R - .007],
      [face - .002, R - .0035], [face, R + .001], [face - .001, R + .007], [face - .013, R + .009],
    ], count)
    const forging: T.BufferGeometry[] = [barrel, disk(.065, .055, hubFace - .045, count)]
    for (let i = 0; i < 5; i++) forging.push(spoke(w, (i / 5) * tau + .10, face, full))
    const faceBits: T.BufferGeometry[] = [
      lathe([[face - .0002, R - .0033], [face + .002, R + .0022], [face - .0007, R + .0043]], count),
      disk(.028, .008, hubFace - .004, 40), disk(.084, .028, axis - .006, 45),
    ]
    for (let i = 0; i < 5; i++) {
      const [, y, z] = axisRoll(0, .051, tau * i / 5 + .33)
      faceBits.push(disk(.0106, .013, hubFace - .012, 6).translate(0, y, z))
    }
    for (let i = 0; i < 10; i++) {
      const [, y, z] = axisRoll(0, .091, tau * i / 10)
      faceBits.push(disk(.0074, .007, axis + .003, 8).translate(0, y, z))
    }
    const relief: T.BufferGeometry[] = []
    if (full) {
      const outerSidewall = curve([
        [R - .011, .86], [R + .013, .975], [w.radius - .054, 1], [w.radius - .026, .986],
        [w.radius - .010, .93], [w.radius, .67],
      ])
      const sideX = (r: number) => outerSidewall(r) * H
      for (const r of [R + .019, w.radius - .043, w.radius - .036]) {
        relief.push(lathe([[sideX(r - .002) - .0005, r - .002], [sideX(r) + .00065, r], [sideX(r + .002) - .0005, r + .002]], count))
      }
      for (let i = 0; i < 48; i++) {
        const a = tau * i / 48
        const r = w.radius - .036, q = w.radius - .027
        const points: Point[] = [
          axisRoll(sideX(r) + .0012, r, a - .011),
          axisRoll(sideX(r) + .0012, r + .0005, a + .010),
          axisRoll(sideX(q) + .0012, q, a + .019),
          axisRoll(sideX(q) + .0012, q - .001, a - .008),
        ]
        relief.push(polygon(roundedPath(points, 3, .14), [1, 0, 0], .0031))
      }
    }
    const forged = joined(forging), hardware = joined(faceBits), brake = rotor(w, full, axis), cal = caliper(w, full, axis)
    const sidewall = relief.length > 0 ? joined(relief) : null
    for (const side of [1, -1]) {
      const group = new T.Group()
      group.name = w === frontWheel ? 'front wheel' : 'rear wheel'
      group.position.set(w.x * side, w.loaded, w.z)
      group.scale.x = side
      add(group, 'loaded rubber and tread', tire, m.tire)
      add(group, 'forged divided spokes and barrel', forged, m.forged)
      add(group, 'machined flange and unmarked hub', hardware, m.brushed)
      add(group, 'drilled ceramic rotor', brake, m.brake)
      add(group, 'recessed brake shield', disk(R - .013, .010, -.052, 64), m.dark)
      add(group, 'fixed brake caliper', cal, m.caliper)
      if (sidewall) add(group, 'molded sidewall relief', sidewall, m.tire)
      parent.add(group)
    }
    if (w === frontWheel) anchor = [w.x + hubFace, w.loaded, w.z]
  }
  return anchor
}
