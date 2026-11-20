import * as T from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export type Point = readonly [number, number, number]
export type Surface = (u: number, v: number) => Point
export type Knot = readonly [number, number]
export type Material = T.MeshStandardMaterial | T.MeshPhysicalMaterial
export const mix = T.MathUtils.lerp
export const smooth = T.MathUtils.smoothstep
export const tau = 2 * Math.PI
export const vec = (p: Point) => new T.Vector3(...p)
export const blend = (a: Point, b: Point, t: number): Point => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]

export function curve(knots: readonly Knot[]): (x: number) => number {
  const slopes = knots.slice(1).map(([x, y], i) => (y - knots[i][1]) / (x - knots[i][0]))
  const derivatives = knots.map((_, i) => {
    if (i === 0) return slopes[0]
    if (i === knots.length - 1) return slopes[i - 1]
    const a = slopes[i - 1], b = slopes[i]
    return a * b > 0 ? (2 * a * b) / (a + b) : 0
  })
  return (x) => {
    if (x <= knots[0][0]) return knots[0][1]
    if (x >= knots.at(-1)![0]) return knots.at(-1)![1]
    let i = 0
    while (x > knots[i + 1][0]) i++
    const [x0, y0] = knots[i]
    const [x1, y1] = knots[i + 1]
    const d = x1 - x0, t = (x - x0) / d, q = t * (1 - t)
    return mix(y0, y1, t) + q * ((1 - t) * (d * derivatives[i] - (y1 - y0)) + t * ((y1 - y0) - d * derivatives[i + 1]))
  }
}

type FairOptions = {
  controls?: number
  interior?: readonly number[]
  pins?: readonly Knot[]
  breaks?: readonly Knot[]
  penalty?: number
  flatStart?: boolean
  flatEnd?: boolean
}

function cubicBasis(knots: readonly number[], t: number): number[] {
  const count = knots.length - 4
  if (t >= 1) return Array.from({ length: count }, (_, i) => +(i === count - 1))
  const b = knots.slice(1).map((right, i) => +(t >= knots[i] && t < right))
  for (let d = 1; d <= 3; d++) for (let i = 0; i + d < b.length; i++) {
    const a = knots[i + d] - knots[i], c = knots[i + d + 1] - knots[i + 1]
    b[i] = (a ? (t - knots[i]) * b[i] / a : 0) + (c ? (knots[i + d + 1] - t) * b[i + 1] / c : 0)
  }
  return b.slice(0, count)
}

function solveFit(a: number[][], b: number[]): number[] {
  for (let i = 0; i < a.length; i++) {
    let p = i
    for (let j = i + 1; j < a.length; j++) if (Math.abs(a[j][i]) > Math.abs(a[p][i])) p = j
    if (Math.abs(a[p][i]) < 1e-12) throw new Error('Dependent fair-curve constraints')
    ;[a[i], a[p]] = [a[p], a[i]]
    ;[b[i], b[p]] = [b[p], b[i]]
    for (let j = i + 1; j < a.length; j++) {
      const scale = a[j][i] / a[i][i]
      for (let k = i + 1; k < a.length; k++) a[j][k] -= a[i][k] * scale
      b[j] -= b[i] * scale
    }
  }
  for (let i = b.length - 1; i >= 0; i--) {
    for (let j = i + 1; j < b.length; j++) b[i] -= a[i][j] * b[j]
    b[i] /= a[i][i]
  }
  return b
}

export function fairCurve(trace: readonly Knot[], options: FairOptions = {}): (x: number) => number {
  const first = trace[0], last = trace[trace.length - 1], origin = first[0], span = last[0] - origin
  const unit = (x: number) => (x - origin) / span
  if (options.breaks?.length) {
    const ends = [first, ...options.breaks, last]
    const fits = ends.slice(1).map((right, i) => {
      const left = ends[i], inside = (x: number) => left[0] < x && x < right[0]
      return fairCurve([left, ...trace.filter(([x]) => inside(x)), right], {
        ...options, breaks: [], interior: options.interior?.filter(inside), pins: options.pins?.filter(([x]) => inside(x)),
        flatStart: i === 0 && options.flatStart, flatEnd: i === ends.length - 2 && options.flatEnd,
      })
    })
    return (x) => {
      let i = 0
      while (i + 1 < fits.length && x > ends[i + 1][0]) i++
      return fits[i](x)
    }
  }
  const pins = (options.pins ?? []).filter(([x]) => x > origin && x < last[0])
  const minimum = 2 + pins.length + 2 * (Number(!!options.flatStart) + Number(!!options.flatEnd))
  const count = options.interior ? options.interior.length + 4 :
    Math.max(4, minimum, options.controls ?? Math.min(8, Math.ceil(trace.length * .68)))
  const interior = options.interior?.map(unit) ??
    Array.from({ length: count - 4 }, (_, i) => (i + 1) / (count - 3))
  const edges = [0, ...interior, 1]
  const knots = [0, 0, 0, ...edges, 1, 1, 1]
  const basis = (u: number) => cubicBasis(knots, u)
  const constraints = [first, ...pins, last].map(([x, y]) => ({ row: basis(unit(x)), y }))
  const flat = (i: number, j: number) => constraints.push({ row: Array.from({ length: count }, (_, k) => +(k === i) - +(k === j)), y: 0 })
  if (options.flatStart) { flat(0, 1); flat(1, 2) }
  if (options.flatEnd) { flat(count - 1, count - 2); flat(count - 2, count - 3) }
  const size = count + constraints.length
  const a = Array.from({ length: size }, () => new Array<number>(size).fill(0))
  const b = new Array<number>(size).fill(0)
  const accumulate = (row: number[], y: number, weight: number) => {
    for (let i = 0; i < count; i++) {
      b[i] += row[i] * y * weight
      for (let j = 0; j < count; j++) a[i][j] += row[i] * row[j] * weight
    }
  }
  trace.forEach(([x, y]) => accumulate(basis(unit(x)), y, 1))
  const samples = edges.slice(1).map((right, i) => {
    const left = edges[i], length = right - left
    return [0, 1 / 3, 2 / 3, 1].map((u) => basis(left + u * length))
  })
  // Each span contributes the integral of its squared third derivative.
  samples.forEach(([p, q, r, s], i) => {
    const length = edges[i + 1] - edges[i]
    accumulate(p.map((v, j) => s[j] - 3 * r[j] + 3 * q[j] - v), 0, (options.penalty ?? 6e-8) * 729 / length ** 5)
  })
  constraints.forEach(({ row, y }, k) => {
    row.forEach((v, j) => { a[count + k][j] = a[j][count + k] = v })
    b[count + k] = y
  })
  const controls = solveFit(a, b)
  const coefficients = samples.map((rows) => {
    const [p, q, r, s] = rows.map((row) => row.reduce((y, v, i) => y + v * controls[i], 0))
    const d1 = q - p, d2 = r - 2 * q + p, d3 = s - 3 * r + 3 * q - p
    return [p, 3 * d1 - 1.5 * d2 + d3, 4.5 * (d2 - d3), 4.5 * d3]
  })
  return (x) => {
    if (x <= origin) return first[1]
    if (x >= last[0]) return last[1]
    const u = unit(x)
    let i = 0
    while (u > edges[i + 1]) i++
    const t = (u - edges[i]) / (edges[i + 1] - edges[i])
    const [p, q, r, s] = coefficients[i]
    return p + t * (q + t * (r + t * s))
  }
}

export function patch(point: Surface, uSteps: number, vSteps: number, outward: Point, thickness = 0, row?: (u: number, j: number) => number): T.BufferGeometry {
  const p: number[] = [], n: number[] = [], uv: number[] = [], id: number[] = []
  const d = 0.0001
  const toNormal = (u: number, v: number) => vec(point(Math.min(1, u + d), v)).sub(vec(point(Math.max(0, u - d), v)))
    .cross(vec(point(u, Math.min(1, v + d))).sub(vec(point(u, Math.max(0, v - d)))))
  const flip = toNormal(0.5, 0.5).dot(vec(outward)) < 0
  const distance = (alongU: boolean, cross: number) => {
    const path = (n: number) => vec(alongU ? point(n / 8, cross) : point(cross, n / 8))
    let length = 0
    for (let i = 0; i < 8; i++) length += path(i).distanceTo(path(i + 1))
    return length
  }
  const uMeters = (distance(true, .25) + distance(true, .75)) * .5
  const vMeters = (distance(false, .25) + distance(false, .75)) * .5
  for (let j = 0; j <= vSteps; j++) for (let i = 0; i <= uSteps; i++) {
    const u = i / uSteps, v = row ? row(u, j) : j / vSteps
    p.push(...point(u, v))
    const normal = toNormal(u, v).normalize().multiplyScalar(flip ? -1 : 1)
    n.push(...(normal.lengthSq() > 0 ? normal.toArray() : outward))
    uv.push(u * uMeters, v * vMeters)
  }
  const triangle = (a: number, b: number, c: number, reversed = false) => id.push(a, flip === reversed ? b : c, flip === reversed ? c : b)
  const stride = uSteps + 1
  for (let j = 0; j < vSteps; j++) for (let i = 0; i < uSteps; i++) {
    const a = j * stride + i
    triangle(a, a + 1, a + stride + 1)
    triangle(a, a + stride + 1, a + stride)
  }
  if (thickness > 0) {
    const count = p.length / 3
    for (let i = 0; i < count; i++) {
      p.push(p[i * 3] - thickness * n[i * 3], p[i * 3 + 1] - thickness * n[i * 3 + 1], p[i * 3 + 2] - thickness * n[i * 3 + 2])
      n.push(-n[i * 3], -n[i * 3 + 1], -n[i * 3 + 2])
      uv.push(uv[i * 2], uv[i * 2 + 1])
    }
    const size = id.length
    for (let i = 0; i < size; i += 3) id.push(id[i] + count, id[i + 2] + count, id[i + 1] + count)
    const edge = (a: number, b: number) => {
      const aPoint = vec([p[a * 3], p[a * 3 + 1], p[a * 3 + 2]])
      const e = vec([p[b * 3], p[b * 3 + 1], p[b * 3 + 2]]).sub(aPoint)
      const depth = vec([p[(a + count) * 3], p[(a + count) * 3 + 1], p[(a + count) * 3 + 2]]).sub(aPoint)
      const normal = e.cross(depth).normalize().multiplyScalar(flip ? -1 : 1)
      const k = p.length / 3
      const du = uv[b * 2] - uv[a * 2], dv = uv[b * 2 + 1] - uv[a * 2 + 1]
      const scale = thickness / Math.max(1e-6, Math.hypot(du, dv))
      for (const source of [a, b, b + count, a + count]) {
        const offset = source >= count ? scale : 0
        p.push(p[source * 3], p[source * 3 + 1], p[source * 3 + 2]); n.push(...normal.toArray())
        uv.push(uv[source * 2] - dv * offset, uv[source * 2 + 1] + du * offset)
      }
      triangle(k, k + 1, k + 2); triangle(k, k + 2, k + 3)
    }
    for (let i = 0; i < uSteps; i++) { edge(i + 1, i); edge(vSteps * stride + i, vSteps * stride + i + 1) }
    for (let j = 0; j < vSteps; j++) { edge(j * stride, (j + 1) * stride); edge((j + 1) * stride + uSteps, j * stride + uSteps) }
  }
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.Float32BufferAttribute(p, 3))
  geometry.setAttribute('normal', new T.Float32BufferAttribute(n, 3))
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
  geometry.setIndex(id)
  return geometry
}

export function contour(points: readonly Point[], radius: number, closed = false, segments = 8): T.BufferGeometry {
  return new T.TubeGeometry(new T.CatmullRomCurve3(points.map(vec), closed, 'centripetal'), Math.max(10, points.length * 5), radius, segments, closed)
}

export function polygon(points: readonly Point[], outward: Point, thickness = 0): T.BufferGeometry {
  const normal = vec(outward).normalize()
  const primary = Math.abs(normal.z) > 0.6 ? [0, 1] : Math.abs(normal.x) > 0.6 ? [2, 1] : [0, 2]
  const outline = points.map((p) => new T.Vector2(p[primary[0]], p[primary[1]]))
  const faces = T.ShapeUtils.triangulateShape(outline, [])
  const packed = points.map(vec)
  const uv = outline.flatMap(({ x, y }) => [x, y])
  const flip = vec(points[faces[0][1]]).sub(vec(points[faces[0][0]]))
    .cross(vec(points[faces[0][2]]).sub(vec(points[faces[0][0]]))).dot(normal) < 0
  const index = faces.flatMap(([a, b, c]) => flip ? [a, c, b] : [a, b, c])
  if (thickness > 0) {
    const size = points.length
    packed.push(...points.map((p) => vec(p).addScaledVector(normal, -thickness)))
    uv.push(...uv.slice())
    index.push(...faces.flatMap(([a, b, c]) => flip ? [a + size, b + size, c + size] : [a + size, c + size, b + size]))
    for (let i = 0; i < size; i++) {
      const j = (i + 1) % size
      if (flip) index.push(i, j, j + size, i, j + size, i + size)
      else index.push(i, j + size, j, i, i + size, j + size)
    }
  }
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.Float32BufferAttribute(packed.flatMap((p) => p.toArray()), 3))
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
  geometry.setIndex(index)
  if (thickness > 0) {
    const flat = geometry.toNonIndexed()
    flat.computeVertexNormals()
    return flat
  }
  geometry.computeVertexNormals()
  return geometry
}

export function joined(geometries: T.BufferGeometry[]): T.BufferGeometry {
  const indexed = geometries.every((g) => g.index !== null)
  if (indexed || geometries.every((g) => g.index === null)) return mergeGeometries(geometries)
  return mergeGeometries(geometries.map((g) => g.index ? g.toNonIndexed() : g))
}

export function add(parent: T.Object3D, name: string, geometry: T.BufferGeometry, material: Material): T.Mesh<T.BufferGeometry, Material> {
  const mesh = new T.Mesh(geometry, material)
  mesh.name = name
  mesh.castShadow = mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

export function roundedPath(points: readonly Point[], cuts = 4, radius = 0.15): Point[] {
  return points.flatMap((p, i) => {
    const a = blend(p, points[(i + points.length - 1) % points.length], radius)
    const b = blend(p, points[(i + 1) % points.length], radius)
    return Array.from({ length: cuts + 1 }, (_, j) => blend(blend(a, p, j / cuts), blend(p, b, j / cuts), j / cuts))
  })
}

export function strut(a: Point, b: Point, radius: number, sides = 8): T.BufferGeometry {
  const av = vec(a), bv = vec(b), mid = av.clone().lerp(bv, 0.5)
  const rotation = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), bv.clone().sub(av).normalize())
  return new T.CylinderGeometry(radius, radius, av.distanceTo(bv), sides, 1, true)
    .applyQuaternion(rotation).translate(mid.x, mid.y, mid.z)
}

export function hexMesh(map: (u: number, v: number) => Point, width: number, height: number, cell: number, gauge: number): T.BufferGeometry {
  const segments: T.BufferGeometry[] = []
  const horizontal = cell * 1.5, vertical = cell * Math.sqrt(3)
  for (let column = 0; column * horizontal + cell * 2 < width; column++) {
    const x = cell + column * horizontal
    for (let row = 0; (row + 1.5) * vertical < height; row++) {
      const y = (row + 0.5 + (column % 2) * 0.5) * vertical
      for (let k = 0; k < 6; k++) {
        if (column > 0 && (k === 2 || k === 3)) continue
        if (row > 0 && k === 4) continue
        const vertex = (step: number) => map((x + cell * Math.cos(step * tau / 6)) / width, (y + cell * Math.sin(step * tau / 6)) / height)
        segments.push(strut(vertex(k), vertex(k + 1), gauge, 4))
      }
    }
  }
  return joined(segments)
}
