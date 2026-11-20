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
    [.27, w.radius - .010], [.34, w.radius - .0012], [.39, w.radius], [.61, w.radius],
    [.66, w.radius - .0012], [.73, w.radius - .010], [.77, w.radius - .026], [.82, w.radius - .054], [.92, w.rim + .013], [1, w.rim - .011],
  ])
  const width = curve([[0, -.86], [.12, -.974], [.179, -1], [.226, -.985], [.27, -.93], [.50, 0], [.73, .93], [.774, .985], [.821, 1], [.88, .974], [1, .86]])
  const axial = (v: number) => {
    if (v < .27 || v > .73) return width(v) * H
    return mix(-.93, .93, (v - .27) / .46) * H
  }
  const grooves = [.363, .452, .544, .638]
  const depth = (u: number, v: number): number => {
    const groove = grooves.reduce((r, g) => Math.max(r, 1 - smooth(Math.abs(v - g), .0045, .014)), 0)
    const block = (p: number, narrow: number, wide: number) => 1 - smooth(Math.abs(p - Math.round(p)), narrow, wide)
    const pitch = u * (full ? 52 : 24) + .23 * Math.sin(u * tau * 4)
    const inner = block(pitch + .43 + (v - .5) * 6, .075, .17) * smooth(v, .268, .300) * (1 - smooth(v, .363, .377))
    const outer = block(pitch + (v - .638) * 5 + 10 * (v - .69) ** 2, .085, .214)
      * smooth(v, .623, .639) * (1 - smooth(v, .763, .793))
    const sipes = block(pitch - .3 + (v - .49) * 5, .025, full ? .091 : .138)
      * smooth(v, .392, .416) * (1 - smooth(v, .576, .598))
    return Math.max(.0062 * groove, .0041 * inner, .0055 * outer, .0028 * sipes)
  }
  const position = (u: number, v: number): Point => {
    const th = u * tau
    const p = axisRoll(axial(v), cross(v) - depth(u, v), th)
    const ground = p[1] + w.loaded
    const cushion = ground > .010 ? ground : ground < 0 ? 0 : ground ** 2 * (20 - 1000 * ground) * 1000 / 100
    const bulge = .0015 * Math.exp(-((ground - .027) ** 2) / .00069) * Math.sin(Math.PI * v) * Math.sign(p[0])
    return [p[0] + bulge - (p[0] > 0 ? treadInset(w, cross(v)) : 0), cushion - w.loaded, p[2]]
  }
  const rows = [...new Set([
    ...Array.from({ length: full ? 55 : 17 }, (_, i) => i / (full ? 54 : 16)),
    ...grooves.flatMap((v) => [v - .014, v - .004, v + .004, v + .014]),
    .745, .773, .797,
  ])].sort((a, b) => a - b)
  return patch(position, full ? 576 : 96, rows.length - 1, [0, -1, 0], 0, (_, i) => rows[i])
}

function rotor(w: WheelSize, full: boolean, axis: number): [T.BufferGeometry, T.BufferGeometry, T.BufferGeometry] {
  const face = new T.Shape()
  const segments = full ? 160 : 96
  const radius = w.disc, ring = .104, lip = radius - .0018
  face.moveTo(lip, 0)
  for (let i = 1; i < segments; i++) {
    const theta = tau * i / segments
    face.lineTo(lip * Math.cos(theta), lip * Math.sin(theta))
  }
  face.closePath()
  const center = new T.Path()
  center.moveTo(ring, 0)
  for (let i = 1; i < segments / 2; i++) {
    const theta = -tau * i / (segments / 2)
    center.lineTo(ring * Math.cos(theta), ring * Math.sin(theta))
  }
  center.closePath()
  face.holes.push(center)
  const wells: T.BufferGeometry[] = []
  const count = full ? 24 : 16, edges = full ? 10 : 6
  for (let i = 0; i < count; i++) for (let j = 0; j < 4; j++) {
    const a = (i / count) * tau + .043 * j + .0105 * j ** 2
    const r = radius - .018 - .018 * j
    const drill = new T.Path(), y = Math.sin(a) * r, z = -Math.cos(a) * r
    for (let k = 0; k <= edges; k++) {
      const phi = -tau * k / edges
      const q = .0036
      if (k === 0) drill.moveTo(-z + q, y)
      else drill.lineTo(-z + q * Math.cos(phi), y + q * Math.sin(phi))
    }
    face.holes.push(drill)
    wells.push(patch((u, v) => {
      const phi = -u * tau, q = mix(.0036, .00285, v)
      return [axis - .007 * v, y + q * Math.sin(phi), z - q * Math.cos(phi)]
    }, edges, 1, [1, 0, 0]))
  }
  const rear = axis - w.discDepth, cheek = .0095
  const back = lathe([[rear, ring], [rear, lip], [rear + .0018, radius], [rear + cheek, radius], [rear + cheek, ring]], full ? segments : 64)
  const ceramic = joined([
    new T.ShapeGeometry(face, 1).rotateY(Math.PI / 2).translate(axis + .00002, 0, 0),
    lathe([[axis - cheek, ring], [axis - cheek, radius], [axis - .0018, radius], [axis, lip]], segments), back,
  ])
  const ventRibs: T.BufferGeometry[] = [lathe([[rear + cheek, .122], [axis - cheek, .122]], segments / 2)]
  for (let i = 0; i < (full ? 42 : 26); i++) {
    const a = tau * i / (full ? 42 : 26)
    ventRibs.push(patch((u, v) => axisRoll(mix(rear + cheek, axis - cheek, v), mix(.127, lip - .0015, u), a + .23 * u),
      full ? 2 : 1, 1, [0, -Math.sin(a), Math.cos(a)], .0038))
  }
  return [ceramic, joined([...wells, ...ventRibs]), lathe([
    [axis - .008, .115], [axis - .004, .112], [axis - .004, .105], [axis - .015, .104],
    [axis - .015, .098], [axis - .009, .088], [axis - .005, .081], [axis - .005, .047],
  ], full ? segments / 2 : 36)]
}

function spoke(w: WheelSize, theta: number, axial: number, full: boolean): [T.BufferGeometry, T.BufferGeometry] {
  const rr = w.rim
  const faceAt = (r: number) => axial - .034 + .034 * smooth(r, .045, rr) - .004 * smooth(r, rr * .8, rr)
  const local: readonly [number, number][] = [[.042, -.024], [.103, -.0275], [.149, -.0275], [rr * .83, -.076],
    [rr * .95, -.077], [rr * .99, -.069], [rr * .99, -.037], [rr * .92, -.035], [.183, -.011],
    [.173, .004], [.185, .020], [rr * .93, .047], [rr * .99, .058], [rr * .99, .093], [rr * .91, .090],
    [.151, .034], [.103, .0275], [.044, .023]]
  const point = (r: number, t: number, depth: number): Point => {
    r = Math.min(r, Math.sqrt((rr - .006) ** 2 - t ** 2))
    const a = theta + .15 * (r / rr - .48)
    return [faceAt(Math.hypot(r, t)) - depth,
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
    return [faceAt(Math.hypot(y, z) * scale), y * scale, z * scale]
  })
  const skin = polygon(inner, [1, 0, 0])
  const pos = skin.getAttribute('position'), normal = skin.getAttribute('normal')
  const n = new T.Vector3()
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), z = pos.getZ(i), r = Math.hypot(y, z)
    const slope = (faceAt(r + .001) - faceAt(r - .001)) / .002
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

function caliper(w: WheelSize, full: boolean, axis: number): [T.BufferGeometry, T.BufferGeometry, T.BufferGeometry] {
  const rear = w === rearWheel
  const middle = rear ? 1.18 : -.86
  const half = rear ? .735 : 1.05
  const low = w.disc - (rear ? .058 : .066)
  const outer = w.disc + (rear ? .026 : .025)
  const lowAt = curve([[0, .031], [.085, .012], [.21, 0], [.41, .001], [.58, .004], [.79, 0], [.92, .012], [1, .030]])
  const highAt = curve([[0, -.029], [.08, -.011], [.19, -.004], [.34, 0], [.58, .001], [.76, -.002], [.92, -.008], [1, -.030]])
  const profile = new T.CatmullRomCurve3([
    [.009, .052], [.016, .17], [.019, .38], [.018, .58], [.012, .84], [.004, .96], [-.014, 1],
    [-.040, .99], [-.055, .86], [-.058, .50], [-.056, .16], [-.051, .071], [-.044, .13],
    [-.043, .76], [-.033, .83], [-.012, .84], [.004, .80], [.005, .11],
  ].map(([x, y]) => new T.Vector3(x, y, 0)), true, 'centripetal')
  const body = (u: number, v: number): Point => {
    const { x, y: t } = profile.getPoint(v)
    const a = middle + half * (2 * u - 1)
    const radius = mix(low + lowAt(u), outer + highAt(u), t)
    const scallop = .0022 * Math.cos(tau * (rear ? 2 : 5) * (u - .035)) * smooth(t, .02, .40) * (1 - smooth(t, .56, .91))
    return axisRoll(axis + x * (.79 + .21 * smooth(u, 0, .13) * (1 - smooth(u, .87, 1))) + scallop, radius, a)
  }
  const sections = full ? 30 : 16
  const cast: T.BufferGeometry[] = [patch(body, full ? 52 : 28, sections, [-1, 0, 0])]
  for (const end of [0, 1]) {
    const a = middle + half * (2 * end - 1)
    const normal = axisRoll(0, 2 * end - 1, a + Math.PI / 2)
    const rim = Array.from({ length: sections }, (_, i) => body(end, i / sections))
    cast.push(polygon(rim, normal))
  }
  const rail = patch((u, v) => {
    const p = body(mix(.135, .864, u), mix(.045, .077, v))
    const taper = Math.sin(Math.PI * u) ** .45
    return [p[0] + .0025 * taper * Math.sin(Math.PI * v), p[1], p[2]]
  }, full ? 24 : 10, 3, [1, 0, 0])
  const clips: T.BufferGeometry[] = []
  const fasteners: T.BufferGeometry[] = []
  for (const u of [.16, .83]) {
    const [x, y, z] = body(u, .129)
    const clip = disk(.0068, .0035, x + .0012, full ? 16 : 8).translate(0, y, z)
    clips.push(clip)
    fasteners.push(disk(.0031, .0028, x + .0036, 6).translate(0, y, z))
  }
  return [joined([...cast, rail]), joined(clips), joined(fasteners)]
}

export function createWheels(parent: T.Group, m: Palette, full: boolean): Point {
  let anchor: Point = [0, 0, 0]
  for (const w of [frontWheel, rearWheel]) {
    const H = w.width / 2, R = w.rim
    const axis = H - .058, face = H - .008, hubPlane = face - .030, hubFace = hubPlane + .0018
    const count = full ? 144 : 72
    const tire = tireGeometry(w, full)
    const barrel = lathe([
      [-w.rimWidth / 2, R + .004], [-w.rimWidth / 2 + .010, R - .013], [-.039, R - .021],
      [-.006, R - .021], [.025, R - .017], [face - .019, R - .010], [face - .006, R - .007],
      [face - .001, R - .002], [face, R + .003], [face - .007, R + .006],
    ], count)
    const hub = disk(.084, .023, hubPlane - .0115, count)
    const cap = disk(.028, .006, hubFace - .003, 64)
    const forging: T.BufferGeometry[] = [barrel, lathe([
      [hubPlane - .010, .089], [hubPlane - .005, .093], [hubPlane - .001, .087], [hubPlane, .084],
    ], count)]
    const faces: T.BufferGeometry[] = []
    for (let i = 0; i < 5; i++) {
      const [skin, side] = spoke(w, (i / 5) * tau + .10, face, full)
      faces.push(skin)
      forging.push(side)
    }
    const faceBits: T.BufferGeometry[] = [
      lathe([[face - .001, R - .003], [face + .001, R + .001], [face - .0002, R + .0034]], count),
    ]
    const lugs: T.BufferGeometry[] = []
    for (let i = 0; i < 5; i++) {
      const [, y, z] = axisRoll(0, .051, tau * i / 5 + .33)
      lugs.push(disk(.0106, .010, hubPlane - .001, 6).translate(0, y, z))
    }
    const relief: T.BufferGeometry[] = []
    {
      const outerSidewall = curve([
        [R - .011, .86], [R + .013, .975], [w.radius - .054, 1], [w.radius - .026, .986],
        [w.radius - .010, .93], [w.radius, .67],
      ])
      const sideX = (r: number) => outerSidewall(r) * H - treadInset(w, r)
      for (const [r, half, rise] of [[R + .017, .0022, .0015], [w.radius - .044, .0014, .0012], [w.radius - .037, .0013, .0014]]) {
        relief.push(lathe([[sideX(r + half) - .001, r + half], [sideX(r) + rise, r], [sideX(r - half) - .001, r - half]], full ? count : 56))
      }
    }
    const forged = joined(forging), milled = joined(faces), hardware = joined(faceBits), [brake, apertures, hat] = rotor(w, full, axis)
    const [castCaliper, clips, fasteners] = caliper(w, full, axis)
    const pins = joined(Array.from({ length: 10 }, (_, i) => {
      const [, y, z] = axisRoll(0, .1095, tau * i / 10 + .134)
      return disk(.0037, .003, axis - .004, full ? 12 : 6).translate(0, y, z)
    }))
    const lugNuts = joined(lugs)
    const sidewall = relief.length > 0 ? joined(relief) : null
    for (const side of [1, -1]) {
      const group = new T.Group()
      group.name = w === frontWheel ? 'front wheel' : 'rear wheel'
      group.position.set(w.x * side, w.loaded, w.z)
      group.scale.x = side
      add(group, 'loaded rubber and tread', tire, m.tire)
      add(group, 'forged divided spokes and barrel', forged, m.forged)
      add(group, 'diamond cut spoke faces', milled, m.spoke)
      add(group, 'machined flange', hardware, m.brushed)
      add(group, 'flat recessed hub plate', hub, m.forged)
      add(group, 'flat center cap', cap, m.forged)
      add(group, 'five lug nuts', lugNuts, m.brushed)
      add(group, 'drilled ceramic rotor', brake, m.brake)
      add(group, 'recessed drill wells and rotor vents', apertures, m.dark)
      add(group, 'floating rotor hat', hat, m.forged)
      add(group, 'rotor hat bobbins', pins, m.brushed)
      add(group, 'recessed brake shield', disk(R - .018, .008, -.054, full ? 64 : 32), m.dark)
      add(group, 'fixed brake caliper', castCaliper, m.caliper)
      add(group, 'caliper pin seats', clips, m.matte)
      add(group, 'caliper pin heads', fasteners, m.brushed)
      if (sidewall) add(group, 'molded sidewall relief', sidewall, m.tire)
      parent.add(group)
    }
    if (w === frontWheel) anchor = [w.x + hubFace, w.loaded, w.z]
  }
  return anchor
}
