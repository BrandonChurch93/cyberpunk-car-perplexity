import * as THREE from 'three'
import { withEmitters, waterF0 } from '../../core/emitters-glsl'
import { stream } from '../../core/random'
import { insertAfter, patchMaterial } from '../../materials/patch'
import { dims } from '../body/shape'
import type { WetnessKind } from '../contract'
import { mirrorGeometry } from '../geom/mesh'
import type { Prof } from '../geom/shapes'
import type { V3 } from '../geom/vec'

export interface WheelSpec {
  radius: number
  width: number
  rim: number
  disc: { radius: number; thickness: number }
  flat: number
  caliperAngle: number
  caliperLength: number
  quality: number
}

export interface WheelParts {
  tire: THREE.BufferGeometry
  rim: THREE.BufferGeometry
  disc: THREE.BufferGeometry
  hat: THREE.BufferGeometry
  caliper: THREE.BufferGeometry
  face: V3
}

export interface WheelMaterials {
  dark: THREE.Material
  matte: THREE.Material
  rim?: THREE.Material
  disc?: THREE.Material
  hat?: THREE.Material
  caliper?: THREE.Material
  tire?: THREE.Material
  tag?: (material: THREE.Material, wetness: WetnessKind) => THREE.Material
}

interface WheelSize {
  readonly x: number
  readonly z: number
  readonly radius: number
  readonly loaded: number
  readonly width: number
  readonly rim: number
  readonly rimWidth: number
  readonly disc: number
  readonly discDepth: number
  readonly front: boolean
}

type Point = readonly [number, number, number]
type Knot = readonly [number, number]
type Profile = ReadonlyArray<readonly [number, number]>
type Pt2 = readonly [number, number]
interface LoopSample {
  readonly p: Pt2
  readonly n: Pt2
}

const tau = 2 * Math.PI
const mix = THREE.MathUtils.lerp
const smooth = THREE.MathUtils.smoothstep
const vec = (p: Point): THREE.Vector3 => new THREE.Vector3(p[0], p[1], p[2])
const axisRoll = (axis: number, radius: number, theta: number): Point => [
  axis,
  Math.cos(theta) * radius,
  Math.sin(theta) * radius,
]
const polar2 = (radius: number, theta: number): Pt2 => [Math.cos(theta) * radius, Math.sin(theta) * radius]
const local2 = (theta: number, radial: number, tangent: number): Pt2 => [
  Math.cos(theta) * radial - Math.sin(theta) * tangent,
  Math.sin(theta) * radial + Math.cos(theta) * tangent,
]

function frontWheelSize(): WheelSize {
  const t = dims.frontTire
  return {
    x: dims.frontHubX,
    z: dims.frontHubZ,
    radius: t.radius,
    loaded: 0.3405,
    width: t.width,
    rim: t.rim,
    rimWidth: 0.2413,
    disc: 0.205,
    discDepth: 0.038,
    front: true,
  }
}

function rearWheelSize(): WheelSize {
  const t = dims.rearTire
  return {
    x: dims.rearHubX,
    z: dims.rearHubZ,
    radius: t.radius,
    loaded: 0.3625,
    width: t.width,
    rim: t.rim,
    rimWidth: 0.3048,
    disc: 0.195,
    discDepth: 0.032,
    front: false,
  }
}

function curve(knots: readonly Knot[]): (x: number) => number {
  const slopes = knots.slice(1).map(([x, y], i) => (y - knots[i][1]) / (x - knots[i][0]))
  const derivatives = knots.map((_, i) => {
    if (i === 0) return slopes[0]
    if (i === knots.length - 1) return slopes[i - 1]
    const a = slopes[i - 1]
    const b = slopes[i]
    return a * b > 0 ? (2 * a * b) / (a + b) : 0
  })
  return (x) => {
    if (x <= knots[0][0]) return knots[0][1]
    if (x >= knots[knots.length - 1][0]) return knots[knots.length - 1][1]
    let i = 0
    while (x > knots[i + 1][0]) i++
    const [x0, y0] = knots[i]
    const [x1, y1] = knots[i + 1]
    const d = x1 - x0
    const t = (x - x0) / d
    const q = t * (1 - t)
    return mix(y0, y1, t) + q * ((1 - t) * (d * derivatives[i] - (y1 - y0)) + t * ((y1 - y0) - d * derivatives[i + 1]))
  }
}

/**
 * Ensures every output geometry is indexed, has finite unit normals, drops zero-area 3D slivers,
 * and unshares/reprojects any collapsed-UV triangle onto an isometric face frame so anisotropic
 * derivative tangents have strictly positive UV area in unguarded beauty renders.
 */
export function ensureValidWheelGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const posAttr = g.getAttribute('position')
  const vCount = posAttr.count
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  if (!g.getAttribute('uv')) {
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(vCount * 2), 2))
  }
  const nrmAttr = g.getAttribute('normal')
  const uvAttr = g.getAttribute('uv')
  const rawIdx = g.getIndex()
  const triCount = rawIdx ? Math.floor(rawIdx.count / 3) : Math.floor(vCount / 3)
  const validTris: number[] = []
  const badUvTris: number[] = []
  const pa = new THREE.Vector3()
  const pb = new THREE.Vector3()
  const pc = new THREE.Vector3()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const fn = new THREE.Vector3()

  for (let t = 0; t < triCount; t++) {
    const ia = rawIdx ? rawIdx.getX(t * 3) : t * 3
    const ib = rawIdx ? rawIdx.getX(t * 3 + 1) : t * 3 + 1
    const ic = rawIdx ? rawIdx.getX(t * 3 + 2) : t * 3 + 2
    pa.fromBufferAttribute(posAttr, ia)
    pb.fromBufferAttribute(posAttr, ib)
    pc.fromBufferAttribute(posAttr, ic)
    e1.subVectors(pb, pa)
    e2.subVectors(pc, pa)
    fn.crossVectors(e1, e2)
    if (!(fn.lengthSq() > 1e-22)) continue
    fn.normalize()
    for (const v of [ia, ib, ic]) {
      const nx = nrmAttr.getX(v)
      const ny = nrmAttr.getY(v)
      const nz = nrmAttr.getZ(v)
      const lenSq = nx * nx + ny * ny + nz * nz
      if (!(lenSq > 1e-6) || !Number.isFinite(lenSq)) {
        nrmAttr.setXYZ(v, fn.x, fn.y, fn.z)
      }
    }
    const ua = uvAttr.getX(ia)
    const va = uvAttr.getY(ia)
    const ub = uvAttr.getX(ib)
    const vb = uvAttr.getY(ib)
    const uc = uvAttr.getX(ic)
    const vc = uvAttr.getY(ic)
    const uvArea2 = Math.abs((ub - ua) * (vc - va) - (vb - va) * (uc - ua))
    if (!(uvArea2 >= 1e-11) || !Number.isFinite(uvArea2)) badUvTris.push(ia, ib, ic)
    else validTris.push(ia, ib, ic)
  }

  if (badUvTris.length > 0) {
    const attrNames = Object.keys(g.attributes)
    const oldCount = posAttr.count
    const totalCount = oldCount + badUvTris.length
    const grown = new Map<string, Float32Array>()
    for (const name of attrNames) {
      const attr = g.getAttribute(name)
      const next = new Float32Array(totalCount * attr.itemSize)
      next.set(attr.array as ArrayLike<number>, 0)
      grown.set(name, next)
    }
    const uvNext = grown.get('uv')!
    const tAxis = new THREE.Vector3()
    const bAxis = new THREE.Vector3()
    for (let k = 0; k < badUvTris.length; k += 3) {
      const src = [badUvTris[k], badUvTris[k + 1], badUvTris[k + 2]]
      const dst = [oldCount + k, oldCount + k + 1, oldCount + k + 2]
      for (const name of attrNames) {
        const itemSize = g.getAttribute(name).itemSize
        const arr = grown.get(name)!
        for (let m = 0; m < 3; m++) {
          for (let c = 0; c < itemSize; c++) arr[dst[m] * itemSize + c] = arr[src[m] * itemSize + c]
        }
      }
      pa.fromBufferAttribute(posAttr, src[0])
      pb.fromBufferAttribute(posAttr, src[1])
      pc.fromBufferAttribute(posAttr, src[2])
      e1.subVectors(pb, pa)
      e2.subVectors(pc, pa)
      const l1 = Math.max(1e-5, e1.length())
      tAxis.copy(e1).divideScalar(l1)
      fn.crossVectors(e1, e2).normalize()
      bAxis.crossVectors(fn, tAxis).normalize()
      uvNext[dst[0] * 2] = 0
      uvNext[dst[0] * 2 + 1] = 0
      uvNext[dst[1] * 2] = Math.max(1e-4, l1)
      uvNext[dst[1] * 2 + 1] = 0
      uvNext[dst[2] * 2] = e2.dot(tAxis)
      uvNext[dst[2] * 2 + 1] = Math.max(1e-4, Math.abs(e2.dot(bAxis)))
      validTris.push(dst[0], dst[1], dst[2])
    }
    for (const [name, arr] of grown.entries()) {
      g.setAttribute(name, new THREE.Float32BufferAttribute(arr, g.getAttribute(name).itemSize))
    }
  }

  const curVertCount = g.getAttribute('position').count
  const remap = new Int32Array(curVertCount).fill(-1)
  let compactCount = 0
  for (let i = 0; i < validTris.length; i++) {
    const v = validTris[i]
    if (remap[v] === -1) remap[v] = compactCount++
  }
  if (compactCount < curVertCount) {
    for (const name of Object.keys(g.attributes)) {
      const attr = g.getAttribute(name)
      const itemSize = attr.itemSize
      const src = attr.array as ArrayLike<number>
      const dst = new Float32Array(compactCount * itemSize)
      for (let v = 0; v < curVertCount; v++) {
        const nv = remap[v]
        if (nv === -1) continue
        for (let c = 0; c < itemSize; c++) dst[nv * itemSize + c] = src[v * itemSize + c]
      }
      g.setAttribute(name, new THREE.Float32BufferAttribute(dst, itemSize))
    }
    for (let i = 0; i < validTris.length; i++) validTris[i] = remap[validTris[i]]
  }

  const finalNrm = g.getAttribute('normal')
  for (let v = 0; v < finalNrm.count; v++) {
    const nx = finalNrm.getX(v)
    const ny = finalNrm.getY(v)
    const nz = finalNrm.getZ(v)
    const len = Math.hypot(nx, ny, nz)
    if (Number.isFinite(len) && len > 1e-6) finalNrm.setXYZ(v, nx / len, ny / len, nz / len)
    else finalNrm.setXYZ(v, 0, 1, 0)
  }

  const finalVertCount = g.getAttribute('position').count
  const idxArray = finalVertCount > 65535 ? new Uint32Array(validTris) : new Uint16Array(validTris)
  g.setIndex(new THREE.BufferAttribute(idxArray, 1))
  return g
}

function joined(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = []
  const nrm: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (const raw of geometries) {
    const g = ensureValidWheelGeometry(raw)
    const p = g.getAttribute('position')
    const n = g.getAttribute('normal')
    const u = g.getAttribute('uv')
    const index = g.getIndex()!
    const base = pos.length / 3
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i))
      nrm.push(n.getX(i), n.getY(i), n.getZ(i))
      uv.push(u.getX(i), u.getY(i))
    }
    for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i))
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  out.setIndex(idx)
  return ensureValidWheelGeometry(out)
}

function lathe(profile: Profile, segments: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([a, r]) => new THREE.Vector2(Math.max(1e-4, r), a)), segments).rotateZ(-Math.PI / 2)
  return ensureValidWheelGeometry(g)
}

function disk(radius: number, depth: number, x: number, segments = 40): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, depth, segments).rotateZ(-Math.PI / 2).translate(x, 0, 0)
  return ensureValidWheelGeometry(g)
}

function patch(
  point: (u: number, v: number) => Point,
  uSteps: number,
  vSteps: number,
  outward: Point,
  thickness = 0,
  row?: (u: number, j: number) => number,
): THREE.BufferGeometry {
  const p: number[] = []
  const n: number[] = []
  const uv: number[] = []
  const id: number[] = []
  const d = 0.0001
  const toNormal = (u: number, v: number) =>
    vec(point(Math.min(1, u + d), v))
      .sub(vec(point(Math.max(0, u - d), v)))
      .cross(vec(point(u, Math.min(1, v + d))).sub(vec(point(u, Math.max(0, v - d)))))
  const flip = toNormal(0.5, 0.5).dot(vec(outward)) < 0
  const distance = (alongU: boolean, cross: number) => {
    const path = (k: number) => vec(alongU ? point(k / 8, cross) : point(cross, k / 8))
    let length = 0
    for (let i = 0; i < 8; i++) length += path(i).distanceTo(path(i + 1))
    return Math.max(1e-3, length)
  }
  const uMeters = (distance(true, 0.25) + distance(true, 0.75)) * 0.5
  const vMeters = (distance(false, 0.25) + distance(false, 0.75)) * 0.5
  for (let j = 0; j <= vSteps; j++) {
    for (let i = 0; i <= uSteps; i++) {
      const u = i / uSteps
      const v = row ? row(u, j) : j / vSteps
      p.push(...point(u, v))
      const normal = toNormal(u, v).normalize().multiplyScalar(flip ? -1 : 1)
      n.push(...(normal.lengthSq() > 0 ? normal.toArray() : outward))
      uv.push(u * uMeters, v * vMeters)
    }
  }
  const triangle = (a: number, b: number, c: number, reversed = false) =>
    id.push(a, flip === reversed ? b : c, flip === reversed ? c : b)
  const stride = uSteps + 1
  for (let j = 0; j < vSteps; j++) {
    for (let i = 0; i < uSteps; i++) {
      const a = j * stride + i
      triangle(a, a + 1, a + stride + 1)
      triangle(a, a + stride + 1, a + stride)
    }
  }
  if (thickness > 0) {
    const count = p.length / 3
    for (let i = 0; i < count; i++) {
      p.push(p[i * 3] - thickness * n[i * 3], p[i * 3 + 1] - thickness * n[i * 3 + 1], p[i * 3 + 2] - thickness * n[i * 3 + 2])
      n.push(-n[i * 3], -n[i * 3 + 1], -n[i * 3 + 2])
      uv.push(uv[i * 2], uv[i * 2 + 1])
    }
    for (let j = 0; j < vSteps; j++) {
      for (let i = 0; i < uSteps; i++) {
        const a = count + j * stride + i
        triangle(a, a + 1, a + stride + 1, true)
        triangle(a, a + stride + 1, a + stride, true)
      }
    }
    const rimEdge: number[] = []
    for (let i = 0; i < uSteps; i++) rimEdge.push(i)
    for (let j = 0; j < vSteps; j++) rimEdge.push(j * stride + uSteps)
    for (let i = uSteps; i > 0; i--) rimEdge.push(vSteps * stride + i)
    for (let j = vSteps; j > 0; j--) rimEdge.push(j * stride)
    for (let i = 0; i < rimEdge.length; i++) {
      const a = rimEdge[i]
      const b = rimEdge[(i + 1) % rimEdge.length]
      triangle(a, b, b + count)
      triangle(a, b + count, a + count)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(id)
  if (thickness > 0) {
    const flat = g.toNonIndexed()
    g.dispose()
    flat.computeVertexNormals()
    return ensureValidWheelGeometry(flat)
  }
  return ensureValidWheelGeometry(g)
}

function polygon(points: readonly Point[], face: Point): THREE.BufferGeometry {
  const normal = vec(face).normalize()
  const tangent = new THREE.Vector3(0, 1, 0).cross(normal)
  if (tangent.lengthSq() < 1e-4) tangent.set(1, 0, 0).cross(normal)
  tangent.normalize()
  const bitangent = normal.clone().cross(tangent)
  const origin = vec(points[0])
  const contour = points.map((p) => {
    const d = vec(p).sub(origin)
    return new THREE.Vector2(d.dot(tangent), d.dot(bitangent))
  })
  const flip = THREE.ShapeUtils.area(contour) < 0
  const faces = THREE.ShapeUtils.triangulateShape(contour, [])
  const packed: number[] = []
  const nrm: number[] = []
  const uv: number[] = []
  for (let i = 0; i < points.length; i++) {
    packed.push(...points[i])
    nrm.push(normal.x, normal.y, normal.z)
    uv.push(contour[i].x, contour[i].y)
  }
  const index = faces.flatMap(([a, b, c]) => (flip ? [a, c, b] : [a, b, c]))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(packed, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(index)
  return ensureValidWheelGeometry(g)
}

function treadInset(w: WheelSize, r: number): number {
  return (w.front ? 0.016 : 0.005) * smooth(r, w.radius - 0.051, w.radius - 0.012)
}

function tireShell(w: WheelSize) {
  const H = w.width / 2
  const cross = curve([
    [0, w.rim - 0.009],
    [0.035, w.rim + 0.0065],
    [0.062, w.rim + 0.011],
    [0.14, w.radius - 0.052],
    [0.21, w.radius - 0.022],
    [0.27, w.radius - 0.0075],
    [0.34, w.radius - 0.001],
    [0.39, w.radius],
    [0.61, w.radius],
    [0.66, w.radius - 0.001],
    [0.73, w.radius - 0.0075],
    [0.79, w.radius - 0.022],
    [0.86, w.radius - 0.052],
    [0.938, w.rim + 0.011],
    [0.965, w.rim + 0.0065],
    [1, w.rim - 0.009],
  ])
  const width = curve([
    [0, -0.86],
    [0.032, -0.978],
    [0.058, -0.958],
    [0.145, -1.008],
    [0.215, -0.98],
    [0.27, -0.925],
    [0.5, 0],
    [0.73, 0.925],
    [0.785, 0.98],
    [0.855, 1.008],
    [0.942, 0.958],
    [0.968, 0.982],
    [1, 0.86],
  ])
  const axial = (v: number) => {
    if (v < 0.27 || v > 0.73) return width(v) * H
    return mix(-0.925, 0.925, (v - 0.27) / 0.46) * H
  }
  const place = (u: number, v: number, depthOffset: number, extraX = 0): Point => {
    const th = u * tau
    const p = axisRoll(axial(v) + extraX, cross(v) - depthOffset, th)
    const sv = v > 0.5 ? v : 1 - v
    const cheek = Math.sin(Math.PI * THREE.MathUtils.clamp((sv - 0.725) / 0.225, 0, 1)) ** 1.15
    const footChord = Math.exp(-((p[2] / 0.098) ** 2))
    const shoulderSpan = 1 - smooth(Math.abs(v - 0.5), 0.245, 0.315)
    const loadPress = 0.0042 * footChord * smooth(-p[1], w.loaded - 0.062, w.loaded - 0.004) * shoulderSpan
    const bellyZone = Math.exp(-((p[2] / 0.102) ** 2)) * smooth(-p[1], w.loaded - 0.102, w.loaded - 0.024)
    const cheekSag = 0.0048 * bellyZone * cheek
    const rawGround = p[1] - loadPress - cheekSag + w.loaded
    const h = 0.0135
    const s = rawGround / h
    const cushion = rawGround <= 0 ? 0 : rawGround >= h ? rawGround : h * s * s * (2 - s)
    const bulge = 0.0138 * bellyZone * cheek * Math.sign(p[0])
    const outerInset = smooth(v, 0.46, 0.66) * treadInset(w, cross(v))
    return [p[0] + bulge - outerInset, cushion - w.loaded, p[2]]
  }
  return { place }
}

function tireGeometry(w: WheelSize, full: boolean, hero = w.front): THREE.BufferGeometry {
  const { place } = tireShell(w)
  const front = w.front
  const pitches = front ? 40 : 32
  const grooves = [0.346, 0.452, 0.558, 0.658]
  const block = (p: number, narrow: number, wide: number) => 1 - smooth(Math.abs(p - Math.round(p)), narrow, wide)
  const depth = (u: number, v: number): number => {
    const groove = grooves.reduce((r, g) => Math.max(r, 1 - smooth(Math.abs(v - g), 0.0058, 0.0138)), 0)
    const shoulderGroove = 1 - smooth(Math.abs(v - 0.704), 0.0024, 0.0064)
    if (!full) {
      return Math.max(0.0042 * groove, 0.0018 * shoulderGroove)
    }
    const pitch = u * pitches
    const inner = block(pitch + 0.35 - (v - 0.346) * 2.1, 0.056, 0.152) * smooth(v, 0.264, 0.286) * (1 - smooth(v, 0.328, 0.341))
    const dv = Math.max(0, v - 0.66)
    const shProfile = smooth(v, 0.662, 0.676) * (1 - 0.52 * smooth(v, 0.728, 0.758)) * (1 - smooth(v, 0.76, 0.778))
    const outerSlot = block(pitch + dv * 2.2 + dv * dv * 6.2, 0.058, 0.156) * shProfile
    const ribOuter = block(pitch - 0.24 + (v - 0.608) * 2.0, 0.054, 0.148) * smooth(v, 0.57, 0.582) * (1 - smooth(v, 0.642, 0.654))
    const ribMid = block(pitch + 0.18 - (v - 0.505) * 1.9, 0.052, 0.146) * smooth(v, 0.466, 0.478) * (1 - smooth(v, 0.542, 0.554))
    const ribInner = block(pitch - 0.36 + (v - 0.399) * 1.9, 0.052, 0.146) * smooth(v, 0.36, 0.372) * (1 - smooth(v, 0.436, 0.448))
    return Math.max(
      0.0042 * groove,
      0.0018 * shoulderGroove,
      0.0022 * inner,
      0.0024 * outerSlot,
      0.0021 * ribOuter,
      0.002 * ribMid,
      0.002 * ribInner,
    )
  }
  const rows = [
    ...new Set(
      full
        ? [
            0, 0.062, 0.14, 0.21, 0.262, 0.284, 0.312,
            ...grooves.flatMap((v) => [v - 0.0138, v - 0.0058, v, v + 0.0058, v + 0.0138]),
            0.399, 0.505, 0.608,
            0.676, 0.694, 0.704, 0.714, 0.73, 0.748, 0.764, 0.78,
            0.798, 0.815, 0.833, 0.86, 0.892, 0.92, 0.942, 0.966, 0.984, 1,
          ]
        : hero
          ? [0, 0.276, ...grooves.flatMap((v) => [v - 0.0138, v, v + 0.0138]), 0.704, 0.73, 0.764, 0.802, 0.833, 0.873, 0.913, 0.952, 1]
          : [0, 0.22, 0.36, 0.5, 0.64, 0.74, 0.84, 0.94, 1],
    ),
  ].sort((a, b) => a - b)
  const uSteps = full ? (front ? 240 : 192) : hero ? 128 : 36
  const geom = patch((u, v) => place(u, v, depth(u, v)), uSteps, rows.length - 1, [0, -1, 0], 0, (_, i) => rows[i])
  const vCount = geom.getAttribute('position').count
  const cavity = new Float32Array(vCount)
  const tireUv = new Float32Array(vCount * 2)
  let ptr = 0
  let uvPtr = 0
  for (let j = 0; j < rows.length; j++) {
    const v = rows[j]
    for (let i = 0; i <= uSteps; i++) {
      if (ptr >= vCount) break
      const u = i / uSteps
      cavity[ptr++] = Math.min(1, depth(u, v) / 0.0042)
      tireUv[uvPtr++] = u
      tireUv[uvPtr++] = v
    }
  }
  geom.setAttribute('tireCavity', new THREE.Float32BufferAttribute(cavity, 1))
  geom.setAttribute('tireUv', new THREE.Float32BufferAttribute(tireUv, 2))
  return geom
}

function sidewallReliefGeometry(w: WheelSize, full: boolean, hero = w.front): THREE.BufferGeometry {
  const { place } = tireShell(w)
  const uSteps = full ? (w.front ? 168 : 120) : hero ? 72 : 28
  const outerCordon: Profile = full
    ? [[0.818, -0.0008], [0.823, 0.0014], [0.829, 0.00145], [0.834, -0.0008]]
    : [[0.819, -0.0008], [0.826, 0.0013], [0.833, -0.0008]]
  const innerCordon: Profile = full
    ? [[0.906, -0.0008], [0.911, 0.00145], [0.917, 0.0014], [0.922, -0.0008]]
    : [[0.907, -0.0008], [0.914, 0.0013], [0.921, -0.0008]]
  const beadKnots: Profile = full
    ? [[0.946, -0.0008], [0.954, 0.0024], [0.965, 0.0026], [0.975, 0.0012], [0.982, -0.0008]]
    : [[0.948, -0.0008], [0.96, 0.0022], [0.973, 0.001], [0.982, -0.0008]]
  const buildBand = (knots: Profile, mod?: (u: number, v: number) => number) =>
    patch(
      (u, s) => {
        const idx = THREE.MathUtils.clamp(s * (knots.length - 1), 0, knots.length - 1)
        const i = Math.min(knots.length - 2, Math.floor(idx))
        const f = idx - i
        const v = mix(knots[i][0], knots[i + 1][0], f)
        const h = mix(knots[i][1], knots[i + 1][1], f) + (mod ? mod(u, v) : 0)
        return place(u, v, 0, h)
      },
      uSteps,
      knots.length - 1,
      [1, 0, 0],
    )
  const parts = [buildBand(outerCordon), buildBand(innerCordon), buildBand(beadKnots)]
  if (full) {
    const plaqueKnots: Profile = [[0.854, -0.0009], [0.861, 0.0012], [0.879, 0.0012], [0.886, -0.0009]]
    parts.push(
      buildBand(plaqueKnots, (u, v) => {
        const arc = Math.abs(((u * 2 + 0.18) % 1) - 0.5)
        const win = 1 - smooth(arc, 0.14, 0.22)
        const fineRib = 0.00028 * Math.cos(u * (w.front ? 56 : 42) * tau) * smooth(v, 0.859, 0.864) * (1 - smooth(v, 0.876, 0.881))
        return (win - 1) * 0.0024 + win * fineRib
      }),
    )
  }
  return joined(parts)
}

function rotor(w: WheelSize, full: boolean, axis: number, hero = w.front): [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry] {
  const front = w.front
  const face = new THREE.Shape()
  const segments = full ? 108 : hero ? 96 : 36
  const radius = w.disc
  const ring = 0.104
  const lip = radius - 0.0018
  face.moveTo(lip, 0)
  for (let i = 1; i < segments; i++) {
    const theta = (tau * i) / segments
    face.lineTo(lip * Math.cos(theta), lip * Math.sin(theta))
  }
  face.closePath()
  const center = new THREE.Path()
  center.moveTo(ring, 0)
  for (let i = 1; i < segments / 2; i++) {
    const theta = (-tau * i) / (segments / 2)
    center.lineTo(ring * Math.cos(theta), ring * Math.sin(theta))
  }
  center.closePath()
  face.holes.push(center)
  const bevels: THREE.BufferGeometry[] = []
  const wells: THREE.BufferGeometry[] = []
  const count = full || hero ? 24 : 8
  const drillRows = full || hero ? 4 : 2
  const edges = full ? (front ? 8 : 6) : hero ? 8 : 5
  const qOuter = full || hero ? 0.0043 : 0.0036
  const qInner = 0.0032
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < drillRows; j++) {
      const a = (i / count) * tau + 0.043 * j + 0.0105 * j ** 2
      const r = radius - 0.018 - 0.018 * j
      const drill = new THREE.Path()
      const y = Math.sin(a) * r
      const z = -Math.cos(a) * r
      for (let k = 0; k < edges; k++) {
        const phi = (-tau * k) / edges
        if (k === 0) drill.moveTo(-z + qOuter, y)
        else drill.lineTo(-z + qOuter * Math.cos(phi), y + qOuter * Math.sin(phi))
      }
      drill.closePath()
      face.holes.push(drill)
      if (full || hero) {
        bevels.push(
          patch(
            (u, v) => {
              const phi = -u * tau
              const q = mix(qOuter, qInner, v)
              return [axis + 0.00002 - 0.00095 * v, y + q * Math.sin(phi), z - q * Math.cos(phi)]
            },
            edges,
            1,
            [1, 0, 0],
          ),
        )
      }
      wells.push(
        patch(
          (u, v) => {
            const phi = -u * tau
            const q = mix(qInner, 0.0027, v)
            return [axis - 0.00095 - 0.0065 * v, y + q * Math.sin(phi), z - q * Math.cos(phi)]
          },
          edges,
          1,
          [1, 0, 0],
        ),
      )
    }
  }
  const rear = axis - w.discDepth
  const cheek = 0.009
  const back = lathe(
    [
      [rear, ring],
      [rear, lip],
      [rear + 0.0018, radius],
      [rear + cheek, radius],
      [rear + cheek, ring],
    ],
    full ? 36 : 16,
  )
  const vaneCount = full ? 32 : hero ? 28 : 10
  const edgeVanes: THREE.BufferGeometry[] = []
  for (let i = 0; i < vaneCount; i++) {
    const a = (tau * i) / vaneCount + 0.04
    const thick = 0.0038
    const halfAng = (0.5 * thick) / radius
    edgeVanes.push(
      patch(
        (u, v) => axisRoll(mix(rear + cheek + 0.0005, axis - cheek - 0.0005, v), mix(radius - 0.0145, radius - 0.0002, u), a + halfAng),
        1,
        1,
        [0, -Math.sin(a), Math.cos(a)],
        thick,
      ),
    )
  }
  const ceramic = joined([
    ensureValidWheelGeometry(new THREE.ShapeGeometry(face, 1).rotateY(Math.PI / 2).translate(axis + 0.00002, 0, 0)),
    ...bevels,
    lathe(
      [
        [axis - cheek, ring],
        [axis - cheek, radius],
        [axis - 0.0018, radius],
        [axis, lip],
      ],
      segments,
    ),
    back,
    ...edgeVanes,
  ])
  const slotFloor = lathe(
    [
      [rear + cheek, 0.122],
      [rear + cheek, radius - 0.0148],
      [axis - cheek, radius - 0.0148],
      [axis - cheek, 0.122],
    ],
    full ? 48 : hero ? 36 : 16,
  )
  const hatGeom = lathe(
    [
      [axis - 0.008, 0.115],
      [axis - 0.004, 0.112],
      [axis - 0.004, 0.105],
      [axis - 0.015, 0.104],
      [axis - 0.015, 0.098],
      [axis - 0.009, 0.088],
      [axis - 0.005, 0.081],
      [axis - 0.005, 0.047],
    ],
    full ? 48 : hero ? 36 : 20,
  )
  return [ceramic, joined([...wells, slotFloor]), hatGeom]
}

function filletConvexCCW(pts: readonly Pt2[], radii: readonly number[], cornerSegs: number, maxEdge = 0.0075): LoopSample[] {
  const m = pts.length
  const corners: { s1: Pt2; s2: Pt2; arc: LoopSample[] }[] = []
  for (let i = 0; i < m; i++) {
    const prev = pts[(i - 1 + m) % m]
    const cur = pts[i]
    const next = pts[(i + 1) % m]
    let d1x = cur[0] - prev[0]
    let d1y = cur[1] - prev[1]
    let d2x = next[0] - cur[0]
    let d2y = next[1] - cur[1]
    const l1 = Math.hypot(d1x, d1y)
    const l2 = Math.hypot(d2x, d2y)
    d1x /= l1
    d1y /= l1
    d2x /= l2
    d2y /= l2
    const cross = d1x * d2y - d1y * d2x
    if (cross < 1e-4 || radii[i] <= 1e-5) {
      const nx = (d1y + d2y) * 0.5
      const ny = -(d1x + d2x) * 0.5
      const nl = Math.hypot(nx, ny) || 1
      corners.push({ s1: cur, s2: cur, arc: [{ p: cur, n: [nx / nl, ny / nl] }] })
      continue
    }
    const dot = THREE.MathUtils.clamp(-d1x * d2x - d1y * d2y, -0.999, 0.999)
    const halfA = 0.5 * Math.acos(dot)
    const maxTan = 0.46 * Math.min(l1, l2)
    const rad = Math.min(radii[i], maxTan * Math.tan(halfA))
    const tanLen = rad / Math.tan(halfA)
    const s1: Pt2 = [cur[0] - d1x * tanLen, cur[1] - d1y * tanLen]
    const s2: Pt2 = [cur[0] + d2x * tanLen, cur[1] + d2y * tanLen]
    const cx = s1[0] - d1y * rad
    const cy = s1[1] + d1x * rad
    const a0 = Math.atan2(s1[1] - cy, s1[0] - cx)
    let a1 = Math.atan2(s2[1] - cy, s2[0] - cx)
    while (a1 < a0) a1 += tau
    const arc: LoopSample[] = []
    for (let j = 0; j <= cornerSegs; j++) {
      const a = mix(a0, a1, j / cornerSegs)
      const nx = Math.cos(a)
      const ny = Math.sin(a)
      arc.push({ p: [cx + nx * rad, cy + ny * rad], n: [nx, ny] })
    }
    corners.push({ s1, s2, arc })
  }
  const out: LoopSample[] = []
  for (let i = 0; i < m; i++) {
    const cur = corners[i]
    const next = corners[(i + 1) % m]
    out.push(...cur.arc)
    const ex = next.s1[0] - cur.s2[0]
    const ey = next.s1[1] - cur.s2[1]
    const elen = Math.hypot(ex, ey)
    const steps = Math.max(1, Math.ceil(elen / maxEdge))
    if (steps > 1 && elen > 1e-5) {
      const nx = ey / elen
      const ny = -ex / elen
      for (let k = 1; k < steps; k++) {
        const t = k / steps
        out.push({ p: [cur.s2[0] + ex * t, cur.s2[1] + ey * t], n: [nx, ny] })
      }
    }
  }
  return out
}

function circleLoopCCW(center: Pt2, radius: number, segments: number): LoopSample[] {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * tau
    const nx = Math.cos(a)
    const ny = Math.sin(a)
    return { p: [center[0] + nx * radius, center[1] + ny * radius], n: [nx, ny] }
  })
}

function sweepLoopRibbon(
  loop: readonly LoopSample[],
  stations: ReadonlyArray<readonly [number, number]>,
  baseX: (y: number, z: number) => number,
): THREE.BufferGeometry {
  const m = loop.length
  const rows = stations.length
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const arcU: number[] = [0]
  for (let i = 1; i <= m; i++) {
    const a = loop[i - 1].p
    const b = loop[i % m].p
    arcU.push(arcU[i - 1] + Math.max(1e-5, Math.hypot(b[0] - a[0], b[1] - a[1])))
  }
  const stationV: number[] = [0]
  for (let j = 1; j < rows; j++) {
    const stepLen = Math.hypot(stations[j][0] - stations[j - 1][0], stations[j][1] - stations[j - 1][1])
    stationV.push(stationV[j - 1] + Math.max(1e-4, stepLen))
  }
  for (let j = 0; j < rows; j++) {
    const [offset, dx] = stations[j]
    for (let i = 0; i <= m; i++) {
      const { p, n } = loop[i % m]
      const y = p[0] + n[0] * offset
      const z = p[1] + n[1] * offset
      pos.push(baseX(y, z) + dx, y, z)
      uv.push(arcU[i], stationV[j])
    }
  }
  const stride = m + 1
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < m; i++) {
      const a = j * stride + i
      const b = a + 1
      const c = a + stride
      const d = c + 1
      idx.push(a, c, d, a, d, b)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return ensureValidWheelGeometry(g)
}

function refineInterior2D(verts: Pt2[], tris: [number, number, number][], maxEdge: number, passes: number): void {
  const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`)
  for (let pass = 0; pass < passes; pass++) {
    const counts = new Map<string, [number, number, number]>()
    for (const [a, b, c] of tris) {
      for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
        const k = edgeKey(u, v)
        const cur = counts.get(k)
        if (cur) cur[2]++
        else counts.set(k, [u, v, 1])
      }
    }
    const mids = new Map<string, number>()
    for (const [k, [u, v, count]] of counts) {
      if (count !== 2) continue
      const pu = verts[u]
      const pv = verts[v]
      if (Math.hypot(pu[0] - pv[0], pu[1] - pv[1]) <= maxEdge) continue
      mids.set(k, verts.length)
      verts.push([(pu[0] + pv[0]) * 0.5, (pu[1] + pv[1]) * 0.5])
    }
    if (mids.size === 0) break
    const next: [number, number, number][] = []
    for (const [a, b, c] of tris) {
      const mab = mids.get(edgeKey(a, b))
      const mbc = mids.get(edgeKey(b, c))
      const mca = mids.get(edgeKey(c, a))
      if (mab !== undefined && mbc !== undefined && mca !== undefined) {
        next.push([a, mab, mca], [mab, b, mbc], [mca, mbc, c], [mab, mbc, mca])
      } else if (mab !== undefined && mbc !== undefined) {
        next.push([a, mab, c], [mab, mbc, c], [mab, b, mbc])
      } else if (mbc !== undefined && mca !== undefined) {
        next.push([a, b, mbc], [a, mbc, mca], [mca, mbc, c])
      } else if (mca !== undefined && mab !== undefined) {
        next.push([a, mab, mca], [mab, b, c], [mab, c, mca])
      } else if (mab !== undefined) {
        next.push([a, mab, c], [mab, b, c])
      } else if (mbc !== undefined) {
        next.push([a, b, mbc], [a, mbc, c])
      } else if (mca !== undefined) {
        next.push([a, b, mca], [mca, b, c])
      } else {
        next.push([a, b, c])
      }
    }
    tris.length = 0
    tris.push(...next)
  }
}

function buildPlanarSurface(
  outer: readonly Pt2[],
  holes: ReadonlyArray<readonly Pt2[]>,
  heightAt: (y: number, z: number) => number,
  outwardSign: 1 | -1,
  maxInteriorEdge: number,
  passes = 2,
): THREE.BufferGeometry {
  const contour = outer.map(([y, z]) => new THREE.Vector2(y, z))
  const holeVecs = holes.map((h) => h.map(([y, z]) => new THREE.Vector2(y, z)))
  const rawFaces = THREE.ShapeUtils.triangulateShape(contour, holeVecs)
  const verts: Pt2[] = [...contour, ...holeVecs.flat()].map((v) => [v.x, v.y])
  const tris: [number, number, number][] = rawFaces.map(([a, b, c]) => {
    const pa = verts[a]
    const pb = verts[b]
    const pc = verts[c]
    const area2 = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])
    return (area2 * outwardSign > 0 ? [a, b, c] : [a, c, b]) as [number, number, number]
  })
  if (maxInteriorEdge > 0) refineInterior2D(verts, tris, maxInteriorEdge, passes)
  const pos: number[] = []
  const nrm: number[] = []
  const uv: number[] = []
  const eps = 0.0006
  for (const [y, z] of verts) {
    const x = heightAt(y, z)
    const dxdy = (heightAt(y + eps, z) - heightAt(y - eps, z)) / (2 * eps)
    const dxdz = (heightAt(y, z + eps) - heightAt(y, z - eps)) / (2 * eps)
    const nx = outwardSign
    const ny = -dxdy * outwardSign
    const nz = -dxdz * outwardSign
    const nl = Math.hypot(nx, ny, nz) || 1
    pos.push(x, y, z)
    nrm.push(nx / nl, ny / nl, nz / nl)
    uv.push(y, z)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(tris.flat())
  return ensureValidWheelGeometry(g)
}

function forgedWheelAssembly(
  w: WheelSize,
  full: boolean,
  hero = w.front,
): {
  satinWeb: THREE.BufferGeometry
  forging: THREE.BufferGeometry
  barrel: THREE.BufferGeometry
  machinedSpokes: THREE.BufferGeometry
  flange: THREE.BufferGeometry
  hub: THREE.BufferGeometry
  cap: THREE.BufferGeometry
  lugs: THREE.BufferGeometry
} {
  const front = hero
  const H = w.width / 2
  const R = w.rim
  const face = H - 0.008
  const hubPlane = face - 0.03
  const hubFace = hubPlane + 0.0018
  const rCap = 0.148 * R
  const rCollar = 0.161 * R
  const rHubInner = 0.248 * R
  const rHubOuter = 0.26 * R
  const rWebOuter = R - 0.0035
  const rWinOuter = R - 0.0124
  const theta0 = w.front ? 1.18 : 0.56
  const branchSpan = 0.456
  const stemRootHalf = 0.064 * R
  const stemForkHalf = 0.052 * R
  const branchBaseHalf = 0.045 * R
  const rPentInner = 0.284 * R
  const rPentArc = 0.296 * R
  const rFork = 0.425 * R
  const rForkJoin = 0.955 * R
  const tDraft = 0.0021
  const tChamfer = 0.0039
  const tSeam = tDraft + tChamfer

  const f0 = polar2(rFork, 0)
  const j0 = polar2(rForkJoin, branchSpan)
  const bdx = j0[0] - f0[0]
  const bdy = j0[1] - f0[1]
  const blen = Math.hypot(bdx, bdy)
  const bux = bdx / blen
  const buy = bdy / blen
  const nInX = buy
  const nInY = -bux
  const triEdgePt: Pt2 = [f0[0] + nInX * branchBaseHalf, f0[1] + nInY * branchBaseHalf]
  const crotchR = triEdgePt[0] - (triEdgePt[1] / buy) * bux
  const triB = 2 * crotchR * bux
  const triC = crotchR * crotchR - rWinOuter * rWinOuter
  const sTri = (-triB + Math.sqrt(Math.max(0, triB * triB - 4 * triC))) * 0.5
  const triHalfAngle = Math.atan2(sTri * buy, crotchR + sTri * bux)

  const pentOuterPt: Pt2 = [f0[0] - nInX * branchBaseHalf, f0[1] - nInY * branchBaseHalf]
  const sElbow = (stemForkHalf - pentOuterPt[1]) / buy
  const elbowX = pentOuterPt[0] + sElbow * bux
  const pDot = pentOuterPt[0] * bux + pentOuterPt[1] * buy
  const pC = pentOuterPt[0] * pentOuterPt[0] + pentOuterPt[1] * pentOuterPt[1] - rWinOuter * rWinOuter
  const sPentOuter = -pDot + Math.sqrt(Math.max(0, pDot * pDot - pC))
  const pentBranchOuterAngle = Math.atan2(pentOuterPt[1] + sPentOuter * buy, pentOuterPt[0] + sPentOuter * bux)

  const windowLoops: LoopSample[][] = []
  const lugCenters: Pt2[] = []
  const lugLoops: LoopSample[][] = []
  const rLug = 0.204 * R
  const rLugWell = 0.0066
  const tLugSeam = 0.0014
  const cornerSegs = full ? 9 : front ? 6 : 2
  const maxLoopEdge = full ? 0.013 : front ? 0.016 : 0.045
  const rimArcPts = (a0: number, a1: number, count: number): { pts: Pt2[]; radii: number[] } => {
    const pad = 0.088
    const pts: Pt2[] = [polar2(rWinOuter, a0)]
    const radii: number[] = [0.0148]
    if (a1 - a0 > 2 * pad && count > 1) {
      for (let m = 0; m < count; m++) {
        pts.push(polar2(rWinOuter, mix(a0 + pad, a1 - pad, count === 1 ? 0.5 : m / (count - 1))))
        radii.push(0)
      }
    }
    pts.push(polar2(rWinOuter, a1))
    radii.push(0.0148)
    return { pts, radii }
  }
  const arcSub = full ? 5 : front ? 3 : 0

  for (let k = 0; k < 5; k++) {
    const th = theta0 + (k / 5) * tau
    const thNext = th + tau / 5
    const aPent0 = th + pentBranchOuterAngle
    const aPent1 = thNext - pentBranchOuterAngle
    const pentOuterArc = rimArcPts(aPent0, aPent1, arcSub)
    const pentPts: Pt2[] = [
      local2(th, rPentInner, stemRootHalf),
      local2(th, elbowX, stemForkHalf),
      ...pentOuterArc.pts,
      local2(thNext, elbowX, -stemForkHalf),
      local2(thNext, rPentInner, -stemRootHalf),
      polar2(rPentArc, (th + thNext) * 0.5),
    ]
    const pentRadii = [0.0132, 0.0165, ...pentOuterArc.radii, 0.0165, 0.0132, 0.085]
    windowLoops.push(filletConvexCCW(pentPts, pentRadii, cornerSegs, maxLoopEdge))

    const triOuterArc = rimArcPts(th - triHalfAngle, th + triHalfAngle, arcSub)
    const triPts: Pt2[] = [polar2(crotchR, th), ...triOuterArc.pts]
    const triRadii = [0.0116, ...triOuterArc.radii]
    windowLoops.push(filletConvexCCW(triPts, triRadii, cornerSegs, maxLoopEdge))

    const lugCenter = polar2(rLug, th + tau / 10)
    lugCenters.push(lugCenter)
    lugLoops.push(circleLoopCCW(lugCenter, rLugWell, full ? 12 : front ? 10 : 8))
  }

  const hubBowlX = hubPlane + 0.0042
  const dishAt = (r: number): number => mix(hubPlane + 0.0068, face - 0.0008, smooth(r, rHubOuter, rWebOuter) ** 0.76)
  const webHeight = (y: number, z: number): number => dishAt(Math.hypot(y, z))
  const hubFlatHeight = (): number => hubBowlX

  const collarLoop = circleLoopCCW([0, 0], rCollar, full ? 32 : front ? 24 : 16)
  const collarSeamOffset = 0.0018
  const collarSeamPts = collarLoop.map(({ p, n }) => [p[0] + n[0] * collarSeamOffset, p[1] + n[1] * collarSeamOffset] as Pt2)

  const hubDiscSegs = full ? 48 : front ? 32 : 18
  const hubInnerPts = Array.from({ length: hubDiscSegs }, (_, i) => polar2(rHubInner, (i / hubDiscSegs) * tau))
  const hubOuterLoop = circleLoopCCW([0, 0], rHubOuter, hubDiscSegs)
  const hubOuterPts = hubOuterLoop.map(({ p }) => p)

  const barrelCount = full ? 108 : front ? 72 : 30
  const outerWebPts = Array.from({ length: barrelCount }, (_, i) => polar2(rWebOuter, (i / barrelCount) * tau))
  const windowSeamHoles = windowLoops.map((loop) => loop.map(({ p, n }) => [p[0] + n[0] * tSeam, p[1] + n[1] * tSeam] as Pt2))
  const lugSeamHoles = lugLoops.map((loop) => loop.map(({ p, n }) => [p[0] + n[0] * tLugSeam, p[1] + n[1] * tLugSeam] as Pt2))

  const frontWeb = buildPlanarSurface(outerWebPts, [hubOuterPts, ...windowSeamHoles], webHeight, 1, full ? 0.016 : 0, full ? 1 : 0)
  const hubDisc = buildPlanarSurface(hubInnerPts, [collarSeamPts, ...lugSeamHoles], hubFlatHeight, 1, 0)
  const xHubOuter = dishAt(rHubOuter)
  const hubStepWall = lathe(
    [
      [xHubOuter, rHubOuter],
      [mix(hubBowlX, xHubOuter, 0.76), mix(rHubInner, rHubOuter, 0.72)],
      [mix(hubBowlX, xHubOuter, 0.2), mix(rHubInner, rHubOuter, 0.26)],
      [hubBowlX, rHubInner],
    ],
    hubDiscSegs,
  )

  const forgedParts: THREE.BufferGeometry[] = [hubDisc, hubStepWall]
  const machinedParts: THREE.BufferGeometry[] = []

  for (const loop of windowLoops) {
    const sidewall: Profile = [
      [0.0005, -0.008],
      [0, -0.0068],
      [tDraft, -0.0031],
    ]
    const chamfer: Profile = full
      ? [
          [tDraft, -0.0031],
          [tDraft + 0.0011, -0.0016],
          [tDraft + 0.0024, -0.00045],
          [tSeam, 0],
        ]
      : front
        ? [
            [tDraft, -0.0031],
            [tDraft + 0.0017, -0.0012],
            [tSeam, 0],
          ]
        : [
            [tDraft, -0.0031],
            [tSeam, 0],
          ]
    forgedParts.push(sweepLoopRibbon(loop, sidewall, webHeight))
    machinedParts.push(sweepLoopRibbon(loop, chamfer, webHeight))
  }

  const bezelFloorX = hubPlane - 0.0012
  machinedParts.push(
    sweepLoopRibbon(
      collarLoop,
      [
        [0, bezelFloorX - hubBowlX],
        [0.0009, 0.0007],
        [collarSeamOffset, 0],
      ],
      hubFlatHeight,
    ),
  )

  const lugFloorX = hubPlane - 0.0028
  for (let k = 0; k < 5; k++) {
    const loop = lugLoops[k]
    forgedParts.push(
      sweepLoopRibbon(loop, [[0, lugFloorX - hubBowlX], [0.0007, -0.0011]], hubFlatHeight),
      polygon(loop.map(({ p }) => [lugFloorX, p[0], p[1]] as Point), [1, 0, 0]),
    )
    machinedParts.push(sweepLoopRibbon(loop, [[0.0007, -0.0011], [tLugSeam, 0]], hubFlatHeight))
  }

  const barrel = lathe(
    [
      [face - 0.012, R + 0.0065],
      [face - 0.002, R + 0.0024],
      [face - 0.0056, R + 0.002],
      [face - 0.017, R - 0.0042],
      [face - 0.0183, R - 0.0108],
      [face - 0.036, R - 0.0122],
      [face - 0.064, R - 0.0142],
      [-0.012, R - 0.0164],
      [-0.064, R - 0.0182],
      [-w.rimWidth / 2 + 0.016, R - 0.0145],
      [-w.rimWidth / 2, R + 0.0045],
    ],
    barrelCount,
  )

  const flange = lathe(
    [
      [face - 0.0024, R + 0.003],
      [face + 0.0006, R + 0.002],
      [face + 0.002, R + 0.0007],
      [face + 0.0024, R - 0.0007],
      [face + 0.0018, R - 0.0021],
      [face + 0.0007, R - 0.0035],
      [face - 0.0006, R - 0.0045],
      [face - 0.0016, R - 0.0052],
    ],
    barrelCount,
  )

  const ringSegs = full ? 40 : front ? 28 : 16
  const hub = lathe(
    [
      [hubPlane - 0.003, rCollar + 0.003],
      [hubPlane, rCollar],
      [hubPlane, rCap - 0.002],
      [hubPlane - 0.002, rCap - 0.003],
      [hubPlane - 0.002, 0.0002],
    ],
    ringSegs,
  )

  const capBezel = lathe(
    [
      [hubPlane - 0.0016, rCap + 0.0005],
      [hubPlane + 0.0014, rCap - 0.0006],
      [hubPlane + 0.0016, rCap - 0.0022],
      [hubPlane + 0.0005, rCap - 0.0034],
    ],
    ringSegs,
  )
  machinedParts.push(capBezel)
  const cap = lathe(
    [
      [hubPlane + 0.0005, rCap - 0.0032],
      [hubPlane + 0.0007, rCap * 0.78],
      [hubPlane - 0.0004, rCap * 0.56],
      [hubPlane - 0.0015, rCap * 0.32],
      [hubPlane - 0.0021, rCap * 0.12],
      [hubPlane - 0.0023, 0.0002],
    ],
    ringSegs,
  )

  const lugTopX = hubPlane + 0.003
  const lugGeoms: THREE.BufferGeometry[] = []
  for (const [ly, lz] of lugCenters) {
    const bolt = lathe(
      [
        [lugFloorX, 0.0058],
        [lugFloorX + 0.0018, 0.0054],
        [lugTopX - 0.0005, 0.0048],
        [lugTopX, 0.0042],
        [lugTopX, 0.0026],
        [lugFloorX + 0.0016, 0.0022],
        [lugFloorX + 0.0016, 0.0002],
      ],
      full ? 8 : 6,
    ).translate(0, ly, lz)
    lugGeoms.push(ensureValidWheelGeometry(bolt))
  }

  return {
    satinWeb: frontWeb,
    forging: joined(forgedParts),
    barrel,
    machinedSpokes: joined(machinedParts),
    flange,
    hub,
    cap,
    lugs: joined(lugGeoms),
  }
}

function caliper(
  w: WheelSize,
  full: boolean,
  axis: number,
  hero = w.front,
): [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry] {
  const rear = !w.front
  const middle = rear ? 0.78 : -0.98
  const half = rear ? 0.8 : 1.05
  const low = w.disc - (rear ? 0.058 : 0.066)
  const outer = w.disc + (rear ? 0.026 : 0.025)
  const lowAt = curve([
    [0, 0.032],
    [0.085, 0.012],
    [0.21, 0],
    [0.41, 0.001],
    [0.58, 0.004],
    [0.79, 0],
    [0.92, 0.012],
    [1, 0.031],
  ])
  const highAt = curve([
    [0, -0.031],
    [0.075, -0.011],
    [0.18, -0.003],
    [0.34, 0],
    [0.58, 0.001],
    [0.78, -0.002],
    [0.925, -0.01],
    [1, -0.032],
  ])
  const crossPts: Profile = full
    ? [
        [0.0065, 0.054], [0.0148, 0.105], [0.0166, 0.155],
        [0.0169, 0.24], [0.0169, 0.36], [0.0169, 0.48], [0.0169, 0.6], [0.0168, 0.72],
        [0.0166, 0.815], [0.016, 0.878], [0.0146, 0.912], [0.0102, 0.962], [0.0032, 0.99],
        [-0.012, 0.998], [-0.036, 0.992], [-0.053, 0.89], [-0.058, 0.5],
        [-0.056, 0.16], [-0.051, 0.072], [-0.044, 0.13], [-0.043, 0.76],
        [-0.033, 0.83], [-0.012, 0.84], [0.004, 0.8], [0.005, 0.11],
      ]
    : [
        [0.0065, 0.054], [0.0148, 0.105], [0.0166, 0.155], [0.0169, 0.32], [0.0169, 0.62],
        [0.0166, 0.815], [0.016, 0.878], [0.0146, 0.912], [0.0102, 0.962], [0.0032, 0.99],
        [-0.012, 0.998], [-0.036, 0.992], [-0.053, 0.89], [-0.058, 0.5],
        [-0.056, 0.16], [-0.051, 0.072], [-0.044, 0.13], [-0.043, 0.76],
        [-0.033, 0.83], [-0.012, 0.84], [0.004, 0.8], [0.005, 0.11],
      ]
  const nPts = crossPts.length
  const sampleStation = (v: number): Pt2 => {
    const s = (((v % 1) + 1) % 1) * nPts
    const i = Math.floor(s)
    const f = s - i
    const a = crossPts[i % nPts]
    const b = crossPts[(i + 1) % nPts]
    return [mix(a[0], b[0], f), mix(a[1], b[1], f)]
  }
  const grooveAt = (u: number, center: number, halfW: number): number => 1 - smooth(Math.abs(u - center), halfW * 0.24, halfW)
  const placeArch = (u: number, x: number, t: number, relief = 0): Point => {
    const a = middle + half * (2 * u - 1)
    const endCurve = smooth(u, 0, 0.09) * (1 - smooth(u, 0.91, 1))
    const endTaper = 0.58 + 0.42 * endCurve
    const noseDrop = 0.0038 * (1 - endCurve) * smooth(t, 0.55, 0.96)
    const radius = mix(low + lowAt(u), outer + highAt(u) - noseDrop, t)
    return axisRoll(axis + x * endTaper + relief, radius, a)
  }
  const body = (u: number, v: number): Point => {
    const [x, t] = sampleStation(v)
    const cheekMask = smooth(x, 0.01, 0.0162) * smooth(t, 0.16, 0.34) * (1 - smooth(t, 0.68, 0.86))
    const flutes = Math.max(grooveAt(u, 0.365, 0.048), grooveAt(u, 0.635, 0.048))
    let boss = 0
    for (const bu of rear ? [0.33, 0.67] : [0.235, 0.5, 0.765]) {
      const du = (u - bu) / 0.086
      const dt = (t - 0.48) / 0.26
      const d = Math.hypot(du, dt)
      boss = Math.max(boss, 1 - smooth(d, 0.3, 1.0))
    }
    const topWindow =
      smooth(t, 0.885, 0.93) *
      (1 - smooth(t, 0.968, 0.995)) *
      smooth(x, -0.032, -0.018) *
      (1 - smooth(x, 0.001, 0.009)) *
      Math.max(smooth(u, 0.21, 0.265) * (1 - smooth(u, 0.435, 0.49)), smooth(u, 0.51, 0.565) * (1 - smooth(u, 0.735, 0.79)))
    return placeArch(u, x - 0.003 * topWindow, t - 0.006 * topWindow, (0.0015 * boss - 0.0015 * flutes) * cheekMask)
  }
  const sections = nPts
  const uSpan = full ? (rear ? 28 : 44) : hero ? 28 : 12
  const cast: THREE.BufferGeometry[] = [patch(body, uSpan, sections, [-1, 0, 0])]
  for (const end of [0, 1]) {
    const a = middle + half * (2 * end - 1)
    const normal = axisRoll(0, 2 * end - 1, a + Math.PI / 2)
    const rim = Array.from({ length: sections }, (_, i) => body(end, i / sections))
    cast.push(polygon(rim, normal))
  }
  const rail = patch(
    (u, v) => {
      const p = body(mix(0.135, 0.864, u), mix(0.065, 0.115, v))
      const taper = Math.sin(Math.PI * u) ** 0.45
      return [p[0] + 0.002 * taper * Math.sin(Math.PI * v), p[1], p[2]]
    },
    full ? 16 : 10,
    3,
    [1, 0, 0],
  )
  const clips: THREE.BufferGeometry[] = []
  const fasteners: THREE.BufferGeometry[] = []
  for (const [u, vPos] of [
    [0.15, 0.09],
    [0.365, 0.24],
    [0.635, 0.24],
    [0.85, 0.09],
  ] as const) {
    const [x, y, z] = body(u, vPos)
    clips.push(ensureValidWheelGeometry(disk(0.0058, 0.0028, x + 0.0006, full ? 10 : 8).translate(0, y, z)))
    fasteners.push(
      ensureValidWheelGeometry(
        lathe(
          [
            [x + 0.0006, 0.0039],
            [x + 0.0028, 0.0035],
            [x + 0.0028, 0.0019],
            [x + 0.0012, 0.0016],
            [x + 0.0012, 0.0002],
          ],
          full ? 8 : 6,
        ).translate(0, y, z),
      ),
    )
  }
  if (!rear) {
    const [bx, by, bz] = body(0.908, 0.31)
    clips.push(ensureValidWheelGeometry(disk(0.0052, 0.0022, bx + 0.0005, full ? 10 : 8).translate(0, by, bz)))
    fasteners.push(
      ensureValidWheelGeometry(
        lathe(
          [
            [bx + 0.0006, 0.0036],
            [bx + 0.0036, 0.0032],
            [bx + 0.0052, 0.0021],
            [bx + 0.0066, 0.0026],
            [bx + 0.0076, 0.0017],
            [bx + 0.0076, 0.0002],
          ],
          full ? 8 : 6,
        ).translate(0, by, bz),
      ),
    )
  }
  return [joined([...cast, rail]), joined(clips), joined(fasteners)]
}

export function tireProfile(s: WheelSpec): Prof {
  const R = s.radius
  const hw = s.width / 2
  const bead = s.rim + 0.011
  return [
    [s.rim - 0.009, -hw * 0.86],
    [bead, -hw * 0.96],
    [R - 0.052, -hw * 1.008],
    [R - 0.0075, -hw * 0.925],
    [R, 0],
    [R - 0.0075, hw * 0.925],
    [R - 0.052, hw * 1.008],
    [bead, hw * 0.96],
    [s.rim - 0.009, hw * 0.86],
  ]
}

export function buildWheel(s: WheelSpec): WheelParts {
  const full = s.quality > 0.75
  const front = s.width < 0.3
  const w: WheelSize = {
    x: front ? dims.frontHubX : dims.rearHubX,
    z: front ? dims.frontHubZ : dims.rearHubZ,
    radius: s.radius,
    loaded: s.radius - s.flat,
    width: s.width,
    rim: s.rim,
    rimWidth: front ? 0.2413 : 0.3048,
    disc: s.disc.radius,
    discDepth: s.disc.thickness,
    front,
  }
  const H = w.width / 2
  const axis = H - 0.047
  const face = H - 0.008
  const hubFace = face - 0.03 + 0.0018
  const tire = joined([tireGeometry(w, full, front), sidewallReliefGeometry(w, full, front)])
  const wheel = forgedWheelAssembly(w, full, front)
  const [ceramic, apertures, hat] = rotor(w, full, axis, front)
  const pins = Array.from({ length: 10 }, (_, i) => {
    const [, y, z] = axisRoll(0, 0.1065, (tau * i) / 10 + 0.134)
    return ensureValidWheelGeometry(
      lathe(
        [
          [axis - 0.0035, 0.0064],
          [axis + 0.0018, 0.0058],
          [axis + 0.0018, 0.0031],
          [axis - 0.003, 0.0027],
        ],
        full ? 8 : 6,
      ).translate(0, y, z),
    )
  })
  const [castCaliper, clips, fasteners] = caliper(w, full, axis, front)
  return {
    tire,
    rim: joined([wheel.satinWeb, wheel.forging, wheel.barrel, wheel.machinedSpokes, wheel.flange, wheel.hub, wheel.cap, wheel.lugs]),
    disc: joined([ceramic, apertures]),
    hat: joined([hat, ...pins]),
    caliper: joined([castCaliper, clips, fasteners]),
    face: [hubFace, 0, 0],
  }
}

export interface EmitterGlintSheenOptions {
  baseCurv: number
  coatCurv: number
  coatF0?: number
  gain?: number
  includeBase?: boolean
}

export function patchEmitterGlintSheen(
  mat: THREE.Material,
  id: string,
  opts: EmitterGlintSheenOptions,
): void {
  const includeBase = opts.includeBase ?? true
  patchMaterial(mat, {
    id,
    uniforms: {
      weBaseCurv: { value: opts.baseCurv },
      weCoatCurv: { value: opts.coatCurv },
      weCoatF0Val: { value: opts.coatF0 ?? waterF0 + 0.012 },
      weGain: { value: opts.gain ?? 1.0 },
    },
    apply(shader) {
      shader.vertexShader =
        'varying vec3 wheelEmitWorldPos;\n' +
        insertAfter(
          shader.vertexShader,
          '#include <project_vertex>',
          `{
            vec4 weP = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
              weP = instanceMatrix * weP;
            #endif
            wheelEmitWorldPos = (modelMatrix * weP).xyz;
          }`,
        )
      let f =
        'varying vec3 wheelEmitWorldPos;\nuniform float weBaseCurv;\nuniform float weCoatCurv;\nuniform float weCoatF0Val;\nuniform float weGain;\n' +
        shader.fragmentShader
      f = insertAfter(
        f,
        '#include <lights_fragment_end>',
        `{
          vec3 weToEye = cameraPosition - wheelEmitWorldPos;
          vec3 weV = weToEye / max(length(weToEye), 1e-4);
          vec3 weViewV = normalize(vViewPosition);
          vec3 weSpecAdd = vec3(0.0);
          ${
            includeBase
              ? `vec3 weN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float weRough = clamp(material.roughness, 0.045, 1.0);
          vec3 weBaseF0 = material.specularColor;
          vec3 weSharpBase = emitterGlintF0(wheelEmitWorldPos, weN, weV, weRough, weBaseCurv, weBaseF0);
          vec3 weIblBase = vec3(0.0);
          #ifdef USE_ENVMAP
            weIblBase = emitterFresnel(weBaseF0, clamp(dot(weN, weV), 0.0, 1.0)) * getIBLRadiance(weViewV, normal, weRough);
          #endif
          weSpecAdd += max(weSharpBase - weIblBase, vec3(0.0));
          float weBaseSheenR = clamp(max(weRough, 0.35), 0.28, 0.48);
          vec3 weSheenBase = emitterGlintF0(wheelEmitWorldPos, weN, weV, weBaseSheenR, max(weBaseCurv * 0.45, 0.016), weBaseF0);
          vec3 weIblBaseS = vec3(0.0);
          #ifdef USE_ENVMAP
            weIblBaseS = emitterFresnel(weBaseF0, clamp(dot(weN, weV), 0.0, 1.0)) * getIBLRadiance(weViewV, normal, weBaseSheenR);
          #endif
          weSpecAdd += 0.82 * max(weSheenBase - weIblBaseS, vec3(0.0));`
              : ''
          }
          #ifdef USE_CLEARCOAT
            vec3 weCcN = normalize((vec4(clearcoatNormal, 0.0) * viewMatrix).xyz);
            float weCcRough = clamp(material.clearcoatRoughness, 0.04, 1.0);
            vec3 weCoatF0 = vec3(weCoatF0Val);
            vec3 weSharpCoat = emitterGlintF0(wheelEmitWorldPos, weCcN, weV, weCcRough, weCoatCurv, weCoatF0);
            vec3 weIblCoat = vec3(0.0);
            #ifdef USE_ENVMAP
              weIblCoat = emitterFresnel(weCoatF0, clamp(dot(weCcN, weV), 0.0, 1.0)) * getIBLRadiance(weViewV, clearcoatNormal, weCcRough);
            #endif
            weSpecAdd += material.clearcoat * max(weSharpCoat - weIblCoat, vec3(0.0));
            float weSheenRough = clamp(max(weCcRough, 0.34), 0.26, 0.46);
            vec3 weSheenCoat = emitterGlintF0(wheelEmitWorldPos, weCcN, weV, weSheenRough, max(weCoatCurv * 0.45, 0.016), weCoatF0);
            vec3 weIblSheen = vec3(0.0);
            #ifdef USE_ENVMAP
              weIblSheen = emitterFresnel(weCoatF0, clamp(dot(weCcN, weV), 0.0, 1.0)) * getIBLRadiance(weViewV, clearcoatNormal, weSheenRough);
            #endif
            weSpecAdd += 0.78 * material.clearcoat * max(weSheenCoat - weIblSheen, vec3(0.0));
          #endif
          reflectedLight.indirectSpecular += min(weSpecAdd * weGain, vec3(48.0));
        }`,
      )
      shader.fragmentShader = f
      withEmitters(shader)
    },
  })
}

export function buildWheels(root: THREE.Group, m: WheelMaterials, full: boolean): V3 {
  const tag = <M extends THREE.Material>(material: M, wetness: WetnessKind): M => (m.tag ? (m.tag(material, wetness) as M) : material)
  const lodTag = full ? 'full' : 'blockout'

  const patchWheelEmitterGlints = (
    mat: THREE.Material,
    label: string,
    opts: EmitterGlintSheenOptions,
  ): void => {
    patchEmitterGlintSheen(mat, `wheel emitter glint ${lodTag} ${label}`, opts)
  }

  const makeTireRubber = (w: WheelSize, label: string) => {
    const mat = tag(
      new THREE.MeshPhysicalMaterial({
        color: full ? 0x191d26 : 0x1b1f27,
        roughness: full ? 0.38 : 0.5,
        metalness: 0.02,
        clearcoat: 0.9,
        clearcoatRoughness: 0.082,
        specularIntensity: 1.0,
        envMapIntensity: 1.54,
      }),
      'sheet',
    )
    const id = `wheel tire vulcanized grain ${lodTag} ${label}`
    const seed = stream(id).range(0.1, 21)
    patchMaterial(mat, {
      id,
      uniforms: {
        wheelTireSeed: { value: seed },
        wheelTireRadius: { value: w.radius },
        wheelTireLoaded: { value: w.loaded },
        wheelTirePitches: { value: w.front ? 40 : 32 },
        wheelTireGrainAmt: { value: full ? 1 : 0 },
      },
      apply(shader) {
        shader.vertexShader =
          'attribute float tireCavity;\nattribute vec2 tireUv;\nvarying float wheelTireCav;\nvarying vec2 wheelTireUv;\nvarying vec3 wheelTirePt;\nvarying vec3 wheelTireUpView;\nvarying vec3 wheelTireRadView;\n' +
          shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            wheelTirePt = position;
            wheelTireCav = tireCavity;
            wheelTireUv = tireUv;
            wheelTireUpView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
            vec3 wtLocalRad = length(position.yz) > 1e-4 ? normalize(vec3(0.0, position.y, position.z)) : vec3(0.0, 1.0, 0.0);
            wheelTireRadView = normalize((modelViewMatrix * vec4(wtLocalRad, 0.0)).xyz);`,
          )
        shader.fragmentShader =
          `varying float wheelTireCav;
          varying vec2 wheelTireUv;
          varying vec3 wheelTirePt;
          varying vec3 wheelTireUpView;
          varying vec3 wheelTireRadView;
          uniform float wheelTireSeed;
          uniform float wheelTireRadius;
          uniform float wheelTireLoaded;
          uniform float wheelTirePitches;
          uniform float wheelTireGrainAmt;
          float wheelTireHash(vec3 p) {
            p = fract(p * vec3(0.1031, 0.0973, 0.1099));
            p += dot(p, p.yzx + wheelTireSeed + 19.19);
            return fract((p.x + p.y) * p.z);
          }
          float wtSipePulse(float p, float w0, float w1, float fw) {
            float d = abs(p - floor(p + 0.5));
            return 1.0 - smoothstep(w0, w1 + fw, d);
          }
        ` +
          shader.fragmentShader
            .replace(
              '#include <color_fragment>',
              `#include <color_fragment>
            vec3 wtSymPt = vec3(abs(wheelTirePt.x), wheelTirePt.y, wheelTirePt.z);
            float wtGrain = wheelTireHash(floor(wtSymPt * 1450.0));
            float wtWeight = wheelTireGrainAmt * (1.0 - smoothstep(0.00022, 0.00075, length(fwidth(wtSymPt))));
            float wtU = wheelTireUv.x;
            float wtV = wheelTireUv.y;
            float wtPitch = wtU * wheelTirePitches;
            float wtFw = min(0.20, fwidth(wtPitch));
            float wtSipeFade = 1.0 - smoothstep(0.24, 0.46, wtFw);
            float wtDv = max(0.0, wtV - 0.660);
            float wtSipeOuter = wtSipePulse(wtPitch + wtDv * 2.2 + wtDv * wtDv * 6.2, 0.056, 0.154, wtFw)
              * smoothstep(0.662, 0.676, wtV) * (1.0 - smoothstep(0.758, 0.778, wtV));
            float wtSipeRib1 = wtSipePulse(wtPitch - 0.24 + (wtV - 0.608) * 2.0, 0.052, 0.146, wtFw)
              * smoothstep(0.570, 0.582, wtV) * (1.0 - smoothstep(0.642, 0.654, wtV));
            float wtSipeRib2 = wtSipePulse(wtPitch + 0.18 - (wtV - 0.505) * 1.9, 0.050, 0.144, wtFw)
              * smoothstep(0.466, 0.478, wtV) * (1.0 - smoothstep(0.542, 0.554, wtV));
            float wtSipeRib3 = wtSipePulse(wtPitch - 0.36 + (wtV - 0.399) * 1.9, 0.050, 0.144, wtFw)
              * smoothstep(0.360, 0.372, wtV) * (1.0 - smoothstep(0.436, 0.448, wtV));
            float wtSipeIn = wtSipePulse(wtPitch + 0.35 - (wtV - 0.346) * 2.1, 0.054, 0.150, wtFw)
              * smoothstep(0.264, 0.286, wtV) * (1.0 - smoothstep(0.328, 0.341, wtV));
            float wtSipe = wtSipeFade * max(max(wtSipeOuter, wtSipeRib1), max(max(wtSipeRib2, wtSipeRib3), wtSipeIn));
            float wtMainCh = max(
              max(1.0 - smoothstep(0.0058, 0.0138, abs(wtV - 0.346)), 1.0 - smoothstep(0.0058, 0.0138, abs(wtV - 0.452))),
              max(1.0 - smoothstep(0.0058, 0.0138, abs(wtV - 0.558)), 1.0 - smoothstep(0.0058, 0.0138, abs(wtV - 0.658)))
            );
            float wtShCh = 1.0 - smoothstep(0.0024, 0.0064, abs(wtV - 0.704));
            float wtCav = clamp(max(wheelTireCav, max(wtMainCh, max(0.52 * wtShCh, 0.74 * wtSipe))), 0.0, 1.0);
            float wtTread = smoothstep(0.25, 0.30, wtV) * (1.0 - smoothstep(0.735, 0.785, wtV));
            float wtYRel = wheelTirePt.y + wheelTireLoaded;
            float wtDeckNear = 1.0 - smoothstep(0.02, 0.30, wtYRel);
            float wtSplash = 1.0 - smoothstep(0.008, 0.20, wtYRel);
            float wtWaterline = 1.0 - smoothstep(0.001, 0.016, wtYRel);
            float wtRibTop = wtTread * (1.0 - smoothstep(0.04, 0.36, wtCav));
            float wtSideOuter = smoothstep(0.730, 0.790, wtV) * (1.0 - smoothstep(0.960, 0.992, wtV));
            float wtShoulder = smoothstep(0.640, 0.735, wtV) * (1.0 - smoothstep(0.960, 0.992, wtV));
            float wtCrownSheen = 0.82 + 0.16 * clamp(wheelTirePt.y / max(wheelTireRadius, 0.1) * 0.5 + 0.5, 0.0, 1.0);
            float wtWetRib = wtRibTop * max(0.72 * wtCrownSheen, 0.94 * wtSplash + 0.42 * wtDeckNear);
            float wtWetSide = max(wtSideOuter, 0.94 * wtShoulder) * clamp(0.88 * wtCrownSheen + 0.42 * wtSplash + 0.28 * wtDeckNear, 0.0, 1.0);
            float wtInGroove = clamp(max(smoothstep(0.26, 0.78, wtMainCh), max(0.90 * smoothstep(0.24, 0.78, wtSipe), 0.62 * wtShCh)), 0.0, 1.0);
            float wtWetChannel = wtInGroove * (0.78 + 0.22 * wtDeckNear);
            float wtWetWater = clamp(max(wtWetChannel, max(wtWetRib, wtWetSide)), 0.0, 1.0);
            float wtRibEdge = wtRibTop * smoothstep(0.004, 0.022, wtYRel);
            float wtFootZ = exp(-pow(wheelTirePt.z / 0.105, 2.0)) * smoothstep(0.73, 0.82, max(wtV, 1.0 - wtV));
            float wtBulgeUpper = wtFootZ * smoothstep(0.016, 0.032, wtYRel) * (1.0 - smoothstep(0.048, 0.075, wtYRel));
            float wtBulgeTuck = wtFootZ * (1.0 - smoothstep(0.003, 0.018, wtYRel));
            diffuseColor.rgb *= (1.0 + (wtGrain - 0.5) * 0.06 * wtWeight)
              * mix(1.0, 0.92, wtTread)
              * mix(1.0, 0.18, wtCav)
              * mix(1.0, 1.15, wtRibEdge * (1.0 - 0.40 * wtSplash))
              * mix(1.0, 0.88, max(wtWetRib, wtWetSide))
              * mix(1.0, 1.18, wtBulgeUpper)
              * mix(1.0, 0.84, wtBulgeTuck);
          `,
            )
            .replace(
              '#include <roughnessmap_fragment>',
              `#include <roughnessmap_fragment>
            roughnessFactor = clamp(
              roughnessFactor + (wtGrain - 0.5) * 0.04 * wtWeight - 0.06 * wtTread - 0.06 * wtRibEdge,
              0.30,
              0.64
            );
            roughnessFactor = mix(roughnessFactor, 0.17, max(wtWetRib, wtWetSide));
            roughnessFactor = mix(roughnessFactor, 0.055, max(wtInGroove, max(0.88 * wtSplash, wtWaterline)));
          `,
            )
            .replace(
              '#include <normal_fragment_maps>',
              `#include <normal_fragment_maps>
            float wtReliefH = -(1.0 - 0.45 * wheelTireGrainAmt) * 0.0018 * wtSipe - (1.0 - 0.65 * wheelTireGrainAmt) * 0.0018 * wtMainCh - 0.0009 * wtShCh;
            vec3 wtDx = dFdx(vViewPosition), wtDy = dFdy(vViewPosition);
            vec3 wtR1 = cross(wtDy, normal), wtR2 = cross(normal, wtDx);
            float wtDet = dot(wtDx, wtR1);
            vec3 wtGrad = (dFdx(wtReliefH) * wtR1 + dFdy(wtReliefH) * wtR2) * sign(wtDet);
            normal = normalize(max(abs(wtDet), 1e-9) * normal - wtGrad);
          `,
            )
            .replace(
              '#include <clearcoat_normal_fragment_maps>',
              `#include <clearcoat_normal_fragment_maps>
            float wtMeniscusH = 0.0012 * (wtMainCh * wtMainCh + 0.55 * wtSipe * wtSipe);
            vec3 wtCcGrad = (dFdx(wtMeniscusH) * wtR1 + dFdy(wtMeniscusH) * wtR2) * sign(wtDet);
            vec3 wtCcBase = normalize(max(abs(wtDet), 1e-9) * clearcoatNormal - wtCcGrad);
            float wtCcUp = dot(wtCcBase, wheelTireUpView);
            vec3 wtHorizRaw = wtCcBase - wheelTireUpView * wtCcUp;
            float wtHorizLen = length(wtHorizRaw);
            vec3 wtHorizView = wtHorizLen > 1e-4 ? wtHorizRaw / wtHorizLen : wheelTireRadView;
            float wtLowerDrain = (1.0 - smoothstep(0.012, 0.19, wtYRel)) * clamp(-wtCcUp, 0.0, 1.0);
            vec3 wtDrainedN = normalize(mix(wtCcBase, normalize(wtHorizView - 0.18 * wheelTireUpView), 0.42 * wtLowerDrain));
            vec3 wtCollarN = normalize(mix(wtHorizView, wheelTireUpView, 0.46));
            vec3 wtPoolN = normalize(mix(wheelTireRadView, wheelTireUpView, 0.38 * wtDeckNear));
            clearcoatNormal = normalize(mix(mix(wtDrainedN, wtPoolN, 0.78 * wtInGroove), wtCollarN, 0.76 * wtWaterline));
          `,
            )
            .replace(
              '#include <lights_physical_fragment>',
              `#include <lights_physical_fragment>
            #ifdef USE_CLEARCOAT
              material.clearcoat = clamp(mix(0.42 + 0.50 * wtWetWater + 0.12 * wtSplash, 0.99, max(wtInGroove, wtWaterline)), 0.0, 0.99);
              material.clearcoatRoughness = clamp(mix(mix(0.165, 0.082, wtWetWater) - 0.038 * wtSplash, 0.026, max(wtInGroove, wtWaterline)), 0.024, 0.19);
            #endif
          `,
            )
      },
    })
    patchWheelEmitterGlints(mat, `tire ${label}`, {
      baseCurv: 0.12,
      coatCurv: 0.075,
      coatF0: waterF0 + 0.026,
      gain: 2.45,
      includeBase: false,
    })
    return mat
  }

  const sidewallBand = tag(
    new THREE.MeshPhysicalMaterial({
      color: full ? 0x161a23 : 0x181c24,
      roughness: full ? 0.27 : 0.38,
      metalness: 0.02,
      clearcoat: full ? 0.88 : 0.52,
      clearcoatRoughness: 0.072,
      specularIntensity: 1.0,
      envMapIntensity: 1.36,
    }),
    'sheet',
  )
  patchWheelEmitterGlints(sidewallBand, 'sidewall-relief', {
    baseCurv: 0.038,
    coatCurv: 0.032,
    coatF0: waterF0 + 0.026,
    gain: 2.45,
    includeBase: false,
  })

  const makeRotorFinish = (w: WheelSize, axis: number, label: string) => {
    const mat = tag(
      new THREE.MeshPhysicalMaterial({
        color: full ? 0x282e38 : 0x2e3440,
        metalness: full ? 0.89 : 0.72,
        roughness: full ? 0.25 : 0.31,
        clearcoat: full ? 0.62 : 0.32,
        clearcoatRoughness: 0.088,
        specularIntensity: 1.0,
        envMapIntensity: 1.32,
      }),
      'none',
    )
    const id = `wheel rotor swept finish ${lodTag} ${label}`
    const seed = stream(id).range(0.1, 21)
    patchMaterial(mat, {
      id,
      uniforms: {
        wrSeed: { value: seed },
        wrOuterR: { value: w.disc },
        wrMidX: { value: axis - 0.5 * w.discDepth },
        wrHalfSlot: { value: 0.5 * w.discDepth - 0.0088 },
        wrVanes: { value: full ? 32 : w.front ? 28 : 12 },
        wrGrainAmt: { value: full ? 1 : 0 },
      },
      apply(shader) {
        shader.vertexShader =
          'varying vec3 wheelRotorPt;\nvarying vec3 wheelRotorWorldPos;\nvarying vec3 wheelRotorRadWorld;\n' +
          insertAfter(
            shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nwheelRotorPt = position;'),
            '#include <project_vertex>',
            `{
              vec4 wrP = vec4(transformed, 1.0);
              mat3 wrBasis = mat3(modelMatrix);
              #ifdef USE_INSTANCING
                wrP = instanceMatrix * wrP;
                wrBasis = wrBasis * mat3(instanceMatrix);
              #endif
              wheelRotorWorldPos = (modelMatrix * wrP).xyz;
              vec2 wrYZ = position.yz;
              float wrYZLen = length(wrYZ);
              vec3 wrLocalRad = wrYZLen > 1e-4 ? vec3(0.0, wrYZ.x / wrYZLen, wrYZ.y / wrYZLen) : vec3(0.0, 1.0, 0.0);
              wheelRotorRadWorld = normalize(wrBasis * wrLocalRad);
            }`,
          )
        let f =
          `varying vec3 wheelRotorPt;
          varying vec3 wheelRotorWorldPos;
          varying vec3 wheelRotorRadWorld;
          uniform float wrSeed;
          uniform float wrOuterR;
          uniform float wrMidX;
          uniform float wrHalfSlot;
          uniform float wrVanes;
          uniform float wrGrainAmt;
          float wrHash(vec3 p) {
            p = fract(p * vec3(0.1031, 0.0973, 0.1099));
            p += dot(p, p.yzx + wrSeed + 19.19);
            return fract((p.x + p.y) * p.z);
          }
          float wrNoise1(float x) {
            float i = floor(x);
            float f = fract(x);
            float u = f * f * (3.0 - 2.0 * f);
            float a = wrHash(vec3(i, 3.1, 7.7));
            float b = wrHash(vec3(i + 1.0, 3.1, 7.7));
            return mix(a, b, u) - 0.5;
          }
          float wrRingNoise(float t, float period) {
            float x = fract(t) * period;
            float i = floor(x);
            float f = fract(x);
            float u = f * f * (3.0 - 2.0 * f);
            float a = wrHash(vec3(mod(i, period), 11.3, 5.9));
            float b = wrHash(vec3(mod(i + 1.0, period), 11.3, 5.9));
            return mix(a, b, u) - 0.5;
          }
        ` +
          shader.fragmentShader
            .replace(
              '#include <color_fragment>',
              `#include <color_fragment>
            float wrR = length(wheelRotorPt.yz);
            float wrFoot = length(fwidth(wheelRotorPt.yz));
            float wrSwept = smoothstep(0.111, 0.117, wrR) * (1.0 - smoothstep(wrOuterR - 0.0088, wrOuterR - 0.0038, wrR));
            float wrInSlot = 1.0 - smoothstep(wrHalfSlot - 0.0012, wrHalfSlot + 0.0006, abs(abs(wheelRotorPt.x) - wrMidX));
            float wrOct1 = (1.0 - smoothstep(0.16, 0.42, wrFoot * 105.0)) * wrNoise1(wrR * 105.0);
            float wrOct2 = (1.0 - smoothstep(0.16, 0.42, wrFoot * 235.0)) * wrNoise1(wrR * 235.0);
            float wrFine = (1.0 - smoothstep(0.14, 0.40, wrFoot * 460.0)) * sin(wrR * 460.0) * 0.5;
            float wrRings = 0.68 * wrOct1 + 0.46 * wrOct2 + 0.42 * wrFine;
            float wrTheta = atan(wheelRotorPt.y, wheelRotorPt.z);
            float wrTurn = wrTheta * 0.15915494 + 0.5;
            float wrAngFoot = wrFoot / max(0.08, wrR);
            float wrVaneFade = 1.0 - smoothstep(0.025, 0.075, wrAngFoot);
            float wrSpokeFade = 1.0 - smoothstep(0.012, 0.036, wrAngFoot);
            float wrRadial = 0.085 * cos(wrTheta * wrVanes) * wrVaneFade
              + 0.095 * wrRingNoise(wrTurn, 72.0) * wrSpokeFade;
            vec3 wrSymPt = vec3(abs(wheelRotorPt.x), wheelRotorPt.y, wheelRotorPt.z);
            float wrGrain = wrHash(floor(wrSymPt * 920.0));
            float wrGrainW = wrGrainAmt * (1.0 - smoothstep(0.00028, 0.00085, wrFoot));
            float wrBandGain = mix(0.32, 1.06, wrSwept);
            wrBandGain = mix(wrBandGain, 1.24, wrInSlot);
            diffuseColor.rgb *= wrBandGain
              * (1.0 + wrSwept * (0.34 * wrRings + wrRadial) + (wrGrain - 0.5) * 0.16 * wrGrainW);
          `,
            )
            .replace(
              '#include <roughnessmap_fragment>',
              `#include <roughnessmap_fragment>
            roughnessFactor = clamp(
              roughnessFactor + mix(0.16, -0.07, wrSwept) - 0.10 * wrInSlot - 0.08 * wrSwept * wrRings + (wrGrain - 0.5) * 0.08 * wrGrainW,
              0.15,
              0.72
            );
          `,
            )
            .replace(
              '#include <normal_fragment_maps>',
              `#include <normal_fragment_maps>
            float wrGrooveH = wrSwept * (0.0018 * wrOct1 + 0.0011 * wrOct2 + 0.0007 * wrFine);
            vec3 wrDx = dFdx(vViewPosition), wrDy = dFdy(vViewPosition);
            vec3 wrR1 = cross(wrDy, normal), wrR2 = cross(normal, wrDx);
            float wrDet = dot(wrDx, wrR1);
            vec3 wrGrad = (dFdx(wrGrooveH) * wrR1 + dFdy(wrGrooveH) * wrR2) * sign(wrDet);
            vec3 wrRadView = normalize((viewMatrix * vec4(wheelRotorRadWorld, 0.0)).xyz);
            vec3 wrRadTan = wrRadView - normal * dot(wrRadView, normal);
            normal = normalize(normalize(max(abs(wrDet), 1e-9) * normal - wrGrad) + wrSwept * 0.17 * wrRadTan);
          `,
            )
        f = insertAfter(
          f,
          '#include <lights_fragment_end>',
          `{
            vec3 wrToEye = cameraPosition - wheelRotorWorldPos;
            vec3 wrV = wrToEye / max(length(wrToEye), 1e-4);
            vec3 wrN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
            vec3 wrRadT = wheelRotorRadWorld - wrN * dot(wheelRotorRadWorld, wrN);
            float wrRadLen = length(wrRadT);
            vec3 wrRad = wrRadLen > 1e-4 ? wrRadT / wrRadLen : vec3(0.0, 1.0, 0.0);
            vec3 wrTan = normalize(cross(wrN, wrRad));
            vec3 wrN1 = normalize(wrN + 0.28 * wrRad);
            vec3 wrN2 = normalize(wrN - 0.28 * wrRad);
            vec3 wrT1 = normalize(wrN + 0.22 * wrTan);
            vec3 wrT2 = normalize(wrN - 0.22 * wrTan);
            float wrRough = clamp(material.roughness, 0.16, 0.55);
            vec3 wrF0 = material.specularColor;
            vec3 wrGlint = 0.30 * emitterGlintF0(wheelRotorWorldPos, wrN, wrV, wrRough, 0.12, wrF0)
              + 0.24 * emitterGlintF0(wheelRotorWorldPos, wrN1, wrV, wrRough, 0.08, wrF0)
              + 0.22 * emitterGlintF0(wheelRotorWorldPos, wrN2, wrV, wrRough, 0.08, wrF0)
              + 0.12 * emitterGlintF0(wheelRotorWorldPos, wrT1, wrV, wrRough, 0.09, wrF0)
              + 0.12 * emitterGlintF0(wheelRotorWorldPos, wrT2, wrV, wrRough, 0.09, wrF0);
            vec3 wrIbl = vec3(0.0);
            #ifdef USE_ENVMAP
              wrIbl = emitterFresnel(wrF0, clamp(dot(wrN, wrV), 0.0, 1.0)) * getIBLRadiance(normalize(vViewPosition), normal, wrRough);
            #endif
            reflectedLight.indirectSpecular += min(max(wrGlint - wrIbl, vec3(0.0)) * (0.48 + 1.22 * wrSwept), vec3(36.0));
          }`,
        )
        shader.fragmentShader = f
        withEmitters(shader)
      },
    })
    return mat
  }

  const wheelSatinFace = tag(
    new THREE.MeshPhysicalMaterial({
      color: full ? 0x06080c : 0x10131a,
      metalness: 0.14,
      roughness: full ? 0.21 : 0.27,
      clearcoat: full ? 0.95 : 0.62,
      clearcoatRoughness: 0.052,
      specularIntensity: 1.0,
      envMapIntensity: 1.08,
    }),
    'sheet',
  )
  patchWheelEmitterGlints(wheelSatinFace, 'spoke-web', { baseCurv: 0.15, coatCurv: 0.12, gain: 1.85 })

  const wheelDeepGloss = tag(
    new THREE.MeshPhysicalMaterial({
      color: full ? 0x05070b : 0x0d1017,
      metalness: 0.14,
      roughness: full ? 0.2 : 0.28,
      clearcoat: full ? 0.92 : 0.55,
      clearcoatRoughness: 0.056,
      specularIntensity: 0.98,
      envMapIntensity: full ? 1.02 : 0.95,
    }),
    'sheet',
  )
  patchWheelEmitterGlints(wheelDeepGloss, 'spoke-recess', { baseCurv: 0.08, coatCurv: 0.068, gain: 1.9 })

  const wheelBarrel = tag(
    new THREE.MeshPhysicalMaterial({
      color: full ? 0x05070b : 0x0e1118,
      metalness: 0.16,
      roughness: full ? 0.19 : 0.28,
      clearcoat: full ? 0.94 : 0.52,
      clearcoatRoughness: 0.054,
      specularIntensity: 0.98,
      envMapIntensity: full ? 1.12 : 1.0,
    }),
    'sheet',
  )
  patchWheelEmitterGlints(wheelBarrel, 'rim-barrel', { baseCurv: 0.2, coatCurv: 0.18, gain: 1.65 })

  const wheelChamfer = tag(
    new THREE.MeshPhysicalMaterial({
      color: full ? 0x191f2b : 0x202634,
      metalness: full ? 0.8 : 0.56,
      roughness: full ? 0.13 : 0.2,
      clearcoat: full ? 0.98 : 0.65,
      clearcoatRoughness: 0.038,
      specularIntensity: 1.0,
      envMapIntensity: full ? 1.14 : 1.1,
    }),
    'sheet',
  )
  patchWheelEmitterGlints(wheelChamfer, 'spoke-chamfer', { baseCurv: 0.038, coatCurv: 0.034, gain: 2.45 })

  const wheelLipLine = tag(
    new THREE.MeshPhysicalMaterial({
      color: full ? 0x222938 : 0x272f40,
      metalness: full ? 0.84 : 0.6,
      roughness: 0.11,
      clearcoat: 0.99,
      clearcoatRoughness: 0.032,
      specularIntensity: 1.0,
      envMapIntensity: 1.32,
    }),
    'sheet',
  )
  patchWheelEmitterGlints(wheelLipLine, 'rim-flange', { baseCurv: 0.034, coatCurv: 0.03, gain: 2.45 })

  const wheelCapFinish = tag(
    new THREE.MeshPhysicalMaterial({
      color: full ? 0x04060a : 0x0c0f16,
      metalness: 0.12,
      roughness: full ? 0.18 : 0.28,
      clearcoat: full ? 0.94 : 0.52,
      clearcoatRoughness: 0.052,
      specularIntensity: 0.96,
      envMapIntensity: 0.88,
    }),
    'sheet',
  )
  patchWheelEmitterGlints(wheelCapFinish, 'cap', { baseCurv: 0.055, coatCurv: 0.048, gain: 2.05 })

  const lugFinish = tag(
    new THREE.MeshPhysicalMaterial({
      color: full ? 0x1c222e : 0x222834,
      metalness: full ? 0.76 : 0.52,
      roughness: 0.16,
      clearcoat: 0.9,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.38,
    }),
    'sheet',
  )
  patchWheelEmitterGlints(lugFinish, 'lugs', { baseCurv: 0.028, coatCurv: 0.026, gain: 1.8 })

  const wheelHardware = tag(
    new THREE.MeshPhysicalMaterial({
      color: full ? 0x525a68 : 0x565e6c,
      metalness: full ? 0.88 : 0.64,
      roughness: 0.2,
      clearcoat: 0.65,
      envMapIntensity: 1.28,
    }),
    'none',
  )
  const makeCaliperFinish = (axis: number, label: string) => {
    const mat = tag(
      new THREE.MeshPhysicalMaterial({
        color: full ? 0xb21924 : 0x8e1620,
        metalness: full ? 0.16 : 0.16,
        roughness: full ? 0.18 : 0.24,
        clearcoat: full ? 0.96 : 0.72,
        clearcoatRoughness: full ? 0.056 : 0.1,
        specularIntensity: 1.0,
        envMapIntensity: full ? 1.54 : 1.12,
      }),
      'none',
    )
    patchMaterial(mat, {
      id: `wheel caliper cavity shade ${lodTag} ${label}`,
      uniforms: { wcAxis: { value: axis } },
      apply(shader) {
        shader.vertexShader =
          'varying vec3 wheelCalPt;\n' +
          shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nwheelCalPt = position;')
        shader.fragmentShader =
          'varying vec3 wheelCalPt;\nuniform float wcAxis;\n' +
          shader.fragmentShader.replace(
            '#include <color_fragment>',
            '#include <color_fragment>\ndiffuseColor.rgb *= mix(0.52, 1.0, smoothstep(wcAxis - 0.018, wcAxis + 0.014, abs(wheelCalPt.x)));',
          )
      },
    })
    patchWheelEmitterGlints(mat, `caliper ${label}`, {
      baseCurv: 0.065,
      coatCurv: 0.052,
      coatF0: 0.048,
      gain: 1.95,
      includeBase: false,
    })
    return mat
  }
  const hatFinish = tag(
    new THREE.MeshPhysicalMaterial({
      color: full ? 0x0c0f15 : 0x181c24,
      metalness: full ? 0.55 : 0.45,
      roughness: 0.28,
      clearcoat: 0.45,
      envMapIntensity: 1.05,
    }),
    'none',
  )

  const addMesh = (parent: THREE.Object3D, name: string, g: THREE.BufferGeometry, mat: THREE.Material): void => {
    const mesh = new THREE.Mesh(g, mat)
    mesh.name = name
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
  }

  let anchor: V3 = [0, 0, 0]
  for (const w of [frontWheelSize(), rearWheelSize()]) {
    const axleLabel = w.front ? 'front' : 'rear'
    const tireRubber = makeTireRubber(w, axleLabel)
    const H = w.width / 2
    const axis = w.front ? H - 0.047 : H - 0.04
    const face = H - 0.008
    const hubPlane = face - 0.03
    const hubFace = hubPlane + 0.0018
    const rotorFinish = makeRotorFinish(w, axis, axleLabel)
    const caliperFinish = makeCaliperFinish(axis, axleLabel)
    const pins = joined(
      Array.from({ length: 10 }, (_, i) => {
        const [, y, z] = axisRoll(0, 0.1065, (tau * i) / 10 + 0.134)
        return ensureValidWheelGeometry(
          lathe(
            [
              [axis - 0.0035, 0.0064],
              [axis + 0.0018, 0.0058],
              [axis + 0.0018, 0.0031],
              [axis - 0.003, 0.0027],
            ],
            full ? 8 : 6,
          ).translate(0, y, z),
        )
      }),
    )
    const shield = disk(w.disc - 0.004, 0.008, -0.054, full ? 36 : 16)
    const buildSet = (hero: boolean) => ({
      tire: tireGeometry(w, full, hero),
      wheel: forgedWheelAssembly(w, full, hero),
      brakeSet: rotor(w, full, axis, hero),
      caliperSet: caliper(w, full, axis, hero),
      sidewall: sidewallReliefGeometry(w, full, hero),
    })
    const primary = buildSet(w.front)
    const farSide = !full && w.front ? buildSet(false) : primary
    for (const side of [1, -1] as const) {
      const set = side === 1 ? primary : farSide
      const geo = (x: THREE.BufferGeometry): THREE.BufferGeometry => (side === 1 ? x : mirrorGeometry(x))
      const { satinWeb, forging, barrel, machinedSpokes, flange, hub, cap, lugs } = set.wheel
      const [brake, apertures, hat] = set.brakeSet
      const [castCaliper, clips, fasteners] = set.caliperSet
      const group = new THREE.Group()
      group.name = `wheel-${axleLabel}-${side === 1 ? 'left' : 'right'}`
      group.position.set(w.x * side, w.loaded, w.z)
      addMesh(group, 'tire', geo(set.tire), tireRubber)
      addMesh(group, 'sidewall-relief', geo(set.sidewall), sidewallBand)
      addMesh(group, 'spoke-web', geo(satinWeb), wheelSatinFace)
      addMesh(group, 'spoke-recess', geo(forging), wheelDeepGloss)
      addMesh(group, 'rim-barrel', geo(barrel), wheelBarrel)
      addMesh(group, 'spoke-chamfer', geo(machinedSpokes), wheelChamfer)
      addMesh(group, 'rim-flange', geo(flange), wheelLipLine)
      addMesh(group, 'hub-bowl', geo(hub), wheelDeepGloss)
      addMesh(group, 'rim', geo(cap), wheelCapFinish)
      addMesh(group, 'lug-bolts', geo(lugs), lugFinish)
      addMesh(group, 'disc', geo(brake), rotorFinish)
      addMesh(group, 'disc-vents', geo(apertures), m.dark)
      addMesh(group, 'disc-hat', geo(hat), hatFinish)
      addMesh(group, 'disc-bobbins', geo(pins), wheelHardware)
      addMesh(group, 'dust-shield', geo(shield), m.dark)
      addMesh(group, 'caliper', geo(castCaliper), caliperFinish)
      addMesh(group, 'caliper-clips', geo(clips), m.matte)
      addMesh(group, 'caliper-pins', geo(fasteners), wheelHardware)
      root.add(group)
    }
    if (w.front) anchor = [w.x + hubFace, w.loaded, w.z]
  }
  return anchor
}
