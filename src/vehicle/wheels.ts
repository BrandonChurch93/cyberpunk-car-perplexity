import * as T from 'three'
import { frontWheel, rearWheel, type WheelSize } from './body'
import { add, blend, curve, joined, mix, patch, polygon, roundedPath, smooth, tau, type Point } from './geometry'
import type { Palette } from './materials'

type Profile = ReadonlyArray<readonly [number, number]>
const axisRoll = (axis: number, radius: number, theta: number): Point => [axis, Math.cos(theta) * radius, Math.sin(theta) * radius]

function lathe(profile: Profile, segments: number): T.BufferGeometry {
  return new T.LatheGeometry(profile.map(([a, r]) => new T.Vector2(r, a)), segments).rotateZ(-Math.PI / 2)
}

function disk(radius: number, depth: number, x: number, segments = 40): T.BufferGeometry {
  return new T.CylinderGeometry(radius, radius, depth, segments).rotateZ(-Math.PI / 2).translate(x, 0, 0)
}

function treadInset(w: WheelSize, r: number): number {
  return (w === frontWheel ? .016 : .005) * smooth(r, w.radius - .051, w.radius - .012)
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
    return [p[0] + bulge - (p[0] > 0 ? treadInset(w, cross(v)) : 0), cushion - w.loaded, p[2]]
  }
  return patch(position, full ? 560 : 128, full ? 68 : 30, [0, -1, 0])
}

function rotor(w: WheelSize, full: boolean, axis: number): T.BufferGeometry {
  const face = new T.Shape()
  const dia = w.disc
  if (full) {
    const segments = 144
    face.moveTo(dia, 0)
    for (let i = 1; i < segments; i++) {
      const theta = tau * i / segments
      face.lineTo(dia * Math.cos(theta), dia * Math.sin(theta))
    }
    face.closePath()
  } else face.absarc(0, 0, dia, 0, tau, false)
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

function spoke(w: WheelSize, theta: number, axial: number, full: boolean): [T.BufferGeometry, T.BufferGeometry] {
  const rr = w.rim
  const local: readonly [number, number][] = [[.042, -.024], [.103, -.0275], [.149, -.0275], [rr * .83, -.076],
    [rr * .95, -.077], [rr * .99, -.069], [rr * .99, -.037], [rr * .92, -.035], [.183, -.011],
    [.173, .004], [.185, .020], [rr * .93, .047], [rr * .99, .058], [rr * .99, .093], [rr * .91, .090],
    [.151, .034], [.103, .0275], [.044, .023]]
  const point = (r: number, t: number, depth: number): Point => {
    r = Math.min(r, Math.sqrt((rr - .006) ** 2 - t ** 2))
    const a = theta + .15 * (r / rr - .48)
    return [axial - .015 * (1 - r / rr) - .005 * smooth(r, rr * .8, rr) - depth,
      Math.cos(a) * r - Math.sin(a) * t, Math.sin(a) * r + Math.cos(a) * t]
  }
  const outline = roundedPath(local.map(([r, t]) => point(r, t, 0)), full ? 4 : 2, .10)
  const side = Math.sign(outline.reduce((sum, p, i) => {
    const [, y, z] = outline[(i + 1) % outline.length]
    return sum + p[1] * z - p[2] * y
  }, 0))
  const normalYZ = (a: Point, b: Point) => new T.Vector2(b[2] - a[2], a[1] - b[1]).normalize().multiplyScalar(side)
  const inner = outline.map((p, i): Point => {
    const a = normalYZ(outline[(i - 1 + outline.length) % outline.length], p)
    const b = normalYZ(p, outline[(i + 1) % outline.length])
    const m = a.clone().add(b).normalize()
    const bevel = Math.min(.006, .0042 / Math.max(.65, m.dot(b)))
    const y = p[1] - m.x * bevel, z = p[2] - m.y * bevel
    const scale = Math.min(1, (rr - .006) / Math.hypot(y, z))
    return [p[0], y * scale, z * scale]
  })
  const skin = polygon(inner, [1, 0, 0])
  const pos = skin.getAttribute('position'), normal = skin.getAttribute('normal')
  const n = new T.Vector3()
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), z = pos.getZ(i), r = Math.hypot(y, z)
    const slope = .015 / rr
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
    const depth = .0045 * Math.min(1, v * 3) + .015 * Math.max(0, (v - 1 / 3) * 1.5)
    return [q[0] - depth, q[1], q[2]]
  }, inner.length, full ? 6 : 3, [1, 0, 0])
  const interior = polygon(outline.map(([x, y, z]) => [x - .0195, y, z]), [-1, 0, 0])
  return [skin, joined([bevel, interior])]
}

function caliper(w: WheelSize, full: boolean, axis: number): T.BufferGeometry {
  const rear = w === rearWheel
  const angle = rear ? 1.28 : -1.15
  const seat = axis - .009
  const point = (x: number, r: number, a: number): Point => axisRoll(x, r, angle + a)
  const span = rear ? .35 : .51
  const lower = w.disc - .048
  const upper = w.disc + .018
  const outline: readonly [number, number][] = [[-.99, .29], [-.78, 0], [.78, 0], [.99, .29], [.93, .70], [.46, 1], [-.46, 1], [-.93, .70]]
  const loop = (scale: number, x: number): Point[] => outline.map(([a, r]) =>
    point(x, mix(lower, upper, .5 + (r - .5) * scale), a * span * scale))
  const front = loop(.78, seat + .018)
  const edge = loop(1, seat + .008)
  const bevels = edge.map((p, i) => {
    const j = (i + 1) % edge.length
    return patch((u, v) => blend(blend(front[i], front[j], u), blend(p, edge[j], u), v), 1, 1, [1, 0, 0])
  })
  const attachments = [
    disk(.014, .014, seat + .007, 12).translate(0, ...point(0, w.disc - .043, .76 * span).slice(1) as [number, number]),
    disk(.014, .014, seat + .007, 12).translate(0, ...point(0, w.disc - .043, -.76 * span).slice(1) as [number, number]),
  ]
  if (full) {
    attachments.push(polygon([point(seat + .019, lower + .012, -.52 * span), point(seat + .019, lower + .012, .52 * span),
      point(seat + .019, lower + .022, .42 * span), point(seat + .019, lower + .022, -.42 * span)], [1, 0, 0], .002))
  }
  return joined([polygon(front, [1, 0, 0]), polygon(edge.map(([x, y, z]) => [x - .059, y, z]), [1, 0, 0], .059), ...bevels, ...attachments])
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
      [-.049, R - .017], [-.026, R - .026], [.020, R - .022], [face - .015, R - .009], [face - .008, R - .007],
      [face - .002, R - .004], [face, R + .001], [face - .001, R + .006], [face - .011, R + .007],
    ], count)
    const forging: T.BufferGeometry[] = [barrel, disk(.065, .055, hubFace - .045, count)]
    const faces: T.BufferGeometry[] = []
    for (let i = 0; i < 5; i++) {
      const [skin, side] = spoke(w, (i / 5) * tau + .10, face, full)
      faces.push(skin)
      forging.push(side)
    }
    const faceBits: T.BufferGeometry[] = [
      lathe([[face - .001, R - .003], [face + .001, R + .001], [face - .0002, R + .0034]], count),
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
      const sideX = (r: number) => outerSidewall(r) * H - treadInset(w, r)
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
    const forged = joined(forging), milled = joined(faces), hardware = joined(faceBits), brake = rotor(w, full, axis), cal = caliper(w, full, axis)
    const sidewall = relief.length > 0 ? joined(relief) : null
    for (const side of [1, -1]) {
      const group = new T.Group()
      group.name = w === frontWheel ? 'front wheel' : 'rear wheel'
      group.position.set(w.x * side, w.loaded, w.z)
      group.scale.x = side
      add(group, 'loaded rubber and tread', tire, m.tire)
      add(group, 'forged divided spokes and barrel', forged, m.forged)
      add(group, 'diamond cut spoke faces', milled, m.spoke)
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
